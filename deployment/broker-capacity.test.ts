import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createAgentShell, type ShellOptions } from '../packages/agent-shell/index.ts';
import { identity, type JsonValue, type PhysicalRequest, type ShellBridge, type ShellInput, type ResourceEnvelope } from '../packages/contracts/index.ts';
import { EffectJournal } from '../packages/effects/index.ts';
import { DurableRuntime, type CapacityWait } from '../packages/runtime/execution/index.ts';
import { ResourceLedger } from '../packages/runtime/resources/index.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { createBrokerShell, type TransportReceipt } from './broker-shell.ts';

const authority = { generation: 'capacity-fixture', epoch: 1, controlRevision: 'fixture' };
const prompt = { id: 'base', requestDigest: identity('base'), fragments: [] };
const model = 'capacity-fixture-v1';
const envelope: ResourceEnvelope = { maxRequests: 10, maxTokens: 100000, maxCostUsd: 10, maxElapsedMs: 60000, maxConcurrency: 1 };
const raw = JSON.stringify({ model, choices: [{ finish_reason: 'stop', message: { content: 'completed' } }], usage: { prompt_tokens: 7, completion_tokens: 2 } });
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;
function gate<T = void>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

// The real Pi/Mistral transport, broker RPC handler, durable runtime and ledger
// execute together. Only worker process, HTTP response and clocks are injected.
function fixture(t: TestContext, options: { maxRequests?: number; uncertain?: boolean } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'aeon-broker-capacity-'));
  const store = new OperationalStore({ filename: join(directory, 'state.sqlite') });
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const resources = new ResourceLedger(store, { tokens: 10000, costUsd: 1, elapsedMs: 5000 }, () => 0);
  resources.allocate('root', { ...envelope, maxRequests: options.maxRequests ?? envelope.maxRequests });
  const effects = new EffectJournal(store, { assert() {} }, { async dispatch() { throw Error('Unexpected effect'); }, async reconcile() { throw Error('Unexpected effect'); } }, () => 'unused');
  const firstEntered = gate(), releaseFirst = gate(), queued = gate<CapacityWait>();
  const physical: string[] = [], finished: string[] = [], reservations: PhysicalRequest[] = [];
  const workers = new Map<string, AbortController>();
  let sequence = 0;
  const broker = createBrokerShell({ applicationRoot: directory, entrypoint: 'unused.ts', workspace: () => directory, protectedPaths: [], nodeBinary: 'unused', timeoutMs: 12000,
    maxPayloadBytes: 65536, pricesPerMillion: { input: 1, output: 2 }, worker: { provider: 'mistral', model, maxRequests: 1, timeoutMs: 5000, maxOutputTokens: 32, tools: [] },
    brokerTiming: { monotonicNow: () => 0, timeoutSignal: () => new AbortController().signal },
    retainToolInstructions: source => store.putArtifact(source), resolveFragment: async fragment => Buffer.from(store.readArtifact(fragment.artifact)).toString(), assertAuthority() {},
    async performRequest(payload) {
      physical.push(payload);
      if (physical.length === 1) { firstEntered.resolve(); await releaseFirst.promise; if (options.uncertain) throw Error('fixture connection lost after dispatch'); }
      return { status: 200, body: raw };
    },
    recordTransport(receipt: TransportReceipt) { store.put('transport', receipt.requestId, structuredClone(receipt), store.get('transport', receipt.requestId)?.revision ?? null); },
    onTransportFinished(id) { finished.push(id); resources.releaseConcurrency(id, { kind: 'transport-terminal', reason: 'Fixture HTTP operation ended' }); },
    async runWorker(worker) {
      const start = worker.initial as unknown as { input: ShellInput; options: ShellOptions; fragments: Record<string, string> };
      const deadline = new AbortController(); workers.set(start.input.run.id, deadline);
      const signal = AbortSignal.any([worker.command.signal!, deadline.signal]);
      assert.equal(worker.command.timeoutMs, 12000);
      const rpc = (method: string, ...args: unknown[]) => worker.handle(method, json(args) as JsonValue[], signal);
      const bridge: ShellBridge = {
        execute: call => rpc('execute', call) as unknown as ReturnType<ShellBridge['execute']>,
        persistCheckpoint: (...args) => rpc('persistCheckpoint', ...args) as unknown as ReturnType<ShellBridge['persistCheckpoint']>,
        readCheckpoint: checkpoint => rpc('readCheckpoint', checkpoint),
        capturePrompt: async (manifest, payload) => { await rpc('capturePrompt', manifest, payload); },
        reserve: async request => { reservations.push(structuredClone(request)); await rpc('reserve', request); },
        dispatched: async request => { await rpc('dispatched', request); },
        settle: async receipt => { await rpc('settle', receipt); },
      };
      const shell = createAgentShell({ ...start.options, apiKey: () => 'fixture-host-owned',
        environment: { wallNow: () => 0, monotonicNow: () => 0, newId: () => `shell-${++sequence}`, scheduleTimeout: () => () => {} },
        resolveFragment: async fragment => start.fragments[fragment.artifact.sha256]!,
        fetch: async (_url, init) => { const response = await rpc('provider.fetch', String(init?.body)) as { status: number; body: string }; return new Response(response.body, { status: response.status }); },
      });
      return json(await shell.run(start.input, bridge, signal));
    },
  });
  const runtime = new DurableRuntime({ store, resources, effects, now: () => 0, elapsedNow: () => 0, newId: () => `runtime-${++sequence}`,
    shell: { run(input, bridge, signal) { return broker.run(input, { ...bridge, reserve(request, signal) {
      const pending = bridge.reserve(request, signal);
      const waiting = store.get<CapacityWait>('execution.capacity-waits', request.id)?.value;
      if (waiting) queued.resolve(waiting);
      return pending;
    } }, signal); } },
  });
  const admit = (name: string) => runtime.admit({ id: name, source: 'fixture', externalId: name, externalRevision: '1', actorId: 'fixture', authenticated: true, scope: { kind: 'public' }, value: name }, authority, envelope, 'root');
  return { store, resources, runtime, first: admit('first'), second: admit('second'), firstEntered, releaseFirst, queued, physical, finished, reservations, workers };
}

for (const uncertain of [false, true]) test(`Mistral broker queues the same request until the first transport ${uncertain ? 'ends uncertain' : 'succeeds'}`, async t => {
  const f = fixture(t, { uncertain });
  const first = f.runtime.resume(f.first.id, prompt); await f.firstEntered.promise;
  const second = f.runtime.resume(f.second.id, prompt); const waiting = await f.queued.promise;
  assert.equal(waiting.runId, f.second.id); assert.equal(waiting.phase, 'reserve');
  assert.equal(f.runtime.getRun(f.second.id)?.status, 'running');
  assert.equal(f.resources.request(waiting.requestId), undefined); assert.equal(f.physical.length, 1); assert.equal(f.finished.length, 0);
  f.releaseFirst.resolve();
  assert.equal((await first).status, uncertain ? 'blocked' : 'completed'); assert.equal((await second).status, 'completed');
  assert.equal(f.physical.length, 2); assert.equal(f.finished.length, 2); assert.equal(f.reservations.length, 2);
  assert.equal(new Set(f.reservations.map(request => request.id)).size, 2);
  assert.equal(f.resources.request(waiting.requestId)?.status, 'succeeded');
  assert.equal(f.resources.snapshot('root').requests, 2); assert.equal(f.resources.snapshot('root').concurrent, 0);
  assert.equal(f.store.list('execution.capacity-waits').length, 0);
  if (uncertain) {
    assert.equal(f.resources.request(f.finished[0]!)?.status, 'uncertain');
    assert.ok(f.resources.snapshot('root').tokens > 9);
  }
});

for (const boundary of ['runtime-cancel', 'worker-deadline']) test(`${boundary} removes a queued Mistral request without entering HTTP`, async t => {
  const f = fixture(t), first = f.runtime.resume(f.first.id, prompt); await f.firstEntered.promise;
  const second = f.runtime.resume(f.second.id, prompt); const waiting = await f.queued.promise;
  if (boundary === 'runtime-cancel') f.runtime.cancel(f.second.id, 'fixture', 'stop queued work');
  else f.workers.get(f.second.id)!.abort(Error('Worker deadline exceeded'));
  assert.equal((await second).status, boundary === 'runtime-cancel' ? 'cancelled' : 'waiting');
  assert.equal(f.store.list('execution.capacity-waits').length, 0); assert.equal(f.resources.request(waiting.requestId), undefined);
  assert.equal(f.physical.length, 1); assert.equal(f.finished.length, 0);
  f.releaseFirst.resolve(); await first;
  assert.equal(f.physical.length, 1); assert.equal(f.resources.snapshot('root').requests, 1);
});

test('permanent request exhaustion fails promptly even while physical capacity is full', async t => {
  const f = fixture(t, { maxRequests: 1 }), first = f.runtime.resume(f.first.id, prompt); await f.firstEntered.promise;
  assert.equal((await f.runtime.resume(f.second.id, prompt)).status, 'blocked');
  assert.equal(f.store.list('execution.capacity-waits').length, 0); assert.equal(f.physical.length, 1);
  f.releaseFirst.resolve(); await first; assert.equal(f.resources.snapshot('root').requests, 1);
});
