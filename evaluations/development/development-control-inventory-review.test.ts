// Independent R4 review. Frozen controlled-real fixture plumbing only is reused; held-out assertions follow.
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';
import { canonicalJson, identity, type Effect, type InboundInput, type PhysicalRequest } from '../../packages/contracts/index.ts';
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
  createWorkspace: () => mkdtempSync(join(tmpdir(), 'control-inventory-review-')),
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
  const peers: AutarkApplication[] = [];
  function peer(kind: DevelopmentControlKind) {
    const config = configs[kinds.indexOf(kind as typeof kinds[number])]!, peerRole = roles[kinds.indexOf(kind as typeof kinds[number])]!;
    const authorityStore = environment.openAuthority(join(config.stateDirectory, 'authority.sqlite'));
    const authority = authorityStore.bootstrap('fixture-instance', config.controlRevision, config.artifactId);
    const peer = environment.openApplication({ ...options, config, authorityStore, authority, documentJournal: journal(kind), developmentAccounting: ({ store, config: actual }) => new DevelopmentAccounting({ localStore: store, original, localDefaultCeiling: original.defaultCeiling, registration, acceptedRegistrationDigest: identity(registration), roleId: peerRole.id, acceptedRoleDigest: identity(peerRole), originalGrant, behaviorWindow: { notBefore: registration.registeredAt, deadlineAt: registration.reviewDeadlineAt }, actualConfigurationDigest: identity(actual), actualClosureDigest: peerRole.closureDigest, actualProfile: actual.model, rawStore: raw, transport: { id: 'fixture-transport', key: Buffer.alloc(32, 9) }, reserveEvidence() {}, maxResponseBytes: 1_000_000 }) });
    peers.push(peer); t.after(() => authorityStore.close());
    return { app: peer, assignment: packet.assignments.find(a => a.roleId === peerRole.id)! };
  }
  t.after(async () => { for (const peer of peers) await peer.close(); await app.close(); originalStore.close(); authorityStore.close(); raw.close(); environment.removeWorkspace(root); });
  return { context, sources, execute, scriptChecks, peer, retainJson, originalStore, original, captureOriginal(asAfter = false) { time += 10; const current = capture(originalStore, roles[0]!.id, roles[0]!.configurationDigest); sources.original.current = current; if (asAfter) sources.original.after = current; }, get app() { return app; }, async reopen() { await app.close(); app = environment.openApplication(options); }, captureCurrent() { time += 10; const current = capture(app.store, role.id, role.configurationDigest); sources.role.current = current; sources.assignments.forEach(x => x.source.current = current); } };
}

type Fixture = ReturnType<typeof fixture>;
type Binding = { localId: string; parentRunId: string; envelope: import('../../packages/contracts/index.ts').ResourceEnvelope; roleId: string; registrationDigest: string };
type Allocation = { rootId: string; parentRunId?: string; envelope: Binding['envelope'] };
const bindings = 'development.accounting.allocations', bridges = 'development.accounting.latest';
function outcomes(f: Fixture) { return [deriveDevelopmentControlProof(f.context, f.sources), inspectDevelopmentControlCase(f.context, f.sources, f.sources.scripts[0]!.assignmentId)]; }
function refused(f: Fixture) {
  const results = outcomes(f);
  assert.ok(results.every(r => r.status !== 'derived'), JSON.stringify(results.map(r => r.status === 'derived' ? { status: r.status, acquisition: 'acquisition' in r.proof ? r.proof.acquisition : undefined } : r)));
}
function baseline(f: Fixture) {
  const result = deriveDevelopmentControlProof(f.context, f.sources);
  assert.equal(result.status, 'derived', JSON.stringify(result));
  if (result.status !== 'derived') throw Error(JSON.stringify(result));
  assert.equal(result.proof.acquisition, 'completed'); assert.equal(result.proof.validity, 'unavailable');
  return { interval: result.proof.interval, source: result.proof.source, executions: result.proof.executions };
}
async function ready(t: TestContext) { const f = fixture(t, realEnvironment, 'always-agree'); await f.execute(); f.scriptChecks(); baseline(f); return f; }
function mapped(f: Fixture, local: string) { return `development-run:${identity([identity(f.context.plan.registration.value), 'role-always-agree', local])}`; }
function nested(f: Fixture) {
  const parent = f.originalStore.list<Binding>(bindings)[0]!.value;
  f.app.resources.allocate('review:child', parent.envelope, parent.localId);
  f.app.resources.allocate('review:grandchild', parent.envelope, 'review:child');
  return { parent, child: mapped(f, 'review:child'), grandchild: mapped(f, 'review:grandchild') };
}
function physical(f: Fixture, runId: string, status: 'reserved' | 'dispatched' | 'failed' | 'uncertain') {
  const source = f.originalStore.list<DevelopmentRequestState>(bridges)[0]!.value.request;
  const id = `development-request:${identity([identity(f.context.plan.registration.value), 'role-always-agree', `review:extra:${status}`])}`;
  const request = { ...source, id, reservationId: id, runId, status: 'reserved' as const };
  f.original.reserve(request);
  if (status !== 'reserved') f.original.dispatched({ ...request, status: 'dispatched' });
  if (status === 'failed' || status === 'uncertain') f.original.settle({ ...request, status });
  assert.equal(f.originalStore.get(bridges, id), undefined);
  assert.equal(f.originalStore.list('requests').length, 7);
  assert.throws(() => f.app.resources.allocate('review:live-check', f.context.plan.registration.value.roles[0]!.resources, 'operating-envelope:v1'), /Unobserved or changed original physical request/);
  return id;
}

for (const status of ['reserved', 'dispatched'] as const) test(`inventory review: nested unbridged ${status} work remains unavailable at both cuts`, async t => {
  const f = await ready(t), n = nested(f), after = f.sources.original.after;
  physical(f, n.grandchild, status); f.captureOriginal();
  assert.deepEqual(f.sources.original.after, after); refused(f);
  f.captureOriginal(true); refused(f);
});

test('inventory review: intermediate allocation and binding loss, aliasing and cycles cannot hide a nested request', async t => {
  const f = await ready(t), n = nested(f); physical(f, n.grandchild, 'failed'); f.captureOriginal(); refused(f);
  const allocation = f.originalStore.get<Allocation>('allocations', n.child)!, binding = f.originalStore.get<Binding>(bindings, n.child)!;
  f.originalStore.delete('allocations', n.child, allocation.revision); f.captureOriginal(); refused(f);
  f.originalStore.put('allocations', n.child, allocation.value, null);
  f.originalStore.delete(bindings, n.child, binding.revision); f.originalStore.put(bindings, 'review:alias', binding.value, null); f.captureOriginal(); refused(f);
  f.originalStore.delete(bindings, 'review:alias', 1); f.originalStore.put(bindings, n.child, binding.value, null);
  const live = f.originalStore.get<Allocation>('allocations', n.child)!;
  f.originalStore.put('allocations', n.child, { ...live.value, parentRunId: n.grandchild }, live.revision); f.captureOriginal(); refused(f);
});

test('inventory review: forged role plus reparenting cannot disguise canonical represented-role work', async t => {
  const f = await ready(t), n = nested(f), oldAfter = f.sources.original.after;
  physical(f, n.grandchild, 'uncertain'); f.captureOriginal(); refused(f);
  const allocation = f.originalStore.get<Allocation>('allocations', n.grandchild)!, binding = f.originalStore.get<Binding>(bindings, n.grandchild)!;
  f.originalStore.put('allocations', n.grandchild, { ...allocation.value, parentRunId: 'role-allocation-always-oppose' }, allocation.revision);
  f.captureOriginal(); refused(f);
  f.originalStore.put(bindings, n.grandchild, { ...binding.value, roleId: 'role-always-oppose', parentRunId: 'operating-envelope:v1' }, binding.revision);
  assert.equal(mapped(f, binding.value.localId), n.grandchild);
  f.captureOriginal(); assert.deepEqual(f.sources.original.after, oldAfter);
  assert.throws(() => f.app.resources.allocate('review:live-check-again', n.parent.envelope, 'operating-envelope:v1'), /Unobserved or changed original physical request/);
  const currentResults = outcomes(f);
  assert.equal(f.originalStore.list(bridges).length, 6);
  f.captureOriginal(true); const afterResults = outcomes(f);
  const results = [...currentResults, ...afterResults];
  assert.ok(results.every(r => r.status !== 'derived'), JSON.stringify(results.map(r => r.status === 'derived' ? { status: r.status, acquisition: 'acquisition' in r.proof ? r.proof.acquisition : undefined } : r)));
});

test('inventory review: removing declared-after physical state cannot be healed by complete later current', async t => {
  const f = await ready(t), original = baseline(f), after = f.sources.original.after;
  const row = f.originalStore.list('requests')[0]!;
  f.originalStore.delete('requests', row.key, row.revision); f.captureOriginal(true);
  f.originalStore.put('requests', row.key, row.value, null); f.captureOriginal(); refused(f);
  f.sources.original.after = after; assert.deepEqual(baseline(f), original);
});

test('inventory review: authentic other-role work may precede after and continue beyond it', async t => {
  const f = await ready(t), original = baseline(f), peer = f.peer('always-oppose');
  const run = peer.app.communications.receive(peer.assignment.message).run; await peer.app.resume(run.id);
  f.captureOriginal(true); assert.deepEqual(baseline(f), original);
  const after = f.sources.original.after;
  const pending = peer.app.communications.receive({ ...peer.assignment.message, externalId: 'review:peer-pending', conversation: 'review:peer-pending', text: JSON.stringify({ version: 1, task: 'Judge.', proposition: null }) }).run;
  await peer.app.resume(pending.id);
  const other = f.originalStore.list<DevelopmentRequestState>(bridges).filter(r => r.value.roleId === 'role-always-oppose');
  assert.equal(other.length, 2); assert.ok(other.some(r => r.value.request.status === 'uncertain'));
  for (const row of other) assert.equal(f.originalStore.get<Binding>(bindings, row.value.request.runId)!.value.roleId, 'role-always-oppose');
  f.originalStore.put('review.unrelated', 'later', { replay: true }, null); f.captureOriginal();
  assert.deepEqual(f.sources.original.after, after); assert.notEqual(f.sources.original.current.sha256, after.sha256);
  assert.deepEqual(baseline(f), original);
});

test('inventory review: current inventory traversal preserves explicit operational callback ceilings and receivers', async t => {
  const f = await ready(t), original = baseline(f); f.originalStore.put('review.unrelated', 'later', { replay: true }, null); f.captureOriginal();
  const seen: number[] = [], raw = f.context.readArtifact;
  const limits = new Map(f.sources.original.openAcquiredCapture(f.sources.original.after).manifest.cut.operationalArtifacts.flatMap(m => [[m.original.sha256, m.bytes], [m.retained.sha256, m.bytes]] as const));
  f.context.readArtifact = function (ref, maximum) {
    assert.equal(this, undefined); const indexed = limits.get(ref.sha256);
    if (indexed !== undefined) { assert.ok(maximum > 0 && maximum <= indexed && maximum <= 1_000_000); seen.push(maximum); }
    return raw(ref, maximum);
  };
  const open = f.sources.role.openAcquiredCapture;
  f.sources.role.openAcquiredCapture = ref => {
    const reader = open(ref), wrapper: DevelopmentPageReader = { ...reader, resolve(artifact, maximum) {
      assert.equal(this, wrapper); const mapping = reader.manifest.cut.operationalArtifacts.find(m => canonicalJson(m.original) === canonicalJson(artifact));
      assert.ok(mapping); assert.ok(maximum > 0 && maximum <= mapping.bytes && maximum <= 1_000_000); seen.push(maximum); return reader.resolve(artifact, maximum);
    } };
    return wrapper;
  };
  assert.deepEqual(baseline(f), original); assert.ok(seen.length >= 12);
});

test('inventory review: binding mutations are exercised on actual request ancestry rather than hash-order selection', async t => {
  const f = fixture(t, realEnvironment, 'scripted-praise'); await f.execute(); f.scriptChecks(); const original = baseline(f);
  const rows = f.originalStore.list<Binding>(bindings), requests = f.originalStore.list<{ request: PhysicalRequest }>('requests');
  const ancestry = new Set<string>();
  for (const row of requests) { let id: string | undefined = row.value.request.runId; while (id) { ancestry.add(id); id = f.originalStore.get<Allocation>('allocations', id)!.value.parentRunId; } }
  const unused = rows.find(r => r.value.localId === 'initiative:ordinary')!; assert.ok(unused); assert.equal(ancestry.has(unused.key), false);
  f.originalStore.put(bindings, unused.key, { ...unused.value, roleId: 'role-always-agree' }, unused.revision); f.captureOriginal();
  t.diagnostic(JSON.stringify({ firstBindingLocalId: rows[0]!.value.localId, firstBindingHasPhysicalDescendant: ancestry.has(rows[0]!.key), unusedBinding: unused.value.localId, unusedMutationOutcomes: outcomes(f).map(r => r.status) }));
  f.originalStore.put(bindings, unused.key, unused.value, unused.revision + 1); f.captureOriginal(); assert.deepEqual(baseline(f), original);
  const row = f.originalStore.get<Binding>(bindings, requests[0]!.value.request.runId)!; assert.ok(row);
  const key = requests[0]!.value.request.runId;
  for (const change of [{ roleId: 'role-always-agree' }, { registrationDigest: identity('review:foreign-registration') }, { localId: 'review:foreign-local' }, { parentRunId: 'review:foreign-parent' }, { envelope: { ...row.value.envelope, maxRequests: 1 } }]) {
    const live = f.originalStore.get<Binding>(bindings, key)!;
    f.originalStore.put(bindings, key, { ...row.value, ...change }, live.revision); f.captureOriginal(); refused(f);
    f.originalStore.put(bindings, key, row.value, live.revision + 1); f.captureOriginal(); assert.deepEqual(baseline(f), original);
  }
});
