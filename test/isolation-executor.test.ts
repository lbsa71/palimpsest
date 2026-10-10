import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { runIsolated, runIsolatedSession, type IsolationOptions, type IsolationResult } from '../src/isolation.ts';
import { withIsolationOwnership } from '../src/isolation-ownership.ts';
import { withFiniteIsolationExecutor, type FiniteIsolationExecutor } from '../src/isolation-executor.ts';

const darwin = { skip: process.platform !== 'darwin' };
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const launcherUrl = new URL('../src/isolation.ts', import.meta.url).href;
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'palimpsest-executor-')), work = join(root, 'work'); mkdirSync(work);
  return { root, work, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
/** The trusted test broker is a separate actual process, so its default
 * Seatbelt launcher cannot recursively inherit the helper's executor scope. */
function broker(onSpawn?: (child: ChildProcess) => void) {
  const calls: IsolationOptions[] = [], children: ChildProcess[] = [];
  const execute: FiniteIsolationExecutor = async options => {
    calls.push(options);
    const child = spawn(process.execPath, ['--input-type=module', '-e', `import fs from 'node:fs';import {runIsolated} from ${JSON.stringify(launcherUrl)};
      const options=JSON.parse(fs.readFileSync(0,'utf8'));const result=await runIsolated(options);process.stdout.write(JSON.stringify(result));`],
      { cwd: repository, env: { LANG: 'C', NODE_NO_WARNINGS: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    children.push(child); onSpawn?.(child);
    const finished = new Promise<IsolationResult>((resolve, reject) => {
      const stdout: Buffer[] = [], stderr: Buffer[] = []; let fault: Error | undefined;
      const guard = setTimeout(() => { fault = new Error('Synthetic broker observation deadline'); child.kill('SIGKILL'); }, 5000);
      child.stdout.on('data', chunk => stdout.push(chunk)); child.stderr.on('data', chunk => stderr.push(chunk));
      child.once('error', error => { fault = error; });
      child.once('close', code => {
        clearTimeout(guard);
        if (fault || code !== 0) { reject(fault ?? new Error(`Broker failed: ${Buffer.concat(stderr).toString()}`)); return; }
        try { resolve(JSON.parse(Buffer.concat(stdout).toString())); } catch (error) { reject(error); }
      });
    });
    child.stdin.end(JSON.stringify(options));
    return finished;
  };
  return { execute, calls, children };
}
function gone(children: ChildProcess[]) { for (const child of children) { assert.ok(child.pid); assert.throws(() => process.kill(child.pid!, 0), { code: 'ESRCH' }); } }

test('finite executor substitutes the actual launch before helper-side ownership and retains real Seatbelt behavior', darwin, async () => {
  const f = fixture(), b = broker(); let helperOwnershipCalls = 0;
  const noHelperChildren = () => { helperOwnershipCalls++; throw new Error('Helper must not launch another Seatbelt process'); };
  try {
    const result = await withIsolationOwnership({ signal: new AbortController().signal, beforeSpawn: noHelperChildren, spawned: noHelperChildren, drained: noHelperChildren },
      async () => withFiniteIsolationExecutor(b.execute, async () => runIsolated({ program: process.execPath, args: ['-e', 'console.log("actual brokered check")'], cwd: f.work })));
    assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout.trim(), 'actual brokered check');
    assert.equal(b.calls.length, 1); assert.equal(b.children.length, 1); assert.equal(helperOwnershipCalls, 0); gone(b.children);
  } finally { f.cleanup(); }
});

test('executor options are copied and frozen before yielding to a delayed actual broker', darwin, async () => {
  const f = fixture(), b = broker(); const signal = new AbortController().signal;
  const args = ['-e', 'process.stdout.write(require("node:fs").readFileSync(0,"utf8"))'], readPaths = [f.work], env = { LANG: 'C' };
  const options: IsolationOptions = { program: process.execPath, args, cwd: f.work, readPaths, env, stdin: 'original\0stdin', timeoutMs: 1000, maxOutputBytes: 1024, signal };
  let observed: IsolationOptions | undefined;
  const delayed: FiniteIsolationExecutor = async copied => {
    observed = copied;
    assert.equal(Object.isFrozen(copied), true); assert.equal(Object.isFrozen(copied.args), true); assert.equal(Object.isFrozen(copied.readPaths), true); assert.equal(Object.isFrozen(copied.env), true);
    assert.equal(copied.signal, signal); assert.throws(() => { copied.args[1] = 'mutated'; });
    await pause(20);
    const { signal: _signal, ...serializable } = copied;
    return b.execute(serializable);
  };
  try {
    await withFiniteIsolationExecutor(delayed, async () => {
      const pending = runIsolated(options); args[1] = 'throw new Error("mutated")'; readPaths[0] = f.root; env.LANG = 'mutated'; options.stdin = 'mutated stdin';
      const result = await pending; assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, 'original\0stdin');
    });
    assert.deepEqual(observed!.readPaths, [f.work]); assert.deepEqual(observed!.env, { LANG: 'C' }); gone(b.children);
  } finally { f.cleanup(); }
});

test('ignored real transport rejection is consumed and still fails operation completion', darwin, async () => {
  const f = fixture(); const unhandled: unknown[] = []; const observe = (cause: unknown) => { unhandled.push(cause); };
  process.on('unhandledRejection', observe); let closed = false;
  try {
    await assert.rejects(withFiniteIsolationExecutor(async () => {
      const child = spawn(join(f.root, 'missing-broker'), [], { stdio: 'ignore' });
      return new Promise((_, reject) => {
        let fault: Error | undefined; child.once('error', error => { fault = error; }); child.once('close', () => { closed = true; reject(fault); });
      });
    }, async () => {
      void runIsolated({ program: process.execPath, args: ['-e', '0'], cwd: f.work });
      await pause(20); return { passed: true };
    }), /executor.*failed/i);
    await pause(20); assert.equal(closed, true); assert.deepEqual(unhandled, []);
  } finally { process.removeListener('unhandledRejection', observe); f.cleanup(); }
});

test('an operation error retains its identity while unfinished actual broker work drains', darwin, async () => {
  const f = fixture(), b = broker(); const original = new Error('original operation failure'); let pending: ReturnType<typeof runIsolated> | undefined;
  try {
    await assert.rejects(withFiniteIsolationExecutor(b.execute, async () => {
      pending = runIsolated({ program: process.execPath, args: ['-e', 'setTimeout(()=>console.log("drained"),20)'], cwd: f.work });
      throw original;
    }), error => error === original);
    assert.equal((await pending!).stdout.trim(), 'drained'); gone(b.children);
  } finally { await pending?.catch(() => {}); f.cleanup(); }
});

test('executor failure never falls back and a swallowed real transport error cannot make scope success', darwin, async () => {
  const f = fixture(); let calls = 0, closed = false;
  const failed: FiniteIsolationExecutor = async () => {
    calls++;
    const child = spawn(join(f.root, 'missing-broker'), [], { stdio: 'ignore' });
    return new Promise((_, reject) => {
      let fault: Error | undefined; child.once('error', error => { fault = error; });
      child.once('close', () => { closed = true; reject(fault ?? new Error('Broker transport failed')); });
    });
  };
  try {
    await assert.rejects(withFiniteIsolationExecutor(failed, async () => {
      await assert.rejects(runIsolated({ program: process.execPath, args: ['-e', 'console.log("unsafe fallback")'], cwd: f.work }), /ENOENT/);
      await assert.rejects(runIsolated({ program: process.execPath, args: ['-e', '0'], cwd: f.work }), /closed|failed/);
      return { passed: true };
    }), /executor.*failed/i);
    assert.equal(calls, 1); assert.equal(closed, true);
    const cause = new Error('original synchronous executor failure');
    await assert.rejects(withFiniteIsolationExecutor(() => { throw cause; }, async () => runIsolated({ program: process.execPath, args: ['-e', '0'], cwd: f.work })), error => error === cause);
  } finally { f.cleanup(); }
});

test('same-turn validation failure blocks subsequent and already queued actual broker dispatch', darwin, async () => {
  const f = fixture();
  try {
    for (const validFirst of [false, true]) {
      const b = broker(); const requests: Promise<IsolationResult>[] = [];
      await assert.rejects(withFiniteIsolationExecutor(b.execute, async () => {
        const valid = () => runIsolated({ program: process.execPath, args: ['-e', 'console.log("unsafe dispatch")'], cwd: f.work });
        const invalid = () => runIsolated({ program: process.execPath, args: ['-e', '0'], cwd: 'relative' });
        requests.push(...(validFirst ? [valid(), invalid()] : [invalid(), valid()]));
        const results = await Promise.allSettled(requests);
        for (const result of results) assert.equal(result.status, 'rejected');
        return { passed: true };
      }), /executor.*failed/i);
      assert.equal(b.calls.length, 0); assert.equal(b.children.length, 0);
    }
  } finally { f.cleanup(); }
});

test('known synchronous executor failure blocks another request already queued in the same scope', darwin, async () => {
  const f = fixture(), b = broker(); let invocations = 0;
  try {
    await assert.rejects(withFiniteIsolationExecutor(options => {
      if (++invocations === 1) throw new Error('synchronous broker fault');
      return b.execute(options);
    }, async () => {
      const requests = [runIsolated({ program: process.execPath, args: ['-e', '0'], cwd: f.work }), runIsolated({ program: process.execPath, args: ['-e', '0'], cwd: f.work })];
      const results = await Promise.allSettled(requests);
      for (const result of results) assert.equal(result.status, 'rejected');
      return { passed: true };
    }), /executor.*failed/i);
    assert.equal(invocations, 1); assert.equal(b.calls.length, 0); assert.equal(b.children.length, 0);
  } finally { f.cleanup(); }
});

test('unawaited actual broker execution settles before rejecting an early successful operation return', darwin, async () => {
  const f = fixture(); let ready!: () => void; const started = new Promise<void>(resolve => { ready = resolve; }), b = broker(() => ready());
  let pending: ReturnType<typeof runIsolated> | undefined;
  try {
    await assert.rejects(withFiniteIsolationExecutor(b.execute, async () => {
      pending = runIsolated({ program: process.execPath, args: ['-e', 'setTimeout(()=>console.log("completed"),50)'], cwd: f.work });
      await Promise.race([started, pending.then(() => { throw new Error('Actual execution bypassed the broker'); })]); return { passed: true };
    }), /unfinished/i);
    assert.equal((await pending!).stdout.trim(), 'completed'); gone(b.children);
  } finally { await pending?.catch(() => {}); f.cleanup(); }
});

test('late inherited calls and nested scopes cannot replace or reuse an executor', darwin, async () => {
  const f = fixture(), b = broker(); let late: Promise<unknown> | undefined;
  try {
    await withFiniteIsolationExecutor(b.execute, async () => {
      await assert.rejects(withFiniteIsolationExecutor(b.execute, async () => {}), /nested/);
      late = pause(20).then(() => runIsolated({ program: process.execPath, args: ['-e', '0'], cwd: f.work }));
    });
    await assert.rejects(late!, /closed/); assert.equal(b.calls.length, 0); assert.equal(b.children.length, 0);
  } finally { f.cleanup(); }
});

test('concurrent actual broker scopes keep their selected executors across asynchronous boundaries', darwin, async () => {
  const f = fixture(), a = broker(), b = broker();
  try {
    const [ra, rb] = await Promise.all([
      withFiniteIsolationExecutor(a.execute, async () => { await pause(10); return runIsolated({ program: process.execPath, args: ['-e', 'console.log("a")'], cwd: f.work }); }),
      withFiniteIsolationExecutor(b.execute, async () => { await pause(5); return runIsolated({ program: process.execPath, args: ['-e', 'console.log("b")'], cwd: f.work }); }),
    ]);
    assert.equal(ra.stdout.trim(), 'a'); assert.equal(rb.stdout.trim(), 'b'); assert.equal(a.calls.length, 1); assert.equal(b.calls.length, 1); gone([...a.children, ...b.children]);
  } finally { f.cleanup(); }
});

test('executor scope rejects persistent session capture while an unrelated actual session survives', darwin, async () => {
  const f = fixture(), b = broker(), controller = new AbortController(); let child: ChildProcess | undefined, ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  const live = runIsolatedSession({ program: process.execPath, args: ['-e', 'console.log("ready");setInterval(()=>{},1000)'], cwd: f.work, signal: controller.signal, onSpawn: value => { child = value; }, onStdout: ready });
  try {
    await started;
    await withFiniteIsolationExecutor(b.execute, async () => {
      await assert.rejects(runIsolatedSession({ program: process.execPath, args: ['-e', '0'], cwd: f.work, signal: new AbortController().signal, onSpawn: () => {}, onStdout: () => {} }), /session|executor/i);
    });
    assert.equal(b.calls.length, 0); assert.doesNotThrow(() => process.kill(child!.pid!, 0));
  } finally { controller.abort(); await live; f.cleanup(); }
});

test('finite broker rejects lifecycle callbacks, open input and invalid shapes before dispatch', darwin, async () => {
  const f = fixture(), b = broker();
  try {
    for (const patch of [{ onSpawn: () => {} }, { onStdout: () => {} }, { onStderr: () => {} }, { keepStdinOpen: true }, { keepStdinOpen: undefined },
      { program: null }, { args: ['x', 1] }, { cwd: 'relative' }, { readPaths: [1] }, { env: { LANG: null } }, { timeoutMs: 300001 }, { maxOutputBytes: 0 }, { signal: {} }]) {
      await assert.rejects(withFiniteIsolationExecutor(b.execute, async () => runIsolated({ program: process.execPath, args: ['-e', '0'], cwd: f.work, ...patch } as unknown as IsolationOptions)), /executor|option|finite/i);
    }
    let invoked = false;
    await assert.rejects(withFiniteIsolationExecutor(undefined as unknown as FiniteIsolationExecutor, async () => { invoked = true; }));
    assert.equal(invoked, false); assert.equal(b.calls.length, 0); assert.equal(b.children.length, 0);
  } finally { f.cleanup(); }
});

test('copied executable descriptors and path grants never become shared mutable executor options', darwin, async () => {
  const f = fixture(), b = broker(), trustedExecutables = [{ path: process.execPath, sha256: 'a'.repeat(64) }];
  let observed: IsolationOptions | undefined;
  try {
    await withFiniteIsolationExecutor(async options => {
      observed = options; assert.equal(Object.isFrozen(options.trustedExecutables), true); assert.equal(Object.isFrozen(options.trustedExecutables![0]), true);
      await pause(10);
      const { trustedExecutables: _trusted, ...ordinary } = options;
      return b.execute(ordinary);
    }, async () => {
      const pending = runIsolated({ program: process.execPath, args: ['-e', '0'], cwd: f.work, trustedExecutables, denyReadPaths: [], writePaths: [] });
      trustedExecutables[0].sha256 = 'b'.repeat(64); trustedExecutables.push({ path: '/bad', sha256: 'c'.repeat(64) });
      assert.equal((await pending).exitCode, 0);
    });
    assert.deepEqual(observed!.trustedExecutables, [{ path: process.execPath, sha256: 'a'.repeat(64) }]); assert.equal(existsSync(f.work), true); gone(b.children);
  } finally { f.cleanup(); }
});
