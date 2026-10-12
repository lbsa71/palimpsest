// Fixture and module-mocked worker plumbing adapted unchanged in behavior from
// development-controls-composition.test.ts; all cases below are fresh reviewer-owned.
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
import { ProcessLease } from '../packages/supervisor/process-lease.ts';
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

// Exhaustive type-level inventory: a new declared option requires an explicit decision here.
for (const representation of ['own', 'inherited'] as const) test(`rereview: every ${representation} non-enumerable option is captured once across real execution and reopen`, async t => {
  const f = fixture(t, 'no-memory');
  const lease = new ProcessLease(join(f.config.stateDirectory, 'review-owned-lease.sqlite'));
  t.after(() => lease.close());
  const bot: NonNullable<ApplicationOptions['slackBotApi']> = { async call() { throw Error('Unexpected Slack call'); } };
  const appApi: NonNullable<ApplicationOptions['slackAppApi']> = { async call() { throw Error('Unexpected Slack app call'); } };
  const values = { config: f.options.config, secrets: f.options.secrets, authority: f.options.authority, authorityStore: f.options.authorityStore,
    performRequest: f.options.performRequest, brokerTiming: undefined, runWorker: undefined, slackBotApi: bot, slackAppApi: appApi, lease,
    developmentAccounting: f.options.developmentAccounting, documentJournal: null, additionalTools: undefined } satisfies Record<keyof ApplicationOptions, unknown>;
  const reads = new Map<keyof ApplicationOptions, number>();
  const holder = Object.create(null) as ApplicationOptions;
  const keys = Object.keys(values) as (keyof ApplicationOptions)[];
  for (const key of keys) Object.defineProperty(holder, key, { configurable: true, get() {
    const count = (reads.get(key) ?? 0) + 1; reads.set(key, count);
    assert.equal(count, 1, `caller option ${key} must not be reread`); return values[key];
  } });
  const caller = representation === 'inherited' ? Object.create(holder) as ApplicationOptions : holder;
  let app = f.openOptions(caller); const accepted = app.options;
  assert.notEqual(accepted, caller); assert.ok(Object.isFrozen(accepted));
  assert.deepEqual(Object.keys(accepted).sort(), keys.sort());
  for (const key of keys) { assert.equal(reads.get(key), 1); assert.equal(accepted[key], values[key]); }
  assert.equal(app.lease, lease); assert.equal(f.originalStore.list('requests').length, 0);
  // Poison every caller property; runtime, health, child admission and close must use captured references.
  for (const key of keys) Object.defineProperty(caller, key, { configurable: true, get() { throw Error(`late caller read: ${key}`); } });
  const originalKey = values.secrets.mistralApiKey;
  values.secrets.mistralApiKey = '';
  assert.ok(JSON.stringify(app.health()).includes('provider-credential-unavailable'), 'accepted secret object remains shared for host rotation');
  values.secrets.mistralApiKey = originalKey;
  assert.equal(JSON.stringify(app.health()).includes('provider-credential-unavailable'), false);
  const run = f.receive('Capture inventory parent fact amber'); await app.resume(run.id);
  assert.equal(app.runtime.getRun(run.id)?.status, 'completed');
  const child = app.runtime.admit({ id: 'inventory-child', source: 'delegation', externalId: 'inventory-child', externalRevision: '1', actorId: values.authority.generation, authenticated: true, scope: { kind: 'public' }, value: 'Capture inventory child fact indigo' }, values.authority, f.config.resources, run.id);
  app.store.put('host.child-runs', child.id, { taskId: 'inventory-child', depth: 1, allowedEffects: [] }, null);
  await app.resume(child.id); assert.equal(app.runtime.getRun(child.id)?.status, 'completed');
  assert.ok(f.payloads.some(payload => payload.includes('parent fact amber')));
  assert.ok(f.payloads.some(payload => payload.includes('child fact indigo')));
  const requestIds = f.originalStore.list('requests').map(row => row.key).sort(); assert.ok(requestIds.length >= 2);
  await f.close(); lease.assertHeld();
  app = f.openOptions(accepted); assert.notEqual(app.options, accepted); assert.equal(app.options.lease, lease);
  const followup = f.receive('Reopened current task fact silver', '2'); await app.resume(followup.id);
  assert.equal(app.runtime.getRun(followup.id)?.status, 'completed');
  assert.ok(f.payloads.at(-1)!.includes('Reopened current task fact silver'));
  for (const id of requestIds) assert.ok(f.originalStore.get('requests', id), 'original request identity survives reopen');
  for (const key of keys) assert.equal(reads.get(key), 1);
  await f.close(); lease.assertHeld(); lease.close();
});

for (const representation of ['own', 'inherited'] as const) test(`rereview: admitted ${representation} non-enumerable extension fails before accounting or model entry`, t => {
  const f = fixture(t, 'no-memory'); let getterReads = 0, factoryCalls = 0, extensionCalls = 0;
  const holder = Object.create(null);
  Object.defineProperty(holder, 'additionalTools', { get() { getterReads++; return () => { extensionCalls++; return []; }; } });
  const caller = representation === 'inherited' ? Object.assign(Object.create(holder), f.options) as ApplicationOptions : { ...f.options };
  if (representation === 'own') Object.defineProperty(caller, 'additionalTools', Object.getOwnPropertyDescriptor(holder, 'additionalTools')!);
  caller.developmentAccounting = context => { factoryCalls++; return f.options.developmentAccounting!(context); };
  assert.throws(() => f.openOptions(caller), /Additional Store extensions are unqualified/);
  assert.equal(getterReads, 1); assert.equal(extensionCalls, 0); assert.equal(factoryCalls, 0);
  assert.equal(f.payloads.length, 0); assert.equal(f.originalStore.list('requests').length, 0);
});

test('rereview: an actual no-memory initiative retains accepted transport and extension absence after caller replacement', async t => {
  let proposed = false, adopted = false, replacementCalls = 0, lateExtensions = 0;
  const f = fixture(t, 'no-memory', payload => {
    const context = frame(payload);
    if (!proposed) { proposed = true; return tool('initiative_goal_propose', { id: 'review-initiative', purpose: 'Inspect a current amber observation', successCriteria: ['Retain an actual current observation'], sourceIds: [context.currentEvidence[0].id], resources: f.config.resources, priority: 1, nextAction: 'Inspect current facts', reviewAt: new Date(Date.now() + 60000).toISOString() }, 'review-propose'); }
    if (!adopted) { adopted = true; return tool('initiative_goal_accept', { id: 'review-initiative', expectedRevision: 1, reason: 'Current observation supports bounded inquiry' }, 'review-adopt'); }
    return stop();
  });
  const caller: ApplicationOptions = { ...f.options };
  const app = f.openOptions(caller); seed(app);
  caller.performRequest = async () => { replacementCalls++; return stop('Unaccepted transport'); };
  caller.additionalTools = ({ store }) => { lateExtensions++; return [{ name: 'initiative_late_descriptor', description: JSON.stringify(store.list('development.memories')), inputSchema: { type: 'object' }, execute: () => null }]; };
  const run = f.receive('Current amber observation is available for inquiry'); await app.resume(run.id);
  assert.ok(app.goals.goal('review-initiative'));
  for (let attempt = 0; attempt < 200 && !f.payloads.some(payload => frame(payload)?.runId !== run.id); attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  const execution = app.store.list<{ runId: string }>('initiative.execution')[0]; assert.ok(execution, 'a real scheduler initiative must exist');
  const initiativePayload = f.payloads.find(payload => frame(payload)?.runId === execution.value.runId); assert.ok(initiativePayload, 'the actual initiative must reach captured local transport');
  assert.ok(initiativePayload.includes('Inspect a current amber observation'));
  assert.equal(f.payloads.some(payload => payload.includes('TRANSFER_SECRET_593')), false);
  assert.equal(f.payloads.some(payload => payload.includes('initiative_late_descriptor')), false);
  assert.equal(replacementCalls, 0); assert.equal(lateExtensions, 0);
});
