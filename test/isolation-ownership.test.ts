import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import childProcesses from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { test } from 'node:test';
import { IsolationError, runIsolated, runIsolatedSession } from '../src/isolation.ts';
import { withIsolationOwnership, type IsolationOwnership, type IsolationSpawnDescriptor } from '../src/isolation-ownership.ts';

const darwin = { skip: process.platform !== 'darwin' };
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function ownershipCause(pattern: RegExp) {
  return (error: unknown) => { assert.ok(error instanceof IsolationError); assert.ok(error.cause instanceof Error); assert.match(error.cause.message, pattern); return true; };
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'palimpsest-ownership-')), work = join(root, 'work'), outside = join(root, 'private');
  mkdirSync(work); mkdirSync(outside); const secret = join(outside, 'secret'); writeFileSync(secret, 'synthetic private value');
  return { root, work, secret, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
function record(controller = new AbortController()) {
  const events: string[] = [], descriptors: IsolationSpawnDescriptor[] = [], children: ChildProcess[] = [];
  const closed = new Set<number>(); let serial = 0;
  const owner: IsolationOwnership = { signal: controller.signal,
    beforeSpawn: descriptor => { descriptors.push(descriptor); events.push('intent'); return `spawn-${++serial}`; },
    spawned: (id, child) => { assert.ok(child.pid); children.push(child); events.push(`pid:${id}`); child.once('close', () => { closed.add(child.pid!); events.push(`close:${id}`); }); },
    drained: (id, result) => {
      const child = children[Number(id.split('-')[1]) - 1];
      assert.ok(closed.has(child.pid!), 'drain receipt follows actual close');
      assert.equal(existsSync(descriptors[Number(id.split('-')[1]) - 1].scratch), false, 'drain receipt follows scratch cleanup');
      assert.throws(() => process.kill(child.pid!, 0), { code: 'ESRCH' });
      assert.ok(result.exitCode !== undefined); events.push(`drain:${id}`);
    } };
  return { owner, controller, events, descriptors, children };
}

test('owned finite execution records immutable intent, PID, actual close and scratch cleanup in order', darwin, async () => {
  const f = fixture(), r = record();
  try {
    const args = ['-e', 'console.log("copied original")'];
    const original = r.owner.beforeSpawn;
    r.owner.beforeSpawn = descriptor => { assert.equal(Object.isFrozen(descriptor), true); assert.equal(Object.isFrozen(descriptor.args), true); args[1] = 'console.log("mutated")'; return original(descriptor); };
    const result = await withIsolationOwnership(r.owner, async () => runIsolated({ program: process.execPath, args, cwd: f.work }));
    assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout.trim(), 'copied original');
    assert.equal(r.descriptors[0].program, realpathSync(process.execPath)); assert.equal(r.descriptors[0].cwd, realpathSync(f.work));
    assert.equal(r.descriptors[0].purpose, 'finite-isolated-process'); assert.deepEqual(r.events, ['intent', 'pid:spawn-1', 'close:spawn-1', 'drain:spawn-1']);
  } finally { f.cleanup(); }
});

test('both owner and per-operation cancellation kill and drain actual finite children before settlement', darwin, async () => {
  const f = fixture();
  try {
    for (const source of ['owner', 'operation']) {
      const r = record(), operation = new AbortController();
      const result = await withIsolationOwnership(r.owner, async () => runIsolated({ program: process.execPath, args: ['-e', 'console.log("ready");setInterval(()=>{},1000)'], cwd: f.work, signal: operation.signal,
        timeoutMs: 1000, onStdout: () => (source === 'owner' ? r.controller : operation).abort() }));
      assert.equal(result.aborted, true); assert.equal(result.timedOut, false); assert.equal(r.events.at(-1), 'drain:spawn-1');
    }
  } finally { f.cleanup(); }
});

test('already cancelled owner and cancellation within intent create no child or PID/drain receipt', darwin, async () => {
  const f = fixture();
  try {
    const r = record(); r.controller.abort();
    await assert.rejects(withIsolationOwnership(r.owner, async () => runIsolated({ program: process.execPath, args: ['-e', '0'], cwd: f.work })), /cancel|abort/i);
    assert.deepEqual(r.events, []);
    const during = record(); during.owner.beforeSpawn = descriptor => { during.descriptors.push(descriptor); during.events.push('intent'); during.controller.abort(); return 'spawn-1'; };
    await assert.rejects(withIsolationOwnership(during.owner, async () => runIsolated({ program: process.execPath, args: ['-e', '0'], cwd: f.work })), ownershipCause(/cancel|abort/i));
    assert.deepEqual(during.events, ['intent']); assert.equal(existsSync(during.descriptors[0].scratch), false);
    const perCall = record(), already = new AbortController(); already.abort();
    await assert.rejects(withIsolationOwnership(perCall.owner, async () => runIsolated({ program: process.execPath, args: ['-e', '0'], cwd: f.work, signal: already.signal })), /cancel|abort/i);
    assert.deepEqual(perCall.events, []);
    const midCall = record(), cancelled = new AbortController();
    midCall.owner.beforeSpawn = descriptor => { midCall.descriptors.push(descriptor); midCall.events.push('intent'); cancelled.abort(); return 'spawn-1'; };
    await assert.rejects(withIsolationOwnership(midCall.owner, async () => runIsolated({ program: process.execPath, args: ['-e', '0'], cwd: f.work, signal: cancelled.signal })), /cancel|abort/i);
    assert.deepEqual(midCall.events, ['intent']); assert.equal(existsSync(midCall.descriptors[0].scratch), false);
  } finally { f.cleanup(); }
});

test('a synchronous intent failure starts no actual process and preserves no invented drain', darwin, async () => {
  const f = fixture(), r = record();
  try {
    r.owner.beforeSpawn = descriptor => { r.descriptors.push(descriptor); throw new Error('synthetic intent failure'); };
    await assert.rejects(withIsolationOwnership(r.owner, async () => runIsolated({ program: process.execPath, args: ['-e', '0'], cwd: f.work })), /intent|ownership/i);
    assert.deepEqual(r.events, []); assert.equal(r.children.length, 0); assert.equal(existsSync(r.descriptors[0].scratch), false);
  } finally { f.cleanup(); }
});

for (const hook of ['beforeSpawn', 'spawned', 'drained'] as const) {
  test(`ownership ${hook} rejects asynchronous completion and consumes delayed rejection`, darwin, async () => {
    const f = fixture();
    try {
      for (const rejection of [false, true]) {
        const r = record(); const original = r.owner[hook]; let calls = 0;
        (r.owner as unknown as Record<string, unknown>)[hook] = (...args: unknown[]) => {
          calls++;
          if (hook === 'spawned') (original as IsolationOwnership['spawned'])(args[0] as string, args[1] as ChildProcess);
          if (hook === 'drained') { assert.equal(existsSync(r.descriptors[0].scratch), false); assert.equal(r.children[0].exitCode !== null || r.children[0].signalCode !== null, true); }
          return new Promise((resolve, reject) => setTimeout(() => rejection ? reject(new Error('delayed hook fault')) : resolve(hook === 'beforeSpawn' ? 'spawn-1' : undefined), 20));
        };
        await assert.rejects(withIsolationOwnership(r.owner, async () => runIsolated({ program: process.execPath, args: ['-e', hook === 'drained' ? '0' : 'setInterval(()=>{},1000)'], cwd: f.work, timeoutMs: 1000 })), /synchronous|ownership/i);
        assert.equal(calls, 1);
        if (hook === 'beforeSpawn') assert.equal(r.children.length, 0);
        else { assert.equal(r.events.includes('close:spawn-1'), true); assert.throws(() => process.kill(r.children[0].pid!, 0), { code: 'ESRCH' }); }
        assert.equal(r.events.some(value => value.startsWith('drain:')), false);
        await pause(40);
      }
    } finally { f.cleanup(); }
  });
}

test('PID receipt failure kills actual child but leaves its durable intent undrained', darwin, async () => {
  const f = fixture(), r = record();
  try {
    const original = r.owner.spawned;
    r.owner.spawned = (id, child) => { original(id, child); throw new Error('synthetic PID journal failure'); };
    await assert.rejects(withIsolationOwnership(r.owner, async () => runIsolated({ program: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], cwd: f.work })), /ownership/i);
    assert.deepEqual(r.events, ['intent', 'pid:spawn-1', 'close:spawn-1']); assert.equal(existsSync(r.descriptors[0].scratch), false);
  } finally { f.cleanup(); }
});

test('a failed ownership receipt poisons the scope so a swallowing collector cannot launch another check', darwin, async () => {
  const f = fixture(), r = record();
  try {
    const original = r.owner.spawned;
    r.owner.spawned = (id, child) => { original(id, child); throw new Error('synthetic journal failure'); };
    await assert.rejects(withIsolationOwnership(r.owner, async () => {
      await assert.rejects(runIsolated({ program: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], cwd: f.work }), /ownership/i);
      await assert.rejects(runIsolated({ program: process.execPath, args: ['-e', '0'], cwd: f.work }), /closed|cancelled/);
      return 'admissible-looking result';
    }), /ownership.*failed/i);
    assert.equal(r.descriptors.length, 1); assert.equal(r.children.length, 1); assert.deepEqual(r.events, ['intent', 'pid:spawn-1', 'close:spawn-1']);
  } finally { f.cleanup(); }
});

for (const hook of ['beforeSpawn', 'drained'] as const) {
  test(`a swallowed ${hook} journal failure cannot become a successful ownership result`, darwin, async () => {
    const f = fixture(), r = record();
    try {
      (r.owner as unknown as Record<string, unknown>)[hook] = () => { throw new Error(`synthetic ${hook} journal failure`); };
      await assert.rejects(withIsolationOwnership(r.owner, async () => {
        await assert.rejects(runIsolated({ program: process.execPath, args: ['-e', '0'], cwd: f.work }), /ownership/i);
        return { passed: true };
      }), /ownership.*failed/i);
      assert.equal(r.events.some(value => value.startsWith('drain:')), false);
      if (hook === 'beforeSpawn') assert.equal(r.children.length, 0);
      else { assert.equal(r.events.includes('close:spawn-1'), true); assert.equal(existsSync(r.descriptors[0].scratch), false); }
    } finally { f.cleanup(); }
  });
}

test('actual ENOENT without a PID retains the undrained intent and rejects later launch and scope success', darwin, async () => {
  const f = fixture(), r = record(), originalSpawn = childProcesses.spawn; let launches = 0, first: ChildProcess | undefined, firstClosed = false;
  childProcesses.spawn = ((program: string, args: string[], options: Parameters<typeof childProcesses.spawn>[2]) => {
    launches++;
    const child = originalSpawn(launches === 1 ? join(f.root, 'nonexistent-executable') : program, args, options);
    if (launches === 1) { first = child; child.once('close', () => { firstClosed = true; }); }
    return child;
  }) as typeof childProcesses.spawn;
  syncBuiltinESMExports();
  try {
    await assert.rejects(withIsolationOwnership(r.owner, async () => {
      await assert.rejects(runIsolated({ program: process.execPath, args: ['-e', '0'], cwd: f.work }), /launch|isolated/i);
      assert.equal(first?.pid, undefined); assert.equal(firstClosed, true); assert.equal(existsSync(r.descriptors[0].scratch), false);
      await assert.rejects(runIsolated({ program: process.execPath, args: ['-e', '0'], cwd: f.work }), /closed|cancelled/);
      return { passed: true };
    }), /ownership.*failed/i);
    assert.equal(launches, 1); assert.deepEqual(r.events, ['intent']); assert.equal(r.children.length, 0);
  } finally { childProcesses.spawn = originalSpawn; syncBuiltinESMExports(); f.cleanup(); }
});

test('actual child error does not settle before close and successful scratch cleanup', darwin, async () => {
  const f = fixture(), r = record(); let killTimer: NodeJS.Timeout | undefined;
  try {
    await assert.rejects(withIsolationOwnership(r.owner, async () => runIsolated({ program: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], cwd: f.work,
      onSpawn: child => { killTimer = setTimeout(() => child.kill('SIGKILL'), 80); child.emit('error', new Error('synthetic process error')); } })), error => {
      assert.ok(error instanceof IsolationError); assert.equal(r.events.includes('close:spawn-1'), true); assert.equal(existsSync(r.descriptors[0].scratch), false); return true;
    });
    assert.equal(r.events.at(-1), 'drain:spawn-1');
  } finally {
    if (killTimer) clearTimeout(killTimer);
    for (const child of r.children) if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await new Promise(resolve => child.once('close', resolve)); }
    f.cleanup();
  }
});

test('failed actual scratch cleanup withholds drain receipt after process close', darwin, async () => {
  const f = fixture(), r = record(); let blocked: string | undefined;
  try {
    await assert.rejects(withIsolationOwnership(r.owner, async () => {
      await assert.rejects(runIsolated({ program: process.execPath, args: ['-e', '0'], cwd: f.work,
        onSpawn: () => { blocked = join(r.descriptors[0].scratch, 'blocked'); mkdirSync(blocked); writeFileSync(join(blocked, 'file'), 'fixture'); chmodSync(blocked, 0); } }), /EACCES|EPERM|ENOTEMPTY|cleanup/i);
      await assert.rejects(runIsolated({ program: process.execPath, args: ['-e', '0'], cwd: f.work }), /closed|cancelled/);
      return { passed: true };
    }), /ownership.*failed/i);
    assert.equal(r.events.includes('close:spawn-1'), true); assert.equal(r.events.some(value => value.startsWith('drain:')), false);
  } finally { if (blocked && existsSync(blocked)) chmodSync(blocked, 0o700); for (const descriptor of r.descriptors) rmSync(descriptor.scratch, { recursive: true, force: true }); f.cleanup(); }
});

test('concurrent ownership contexts copy callbacks and cancel only their own actual children', darwin, async () => {
  const f = fixture(), a = record(), b = record(); let aReady!: () => void, bReady!: () => void;
  const readyA = new Promise<void>(resolve => { aReady = resolve; }), readyB = new Promise<void>(resolve => { bReady = resolve; });
  try {
    const pa = withIsolationOwnership(a.owner, async () => { await pause(5); return runIsolated({ program: process.execPath, args: ['-e', 'console.log("ready");setInterval(()=>{},1000)'], cwd: f.work, timeoutMs: 1000, onStdout: aReady }); });
    const pb = withIsolationOwnership(b.owner, async () => { await pause(5); return runIsolated({ program: process.execPath, args: ['-e', 'console.log("ready");setTimeout(()=>console.log("survived"),150)'], cwd: f.work, timeoutMs: 1000, onStdout: bReady }); });
    a.owner.spawned = () => { throw new Error('mutated owner callbacks must not execute'); };
    await Promise.all([readyA, readyB]); a.controller.abort();
    const [ra, rb] = await Promise.all([pa, pb]); assert.equal(ra.aborted, true); assert.equal(rb.aborted, false); assert.equal(rb.exitCode, 0, rb.stderr); assert.match(rb.stdout, /survived/);
    for (const r of [a, b]) assert.deepEqual(r.events, ['intent', 'pid:spawn-1', 'close:spawn-1', 'drain:spawn-1']);
  } finally { a.controller.abort(); b.controller.abort(); f.cleanup(); }
});

test('owned finite context rejects a persistent session without capturing unrelated live sessions', darwin, async () => {
  const f = fixture(), owner = record(), outside = new AbortController(); let child: ChildProcess | undefined, ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  const live = runIsolatedSession({ program: process.execPath, args: ['-e', 'console.log("ready");setInterval(()=>{},1000)'], cwd: f.work, signal: outside.signal, onSpawn: value => { child = value; }, onStdout: ready });
  try {
    await started;
    await assert.rejects(withIsolationOwnership(owner.owner, async () => runIsolatedSession({ program: process.execPath, args: ['-e', '0'], cwd: f.work, signal: owner.controller.signal, onSpawn: () => {}, onStdout: () => {} })), /ownership|session/i);
    owner.controller.abort(); assert.doesNotThrow(() => process.kill(child!.pid!, 0)); assert.deepEqual(owner.events, []);
  } finally { outside.abort(); await live; f.cleanup(); }
});

test('ownership supplies no private read, write, fork, environment or network authority', darwin, async () => {
  const f = fixture(), r = record();
  try {
    const script = `const fs=require('node:fs'),cp=require('node:child_process'),net=require('node:net');const r={};
      for(const[name,fn]of Object.entries({read:()=>fs.readFileSync(${JSON.stringify(f.secret)}),write:()=>fs.writeFileSync(${JSON.stringify(f.secret)},'bad')})){try{fn();r[name]='ALLOWED';}catch(e){r[name]=e.code;}}
      r.fork=cp.spawnSync(process.execPath,['-e','0']).error?.code;
      const s=net.connect({host:'127.0.0.1',port:9});s.on('error',e=>{r.network=e.code;console.log(JSON.stringify(r));});`;
    const result = await withIsolationOwnership(r.owner, async () => runIsolated({ program: process.execPath, args: ['-e', script], cwd: f.work }));
    assert.equal(result.exitCode, 0, result.stderr); const actual = JSON.parse(result.stdout);
    for (const key of ['read', 'write', 'fork', 'network']) assert.match(actual[key], /^(EPERM|EACCES)$/); assert.equal(readFileSync(f.secret, 'utf8'), 'synthetic private value');
    await assert.rejects(withIsolationOwnership(r.owner, async () => runIsolated({ program: process.execPath, args: ['-e', '0'], cwd: f.work, env: { MISTRAL_API_KEY: 'synthetic' } })), /environment/i);
  } finally { f.cleanup(); }
});

test('invalid owner and invalid or reused spawn identities fail before launching replacement children', darwin, async () => {
  const f = fixture();
  try {
    for (const patch of [{ signal: undefined }, { signal: {} }, { beforeSpawn: undefined }, { spawned: 1 }, { drained: null }]) {
      let invoked = false;
      await assert.rejects(withIsolationOwnership({ ...record().owner, ...patch } as unknown as IsolationOwnership, async () => { invoked = true; })); assert.equal(invoked, false);
    }
    for (const id of ['', '../escape', 'x'.repeat(129), 1]) {
      const r = record(); r.owner.beforeSpawn = () => id as string;
      await assert.rejects(withIsolationOwnership(r.owner, async () => runIsolated({ program: process.execPath, args: ['-e', '0'], cwd: f.work })), ownershipCause(/identity|spawn/i)); assert.equal(r.children.length, 0);
    }
    const r = record(); r.owner.beforeSpawn = descriptor => { r.descriptors.push(descriptor); return 'spawn-1'; };
    await assert.rejects(withIsolationOwnership(r.owner, async () => { await runIsolated({ program: process.execPath, args: ['-e', '0'], cwd: f.work }); await assert.rejects(runIsolated({ program: process.execPath, args: ['-e', '0'], cwd: f.work }), ownershipCause(/identity|duplicate|spawn/i)); }), /ownership.*failed/i);
    assert.equal(r.children.length, 1);
  } finally { f.cleanup(); }
});

test('an early operation return cancels and drains existing children, and inherited late work cannot launch', darwin, async () => {
  const f = fixture(), r = record(); let ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; }); let pending: ReturnType<typeof runIsolated> | undefined;
  try {
    await assert.rejects(withIsolationOwnership(r.owner, async () => {
      pending = runIsolated({ program: process.execPath, args: ['-e', 'console.log("ready");setInterval(()=>{},1000)'], cwd: f.work, onStdout: ready });
      await started; return 'early';
    }), /unfinished isolated execution/);
    assert.equal((await pending!).aborted, true); assert.equal(r.events.at(-1), 'drain:spawn-1');
    const late = record(); let eventual: Promise<unknown> | undefined;
    await withIsolationOwnership(late.owner, async () => {
      eventual = pause(20).then(() => runIsolated({ program: process.execPath, args: ['-e', '0'], cwd: f.work }));
    });
    await assert.rejects(eventual!, /closed|cancelled/); assert.deepEqual(late.events, []);
  } finally { r.controller.abort(); await pending; f.cleanup(); }
});

test('a nested ownership context cannot replace the admitted operation owner', darwin, async () => {
  const r = record();
  await withIsolationOwnership(r.owner, async () => { await assert.rejects(withIsolationOwnership(record().owner, async () => {}), /nested/); });
});
