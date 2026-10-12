import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

function fixture(t: TestContext, options: { slack?: boolean; externalLease?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'aeon-shutdown-')), stateDirectory = join(root, 'state'), workspaceDirectory = join(root, 'workspace'); mkdirSync(stateDirectory); mkdirSync(workspaceDirectory);
  const promptFile = join(root, 'mind.txt'), compactionPromptFile = join(root, 'compact.txt'); writeFileSync(promptFile, 'Bounded shutdown fixture.'); writeFileSync(compactionPromptFile, 'Preserve unresolved work.');
  const resources = { maxRequests: 100, maxTokens: 10_000_000, maxCostUsd: 100, maxElapsedMs: 300_000, maxConcurrency: 8 };
  const config: ApplicationConfig = { stateDirectory, workspaceDirectory, applicationRoot: dirname(dirname(fileURLToPath(import.meta.url))), nodeBinary: process.execPath, workerEntrypoint: 'deployment/shell-worker.ts', artifactId: 'shutdown-fixture', controlRevision: 'fixture-controls', promptFile, compactionPromptFile,
    model: { id: 'mistral-fixture-v1', contextWindow: 128000, reasoning: false, effort: 'none', maxOutputTokens: 100, maxRequestsPerSlice: 4, timeoutMs: 10000, pricesPerMillion: { input: 1, output: 2 } }, resources, conversationResources: resources,
    bootstrapInitiative: false, scheduler: { windowMs: 60000, maxSlicesPerWindow: 8, maxLifetimeSlices: 32, quantumMs: 30000, idleRetryMs: 1000, maxStalls: 2, resources }, maxConcurrentRuns: 2, pollMs: 100, commands: [], researchHosts: [], direct: { host: '127.0.0.1', port: 0, actorId: 'operator', scope: { kind: 'public' }, modificationEligible: false },
    ...(options.slack ? { slack: { teamId: 'fixture-team', botUserId: 'fixture-bot', channels: [], eligibleHumanIds: [], coverageStart: '1.000000', lookbackSeconds: 10, allowSpeech: false } } : {}) };
  const authorityStore = new AuthorityStore(join(stateDirectory, 'authority.sqlite')), authority = authorityStore.bootstrap('fixture-instance', config.controlRevision, config.artifactId);
  const lease = options.externalLease ? new ProcessLease(join(stateDirectory, 'process-lease.sqlite')) : undefined;
  const entered = deferred(), aborted = deferred(), release = deferred(); let requests = 0;
  const api = { async call<T>(): Promise<T> { throw new Error('Shutdown fixture forbids Slack calls'); } };
  const app = new AutarkApplication({ config, authority, authorityStore, lease, secrets: { mistralApiKey: 'fixture', directToken: 'fixture' }, slackBotApi: api, slackAppApi: api, performRequest: async (_payload, signal) => {
    requests++; entered.resolve();
    if (signal.aborted) aborted.resolve(); else signal.addEventListener('abort', aborted.resolve, { once: true });
    await release.promise; signal.throwIfAborted(); throw new Error('Fixture requires shutdown before transport release');
  } });
  const put = app.store.put.bind(app.store), closeStore = app.store.close.bind(app.store), closeLease = app.lease.close.bind(app.lease), stopSlack = app.slackSocket?.stop.bind(app.slackSocket);
  t.after(async () => {
    app.store.put = put; app.store.close = closeStore; app.lease.close = closeLease; if (app.slackSocket && stopSlack) app.slackSocket.stop = stopSlack;
    release.resolve(); await app.close().catch(() => undefined); await turn();
    // Failure fixtures deliberately retain ownership; explicit host cleanup follows observed drain.
    try { closeStore(); } catch { /* Already closed on successful teardown. */ } closeLease(); authorityStore.close(); rmSync(root, { recursive: true, force: true });
  });
  const begin = async () => {
    const run = app.communications.receive({ source: 'direct', externalId: 'shutdown-input', revision: '1', conversation: 'shutdown', text: 'Hold until interrupted', actor: { id: 'operator', scope: { kind: 'public' }, modificationEligible: false } }).run;
    await entered.promise; assert.equal(app.runtime.getRun(run.id)!.status, 'running'); assert.equal(requests, 1); return run;
  };
  return { app, begin, aborted, release, config, closeStore, closeLease, get requests() { return requests; } };
}

test('concurrent close calls share completion until the actual interrupted transport drains', { timeout: 10000 }, async t => {
  const f = fixture(t), run = await f.begin(), allocation = f.app.store.get('allocations', 'operating-envelope:v1');
  const first = f.app.close(), second = f.app.close(); let secondDone = false; void second.then(() => { secondDone = true; });
  await f.aborted.promise; await turn(); assert.equal(secondDone, false, 'Concurrent close must not report quiescence before drain'); assert.strictEqual(first, second);
  f.release.resolve(); await first; await second; assert.throws(() => f.app.lease.assertHeld(), /closed/);
  const reopened = new OperationalStore({ filename: join(f.config.stateDirectory, 'operational.sqlite') });
  try { assert.deepEqual(reopened.get('allocations', 'operating-envelope:v1'), allocation); assert.ok(reopened.get('host.pending-runs', run.id)); assert.equal(reopened.list('requests').length, 1); assert.equal((reopened.list<any>('requests')[0]!.value.request).status, 'uncertain'); }
  finally { reopened.close(); }
  assert.equal(f.requests, 1);
});

for (const failure of ['pending-write', 'slack-stop'] as const) test(`${failure} failure still aborts and drains work, retaining the Store, lease and stable rejection`, { timeout: 10000 }, async t => {
  const f = fixture(t, { slack: failure === 'slack-stop' }), run = await f.begin(), injected = new Error(`injected-${failure}`);
  const grant = f.app.store.get('allocations', 'operating-envelope:v1');
  if (failure === 'pending-write') { const put = f.app.store.put.bind(f.app.store); f.app.store.put = ((namespace, ...args) => { if (namespace === 'host.pending-runs') throw injected; return (put as any)(namespace, ...args); }) as typeof f.app.store.put; }
  else f.app.slackSocket!.stop = async () => { throw injected; };
  const closing = f.app.close(); let completed = false; const result = closing.then(() => { completed = true; return undefined; }, error => { completed = true; return error; });
  await turn(); assert.equal(completed, false, 'Preparatory failure must still await active work');
  await f.aborted.promise; f.release.resolve(); const error = await result;
  assert.ok(error instanceof AggregateError); assert.ok(error.errors.includes(injected)); assert.strictEqual(f.app.close(), closing); assert.strictEqual(await f.app.close().catch(value => value), error);
  f.app.lease.assertHeld(); assert.deepEqual(f.app.store.get('allocations', 'operating-envelope:v1'), grant); assert.notEqual(f.app.runtime.getRun(run.id)!.status, 'running');
  assert.equal(f.app.store.list('requests').length, 1); assert.equal(f.app.store.list<any>('requests')[0]!.value.request.status, 'uncertain');
  assert.throws(() => new ProcessLease(join(f.config.stateDirectory, 'process-lease.sqlite')), /Another supervisor/); await f.app.tick(); assert.equal(f.requests, 1);
});

test('Store-close failure retains its owned lease and cannot turn a repeated close into success', async t => {
  const f = fixture(t), injected = new Error('injected-store-close'); let closes = 0;
  f.app.store.close = () => { closes++; throw injected; };
  const closing = f.app.close(); assert.strictEqual(await closing.catch(error => error), injected); assert.strictEqual(f.app.close(), closing); assert.strictEqual(await f.app.close().catch(error => error), injected);
  assert.equal(closes, 1); f.app.lease.assertHeld(); assert.ok(f.app.store.get('allocations', 'operating-envelope:v1'));
});

test('successful close leaves an externally supplied lease held by its owner', async t => {
  const f = fixture(t, { externalLease: true }); await f.app.close(); f.app.lease.assertHeld();
  assert.throws(() => f.app.store.list('runs'), /closed|not open/i); assert.strictEqual(f.app.close(), f.app.close());
});

test('owned lease-close failure remains the same failed completion without replay', async t => {
  const f = fixture(t), injected = new Error('injected-lease-close'); let closes = 0;
  f.app.lease.close = () => { closes++; throw injected; };
  const closing = f.app.close(); assert.strictEqual(await closing.catch(error => error), injected); assert.strictEqual(await f.app.close().catch(error => error), injected); assert.equal(closes, 1);
  assert.throws(() => f.app.store.list('runs'), /closed|not open/i); f.app.lease.assertHeld();
});
