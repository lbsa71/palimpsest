import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { mock, type TestContext } from 'node:test';
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

assert.ok(process.execArgv.includes('--experimental-test-module-mocks'), 'Explicit in-process worker mock required; refusing physical fallback');
let workers = 0; const workerFailures: string[] = [];
mock.module('../../packages/supervisor/worker-process.ts', { namedExports: { runWorker: async (options: WorkerOptions): Promise<JsonValue> => {
  workers++;
  const start = options.initial as unknown as { input: ShellInput; options: ShellOptions; fragments: Record<string, string> };
  const call = <T>(method: string, ...args: unknown[]) => options.handle(method, args as JsonValue[], options.command.signal ?? new AbortController().signal).catch(error => { workerFailures.push(`${method}: ${String(error)}`); throw error; }) as Promise<T>;
  const shell = createAgentShell({ ...start.options, apiKey: () => 'public-offline-fixture', resolveFragment: async fragment => start.fragments[fragment.artifact.sha256]!, fetch: async (_url, init) => { const response = await call<{ status: number; body: string }>('provider.fetch', init!.body); return new Response(response.body, { status: response.status }); } });
  const bridge: ShellBridge = { execute: (...args) => call('execute', ...args), persistCheckpoint: (...args) => call('persistCheckpoint', ...args), readCheckpoint: (...args) => call('readCheckpoint', ...args), capturePrompt: (...args) => call('capturePrompt', ...args), reserve: (...args) => call('reserve', ...args), dispatched: (...args) => call('dispatched', ...args), settle: (...args) => call('settle', ...args) };
  return await shell.run(start.input, bridge, options.command.signal) as unknown as JsonValue;
} } });
const { DevelopmentAcquisitionDriver, DevelopmentDriverPreparationFailure } = await import('./development-driver.ts');
const { AutarkApplication } = await import('../../deployment/application.ts');
const { DevelopmentAcquisitionRecorder } = await import('./acquire.ts');
const stop = () => ({ status: 200, body: JSON.stringify({ model: 'synthetic-model', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Public offline response' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) });

/** Actual applications with NEW signed full126/156 paged plan. Only a few deliveries run. */
function fixture(t: TestContext) {
  const f = syntheticWitnessFixture(), directory = mkdtempSync(join(tmpdir(), 'aeon-ordinary-driver-'));
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
  const roles: DevelopmentRoleBinding[] = [...configs.keys()].map((id, index) => ({ id, kind: index === 0 ? 'candidate' : index <= m.controls.length ? 'control' : 'reviewer', assignmentId: index === 0 ? null : id, allocationId: `role:${id}`, configurationDigest: identity(configs.get(id)!), closureDigest: identity({ id, synthetic: 'exact-source-closure' }), profile: configs.get(id)!.model, allowedEffects: ['scripted-praise', 'always-agree', 'always-oppose'].includes(id) ? ['development_control_emit'] : ['speech_send', 'memory_retrieve', 'obligation_owe', 'initiative_agenda'], resources: roleResources }));
  const schedule: NonNullable<DevelopmentAcquisitionPlan['protocol']>['schedule'] = [], assignments: any[] = [];
  const add = (roleId: string, phase: typeof schedule[number]['phase'], n: number) => { for (let ordinal = 0; ordinal < n; ordinal++) { const id = `${phase}:${ordinal}`; schedule.push({ roleId, assignmentId: id, phase, ordinal }); assignments.push({ roleId, id, message: { source: 'direct', externalId: id, revision: '1', conversation: `${roleId}:${id}`, text: JSON.stringify({ version: 1, task: 'Judge this public proposition and supplied feedback', proposition: { id, text: 'Two plus two equals four' } }), actor: { id: 'public-host', scope: { kind: 'public' }, modificationEligible: false } } }); } };
  for (const roleId of ['candidate', 'no-memory', 'no-standing-goals']) for (const [phase, n] of [['opportunity', 12], ['learning', 3], ['interference', 9], ['feedback', 12]] as const) add(roleId, phase, n);
  for (const roleId of ['scripted-praise', 'always-agree', 'always-oppose']) { add(roleId, 'script', 3); add(roleId, 'script-feedback', 3); }
  const packet = f.put({ version: 1, assignments });
  const registration: DevelopmentRegistration = { version: 2, attemptDigest: identity(m), rootId: 'operating-envelope:v1', rootCancelled: false, registeredAt: m.registeredAt, reviewDeadlineAt: at(290), observerClosureDigest: f.trust.observer.artifactDigest, closureVerifierDigest: identity('synthetic verifier'), assignmentDigest: packet.sha256, roles, originalRequests: [] };
  const plan: DevelopmentAcquisitionPlan = { version: 2, id: 'public-ordinary-driver-fixture', manifest: signDocument(domains.attempt, m, 'issuer', f.keys.get('issuer')!), registration: signDocument(reviewEnvelopeDomains.registration, registration, 'issuer', f.keys.get('issuer')!), assignmentPacket: packet, originalStateFile: join(config.stateDirectory, 'operational.sqlite'), closures: { node: identity('pinned node fixture'), dependencies: m.candidate.dependencies, prompts: m.candidate.prompts, tools: identity('fixture tools'), acquisition: m.acquisitionDigest }, rawStore: raw.identity(), roles: roles.map(role => ({ roleId: role.id, stateFile: join(configs.get(role.id)!.stateDirectory, 'operational.sqlite'), workspace: configs.get(role.id)!.workspaceDirectory, configuration: f.put(configs.get(role.id)), closure: f.put({ id: role.id, synthetic: 'exact-source-closure' }), journal: { stream: `journal:${role.id}`, hostId: `host:${role.id}`, maxAnchorDocuments: 512, maxAnchorBytes: 1000000 }, maxDrafts: 64, maxPayloadBytes: 65536, maxPromptBytes: 65536, maxFragmentBytes: 65536, maxResponseBytes: 4096 })),
    capacity: { captureBytes: 854228992, maxSnapshots: 156, maxSnapshotBytes: 1048576, envelopeBytes: 75497472, transitionBytes: 4096, failureBytes: 65536, inventoryEntryBytes: 384, maxArtifacts: 13568, maxObservations: 424 },
    captureLayout: { kind: 'complete-pages-global-originals-v1', page: { maxPageRows: 512, maxPageBytes: 262144, maxPages: 64, maxPhysicalRows: 32768, maxConservativeBytes: 16777216, maxSerializedBytes: 4194304, maxOperationalArtifacts: 2048, maxOperationalArtifactBytes: 1000000, maxOperationalArtifactTotalBytes: 16777216 }, maxManifestBytes: 1048576, maxCaptureIndexBytes: 4096, referencedOriginalPool: { maxOriginals: 2048, maxBytes: 16777216 }, sourcePool: { maxArtifacts: 32, maxBytes: 1048576 }, proofPool: { maxArtifacts: 256, maxBytes: 16777216, mandatoryArtifacts: 202, mandatoryArtifactBytes: 65536 }, metadata: { behaviorBytes: 16777216, finalBytes: 25165824, ownerWithoutBehaviorBytes: 25165824, ownerBytes: 41943040 } }, protocol: { nonRequestObservations: 40, initialCaptures: 6, cycleCaptures: 6, boundaryCaptures: 12, schedule } };
  const setup = new OperationalStore({ filename: plan.originalStateFile, documentJournal: plan.roles[0]!.journal }); chmodSync(setup.filename, 0o600);
  const ceiling = { tokens: 100000, costUsd: 1, elapsedMs: 5000 };
  const original = new ResourceLedger(setup, ceiling, () => base - 5000); original.allocate(registration.rootId, rootResources); for (const role of roles) original.allocate(role.allocationId, role.resources, registration.rootId);
  const anchors = new Map(setup.list('allocations').map(row => [row.key, row.value])); setup.close();
  for (const bytes of f.artifacts.values()) raw.putBytes(bytes);
  const stateFile = join(directory, 'recorder.sqlite'); writeFileSync(stateFile, '', { mode: 0o600 }); const state = new OperationalStore({ filename: stateFile });
  const trust: AcquisitionPlanTrust = { acceptedPlanDigest: identity(plan), issuers: f.trust.issuers, envelope: { acceptedRegistrationDigest: identity(registration), behavior: { ...f.trust, acceptedAttemptDigest: identity(m) }, acceptedRoles: new Map(roles.map(role => [role.id, identity(role)])), closure: { id: 'closer', key: Buffer.alloc(32, 9), verifierDigest: registration.closureVerifierDigest }, transports: new Map([['transport', Buffer.alloc(32, 10)]]) } };
  const payloads: { roleId: string; payload: string }[] = [];
  let provider: (roleId: string, payload: string, signal: AbortSignal) => Promise<ReturnType<typeof stop>> = async () => stop();
  const descriptors: DevelopmentDriverRole[] = roles.filter(role => role.kind !== 'reviewer').map(role => {
    const config = configs.get(role.id)!, authorityStore = authorities.get(role.id)!, authority = authorityStore.bootstrap(`instance-${role.id}`, config.controlRevision, config.artifactId);
    return { roleId: role.id, localDefaultCeiling: ceiling, transport: { id: 'transport', key: Buffer.alloc(32, 10) }, application: { config, authority, authorityStore, secrets: { mistralApiKey: 'public-offline-fixture', directToken: 'public-offline-fixture' }, performRequest: async (payload, signal) => { payloads.push({ roleId: role.id, payload }); return provider(role.id, payload, signal); } } };
  });
  const options: DevelopmentDriverOptions = { document: signDocument(acquisitionPlanDomain, plan, 'issuer', f.keys.get('issuer')!), trust, state, raw, originalDefaultCeiling: ceiling, syntheticClock: () => ({ wallMs: now, monotonicMs: now - (base - 5000), bootId: 'public-synthetic-boot', processStart: 'public-synthetic-process' }), roles: descriptors };
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
  return { f, directory, m, roles, plan, registration, configs, descriptors, options, anchors, state, raw, payloads, open, resign, setTime: (seconds: number) => { now = base + seconds * 1000; }, setProvider: (next: typeof provider) => { provider = next; }, get driver() { return driver!; } };
}
async function until(predicate: () => boolean, message: string, diagnostic?: () => unknown) { for (let n = 0; n < 200; n++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail(`${message}${diagnostic ? `: ${canonicalJson(diagnostic())}` : ''}`); }

test('prepare binds six actual application Stores and unchanged original allocation anchors with zero dispatch/listeners', async t => {
  const f = fixture(t), beforeWorkers = workers, driver = await f.open();
  assert.equal(f.plan.protocol!.schedule.length, 126); assert.equal(driver.recorder.status().snapshots.length, 6);
  const original = driver.application('candidate').accounting.originalResources;
  for (const [roleId, value] of f.anchors) assert.deepEqual(original.store.get('allocations', roleId)!.value, value);
  for (const descriptor of f.descriptors) { const { application: app, accounting } = driver.application(descriptor.roleId); assert.ok(app instanceof AutarkApplication); assert.equal(accounting.originalResources, original); assert.equal(app.resources, accounting.resources); assert.equal(app.runtime.store, app.store); assert.equal(app.communications.options.runtime, app.runtime); assert.equal(app.directApi.listening, false); assert.equal(app.options.performRequest, descriptor.application.performRequest); assert.equal(app.options.authorityStore, descriptor.application.authorityStore); assert.equal(app.options.secrets, descriptor.application.secrets); assert.equal(app.store.documentJournalBinding()!.stream, f.plan.roles.find(role => role.roleId === descriptor.roleId)!.journal!.stream); }
  assert.equal(original.store, driver.application('candidate').application.store); assert.equal(original.store.filename, f.plan.originalStateFile); assert.equal(original.snapshot(f.registration.rootId).requests, 0); assert.equal(workers, beforeWorkers); assert.equal(f.payloads.length, 0);
  assert.throws(() => driver.application('reviewer-a'), /Unregistered/);
});

test('all construction-time raw/current-use callbacks refuse until the final initial capture', async t => {
  const f = fixture(t); const probed = new Set<string>();
  const assertApplication = DevelopmentAccounting.prototype.assertApplication;
  const probe = mock.method(DevelopmentAccounting.prototype, 'assertApplication', function (this: DevelopmentAccounting, config: ApplicationConfig) {
    assertApplication.call(this, config);
    if (!this.resources.store.get('host.development-control', 'mode')) { probed.add(this.role.id); assert.throws(() => this.captureTool({ id: 'early', runId: 'early', stepId: 'early', name: 'speech_send', arguments: {} }), /not ready/); }
  });
  let initialProbes = 0; const capture = DevelopmentAcquisitionRecorder.prototype.captureApplication;
  const captured = mock.method(DevelopmentAcquisitionRecorder.prototype, 'captureApplication', function (this: ReturnType<typeof DevelopmentAcquisitionRecorder.claim>, ...args: Parameters<typeof capture>) { const ref = capture.apply(this, args); initialProbes++; assert.throws(() => args[2]!.captureTool({ id: 'early-cut', runId: 'early', stepId: 'early', name: 'speech_send', arguments: {} }), /not ready/); return ref; });
  const driver = await f.open(); probe.mock.restore(); captured.mock.restore(); assert.equal(probed.size, 6); assert.equal(initialProbes, 6); assert.equal(f.payloads.length, 0); assert.equal(driver.application('candidate').accounting.originalResources.snapshot(f.registration.rootId).requests, 0);
});

test('accepted callbacks, plain configuration, role/transport descriptors and signed document detach from caller mutation', async t => {
  const f = fixture(t); const candidate = f.descriptors[0]!, accepted = candidate.application.performRequest!; let reads = 0;
  Object.defineProperty(candidate.application, 'performRequest', { get: () => { reads++; return reads === 1 ? accepted : async () => { throw Error('substitute callback'); }; } });
  const driver = await f.open(); assert.equal(reads, 1);
  f.options.document.value.roles[0]!.maxDrafts = 1; f.options.trust.envelope.transports.get('transport')!.fill(0); candidate.transport.key.fill(0); candidate.roleId = 'foreign'; candidate.application.config.direct.actorId = 'foreign'; candidate.localDefaultCeiling.tokens = 0;
  assert.equal(driver.recorder.plan.roles[0]!.maxDrafts, 64); assert.equal(driver.application('candidate').application.options.performRequest, accepted); assert.equal(driver.application('candidate').application.config.direct.actorId, 'public-host'); assert.equal(driver.application('candidate').accounting.resources.defaultCeiling.tokens, 100000);
  f.setTime(0); const runId = driver.ingestRegisteredAssignment('candidate', 'opportunity:0'); await until(() => driver.application('candidate').application.runtime.getRun(runId)?.status === 'completed', 'accepted callback run failed', () => ({ workerFailures, payloads: f.payloads.length, run: driver.application('candidate').application.runtime.getRun(runId), execution: driver.application('candidate').application.store.list('execution'), states: driver.application('candidate').accounting.states(), phase: driver.recorder.status().phase, failure: driver.recorder.status().failure })); assert.ok(f.payloads.length); assert.equal(reads, 1);
});

for (const [name, mutate] of [
  ['missing role', (f: ReturnType<typeof fixture>) => { f.descriptors.pop(); }],
  ['duplicate role', (f: ReturnType<typeof fixture>) => { f.descriptors[1]!.roleId = 'candidate'; }],
  ['foreign accounting factory', (f: ReturnType<typeof fixture>) => { (f.descriptors[0]!.application as any).developmentAccounting = () => ({ fake: true }); }],
  ['foreign journal', (f: ReturnType<typeof fixture>) => { (f.descriptors[0]!.application as any).documentJournal = null; }],
  ['additional tools', (f: ReturnType<typeof fixture>) => { f.descriptors[0]!.application.additionalTools = () => []; }],
  ['changed plain config', (f: ReturnType<typeof fixture>) => { f.configs.get('candidate')!.direct.actorId = 'foreign'; }],
  ['unaccepted signer', (f: ReturnType<typeof fixture>) => { f.descriptors[0]!.transport.key.fill(0); }],
] as const) test(`${name} refuses before construction, dispatch and claim`, async t => {
  const f = fixture(t); mutate(f); const beforeWorkers = workers; await assert.rejects(f.open()); assert.equal(f.payloads.length, 0); assert.equal(workers, beforeWorkers); assert.equal(f.state.get('development.acquisition', f.plan.id), undefined); assert.equal(f.state.get('development.driver', f.plan.id), undefined);
});

for (const kind of ['always-agree', 'ordinary'] as const) test(`new signed wrong control kind ${kind} refuses before actual applications`, async t => {
  const f = fixture(t); f.configs.get('no-memory')!.developmentControl!.kind = kind; if (kind === 'ordinary') f.configs.get('no-memory')!.developmentControl!.assignmentId = null; f.resign(); await assert.rejects(f.open(), /control kind/); assert.equal(f.state.get('development.driver', f.plan.id), undefined); assert.equal(f.payloads.length, 0);
});

test('new signed unmatched public workload refuses before preparation claim', async t => {
  const f = fixture(t); f.configs.get('always-agree')!.developmentControl!.workloadDigest = identity('different-public-fixture'); f.resign(); await assert.rejects(f.open(), /Matched public workload/); assert.equal(f.state.get('development.driver', f.plan.id), undefined);
});

test('partial construction preserves original failure, closes earlier control then candidate and makes preparation one-use', async t => {
  const f = fixture(t), originalError = Error('actual later-role authority failure'), store = f.descriptors[2]!.application.authorityStore;
  const fail = mock.method(store, 'assert', () => { throw originalError; }); const closed: string[] = [], close = AutarkApplication.prototype.close;
  const tracking = mock.method(AutarkApplication.prototype, 'close', async function (this: InstanceType<typeof AutarkApplication>) { closed.push(this.config.developmentControl!.kind); return close.call(this); });
  await assert.rejects(f.open(), error => error === originalError); fail.mock.restore(); tracking.mock.restore(); assert.deepEqual(closed, ['no-memory', 'ordinary']);
  const retained = f.state.get<any>('development.driver', f.plan.id)!.value; assert.equal(retained.phase, 'failed'); assert.match(retained.failure, /actual later-role/); assert.equal(f.state.get('development.acquisition', f.plan.id), undefined);
  const source = new OperationalStore({ filename: f.plan.originalStateFile, documentJournal: f.plan.roles[0]!.journal }); for (const [id, value] of f.anchors) assert.deepEqual(source.get('allocations', id)!.value, value); assert.equal(source.list('requests').length, 0); source.close(); await assert.rejects(f.open(), /already consumed/);
});

test('registered candidate and real no-memory ingress create independent same-ID source bindings; duplicate/foreign admission refuses', async t => {
  const f = fixture(t), driver = await f.open(); f.setTime(0);
  const runId = driver.ingestRegisteredAssignment('candidate', 'opportunity:0'), controlRunId = driver.ingestRegisteredAssignment('no-memory', 'opportunity:0'); assert.equal(runId, controlRunId, 'same local input identity is independent across role Stores'); assert.notEqual(driver.application('candidate').application.store, driver.application('no-memory').application.store);
  assert.throws(() => driver.ingestRegisteredAssignment('candidate', 'opportunity:0'), /already attempted/); assert.throws(() => driver.ingestRegisteredAssignment('candidate', 'foreign'), /Unregistered assignment/);
  await until(() => f.payloads.length >= 2 && driver.application('candidate').application.runtime.getRun(runId)?.status === 'completed' && driver.application('no-memory').application.runtime.getRun(controlRunId)?.status === 'completed', 'actual ordinary runs did not complete', () => ({ workerFailures, payloads: f.payloads.length, execution: driver.application('candidate').application.store.list('execution'), states: driver.application('candidate').accounting.states(), phase: driver.recorder.status().phase, failure: driver.recorder.status().failure }));
  for (const id of ['candidate', 'no-memory']) { const app = driver.application(id).application, input = app.store.list('communications.inputs')[0]!; assert.ok(input); assert.ok(app.store.events().some(event => event.type === 'admitted')); assert.equal(app.runtime.getRun(id === 'candidate' ? runId : controlRunId)?.status, 'completed'); }
  for (const roleId of ['candidate', 'no-memory']) {
    const source = driver.application(roleId), state = source.accounting.states().find(state => state.roleId === roleId)!, rp = driver.recorder.plan.roles.find(role => role.roleId === roleId)!;
    const payloadBytes = driver.recorder.readArtifact(state.payload!, rp.maxPayloadBytes), promptBytes = driver.recorder.readArtifact(state.prompt!, rp.maxPromptBytes);
    const prompt = JSON.parse(promptBytes.toString()), fragmentBytes = prompt.manifest.fragments.map((fragment: any) => ({ id: fragment.id, bytes: source.application.store.readArtifact(fragment.artifact).byteLength }));
    const checkpoint = source.application.store.get<any>('execution', roleId === 'candidate' ? runId : controlRunId)!.value.checkpoint.artifact;
    const measured = { roleId, payloadBytes: payloadBytes.byteLength, toolSchemaBytes: Buffer.byteLength(canonicalJson(JSON.parse(payloadBytes.toString()).tools)), promptBytes: promptBytes.byteLength, instructionFragments: fragmentBytes, totalFragmentBytes: fragmentBytes.reduce((n: number, f: any) => n + f.bytes, 0), checkpointBytes: source.application.store.readArtifact(checkpoint).byteLength, signedBounds: { payload: rp.maxPayloadBytes, prompt: rp.maxPromptBytes, fragments: rp.maxFragmentBytes, response: rp.maxResponseBytes } };
    assert.ok(measured.totalFragmentBytes <= rp.maxFragmentBytes); t.diagnostic(canonicalJson(measured));
  }
  assert.equal(driver.recorder.status().deliveries.length, 2); assert.equal(driver.recorder.status().snapshots.length, 8); assert.equal(driver.application('candidate').accounting.originalResources.snapshot(f.registration.rootId).requests, 2);
  const payload = JSON.parse(f.payloads.find(p => p.roleId === 'no-memory')!.payload), context = payload.messages.filter((m: any) => m.role === 'user').map((m: any) => { try { return JSON.parse(m.content); } catch { return {}; } }).find((m: any) => m.hostContext).hostContext; assert.deepEqual(context.memory.self, []); assert.equal(payload.tools.some((tool: any) => tool.function.name === 'memory_retrieve'), false);
});

for (const roleId of ['scripted-praise', 'always-agree', 'always-oppose'] as const) test(`${roleId} dispatches real local accounted DC1 receipt with zero model work`, async t => {
  const f = fixture(t), driver = await f.open(), beforeWorkers = workers; f.setTime(0); const id = driver.ingestRegisteredAssignment(roleId, 'script:0'), app = driver.application(roleId).application;
  await until(() => app.runtime.getRun(id)?.status === 'completed', 'script run did not complete'); const result = app.runtime.observations(id).find(observation => observation.kind === 'result')!; assert.ok(result); assert.match(JSON.stringify(result.value), /modeSeal/); assert.equal(f.payloads.length, 0); assert.equal(workers, beforeWorkers); const states = driver.application(roleId).accounting.states(); assert.equal(states.length, 1); assert.equal(states[0]!.request.provider, 'effect-receiver'); assert.equal(states[0]!.request.status, 'succeeded');
});

test('ordinary capture pair returns while the actual transport is pending, retains real cuts, and preserves original uncertain charge on close', async t => {
  const f = fixture(t); let entered!: () => void; const entry = new Promise<void>(resolve => { entered = resolve; });
  f.setProvider(async (_role, _payload, signal) => { entered(); await new Promise<void>((_resolve, reject) => { if (signal.aborted) reject(signal.reason); else signal.addEventListener('abort', () => reject(signal.reason), { once: true }); }); return stop(); });
  const driver = await f.open(); f.setTime(0); const run = driver.ingestRegisteredAssignment('candidate', 'opportunity:0'); const pair = await driver.observeOrdinaryStep('candidate'); await until(() => f.payloads.length > 0, 'transport never entered'); await entry;
  const before = driver.recorder.openAcquiredCapture(pair.before).manifest, after = driver.recorder.openAcquiredCapture(pair.after).manifest;
  assert.ok(after.cut.lastSequence >= before.cut.lastSequence); assert.equal(pair.phase, 'acquiring'); assert.equal(driver.application('candidate').application.runtime.getRun(run)?.status, 'running'); assert.equal(driver.application('candidate').accounting.states()[0]!.request.status, 'dispatched');
  const close = await driver.closeApplications(); assert.deepEqual(close.errors, []); const source = new OperationalStore({ filename: f.plan.originalStateFile, documentJournal: f.plan.roles[0]!.journal }); const requests = source.list<any>('requests'); assert.equal(requests.length, 1); assert.equal(requests[0]!.value.request.status, 'uncertain'); assert.ok(requests[0]!.value.charged.tokens > 0); assert.equal(source.get<any>('budgets', f.registration.rootId)!.value.cancelled, false); source.close(); assert.equal(await driver.closeApplications(), close);
});

test('three ordinary pairs exhaust only fixed cycle cuts and protect all deliveries/finals/boundaries before another tick', async t => {
  const f = fixture(t), driver = await f.open(); for (let n = 0; n < 3; n++) await driver.observeOrdinaryStep('no-standing-goals'); const snapshots = canonicalJson(driver.recorder.status().snapshots), events = driver.application('no-standing-goals').application.store.events().length;
  assert.throws(() => driver.observeOrdinaryStep('no-standing-goals'), /pair budget/); assert.equal(canonicalJson(driver.recorder.status().snapshots), snapshots); assert.equal(driver.application('no-standing-goals').application.store.events().length, events); assert.equal(driver.recorder.plan.capacity.maxSnapshots, 156); assert.equal(driver.recorder.status().snapshots.length, 12);
});

test('all-role freeze retains six final committed cuts and unavailable boundary disposition without a competence upgrade', async t => {
  const f = fixture(t), driver = await f.open(); f.setTime(0); const id = driver.ingestRegisteredAssignment('always-agree', 'script:0'); await until(() => driver.application('always-agree').application.runtime.getRun(id)?.status === 'completed', 'script completion'); f.setTime(180);
  const b = driver.freezeBehavior(), state = driver.recorder.status(); assert.equal(state.phase, 'reviewing'); assert.equal(state.finalCaptures.length, 6); assert.equal(state.snapshots.length, 13); assert.equal(b.value.requests.length, 1); assert.ok(state.findings.some(finding => finding.code.startsWith('boundary-') && finding.status === 'unavailable')); assert.throws(() => driver.ingestRegisteredAssignment('candidate', 'opportunity:0'), /phase stopped/); assert.throws(() => driver.freezeBehavior(), /already frozen/);
});

test('source withdrawal remains terminal failure and cannot be converted to passing freeze', async t => {
  const f = fixture(t), driver = await f.open(), app = driver.application('no-memory').application; app.store.put('fixture-public', 'target', { fact: 'public source' }, null); await driver.observeOrdinaryStep('no-memory'); app.store.withdrawDocumentJournalContent({ id: 'public-withdrawal', reason: 'forget', targets: [{ namespace: 'fixture-public', key: 'target', expectedRevision: 1 }] });
  assert.throws(() => driver.ingestRegisteredAssignment('candidate', 'opportunity:0'), /withdrawn/); assert.throws(() => driver.freezeBehavior(), /withdrawn/); assert.equal(driver.recorder.status().useDisposition!.value.source, null); assert.equal(f.payloads.length, 0);
});

test('shutdown drains late authentic control response before candidate closes, retaining original response and request', async t => {
  const f = fixture(t); let entered!: () => void, release!: () => void; const entry = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  f.setProvider(async () => { entered(); await gate; return stop(); }); const driver = await f.open(); f.setTime(0); const id = driver.ingestRegisteredAssignment('no-memory', 'opportunity:0'); await until(() => f.payloads.length > 0, 'transport never entered'); await entry;
  const closed: string[] = [], close = AutarkApplication.prototype.close;
  const tracking = mock.method(AutarkApplication.prototype, 'close', async function (this: InstanceType<typeof AutarkApplication>) { closed.push(this.config.developmentControl!.kind); return close.call(this); });
  const closing = driver.closeApplications(); await new Promise(resolve => setImmediate(resolve)); assert.equal(driver.application('candidate').application.store.list('requests').length, 1); assert.throws(() => driver.ingestRegisteredAssignment('candidate', 'opportunity:0'), /closing/); release(); const result = await closing; tracking.mock.restore(); assert.deepEqual(result.errors, []); assert.equal(closed.at(-1), 'ordinary'); assert.equal(closed.length, 6);
  const source = new OperationalStore({ filename: f.plan.originalStateFile, documentJournal: f.plan.roles[0]!.journal }), state = source.list<any>('development.accounting.latest')[0]!.value; assert.equal(state.request.status, 'succeeded'); const reservation = driver.recorder.status().reservations[state.request.id]!; assert.ok(reservation.responseArtifacts.length > 0); assert.ok(f.raw.readArtifact({ uri: `sha256:${reservation.responseArtifacts[0]}`, sha256: reservation.responseArtifacts[0]! }, 4096).byteLength); assert.ok(id); source.close();
});

test('shutdown failures are retained without clearing recorder failure or original allowance', async t => {
  const f = fixture(t), driver = await f.open(), originalError = Error('actual shutdown fixture failure'), app = driver.application('always-agree').application, close = app.close.bind(app);
  mock.method(app, 'close', async () => { await close(); throw originalError; }); const result = await driver.closeApplications(); assert.equal(result.errors.length, 2); assert.match(result.errors[1]!.detail, /candidate-close-deferred/); assert.equal(result.errors[0]!.roleId, 'always-agree'); assert.match(result.errors[0]!.detail, /actual shutdown fixture/); assert.equal(driver.recorder.status().phase, 'failed'); assert.ok(driver.recorder.status().failure); assert.equal(f.state.get<any>('development.driver', f.plan.id)!.value.phase, 'failed'); await assert.rejects(f.open(), /already consumed/);
});

test('shutdown still drains all actual applications when owner disposition persistence fails', async t => {
  const f = fixture(t), driver = await f.open(), put = f.state.put.bind(f.state), closed: string[] = [], close = AutarkApplication.prototype.close;
  const tracking = mock.method(AutarkApplication.prototype, 'close', async function (this: InstanceType<typeof AutarkApplication>) { closed.push(this.config.developmentControl!.kind); return close.call(this); });
  const persistence = mock.method(f.state, 'put', (...args: Parameters<typeof put>) => { if (args[0] === 'development.driver') throw Error('owner disposition persistence failed'); return put(...args); });
  const result = await driver.closeApplications(); persistence.mock.restore(); tracking.mock.restore(); assert.equal(closed.length, 6); assert.equal(closed.at(-1), 'ordinary'); assert.equal(result.errors.length, 2); assert.equal(result.errors[0]!.roleId, 'owner'); assert.equal(driver.recorder.status().phase, 'failed'); assert.ok(driver.recorder.status().failure); assert.equal(await driver.closeApplications(), result);
});

for (const [name, mutate] of [
  ['signed assignment mismatch', (f: ReturnType<typeof fixture>) => { f.configs.get('no-memory')!.developmentControl!.assignmentId = 'different-control'; }],
  ['signed workspace mismatch', (f: ReturnType<typeof fixture>) => { f.configs.get('no-memory')!.workspaceDirectory = f.configs.get('always-agree')!.workspaceDirectory; }],
  ['signed model mismatch', (f: ReturnType<typeof fixture>) => { f.configs.get('no-memory')!.model.id = 'other-explicit-model'; }],
] as const) test(`${name} refuses before driver claim`, async t => {
  const f = fixture(t); mutate(f); f.resign(); await assert.rejects(f.open(), /configuration\/state\/workspace|control kind|model profile/); assert.equal(f.state.get('development.driver', f.plan.id), undefined); assert.equal(f.payloads.length, 0);
});

test('a consumed real recorder claim refuses preparation before new applications or original mutations', async t => {
  const f = fixture(t), driver = await f.open(); const before = canonicalJson(driver.application('candidate').application.store.list('allocations')), snapshots = canonicalJson(driver.recorder.status().snapshots); await assert.rejects(DevelopmentAcquisitionDriver.prepare(f.options), /already consumed/); assert.equal(canonicalJson(driver.application('candidate').application.store.list('allocations')), before); assert.equal(canonicalJson(driver.recorder.status().snapshots), snapshots); assert.equal(f.payloads.length, 0);
});

test('rejected pending control shutdown preserves candidate Store and late response for explicit host resolution', async t => {
  const f = fixture(t); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); f.setProvider(async () => { await gate; return stop(); });
  const driver = await f.open(); f.setTime(0); const control = driver.application('no-memory'), id = driver.ingestRegisteredAssignment('no-memory', 'opportunity:0'); await until(() => f.payloads.length > 0, 'pending provider did not enter');
  const refusal = mock.method(control.application, 'close', async () => { throw Error('shutdown rejected before draining pending control'); });
  const result = await driver.closeApplications(); refusal.mock.restore(); assert.equal(result.errors.length, 2); assert.match(result.errors[1]!.detail, /candidate-close-deferred/); assert.equal(driver.recorder.status().phase, 'failed');
  const original = driver.application('candidate').accounting.originalResources; assert.equal(original.store.list('requests').length, 1); assert.equal(original.snapshot(f.registration.rootId).cancelled, false); release();
  await until(() => original.store.list<any>('development.accounting.latest')[0]!.value.request.status === 'succeeded', 'late authentic response did not settle after failed close');
  const reservation = Object.values(driver.recorder.status().reservations)[0]!; assert.equal(reservation.responseArtifacts.length, 1); assert.ok(driver.recorder.readRetainedResponse(Object.keys(driver.recorder.status().reservations)[0]!, { uri: `sha256:${reservation.responseArtifacts[0]}`, sha256: reservation.responseArtifacts[0]! }, 4096).byteLength);
  await until(() => control.application.runtime.getRun(id)?.status !== 'running', 'control callback remained active'); await control.application.close(); await driver.application('candidate').application.close(); assert.equal(await driver.closeApplications(), result);
});

test('combined partial-construction cleanup failure retains exact original cause and candidate handles without retry', async t => {
  const f = fixture(t), originalError = Object.freeze(Error('original frozen construction failure')), originalClose = AutarkApplication.prototype.close;
  const failure = mock.method(f.descriptors[2]!.application.authorityStore, 'assert', () => { throw originalError; });
  const closing = mock.method(AutarkApplication.prototype, 'close', async function (this: InstanceType<typeof AutarkApplication>) { if (this.config.developmentControl!.kind === 'no-memory') throw Error('partial control close rejected'); return originalClose.call(this); });
  let recovery: InstanceType<typeof DevelopmentDriverPreparationFailure> | undefined;
  await assert.rejects(f.open(), error => { assert.ok(error instanceof DevelopmentDriverPreparationFailure); recovery = error; return error.cause === originalError; }); failure.mock.restore(); closing.mock.restore();
  assert.equal(recovery!.closeErrors.length, 2); const candidate = recovery!.application('candidate'); assert.ok(candidate.application.store.list('allocations').length); assert.equal(candidate.accounting.originalResources.store, candidate.application.store); assert.equal(candidate.accounting.originalResources.snapshot(f.registration.rootId).requests, 0); assert.throws(() => recovery!.application('always-agree'), /Unregistered constructed/);
  assert.equal(f.state.get<any>('development.driver', f.plan.id)!.value.phase, 'failed'); await assert.rejects(f.open(), /already consumed/); await recovery!.application('no-memory').application.close(); await candidate.application.close();
});

test('ordinary application executes model-requested speech through its actual accounted effect receiver and retained checkpoint', async t => {
  const f = fixture(t); let index = 0, driver: Awaited<ReturnType<typeof DevelopmentAcquisitionDriver.prepare>>;
  f.setProvider(async () => {
    if (index++ > 0) return stop();
    const conversation = driver.application('candidate').application.store.list<any>('communications.inputs')[0]!.value.conversation;
    return { status: 200, body: JSON.stringify({ model: 'synthetic-model', choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'public-speech-tool', type: 'function', function: { name: 'speech_send', arguments: JSON.stringify({ channel: conversation, text: 'Public verified fixture result' }) } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) };
  });
  driver = await f.open(); f.setTime(0); const id = driver.ingestRegisteredAssignment('candidate', 'opportunity:0'), source = driver.application('candidate');
  await until(() => source.application.runtime.getRun(id)?.status === 'completed', 'ordinary tool path did not complete', () => ({ workerFailures, states: source.accounting.states(), run: source.application.runtime.getRun(id) }));
  assert.equal(source.application.output(id).length, 1); assert.match(JSON.stringify(source.application.output(id)), /Public verified fixture result/); assert.equal(source.accounting.states().length, 3); assert.equal(source.accounting.states().filter(state => state.request.provider === 'effect-receiver').length, 1); assert.ok(source.accounting.states().every(state => state.request.status === 'succeeded'));
  const checkpoint = source.application.store.get<any>('execution', id)!.value.checkpoint.artifact, bytes = source.application.store.readArtifact(checkpoint); assert.match(Buffer.from(bytes).toString(), /Public verified fixture result/); assert.equal(f.payloads.length, 2);
  t.diagnostic(canonicalJson({ toolPath: 'ordinary-speech', firstPayloadBytes: Buffer.byteLength(f.payloads[0]!.payload), followupPayloadBytes: Buffer.byteLength(f.payloads[1]!.payload), checkpointBytes: bytes.byteLength, responseBytes: source.accounting.states().filter(state => state.request.provider === 'mistral').map(state => driver.recorder.status().reservations[state.request.id]!.responseBytes) }));
});

test('freezing an open actual transport retains dispatched state in B and original unknown charge after shutdown', async t => {
  const f = fixture(t); f.setProvider(async (_role, _payload, signal) => { await new Promise<void>((_resolve, reject) => { if (signal.aborted) reject(signal.reason); else signal.addEventListener('abort', () => reject(signal.reason), { once: true }); }); return stop(); });
  const driver = await f.open(); f.setTime(0); driver.ingestRegisteredAssignment('candidate', 'opportunity:0'); await until(() => f.payloads.length > 0, 'open actual transport never entered'); f.setTime(180);
  const b = driver.freezeBehavior(), originalB = canonicalJson(b); assert.equal(b.value.requests.length, 1); assert.equal(b.value.requests[0]!.request.status, 'dispatched'); assert.ok(driver.recorder.status().findings.some(finding => finding.status === 'unavailable'));
  const result = await driver.closeApplications(); assert.deepEqual(result.errors, []); assert.equal(canonicalJson(driver.recorder.status().behavior), originalB);
  const store = new OperationalStore({ filename: f.plan.originalStateFile, documentJournal: f.plan.roles[0]!.journal }); const latest = store.list<any>('development.accounting.latest')[0]!.value; assert.equal(latest.request.status, 'uncertain'); assert.ok(latest.charged.tokens > 0); assert.equal(store.get<any>('budgets', f.registration.rootId)!.value.cancelled, false); store.close();
});

test('recorder owner cannot substitute an actual behavioral Store or mutate original setup before refusal', async t => {
  const f = fixture(t), source = new OperationalStore({ filename: f.plan.originalStateFile, documentJournal: f.plan.roles[0]!.journal }), before = canonicalJson(source.list('allocations'));
  await assert.rejects(DevelopmentAcquisitionDriver.prepare({ ...f.options, state: source }), /separate recorder owner/); assert.equal(canonicalJson(source.list('allocations')), before); assert.equal(source.get('development.driver', f.plan.id), undefined); assert.equal(f.payloads.length, 0); source.close();
});
