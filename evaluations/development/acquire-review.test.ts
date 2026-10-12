import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { canonicalJson, candidateIdentity, identity, type PhysicalRequest, type PromptManifest } from '../../packages/contracts/index.ts';
import { ResourceLedger, DurableRuntime } from '../../packages/runtime/index.ts';
import { EffectJournal } from '../../packages/effects/index.ts';
import { CommunicationsCore } from '../../packages/communications/core/index.ts';
import { OperationalStore } from '../../packages/storage/index.ts';
import { DevelopmentAccounting } from '../../deployment/development-accounting.ts';
import type { AutarkApplication } from '../../deployment/application.ts';
import { QualificationStore } from '../qualification/store.ts';
import { signDocument } from '../qualification/manifest.ts';
import { syntheticWitnessFixture } from './witness-fixture.ts';
import { acquisitionPlanDomain, acquisitionMetadataUsage, verifyAcquisitionPlan, AcquisitionInfeasible, evidenceRetentionDomain, retentionSourceDigest, type DevelopmentAcquisitionPlan, type AcquisitionPlanTrust } from './acquisition-plan.ts';
import { reviewEnvelopeDomains, type DevelopmentRegistration, type DevelopmentRoleBinding } from './review-envelope.ts';
import { DevelopmentAcquisitionRecorder, type AcquisitionRecorderOptions, type AcquisitionAssignmentPacket } from './acquire.ts';

// Public synthetic witness inputs, independent host/ingress composition. No sibling tests imported.
function fixture(t: TestContext, journalComposition = false) {
  const f = syntheticWitnessFixture(), m = f.m, directory = mkdtempSync(join(tmpdir(), 'aeon-acquire-review-'));
  m.limits = { maxRecords: 512, maxArtifactBytes: 1_000_000, maxEvidenceBytes: 8 * 1024 * 1024 };
  m.grant.originalAccounting = { grantId: m.grant.id, usage: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 3000 }, chargedTokens: 0, chargedCostUsd: 0, chargedElapsedMs: 0, requestIds: [], unknownRequestIds: [] };
  const config = JSON.parse(Buffer.from(f.reader(m.configurationArtifact, 10000)).toString());
  const roles: DevelopmentRoleBinding[] = [
    { id: 'candidate', kind: 'candidate', assignmentId: null },
    ...m.controls.map(c => ({ id: c.id, kind: 'control' as const, assignmentId: c.id })),
    ...m.reviewers.map(r => ({ id: r.id, kind: 'reviewer' as const, assignmentId: r.id })),
  ].map(r => ({ ...r, kind: r.kind as DevelopmentRoleBinding['kind'], allocationId: `allocation:${r.id}`, configurationDigest: m.candidate.configuration, closureDigest: identity({ role: r.id }), profile: config.model, allowedEffects: ['fixture_read'], resources: m.grant.resources }));
  const packet: AcquisitionAssignmentPacket = { version: 1, assignments: roles.filter(r => r.kind !== 'reviewer').map(r => ({ id: 'matched-opportunity', roleId: r.id, message: { source: 'synthetic-assignment', externalId: 'opportunity', revision: '1', conversation: 'assignment', text: 'Solve the public synthetic opportunity', actor: { id: 'trusted-fixture-issuer', scope: { kind: 'public' }, modificationEligible: false } } })) };
  const assignmentPacket = f.put(packet);
  const registration: DevelopmentRegistration = { version: 2, attemptDigest: identity(m), rootId: 'operating-envelope:v1', rootCancelled: false, registeredAt: m.registeredAt, reviewDeadlineAt: f.at(290), observerClosureDigest: f.trust.observer.artifactDigest, closureVerifierDigest: identity('review-closure'), assignmentDigest: assignmentPacket.sha256, roles, originalRequests: [] };
  const rawDir = join(directory, 'raw'); mkdirSync(rawDir, { mode: 0o700 });
  const raw = new QualificationStore(rawDir, 32 * 1024 * 1024);
  const plan: DevelopmentAcquisitionPlan = {
    version: 1, id: 'review-recorder', manifest: f.manifest(), registration: signDocument(reviewEnvelopeDomains.registration, registration, 'issuer', f.keys.get('issuer')!), assignmentPacket,
    originalStateFile: join(directory, 'candidate.sqlite'), rawStore: raw.identity(),
    closures: { node: identity('node'), dependencies: m.candidate.dependencies, prompts: m.candidate.prompts, tools: identity('tools'), acquisition: m.acquisitionDigest },
    roles: roles.map(r => ({ roleId: r.id, stateFile: join(directory, `${r.id}.sqlite`), workspace: join(directory, `workspace-${r.id}`), configuration: m.configurationArtifact, closure: f.put({ role: r.id }), journal: { stream: `journal:${r.id}`, hostId: 'review-host', maxAnchorDocuments: 512, maxAnchorBytes: 1_000_000 }, maxDrafts: 1, maxPayloadBytes: 5000, maxPromptBytes: 5000, maxFragmentBytes: 1000, maxResponseBytes: 1000 })),
    capacity: { captureBytes: 6_100_000, maxSnapshots: 20, maxSnapshotBytes: 300_000, envelopeBytes: 200_000, transitionBytes: 5000, failureBytes: 4096, inventoryEntryBytes: 256, maxArtifacts: 256, maxObservations: 128 },
  };
  // Root-predeclared unclaimed allocation for the one physical-promise positive only.
  if (journalComposition) Object.assign(plan.capacity, { maxSnapshots: 13, maxSnapshotBytes: 500000, captureBytes: 6600000 });
  for (const bytes of f.artifacts.values()) raw.putBytes(bytes);
  const stateFile = join(directory, 'recorder.sqlite'); writeFileSync(stateFile, '', { mode: 0o600 });
  const state = new OperationalStore({ filename: stateFile }), originalStore = new OperationalStore({ filename: plan.originalStateFile, documentJournal: plan.roles[0]!.journal });
  let now = Date.parse(m.grant.issuedAt);
  const original = new ResourceLedger(originalStore, { tokens: 100, costUsd: 0.1, elapsedMs: 5000 }, () => now);
  original.allocate(registration.rootId, m.grant.resources); for (const role of roles) original.allocate(role.allocationId, role.resources, registration.rootId);
  now = Date.parse(m.registeredAt);
  const trust: AcquisitionPlanTrust = { acceptedPlanDigest: '', issuers: f.trust.issuers, envelope: { acceptedRegistrationDigest: '', behavior: { ...f.trust, acceptedAttemptDigest: identity(m) }, acceptedRoles: new Map(roles.map(r => [r.id, identity(r)])), closure: { id: 'closer', key: Buffer.alloc(32, 9), verifierDigest: registration.closureVerifierDigest }, transports: new Map([['transport', Buffer.alloc(32, 10)]]) } };
  const options: AcquisitionRecorderOptions = { state, raw, original, document: signDocument(acquisitionPlanDomain, plan, 'issuer', f.keys.get('issuer')!), trust, syntheticClock: () => ({ wallMs: now, monotonicMs: now - Date.parse(m.grant.issuedAt), bootId: 'synthetic-boot', processStart: 'synthetic-process' }) };
  const accept = () => { registration.attemptDigest = identity(m); plan.manifest = f.manifest(); plan.registration = signDocument(reviewEnvelopeDomains.registration, registration, 'issuer', f.keys.get('issuer')!); trust.acceptedPlanDigest = identity(plan); trust.envelope.acceptedRegistrationDigest = identity(registration); trust.envelope.behavior.acceptedAttemptDigest = identity(m); options.document = signDocument(acquisitionPlanDomain, plan, 'issuer', f.keys.get('issuer')!); };
  accept();
  const stores = new Map<string, OperationalStore>([['candidate', originalStore]]);
  const source = (r: DevelopmentAcquisitionRecorder, id: string, originalLedger = original) => {
    const role = roles.find(role => role.id === id)!, rp = plan.roles.find(p => p.roleId === id)!;
    let store = stores.get(id); if (!store) { store = new OperationalStore({ filename: rp.stateFile, documentJournal: rp.journal }); stores.set(id, store); }
    const accounting = new DevelopmentAccounting({ localStore: store, original: originalLedger, localDefaultCeiling: original.defaultCeiling, registration, acceptedRegistrationDigest: identity(registration), roleId: id, acceptedRoleDigest: identity(role), originalGrant: { resources: m.grant.resources, issuedAt: m.grant.issuedAt, expiresAt: m.grant.expiresAt }, behaviorWindow: { notBefore: m.notBefore, deadlineAt: m.deadlineAt }, actualConfigurationDigest: role.configurationDigest, actualClosureDigest: role.closureDigest, actualProfile: role.profile, rawStore: r.rawStoreForRole(id), reserveEvidence: q => r.reserveEvidence(id, q), retainResponse: (rid, bytes) => r.retainResponse(rid, bytes), transport: { id: 'transport', key: Buffer.alloc(32, 10) }, maxResponseBytes: rp.maxResponseBytes });
    if (!store.get('allocations', registration.rootId)) accounting.resources.allocate(registration.rootId, role.resources);
    const effects = new EffectJournal(store, { assert() {} }, { async dispatch() { throw new Error('No fixture effect dispatch authorized'); }, async reconcile() { throw new Error('No fixture reconciliation'); } });
    const runtime = new DurableRuntime({ store, resources: accounting.resources, effects, shell: { async run() { return { status: 'completed', observations: [] }; } }, now: original.now });
    const communications = new CommunicationsCore({ store, runtime, grant: () => ({ authority: { generation: 'review', epoch: 1, controlRevision: 'review' }, resources: role.resources, parentRunId: registration.rootId }) });
    const application = { store, config, communications, runtime, resources: accounting.resources } as Pick<AutarkApplication, 'store' | 'config' | 'communications' | 'runtime' | 'resources'>;
    return { application, accounting, role, runtime };
  };
  const claim = () => DevelopmentAcquisitionRecorder.claim(options);
  const freezeSources = (r: DevelopmentAcquisitionRecorder) => new Map(roles.filter(role => role.kind !== 'reviewer').map(role => [role.id, source(r, role.id)]));
  t.after(() => { for (const store of stores.values()) store.close(); state.close(); raw.close(); rmSync(directory, { recursive: true, force: true }); });
  return { f, m, plan, roles, registration, packet, raw, state, original, originalStore, options, trust, accept, claim, source, freezeSources, time: (s: number) => { now = Date.parse(f.at(s)); } };
}

test('review: candidate assignment uses real ordinary ingress and rejects a repeated role-local delivery', t => {
  const f = fixture(t), r = f.claim(); f.time(0); const s = f.source(r, 'candidate');
  const run = r.deliverAssignment('candidate', 'matched-opportunity', s.application, s.accounting);
  assert.ok(s.runtime.getRun(run)); assert.equal(s.application.store.list<{ input: { value: string } }>('communications.inputs')[0]!.value.input.value, f.packet.assignments[0]!.message.text);
  assert.equal(r.status().snapshots.length, 1);
  assert.throws(() => r.deliverAssignment('candidate', 'matched-opportunity', s.application, s.accounting), /already attempted/);
});

test('review R1: accepted control ordinary ingress must finish capture instead of failing after admission', t => {
  const f = fixture(t), r = f.claim(); f.time(0); const s = f.source(r, 'no-memory');
  // The API must support the exact accounting association required by captureApplication.
  assert.doesNotThrow(() => r.deliverAssignment('no-memory', 'matched-opportunity', s.application, s.accounting));
  assert.equal(r.status().snapshots.length, 1); assert.equal(r.status().phase, 'acquiring');
});

test('review R2: matched assignment identity is distinct in each registered role', t => {
  const f = fixture(t), r = f.claim(); f.time(0); const candidate = f.source(r, 'candidate'), control = f.source(r, 'no-memory');
  r.deliverAssignment('candidate', 'matched-opportunity', candidate.application, candidate.accounting);
  assert.doesNotThrow(() => r.deliverAssignment('no-memory', 'matched-opportunity', control.application, control.accounting));
  assert.equal(r.status().deliveries.length, 2);
});

test('review R3: foreign CommunicationsCore is refused before any foreign admission', t => {
  const f = fixture(t), r = f.claim(); f.time(0); const candidate = f.source(r, 'candidate'), foreign = f.source(r, 'no-memory');
  const app = { ...candidate.application, communications: foreign.application.communications };
  assert.throws(() => r.deliverAssignment('candidate', 'matched-opportunity', app, candidate.accounting));
  assert.equal(foreign.application.store.list('communications.inputs').length, 0);
  assert.equal(r.status().deliveries.length, 0);
});

for (const field of ['maxArtifacts', 'maxObservations', 'maxSnapshots'] as const) {
  test(`review R4: impossible mandatory ${field} fails before consuming the durable attempt`, t => {
    const f = fixture(t); f.plan.capacity[field] = 1; f.accept();
    assert.throws(f.claim);
    assert.equal(f.state.get('development.acquisition', f.plan.id), undefined);
  });
}

test('review R5: duplicate plan role cannot replace another registered role before claim', t => {
  const f = fixture(t); f.plan.roles[2] = { ...f.plan.roles[1]!, stateFile: f.plan.roles[2]!.stateFile, workspace: f.plan.roles[2]!.workspace }; f.accept();
  assert.throws(f.claim); assert.equal(f.state.get('development.acquisition', f.plan.id), undefined);
});

function reserveModel(f: ReturnType<typeof fixture>, r: DevelopmentAcquisitionRecorder) {
  const source = f.source(r, 'no-memory'), a = source.accounting, store = source.application.store, profile = source.role.profile!;
  a.resources.allocate('model-run', source.role.resources, f.registration.rootId);
  const payload = canonicalJson({ model: profile.id, input: 'independent synthetic request' });
  const prompt: PromptManifest = { id: 'review-prompt', requestDigest: identity(JSON.parse(payload)), fragments: [{ id: 'owned', owner: 'application', role: 'system', order: 0, artifact: store.putArtifact('Host fixture instruction'), scope: { kind: 'public' }, replaceable: true, derivedFrom: [] }] };
  a.capturePrompt(prompt, payload); const inputTokens = Buffer.byteLength(payload) + 1024;
  const q: PhysicalRequest = { id: 'request', runId: 'model-run', purpose: 'reasoning', provider: 'mistral', model: profile.id, promptManifestId: prompt.id, requestDigest: prompt.requestDigest, reservationId: 'request', status: 'reserved', usage: { requests: 1, inputTokens, outputTokens: profile.maxOutputTokens, costUsd: (inputTokens * profile.pricesPerMillion.input + profile.maxOutputTokens * profile.pricesPerMillion.output) / 1_000_000, elapsedMs: profile.timeoutMs } };
  a.resources.reserve(q); a.resources.dispatched({ ...q, status: 'dispatched' });
  return { ...source, q };
}

test('review R4: draft inventory cannot consume a dispatched request protected response slot', t => {
  const f = fixture(t), r = f.claim(); f.time(0); const s = reserveModel(f, r), writer = r.rawStoreForRole('no-memory');
  for (let n = 0; n < f.plan.capacity.maxArtifacts; n++) {
    try { writer.putBytes(Buffer.from(`rejected-draft-${n}`)); } catch { break; }
  }
  assert.equal(f.original.request(s.accounting.requestId(s.q.id))?.status, 'dispatched');
  assert.doesNotThrow(() => s.accounting.recordResponse(s.q.id, { status: 200, body: 'actual response' }));
  assert.ok(r.status().inventory.some(i => i.pool === 'response'));
});

test('review R6: a previously started recorder refuses assignment after the registered behavioral deadline', t => {
  const f = fixture(t); f.packet.assignments.push({ ...f.packet.assignments[0]!, id: 'late-assignment', message: { ...f.packet.assignments[0]!.message, externalId: 'late', conversation: 'late' } });
  f.plan.assignmentPacket = f.raw.put(f.packet); f.registration.assignmentDigest = f.plan.assignmentPacket.sha256; f.accept();
  const r = f.claim(); f.time(0); const s = f.source(r, 'candidate'); r.deliverAssignment('candidate', 'matched-opportunity', s.application, s.accounting);
  f.time(181); assert.throws(() => r.deliverAssignment('candidate', 'late-assignment', s.application, s.accounting));
  assert.equal(s.application.store.list('communications.inputs').length, 1);
});

test('review: interrupted retention preserves exact pending bytes, one-use claim and terminal failure', t => {
  const f = fixture(t), r = f.claim(), put = f.raw.putBytes.bind(f.raw); const bytes = Buffer.from([255, 0, 13, 10]);
  f.raw.putBytes = () => { throw new Error('injected raw write interruption'); };
  assert.throws(() => r.rawStoreForRole('candidate').putBytes(bytes), /interruption/); f.raw.putBytes = put;
  assert.equal(r.status().pending?.bytes, bytes.length); assert.throws(() => DevelopmentAcquisitionRecorder.reopen(f.options), /Interrupted raw/);
  const failure = r.fail('review-interruption', new Error('retained failure'));
  assert.equal(r.status().phase, 'failed'); assert.match(r.readArtifact(failure, 4096).toString(), /review-interruption/);
  assert.throws(f.claim, /claimed/);
});

test('review: exact shared draft bytes deduplicate while rejected distinct drafts remain charged', t => {
  const f = fixture(t), r = f.claim(), bytes = Buffer.from([128, 255, 0, 1]);
  const first = r.rawStoreForRole('candidate').putBytes(bytes), count = r.status().inventory.length;
  assert.equal(r.rawStoreForRole('no-memory').putBytes(bytes).sha256, first.sha256); assert.equal(r.status().inventory.length, count);
  assert.deepEqual(r.readArtifact(first, bytes.length), bytes);
  const second = r.rawStoreForRole('no-memory').putBytes(Buffer.from('draft rejected before original reserve'));
  assert.notEqual(first.sha256, second.sha256); assert.equal(f.original.snapshot(f.registration.rootId).requests, 0);
  assert.ok(r.status().draftBytes['no-memory']! > 0);
});

test('review: reopened same-path candidate handle cannot substitute for actual original source', t => {
  const f = fixture(t), r = f.claim(), s = f.source(r, 'candidate'), other = new OperationalStore({ filename: f.plan.originalStateFile });
  try { assert.throws(() => r.captureApplication('candidate', { ...s.application, store: other }), /actual original ledger store/); } finally { other.close(); }
  assert.equal(r.status().snapshots.length, 0);
});

test('review: journal replay retains delete/recreate and refuses subsequent source-prefix substitution', t => {
  const f = fixture(t), r = f.claim(), s = f.source(r, 'candidate');
  f.originalStore.put('experience', 'lesson', { value: 'first' }, null); f.originalStore.delete('experience', 'lesson', 1); f.originalStore.put('experience', 'lesson', { value: 'second' }, null);
  const captured = r.captureApplication('candidate', s.application); assert.ok(r.readArtifact(captured, 300000).includes(Buffer.from('first')));
  f.originalStore.append({ id: 'ordinary', stream: 'ordinary', type: 'observation', data: { outcome: 'failure' } }); r.captureApplication('candidate', s.application);
  const db = new DatabaseSync(f.plan.originalStateFile); try { db.prepare('UPDATE events SET data=? WHERE id=?').run(canonicalJson({ outcome: 'success' }), 'ordinary'); } finally { db.close(); }
  assert.throws(() => r.captureApplication('candidate', s.application), /prefix replaced/); assert.equal(r.status().snapshots.length, 2);
});

test('review: negative B freezes roles, T includes rejected review bytes, no absent reviews or boundaries qualify', t => {
  const f = fixture(t), r = f.claim(); f.time(0); r.begin();
  const draft = r.rawStoreForRole('candidate').putBytes(Buffer.from('pre-reservation failure draft')), sources = f.freezeSources(r); f.time(180);
  const a = sources.get('candidate')!.accounting, b = r.freezeBehavior(a, sources);
  assert.ok(b.value.artifactIndex.some(i => i.artifact.sha256 === draft.sha256));
  for (const capture of r.status().snapshots) assert.ok(b.value.artifactIndex.some(i => i.artifact.sha256 === capture.artifact.sha256));
  assert.throws(() => r.rawStoreForRole('no-memory').putBytes(Buffer.from('late control')), /phase/);
  const late = r.rawStoreForRole('reviewer-a').putBytes(Buffer.from('review rejected before model reserve'));
  const result = r.close(a, []); assert.ok(result.envelope.accountingTail.value.artifactIndex.some(i => i.artifact.sha256 === late.sha256));
  assert.deepEqual(result.envelope.behavior, b); assert.equal(result.envelope.reviews.length, 0);
  assert.equal(result.findings.filter(x => x.code.startsWith('boundary-')).length, 6);
  assert.notEqual(result.status, 'mechanically-prepared'); assert.equal(result.automaticReleaseEligible, false); assert.equal(result.h1Eligible, false);
  assert.throws(() => r.close(a, []), /immutable B/);
});

for (const substitution of ['runtime-store', 'runtime-resources', 'app-runtime', 'app-resources', 'original-ledger', 'store-handle'] as const) {
  test(`repair review: foreign actual ${substitution} is refused before ordinary side effects`, t => {
    const f = fixture(t), r = f.claim(); f.time(0); const candidate = f.source(r, 'candidate'), foreign = f.source(r, 'no-memory');
    let app = { ...candidate.application }, bridge = candidate.accounting;
    if (substitution === 'runtime-store') {
      const communications = new CommunicationsCore({ ...candidate.application.communications.options, runtime: foreign.runtime });
      app = { ...app, communications, runtime: foreign.runtime };
    } else if (substitution === 'runtime-resources') {
      const resources = new ResourceLedger(f.originalStore, f.original.defaultCeiling, f.original.now);
      const runtime = new DurableRuntime({ store: f.originalStore, resources, effects: candidate.runtime.effects, shell: { async run() { return { status: 'completed', observations: [] }; } } });
      app = { ...app, runtime, resources, communications: new CommunicationsCore({ ...candidate.application.communications.options, runtime }) };
    } else if (substitution === 'app-runtime') app.runtime = foreign.runtime;
    else if (substitution === 'app-resources') app.resources = foreign.accounting.resources;
    else if (substitution === 'original-ledger') {
      const other = new ResourceLedger(f.originalStore, f.original.defaultCeiling, f.original.now), source = f.source(r, 'candidate', other);
      app = source.application; bridge = source.accounting;
    } else {
      const other = new OperationalStore({ filename: f.plan.originalStateFile }); t.after(() => other.close()); app.store = other;
    }
    const snapshotCount = r.status().snapshots.length;
    assert.throws(() => r.deliverAssignment('candidate', 'matched-opportunity', app, bridge), /association|original ledger|handle/);
    assert.equal(f.originalStore.list('communications.inputs').length, 0); assert.equal(foreign.application.store.list('communications.inputs').length, 0);
    assert.equal(r.status().deliveries.length, 0); assert.equal(r.status().snapshots.length, snapshotCount);
  });
}

test('repair review: actual dispatched response settles after unrelated terminal failure without restarting work', t => {
  const f = fixture(t), r = f.claim(); f.time(0); const source = reserveModel(f, r), a = source.accounting;
  const failure = r.fail('unrelated-role-stopped', new Error('review fixture failure'));
  const held = f.original.request(a.requestId(source.q.id)); assert.equal(held?.status, 'dispatched');
  f.time(1); const body = '{"model":"synthetic-model","late":true}';
  a.recordResponse(source.q.id, { status: 200, body });
  const response = r.status().inventory.find(i => i.pool === 'response')!; assert.equal(r.readArtifact(response.artifact, 1000).toString(), body);
  a.recordTransport({ requestId: source.q.id, dispatched: true, status: 'succeeded', httpStatus: 200, usage: { requests: 1, inputTokens: 2, outputTokens: 1, costUsd: 0.000004, elapsedMs: 1000 }, responseModel: 'synthetic-model', responseDigest: response.artifact.sha256 });
  a.resources.settle({ ...source.q, status: 'succeeded', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } });
  assert.equal(f.original.request(a.requestId(source.q.id))?.status, 'succeeded'); assert.equal(r.status().phase, 'failed'); assert.equal(identity(r.status().failure), identity(failure));
  assert.throws(() => r.deliverAssignment('no-memory', 'matched-opportunity', source.application, a), /phase stopped/);
  assert.throws(() => r.rawStoreForRole('candidate').putBytes(Buffer.from('new work after failure')), /phase/);
});

for (const relation of ['forward', 'reverse', 'sibling'] as const) {
  test(`repair review: component path ancestry ${relation} handles literal dot-prefix names`, t => {
    const f = fixture(t), base = JSON.parse(f.raw.readArtifact(f.m.configurationArtifact, 10000).toString());
    const stateDirs = f.roles.map(role => `/tmp/review-live-path/state-${role.id}`);
    if (relation === 'forward') stateDirs[1] = `${stateDirs[0]}/..peer`;
    else if (relation === 'reverse') stateDirs[0] = `${stateDirs[1]}/..peer`;
    else stateDirs[1] = `${stateDirs[0]}..peer`;
    f.m.evidenceKind = 'live-development';
    for (let i = 0; i < f.roles.length; i++) {
      const role = f.roles[i]!, plan = f.plan.roles[i]!, config = { ...base, stateDirectory: stateDirs[i], workspaceDirectory: `/tmp/review-live-path/work-${role.id}`, nodeBinary: '/synthetic/node' };
      plan.stateFile = `${stateDirs[i]}/operational.sqlite`; plan.workspace = config.workspaceDirectory; plan.configuration = f.raw.put(config); role.configurationDigest = plan.configuration.sha256;
    }
    f.plan.originalStateFile = f.plan.roles[0]!.stateFile; f.m.configurationArtifact = f.plan.roles[0]!.configuration; f.m.candidate.configuration = f.m.configurationArtifact.sha256;
    const { id: _old, ...fields } = f.m.candidate; f.m.candidate.id = candidateIdentity(fields);
    const candidate = JSON.parse(f.raw.readArtifact(f.m.candidateArtifact, 10000).toString()); candidate.manifest = f.m.candidate; candidate.inputs.configuration = JSON.parse(f.raw.readArtifact(f.m.configurationArtifact, 10000).toString()); f.m.candidateArtifact = f.raw.put(candidate);
    f.trust.envelope.acceptedRoles = new Map(f.roles.map(role => [role.id, identity(role)])); f.accept();
    // New unclaimed fixture plans need independent copy authority before testing live path admission.
    const retention = { version: 1 as const, id: 'independent-path-fixture-copy', attemptDigest: identity(f.m), sourceDigest: retentionSourceDigest(f.plan), rawStoreDigest: identity(f.plan.rawStore), custodianId: 'path-fixture-custodian', purpose: 'synthetic path-verifier checks', audiences: [...new Set([`principal:${f.m.observerId}`, ...f.roles.filter(role => role.profile).map(role => `provider:${role.profile!.provider ?? 'mistral'}`), ...f.roles.filter(role => role.kind === 'reviewer').map(role => `reviewer:${role.assignmentId}`)])], dataScope: 'complete-operational-role-sources' as const, retention: 'independent-indefinite' as const, withdrawal: 'stop-use-retain-originals' as const };
    f.plan.retention = signDocument(evidenceRetentionDomain, retention, 'issuer', f.f.keys.get('issuer')!);
    f.trust.retention = { acceptedGrantDigest: identity(retention), issuers: f.f.trust.issuers, custodianSigner: 'issuer', custodianKey: f.f.keys.get('issuer')! }; f.accept();
    const verify = () => verifyAcquisitionPlan(f.options.document, f.trust, (ref, bound) => f.raw.readArtifact(ref, bound), Date.parse(f.m.registeredAt));
    if (relation === 'sibling') assert.doesNotThrow(verify); else assert.throws(verify, /directories must be disjoint/);
    assert.equal(f.state.get('development.acquisition', f.plan.id), undefined);
  });
}

test('repair review R4: rejected drafts leave mandatory B and final metadata bytes usable', t => {
  const f = fixture(t); f.plan.capacity.envelopeBytes = 40_000; f.plan.capacity.transitionBytes = 100; f.accept();
  const usage = f.raw.usage(); let r: DevelopmentAcquisitionRecorder;
  try { r = f.claim(); } catch (error) { assert.ok(error instanceof AcquisitionInfeasible); assert.equal(f.state.get('development.acquisition', f.plan.id), undefined); assert.deepEqual(f.raw.usage(), usage); return; }
  f.time(0); r.begin(); const writer = r.rawStoreForRole('candidate');
  for (let n = 0; n < f.plan.capacity.maxArtifacts; n++) { try { writer.putBytes(Buffer.from(`failed-metadata-draft-${n}`)); } catch { break; } }
  const sources = f.freezeSources(r); f.time(180); const a = sources.get('candidate')!.accounting;
  assert.doesNotThrow(() => r.freezeBehavior(a, sources));
  assert.doesNotThrow(() => r.close(a, []));
  assert.equal(r.status().phase, 'closed');
});

function pressureOptionalDrafts(f: ReturnType<typeof fixture>, r: DevelopmentAcquisitionRecorder, prefix: string) {
  const writer = r.rawStoreForRole('candidate'), artifacts = [];
  let refusal: unknown;
  for (let n = 0; n <= f.plan.capacity.maxArtifacts; n++) {
    const before = f.raw.usage(), inventory = r.status().inventory;
    try { artifacts.push(writer.putBytes(Buffer.from(`${prefix}:${n}`))); }
    catch (error) { refusal = error; assert.deepEqual(f.raw.usage(), before); assert.deepEqual(r.status().inventory, inventory); assert.equal(r.status().pending, null); break; }
  }
  assert.ok(refusal); assert.ok(artifacts.length > 0); return { artifacts, refusal };
}

function assertSerializedPromise(r: DevelopmentAcquisitionRecorder, result: ReturnType<DevelopmentAcquisitionRecorder['close']>) {
  const state = r.status(), size = (v: unknown) => Buffer.byteLength(canonicalJson(v));
  const usage = acquisitionMetadataUsage(r.plan, r.capacity, state.inventory.length, Object.values(state.reservations).map(q => q.metadata));
  assert.ok(size(result.envelope.behavior) <= usage.behaviorBytes, 'actual signed B exceeds modeled B bytes');
  assert.ok(size(result.envelope) <= usage.finalBytes, 'actual final envelope exceeds modeled final bytes');
  const actualMetadata = state.inventory.filter(i => i.pool === 'metadata').reduce((n, i) => n + i.bytes, 0) + size(state);
  assert.ok(actualMetadata <= usage.totalBytes, 'actual retained metadata plus owner state exceeds modeled total');
  assert.ok(actualMetadata <= r.capacity.metadataBytes, 'actual metadata exceeds original declared pool');
  assert.ok(size(result.envelope) <= r.plan.manifest.value.limits.maxArtifactBytes);
  const index = new Set([...result.envelope.behavior.value.artifactIndex, ...result.envelope.accountingTail.value.artifactIndex].map(i => i.artifact.sha256));
  const finalDigest = identity(result.envelope);
  for (const entry of state.inventory) { assert.equal(r.readArtifact(entry.artifact, entry.bytes).byteLength, entry.bytes); assert.ok(entry.artifact.sha256 === finalDigest || index.has(entry.artifact.sha256)); }
}

test('R4 arithmetic review: admitted metadata pressure preserves serialized B/final/owner with escaped actual clock and signer strings', t => {
  const f = fixture(t); f.plan.capacity.transitionBytes = 100;
  const clock = f.options.syntheticClock!; f.options.syntheticClock = () => ({ ...clock(), bootId: '\0'.repeat(20), processStart: '界'.repeat(40) });
  f.m.observerId = '"\\\0'.repeat(40); f.trust.envelope.behavior.observer.id = f.m.observerId; f.trust.envelope.closure.id = '閉'.repeat(100); f.accept();
  const r = f.claim(); f.time(0); r.begin();
  const pressure = pressureOptionalDrafts(f, r, 'escaped-encoding-pressure'); assert.match(String(pressure.refusal), /serialized B\/final\/owner/);
  const sources = f.freezeSources(r); f.time(180); const a = sources.get('candidate')!.accounting;
  const b = r.freezeBehavior(a, sources); for (const draft of pressure.artifacts) assert.ok(b.value.artifactIndex.some(i => i.artifact.sha256 === draft.sha256));
  const result = r.close(a, []); assertSerializedPromise(r, result); assert.equal(r.status().phase, 'closed');
});

test('R4 arithmetic review: admitted physical promise preserves pending response and B/T/final after optional metadata pressure', t => {
  const f = fixture(t, true), r = f.claim(); f.time(0); const source = reserveModel(f, r);
  const pressure = pressureOptionalDrafts(f, r, 'after-dispatch-pressure'); assert.match(String(pressure.refusal), /serialized|artifact inventory/);
  assert.equal(f.original.request(source.accounting.requestId(source.q.id))?.status, 'dispatched');
  const sources = f.freezeSources(r); f.time(180); const a = sources.get('candidate')!.accounting; r.freezeBehavior(a, sources);
  f.time(181); const body = '{"model":"synthetic-model","retained":"after-B"}'; source.accounting.recordResponse(source.q.id, { status: 200, body });
  const response = r.status().inventory.find(i => i.pool === 'response')!;
  source.accounting.recordTransport({ requestId: source.q.id, dispatched: true, status: 'succeeded', httpStatus: 200, usage: { requests: 1, inputTokens: 2, outputTokens: 1, costUsd: 0.000004, elapsedMs: 1000 }, responseModel: 'synthetic-model', responseDigest: response.artifact.sha256 });
  source.accounting.resources.settle({ ...source.q, status: 'succeeded', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } });
  const result = r.close(a, []); assertSerializedPromise(r, result);
  assert.ok(result.envelope.accountingTail.value.artifactIndex.some(i => i.artifact.sha256 === response.artifact.sha256));
  assert.equal(f.original.request(source.accounting.requestId(source.q.id))?.status, 'succeeded'); assert.equal(r.status().phase, 'closed');
});

test('R4 arithmetic review: metadata pressure cannot consume terminal failure or a dispatched late response', t => {
  const f = fixture(t), r = f.claim(); f.time(0); const source = reserveModel(f, r); pressureOptionalDrafts(f, r, 'terminal-pressure');
  const failed = r.fail('independent-role-failure', new Error('保'.repeat(150))); const before = f.original.snapshot(f.registration.rootId);
  source.accounting.recordResponse(source.q.id, { status: 200, body: 'late response after retained failure' });
  assert.equal(r.status().phase, 'failed'); assert.equal(r.status().failure?.sha256, failed.sha256); assert.equal(r.status().pending, null);
  assert.ok(r.status().inventory.some(i => i.pool === 'response')); assert.deepEqual(f.original.snapshot(f.registration.rootId), before);
  const used = Buffer.byteLength(canonicalJson(r.status())) + r.status().inventory.filter(i => i.pool === 'metadata').reduce((n, i) => n + i.bytes, 0);
  assert.ok(used <= r.capacity.metadataBytes); assert.throws(() => r.begin(), /stopped/);
});

test('R4 arithmetic review: repeated assignment identities with escaped encoding stay inside actual owner reserve', t => {
  const f = fixture(t); f.packet.assignments[0]!.id = '\0'.repeat(200); f.plan.assignmentPacket = f.raw.put(f.packet); f.registration.assignmentDigest = f.plan.assignmentPacket.sha256; f.accept();
  const r = f.claim(); f.time(0); const source = f.source(r, 'candidate'); r.deliverAssignment('candidate', f.packet.assignments[0]!.id, source.application, source.accounting);
  const sources = f.freezeSources(r); f.time(180); const a = sources.get('candidate')!.accounting; r.freezeBehavior(a, sources);
  const result = r.close(a, []); assertSerializedPromise(r, result); assert.equal(r.status().deliveries.length, 1);
});

test('R4 arithmetic review: real effect metadata refuses before original reservation when optional evidence has consumed the remainder', t => {
  const f = fixture(t); f.plan.capacity.envelopeBytes = 100_000; f.accept(); const r = f.claim(); f.time(0); r.begin();
  const source = f.source(r, 'no-memory'), a = source.accounting;
  a.resources.allocate('effect-run', source.role.resources, f.registration.rootId);
  const call = { id: 'prospective-effect', runId: 'effect-run', stepId: 'fixture-step', name: 'fixture_read', arguments: { input: 'public synthetic bytes' } };
  a.captureTool(call);
  const q: PhysicalRequest = { id: `tool:${call.id}`, runId: call.runId, purpose: 'reasoning', provider: 'effect-receiver', model: call.name, promptManifestId: `tool:${call.id}`, requestDigest: identity(call), reservationId: `tool:${call.id}`, status: 'reserved', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } };
  pressureOptionalDrafts(f, r, 'before-effect-reserve'); const before = f.raw.usage(), retained = r.status().inventory;
  assert.throws(() => a.resources.reserve(q), /serialized B\/final\/owner metadata/);
  assert.equal(f.original.request(a.requestId(q.id)), undefined); assert.equal(r.status().reservations[a.requestId(q.id)], undefined);
  assert.deepEqual(r.status().inventory, retained); assert.deepEqual(f.raw.usage(), before); assert.equal(r.status().pending, null);
});

test('R4 arithmetic review: accepted minimum terminal reserve covers bounded escaped error text and still permits late response', t => {
  const f = fixture(t); f.plan.capacity.failureBytes = 2048; f.accept(); const before = f.raw.usage(); let r: DevelopmentAcquisitionRecorder;
  try { r = f.claim(); } catch (error) { assert.ok(error instanceof AcquisitionInfeasible); assert.deepEqual(f.raw.usage(), before); assert.equal(f.state.get('development.acquisition', f.plan.id), undefined); return; }
  f.time(0); const source = reserveModel(f, r), held = f.original.snapshot(f.registration.rootId);
  assert.doesNotThrow(() => r.fail('tool-output-failure', new Error('\0'.repeat(512))));
  assert.equal(r.status().phase, 'failed'); assert.ok(r.status().failure); assert.deepEqual(f.original.snapshot(f.registration.rootId), held);
  assert.doesNotThrow(() => source.accounting.recordResponse(source.q.id, { status: 200, body: 'actual protected response' }));
  assert.equal(r.status().phase, 'failed');
});

// Derive the declared wire independently of the production terminal encoder.
function independentTerminalBounds(maxArtifactBytes: number) {
  const sha256 = 'f'.repeat(64), artifact = { uri: `sha256:${sha256}`, sha256 }, detail = '\0'.repeat(512), code = '\0'.repeat(128);
  const bytes = Buffer.alloc(1024); for (let i = 0; i < detail.length; i++) bytes.writeUInt16LE(detail.charCodeAt(i), i * 2);
  const wire = { version: 2, planDigest: sha256, phase: 'reviewing', pending: { artifact, bytes: maxArtifactBytes, pool: 'response' }, code, detail: { encoding: 'utf16le-base64', value: bytes.toString('base64') } };
  const raw = Buffer.byteLength(canonicalJson(wire));
  const owner = Buffer.byteLength(canonicalJson({ failure: artifact, phase: 'failed', findings: [{ status: 'unavailable', code, detail }], inventory: [{ artifact, bytes: raw, pool: 'failure', roleId: null, slot: 'failure' }] }));
  return { raw, owner };
}

for (const maxArtifactBytes of [999_999, 1_000_000]) {
  test(`terminal repair review: exact canonical ${maxArtifactBytes} boundary rejects one byte short before claim and admits the derived reserve`, t => {
    const f = fixture(t), expected = independentTerminalBounds(maxArtifactBytes); f.m.limits.maxArtifactBytes = maxArtifactBytes;
    f.plan.capacity.failureBytes = expected.raw - 1; f.accept(); const before = f.raw.usage();
    assert.throws(f.claim, AcquisitionInfeasible); assert.deepEqual(f.raw.usage(), before); assert.equal(f.state.get('development.acquisition', f.plan.id), undefined);
    // No attempt was claimed; the independently fixed feasible plan can now claim its one use.
    f.plan.capacity.failureBytes = expected.raw; f.accept(); const r = f.claim();
    assert.equal(r.capacity.terminalRawBytes, expected.raw); assert.equal(r.capacity.terminalOwnerBytes, expected.owner);
    const failure = r.fail('\0'.repeat(128), { toString: () => '\0'.repeat(512) });
    assert.ok(r.readArtifact(failure, expected.raw).byteLength <= expected.raw); assert.equal(r.status().phase, 'failed');
  });
}

function assertTerminalUnits(r: DevelopmentAcquisitionRecorder, code: string, error: unknown) {
  const before = r.status(), beforeOwner = Buffer.byteLength(canonicalJson(before));
  const ref = r.fail(code, error), bytes = r.readArtifact(ref, r.capacity.terminalRawBytes), wire = JSON.parse(bytes.toString('utf8'));
  assert.equal(wire.version, 2); assert.equal(wire.detail.encoding, 'utf16le-base64'); assert.equal(wire.code, code.slice(0, 128));
  assert.equal(wire.planDigest, identity(r.plan)); assert.equal(wire.phase, before.phase); assert.equal(identity(wire.pending), identity(before.pending));
  const expected = String(error).slice(0, 512), decoded = Buffer.from(wire.detail.value, 'base64');
  assert.equal(decoded.length, expected.length * 2);
  for (let i = 0; i < expected.length; i++) assert.equal(decoded.readUInt16LE(i * 2), expected.charCodeAt(i));
  assert.equal(r.status().findings.at(-1)!.detail, expected); assert.equal(r.status().findings.at(-1)!.code, code.slice(0, 128));
  assert.ok(bytes.length <= r.capacity.terminalRawBytes); assert.ok(bytes.length <= r.plan.capacity.failureBytes);
  assert.ok(Buffer.byteLength(canonicalJson(r.status())) - beforeOwner <= r.capacity.terminalOwnerBytes);
  return ref;
}

for (const [name, text] of [
  ['nul', '\0'.repeat(512)],
  ['unpaired', '\ud800'.repeat(512)],
  ['mixed', '界\udc00😀\n'.repeat(110)],
  ['cut-pair', 'x'.repeat(511) + '😀'],
] as const) {
  test(`terminal repair review: retained ${name} diagnostics preserve exact bounded UTF16 units and plaintext finding`, t => {
    const f = fixture(t), r = f.claim(); const code = '\0'.repeat(128) + 'discarded-code-suffix';
    const error = { toString: () => text }, failure = assertTerminalUnits(r, code, error), usage = f.raw.usage();
    assert.equal(r.fail('different later code', new Error('later error')).sha256, failure.sha256); assert.deepEqual(f.raw.usage(), usage);
    assert.equal(r.status().phase, 'failed'); assert.throws(() => r.begin(), /stopped/);
  });
}

test('terminal repair review: worst escaped failure preserves interrupted raw identity and held physical charges', t => {
  const f = fixture(t), r = f.claim(); f.time(0); const source = reserveModel(f, r), put = f.raw.putBytes.bind(f.raw), charge = f.original.snapshot(f.registration.rootId);
  f.raw.putBytes = () => { throw new Error('independent interrupted byte write'); };
  assert.throws(() => r.rawStoreForRole('candidate').putBytes(Buffer.alloc(10_000, 3)), /interrupted byte write/); f.raw.putBytes = put;
  const pending = r.status().pending; assert.ok(pending);
  const failure = assertTerminalUnits(r, '\0'.repeat(128), { toString: () => '\0'.repeat(512) });
  assert.equal(identity(r.status().pending), identity(pending)); assert.deepEqual(f.original.snapshot(f.registration.rootId), charge);
  assert.equal(f.original.request(source.accounting.requestId(source.q.id))?.status, 'dispatched');
  assert.throws(() => source.accounting.recordResponse(source.q.id, { status: 200, body: 'response with unresolved raw intent' }), /Incomplete prior raw retention/);
  assert.equal(r.status().failure?.sha256, failure.sha256); assert.equal(r.status().phase, 'failed');
  assert.throws(() => DevelopmentAcquisitionRecorder.reopen(f.options), /Interrupted raw/);
});

test('terminal repair review: worst plaintext owner growth survives optional pressure and exact late settlement', t => {
  const f = fixture(t), r = f.claim(); f.time(0); const source = reserveModel(f, r); pressureOptionalDrafts(f, r, 'terminal-owner-reserve');
  const failure = assertTerminalUnits(r, '\0'.repeat(128), { toString: () => '\0'.repeat(512) });
  f.time(1); const body = '{"model":"synthetic-model","terminal":true}'; source.accounting.recordResponse(source.q.id, { status: 200, body });
  const response = r.status().inventory.find(i => i.pool === 'response')!;
  source.accounting.recordTransport({ requestId: source.q.id, dispatched: true, status: 'succeeded', httpStatus: 200, usage: { requests: 1, inputTokens: 2, outputTokens: 1, costUsd: 0.000004, elapsedMs: 1000 }, responseModel: 'synthetic-model', responseDigest: response.artifact.sha256 });
  source.accounting.resources.settle({ ...source.q, status: 'succeeded', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } });
  assert.equal(f.original.request(source.accounting.requestId(source.q.id))?.status, 'succeeded'); assert.equal(r.status().failure?.sha256, failure.sha256); assert.equal(r.status().phase, 'failed');
  const used = Buffer.byteLength(canonicalJson(r.status())) + r.status().inventory.filter(i => i.pool === 'metadata').reduce((n, i) => n + i.bytes, 0);
  assert.ok(used <= r.capacity.metadataBytes); assert.throws(() => r.rawStoreForRole('candidate').putBytes(Buffer.from('forbidden new draft')), /phase/);
});
