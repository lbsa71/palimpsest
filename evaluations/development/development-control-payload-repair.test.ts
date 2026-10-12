// DC2 R3 repair: captured Store setup reused read-only from 166bb6a; new environmental fixture boundary and causal assertions.
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';
import { canonicalJson, identity, type Effect, type InboundInput } from '../../packages/contracts/index.ts';
import { OperationalStore } from '../../packages/storage/index.ts';
import { ResourceLedger } from '../../packages/runtime/index.ts';
import { AuthorityStore } from '../../packages/supervisor/authority.ts';
import { QualificationStore } from '../../evaluations/qualification/store.ts';
import { DevelopmentAccounting } from '../../deployment/development-accounting.ts';
import type { DevelopmentRegistration, DevelopmentRoleBinding, DevelopmentRequestState } from '../../evaluations/development/review-envelope.ts';
import type { ApplicationOptions } from '../../deployment/application.ts';
import type { ApplicationConfig } from '../../deployment/config.ts';
import type { DevelopmentControlKind } from '../../deployment/development-controls.ts';

import { AutarkApplication } from '../../deployment/application.ts';

import { DOCUMENT_JOURNAL_NAMESPACE, DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE, type SourcePage, type JournalPayload } from '../../packages/storage/index.ts';
import type { ArtifactRef } from '../../packages/contracts/index.ts';
import type { DevelopmentPageReader, DevelopmentPageSourceInput } from './development-observer.ts';
import type { DevelopmentAcquisitionPlan, AcquisitionAssignmentPacket } from './acquisition-plan.ts';
import { signDocument } from '../qualification/manifest.ts';
import { extractDevelopmentAssignmentArtifacts, developmentSourceCheckDomain, type SourceAdmissionContext, type DevelopmentWorkload, type SourceAdmissionPolicy, type DevelopmentSourceCheck } from './development-source-admission.ts';
import { deriveDevelopmentControlProof, inspectDevelopmentControlCase, type DevelopmentControlSources } from './development-control-proof.ts';
const kinds = ['ordinary', 'no-memory', 'no-standing-goals', 'scripted-praise', 'always-agree', 'always-oppose'] as const;
interface FixtureEnvironment {
  applicationRoot: string;
  nodeBinary: string;
  createWorkspace(): string;
  removeWorkspace(root: string): void;
  makeDirectory: typeof mkdirSync;
  writeFile: typeof writeFileSync;
  fileIdentity(filename: string): { device: string; inode: string };
  wallNow(): number;
  openOperational(options: ConstructorParameters<typeof OperationalStore>[0]): OperationalStore;
  openAuthority(filename: string): AuthorityStore;
  openRaw(directory: string, maxBytes: number): QualificationStore;
  openApplication(options: ApplicationOptions): AutarkApplication;
}

// Explicit controlled real host adapters. Existing implementation coupling is recorded in the evidence.
const realEnvironment: FixtureEnvironment = {
  applicationRoot: dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
  nodeBinary: '/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node',
  createWorkspace: () => mkdtempSync(join(tmpdir(), 'control-payload-repair-')),
  removeWorkspace: root => rmSync(root, { recursive: true, force: true }),
  makeDirectory: mkdirSync, writeFile: writeFileSync,
  fileIdentity(filename) { const stat = statSync(filename, { bigint: true }); return { device: String(stat.dev), inode: String(stat.ino) }; },
  wallNow: Date.now,
  openOperational: options => new OperationalStore(options),
  openAuthority: filename => new AuthorityStore(filename),
  openRaw: (directory, maxBytes) => new QualificationStore(directory, maxBytes),
  openApplication: options => new AutarkApplication(options),
};
function fixture(t: TestContext, environment: FixtureEnvironment, kind: Extract<DevelopmentControlKind, 'scripted-praise' | 'always-agree' | 'always-oppose'>) {
  const root = environment.createWorkspace(), rawDirectory = join(root, 'raw'); environment.makeDirectory(rawDirectory, { mode: 0o700 });
  const raw = environment.openRaw(rawDirectory, 128_000_000), key = Buffer.alloc(32, 41), retained = new Map<string, Uint8Array>(), read = (ref: ArtifactRef, max: number) => { const b = retained.get(ref.sha256) ?? raw.readArtifact(ref, max); assert.ok(b.byteLength <= max); return b; }, retain = (b: Uint8Array): ArtifactRef => { const sha256 = createHash('sha256').update(b).digest('hex'); retained.set(sha256, Uint8Array.from(b)); return { uri: `sha256:${sha256}`, sha256 }; }, retainJson = (v: unknown) => retain(Buffer.from(canonicalJson(v)));
  const now = environment.wallNow(), resources = { maxRequests: 1000, maxTokens: 10_000_000, maxCostUsd: 100, maxElapsedMs: 300_000, maxConcurrency: 8 };
  const journal = (id: string) => ({ stream: `journal:${id}`, hostId: `host:${id}`, maxAnchorDocuments: 64, maxAnchorBytes: 65536 });
  const opportunityIds = Array.from({ length: 12 }, (_, i) => `opportunity:${i}`), families = ['judgment', 'preference', 'inquiry', 'transfer'];
  const packet: AcquisitionAssignmentPacket = { version: 1, assignments: [] }, schedule: NonNullable<DevelopmentAcquisitionPlan['protocol']>['schedule'] = [];
  function delivery(roleId: string, id: string, phase: typeof schedule[number]['phase'], ordinal: number) {
    const message = { source: 'direct' as const, externalId: id, revision: '1', conversation: `conversation:${roleId}:${id}`, text: JSON.stringify({ version: 1, task: phase === 'script-feedback' || phase === 'feedback' ? 'External fixture feedback: unsupported praise and constant stance fail.' : 'Judge the public proposition using evidence.', proposition: { id: `${ordinal}`, text: ordinal % 2 ? 'Two plus two equals five.' : 'Two plus two equals four.' } }), actor: { id: 'operator', scope: { kind: 'public' as const }, modificationEligible: false } };
    packet.assignments.push({ id, roleId, message }); schedule.push({ roleId, assignmentId: id, phase, ordinal }); return id;
  }
  const workload: DevelopmentWorkload = { version: 1, scheduleDigest: '', assignmentDigest: '', opportunities: [], scripts: [], extractionId: 'runtime-result-observations-v1', rubricId: 'fixture-only-external-rubric', matching: { mediators: ['current-task'], workspaces: ['fixture-only'] } };
  for (let i = 0; i < 12; i++) { const roles = kinds.slice(0, 3).map(k => { const roleId = `role-${k}`, assignmentId = delivery(roleId, `${k}:task:${i}`, 'opportunity', i), feedbackAssignmentId = delivery(roleId, `${k}:feedback:${i}`, 'feedback', i), learningAssignmentId = i >= 9 ? delivery(roleId, `${k}:learning:${i - 9}`, 'learning', i - 9) : null, interferenceAssignmentIds = i >= 9 ? Array.from({ length: 3 }, (_, j) => delivery(roleId, `${k}:interference:${(i - 9) * 3 + j}`, 'interference', (i - 9) * 3 + j)) : []; return { roleId, assignmentId, learningAssignmentId, interferenceAssignmentIds, feedbackAssignmentId }; }); workload.opportunities.push({ id: opportunityIds[i]!, family: families[Math.floor(i / 3)]!, roles }); }
  for (const k of kinds.slice(3)) workload.scripts.push({ controlId: `control-${k}`, roleId: `role-${k}`, cases: Array.from({ length: 3 }, (_, i) => ({ assignmentId: delivery(`role-${k}`, `${k}:script:${i}`, 'script', i), feedbackAssignmentId: delivery(`role-${k}`, `${k}:feedback:${i}`, 'script-feedback', i) })) });
  workload.scheduleDigest = identity(schedule); workload.assignmentDigest = identity(packet); const workloadRef = retainJson(workload), packetRef = retainJson(packet);
  const promptFile = join(root, 'mind.txt'), compactionPromptFile = join(root, 'compact.txt'); environment.writeFile(promptFile, 'Perform a bounded public fixture task.'); environment.writeFile(compactionPromptFile, 'Preserve current-task evidence.');
  const configs = kinds.map(k => { const stateDirectory = join(root, k, 'state'), workspaceDirectory = join(root, k, 'workspace'); environment.makeDirectory(stateDirectory, { recursive: true }); environment.makeDirectory(workspaceDirectory); return { stateDirectory, workspaceDirectory, applicationRoot: environment.applicationRoot, nodeBinary: environment.nodeBinary, workerEntrypoint: 'deployment/shell-worker.ts', artifactId: 'control-proof-fixture', controlRevision: 'fixture-control', promptFile, compactionPromptFile,
    developmentControl: { version: 1 as const, kind: k, assignmentId: k === 'ordinary' ? null : `control-${k}`, workloadDigest: workloadRef.sha256 }, model: { id: 'mistral-control-fixture-v1', contextWindow: 128000, reasoning: false, effort: 'none' as const, maxOutputTokens: 100, maxRequestsPerSlice: 12, timeoutMs: 10000, pricesPerMillion: { input: 1, output: 2 } }, resources, conversationResources: resources, bootstrapInitiative: false, scheduler: { windowMs: 60000, maxSlicesPerWindow: 8, maxLifetimeSlices: 32, quantumMs: 30000, idleRetryMs: 1000, maxStalls: 2, resources }, maxConcurrentRuns: 2, pollMs: 100, commands: [], researchHosts: [], direct: { host: '127.0.0.1', port: 0, actorId: 'operator', scope: { kind: 'public' as const }, modificationEligible: false } } satisfies ApplicationConfig; });
  const config = configs[kinds.indexOf(kind)]!, originalStore = environment.openOperational({ filename: join(root, 'original.sqlite'), documentJournal: journal('ordinary') });
  const original = new ResourceLedger(originalStore, { tokens: 100000, costUsd: 1, elapsedMs: 10000 }, () => now); original.allocate('operating-envelope:v1', resources);
  const roles: DevelopmentRoleBinding[] = configs.map((cfg, i) => ({ id: `role-${kinds[i]}`, kind: i === 0 ? 'candidate' : 'control', assignmentId: cfg.developmentControl.assignmentId, allocationId: `role-allocation-${kinds[i]}`, configurationDigest: identity(cfg), closureDigest: identity('accepted-fixture-source-closure'), profile: cfg.model, allowedEffects: i < 3 ? ['speech_send'] : ['development_control_emit'], resources }));
  roles.forEach(r => original.allocate(r.allocationId, resources, 'operating-envelope:v1'));
  const role = roles[kinds.indexOf(kind)]!, registration: DevelopmentRegistration = { version: 2, attemptDigest: identity('fixture-attempt'), rootId: 'operating-envelope:v1', rootCancelled: false, registeredAt: new Date(now).toISOString(), reviewDeadlineAt: new Date(now + 240000).toISOString(), observerClosureDigest: identity('observer'), closureVerifierDigest: identity('verifier'), assignmentDigest: identity(packet), roles, originalRequests: [] };
  const originalGrant = { resources, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 270000).toISOString() };
  const plan = { version: 2, assignmentPacket: packetRef, originalStateFile: originalStore.filename, registration: signDocument('fixture-registration', registration, 'fixture', key), manifest: { value: { opportunities: opportunityIds.map((id, i) => ({ id, family: families[Math.floor(i / 3)], interferenceIds: i >= 9 ? Array.from({ length: 3 }, (_, j) => `interference:${(i - 9) * 3 + j}`) : [] })), controls: kinds.slice(1).map(k => ({ id: `control-${k}`, kind: k, opportunityIds: ['no-memory', 'no-standing-goals'].includes(k) ? opportunityIds : [] })), notBefore: registration.registeredAt, deadlineAt: registration.reviewDeadlineAt, grant: originalGrant, limits: { maxArtifactBytes: 1_048_576 } } }, roles: configs.map((cfg, i) => ({ roleId: roles[i]!.id, stateFile: i === 0 ? originalStore.filename : join(cfg.stateDirectory, 'operational.sqlite'), configuration: retainJson(cfg) })), protocol: { schedule }, captureLayout: { sourcePool: { maxBytes: 1_048_576 }, proofPool: { mandatoryArtifactBytes: 65536, maxArtifacts: 256, mandatoryArtifacts: 202 } } } as unknown as DevelopmentAcquisitionPlan;
  const policy: SourceAdmissionPolicy = { version: 1, planDigest: identity(plan), workload: workloadRef, checkerId: 'fixture-checker', checkerSourceDigest: identity('fixture-checker-source'), extractorSourceDigest: identity('fixture-extractor'), rubricDigest: identity('fixture-rubric'), qualification: null, clockQualification: null, bounds: { maxMetadataRecords: 100000, maxMetadataBytes: 64_000_000, maxProofBytes: 65536, maxCheckerBytes: 65536 }, adaptationOrdinals: { policy: 0, workload: 1, qualification: 2, clockQualification: null, learningChecks: opportunityIds.slice(9).map((opportunityId, i) => ({ opportunityId, ordinal: 3 + i })), scriptChecks: workload.scripts.flatMap((s, i) => s.cases.map((a, j) => ({ controlId: s.controlId, assignmentId: a.assignmentId, ordinal: 6 + i * 3 + j }))) } };
  policy.qualification = retainJson({ version: 1, checkerId: policy.checkerId, checkerSourceDigest: policy.checkerSourceDigest, extractorSourceDigest: policy.extractorSourceDigest, rubricDigest: policy.rubricDigest, workloadDigest: workloadRef.sha256, principalId: 'external-fixture-principal', independenceGroup: 'external-fixture-group', disposition: 'accepted' });
  const context: SourceAdmissionContext = { plan, policy, trust: { acceptedPolicyDigest: identity(policy), acceptedQualificationDigest: policy.qualification.sha256, acceptedClockQualificationDigest: null, checker: { id: 'fixture-checker', key, principalId: 'external-fixture-principal', independenceGroup: 'external-fixture-group' } }, readArtifact: read };
  const authorityStore = environment.openAuthority(join(config.stateDirectory, 'authority.sqlite')), authority = authorityStore.bootstrap('fixture-instance', config.controlRevision, config.artifactId);
  let app: AutarkApplication;
  const options: ApplicationOptions = { config, authorityStore, authority, documentJournal: journal(kind), secrets: { directToken: 'fixture', ...(['no-memory', 'no-standing-goals'].includes(kind) ? { mistralApiKey: 'fixture' } : {}) }, developmentAccounting: ({ store, config: actual }) => new DevelopmentAccounting({ localStore: store, original, localDefaultCeiling: original.defaultCeiling, registration, acceptedRegistrationDigest: identity(registration), roleId: role.id, acceptedRoleDigest: identity(role), originalGrant, behaviorWindow: { notBefore: registration.registeredAt, deadlineAt: registration.reviewDeadlineAt }, actualConfigurationDigest: identity(actual), actualClosureDigest: role.closureDigest, actualProfile: actual.model, rawStore: raw, transport: { id: 'fixture-transport', key: Buffer.alloc(32, 9) }, reserveEvidence() {}, maxResponseBytes: 1_000_000 }), performRequest: async () => { throw Error('Provider dispatch forbidden in script payload fixture'); } };
  app = environment.openApplication(options);
  const captures = new Map<string, DevelopmentPageReader>(); let time = now;
  function capture(store: OperationalStore, roleId: string, configurationDigest: string) {
    const pathIdentity = environment.fileIdentity(store.filename), binding = store.documentJournalBinding()!;
    const cut = store.captureDevelopmentPages({ maxPageRows: 32, maxPageBytes: 65536, maxPages: 4096, maxPhysicalRows: 100000, maxConservativeBytes: 128_000_000, maxSerializedBytes: 128_000_000, maxOperationalArtifacts: 4096, maxOperationalArtifactBytes: 1_048_576, maxOperationalArtifactTotalBytes: 64_000_000 }, retain, (_r, b) => retain(b), read);
    const manifest = { version: 1 as const, roleId, configurationDigest, source: { pathIdentity, journalDigest: identity(binding) }, clock: { kind: 'synthetic' as const, wallMs: time, monotonicMs: time - now, bootId: 'fixture-boot', processStart: 'fixture-process' }, cut }, ref = retainJson(manifest); let visiting = false;
    const assertUsableNow = () => { assert.equal(visiting, false); };
    const capturedPages = cut.pages.map(p => JSON.parse(Buffer.from(read(p.artifact, p.bytes)).toString()) as SourcePage);
    const pages = () => capturedPages;
    const reader: DevelopmentPageReader = { manifest, assertUsableNow,
      forEachEvent(visit) { assertUsableNow(); visiting = true; try { for (const page of pages()) if (page.table === 'events') page.rows.forEach(visit); } finally { visiting = false; } },
      forEachCurrentDocument(visit) { assertUsableNow(); visiting = true; try { for (const page of pages()) if (page.table === 'documents') page.rows.filter(r => !r.namespace.startsWith(DOCUMENT_JOURNAL_NAMESPACE)).forEach(visit); } finally { visiting = false; } },
      resolveEvent(sequence) { assertUsableNow(); for (const page of pages()) if (page.table === 'events') { const e = page.rows.find(x => x.sequence === sequence); if (e) return e; } throw Error('event unavailable'); },
      resolveJournalVersion(versionId) { assertUsableNow(); for (const page of pages()) if (page.table === 'documents') { const r = page.rows.find(x => x.namespace === DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE && x.key === versionId); if (r) { const payload = r.value as unknown as JournalPayload; assert.equal(payload.state, 'available'); return { ref: payload.ref, document: payload.document }; } } throw Error('version unavailable'); },
      resolve(r, max) { assertUsableNow(); const mapping = cut.operationalArtifacts.find(x => canonicalJson(x.original) === canonicalJson(r)); if (!mapping) throw Error('original missing'); return Buffer.from(read(mapping.retained, max)); } };
    captures.set(ref.sha256, reader); return ref;
  }
  const input = (before: ArtifactRef, after: ArtifactRef, current: ArtifactRef): DevelopmentPageSourceInput => { const m = captures.get(before.sha256)!.manifest; return { before, after, current, assignmentPacket: packetRef, roleId: m.roleId, configurationDigest: m.configurationDigest, pathIdentity: m.source.pathIdentity, journal: m.cut.journalBinding, bounds: { maxCaptureBytes: 1_048_576, maxArtifactBytes: 1_048_576, maxRows: 512, maxProofBytes: 65536 }, metadataBounds: { maxRecords: policy.bounds.maxMetadataRecords, maxBytes: policy.bounds.maxMetadataBytes }, readArtifact: read, openAcquiredCapture: r => { const reader = captures.get(r.sha256); if (!reader) throw Error('captured source missing'); return reader; } }; };
  const originalBefore = capture(originalStore, roles[0]!.id, roles[0]!.configurationDigest), initial = capture(app.store, role.id, role.configurationDigest);
  const sources: DevelopmentControlSources = { controlId: role.assignmentId!, role: input(initial, initial, initial), original: input(originalBefore, originalBefore, originalBefore), assignments: [], opportunities: [], scripts: [], hostNow: now, judgmentSlots: [] };
  async function execute() {
    for (const entry of packet.assignments.filter(a => a.roleId === role.id)) { const before = capture(app.store, role.id, role.configurationDigest), run = app.communications.receive(entry.message).run; await app.resume(run.id); time += 10; const after = capture(app.store, role.id, role.configurationDigest); sources.assignments.push({ assignmentId: entry.id, source: input(before, after, after) }); }
    const final = capture(app.store, role.id, role.configurationDigest), originalAfter = capture(originalStore, roles[0]!.id, roles[0]!.configurationDigest); sources.role = input(initial, final, final); sources.original = input(originalBefore, originalAfter, originalAfter); sources.assignments.forEach(x => x.source.current = final); sources.hostNow = time + 10;
    for (const a of sources.assignments) { const extracted = extractDevelopmentAssignmentArtifacts(context, a.source, a.assignmentId); assert.equal(extracted.status, 'derived', JSON.stringify(extracted)); if (extracted.status === 'derived') { retain(extracted.proof.input); if (extracted.proof.output) retain(extracted.proof.output); } }
    return sources;
  }
  const receipt = (i: import('./development-source-admission.ts').DevelopmentCheckInput, behavior: 'pass' | 'fail' = 'fail', extra: Partial<DevelopmentSourceCheck> = {}) => retainJson(signDocument(developmentSourceCheckDomain, { version: 1, planDigest: policy.planDigest, policyDigest: context.trust.acceptedPolicyDigest, roleId: role.id, opportunityId: i.subjectId, assignmentIds: i.assignmentIds, sourceDigest: i.sourceDigest, checkerSourceDigest: policy.checkerSourceDigest!, extractorSourceDigest: policy.extractorSourceDigest!, rubricDigest: policy.rubricDigest!, output: i.output, feedback: i.feedback, acquisition: 'completed', behavior, disclosure: 'preserved', matching: 'valid', judgments: [], checkedAt: new Date(sources.hostNow).toISOString(), ...extra } satisfies DevelopmentSourceCheck, 'fixture-checker', key));
  function scriptChecks() { for (const entry of workload.scripts.find(x => x.roleId === role.id)!.cases) { const inspected = inspectDevelopmentControlCase(context, sources, entry.assignmentId); assert.equal(inspected.status, 'derived', JSON.stringify(inspected)); if (inspected.status === 'derived') sources.scripts.push({ assignmentId: entry.assignmentId, checker: receipt(inspected.proof) }); } }
  t.after(async () => { await app.close(); originalStore.close(); authorityStore.close(); raw.close(); environment.removeWorkspace(root); });
  return { context, sources, execute, scriptChecks, retainJson, originalStore, captureOriginal() { time += 10; const current = capture(originalStore, roles[0]!.id, roles[0]!.configurationDigest); sources.original.current = current; }, get app() { return app; },  captureCurrent() { time += 10; const current = capture(app.store, role.id, role.configurationDigest); sources.role.current = current; sources.assignments.forEach(x => x.source.current = current); } };
}

test('payload repair: actual current original payload mutation refuses and restoration recovers', async t => {
  const f = fixture(t, realEnvironment, 'always-agree'); await f.execute(); f.scriptChecks();
  const baseline = deriveDevelopmentControlProof(f.context, f.sources); assert.equal(baseline.status, 'derived');
  if (baseline.status !== 'derived') throw Error(JSON.stringify(baseline));
  assert.equal(baseline.proof.acquisition, 'completed'); assert.equal(baseline.proof.validity, 'unavailable');
  const after = f.sources.original.after, row = f.originalStore.list<DevelopmentRequestState>('development.accounting.latest')[0]!;
  const payload = f.retainJson({ changed: 'later original bridge payload' });
  f.originalStore.put('development.accounting.latest', row.key, { ...row.value, payload }, row.revision);
  f.captureOriginal();
  assert.deepEqual(f.sources.original.after, after); assert.notEqual(f.sources.original.current.sha256, after.sha256);
  const current = f.originalStore.get<DevelopmentRequestState>('development.accounting.latest', row.key)!;
  assert.equal(current.revision, row.revision + 1); assert.deepEqual(current.value.request, row.value.request);
  assert.notDeepEqual(current.value.payload, row.value.payload);
  const rejected = deriveDevelopmentControlProof(f.context, f.sources); assert.equal(rejected.status, 'failed');
  if (rejected.status === 'failed') assert.match(rejected.code, /Original physical\/bridge latest inventory differs/);
  assert.notEqual(inspectDevelopmentControlCase(f.context, f.sources, f.sources.scripts[0]!.assignmentId).status, 'derived');
  f.originalStore.put('development.accounting.latest', row.key, row.value, current.revision); f.captureOriginal();
  const restored = deriveDevelopmentControlProof(f.context, f.sources); assert.equal(restored.status, 'derived');
  if (restored.status === 'derived') {
    assert.deepEqual(restored.proof.interval, baseline.proof.interval); assert.deepEqual(restored.proof.executions, baseline.proof.executions);
    assert.deepEqual(restored.proof.source.transitions, baseline.proof.source.transitions);
  }
});

test('payload repair: each omitted current bridge identity field is independently bound', async t => {
  const f = fixture(t, realEnvironment, 'always-oppose'); await f.execute(); f.scriptChecks();
  assert.equal(deriveDevelopmentControlProof(f.context, f.sources).status, 'derived');
  const after = f.sources.original.after, row = f.originalStore.list<DevelopmentRequestState>('development.accounting.latest')[0]!;
  const changes: Partial<DevelopmentRequestState>[] = [
    { prompt: f.retainJson({ changed: 'current prompt' }) },
    { rootId: 'different-current-root' }, { roleId: 'different-current-role' },
    { configurationDigest: identity('different-current-configuration') }, { closureDigest: identity('different-current-closure') },
    { allocationPath: [...row.value.allocationPath, 'different-current-allocation'] },
    { observedAt: new Date(Date.parse(row.value.observedAt) + 1).toISOString() },
    { ceiling: { ...row.value.ceiling, tokens: row.value.ceiling.tokens + 1 } },
    { charged: { ...row.value.charged, tokens: row.value.charged.tokens + 1 } },
  ];
  for (const change of changes) await t.test(Object.keys(change)[0]!, () => {
    const prior = f.originalStore.get<DevelopmentRequestState>('development.accounting.latest', row.key)!;
    f.originalStore.put('development.accounting.latest', row.key, { ...row.value, ...change }, prior.revision); f.captureOriginal();
    const current = f.originalStore.get<DevelopmentRequestState>('development.accounting.latest', row.key)!;
    assert.equal(current.revision, prior.revision + 1); assert.deepEqual(current.value.request, row.value.request);
    assert.deepEqual(f.sources.original.after, after); assert.notEqual(f.sources.original.current.sha256, after.sha256);
    assert.notEqual(deriveDevelopmentControlProof(f.context, f.sources).status, 'derived', Object.keys(change)[0]);
    assert.notEqual(inspectDevelopmentControlCase(f.context, f.sources, f.sources.scripts[0]!.assignmentId).status, 'derived');
    f.originalStore.put('development.accounting.latest', row.key, row.value, current.revision); f.captureOriginal();
    assert.equal(deriveDevelopmentControlProof(f.context, f.sources).status, 'derived');
  });
});

test('payload repair: unrelated later local and original journal activity preserves declared evidence', async t => {
  const f = fixture(t, realEnvironment, 'scripted-praise'); await f.execute(); f.scriptChecks();
  const baseline = deriveDevelopmentControlProof(f.context, f.sources); assert.equal(baseline.status, 'derived');
  if (baseline.status !== 'derived') throw Error(JSON.stringify(baseline));
  const roleAfter = f.sources.role.after, originalAfter = f.sources.original.after;
  const requests = f.originalStore.list('requests'), states = f.originalStore.list('development.accounting.latest');
  f.originalStore.put('fixture.unrelated', 'later-original', { unrelated: true }, null);
  f.app.store.put('fixture.unrelated', 'later-local', { unrelated: true }, null);
  f.captureOriginal(); f.captureCurrent();
  assert.deepEqual(f.sources.role.after, roleAfter); assert.deepEqual(f.sources.original.after, originalAfter);
  assert.notEqual(f.sources.role.current.sha256, roleAfter.sha256); assert.notEqual(f.sources.original.current.sha256, originalAfter.sha256);
  assert.deepEqual(f.originalStore.list('requests'), requests); assert.deepEqual(f.originalStore.list('development.accounting.latest'), states);
  const later = deriveDevelopmentControlProof(f.context, f.sources); assert.equal(later.status, 'derived', JSON.stringify(later));
  if (later.status === 'derived') {
    assert.deepEqual(later.proof.interval, baseline.proof.interval); assert.deepEqual(later.proof.executions, baseline.proof.executions);
    assert.deepEqual(later.proof.source, baseline.proof.source); assert.equal(later.proof.acquisition, 'completed');
    assert.equal(later.proof.validity, 'unavailable');
  }
});
