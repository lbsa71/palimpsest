import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { identity } from '../../packages/contracts/index.ts';
import { ResourceLedger } from '../../packages/runtime/index.ts';
import { DevelopmentAccounting } from '../../deployment/development-accounting.ts';
import { OperationalStore } from '../../packages/storage/index.ts';
import { QualificationStore } from '../qualification/store.ts';
import { signDocument } from '../qualification/manifest.ts';
import { syntheticWitnessFixture } from './witness-fixture.ts';
import { acquisitionPlanDomain, verifyAcquisitionPlan, retentionSourceDigest, evidenceRetentionDomain, evidenceCustodianDomain, type DevelopmentAcquisitionPlan, type AcquisitionPlanTrust } from './acquisition-plan.ts';
import { reviewEnvelopeDomains, type DevelopmentRegistration, type DevelopmentRoleBinding } from './review-envelope.ts';
import { DevelopmentAcquisitionRecorder, type AcquisitionRecorderOptions } from './acquire.ts';
import { pagedRecorderFixture } from './acquisition-pages.test-fixture.ts';

// Reuse only unclaimed v1 plan construction from the existing acquisition fixture.
function snapshotPlanFixture() {
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

function snapshotFixture(t: TestContext) {
  const f = snapshotPlanFixture(), directory = mkdtempSync(join(tmpdir(), 'aeon-current-use-owner-v1-'));
  mkdirSync(join(directory, 'raw'), { mode: 0o700 });
  const raw = new QualificationStore(join(directory, 'raw'), 32 * 1024 * 1024);
  for (const bytes of f.f.artifacts.values()) raw.putBytes(bytes);
  f.plan.rawStore = raw.identity(); f.plan.originalStateFile = join(directory, 'candidate.sqlite');
  const stores = new Map<string, OperationalStore>();
  for (const rp of f.plan.roles) {
    rp.stateFile = join(directory, `${rp.roleId}.sqlite`); rp.workspace = join(directory, `workspace-${rp.roleId}`);
    rp.journal = { stream: `journal:${rp.roleId}`, hostId: rp.roleId, maxAnchorDocuments: 512, maxAnchorBytes: 1000000 };
    mkdirSync(rp.workspace, { mode: 0o700 });
    const store = new OperationalStore({ filename: rp.stateFile, documentJournal: rp.journal }); chmodSync(store.filename, 0o600); stores.set(rp.roleId, store);
  }
  const filename = join(directory, 'owner.sqlite'); writeFileSync(filename, '', { mode: 0o600 }); const state = new OperationalStore({ filename });
  let now = Date.parse(f.m.grant.issuedAt);
  const original = new ResourceLedger(stores.get('candidate')!, { tokens: 100, costUsd: 0.1, elapsedMs: 5000 }, () => now);
  original.allocate(f.registration.rootId, f.m.grant.resources);
  for (const role of f.roles) original.allocate(role.allocationId, role.resources, f.registration.rootId);
  now = Date.parse(f.m.registeredAt);
  const config = JSON.parse(raw.readArtifact(f.m.configurationArtifact, 10000).toString());
  const options: AcquisitionRecorderOptions = { state, raw, original, document: f.sign(), trust: f.trust, syntheticClock: () => ({ wallMs: now, monotonicMs: now - Date.parse(f.m.grant.issuedAt), bootId: 'synthetic-owner', processStart: 'synthetic-owner' }) };
  const accept = () => { f.accept(); options.document = f.sign(); };
  accept();
  const initial = (r: DevelopmentAcquisitionRecorder) => { for (const role of f.roles.filter(r => r.kind !== 'reviewer')) {
    const store = stores.get(role.id)!, rp = f.plan.roles.find(rp => rp.roleId === role.id)!;
    const accounting = new DevelopmentAccounting({ localStore: store, original, localDefaultCeiling: original.defaultCeiling, registration: f.registration, acceptedRegistrationDigest: identity(f.registration), roleId: role.id, acceptedRoleDigest: identity(role), originalGrant: { resources: f.m.grant.resources, issuedAt: f.m.grant.issuedAt, expiresAt: f.m.grant.expiresAt }, behaviorWindow: { notBefore: f.m.notBefore, deadlineAt: f.m.deadlineAt }, actualConfigurationDigest: role.configurationDigest, actualClosureDigest: role.closureDigest, actualProfile: role.profile, rawStore: r.rawStoreForRole(role.id), reserveEvidence: q => r.reserveEvidence(role.id, q), retainResponse: (id, bytes) => r.retainResponse(id, bytes), transport: { id: 'transport', key: Buffer.alloc(32, 10) }, maxResponseBytes: rp.maxResponseBytes });
    r.captureApplication(role.id, { store, config }, accounting);
  } };
  t.after(() => { for (const store of stores.values()) store.close(); state.close(); raw.close(); rmSync(directory, { recursive: true, force: true }); });
  return { ...f, raw, state, original, stores, options, accept, initial, claim: () => DevelopmentAcquisitionRecorder.claim(options) };
}

function fixture(t: TestContext, profile: 'snapshot' | 'paged') {
  const f = profile === 'snapshot' ? snapshotFixture(t) : pagedRecorderFixture(t, true);
  const directory = mkdtempSync(join(tmpdir(), 'aeon-current-custodian-'));
  const store = new OperationalStore({ filename: join(directory, 'custodian.sqlite') }); chmodSync(store.filename, 0o600);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const value = { version: 1 as const, id: 'owner-fence-retention', attemptDigest: identity(f.m), sourceDigest: retentionSourceDigest(f.plan), rawStoreDigest: identity(f.plan.rawStore), custodianId: 'owner-fence-custodian', purpose: 'bounded synthetic fence checks', audiences: [`principal:${f.m.observerId}`, ...f.roles.map(r => `provider:${r.profile?.provider ?? 'mistral'}`), ...f.roles.filter(r => r.kind === 'reviewer').map(r => `reviewer:${r.assignmentId}`)].filter((v, i, all) => all.indexOf(v) === i), dataScope: 'complete-operational-role-sources' as const, retention: 'independent-indefinite' as const, withdrawal: 'stop-use-retain-originals' as const };
  f.plan.retention = signDocument(evidenceRetentionDomain, value, 'issuer', f.f.keys.get('issuer')!);
  f.trust.retention = { acceptedGrantDigest: identity(value), issuers: f.f.trust.issuers, custodianSigner: 'issuer', custodianKey: f.f.keys.get('issuer')! };
  f.options.custodian = { store, key: value.custodianId };
  const writeDisposition = (status: 'active' | 'withdrawn' | 'destruction-pending') => {
    const row = store.get('development.evidence-custodian', value.custodianId);
    store.put('development.evidence-custodian', value.custodianId, signDocument(evidenceCustodianDomain, { version: 1, grantDigest: identity(value), attemptDigest: identity(f.m), custodianId: value.custodianId, status }, 'issuer', f.f.keys.get('issuer')!), row?.revision ?? null);
  };
  writeDisposition('active'); f.accept();
  f.stores.get('no-memory')!.put('memory', 'withdraw-target', { retained: true }, null);
  const recorder = f.claim(); f.initial(recorder);
  return { ...f, recorder, custodian: store, writeDisposition };
}

for (const profile of ['snapshot', 'paged'] as const) {
  test(`${profile} callback fences owner, custodian, original and captured sources before byte release`, t => {
    const f = fixture(t, profile), before = identity(f.recorder.status().inventory), entry = f.recorder.status().inventory[0]!;
    for (const store of [f.state, f.custodian, f.original.store, f.stores.get('no-memory')!]) {
      let released: Uint8Array | undefined;
      assert.throws(() => f.recorder.withEvidenceRead(read => {
        store.put('forbidden', 'callback-write', true, null); released = read(entry.artifact, entry.bytes);
      }), /source writes forbidden/);
      assert.equal(released, undefined); assert.equal(store.get('forbidden', 'callback-write'), undefined);
    }
    assert.throws(() => f.recorder.withEvidenceRead(read => { f.recorder.withdrawAttemptUse('inside-owner-callback'); return read(entry.artifact, entry.bytes); }), /source writes forbidden/);
    assert.equal(f.recorder.status().useDisposition, null); assert.equal(identity(f.recorder.status().inventory), before);
    assert.equal(f.recorder.withEvidenceRead(read => read(entry.artifact, entry.bytes)).byteLength, entry.bytes);
  });

  test(`${profile} current-use permits nested reads and restores stores after callback refusal`, t => {
    const f = fixture(t, profile), error = new Error('owner-callback-error');
    f.recorder.withCurrentUse(() => {
      assert.ok(f.state.transaction(() => f.state.get('development.acquisition', f.plan.id)));
      assert.equal(f.original.store.transaction(() => f.original.snapshot(f.registration.rootId)).cancelled, false);
      assert.throws(() => f.recorder.withCurrentUse(() => assert.fail('reentry')), /reentrant|Owner writer transaction/);
    });
    assert.throws(() => f.recorder.withCurrentUse(() => { throw error; }), value => value === error);
    assert.throws(() => f.recorder.withCurrentUse(() => ({ then() { assert.fail('then invoked'); } })), /synchronous/);
    for (const store of [f.state, f.custodian, f.original.store]) { assert.equal(store.transactionActive, false); store.put('ordinary', 'after-callback', true, null); }
    assert.equal(f.recorder.status().useDisposition, null); f.recorder.assertCurrentUse();
  });

  test(`${profile} provider promise begins synchronously and settles with owner writes outside guard`, async t => {
    const f = fixture(t, profile); let pending: Promise<void> | undefined;
    f.recorder.withCurrentUse(() => { pending = Promise.resolve().then(() => { f.state.put('ordinary', 'settlement', true, null); f.original.store.put('ordinary', 'late-settlement', true, null); }); });
    await pending; assert.ok(f.state.get('ordinary', 'settlement'));
    const artifact = f.recorder.rawStoreForRole('no-memory').putBytes(Buffer.from('new retained bytes after guard'));
    assert.equal(f.recorder.readArtifact(artifact, 100).toString(), 'new retained bytes after guard');
  });

  test(`${profile} custodian withdrawal between entry checks persists after read fences exit`, t => {
    const f = fixture(t, profile); let called = false;
    // Commit the disposition after the initial authority check, immediately
    // before this store participates in the guard's first transaction.
    const originalCustodianFence = f.custodian.withDevelopmentReadOnly.bind(f.custodian);
    const originalTransaction = f.custodian.transaction.bind(f.custodian);
    if (profile === 'snapshot') f.custodian.transaction = use => { f.custodian.transaction = originalTransaction; f.writeDisposition('withdrawn'); return originalTransaction(use); };
    else f.custodian.withDevelopmentReadOnly = use => { f.writeDisposition('withdrawn'); return originalCustodianFence(use); };
    assert.throws(() => f.recorder.withCurrentUse(() => { called = true; }), /withdrawn/);
    f.custodian.withDevelopmentReadOnly = originalCustodianFence; f.custodian.transaction = originalTransaction;
    assert.equal(called, false); assert.equal(f.recorder.status().useDisposition!.value.status, 'withdrawn');
    assert.equal(f.state.transactionActive, false); assert.equal(f.custodian.transactionActive, false);
    assert.throws(() => f.recorder.assertCurrentUse(), /withdrawn/);
  });

  test(`${profile} prior source withdrawal stops callback and retains a durable terminal marker`, t => {
    const f = fixture(t, profile); let called = false; const inventory = identity(f.recorder.status().inventory);
    f.stores.get('no-memory')!.withdrawDocumentJournalContent({ id: 'owner-fence-source-withdrawal', reason: 'forget', targets: [{ namespace: 'memory', key: 'withdraw-target', expectedRevision: 1 }] });
    assert.throws(() => f.recorder.withCurrentUse(() => { called = true; }), /document-history-withdrawn/);
    assert.equal(called, false); assert.equal(f.recorder.status().useDisposition!.value.status, 'document-history-withdrawn');
    assert.equal(identity(f.recorder.status().inventory), inventory);
  });

  test(`${profile} source withdrawal at guard entry persists its marker after guard rollback`, t => {
    const f = fixture(t, profile), source = f.stores.get('no-memory')!; let called = false;
    const withdraw = () => source.withdrawDocumentJournalContent({ id: 'entry-source-withdrawal', reason: 'forget', targets: [{ namespace: 'memory', key: 'withdraw-target', expectedRevision: 1 }] });
    const transaction = source.transaction.bind(source), versions = source.withDevelopmentVersionsAvailable.bind(source);
    if (profile === 'snapshot') source.transaction = use => { source.transaction = transaction; withdraw(); return transaction(use); };
    else source.withDevelopmentVersionsAvailable = (input, use) => { source.withDevelopmentVersionsAvailable = versions; withdraw(); return versions(input, use); };
    assert.throws(() => f.recorder.withCurrentUse(() => { called = true; }), /document-history-withdrawn/);
    source.transaction = transaction; source.withDevelopmentVersionsAvailable = versions;
    assert.equal(called, false); assert.equal(f.recorder.status().useDisposition!.value.status, 'document-history-withdrawn');
    assert.equal(source.transactionActive, false); assert.equal(f.state.transactionActive, false);
  });
}

test('snapshot current-use fences the original ledger even before a source capture exists', t => {
  const f = snapshotFixture(t), recorder = f.claim();
  assert.throws(() => recorder.withCurrentUse(() => f.original.store.put('forbidden', 'uncaptured-original', true, null)), /source writes forbidden/);
  assert.equal(f.original.store.get('forbidden', 'uncaptured-original'), undefined);
  assert.equal(recorder.status().useDisposition, null);
});
