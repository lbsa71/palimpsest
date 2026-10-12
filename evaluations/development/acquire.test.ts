import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { canonicalJson, identity, type PhysicalRequest, type PromptManifest } from '../../packages/contracts/index.ts';
import { DurableRuntime, ResourceLedger } from '../../packages/runtime/index.ts';
import { EffectJournal } from '../../packages/effects/index.ts';
import { CommunicationsCore } from '../../packages/communications/core/index.ts';
import { hashBytes } from '../../packages/release/artifacts.ts';
import { OperationalStore } from '../../packages/storage/index.ts';
import { DevelopmentAccounting } from '../../deployment/development-accounting.ts';
import type { AutarkApplication } from '../../deployment/application.ts';
import { QualificationStore } from '../qualification/store.ts';
import { signDocument } from '../qualification/manifest.ts';
import { AcquisitionInfeasible, acquisitionPlanDomain, verifyAcquisitionPlan, type AcquisitionPlanTrust, type DevelopmentAcquisitionPlan } from './acquisition-plan.ts';
import { reviewEnvelopeDomains, type DevelopmentRegistration, type DevelopmentRoleBinding } from './review-envelope.ts';
import { syntheticWitnessFixture } from './witness-fixture.ts';
import { DevelopmentAcquisitionRecorder, type AcquisitionRecorderOptions } from './acquire.ts';

function syntheticAcquisitionPlanFixture() {
  const f = syntheticWitnessFixture(), m = f.m;
  m.limits = { maxRecords: 512, maxArtifactBytes: 1_000_000, maxEvidenceBytes: 8 * 1024 * 1024 };
  m.grant.originalAccounting = { grantId: m.grant.id, usage: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 3000 }, chargedTokens: 0, chargedCostUsd: 0, chargedElapsedMs: 0, requestIds: [], unknownRequestIds: [] };
  const configuration = JSON.parse(Buffer.from(f.reader(m.configurationArtifact, 10000)).toString('utf8'));
  const roles: DevelopmentRoleBinding[] = ['candidate', ...m.controls.map(c => c.id), ...m.reviewers.map(r => r.id)].map((id, i) => ({ id, kind: i === 0 ? 'candidate' : i <= m.controls.length ? 'control' : 'reviewer', assignmentId: i === 0 ? null : id, allocationId: `role:${id}`, configurationDigest: m.candidate.configuration, closureDigest: identity({ id, synthetic: 'closure' }), profile: configuration.model, allowedEffects: ['fixture_read'], resources: m.grant.resources }));
  const assignmentPacket = f.put({ version: 1, assignments: [] });
  const registration: DevelopmentRegistration = { version: 2, attemptDigest: identity(m), rootId: 'operating-envelope:v1', rootCancelled: false, registeredAt: m.registeredAt, reviewDeadlineAt: f.at(290), observerClosureDigest: f.trust.observer.artifactDigest, closureVerifierDigest: identity('synthetic closure verifier'), assignmentDigest: assignmentPacket.sha256, roles, originalRequests: [] };
  const plan: DevelopmentAcquisitionPlan = { version: 1, id: 'synthetic-acquisition', manifest: f.manifest(), registration: signDocument(reviewEnvelopeDomains.registration, registration, 'issuer', f.keys.get('issuer')!), assignmentPacket, originalStateFile: '/tmp/aeon-acquisition/original.sqlite', closures: { node: identity('synthetic node'), dependencies: m.candidate.dependencies, prompts: m.candidate.prompts, tools: identity('synthetic tools'), acquisition: m.acquisitionDigest }, rawStore: { directory: '/tmp/aeon-acquisition/raw', device: '1', inode: '2', uid: '3', capacityBytes: 32 * 1024 * 1024 }, roles: roles.map(r => ({ roleId: r.id, stateFile: `/tmp/aeon-acquisition/${r.id === 'candidate' ? 'original' : r.id}.sqlite`, workspace: `/tmp/aeon-acquisition/work-${r.id}`, configuration: m.configurationArtifact, closure: f.put({ id: r.id, synthetic: 'closure' }), journal: null, maxDrafts: 1, maxPayloadBytes: 5000, maxPromptBytes: 5000, maxFragmentBytes: 1000, maxResponseBytes: 1000 })), capacity: { captureBytes: 6100000, maxSnapshots: 20, maxSnapshotBytes: 300000, envelopeBytes: 200000, transitionBytes: 5000, failureBytes: 4096, inventoryEntryBytes: 256, maxArtifacts: 256, maxObservations: 128 } };
  const trust: AcquisitionPlanTrust = { acceptedPlanDigest: identity(plan), issuers: f.trust.issuers, envelope: { acceptedRegistrationDigest: identity(registration), behavior: { ...f.trust, acceptedAttemptDigest: identity(m) }, acceptedRoles: new Map(roles.map(r => [r.id, identity(r)])), closure: { id: 'closer', key: Buffer.alloc(32, 9), verifierDigest: registration.closureVerifierDigest }, transports: new Map([['transport', Buffer.alloc(32, 10)]]) } };
  const sign = () => signDocument(acquisitionPlanDomain, plan, 'issuer', f.keys.get('issuer')!);
  const accept = () => { plan.registration = signDocument(reviewEnvelopeDomains.registration, registration, 'issuer', f.keys.get('issuer')!); plan.manifest = f.manifest(); registration.attemptDigest = identity(m); trust.acceptedPlanDigest = identity(plan); trust.envelope.acceptedRegistrationDigest = identity(registration); trust.envelope.behavior.acceptedAttemptDigest = identity(m); trust.envelope.acceptedRoles = new Map(roles.map(r => [r.id, identity(r)])); };
  return { f, m, roles, registration, plan, trust, sign, accept, verify: () => verifyAcquisitionPlan(sign(), trust, f.reader, Date.parse(m.registeredAt)) };
}


function fixture(t: TestContext, journal = false, assignments = false) {
  const f = syntheticAcquisitionPlanFixture(), directory = mkdtempSync(join(tmpdir(), 'aeon-recorder-'));
  if (assignments) { f.plan.assignmentPacket = f.f.put({ version: 1, assignments: f.roles.filter(r => r.kind !== 'reviewer').map(r => ({ roleId: r.id, id: 'opportunity', message: { source: 'synthetic-assignment', externalId: 'opportunity', revision: '1', conversation: 'opportunity', text: 'Public synthetic assignment', actor: { id: 'synthetic-host', scope: { kind: 'public' }, modificationEligible: false } } })) }); f.registration.assignmentDigest = f.plan.assignmentPacket.sha256; }
  const rawDirectory = join(directory, 'raw'); mkdirSync(rawDirectory, { mode: 0o700 });
  const raw = new QualificationStore(rawDirectory, 32 * 1024 * 1024);
  for (const bytes of f.f.artifacts.values()) raw.putBytes(bytes);
  f.plan.originalStateFile = join(directory, 'original.sqlite'); f.plan.rawStore = raw.identity();
  for (const rp of f.plan.roles) { rp.stateFile = join(directory, rp.roleId === 'candidate' ? 'original.sqlite' : `${rp.roleId}.sqlite`); rp.workspace = join(directory, `workspace-${rp.roleId}`); rp.journal = journal ? { stream: `source-journal:${rp.roleId}`, hostId: `synthetic-host:${rp.roleId}`, maxAnchorDocuments: 512, maxAnchorBytes: 1_000_000 } : null; mkdirSync(rp.workspace, { mode: 0o700 }); }
  const file = join(directory, 'recorder.sqlite'); writeFileSync(file, '', { mode: 0o600 });
  const state = new OperationalStore({ filename: file }), originalStore = new OperationalStore({ filename: f.plan.originalStateFile, documentJournal: f.plan.roles[0]!.journal });
  let now = Date.parse(f.m.grant.issuedAt);
  const original = new ResourceLedger(originalStore, { tokens: 100, costUsd: 0.1, elapsedMs: 5000 }, () => now);
  original.allocate(f.registration.rootId, f.m.grant.resources);
  for (const role of f.roles) original.allocate(role.allocationId, role.resources, f.registration.rootId);
  now = Date.parse(f.m.registeredAt); f.accept();
  const options: AcquisitionRecorderOptions = { state, original, raw, document: f.sign(), trust: f.trust, syntheticClock: () => ({ wallMs: now, monotonicMs: now - Date.parse(f.m.grant.issuedAt), bootId: 'synthetic-boot', processStart: 'synthetic-process' }) };
  const recorder = () => DevelopmentAcquisitionRecorder.claim(options);
  const stores: OperationalStore[] = [];
  const bridge = (r: DevelopmentAcquisitionRecorder, roleId = 'no-memory', actualOriginal = original) => {
    const role = f.roles.find(r => r.id === roleId)!, rp = f.plan.roles.find(r => r.roleId === roleId)!;
    const store = role.kind === 'candidate' ? originalStore : new OperationalStore({ filename: rp.stateFile, documentJournal: rp.journal }); if (store !== originalStore) stores.push(store);
    const a = new DevelopmentAccounting({ localStore: store, original: actualOriginal, localDefaultCeiling: { tokens: 100, costUsd: 0.1, elapsedMs: 5000 }, registration: f.registration, acceptedRegistrationDigest: identity(f.registration), roleId, acceptedRoleDigest: identity(role), originalGrant: { resources: f.m.grant.resources, issuedAt: f.m.grant.issuedAt, expiresAt: f.m.grant.expiresAt }, behaviorWindow: { notBefore: f.m.notBefore, deadlineAt: f.m.deadlineAt }, actualConfigurationDigest: role.configurationDigest, actualClosureDigest: role.closureDigest, actualProfile: role.profile, rawStore: r.rawStoreForRole(roleId), reserveEvidence: q => r.reserveEvidence(roleId, q), retainResponse: (id, bytes) => r.retainResponse(id, bytes), transport: { id: 'transport', key: Buffer.alloc(32, 10) }, maxResponseBytes: rp.maxResponseBytes });
    if (!store.get('allocations', f.registration.rootId)) a.resources.allocate(f.registration.rootId, role.resources); if (!store.get('allocations', 'run')) a.resources.allocate('run', role.resources, f.registration.rootId); return { a, store, role, rp };
  };
  const model = (x: ReturnType<typeof bridge>, id = 'physical') => {
    const payload = canonicalJson({ model: x.role.profile!.id, synthetic: id }), fragment = x.store.putArtifact('Synthetic host-owned prompt');
    const manifest: PromptManifest = { id: `prompt:${id}`, requestDigest: identity(JSON.parse(payload)), fragments: [{ id: 'owned', owner: 'application', role: 'system', order: 0, artifact: fragment, scope: { kind: 'public' }, replaceable: true, derivedFrom: [] }] };
    x.a.capturePrompt(manifest, payload); const profile = x.role.profile!, inputTokens = Buffer.byteLength(payload) + 1024;
    return { id, runId: 'run', purpose: 'reasoning', provider: 'mistral', model: profile.id, promptManifestId: manifest.id, requestDigest: manifest.requestDigest, reservationId: id, status: 'reserved', usage: { requests: 1, inputTokens, outputTokens: profile.maxOutputTokens, costUsd: (inputTokens * profile.pricesPerMillion.input + profile.maxOutputTokens * profile.pricesPerMillion.output) / 1_000_000, elapsedMs: profile.timeoutMs } } satisfies PhysicalRequest;
  };
  const app = (roleId = 'candidate', store = originalStore) => ({ store, config: JSON.parse(raw.readArtifact(f.m.configurationArtifact, 10000).toString('utf8')) }) as Pick<AutarkApplication, 'store' | 'config'>;
  const freezeSources = (r: DevelopmentAcquisitionRecorder) => new Map(f.roles.filter(role => role.kind !== 'reviewer').map(role => { const x = bridge(r, role.id); return [role.id, { application: app(role.id, x.store), accounting: x.a }] as const; }));
  const ingress = (r: DevelopmentAcquisitionRecorder, roleId = 'candidate', actualOriginal = original) => {
    const x = bridge(r, roleId, actualOriginal), effects = new EffectJournal(x.store, { assert() {} }, { async dispatch() { throw new Error('Synthetic fixture forbids effects'); }, async reconcile() { throw new Error('Synthetic fixture forbids reconciliation'); } });
    const runtime = new DurableRuntime({ store: x.store, resources: x.a.resources, effects, shell: { async run() { return { status: 'completed', observations: [] }; } }, now: original.now });
    const communications = new CommunicationsCore({ store: x.store, runtime, grant: () => ({ authority: { generation: 'synthetic', epoch: 1, controlRevision: 'synthetic' }, resources: x.role.resources, parentRunId: f.registration.rootId }) });
    return { ...x, runtime, application: { ...app(roleId, x.store), communications, runtime, resources: x.a.resources } };
  };
  t.after(() => { for (const store of new Set(stores)) { try { store.close(); } catch {} } state.close(); originalStore.close(); raw.close(); rmSync(directory, { recursive: true, force: true }); });
  return { ...f, raw, state, originalStore, original, options, recorder, bridge, model, app, freezeSources, ingress, setTime: (seconds: number) => { now = Date.parse(f.f.at(seconds)); } };
}

test('one-use durable claim, deduplicated source inventory and exact reopen retain finite reservations', t => {
  const f = fixture(t), r = f.recorder(); const bytes = Buffer.from([0, 255, 13, 10, 128]); const raw = r.rawStoreForRole('no-memory');
  const a = raw.putBytes(bytes), count = r.status().inventory.length; assert.equal(raw.putBytes(bytes).sha256, a.sha256); assert.equal(r.status().inventory.length, count); assert.deepEqual(r.readArtifact(a, bytes.length), bytes);
  assert.throws(f.recorder, /claimed/); const reopened = DevelopmentAcquisitionRecorder.reopen(f.options); assert.equal(reopened.status().planDigest, r.status().planDigest); assert.equal(reopened.status().phase, 'claimed');
});
test('infeasible signed plan stops before durable claim and can be repaired only before attempt', t => {
  const f = fixture(t), count = f.raw.usage().entryCount; f.plan.capacity.captureBytes = 8 * 1024 * 1024; f.accept(); f.options.document = f.sign(); assert.throws(f.recorder, /cannot cover/); assert.equal(f.state.get('development.acquisition', f.plan.id), undefined); assert.equal(f.raw.usage().entryCount, count);
});
test('actual bound source/configuration and original ledger cannot be substituted', t => {
  const f = fixture(t), r = f.recorder(); assert.throws(() => r.captureApplication('candidate', { ...f.app(), config: { ...f.app().config, model: { ...f.app().config.model, contextWindow: 2 } } }), /source\/configuration changed/);
  assert.throws(() => DevelopmentAcquisitionRecorder.reopen({ ...f.options, document: { ...f.options.document, value: { ...f.plan, originalStateFile: '/tmp/foreign.sqlite' } } }), /signature/);
});
test('interrupted raw retention preserves pending intent and refuses reopened success', t => {
  const f = fixture(t), r = f.recorder(), write = f.raw.putBytes.bind(f.raw); f.raw.putBytes = () => { throw new Error('synthetic disk retention failure'); };
  assert.throws(() => r.rawStoreForRole('no-memory').putBytes(Buffer.from('distinct interrupted bytes')), /retention failure/); assert.ok(r.status().pending);
  f.raw.putBytes = write; assert.throws(() => DevelopmentAcquisitionRecorder.reopen(f.options), /Interrupted raw write/); const failure = r.fail('raw-retention', new Error('synthetic failed disk'));
  assert.equal(r.status().phase, 'failed'); assert.ok(r.status().pending); assert.match(r.readArtifact(failure, 2048).toString('utf8'), /raw-retention/);
});
test('draft overflow before original reservation never enters receiver and preserves terminal headroom', t => {
  const f = fixture(t), r = f.recorder(), raw = r.rawStoreForRole('no-memory'); let receiverEntries = 0;
  raw.putBytes(Buffer.alloc(11000, 1)); assert.throws(() => { raw.putBytes(Buffer.from('exhausted draft')); receiverEntries++; }, /draft byte allowance/);
  assert.equal(receiverEntries, 0); assert.equal(f.original.snapshot(f.registration.rootId).requests, 0); const artifact = r.fail('draft-overflow', new Error('Synthetic rejected before entry')); assert.ok(r.readArtifact(artifact, 2048).length > 0);
});
test('aborted pre-reserve drafts consume bytes while protected actual response remains retainable', t => {
  const f = fixture(t), r = f.recorder(); f.setTime(0); const x = f.bridge(r), q = f.model(x); x.a.resources.reserve(q); x.a.resources.dispatched({ ...q, status: 'dispatched' });
  const raw = r.rawStoreForRole('no-memory'), consumed = r.status().draftBytes['no-memory']!; raw.putBytes(Buffer.alloc(11000 - consumed, 7)); assert.throws(() => raw.putBytes(Buffer.from('another distinct rejected prompt')), /draft byte allowance/);
  const body = '{"model":"synthetic-model","synthetic":"late response"}'; x.a.recordResponse(q.id, { status: 200, body }); const reservation = r.status().reservations[x.a.requestId(q.id)]!;
  assert.ok(reservation.responseBytes > 0); assert.equal(r.status().inventory.filter(i => i.pool === 'response').length, 1); assert.equal(f.original.request(x.a.requestId(q.id))?.status, 'dispatched');
});
test('independent roles share durable capacity and preserve both rejected reservations and raw drafts', t => {
  const f = fixture(t), r = f.recorder(); f.setTime(0); const x = f.bridge(r), y = f.bridge(r, 'no-standing-goals'), q = f.model(x), second = f.model(y, 'second');
  x.a.resources.reserve(q); assert.throws(() => y.a.resources.reserve(second), /budget exhausted/);
  assert.equal(Object.keys(r.status().reservations).length, 2); assert.ok(r.status().draftBytes['no-standing-goals']! > 0); assert.equal(f.original.snapshot(f.registration.rootId).requests, 1);
});
test('changed response ID, too-large response and repeat physical reservation cannot consume authority', t => {
  const f = fixture(t), r = f.recorder(); f.setTime(0); const x = f.bridge(r), q = f.model(x); x.a.resources.reserve(q);
  assert.throws(() => r.retainResponse('foreign', Buffer.from('x')), /Unregistered.*response/); x.a.resources.dispatched({ ...q, status: 'dispatched' }); assert.throws(() => r.retainResponse(x.a.requestId(q.id), Buffer.alloc(1001)), /response bytes/); assert.throws(() => x.a.resources.reserve(q), /consumed/);
  assert.equal(f.original.snapshot(f.registration.rootId).requests, 1);
});
test('response retention failure after dispatch leaves original uncertainty and held full charges', async t => {
  const f = fixture(t), r = f.recorder(); f.setTime(0); const x = f.bridge(r), q = f.model(x); x.a.resources.reserve(q); x.a.resources.dispatched({ ...q, status: 'dispatched' });
  const write = f.raw.putBytes.bind(f.raw); f.raw.putBytes = () => { throw new Error('Synthetic response disk failure'); }; assert.throws(() => x.a.recordResponse(q.id, { status: 200, body: '{"model":"synthetic-model"}' }), /disk failure/); f.raw.putBytes = write;
  x.a.resources.recoverDispatched(); const state = x.a.states()[0]!; assert.equal(state.request.status, 'uncertain'); assert.deepEqual(state.charged, state.ceiling); assert.ok(r.status().pending); assert.equal(f.original.snapshot(f.registration.rootId).requests, 1);
});
test('synthetic clocks, backwards time and changed process cannot fabricate live elapsed/restart boundaries', t => {
  const f = fixture(t), r = f.recorder(); f.setTime(-3); assert.throws(() => r.begin(), /clock\/process/); f.setTime(0); f.options.syntheticClock = () => ({ wallMs: Date.parse(f.f.at(0)), monotonicMs: 5000, bootId: 'another-boot', processStart: 'synthetic-process' }); assert.throws(() => DevelopmentAcquisitionRecorder.reopen(f.options), /clock\/process/);
});
test('behavior cannot freeze before actual acquisition start and failed freeze remains durably fenced', t => {
  const f = fixture(t), r = f.recorder(), x = f.bridge(r); assert.throws(() => r.freezeBehavior(x.a), /start missing/); f.setTime(0); r.begin(); f.setTime(180);
  const sources = f.freezeSources(r), write = f.raw.putBytes.bind(f.raw); f.raw.putBytes = () => { throw new Error('Synthetic B disk failure'); }; assert.throws(() => r.freezeBehavior(x.a, sources), /B disk failure/); f.raw.putBytes = write;
  assert.ok(f.originalStore.get('development.accounting.freeze', identity(f.registration))); assert.equal(r.status().phase, 'freezing'); assert.throws(() => DevelopmentAcquisitionRecorder.reopen(f.options), /Interrupted/); assert.equal(r.status().phase, 'freezing'); assert.throws(() => x.a.resources.reserve(f.model(x, 'after-freeze')), /registered phase/);
});
test('no registered reviewer judgment is fabricated by recorder', t => {
  const f = fixture(t), r = f.recorder(); assert.throws(() => r.close(f.bridge(r).a, []), /immutable B/); assert.equal(r.status().behavior, null); assert.equal(r.status().findings.length, 0);
});

test('actual document put/delete/recreation and all events retain exact source revisions and original bytes', t => {
  const f = fixture(t, true), r = f.recorder(); f.originalStore.put('ordinary', 'document', { exact: 'first' }, null); const first = r.captureApplication('candidate', f.app());
  f.originalStore.put('ordinary', 'document', { exact: 'second' }, 1); f.originalStore.delete('ordinary', 'document', 2); f.originalStore.put('ordinary', 'document', { exact: 'recreated' }, null);
  f.originalStore.append({ id: 'ordinary-observation', stream: 'ordinary', type: 'result', data: { actual: true } }); const second = r.captureApplication('candidate', f.app());
  const captured = JSON.parse(r.readArtifact(second, 100000).toString('utf8')); assert.notEqual(first.sha256, second.sha256); assert.ok(captured.snapshot.events.some((e: { id: string }) => e.id === 'ordinary-observation')); assert.equal(captured.snapshot.documents.find((d: { namespace: string; key: string }) => d.namespace === 'ordinary' && d.key === 'document').revision, 1); assert.equal(r.status().findings.length, 0);
});
test('snapshot without qualified document journal stays explicitly unavailable', t => {
  const f = fixture(t), r = f.recorder(); r.captureApplication('candidate', f.app()); assert.ok(r.status().findings.some(f => f.code === 'document-history-unavailable' && f.status === 'unavailable'));
});
test('lost source document mutation or raw revision gap cannot be projected as complete', t => {
  const f = fixture(t, true), r = f.recorder(); f.originalStore.put('ordinary', 'document', { exact: 'first' }, null); r.captureApplication('candidate', f.app());
  const db = new DatabaseSync(f.originalStore.filename); try { db.prepare('UPDATE documents SET revision=3,value=? WHERE namespace=? AND key=?').run(canonicalJson({ exact: 'unobserved' }), 'ordinary', 'document'); } finally { db.close(); }
  assert.throws(() => r.captureApplication('candidate', f.app()), /disagree with complete source journal/); assert.equal(r.status().snapshots.length, 1);
});
test('omitted or replaced past ordinary event refuses capture even if latest snapshot looks successful', t => {
  const f = fixture(t, true), r = f.recorder(); f.originalStore.append({ id: 'retained-event', stream: 'ordinary', type: 'result', data: { result: 'failure retained' } }); r.captureApplication('candidate', f.app());
  const db = new DatabaseSync(f.originalStore.filename); try { db.prepare('UPDATE events SET data=? WHERE id=?').run(canonicalJson({ result: 'forged success' }), 'retained-event'); } finally { db.close(); }
  assert.throws(() => r.captureApplication('candidate', f.app()), /prefix replaced\/omitted/); assert.equal(r.status().snapshots.length, 1);
});
test('source bounded preflight refuses excessive actual rows before retaining a partial capture', t => {
  const f = fixture(t, true), r = f.recorder(); f.originalStore.put('ordinary', 'large', { raw: 'x'.repeat(100000) }, null); assert.throws(() => r.captureApplication('candidate', f.app()), /snapshot.*bound|snapshot.*exceeds/); assert.equal(r.status().snapshots.length, 0);
});

test('insufficient transition/signature headroom stops before original ledger reservation', t => {
  const f = fixture(t); f.plan.capacity.transitionBytes = 100; f.accept(); f.options.document = f.sign(); const r = f.recorder(); f.setTime(0); const x = f.bridge(r), q = f.model(x); assert.throws(() => x.a.resources.reserve(q), /Transition\/signature headroom/); assert.equal(f.original.snapshot(f.registration.rootId).requests, 0); assert.ok(r.status().draftBytes['no-memory']! > 0);
});
test('admitted small metadata pool stops optional bytes before pending intent and still closes complete B and final inventory', t => {
  const f = fixture(t, true); f.plan.capacity.transitionBytes = 100; f.accept(); f.options.document = f.sign();
  const r = f.recorder(); f.setTime(0); r.begin(); const raw = r.rawStoreForRole('candidate'), drafts = [];
  let refusal: unknown;
  for (let n = 0; n < f.plan.capacity.maxArtifacts; n++) {
    const before = f.raw.usage();
    try { drafts.push(raw.putBytes(Buffer.from(`rejected metadata draft:${n}`))); }
    catch (error) { refusal = error; assert.deepEqual(f.raw.usage(), before); break; }
  }
  assert.match(String(refusal), /Protected serialized B\/final\/owner metadata capacity/);
  assert.ok(drafts.length > 0); assert.ok(r.status().inventory.length < f.plan.capacity.maxArtifacts);
  assert.equal(r.status().pending, null); assert.equal(f.original.snapshot(f.registration.rootId).requests, 0);
  const sources = f.freezeSources(r); f.setTime(180); const candidate = sources.get('candidate')!.accounting;
  const b = r.freezeBehavior(candidate, sources), retained = r.status().inventory;
  for (const draft of drafts) assert.ok(b.value.artifactIndex.some(entry => entry.artifact.sha256 === draft.sha256));
  const result = r.close(candidate, []), tail = result.envelope.accountingTail.value;
  for (const entry of retained) assert.ok(b.value.artifactIndex.some(i => i.artifact.sha256 === entry.artifact.sha256) || tail.artifactIndex.some(i => i.artifact.sha256 === entry.artifact.sha256));
  assert.equal(r.status().phase, 'closed'); assert.equal(result.automaticReleaseEligible, false); assert.equal(result.h1Eligible, false);
});
test('serialized request promise refuses before original reserve while retaining all prior attempted drafts', t => {
  const f = fixture(t); f.plan.capacity.envelopeBytes = 100000; f.accept(); f.options.document = f.sign();
  const r = f.recorder(); f.setTime(0); r.begin(); const x = f.bridge(r), q = f.model(x), raw = r.rawStoreForRole('candidate');
  for (let n = 0; n < f.plan.capacity.maxArtifacts; n++) { try { raw.putBytes(Buffer.from(`prior metadata draft:${n}`)); } catch { break; } }
  const inventory = r.status().inventory, before = f.raw.usage();
  assert.throws(() => x.a.resources.reserve(q), /Protected serialized B\/final\/owner metadata capacity/);
  assert.deepEqual(f.raw.usage(), before); assert.deepEqual(r.status().inventory, inventory); assert.equal(r.status().pending, null);
  assert.equal(r.status().reservations[x.a.requestId(q.id)], undefined); assert.equal(f.original.request(x.a.requestId(q.id)), undefined);
  assert.equal(f.original.snapshot(f.registration.rootId).requests, 0); assert.ok(r.status().draftBytes['no-memory']! > 0);
});
test('missing actual control handle and reused SQLite handle cannot be labelled qualified source', t => {
  const f = fixture(t, true), r = f.recorder(), x = f.bridge(r); assert.throws(() => r.captureApplication('no-memory', f.app('no-memory', x.store)), /actual accepted bridge\/store/);
  const other = new OperationalStore({ filename: f.originalStore.filename }); try { assert.throws(() => r.captureApplication('candidate', f.app('candidate', other)), /actual original ledger store/); } finally { other.close(); }
});
test('missing candidate/control final sources refuse freeze before bridge phase changes', t => {
  const f = fixture(t, true), r = f.recorder(), x = f.bridge(r); f.setTime(0); r.begin(); assert.throws(() => r.freezeBehavior(x.a), /source missing/); assert.equal(f.originalStore.get('development.accounting.freeze', identity(f.registration)), undefined); assert.equal(r.status().phase, 'acquiring');
});
test('one immutable negative B retains actual source capture without fabricated development boundaries', t => {
  const f = fixture(t, true), r = f.recorder(); f.setTime(0); r.begin(); const sources = f.freezeSources(r); f.setTime(180); const candidate = sources.get('candidate')!.accounting;
  const b = r.freezeBehavior(candidate, sources); assert.equal(b.value.frozenAt, f.f.at(180)); assert.equal(r.status().phase, 'reviewing'); assert.equal(r.status().snapshots.length, 6); assert.equal(r.status().findings.filter(f => f.code.startsWith('boundary-')).length, 6); assert.ok(b.value.evidence.findings.length > 0);
  assert.throws(() => r.freezeBehavior(candidate, sources), /start missing|already frozen/); assert.throws(() => r.rawStoreForRole('candidate').putBytes(Buffer.from('late behavioral draft')), /registered phase/);
  const result = r.close(candidate, []); assert.notEqual(result.status, 'mechanically-prepared'); assert.equal(result.automaticReleaseEligible, false); assert.equal(result.h1Eligible, false); assert.equal(result.envelope.reviews.length, 0); assert.equal(r.status().phase, 'closed');
});
test('manual original cancellation before B is retained as unavailable and never false cancellation anchor', t => {
  const f = fixture(t, true), r = f.recorder(); f.setTime(0); r.begin(); const sources = f.freezeSources(r); f.setTime(180); f.original.cancel(f.registration.rootId);
  assert.throws(() => r.freezeBehavior(sources.get('candidate')!.accounting, sources), /cancellation.*unavailable/); assert.equal(r.status().behavior, null); assert.equal(r.status().frozen?.rootCancelled, true); assert.equal(r.status().phase, 'failed'); assert.equal(f.original.snapshot(f.registration.rootId).cancelled, true);
});
test('manual cancellation during T retains no false C while real late response can still settle', t => {
  const f = fixture(t, true), r = f.recorder(); f.setTime(0); r.begin(); const sources = f.freezeSources(r), x = { a: sources.get('no-memory')!.accounting, store: sources.get('no-memory')!.application.store, role: f.roles.find(r => r.id === 'no-memory')!, rp: f.plan.roles.find(r => r.roleId === 'no-memory')! };
  const q = f.model(x); x.a.resources.reserve(q); x.a.resources.dispatched({ ...q, status: 'dispatched' }); f.setTime(180); const candidate = sources.get('candidate')!.accounting; r.freezeBehavior(candidate, sources);
  f.original.cancel(f.registration.rootId); f.setTime(181); const body = '{"model":"synthetic-model","late":true}'; x.a.recordResponse(q.id, { status: 200, body }); x.a.recordTransport({ requestId: q.id, dispatched: true, status: 'succeeded', httpStatus: 200, usage: { requests: 1, inputTokens: 2, outputTokens: 1, costUsd: 0.000004, elapsedMs: 1000 }, responseModel: 'synthetic-model', responseDigest: hashBytes(body) }); x.a.resources.settle({ ...q, status: 'succeeded', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } });
  const result = r.close(candidate, []); assert.equal(result.envelope.closure, null); assert.notEqual(result.status, 'mechanically-prepared'); assert.equal(f.original.request(x.a.requestId(q.id))?.status, 'succeeded'); assert.ok(r.status().inventory.some(i => i.pool === 'response')); assert.equal(f.original.snapshot(f.registration.rootId).cancelled, true);
});
test('B indexes complete durable inventory including an aborted draft and actual source snapshots', t => {
  const f = fixture(t, true), r = f.recorder(); f.setTime(0); r.begin();
  const draft = r.rawStoreForRole('no-memory').putBytes(Buffer.from('aborted pre-reservation raw draft'));
  const sources = f.freezeSources(r); f.setTime(180); const b = r.freezeBehavior(sources.get('candidate')!.accounting, sources);
  const index = new Map(b.value.artifactIndex.map(e => [e.artifact.sha256, e.bytes]));
  assert.equal(index.get(draft.sha256), Buffer.byteLength('aborted pre-reservation raw draft')); assert.equal(f.original.snapshot(f.registration.rootId).requests, 0);
  for (const snapshot of r.status().snapshots) assert.ok(index.has(snapshot.artifact.sha256));
  for (const retained of r.status().inventory.filter(i => i.pool !== 'metadata')) assert.equal(index.get(retained.artifact.sha256), retained.bytes);
});
test('T indexes rejected reviewer drafts and retained B bytes once without overlapping B index', t => {
  const f = fixture(t, true), r = f.recorder(); f.setTime(0); r.begin(); const sources = f.freezeSources(r); f.setTime(180);
  const candidate = sources.get('candidate')!.accounting, b = r.freezeBehavior(candidate, sources);
  const reviewer = f.roles.find(role => role.kind === 'reviewer')!;
  const draft = r.rawStoreForRole(reviewer.id).putBytes(Buffer.from('review draft rejected before ledger reserve'));
  const inventory = r.status().inventory, result = r.close(candidate, []), tail = result.envelope.accountingTail.value;
  const original = new Set(b.value.artifactIndex.map(e => e.artifact.sha256));
  assert.ok(tail.artifactIndex.some(e => e.artifact.sha256 === draft.sha256)); assert.equal(tail.transitions.length, 0); assert.equal(f.original.snapshot(f.registration.rootId).requests, 0);
  for (const retained of inventory) assert.ok(original.has(retained.artifact.sha256) || tail.artifactIndex.some(e => e.artifact.sha256 === retained.artifact.sha256 && e.bytes === retained.bytes));
  assert.ok(tail.artifactIndex.every(e => !original.has(e.artifact.sha256))); assert.equal(result.automaticReleaseEligible, false); assert.equal(result.h1Eligible, false);
});
test('real candidate and control assignments share opportunity ID with distinct one-use deliveries and actual captures', t => {
  const f = fixture(t, true, true), r = f.recorder(); f.setTime(0); const candidate = f.ingress(r), control = f.ingress(r, 'no-memory');
  const first = r.deliverAssignment('candidate', 'opportunity', candidate.application, candidate.a), second = r.deliverAssignment('no-memory', 'opportunity', control.application, control.a);
  assert.ok(candidate.runtime.getRun(first)); assert.ok(control.runtime.getRun(second)); assert.equal(r.status().deliveries.length, 2); assert.equal(r.status().snapshots.length, 2);
  assert.throws(() => r.deliverAssignment('no-memory', 'opportunity', control.application, control.a), /already attempted/); assert.equal(control.store.list('communications.inputs').length, 1);
});
test('foreign communications, runtime resources and original ledger identity refuse before intent or ingress', t => {
  const f = fixture(t, true, true), r = f.recorder(); f.setTime(0); const candidate = f.ingress(r), foreign = f.ingress(r, 'no-memory');
  assert.throws(() => r.deliverAssignment('candidate', 'opportunity', { ...candidate.application, communications: foreign.application.communications }, candidate.a), /association/);
  const old = candidate.runtime.resources; Object.assign(candidate.runtime, { resources: f.original });
  assert.throws(() => r.deliverAssignment('candidate', 'opportunity', candidate.application, candidate.a), /association/); Object.assign(candidate.runtime, { resources: old });
  const alternate = new ResourceLedger(f.originalStore, f.original.defaultCeiling, f.original.now), other = f.ingress(r, 'candidate', alternate);
  assert.throws(() => r.deliverAssignment('candidate', 'opportunity', other.application, other.a), /original association/);
  assert.equal(r.status().deliveries.length, 0); assert.equal(candidate.store.list('communications.inputs').length, 0); assert.equal(foreign.store.list('communications.inputs').length, 0);
});
test('every assignment checks clock/deadline and cancellation before admission after begin', t => {
  const f = fixture(t, true, true), r = f.recorder(); f.setTime(0); r.begin(); const candidate = f.ingress(r);
  f.setTime(181); assert.throws(() => r.deliverAssignment('candidate', 'opportunity', candidate.application, candidate.a), /behavioral window/); assert.equal(r.status().deliveries.length, 0); assert.equal(candidate.store.list('communications.inputs').length, 0);
});
for (const field of ['maxArtifacts', 'maxObservations', 'maxSnapshots', 'envelopeBytes'] as const) test(`mandatory ${field} minima refuse before one-use claim`, t => {
  const f = fixture(t, true, true); f.plan.capacity[field] = 1; f.accept(); f.options.document = f.sign();
  assert.throws(f.recorder); assert.equal(f.state.get('development.acquisition', f.plan.id), undefined);
});
test('duplicate plan role cannot replace another registered role', t => {
  const f = fixture(t); f.plan.roles[2] = { ...f.plan.roles[1]!, stateFile: f.plan.roles[2]!.stateFile, workspace: f.plan.roles[2]!.workspace }; f.accept(); f.options.document = f.sign();
  assert.throws(f.recorder, /registered permutation/); assert.equal(f.state.get('development.acquisition', f.plan.id), undefined);
});
test('arbitrary rejected drafts cannot consume a dispatched response protected artifact slot', t => {
  const f = fixture(t), r = f.recorder(); f.setTime(0); const x = f.bridge(r), q = f.model(x); x.a.resources.reserve(q); x.a.resources.dispatched({ ...q, status: 'dispatched' });
  for (let n = 0; n < f.plan.capacity.maxArtifacts; n++) { try { r.rawStoreForRole('no-memory').putBytes(Buffer.from(`rejected:${n}`)); } catch { break; } }
  assert.doesNotThrow(() => x.a.recordResponse(q.id, { status: 200, body: 'actual response' })); assert.ok(r.status().inventory.some(i => i.pool === 'response'));
  assert.throws(() => x.a.recordResponse(q.id, { status: 200, body: 'changed reply' }), /immutable physical response/); assert.equal(f.original.request(x.a.requestId(q.id))?.status, 'dispatched');
});
test('durable unrelated failure stops admission but preserves late actual dispatched response and settlement', t => {
  const f = fixture(t), r = f.recorder(); f.setTime(0); const x = f.bridge(r), q = f.model(x); x.a.resources.reserve(q); x.a.resources.dispatched({ ...q, status: 'dispatched' });
  r.fail('other-role-failure', new Error('independent role stopped acquisition')); assert.throws(() => r.rawStoreForRole('candidate').putBytes(Buffer.from('new draft')), /phase/);
  const body = '{"model":"synthetic-model","late":true}'; x.a.recordResponse(q.id, { status: 200, body }); x.a.recordTransport({ requestId: q.id, dispatched: true, status: 'succeeded', httpStatus: 200, usage: { requests: 1, inputTokens: 2, outputTokens: 1, costUsd: 0.000004, elapsedMs: 1000 }, responseModel: 'synthetic-model', responseDigest: hashBytes(body) }); x.a.resources.settle({ ...q, status: 'succeeded', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } });
  assert.equal(r.status().phase, 'failed'); assert.ok(r.status().failure); assert.ok(r.status().inventory.some(i => i.pool === 'response')); assert.equal(f.original.request(x.a.requestId(q.id))?.status, 'succeeded');
});
test('insufficient canonical terminal pool refuses before raw or owner claim', t => {
  const f = fixture(t); f.plan.capacity.failureBytes = 2048; f.accept(); f.options.document = f.sign(); const before = f.raw.usage();
  assert.throws(f.recorder, AcquisitionInfeasible); assert.deepEqual(f.raw.usage(), before); assert.equal(f.state.get('development.acquisition', f.plan.id), undefined);
});
for (const [label, detail] of [['NUL', '\u0000'.repeat(512)], ['lone surrogate', '\ud800'.repeat(512)], ['nonASCII pairs and unpaired UTF16', '界😀\udc00'.repeat(128)]]) {
  test(`terminal v2 losslessly retains ${label} and worst code with interrupted pending identity`, t => {
    const f = fixture(t), r = f.recorder(); f.setTime(0); r.begin(); const x = f.bridge(r), q = f.model(x); x.a.resources.reserve(q); x.a.resources.dispatched({ ...q, status: 'dispatched' });
    const write = f.raw.putBytes.bind(f.raw); f.raw.putBytes = () => { throw new Error('synthetic private raw interruption'); };
    assert.throws(() => r.rawStoreForRole('candidate').putBytes(Buffer.from('unknown interrupted raw intent')), /interruption/); f.raw.putBytes = write;
    const before = r.status(), pending = before.pending, held = f.original.snapshot(f.registration.rootId), code = '\u0000'.repeat(128);
    const artifact = r.fail(code, detail), after = r.status(), bytes = r.readArtifact(artifact, f.plan.capacity.failureBytes), record = JSON.parse(bytes.toString('utf8'));
    assert.equal(record.version, 2); assert.equal(record.detail.encoding, 'utf16le-base64'); assert.equal(Buffer.from(record.detail.value, 'base64').toString('utf16le'), detail);
    assert.equal(record.code, code); assert.equal(record.phase, before.phase); assert.equal(identity(record.pending), identity(pending)); assert.equal(identity(after.pending), identity(pending));
    assert.equal(after.findings.at(-1)!.code, code); assert.equal(after.findings.at(-1)!.detail, detail); assert.equal(after.phase, 'failed');
    assert.ok(bytes.byteLength <= r.capacity.terminalRawBytes); assert.ok(bytes.byteLength <= f.plan.capacity.failureBytes);
    assert.ok(Buffer.byteLength(canonicalJson(after)) - Buffer.byteLength(canonicalJson(before)) <= r.capacity.terminalOwnerBytes);
    assert.deepEqual(f.original.snapshot(f.registration.rootId), held); assert.throws(() => x.a.recordResponse(q.id, { status: 200, body: 'response remains held behind unknown raw intent' }), /Incomplete prior raw retention/);
    const usage = f.raw.usage(); assert.equal(identity(r.fail('second failure', 'different detail')), identity(artifact)); assert.deepEqual(f.raw.usage(), usage);
  });
}
test('worst escaped terminal finding fits after optional owner pressure and preserves dispatched late settlement', t => {
  const f = fixture(t); f.plan.capacity.envelopeBytes = 100000; f.accept(); f.options.document = f.sign();
  const r = f.recorder(); f.setTime(0); r.begin(); const x = f.bridge(r), q = f.model(x); x.a.resources.reserve(q); x.a.resources.dispatched({ ...q, status: 'dispatched' });
  for (let n = 0; n <= f.plan.capacity.maxArtifacts; n++) { try { r.rawStoreForRole('candidate').putBytes(Buffer.from(`terminal owner pressure:${n}`)); } catch { break; } }
  const before = r.status(), held = f.original.snapshot(f.registration.rootId), error = new Error('\u0000'.repeat(512)), code = '\u0000'.repeat(128);
  const artifact = r.fail(code, error), bytes = r.readArtifact(artifact, f.plan.capacity.failureBytes), record = JSON.parse(bytes.toString('utf8'));
  assert.equal(Buffer.from(record.detail.value, 'base64').toString('utf16le'), String(error).slice(0, 512)); assert.equal(record.code, code);
  assert.equal(r.status().pending, null); assert.deepEqual(f.original.snapshot(f.registration.rootId), held);
  const body = '{"model":"synthetic-model","late":true}'; x.a.recordResponse(q.id, { status: 200, body }); x.a.recordTransport({ requestId: q.id, dispatched: true, status: 'succeeded', httpStatus: 200, usage: { requests: 1, inputTokens: 2, outputTokens: 1, costUsd: 0.000004, elapsedMs: 1000 }, responseModel: 'synthetic-model', responseDigest: hashBytes(body) }); x.a.resources.settle({ ...q, status: 'succeeded', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } });
  const after = r.status(); assert.equal(after.phase, 'failed'); assert.equal(f.original.request(x.a.requestId(q.id))?.status, 'succeeded');
  assert.ok(after.inventory.some(i => i.pool === 'response')); assert.equal(identity(after.failure), identity(artifact));
  for (const entry of before.inventory) assert.equal(r.readArtifact(entry.artifact, entry.bytes).byteLength, entry.bytes);
  assert.ok(Buffer.byteLength(canonicalJson(after)) + after.inventory.filter(i => i.pool === 'metadata').reduce((n, i) => n + i.bytes, 0) <= r.capacity.metadataBytes);
  assert.throws(() => r.rawStoreForRole('candidate').putBytes(Buffer.from('new work after terminal failure')), /phase/);
});
