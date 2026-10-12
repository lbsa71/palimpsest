import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';
import { createHash } from 'node:crypto';
import { canonicalJson, identity, type ArtifactRef, type PhysicalRequest, type PromptManifest, type ResourceEnvelope, type ShellPort, type ToolCall } from '../packages/contracts/index.ts';
import { ResourceLedger, DurableRuntime } from '../packages/runtime/index.ts';
import { EffectJournal } from '../packages/effects/index.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { QualificationStore } from '../evaluations/qualification/store.ts';
import { authenticate } from '../evaluations/qualification/manifest.ts';
import { reviewEnvelopeDomains, type DevelopmentRegistration, type DevelopmentRoleBinding } from '../evaluations/development/review-envelope.ts';
import { DevelopmentAccounting, type DevelopmentAccountingOptions } from './development-accounting.ts';
import type { ModelProfile } from './model-grants.ts';
import { AutarkApplication } from './application.ts';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import type { ApplicationConfig } from './config.ts';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const issued = Date.parse('2026-10-11T00:00:00.000Z');
const rootId = 'operating-envelope:v1';
const envelope: ResourceEnvelope = { maxRequests: 20, maxTokens: 100_000, maxCostUsd: 20, maxElapsedMs: 100_000, maxConcurrency: 4 };
const profile: ModelProfile = { provider: 'mistral', id: 'mistral-fixture-v1', contextWindow: 10000, reasoning: false, effort: 'none', maxOutputTokens: 20, maxRequestsPerSlice: 10, timeoutMs: 10, pricesPerMillion: { input: 1, output: 2 } };
const key = Buffer.alloc(32, 7);
const authority = { generation: 'fixture', epoch: 1, controlRevision: 'fixture-control' };
const fence = { assert() {} };
function fixture(t: TestContext, limits: Partial<ResourceEnvelope> = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'development-accounting-'));
  const originalStore = new OperationalStore({ filename: join(directory, 'original.sqlite') });
  const rawDirectory = join(directory, 'raw'); mkdirSync(rawDirectory, { mode: 0o700 }); const raw = new QualificationStore(rawDirectory, 2_000_000);
  let now = issued; const resources = { ...envelope, ...limits };
  const original = new ResourceLedger(originalStore, { tokens: 100, costUsd: 0.1, elapsedMs: 10 }, () => now);
  original.allocate(rootId, resources);
  const roles: DevelopmentRoleBinding[] = ['candidate', 'control-a', 'control-b', 'reviewer'].map((id, i) => ({ id, kind: i === 0 ? 'candidate' : i === 3 ? 'reviewer' : 'control', assignmentId: i === 0 ? null : id, allocationId: `role:${id}`, configurationDigest: identity(`config:${id}`), closureDigest: identity(`closure:${id}`), profile, allowedEffects: ['fixture_read'], resources }));
  for (const role of roles) original.allocate(role.allocationId, resources, rootId);
  const registration: DevelopmentRegistration & { rootCancelled: boolean } = { version: 2, attemptDigest: identity('attempt'), rootId, rootCancelled: false, registeredAt: new Date(now).toISOString(), reviewDeadlineAt: new Date(issued + resources.maxElapsedMs).toISOString(), observerClosureDigest: identity('observer'), closureVerifierDigest: identity('verifier'), assignmentDigest: identity('assignment'), roles, originalRequests: [] };
  const stores: OperationalStore[] = []; let capacityCalls = 0;
  const options = (roleId = 'control-a', localStore?: OperationalStore): DevelopmentAccountingOptions => {
    const store = localStore ?? new OperationalStore({ filename: join(directory, `${roleId}-${stores.length}.sqlite`) }); if (store !== originalStore) stores.push(store);
    const role = roles.find(r => r.id === roleId)!;
    return { localStore: store, original, localDefaultCeiling: { tokens: 100, costUsd: 0.1, elapsedMs: 10 }, registration, acceptedRegistrationDigest: identity(registration), roleId, acceptedRoleDigest: identity(role), originalGrant: { resources, issuedAt: new Date(issued).toISOString(), expiresAt: new Date(issued + resources.maxElapsedMs).toISOString() }, behaviorWindow: { notBefore: new Date(issued).toISOString(), deadlineAt: new Date(issued + resources.maxElapsedMs - 1).toISOString() }, actualConfigurationDigest: role.configurationDigest, actualClosureDigest: role.closureDigest, actualProfile: role.profile, rawStore: raw, transport: { id: 'host-transport', key }, reserveEvidence: () => { capacityCalls++; }, maxResponseBytes: 10000 };
  };
  const adapter = (roleId = 'control-a') => { const o = options(roleId), a = new DevelopmentAccounting(o); a.resources.allocate(rootId, resources); a.resources.allocate('run', resources, rootId); return { a, store: o.localStore, o }; };
  t.after(() => { for (const store of new Set(stores)) { try { store.close(); } catch {} } originalStore.close(); raw.close(); rmSync(directory, { recursive: true, force: true }); });
  return { directory, original, originalStore, raw, roles, registration, resources, options, adapter, time: (value: number) => { now = value; }, get capacityCalls() { return capacityCalls; } };
}
function model(a: DevelopmentAccounting, store: OperationalStore, id = 'physical', purpose: PhysicalRequest['purpose'] = 'reasoning', parentRequestId?: string) {
  const payload = canonicalJson({ model: profile.id, synthetic: id }), fragment = store.putArtifact('Owned fixture prompt');
  const manifest: PromptManifest = { id: `prompt:${id}`, requestDigest: hash(payload), fragments: [{ id: 'owned', owner: 'application', role: 'system', order: 0, artifact: fragment, scope: { kind: 'public' }, replaceable: true, derivedFrom: [] }] };
  a.capturePrompt(manifest, payload);
  const inputTokens = Buffer.byteLength(payload) + 1024;
  const request: PhysicalRequest = { id, runId: 'run', purpose, provider: 'mistral', model: profile.id, promptManifestId: manifest.id, requestDigest: hash(payload), reservationId: id, ...(parentRequestId ? { parentRequestId } : {}), status: 'reserved', usage: { requests: 1, inputTokens, outputTokens: profile.maxOutputTokens, costUsd: (inputTokens + profile.maxOutputTokens * 2) / 1_000_000, elapsedMs: profile.timeoutMs } };
  return request;
}
function success(a: DevelopmentAccounting, q: PhysicalRequest, body = '{"synthetic":"trusted response"}', usage = { requests: 1, inputTokens: 2, outputTokens: 1, costUsd: 0.000004, elapsedMs: 1 }) {
  a.recordResponse(q.id, { status: 200, body });
  a.recordTransport({ requestId: q.id, dispatched: true, status: 'succeeded', httpStatus: 200, usage, responseModel: profile.id, responseDigest: hash(body) });
  a.resources.settle({ ...q, status: 'succeeded', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } });
}
function effect(a: DevelopmentAccounting, id = 'effect') {
  const call: ToolCall = { id, runId: 'run', stepId: 'step', name: 'fixture_read', arguments: { file: 'fixture' } };
  a.captureTool(call);
  const q: PhysicalRequest = { id: `tool:${id}`, runId: 'run', purpose: 'reasoning', provider: 'effect-receiver', model: call.name, promptManifestId: `tool:${id}`, requestDigest: identity(call), reservationId: `tool:${id}`, status: 'reserved', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } };
  return q;
}

test('reserved responses retain mapped identities out of order after draft exhaustion and cancellation', t => {
  const f = fixture(t), o = f.options(), reserved = new Set<string>(), replies: string[] = []; let draftsExhausted = false;
  o.rawStore = { putBytes: bytes => { if (draftsExhausted) throw new Error('Draft allowance exhausted'); return f.raw.putBytes(bytes); }, readArtifact: (ref, bound) => f.raw.readArtifact(ref, bound) };
  o.reserveEvidence = request => { reserved.add(request.request.id); };
  o.retainResponse = (id, bytes) => { assert.ok(reserved.has(id)); replies.push(id); return f.raw.putBytes(bytes); };
  const a = new DevelopmentAccounting(o); a.resources.allocate(rootId, f.resources); a.resources.allocate('run', f.resources, rootId);
  const first = model(a, o.localStore, 'first'), second = model(a, o.localStore, 'second');
  for (const q of [first, second]) { a.resources.reserve(q); a.resources.dispatched({ ...q, status: 'dispatched' }); }
  draftsExhausted = true; assert.throws(() => model(a, o.localStore, 'rejected-draft'), /Draft allowance/);
  f.original.cancel(rootId); f.time(issued + f.resources.maxElapsedMs + 1);
  success(a, second, 'second actual reply'); success(a, first, 'first actual reply');
  assert.deepEqual(replies, [a.requestId(second.id), a.requestId(first.id)]);
  assert.equal(a.accounting('grant').usage.requests, 2); assert.equal(a.accounting('grant').chargedTokens, 6); assert.equal(a.rootCancelled, true);
});

test('effect and physical reconciliation replies consume their distinct reserved response identities', async t => {
  const f = fixture(t), o = f.options(), replies: string[] = [], reserved = new Set<string>();
  o.reserveEvidence = value => { reserved.add(value.request.id); };
  o.retainResponse = (id, bytes) => { assert.ok(reserved.has(id)); replies.push(id); return f.raw.putBytes(bytes); };
  const a = new DevelopmentAccounting(o); a.resources.allocate(rootId, f.resources); a.resources.allocate('run', f.resources, rootId);
  const q = effect(a); a.resources.reserve(q); a.resources.dispatched({ ...q, status: 'dispatched' });
  const receiver = a.wrapReceiver({ dispatch: async () => ({ outcome: 'uncertain', receipt: o.localStore.putArtifact('unknown') }), reconcile: async () => ({ outcome: 'succeeded', receipt: o.localStore.putArtifact('authoritative result') }) });
  const e = { id: q.id, runId: 'run', stepId: 'step', kind: 'fixture_read', payload: { file: 'fixture' }, scope: { kind: 'public' as const }, authority, status: 'dispatched' as const, revision: 2, reservationId: q.id };
  await receiver.dispatch(e); a.resources.settle({ ...q, status: 'uncertain' }); await receiver.reconcile({ ...e, status: 'uncertain' });
  const reconciliation = a.states().find(s => s.request.id !== a.requestId(q.id))!;
  assert.deepEqual(replies, [a.requestId(q.id), reconciliation.request.id]); assert.equal(reconciliation.request.parentRequestId, replies[0]);
  assert.equal(a.originalRequest(q.id)!.status, 'succeeded'); assert.equal(f.original.snapshot(rootId).requests, 2);
});

for (const kind of ['model', 'effect'] as const) for (const failure of ['throws', 'substitutes'] as const) test(`${kind} response retention ${failure} preserves original uncertain charges`, async t => {
  const f = fixture(t), o = f.options();
  o.retainResponse = () => { if (failure === 'throws') throw new Error('Response reservation unavailable'); return f.raw.putBytes(Buffer.from('substituted bytes')); };
  const a = new DevelopmentAccounting(o); a.resources.allocate(rootId, f.resources); a.resources.allocate('run', f.resources, rootId);
  const q = kind === 'model' ? model(a, o.localStore) : effect(a); a.resources.reserve(q); a.resources.dispatched({ ...q, status: 'dispatched' });
  const before = a.states()[0]!.ceiling;
  if (kind === 'model') assert.throws(() => a.recordResponse(q.id, { status: 200, body: 'actual response' }), /Response reservation|substituted/);
  else {
    const receiver = a.wrapReceiver({ dispatch: async () => ({ outcome: 'succeeded', receipt: o.localStore.putArtifact('actual response') }), reconcile: async () => { throw new Error('Unused'); } });
    await assert.rejects(receiver.dispatch({ id: q.id, runId: 'run', stepId: 'step', kind: 'fixture_read', payload: {}, scope: { kind: 'public' }, authority, status: 'dispatched', revision: 2, reservationId: q.id }), /Response reservation|substituted/);
  }
  a.resources.settle({ ...q, status: 'succeeded', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } });
  assert.equal(a.originalRequest(q.id)!.status, 'uncertain'); assert.equal(a.originalRequest(q.id)!.usage.inputTokens, kind === 'model' ? null : 0); assert.deepEqual(a.states()[0]!.charged, before);
});

test('two isolated states consume one final original request and retain role lineage', t => {
  const f = fixture(t, { maxRequests: 1 }), x = f.adapter(), y = f.adapter('control-b');
  const q = model(x.a, x.store); x.a.resources.reserve(q);
  assert.equal(f.original.snapshot(rootId).requests, 1); assert.equal(x.a.resources.snapshot(rootId).requests, 1); assert.equal(y.a.resources.snapshot(rootId).requests, 0);
  assert.throws(() => y.a.resources.reserve(model(y.a, y.store)), /budget exhausted/);
  assert.deepEqual(x.a.states()[0]!.allocationPath, [rootId, 'role:control-a', x.a.runId('run')]);
  assert.notEqual(x.a.requestId(q.id), y.a.requestId(q.id)); assert.equal(f.capacityCalls, 2);
});
test('actual original concurrency wins over isolated local availability', t => {
  const f = fixture(t, { maxConcurrency: 1 }), x = f.adapter(), y = f.adapter('control-b');
  x.a.resources.reserve(model(x.a, x.store)); assert.throws(() => y.a.resources.reserve(model(y.a, y.store)), /budget exhausted/);
});
test('candidate shares original store without double charging and competes with controls', t => {
  const f = fixture(t, { maxRequests: 1 }), o = f.options('candidate', f.originalStore), a = new DevelopmentAccounting(o);
  a.resources.allocate('candidate-run', f.resources, rootId);
  const q = { ...model(a, f.originalStore), runId: 'candidate-run' }; a.resources.reserve(q);
  assert.equal(f.original.snapshot(rootId).requests, 1); assert.equal(a.originalRequest(q.id)!.id, q.id);
  const control = f.adapter(); assert.throws(() => control.a.resources.reserve(model(control.a, control.store)), /budget exhausted/);
});
test('reviewer phase cannot reset original grant and behavior stops at durable freeze', t => {
  const f = fixture(t), x = f.adapter(), reviewer = f.adapter('reviewer');
  const q = model(reviewer.a, reviewer.store, 'review', 'review'); assert.throws(() => reviewer.a.resources.reserve(q), /requires frozen/);
  x.a.freezeBehavior(); reviewer.a.resources.reserve(q);
  assert.throws(() => x.a.resources.reserve(model(x.a, x.store, 'late')), /outside its original window/);
  assert.throws(() => reviewer.a.freezeBehavior(), /already frozen/);
});
test('mapped nested allocation and parent physical IDs preserve exact local references', t => {
  const f = fixture(t), x = f.adapter(); x.a.resources.allocate('child', { ...f.resources, maxRequests: 2 }, 'run');
  const parent = model(x.a, x.store, 'parent'); x.a.resources.reserve(parent); x.a.resources.dispatched({ ...parent, status: 'dispatched' }); success(x.a, parent);
  const child = { ...model(x.a, x.store, 'child-request', 'compaction', parent.id), runId: 'child' }; x.a.resources.reserve(child);
  const actual = x.a.originalRequest(child.id)!; assert.equal(actual.parentRequestId, x.a.requestId(parent.id)); assert.equal(actual.runId, x.a.runId('child'));
  assert.deepEqual(x.a.states().find(s => s.request.id === actual.id)!.allocationPath, [rootId, 'role:control-a', x.a.runId('run'), x.a.runId('child')]);
  assert.throws(() => x.a.resources.allocate('too-large', { ...f.resources, maxRequests: 3 }, 'child'), /sublimit exceeds/);
});
test('a real DurableRuntime enters its effect receiver only after original durable dispatch', async t => {
  const f = fixture(t), o = f.options(), a = new DevelopmentAccounting(o); a.resources.allocate(rootId, f.resources);
  let entries = 0, runId = '';
  const receiver = a.wrapReceiver({ dispatch: async e => {
    entries++; assert.equal(a.originalRequest(e.id)!.status, 'dispatched');
    const reopened = new OperationalStore({ filename: f.originalStore.filename });
    try { assert.equal(reopened.get<{ request: PhysicalRequest }>('requests', a.requestId(e.id))!.value.request.status, 'dispatched'); } finally { reopened.close(); }
    return { outcome: 'succeeded', receipt: o.localStore.putJsonArtifact({ synthetic: 'receiver result' }) };
  }, reconcile: async () => { throw new Error('Unexpected reconciliation'); } });
  const shell: ShellPort = { run: async (input, bridge) => {
    runId = input.run.id; const observed = await bridge.execute({ id: 'effect-entry', runId, stepId: 'step', name: 'fixture_read', arguments: { fixture: true } });
    return { status: 'completed', observations: [observed] };
  } };
  const runtime = new DurableRuntime({ store: o.localStore, resources: a.resources, effects: new EffectJournal(o.localStore, fence, receiver), shell: a.wrapShell(shell), now: f.original.now });
  const run = runtime.admit({ id: 'input', source: 'direct', externalId: 'input', externalRevision: '1', actorId: 'fixture', authenticated: true, scope: { kind: 'public' }, value: 'Use the fixture effect' }, authority, f.resources, rootId);
  const result = await runtime.resume(run.id, { id: 'base', requestDigest: identity('base'), fragments: [] });
  assert.equal(result.status, 'completed'); assert.equal(entries, 1); assert.equal(a.originalRequest('tool:effect-entry')!.status, 'succeeded');
  const transitions = a.transitions(); assert.deepEqual(transitions.map(s => s.state.request.status), ['reserved', 'dispatched', 'succeeded']);
  const settlement = authenticate(reviewEnvelopeDomains.settlement, transitions[2]!.settlement!, new Map([['host-transport', key]])); assert.equal(settlement.response!.sha256, hash(canonicalJson({ synthetic: 'receiver result' })));
});
test('actual runtime model bridge captures prompts and refuses worker claimed free usage', async t => {
  const f = fixture(t), o = f.options(), a = new DevelopmentAccounting(o); a.resources.allocate(rootId, f.resources);
  let entered = false;
  const shell: ShellPort = { run: async (input, bridge) => {
    const payload = canonicalJson({ model: profile.id, synthetic: 'runtime model' }), tokens = Buffer.byteLength(payload) + 1024;
    const manifest: PromptManifest = { id: 'runtime-prompt', requestDigest: hash(payload), fragments: [] };
    await bridge.capturePrompt(manifest, payload);
    const q: PhysicalRequest = { id: 'runtime-model', runId: input.run.id, provider: 'mistral', model: profile.id, purpose: 'compaction', promptManifestId: manifest.id, requestDigest: hash(payload), reservationId: 'runtime-model', status: 'reserved', usage: { requests: 1, inputTokens: tokens, outputTokens: 20, costUsd: (tokens + 40) / 1_000_000, elapsedMs: 10 } };
    await bridge.reserve(q); await bridge.dispatched({ ...q, status: 'dispatched' }); a.assertEntry(q.id); entered = true;
    await bridge.settle({ ...q, status: 'succeeded', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } });
    return { status: 'completed', observations: [] };
  } };
  const runtime = new DurableRuntime({ store: o.localStore, resources: a.resources, effects: new EffectJournal(o.localStore, fence, a.wrapReceiver({ dispatch: async () => { throw new Error('No effect'); }, reconcile: async () => { throw new Error('No effect'); } })), shell: a.wrapShell(shell), now: f.original.now });
  const run = runtime.admit({ id: 'model', source: 'direct', externalId: 'model', externalRevision: '1', actorId: 'fixture', authenticated: true, scope: { kind: 'public' }, value: 'Think' }, authority, f.resources, rootId);
  await runtime.resume(run.id, { id: 'base', requestDigest: identity('base'), fragments: [] });
  assert.equal(entered, true); assert.equal(a.originalRequest('runtime-model')!.status, 'uncertain');
  assert.equal(f.original.snapshot(rootId).tokens, a.states()[0]!.ceiling.tokens); assert.equal(a.originalRequest('runtime-model')!.usage.inputTokens, null);
});
test('capacity refusal occurs before original reservation and receiver entry', t => {
  const f = fixture(t), o = f.options(); o.reserveEvidence = () => { throw new Error('Evidence exhausted'); };
  const a = new DevelopmentAccounting(o); a.resources.allocate(rootId, f.resources); a.resources.allocate('run', f.resources, rootId);
  assert.throws(() => a.resources.reserve(model(a, o.localStore)), /Evidence exhausted/); assert.equal(f.original.snapshot(rootId).requests, 0);
});
test('wrong configuration/profile/closure or allocation cannot bind', t => {
  const f = fixture(t);
  for (const changed of [{ actualConfigurationDigest: identity('wrong') }, { actualClosureDigest: identity('wrong') }, { actualProfile: { ...profile, id: 'different' } }, { acceptedRoleDigest: identity('wrong') }, { acceptedRegistrationDigest: identity('wrong') }]) assert.throws(() => new DevelopmentAccounting({ ...f.options(), ...changed }), /differs|Unaccepted/);
  const x = f.adapter(); assert.throws(() => x.a.resources.reserve({ ...model(x.a, x.store), model: 'different' }), /Unregistered model/);
  assert.throws(() => x.a.resources.allocate('foreign-child', f.resources, 'role:control-b'), /Foreign|Missing/);
});
test('local cancellation affects only its original role, while root cancellation blocks all roles', t => {
  const f = fixture(t), x = f.adapter(), y = f.adapter('control-b');
  x.a.resources.cancel(rootId); assert.equal(f.original.snapshot('role:control-a').cancelled, true); assert.equal(f.original.snapshot('role:control-b').cancelled, false);
  const q = model(y.a, y.store); y.a.resources.reserve(q); f.original.cancel(rootId);
  assert.throws(() => y.a.resources.dispatched({ ...q, status: 'dispatched' }), /cancelled or expired/); assert.equal(y.a.originalRequest(q.id)!.status, 'reserved');
});
test('original expiry between reserve and dispatch preserves its held reservation', t => {
  const f = fixture(t), x = f.adapter(), q = model(x.a, x.store); x.a.resources.reserve(q);
  f.time(issued + f.resources.maxElapsedMs); assert.throws(() => x.a.resources.dispatched({ ...q, status: 'dispatched' }), /expired/);
  assert.equal(x.a.originalRequest(q.id)!.status, 'reserved'); assert.equal(f.original.snapshot(rootId).requests, 1);
});
test('cancellation after dispatch but before transport entry refuses provider entry', t => {
  const f = fixture(t), x = f.adapter(), q = model(x.a, x.store); x.a.resources.reserve(q); x.a.resources.dispatched({ ...q, status: 'dispatched' }); f.original.cancel(rootId);
  assert.throws(() => x.a.assertEntry(q.id), /cancelled/); assert.equal(x.a.originalRequest(q.id)!.status, 'dispatched');
});
test('original reserve survives a local SQLite rollback and blocks replay or fresh continuation', t => {
  const f = fixture(t), x = f.adapter(), q = model(x.a, x.store);
  assert.throws(() => x.store.transaction(() => { x.a.resources.reserve(q); throw new Error('Crash before local commit'); }), /Crash/);
  assert.equal(x.store.get('requests', q.id), undefined); assert.equal(x.a.originalRequest(q.id)!.status, 'reserved');
  const restarted = new DevelopmentAccounting(x.o); assert.throws(() => restarted.resources.reserve(model(restarted, x.store)), /Orphan/);
  assert.throws(() => restarted.resources.reserve(model(restarted, x.store, 'new-id')), /Orphan/); assert.equal(f.original.snapshot(rootId).requests, 1);
});
test('original dispatch survives local effect-intent rollback without receiver entry or replay', t => {
  const f = fixture(t), x = f.adapter(), q = effect(x.a); x.a.resources.reserve(q);
  assert.throws(() => x.store.transaction(() => { x.a.resources.dispatched({ ...q, status: 'dispatched' }); throw new Error('Crash before local intent commit'); }), /Crash/);
  assert.equal(x.a.originalRequest(q.id)!.status, 'dispatched'); assert.equal(x.a.resources.request(q.id)!.status, 'reserved');
  const restart = new DevelopmentAccounting(x.o); restart.resources.recoverDispatched(); restart.resources.recoverUndispatchedEffects();
  assert.equal(restart.originalRequest(q.id)!.status, 'uncertain'); assert.throws(() => restart.resources.dispatched({ ...q, status: 'dispatched' }), /not reserved/);
});
test('original trusted settlement survives local rollback; no physical replay is possible', t => {
  const f = fixture(t), x = f.adapter(), q = model(x.a, x.store); x.a.resources.reserve(q); x.a.resources.dispatched({ ...q, status: 'dispatched' });
  assert.throws(() => x.store.transaction(() => { success(x.a, q); throw new Error('Crash before local settlement commit'); }), /Crash/);
  assert.equal(x.a.originalRequest(q.id)!.status, 'succeeded'); assert.equal(x.a.resources.request(q.id)!.status, 'dispatched');
  const restart = new DevelopmentAccounting(x.o); restart.resources.recoverDispatched(); restart.resources.settle({ ...q, status: 'uncertain' });
  assert.equal(restart.resources.request(q.id)!.status, 'succeeded'); assert.throws(() => restart.resources.reserve(model(restart, x.store)), /already consumed/);
});
test('recovering one control preserves another control active dispatch and held null usage', t => {
  const f = fixture(t), x = f.adapter(), y = f.adapter('control-b'); const q = model(x.a, x.store), other = model(y.a, y.store);
  x.a.resources.reserve(q); y.a.resources.reserve(other); x.a.resources.dispatched({ ...q, status: 'dispatched' }); y.a.resources.dispatched({ ...other, status: 'dispatched' });
  const restart = new DevelopmentAccounting(x.o); restart.resources.recoverDispatched();
  assert.equal(restart.originalRequest(q.id)!.status, 'uncertain'); assert.equal(y.a.originalRequest(other.id)!.status, 'dispatched');
  assert.equal(restart.originalRequest(q.id)!.usage.inputTokens, null); assert.equal(restart.states().find(s => s.roleId === 'control-a')!.charged.tokens, restart.states().find(s => s.roleId === 'control-a')!.ceiling.tokens);
});
test('retained raw response and trusted usage survive cancellation and reconcile uncertainty', t => {
  const f = fixture(t), x = f.adapter(), q = model(x.a, x.store); x.a.resources.reserve(q); x.a.resources.dispatched({ ...q, status: 'dispatched' });
  const body = '{ "raw": "exact bytes" }'; x.a.recordResponse(q.id, { status: 200, body });
  x.a.recordTransport({ requestId: q.id, dispatched: true, status: 'succeeded', httpStatus: 200, usage: { requests: 1, inputTokens: 2, outputTokens: 1, costUsd: 0.000004, elapsedMs: 1 }, responseModel: profile.id, responseDigest: hash(body) });
  f.original.cancel(rootId); x.a.resources.recoverDispatched(); x.a.resources.settle({ ...q, status: 'failed', usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 500 } });
  assert.equal(x.a.originalRequest(q.id)!.status, 'succeeded'); assert.equal(x.a.originalRequest(q.id)!.usage.inputTokens, 2);
  const final = x.a.transitions().at(-1)!; assert.equal(final.settlement!.value.response!.sha256, hash(body)); assert.equal(f.raw.readArtifact(final.settlement!.value.response!, 100).toString(), body);
});
test('raw retention failure cannot expose known usage that releases the original charge', t => {
  const f = fixture(t), x = f.adapter(), q = model(x.a, x.store); x.a.resources.reserve(q); x.a.resources.dispatched({ ...q, status: 'dispatched' });
  assert.throws(() => x.a.recordTransport({ requestId: q.id, dispatched: true, status: 'succeeded', httpStatus: 200, usage: { requests: 1, inputTokens: 1, outputTokens: 1, costUsd: 0, elapsedMs: 0 }, responseModel: profile.id, responseDigest: hash('missing') }), /Raw response unavailable/);
  x.a.resources.settle({ ...q, status: 'succeeded', usage: { requests: 1, inputTokens: 1, outputTokens: 1, costUsd: 0, elapsedMs: 0 } });
  assert.equal(x.a.originalRequest(q.id)!.status, 'uncertain'); assert.equal(f.original.snapshot(rootId).tokens, x.a.states()[0]!.ceiling.tokens);
});
test('known physical overrun cancels original root and refuses already reserved entry', t => {
  const f = fixture(t), x = f.adapter(), y = f.adapter('control-b'), q = model(x.a, x.store), other = model(y.a, y.store);
  x.a.resources.reserve(q); y.a.resources.reserve(other); x.a.resources.dispatched({ ...q, status: 'dispatched' });
  success(x.a, q, '{}', { requests: 1, inputTokens: 2000, outputTokens: 1, costUsd: 0.1, elapsedMs: 20 });
  assert.equal(f.original.snapshot(rootId).cancelled, true); assert.throws(() => y.a.resources.dispatched({ ...other, status: 'dispatched' }), /cancelled/);
});
test('actual original wall plus new physical ceiling prevents overspending elapsed allowance', t => {
  const f = fixture(t, { maxElapsedMs: 20 }), x = f.adapter(); f.time(issued + 11);
  assert.throws(() => x.a.resources.reserve(model(x.a, x.store)), /budget exhausted|allocation exhausted/); assert.equal(f.original.snapshot(rootId).requests, 0);
});
test('replacing local state cannot reclaim consumed identities or reset role clock', t => {
  const f = fixture(t), x = f.adapter(), q = model(x.a, x.store); x.a.resources.reserve(q); x.a.resources.dispatched({ ...q, status: 'dispatched' }); success(x.a, q);
  const replacement = f.adapter(); const before = f.originalStore.get('allocations', 'role:control-a');
  assert.throws(() => replacement.a.resources.reserve(model(replacement.a, replacement.store)), /already consumed/); assert.deepEqual(f.originalStore.get('allocations', 'role:control-a'), before);
  assert.equal(f.original.snapshot(rootId).requests, 1);
});
test('physical effect reconciliation is a separate original charged request', async t => {
  const f = fixture(t), x = f.adapter(), q = effect(x.a); x.a.resources.reserve(q); x.a.resources.dispatched({ ...q, status: 'dispatched' });
  const receiver = x.a.wrapReceiver({ dispatch: async () => ({ outcome: 'uncertain', receipt: x.store.putArtifact('unknown') }), reconcile: async () => ({ outcome: 'succeeded', receipt: x.store.putArtifact('authoritative result') }) });
  const e = { id: q.id, runId: 'run', stepId: 'step', kind: 'fixture_read', payload: { file: 'fixture' }, scope: { kind: 'public' as const }, authority, status: 'dispatched' as const, revision: 2, reservationId: q.id };
  await receiver.dispatch(e); x.a.resources.settle({ ...q, status: 'uncertain' });
  await receiver.reconcile({ ...e, status: 'uncertain' });
  assert.equal(f.original.snapshot(rootId).requests, 2); assert.equal(x.a.originalRequest(q.id)!.status, 'succeeded');
  assert.equal(x.a.states().find(s => s.request.id !== x.a.requestId(q.id))!.request.parentRequestId, x.a.requestId(q.id));
});

test('actual application construction installs the trusted ledger without process or network dispatch', async t => {
  const f = fixture(t), stateDirectory = join(f.directory, 'application-state'), workspaceDirectory = join(f.directory, 'workspace'); mkdirSync(stateDirectory); mkdirSync(workspaceDirectory);
  const promptFile = join(f.directory, 'mind.txt'), compactionPromptFile = join(f.directory, 'compact.txt'); writeFileSync(promptFile, 'Owned fixture mind'); writeFileSync(compactionPromptFile, 'Owned fixture compaction');
  const config: ApplicationConfig = { stateDirectory, workspaceDirectory, applicationRoot: dirname(dirname(fileURLToPath(import.meta.url))), nodeBinary: process.execPath, workerEntrypoint: 'deployment/shell-worker.ts', artifactId: 'fixture-application', controlRevision: 'fixture-control', promptFile, compactionPromptFile, model: profile, resources: f.resources, conversationResources: f.resources, bootstrapInitiative: false, scheduler: { windowMs: 1000, maxSlicesPerWindow: 2, maxLifetimeSlices: 4, quantumMs: 100, idleRetryMs: 10, maxStalls: 2, resources: f.resources }, maxConcurrentRuns: 2, pollMs: 100, commands: ['/runtime/node'], researchHosts: [], direct: { host: '127.0.0.1', port: 0, actorId: 'fixture', scope: { kind: 'public' }, modificationEligible: true } };
  config.developmentControl = { version: 1, kind: 'no-memory', assignmentId: 'control-a', workloadDigest: identity('public accounting-construction fixture') };
  const role = f.roles.find(r => r.id === 'control-a')!; role.configurationDigest = identity(config);
  const authorityStore = new AuthorityStore(join(stateDirectory, 'authority.sqlite')); const authority = authorityStore.bootstrap('fixture', config.controlRevision, config.artifactId);
  let adapter!: DevelopmentAccounting, calls = 0;
  const app = new AutarkApplication({ config, authority, authorityStore, secrets: { directToken: 'fixture', mistralApiKey: 'fixture' }, performRequest: async () => { calls++; throw new Error('No physical request authorized'); }, developmentAccounting: ({ store, config: actual }) => { assert.equal(identity(actual), identity(config)); const o = f.options('control-a', store); o.localDefaultCeiling.elapsedMs = profile.timeoutMs; adapter = new DevelopmentAccounting(o); return adapter; } });
  try { assert.equal(app.resources, adapter.resources); assert.equal(app.runtime.resources, adapter.resources); assert.equal(app.resources.snapshot(rootId).requests, 0); assert.equal(calls, 0); assert.equal(f.original.snapshot(rootId).requests, 0); assert.equal(f.originalStore.get<{ parentRunId: string }>('allocations', adapter.runId('initiative:ordinary'))!.value.parentRunId, role.allocationId); }
  finally { await app.close(); authorityStore.close(); }
});

test('late original response is retained after cancellation and expiry without a new entry', t => {
  const f = fixture(t), x = f.adapter(), q = model(x.a, x.store); x.a.resources.reserve(q); x.a.resources.dispatched({ ...q, status: 'dispatched' });
  f.original.cancel(rootId); f.time(issued + f.resources.maxElapsedMs + 1); success(x.a, q, 'late authoritative raw bytes');
  assert.equal(x.a.originalRequest(q.id)!.status, 'succeeded'); assert.equal(x.a.rootCancelled, true); assert.throws(() => x.a.assertEntry(q.id), /cancelled|expired|original window/);
  assert.equal(x.a.accounting('original-grant').usage.elapsedMs, f.resources.maxElapsedMs + 1);
});
test('raw response persists across a crash before authenticated transport settlement', t => {
  const f = fixture(t), x = f.adapter(), q = model(x.a, x.store), body = 'durable raw response'; x.a.resources.reserve(q); x.a.resources.dispatched({ ...q, status: 'dispatched' });
  x.a.recordResponse(q.id, { status: 200, body }); const restarted = new DevelopmentAccounting(x.o); restarted.resources.recoverDispatched();
  restarted.recordTransport({ requestId: q.id, dispatched: true, status: 'succeeded', httpStatus: 200, usage: { requests: 1, inputTokens: 2, outputTokens: 1, costUsd: 0.000004, elapsedMs: 1 }, responseModel: profile.id, responseDigest: hash(body) });
  restarted.resources.settle({ ...q, status: 'failed' }); assert.equal(restarted.originalRequest(q.id)!.status, 'succeeded');
});
test('original token and cost ceilings exhaust across independent local states', t => {
  for (const limit of ['maxTokens', 'maxCostUsd'] as const) {
    const tokens = Buffer.byteLength(canonicalJson({ model: profile.id, synthetic: 'physical' })) + 1024;
    const f = fixture(t, { [limit]: limit === 'maxTokens' ? tokens + profile.maxOutputTokens : (tokens + profile.maxOutputTokens * 2) / 1_000_000 }), x = f.adapter(), y = f.adapter('control-b'), q = model(x.a, x.store), other = model(y.a, y.store);
    x.a.resources.reserve(q); assert.throws(() => y.a.resources.reserve(other), /budget exhausted/);
  }
});
test('recorder capacity sees exact retained payload, manifest and prompt fragment bytes', t => {
  const f = fixture(t), o = f.options(); let seen: Parameters<DevelopmentAccountingOptions['reserveEvidence']>[0] | undefined;
  o.reserveEvidence = request => { seen = request; }; const a = new DevelopmentAccounting(o); a.resources.allocate(rootId, f.resources); a.resources.allocate('run', f.resources, rootId);
  const q = model(a, o.localStore); a.resources.reserve(q); assert.ok(seen); assert.equal(seen.payload.sha256, q.requestDigest); assert.equal(seen.fragments.length, 1);
  assert.equal(seen.payloadBytes, f.raw.readArtifact(seen.payload, 10000).byteLength);
  assert.equal(seen.promptBytes, f.raw.readArtifact(seen.prompt!, 10000).byteLength + seen.fragments[0]!.bytes); assert.equal(seen.maxTransitions, 5);
});
test('oversized physical effect receipt refuses bounded BLOB reading and retains original uncertainty', async t => {
  const f = fixture(t), o = f.options(); o.maxResponseBytes = 10; const a = new DevelopmentAccounting(o); a.resources.allocate(rootId, f.resources); a.resources.allocate('run', f.resources, rootId);
  const q = effect(a); a.resources.reserve(q); a.resources.dispatched({ ...q, status: 'dispatched' });
  const receiver = a.wrapReceiver({ dispatch: async () => ({ outcome: 'succeeded', receipt: o.localStore.putArtifact('x'.repeat(100)) }), reconcile: async () => { throw new Error('Unused'); } });
  await assert.rejects(() => receiver.dispatch({ id: q.id, runId: 'run', stepId: 'step', kind: 'fixture_read', payload: {}, scope: { kind: 'public' }, authority, status: 'dispatched', revision: 2, reservationId: q.id }), /exceeds read bound/);
  a.resources.settle({ ...q, status: 'succeeded' }); assert.equal(a.originalRequest(q.id)!.status, 'uncertain'); assert.equal(a.states()[0]!.charged.elapsedMs, a.states()[0]!.ceiling.elapsedMs);
});

test('one operational state cannot be rebound to another isolated role', t => {
  const f = fixture(t), x = f.adapter(); assert.throws(() => new DevelopmentAccounting(f.options('control-b', x.store)), /belongs to another development role/);
});
test('changed original envelope or clock refuses the next physical reservation', t => {
  const f = fixture(t), x = f.adapter(), q = model(x.a, x.store);
  const budget = f.originalStore.get<{ envelope: ResourceEnvelope }>('budgets', rootId)!;
  f.originalStore.put('budgets', rootId, { ...budget.value, envelope: { ...f.resources, maxRequests: f.resources.maxRequests + 1 } }, budget.revision);
  assert.throws(() => x.a.resources.reserve(q), /allowance or issued-at changed/); assert.equal(f.original.snapshot(rootId).requests, 0);
});

for (const boundary of ['prompt', 'tool', 'reserve', 'dispatch', 'entry'] as const) test(`current-use withdrawal refuses ${boundary} without new accounting or raw writes`, t => {
  const f = fixture(t), o = f.options(); let withdrawn = false;
  o.assertCurrentUse = () => { if (withdrawn) throw new Error('Attempt use withdrawn'); };
  const a = new DevelopmentAccounting(o); a.resources.allocate(rootId, f.resources); a.resources.allocate('run', f.resources, rootId);
  const q = boundary === 'prompt' || boundary === 'tool' ? null : model(a, o.localStore);
  if (q && (boundary === 'dispatch' || boundary === 'entry')) a.resources.reserve(q);
  if (q && boundary === 'entry') a.resources.dispatched({ ...q, status: 'dispatched' });
  const before = a.accounting('grant'), rawBytes = f.raw.usedBytes, transitions = a.transitions(); withdrawn = true;
  assert.throws(() => {
    if (boundary === 'prompt') model(a, o.localStore, 'refused');
    else if (boundary === 'tool') effect(a, 'refused');
    else if (boundary === 'reserve') a.resources.reserve(q!);
    else if (boundary === 'dispatch') a.resources.dispatched({ ...q!, status: 'dispatched' });
    else a.assertEntry(q!.id);
  }, /Attempt use withdrawn/);
  assert.deepEqual(a.accounting('grant'), before); assert.equal(f.raw.usedBytes, rawBytes); assert.deepEqual(a.transitions(), transitions);
});

test('current-use hook rejects asynchronous authorization before capture', t => {
  const f = fixture(t), o = f.options(); o.assertCurrentUse = async () => {};
  const a = new DevelopmentAccounting(o); a.resources.allocate(rootId, f.resources); a.resources.allocate('run', f.resources, rootId);
  const before = f.raw.usedBytes;
  assert.throws(() => model(a, o.localStore), /must be synchronous/);
  assert.equal(f.raw.usedBytes, before); assert.equal(f.original.snapshot(rootId).requests, 0);
});

test('withdrawn evidence prevents actual receiver entry after original dispatch', async t => {
  const f = fixture(t), o = f.options(); let withdrawn = false, entries = 0;
  o.assertCurrentUse = () => { if (withdrawn) throw new Error('Attempt use withdrawn'); };
  const a = new DevelopmentAccounting(o); a.resources.allocate(rootId, f.resources); a.resources.allocate('run', f.resources, rootId);
  const q = effect(a); a.resources.reserve(q); a.resources.dispatched({ ...q, status: 'dispatched' });
  const before = a.states()[0]!;
  const receiver = a.wrapReceiver({ dispatch: async () => { entries++; return { outcome: 'succeeded' }; }, reconcile: async () => { throw new Error('Unused'); } });
  withdrawn = true;
  await assert.rejects(receiver.dispatch({ id: q.id, runId: 'run', stepId: 'step', kind: 'fixture_read', payload: {}, scope: { kind: 'public' }, authority, status: 'dispatched', revision: 2, reservationId: q.id }), /Attempt use withdrawn/);
  assert.equal(entries, 0); assert.deepEqual(a.states()[0], before);
});

test('request-scoped response maintenance settles late reply while all evidence reads refuse', t => {
  const f = fixture(t), o = f.options(); let withdrawn = false, ordinaryReadsAfterWithdrawal = 0;
  const retained = new Map<string, ArtifactRef>(), reads: { requestId: string; artifact: ArtifactRef; bound: number }[] = [];
  o.assertCurrentUse = () => { if (withdrawn) throw new Error('Attempt use withdrawn'); };
  o.rawStore = { putBytes: bytes => { if (withdrawn) throw new Error('Ordinary evidence writes withdrawn'); return f.raw.putBytes(bytes); }, readArtifact: (ref, bound) => { if (withdrawn) { ordinaryReadsAfterWithdrawal++; throw new Error('Ordinary evidence reads withdrawn'); } return f.raw.readArtifact(ref, bound); } };
  o.retainResponse = (id, bytes) => { const ref = f.raw.putBytes(bytes); retained.set(id, ref); return ref; };
  o.readRetainedResponse = (id, ref, bound) => { assert.deepEqual(ref, retained.get(id)); reads.push({ requestId: id, artifact: ref, bound }); return f.raw.readArtifact(ref, bound); };
  const a = new DevelopmentAccounting(o); a.resources.allocate(rootId, f.resources); a.resources.allocate('run', f.resources, rootId);
  const q = model(a, o.localStore); a.resources.reserve(q); a.resources.dispatched({ ...q, status: 'dispatched' });
  withdrawn = true; f.original.cancel(rootId); f.time(issued + f.resources.maxElapsedMs + 1);
  success(a, q, 'Late authentic reply');
  assert.equal(ordinaryReadsAfterWithdrawal, 0); assert.equal(reads.length, 2);
  assert.ok(reads.every(read => read.requestId === a.requestId(q.id) && read.requestId !== q.id && read.bound === o.maxResponseBytes && read.artifact.sha256 === hash('Late authentic reply')));
  assert.equal(a.originalRequest(q.id)!.status, 'succeeded'); assert.equal(a.accounting('grant').chargedTokens, 3);
  assert.throws(() => model(a, o.localStore, 'another'), /Attempt use withdrawn/);
});

for (const bad of ['throws', 'substitutes', 'oversized'] as const) test(`response maintenance ${bad} cannot fall back or release original charge`, t => {
  const f = fixture(t), o = f.options(); let ordinaryReads = 0, maintenance = false;
  o.rawStore = { putBytes: bytes => f.raw.putBytes(bytes), readArtifact: (ref, bound) => { if (maintenance) ordinaryReads++; return f.raw.readArtifact(ref, bound); } };
  o.retainResponse = (_id, bytes) => f.raw.putBytes(bytes);
  o.readRetainedResponse = () => { if (bad === 'throws') throw new Error('Reserved response unavailable'); return Buffer.from(bad === 'oversized' ? 'x'.repeat(o.maxResponseBytes + 1) : 'substitute'); };
  const a = new DevelopmentAccounting(o); a.resources.allocate(rootId, f.resources); a.resources.allocate('run', f.resources, rootId);
  const q = model(a, o.localStore); a.resources.reserve(q); a.resources.dispatched({ ...q, status: 'dispatched' });
  const prior = a.states()[0]!; maintenance = true;
  assert.throws(() => a.recordResponse(q.id, { status: 200, body: 'actual reply' }), /Reserved response unavailable|Response retention/);
  assert.equal(ordinaryReads, 0); a.resources.settle({ ...q, status: 'uncertain' });
  const after = a.states()[0]!; assert.equal(after.request.status, 'uncertain'); assert.deepEqual(after.charged, prior.charged);
});

test('response hook cannot mutate its retained-reference alias during verification', t => {
  const f = fixture(t), o = f.options(); let returned: ArtifactRef | undefined;
  const substitute = f.raw.putBytes(Buffer.from('substitute'));
  o.retainResponse = (_id, bytes) => returned = f.raw.putBytes(bytes);
  o.readRetainedResponse = (_id, ref, bound) => { returned!.uri = substitute.uri; returned!.sha256 = substitute.sha256; ref.uri = substitute.uri; ref.sha256 = substitute.sha256; return f.raw.readArtifact(substitute, bound); };
  const a = new DevelopmentAccounting(o); a.resources.allocate(rootId, f.resources); a.resources.allocate('run', f.resources, rootId);
  const q = model(a, o.localStore); a.resources.reserve(q); a.resources.dispatched({ ...q, status: 'dispatched' });
  assert.throws(() => a.recordResponse(q.id, { status: 200, body: 'actual reply' }), /Response retention/);
  a.resources.settle({ ...q, status: 'uncertain' }); assert.equal(a.originalRequest(q.id)!.status, 'uncertain');
});

test('withdrawal refuses a new physical reconciliation before retaining its draft', async t => {
  const f = fixture(t), o = f.options(); let withdrawn = false, entries = 0;
  o.assertCurrentUse = () => { if (withdrawn) throw new Error('Attempt use withdrawn'); };
  const a = new DevelopmentAccounting(o); a.resources.allocate(rootId, f.resources); a.resources.allocate('run', f.resources, rootId);
  const q = effect(a); a.resources.reserve(q); a.resources.dispatched({ ...q, status: 'dispatched' }); a.resources.settle({ ...q, status: 'uncertain' });
  const before = a.accounting('grant'), bytes = f.raw.usedBytes;
  const receiver = a.wrapReceiver({ dispatch: async () => { throw new Error('Unused'); }, reconcile: async () => { entries++; return { outcome: 'succeeded', receipt: o.localStore.putArtifact('unexpected reconciliation') }; } });
  withdrawn = true;
  await assert.rejects(receiver.reconcile({ id: q.id, runId: 'run', stepId: 'step', kind: 'fixture_read', payload: {}, scope: { kind: 'public' }, authority, status: 'uncertain', revision: 3, reservationId: q.id }), /Attempt use withdrawn/);
  assert.equal(entries, 0); assert.equal(f.raw.usedBytes, bytes); assert.deepEqual(a.accounting('grant'), before);
});
