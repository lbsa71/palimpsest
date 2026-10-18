import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertAuthority, identity, type Authority, type ResourceEnvelope } from '../../contracts/common.ts';
import type { PhysicalRequest } from '../../contracts/control/index.ts';
import type { Effect } from '../../contracts/execution/index.ts';
import { EffectJournal } from '../../effects/index.ts';
import { OperationalStore } from '../../storage/index.ts';
import { BudgetExceeded, ResourceLedger } from '../resources/index.ts';

const envelope: ResourceEnvelope = { maxRequests: 50, maxTokens: 1000, maxCostUsd: 100, maxElapsedMs: 10000, maxConcurrency: 8 };
const authority: Authority = { generation: 'old-host', epoch: 1, controlRevision: 'accepted' };
const inputId = identity('authenticated Slack control'), id = `host:slack-control:${inputId}`;
const scope = { kind: 'restricted' as const, principals: ['slack:user'] };
const payload = { channel: 'C1', threadTs: '123.456', kind: 'message', text: '[Host status] Cancellation recorded. This conversation is cancelled.' };
function fixture(t: test.TestContext, cancelled = true) {
  const directory = mkdtempSync(join(tmpdir(), 'aeon-host-accounting-')), filename = join(directory, 'state.sqlite');
  let store = new OperationalStore({ filename }), ledger = new ResourceLedger(store, { tokens: 10, costUsd: 1, elapsedMs: 5 }, () => 0);
  let current = authority, eventId = 0, calls = 0;
  const journal = () => new EffectJournal(store, { assert(value) { assertAuthority(value, current); } }, {
    async dispatch() { calls += 1; return { outcome: 'succeeded' }; },
    async reconcile() { return { outcome: 'unresolved', receipt: store.putArtifact('unresolved') }; },
  }, () => `effect-event:${++eventId}`);
  let effects = journal();
  ledger.allocate('root', envelope); ledger.allocate('conversation', envelope, 'root');
  if (cancelled) ledger.cancel('conversation');
  const request: PhysicalRequest = { id, runId: 'root', purpose: 'reasoning', provider: 'effect-receiver', model: 'speech_send',
    promptManifestId: id, requestDigest: identity(payload), reservationId: id, status: 'reserved',
    usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } };
  const effect: Effect = { id, runId: 'conversation', stepId: id, kind: 'speech_send', payload, scope, authority, status: 'pending', revision: 0 };
  const plan = { id, inputId, runId: 'conversation', control: 'cancel', runStatus: 'cancelled', runRevision: 2,
    target: { channel: payload.channel, threadTs: payload.threadTs, transport: 'slack', scope }, payload };
  store.put('host.slack-control-replies', id, plan, null);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return {
    get store() { return store; }, get ledger() { return ledger; }, get effects() { return effects; }, get calls() { return calls; },
    get host() { return { authority: current, assertAuthority() { assertAuthority(current, current); } }; }, request, effect, plan,
    setAuthority(value: Authority) { current = value; },
    create(r = request, e = effect) { ledger.reserve(r); effects.create(e); return effects.authorize(e.id, r.id, current); },
    bind() { ledger.bindHostEffectAccounting(effects.get(id)!, ledger.request(id)!, this.host); },
    reopen() { store.close(); store = new OperationalStore({ filename }); ledger = new ResourceLedger(store, { tokens: 10, costUsd: 1, elapsedMs: 5 }, () => 0); effects = journal(); },
  };
}

test('root-paid cancellation acknowledgement survives restart without changing any original grant or charge', t => {
  const f = fixture(t); f.create();
  const preserved = ['allocations', 'budgets', 'requests', 'effects'].map(namespace => f.store.list(namespace));
  f.bind(); f.bind();
  assert.deepEqual(['allocations', 'budgets', 'requests', 'effects'].map(namespace => f.store.list(namespace)), preserved);
  assert.equal(f.store.list('resource.host-effect-accounting').length, 1);
  const before = f.ledger.snapshot('root');
  f.reopen(); f.ledger.recoverUndispatchedEffects();
  assert.deepEqual(f.ledger.snapshot('root'), before);
  assert.equal(f.ledger.snapshot('conversation').cancelled, true);
  assert.equal(f.ledger.request(id)?.runId, 'root');
  assert.equal(f.effects.get(id)?.runId, 'conversation');
  assert.throws(() => f.ledger.reserve({ ...f.request, id: 'attempt-to-revive', reservationId: 'attempt-to-revive', runId: 'conversation' }), BudgetExceeded);
});

test('a pre-atomic dispatch crash restores only request status and retains unknown root charges', t => {
  const f = fixture(t), request = { ...f.request, usage: { ...f.request.usage, inputTokens: null, outputTokens: null, costUsd: null } };
  f.create(request); f.bind(); f.ledger.dispatched({ ...request, status: 'dispatched' });
  f.ledger.settle({ ...request, status: 'uncertain' });
  const reservation = f.store.get<any>('requests', id)!.value, allocations = f.store.list('allocations'), budgets = f.store.list('budgets');
  assert.equal(f.ledger.snapshot('root').tokens, 10); assert.equal(f.ledger.snapshot('root').costUsd, 1);
  f.reopen(); f.ledger.recoverUndispatchedEffects();
  assert.deepEqual(f.store.get('requests', id)!.value, { ...reservation, request: { ...reservation.request, status: 'reserved' } });
  assert.deepEqual(f.store.list('allocations'), allocations); assert.deepEqual(f.store.list('budgets'), budgets);
  assert.equal(f.ledger.snapshot('root').tokens, 10); assert.equal(f.ledger.snapshot('root').costUsd, 1);
  assert.equal(f.effects.get(id)?.status, 'authorized'); assert.equal(f.calls, 0);
});

test('ordinary same-run recovery still works and ordinary foreign-run reservations still fail', t => {
  const same = fixture(t, false);
  const request = { ...same.request, runId: 'conversation' };
  same.create(request); same.ledger.dispatched({ ...request, status: 'dispatched' });
  same.ledger.recoverUndispatchedEffects(); assert.equal(same.ledger.request(id)?.status, 'reserved');
  const foreign = fixture(t); foreign.create();
  assert.throws(() => foreign.ledger.recoverUndispatchedEffects(), /evidence unavailable/);
  assert.equal(foreign.store.list('resource.host-effect-accounting').length, 0);
  assert.equal(foreign.ledger.request(id)?.status, 'reserved');
  const ordinary = fixture(t);
  const ordinaryRequest = { ...ordinary.request, id: 'ordinary-effect', reservationId: 'ordinary-effect', promptManifestId: 'ordinary-effect' };
  const ordinaryEffect = ordinary.create(ordinaryRequest, { ...ordinary.effect, id: 'ordinary-effect', stepId: 'ordinary-effect' });
  assert.throws(() => ordinary.ledger.recoverUndispatchedEffects(), /exact control reply reservation/);
  assert.throws(() => ordinary.ledger.bindHostEffectAccounting(ordinaryEffect, ordinaryRequest, ordinary.host), /exact control reply reservation/);
});

test('prefixes and forged binding documents do not supply host ownership evidence', t => {
  const f = fixture(t); const effect = f.create();
  const bindingId = identity({ effectId: id, authority });
  f.store.put('resource.host-effect-accounting', bindingId, { effect, reservation: f.store.get('requests', id)!.value, plan: f.plan, authority, boundAt: 0 }, null);
  assert.throws(() => f.ledger.recoverUndispatchedEffects(), /evidence unavailable/);
  assert.throws(() => f.bind(), /evidence unavailable/);
  const missingPlan = fixture(t); missingPlan.create();
  missingPlan.store.delete('host.slack-control-replies', id, missingPlan.store.get('host.slack-control-replies', id)!.revision);
  assert.throws(() => missingPlan.bind(), /retained host control plan/);
});

test('binding requires synchronous current host authority and the exact retained reserved objects', t => {
  const f = fixture(t), effect = f.create();
  assert.throws(() => f.ledger.bindHostEffectAccounting(effect, f.request, { authority, assertAuthority() { throw new Error('withdrawn'); } }), /withdrawn/);
  assert.throws(() => f.ledger.bindHostEffectAccounting(effect, f.request, { authority, assertAuthority: async () => {} }), /synchronous/);
  assert.throws(() => f.ledger.bindHostEffectAccounting(effect, f.request, { ...f.host, authority: { ...authority, epoch: 2 } }), /stale or foreign/);
  assert.throws(() => f.ledger.bindHostEffectAccounting({ ...effect, payload: 'forged' }, f.request, f.host), /exact retained/);
  assert.throws(() => f.ledger.bindHostEffectAccounting(effect, { ...f.request, requestDigest: identity('forged') }, f.host), /exact retained/);
  f.ledger.dispatched({ ...f.request, status: 'dispatched' });
  assert.throws(() => f.ledger.bindHostEffectAccounting(effect, f.ledger.request(id)!, f.host), /exact retained/);
  assert.equal(f.store.list('resource.host-effect-accounting').length, 0);
});

test('only the actual root ancestor can pay for a host reply', t => {
  for (const runId of ['unrelated-root', 'sibling', 'conversation']) {
    const f = fixture(t, false);
    f.ledger.allocate('unrelated-root', envelope); f.ledger.allocate('sibling', envelope, 'root');
    f.create({ ...f.request, runId });
    assert.throws(() => f.bind(), /conversation root allocation/);
  }
});

test('recovery rejects changed payload, scope, recipient, request, ceiling, plan or binding snapshot', t => {
  const mutations: Array<(f: ReturnType<typeof fixture>) => void> = [
    f => { const row = f.store.get<Effect>('effects', id)!; f.store.put('effects', id, { ...row.value, payload: { ...payload, text: 'changed' } }, row.revision); },
    f => { const row = f.store.get<Effect>('effects', id)!; f.store.put('effects', id, { ...row.value, scope: { kind: 'public' } }, row.revision); },
    f => { const row = f.store.get<Effect>('effects', id)!; f.store.put('effects', id, { ...row.value, stepId: 'different-step' }, row.revision); },
    f => { const row = f.store.get<any>('requests', id)!; f.store.put('requests', id, { ...row.value, request: { ...row.value.request, promptManifestId: 'changed' } }, row.revision); },
    f => { const row = f.store.get<any>('requests', id)!; f.store.put('requests', id, { ...row.value, ceiling: { ...row.value.ceiling, tokens: 999 } }, row.revision); },
    f => { const row = f.store.get<any>('host.slack-control-replies', id)!; f.store.put('host.slack-control-replies', id, { ...row.value, runRevision: 999 }, row.revision); },
    f => { const row = f.store.list<any>('resource.host-effect-accounting')[0]!; f.store.put('resource.host-effect-accounting', row.key, { ...row.value, boundAt: 999 }, row.revision); },
  ];
  for (const mutate of mutations) {
    const f = fixture(t); f.create(); f.bind(); mutate(f);
    assert.throws(() => f.ledger.recoverUndispatchedEffects());
    assert.equal(f.calls, 0);
  }
});

test('restart during real authority adoption preserves intent evidence but never bypasses the dispatch fence', async t => {
  const f = fixture(t); f.create(); f.bind();
  const original = f.store.list('resource.host-effect-accounting');
  f.reopen(); f.ledger.recoverUndispatchedEffects();
  const replacement = { ...authority, generation: 'new-host', epoch: 2 }; f.setAuthority(replacement);
  f.effects.adoptUndispatched('conversation', replacement, [id]);
  // Crash before the host's next notification loop can append its new binding.
  f.reopen(); f.ledger.recoverUndispatchedEffects();
  assert.deepEqual(f.store.list('resource.host-effect-accounting'), original);
  await assert.rejects(f.effects.dispatch(id, authority), /stale or foreign/);
  assert.equal(f.calls, 0);
  f.bind();
  assert.equal(f.store.list('resource.host-effect-accounting').length, 2);
  assert.deepEqual(f.store.get('resource.host-effect-accounting', original[0]!.key), { revision: original[0]!.revision, value: original[0]!.value });
  f.effects.adoptUndispatched('conversation', replacement, [id]); f.bind();
  assert.equal(f.store.list('resource.host-effect-accounting').length, 2);
  const request = f.ledger.request(id)!;
  const sent = await f.effects.dispatch(id, replacement, undefined, () => f.ledger.dispatched({ ...request, status: 'dispatched' }));
  f.ledger.settle({ ...request, status: 'succeeded' });
  assert.equal(sent.status, 'succeeded'); assert.equal(f.calls, 1);
  assert.equal(f.ledger.snapshot('conversation').cancelled, true);
  assert.equal(f.ledger.request(id)?.runId, 'root');
});

test('creation transaction rollback cannot leave accounting evidence behind', t => {
  const f = fixture(t);
  assert.throws(() => f.store.transaction(() => { f.create(); f.bind(); throw new Error('crash before commit'); }), /crash before commit/);
  assert.equal(f.store.get('effects', id), undefined); assert.equal(f.ledger.request(id), undefined);
  assert.equal(f.store.list('resource.host-effect-accounting').length, 0);
  assert.equal(f.store.events().filter(event => event.type === 'host-effect-accounting-bound').length, 0);
});
