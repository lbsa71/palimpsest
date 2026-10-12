import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OperationalStore } from '../packages/storage/index.ts';
import { DurableRuntime } from '../packages/runtime/execution/index.ts';
import type { RuntimeOptions } from '../packages/runtime/execution/index.ts';
import { ResourceLedger, BudgetExceeded } from '../packages/runtime/resources/index.ts';
import { EffectJournal } from '../packages/effects/index.ts';
import { assertAuthority, identity } from '../packages/contracts/common.ts';
import type { Effect, EffectReceiver, ShellPort } from '../packages/contracts/execution/index.ts';
import type { PhysicalRequest } from '../packages/contracts/control/index.ts';
import { authority, envelope, input, prompt } from '../packages/runtime/test/fixtures.ts';

function filename(): string { return join(mkdtempSync(join(tmpdir(), 'aeon-di03-')), 'state.sqlite'); }
function request(id: string, runId = 'r'): PhysicalRequest {
  return { id, runId, purpose: 'reasoning', provider: 'fixture', model: 'fixture', promptManifestId: 'p', requestDigest: identity(id), reservationId: id, status: 'reserved', usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 } };
}
function pendingEffect(id = 'e'): Effect { return { id, runId: 'r', stepId: 's', kind: 'inspect', payload: null, scope: { kind: 'public' }, authority, status: 'pending', revision: 0 }; }
function setup(label: string, shell: ShellPort, receive?: EffectReceiver['dispatch']) {
  const store = new OperationalStore({ filename: filename() });
  const clock = { wall: 1000, elapsed: 20 };
  let runtimeSequence = 0, effectSequence = 0, calls = 0;
  const ids = { runtime: () => `${label}:runtime:${++runtimeSequence}`, effect: () => `${label}:effect:${++effectSequence}` };
  const effects = new EffectJournal(store, { assert(a) { assertAuthority(a, authority); } }, {
    async dispatch(effect, signal) { calls++; return receive ? receive(effect, signal) : { outcome: 'succeeded', receipt: store.putJsonArtifact({ ok: true }) }; },
    async reconcile() { return { outcome: 'unresolved', receipt: store.putJsonArtifact({ unknown: true }) }; },
  }, () => ids.effect());
  const resources = new ResourceLedger(store, { tokens: 100, costUsd: 1, elapsedMs: 10 }, () => clock.wall);
  const options: RuntimeOptions = { store, effects, resources, shell, now: () => clock.wall, elapsedNow: () => clock.elapsed, newId: () => ids.runtime() };
  const runtime = new DurableRuntime(options);
  return { store, clock, ids, resources, effects, options, runtime, calls: () => calls };
}
const idle: ShellPort = { async run() { return { status: 'completed', observations: [] }; } };

test('independent captured ports determine timestamps, elapsed usage and every runtime/effect journal ID', async () => {
  const exercise = async (label: string, wall: number, elapsed: number) => {
    const f = setup(label, { async run({ run, messages }, bridge) {
      assert.equal((messages[0] as { timestamp: number }).timestamp, wall);
      const observation = await bridge.execute({ id: 'inspect', runId: run.id, stepId: 's', name: 'inspect', arguments: null });
      assert.equal(observation.provenance.recordedAt, new Date(wall).toISOString());
      const checkpoint = await bridge.persistCheckpoint(run.id, run.revision, 'fixture', { observationIds: [observation.id] });
      return { status: 'checkpointed', observations: [observation], checkpoint };
    } }, async () => { f.clock.elapsed += elapsed; return { outcome: 'succeeded' }; });
    try {
      f.clock.wall = wall;
      f.options.now = () => { throw Error('replaced wall'); };
      f.options.elapsedNow = () => { throw Error('replaced elapsed'); };
      f.options.newId = () => { throw Error('replaced ID'); };
      const run = f.runtime.admit(input, authority, envelope);
      assert.equal((await f.runtime.resume(run.id, prompt)).status, 'waiting');
      assert.equal(f.resources.request('tool:inspect')?.usage.elapsedMs, elapsed);
      f.runtime.adopt(run.id, authority);
      f.runtime.cancel(run.id, 'alice', 'stop');
      const events = f.store.events();
      assert.deepEqual(events.filter(e => ['status', 'observation', 'checkpoint', 'adopted', 'cancelled'].includes(e.type)).map(e => e.id), Array.from({ length: 7 }, (_, i) => `${label}:runtime:${i + 1}`));
      assert.deepEqual(events.filter(e => e.stream.startsWith('effect:')).map(e => e.id), Array.from({ length: 4 }, (_, i) => `${label}:effect:${i + 1}`));
      assert.equal((events.find(e => e.type === 'cancelled')!.data as { requestedAt: string }).requestedAt, new Date(wall).toISOString());
      assert.equal(f.calls(), 1);
    } finally { f.store.close(); }
  };
  await Promise.all([exercise('first', 1000, 3), exercise('second', 9000, 7)]);
});

test('duplicate status/checkpoint IDs roll back logical writes and leave the prior checkpoint readable', async () => {
  const f = setup('duplicate', idle);
  try {
    const run = f.runtime.admit(input, authority, envelope);
    f.ids.runtime = () => 'single-id';
    const claim = f.runtime.prepareResume(run.id);
    const bridge = f.runtime.bridge(run.id, authority);
    await assert.rejects(bridge.persistCheckpoint(run.id, claim.run.revision, 'fixture', {}), /conflicting event identity/);
    assert.equal(f.store.get('execution', run.id), undefined);
    assert.throws(() => f.runtime.cancel(run.id, 'alice', 'stop'), /conflicting event identity/);
    assert.equal(f.runtime.getRun(run.id)?.status, 'running');
    assert.equal(f.resources.snapshot(run.id).cancelled, false);
    f.ids.runtime = () => 'checkpoint-id';
    const checkpoint = await bridge.persistCheckpoint(run.id, claim.run.revision, 'fixture', { previous: true });
    f.ids.runtime = () => { throw Error('ID supplier failed'); };
    await assert.rejects(bridge.persistCheckpoint(run.id, claim.run.revision, 'fixture', { replacement: true }), /ID supplier failed/);
    assert.deepEqual(await bridge.readCheckpoint(checkpoint), { previous: true });
  } finally { f.store.close(); }
});

test('throwing status supplier rolls back a claim before shell entry; effect ID failures roll back creation/dispatch', async () => {
  const f = setup('failure', idle);
  try {
    const run = f.runtime.admit(input, authority, envelope);
    f.ids.runtime = () => { throw Error('status unavailable'); };
    assert.throws(() => f.runtime.prepareResume(run.id), /status unavailable/);
    assert.equal(f.runtime.getRun(run.id)?.status, 'ready');
    f.ids.effect = () => { throw Error('effect ID unavailable'); };
    assert.throws(() => f.effects.create(pendingEffect()), /effect ID unavailable/);
    assert.equal(f.effects.get('e'), undefined);
    f.ids.effect = () => 'single-effect-id';
    f.effects.create(pendingEffect());
    assert.throws(() => f.effects.authorize('e', 'e', authority), /conflicting event identity/);
    assert.equal(f.effects.get('e')?.status, 'pending');
    f.ids.effect = () => 'authorize-id';
    f.effects.authorize('e', 'e', authority);
    f.resources.allocate('r', envelope);
    const reservation = { ...request('e'), provider: 'effect-receiver' };
    f.resources.reserve(reservation);
    f.ids.effect = () => { throw Error('dispatch ID unavailable'); };
    await assert.rejects(f.effects.dispatch('e', authority, undefined, () => f.resources.dispatched({ ...reservation, status: 'dispatched' })), /dispatch ID unavailable/);
    assert.equal(f.effects.get('e')?.status, 'authorized');
    assert.equal(f.resources.request('e')?.status, 'reserved');
    assert.equal(f.calls(), 0);
  } finally { f.store.close(); }
});

test('wall rollback cannot replenish a denied durable parent allowance after reopen', () => {
  const path = filename(); let wall = 100;
  let store = new OperationalStore({ filename: path });
  let ledger = new ResourceLedger(store, { tokens: 10, costUsd: 1, elapsedMs: 1 }, () => wall);
  ledger.allocate('r', { ...envelope, maxElapsedMs: 10 });
  ledger.allocate('child', envelope, 'r');
  const reserved = request('p', 'child'); ledger.reserve(reserved);
  wall = 111;
  assert.throws(() => ledger.dispatched({ ...reserved, status: 'dispatched' }), BudgetExceeded);
  store.close(); wall = 100;
  store = new OperationalStore({ filename: path });
  ledger = new ResourceLedger(store, { tokens: 10, costUsd: 1, elapsedMs: 1 }, () => wall);
  try {
    assert.equal(ledger.snapshot('child').elapsedMs, 11);
    assert.throws(() => ledger.dispatched({ ...reserved, status: 'dispatched' }), BudgetExceeded);
    assert.throws(() => ledger.reserve(request('new', 'child')), BudgetExceeded);
    assert.equal(ledger.request('p')?.status, 'reserved');
    assert.equal(ledger.request('new'), undefined);
  } finally { store.close(); }
});

test('resource snapshot stays read-only under the actual development source fence', () => {
  const f = setup('read-only', idle);
  try {
    f.resources.allocate('r', envelope); const before = f.store.get('allocations', 'r');
    f.clock.wall += 4;
    assert.equal(f.store.withDevelopmentReadOnly(() => f.resources.snapshot('r')).elapsedMs, 4);
    assert.deepEqual(f.store.get('allocations', 'r'), before);
    f.clock.wall -= 4;
    assert.equal(f.resources.snapshot('r').elapsedMs, 4);
    // A subsequent explicit reservation commits previously observed time.
    f.resources.reserve(request('commit-observation'));
    assert.equal(f.resources.snapshot('r').elapsedMs, 10);
  } finally { f.store.close(); }
});

test('elapsed floors share enclosing transaction rollback and do not mutate a fenced snapshot', () => {
  const f = setup('outer-rollback', idle);
  try {
    f.resources.allocate('r', { ...envelope, maxElapsedMs: 10 });
    const original = request('outer'); f.resources.reserve(original);
    const before = f.store.get('budgets', 'r');
    f.clock.wall += 11;
    assert.throws(() => f.store.transaction(() => f.resources.dispatched({ ...original, status: 'dispatched' })), BudgetExceeded);
    assert.deepEqual(f.store.get('budgets', 'r'), before, 'outer rollback also rolls back elapsed-floor persistence');
    f.clock.wall -= 11;
    assert.equal(f.store.withDevelopmentReadOnly(() => f.resources.snapshot('r')).elapsedMs, 11, 'current instance retains the uncommitted conservative observation');
    assert.deepEqual(f.store.get('budgets', 'r'), before);
    assert.equal(f.resources.request('outer')?.status, 'reserved');
  } finally { f.store.close(); }
});

test('unknown usage keeps original charges and concurrency through recovery and cancellation', () => {
  const path = filename(); let store = new OperationalStore({ filename: path });
  let ledger = new ResourceLedger(store, { tokens: 80, costUsd: 2, elapsedMs: 9 }, () => 100);
  ledger.allocate('r', envelope); const original = request('unknown'); ledger.reserve(original); ledger.dispatched({ ...original, status: 'dispatched' }); store.close();
  store = new OperationalStore({ filename: path }); ledger = new ResourceLedger(store, { tokens: 1, costUsd: 0, elapsedMs: 0 }, () => 0);
  try {
    ledger.recoverDispatched(); ledger.cancel('r');
    assert.equal(ledger.request('unknown')?.status, 'uncertain');
    const snapshot = ledger.snapshot('r');
    assert.deepEqual(snapshot, { requests: 1, tokens: 80, costUsd: 2, elapsedMs: 9, concurrent: 1, cancelled: true });
    assert.throws(() => ledger.reserve(request('retry')), BudgetExceeded);
  } finally { store.close(); }
});

for (const bad of [NaN, Infinity]) test(`invalid wall reading ${bad} rolls back allocation and cancellation`, () => {
  const f = setup('invalid-wall', idle);
  try {
    f.clock.wall = bad;
    assert.throws(() => f.resources.allocate('bad', envelope), /wall clock/);
    assert.equal(f.store.get('allocations', 'bad'), undefined);
    f.clock.wall = 1000; const run = f.runtime.admit(input, authority, envelope); f.clock.wall = bad;
    assert.throws(() => f.runtime.cancel(run.id, 'alice', 'stop'), /wall clock/);
    assert.equal(f.runtime.getRun(run.id)?.status, 'ready');
    assert.equal(f.store.events(run.id).filter(e => e.type === 'cancelled').length, 0);
  } finally { f.store.close(); }
});

for (const failure of ['regression', 'throws', 'nonfinite'] as const) test(`elapsed clock ${failure} after receiver entry preserves reservation and actual receipt`, async () => {
  const f = setup('elapsed-failure', { async run({ run }, bridge) {
    await bridge.execute({ id: 'inspect', runId: run.id, stepId: 's', name: 'inspect', arguments: null });
    return { status: 'completed', observations: [] };
  } }, async () => { if (failure === 'throws') failing = true; else f.clock.elapsed = failure === 'regression' ? 19 : NaN; return { outcome: 'succeeded', receipt: f.store.putJsonArtifact({ entered: true }) }; });
  let failing = false;
  // Supply failure through an already-captured callback's controlled state.
  const runtime = new DurableRuntime({ ...f.options, elapsedNow: () => { if (failing) throw Error('elapsed unavailable'); return f.clock.elapsed; } });
  try {
    const run = runtime.admit(input, authority, envelope);
    assert.equal((await runtime.resume(run.id, prompt)).status, 'waiting');
    assert.equal(f.effects.get('tool:inspect')?.status, 'succeeded');
    assert.deepEqual(f.store.readJsonArtifact(f.effects.get('tool:inspect')!.receipt!), { entered: true });
    assert.equal(f.resources.request('tool:inspect')?.status, 'dispatched');
    assert.equal(f.resources.snapshot(run.id).elapsedMs, 10);
    runtime.recover();
    assert.equal(f.resources.request('tool:inspect')?.status, 'uncertain');
    assert.equal(f.resources.snapshot(run.id).elapsedMs, 10);
    assert.equal(f.calls(), 1);
  } finally { f.store.close(); }
});

for (const bad of [-1, NaN]) test(`invalid elapsed reading ${bad} before entry retains authorization without dispatch`, async () => {
  const f = setup('pre-entry-clock', { async run({ run }, bridge) {
    await bridge.execute({ id: 'inspect', runId: run.id, stepId: 's', name: 'inspect', arguments: null });
    return { status: 'completed', observations: [] };
  } });
  try {
    f.clock.elapsed = bad; const run = f.runtime.admit(input, authority, envelope);
    assert.equal((await f.runtime.resume(run.id, prompt)).status, 'waiting');
    assert.equal(f.calls(), 0);
    assert.equal(f.effects.get('tool:inspect')?.status, 'authorized');
    assert.equal(f.resources.request('tool:inspect')?.status, 'reserved');
    assert.equal(f.resources.snapshot(run.id).elapsedMs, 10);
  } finally { f.store.close(); }
});

test('empty ID suppliers fail atomically without silently selecting production IDs', () => {
  const f = setup('empty-id', idle);
  try {
    const run = f.runtime.admit(input, authority, envelope); f.ids.runtime = () => '';
    assert.throws(() => f.runtime.prepareResume(run.id), /event.id/);
    assert.equal(f.runtime.getRun(run.id)?.status, 'ready');
    f.ids.effect = () => ''; assert.throws(() => f.effects.create(pendingEffect()), /event.id/);
    assert.equal(f.effects.get('e'), undefined);
    assert.equal(f.store.events().length, 1);
  } finally { f.store.close(); }
});

test('cancellation aborts active receiver, retains late receipt and original charge, and prevents new effects', async () => {
  let entered!: () => void, finish!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const drain = new Promise<void>(resolve => { finish = resolve; });
  let receiverSignal: AbortSignal | undefined;
  const f = setup('cancel', { async run({ run }, bridge, signal) {
    await bridge.execute({ id: 'inspect', runId: run.id, stepId: 's', name: 'inspect', arguments: null }, signal);
    await assert.rejects(bridge.execute({ id: 'later', runId: run.id, stepId: 's2', name: 'inspect', arguments: null }, signal), /ownership withdrawn/);
    return { status: 'cancelled', observations: [] };
  } }, async (_effect, signal) => { receiverSignal = signal; entered(); await drain; return { outcome: 'succeeded', receipt: f.store.putJsonArtifact({ late: true }) }; });
  try {
    const run = f.runtime.admit(input, authority, envelope);
    const result = f.runtime.resume(run.id, prompt); await ready;
    f.runtime.cancel(run.id, 'alice', 'stop'); assert.equal(receiverSignal?.aborted, true);
    f.clock.elapsed += 4; finish(); assert.equal((await result).status, 'cancelled');
    assert.equal(f.effects.get('tool:inspect')?.status, 'succeeded');
    assert.equal(f.resources.snapshot(run.id).cancelled, true);
    assert.equal(f.resources.request('tool:inspect')?.usage.elapsedMs, 4);
    assert.equal(f.effects.get('tool:later'), undefined); assert.equal(f.calls(), 1);
  } finally { finish(); f.store.close(); }
});
