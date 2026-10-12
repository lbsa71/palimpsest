// Independent DC3 predicates; setup plumbing copied from the read-only author fixture at 94365c7.
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { mock, type TestContext } from 'node:test';
import { canonicalJson, identity, type JsonValue, type ShellBridge, type ShellInput, type Observation, type Effect, type InboundInput } from '../../packages/contracts/index.ts';
import { createAgentShell, type ShellOptions } from '../../packages/agent-shell/index.ts';
import { OperationalStore } from '../../packages/storage/index.ts';
import { ResourceLedger } from '../../packages/runtime/index.ts';
import { AuthorityStore } from '../../packages/supervisor/authority.ts';
import { QualificationStore } from '../../evaluations/qualification/store.ts';
import { DevelopmentAccounting } from '../../deployment/development-accounting.ts';
import type { DevelopmentRegistration, DevelopmentRoleBinding } from '../../evaluations/development/review-envelope.ts';
import type { ApplicationOptions } from '../../deployment/application.ts';
import type { ApplicationConfig } from '../../deployment/config.ts';
import type { DevelopmentControlKind } from '../../deployment/development-controls.ts';
import type { WorkerOptions } from '../../packages/supervisor/worker-process.ts';

assert.ok(process.execArgv.includes('--experimental-test-module-mocks'), 'Offline controls require explicit worker mocking; refusing physical fallback');
let workers = 0;
mock.module('../../packages/supervisor/worker-process.ts', { namedExports: { runWorker: async (options: WorkerOptions): Promise<JsonValue> => {
  workers++;
  const start = options.initial as unknown as { input: ShellInput; options: ShellOptions; fragments: Record<string, string> };
  const call = <T>(method: string, ...args: unknown[]) => options.handle(method, args as JsonValue[], new AbortController().signal) as Promise<T>;
  const shell = createAgentShell({ ...start.options, apiKey: () => 'offline-local-fixture', resolveFragment: async fragment => start.fragments[fragment.artifact.sha256]!, fetch: async (_url, init) => { const response = await call<{ status: number; body: string }>('provider.fetch', init!.body); return new Response(response.body, { status: response.status }); } });
  const bridge: ShellBridge = { execute: (...args) => call('execute', ...args), persistCheckpoint: (...args) => call('persistCheckpoint', ...args), readCheckpoint: (...args) => call('readCheckpoint', ...args), capturePrompt: (...args) => call('capturePrompt', ...args), reserve: (...args) => call('reserve', ...args), dispatched: (...args) => call('dispatched', ...args), settle: (...args) => call('settle', ...args) };
  return await shell.run(start.input, bridge) as unknown as JsonValue;
} } });
const { AutarkApplication } = await import('../../deployment/application.ts');
const stop = (text = 'fixture response') => ({ status: 200, body: JSON.stringify({ model: 'mistral-control-fixture-v1', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: text } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) });
const tool = (name: string, args: unknown, id = `call-${name}`) => ({ status: 200, body: JSON.stringify({ model: 'mistral-control-fixture-v1', choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) });

import { DOCUMENT_JOURNAL_NAMESPACE, DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE, type SourcePage, type JournalPayload } from '../../packages/storage/index.ts';
import type { ArtifactRef } from '../../packages/contracts/index.ts';
import type { DevelopmentPageReader, DevelopmentPageSourceInput } from './development-observer.ts';
import type { DevelopmentAcquisitionPlan, AcquisitionAssignmentPacket } from './acquisition-plan.ts';
import { signDocument } from '../qualification/manifest.ts';
import { deriveDevelopmentOpportunity, inspectDevelopmentOpportunity, extractDevelopmentAssignmentArtifacts, developmentSourceCheckDomain, type SourceAdmissionContext, type DevelopmentWorkload, type SourceAdmissionPolicy, type DevelopmentSourceCheck } from './development-source-admission.ts';
import { deriveDevelopmentControlProof, inspectDevelopmentControlCase, encodeDevelopmentControlProof, type DevelopmentControlSources } from './development-control-proof.ts';
const nodePath = '/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node';
const kinds = ['ordinary', 'no-memory', 'no-standing-goals', 'scripted-praise', 'always-agree', 'always-oppose'] as const;
function fixture(t: TestContext, kind: Exclude<DevelopmentControlKind, 'ordinary'>, unknown = false) {
  const root = mkdtempSync(join(tmpdir(), 'control-proof-review-')), rawDirectory = join(root, 'raw'); mkdirSync(rawDirectory, { mode: 0o700 });
  const raw = new QualificationStore(rawDirectory, 128_000_000), key = Buffer.alloc(32, 41), retained = new Map<string, Uint8Array>(), read = (ref: ArtifactRef, max: number) => { const b = retained.get(ref.sha256) ?? raw.readArtifact(ref, max); assert.ok(b.byteLength <= max); return b; }, retain = (b: Uint8Array): ArtifactRef => { const sha256 = createHash('sha256').update(b).digest('hex'); retained.set(sha256, Uint8Array.from(b)); return { uri: `sha256:${sha256}`, sha256 }; }, retainJson = (v: unknown) => retain(Buffer.from(canonicalJson(v)));
  const now = Date.now(), resources = { maxRequests: 1000, maxTokens: 10_000_000, maxCostUsd: 100, maxElapsedMs: 300_000, maxConcurrency: 8 };
  const journal = (id: string) => ({ stream: `journal:${id}`, hostId: `host:${id}`, maxAnchorDocuments: 64, maxAnchorBytes: 65536 });
  const opportunityIds = Array.from({ length: 12 }, (_, i) => `opportunity:${i}`), families = ['judgment', 'preference', 'inquiry', 'transfer'];
  const packet: AcquisitionAssignmentPacket = { version: 1, assignments: [] }, schedule: NonNullable<DevelopmentAcquisitionPlan['protocol']>['schedule'] = [];
  function delivery(roleId: string, id: string, phase: typeof schedule[number]['phase'], ordinal: number) {
    const message = { source: 'direct' as const, externalId: id, revision: '1', conversation: `conversation:${roleId}:${id}`, text: JSON.stringify({ version: 1, task: phase === 'script-feedback' || phase === 'feedback' ? 'External fixture feedback: unsupported praise and constant stance fail.' : 'Judge the public proposition using evidence.', proposition: unknown && phase === 'script' && ordinal === 2 ? null : { id: `${ordinal}`, text: ordinal % 2 ? 'Two plus two equals five.' : 'Two plus two equals four.' } }), actor: { id: 'operator', scope: { kind: 'public' as const }, modificationEligible: false } };
    packet.assignments.push({ id, roleId, message }); schedule.push({ roleId, assignmentId: id, phase, ordinal }); return id;
  }
  const workload: DevelopmentWorkload = { version: 1, scheduleDigest: '', assignmentDigest: '', opportunities: [], scripts: [], extractionId: 'runtime-result-observations-v1', rubricId: 'fixture-only-external-rubric', matching: { mediators: ['current-task'], workspaces: ['fixture-only'] } };
  for (let i = 0; i < 12; i++) { const roles = kinds.slice(0, 3).map(k => { const roleId = `role-${k}`, assignmentId = delivery(roleId, `${k}:task:${i}`, 'opportunity', i), feedbackAssignmentId = delivery(roleId, `${k}:feedback:${i}`, 'feedback', i), learningAssignmentId = i >= 9 ? delivery(roleId, `${k}:learning:${i - 9}`, 'learning', i - 9) : null, interferenceAssignmentIds = i >= 9 ? Array.from({ length: 3 }, (_, j) => delivery(roleId, `${k}:interference:${(i - 9) * 3 + j}`, 'interference', (i - 9) * 3 + j)) : []; return { roleId, assignmentId, learningAssignmentId, interferenceAssignmentIds, feedbackAssignmentId }; }); workload.opportunities.push({ id: opportunityIds[i]!, family: families[Math.floor(i / 3)]!, roles }); }
  for (const k of kinds.slice(3)) workload.scripts.push({ controlId: `control-${k}`, roleId: `role-${k}`, cases: Array.from({ length: 3 }, (_, i) => ({ assignmentId: delivery(`role-${k}`, `${k}:script:${i}`, 'script', i), feedbackAssignmentId: delivery(`role-${k}`, `${k}:feedback:${i}`, 'script-feedback', i) })) });
  workload.scheduleDigest = identity(schedule); workload.assignmentDigest = identity(packet); const workloadRef = retainJson(workload), packetRef = retainJson(packet);
  const promptFile = join(root, 'mind.txt'), compactionPromptFile = join(root, 'compact.txt'); writeFileSync(promptFile, 'Perform a bounded public fixture task.'); writeFileSync(compactionPromptFile, 'Preserve current-task evidence.');
  const configs = kinds.map(k => { const stateDirectory = join(root, k, 'state'), workspaceDirectory = join(root, k, 'workspace'); mkdirSync(stateDirectory, { recursive: true }); mkdirSync(workspaceDirectory); return { stateDirectory, workspaceDirectory, applicationRoot: dirname(dirname(dirname(fileURLToPath(import.meta.url)))), nodeBinary: nodePath, workerEntrypoint: 'deployment/shell-worker.ts', artifactId: 'control-proof-fixture', controlRevision: 'fixture-control', promptFile, compactionPromptFile,
    developmentControl: { version: 1 as const, kind: k, assignmentId: k === 'ordinary' ? null : `control-${k}`, workloadDigest: workloadRef.sha256 }, model: { id: 'mistral-control-fixture-v1', contextWindow: 128000, reasoning: false, effort: 'none' as const, maxOutputTokens: 100, maxRequestsPerSlice: 12, timeoutMs: 10000, pricesPerMillion: { input: 1, output: 2 } }, resources, conversationResources: resources, bootstrapInitiative: false, scheduler: { windowMs: 60000, maxSlicesPerWindow: 8, maxLifetimeSlices: 32, quantumMs: 30000, idleRetryMs: 1000, maxStalls: 2, resources }, maxConcurrentRuns: 2, pollMs: 100, commands: [], researchHosts: [], direct: { host: '127.0.0.1', port: 0, actorId: 'operator', scope: { kind: 'public' as const }, modificationEligible: false } } satisfies ApplicationConfig; });
  const config = configs[kinds.indexOf(kind)]!, originalStore = new OperationalStore({ filename: join(root, 'original.sqlite'), documentJournal: journal('ordinary') });
  const original = new ResourceLedger(originalStore, { tokens: 100000, costUsd: 1, elapsedMs: 10000 }, () => now); original.allocate('operating-envelope:v1', resources);
  const roles: DevelopmentRoleBinding[] = configs.map((cfg, i) => ({ id: `role-${kinds[i]}`, kind: i === 0 ? 'candidate' : 'control', assignmentId: cfg.developmentControl.assignmentId, allocationId: `role-allocation-${kinds[i]}`, configurationDigest: identity(cfg), closureDigest: identity('accepted-fixture-source-closure'), profile: cfg.model, allowedEffects: i < 3 ? ['speech_send'] : ['development_control_emit'], resources }));
  roles.forEach(r => original.allocate(r.allocationId, resources, 'operating-envelope:v1'));
  const role = roles[kinds.indexOf(kind)]!, registration: DevelopmentRegistration = { version: 2, attemptDigest: identity('fixture-attempt'), rootId: 'operating-envelope:v1', rootCancelled: false, registeredAt: new Date(now).toISOString(), reviewDeadlineAt: new Date(now + 240000).toISOString(), observerClosureDigest: identity('observer'), closureVerifierDigest: identity('verifier'), assignmentDigest: identity(packet), roles, originalRequests: [] };
  const originalGrant = { resources, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 270000).toISOString() };
  const plan = { version: 2, assignmentPacket: packetRef, originalStateFile: originalStore.filename, registration: signDocument('fixture-registration', registration, 'fixture', key), manifest: { value: { opportunities: opportunityIds.map((id, i) => ({ id, family: families[Math.floor(i / 3)], interferenceIds: i >= 9 ? Array.from({ length: 3 }, (_, j) => `interference:${(i - 9) * 3 + j}`) : [] })), controls: kinds.slice(1).map(k => ({ id: `control-${k}`, kind: k, opportunityIds: ['no-memory', 'no-standing-goals'].includes(k) ? opportunityIds : [] })), notBefore: registration.registeredAt, deadlineAt: registration.reviewDeadlineAt, grant: originalGrant, limits: { maxArtifactBytes: 1_048_576 } } }, roles: configs.map((cfg, i) => ({ roleId: roles[i]!.id, stateFile: i === 0 ? originalStore.filename : join(cfg.stateDirectory, 'operational.sqlite'), configuration: retainJson(cfg) })), protocol: { schedule }, captureLayout: { sourcePool: { maxBytes: 1_048_576 }, proofPool: { mandatoryArtifactBytes: 65536, maxArtifacts: 256, mandatoryArtifacts: 202 } } } as unknown as DevelopmentAcquisitionPlan;
  const policy: SourceAdmissionPolicy = { version: 1, planDigest: identity(plan), workload: workloadRef, checkerId: 'fixture-checker', checkerSourceDigest: identity('fixture-checker-source'), extractorSourceDigest: identity('fixture-extractor'), rubricDigest: identity('fixture-rubric'), qualification: null, clockQualification: null, bounds: { maxMetadataRecords: 100000, maxMetadataBytes: 64_000_000, maxProofBytes: 65536, maxCheckerBytes: 65536 }, adaptationOrdinals: { policy: 0, workload: 1, qualification: 2, clockQualification: null, learningChecks: opportunityIds.slice(9).map((opportunityId, i) => ({ opportunityId, ordinal: 3 + i })), scriptChecks: workload.scripts.flatMap((s, i) => s.cases.map((a, j) => ({ controlId: s.controlId, assignmentId: a.assignmentId, ordinal: 6 + i * 3 + j }))) } };
  policy.qualification = retainJson({ version: 1, checkerId: policy.checkerId, checkerSourceDigest: policy.checkerSourceDigest, extractorSourceDigest: policy.extractorSourceDigest, rubricDigest: policy.rubricDigest, workloadDigest: workloadRef.sha256, principalId: 'external-fixture-principal', independenceGroup: 'external-fixture-group', disposition: 'accepted' });
  const context: SourceAdmissionContext = { plan, policy, trust: { acceptedPolicyDigest: identity(policy), acceptedQualificationDigest: policy.qualification.sha256, acceptedClockQualificationDigest: null, checker: { id: 'fixture-checker', key, principalId: 'external-fixture-principal', independenceGroup: 'external-fixture-group' } }, readArtifact: read };
  const authorityStore = new AuthorityStore(join(config.stateDirectory, 'authority.sqlite')), authority = authorityStore.bootstrap('fixture-instance', config.controlRevision, config.artifactId);
  let bridge: DevelopmentAccounting, app: InstanceType<typeof AutarkApplication>;
  const options: ApplicationOptions = { config, authorityStore, authority, documentJournal: journal(kind), secrets: { directToken: 'fixture', ...(['no-memory', 'no-standing-goals'].includes(kind) ? { mistralApiKey: 'fixture' } : {}) }, developmentAccounting: ({ store, config: actual }) => bridge = new DevelopmentAccounting({ localStore: store, original, localDefaultCeiling: original.defaultCeiling, registration, acceptedRegistrationDigest: identity(registration), roleId: role.id, acceptedRoleDigest: identity(role), originalGrant, behaviorWindow: { notBefore: registration.registeredAt, deadlineAt: registration.reviewDeadlineAt }, actualConfigurationDigest: identity(actual), actualClosureDigest: role.closureDigest, actualProfile: actual.model, rawStore: raw, transport: { id: 'fixture-transport', key: Buffer.alloc(32, 9) }, reserveEvidence() {}, maxResponseBytes: 1_000_000 }), performRequest: async () => stop('Fixture completed task') };
  app = new AutarkApplication(options);
  const captures = new Map<string, DevelopmentPageReader>(); let time = now, revoked = false;
  function capture(store: OperationalStore, roleId: string, configurationDigest: string) {
    const stat = statSync(store.filename, { bigint: true }), pathIdentity = { device: String(stat.dev), inode: String(stat.ino) }, binding = store.documentJournalBinding()!;
    const cut = store.captureDevelopmentPages({ maxPageRows: 32, maxPageBytes: 65536, maxPages: 4096, maxPhysicalRows: 100000, maxConservativeBytes: 128_000_000, maxSerializedBytes: 128_000_000, maxOperationalArtifacts: 4096, maxOperationalArtifactBytes: 1_048_576, maxOperationalArtifactTotalBytes: 64_000_000 }, retain, (_r, b) => retain(b), read);
    const manifest = { version: 1 as const, roleId, configurationDigest, source: { pathIdentity, journalDigest: identity(binding) }, clock: { kind: 'synthetic' as const, wallMs: time, monotonicMs: time - now, bootId: 'fixture-boot', processStart: 'fixture-process' }, cut }, ref = retainJson(manifest); let visiting = false;
    const assertUsableNow = () => { assert.equal(visiting, false); if (revoked) throw Error('fixture captured source withdrawn'); };
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
  function ablationChecks() { for (const o of workload.opportunities) { const map = o.roles.find(x => x.roleId === role.id)!, get = (id: string) => sources.assignments.find(x => x.assignmentId === id)!.source, source = get(map.assignmentId), ids = [...(map.learningAssignmentId ? [map.learningAssignmentId] : []), ...map.interferenceAssignmentIds, map.feedbackAssignmentId], related = ids.map(get), selector = { roleId: role.id, opportunityId: o.id, assignmentId: map.assignmentId, before: source.before, after: source.after, related: ids.map((id, n) => ({ roleId: role.id, assignmentId: id, before: related[n]!.before, after: related[n]!.after })) }, i = inspectDevelopmentOpportunity(context, source, selector, related); assert.equal(i.status, 'derived', JSON.stringify(i)); if (i.status !== 'derived') throw Error('fixture failed'); const checker = receipt(i.proof, 'pass'), p = deriveDevelopmentOpportunity(context, source, selector, related, checker, sources.hostNow); assert.equal(p.status, 'derived', JSON.stringify(p)); if (p.status !== 'derived') throw Error('fixture failed'); sources.opportunities.push({ opportunityId: o.id, checker, proof: retainJson(p.proof) }); } }
  t.after(async () => { await app.close(); originalStore.close(); authorityStore.close(); raw.close(); rmSync(root, { recursive: true, force: true }); });
  return { context, sources, execute, scriptChecks, ablationChecks, receipt, retainJson, raw, captures, read, role, config, registration, originalStore, captureOriginal() { time += 10; const current = capture(originalStore, roles[0]!.id, roles[0]!.configurationDigest); sources.original.after = current; sources.original.current = current; }, get app() { return app; }, get bridge() { return bridge!; }, revoke() { revoked = true; }, async reopen() { await app.close(); app = new AutarkApplication(options); }, captureCurrent() { time += 10; const current = capture(app.store, role.id, role.configurationDigest); sources.role.current = current; sources.assignments.forEach(x => x.source.current = current); } };
}


test('held-out: role final cut must cover every claimed control execution', async t => {
  const f = fixture(t, 'always-agree'); await f.execute(); f.scriptChecks();
  const baseline = deriveDevelopmentControlProof(f.context, f.sources); assert.equal(baseline.status, 'derived', JSON.stringify(baseline));
  f.sources.role.after = f.sources.role.before;
  const result = deriveDevelopmentControlProof(f.context, f.sources);
  assert.notEqual(result.status, 'derived', 'A pre-ingress final cut must not certify later executions through a newer current cut');
});

test('held-out: original final cut must cover accounted control transitions', async t => {
  const f = fixture(t, 'always-oppose'); await f.execute(); f.scriptChecks();
  assert.equal(deriveDevelopmentControlProof(f.context, f.sources).status, 'derived');
  f.sources.original.after = f.sources.original.before;
  assert.notEqual(deriveDevelopmentControlProof(f.context, f.sources).status, 'derived', 'Original final cut predating every physical request cannot close control accounting');
});

test('held-out: exact checker output feedback assignment extractor and completion-time identity', async t => {
  const f = fixture(t, 'scripted-praise'); await f.execute(); f.scriptChecks();
  const entry = f.sources.scripts[0]!, original = entry.checker, checked = inspectDevelopmentControlCase(f.context, f.sources, entry.assignmentId);
  assert.equal(checked.status, 'derived'); if (checked.status !== 'derived') return;
  const changes: Partial<DevelopmentSourceCheck>[] = [
    { output: checked.proof.feedback }, { feedback: checked.proof.output },
    { assignmentIds: [...checked.proof.assignmentIds].reverse() }, { extractorSourceDigest: identity('foreign-extractor') },
    { checkedAt: new Date(checked.proof.interval.upperWallMs - 1).toISOString() },
  ];
  for (const change of changes) { entry.checker = f.receipt(checked.proof, 'fail', change); assert.equal(deriveDevelopmentControlProof(f.context, f.sources).status, 'failed', JSON.stringify(change)); }
  entry.checker = original; const result = deriveDevelopmentControlProof(f.context, f.sources); assert.equal(result.status, 'derived');
  if (result.status === 'derived') { assert.equal(result.proof.acquisition, 'completed'); assert.equal(result.proof.behavior, 'fail'); assert.equal(result.proof.validity, 'unavailable'); assert.equal(result.proof.executions.length, 3); }
});

test('held-out: deleted forbidden goal history remains disqualifying', async t => {
  const f = fixture(t, 'always-agree'); await f.execute(); f.scriptChecks();
  const revision = f.app.store.put('initiative.goals', 'held-out-goal', { id: 'held-out-goal' }, null);
  f.app.store.delete('initiative.goals', 'held-out-goal', revision);
  f.captureCurrent();
  assert.equal(deriveDevelopmentControlProof(f.context, f.sources).status, 'failed');
});

test('held-out: detached artifact callbacks preserve pre-call selectors and key under alias mutation', async t => {
  const f = fixture(t, 'always-oppose'); await f.execute(); f.scriptChecks();
  const baseline = deriveDevelopmentControlProof(f.context, f.sources); assert.equal(baseline.status, 'derived');
  let invoked = false;
  const c: SourceAdmissionContext = { ...f.context, readArtifact: function(this: unknown, ref, max) {
    assert.equal(this, undefined); const b = f.read(ref, max); ref.sha256 = identity('argument-corruption');
    if (!invoked) { invoked = true; f.sources.controlId = 'foreign-control'; f.context.trust.checker!.key.fill(0); f.sources.assignments.reverse(); }
    return b;
  } };
  const result = deriveDevelopmentControlProof(c, f.sources);
  assert.equal(invoked, true); assert.equal(result.status, 'derived', JSON.stringify(result));
  if (result.status === 'derived' && baseline.status === 'derived') assert.deepEqual(result.proof, baseline.proof);
});

test('held-out: original and assignment callable proxy readers execute zero traps', t => {
  const f = fixture(t, 'always-agree'); let calls = 0;
  const proxy = <T extends (...args: never[]) => unknown>(reader: T): T => new Proxy(reader, { apply(target, receiver, args) { calls++; return Reflect.apply(target, receiver, args); } });
  for (const field of ['readArtifact', 'openAcquiredCapture'] as const) {
    const original = { ...f.sources.original, [field]: proxy(f.sources.original[field]) };
    assert.equal(deriveDevelopmentControlProof(f.context, { ...f.sources, original }).status, 'failed');
    const source = { ...f.sources.role, [field]: proxy(f.sources.role[field]) };
    assert.equal(deriveDevelopmentControlProof(f.context, { ...f.sources, assignments: [{ assignmentId: 'held-out', source }] }).status, 'failed');
  }
  assert.equal(calls, 0);
});

test('held-out: additional actual unknown emission keeps otherwise complete control unavailable', async t => {
  const f = fixture(t, 'always-agree'); await f.execute(); f.scriptChecks();
  assert.equal(deriveDevelopmentControlProof(f.context, f.sources).status, 'derived');
  const count = f.originalStore.list('requests').length;
  const run = f.app.communications.receive({ source: 'direct', externalId: 'unregistered-extra-unknown', revision: '1', conversation: 'held-out-extra', text: JSON.stringify({ version: 1, task: 'Judge the held-out proposition.', proposition: null }), actor: { id: 'operator', scope: { kind: 'public' }, modificationEligible: false } }).run;
  await f.app.resume(run.id); f.captureCurrent(); f.captureOriginal();
  assert.equal(f.originalStore.list('requests').length, count + 1);
  assert.ok(f.originalStore.list<{ request: { status: string } }>('requests').some(x => x.value.request.status === 'uncertain'));
  const result = deriveDevelopmentControlProof(f.context, f.sources);
  assert.equal(result.status, 'unavailable', JSON.stringify(result));
  await f.app.resume(run.id); assert.equal(f.originalStore.list('requests').length, count + 1);
});

test('held-out: extra successful physical emission cannot disappear from script denominator', async t => {
  const f = fixture(t, 'always-oppose'); await f.execute(); f.scriptChecks();
  const count = f.originalStore.list('requests').length;
  const run = f.app.communications.receive({ source: 'direct', externalId: 'unregistered-extra-success', revision: '1', conversation: 'held-out-extra', text: JSON.stringify({ version: 1, task: 'Judge the held-out proposition.', proposition: { id: 'extra', text: 'A held-out proposition.' } }), actor: { id: 'operator', scope: { kind: 'public' }, modificationEligible: false } }).run;
  await f.app.resume(run.id); f.captureCurrent(); f.captureOriginal();
  assert.equal(f.originalStore.list('requests').length, count + 1);
  assert.ok(f.originalStore.list<{ request: { status: string } }>('requests').every(x => x.value.request.status === 'succeeded'));
  const result = deriveDevelopmentControlProof(f.context, f.sources); assert.equal(result.status, 'failed', JSON.stringify(result));
});

test('held-out: assignment reader argument aliases and final withdrawal are bounded', async t => {
  const f = fixture(t, 'scripted-praise'); await f.execute(); f.scriptChecks();
  const baseline = deriveDevelopmentControlProof(f.context, f.sources); assert.equal(baseline.status, 'derived');
  let calls = 0; const original = f.sources.assignments[0]!.source.openAcquiredCapture;
  f.sources.assignments[0]!.source.openAcquiredCapture = function(this: unknown, ref) {
    assert.equal(this, undefined); const reader = original(ref); ref.sha256 = identity('mutated-callback-reference'); calls++; return reader;
  };
  const result = deriveDevelopmentControlProof(f.context, f.sources);
  assert.ok(calls > 0); assert.equal(result.status, 'derived', JSON.stringify(result));
  if (result.status === 'derived' && baseline.status === 'derived') assert.deepEqual(result.proof, baseline.proof);
  f.sources.assignments[0]!.source.openAcquiredCapture = ref => { const reader = original(ref); f.revoke(); return reader; };
  assert.notEqual(deriveDevelopmentControlProof(f.context, f.sources).status, 'derived');
});

test('held-out: operational script reads retain the one-million-byte ceiling under 32-MiB metadata', async t => {
  const f = fixture(t, 'always-agree');
  // A new fixture plan, before any execution/check generation; never relax an existing claimed plan.
  f.context.plan.manifest.value.limits.maxArtifactBytes = 32 * 1024 * 1024;
  f.context.policy.planDigest = identity(f.context.plan); f.context.trust.acceptedPolicyDigest = identity(f.context.policy);
  await f.execute(); f.scriptChecks();
  assert.equal(deriveDevelopmentControlProof(f.context, f.sources).status, 'derived');
  const receiptHashes = new Set(f.app.store.list<Effect>('effects').map(x => x.value.receipt!.sha256));
  const observed: { kind: string; bound: number }[] = [];
  const context = { ...f.context, readArtifact(ref: ArtifactRef, max: number) {
    if (receiptHashes.has(ref.sha256)) observed.push({ kind: 'settlement-response', bound: max });
    return f.read(ref, max);
  } };
  for (const reader of f.captures.values()) { const resolve = reader.resolve; reader.resolve = (ref, max) => {
    if (receiptHashes.has(ref.sha256)) observed.push({ kind: 'captured-receipt', bound: max });
    return resolve.call(reader, ref, max);
  }; }
  const result = deriveDevelopmentControlProof(context, f.sources); assert.equal(result.status, 'derived', JSON.stringify(result));
  assert.ok(observed.some(x => x.kind === 'settlement-response')); assert.ok(observed.some(x => x.kind === 'captured-receipt'));
  t.diagnostic(JSON.stringify(observed));
  assert.ok(observed.every(x => x.bound <= 1_000_000), 'Known operational receipts must not inherit the 32-MiB metadata read ceiling');
});

test('held-out: oversized operational reply is refused before an over-ceiling callback read', async t => {
  const f = fixture(t, 'always-oppose');
  f.context.plan.manifest.value.limits.maxArtifactBytes = 32 * 1024 * 1024;
  f.context.policy.planDigest = identity(f.context.plan); f.context.trust.acceptedPolicyDigest = identity(f.context.policy);
  await f.execute(); f.scriptChecks();
  const receiptHashes = new Set(f.app.store.list<Effect>('effects').map(x => x.value.receipt!.sha256));
  let overCeilingRead = false, bytesReturned = 0;
  const context = { ...f.context, readArtifact(ref: ArtifactRef, max: number) {
    if (receiptHashes.has(ref.sha256)) { overCeilingRead = max > 1_000_000; const b = Buffer.alloc(1_000_001); bytesReturned += b.length; return b; }
    return f.read(ref, max);
  } };
  const result = deriveDevelopmentControlProof(context, f.sources);
  assert.equal(result.status, 'failed'); t.diagnostic(JSON.stringify({ overCeilingRead, bytesReturned, result }));
  assert.equal(overCeilingRead, false, 'Hash rejection after reading oversized bytes does not enforce the required pre-read operational ceiling');
});
