import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { getEventListeners } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson, identity, type Goal, type ShellPort } from '../packages/contracts/index.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { DevelopmentalMemory } from '../packages/development/index.ts';
import { DurableRuntime, ResourceLedger } from '../packages/runtime/index.ts';
import { EffectJournal } from '../packages/effects/index.ts';
import { DriveRegistry, FairScheduler, InitiativeRegistry, InitiativeRunner, ObligationRegistry, PlanRegistry, initiativeTools } from '../packages/initiative/index.ts';
import type { ScheduleTimeout } from '../packages/initiative/environment.ts';

const epoch = Date.parse('2042-03-04T05:06:07.000Z');
const scope = { kind: 'public' } as const;
const resources = { maxRequests: 8, maxTokens: 800, maxCostUsd: 8, maxElapsedMs: 100000, maxConcurrency: 1 };
const policy = { windowMs: 1000, maxSlicesPerWindow: 8, maxLifetimeSlices: 8, quantumMs: 50, idleRetryMs: 100, maxStalls: 3, resources };
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const sequence = (prefix: string) => { let index = 0; return () => `${prefix}-${++index}`; };
const iso = (time = epoch) => new Date(time).toISOString();
function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'initiative-heldout-'));
  const filename = join(directory, 'state.sqlite');
  let store = new OperationalStore({ filename });
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  let time = epoch;
  const now = () => time;
  const dependencies = (db: OperationalStore, prefix: string) => {
    const goals = new InitiativeRegistry(db, sequence(`${prefix}-goal`));
    const memory = new DevelopmentalMemory(db, () => iso(now()), { monotonicNow: () => 0, withdrawalId: sequence(`${prefix}-withdrawal`), compareIds: order });
    const obligations = new ObligationRegistry(db);
    return { goals, memory, obligations };
  };
  return { store, ...dependencies(store, 'first'), now, setTime: (value: number) => { time = value; },
    reopen() { store.close(); store = new OperationalStore({ filename }); return { store, ...dependencies(store, 'restart') }; } };
}
const snapshot = (store: OperationalStore) => canonicalJson(store.captureDevelopmentSnapshot({ maxRows: 512, maxBytes: 1000000 }));
function add(goals: InitiativeRegistry, id: string, origin: Goal['origin'] = { kind: 'self' }) {
  const goal = goals.propose({ id, origin, purpose: `Observe ${id}`, scope, successCriteria: ['new measurement'], evidenceIds: [], dependencyIds: [], resources, priority: 1, nextAction: 'measure', reviewAt: iso() }, { sourceIds: ['fixture-evidence'], actorId: 'review', recordedAt: iso(), derivation: 'interpreted' });
  return goals.accept(id, goal.revision, 'bounded inquiry');
}
function scheduler(f: Pick<ReturnType<typeof fixture>, 'store' | 'goals' | 'obligations'>, prefix = 'first') {
  return new FairScheduler(f.store, f.goals, f.obligations, 'review', policy, epoch, undefined, { newId: sequence(`${prefix}-selection`), compareIds: order });
}
function runtime(f: Pick<ReturnType<typeof fixture>, 'store' | 'now'>, shell: ShellPort, newId = sequence('runtime')) {
  const effects = new EffectJournal(f.store, { assert() {} }, { async dispatch() { throw Error('unexpected effect'); }, async reconcile() { throw Error('unexpected effect'); } }, sequence('effect'));
  const ledger = new ResourceLedger(f.store, { tokens: 9, costUsd: 0.5, elapsedMs: 10 }, f.now);
  return new DurableRuntime({ store: f.store, shell, effects, resources: ledger, now: f.now, elapsedNow: () => 0, newId });
}
function options(f: ReturnType<typeof fixture>, s: FairScheduler, r: DurableRuntime, scheduleTimeout: ScheduleTimeout) {
  return { scheduler: s, runtime: r, memory: f.memory, authority: { generation: 'review', epoch: 1, controlRevision: 'review' },
    prompt: () => ({ id: 'review', fragments: [], requestDigest: identity('review') }),
    decide: (): never => { throw Error('unexpected judgment'); }, scheduleTimeout };
}
function timer() {
  const callbacks: (() => void)[] = []; let cancels = 0;
  const schedule: ScheduleTimeout = (_delay, callback) => { callbacks.push(callback); return () => { cancels++; }; };
  return { schedule, callbacks, cancels: () => cancels };
}
const noShell: ShellPort = { async run() { throw Error('shell must not be entered'); } };

for (const stage of ['goal-ID', 'runtime-ID', 'prompt'] as const) test(`heldout: ${stage} failure rolls back the complete prepared slice and retries once`, async t => {
  const f = fixture(t); add(f.goals, 'goal'); let fail = true, calls = 0;
  const failure = Error(`${stage} unavailable`);
  const goals = stage === 'goal-ID' ? new InitiativeRegistry(f.store, () => { calls++; if (fail) throw failure; return `recovery-goal-${calls}`; }) : f.goals;
  const s = scheduler({ ...f, goals });
  const r = runtime(f, { async run() { return { status: 'completed', observations: [] }; } }, () => { calls++; if (fail && stage === 'runtime-ID') throw failure; return `runtime-${calls}`; });
  const clock = timer(), config = options(f, s, r, clock.schedule);
  config.prompt = () => { if (fail && stage === 'prompt') throw failure; return { id: 'review', fragments: [], requestDigest: identity('review') }; };
  const runner = new InitiativeRunner(config), parent = new AbortController(), before = snapshot(f.store);
  await assert.rejects(runner.tick(parent.signal), error => error === failure);
  assert.equal(snapshot(f.store), before);
  assert.equal(f.store.list('initiative.execution').length, 0); assert.equal(f.store.list('runs').length, 0);
  assert.equal(f.store.list('allocations').length, 1); assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
  fail = false; assert.equal((await runner.tick()).kind, 'selected'); assert.equal(s.snapshot().lifetimeSlices, 1);
  assert.equal(clock.cancels(), 2);
});

test('heldout: setup and cancellation reentrancy cannot double select; late callbacks cannot abort delivery', async t => {
  const f = fixture(t), s = scheduler(f), r = runtime(f, noShell);
  f.obligations.owe({ id: 'report', inputId: 'input', audience: scope, promisedOutcome: 'report evidence', dueAt: iso() });
  let runner!: InitiativeRunner, delivered!: AbortSignal, callback!: () => void, calls = 0;
  const reentrant: Promise<void>[] = [];
  const schedule: ScheduleTimeout = (_delay, fire) => {
    callback = fire; calls++;
    reentrant.push(assert.rejects(runner.tick(), /slice already active/));
    return () => { fire(); reentrant.push(assert.rejects(runner.tick(), /slice already active/)); };
  };
  const config = { ...options(f, s, r, schedule), deliver: async (_id: string, signal: AbortSignal) => { delivered = signal; } };
  runner = new InitiativeRunner(config); config.scheduleTimeout = () => { throw Error('mutated timer must not run'); };
  await runner.tick(); await Promise.all(reentrant);
  assert.equal(calls, 1); assert.equal(s.snapshot().lifetimeSlices, 1); assert.equal(delivered.aborted, false);
  const after = snapshot(f.store); callback(); callback(); assert.equal(snapshot(f.store), after); assert.equal(delivered.aborted, false);
  assert.equal((await runner.tick()).kind, 'idle'); await Promise.all(reentrant);
});

test('heldout: a pending delivery excludes a concurrent tick and retains failure, backoff and original resource charge across reopen', async t => {
  const f = fixture(t), s = scheduler(f), r = runtime(f, noShell), clock = timer();
  f.obligations.owe({ id: 'report', inputId: 'input', audience: scope, promisedOutcome: 'report evidence', dueAt: iso() });
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), pending = new Promise<void>(resolve => { release = resolve; });
  const failure = Error('delivery unavailable'); let deliveries = 0, signal!: AbortSignal;
  const runner = new InitiativeRunner({ ...options(f, s, r, clock.schedule), deliver: async (_id, abortSignal) => { deliveries++; signal = abortSignal; entered(); await pending; throw failure; } });
  const reserved = { id: 'retained-request', reservationId: 'retained-request', runId: runner.rootAllocation, purpose: 'reasoning' as const, provider: 'fixture', model: 'fixture', promptManifestId: 'review', requestDigest: identity('review'), status: 'reserved' as const, usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 } };
  r.resources.reserve(reserved); r.resources.dispatched({ ...reserved, status: 'dispatched' });
  const parent = new AbortController(); const done = runner.tick(parent.signal); const rejected = assert.rejects(done, error => error === failure);
  await started; const before = snapshot(f.store); await assert.rejects(runner.tick(), /slice already active/); assert.equal(snapshot(f.store), before);
  parent.abort(Error('stop')); clock.callbacks[0]!(); release(); await rejected;
  assert.equal(signal.aborted, true); assert.equal(getEventListeners(parent.signal, 'abort').length, 0); assert.equal(clock.cancels(), 1);
  assert.equal(f.obligations.obligation('report')!.status, 'owed');
  const charge = r.resources.snapshot(runner.rootAllocation), request = f.store.get('requests', 'retained-request');
  assert.equal(charge.requests, 1); assert.equal(charge.tokens, 9); assert.equal(charge.concurrent, 1);
  const reopened = { ...f, ...f.reopen() }, nextScheduler = scheduler(reopened, 'restart'), nextRuntime = runtime(reopened, noShell);
  const next = new InitiativeRunner({ ...options(reopened, nextScheduler, nextRuntime, clock.schedule), deliver: async () => { deliveries++; } });
  assert.deepEqual(nextRuntime.resources.snapshot(next.rootAllocation), charge); assert.deepEqual(reopened.store.get('requests', 'retained-request'), request);
  assert.equal((await next.tick()).kind, 'idle'); assert.equal(deliveries, 1);
  f.setTime(epoch + policy.idleRetryMs); assert.equal((await next.tick()).kind, 'selected'); assert.equal(deliveries, 2);
  assert.equal(nextScheduler.snapshot().lifetimeSlices, 2); assert.equal(nextRuntime.resources.snapshot(next.rootAllocation).requests, 1);
});

test('heldout: persisted service cursor and within-class queue survive restart and wall rollback', t => {
  const f = fixture(t); add(f.goals, 'a-inquiry'); add(f.goals, 'b-inquiry'); add(f.goals, 'conversation', { kind: 'request', inputId: 'input' });
  f.obligations.owe({ id: 'report', inputId: 'promise', audience: scope, promisedOutcome: 'report', dueAt: iso() });
  const s = scheduler(f);
  const selectedId = (value: ReturnType<FairScheduler['select']>) => { assert.equal(value.kind, 'selected'); if (value.kind !== 'selected') throw Error('selection required'); return value.selection.kind === 'goal' ? value.selection.goal.id : value.selection.obligation.id; };
  assert.equal(selectedId(s.select(iso(), true)), 'report'); assert.equal(selectedId(s.select(iso(), true)), 'conversation');
  assert.equal(selectedId(s.select(iso(), true)), 'a-inquiry');
  const reopened = { ...f, ...f.reopen() }, next = scheduler(reopened, 'restart');
  const before = snapshot(reopened.store); assert.throws(() => next.select(iso(epoch - 1), true), /backwards/); assert.equal(snapshot(reopened.store), before);
  assert.equal(selectedId(next.select(iso(epoch + 1000), true)), 'report'); assert.equal(selectedId(next.select(iso(epoch + 1000), true)), 'conversation'); assert.equal(selectedId(next.select(iso(epoch + 1000), true)), 'b-inquiry');
  assert.equal(next.snapshot().lifetimeSlices, 6); assert.equal(next.snapshot().windowSlices, 3);
});

for (const mode of ['throw', 'nonfinite'] as const) test(`heldout: drive ${mode} comparator cannot consume an opportunity or create a goal`, t => {
  const f = fixture(t); f.memory.ingest({ id: 'experience', runId: 'source', sourceId: 'observation', actorId: 'review', channel: 'tool', scope, at: iso(), content: 'new measurement' });
  const failure = Error('collation unavailable'); let fail = false, comparisons = 0;
  const drives = new DriveRegistry(f.store, f.memory, (a, b) => { comparisons++; if (fail) { if (mode === 'throw') throw failure; return Infinity; } return order(a, b); });
  drives.adopt({ id: 'curiosity', dimension: 'curiosity', scope, purpose: 'find out', reason: 'experience', weight: 1, active: true, provenance: { sourceIds: ['experience'], actorId: 'review', recordedAt: iso(), derivation: 'interpreted' } }, null);
  for (const id of ['first', 'second']) drives.offer({ id, driveId: 'curiosity', scope, sourceIds: ['experience'], question: 'why', observationAction: 'observe', successCriteria: ['measurement'], reason: 'uncertain', priority: 1 });
  const before = snapshot(f.store); fail = true;
  assert.throws(() => drives.select('first', f.goals, { id: 'derived', dependencyIds: [], resources, priority: 1, reviewAt: iso() }, 'review', iso()), mode === 'throw' ? error => error === failure : /collation/);
  assert.ok(comparisons > 0); assert.equal(snapshot(f.store), before);
  fail = false; drives.select('first', f.goals, { id: 'derived', dependencyIds: [], resources, priority: 1, reviewAt: iso() }, 'review', iso());
  assert.equal(drives.opportunities(scope).length, 1); assert.equal(f.goals.goal('derived')!.status, 'proposed');
});

test('heldout: throwing tool wall clock preserves original error and an entirely unchanged Store', t => {
  const f = fixture(t); f.memory.ingest({ id: 'experience', runId: 'source', sourceId: 'observation', actorId: 'review', channel: 'tool', scope, at: iso(), content: 'measurement' });
  const failure = Error('wall clock unavailable'); let reads = 0;
  const tools = initiativeTools(f.goals, new DriveRegistry(f.store, f.memory, order), new PlanRegistry(f.store), scope, 'review', resources, 'run', () => { reads++; throw failure; });
  const before = snapshot(f.store);
  assert.throws(() => tools.find(tool => tool.name === 'initiative_drive_adopt')!.execute({ id: 'drive', dimension: 'curiosity', purpose: 'learn', sourceIds: ['experience'], reason: 'observation', weight: 1, active: true, expectedRevision: null }), error => error === failure);
  assert.equal(reads, 1); assert.equal(snapshot(f.store), before);
});

test('heldout: simultaneous selection and timer-cleanup failure retain both original error identities', async t => {
  const f = fixture(t), selectionFailure = Error('selection ID unavailable'), cleanupFailure = Error('timer cleanup unavailable');
  const s = new FairScheduler(f.store, f.goals, f.obligations, 'review', policy, epoch, undefined, { newId: () => { throw selectionFailure; }, compareIds: order });
  const r = runtime(f, noShell); let cancelFails = true;
  const runner = new InitiativeRunner(options(f, s, r, () => () => { if (cancelFails) throw cleanupFailure; }));
  const parent = new AbortController(), before = snapshot(f.store); let observed: unknown;
  try { await runner.tick(parent.signal); } catch (error) { observed = error; }
  assert.equal(snapshot(f.store), before); assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
  cancelFails = false; await assert.rejects(runner.tick(), error => error === selectionFailure);
  // Either a primary error with retained cleanup cause, or an aggregate, preserves both failures.
  const contains = (error: unknown, expected: Error): boolean => error === expected || (error instanceof AggregateError && error.errors.some(item => contains(item, expected))) || (error instanceof Error && contains(error.cause, expected));
  assert.ok(contains(observed, cleanupFailure), 'cleanup failure must remain observable');
  assert.ok(contains(observed, selectionFailure), 'original selection failure must not be replaced by cleanup failure');
});
