import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import type { JsonValue, PhysicalRequest, ShellBridge, ShellInput } from '../packages/contracts/index.ts';
import { ResourceLedger } from '../packages/runtime/resources/index.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { createBrokerShell, type BrokerShellOptions, type BrokerTiming, type TransportReceipt } from './broker-shell.ts';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const model = 'timing-fixture-v1';
const payload = JSON.stringify({ model, messages: [{ role: 'system', content: '' }], stream: false, max_tokens: 32 });
const raw = JSON.stringify({ model, usage: { prompt_tokens: 7, completion_tokens: 2 } });
const input: ShellInput = { run: { id: 'run', revision: 1, status: 'running', authority: { generation: 'fixture', epoch: 1, controlRevision: 'fixture' }, scope: { kind: 'public' } }, messages: [], prompt: { id: 'base', requestDigest: hash('base'), fragments: [] } };
const manifest = { id: 'captured', requestDigest: hash(payload), fragments: [{ id: 'shell.tools', owner: 'tool', role: 'tool', order: 0, artifact: { uri: `aeon:artifact:${hash('[]')}`, sha256: hash('[]') }, scope: input.run.scope, replaceable: true, derivedFrom: [] }] };
const request: PhysicalRequest = { id: 'request', reservationId: 'request', runId: 'run', purpose: 'reasoning', provider: 'mistral', model, promptManifestId: manifest.id, requestDigest: manifest.requestDigest, status: 'reserved', usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 } };

// Explicit controlled real storage, injected worker/transport/clocks; no timers,
// module mocks, physical workers or network calls are needed for these checks.
function fixture(t: TestContext, brokerTiming: BrokerTiming, performRequest?: BrokerShellOptions['performRequest']) {
  const root = mkdtempSync(join(tmpdir(), 'aeon-broker-timing-'));
  const store = new OperationalStore({ filename: join(root, 'state.sqlite') });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const ledger = new ResourceLedger(store, { tokens: 10000, costUsd: 1, elapsedMs: 5000 }, () => 1000);
  ledger.allocate('run', { maxRequests: 4, maxTokens: 100000, maxCostUsd: 2, maxElapsedMs: 60000, maxConcurrency: 2 });
  let calls = 0, settled = 0, caught: unknown;
  let reserved: PhysicalRequest | undefined;
  const refuse = async (): Promise<never> => { throw Error('Unexpected effect'); };
  const bridge: ShellBridge = { execute: refuse, persistCheckpoint: refuse, readCheckpoint: refuse, async capturePrompt() {},
    async reserve(r) { reserved = structuredClone(r); ledger.reserve(r); }, async dispatched(r) { ledger.dispatched(r); },
    async settle(r) { settled++; ledger.settle(r); } };
  const options: BrokerShellOptions = { applicationRoot: root, entrypoint: 'unused.js', workspace: () => root, protectedPaths: [], nodeBinary: 'unused', timeoutMs: 5000,
    maxPayloadBytes: 65536, pricesPerMillion: { input: 1, output: 2 }, worker: { model, maxRequests: 1, timeoutMs: 5000, maxOutputTokens: 32, tools: [] }, brokerTiming,
    retainToolInstructions: source => store.putArtifact(source), resolveFragment: async fragment => Buffer.from(store.readArtifact(fragment.artifact)).toString(), assertAuthority() {},
    performRequest: async (body, signal) => { calls++; assert.equal(body, payload); return performRequest ? performRequest(body, signal) : { status: 200, body: raw }; },
    recordResponse(id, response) { store.put('raw', id, { ref: store.putArtifact(response.body) }, null); },
    recordTransport(receipt) { store.put('receipts', receipt.requestId, structuredClone(receipt), store.get('receipts', receipt.requestId)?.revision ?? null); },
    async runWorker(options) {
      assert.equal(JSON.stringify(options.initial).includes('brokerTiming'), false);
      const rpc = (method: string, ...args: unknown[]) => options.handle(method, args as JsonValue[], new AbortController().signal);
      await rpc('capturePrompt', manifest, payload); await rpc('reserve', request); await rpc('dispatched', { ...request, status: 'dispatched' });
      try { await rpc('provider.fetch', payload); } catch (error) { caught = error; }
      await rpc('settle', { ...request, status: 'succeeded' });
      await assert.rejects(rpc('provider.fetch', payload), /unused dispatched reservation/);
      return { status: caught ? 'blocked' : 'completed', observations: [] };
    } };
  const shell = createBrokerShell(options);
  return { options, ledger, store, run: () => shell.run(input, bridge), receipt: () => store.get<TransportReceipt>('receipts', 'request')!.value,
    state: () => ({ calls, settled, caught, reserved: reserved! }) };
}

test('injected clock measures usage and captured callback identities resist caller replacement', async t => {
  let tick = 10; const timeouts: number[] = [];
  const timing: BrokerTiming = { monotonicNow: () => { const result = tick; tick += 75; return result; }, timeoutSignal: ms => { timeouts.push(ms); return new AbortController().signal; } };
  const f = fixture(t, timing);
  timing.monotonicNow = () => { throw Error('replaced clock'); };
  timing.timeoutSignal = () => { throw Error('replaced timeout'); };
  f.options.runWorker = async () => { throw Error('replaced runner'); };
  assert.equal((await f.run()).status, 'completed');
  assert.deepEqual(timeouts, [5000]); assert.equal(f.receipt().usage.elapsedMs, 75);
  assert.equal(f.ledger.snapshot('run').elapsedMs, 75); assert.equal(f.ledger.snapshot('run').tokens, 9);
  assert.equal(f.state().calls, 1); assert.equal(f.state().settled, 1);
});

test('injected timeout abort reaches transport and retains the unknown reservation', async t => {
  const timeout = new AbortController(); let clock = 0;
  const f = fixture(t, { monotonicNow: () => clock, timeoutSignal: () => timeout.signal }, async (_body, signal) => {
    clock = 5000; timeout.abort(Error('synthetic timeout')); signal.throwIfAborted(); throw Error('unreachable');
  });
  assert.equal((await f.run()).status, 'blocked'); assert.match(String(f.state().caught), /synthetic timeout/);
  assert.equal(f.receipt().status, 'uncertain'); assert.equal(f.receipt().usage.elapsedMs, 5000);
  assert.equal(f.ledger.snapshot('run').elapsedMs, 5000); assert.equal(f.ledger.snapshot('run').concurrent, 1);
  assert.equal(f.ledger.snapshot('run').tokens, f.state().reserved.usage.inputTokens! + 32);
  assert.equal(f.state().settled, 1); assert.equal(f.store.get('raw', 'request'), undefined);
});

test('injected elapsed overrun still cancels the real ledger root budget', async t => {
  let clock = 0;
  const f = fixture(t, { monotonicNow: () => clock, timeoutSignal: () => new AbortController().signal }, async () => { clock = 5001; return { status: 200, body: raw }; });
  await f.run(); assert.equal(f.receipt().usage.elapsedMs, 5001);
  assert.equal(f.ledger.snapshot('run').cancelled, true); assert.equal(f.ledger.snapshot('run').elapsedMs, 5001);
  assert.equal(f.state().settled, 1);
});

for (const mode of ['throws', 'regresses', 'nan'] as const) test(`completion clock ${mode} preserves raw response and conservative unknown charges`, async t => {
  let calls = 0;
  const f = fixture(t, { monotonicNow: () => { if (++calls === 1) return 100; if (mode === 'throws') throw Error('clock failed'); return mode === 'regresses' ? 99 : NaN; }, timeoutSignal: () => new AbortController().signal });
  assert.equal((await f.run()).status, 'blocked'); assert.match(String(f.state().caught), /Host monotonic timing unavailable/);
  const receipt = f.receipt(); assert.equal(receipt.status, 'uncertain'); assert.equal(receipt.responseDigest, hash(raw));
  assert.equal(receipt.usage.elapsedMs, 5000); assert.equal(receipt.usage.inputTokens, null); assert.equal(receipt.usage.costUsd, null);
  const retained = f.store.get<{ ref: import('../packages/contracts/index.ts').ArtifactRef }>('raw', 'request')!;
  assert.equal(Buffer.from(f.store.readArtifact(retained.value.ref)).toString(), raw);
  const snapshot = f.ledger.snapshot('run'); assert.equal(snapshot.elapsedMs, 5000); assert.equal(snapshot.cancelled, false);
  assert.equal(snapshot.tokens, f.state().reserved.usage.inputTokens! + 32); assert.equal(snapshot.costUsd, f.state().reserved.usage.costUsd);
  assert.equal(snapshot.concurrent, 1); assert.equal(f.state().settled, 1);
});

for (const reading of [-1, Infinity, NaN]) test(`invalid initial clock ${reading} prevents transport and settles uncertainty`, async t => {
  const f = fixture(t, { monotonicNow: () => reading, timeoutSignal: () => { throw Error('must not construct timeout'); } });
  assert.equal((await f.run()).status, 'blocked'); assert.match(String(f.state().caught), /Invalid host monotonic time/);
  assert.equal(f.state().calls, 0); assert.equal(f.state().settled, 1);
  assert.equal(f.receipt().status, 'uncertain'); assert.equal(f.ledger.snapshot('run').elapsedMs, 5000);
});

test('already aborted injected timeout prevents physical entry', async t => {
  const f = fixture(t, { monotonicNow: () => 10, timeoutSignal: () => AbortSignal.abort(Error('already expired')) });
  assert.equal((await f.run()).status, 'blocked'); assert.match(String(f.state().caught), /already expired/);
  assert.equal(f.state().calls, 0); assert.equal(f.state().settled, 1);
  assert.equal(f.ledger.snapshot('run').elapsedMs, 5000);
});
