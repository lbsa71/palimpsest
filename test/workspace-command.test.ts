import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { runWorkspaceCommand, readWorkspaceCommandOutput } from '../src/workspace-command.ts';
import type { CandidateRuntime } from '../src/candidates.ts';

const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const compiler = process.platform === 'darwin'
  ? fs.realpathSync(resolve('node_modules', '@typescript', `typescript-${process.platform}-${process.arch}`, 'lib/tsc'))
  : fs.realpathSync(process.execPath);
const runtime: CandidateRuntime = { nodeVersion: process.version, nodeSha256: sha(fs.readFileSync(process.execPath)),
  compilerPath: compiler, compilerSha256: sha(fs.readFileSync(compiler)), toolchainDigest: 'a'.repeat(64) };
const platform = { skip: process.platform !== 'darwin' };
function fixture() {
  const base = fs.mkdtempSync(join(tmpdir(), 'palimpsest-command-')); const root = join(base, 'work'); const output = join(base, 'outputs');
  const privateDir = join(base, 'private'); for (const path of [root, output, privateDir]) fs.mkdirSync(path, { mode: 0o700 });
  const secret = join(privateDir, 'key'); fs.writeFileSync(secret, 'private fixture'); let index = 0;
  function options(args: string[], extra: Record<string, unknown> = {}) {
    const outputDirectory = join(output, `command-${index++}`); fs.mkdirSync(outputDirectory, { mode: 0o700 });
    return { commandId: `command-${index}`, root, outputDirectory, runtime, command: { tool: 'node' as const, args }, ...extra };
  }
  return { base, root, output, secret, options, dispose: () => fs.rmSync(base, { recursive: true, force: true }) };
}

test('actual Node mutation seals separate raw outputs outside the writable workspace', platform, async () => {
  const f = fixture(); try {
    const options = f.options(['-e', "require('node:fs').writeFileSync('draft.ts','corrected');process.stdout.write('out');process.stderr.write('err');"]);
    const receipt = await runWorkspaceCommand(options);
    assert.equal(fs.readFileSync(join(f.root, 'draft.ts'), 'utf8'), 'corrected');
    assert.equal(receipt.outputComplete, true); assert.equal(receipt.exitSuccessful, true);
    assert.equal(fs.readFileSync(join(options.outputDirectory, 'stdout.bin'), 'utf8'), 'out');
    assert.equal(fs.readFileSync(join(options.outputDirectory, 'stderr.bin'), 'utf8'), 'err');
    assert.equal(receipt.streams.stdout.sha256, sha('out')); assert.equal(receipt.streams.stderr.bytes, 3);
    assert.deepEqual(JSON.parse(fs.readFileSync(join(options.outputDirectory, 'receipt.json'), 'utf8')), receipt);
    assert.equal(Object.isFrozen(receipt), true); assert.equal(Object.isFrozen(receipt.command.args), true);
  } finally { f.dispose(); }
});

test('native compiler reports real failure then successful repair; Node runs in-process tests', platform, async () => {
  const f = fixture(); try {
    fs.writeFileSync(join(f.root, 'main.ts'), 'export const value: string = 1;');
    const args = ['--ignoreConfig', '--noEmit', '--strict', 'main.ts'];
    const firstOptions = f.options(args, { command: { tool: 'native-tsc', args }, readPaths: [dirname(dirname(compiler))] });
    const failed = await runWorkspaceCommand(firstOptions);
    assert.equal(failed.exitSuccessful, false); assert.notEqual(failed.exit.code, 0);
    assert.match(readWorkspaceCommandOutput({ outputDirectory: firstOptions.outputDirectory, receipt: failed, stream: 'stdout', offset: 0, length: 4096 }).text!, /TS2322/);
    fs.writeFileSync(join(f.root, 'main.ts'), "export const value: string = 'fixed';");
    const fixed = await runWorkspaceCommand(f.options(args, { command: { tool: 'native-tsc', args }, readPaths: [dirname(dirname(compiler))] }));
    assert.equal(fixed.exitSuccessful, true);
    fs.writeFileSync(join(f.root, 'small.test.ts'), "import {test} from 'node:test';import assert from 'node:assert/strict';test('actual',()=>assert.equal(2+2,4));");
    const tested = await runWorkspaceCommand(f.options(['--test', '--test-isolation=none', 'small.test.ts']));
    assert.equal(tested.exitSuccessful, true);
  } finally { f.dispose(); }
});

test('actual command cannot read/write private files or spool, network, fork or detached children', platform, async () => {
  const f = fixture(); try {
    const options = f.options([]); const script = `const fs=require('node:fs'),cp=require('node:child_process'),net=require('node:net');const r={};
      for(const[n,fn]of Object.entries({read:()=>fs.readFileSync(${JSON.stringify(f.secret)}),write:()=>fs.writeFileSync(${JSON.stringify(f.secret)},'bad'),spool:()=>fs.readFileSync(${JSON.stringify(join(options.outputDirectory,'stdout.bin'))})})){
        try{fn();r[n]='ALLOWED';}catch(e){r[n]=e.code;}}
      for(const detached of [false,true]){const child=cp.spawnSync(process.execPath,['-e','console.log(1)'],{detached});r[detached?'detached':'fork']=child.error?.code??child.status;}
      const socket=net.connect({host:'127.0.0.1',port:9});socket.once('error',e=>{r.network=e.code;console.log(JSON.stringify(r));});`;
    options.command.args = ['-e', script]; const receipt = await runWorkspaceCommand(options);
    const output = JSON.parse(readWorkspaceCommandOutput({ outputDirectory: options.outputDirectory, receipt, stream: 'stdout', offset: 0, length: 4096 }).text!);
    for (const key of ['read', 'write', 'spool', 'network', 'fork', 'detached']) assert.match(String(output[key]), /^(EPERM|EACCES)$/, key);
    assert.equal(fs.readFileSync(f.secret, 'utf8'), 'private fixture');
  } finally { f.dispose(); }
});

test('sealed paging preserves split Unicode and arbitrary binary bytes', platform, async () => {
  const f = fixture(); try {
    const bytes = Buffer.from([0xf0, 0x9f, 0x98, 0x80, 0xff, 0, 10]);
    const options = f.options(['-e', `process.stdout.write(Buffer.from(${JSON.stringify([...bytes])}));`]);
    const receipt = await runWorkspaceCommand(options);
    const first = readWorkspaceCommandOutput({ outputDirectory: options.outputDirectory, receipt, stream: 'stdout', offset: 0, length: 2 });
    assert.equal(first.text, undefined); assert.equal(first.nextOffset, 2);
    const last = readWorkspaceCommandOutput({ outputDirectory: options.outputDirectory, receipt, stream: 'stdout', offset: 2, length: 5 });
    assert.deepEqual(Buffer.concat([Buffer.from(first.base64, 'base64'), Buffer.from(last.base64, 'base64')]), bytes);
    const emoji = readWorkspaceCommandOutput({ outputDirectory: options.outputDirectory, receipt, stream: 'stdout', offset: 0, length: 4 });
    assert.equal(emoji.text, '😀'); assert.equal(last.nextOffset, null);
    for (const range of [{ offset: -1, length: 1 }, { offset: 8, length: 1 }, { offset: 0, length: 65537 }]) {
      assert.throws(() => readWorkspaceCommandOutput({ outputDirectory: options.outputDirectory, receipt, stream: 'stdout', ...range }));
    }
  } finally { f.dispose(); }
});

test('combined overflow kills actual process and seals explicitly incomplete capture', platform, async () => {
  const f = fixture(); try {
    let pid = 0; const receipt = await runWorkspaceCommand(f.options(['-e', "process.stdout.write('x'.repeat(10000));process.stderr.write('y'.repeat(10000));setInterval(()=>{},1000);"],
      { maxOutputBytes: 1024, onPid: (value: number) => { pid = value; } }));
    assert.equal(receipt.outputLimitExceeded, true); assert.equal(receipt.outputComplete, false); assert.equal(receipt.exitSuccessful, false);
    assert.equal(receipt.streams.stdout.bytes + receipt.streams.stderr.bytes, 1024);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  } finally { f.dispose(); }
});

test('deadline, cancellation and PID observer failure drain the direct process', platform, async () => {
  const f = fixture(); try {
    let pid = 0; const options = f.options(['-e', 'setInterval(()=>{},1000);'], { timeoutMs: 100, onPid: (value: number) => { pid = value; } });
    const timed = await runWorkspaceCommand(options); assert.equal(timed.timedOut, true); assert.equal(timed.exitSuccessful, false); assert.equal(timed.outputComplete, false);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    const controller = new AbortController();
    const pending = runWorkspaceCommand(f.options(['-e', 'setInterval(()=>{},1000);'], { signal: controller.signal, onPid: (value: number) => { pid = value; } }));
    setTimeout(() => controller.abort(), 50); const aborted = await pending;
    assert.equal(aborted.aborted, true); assert.equal(aborted.outputComplete, false); assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    await assert.rejects(runWorkspaceCommand(f.options(['-e', 'setInterval(()=>{},1000);'], { onPid: (value: number) => { pid = value; throw new Error('private operator path must not escape'); } })), /command|observer/i);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  } finally { f.dispose(); }
});

test('asynchronous PID callbacks are refused without escaping a rejection or leaving a process', platform, async () => {
  const f = fixture(); let pid = 0;
  try {
    await assert.rejects(runWorkspaceCommand(f.options(['-e', 'setInterval(()=>{},1000);'], {
      onPid: async (value: number) => { pid = value; throw new Error('private asynchronous PID detail'); },
    })), /command-pid-observer-failed/);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    await new Promise(resolve => setImmediate(resolve));
  } finally { f.dispose(); }
});

test('spool tampering and links fail sealed retrieval without returning bytes', platform, async () => {
  const f = fixture(); try {
    const options = f.options(['-e', "process.stdout.write('good');"]); const receipt = await runWorkspaceCommand(options);
    const path = join(options.outputDirectory, 'stdout.bin'); fs.chmodSync(path, 0o600); fs.writeFileSync(path, 'evil');
    assert.throws(() => readWorkspaceCommandOutput({ outputDirectory: options.outputDirectory, receipt, stream: 'stdout', offset: 0, length: 4 }));
    fs.unlinkSync(path); fs.symlinkSync(f.secret, path);
    assert.throws(() => readWorkspaceCommandOutput({ outputDirectory: options.outputDirectory, receipt, stream: 'stdout', offset: 0, length: 4 }));
  } finally { f.dispose(); }
});

test('spool storage observer failure drains the real writer and redacts the injected cause', platform, async context => {
  const f = fixture(); let pid = 0;
  try {
    const options = f.options(['-e', "const fs=require('node:fs');fs.writeFileSync('draft','started');process.stdout.write('first');setInterval(()=>fs.appendFileSync('draft','tick'),1);"],
      { onPid: (value: number) => { pid = value; } });
    const original = fs.writeSync;
    context.mock.method(fs, 'writeSync', (fd: number, ...args: any[]) => {
      const stat = fs.fstatSync(fd), path = join(options.outputDirectory, 'stdout.bin');
      if (fs.existsSync(path) && stat.ino === fs.lstatSync(path).ino) throw new Error('private injected disk path');
      return (original as (...args: any[]) => number)(fd, ...args);
    });
    await assert.rejects(runWorkspaceCommand(options), error => {
      assert.equal((error as Error).message, 'command-output-storage-failed');
      assert.equal((error as Error).cause, undefined); return true;
    });
    assert.ok(pid > 0); assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    const settled = fs.readFileSync(join(f.root, 'draft'));
    await new Promise(resolve => setTimeout(resolve, 20)); assert.deepEqual(fs.readFileSync(join(f.root, 'draft')), settled);
    assert.equal(fs.existsSync(join(options.outputDirectory, 'receipt.json')), false);
  } finally { context.mock.restoreAll(); f.dispose(); }
});

test('a renamed spool cannot be sealed as the fixed stream pathname', platform, async () => {
  const f = fixture(); try {
    const options = f.options(['-e', "process.stdout.write('real');"]);
    await assert.rejects(runWorkspaceCommand({ ...options, onPid: () => {
      fs.renameSync(join(options.outputDirectory, 'stdout.bin'), join(options.outputDirectory, 'moved.bin'));
      fs.writeFileSync(join(options.outputDirectory, 'stdout.bin'), 'other', { mode: 0o600 });
    } }));
    assert.equal(fs.existsSync(join(options.outputDirectory, 'receipt.json')), false);
  } finally { f.dispose(); }
});

test('seal flush failure cannot publish a valid receipt after the actual child exits', platform, async context => {
  const f = fixture(); let pid = 0;
  try {
    const options = f.options(['-e', "process.stdout.write('finished');"], { onPid: (value: number) => { pid = value; } });
    const original = fs.fsyncSync;
    context.mock.method(fs, 'fsyncSync', (fd: number) => {
      const stat = fs.fstatSync(fd); if (stat.isFile()) throw new Error('private flush detail'); return original(fd);
    });
    await assert.rejects(runWorkspaceCommand(options), error => {
      assert.equal((error as Error).message, 'command-execution-or-storage-failed'); return true;
    });
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    assert.equal(fs.existsSync(join(options.outputDirectory, 'receipt.json')), false);
  } finally { context.mock.restoreAll(); f.dispose(); }
});

test('accepted arguments/runtime stay immutable and relative cwd is constrained', platform, async () => {
  const f = fixture(); try {
    fs.mkdirSync(join(f.root, 'sub'));
    const script = "require('node:fs').writeFileSync('accepted','yes');";
    const options = f.options(['-e', script], { runtime: { ...runtime }, command: { tool: 'node' as const, args: ['-e', script], cwd: 'sub' } });
    const pending = runWorkspaceCommand(options); options.command.args[1] = 'throw new Error("changed")'; options.runtime.nodeSha256 = '0'.repeat(64);
    const receipt = await pending; assert.equal(receipt.command.args[1], script); assert.equal(receipt.runtime.nodeSha256, runtime.nodeSha256);
    assert.equal(fs.readFileSync(join(f.root, 'sub/accepted'), 'utf8'), 'yes');
    fs.symlinkSync(dirname(f.secret), join(f.root, 'alias'));
    for (const cwd of ['../private', '/tmp', 'sub/../sub', 'alias']) {
      let started = false; await assert.rejects(runWorkspaceCommand(f.options(['-e', '0'], { command: { tool: 'node', args: ['-e', '0'], cwd }, onPid: () => { started = true; } })));
      assert.equal(started, false);
    }
  } finally { f.dispose(); }
});

test('executable identities, finite limits and private output grants fail before a process starts', platform, async () => {
  const f = fixture(); try {
    for (const extra of [
      { runtime: { ...runtime, nodeSha256: '0'.repeat(64) } },
      { runtime: { ...runtime, compilerPath: process.execPath, compilerSha256: runtime.nodeSha256 } },
      { timeoutMs: 30001 }, { maxOutputBytes: 1048577 }, { command: { tool: 'shell', args: ['-c', '0'] } },
      { readPaths: [f.output] },
    ]) {
      let started = false;
      await assert.rejects(runWorkspaceCommand(f.options(['-e', '0'], { ...extra, onPid: () => { started = true; } })));
      assert.equal(started, false);
    }
    const options = f.options(['-e', '0']); fs.chmodSync(options.outputDirectory, 0o755);
    await assert.rejects(runWorkspaceCommand(options));
    const inside = join(f.root, 'outputs'); fs.mkdirSync(inside, { mode: 0o700 });
    await assert.rejects(runWorkspaceCommand(f.options(['-e', '0'], { outputDirectory: inside })));
  } finally { f.dispose(); }
});

test('hardlinked, public-mode and wrong-identity spools are rejected before paging', platform, async () => {
  const f = fixture(); try {
    const options = f.options(['-e', "process.stdout.write('good');"]), receipt = await runWorkspaceCommand(options);
    const path = join(options.outputDirectory, 'stdout.bin'), link = join(f.output, 'link'); fs.linkSync(path, link);
    const page = () => readWorkspaceCommandOutput({ outputDirectory: options.outputDirectory, receipt, stream: 'stdout', offset: 0, length: 4 });
    assert.throws(page); fs.unlinkSync(link); fs.chmodSync(path, 0o444); assert.throws(page); fs.chmodSync(path, 0o400);
    const forged = structuredClone(receipt); forged.streams.stdout.inode++;
    assert.throws(() => readWorkspaceCommandOutput({ outputDirectory: options.outputDirectory, receipt: forged, stream: 'stdout', offset: 0, length: 4 }));
    assert.equal(page().text, 'good');
  } finally { f.dispose(); }
});
