import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { identity, type Effect, type PhysicalRequest, type ResourceEnvelope } from '../packages/contracts/index.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { ResourceLedger } from '../packages/runtime/resources/index.ts';
import { QualificationStore } from '../evaluations/qualification/store.ts';
import type { DevelopmentRegistration, DevelopmentRoleBinding } from '../evaluations/development/review-envelope.ts';
import { DevelopmentAccounting, type DevelopmentAccountingOptions } from './development-accounting.ts';

const epoch = Date.parse('2026-10-12T00:00:00Z');
const root = 'review-original';
const limits: ResourceEnvelope = { maxRequests: 12, maxTokens: 100_000, maxCostUsd: 10, maxElapsedMs: 1000, maxConcurrency: 4 };
const profile = { provider: 'mistral' as const, id: 'review-model', contextWindow: 10_000, reasoning: false, effort: 'none' as const, maxOutputTokens: 10, maxRequestsPerSlice: 10, timeoutMs: 10, pricesPerMillion: { input: 1, output: 1 } };
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'accounting-independent-'));
  const originalStore = new OperationalStore({ filename: join(dir, 'original.sqlite') });
  mkdirSync(join(dir, 'raw'), { mode: 0o700 }); const raw = new QualificationStore(join(dir, 'raw'), 1_000_000);
  let now = epoch;
  const original = new ResourceLedger(originalStore, { tokens: 10, costUsd: 0.01, elapsedMs: 1 }, () => now);
  original.allocate(root, limits);
  const roles: DevelopmentRoleBinding[] = ['candidate', 'control', 'other'].map((id, i) => ({ id, kind: i === 0 ? 'candidate' : 'control', assignmentId: i ? id : null, allocationId: `role:${id}`, resources: limits, configurationDigest: identity(['configuration', id]), closureDigest: identity(['closure', id]), profile, allowedEffects: ['read'] }));
  roles.forEach(r => original.allocate(r.allocationId, limits, root));
  const registration: DevelopmentRegistration = { version: 2, attemptDigest: identity('attempt'), rootId: root, rootCancelled: false, registeredAt: new Date(epoch).toISOString(), reviewDeadlineAt: new Date(epoch + 1000).toISOString(), observerClosureDigest: identity('observer'), closureVerifierDigest: identity('verifier'), assignmentDigest: identity('assignments'), roles, originalRequests: [] };
  const locals: OperationalStore[] = [];
  function options(roleId = 'control', shared = false): DevelopmentAccountingOptions {
    const role = roles.find(r => r.id === roleId)!;
    const localStore = shared ? originalStore : new OperationalStore({ filename: join(dir, `local-${locals.length}.sqlite`) });
    if (!shared) locals.push(localStore);
    return { localStore, localRootId: root, original, localDefaultCeiling: original.defaultCeiling, registration, acceptedRegistrationDigest: identity(registration), roleId, acceptedRoleDigest: identity(role), originalGrant: { resources: limits, issuedAt: new Date(epoch).toISOString(), expiresAt: new Date(epoch + 1000).toISOString() }, behaviorWindow: { notBefore: new Date(epoch).toISOString(), deadlineAt: new Date(epoch + 900).toISOString() }, actualConfigurationDigest: role.configurationDigest, actualClosureDigest: role.closureDigest, actualProfile: profile, rawStore: raw, transport: { id: 'review-host', key: Buffer.alloc(32, 9) }, reserveEvidence() {}, maxResponseBytes: 4096 };
  }
  function adapter(roleId = 'control', shared = false) {
    const o = options(roleId, shared), a = new DevelopmentAccounting(o);
    a.resources.allocate(root, limits); a.resources.allocate('parent', { ...limits, maxElapsedMs: 100 }, root); a.resources.allocate('child', { ...limits, maxElapsedMs: 50 }, 'parent');
    return { a, o };
  }
  t.after(() => { locals.forEach(s => s.close()); originalStore.close(); raw.close(); rmSync(dir, { recursive: true, force: true }); });
  return { original, originalStore, raw, options, adapter, registration, now: (n: number) => { now = epoch + n; } };
}
function model(a: DevelopmentAccounting, id = 'model'): PhysicalRequest {
  const payload = JSON.stringify({ model: profile.id, messages: [{ role: 'user', content: id }] });
  a.capturePrompt({ id: `prompt:${id}`, requestDigest: digest(payload), fragments: [] }, payload);
  const tokens = Buffer.byteLength(payload) + 1024;
  return { id, runId: 'child', purpose: 'compaction', provider: 'mistral', model: profile.id, promptManifestId: `prompt:${id}`, requestDigest: digest(payload), reservationId: id, status: 'reserved', usage: { requests: 1, inputTokens: tokens, outputTokens: 10, costUsd: (tokens + 10) / 1_000_000, elapsedMs: 10 } };
}
function effect(a: DevelopmentAccounting, id = 'effect'): { q: PhysicalRequest; e: Effect } {
  const call = { id, runId: 'child', stepId: 'step', name: 'read', arguments: { path: 'fixture' } };
  a.captureTool(call);
  const q: PhysicalRequest = { id: `tool:${id}`, runId: 'child', purpose: 'reasoning', provider: 'effect-receiver', model: 'read', promptManifestId: `tool:${id}`, requestDigest: identity(call), reservationId: `tool:${id}`, status: 'reserved', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 1 } };
  return { q, e: { id: q.id, runId: q.runId, stepId: 'step', kind: 'read', payload: call.arguments, scope: { kind: 'public' }, authority: { generation: 'review', epoch: 1, controlRevision: 'review' }, status: 'dispatched', revision: 1, reservationId: q.id } };
}
function dispatch(a: DevelopmentAccounting, q: PhysicalRequest): void { a.resources.reserve(q); a.resources.dispatched({ ...q, status: 'dispatched' }); }

for (const boundary of ['cancel-child', 'cancel-parent', 'expire-child', 'expire-parent'] as const) {
  test(`immediate model entry refuses ${boundary} after durable dispatch`, t => {
    const f = fixture(t), { a } = f.adapter(), q = model(a); dispatch(a, q);
    if (boundary.startsWith('cancel')) a.resources.cancel(boundary === 'cancel-child' ? 'child' : 'parent');
    else f.now(boundary === 'expire-child' ? 51 : 101);
    assert.throws(() => a.assertEntry(q.id), /cancel|expir|elapsed/i);
    assert.equal(a.originalRequest(q.id)!.status, 'dispatched');
  });
}
test('actual wrapped effect receiver is never entered after nested cancellation', async t => {
  const f = fixture(t), { a } = f.adapter(), { q, e } = effect(a); dispatch(a, q);
  a.resources.cancel('parent'); let entries = 0;
  const receiver = a.wrapReceiver({ dispatch: async () => { entries++; return { outcome: 'succeeded' }; }, reconcile: async () => { throw Error('unused'); } });
  await assert.rejects(receiver.dispatch(e, new AbortController().signal), /cancel/i);
  assert.equal(entries, 0);
});
test('authentic late model response settles after nested cancellation and original expiry', t => {
  const f = fixture(t), { a } = f.adapter(), q = model(a); dispatch(a, q); a.resources.cancel('parent'); f.now(1001);
  const body = '{"retained":"late"}', usage = { requests: 1, inputTokens: 2, outputTokens: 1, costUsd: 0.000003, elapsedMs: 10 };
  a.recordResponse(q.id, { status: 200, body });
  a.recordTransport({ requestId: q.id, dispatched: true, status: 'succeeded', httpStatus: 200, responseModel: profile.id, responseDigest: digest(body), usage });
  a.resources.settle({ ...q, status: 'succeeded', usage: { ...usage, inputTokens: 0 } });
  assert.deepEqual(a.originalRequest(q.id)!.usage, usage); assert.equal(a.originalRequest(q.id)!.status, 'succeeded');
});
test('original reserve and transition roll back together before local reservation', t => {
  const f = fixture(t), { a, o } = f.adapter(), q = model(a);
  t.mock.method(f.originalStore, 'append', () => { throw Error('transition persistence failed'); });
  assert.throws(() => a.resources.reserve(q), /transition persistence failed/);
  assert.equal(f.original.request(a.requestId(q.id)), undefined); assert.equal(o.localStore.get('requests', q.id), undefined);
});
test('local rollback consumes original physical identity and blocks fresh continuation after replacement', t => {
  const f = fixture(t), { a, o } = f.adapter(), q = model(a), put = o.localStore.put.bind(o.localStore);
  t.mock.method(o.localStore, 'put', (namespace: string, ...args: Parameters<typeof put> extends [string, ...infer R] ? R : never) => { if (namespace === 'requests') throw Error('local commit failed'); return put(namespace, ...args); });
  assert.throws(() => a.resources.reserve(q), /local commit failed/); assert.equal(a.originalRequest(q.id)!.status, 'reserved');
  const replacement = f.adapter(); assert.throws(() => replacement.a.resources.reserve(model(replacement.a, 'replacement')), /Orphan/);
  assert.equal(f.original.snapshot(root).requests, 1);
});
test('scoped recovery holds charges and leaves another role dispatched', t => {
  const f = fixture(t), x = f.adapter(), y = f.adapter('other'), a = model(x.a, 'same'), b = model(y.a, 'same');
  dispatch(x.a, a); dispatch(y.a, b); const before = f.original.snapshot(root);
  x.a.resources.recoverDispatched();
  assert.equal(x.a.originalRequest(a.id)!.status, 'uncertain'); assert.equal(y.a.originalRequest(b.id)!.status, 'dispatched');
  assert.equal(f.original.snapshot(root).tokens, before.tokens); assert.equal(f.original.snapshot(root).costUsd, before.costUsd);
});
test('candidate shared-store request has one physical row and the full role lineage', t => {
  const f = fixture(t), { a } = f.adapter('candidate', true), q = model(a); dispatch(a, q);
  assert.equal(f.original.snapshot(root).requests, 1); assert.equal(a.requestId(q.id), q.id);
  assert.deepEqual(a.states()[0]!.allocationPath, [root, 'role:candidate', 'parent', 'child']);
});
test('known transport usage without retained raw response cannot release original charge', t => {
  const f = fixture(t), { a } = f.adapter(), q = model(a); dispatch(a, q); const tokens = f.original.snapshot(root).tokens;
  assert.throws(() => a.recordTransport({ requestId: q.id, dispatched: true, status: 'succeeded', httpStatus: 200, responseModel: profile.id, responseDigest: digest('missing'), usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } }), /Raw response unavailable/);
  a.resources.settle({ ...q, status: 'succeeded' }); assert.equal(a.originalRequest(q.id)!.status, 'uncertain'); assert.equal(f.original.snapshot(root).tokens, tokens);
});
