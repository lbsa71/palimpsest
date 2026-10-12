import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OperationalStore } from '../packages/storage/index.ts';
import { DurableRuntime } from '../packages/runtime/execution/index.ts';
import type { RuntimeOptions } from '../packages/runtime/execution/index.ts';
import { ResourceLedger, BudgetExceeded } from '../packages/runtime/resources/index.ts';
import { EffectJournal } from '../packages/effects/index.ts';
import { assertAuthority, canonicalJson, identity } from '../packages/contracts/common.ts';
import type { Effect, EffectReceiver, ShellPort } from '../packages/contracts/execution/index.ts';
import type { PhysicalRequest } from '../packages/contracts/control/index.ts';
import { authority, envelope, input, prompt } from '../packages/runtime/test/fixtures.ts';

const ceiling = { tokens: 30, costUsd: 1, elapsedMs: 20 };
const idle: ShellPort = { async run() { return { status: 'completed', observations: [] }; } };
function state(store: OperationalStore) { return store.captureDevelopmentSnapshot({ maxRows: 512, maxBytes: 1_048_576 }); }
function request(id: string, runId = 'root'): PhysicalRequest {
  return { id, runId, purpose: 'reasoning', provider: 'fixture', model: 'fixture', promptManifestId: 'prompt', requestDigest: identity(id), reservationId: id, status: 'reserved', usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 } };
}
function effect(id: string): Effect { return { id, runId: 'root', stepId: id, kind: 'fixture', payload: null, scope: { kind: 'public' }, authority, status: 'pending', revision: 0 }; }
function fixture(shell: ShellPort = idle, dispatch?: EffectReceiver['dispatch']) {
  const directory = mkdtempSync(join(tmpdir(), 'aeon-di03-review-'));
  const filename = join(directory, 'state.sqlite');
  const store = new OperationalStore({ filename });
  const control = { wall: 100, elapsed: 10, runtimeId: undefined as string | Error | undefined, effectId: undefined as string | Error | undefined, elapsedError: undefined as Error | undefined };
  let runtimeSequence = 0, effectSequence = 0, entries = 0;
  const wall = function(this: unknown) { assert.equal(this, undefined); return control.wall; };
  const elapsed = function(this: unknown) { assert.equal(this, undefined); if (control.elapsedError) throw control.elapsedError; return control.elapsed; };
  const runtimeId = function(this: unknown) { assert.equal(this, undefined); if (control.runtimeId instanceof Error) throw control.runtimeId; return control.runtimeId ?? `runtime:${++runtimeSequence}`; };
  const effectId = function(this: unknown) { assert.equal(this, undefined); if (control.effectId instanceof Error) throw control.effectId; return control.effectId ?? `effect:${++effectSequence}`; };
  const effects = new EffectJournal(store, { assert(a) { assertAuthority(a, authority); } }, {
    async dispatch(e, signal) { entries++; return dispatch ? dispatch(e, signal) : { outcome: 'succeeded' }; },
    async reconcile() { return { outcome: 'unresolved', receipt: store.putJsonArtifact({ unknown: true }) }; },
  }, effectId);
  const resources = new ResourceLedger(store, ceiling, wall);
  const options: RuntimeOptions = { store, shell, effects, resources, now: wall, elapsedNow: elapsed, newId: runtimeId };
  const runtime = new DurableRuntime(options);
  return { store, filename, control, options, runtime, resources, effects, entries: () => entries, close() { store.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('review: captured callbacks are receiver-free through messages, effects, checkpoint and cancellation', async () => {
  let timestamp: unknown;
  const f = fixture({ async run({ run, messages }, bridge) {
    timestamp = (messages[0] as { timestamp: number }).timestamp;
    const observed = await bridge.execute({ id: 'one', runId: run.id, stepId: 'step', name: 'fixture', arguments: null });
    const checkpoint = await bridge.persistCheckpoint(run.id, run.revision, 'fixture', { observationIds: [observed.id] });
    return { status: 'checkpointed', observations: [observed], checkpoint };
  } }, async () => { f.control.elapsed = 17; return { outcome: 'succeeded' }; });
  try {
    f.options.now = f.options.elapsedNow = () => { throw Error('replacement used'); };
    f.options.newId = () => { throw Error('replacement used'); };
    const run = f.runtime.admit(input, authority, envelope);
    assert.equal((await f.runtime.resume(run.id, prompt)).status, 'waiting');
    assert.equal(timestamp, 100);
    assert.equal(f.resources.request('tool:one')?.usage.elapsedMs, 7);
    assert.equal(f.runtime.observations(run.id)[0].provenance.recordedAt, new Date(100).toISOString());
    f.runtime.cancel(run.id, 'reviewer', 'done');
    assert.equal(f.runtime.getRun(run.id)?.status, 'cancelled');
    assert.equal(f.entries(), 1);
  } finally { f.close(); }
});

for (const failure of ['throw', 'collision'] as const) test(`review: checkpoint ${failure} removes rejected artifact and preserves prior assignment across reopen`, async () => {
  const f = fixture();
  try {
    const run = f.runtime.admit(input, authority, envelope), claim = f.runtime.prepareResume(run.id);
    const bridge = f.runtime.bridge(run.id, authority);
    const saved = await bridge.persistCheckpoint(run.id, claim.run.revision, 'fixture', { retained: true });
    const before = state(f.store), rejected = { uniqueRejectedCheckpoint: failure };
    const digest = identity(rejected);
    f.control.runtimeId = failure === 'throw' ? Error('checkpoint ID failure') : f.store.events(run.id).find(e => e.type === 'checkpoint')!.id;
    await assert.rejects(bridge.persistCheckpoint(run.id, claim.run.revision, 'fixture', rejected), /checkpoint ID failure|conflicting event identity/);
    assert.deepEqual(state(f.store), before);
    assert.throws(() => f.store.readArtifact({ uri: `aeon:artifact:${digest}`, sha256: digest }), /missing artifact/);
    const reopened = new OperationalStore({ filename: f.filename });
    try {
      assert.deepEqual(state(reopened), before);
      assert.deepEqual(reopened.readJsonArtifact(saved.artifact), { retained: true });
      assert.throws(() => reopened.readArtifact({ uri: `aeon:artifact:${digest}`, sha256: digest }), /missing artifact/);
      assert.deepEqual(await bridge.readCheckpoint(saved), { retained: true });
    } finally { reopened.close(); }
  } finally { f.close(); }
});

for (const failure of ['throw', 'collision'] as const) test(`review: receipt ID ${failure} after receiver entry keeps conservative work and prevents replay`, async () => {
  const f = fixture(idle, async () => {
    f.control.effectId = failure === 'throw' ? Error('receipt ID failure') : 'effect:1';
    return { outcome: 'succeeded', receipt: f.store.putJsonArtifact({ actual: 'receipt' }) };
  });
  try {
    f.resources.allocate('root', envelope);
    const r = { ...request('one'), provider: 'effect-receiver' };
    f.resources.reserve(r); f.effects.create(effect('one')); f.effects.authorize('one', r.id, authority);
    await assert.rejects(f.effects.dispatch('one', authority, undefined, () => f.resources.dispatched({ ...r, status: 'dispatched' })), /receipt ID failure|conflicting event identity/);
    assert.equal(f.entries(), 1); assert.equal(f.effects.get('one')?.status, 'dispatched');
    assert.equal(f.resources.request('one')?.status, 'dispatched');
    assert.deepEqual(f.resources.snapshot('root'), { requests: 1, tokens: 30, costUsd: 1, elapsedMs: 20, concurrent: 1, cancelled: false });
    const receiptDigest = identity({ actual: 'receipt' });
    assert.deepEqual(f.store.readJsonArtifact({ uri: `aeon:artifact:${receiptDigest}`, sha256: receiptDigest }), { actual: 'receipt' });
    f.control.effectId = undefined; f.runtime.recover();
    assert.equal(f.effects.get('one')?.status, 'uncertain'); assert.equal(f.resources.request('one')?.status, 'uncertain');
    await assert.rejects(f.effects.dispatch('one', authority), /requires authorization or reconciliation/);
    assert.equal(f.entries(), 1); assert.equal(f.resources.snapshot('root').elapsedMs, 20);
  } finally { f.close(); }
});

test('review: duplicate recovery event rolls back the entire effect batch before resources recover', async () => {
  const f = fixture(idle, async () => ({ outcome: 'uncertain' }));
  try {
    f.resources.allocate('root', envelope);
    // Actual unresolved receiver outcomes are then represented as dispatched crash-state
    // through the Store adapter, without replacing any module or instance method.
    for (const id of ['a', 'b']) {
      const r = request(id); f.resources.reserve(r); f.resources.dispatched({ ...r, status: 'dispatched' });
      f.effects.create(effect(id)); f.effects.authorize(id, id, authority);
      const row = f.store.get<Effect>('effects', id)!;
      f.store.put('effects', id, { ...row.value, status: 'dispatched', revision: row.value.revision + 1 }, row.revision);
    }
    const before = state(f.store); f.control.effectId = 'duplicate-recovery';
    assert.throws(() => f.runtime.recover(), /conflicting event identity/);
    assert.deepEqual(state(f.store), before);
    f.control.effectId = undefined; f.runtime.recover();
    assert.equal(f.effects.unresolved('root').length, 2);
    for (const id of ['a', 'b']) { assert.equal(f.effects.get(id)?.status, 'uncertain'); assert.equal(f.resources.request(id)?.status, 'uncertain'); }
    assert.equal(f.resources.snapshot('root').elapsedMs, 40);
  } finally { f.close(); }
});

test('review: runtime adoption ID failure rolls back previously reauthorized effects', () => {
  const f = fixture();
  try {
    const run = f.runtime.admit(input, authority, envelope);
    f.effects.create({ ...effect('adopt'), runId: run.id });
    const before = state(f.store); f.control.runtimeId = Error('adoption ID failure');
    assert.throws(() => f.runtime.adopt(run.id, authority), /adoption ID failure/);
    assert.deepEqual(state(f.store), before);
    f.control.runtimeId = undefined; f.runtime.adopt(run.id, authority);
    assert.equal(f.effects.get('adopt')?.revision, 1);
    assert.equal(f.runtime.getRun(run.id)?.revision, 1);
  } finally { f.close(); }
});

for (const failFirstCompletion of [false, true]) test(`review: reverse async completions preserve per-run elapsed and reservations (clock failure=${failFirstCompletion})`, async () => {
  const releases = new Map<string, () => void>();
  const f = fixture(idle, async e => { await new Promise<void>(resolve => releases.set(e.id, resolve)); return { outcome: 'succeeded', receipt: f.store.putJsonArtifact({ completed: e.id }) }; });
  try {
    const a = f.runtime.admit(input, authority, envelope);
    const b = f.runtime.admit({ ...input, id: 'two', externalId: 'two' }, authority, envelope);
    f.runtime.prepareResume(a.id); f.runtime.prepareResume(b.id);
    const pa = f.runtime.bridge(a.id, authority).execute({ id: 'a', runId: a.id, stepId: 's', name: 'fixture', arguments: null });
    f.control.elapsed = 15;
    const pb = f.runtime.bridge(b.id, authority).execute({ id: 'b', runId: b.id, stepId: 's', name: 'fixture', arguments: null });
    assert.equal(releases.size, 2);
    if (failFirstCompletion) f.control.elapsedError = Error('one completion clock failed'); else f.control.elapsed = 18;
    releases.get('tool:b')!();
    if (failFirstCompletion) await assert.rejects(pb, /one completion clock failed/); else await pb;
    f.control.elapsedError = undefined; f.control.elapsed = 20; releases.get('tool:a')!(); await pa;
    assert.equal(f.resources.request('tool:a')?.usage.elapsedMs, 10);
    assert.equal(f.resources.request('tool:a')?.status, 'succeeded');
    assert.equal(f.resources.request('tool:b')?.status, failFirstCompletion ? 'dispatched' : 'succeeded');
    assert.equal(f.resources.snapshot(b.id).elapsedMs, failFirstCompletion ? 20 : 3);
    f.runtime.recover();
    assert.equal(f.resources.request('tool:b')?.status, failFirstCompletion ? 'uncertain' : 'succeeded');
    assert.deepEqual(f.store.readJsonArtifact(f.effects.get('tool:b')!.receipt!), { completed: 'tool:b' });
    assert.equal(f.entries(), 2);
  } finally { for (const release of releases.values()) release(); f.close(); }
});

test('review: persisted narrow lineage survives reopen while a roomy sibling remains usable', () => {
  const f = fixture();
  try {
    const ledger = new ResourceLedger(f.store, { ...ceiling, elapsedMs: 1 }, () => f.control.wall);
    ledger.allocate('root', envelope); ledger.allocate('narrow', { ...envelope, maxElapsedMs: 5 }, 'root');
    ledger.allocate('grandchild', envelope, 'narrow'); ledger.allocate('sibling', envelope, 'root');
    const blocked = request('blocked', 'grandchild'); ledger.reserve(blocked);
    f.control.wall = 106; assert.throws(() => ledger.dispatched({ ...blocked, status: 'dispatched' }), BudgetExceeded);
    const reopened = new OperationalStore({ filename: f.filename });
    try {
      const next = new ResourceLedger(reopened, { ...ceiling, elapsedMs: 1 }, () => 100);
      assert.throws(() => next.dispatched({ ...blocked, status: 'dispatched' }), BudgetExceeded);
      next.allocate('new-descendant', envelope, 'narrow');
      assert.throws(() => next.reserve(request('descendant', 'new-descendant')), BudgetExceeded);
      const sibling = request('sibling-request', 'sibling'); next.reserve(sibling); next.dispatched({ ...sibling, status: 'dispatched' });
      next.settle({ ...sibling, status: 'succeeded', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } });
      assert.equal(next.snapshot('sibling').elapsedMs, 6);
      assert.equal(next.request('blocked')?.status, 'reserved');
      assert.equal(next.request('sibling-request')?.status, 'succeeded');
    } finally { reopened.close(); }
  } finally { f.close(); }
});

for (const observation of ['read-only', 'rolled-back-dispatch'] as const) test(`review: ${observation} floor is local until an explicit commit and reopen retains only committed floors`, () => {
  const f = fixture();
  try {
    const ledger = new ResourceLedger(f.store, { ...ceiling, elapsedMs: 1 }, () => f.control.wall);
    ledger.allocate('root', { ...envelope, maxElapsedMs: 10 }); const r = request('reserved'); ledger.reserve(r);
    const before = state(f.store); f.control.wall = 112;
    if (observation === 'read-only') assert.equal(f.store.withDevelopmentReadOnly(() => ledger.snapshot('root')).elapsedMs, 12);
    else assert.throws(() => f.store.transaction(() => ledger.dispatched({ ...r, status: 'dispatched' })), BudgetExceeded);
    assert.deepEqual(state(f.store), before); f.control.wall = 100;
    assert.equal(f.store.withDevelopmentReadOnly(() => ledger.snapshot('root')).elapsedMs, 12);
    const reopened = new OperationalStore({ filename: f.filename });
    try {
      const fresh = new ResourceLedger(reopened, { ...ceiling, elapsedMs: 1 }, () => 100);
      assert.equal(fresh.snapshot('root').elapsedMs, 1, 'uncommitted observations are not restart clock evidence');
      assert.deepEqual(state(reopened), before);
      assert.throws(() => ledger.reserve(request('commit-denial')), BudgetExceeded);
      assert.equal(fresh.snapshot('root').elapsedMs, 12, 'explicit denied reservation commits the remembered floor');
      assert.throws(() => fresh.dispatched({ ...r, status: 'dispatched' }), BudgetExceeded);
      assert.equal(canonicalJson(fresh.request('reserved')), canonicalJson(r));
    } finally { reopened.close(); }
  } finally { f.close(); }
});
