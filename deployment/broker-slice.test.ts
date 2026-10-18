import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createAgentShell, physicalRequestSliceContinuation, SHELL_REVISION, type ShellOptions } from '../packages/agent-shell/index.ts';
import { identity, type JsonValue, type ShellBridge, type ShellInput, type ShellResult } from '../packages/contracts/index.ts';
import { EffectJournal } from '../packages/effects/index.ts';
import { DurableRuntime } from '../packages/runtime/execution/index.ts';
import { ResourceLedger } from '../packages/runtime/resources/index.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { createBrokerShell, type TransportReceipt } from './broker-shell.ts';

const model = 'slice-fixture-v1';
const authority = { generation: 'slice-fixture', epoch: 1, controlRevision: 'slice-controls' };
const prompt = { id: 'base', requestDigest: identity('base'), fragments: [] };
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;

// The real shell, broker, durable runtime, effect journal and ledger are joined.
// Worker process, transport, clocks and identifiers are explicitly supplied.
function fixture(t: TestContext, options: { totalRequests?: number; unknown?: boolean; forged?: 'without-dispatch' | 'unknown' | 'wrong-limit'; overrunWorker?: boolean; continueAfterSeal?: boolean } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'aeon-broker-slice-'));
  const store = new OperationalStore({ filename: join(directory, 'state.sqlite') });
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const resources = new ResourceLedger(store, { tokens: 100000, costUsd: 1, elapsedMs: 5000 }, () => 100);
  const envelope = { maxRequests: options.totalRequests ?? 10, maxTokens: 1000000, maxCostUsd: 10, maxElapsedMs: 60000, maxConcurrency: 2 };
  resources.allocate('root', envelope);
  let sequence = 0, inspections = 0;
  const calls: string[] = [], receipts: TransportReceipt[] = [], results: ShellResult[] = [];
  const effects = new EffectJournal(store, { assert() {} }, {
    async dispatch() { inspections++; return { outcome: 'succeeded', receipt: store.putJsonArtifact({ observed: 'retained inspection' }) }; },
    async reconcile() { throw Error('No unknown effect expected'); },
  }, () => `effect-event-${++sequence}`);
  const broker = createBrokerShell({ applicationRoot: directory, entrypoint: 'unused.ts', workspace: () => directory, protectedPaths: [], nodeBinary: 'unused', timeoutMs: 10000,
    maxPayloadBytes: 65536, pricesPerMillion: { input: 1, output: 2 },
    worker: { model, maxRequests: 1, timeoutMs: 5000, maxOutputTokens: 32, tools: [{ name: 'inspect', description: 'Inspect the retained fixture', parameters: { type: 'object', properties: {}, additionalProperties: false } }] },
    brokerTiming: { monotonicNow: () => 0, timeoutSignal: () => new AbortController().signal },
    retainToolInstructions: source => store.putArtifact(source), resolveFragment: async fragment => Buffer.from(store.readArtifact(fragment.artifact)).toString(), assertAuthority() {},
    async performRequest(payload) {
      calls.push(payload);
      if (options.unknown || options.forged === 'unknown') throw Error('Connection lost after physical dispatch');
      const first = calls.length === 1;
      if (!first) assert.match(payload, /retained inspection/);
      return { status: 200, body: JSON.stringify({ model, usage: { prompt_tokens: 7, completion_tokens: 2 }, choices: [{ finish_reason: first ? 'tool_calls' : 'stop', message: first
        ? { content: null, tool_calls: [{ id: 'inspect01', type: 'function', function: { name: 'inspect', arguments: '{}' } }] }
        : { content: 'The completed inspection is retained.' } }] }) };
    },
    recordTransport(receipt) { receipts.push(structuredClone(receipt)); },
    onTransportFinished(requestId) { resources.releaseConcurrency(requestId, { kind: 'transport-terminal', reason: 'Injected HTTP operation ended' }); },
    async runWorker(worker) {
      const start = worker.initial as unknown as { input: ShellInput; options: ShellOptions; fragments: Record<string, string> };
      const signal = worker.command.signal ?? new AbortController().signal;
      const rpc = (method: string, ...args: unknown[]) => worker.handle(method, json(args) as JsonValue[], signal);
      const bridge: ShellBridge = {
        execute: call => rpc('execute', call) as unknown as ReturnType<ShellBridge['execute']>,
        persistCheckpoint: (runId, revision, shell, content) => {
          const continuation = physicalRequestSliceContinuation(content);
          const supplied = options.forged === 'wrong-limit' && continuation
            ? json({ ...(content as Record<string, JsonValue>), continuation: { ...continuation, physicalRequests: 2, maxRequests: 2 } }) : content;
          return rpc('persistCheckpoint', runId, revision, shell, supplied) as unknown as ReturnType<ShellBridge['persistCheckpoint']>;
        },
        readCheckpoint: checkpoint => rpc('readCheckpoint', checkpoint),
        capturePrompt: async (manifest, payload) => { await rpc('capturePrompt', manifest, payload); },
        reserve: async request => { await rpc('reserve', request); },
        dispatched: async request => { await rpc('dispatched', request); },
        settle: async receipt => { await rpc('settle', receipt); },
      };
      const shell = createAgentShell({ ...start.options, ...(options.overrunWorker ? { maxRequests: 2 } : {}), apiKey: () => 'fixture-host-owned',
        environment: { wallNow: () => 0, monotonicNow: () => 0, newId: () => `shell-${++sequence}`, scheduleTimeout: () => () => {} },
        resolveFragment: async fragment => start.fragments[fragment.artifact.sha256]!,
        fetch: async (_url, init) => { const response = await rpc('provider.fetch', String(init?.body)) as { status: number; body: string }; return new Response(response.body, { status: response.status }); },
      });
      let result: ShellResult = options.forged === 'without-dispatch' ? { status: 'blocked', observations: [] } : await shell.run(start.input, bridge, signal);
      if (options.continueAfterSeal && result.status === 'checkpointed') {
        await assert.rejects(rpc('execute', { id: 'invented', runId: start.input.run.id, stepId: 'invented', name: 'inspect', arguments: {} }), /continued after its checkpointed slice/);
      }
      if (options.forged && options.forged !== 'wrong-limit') {
        const prior = result.checkpoint ? await bridge.readCheckpoint(result.checkpoint) : { schema: SHELL_REVISION, observationIds: [], messages: [], compactions: [] };
        const content: Record<string, JsonValue> = { ...(prior as Record<string, JsonValue>), status: 'checkpointed', continuation: { kind: 'physical-request-slice', physicalRequests: 1, maxRequests: 1, nextPurpose: 'reasoning' } };
        delete content.failure;
        result = { ...result, status: 'checkpointed', checkpoint: await bridge.persistCheckpoint(start.input.run.id, start.input.run.revision, SHELL_REVISION, json(content)) };
      }
      return json(result);
    },
  });
  const runtime = new DurableRuntime({ store, resources, effects, now: () => 100, elapsedNow: () => 0, newId: () => `runtime-${++sequence}`,
    shell: { async run(input, bridge, signal) { const result = await broker.run(input, bridge, signal); results.push(result); return result; } },
  });
  const run = runtime.admit({ id: 'input', source: 'fixture', externalId: 'input', externalRevision: '1', actorId: 'fixture', authenticated: true, scope: { kind: 'public' }, value: 'Inspect then report.' }, authority, envelope, 'root');
  return { store, resources, runtime, run, calls, receipts, results, inspections: () => inspections,
    async checkpoint() { const execution = store.get<{ checkpoint?: { artifact: { sha256: string; uri: string } } }>('execution', run.id)?.value; return execution?.checkpoint ? store.readJsonArtifact(execution.checkpoint.artifact) : null; } };
}

test('broker validates a slice and durable resume retains the original overall allocation and completed observation', async t => {
  const f = fixture(t);
  const allocation = structuredClone(f.store.get('allocations', f.run.id)!.value);
  assert.equal((await f.runtime.resume(f.run.id, prompt)).status, 'waiting');
  assert.equal(f.results[0].status, 'checkpointed'); assert.equal(f.calls.length, 1); assert.equal(f.inspections(), 1);
  assert.deepEqual(physicalRequestSliceContinuation(await f.checkpoint()), { kind: 'physical-request-slice', physicalRequests: 1, maxRequests: 1, nextPurpose: 'reasoning' });
  const requests = f.store.list('requests'); const observations = f.runtime.observations(f.run.id);
  assert.equal((await f.runtime.resume(f.run.id, prompt)).status, 'completed');
  assert.equal(f.calls.length, 2); assert.equal(f.inspections(), 1); assert.deepEqual(f.runtime.observations(f.run.id), observations);
  for (const { key, ...row } of requests) assert.deepEqual(f.store.get('requests', key), row);
  assert.deepEqual(f.store.get('allocations', f.run.id)!.value, allocation);
  assert.equal(f.resources.snapshot('root').requests, 3); assert.equal(f.resources.snapshot('root').concurrent, 0);
});

test('a resumed slice still fails the unchanged overall request allowance before another physical dispatch', async t => {
  const f = fixture(t, { totalRequests: 2 });
  assert.equal((await f.runtime.resume(f.run.id, prompt)).status, 'waiting');
  const requests = f.store.list('requests');
  assert.equal((await f.runtime.resume(f.run.id, prompt)).status, 'blocked');
  assert.equal(f.calls.length, 1); assert.equal(f.inspections(), 1); assert.deepEqual(f.store.list('requests'), requests);
  assert.equal(physicalRequestSliceContinuation(await f.checkpoint()), undefined);
});

test('an unknown physical response is blocked and retains unknown accounting even though its local slot is released', async t => {
  const f = fixture(t, { unknown: true });
  assert.equal((await f.runtime.resume(f.run.id, prompt)).status, 'blocked');
  assert.equal(f.calls.length, 1); assert.equal(f.inspections(), 0); assert.equal(physicalRequestSliceContinuation(await f.checkpoint()), undefined);
  assert.equal(f.resources.snapshot('root').concurrent, 0);
  assert.equal(f.store.list<{ request: { status: string } }>('requests')[0].value.request.status, 'uncertain');
  assert.ok(f.resources.snapshot('root').tokens > 0);
});

for (const forged of ['without-dispatch', 'unknown', 'wrong-limit'] as const) test(`host rejects worker slice forgery: ${forged}`, async t => {
  const f = fixture(t, { forged });
  assert.equal((await f.runtime.resume(f.run.id, prompt)).status, 'waiting');
  assert.equal(f.results.length, 0, 'No trusted resumable result is returned by the broker');
  assert.equal(f.calls.length, forged === 'without-dispatch' ? 0 : 1);
  assert.match(f.store.get<{ failure: string }>('execution', f.run.id)!.value.failure, /slice/);
  // Runtime interruption is waiting; it is not an accepted checkpointed result.
  // The host must not leave a forged marker for a scheduler to mistake for one.
  assert.equal(physicalRequestSliceContinuation(await f.checkpoint()), undefined);
});

test('host ceiling rejects a worker overrun before a second request is reserved or dispatched', async t => {
  const f = fixture(t, { overrunWorker: true });
  assert.equal((await f.runtime.resume(f.run.id, prompt)).status, 'blocked');
  assert.equal(f.calls.length, 1); assert.equal(f.receipts.filter(r => r.status === 'succeeded').length, 1);
  assert.equal(f.store.list<{ request: { provider: string } }>('requests').filter(row => row.value.request.provider === 'mistral').length, 1);
});

test('a sealed slice cannot execute another tool before returning its result', async t => {
  const f = fixture(t, { continueAfterSeal: true });
  assert.equal((await f.runtime.resume(f.run.id, prompt)).status, 'waiting');
  assert.equal(f.results[0].status, 'checkpointed'); assert.equal(f.inspections(), 1); assert.equal(f.calls.length, 1);
});
