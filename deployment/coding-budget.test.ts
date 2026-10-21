import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codexCodingShell } from './coding-shell.ts';
import { AutarkApplication } from './application.ts';
import type { ApplicationConfig } from './config.ts';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { EffectJournal } from '../packages/effects/index.ts';
import { DurableRuntime, ResourceLedger } from '../packages/runtime/index.ts';
import { assertAuthority, identity, type PhysicalRequest } from '../packages/contracts/index.ts';
import type { CodingRequest, CodingResult } from '../packages/coding/index.ts';
import { parseCodexResult } from '../packages/coding/index.ts';
import type { CodingTurn } from './coding-limb.ts';

const authority = { generation: 'budget-fixture', epoch: 1, controlRevision: 'budget-controls' };
const nativeId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const finished: CodingResult = { provider: 'codex', status: 'completed', sessionId: nativeId, summary: 'Observed completion', events: [], stdout: '', stderr: '',
  exitCode: 0, elapsedMs: 20, usage: { inputTokens: 30, outputTokens: 10, cachedInputTokens: 0, costUsd: null, physicalRequests: null } };

function shellFixture(budget: { timeoutMs: number; maxTokens: number; reservationElapsedMs?: number }, maxTokens = 2000, outcome = finished) {
  const root = mkdtempSync(join(tmpdir(), 'aeon-coding-budget-'));
  const store = new OperationalStore({ filename: join(root, 'state.sqlite') });
  let now = 1000;
  const fence = { assert(value: typeof authority) { assertAuthority(value, authority); } };
  const effects = new EffectJournal(store, fence, { async dispatch() { throw Error('No effect receiver in shell fixture'); }, async reconcile() { return { outcome: 'unresolved' as const, receipt: store.putJsonArtifact({ reason: 'No effect receiver in shell fixture' }) }; } });
  const resources = new ResourceLedger(store, { tokens: 100000, costUsd: 5, elapsedMs: 1000 }, () => now);
  const envelope = { maxRequests: 10, maxTokens, maxCostUsd: 10, maxElapsedMs: 5000, maxConcurrency: 2 };
  resources.allocate('parent', envelope);
  now += 250;
  const requests: CodingRequest[] = [], budgetRunIds: string[] = [];
  let runId = '';
  const turn = (): CodingTurn => ({ id: 'turn-1', sequence: 1, sessionId: 'session-1', runId, authority, message: 'Run the bounded task.', status: 'running', notified: false });
  const shell = codexCodingShell({ store, timeoutMs: 5000, provider: { id: 'codex', async run(request) { requests.push(request); return outcome; } },
    session: () => ({ id: 'session-1', owner: 'owner', provider: 'codex', workspace: join(root, 'work'), scope: { kind: 'public' } }), turn,
    executionBudget(id) { budgetRunIds.push(id); return { reservationElapsedMs: budget.timeoutMs + 500, ...budget }; },
    onProcessStopped: id => resources.releaseConcurrency(id, { kind: 'transport-terminal', reason: 'Test host confirmed process cleanup' }) });
  const runtime = new DurableRuntime({ store, effects, resources, shell, now: () => now, elapsedNow: () => 0, newId: (() => { let count = 0; return () => `event-${++count}`; })() });
  const run = runtime.admit({ id: 'coding-1', source: 'host.coding', externalId: 'coding-1', externalRevision: '1', actorId: 'host', authenticated: true,
    scope: { kind: 'public' }, value: 'Run coding' }, authority, envelope, 'parent');
  runId = run.id;
  return { root, store, resources, runtime, run, requests, budgetRunIds,
    async execute() { return runtime.resume(run.id, { id: 'coding-prompt', requestDigest: identity('fixture'), fragments: [] }); },
    close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('coding shell reserves the granted remaining tokens and time instead of its larger defaults', async () => {
  const f = shellFixture({ timeoutMs: 1500, maxTokens: 800 });
  try {
    assert.equal((await f.execute()).status, 'waiting');
    assert.deepEqual(f.budgetRunIds, [f.run.id]);
    assert.equal(f.requests.length, 1);
    assert.equal((f.requests[0] as CodingRequest & { timeoutMs: number }).timeoutMs, 1500);
    const reservation = f.store.get<{ request: PhysicalRequest; ceiling: { tokens: number; costUsd: number; elapsedMs: number } }>('requests', 'coding-invocation:turn-1')!.value;
    assert.deepEqual(reservation.ceiling, { tokens: 800, costUsd: 5, elapsedMs: 2000 });
    assert.equal(reservation.request.status, 'succeeded');
    assert.equal(reservation.request.model, 'gpt-6.1-sol');
    const prompt = f.store.get<{ artifact: { uri: string; sha256: string } }>('prompts', reservation.request.promptManifestId)!.value;
    const payload = JSON.parse(Buffer.from(f.store.readArtifact(prompt.artifact)).toString());
    assert.equal(payload.model, 'gpt-6.1-sol'); assert.equal(payload.reasoningEffort, 'high');
    assert.equal(reservation.request.usage.costUsd, null);
    assert.equal(reservation.request.usage.inputTokens, 30); assert.equal(reservation.request.usage.outputTokens, 10);
    assert.equal(f.resources.snapshot('parent').cancelled, false);
    const retained = f.store.get<{ artifact: { uri: string; sha256: string } }>('host.coding-results', 'turn-1')!.value;
    assert.equal(f.store.readJsonArtifact<CodingResult>(retained.artifact).usage.physicalRequests, null);
  } finally { f.close(); }
});

test('a normal provider timeout preserves actual cleanup elapsed time without cancelling the parent', async () => {
  const timeout = parseCodexResult({ exitCode: null, signal: 'SIGTERM', stdout: JSON.stringify({ type: 'thread.started', thread_id: nativeId }), stderr: '', elapsedMs: 1510, stoppedFor: 'timeout' });
  const f = shellFixture({ timeoutMs: 1500, reservationElapsedMs: 2000, maxTokens: 800 }, 2000, timeout);
  try {
    assert.equal((await f.execute()).status, 'waiting');
    const request = f.resources.request('coding-invocation:turn-1')!;
    assert.equal(request.status, 'uncertain'); assert.equal(request.usage.elapsedMs, 1510);
    assert.equal(f.resources.snapshot('parent').cancelled, false);
    assert.equal((f.requests[0] as CodingRequest & { timeoutMs: number }).timeoutMs, 1500);
  } finally { f.close(); }
});

test('aggregate CLI usage above the ordinary 100k call ceiling does not cancel its granted parent', async () => {
  const f = shellFixture({ timeoutMs: 1500, maxTokens: 150000 }, 200000,
    { ...finished, usage: { ...finished.usage, inputTokens: 110000, outputTokens: 20000 } });
  try {
    assert.equal((await f.execute()).status, 'waiting'); assert.equal(f.requests.length, 1);
    const snapshot = f.resources.snapshot('parent');
    assert.equal(snapshot.tokens, 130000); assert.equal(snapshot.cancelled, false);
    assert.equal(f.resources.request('coding-invocation:turn-1')?.usage.costUsd, null);
  } finally { f.close(); }
});

test('uncertain coding frees capacity only with confirmed process cleanup and retains unknown charges', async () => {
  for (const processStopped of [false, true]) {
    const outcome: CodingResult = { ...finished, status: 'uncertain', processStopped,
      usage: { inputTokens: null, outputTokens: null, cachedInputTokens: null, costUsd: null, physicalRequests: null } };
    const f = shellFixture({ timeoutMs: 1500, maxTokens: 800 }, 2000, outcome);
    try {
      await f.execute();
      assert.equal(f.resources.request('coding-invocation:turn-1')?.status, 'uncertain');
      assert.equal(f.resources.snapshot('parent').concurrent, processStopped ? 0 : 1);
      assert.equal(f.resources.snapshot('parent').costUsd, 5);
      assert.equal(f.resources.snapshot('parent').tokens, 800);
    } finally { f.close(); }
  }
});

for (const budget of [{ timeoutMs: 0, maxTokens: 800 }, { timeoutMs: 1500, maxTokens: 0 }, { timeoutMs: 5001, maxTokens: 800 }, { timeoutMs: NaN, maxTokens: 800 }]) {
  test(`exhausted or invalid coding execution budget is refused before dispatch: ${JSON.stringify(budget)}`, async () => {
    const f = shellFixture(budget);
    try {
      assert.notEqual((await f.execute()).status, 'completed');
      assert.equal(f.requests.length, 0); assert.equal(f.store.list('requests').length, 0); assert.equal(f.store.list('prompts').length, 0);
      assert.match(JSON.stringify(f.store.get('execution', f.run.id)?.value), /positive remaining/);
    } finally { f.close(); }
  });
}

test('remaining ledger admission still prevents a coding dispatch when the supplied grant exceeds tokens', async () => {
  const f = shellFixture({ timeoutMs: 1500, maxTokens: 2001 });
  try {
    assert.equal((await f.execute()).status, 'blocked');
    assert.equal(f.requests.length, 0); assert.equal(f.store.list('requests').length, 0);
  } finally { f.close(); }
});

test('default coding timeout admits a bounded conversation after its parent has consumed time', { timeout: 20000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-coding-default-budget-'));
  const stateDirectory = join(root, 'state'), workspaceDirectory = join(root, 'work'); mkdirSync(stateDirectory); mkdirSync(workspaceDirectory);
  const promptFile = join(root, 'mind'), compactionPromptFile = join(root, 'compact'); writeFileSync(promptFile, 'Mind fixture'); writeFileSync(compactionPromptFile, 'Retain context');
  const resources = { maxRequests: 30, maxTokens: 1_000_000, maxCostUsd: 100, maxElapsedMs: 120000, maxConcurrency: 4 };
  const config: ApplicationConfig = { stateDirectory, workspaceDirectory, applicationRoot: dirname(dirname(fileURLToPath(import.meta.url))), nodeBinary: process.execPath,
    workerEntrypoint: 'deployment/shell-worker.ts', artifactId: 'default-budget', controlRevision: 'default-controls', promptFile, compactionPromptFile,
    model: { id: 'mistral-fixture-v1', contextWindow: 128000, reasoning: false, effort: 'none', maxOutputTokens: 1024, maxRequestsPerSlice: 5, timeoutMs: 1000, pricesPerMillion: { input: 1, output: 2 } },
    resources, conversationResources: resources, bootstrapInitiative: false, scheduler: { windowMs: 60000, maxSlicesPerWindow: 2, maxLifetimeSlices: 4, quantumMs: 30000, idleRetryMs: 1000, maxStalls: 2, resources },
    maxConcurrentRuns: 2, pollMs: 100, commands: ['/runtime/node'], researchHosts: [], direct: { host: '127.0.0.1', port: 0, actorId: 'operator', scope: { kind: 'public' }, modificationEligible: true } };
  const authorityStore = new AuthorityStore(join(stateDirectory, 'authority.sqlite'));
  const admitted = authorityStore.bootstrap('default-budget', config.controlRevision, config.artifactId);
  let mindCalls = 0, codingCalls = 0, observedTimeout = 0;
  const app = new AutarkApplication({ config, authority: admitted, authorityStore, secrets: { mistralApiKey: 'fixture', directToken: 'fixture' },
    codingExecutor: async invocation => {
      codingCalls++; observedTimeout = invocation.timeoutMs;
      return { exitCode: 0, signal: null, elapsedMs: 2, stderr: '', stdout: [
        { type: 'thread.started', thread_id: nativeId }, { type: 'item.completed', item: { type: 'agent_message', text: 'Bounded work complete' } },
        { type: 'turn.completed', usage: { input_tokens: 20, cached_input_tokens: 0, output_tokens: 10 } },
      ].map(event => JSON.stringify(event)).join('\n') };
    },
    performRequest: async () => {
      mindCalls++;
      const call = mindCalls === 1;
      return { status: 200, body: JSON.stringify({ model: config.model.id, choices: [{ finish_reason: call ? 'tool_calls' : 'stop', message: { role: 'assistant', content: call ? null : 'Observed the coding result.',
        ...(call ? { tool_calls: [{ id: '000000001', type: 'function', function: { name: 'develop', arguments: JSON.stringify({ message: 'Run one bounded fixture task.', target: 'workspace' }) } }] } : {}) } }], usage: { prompt_tokens: 20, completion_tokens: 10 } }) };
    } });
  try {
    assert.equal(config.coding, undefined);
    const run = app.communications.receive({ source: 'direct', externalId: 'default-coding', revision: '1', conversation: 'default-coding', text: 'Code this bounded task',
      actor: { id: 'operator', scope: config.direct.scope, modificationEligible: true } }).run;
    await app.resume(run.id);
    const deadline = Date.now() + 12000;
    while (app.runtime.getRun(run.id)?.status !== 'completed') {
      assert.ok(Date.now() < deadline, JSON.stringify({ turns: app.store.list('host.coding-turns'), execution: app.store.list('execution') }));
      await app.tick(); await new Promise<void>(resolve => setTimeout(resolve, 10));
    }
    assert.equal(codingCalls, 1); assert.equal(mindCalls, 2);
    assert.ok(observedTimeout > 0 && observedTimeout < config.conversationResources.maxElapsedMs);
    assert.equal(app.resources.snapshot(run.id).cancelled, false);
    assert.equal(app.store.list<CodingTurn>('host.coding-turns')[0]?.value.status, 'completed');
  } finally { await app.close(); authorityStore.close(); rmSync(root, { recursive: true, force: true }); }
});
