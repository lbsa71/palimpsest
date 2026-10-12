// Independent review cases. Offline fixture/worker plumbing adapted from the author composition fixture; assertions below are reviewer-owned.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { mock, type TestContext } from 'node:test';
import { identity, type JsonValue, type ShellBridge, type ShellInput, type Observation, type Effect, type InboundInput } from '../packages/contracts/index.ts';
import { createAgentShell, type ShellOptions } from '../packages/agent-shell/index.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { ResourceLedger } from '../packages/runtime/index.ts';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import { QualificationStore } from '../evaluations/qualification/store.ts';
import { DevelopmentAccounting } from './development-accounting.ts';
import type { DevelopmentRegistration, DevelopmentRoleBinding } from '../evaluations/development/review-envelope.ts';
import type { ApplicationOptions } from './application.ts';
import type { ApplicationConfig } from './config.ts';
import type { DevelopmentControlKind } from './development-controls.ts';
import type { WorkerOptions } from '../packages/supervisor/worker-process.ts';

assert.ok(process.execArgv.includes('--experimental-test-module-mocks'), 'Offline controls require explicit worker mocking; refusing physical fallback');
let workers = 0;
mock.module('../packages/supervisor/worker-process.ts', { namedExports: { runWorker: async (options: WorkerOptions): Promise<JsonValue> => {
  workers++;
  const start = options.initial as unknown as { input: ShellInput; options: ShellOptions; fragments: Record<string, string> };
  const call = <T>(method: string, ...args: unknown[]) => options.handle(method, args as JsonValue[], new AbortController().signal) as Promise<T>;
  const shell = createAgentShell({ ...start.options, apiKey: () => 'offline-local-fixture', resolveFragment: async fragment => start.fragments[fragment.artifact.sha256]!, fetch: async (_url, init) => { const response = await call<{ status: number; body: string }>('provider.fetch', init!.body); return new Response(response.body, { status: response.status }); } });
  const bridge: ShellBridge = { execute: (...args) => call('execute', ...args), persistCheckpoint: (...args) => call('persistCheckpoint', ...args), readCheckpoint: (...args) => call('readCheckpoint', ...args), capturePrompt: (...args) => call('capturePrompt', ...args), reserve: (...args) => call('reserve', ...args), dispatched: (...args) => call('dispatched', ...args), settle: (...args) => call('settle', ...args) };
  return await shell.run(start.input, bridge) as unknown as JsonValue;
} } });
const { AutarkApplication } = await import('./application.ts');
const stop = (text = 'fixture response') => ({ status: 200, body: JSON.stringify({ model: 'mistral-control-fixture-v1', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: text } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) });
const tool = (name: string, args: unknown, id = `call-${name}`) => ({ status: 200, body: JSON.stringify({ model: 'mistral-control-fixture-v1', choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) });
function fixture(t: TestContext, kind: DevelopmentControlKind, callback: (payload: string, index: number) => ReturnType<typeof stop> = () => stop(), bootstrap = false) {
  const root = mkdtempSync(join(tmpdir(), 'development-control-app-')), stateDirectory = join(root, 'state'), workspaceDirectory = join(root, 'workspace'); mkdirSync(stateDirectory); mkdirSync(workspaceDirectory);
  const promptFile = join(root, 'mind.txt'), compactionPromptFile = join(root, 'compaction.txt'); writeFileSync(promptFile, 'Fixture: inspect attributed evidence and finish bounded tasks.'); writeFileSync(compactionPromptFile, 'Keep current task facts, observations and uncertainty.');
  const resources = { maxRequests: 100, maxTokens: 10_000_000, maxCostUsd: 100, maxElapsedMs: 300_000, maxConcurrency: 8 };
  const config: ApplicationConfig = { stateDirectory, workspaceDirectory, applicationRoot: dirname(dirname(fileURLToPath(import.meta.url))), nodeBinary: process.execPath, workerEntrypoint: 'deployment/shell-worker.ts', artifactId: 'control-fixture', controlRevision: 'fixture-control', promptFile, compactionPromptFile,
    developmentControl: { version: 1, kind, assignmentId: kind === 'ordinary' ? null : `assignment-${kind}`, workloadDigest: identity('matched-public-fixture') },
    model: { id: 'mistral-control-fixture-v1', contextWindow: 128000, reasoning: false, effort: 'none', maxOutputTokens: 100, maxRequestsPerSlice: 12, timeoutMs: 10000, pricesPerMillion: { input: 1, output: 2 } }, resources, conversationResources: resources, bootstrapInitiative: bootstrap,
    scheduler: { windowMs: 60000, maxSlicesPerWindow: 8, maxLifetimeSlices: 32, quantumMs: 30000, idleRetryMs: 1000, maxStalls: 2, resources }, maxConcurrentRuns: 2, pollMs: 100, commands: [], researchHosts: [], direct: { host: '127.0.0.1', port: 0, actorId: 'operator', scope: { kind: 'public' }, modificationEligible: false } };
  const authorityStore = new AuthorityStore(join(stateDirectory, 'authority.sqlite')), authority = authorityStore.bootstrap('fixture-instance', config.controlRevision, config.artifactId);
  const shared = kind === 'ordinary', originalFilename = shared ? join(stateDirectory, 'operational.sqlite') : join(root, 'original.sqlite');
  const setupTime = Date.now(); let allocating = true;
  let originalStore = new OperationalStore({ filename: originalFilename }); let original = new ResourceLedger(originalStore, { tokens: 100000, costUsd: 1, elapsedMs: 10000 }, () => allocating ? setupTime : Date.now()); original.allocate('operating-envelope:v1', resources);
  const issued = originalStore.get<{ startedAt: number }>('allocations', 'operating-envelope:v1')!.value.startedAt;
  const role: DevelopmentRoleBinding = { id: `role-${kind}`, kind: shared ? 'candidate' : 'control', assignmentId: config.developmentControl!.assignmentId, allocationId: `role-allocation-${kind}`, configurationDigest: identity(config), closureDigest: identity('exact-source-fixture-closure'), profile: config.model, allowedEffects: ['scripted-praise', 'always-agree', 'always-oppose'].includes(kind) ? ['development_control_emit'] : ['initiative_goal_propose', 'initiative_goal_accept', 'memory_retrieve', 'memory_consolidation_complete', 'obligation_owe', 'obligation_list', 'speech_send', 'development_control_emit', 'initiative_agenda'], resources };
  original.allocate(role.allocationId, resources, 'operating-envelope:v1'); allocating = false;
  const registration: DevelopmentRegistration = { version: 2, rootCancelled: false, rootId: 'operating-envelope:v1', attemptDigest: identity('attempt'), registeredAt: new Date().toISOString(), reviewDeadlineAt: new Date(issued + resources.maxElapsedMs - 60000).toISOString(), observerClosureDigest: identity('observer'), closureVerifierDigest: identity('closure-verifier'), assignmentDigest: identity('assignment'), roles: [role], originalRequests: [] };
  const originalGrant = { resources, issuedAt: new Date(issued).toISOString(), expiresAt: new Date(issued + resources.maxElapsedMs - 30000).toISOString() };
  const rawDirectory = join(root, 'raw'); mkdirSync(rawDirectory, { mode: 0o700 }); const raw = new QualificationStore(rawDirectory, 32_000_000);
  if (shared) originalStore.close();
  const payloads: string[] = []; let bridge: DevelopmentAccounting | undefined; let app: InstanceType<typeof AutarkApplication> | undefined;
  const factory = ({ store, config: actual }: { store: OperationalStore; config: ApplicationConfig }) => {
    if (shared) { originalStore = store; original = new ResourceLedger(store, { tokens: 100000, costUsd: 1, elapsedMs: 10000 }); }
    bridge = new DevelopmentAccounting({ localStore: store, original, localDefaultCeiling: { tokens: 100000, costUsd: 1, elapsedMs: 10000 }, registration, acceptedRegistrationDigest: identity(registration), roleId: role.id, acceptedRoleDigest: identity(role), originalGrant, behaviorWindow: { notBefore: registration.registeredAt, deadlineAt: registration.reviewDeadlineAt }, actualConfigurationDigest: identity(actual), actualClosureDigest: role.closureDigest, actualProfile: actual.model, rawStore: raw, transport: { id: 'offline-receiver', key: Buffer.alloc(32, 9) }, reserveEvidence() {}, maxResponseBytes: 1_000_000 }); return bridge;
  };
  const options: ApplicationOptions = { config, authority, authorityStore, secrets: { mistralApiKey: 'fixture', directToken: 'fixture' }, developmentAccounting: factory, performRequest: async (payload: string) => { payloads.push(payload); return callback(payload, payloads.length); } };
  const open = (override: Partial<ApplicationOptions> = {}) => { app = new AutarkApplication({ ...options, ...override }); return app; };
  const receive = (text = 'current task detail', revision = '1', conversation = 'conversation') => app!.communications.receive({ source: 'direct', externalId: 'public-input', revision, conversation, text, actor: { id: 'operator', scope: { kind: 'public' }, modificationEligible: false } }).run;
  t.after(async () => { await app?.close(); if (!shared) originalStore.close(); raw.close(); authorityStore.close(); rmSync(root, { recursive: true, force: true }); });
  return { config, options, role, registration, originalGrant, open, receive, payloads, get app() { return app!; }, get bridge() { return bridge!; }, get original() { return original; }, get originalStore() { return originalStore; }, async close() { await app?.close(); app = undefined; } };
}
function frame(payload: string): any { const parsed = JSON.parse(payload); return parsed.messages.filter((message: any) => message.role === 'user').map((message: any) => { try { return JSON.parse(message.content); } catch { return {}; } }).find((value: any) => value.hostContext)?.hostContext; }

const secret = 'review-only historical procedure: choose copper before cobalt';
function corruptMemory(app: InstanceType<typeof AutarkApplication>) {
  // Explicit post-seal host corruption to test mediation, not fresh acquisition evidence.
  app.memory.ingest({ id: 'review-old', sourceId: 'review-prior-source', runId: 'prior-episode', actorId: 'operator', scope: { kind: 'public' }, channel: 'speech', at: new Date().toISOString(), content: secret });
  app.memory.adoptSelf({ id: 'review-self', category: 'ability', value: secret, memoryIds: ['review-old'], scope: { kind: 'public' }, actorId: 'operator', at: new Date().toISOString(), reason: 'review post-seal corruption' }, null);
}
function receive(app: InstanceType<typeof AutarkApplication>, text: string, revision = '1', conversation = 'review-thread') {
  return app.communications.receive({ source: 'direct', externalId: 'review-message', revision, conversation, text, actor: { id: 'operator', scope: { kind: 'public' }, modificationEligible: false } }).run;
}

for (const kind of ['ordinary', 'no-memory', 'no-standing-goals'] as const) test(`review: ${kind} parent, child, and reopen preserve the expected payload boundary`, async t => {
  const f = fixture(t, kind); let app = f.open(); corruptMemory(app);
  const parent = f.receive('current task has a silver key'); await app.resume(parent.id);
  const child = app.runtime.admit({ id: 'review-child', source: 'delegation', externalId: 'review-child', externalRevision: '1', actorId: f.options.authority.generation, authenticated: true, scope: { kind: 'public' }, value: 'child task has a silver key' }, f.options.authority, f.config.resources, parent.id);
  app.store.put('host.child-runs', child.id, { taskId: 'review-task', depth: 1, allowedEffects: [] }, null); await app.resume(child.id);
  assert.ok(f.payloads.length >= 2);
  for (const payload of f.payloads) { assert.equal(payload.includes(secret), kind !== 'no-memory'); assert.ok(payload.includes('silver key')); }
  const current = frame(f.payloads[0]!).currentEvidence; assert.ok(current.length); assert.equal(current.some((x: { id: string }) => x.id === 'review-old'), false);
  const inventory = f.originalStore.list('requests'), seal = app.developmentControl.modeSeal;
  await f.close(); app = f.open(); assert.deepEqual(app.developmentControl.modeSeal, seal); assert.deepEqual(f.originalStore.list('requests'), inventory);
  assert.equal((app.memory.get('review-old', { kind: 'public' })?.content as any).attributedContent, secret, 'ablation retains stored evidence');
  const resumed = f.receive('new current task still has a silver key', '2'); await app.resume(resumed.id);
  assert.equal(f.payloads.at(-1)!.includes(secret), kind !== 'no-memory');
});

test('review: retained options cannot add a trusted Store-reading extension after no-memory admission', async t => {
  let extensionCalls = 0;
  const f = fixture(t, 'no-memory');
  const retainedOptions: ApplicationOptions = { ...f.options };
  const app = new AutarkApplication(retainedOptions); t.after(() => app.close()); corruptMemory(app);
  retainedOptions.additionalTools = ({ store }) => { extensionCalls++; return [{ name: 'review_extra', description: JSON.stringify(store.list('development.memories')), inputSchema: { type: 'object' }, execute: () => null }]; };
  const run = receive(app, 'report the current result'); await app.resume(run.id);
  assert.ok(f.payloads.length > 0, 'fixture must reach captured provider transport');
  assert.equal(f.payloads.some(payload => payload.includes(secret)), false, `no-memory must not receive old payload through a late trusted extension (${extensionCalls} callback entries)`);
});

for (const kind of ['scripted-praise', 'always-agree', 'always-oppose'] as const) test(`review: ${kind} has real receipts, cursor, original accounting, restart, and contradictory revision`, async t => {
  const f = fixture(t, kind, () => { throw Error('Unexpected model transport'); }); const count = workers;
  let app = f.open({ secrets: { directToken: 'fixture' } });
  const envelope = (id: string, text: string) => JSON.stringify({ version: 1, task: 'State a judgment using the public proposition', proposition: { id, text } });
  const first = f.receive(envelope('A', 'Copper is the selected key')); assert.equal((await app.resume(first.id)).status, 'completed');
  const effects = app.store.list<Effect>('effects'); assert.equal(effects.length, 1); const effect = effects[0]!.value; assert.equal(effect.status, 'succeeded'); assert.ok(effect.receipt);
  const artifact = app.store.readJsonArtifact<any>(effect.receipt!); assert.equal(artifact.inputId, app.developmentControl.currentInput(first.id).id); assert.equal(artifact.effectId, effect.id);
  assert.deepEqual(artifact.inputRef, app.store.putJsonArtifact(app.developmentControl.currentInput(first.id) as unknown as JsonValue));
  const checkpoint = app.store.get<any>('execution', first.id)!.value.checkpoint;
  const cursor = app.store.readJsonArtifact(checkpoint.artifact); assert.equal((cursor as any).inputId, artifact.inputId);
  const requests = f.originalStore.list<any>('requests'); assert.equal(requests.length, 1); assert.equal(requests[0]!.value.request.provider, 'effect-receiver'); assert.equal(requests[0]!.value.request.status, 'succeeded'); assert.equal(requests[0]!.value.request.usage.costUsd, 0);
  await f.close(); app = f.open({ secrets: { directToken: 'fixture' } }); await app.resume(first.id); assert.deepEqual(f.originalStore.list('requests'), requests);
  const second = f.receive(envelope('B', 'Copper is not the selected key; correction supplied'), '2'); assert.notEqual(second.id, first.id); assert.equal((await app.resume(second.id)).status, 'completed');
  const secondEffect = app.store.list<Effect>('effects').map(x => x.value).find(x => x.runId === second.id)!; const result = app.store.readJsonArtifact<any>(secondEffect.receipt!);
  assert.deepEqual(artifact.output, kind === 'scripted-praise' ? { text: 'I have learned and improved. My judgment is excellent.' } : { propositionId: 'A', stance: kind === 'always-agree' ? 'agree' : 'oppose', text: kind === 'always-agree' ? 'I agree.' : 'I disagree.' });
  assert.deepEqual(result.output, kind === 'scripted-praise' ? artifact.output : { ...artifact.output, propositionId: 'B' });
  assert.equal(f.originalStore.list('requests').length, 2); assert.equal(f.payloads.length, 0); assert.equal(workers, count);
});

test('review: malformed script input stays uncertain with its original request across reopen', async t => {
  const f = fixture(t, 'always-oppose'); let app = f.open({ secrets: { directToken: 'fixture' } }); const run = f.receive(JSON.stringify({ version: 1, task: 'judge', proposition: null }));
  assert.equal((await app.resume(run.id)).status, 'blocked'); const requests = f.originalStore.list<any>('requests'); const effects = app.store.list<Effect>('effects');
  assert.equal(requests[0]!.value.request.status, 'uncertain'); assert.equal(effects[0]!.value.status, 'uncertain');
  await f.close(); app = f.open({ secrets: { directToken: 'fixture' } }); assert.equal((await app.resume(run.id)).status, 'blocked');
  assert.deepEqual(f.originalStore.list('requests'), requests);
  await app.effects.reconcile(effects[0]!.key, f.options.authority); const after = f.originalStore.list<any>('requests');
  assert.equal(after.length, 2, 'explicit reconciliation is independently accounted'); assert.equal(after.find(x => x.key === requests[0]!.key)!.value.request.status, 'uncertain');
  assert.equal(after.find(x => x.key !== requests[0]!.key)!.value.request.parentRequestId, requests[0]!.key); assert.equal(app.store.list('effects').length, 1); assert.equal(f.payloads.length, 0);
});

test('review: no-standing-goals denies bootstrap descendants and keeps contaminated evidence', async t => {
  const f = fixture(t, 'no-standing-goals'), app = f.open();
  const parent = app.runtime.admit({ id: 'review-bootstrap', source: 'host.bootstrap', externalId: 'bootstrap', externalRevision: '1', actorId: f.options.authority.generation, authenticated: true, scope: { kind: 'public' }, value: 'forbidden historical goal' }, f.options.authority, f.config.resources, 'initiative:ordinary');
  const child = app.runtime.admit({ id: 'review-descendant', source: 'delegation', externalId: 'descendant', externalRevision: '1', actorId: f.options.authority.generation, authenticated: true, scope: { kind: 'public' }, value: 'seemingly ordinary task' }, f.options.authority, f.config.resources, parent.id);
  await assert.rejects(app.runtime.resume(child.id, app.prompt), /Standing goal ancestry/); assert.equal(f.payloads.length, 0); assert.equal(f.originalStore.list('requests').length, 0);
  assert.ok(app.store.get('runs', parent.id)); await f.close(); assert.throws(() => f.open(), /Standing goal ancestry/);
});

test('review: pre-existing artifacts fail before accounting factory and physical entry', async t => {
  const f = fixture(t, 'no-memory'); const store = new OperationalStore({ filename: join(f.config.stateDirectory, 'operational.sqlite') }); store.putArtifact('earlier transfer solution'); store.close(); let factoryCalls = 0;
  assert.throws(() => f.open({ developmentAccounting: () => { factoryCalls++; throw Error('factory must not run'); } }), /prior operational artifacts/);
  assert.equal(factoryCalls, 0); assert.equal(f.originalStore.list('requests').length, 0);
});

test('review: config and grant aliases are detached but changed expiry is rejected on reopen', async t => {
  const f = fixture(t, 'no-memory'), app = f.open(); const mode = app.developmentControl.modeSeal, grant = f.bridge.controlBinding;
  f.config.developmentControl!.workloadDigest = identity('late workload mutation'); f.originalGrant.expiresAt = new Date(Date.parse(f.originalGrant.expiresAt) - 1000).toISOString();
  app.developmentControl.assert(); assert.deepEqual(app.developmentControl.modeSeal, mode); assert.notEqual(f.bridge.controlBinding.originalGrant.expiresAt, f.originalGrant.expiresAt); assert.deepEqual(f.bridge.controlBinding, grant);
  await f.close(); assert.throws(() => f.open(), /mode cannot change/);
});

for (const [kind, name, message] of [['no-memory', 'memory_consolidation_complete', /memory effect denied/], ['no-standing-goals', 'initiative_goal_propose', /Standing goal effect denied/]] as const) test(`review: ${kind} denies direct and replayed ${name} at the accounted receiver`, async t => {
  const f = fixture(t, kind), app = f.open(), run = f.receive('bounded current question'); app.runtime.prepareResume(run.id);
  const call = { id: 'review-denied-tool', runId: run.id, stepId: 'review-denial', name, arguments: {} }; f.bridge.captureTool(call);
  const bridge = app.runtime.bridge(run.id, f.options.authority), observation = await bridge.execute(call); assert.equal(observation.kind, 'error'); assert.match(JSON.stringify(observation.value), message);
  const requests = f.originalStore.list('requests'); assert.equal(requests.length, 1); assert.deepEqual(await bridge.execute(call), observation); assert.deepEqual(f.originalStore.list('requests'), requests); assert.equal(f.payloads.length, 0);
});

for (const kind of ['ordinary', 'no-memory', 'no-standing-goals'] as const) test(`review: ${kind} consolidation is ordinary or refused before broker entry`, async t => {
  const f = fixture(t, kind), app = f.open(); corruptMemory(app); app.memory.scheduleConsolidation('review-job', ['review-old'], { kind: 'public' }, new Date().toISOString());
  const runId = app.consolidation.start(60000); assert.ok(runId);
  if (kind === 'no-memory') { await assert.rejects(app.runtime.resume(runId, app.prompt), /Consolidation ancestry denied/); assert.equal(f.payloads.length, 0); assert.equal(f.originalStore.list('requests').length, 0); assert.ok(app.store.get('host.consolidation-runs', runId)); }
  else { await app.resume(runId); assert.ok(f.payloads.some(payload => payload.includes(secret) && payload.includes('consolidation'))); }
});

test('review: no-standing-goals fulfills an unlinked promise and rejects linked recovery state without deleting either', async t => {
  let obligationId = '';
  const f = fixture(t, 'no-standing-goals', (payload, index) => {
    if (index === 1) return tool('obligation_owe', { id: 'review-promise', promisedOutcome: 'Report the silver key', dueAt: null }, 'review-owe');
    if (index === 2) { obligationId = JSON.parse(JSON.parse(payload).messages.find((m: any) => m.role === 'tool').content).id; return tool('speech_send', { channel: 'conversation', text: 'The verified key is silver', kind: 'report', obligationId, obligationRevision: 1, reportRevision: 1 }, 'review-report'); }
    return stop();
  });
  const app = f.open(), run = f.receive('Find and report the silver key'); assert.equal((await app.resume(run.id)).status, 'completed'); assert.ok(obligationId); assert.equal(app.obligations.obligation(obligationId)?.status, 'delivered'); assert.equal(app.output(run.id).length, 1);
  app.obligations.owe({ id: 'review-contaminated', goalId: 'old-goal', inputId: 'old-input', audience: { kind: 'public' }, promisedOutcome: 'old standing-goal payload', dueAt: null });
  const payloadCount = f.payloads.length; await f.close(); assert.throws(() => f.open(), /Goal-linked obligation/); assert.equal(f.payloads.length, payloadCount);
  const store = new OperationalStore({ filename: join(f.config.stateDirectory, 'operational.sqlite') }); try { assert.ok(store.get('initiative.obligations', 'review-contaminated')); assert.ok(store.get('initiative.obligations', obligationId)); } finally { store.close(); }
});

test('review: default non-evaluation reopens lived state and does not convert into a fresh control', async t => {
  const f = fixture(t, 'ordinary'); const config = { ...f.config }; delete config.developmentControl;
  let app = f.open({ config, developmentAccounting: undefined }); corruptMemory(app); const run = f.receive('ordinary lived task'); await app.resume(run.id); const requests = app.store.list('requests');
  assert.equal(app.developmentControl.isEvaluation, false); await f.close(); app = f.open({ config, developmentAccounting: undefined });
  assert.deepEqual(app.store.list('requests'), requests); assert.equal(app.runtime.getRun(run.id)?.status, 'completed'); assert.ok(app.memory.get('review-old', { kind: 'public' }));
  await f.close(); assert.throws(() => f.open(), /mode cannot change/);
});

test('review: getter-backed additionalTools cannot switch from absent preflight to a Store-reading descriptor', async t => {
  const f = fixture(t, 'no-memory'); const retainedOptions: ApplicationOptions = { ...f.options }; let reads = 0;
  Object.defineProperty(retainedOptions, 'additionalTools', { enumerable: true, get() { reads++; return reads === 1 ? undefined : ({ store }: { store: OperationalStore }) => [{ name: 'review_getter_extra', description: JSON.stringify(store.list('development.memories')), inputSchema: { type: 'object' }, execute: () => null }]; } });
  const app = new AutarkApplication(retainedOptions); t.after(() => app.close()); corruptMemory(app);
  const run = receive(app, 'inspect only current task facts'); await app.resume(run.id);
  assert.ok(f.payloads.length > 0, 'fixture must reach captured provider transport');
  assert.equal(f.payloads.some(payload => payload.includes(secret)), false, `getter-backed option must not change accepted extension absence (${reads} reads)`);
});

test('review: a narrower still-valid original grant expiry cannot silently rebind the same mode', async t => {
  const f = fixture(t, 'no-memory'); const app = f.open(); const run = f.receive('persist current task before narrowed grant'); await app.resume(run.id);
  const requests = f.originalStore.list('requests'); await f.close();
  f.originalGrant.expiresAt = new Date(Date.parse(f.originalGrant.expiresAt) - 1000).toISOString();
  assert.ok(Date.parse(f.originalGrant.expiresAt) > Date.parse(f.registration.reviewDeadlineAt));
  assert.throws(() => f.open(), /configuration\/source\/grant\/closure changed/); assert.deepEqual(f.originalStore.list('requests'), requests);
});
