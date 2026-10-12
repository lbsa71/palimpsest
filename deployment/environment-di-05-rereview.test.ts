import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { getEventListeners } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonicalJson, identity, type ShellPort } from '../packages/contracts/index.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { DevelopmentalMemory } from '../packages/development/index.ts';
import { DurableRuntime, ResourceLedger } from '../packages/runtime/index.ts';
import { EffectJournal } from '../packages/effects/index.ts';
import { FairScheduler, InitiativeRegistry, InitiativeRunner, ObligationRegistry } from '../packages/initiative/index.ts';

const epoch = Date.parse('2043-04-05T06:07:08.000Z');
const scope = { kind: 'public' } as const;
const resources = { maxRequests: 10, maxTokens: 1000, maxCostUsd: 2, maxElapsedMs: 100000, maxConcurrency: 1 };
const policy = { windowMs: 1000, maxSlicesPerWindow: 8, maxLifetimeSlices: 12, quantumMs: 50, idleRetryMs: 100, maxStalls: 3, resources };
const compareIds = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
async function rejection(task: Promise<unknown>): Promise<unknown> {
  let rejected = false, value: unknown;
  try { await task; } catch (error) { rejected = true; value = error; }
  assert.equal(rejected, true, 'must reject even for an undefined thrown value'); return value;
}
function dual(value: unknown, operation: unknown, cleanup: unknown) {
  assert.ok(value instanceof AggregateError); assert.equal(value.errors.length, 2);
  assert.equal(value.errors[0], operation); assert.equal(value.errors[1], cleanup);
  assert.ok(Object.hasOwn(value, 'cause')); assert.equal(value.cause, operation);
}
function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'initiative-rereview-'));
  const store = new OperationalStore({ filename: join(directory, 'state.sqlite') });
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  let count = 0, time = epoch, shellCalls = 0, cancels = 0;
  const state = {
    held: false, inline: false,
    goalId: () => `goal-event:${++count}`,
    setup: () => {}, cleanup: () => {},
    shell: (async () => ({ status: 'completed', observations: [] })) as ShellPort['run'],
  };
  const goals = new InitiativeRegistry(store, () => state.goalId());
  const obligations = new ObligationRegistry(store);
  const memory = new DevelopmentalMemory(store, () => new Date(time).toISOString(), { monotonicNow: () => 0, withdrawalId: () => `withdrawal:${++count}`, compareIds });
  const scheduler = new FairScheduler(store, goals, obligations, 'rereview', policy, epoch, undefined, { newId: () => `selection:${++count}`, compareIds });
  const ledger = new ResourceLedger(store, { tokens: 1, costUsd: 0, elapsedMs: 1 }, () => time);
  const effects = new EffectJournal(store, { assert() {} }, { async dispatch() { throw Error('unexpected effect'); }, async reconcile() { throw Error('unexpected effect'); } }, () => `effect:${++count}`);
  const runtime = new DurableRuntime({ store, resources: ledger, effects, now: () => time, elapsedNow: () => 0, newId: () => `runtime:${++count}`, canResume: () => !state.held, shell: { async run(...args) { shellCalls++; return state.shell(...args); } } });
  const callbacks: (() => void)[] = [];
  const runner = new InitiativeRunner({ scheduler, runtime, memory, authority: { generation: 'rereview', epoch: 1, controlRevision: 'c1' }, prompt: () => ({ id: 'rereview', fragments: [], requestDigest: identity('rereview') }), decide: () => { throw Error('unexpected judgment'); },
    scheduleTimeout: (_delay, fire) => { state.setup(); callbacks.push(fire); if (state.inline) fire(); return () => { cancels++; state.cleanup(); }; } });
  const addGoal = () => {
    const goal = goals.propose({ id: 'inquiry', origin: { kind: 'self' }, purpose: 'Observe a bounded fixture', scope, successCriteria: ['observation'], evidenceIds: [], dependencyIds: [], resources, priority: 1, nextAction: 'observe', reviewAt: new Date(time).toISOString() }, { sourceIds: ['public-fixture'], actorId: 'rereview', recordedAt: new Date(time).toISOString(), derivation: 'interpreted' });
    goals.accept(goal.id, goal.revision, 'bounded fixture inquiry');
  };
  return { store, state, goals, runtime, scheduler, ledger, runner, callbacks, addGoal, setTime: (value: number) => { time = value; }, shellCalls: () => shellCalls, cancels: () => cancels,
    snapshot: () => canonicalJson(store.captureDevelopmentSnapshot({ maxRows: 512, maxBytes: 1000000 })) };
}

for (const failCleanup of [false, true]) test(`rereview: deferred start rolls back admission and ${failCleanup ? 'retains only cleanup failure' : 'returns normal idle'}`, async t => {
  const f = fixture(t); f.addGoal(); f.state.held = true;
  const cleanup = Object.freeze(new AggregateError([Symbol('adapter detail')], 'adapter cleanup'));
  const descriptors = Object.getOwnPropertyDescriptors(cleanup);
  if (failCleanup) f.state.cleanup = () => { throw cleanup; };
  const before = f.snapshot(), parent = new AbortController();
  if (failCleanup) assert.equal(await rejection(f.runner.tick(parent.signal)), cleanup);
  else assert.deepEqual(await f.runner.tick(parent.signal), { kind: 'idle', reason: 'host execution hold retained; no scheduler slice consumed', nextWakeup: null });
  assert.equal(f.snapshot(), before); assert.equal(f.shellCalls(), 0); assert.equal(f.cancels(), 1);
  assert.equal(getEventListeners(parent.signal, 'abort').length, 0); assert.deepEqual(Object.getOwnPropertyDescriptors(cleanup), descriptors);
  f.state.held = false; f.state.cleanup = () => {};
  assert.equal((await f.runner.tick()).kind, 'selected'); assert.equal(f.shellCalls(), 1); assert.equal(f.scheduler.snapshot().lifetimeSlices, 1);
});

test('rereview: runtime-handled shell failure stays durable normal control when cleanup alone fails', async t => {
  const f = fixture(t); f.addGoal();
  const body = Object.freeze(Error('fixture shell stopped')), cleanup = Object.freeze(Error('timer cannot cancel'));
  const beforeBody = Object.getOwnPropertyDescriptors(body), beforeCleanup = Object.getOwnPropertyDescriptors(cleanup);
  f.state.shell = async () => { throw body; }; f.state.cleanup = () => { throw cleanup; };
  const parent = new AbortController(); assert.equal(await rejection(f.runner.tick(parent.signal)), cleanup);
  assert.equal(f.goals.goal('inquiry')!.status, 'waiting');
  const execution = f.store.list<{ failure: string }>('execution'); assert.equal(execution.length, 1); assert.equal(execution[0]!.value.failure, body.message);
  assert.equal(f.store.list('requests').length, 0); assert.equal(f.scheduler.snapshot().lifetimeSlices, 1);
  assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
  assert.deepEqual(Object.getOwnPropertyDescriptors(body), beforeBody); assert.deepEqual(Object.getOwnPropertyDescriptors(cleanup), beforeCleanup);
  f.state.cleanup = () => {}; assert.equal((await f.runner.tick()).kind, 'idle'); assert.equal(f.shellCalls(), 1);
});

for (const failInsideCatch of [false, true]) test(`rereview: post-execution ${failInsideCatch ? 'catch failure' : 'non-Error failure'} is the exact outgoing operation in the aggregate`, async t => {
  const f = fixture(t); f.addGoal(); let revisionAttempts = 0;
  const first = Symbol('post-execution goal event'), cleanup = Object.freeze(Error('cancel failure'));
  const cleanupBefore = Object.getOwnPropertyDescriptors(cleanup);
  f.state.shell = async () => {
    f.state.goalId = () => { revisionAttempts++; if (revisionAttempts === 1) throw first; if (failInsideCatch && revisionAttempts === 2) throw undefined; return `after-shell:${revisionAttempts}`; };
    return { status: 'completed', observations: [] };
  };
  f.state.cleanup = () => { throw cleanup; };
  const parent = new AbortController(), result = await rejection(f.runner.tick(parent.signal));
  dual(result, failInsideCatch ? undefined : first, cleanup);
  assert.equal(revisionAttempts, 2); assert.equal(f.goals.goal('inquiry')!.status, failInsideCatch ? 'running' : 'blocked');
  assert.equal(f.store.list<{ status: string }>('runs')[0]!.value.status, 'completed'); assert.equal(f.scheduler.snapshot().lifetimeSlices, 1);
  assert.equal(f.store.list('requests').length, 0); assert.equal(f.cancels(), 1); assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
  assert.deepEqual(Object.getOwnPropertyDescriptors(cleanup), cleanupBefore);
  f.state.cleanup = () => {}; f.runner.cancel('inquiry', 'end bounded fault fixture');
  assert.equal((await f.runner.tick()).kind, 'idle'); assert.equal(f.cancels(), 2);
});

test('rereview: synchronous setup callback and failing cancellation compose before any selection', async t => {
  const f = fixture(t); f.addGoal(); f.state.inline = true;
  const cleanup = Symbol('setup cancellation failure'); f.state.cleanup = () => { throw cleanup; };
  const parent = new AbortController(), before = f.snapshot(), result = await rejection(f.runner.tick(parent.signal));
  assert.ok(result instanceof AggregateError); assert.ok(result.errors[0] instanceof Error); assert.match(result.errors[0].message, /enqueue callback/);
  dual(result, result.errors[0], cleanup); assert.equal(f.snapshot(), before); assert.equal(f.shellCalls(), 0);
  assert.equal(getEventListeners(parent.signal, 'abort').length, 0); assert.equal(f.cancels(), 1);
  f.callbacks[0]!(); assert.equal(f.snapshot(), before);
  f.state.inline = false; f.state.cleanup = () => {}; assert.equal((await f.runner.tick()).kind, 'selected');
});

test('rereview: setup failure and preabort preserve sole non-Error identity without selection or cancellation', async t => {
  const f = fixture(t); f.addGoal(); const failure = Object.freeze({ stage: 'setup' }), parent = new AbortController();
  f.state.setup = () => { throw failure; }; const before = f.snapshot();
  assert.equal(await rejection(f.runner.tick(parent.signal)), failure); assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
  f.state.setup = () => {}; parent.abort(false); assert.equal(await rejection(f.runner.tick(parent.signal)), false);
  assert.equal(f.snapshot(), before); assert.equal(f.cancels(), 0); assert.equal(f.callbacks.length, 0);
  assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
  assert.equal((await f.runner.tick()).kind, 'selected'); assert.equal(f.shellCalls(), 1);
});

test('rereview: manual quantum abort retains sole cleanup value, ignores late callback and releases latch', async t => {
  const f = fixture(t); f.addGoal(); let entered!: () => void, release!: () => void, signal!: AbortSignal;
  const started = new Promise<void>(resolve => { entered = resolve; }), pending = new Promise<void>(resolve => { release = resolve; });
  const cleanup = Object.freeze({ stage: 'quantum cleanup' });
  f.state.shell = async (_input, _bridge, received) => { signal = received!; entered(); await pending; signal.throwIfAborted(); return { status: 'completed', observations: [] }; };
  f.state.cleanup = () => { throw cleanup; };
  const parent = new AbortController(), result = rejection(f.runner.tick(parent.signal)); await started;
  await assert.rejects(f.runner.tick(), /already active/); f.callbacks[0]!(); assert.equal(signal.aborted, true); release();
  assert.equal(await result, cleanup); assert.equal(f.goals.goal('inquiry')!.status, 'waiting'); assert.equal(f.cancels(), 1);
  assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
  const after = f.snapshot(), reason = signal.reason; f.callbacks[0]!(); parent.abort(Error('late parent')); assert.equal(f.snapshot(), after); assert.equal(signal.reason, reason);
  f.state.cleanup = () => {}; assert.equal((await f.runner.tick()).kind, 'idle'); assert.equal(f.shellCalls(), 1);
});

test('rereview: child allocation changes only touched ancestor floors and never resets a prior floor or grant', t => {
  const f = fixture(t), ledger = f.ledger;
  ledger.allocate('root', resources); ledger.allocate('behavior', resources, 'root'); ledger.allocate('reviewer', resources, 'root');
  f.setTime(epoch + 7000); ledger.allocate('earlier-child', resources, 'behavior');
  const before = new Map(f.store.list('allocations').map(row => [row.key, row.value]));
  // Reconstruct a ledger to prove the durable prior floor survives a fresh instance and wall rollback.
  f.setTime(epoch + 3000); const fresh = new ResourceLedger(f.store, ledger.defaultCeiling, () => epoch + 3000);
  fresh.allocate('new-child', resources, 'behavior');
  for (const [id, value] of before) assert.deepEqual(f.store.get('allocations', id)!.value, value);
  for (const id of ['root', 'behavior']) assert.equal(f.store.get<{ elapsedFloorMs: number }>('allocations', id)!.value.elapsedFloorMs, 7000);
  assert.equal(f.store.get<{ elapsedFloorMs: number }>('allocations', 'reviewer')!.value.elapsedFloorMs, 0);
  f.setTime(epoch + 9000); ledger.allocate('later-child', resources, 'behavior');
  for (const [id, value] of before) assert.deepEqual(f.store.get('allocations', id)!.value, ['root', 'behavior'].includes(id) ? { ...(value as object), elapsedFloorMs: 9000 } : value);
  assert.equal(f.store.list('requests').length, 0); assert.equal(fresh.snapshot('root').requests, 0);
});
