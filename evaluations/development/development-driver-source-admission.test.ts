// Reuse the unchanged actual-driver setup from development-driver.test.ts; old tests remain read-only.
import type { SourceAdmissionPolicy } from './development-source-admission.ts';
import type { RecorderSourceAdmission } from './source-admission-reservation.ts';
import type { DevelopmentReviewerSession } from './model-review.ts';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';
import { candidateIdentity, canonicalJson, identity, type JsonValue, type ShellBridge, type ShellInput } from '../../packages/contracts/index.ts';
import { createAgentShell, type ShellOptions } from '../../packages/agent-shell/index.ts';
import { OperationalStore } from '../../packages/storage/index.ts';
import { ResourceLedger } from '../../packages/runtime/index.ts';
import { AuthorityStore } from '../../packages/supervisor/authority.ts';
import type { WorkerOptions } from '../../packages/supervisor/worker-process.ts';
import { DevelopmentAccounting } from '../../deployment/development-accounting.ts';
import type { ApplicationConfig } from '../../deployment/config.ts';
import { QualificationStore } from '../qualification/store.ts';
import { signDocument } from '../qualification/manifest.ts';
import { syntheticWitnessFixture } from './witness-fixture.ts';
import { acquisitionPlanDomain, type AcquisitionPlanTrust, type DevelopmentAcquisitionPlan } from './acquisition-plan.ts';
import { reviewEnvelopeDomains, type DevelopmentRegistration, type DevelopmentRoleBinding } from './review-envelope.ts';
import { domains, developmentCapacityProfile, developmentCapacityLimits, type DevelopmentAttempt } from './witness.ts';
import type { DevelopmentDriverOptions, DevelopmentDriverRole } from './development-driver.ts';

let workers = 0; const workerFailures: string[] = [];
const inProcessWorker = async (options: WorkerOptions): Promise<JsonValue> => {
  workers++;
  const start = options.initial as unknown as { input: ShellInput; options: ShellOptions; fragments: Record<string, string> };
  const call = <T>(method: string, ...args: unknown[]) => options.handle(method, args as JsonValue[], options.command.signal ?? new AbortController().signal).catch(error => { workerFailures.push(`${method}: ${String(error)}`); throw error; }) as Promise<T>;
  const shell = createAgentShell({ ...start.options, apiKey: () => 'public-offline-fixture', resolveFragment: async fragment => start.fragments[fragment.artifact.sha256]!, fetch: async (_url, init) => { const response = await call<{ status: number; body: string }>('provider.fetch', init!.body); return new Response(response.body, { status: response.status }); } });
  const bridge: ShellBridge = { execute: (...args) => call('execute', ...args), persistCheckpoint: (...args) => call('persistCheckpoint', ...args), readCheckpoint: (...args) => call('readCheckpoint', ...args), capturePrompt: (...args) => call('capturePrompt', ...args), reserve: (...args) => call('reserve', ...args), dispatched: (...args) => call('dispatched', ...args), settle: (...args) => call('settle', ...args) };
  return await shell.run(start.input, bridge, options.command.signal) as unknown as JsonValue;
};
const { DevelopmentAcquisitionDriver, DevelopmentDriverPreparationFailure } = await import('./development-driver.ts');
const { AutarkApplication } = await import('../../deployment/application.ts');
const { DevelopmentAcquisitionRecorder } = await import('./acquire.ts');
const stop = () => ({ status: 200, body: JSON.stringify({ model: 'synthetic-model', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Public offline response' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) });

/** Actual applications with NEW signed full126/156 paged plan. Only a few deliveries run. */
function fixture(t: TestContext) {
  const f = syntheticWitnessFixture(), directory = mkdtempSync(join(tmpdir(), 'aeon-driver-admission-'));
  const applicationRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const promptFile = join(directory, 'mind.txt'), compactionPromptFile = join(directory, 'compaction.txt');
  writeFileSync(promptFile, 'Inspect public attributed evidence and finish bounded tasks.'); writeFileSync(compactionPromptFile, 'Retain current task facts and uncertainty.');
  mkdirSync(join(directory, 'raw'), { mode: 0o700 }); const raw = new QualificationStore(join(directory, 'raw'), developmentCapacityLimits.maxEvidenceBytes, developmentCapacityProfile);
  const base = Date.now(), at = (seconds: number) => new Date(base + seconds * 1000).toISOString(); let now = base - 2000;
  const rootResources = { maxRequests: 512, maxTokens: 2000000, maxCostUsd: 500, maxElapsedMs: 600000, maxConcurrency: 8 };
  const roleResources = { ...rootResources, maxRequests: 64 };
  const configs = new Map<string, ApplicationConfig>(), authorities = new Map<string, AuthorityStore>();
  for (const id of ['candidate', ...f.m.controls.map(c => c.id), ...f.m.reviewers.map(r => r.id)]) {
    const stateDirectory = join(directory, `state-${id}`), workspaceDirectory = join(directory, `workspace-${id}`);
    mkdirSync(stateDirectory, { mode: 0o700 }); mkdirSync(workspaceDirectory, { mode: 0o700 });
    const kind = id === 'candidate' || id.startsWith('reviewer') ? 'ordinary' : f.m.controls.find(c => c.id === id)!.kind;
    const config: ApplicationConfig = { stateDirectory, workspaceDirectory, applicationRoot, nodeBinary: process.execPath, workerEntrypoint: 'deployment/shell-worker.ts', artifactId: 'public-driver-fixture', controlRevision: 'fixture-control', promptFile, compactionPromptFile,
      developmentControl: { version: 1, kind, assignmentId: kind === 'ordinary' ? null : id, workloadDigest: identity('shared-public-fixture-envelope-feedback') },
      model: { ...JSON.parse(Buffer.from(f.reader(f.m.configurationArtifact, 10000)).toString()).model, contextWindow: 128000 },
      resources: id === 'candidate' ? rootResources : roleResources, conversationResources: roleResources, bootstrapInitiative: false,
      scheduler: { windowMs: 60000, maxSlicesPerWindow: 8, maxLifetimeSlices: 32, quantumMs: 30000, idleRetryMs: 1000, maxStalls: 2, resources: roleResources }, maxConcurrentRuns: 2, pollMs: 100, commands: [], researchHosts: [], direct: { host: '127.0.0.1', port: 0, actorId: 'public-host', scope: { kind: 'public' }, modificationEligible: false } };
    configs.set(id, config); authorities.set(id, new AuthorityStore(join(stateDirectory, 'authority.sqlite')));
  }
  const config = configs.get('candidate')!, candidateArtifact = JSON.parse(Buffer.from(f.reader(f.m.candidateArtifact, 10000)).toString());
  const inputs = { ...candidateArtifact.inputs, model: config.model, configuration: config };
  const { id: retiredId, ...priorFields } = f.m.candidate;
  const manifestFields = { ...priorFields, model: identity(config.model), configuration: identity(config) }; const fields = { ...manifestFields, id: candidateIdentity(manifestFields) };
  const m: DevelopmentAttempt = { ...f.m, version: 2, capacityProfile: developmentCapacityProfile, limits: { ...developmentCapacityLimits }, candidate: fields, candidateArtifact: f.put({ manifest: fields, files: candidateArtifact.files, inputs }), configurationArtifact: f.put(config), contextWindowTokens: config.model.contextWindow,
    registeredAt: at(-2), notBefore: at(0), deadlineAt: at(180), grant: { ...f.m.grant, issuedAt: at(-5), expiresAt: at(300), resources: rootResources, originalAccounting: { grantId: f.m.grant.id, usage: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 3000 }, chargedTokens: 0, chargedCostUsd: 0, chargedElapsedMs: 0, requestIds: [], unknownRequestIds: [] } } };
  const roles: DevelopmentRoleBinding[] = [...configs.keys()].map((id, index) => ({ id, kind: index === 0 ? 'candidate' : index <= m.controls.length ? 'control' : 'reviewer', assignmentId: index === 0 ? null : id, allocationId: `role:${id}`, configurationDigest: identity(configs.get(id)!), closureDigest: identity({ id, synthetic: 'exact-source-closure' }), profile: configs.get(id)!.model, allowedEffects: index > m.controls.length ? ['evidence_read'] : ['scripted-praise', 'always-agree', 'always-oppose'].includes(id) ? ['development_control_emit'] : ['speech_send', 'memory_retrieve', 'obligation_owe', 'initiative_agenda'], resources: roleResources }));
  const schedule: NonNullable<DevelopmentAcquisitionPlan['protocol']>['schedule'] = [], assignments: any[] = [];
  const add = (roleId: string, phase: typeof schedule[number]['phase'], n: number) => { for (let ordinal = 0; ordinal < n; ordinal++) { const id = `${phase}:${ordinal}`; schedule.push({ roleId, assignmentId: id, phase, ordinal }); assignments.push({ roleId, id, message: { source: 'direct', externalId: id, revision: '1', conversation: `${roleId}:${id}`, text: JSON.stringify({ version: 1, task: 'Judge this public proposition and supplied feedback', proposition: { id, text: 'Two plus two equals four' } }), actor: { id: 'public-host', scope: { kind: 'public' }, modificationEligible: false } } }); } };
  for (const roleId of ['candidate', 'no-memory', 'no-standing-goals']) for (const [phase, n] of [['opportunity', 12], ['learning', 3], ['interference', 9], ['feedback', 12]] as const) add(roleId, phase, n);
  for (const roleId of ['scripted-praise', 'always-agree', 'always-oppose']) { add(roleId, 'script', 3); add(roleId, 'script-feedback', 3); }
  const packet = f.put({ version: 1, assignments });
  const registration: DevelopmentRegistration = { version: 2, attemptDigest: identity(m), rootId: 'operating-envelope:v1', rootCancelled: false, registeredAt: m.registeredAt, reviewDeadlineAt: at(290), observerClosureDigest: f.trust.observer.artifactDigest, closureVerifierDigest: identity('synthetic verifier'), assignmentDigest: packet.sha256, roles, originalRequests: [] };
  const plan: DevelopmentAcquisitionPlan = { version: 2, id: 'public-ordinary-driver-fixture', manifest: signDocument(domains.attempt, m, 'issuer', f.keys.get('issuer')!), registration: signDocument(reviewEnvelopeDomains.registration, registration, 'issuer', f.keys.get('issuer')!), assignmentPacket: packet, originalStateFile: join(config.stateDirectory, 'operational.sqlite'), closures: { node: identity('pinned node fixture'), dependencies: m.candidate.dependencies, prompts: m.candidate.prompts, tools: identity('fixture tools'), acquisition: m.acquisitionDigest }, rawStore: raw.identity(), roles: roles.map(role => ({ roleId: role.id, stateFile: join(configs.get(role.id)!.stateDirectory, 'operational.sqlite'), workspace: configs.get(role.id)!.workspaceDirectory, configuration: f.put(configs.get(role.id)), closure: f.put({ id: role.id, synthetic: 'exact-source-closure' }), journal: role.kind === 'reviewer' ? null : { stream: `journal:${role.id}`, hostId: `host:${role.id}`, maxAnchorDocuments: 512, maxAnchorBytes: 1000000 }, maxDrafts: 64, maxPayloadBytes: 65536, maxPromptBytes: 65536, maxFragmentBytes: 65536, maxResponseBytes: 4096 })),
    capacity: { captureBytes: 854228992, maxSnapshots: 156, maxSnapshotBytes: 1048576, envelopeBytes: 75497472, transitionBytes: 4096, failureBytes: 65536, inventoryEntryBytes: 384, maxArtifacts: 13568, maxObservations: 424 },
    captureLayout: { kind: 'complete-pages-global-originals-v1', page: { maxPageRows: 512, maxPageBytes: 262144, maxPages: 64, maxPhysicalRows: 32768, maxConservativeBytes: 16777216, maxSerializedBytes: 4194304, maxOperationalArtifacts: 2048, maxOperationalArtifactBytes: 1000000, maxOperationalArtifactTotalBytes: 16777216 }, maxManifestBytes: 1048576, maxCaptureIndexBytes: 4096, referencedOriginalPool: { maxOriginals: 2048, maxBytes: 16777216 }, sourcePool: { maxArtifacts: 32, maxBytes: 1048576 }, proofPool: { maxArtifacts: 256, maxBytes: 16777216, mandatoryArtifacts: 202, mandatoryArtifactBytes: 65536 }, metadata: { behaviorBytes: 16777216, finalBytes: 25165824, ownerWithoutBehaviorBytes: 25165824, ownerBytes: 41943040 } }, protocol: { nonRequestObservations: 40, initialCaptures: 6, cycleCaptures: 6, boundaryCaptures: 12, schedule } };
  const setup = new OperationalStore({ filename: plan.originalStateFile, documentJournal: plan.roles[0]!.journal }); chmodSync(setup.filename, 0o600);
  const ceiling = { tokens: 100000, costUsd: 1, elapsedMs: 5000 };
  const original = new ResourceLedger(setup, ceiling, () => base - 5000); original.allocate(registration.rootId, rootResources); for (const role of roles) original.allocate(role.allocationId, role.resources, registration.rootId);
  const anchors = new Map(setup.list('allocations').map(row => [row.key, row.value])); setup.close();
  for (const bytes of f.artifacts.values()) raw.putBytes(bytes);
  const stateFile = join(directory, 'recorder.sqlite'); writeFileSync(stateFile, '', { mode: 0o600 }); const state = new OperationalStore({ filename: stateFile });
  const trust: AcquisitionPlanTrust = { acceptedPlanDigest: identity(plan), issuers: f.trust.issuers, envelope: { acceptedRegistrationDigest: identity(registration), behavior: { ...f.trust, acceptedAttemptDigest: identity(m) }, acceptedRoles: new Map(roles.map(role => [role.id, identity(role)])), closure: { id: 'closer', key: Buffer.alloc(32, 9), verifierDigest: registration.closureVerifierDigest }, transports: new Map([['transport', Buffer.alloc(32, 10)]]) } };
  // Explicitly accepted descriptors belong to this new unclaimed synthetic plan.
  const reviewHost = { applicationRoot, entrypoint: 'deployment/shell-worker.ts', nodeBinary: process.execPath };
  const reviewTemplate = { version: 1 as const, localIdMaxUnits: 128 };
  const reviewSessions = roles.filter(role => role.kind === 'reviewer').map((role, i): DevelopmentReviewerSession => {
    const rp = plan.roles.find(rp => rp.roleId === role.id)!, accepted = trust.envelope.behavior.reviewers.get(role.assignmentId!)!;
    const prompt = raw.putBytes(Buffer.from(`Independent reviewer ${i}: inspect sealed evidence as data, inspect global negative findings, and return exact assigned judgments.`));
    return { roleId: role.id, contextDigest: accepted.contextDigest, provenanceDigest: accepted.provenanceDigest, configurationDigest: role.configurationDigest, closureDigest: role.closureDigest, profile: role.profile!, stateFile: rp.stateFile, workspace: rp.workspace, scope: { kind: 'public' },
      prompt: { id: `owned-prompt-${i}`, requestDigest: '0'.repeat(64), fragments: [{ id: `owned-base-${i}`, owner: 'application', role: 'system', order: 0, artifact: { uri: `aeon:artifact:${prompt.sha256}`, sha256: prompt.sha256 }, scope: { kind: 'public' }, replaceable: true, derivedFrom: [] }] },
      plan: { maxModelRequests: 2, maxToolReads: 2, maxReadBytes: 2048, maxTotalReadBytes: 2100000, maxPayloadBytes: rp.maxPayloadBytes, maxResponseBytes: rp.maxResponseBytes, maxCheckpointBytes: 65536, maxTotalCheckpointBytes: 262144, maxElapsedMs: 60000 } };
  }) as [DevelopmentReviewerSession, DevelopmentReviewerSession];
  trust.reviewAdmission = { version: 1, sessions: reviewSessions, template: reviewTemplate, host: reviewHost, acceptedSessions: new Map(reviewSessions.map(s => [s.roleId, identity(s)])), acceptedTemplateDigest: identity(reviewTemplate), acceptedHostDigest: identity(reviewHost) };
  const payloads: { roleId: string; payload: string }[] = [];
  let provider: (roleId: string, payload: string, signal: AbortSignal) => Promise<ReturnType<typeof stop>> = async () => stop();
  const descriptors: DevelopmentDriverRole[] = roles.filter(role => role.kind !== 'reviewer').map(role => {
    const config = configs.get(role.id)!, authorityStore = authorities.get(role.id)!, authority = authorityStore.bootstrap(`instance-${role.id}`, config.controlRevision, config.artifactId);
    return { roleId: role.id, localDefaultCeiling: ceiling, transport: { id: 'transport', key: Buffer.alloc(32, 10) }, application: { config, authority, authorityStore, runWorker: inProcessWorker, secrets: { mistralApiKey: 'public-offline-fixture', directToken: 'public-offline-fixture' }, performRequest: async (payload, signal) => { payloads.push({ roleId: role.id, payload }); return provider(role.id, payload, signal); } } };
  });
  const options: DevelopmentDriverOptions = { document: signDocument(acquisitionPlanDomain, plan, 'issuer', f.keys.get('issuer')!), trust, state, raw, originalDefaultCeiling: ceiling, syntheticClock: () => ({ wallMs: now, monotonicMs: now - (base - 5000), bootId: 'public-synthetic-boot', processStart: 'public-synthetic-process' }), roles: descriptors };
  const policy: SourceAdmissionPolicy = { version: 1, planDigest: identity(plan), workload: null, checkerId: null,
    checkerSourceDigest: null, extractorSourceDigest: null, rubricDigest: null, qualification: null, clockQualification: null,
    bounds: { maxMetadataRecords: 131072, maxMetadataBytes: 67108864, maxProofBytes: 65536, maxCheckerBytes: 65536 },
    adaptationOrdinals: { policy: 0, workload: null, qualification: null, clockQualification: null, learningChecks: [], scriptChecks: [] } };
  const composition: RecorderSourceAdmission['composition'] = { version: 1, layout: 'source-admission-fixed-54-v1', maxExtractedBytes: 65536, support: [] };
  const admission: RecorderSourceAdmission = { policy, trust: { acceptedPolicyDigest: identity(policy), acceptedQualificationDigest: null, checker: null, acceptedClockQualificationDigest: null }, composition, acceptedCompositionDigest: identity(composition) };
  options.sourceAdmission = admission;
  let driver: Awaited<ReturnType<typeof DevelopmentAcquisitionDriver.prepare>> | undefined;
  const open = async () => { driver = await DevelopmentAcquisitionDriver.prepare(options); return driver; };
  // Re-sign only NEW unclaimed fixture inputs for rejection tests; no claimed plan changes.
  const resign = () => {
    for (const rp of plan.roles) { rp.configuration = raw.put(configs.get(rp.roleId)); roles.find(role => role.id === rp.roleId)!.configurationDigest = rp.configuration.sha256; }
    const c = configs.get('candidate')!; m.candidate.configuration = identity(c); m.candidate.model = identity(c.model); const { id: priorId, ...newFields } = m.candidate; m.candidate.id = candidateIdentity(newFields); m.configurationArtifact = raw.put(c);
    const source = { ...candidateArtifact, inputs: { ...inputs, configuration: c, model: c.model }, manifest: m.candidate }; m.candidateArtifact = raw.put(source);
    plan.manifest = signDocument(domains.attempt, m, 'issuer', f.keys.get('issuer')!); registration.attemptDigest = identity(m); plan.registration = signDocument(reviewEnvelopeDomains.registration, registration, 'issuer', f.keys.get('issuer')!);
    trust.envelope.behavior.acceptedAttemptDigest = identity(m); trust.envelope.acceptedRegistrationDigest = identity(registration); trust.envelope.acceptedRoles = new Map(roles.map(role => [role.id, identity(role)])); trust.acceptedPlanDigest = identity(plan); options.document = signDocument(acquisitionPlanDomain, plan, 'issuer', f.keys.get('issuer')!);
  };
  t.after(async () => { await driver?.closeApplications(); if (driver) for (const role of roles.filter(role => role.kind !== 'reviewer').sort((a, b) => Number(a.kind === 'candidate') - Number(b.kind === 'candidate'))) await driver.application(role.id).application.close().catch(() => undefined); raw.close(); state.close(); for (const authority of authorities.values()) authority.close(); rmSync(directory, { recursive: true, force: true }); });
  return { f, directory, m, roles, plan, registration, configs, descriptors, options, admission, anchors, state, raw, payloads, open, resign, setTime: (seconds: number) => { now = base + seconds * 1000; }, setProvider: (next: typeof provider) => { provider = next; }, get driver() { return driver!; } };
}
async function until(predicate: () => boolean, message: string, diagnostic?: () => unknown) { for (let n = 0; n < 200; n++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail(`${message}${diagnostic ? `: ${canonicalJson(diagnostic())}` : ''}`); }

test('driver admits actual registered source and keeps mechanical experience unavailable', async t => {
  const f = fixture(t), driver = await f.open(), before = driver.recorder.status().snapshots.find(s => s.roleId === 'candidate')!.artifact;
  f.setTime(0); const runId = driver.ingestRegisteredAssignment('candidate', 'opportunity:0');
  await until(() => driver.application('candidate').application.runtime.getRun(runId)?.status === 'completed', 'actual assignment did not finish', () => workerFailures);
  f.setTime(30); const pair = await driver.observeOrdinaryStep('candidate');
  const selector = { roleId: 'candidate', assignmentId: 'opportunity:0', before, after: pair.after };
  const inspected = driver.inspectAssignment(selector); assert.equal(inspected.status, 'derived', canonicalJson(inspected));
  if (inspected.status !== 'derived') return;
  assert.equal(inspected.proof.source.assignment.runId, runId); assert.equal(inspected.proof.acquisition, 'completed'); assert.ok(inspected.proof.output);
  const source = driver.application('candidate'); assert.equal(source.accounting.originalResources.store, source.application.store);
  assert.equal(f.payloads.length, 1); assert.equal(source.accounting.states().length, 1);
  const unavailable = driver.recordExperience({ ...selector, interferenceId: f.m.opportunities[0]!.interferenceIds[0]! });
  assert.equal(unavailable.status, 'unavailable');
  const changed = driver.inspectAssignment({ ...selector, assignmentId: 'foreign' }); assert.notEqual(changed.status, 'derived');
});

test('driver records an actual scheduler selection without claiming autonomous origin', async t => {
  const f = fixture(t), clock = f.options.syntheticClock!;
  t.mock.timers.enable({ apis: ['Date'], now: clock().wallMs });
  const time = (seconds: number) => { f.setTime(seconds); t.mock.timers.setTime(clock().wallMs); };
  const driver = await f.open(), source = driver.application('candidate'), app = source.application;
  time(0); driver.recorder.begin();
  const goal = app.goals.propose({ id: 'driver-mechanical-cycle', origin: { kind: 'self' }, purpose: 'Inspect this synthetic scheduling opportunity', scope: { kind: 'public' }, successCriteria: ['retain actual observations'], evidenceIds: [], dependencyIds: [], resources: f.roles[0]!.resources, priority: 1, nextAction: 'inspect', reviewAt: new Date().toISOString() }, { sourceIds: ['synthetic-host-setup'], actorId: 'fixture-host', recordedAt: new Date().toISOString(), derivation: 'interpreted' });
  app.goals.accept(goal.id, goal.revision, 'synthetic mechanical fixture');
  time(60); const pair = await driver.observeOrdinaryStep('candidate');
  await until(() => {
    const execution = app.store.get<{runId: string}>('initiative.execution', goal.id)?.value;
    return !!execution && app.runtime.getRun(execution.runId)?.status === 'completed';
  }, 'actual initiative run did not finish', () => ({ failures: workerFailures, executions: app.store.list('initiative.execution'), runs: app.store.list('runs') }));
  time(61); const after = driver.recorder.captureApplication('candidate', app, source.accounting);
  const selection = app.store.events().find(event => event.type === 'selection' && (event.data as any).kind === 'selected'); assert.ok(selection);
  const selector = { roleId: 'candidate', before: pair.before, after, cycleId: f.m.cycles[0]!, selectionId: selection.id };
  const recorded = driver.recordCycle(selector); assert.equal(recorded.status, 'recorded', canonicalJson(recorded));
  if (recorded.status !== 'recorded') return;
  const proof = JSON.parse(driver.recorder.readArtifact(recorded.proof, 65536).toString());
  assert.equal(proof.origin, 'unknown'); assert.equal(proof.autonomy, 'unavailable'); assert.equal(proof.source.cycle.selection.id, selection.id);
  const state = driver.recorder.status(); assert.ok(state.proofs?.some(p => p.kind === 'cycle' && p.artifact.sha256 === recorded.proof.sha256));
  assert.ok(state.observations.some(o => o.value.id === recorded.observationId && o.value.data.kind === 'cycle'));
  assert.deepEqual(driver.recordCycle(selector), recorded);
  const changed = driver.recordCycle({ ...selector, selectionId: 'different-selection' });
  assert.equal(changed.status, 'failed'); assert.match(changed.code, /selector changed/);
});

for (const field of ['policy', 'composition'] as const) test(`driver rejects unaccepted ${field} before claiming or creating applications`, async t => {
  const f = fixture(t), beforeWorkers = workers;
  if (field === 'policy') f.admission.trust.acceptedPolicyDigest = identity('unaccepted'); else f.admission.acceptedCompositionDigest = identity('unaccepted');
  await assert.rejects(f.open());
  assert.equal(f.state.get('development.driver', f.plan.id), undefined); assert.equal(f.state.get('development.acquisition', f.plan.id), undefined);
  assert.equal(workers, beforeWorkers); assert.equal(f.payloads.length, 0);
});

for (const boundary of ['option-getter', 'nested-getter', 'option-proxy', 'options-proxy'] as const) test(`driver refuses ${boundary} without executing caller code`, async t => {
  const f = fixture(t); let calls = 0;
  const trap = () => { calls++; throw new Error('caller trap executed'); };
  if (boundary === 'option-getter') Object.defineProperty(f.options, 'sourceAdmission', { enumerable: true, get: trap });
  else if (boundary === 'nested-getter') Object.defineProperty(f.admission.policy, 'version', { enumerable: true, get: trap });
  else if (boundary === 'option-proxy') f.options.sourceAdmission = new Proxy(f.admission, { get: trap, ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap });
  const options = boundary === 'options-proxy' ? new Proxy(f.options, { get: trap, ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap }) : f.options;
  await assert.rejects(DevelopmentAcquisitionDriver.prepare(options)); assert.equal(calls, 0); assert.equal(f.state.get('development.driver', f.plan.id), undefined);
});

test('driver pins admission before its clock callback can mutate the caller descriptor', async t => {
  const f = fixture(t), clock = f.options.syntheticClock!; let calls = 0;
  f.options.syntheticClock = () => { calls++; f.admission.acceptedCompositionDigest = identity('changed during callback'); f.admission.trust.acceptedPolicyDigest = identity('also changed'); return clock(); };
  const driver = await f.open(); assert.ok(calls > 0); assert.equal(driver.recorder.status().phase, 'claimed');
  assert.ok(driver.recorder.status().proofs?.some(p => p.kind === 'adaptation' && p.ordinal === 0));
});

test('driver captures injected timing and worker before preclaim callbacks and actual application execution', async t => {
  const f = fixture(t), descriptor = f.descriptors[0]!, originalClock = f.options.syntheticClock!;
  let ticks = 0, timeoutCalls = 0, workerCalls = 0;
  const timing = { monotonicNow: () => ticks++ * 25, timeoutSignal: (ms: number) => { timeoutCalls++; assert.equal(ms, 5000); return new AbortController().signal; } };
  const runner = async (options: WorkerOptions) => { workerCalls++; return inProcessWorker(options); };
  descriptor.application.brokerTiming = timing; descriptor.application.runWorker = runner;
  const poisoned = () => { throw Error('late caller dependency was read'); };
  f.options.syntheticClock = () => { timing.monotonicNow = poisoned; timing.timeoutSignal = poisoned; descriptor.application.runWorker = async () => poisoned(); return originalClock(); };
  const driver = await f.open();
  assert.equal(driver.application('candidate').application.options.runWorker, runner);
  f.setTime(0); const id = driver.ingestRegisteredAssignment('candidate', 'opportunity:0');
  await until(() => driver.application('candidate').application.runtime.getRun(id)?.status === 'completed', 'injected application run did not finish', () => workerFailures);
  assert.equal(workerCalls, 1); assert.equal(timeoutCalls, 1); assert.equal(ticks, 2);
  const state = driver.application('candidate').accounting.states()[0]!;
  assert.equal(state.request.usage.elapsedMs, 25); assert.equal(state.request.status, 'succeeded');
});

test('driver source inspection refuses after an unrelated captured role withdraws content', async t => {
  const f = fixture(t), driver = await f.open(), before = driver.recorder.status().snapshots.find(s => s.roleId === 'candidate')!.artifact;
  f.setTime(0); const id = driver.ingestRegisteredAssignment('candidate', 'opportunity:0');
  await until(() => driver.application('candidate').application.runtime.getRun(id)?.status === 'completed', 'actual assignment did not finish');
  f.setTime(30); const pair = await driver.observeOrdinaryStep('candidate');
  const selector = { roleId: 'candidate', assignmentId: 'opportunity:0', before, after: pair.after };
  assert.equal(driver.inspectAssignment(selector).status, 'derived');
  const other = driver.application('no-memory').application;
  other.store.put('fixture-public', 'target', { fact: 'later withdrawn source' }, null);
  await driver.observeOrdinaryStep('no-memory');
  other.store.withdrawDocumentJournalContent({ id: 'public-withdrawal', reason: 'forget', targets: [{ namespace: 'fixture-public', key: 'target', expectedRevision: 1 }] });
  const count = driver.recorder.status().observations.length;
  const denied = driver.inspectAssignment(selector); assert.equal(denied.status, 'unavailable');
  assert.match(denied.code, /withdrawn/);
  assert.equal(driver.recorder.status().observations.length, count);
  assert.ok(driver.recorder.status().useDisposition);
});

test('all source entry methods refuse once driver close begins without inspecting selectors', async t => {
  const f = fixture(t), driver = await f.open(); const close = driver.closeApplications(); let reads = 0;
  const selector = new Proxy({}, { get() { reads++; throw new Error('closed selector inspected'); } }) as never;
  assert.throws(() => driver.inspectAssignment(selector), /closing/); assert.throws(() => driver.recordCycle(selector), /closing/);
  assert.throws(() => driver.recordExperience(selector), /closing/); assert.throws(() => driver.importSourceCheck(selector), /closing/);
  assert.throws(() => driver.importSourceSupport(selector), /closing/); assert.equal(reads, 0); assert.deepEqual((await close).errors, []);
});

