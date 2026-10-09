import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { IsolationError, runIsolated, runIsolatedSession, type IsolationSessionOptions } from '../src/isolation.ts';

const darwin = { skip: process.platform !== 'darwin' };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'palimpsest-session-')), work = join(root, 'work'), outside = join(root, 'outside');
  mkdirSync(work); mkdirSync(outside); const secret = join(outside, 'synthetic-private'); writeFileSync(secret, 'untouched fixture');
  return { root, work, outside, secret, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
function gone(child: ChildProcess | undefined) { assert.ok(child?.pid); assert.throws(() => process.kill(child.pid!, 0), { code: 'ESRCH' }); }

test('supervised process survives accelerated300s and600s parent-clock boundaries with the same PID and live transport', darwin, async t => {
  const f = fixture(), controller = new AbortController(); let child: ChildProcess | undefined, buffer = '';
  let deliver: ((line: string) => void) | undefined; const realClearTimeout = clearTimeout;
  const watchdog = setTimeout(() => controller.abort(), 5000);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const line = () => new Promise<string>(resolve => { deliver = resolve; }); const ready = line();
  const pending = runIsolatedSession({ program: process.execPath, cwd: f.work, signal: controller.signal,
    args: ['-e', 'const rl=require("node:readline").createInterface({input:process.stdin});rl.on("line",line=>console.log("ack:"+line));console.log("ready");'],
    onSpawn: value => { child = value; }, onStdout: chunk => {
      buffer += chunk.toString(); const end = buffer.indexOf('\n'); if (end >= 0) { const value = buffer.slice(0, end); buffer = buffer.slice(end + 1); deliver?.(value); deliver = undefined; }
    } });
  const whileAlive = async (reply: Promise<string>) => Promise.race([reply, pending.then(() => { throw new Error('Session ended before transport reply'); })]);
  try {
    assert.equal(await whileAlive(ready), 'ready'); const pid = child!.pid;
    for (const elapsed of [300001, 300001]) {
      t.mock.timers.tick(elapsed); assert.equal(child!.pid, pid); assert.doesNotThrow(() => process.kill(pid!, 0));
      const reply = line(); child!.stdin!.write('still alive\n'); assert.equal(await whileAlive(reply), 'ack:still alive');
    }
    controller.abort(); const result = await pending; assert.equal(result.aborted, true); assert.equal(result.timedOut, false); gone(child);
  } finally { controller.abort(); await pending.catch(() => {}); t.mock.timers.reset(); realClearTimeout(watchdog); f.cleanup(); }
});

test('session streams more than1MiB exact binary stdout without retained transcript or lifetime output ceiling', darwin, async () => {
  const f = fixture(), controller = new AbortController(); let child: ChildProcess | undefined, bytes = 0;
  const digest = createHash('sha256'), expected = Buffer.alloc(2_097_153); for (let i = 0; i < expected.length; i++) expected[i] = i % 256;
  try {
    const result = await runIsolatedSession({ program: process.execPath, cwd: f.work, signal: controller.signal, maxOutputBytes: 1024,
      args: ['-e', 'const b=Buffer.alloc(2097153);for(let i=0;i<b.length;i++)b[i]=i%256;process.stdout.write(b);process.stderr.write("bounded diagnostic");'],
      onSpawn: value => { child = value; }, onStdout: chunk => { bytes += chunk.length; digest.update(chunk); } });
    assert.equal(result.exitCode, 0); assert.equal(bytes, expected.length); assert.equal(digest.digest('hex'), createHash('sha256').update(expected).digest('hex'));
    assert.equal(result.stdout, ''); assert.equal(result.stderr, 'bounded diagnostic'); assert.equal(result.outputLimitExceeded, false); assert.equal(result.timedOut, false); gone(child);
  } finally { controller.abort(); f.cleanup(); }
});

test('session denies private source HOME TMPDIR writes, private reads, network and even same-Node forks', darwin, async () => {
  const f = fixture(), controller = new AbortController(); const source = join(f.work, 'source'); writeFileSync(source, 'untouched source');
  const output: Buffer[] = [];
  try {
    const script = `const fs=require('node:fs'),cp=require('node:child_process'),net=require('node:net'),path=require('node:path');const result={};
      for(const[name,fn]of Object.entries({privateRead:()=>fs.readFileSync(${JSON.stringify(f.secret)}),privateWrite:()=>fs.writeFileSync(${JSON.stringify(f.secret)},'bad'),source:()=>fs.writeFileSync(${JSON.stringify(source)},'bad'),home:()=>fs.writeFileSync(path.join(process.env.HOME,'bad'),'bad'),tmp:()=>fs.writeFileSync(path.join(process.env.TMPDIR,'bad'),'bad')})){try{fn();result[name]='ALLOWED';}catch(e){result[name]=e.code;}}
      const child=cp.spawnSync(process.execPath,['-e','0']);result.fork=child.error?.code??child.status;
      const socket=net.connect({host:'127.0.0.1',port:9});socket.on('error',e=>{result.network=e.code;console.log(JSON.stringify(result));});socket.on('connect',()=>{result.network='ALLOWED';socket.destroy();console.log(JSON.stringify(result));});`;
    const result = await runIsolatedSession({ program: process.execPath, args: ['-e', script], cwd: f.work, signal: controller.signal,
      onSpawn: () => {}, onStdout: chunk => { output.push(Buffer.from(chunk)); } });
    assert.equal(result.exitCode, 0, result.stderr); const denied = JSON.parse(Buffer.concat(output).toString());
    for (const key of ['privateRead', 'privateWrite', 'source', 'home', 'tmp', 'fork', 'network']) assert.match(String(denied[key]), /^(EPERM|EACCES)$/, key);
    assert.equal(readFileSync(source, 'utf8'), 'untouched source'); assert.equal(readFileSync(f.secret, 'utf8'), 'untouched fixture');
  } finally { controller.abort(); f.cleanup(); }
});

test('stderr ceiling and owner abort settle only after actual session process close', darwin, async () => {
  const f = fixture();
  try {
    for (const stop of ['overflow', 'abort']) {
      const controller = new AbortController(); let child: ChildProcess | undefined, closed = false;
      const result = await runIsolatedSession({ program: process.execPath, cwd: f.work, signal: controller.signal, maxOutputBytes: 1024,
        args: ['-e', stop === 'overflow' ? 'process.stderr.write("x".repeat(100000));setInterval(()=>{},1000)' : 'process.stdout.write("ready");setInterval(()=>{},1000)'],
        onSpawn: value => { child = value; value.once('close', () => { closed = true; }); },
        onStdout: () => { if (stop === 'abort') controller.abort(); } });
      assert.equal(closed, true); gone(child); assert.equal(result.timedOut, false);
      assert.equal(result.outputLimitExceeded, stop === 'overflow'); assert.equal(result.aborted, stop === 'abort'); assert.ok(Buffer.byteLength(result.stderr) <= 1024);
    }
  } finally { f.cleanup(); }
});

for (const observer of ['onSpawn', 'onStdout', 'onStderr'] as const) {
  test(`session ${observer} throws or returns an async rejection: kill and drain before rejecting`, darwin, async () => {
    const f = fixture();
    try {
      for (const asynchronous of [false, true]) {
        const controller = new AbortController(); let child: ChildProcess | undefined, closed = false, observed = 0;
        const fault = () => { observed++; if (asynchronous) return new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Synthetic delayed async observer fault')), 20)); throw new Error('Synthetic sync observer fault'); };
        const options: IsolationSessionOptions = { program: process.execPath, cwd: f.work, signal: controller.signal,
          args: ['-e', 'process.stdout.write("ready");process.stderr.write("diagnostic");setInterval(()=>{},1000)'],
          onSpawn: value => { child = value; value.once('close', () => { closed = true; }); if (observer === 'onSpawn') return fault(); },
          onStdout: () => { if (observer === 'onStdout') return fault(); },
          ...(observer === 'onStderr' ? { onStderr: fault } : {}) };
        await assert.rejects(runIsolatedSession(options), IsolationError);
        assert.equal(closed, true); assert.equal(observed, 1); gone(child);
        if (asynchronous) await new Promise(resolve => setTimeout(resolve, 30));
      }
    } finally { f.cleanup(); }
  });
}

test('session rejects missing authority, observers and all finite-job escape fields before spawning', darwin, async () => {
  const f = fixture();
  try {
    const variants: Record<string, unknown>[] = [{ signal: undefined }, { signal: {} }, { onSpawn: undefined }, { onStdout: null }, { onStderr: 1 },
      { timeoutMs: 0 }, { timeoutMs: null }, { timeoutMs: Infinity }, { timeoutMs: undefined }, { stdin: '' }, { keepStdinOpen: true },
      { writePaths: [] }, { allowNodeChildren: false }, { trustedExecutables: [] }, { program: '/bin/sh' }, { maxOutputBytes: 0 }];
    for (const patch of variants) {
      let spawned = false; const options = { program: process.execPath, args: ['-e', '0'], cwd: f.work, signal: new AbortController().signal,
        onSpawn: () => { spawned = true; }, onStdout: () => {}, ...patch };
      await assert.rejects(runIsolatedSession(options as IsolationSessionOptions), IsolationError); assert.equal(spawned, false, JSON.stringify(patch));
    }
    let spawned = false;
    const inherited = Object.assign(Object.create({ allowNodeChildren: true }), { program: process.execPath, args: ['-e', '0'], cwd: f.work,
      signal: new AbortController().signal, onSpawn: () => { spawned = true; }, onStdout: () => {} });
    await assert.rejects(runIsolatedSession(inherited), IsolationError); assert.equal(spawned, false);
  } finally { f.cleanup(); }
});

test('finite jobs retain actual deadline and cumulative combined output bounds', darwin, async () => {
  const f = fixture();
  try {
    let child: ChildProcess | undefined;
    const timed = await runIsolated({ program: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], cwd: f.work, timeoutMs: 100, onSpawn: value => { child = value; } });
    assert.equal(timed.timedOut, true); gone(child);
    const noisy = await runIsolated({ program: process.execPath, args: ['-e', 'process.stdout.write("x".repeat(2000));process.stderr.write("y".repeat(2000));setInterval(()=>{},1000)'], cwd: f.work, maxOutputBytes: 1024 });
    assert.equal(noisy.outputLimitExceeded, true); assert.ok(Buffer.byteLength(noisy.stdout) + Buffer.byteLength(noisy.stderr) <= 1024);
    for (const timeoutMs of [0, NaN, Infinity, 300001]) await assert.rejects(runIsolated({ program: process.execPath, args: ['-e', '0'], cwd: f.work, timeoutMs }), IsolationError);
  } finally { f.cleanup(); }
});
