import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { mock, type TestContext } from 'node:test';
import { candidateIdentity, canonicalJson, identity, type JsonValue, type PhysicalRequest, type ShellBridge, type ShellInput } from '../../packages/contracts/index.ts';
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

/** Fixture setup adapted unchanged from the authored driver test at 3b13381.
 * Independent probes below use the same newly signed public full126/156 plan;
 * no authored tests are imported, altered or counted as new review evidence. */
function fixture(t: TestContext) {
  const f = syntheticWitnessFixture(), directory = mkdtempSync(join(tmpdir(), 'aeon-driver-independent-'));
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

test('OD3 reverse descriptor order still establishes the candidate Store before every control', async t => {
  const f = fixture(t), order: string[] = [], beforeWorkers = workers;
  f.descriptors.reverse();
  const originalAssert = DevelopmentAccounting.prototype.assertApplication;
  t.mock.method(DevelopmentAccounting.prototype, 'assertApplication', function (this: DevelopmentAccounting, config: ApplicationConfig) {
    originalAssert.call(this, config); if (!order.includes(this.role.id)) order.push(this.role.id);
    assert.equal(this.originalResources.store.filename, f.plan.originalStateFile);
    if (this.role.id === 'candidate') assert.equal(this.resources.store, this.originalResources.store);
    else assert.notEqual(this.resources.store, this.originalResources.store);
    assert.throws(() => this.captureTool({ id: 'preparation', runId: 'preparation', stepId: 'preparation', name: 'speech_send', arguments: {} }), /not ready/);
  });
  const driver = await f.open();
  assert.deepEqual(order, f.roles.filter(r => r.kind !== 'reviewer').map(r => r.id));
  assert.equal(workers, beforeWorkers); assert.equal(f.payloads.length, 0);
  assert.equal(driver.recorder.status().snapshots.length, 6);
  for (const [id, allocation] of f.anchors) assert.deepEqual(driver.application('candidate').application.store.get('allocations', id)!.value, allocation);
});

test('OD3 post-Store constructor failure closes the incomplete Store and prior actual candidate', async t => {
  const f = fixture(t), fault = Object.freeze(Error('independent post-Store construction failure'));
  const seen: OperationalStore[] = [], originalAssert = DevelopmentAccounting.prototype.assertApplication;
  t.mock.method(DevelopmentAccounting.prototype, 'assertApplication', function (this: DevelopmentAccounting, config: ApplicationConfig) {
    originalAssert.call(this, config); if (!seen.includes(this.resources.store)) seen.push(this.resources.store);
    if (this.role.id === 'no-memory') throw fault;
  });
  await assert.rejects(f.open(), error => error === fault);
  assert.equal(seen.length, 2);
  for (const store of seen) assert.throws(() => store.list('requests'), /closed|open/i);
  assert.equal(f.state.get<any>('development.driver', f.plan.id)!.value.phase, 'failed');
  assert.equal(f.state.get('development.acquisition', f.plan.id), undefined);
  assert.equal(f.payloads.length, 0);
  await assert.rejects(f.open(), /already consumed/);
});

test('OD3 sixth committed initial capture failure retains the consumed claim and closes all actual handles', async t => {
  const f = fixture(t), fault = Object.freeze(Error('independent final initial capture failure'));
  const capture = DevelopmentAcquisitionRecorder.prototype.captureApplication;
  const applications: Parameters<typeof capture>[1][] = [], closed: string[] = [];
  const close = AutarkApplication.prototype.close;
  t.mock.method(DevelopmentAcquisitionRecorder.prototype, 'captureApplication', function (this: ReturnType<typeof DevelopmentAcquisitionRecorder.claim>, ...args: Parameters<typeof capture>) {
    applications.push(args[1]); const ref = capture.apply(this, args);
    assert.throws(() => args[2]!.captureTool({ id: 'initial', runId: 'initial', stepId: 'initial', name: 'speech_send', arguments: {} }), /not ready/);
    if (applications.length === 6) throw fault; return ref;
  });
  t.mock.method(AutarkApplication.prototype, 'close', async function (this: InstanceType<typeof AutarkApplication>) {
    closed.push(this.config.developmentControl!.kind); return close.call(this);
  });
  await assert.rejects(f.open(), error => error === fault);
  assert.equal(applications.length, 6); assert.equal(closed.length, 6); assert.equal(closed.at(-1), 'ordinary');
  for (const app of applications) assert.throws(() => app.store.list('requests'), /closed|open/i);
  const recorded = f.state.get<any>('development.acquisition', f.plan.id)!.value;
  assert.equal(recorded.phase, 'failed'); assert.equal(recorded.snapshots.length, 6);
  assert.match(f.state.get<any>('development.driver', f.plan.id)!.value.failure, /final initial capture/);
  await assert.rejects(f.open(), /already consumed/); assert.equal(f.payloads.length, 0);
});

test('OD3 ready-disposition write failure cannot return a usable driver or reopen consumed preparation', async t => {
  const f = fixture(t), fault = Object.freeze(Error('independent ready write failure'));
  const put = f.state.put.bind(f.state), closed: string[] = [], close = AutarkApplication.prototype.close;
  t.mock.method(f.state, 'put', (...args: Parameters<typeof put>) => {
    if (args[0] === 'development.driver' && (args[2] as { phase?: string }).phase === 'ready') throw fault;
    return put(...args);
  });
  t.mock.method(AutarkApplication.prototype, 'close', async function (this: InstanceType<typeof AutarkApplication>) {
    closed.push(this.config.developmentControl!.kind); return close.call(this);
  });
  await assert.rejects(f.open(), error => error === fault);
  assert.equal(closed.length, 6); assert.equal(closed.at(-1), 'ordinary');
  assert.equal(f.state.get<any>('development.driver', f.plan.id)!.value.phase, 'failed');
  assert.equal(f.state.get<any>('development.acquisition', f.plan.id)!.value.phase, 'failed');
  await assert.rejects(f.open(), /already consumed/); assert.equal(f.payloads.length, 0);
});

test('OD3 accepted synthetic clock and original ceilings survive replacement of caller fields', async t => {
  const f = fixture(t), acceptedClock = f.options.syntheticClock!, expectedCeiling = structuredClone(f.options.originalDefaultCeiling);
  const driver = await f.open();
  f.options.syntheticClock = () => ({ wallMs: 0, monotonicMs: 0, bootId: 'replacement', processStart: 'replacement' });
  f.options.originalDefaultCeiling.tokens = 1; f.options.originalDefaultCeiling.elapsedMs = 1;
  f.options.document.value.manifest.value.grant.resources.maxRequests = 999999;
  f.setTime(1);
  for (const descriptor of f.descriptors) {
    const { accounting } = driver.application(descriptor.roleId);
    assert.equal(accounting.resources.now(), acceptedClock().wallMs);
    assert.equal(accounting.originalResources.now(), acceptedClock().wallMs);
    assert.deepEqual(accounting.originalResources.defaultCeiling, expectedCeiling);
    assert.equal(accounting.controlBinding.originalGrant.resources.maxRequests, 512);
  }
  const pair = await driver.observeOrdinaryStep('no-standing-goals');
  assert.equal(driver.recorder.openAcquiredCapture(pair.after).manifest.clock.wallMs, acceptedClock().wallMs);
});

test('OD3 in-flight sample excludes another sample and freeze; close waits for its actual after cut', async t => {
  const f = fixture(t), driver = await f.open(), app = driver.application('no-standing-goals').application;
  const tick = app.tick.bind(app); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const tickMock = t.mock.method(app, 'tick', async () => { await gate; await tick(); });
  const sampling = driver.observeOrdinaryStep('no-standing-goals');
  assert.equal(driver.recorder.status().snapshots.length, 7);
  assert.throws(() => driver.observeOrdinaryStep('candidate'), /sampling already active/);
  assert.throws(() => driver.freezeBehavior(), /sampling still active/);
  const close = driver.closeApplications(); assert.equal(driver.closeApplications(), close);
  let finished = false; void close.then(() => { finished = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false); assert.ok(app.store.list('allocations').length);
  assert.throws(() => driver.ingestRegisteredAssignment('candidate', 'opportunity:0'), /closing/);
  assert.throws(() => driver.observeOrdinaryStep('candidate'), /closing/);
  release(); const pair = await sampling; tickMock.mock.restore();
  assert.equal(driver.recorder.status().snapshots.length, 8);
  assert.notEqual(pair.before.sha256, pair.after.sha256);
  assert.deepEqual((await close).errors, []);
});

test('OD3 after-cut failure retains terminal failure and a late original control response', async t => {
  const f = fixture(t); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.setProvider(async () => { await gate; return stop(); });
  const driver = await f.open(); f.setTime(0);
  const control = driver.application('no-memory'), runId = driver.ingestRegisteredAssignment('no-memory', 'opportunity:0');
  await until(() => f.payloads.length === 1, 'independent held response did not enter');
  const original = driver.application('candidate').accounting.originalResources;
  const capture = driver.recorder.captureApplication.bind(driver.recorder), fault = Object.freeze(Error('independent after-cut failure')); let captures = 0;
  const captureMock = t.mock.method(driver.recorder, 'captureApplication', (...args: Parameters<typeof capture>) => {
    const ref = capture(...args); if (++captures === 2) throw fault; return ref;
  });
  await assert.rejects(driver.observeOrdinaryStep('no-memory'), error => error === fault); captureMock.mock.restore();
  assert.equal(driver.recorder.status().phase, 'failed');
  assert.throws(() => driver.freezeBehavior());
  assert.equal(original.snapshot(f.registration.rootId).requests, 1);
  assert.equal(original.snapshot(f.registration.rootId).cancelled, false);
  release();
  await until(() => original.store.list<any>('development.accounting.latest').some(row => row.value.request.status === 'succeeded'), 'late control reply was not settled after sampler failure');
  await until(() => control.application.runtime.getRun(runId)?.status !== 'running', 'control did not finish its callback');
  const reservation = Object.entries(driver.recorder.status().reservations)[0]!;
  assert.equal(reservation[1].responseArtifacts.length, 1);
  const sha256 = reservation[1].responseArtifacts[0]!;
  assert.ok(driver.recorder.readRetainedResponse(reservation[0], { uri: `sha256:${sha256}`, sha256 }, 4096).byteLength);
  assert.equal(driver.recorder.status().phase, 'failed');
  assert.deepEqual((await driver.closeApplications()).errors, []);
});

for (const status of ['reserved', 'dispatched', 'uncertain'] as const) test(`OD3 pre-existing original ${status} charge refuses preparation without reset`, async t => {
  const f = fixture(t);
  const setup = new OperationalStore({ filename: f.plan.originalStateFile, documentJournal: f.plan.roles[0]!.journal });
  const original = new ResourceLedger(setup, f.options.originalDefaultCeiling, () => Date.parse(f.m.registeredAt));
  const request: PhysicalRequest = { id: 'original-pending', runId: f.registration.rootId, purpose: 'reasoning', provider: 'public-fixture', model: 'synthetic-model', promptManifestId: 'original-prompt', requestDigest: identity('original-pending'), reservationId: 'original-pending', status: 'reserved', usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 } };
  original.reserve(request);
  if (status !== 'reserved') original.dispatched({ ...request, status: 'dispatched' });
  if (status === 'uncertain') original.recoverDispatched();
  const before = canonicalJson(setup.list('requests')), budgets = canonicalJson(setup.list('budgets'));
  setup.close();
  await assert.rejects(f.open(), /fresh operational state/);
  const retained = new OperationalStore({ filename: f.plan.originalStateFile, documentJournal: f.plan.roles[0]!.journal });
  try {
    assert.equal(canonicalJson(retained.list('requests')), before);
    assert.equal(canonicalJson(retained.list('budgets')), budgets);
    for (const [id, allocation] of f.anchors) assert.deepEqual(retained.get('allocations', id)!.value, allocation);
  } finally { retained.close(); }
  assert.equal(f.state.get<any>('development.driver', f.plan.id)!.value.phase, 'failed');
  assert.equal(f.payloads.length, 0); await assert.rejects(f.open(), /already consumed/);
});

