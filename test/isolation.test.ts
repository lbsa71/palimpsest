import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { IsolationUnavailableError, runIsolated } from '../src/isolation.ts';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'palimpsest-isolation-'));
  const work = join(root, 'work'); const scratch = join(root, 'scratch'); const privateDir = join(root, 'private');
  for (const path of [work, scratch, privateDir]) mkdirSync(path);
  const secret = join(privateDir, 'credentials.env'); writeFileSync(secret, 'fixture secret');
  const state = join(privateDir, 'lived-state.sqlite'); writeFileSync(state, 'fixture current history');
  const allowed = join(work, 'input.json'); writeFileSync(allowed, '{"input":21}');
  return { root, work, scratch, secret, state, allowed, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('unsupported operating systems fail closed', { skip: process.platform === 'darwin' }, async () => {
  await assert.rejects(runIsolated({ program: process.execPath, args: ['-e', 'console.log(1)'], cwd: tmpdir() }), IsolationUnavailableError);
});

test('Seatbelt permits explicitly scoped read/compute/write and JSON stdin', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    const output = join(f.scratch, 'output.json');
    const script = `const fs=require('node:fs'); const input=JSON.parse(fs.readFileSync(${JSON.stringify(f.allowed)},'utf8')); const stdin=JSON.parse(fs.readFileSync(0,'utf8')); fs.writeFileSync(${JSON.stringify(output)},JSON.stringify(input.input+stdin.increment)); console.log(input.input+stdin.increment);`;
    const entrypoint = join(f.work, 'compute.cjs'); writeFileSync(entrypoint, script);
    const result = await runIsolated({ program: process.execPath, args: [entrypoint], cwd: f.work, writePaths: [f.scratch], stdin: '{"increment":21}' });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.trim(), '42');
    assert.equal(readFileSync(output, 'utf8'), '42');
    assert.equal(result.timedOut, false);
  } finally { f.cleanup(); }
});

test('actual private reads, protected writes, shell exec, and network calls are denied', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    const source = join(f.work, 'source.ts'); writeFileSync(source, 'unchanged source');
    const secretLink = join(f.work, 'secret-link'); symlinkSync(f.secret, secretLink);
    const stateLink = join(f.scratch, 'state-link'); symlinkSync(f.state, stateLink);
    const script = `const fs=require('node:fs');const cp=require('node:child_process');const net=require('node:net'); const results={};
      for(const [name,fn] of Object.entries({secret:()=>fs.readFileSync(${JSON.stringify(f.secret)}),stateWrite:()=>fs.writeFileSync(${JSON.stringify(f.state)},'corrupted'),repoWrite:()=>fs.writeFileSync(${JSON.stringify(source)},'corrupted'),secretLink:()=>fs.readFileSync(${JSON.stringify(secretLink)}),stateLink:()=>fs.writeFileSync(${JSON.stringify(stateLink)},'corrupted')})) {try{fn();results[name]='ALLOWED';}catch(e){results[name]=e.code;}}
      const shell=cp.spawnSync('/bin/sh',['-c','echo escaped']);results.shell=shell.error?.code??shell.status;
      const socket=net.connect({host:'127.0.0.1',port:9});socket.once('error',error=>{results.network=error.code;console.log(JSON.stringify(results));});socket.once('connect',()=>{results.network='ALLOWED';socket.destroy();console.log(JSON.stringify(results));});`;
    const result = await runIsolated({ program: process.execPath, args: ['-e', script], cwd: f.work, writePaths: [f.scratch], timeoutMs: 3000 });
    assert.equal(result.exitCode, 0, result.stderr);
    const denied = JSON.parse(result.stdout);
    for (const operation of ['secret', 'stateWrite', 'repoWrite', 'secretLink', 'stateLink', 'shell', 'network']) assert.match(String(denied[operation]), /^(EPERM|EACCES)$/, operation);
    assert.equal(readFileSync(f.state, 'utf8'), 'fixture current history');
    assert.equal(readFileSync(source, 'utf8'), 'unchanged source');
  } finally { f.cleanup(); }
});

test('environment is fresh and rejects secret or runtime-injection overrides', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture(); const key = 'PALIMPSEST_FIXTURE_SECRET'; process.env[key] = 'must not inherit';
  try {
    const result = await runIsolated({ program: process.execPath, args: ['-e', 'console.log(JSON.stringify(process.env))'], cwd: f.work, env: { LANG: 'C' } });
    assert.equal(result.exitCode, 0, result.stderr);
    const environment = JSON.parse(result.stdout);
    assert.equal(environment[key], undefined);
    assert.equal(environment.LANG, 'C');
    assert.notEqual(environment.HOME, process.env.HOME);
    const forbiddenEnvironments: Record<string, string>[] = [{ MISTRAL_API_KEY: 'secret' }, { NODE_OPTIONS: '--require=evil.js' }, { DYLD_INSERT_LIBRARIES: 'evil.dylib' }];
    for (const env of forbiddenEnvironments) {
      await assert.rejects(runIsolated({ program: process.execPath, args: ['-e', '0'], cwd: f.work, env }), /environment/i);
    }
  } finally { delete process.env[key]; f.cleanup(); }
});

test('wall time, cancellation and combined output are bounded', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    const timed = await runIsolated({ program: process.execPath, args: ['-e', 'while(true){}'], cwd: f.work, timeoutMs: 150 });
    assert.equal(timed.timedOut, true); assert.notEqual(timed.exitCode, 0); assert.ok(timed.durationMs < 3000);
    const noisy = await runIsolated({ program: process.execPath, args: ['-e', 'process.stdout.write("x".repeat(100000));setInterval(()=>{},1000)'], cwd: f.work, maxOutputBytes: 1024 });
    assert.equal(noisy.outputLimitExceeded, true);
    assert.ok(Buffer.byteLength(noisy.stdout) + Buffer.byteLength(noisy.stderr) <= 1024);
    const controller = new AbortController();
    const promise = runIsolated({ program: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], cwd: f.work, signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    assert.equal((await promise).aborted, true);
  } finally { f.cleanup(); }
});

test('program selection fails closed and same-Node child exception retains executable fencing', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    await assert.rejects(runIsolated({ program: '/bin/sh', args: ['-c', 'echo escaped'], cwd: f.work }), /trusted Node/i);
    const script = `const cp=require('node:child_process');const node=cp.spawnSync(process.execPath,['-e','console.log(42)'],{encoding:'utf8'});const shell=cp.spawnSync('/bin/sh',['-c','echo escaped']);console.log(JSON.stringify({node:node.stdout,nodeStatus:node.status,shell:shell.error?.code??shell.status}));`;
    const result = await runIsolated({ program: process.execPath, args: ['-e', script], cwd: f.work, allowNodeChildren: true });
    assert.equal(result.exitCode, 0, result.stderr);
    const body = JSON.parse(result.stdout); assert.equal(body.nodeStatus, 0); assert.equal(body.node.trim(), '42'); assert.match(String(body.shell), /^(EPERM|EACCES)$/);
  } finally { f.cleanup(); }
});

test('trusted supervisor can exchange bounded JSON lines with an isolated worker', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    let pid: number | undefined; const observed: string[] = [];
    const result = await runIsolated({ program: process.execPath, args: ['-e', `const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',line=>console.log(JSON.stringify({answer:JSON.parse(line).value*2})));`], cwd: f.work, keepStdinOpen: true,
      onSpawn: child => { pid = child.pid; child.stdin!.write('{"value":21}\n'); child.stdin!.end(); }, onStdout: chunk => observed.push(chunk.toString()), maxOutputBytes: 1024 });
    assert.ok(pid && pid > 0); assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(JSON.parse(observed.join('')), { answer: 42 });
    await assert.rejects(runIsolated({ program: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], cwd: f.work, onSpawn: () => { throw new Error('fixture observer failure'); } }), /observer failed/);
  } finally { f.cleanup(); }
});
