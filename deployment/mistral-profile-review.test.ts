import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { mock } from 'node:test';
import type { JsonValue, PhysicalRequest, ShellBridge, ShellInput } from '../packages/contracts/index.ts';
import { ResourceLedger } from '../packages/runtime/resources/index.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import type { WorkerOptions } from '../packages/supervisor/worker-process.ts';
import type { TransportReceipt } from './broker-shell.ts';

// Independent host-boundary review. Never launches a process or provider request.
const enabled = process.execArgv.includes('--experimental-test-module-mocks');
let worker: (options: WorkerOptions) => Promise<JsonValue> = async () => { throw Error('Missing review protocol'); };
if (enabled) mock.module('../packages/supervisor/worker-process.ts', { namedExports: {
  runWorker: (options: WorkerOptions) => worker(options),
} });
const { createBrokerShell } = await import('./broker-shell.ts');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const model = 'review-pinned-v1';
const instruction = 'Review owned instruction';
const payload = JSON.stringify({ model, messages: [{ role: 'system', content: instruction }], stream: false, max_tokens: 32 });
const input: ShellInput = {
  run: { id: 'review', revision: 1, status: 'running', authority: { generation: 'review', epoch: 1, controlRevision: 'review' }, scope: { kind: 'public' } },
  messages: [], prompt: { id: 'owned', requestDigest: digest(payload), fragments: [{ id: 'owned', role: 'system', owner: 'application', order: 0,
    replaceable: true, derivedFrom: [], scope: { kind: 'public' }, artifact: { uri: 'review:instruction', sha256: digest(instruction) } }] },
};
const manifest = { id: 'captured', requestDigest: digest(payload), fragments: [...input.prompt.fragments,
  { id: 'shell.tools', role: 'tool', owner: 'tool', order: 1, replaceable: true, derivedFrom: [], scope: input.run.scope,
    artifact: { uri: `shell:tools:${digest('[]')}`, sha256: digest('[]') } }] };
const request: PhysicalRequest = { id: 'attempt', reservationId: 'attempt', runId: 'review', purpose: 'reasoning', provider: 'mistral', model,
  promptManifestId: manifest.id, requestDigest: manifest.requestDigest, status: 'reserved',
  usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 } };

for (const scenario of [
  { label: 'wrong model after cancellation and forged settlement', responseModel: 'other-pinned-v1', tier: 'standard', exit: false },
  { label: 'priority tier after cancellation and forged settlement', responseModel: model, tier: 'priority', exit: false },
  { label: 'wrong model during worker loss', responseModel: 'other-pinned-v1', tier: 'standard', exit: true },
]) test(`Mistral independent review: ${scenario.label}`, { skip: !enabled }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'mistral-review-'));
  const filename = join(root, 'state.sqlite');
  let store = new OperationalStore({ filename });
  let ledger = new ResourceLedger(store, { tokens: 100_000, costUsd: 1, elapsedMs: 5000 }, () => 1000);
  // A roomy grant ensures replay rejection is identity enforcement, not exhaustion.
  ledger.allocate('review', { maxRequests: 8, maxTokens: 100_000, maxCostUsd: 1, maxElapsedMs: 60_000, maxConcurrency: 4 });
  let calls = 0; let workers = 0; let reserved: PhysicalRequest | undefined;
  const abort = new AbortController();
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const raw = JSON.stringify({ model: scenario.responseModel, usage: { prompt_tokens: 1, completion_tokens: 1, service_tier: scenario.tier },
    choices: [{ message: { role: 'assistant', content: 'Must not reach worker' } }] });
  const refuse = async (): Promise<never> => { throw Error('Unexpected bridge operation'); };
  const bridge: ShellBridge = { execute: refuse, persistCheckpoint: refuse, readCheckpoint: refuse, async capturePrompt() {},
    async reserve(r) { ledger.reserve(r); reserved = structuredClone(r); }, async dispatched(r) { ledger.dispatched(r); }, async settle(r) { ledger.settle(r); } };
  const shell = createBrokerShell({ applicationRoot: root, entrypoint: 'unused.js', workspace: () => root, protectedPaths: [], nodeBinary: process.execPath,
    timeoutMs: 5000, maxPayloadBytes: 65536, pricesPerMillion: { input: 1, output: 2 },
    worker: { model, maxRequests: 8, maxOutputTokens: 32, timeoutMs: 5000, tools: [] },
    async resolveFragment() { return instruction; }, assertAuthority() {},
    async performRequest(sent) { assert.equal(sent, payload); calls++; ready.resolve(); await release.promise; return { status: 200, body: raw }; },
    recordTransport(receipt) { store.put('review-receipts', receipt.requestId, structuredClone(receipt), store.get('review-receipts', receipt.requestId)?.revision ?? null); },
  });
  let pending: Promise<JsonValue> | undefined;
  let refusal: Promise<void> | undefined;
  worker = async options => {
    workers++;
    const rpc = (method: string, ...args: unknown[]) => options.handle(method, args as JsonValue[], abort.signal);
    const tierPayload = JSON.stringify({ ...JSON.parse(payload), service_tier: 'auto' });
    await assert.rejects(rpc('capturePrompt', { ...manifest, requestDigest: digest(tierPayload) }, tierPayload), /Unqualified provider option/);
    assert.equal(calls, 0);
    await rpc('capturePrompt', manifest, payload);
    await rpc('reserve', request);
    await rpc('dispatched', { ...request, status: 'dispatched' });
    pending = rpc('provider.fetch', payload);
    refusal = assert.rejects(pending, /Mistral response model|Unsupported Mistral served tier/);
    // Worker-loss branch checks this assertion after the host finally drains.
    void refusal.catch(() => {});
    await ready.promise;
    const forgery = { ...request, status: 'succeeded', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } };
    await assert.rejects(rpc('settle', forgery), /still in flight/);
    if (!scenario.exit) { abort.abort(); ledger.cancel('review'); }
    release.resolve();
    if (scenario.exit) throw Error('Review worker lost');
    await refusal;
    // The advisory settlement method is allowed after cancellation, but cannot
    // overwrite the host's durable unknown receipt with worker-supplied zeros.
    await rpc('settle', forgery);
    await assert.rejects(rpc('provider.fetch', payload));
    return { status: 'cancelled', observations: [] };
  };
  try {
    if (scenario.exit) await assert.rejects(shell.run(input, bridge), /Review worker lost/);
    else assert.equal((await shell.run(input, bridge)).status, 'cancelled');
    await refusal;
    await pending?.catch(() => {});
    assert.equal(workers, 1); assert.equal(calls, 1);
    const receipt = store.get<TransportReceipt>('review-receipts', 'attempt')!.value;
    assert.equal(receipt.status, 'uncertain'); assert.equal(receipt.responseModel, scenario.responseModel);
    assert.equal(receipt.responseServiceTier, scenario.tier); assert.equal(receipt.responseDigest, digest(raw));
    assert.equal(receipt.usage.inputTokens, null); assert.equal(receipt.usage.outputTokens, null); assert.equal(receipt.usage.costUsd, null);
    const snapshot = ledger.snapshot('review');
    assert.equal(snapshot.tokens, reserved!.usage.inputTokens! + reserved!.usage.outputTokens!);
    assert.equal(snapshot.costUsd, reserved!.usage.costUsd); assert.equal(snapshot.concurrent, 1);
    store.close(); store = new OperationalStore({ filename });
    ledger = new ResourceLedger(store, { tokens: 100_000, costUsd: 1, elapsedMs: 5000 }, () => 1000);
    ledger.recoverDispatched(); ledger.settle({ ...ledger.request('attempt')!, status: 'uncertain' });
    assert.deepEqual(store.get<TransportReceipt>('review-receipts', 'attempt')!.value, receipt);
    assert.deepEqual(ledger.snapshot('review'), snapshot);
    // Re-entering the broker after reopen still cannot dispatch the same identity.
    worker = async options => {
      const rpc = (method: string, ...args: unknown[]) => options.handle(method, args as JsonValue[], new AbortController().signal);
      await rpc('capturePrompt', manifest, payload);
      await assert.rejects(rpc('reserve', request), /identity already used/);
      await assert.rejects(rpc('provider.fetch', payload), /unused dispatched reservation/);
      return { status: 'blocked', observations: [] };
    };
    assert.equal((await shell.run(input, bridge)).status, 'blocked');
    ledger.cancel('review'); assert.deepEqual(ledger.snapshot('review'), { ...snapshot, cancelled: true });
    assert.deepEqual(store.get<TransportReceipt>('review-receipts', 'attempt')!.value, receipt);
    assert.equal(calls, 1);
  } finally { release.resolve(); store.close(); rmSync(root, { recursive: true, force: true }); }
});
