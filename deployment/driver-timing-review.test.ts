import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import type { ArtifactRef, JsonValue, PhysicalRequest, ShellBridge, ShellInput } from '../packages/contracts/index.ts';
import { ResourceLedger } from '../packages/runtime/resources/index.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { createBrokerShell, type BrokerShellOptions, type BrokerTiming, type TransportReceipt } from './broker-shell.ts';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const model = 'independent-timing-review';
const payload = JSON.stringify({ model, messages: [{ role: 'system', content: '' }], stream: false, max_tokens: 19 });
const response = { status: 200, body: JSON.stringify({ model, usage: { prompt_tokens: 11, completion_tokens: 3 } }) };
const input: ShellInput = { run: { id: 'review-run', revision: 1, status: 'running', authority: { generation: 'review', epoch: 1, controlRevision: 'review' }, scope: { kind: 'public' } }, messages: [], prompt: { id: 'base', requestDigest: digest('base'), fragments: [] } };
const manifest = { id: 'review-prompt', requestDigest: digest(payload), fragments: [{ id: 'shell.tools', owner: 'tool', role: 'tool', order: 0, artifact: { uri: `aeon:artifact:${digest('[]')}`, sha256: digest('[]') }, scope: input.run.scope, replaceable: true, derivedFrom: [] }] };
const request: PhysicalRequest = { id: 'review-request', reservationId: 'review-request', runId: input.run.id, purpose: 'reasoning', provider: 'mistral', model, promptManifestId: manifest.id, requestDigest: manifest.requestDigest, status: 'reserved', usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 } };
const workerLoss = Error('independent synthetic worker loss');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}

/** Independent protocol driver: no Pi mock, module replacement or ambient clock patch. */
function fixture(t: TestContext, timing: BrokerTiming, transport: BrokerShellOptions['performRequest'] = async () => response,
  workerMode: 'await' | 'lost' | 'early-completion' = 'await') {
  const directory = mkdtempSync(join(tmpdir(), 'aeon-independent-timing-'));
  const store = new OperationalStore({ filename: join(directory, 'review.sqlite') });
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const ledger = new ResourceLedger(store, { tokens: 10000, costUsd: 1, elapsedMs: 5000 }, () => 700);
  const envelope = { maxRequests: 2, maxTokens: 20000, maxCostUsd: 2, maxElapsedMs: 20000, maxConcurrency: 1 };
  ledger.allocate('original-root', envelope); ledger.allocate(input.run.id, envelope, 'original-root');
  const worker = new AbortController();
  const exited = deferred<void>(), entered = deferred<AbortSignal>();
  let authorized = true, transportCalls = 0, settleCalls = 0, authorityCalls = 0;
  let fetchError: unknown, reserved!: PhysicalRequest, initial!: JsonValue;
  let rpc!: (method: string, ...args: unknown[]) => Promise<JsonValue>;
  const impossible = async (): Promise<never> => { throw Error('unexpected review effect'); };
  const bridge: ShellBridge = { execute: impossible, persistCheckpoint: impossible, readCheckpoint: impossible,
    async capturePrompt(captured, actual) { assert.deepEqual(captured, manifest); assert.equal(actual, payload); },
    async reserve(value) { reserved = structuredClone(value); ledger.reserve(value); },
    async dispatched(value) { ledger.dispatched(value); },
    async settle(value) { settleCalls++; ledger.settle(value); } };
  const options: BrokerShellOptions = {
    applicationRoot: directory, entrypoint: 'unused.ts', workspace: () => directory, protectedPaths: [], nodeBinary: 'never-executed',
    timeoutMs: 5000, maxPayloadBytes: 65536, pricesPerMillion: { input: 2, output: 3 }, brokerTiming: timing,
    worker: { model, maxRequests: 1, timeoutMs: 5000, maxOutputTokens: 19, tools: [] },
    assertAuthority() { authorityCalls++; assert.ok(authorized, 'review authority withdrawn'); },
    retainToolInstructions: text => store.putArtifact(text), resolveFragment: async fragment => Buffer.from(store.readArtifact(fragment.artifact)).toString(),
    async performRequest(body, signal) { transportCalls++; assert.equal(body, payload); entered.resolve(signal); return transport(body, signal); },
    recordResponse(id, raw) { store.put('review.raw', id, { ref: store.putArtifact(raw.body) }, null); },
    recordTransport(receipt) { const prior = store.get('review.receipts', receipt.requestId); store.put('review.receipts', receipt.requestId, structuredClone(receipt), prior?.revision ?? null); },
    async runWorker(call) {
      initial = call.initial;
      rpc = (method, ...args) => call.handle(method, args as JsonValue[], worker.signal);
      await rpc('capturePrompt', manifest, payload); await rpc('reserve', request); await rpc('dispatched', { ...request, status: 'dispatched' });
      // Convert rejection to data immediately; detached worker exit cannot cause an unhandled promise.
      const fetch = rpc('provider.fetch', payload).catch(error => { fetchError = error; return null; });
      if (workerMode !== 'await') { exited.resolve(); if (workerMode === 'lost') throw workerLoss; return { status: 'completed', observations: [] }; }
      await fetch;
      // Deliberately dishonest advice, after cancellation too: only host receipt is authoritative.
      await rpc('settle', { ...request, status: 'failed', usage: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } });
      exited.resolve();
      return { status: fetchError ? 'blocked' : 'completed', observations: [] };
    },
  };
  const shell = createBrokerShell(options);
  return { store, ledger, options, entered: entered.promise, exited: exited.promise,
    run: () => shell.run(input, bridge, worker.signal),
    state: () => ({ transportCalls, settleCalls, authorityCalls, fetchError, reserved, initial }),
    receipt: () => store.get<TransportReceipt>('review.receipts', request.id)!.value,
    abort: () => worker.abort(Error('review cancellation')),
    withdraw: () => { authorized = false; ledger.cancel('original-root'); },
    rpc: (method: string, ...args: unknown[]) => rpc(method, ...args),
  };
}

function assertUnknown(f: ReturnType<typeof fixture>) {
  const state = f.state(), snapshot = f.ledger.snapshot('original-root');
  assert.equal(state.settleCalls, 1); assert.equal(snapshot.requests, 1); assert.equal(snapshot.concurrent, 1);
  assert.equal(f.receipt().status, 'uncertain'); assert.equal(f.receipt().usage.inputTokens, null); assert.equal(f.receipt().usage.outputTokens, null); assert.equal(f.receipt().usage.costUsd, null);
  assert.equal(snapshot.tokens, state.reserved.usage.inputTokens! + 19); assert.equal(snapshot.costUsd, state.reserved.usage.costUsd); assert.equal(snapshot.elapsedMs, 5000);
}
function assertRaw(f: ReturnType<typeof fixture>) {
  const row = f.store.get<{ ref: ArtifactRef }>('review.raw', request.id)!;
  assert.equal(Buffer.from(f.store.readArtifact(row.value.ref)).toString(), response.body);
  assert.equal(f.receipt().responseDigest, digest(response.body));
}

test('review: initial clock throw consumes dispatch without constructing timeout or entering transport', async t => {
  const failure = Error('initial clock unavailable'); let timeoutCalls = 0;
  const f = fixture(t, { monotonicNow: () => { throw failure; }, timeoutSignal: () => { timeoutCalls++; return new AbortController().signal; } });
  assert.equal((await f.run()).status, 'blocked'); assert.equal(f.state().fetchError, failure);
  assert.equal(timeoutCalls, 0); assert.equal(f.state().transportCalls, 0); assertUnknown(f);
  assert.equal(f.store.get('review.raw', request.id), undefined);
  await assert.rejects(f.rpc('provider.fetch', payload), /unused dispatched reservation/);
});

test('review: throwing timeout factory cannot enter transport or refund the dispatched reservation', async t => {
  const failure = Error('timeout factory unavailable'); let reads = 0; const requested: number[] = [];
  const f = fixture(t, { monotonicNow: () => { reads++; return 50; }, timeoutSignal: ms => { requested.push(ms); throw failure; } });
  assert.equal((await f.run()).status, 'blocked'); assert.equal(f.state().fetchError, failure);
  assert.deepEqual(requested, [5000]); assert.equal(reads, 2); assert.equal(f.state().transportCalls, 0); assertUnknown(f);
});

for (const completion of [Infinity, -1]) test(`review: invalid completion reading ${completion} preserves exact response bytes and unknown charges`, async t => {
  let reads = 0;
  const f = fixture(t, { monotonicNow: () => ++reads === 1 ? 0 : completion, timeoutSignal: () => new AbortController().signal });
  assert.equal((await f.run()).status, 'blocked'); assert.match(String(f.state().fetchError), /Host monotonic timing unavailable/);
  assertRaw(f); assertUnknown(f); assert.equal(f.ledger.snapshot('original-root').cancelled, false);
});

for (const mode of ['lost', 'early-completion'] as const) test(`review: ${mode} worker drains pending authentic response before returning`, async t => {
  const gate = deferred<typeof response>(); let tick = 100;
  const f = fixture(t, { monotonicNow: () => tick, timeoutSignal: () => new AbortController().signal }, async () => gate.promise, mode);
  let done = false;
  const result = f.run().then(value => ({ value, error: undefined }), error => ({ value: undefined, error })).finally(() => { done = true; });
  await f.entered; await f.exited; await Promise.resolve();
  assert.equal(done, false); assert.equal(f.state().settleCalls, 0); assert.equal(f.ledger.request(request.id)?.status, 'dispatched');
  assert.equal(f.ledger.snapshot('original-root').elapsedMs, 5000);
  await assert.rejects(f.rpc('settle', request), /still in flight/);
  f.abort(); f.withdraw(); tick = 137; gate.resolve(response);
  const outcome = await result;
  if (mode === 'lost') assert.equal(outcome.error, workerLoss); else assert.equal(outcome.value?.status, 'completed');
  assertRaw(f); assert.equal(f.state().transportCalls, 1); assert.equal(f.state().settleCalls, 1);
  assert.equal(f.ledger.request(request.id)?.status, 'succeeded');
  const snapshot = f.ledger.snapshot('original-root'); assert.equal(snapshot.cancelled, true); assert.equal(snapshot.tokens, 14); assert.equal(snapshot.elapsedMs, 37); assert.equal(snapshot.concurrent, 0);
  const calls = f.state().authorityCalls;
  await f.rpc('settle', { ...request, status: 'failed' }); assert.equal(f.state().authorityCalls, calls); assert.equal(f.state().settleCalls, 1);
  await assert.rejects(f.rpc('provider.fetch', payload), /authority withdrawn/);
});

test('review: worker loss plus completion clock throw retains raw bytes and full original charges', async t => {
  const gate = deferred<typeof response>(); let reads = 0;
  const f = fixture(t, { monotonicNow: () => { if (++reads === 1) return 80; throw Error('clock lost after response'); }, timeoutSignal: () => new AbortController().signal }, async () => gate.promise, 'lost');
  const result = f.run().catch(error => error);
  await f.entered; await f.exited; gate.resolve(response);
  assert.equal(await result, workerLoss); assert.match(String(f.state().fetchError), /Host monotonic timing unavailable/);
  assertRaw(f); assertUnknown(f); assert.equal(f.state().transportCalls, 1);
});

for (const origin of ['timeout', 'worker'] as const) test(`review: ${origin} abort racing an acquired response preserves authentic measured settlement`, async t => {
  const gate = deferred<typeof response>(), timeout = new AbortController(); let tick = 0;
  const f = fixture(t, { monotonicNow: () => tick, timeoutSignal: () => timeout.signal }, async () => gate.promise);
  const result = f.run(); const bounded = await f.entered;
  if (origin === 'timeout') timeout.abort(Error('review timeout')); else f.abort();
  assert.equal(bounded.aborted, true); tick = 4999; gate.resolve(response);
  assert.equal((await result).status, 'completed'); assertRaw(f);
  assert.equal(f.ledger.request(request.id)?.status, 'succeeded'); assert.equal(f.state().settleCalls, 1);
  assert.deepEqual(f.ledger.snapshot('original-root'), { requests: 1, tokens: 14, costUsd: 0.000031, elapsedMs: 4999, concurrent: 0, cancelled: false });
});

test('review: captured host adapters are absent from worker initialization and original-root overrun remains enforced', async t => {
  let tick = 0, timeoutCalls = 0;
  const timing = { monotonicNow: () => tick, timeoutSignal: (ms: number) => { timeoutCalls++; assert.equal(ms, 5000); return new AbortController().signal; } };
  const f = fixture(t, timing, async () => { tick = 5001; return response; });
  const poison = () => { throw Error('mutated host callback'); };
  timing.monotonicNow = poison; timing.timeoutSignal = poison; f.options.runWorker = async () => poison();
  assert.equal((await f.run()).status, 'completed'); assert.equal(timeoutCalls, 1); assertRaw(f);
  const initial = f.state().initial as Record<string, JsonValue>;
  assert.deepEqual(Object.keys(initial).sort(), ['fragments', 'input', 'options']);
  const configuration = initial.options as Record<string, JsonValue>;
  assert.deepEqual(Object.keys(configuration).sort(), ['maxOutputTokens', 'maxRequests', 'model', 'timeoutMs', 'toolInstructions', 'tools']);
  assert.equal(f.ledger.snapshot('original-root').cancelled, true); assert.equal(f.ledger.snapshot('original-root').elapsedMs, 5001);
  assert.equal(f.ledger.request(request.id)?.usage.elapsedMs, 5001); assert.equal(f.state().settleCalls, 1);
});
