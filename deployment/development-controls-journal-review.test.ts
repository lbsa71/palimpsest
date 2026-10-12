// Independent actual-journal probes. Setup adapted from the unchanged actual-application fixture; worker entry is forbidden.
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
mock.module('../packages/supervisor/worker-process.ts', { namedExports: { runWorker: async () => { workers++; throw Error('Independent journal review forbids worker entry'); } } });
const { AutarkApplication } = await import('./application.ts');
const stop = (text = 'fixture response') => ({ status: 200, body: JSON.stringify({ model: 'mistral-control-fixture-v1', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: text } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) });
const tool = (name: string, args: unknown, id = `call-${name}`) => ({ status: 200, body: JSON.stringify({ model: 'mistral-control-fixture-v1', choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) });
function fixture(t: TestContext, kind: DevelopmentControlKind, callback: (payload: string, index: number) => ReturnType<typeof stop> = () => stop(), bootstrap = false) {
  const root = mkdtempSync(join(tmpdir(), 'development-control-journal-review-')), stateDirectory = join(root, 'state'), workspaceDirectory = join(root, 'workspace'); mkdirSync(stateDirectory); mkdirSync(workspaceDirectory);
  const promptFile = join(root, 'mind.txt'), compactionPromptFile = join(root, 'compaction.txt'); writeFileSync(promptFile, 'Fixture: inspect attributed evidence and finish bounded tasks.'); writeFileSync(compactionPromptFile, 'Keep current task facts, observations and uncertainty.');
  const resources = { maxRequests: 100, maxTokens: 10_000_000, maxCostUsd: 100, maxElapsedMs: 300_000, maxConcurrency: 8 };
  const config: ApplicationConfig = { stateDirectory, workspaceDirectory, applicationRoot: dirname(dirname(fileURLToPath(import.meta.url))), nodeBinary: process.execPath, workerEntrypoint: 'deployment/shell-worker.ts', artifactId: 'control-fixture', controlRevision: 'fixture-control', promptFile, compactionPromptFile,
    developmentControl: { version: 1, kind, assignmentId: kind === 'ordinary' ? null : `assignment-${kind}`, workloadDigest: identity('matched-public-fixture') },
    model: { id: 'mistral-control-fixture-v1', contextWindow: 128000, reasoning: false, effort: 'none', maxOutputTokens: 100, maxRequestsPerSlice: 12, timeoutMs: 10000, pricesPerMillion: { input: 1, output: 2 } }, resources, conversationResources: resources, bootstrapInitiative: bootstrap,
    scheduler: { windowMs: 60000, maxSlicesPerWindow: 8, maxLifetimeSlices: 32, quantumMs: 30000, idleRetryMs: 1000, maxStalls: 2, resources }, maxConcurrentRuns: 2, pollMs: 100, commands: [], researchHosts: [], direct: { host: '127.0.0.1', port: 0, actorId: 'operator', scope: { kind: 'public' }, modificationEligible: false } };
  const authorityStore = new AuthorityStore(join(stateDirectory, 'authority.sqlite')), authority = authorityStore.bootstrap('fixture-instance', config.controlRevision, config.artifactId);
  const shared = kind === 'ordinary', originalFilename = shared ? join(stateDirectory, 'operational.sqlite') : join(root, 'original.sqlite');
  const setupTime = Date.now(); let allocating = true;
  const documentJournal = {stream:`review-journal:${kind}`,hostId:'independent-review',maxAnchorDocuments:512,maxAnchorBytes:1000000};
  let originalStore = new OperationalStore({ filename: originalFilename, documentJournal }); let original = new ResourceLedger(originalStore, { tokens: 100000, costUsd: 1, elapsedMs: 10000 }, () => allocating ? setupTime : Date.now()); original.allocate('operating-envelope:v1', resources);
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
  const options: ApplicationOptions = { config, authority, authorityStore, documentJournal, secrets: { mistralApiKey: 'fixture', directToken: 'fixture' }, developmentAccounting: factory, performRequest: async (payload: string) => { payloads.push(payload); return callback(payload, payloads.length); } };
  const openOptions = (acceptedOptions: ApplicationOptions) => { app = new AutarkApplication(acceptedOptions); return app; };
  const open = (override: Partial<ApplicationOptions> = {}) => openOptions({ ...options, ...override });
  const receive = (text = 'current task detail', revision = '1', conversation = 'conversation') => app!.communications.receive({ source: 'direct', externalId: 'public-input', revision, conversation, text, actor: { id: 'operator', scope: { kind: 'public' }, modificationEligible: false } }).run;
  t.after(async () => { await app?.close(); if (!shared) originalStore.close(); raw.close(); authorityStore.close(); rmSync(root, { recursive: true, force: true }); });
  return { config, options, role, registration, originalGrant, open, openOptions, receive, payloads, get app() { return app!; }, get bridge() { return bridge!; }, get original() { return original; }, get originalStore() { return originalStore; }, async close() { await app?.close(); app = undefined; } };
}

const standing = ['initiative.goals','initiative.goal-history','initiative.goal-provenance','initiative.drives','initiative.drive-history','initiative.opportunities','initiative.plans','initiative.execution','host.bootstrap'];
const consolidation = ['host.consolidation-runs','development.jobs'];
const modes = ['ordinary','no-memory','no-standing-goals','scripted-praise','always-agree','always-oppose'] as const;

for(const kind of modes)test(`independent actual journal: ${kind} accepts only real setup and reopens the exact control seal`,async t=>{
  const f=fixture(t,kind),app=f.open(),seal=app.developmentControl.modeSeal;
  const mutations=app.store.events().filter(e=>e.type==='document-mutation');assert.ok(mutations.length>0);assert.equal(app.store.events().some(e=>e.type==='document-journal-mutation'),false);
  assert.ok(mutations.some(e=>(e.data as any).namespace==='development.accounting.local'));
  if(kind==='ordinary'){assert.ok(mutations.some(e=>(e.data as any).namespace==='allocations'));assert.ok(mutations.some(e=>(e.data as any).namespace==='budgets'));assert.ok(mutations.some(e=>(e.data as any).namespace==='development.accounting.bindings'));}
  app.developmentControl.assertRestoredState();assert.equal(f.originalStore.list('requests').length,0);await f.close();const reopened=f.open();assert.deepEqual(reopened.developmentControl.modeSeal,seal);reopened.developmentControl.assertRestoredState();assert.equal(workers,0);assert.equal(f.payloads.length,0);
});

for(const namespace of ['initiative.goals','development.jobs','review.prior-memory'])test(`independent actual journal: deleted pre-seal ${namespace} still refuses before accounting`,t=>{
  const f=fixture(t,'no-memory'),store=new OperationalStore({filename:join(f.config.stateDirectory,'operational.sqlite'),documentJournal:f.options.documentJournal});store.put(namespace,'old',{publicSynthetic:'prior'},null);store.delete(namespace,'old',1);assert.equal(store.list(namespace).length,0);assert.ok(store.events().some(e=>e.type==='document-mutation'&&(e.data as any).namespace===namespace));store.close();
  let factoryCalls=0;assert.throws(()=>f.open({developmentAccounting:args=>{factoryCalls++;return f.options.developmentAccounting!(args);}}),/prior operational events|prior journal content/);assert.equal(factoryCalls,0);assert.equal(workers,0);
});

for(const kind of modes.filter(kind=>kind!=='ordinary')){
  const denied = kind==='no-memory'?consolidation:kind==='no-standing-goals'?standing:[...standing,...consolidation];
  for(const namespace of denied)test(`independent actual journal: ${kind} refuses deleted ${namespace} history and reopen`,async t=>{
    const f=fixture(t,kind),app=f.open();app.developmentControl.assertRestoredState();
    app.store.put(namespace,'erased',{publicSynthetic:'forbidden history'},null);app.store.delete(namespace,'erased',1);assert.equal(app.store.list(namespace).length,0);
    const mutations=app.store.events().filter(e=>e.type==='document-mutation'&&(e.data as any).namespace===namespace);assert.equal(mutations.length,2);assert.equal((mutations[1]!.data as any).after,null);
    assert.throws(()=>app.developmentControl.assertRestoredState(),/journal history contaminates/);assert.equal(app.store.list(namespace).length,0);assert.equal(f.originalStore.list('requests').length,0);await f.close();assert.throws(()=>f.open(),/journal history contaminates/);assert.equal(workers,0);
  });
}

for(const [kind,allowed] of [['ordinary',[...standing,...consolidation]],['no-memory',standing],['no-standing-goals',consolidation]] as const)test(`independent actual journal: ${kind} keeps mode-permitted deleted history usable`,t=>{
  const f=fixture(t,kind),app=f.open();for(const namespace of allowed){app.store.put(namespace,'permitted',{publicSynthetic:'allowed history'},null);app.store.delete(namespace,'permitted',1);}app.developmentControl.assertRestoredState();assert.equal(f.originalStore.list('requests').length,0);assert.equal(workers,0);
});

test('independent actual journal: misspelled legacy mutation event is not a fresh-setup fallback',t=>{
  const f=fixture(t,'no-memory'),store=new OperationalStore({filename:join(f.config.stateDirectory,'operational.sqlite'),documentJournal:f.options.documentJournal});
  store.append({id:'legacy-spelling',stream:'review-synthetic',type:'document-journal-mutation',data:{namespace:'allocations'}});store.close();let factoryCalls=0;
  assert.throws(()=>f.open({developmentAccounting:args=>{factoryCalls++;return f.options.developmentAccounting!(args);}}),/prior operational events/);assert.equal(factoryCalls,0);assert.equal(workers,0);
});
