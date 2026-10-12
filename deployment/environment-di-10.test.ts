import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import type { Stats, BigIntStatsFs } from 'node:fs';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import { ProcessLease } from '../packages/supervisor/process-lease.ts';
import { confinementArguments, runConfined, type ConfinedCommand } from '../packages/supervisor/confinement.ts';
import { spawnBounded, initializeResourceDelegation, assertResourceConfinement, type ResourceLimits } from '../packages/supervisor/resource-limits.ts';
import { runWorker } from '../packages/supervisor/worker-process.ts';
import type { ExecutionEnvironment, SqlDatabase, ProcessChild } from '../packages/supervisor/environment.ts';
// JS administrator module is deliberately import-inert; no production adapter is invoked.
// @ts-ignore JS entrypoint has no declaration; tests pass explicit synthetic adapters.
import { provisionWorkspace } from '../packages/supervisor/provision-workspace.mjs';

class Pipe extends EventEmitter {
  destroyed = false;
  values: string[] = [];
  action?: (value: string) => void;
  write(value: string | Uint8Array) { const text = String(value); this.values.push(text); this.action?.(text); return true; }
  end(value: string | Uint8Array) { return this.write(value); }
}
class SyntheticChild extends EventEmitter {
  pid = 700;
  stdin = new Pipe(); stdout = new EventEmitter(); stderr = new EventEmitter(); gate = new Pipe();
  isClosed = false;
  close(code: number | null = 0, signal: NodeJS.Signals | null = null) {
    if (!this.isClosed) { this.isClosed = true; this.emit('close', code, signal); }
  }
}
const command: ConfinedCommand = { workspace: '/work-host', protectedPaths: ['/state-host'], executable: '/usr/bin/true', args: [], timeoutMs: 100, maxOutputBytes: 64 };
const limits: ResourceLimits = { cgroupRoot: '/sys/fs/cgroup/aeon', memoryBytes: 8 * 1024 * 1024, pids: 8,
  cpuQuotaMicros: 1000, cpuPeriodMicros: 10000, maxFileBytes: 1024, maxOpenFiles: 16, workspaceBytes: 16 * 1024 * 1024, workspaceInodes: 128 };
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function kernel() {
  const child = new SyntheticChild();
  const state = { time: 10, id: 0, populated: false, autoDrain: true, stopped: 0, launches: 0, closeOnKill: true,
    failWrite: undefined as string | undefined, failRemove: false, failTimer: false, cancelFailure: undefined as Error | undefined,
    spawnFailure: undefined as Error | undefined, killedFailure: undefined as Error | undefined, peak: '123', spawnArgs: [] as string[],
    dirs: new Set<string>(), writes: [] as [string, string][], removed: [] as string[], files: new Map<string, string>(),
    timers: [] as { callback: () => void; cancelled: number; delay: number }[] };
  const stats = (path: string) => ({ dev: 1, uid: 1000, nlink: 1, isDirectory: () => !path.endsWith('/binary'), isFile: () => path.endsWith('/binary'), isSymbolicLink: () => false }) as unknown as Stats;
  const environment: ExecutionEnvironment = {
    platform: () => 'linux', uid: () => 1000, pid: () => 500, id: () => 'fake-' + ++state.id, monotonicNow: () => state.time,
    realpath: path => path, stat: stats as ExecutionEnvironment['stat'], lstat: stats as ExecutionEnvironment['lstat'],
    statfs: () => ({ type: 0xef53n, blocks: 4096n, bsize: 4096n, files: 128n }) as BigIntStatsFs,
    mkdir: ((path: string) => { if (state.dirs.has(path)) throw Error('EEXIST'); state.dirs.add(path); }) as ExecutionEnvironment['mkdir'],
    readdir: path => path === limits.cgroupRoot ? [...state.dirs].filter(dir => dir.startsWith(path + '/')).map(dir => dir.slice(path.length + 1)) : [],
    rmdir: path => { if (state.failRemove) throw Error('remove failed'); state.removed.push(path); state.dirs.delete(path); },
    writeText: (path, value) => {
      state.writes.push([path, value]); if (path.endsWith(state.failWrite ?? '\0')) throw Error('write failed');
      state.files.set(path, value); if (path.endsWith('/cgroup.kill') && state.autoDrain) state.populated = false;
    },
    readText: path => {
      if (path === '/proc/self/cgroup') return '0::/aeon';
      if (path.endsWith('/cgroup.controllers') || path.endsWith('/cgroup.subtree_control')) return 'cpu memory pids';
      if (path.endsWith('/cgroup.events')) return 'populated ' + Number(state.populated);
      if (path.endsWith('/memory.events')) return 'oom_kill 0';
      if (path.endsWith('/pids.events')) return 'max 0';
      if (path.endsWith('/cpu.stat')) return 'usage_usec 20\nthrottled_usec 3';
      if (path.endsWith('/memory.peak')) return state.peak;
      return state.files.get(path) ?? '';
    },
    schedule: (delay, callback) => {
      if (state.failTimer) throw Error('timer setup failed');
      const timer = { callback, cancelled: 0, delay }; state.timers.push(timer);
      return { cancel() { timer.cancelled++; if (state.cancelFailure) throw state.cancelFailure; } };
    },
    spawn: (_file, args) => { state.launches++; state.spawnArgs = args; if (state.spawnFailure) throw state.spawnFailure; return child as ProcessChild; },
    kill: () => { state.stopped++; if (state.closeOnKill) child.close(null, 'SIGKILL'); if (state.killedFailure) throw state.killedFailure; },
  };
  return { child, state, environment, fire() { const timer = state.timers.find(timer => !timer.cancelled); assert.ok(timer); timer.callback(); } };
}
function worker(fixture: ReturnType<typeof kernel>, handle = async () => null, signal?: AbortSignal) {
  return runWorker({ command: { ...command, signal }, initial: null, maxMessageBytes: 64, maxRequests: 3, handle }, fixture.environment);
}
function sqlite() {
  const actual = new DatabaseSync(':memory:');
  const state = { fail: undefined as string | undefined, rollbackFailure: undefined as unknown, closeFailure: undefined as unknown, closed: 0, now: 0 };
  const db: SqlDatabase = {
    exec(sql) { if (sql === state.fail) throw Error('SQL failed: ' + sql); if (sql === 'ROLLBACK' && state.rollbackFailure) throw state.rollbackFailure; actual.exec(sql); },
    prepare: sql => actual.prepare(sql), close() { state.closed++; if (state.closeFailure) throw state.closeFailure; actual.close(); },
  };
  return { state, db, actual, environment: { mkdir: (() => undefined) as ExecutionEnvironment['mkdir'], openDatabase: () => db, wallNow: () => state.now } };
}

test('synthetic confinement preserves protected paths, hardlink and platform refusals before spawn', () => {
  const f = kernel();
  assert.throws(() => confinementArguments({ ...command, workspace: '/state-host' }, f.environment), /overlaps/);
  f.environment.platform = () => 'darwin'; assert.throws(() => confinementArguments(command, f.environment), /Linux/);
  f.environment.platform = () => 'linux'; f.environment.readdir = () => ['hardlink'];
  f.environment.lstat = (() => ({ isDirectory: () => false, isSymbolicLink: () => false, isFile: () => true, nlink: 2 })) as unknown as ExecutionEnvironment['lstat'];
  assert.throws(() => confinementArguments(command, f.environment), /hardlink/); assert.equal(f.state.launches, 0);
});
test('synthetic command closes normally and captures adapter callbacks before later mutation', async () => {
  const f = kernel(); const running = runConfined(command, f.environment); await tick();
  f.environment.kill = () => { throw Error('late replacement'); }; f.environment.monotonicNow = () => NaN;
  f.child.stdout.emit('data', Buffer.from('ok')); f.state.time = 21; f.child.close();
  const receipt = await running; assert.equal(receipt.stdout, 'ok'); assert.equal(receipt.elapsedMs, 11); assert.equal(f.state.timers[0]!.cancelled, 1);
});
for (const reason of ['timeout', 'cancelled', 'output-limit'] as const) test('synthetic command bounded stop: ' + reason, async () => {
  const f = kernel(), controller = new AbortController(); const running = runConfined({ ...command, signal: controller.signal }, f.environment); await tick();
  if (reason === 'timeout') f.fire(); else if (reason === 'cancelled') controller.abort(); else f.child.stdout.emit('data', Buffer.alloc(200));
  const receipt = await running; assert.equal(receipt.stoppedFor, reason); assert.ok(receipt.stdout.length <= 64); assert.equal(f.state.stopped, 1);
});
test('preaborted command never spawns or schedules', async () => {
  const f = kernel(), controller = new AbortController(); controller.abort();
  await assert.rejects(runConfined({ ...command, signal: controller.signal }, f.environment)); assert.equal(f.state.launches, 0); assert.equal(f.state.timers.length, 0);
});
test('abort arriving during spawn is observed after listener registration', async () => {
  const f = kernel(), controller = new AbortController(), spawn = f.environment.spawn;
  f.environment.spawn = (...args) => { controller.abort(); return spawn(...args); };
  assert.equal((await runConfined({ ...command, signal: controller.signal }, f.environment)).stoppedFor, 'cancelled');
});
test('timer setup failure still kills and drains acquired command', async () => {
  const f = kernel(); f.state.failTimer = true;
  await assert.rejects(runConfined(command, f.environment), /timer setup failed/); assert.equal(f.child.isClosed, true); assert.equal(f.state.stopped, 1);
});
test('launch error waits for actual close before cleanup returns', async () => {
  const f = kernel(); f.state.closeOnKill = false;
  const running = runConfined(command, f.environment); let settled = false; void running.catch(() => { settled = true; }); await tick();
  f.child.emit('error', Error('launch')); await tick(); assert.equal(settled, false); f.child.close(125);
  await assert.rejects(running, /launch unavailable/); assert.equal(f.state.timers[0]!.cancelled, 1);
});
test('operation and timer cancellation failures retain both exact errors', async () => {
  const f = kernel(), cancel = Error('cancel failed'); f.state.cancelFailure = cancel;
  const running = runConfined(command, f.environment); await tick(); f.child.emit('error', Error('launch')); f.child.close(125);
  await assert.rejects(running, (error: unknown) => { assert.ok(error instanceof AggregateError); assert.match(String(error.errors[0]), /launch unavailable/); assert.equal(error.errors[1], cancel); return true; });
});
test('invalid monotonic reading after close cannot fabricate a receipt', async () => {
  const f = kernel(); const running = runConfined(command, f.environment); await tick(); f.state.time = 9; f.child.close();
  await assert.rejects(running, /regressing/); assert.equal(f.state.timers[0]!.cancelled, 1);
});
for (const output of ['not-json\n', '[]\n', '{"kind":"done"}\n', '{"kind":"request","id":"x","method":1,"args":[]}\n']) test('synthetic worker refuses malformed output: ' + output.trim(), async () => {
  const f = kernel(); let calls = 0; const running = worker(f, async () => { calls++; return null; }); await tick();
  f.child.stdout.emit('data', Buffer.from(output)); await assert.rejects(running, /invalid|Invalid|unresolved/); assert.equal(calls, 0);
});
test('worker returns valid result and cancels its timer once', async () => {
  const f = kernel(); const running = worker(f); await tick(); f.child.stdout.emit('data', Buffer.from('{"kind":"done","value":5}\n'));
  assert.equal(await running, 5); assert.equal(f.state.timers[0]!.cancelled, 1);
});
test('worker duplicate request dispatches once and drains the original pending handler', async () => {
  const f = kernel(); let resolve!: (value: null) => void, calls = 0, aborted = false;
  const running = runWorker({ command: { ...command, maxOutputBytes: 256 }, initial: null, maxMessageBytes: 64, maxRequests: 3,
    async handle() { calls++; return await new Promise<null>(done => { resolve = done; }); } }, f.environment);
  let settled = false; void running.catch(() => { settled = true; }); await tick();
  const line = '{"kind":"request","id":"x","method":"m","args":[]}\n';
  f.child.stdout.emit('data', Buffer.from(line + line)); await tick(); aborted = f.child.isClosed;
  assert.equal(aborted, true); assert.equal(settled, false); assert.equal(calls, 1); resolve(null); await assert.rejects(running, /duplicate/);
});
test('worker cancellation aborts in-flight handler and waits for authentic settlement', async () => {
  const f = kernel(), controller = new AbortController(); let resolve!: (value: null) => void, observed = false;
  const running = runWorker({ command: { ...command, signal: controller.signal }, initial: null, maxMessageBytes: 64, maxRequests: 2,
    handle(_method, _args, signal) { signal.addEventListener('abort', () => { observed = true; }); return new Promise(done => { resolve = done; }); } }, f.environment);
  let settled = false; void running.catch(() => { settled = true; }); await tick();
  f.child.stdout.emit('data', Buffer.from('{"kind":"request","id":"x","method":"m","args":[]}\n')); controller.abort(); await tick();
  assert.equal(observed, true); assert.equal(settled, false); resolve(null); await assert.rejects(running, /cancelled/);
});
for (const mode of ['timeout', 'timer-setup', 'early-exit', 'output'] as const) test('worker terminal failure drains: ' + mode, async () => {
  const f = kernel(); if (mode === 'timer-setup') f.state.failTimer = true;
  const running = worker(f); await tick();
  if (mode === 'timeout') f.fire(); if (mode === 'early-exit') f.child.close(); if (mode === 'output') f.child.stderr.emit('data', Buffer.alloc(100));
  await assert.rejects(running, /deadline|timer setup|without a completed|output limit/); assert.equal(f.child.isClosed, true);
});
test('cgroup readback and ext4 capacity gates refuse before launch', () => {
  const f = kernel(); f.environment.statfs = () => ({ type: 1n, blocks: 1n, bsize: 1n, files: 1n }) as BigIntStatsFs;
  assert.throws(() => assertResourceConfinement(command.workspace, limits, f.environment), /ext4/); assert.equal(f.state.launches, 0);
});
test('invalid resource ID cannot leave its namespace or create a group', () => {
  const f = kernel(); f.environment.id = () => '../escape';
  assert.throws(() => assertResourceConfinement(command.workspace, limits, f.environment), /Invalid resource group ID/); assert.equal(f.state.dirs.size, 0);
});
test('cgroup placement precedes gate release and shared cleanup preserves observations', async () => {
  const f = kernel(); f.child.gate.action = () => assert.ok(f.state.writes.some(([path, value]) => path.endsWith('/cgroup.procs') && value === '700'));
  const process = await spawnBounded([], { ...command, resourceLimits: limits, input: 'pipe' }, f.environment);
  assert.ok(f.state.spawnArgs.includes('--pdeathsig')); assert.ok(f.state.spawnArgs.includes('/usr/bin/prlimit'));
  const first = process.cleanup(), second = process.cleanup(); assert.equal(first, second);
  const observation = await first; assert.equal(observation!.memoryPeakBytes, 123); assert.equal(observation!.cpuUsageMicros, 20); assert.equal(f.state.dirs.size, 0);
  assert.equal(await process.cleanup(), observation);
});
test('cgroup write and removal double failure retain setup and cleanup diagnostics', () => {
  const f = kernel(); f.state.failWrite = '/memory.max'; f.state.failRemove = true;
  assert.throws(() => assertResourceConfinement(command.workspace, limits, f.environment), (error: unknown) => {
    assert.ok(error instanceof AggregateError); assert.match(String(error.errors[0]), /write failed/); assert.match(String(error.errors[1]), /remove failed/); return true;
  }); assert.equal(f.state.launches, 0); assert.equal(f.state.dirs.size, 1);
});
test('spawn failure removes installed group and propagates original failure', async () => {
  const f = kernel(), failure = Error('spawn failed'); f.state.spawnFailure = failure;
  await assert.rejects(spawnBounded([], { ...command, resourceLimits: limits, input: 'pipe' }, f.environment), error => error === failure);
  assert.equal(f.state.dirs.size, 0);
});
test('placement failure cannot release the gate and drains before rejecting', async () => {
  const f = kernel(); f.state.failWrite = '/cgroup.procs';
  await assert.rejects(spawnBounded([], { ...command, resourceLimits: limits, input: 'pipe' }, f.environment), /Cannot place/);
  assert.equal(f.child.gate.values.length, 0); assert.equal(f.child.isClosed, true); assert.equal(f.state.dirs.size, 0);
});
test('failed cgroup drain retains group and explicit subsequent cleanup can recover', async () => {
  const f = kernel(); const process = await spawnBounded([], { ...command, resourceLimits: limits, input: 'pipe' }, f.environment);
  f.state.populated = true; f.state.autoDrain = false; const cleaning = process.cleanup(); await tick();
  f.state.time = 4000; f.fire(); await assert.rejects(cleaning, /failed to drain/); assert.equal(f.state.dirs.size, 1);
  f.state.populated = false; await process.cleanup(); assert.equal(f.state.dirs.size, 0); assert.equal(f.state.timers[0]!.cancelled, 1);
});
test('kill failure still attempts process-group kill and reports cleanup failure', async () => {
  const f = kernel(); const process = await spawnBounded([], { ...command, resourceLimits: limits, input: 'pipe' }, f.environment);
  f.state.failWrite = '/cgroup.kill'; await assert.rejects(process.cleanup(), /write failed/); assert.equal(f.state.stopped, 1); assert.equal(f.child.isClosed, true);
});
test('malformed kernel observation cannot become a successful resource receipt', async () => {
  const f = kernel(); const process = await spawnBounded([], { ...command, resourceLimits: limits, input: 'pipe' }, f.environment); f.state.peak = 'NaN';
  await assert.rejects(process.cleanup(), /Malformed resource/); assert.equal(f.state.dirs.size, 1);
});
test('recovery reaps only command groups through the same synthetic kernel and drain', async () => {
  const f = kernel(); f.state.dirs.add(limits.cgroupRoot + '/command-stale'); f.state.dirs.add(limits.cgroupRoot + '/retained');
  await initializeResourceDelegation(limits.cgroupRoot, f.environment);
  assert.ok(!f.state.dirs.has(limits.cgroupRoot + '/command-stale')); assert.ok(f.state.dirs.has(limits.cgroupRoot + '/retained'));
  assert.ok(f.state.writes.some(([path, value]) => path.endsWith('/host/cgroup.procs') && value === '500'));
});
test('authority wall clock and callbacks are captured and retain original authority after commit failure', () => {
  const f = sqlite(), store = new AuthorityStore('/synthetic/authority', f.environment);
  const grant = store.bootstrap('one', 'controls', 'artifact'); f.environment.wallNow = () => NaN;
  f.state.fail = 'COMMIT'; assert.throws(() => store.withdraw(grant), /COMMIT/); store.assert(grant);
  f.state.fail = undefined; const withdrawn = store.withdraw(grant); const next = store.activate(withdrawn, 'two', 'controls', 'artifact-two');
  assert.throws(() => store.dispatch(grant, () => { throw Error('must not dispatch'); }), /Stale/); store.assert(next);
  assert.equal(f.actual.prepare('SELECT at FROM authority_events').get()!.at, '1970-01-01T00:00:00.000Z'); store.close();
});
test('authority invalid wall time rolls back and preserves authority', () => {
  const f = sqlite(), store = new AuthorityStore('/synthetic/authority', f.environment); const grant = store.bootstrap('one', 'controls', 'artifact');
  f.state.now = NaN; assert.throws(() => store.withdraw(grant), /wall clock/); store.assert(grant); store.close();
});
test('authority rollback failure preserves original operation as aggregate cause', () => {
  const f = sqlite(), store = new AuthorityStore('/synthetic/authority', f.environment), failure = Error('operation'), rollback = Error('rollback');
  const grant = store.bootstrap('one', 'controls', 'artifact'); f.state.rollbackFailure = rollback;
  assert.throws(() => store.dispatch(grant, () => { throw failure; }), (error: unknown) => { assert.ok(error instanceof AggregateError); assert.equal(error.cause, failure); assert.deepEqual(error.errors, [failure, rollback]); return true; });
  f.state.rollbackFailure = undefined; f.actual.exec('ROLLBACK'); store.assert(grant); store.close();
});
test('authority initialization closes an acquired database on setup error', () => {
  const failure = Error('setup'), close = Error('close'); let closed = 0;
  assert.throws(() => new AuthorityStore('/synthetic/authority', { mkdir: (() => undefined) as ExecutionEnvironment['mkdir'], wallNow: () => 0,
    openDatabase: () => ({ exec() { throw failure; }, prepare() { throw Error('unused'); }, close() { closed++; throw close; } }) }),
  (error: unknown) => { assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [failure, close]); return true; }); assert.equal(closed, 1);
});
test('lease uses explicit PID and retains ownership after rollback or close failure', () => {
  const f = sqlite(), lease = new ProcessLease('/synthetic/lease', { ...f.environment, pid: () => 321 });
  assert.equal(f.actual.prepare('SELECT pid FROM owner').get()!.pid, 321);
  f.state.fail = 'ROLLBACK'; assert.throws(() => lease.close(), /ROLLBACK/); lease.assertHeld(); assert.equal(f.state.closed, 0);
  f.state.fail = undefined; lease.close(); assert.throws(() => lease.assertHeld(), /closed/); lease.close(); assert.equal(f.state.closed, 1);
});
test('lease failed close stays observable and cannot report released ownership', () => {
  let rolled = 0, closes = 0; const failure = Error('close failure');
  const lease = new ProcessLease('/synthetic/lease', { mkdir: (() => undefined) as ExecutionEnvironment['mkdir'], pid: () => 1,
    openDatabase: () => ({ exec(sql) { if (sql === 'ROLLBACK') rolled++; }, prepare: () => ({ get: () => undefined, all: () => [], run() {} }), close() { closes++; throw failure; } }) });
  assert.throws(() => lease.close(), error => error === failure); assert.throws(() => lease.assertHeld(), /closure incomplete/); assert.equal(rolled, 1); assert.equal(closes, 1);
});
test('lease open and setup failures never fabricate a held lease', () => {
  const f = sqlite(); f.actual.close(); assert.throws(() => new ProcessLease('/synthetic/lease', { ...f.environment, pid: () => 321 }), /operation and cleanup failed/);
  const failure = Error('open'); assert.throws(() => new ProcessLease('/synthetic/lease', { ...f.environment, pid: () => 1, openDatabase() { throw failure; } }), error => error === failure);
});
test('provisioning fake mounted cleanup failure preserves mounted image and original diagnostics', () => {
  const calls: string[] = [], failure = Error('ownership'), cleanup = Error('umount');
  const environment = { uid: () => 0, chmod() {}, chown() { throw failure; }, lstat() {}, mkdir() {}, realpath: (path: string) => path,
    rm(path: string) { calls.push('rm:' + path); }, stat() {}, output() {}, run(binary: string) { calls.push(binary); if (binary.endsWith('/umount')) throw cleanup; return ''; } };
  assert.throws(() => provisionWorkspace(['create', '/new-workspace', '1000', '1000', String(16 * 1024 * 1024), '128'], environment),
    (error: unknown) => { assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [failure, cleanup]); return true; });
  assert.ok(calls.includes('/usr/bin/mount')); assert.ok(!calls.includes('rm:/new-workspace'));
});
test('lease rollback followed by failed close cannot assert an exclusive lock and retry does not roll back twice', () => {
  let rollbacks = 0, closes = 0;
  const lease = new ProcessLease('/synthetic/lease', { mkdir: (() => undefined) as ExecutionEnvironment['mkdir'], pid: () => 1,
    openDatabase: () => ({ exec(sql) { if (sql === 'ROLLBACK') { rollbacks++; if (rollbacks > 1) throw Error('already rolled back'); } },
      prepare: () => ({ get: () => undefined, all: () => [], run() {} }), close() { if (++closes === 1) throw Error('close failed'); } }) });
  assert.throws(() => lease.close(), /close failed/); assert.throws(() => lease.assertHeld(), /released|incomplete/);
  lease.close(); assert.equal(rollbacks, 1); assert.equal(closes, 2); assert.throws(() => lease.assertHeld(), /closed/);
});
test('resource PID failure after group setup removes group before any dispatch', async () => {
  const f = kernel(); f.environment.pid = () => { throw Error('PID unavailable'); };
  await assert.rejects(spawnBounded([], { ...command, resourceLimits: limits, input: 'pipe' }, f.environment), /PID unavailable/);
  assert.equal(f.state.launches, 0); assert.equal(f.state.dirs.size, 0);
});
test('stdout subscription failure after acquisition still drains the child', async () => {
  const f = kernel(); f.child.stdout.on = () => { throw Error('subscribe failed'); };
  await assert.rejects(runConfined(command, f.environment), /subscribe failed/); assert.equal(f.child.isClosed, true); assert.equal(f.state.stopped, 1);
});
test('successful worker RPC uses captured handler and write callbacks', async () => {
  const f = kernel(); let calls = 0;
  const options = { command: { ...command, maxOutputBytes: 256 }, initial: null, maxMessageBytes: 256, maxRequests: 2,
    async handle() { calls++; return 'observed'; } };
  const running = runWorker(options, f.environment); await tick();
  options.handle = async () => { throw Error('replacement'); };
  const original = f.child.stdin.write;
  f.child.stdin.write = () => { throw Error('replacement pipe'); };
  f.child.stdin.action = text => { assert.equal(JSON.parse(text).kind, 'reply'); };
  f.child.stdout.emit('data', Buffer.from('{"kind":"request","id":"x","method":"m","args":[]}\n'));
  await tick(); f.child.stdout.emit('data', Buffer.from('{"kind":"done","value":"observed"}\n'));
  assert.equal(await running, 'observed'); assert.equal(calls, 1); assert.equal(f.child.stdin.values.length, 2); f.child.stdin.write = original;
});
test('worker synchronous host refusal stays redacted through an ordinary reply', async () => {
  const f = kernel();
  const running = runWorker({ command: { ...command, maxOutputBytes: 256 }, initial: null, maxMessageBytes: 256, maxRequests: 1,
    handle() { throw Error('private host diagnostic'); } }, f.environment); await tick();
  let reply: unknown; f.child.stdin.action = text => { reply = JSON.parse(text); };
  f.child.stdout.emit('data', Buffer.from('{"kind":"request","id":"x","method":"m","args":[]}\n'));
  await tick(); f.child.stdout.emit('data', Buffer.from(JSON.stringify({ kind: 'done', value: reply }) + '\n'));
  assert.deepEqual(await running, { kind: 'reply', id: 'x', ok: false, error: 'Host operation refused or unavailable' });
});
test('cgroup collisions fail before overwriting an existing command leaf', () => {
  const f = kernel(); f.environment.id = () => 'fixed'; f.state.dirs.add(limits.cgroupRoot + '/command-fixed');
  assert.throws(() => assertResourceConfinement(command.workspace, limits, f.environment), /EEXIST/);
  assert.equal(f.state.writes.length, 0); assert.equal(f.state.dirs.size, 1);
});
test('cgroup drain clock failure retains actual group rather than reporting cleanup', async () => {
  const f = kernel(), process = await spawnBounded([], { ...command, resourceLimits: limits, input: 'pipe' }, f.environment);
  f.state.time = NaN; await assert.rejects(process.cleanup(), /monotonic clock/); assert.equal(f.state.dirs.size, 1);
});
test('late gate pipe failure is retained by cleanup after child close', async () => {
  const f = kernel(), process = await spawnBounded([], { ...command, resourceLimits: limits, input: 'pipe' }, f.environment), failure = Error('gate pipe');
  f.child.gate.emit('error', failure); await assert.rejects(process.cleanup(), error => error === failure); assert.equal(f.child.isClosed, true);
});
test('provisioning refuses existing layout before administrator commands', () => {
  let runs = 0;
  const environment = { uid: () => 0, chmod() {}, chown() {}, lstat() {}, mkdir() { throw Error('already exists'); }, realpath: (path: string) => path,
    rm() { throw Error('must not delete'); }, stat() {}, output() {}, run() { runs++; return ''; } };
  assert.throws(() => provisionWorkspace(['create', '/new-workspace', '1000', '1000', String(16 * 1024 * 1024), '128'], environment), /already exists/); assert.equal(runs, 0);
});
test('timer cancellation throwing undefined remains an observable failure', async () => {
  const f = kernel(); f.environment.schedule = (_delay, _callback) => ({ cancel() { throw undefined; } });
  const running = runConfined(command, f.environment); await tick(); f.child.close();
  let caught = false; try { await running; } catch (error) { caught = true; assert.equal(error, undefined); } assert.equal(caught, true);
});
test('worker abort after done but before actual close remains cancellation', async () => {
  const f = kernel(), controller = new AbortController(); f.state.closeOnKill = false;
  const running = worker(f, async () => null, controller.signal); await tick();
  f.child.stdout.emit('data', Buffer.from('{"kind":"done","value":1}\n')); controller.abort(); f.child.close(); await assert.rejects(running, /cancelled/);
});
test('drain timer cancellation failure retains group and exact error', async () => {
  const f = kernel(), process = await spawnBounded([], { ...command, resourceLimits: limits, input: 'pipe' }, f.environment), failure = Error('drain cancel');
  f.state.populated = true; f.state.autoDrain = false; f.state.cancelFailure = failure;
  const cleaning = process.cleanup(); await tick(); f.state.populated = false; f.fire();
  await assert.rejects(cleaning, error => error === failure); assert.equal(f.state.dirs.size, 1);
});
test('worker handler accessor is captured exactly once before process acquisition', async () => {
  const f = kernel(); let reads = 0;
  const options = { command, initial: null, maxMessageBytes: 64, maxRequests: 1, async handle() { return null; } };
  Object.defineProperty(options, 'handle', { enumerable: true, get() { reads++; return async () => null; } });
  const running = runWorker(options, f.environment); await tick(); f.child.stdout.emit('data', Buffer.from('{"kind":"done","value":1}\n'));
  assert.equal(await running, 1); assert.equal(reads, 1);
});
