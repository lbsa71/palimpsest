import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import test, { mock, type TestContext } from 'node:test';
import { createAgentShell, type ShellOptions } from '../packages/agent-shell/index.ts';
import type { JsonValue, ShellBridge, ShellInput } from '../packages/contracts/index.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import { ProcessLease } from '../packages/supervisor/process-lease.ts';
import type { WorkerOptions } from '../packages/supervisor/worker-process.ts';
import type { ApplicationConfig } from './config.ts';

assert.ok(process.execArgv.includes('--experimental-test-module-mocks'), 'Shutdown checks require explicit in-process worker transport');
mock.module('../packages/supervisor/worker-process.ts', { namedExports: { runWorker: async (options: WorkerOptions): Promise<JsonValue> => {
  const start = options.initial as unknown as { input: ShellInput; options: ShellOptions; fragments: Record<string, string> };
  const call = <T>(method: string, ...args: unknown[]) => options.handle(method, args as JsonValue[], options.command.signal!) as Promise<T>;
  const shell = createAgentShell({ ...start.options, apiKey: () => 'fixture', resolveFragment: async fragment => start.fragments[fragment.artifact.sha256]!, fetch: async (_url, init) => {
    const response = await call<{ status: number; body: string }>('provider.fetch', init!.body); return new Response(response.body, { status: response.status });
  } });
  const bridge: ShellBridge = { execute: (...args) => call('execute', ...args), persistCheckpoint: (...args) => call('persistCheckpoint', ...args), readCheckpoint: (...args) => call('readCheckpoint', ...args), capturePrompt: (...args) => call('capturePrompt', ...args), reserve: (...args) => call('reserve', ...args), dispatched: (...args) => call('dispatched', ...args), settle: (...args) => call('settle', ...args) };
  return await shell.run(start.input, bridge, options.command.signal) as unknown as JsonValue;
} } });
const { AutarkApplication } = await import('./application.ts');
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
const turn = () => new Promise<void>(resolve => setImmediate(resolve));

// Reuse only the established configuration and in-process Pi transport scaffold;
// the causal review scenarios below are independent of the author's six assertions.
function fixture(t: TestContext, options: { slack?: boolean; externalLease?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'aeon-shutdown-')), stateDirectory = join(root, 'state'), workspaceDirectory = join(root, 'workspace'); mkdirSync(stateDirectory); mkdirSync(workspaceDirectory);
  const promptFile = join(root, 'mind.txt'), compactionPromptFile = join(root, 'compact.txt'); writeFileSync(promptFile, 'Bounded shutdown fixture.'); writeFileSync(compactionPromptFile, 'Preserve unresolved work.');
  const resources = { maxRequests: 100, maxTokens: 10_000_000, maxCostUsd: 100, maxElapsedMs: 300_000, maxConcurrency: 8 };
  const config: ApplicationConfig = { stateDirectory, workspaceDirectory, applicationRoot: dirname(dirname(fileURLToPath(import.meta.url))), nodeBinary: process.execPath, workerEntrypoint: 'deployment/shell-worker.ts', artifactId: 'shutdown-fixture', controlRevision: 'fixture-controls', promptFile, compactionPromptFile,
    model: { id: 'mistral-fixture-v1', contextWindow: 128000, reasoning: false, effort: 'none', maxOutputTokens: 100, maxRequestsPerSlice: 4, timeoutMs: 10000, pricesPerMillion: { input: 1, output: 2 } }, resources, conversationResources: resources,
    bootstrapInitiative: false, scheduler: { windowMs: 60000, maxSlicesPerWindow: 8, maxLifetimeSlices: 32, quantumMs: 30000, idleRetryMs: 1000, maxStalls: 2, resources }, maxConcurrentRuns: 2, pollMs: 100, commands: [], researchHosts: [], direct: { host: '127.0.0.1', port: 0, actorId: 'operator', scope: { kind: 'public' }, modificationEligible: false },
    ...(options.slack ? { slack: { teamId: 'fixture-team', botUserId: 'fixture-bot', channels: [{ channel: 'fixture-channel', scope: { kind: 'public' } }], eligibleHumanIds: [], coverageStart: '1.000000', lookbackSeconds: 10, allowSpeech: false } } : {}) };
  const authorityStore = new AuthorityStore(join(stateDirectory, 'authority.sqlite')), authority = authorityStore.bootstrap('fixture-instance', config.controlRevision, config.artifactId);
  const lease = options.externalLease ? new ProcessLease(join(stateDirectory, 'process-lease.sqlite')) : undefined;
  const requests: { release: ReturnType<typeof deferred>; aborted: ReturnType<typeof deferred>; signal: AbortSignal }[] = [];
  let onAbort: (() => void) | undefined;
  const api = { async call<T>(): Promise<T> { throw new Error('Review forbids Slack calls'); } };
  const app = new AutarkApplication({ config, authority, authorityStore, lease, secrets: { mistralApiKey: 'fixture', directToken: 'fixture' }, slackBotApi: api, slackAppApi: api,
    performRequest: async (_payload, signal) => {
      const request = { release: deferred(), aborted: deferred(), signal }; requests.push(request);
      const aborted = () => { onAbort?.(); request.aborted.resolve(); };
      if (signal.aborted) aborted(); else signal.addEventListener('abort', aborted, { once: true });
      await request.release.promise; signal.throwIfAborted(); throw new Error('Review requires abort before release');
    } });
  const closeStore = app.store.close.bind(app.store), closeLease = app.lease.close.bind(app.lease);
  const stopSlack = app.slackSocket?.stop.bind(app.slackSocket), closeDirect = app.directApi.close.bind(app.directApi);
  t.after(async () => {
    onAbort = undefined;
    for (const request of requests) request.release.resolve();
    await app.close().catch(() => undefined);
    app.store.close = closeStore; app.lease.close = closeLease;
    if (app.slackSocket && stopSlack) app.slackSocket.stop = stopSlack;
    app.directApi.close = closeDirect; delete (app.directApi as unknown as { listening?: boolean }).listening;
    try { closeStore(); } catch { /* Successful close already closed the Store. */ }
    closeLease(); authorityStore.close(); rmSync(root, { recursive: true, force: true });
  });
  const receive = (id: string) => app.communications.receive({ source: 'direct', externalId: id, revision: '1', conversation: id, text: 'Wait for shutdown', actor: { id: 'operator', scope: { kind: 'public' }, modificationEligible: false } }).run;
  const waitFor = async (predicate: () => boolean) => { for (let i = 0; i < 200 && !predicate(); i++) await turn(); assert.ok(predicate(), 'Expected bounded fixture event'); };
  const begin = async (id: string) => {
    const count = requests.length, run = receive(id);
    // There is intentionally no interval/listener in this fixture. Pump the normal
    // tick after an empty initiative slot settles, as the running host would.
    for (let i = 0; i < 200 && requests.length === count; i++) { await app.tick(); await turn(); }
    assert.equal(requests.length, count + 1); assert.equal(app.runtime.getRun(run.id)!.status, 'running'); return run;
  };
  const fault = (sql: string) => { const db = new DatabaseSync(join(stateDirectory, 'operational.sqlite')); try { db.exec(sql); } finally { db.close(); } };
  return { app, authority, config, requests, receive, begin, waitFor, fault, closeStore, closeLease, setOnAbort: (callback: () => void) => { onAbort = callback; } };
}

function observed(promise: Promise<void>) {
  let done = false;
  const result = promise.then(() => { done = true; return undefined; }, (error: unknown) => { done = true; return error; });
  return { result, get done() { return done; } };
}
function held(f: ReturnType<typeof fixture>) {
  f.app.lease.assertHeld(); assert.ok(f.app.store.get('allocations', 'operating-envelope:v1'));
  assert.throws(() => new ProcessLease(join(f.config.stateDirectory, 'process-lease.sqlite')), /Another supervisor/);
}

test('reentrant abort and ingress callbacks receive the original pending close; admission is fenced synchronously', { timeout: 10000 }, async t => {
  const f = fixture(t, { slack: true }), run = await f.begin('initial');
  let fromAbort: Promise<void> | undefined, fromSlack: Promise<void> | undefined, stopped = 0;
  f.setOnAbort(() => { fromAbort = f.app.close(); });
  f.app.slackSocket!.stop = async () => { stopped++; fromSlack = f.app.close(); };
  const closing = f.app.close(), observation = observed(closing);
  const health = f.app.health() as unknown as { execution: { reasons: string[] } };
  assert.ok(health.execution.reasons.includes('stopping'));
  const later = f.receive('after-close'); await f.app.tick();
  await f.requests[0]!.aborted.promise; await turn();
  assert.strictEqual(fromAbort, closing); assert.strictEqual(fromSlack, closing); assert.strictEqual(f.app.close(), closing);
  assert.equal(observation.done, false); assert.equal(f.requests.length, 1); assert.equal(f.app.runtime.getRun(later.id)!.status, 'ready');
  assert.ok(f.app.store.get('host.pending-runs', run.id)); held(f);
  f.requests[0]!.release.resolve(); assert.equal(await observation.result, undefined);
  assert.strictEqual(f.app.close(), closing); assert.equal(stopped, 1);
});

test('first sorted ordinary pending-write fault cannot skip the second write before either abort', { timeout: 10000 }, async t => {
  const f = fixture(t), first = await f.begin('first'), second = await f.begin('second');
  const [bad, good] = [first.id, second.id].sort();
  f.fault(`CREATE TRIGGER review_fault BEFORE INSERT ON documents WHEN NEW.namespace='host.pending-runs' AND NEW.key='${bad!.replaceAll("'", "''")}' BEGIN SELECT RAISE(ABORT, 'review-one-run-write'); END`);
  const atAbort: boolean[] = []; f.setOnAbort(() => { atAbort.push(!!f.app.store.get('host.pending-runs', good!)); });
  const store = f.app.store, lease = f.app.lease, grant = store.get('allocations', 'operating-envelope:v1');
  const closing = f.app.close(), observation = observed(closing);
  await Promise.all(f.requests.map(request => request.aborted.promise)); await turn();
  assert.deepEqual(atAbort, [true, true]); assert.equal(store.get('host.pending-runs', bad!), undefined); held(f);
  f.requests[0]!.release.resolve(); await turn(); assert.equal(observation.done, false); held(f);
  f.requests[1]!.release.resolve(); const error = await observation.result;
  assert.ok(error instanceof AggregateError); assert.equal(error.errors.length, 1); assert.equal(error.errors[0].message, 'review-one-run-write'); assert.equal(error.errors[0].code, 'ERR_SQLITE_ERROR');
  assert.strictEqual(f.app.store, store); assert.strictEqual(f.app.lease, lease); assert.deepEqual(store.get('allocations', 'operating-envelope:v1'), grant);
  assert.deepEqual(store.list<{ request: { status: string } }>('requests').map(row => row.value.request.status), ['uncertain', 'uncertain']);
  f.fault('DROP TRIGGER review_fault'); assert.strictEqual(f.app.close(), closing); assert.strictEqual(await f.app.close().catch(value => value), error);
  await f.app.tick(); assert.equal(f.requests.length, 2); assert.equal(store.get('host.pending-runs', bad!), undefined); held(f);
});

for (const releaseFirst of ['ordinary', 'initiative'] as const) test(`close drains actual ordinary and initiative work with ${releaseFirst} settling first`, { timeout: 10000 }, async t => {
  const f = fixture(t), ordinary = await f.begin('ordinary');
  const goal = f.app.goals.propose({ id: 'shutdown-inquiry', origin: { kind: 'self' }, purpose: 'Finite independent shutdown probe', scope: { kind: 'public' }, successCriteria: ['Retain interrupted work'], evidenceIds: [], dependencyIds: [], resources: f.config.scheduler.resources, priority: 1, nextAction: 'Inspect the test observation', reviewAt: new Date(Date.now() + 60000).toISOString() }, { sourceIds: ['review-observation'], actorId: f.authority.generation, recordedAt: new Date().toISOString(), derivation: 'interpreted' });
  f.app.goals.accept(goal.id, goal.revision, 'Finite review fixture.'); await f.app.tick(); await f.waitFor(() => f.requests.length === 2);
  const initiative = f.app.store.get<{ runId: string }>('initiative.execution', goal.id)!.value.runId;
  assert.equal(f.app.runtime.getRun(initiative)!.status, 'running');
  const closing = f.app.close(), observation = observed(closing); await Promise.all(f.requests.map(request => request.aborted.promise));
  assert.ok(f.app.store.get('host.pending-runs', ordinary.id)); assert.equal(f.app.store.get('host.pending-runs', initiative), undefined);
  const index = releaseFirst === 'ordinary' ? 0 : 1;
  f.requests[index]!.release.resolve(); await f.waitFor(() => f.app.runtime.getRun(index === 0 ? ordinary.id : initiative)!.status !== 'running'); await turn();
  assert.equal(observation.done, false); held(f); f.requests[1 - index]!.release.resolve(); assert.equal(await observation.result, undefined);
  const reopened = new OperationalStore({ filename: join(f.config.stateDirectory, 'operational.sqlite') });
  try {
    assert.deepEqual(reopened.list<{ request: { status: string } }>('requests').map(row => row.value.request.status), ['uncertain', 'uncertain']);
    const persistedGoal = reopened.get<{ status: string }>('initiative.goals', goal.id);
    assert.ok(persistedGoal); assert.notEqual(persistedGoal.value.status, 'running'); assert.ok(reopened.get('initiative.execution', goal.id));
  }
  finally { reopened.close(); }
});

for (const directMode of ['callback', 'throw'] as const) test(`Slack and direct ${directMode} stop failures retain both causes and ownership after actual drain`, { timeout: 10000 }, async t => {
  const f = fixture(t, { slack: true }); await f.begin('ingress-failure');
  const slackError = new Error('review-slack-stop'), directError = new Error('review-direct-stop'); let slackCalls = 0, directCalls = 0;
  f.app.slackSocket!.stop = async () => { slackCalls++; throw slackError; };
  Object.defineProperty(f.app.directApi, 'listening', { configurable: true, value: true });
  f.app.directApi.close = callback => { directCalls++; if (directMode === 'throw') throw directError; callback!(directError); return f.app.directApi; };
  const closing = f.app.close(), observation = observed(closing); await f.requests[0]!.aborted.promise; await turn();
  assert.equal(observation.done, false); held(f); f.requests[0]!.release.resolve(); const error = await observation.result;
  assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [slackError, directError]); held(f);
  assert.strictEqual(await f.app.close().catch(value => value), error); assert.equal(slackCalls, 1); assert.equal(directCalls, 1);
});

test('Store-close callback reentry shares its rejection and leaves the caller-owned lease untouched', async t => {
  const f = fixture(t, { externalLease: true }), failure = new Error('review-store-close'); let reentered: Promise<void> | undefined, calls = 0, leaseCalls = 0;
  f.app.store.close = () => { calls++; reentered = f.app.close(); throw failure; };
  f.app.lease.close = () => { leaseCalls++; };
  const closing = f.app.close(); assert.strictEqual(await closing.catch(value => value), failure);
  assert.strictEqual(reentered, closing); assert.strictEqual(f.app.close(), closing); assert.equal(calls, 1); assert.equal(leaseCalls, 0); held(f);
});
