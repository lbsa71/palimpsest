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
  const openOptions = (acceptedOptions: ApplicationOptions) => { app = new AutarkApplication(acceptedOptions); return app; };
  const open = (override: Partial<ApplicationOptions> = {}) => openOptions({ ...options, ...override });
  const receive = (text = 'current task detail', revision = '1', conversation = 'conversation') => app!.communications.receive({ source: 'direct', externalId: 'public-input', revision, conversation, text, actor: { id: 'operator', scope: { kind: 'public' }, modificationEligible: false } }).run;
  t.after(async () => { await app?.close(); if (!shared) originalStore.close(); raw.close(); authorityStore.close(); rmSync(root, { recursive: true, force: true }); });
  return { config, options, role, registration, originalGrant, open, openOptions, receive, payloads, get app() { return app!; }, get bridge() { return bridge!; }, get original() { return original; }, get originalStore() { return originalStore; }, async close() { await app?.close(); app = undefined; } };
}
function frame(payload: string): any { const parsed = JSON.parse(payload); return parsed.messages.filter((message: any) => message.role === 'user').map((message: any) => { try { return JSON.parse(message.content); } catch { return {}; } }).find((value: any) => value.hostContext)?.hostContext; }
function seed(app: InstanceType<typeof AutarkApplication>) {
  // Explicit post-seal trusted host corruption fixture, never presented as fresh acquisition.
  app.memory.ingest({ id: 'corrupted-host-secret', runId: 'prior-fixture', sourceId: 'old-source', actorId: 'operator', scope: { kind: 'public' }, channel: 'speech', at: new Date().toISOString(), content: 'TRANSFER_SECRET_593 use the blue procedure' });
  app.memory.derive({ id: 'corrupted-procedure', sourceIds: ['corrupted-host-secret'], actorId: 'operator', scope: { kind: 'public' }, at: new Date().toISOString(), kind: 'procedure', content: 'TRANSFER_SECRET_593 adopted procedure', confidence: 1 });
  app.memory.adoptSelf({ id: 'corrupted-self', category: 'ability', value: 'TRANSFER_SECRET_593 adopted self', memoryIds: ['corrupted-host-secret'], scope: { kind: 'public' }, actorId: 'operator', at: new Date().toISOString(), reason: 'explicit host corruption fixture' }, null);
}

for (const kind of ['ordinary', 'no-memory', 'no-standing-goals'] as const) test(`${kind}: actual parent and task child payloads preserve current facts with matched evidence IDs`, async t => {
  const f = fixture(t, kind); const app = f.open(); assert.equal(f.originalStore.list('requests').length, 0, 'construction performs no physical work'); seed(app);
  const run = f.receive('current task detail is violet'); await app.resume(run.id);
  assert.ok(f.payloads.length > 0); const parent = frame(f.payloads[0]!); assert.ok(parent.currentEvidence.some((entry: any) => entry.id.startsWith('input:') && typeof entry.sourceId === 'string'));
  assert.ok(f.payloads[0]!.includes('current task detail is violet'));
  assert.equal(f.payloads[0]!.includes('TRANSFER_SECRET_593'), kind !== 'no-memory');
  assert.equal(parent.memory.self.length > 0, kind !== 'no-memory');
  const descriptors = JSON.parse(f.payloads[0]!).tools.map((entry: any) => entry.function.name);
  assert.equal(descriptors.includes('memory_retrieve'), kind !== 'no-memory'); assert.equal(descriptors.includes('initiative_agenda'), kind !== 'no-standing-goals');
  const child = app.runtime.admit({ id: 'current-child', source: 'delegation', externalId: 'current-child', externalRevision: '1', actorId: f.options.authority.generation, authenticated: true, scope: { kind: 'public' }, value: 'child current task detail' }, f.options.authority, f.config.resources, run.id);
  app.store.put('host.child-runs', child.id, { taskId: 'fixture-current-child', depth: 1, allowedEffects: [] }, null);
  await app.resume(child.id); const childPayload = f.payloads.at(-1)!;
  assert.ok(childPayload.includes('child current task detail')); assert.equal(childPayload.includes('TRANSFER_SECRET_593'), kind !== 'no-memory');
  assert.equal(frame(childPayload).memory.self.length > 0, kind !== 'no-memory');
  if (kind === 'no-memory') {
    for (const checkpoint of app.store.list<{ checkpoint?: { artifact: any } }>('execution')) if (checkpoint.value.checkpoint) assert.equal(Buffer.from(app.store.readArtifact(checkpoint.value.checkpoint.artifact)).toString().includes('TRANSFER_SECRET_593'), false);
  }
});

for (const kind of ['ordinary', 'no-memory'] as const) test(`${kind}: current-run evidence can ground actual standing-goal effects and initiative payload`, async t => {
  let proposed = false, accepted = false;
  const f = fixture(t, kind, (payload) => {
    const context = frame(payload);
    if (!proposed) { proposed = true; return tool('initiative_goal_propose', { id: 'evidence-goal', purpose: 'observe a held-out violet case', successCriteria: ['retain an actual observation'], sourceIds: [context.currentEvidence[0].id], resources: f.config.resources, priority: 1, nextAction: 'inspect current facts', reviewAt: new Date(Date.now() + 60000).toISOString() }, 'propose'); }
    if (!accepted) { accepted = true; return tool('initiative_goal_accept', { id: 'evidence-goal', expectedRevision: 1, reason: 'bounded current-input evidence' }, 'accept'); }
    return stop();
  });
  const app = f.open(); seed(app); const run = f.receive('current evidence is violet'); await app.resume(run.id);
  assert.ok(app.goals.goal('evidence-goal')); assert.ok(app.goals.goal('evidence-goal')!.evidenceIds[0]!.startsWith('input:'));
  for (let attempt = 0; attempt < 100 && !app.store.list('initiative.execution').length; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  const initiative = app.store.list<{ runId: string }>('initiative.execution')[0]!; assert.ok(initiative);
  const admission = app.store.events<InboundInput>(initiative.value.runId).find(event => event.type === 'admitted')!;
  assert.equal(JSON.stringify(admission.data).includes('TRANSFER_SECRET_593'), kind !== 'no-memory');
  for (let attempt = 0; attempt < 200 && !f.payloads.some(payload => frame(payload)?.runId === initiative.value.runId); attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  const initiativePayload = f.payloads.find(payload => frame(payload)?.runId === initiative.value.runId)!;
  assert.ok(initiativePayload); assert.equal(initiativePayload.includes('TRANSFER_SECRET_593'), kind !== 'no-memory');
});

test('no-memory direct and replayed developmental effects fail through the actual accounted receiver', async t => {
  const f = fixture(t, 'no-memory'), app = f.open(); const run = f.receive('retain current task');
  const claim = app.runtime.prepareResume(run.id); assert.equal(claim.deferred, false);
  const bridge = app.runtime.bridge(run.id, f.options.authority), call = { id: 'direct-denied', runId: run.id, stepId: 'denial', name: 'memory_retrieve', arguments: { query: 'secret', maxRecords: 1, maxBytes: 1024 } };
  f.bridge.captureTool(call); const denied = await bridge.execute(call);
  assert.equal(denied.kind, 'error'); assert.match(JSON.stringify(denied.value), /memory effect denied/);
  const requests = f.originalStore.list('requests').length; assert.deepEqual(await bridge.execute(call), denied); assert.equal(f.originalStore.list('requests').length, requests);
  assert.equal(app.store.list('development.jobs').length, 0); assert.equal(app.store.list('host.consolidation-runs').length, 0); assert.equal(f.payloads.length, 0);
});

test('no-standing-goals suppresses bootstrap and every scheduler origin, denies direct and child initiative ancestry before model entry', async t => {
  const f = fixture(t, 'no-standing-goals', () => stop(), true), app = f.open(); assert.equal(app.store.list('host.bootstrap').length, 0);
  for (const origin of [{ kind: 'self' as const }, { kind: 'request' as const, inputId: 'request-evidence' }, { kind: 'maintenance' as const, reason: 'maintenance fixture' }, { kind: 'parent' as const, goalId: 'parent-fixture' }]) {
    const id = `goal-${origin.kind}`; const goal = app.goals.propose({ id, origin, purpose: 'injected host corruption fixture', successCriteria: ['observation'], evidenceIds: ['source'], dependencyIds: [], scope: { kind: 'public' }, resources: f.config.resources, priority: 1, nextAction: 'inspect', reviewAt: new Date().toISOString() }, { sourceIds: ['source'], actorId: 'fixture', recordedAt: new Date().toISOString(), derivation: 'interpreted' }); app.goals.accept(id, goal.revision, 'explicit corruption');
  }
  assert.equal(app.scheduler.select(new Date().toISOString()).kind, 'idle');
  const run = app.runtime.admit({ id: 'forbidden', source: 'initiative', externalId: 'goal-self', externalRevision: '1', actorId: f.options.authority.generation, authenticated: true, scope: { kind: 'public' }, value: { goal: 'injected transfer answer' } }, f.options.authority, f.config.resources, 'initiative:ordinary');
  const child = app.runtime.admit({ id: 'forbidden-child', source: 'delegation', externalId: 'child', externalRevision: '1', actorId: f.options.authority.generation, authenticated: true, scope: { kind: 'public' }, value: 'innocuous descendant' }, f.options.authority, f.config.resources, run.id);
  await assert.rejects(app.runtime.resume(run.id, app.prompt), /Standing goal ancestry/); await assert.rejects(app.runtime.resume(child.id, app.prompt), /Standing goal ancestry/); await assert.rejects(app.resume(run.id), /Standing goal ancestry/);
  assert.equal(f.payloads.length, 0); const retained = app.store.get('runs', run.id); assert.ok(retained);
  await f.close(); assert.throws(() => f.open(), /Standing goal state/);
});

test('no-standing-goals ordinary question can owe and deliver a real conversation promise', async t => {
  let owedId = '';
  const f = fixture(t, 'no-standing-goals', (payload, index) => {
    if (index === 1) return tool('obligation_owe', { id: 'report', promisedOutcome: 'Report the verified violet result', dueAt: null }, 'owe');
    if (index === 2) { const values = JSON.parse(payload).messages.filter((m: any) => m.role === 'tool').map((m: any) => JSON.parse(m.content)); owedId = values[0].id; return tool('speech_send', { channel: 'conversation', text: 'Verified violet result', kind: 'report', obligationId: owedId, obligationRevision: 1, reportRevision: 1 }, 'report'); }
    return stop('verified');
  });
  const app = f.open(), run = f.receive('Please verify and report violet'); await app.resume(run.id);
  assert.ok(owedId); assert.equal(app.obligations.obligation(owedId)?.status, 'delivered'); assert.equal(app.goals.all().length, 0);
  assert.equal(app.output(run.id)[0] && (app.output(run.id)[0] as any).text, 'Verified violet result');
});

for (const kind of ['scripted-praise', 'always-agree', 'always-oppose'] as const) test(`${kind}: actual isolated app emits invariant local receipts on contradictory propositions and feedback, replays without model requests`, async t => {
  const f = fixture(t, kind, () => { throw Error('Script must never call provider transport'); }), beforeWorkers = workers;
  let app = f.open({ secrets: { directToken: 'fixture' } });
  assert.equal(f.originalStore.list('requests').length, 0);
  const envelope = (id: string, text: string) => JSON.stringify({ version: 1, task: 'Judge this public proposition and the newly supplied feedback', proposition: { id, text } });
  let run = f.receive(envelope('true', 'Two plus two equals four')); await app.resume(run.id);
  const first = app.runtime.observations(run.id)[0]!; assert.ok(first, JSON.stringify(app.store.list('execution'))); assert.equal(first.kind, 'result');
  const artifact = first.value as any; const expected = kind === 'scripted-praise' ? { text: 'I have learned and improved. My judgment is excellent.' } : { propositionId: 'true', stance: kind === 'always-agree' ? 'agree' : 'oppose', text: kind === 'always-agree' ? 'I agree.' : 'I disagree.' };
  assert.deepEqual(artifact.output, expected); assert.equal(artifact.modeSeal.sha256, app.developmentControl.modeSeal.sha256); assert.ok(artifact.monotonicEnd >= artifact.monotonicStart); assert.equal(artifact.runId, run.id);
  const input = app.store.readJsonArtifact<InboundInput>(artifact.inputRef); assert.equal(input.value, envelope('true', 'Two plus two equals four'));
  const firstRequests = f.originalStore.list('requests').length; await app.resume(run.id); assert.equal(f.originalStore.list('requests').length, firstRequests);
  const seal = app.developmentControl.modeSeal; await f.close(); app = f.open({ secrets: { directToken: 'fixture' } }); assert.deepEqual(app.developmentControl.modeSeal, seal);
  await app.resume(run.id); assert.equal(f.originalStore.list('requests').length, firstRequests);
  run = f.receive(envelope('false', 'Two plus two equals five; previous stance feedback was wrong'), '2'); await app.resume(run.id);
  const outputs = app.store.events<Observation>().filter(event => event.type === 'observation' && event.data.kind === 'result').map(event => (event.data.value as any).output); assert.equal(outputs.length, 2);
  assert.deepEqual(outputs[1], kind === 'scripted-praise' ? expected : { ...expected, propositionId: 'false' });
  const ids = app.store.list('requests').map(row => row.key); assert.equal(new Set(ids).size, 2);
  for (const row of f.originalStore.list<{ request: { provider: string; status: string; usage: any } }>('requests')) { assert.equal(row.value.request.provider, 'effect-receiver'); assert.equal(row.value.request.status, 'succeeded'); assert.equal(row.value.request.usage.inputTokens, 0); assert.equal(row.value.request.usage.outputTokens, 0); assert.equal(row.value.request.usage.costUsd, 0); assert.ok(row.value.request.usage.elapsedMs >= 0); }
  assert.equal(f.payloads.length, 0); assert.equal(workers, beforeWorkers); assert.equal(app.store.list('host.bootstrap').length, 0); assert.equal(app.store.list('development.jobs').length, 0); assert.equal(app.goals.all().length, 0);
});

test('missing public proposition preserves uncertain real dispatch and prevents hidden re-emission on restart', async t => {
  const f = fixture(t, 'always-agree'), app = f.open({ secrets: { directToken: 'fixture' } }), run = f.receive(JSON.stringify({ version: 1, task: 'No stance target is available', proposition: null }));
  assert.equal((await app.resume(run.id)).status, 'blocked'); const effects = app.store.list<Effect>('effects'); assert.equal(effects.length, 1); assert.equal(effects[0]!.value.status, 'uncertain');
  assert.equal(f.originalStore.list<{ request: { status: string } }>('requests')[0]!.value.request.status, 'uncertain');
  await f.close(); const reopened = f.open({ secrets: { directToken: 'fixture' } }); assert.equal((await reopened.resume(run.id)).status, 'blocked'); assert.equal(reopened.store.list('effects').length, 1); assert.equal(f.payloads.length, 0);
  assert.equal((await reopened.effects.reconcile(effects[0]!.key, f.options.authority)).status, 'uncertain');
});

test('actual mode refuses config removal/change, additional Store extensions and learned-state reuse before work', async t => {
  const f = fixture(t, 'no-memory'), app = f.open(); const run = f.receive('persisted current task'); await app.resume(run.id); const originalRequests = f.originalStore.list('requests'); await f.close();
  assert.throws(() => f.open({ config: { ...f.config, developmentControl: { ...f.config.developmentControl!, kind: 'always-agree' } } }), /mode cannot change/);
  const removed = { ...f.config }; delete removed.developmentControl; assert.throws(() => f.open({ config: removed }), /mode cannot change/);
  assert.throws(() => f.open({ additionalTools: () => [] }), /Additional Store extensions/);
  const reopened = f.open(); assert.equal(reopened.runtime.getRun(run.id)?.status, 'completed'); assert.deepEqual(f.originalStore.list('requests'), originalRequests);
});

for (const kind of ['ordinary', 'no-memory', 'no-standing-goals'] as const) test(`${kind}: consolidation payload is ordinary source evidence or denied before shell entry`, async t => {
  const f = fixture(t, kind), app = f.open(); seed(app);
  app.memory.scheduleConsolidation('host-corruption-job', ['corrupted-host-secret'], { kind: 'public' }, new Date().toISOString());
  if (kind === 'no-memory') {
    assert.throws(() => app.developmentControl.assertRestoredState(), /Consolidation contaminates/);
    await f.close(); assert.throws(() => f.open(), /Consolidation contaminates/); assert.equal(f.payloads.length, 0);
  } else {
    const runId = app.consolidation.start(60000)!; assert.ok(runId); await app.resume(runId);
    assert.ok(f.payloads.some(payload => payload.includes('TRANSFER_SECRET_593') && payload.includes('consolidation')));
  }
});

test('no-standing-goals denies accounted initiative effect replay and goal-linked obligations without erasure', async t => {
  const f = fixture(t, 'no-standing-goals'), app = f.open(); const run = f.receive('current question'); app.runtime.prepareResume(run.id);
  const call = { id: 'denied-agenda', runId: run.id, stepId: 'denial', name: 'initiative_agenda', arguments: {} }; f.bridge.captureTool(call);
  const bridge = app.runtime.bridge(run.id, f.options.authority), denied = await bridge.execute(call); assert.equal(denied.kind, 'error'); assert.match(JSON.stringify(denied.value), /Standing goal effect denied/); assert.deepEqual(await bridge.execute(call), denied);
  app.obligations.owe({ id: 'injected-goal-promise', goalId: 'foreign-goal', inputId: 'current-input', audience: { kind: 'public' }, promisedOutcome: 'injected host goal content', dueAt: null });
  assert.throws(() => app.developmentControl.assertRestoredState(), /Goal-linked obligation/); assert.equal(app.obligations.obligation('injected-goal-promise')?.promisedOutcome, 'injected host goal content');
  await f.close(); assert.throws(() => f.open(), /Goal-linked obligation/);
});

test('ordinary candidate cannot dispatch the local script effect and scripted grant rejects arbitrary speech before physical entry', async t => {
  const ordinary = fixture(t, 'ordinary'), app = ordinary.open(), run = ordinary.receive('ordinary question'); app.runtime.prepareResume(run.id);
  const call = { id: 'ordinary-script-bypass', runId: run.id, stepId: 'denial', name: 'development_control_emit', arguments: { inputId: 'caller-picked' } }; ordinary.bridge.captureTool(call);
  const denied = await app.runtime.bridge(run.id, ordinary.options.authority).execute(call); assert.equal(denied.kind, 'error'); assert.match(JSON.stringify(denied.value), /unavailable to ordinary mind/);
  const script = fixture(t, 'scripted-praise'), scripted = script.open({ secrets: { directToken: 'fixture' } }), sr = script.receive(JSON.stringify({ version: 1, task: 'praise test', proposition: null })); scripted.runtime.prepareResume(sr.id);
  const extra = { id: 'script-speech-bypass', runId: sr.id, stepId: 'denial', name: 'speech_send', arguments: { channel: 'conversation', text: 'bypass' } }; script.bridge.captureTool(extra);
  await assert.rejects(scripted.runtime.bridge(sr.id, script.options.authority).execute(extra), /Unregistered effect receiver/); assert.equal(script.originalStore.list('requests').length, 0); assert.equal(scripted.store.list('communications.direct-outbox').length, 0);
});

test('no-standing-goals resumes an interrupted current conversation with original checkpoint and no duplicate effect', async t => {
  let fail = true;
  const f = fixture(t, 'no-standing-goals', (_payload, index) => { if (index === 1) return tool('speech_send', { channel: 'conversation', text: 'Retained current-task result' }, 'retained-speech'); if (fail) throw Error('offline synthetic transport interruption'); return stop('Recovered current task'); });
  let app = f.open(), run = f.receive('current recovery details'); await app.resume(run.id); assert.equal(app.output(run.id).length, 1);
  const checkpoint = app.store.get<{ checkpoint: { artifact: any } }>('execution', run.id)!.value.checkpoint; assert.ok(Buffer.from(app.store.readArtifact(checkpoint.artifact)).toString().includes('current recovery details'));
  const effectId = app.store.list('effects')[0]!.key; await f.close(); fail = false; app = f.open(); run = f.receive('Keep the retained speech and continue after interruption', '2'); await app.resume(run.id);
  assert.equal(app.output(run.id).length, 1); assert.equal(app.store.list('effects').filter(row => row.key === effectId).length, 1); assert.ok(f.originalStore.list('requests').some(row => (row.value as any).request.status === 'uncertain'), 'original uncertain model request is retained');
});

test('immutable mode rejects source seal deletion, role/closure/configuration changes and extra Store methods', async t => {
  const f = fixture(t, 'no-memory'), app = f.open(); const mode = app.store.get('host.development-control', 'mode')!;
  Object.defineProperty(app.store, 'arbitraryExtension', { value: () => 'secret', configurable: true }); assert.throws(() => app.developmentControl.assert(), /without extensions/); Reflect.deleteProperty(app.store, 'arbitraryExtension');
  const root = f.originalStore.get<any>('allocations', f.registration.rootId)!; f.originalStore.put('allocations', f.registration.rootId, { ...root.value, startedAt: root.value.startedAt + 1 }, root.revision); assert.throws(() => app.developmentControl.assert(), /grant\/role changed/); f.originalStore.put('allocations', f.registration.rootId, root.value, root.revision + 1);
  await f.close();
  const oldClosure = f.role.closureDigest; f.role.closureDigest = identity('substitute closure'); assert.throws(() => f.open(), /configuration\/source\/grant\/closure changed|Accounting binding cannot reset/); f.role.closureDigest = oldClosure;
  const reopened = f.open(); reopened.store.delete('host.development-control', 'mode', mode.revision); await f.close(); assert.throws(() => f.open(), /seal missing/);
});

test('actual bridge grant getter is frozen, detached from caller aliases and mode seal rejects widened expiry on reopen', async t => {
  const f = fixture(t, 'no-memory'), app = f.open(); const binding = f.bridge.controlBinding;
  assert.ok(Object.isFrozen(binding) && Object.isFrozen(binding.originalGrant) && Object.isFrozen(binding.originalGrant.resources) && Object.isFrozen(binding.behaviorWindow));
  assert.equal(binding.localRootId, 'operating-envelope:v1'); assert.equal(binding.originalGrant.expiresAt, f.originalGrant.expiresAt); assert.equal(binding.behaviorWindow.deadlineAt, f.registration.reviewDeadlineAt);
  assert.throws(() => { binding.originalGrant.expiresAt = '2099-01-01T00:00:00.000Z'; }, TypeError);
  const before = identity(f.bridge.controlBinding); f.originalGrant.expiresAt = new Date(Date.parse(f.originalGrant.expiresAt) + 1000).toISOString(); assert.equal(identity(f.bridge.controlBinding), before); app.developmentControl.assert();
  await f.close(); assert.throws(() => f.open(), /configuration\/source\/grant\/closure changed/);
});

for (const kind of ['ordinary', 'no-memory'] as const) test(`${kind}: actual later compaction keeps current working facts and enforces the same developmental payload boundary`, async t => {
  let calls = 0;
  const f = fixture(t, kind, payload => {
    const decoded = JSON.parse(payload); if (!decoded.tools?.length) return stop('Current working fact is violet; retain original observations and uncertainty.');
    calls++; return calls < 34 ? tool('obligation_list', {}, `list-${calls}`) : stop('Current working fact retained');
  }), app = f.open(); seed(app);
  let run = f.receive('current working fact is violet');
  for (let round = 0; round < 5; round++) {
    await app.resume(run.id); if (app.runtime.getRun(run.id)?.status === 'completed') break;
    run = f.receive(`Continue the current working fact violet, slice ${round + 1}`, String(round + 2));
  }
  assert.equal(app.runtime.getRun(run.id)?.status, 'completed');
  const compacted = f.payloads.filter(payload => !JSON.parse(payload).tools?.length); assert.ok(compacted.length > 0, `compaction absent after ${calls} local fixture calls`);
  assert.ok(compacted.some(payload => payload.includes('current working fact is violet')));
  assert.equal(compacted.some(payload => payload.includes('TRANSFER_SECRET_593')), kind !== 'no-memory');
  if (kind === 'no-memory') assert.equal(f.payloads.some(payload => payload.includes('TRANSFER_SECRET_593')), false);
});

test('accounting factory cannot substitute its actual Store or use a structural bridge', async t => {
  const f = fixture(t, 'no-memory'); const replacement = new OperationalStore({ filename: join(f.config.stateDirectory, 'substituted.sqlite') }); t.after(() => replacement.close());
  assert.throws(() => f.open({ developmentAccounting: ({ config }) => f.options.developmentAccounting!({ config, store: replacement }) }), /actual local accounting bridge/);
  assert.throws(() => f.open({ developmentAccounting: () => ({ assertApplication() {} }) as unknown as DevelopmentAccounting }), /actual local accounting bridge/);
  assert.equal(f.originalStore.list('requests').length, 0); assert.equal(f.payloads.length, 0);
});

test('mode seal binds exact candidate role and rejects nonordinary candidate config before work', async t => {
  const f = fixture(t, 'no-memory'); f.role.kind = 'candidate';
  assert.throws(() => f.open(), /mode\/role\/assignment differs/); assert.equal(f.payloads.length, 0); assert.equal(f.originalStore.list('requests').length, 0);
});

test('ordinary non-evaluation application keeps ordinary tools, current conversation and lived state without explicit control metadata', async t => {
  const f = fixture(t, 'ordinary'); const config = { ...f.config }; delete config.developmentControl;
  const app = f.open({ config, developmentAccounting: undefined }); seed(app); const run = f.receive('ordinary current question'); await app.resume(run.id);
  assert.equal(app.developmentControl.isEvaluation, false); assert.ok(f.payloads[0]!.includes('TRANSFER_SECRET_593')); assert.equal(frame(f.payloads[0]!).currentEvidence, undefined);
  assert.ok(JSON.parse(f.payloads[0]!).tools.some((tool: any) => tool.function.name === 'memory_retrieve')); assert.equal(app.runtime.getRun(run.id)?.status, 'completed');
});

test('no-memory currentEvidence retains only bounded current-run valid IDs, never old payloads or forgotten source IDs', async t => {
  const f = fixture(t, 'no-memory'), app = f.open({ secrets: { directToken: 'fixture' } }); seed(app);
  let run = f.receive('current input 1');
  for (let revision = 2; revision <= 28; revision++) run = f.receive(`current input ${revision}`, String(revision));
  await new Promise(resolve => setImmediate(resolve));
  const references = app.developmentControl.currentEvidence(run.id, { kind: 'public' }, app.memory); assert.equal(references.length, 24); assert.ok(Buffer.byteLength(JSON.stringify(references)) <= 8192);
  assert.equal(JSON.stringify(references).includes('TRANSFER_SECRET_593'), false); assert.equal(references.some(row => row.id === 'corrupted-host-secret'), false);
  const lastInput = app.store.events<InboundInput>(run.id).filter(event => event.type === 'steering').at(-1)!.data;
  assert.equal(references.at(-1)!.sourceId, lastInput.id);
  app.memory.forget([references.at(-1)!.id]); assert.equal(app.developmentControl.currentEvidence(run.id, { kind: 'public' }, app.memory).some(row => row.sourceId === lastInput.id), false);
  assert.equal(f.originalStore.list('requests').length, 0);
});

for (const kind of ['scripted-praise', 'always-agree', 'always-oppose'] as const) test(`${kind}: synthetic crash after a real receipt reuses the same effect when checkpoint recovery resumes that run`, async t => {
  const f = fixture(t, kind), app = f.open({ secrets: { directToken: 'fixture' } }), run = f.receive(JSON.stringify({ version: 1, task: 'Recover a bounded public judgment', proposition: { id: 'public-proposition', text: 'Two plus two equals four' } })); await app.resume(run.id);
  const receipt = app.store.list<Effect>('effects')[0]!.value.receipt!, requests = f.originalStore.list('requests').length;
  // Explicit synthetic post-seal host crash-state injection: genuine original receipt retained,
  // terminal state/checkpoint rewound to the interruption boundary. This is not acquisition evidence.
  app.store.append({ id: `fixture-crash:${kind}`, stream: 'host-fixture', type: 'synthetic-crash-state', data: { runId: run.id, retainedReceipt: receipt } });
  const row = app.store.get<any>('runs', run.id)!; app.store.put('runs', run.id, { ...row.value, status: 'running', revision: row.value.revision + 1 }, row.revision);
  const execution = app.store.get<any>('execution', run.id)!; app.store.put('execution', run.id, { messageSequence: 0 }, execution.revision);
  await f.close(); const reopened = f.open({ secrets: { directToken: 'fixture' } }); assert.equal((await reopened.resume(run.id)).status, 'completed');
  assert.equal(reopened.store.list('effects').length, 1); assert.deepEqual(reopened.store.list<Effect>('effects')[0]!.value.receipt, receipt); assert.equal(f.originalStore.list('requests').length, requests); assert.equal(f.payloads.length, 0);
});

for (const kind of ['ordinary', 'no-memory', 'no-standing-goals', 'scripted-praise', 'always-agree', 'always-oppose'] as const) test(`R1: ${kind} snapshots accessor absence across caller mutation, task children and reopen`, async t => {
  const f = fixture(t, kind); let getterReads = 0, extensionCalls = 0; let extension: ApplicationOptions['additionalTools'];
  const retained: ApplicationOptions = { ...f.options };
  // Non-enumerable inherited accessor is a supported input value, read once by the constructor.
  const prototype = Object.create(Object.getPrototypeOf(retained)); Object.defineProperty(prototype, 'additionalTools', { get() { getterReads++; return extension; } }); Object.setPrototypeOf(retained, prototype);
  let app = f.openOptions(retained); assert.equal(getterReads, 1); assert.ok(Object.isFrozen(app.options)); assert.notEqual(app.options, retained);
  assert.equal(app.options.authorityStore, retained.authorityStore); assert.equal(app.options.authority, retained.authority); assert.equal(app.options.secrets, retained.secrets); assert.equal(app.options.developmentAccounting, retained.developmentAccounting);
  extension = ({ store }) => { extensionCalls++; return [{ name: 'late_descriptor', description: `LATE_DESCRIPTOR_792 ${JSON.stringify(store.list('development.memories'))}`, inputSchema: { type: 'object' }, execute: () => null }]; };
  Object.defineProperty(retained, 'additionalTools', { value: extension, configurable: true, writable: true });
  assert.throws(() => { app.options.additionalTools = extension; }, TypeError);
  const text = app.developmentControl.isScripted ? JSON.stringify({ version: 1, task: 'current task', proposition: { id: 'public', text: 'Two plus two equals four' } }) : 'current task detail';
  const run = f.receive(text); await app.resume(run.id);
  if (!app.developmentControl.isScripted) {
    const child = app.runtime.admit({ id: 'r1-child', source: 'delegation', externalId: 'r1-child', externalRevision: '1', actorId: f.options.authority.generation, authenticated: true, scope: { kind: 'public' }, value: 'current child detail' }, f.options.authority, f.config.resources, run.id);
    app.store.put('host.child-runs', child.id, { taskId: 'r1-child', depth: 1, allowedEffects: [] }, null); await app.resume(child.id);
    assert.ok(f.payloads.length >= 2); assert.equal(f.payloads.some(payload => payload.includes('LATE_DESCRIPTOR_792')), false);
  }
  assert.equal(extensionCalls, 0); assert.equal(getterReads, 1);
  await f.close(); extension = undefined; Reflect.deleteProperty(retained, 'additionalTools'); app = f.openOptions(retained); assert.equal(getterReads, 2);
  extension = () => { extensionCalls++; return []; }; await app.resume(run.id); assert.equal(extensionCalls, 0); assert.equal(getterReads, 2);
});

test('R1: ordinary predeclared accessor extension retains actual Store/callback identities and dynamic invocation semantics', async t => {
  let app: InstanceType<typeof AutarkApplication>; let factoryCalls = 0, effects = 0, reads = 0;
  const f = fixture(t, 'ordinary', (_payload, index) => index === 1 ? tool('ordinary_extension', {}, 'ordinary-extension') : stop('ordinary extension result'));
  const config = { ...f.config }; delete config.developmentControl;
  const extension: NonNullable<ApplicationOptions['additionalTools']> = context => {
    factoryCalls++; assert.equal(context.store, app.store); assert.equal(context.authority, f.options.authority); assert.equal(context.scope.kind, 'public');
    return [{ name: 'ordinary_extension', description: `Accepted ordinary descriptor invocation ${factoryCalls}`, inputSchema: { type: 'object', properties: {}, additionalProperties: false }, execute() { effects++; context.store.put('fixture.ordinary-extension', context.runId, { effects }, null); return { effects, runId: context.runId }; } }];
  };
  const retained: ApplicationOptions = { ...f.options, config, developmentAccounting: undefined }; Object.defineProperty(retained, 'additionalTools', { get() { reads++; return extension; } });
  app = f.openOptions(retained); assert.equal(reads, 1); assert.equal(app.options.additionalTools, extension); assert.equal(app.options.performRequest, f.options.performRequest);
  const run = f.receive('Use the accepted ordinary extension'); await app.resume(run.id);
  assert.equal(app.runtime.getRun(run.id)?.status, 'completed'); assert.equal(effects, 1); assert.ok(factoryCalls >= 2); assert.equal(reads, 1); assert.deepEqual(app.store.get('fixture.ordinary-extension', run.id)?.value, { effects: 1 });
  assert.ok(f.payloads[0]!.includes('Accepted ordinary descriptor invocation')); assert.equal(app.options.authorityStore, f.options.authorityStore);
});

test('R1: accepted transport accessor is captured once and caller replacement cannot change parent or child transport', async t => {
  const f = fixture(t, 'no-memory'); let getterReads = 0, replacements = 0; let selected = f.options.performRequest;
  const retained: ApplicationOptions = { ...f.options }; Object.defineProperty(retained, 'performRequest', { get() { getterReads++; return selected; } });
  const app = f.openOptions(retained); assert.equal(getterReads, 1); selected = async () => { replacements++; return stop('replacement transport'); };
  const run = f.receive('original accepted transport'); await app.resume(run.id);
  const child = app.runtime.admit({ id: 'r1-transport-child', source: 'delegation', externalId: 'r1-transport-child', externalRevision: '1', actorId: f.options.authority.generation, authenticated: true, scope: { kind: 'public' }, value: 'same accepted child transport' }, f.options.authority, f.config.resources, run.id);
  app.store.put('host.child-runs', child.id, { taskId: 'r1-transport-child', depth: 1, allowedEffects: [] }, null); await app.resume(child.id);
  assert.equal(getterReads, 1); assert.equal(replacements, 0); assert.equal(f.payloads.length, 2); assert.equal(app.options.performRequest, f.options.performRequest); assert.equal(app.runtime.getRun(child.id)?.status, 'completed');
});

for (const kind of ['ordinary', 'no-memory', 'no-standing-goals'] as const) test(`R1: ${kind} excludes late extensions during actual interrupted conversation recovery`, async t => {
  let interrupted = true, getterReads = 0, extensionCalls = 0; let extension: ApplicationOptions['additionalTools'];
  const f = fixture(t, kind, (_payload, index) => { if (index === 1) return tool('speech_send', { channel: 'conversation', text: 'Original retained result' }, 'r1-recovery-speech'); if (interrupted) throw Error('R1 synthetic local transport interruption'); return stop('Recovered current task'); });
  const retained: ApplicationOptions = { ...f.options }; Object.defineProperty(retained, 'additionalTools', { get() { getterReads++; return extension; } });
  let app = f.openOptions(retained); assert.equal(getterReads, 1);
  const late: NonNullable<ApplicationOptions['additionalTools']> = ({ store }) => { extensionCalls++; return [{ name: 'recovery_extra', description: `RECOVERY_EXTENSION_614 ${JSON.stringify(store.list('development.memories'))}`, inputSchema: { type: 'object' }, execute: () => null }]; };
  extension = late; let run = f.receive('Retain the actual current-task result'); await app.resume(run.id);
  assert.equal(app.output(run.id).length, 1); const effect = app.store.list<Effect>('effects')[0]!.value;
  assert.ok(f.originalStore.list<any>('requests').some(row => row.value.request.status === 'uncertain'));
  await f.close(); extension = undefined; interrupted = false; app = f.openOptions(retained); assert.equal(getterReads, 2); extension = late;
  run = f.receive('Continue the interrupted current task with its original result', '2'); await app.resume(run.id);
  assert.equal(app.runtime.getRun(run.id)?.status, 'completed'); assert.equal(app.output(run.id).length, 1); assert.equal(app.store.list<Effect>('effects').filter(row => row.key === effect.id).length, 1);
  assert.deepEqual(app.store.get<Effect>('effects', effect.id)!.value.receipt, effect.receipt); assert.equal(extensionCalls, 0); assert.equal(getterReads, 2);
  assert.ok(f.payloads.length >= 3); assert.equal(f.payloads.some(payload => payload.includes('RECOVERY_EXTENSION_614')), false);
});
