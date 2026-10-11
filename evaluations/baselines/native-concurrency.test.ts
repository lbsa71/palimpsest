import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { OperationalStore } from '../../packages/storage/index.ts';
import { BaselineObserver, validateObserverGrant } from './observer.ts';
import type { BaselineTransport, ObserverGrant } from './observer.ts';
import type { PhysicalRequest } from '../../packages/contracts/control/index.ts';

const payload = JSON.stringify({ model: 'synthetic-text-model', reasoning: { effort: 'high' }, input: [{ role: 'user', content: 'Public synthetic concurrency fixture.' }] });
const attempt = { method: 'POST', path: '/v1/responses', payload };
const sse = `event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { id: 'synthetic-response', model: 'synthetic-text-model', status: 'completed', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 4 }, output_tokens_details: { reasoning_tokens: 2 } } } })}\n\n`;
function grant(concurrency = 2): ObserverGrant {
  return { id: 'original-synthetic-concurrency-grant', resources: { maxRequests: 8, maxTokens: 960, maxCostUsd: 1, maxElapsedMs: 10_000, maxConcurrency: concurrency },
    profile: { provider: 'openai', model: 'synthetic-text-model', effort: 'high', contextContract: 'Synthetic fixture maximum input; no provider contract', contextWindowTokens: 100, maxOutputTokens: 20,
      prices: { source: 'synthetic fixture rates', inputUsdPerMillion: 2, cachedInputUsdPerMillion: 1, outputUsdPerMillion: 3 } }, requestTimeoutMs: 1000, maxRequestBytes: 4096, maxResponseBytes: 4096 };
}
function fixture(transport: BaselineTransport, g = grant(), now?: () => number) {
  const root = mkdtempSync(join(tmpdir(), 'aeon-concurrency-unit-')); const store = new OperationalStore({ filename: join(root, 'observer.sqlite') });
  const observer = new BaselineObserver({ store, grant: g, transport, ...(now ? { now } : {}) });
  return { store, observer, dispose() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}
const response = () => new Response(sse, { headers: { 'content-type': 'text/event-stream' } });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('original host concurrency grants 1..8 are admitted and every other count is refused', () => {
  for (let count = 1; count <= 8; count++) validateObserverGrant(grant(count));
  for (const count of [0, -1, 1.5, 9, NaN, Infinity]) assert.throws(() => validateObserverGrant(grant(count)));
});

test('overlapping valid requests share the original host allocation; overflow never enters transport', async () => {
  const releases: (() => void)[] = []; let calls = 0;
  const f = fixture(async () => { calls++; await new Promise<void>(resolve => releases.push(resolve)); return response(); });
  try {
    const first = f.observer.handle(attempt), second = f.observer.handle(attempt);
    assert.equal(calls, 2); assert.equal(f.observer.ledger.snapshot(grant().id).concurrent, 2);
    await assert.rejects(f.observer.handle(attempt), /budget|allocation/); assert.equal(calls, 2);
    releases.forEach(release => release()); await Promise.all([first, second]);
    const evidence = f.observer.evidence(); assert.equal(evidence.length, 2); assert.notEqual(evidence[0]!.requestId, evidence[1]!.requestId);
    for (const record of evidence) { assert.equal(record.outcome, 'completed'); assert.equal(Buffer.from(f.store.readArtifact(record.before)).toString(), payload); assert.equal(record.after.sha256, f.observer.ledger.request(record.requestId)!.requestDigest); }
    assert.equal(f.observer.ledger.snapshot(grant().id).tokens, 30);
  } finally { f.dispose(); }
});

test('unknown usage stops dispatch and aborts active siblings while preserving already known charges and late replies', async () => {
  const releases: ((value: Response) => void)[] = [], signals: AbortSignal[] = [];
  const f = fixture((_payload, signal) => { signals.push(signal); return new Promise(resolve => releases.push(resolve)); }, grant(3));
  try {
    const operations = [f.observer.handle(attempt), f.observer.handle(attempt), f.observer.handle(attempt)];
    const settled = Promise.allSettled(operations);
    releases[0]!(response()); await operations[0];
    releases[1]!(new Response('truncated synthetic response', { headers: { 'content-type': 'text/event-stream' } }));
    const outcomes = await settled; assert.deepEqual(outcomes.map(value => value.status), ['fulfilled', 'rejected', 'rejected']);
    assert.equal(signals[2]!.aborted, true);
    assert.deepEqual(f.observer.evidence().map(value => value.outcome).sort(), ['completed', 'unknown', 'unknown']);
    const before = f.observer.ledger.snapshot(grant().id); assert.equal(before.tokens, 15 + 2 * 120); assert.equal(before.costUsd, 31 / 1_000_000 + 2 * 0.00026); assert.equal(before.cancelled, true);
    releases[2]!(response()); await tick();
    assert.deepEqual(f.observer.ledger.snapshot(grant().id), { ...before, elapsedMs: f.observer.ledger.snapshot(grant().id).elapsedMs });
    await assert.rejects(f.observer.handle(attempt), /budget|allocation/); assert.equal(signals.length, 3);
  } finally { f.dispose(); }
});

test('cancellation holds every dispatched reservation and reopen preserves the original allocation and clock', async () => {
  let now = 100; const g = grant(); const f = fixture(() => new Promise(() => {}), g, () => now);
  try {
    const pending = Promise.allSettled([f.observer.handle(attempt), f.observer.handle(attempt)]); now = 140;
    f.observer.cancel(); await pending;
    const before = f.observer.ledger.snapshot(g.id); assert.equal(before.tokens, 240); assert.equal(before.costUsd, 0.00052); assert.equal(before.elapsedMs, 2000);
    let entered = false; now = 5100;
    const reopened = new BaselineObserver({ store: f.store, grant: g, now: () => now, transport: async () => { entered = true; return response(); } });
    assert.equal(reopened.ledger.snapshot(g.id).elapsedMs, 5000);
    await assert.rejects(reopened.handle(attempt), /budget|allocation/); assert.equal(entered, false);
    const changed = structuredClone(g); changed.resources.maxConcurrency = 3;
    assert.throws(() => new BaselineObserver({ store: f.store, grant: changed, transport: async () => response() }), /immutable/);
  } finally { f.dispose(); }
});

test('eight requests can overlap under eight original slots without a second allowance', async () => {
  const releases: (() => void)[] = []; let calls = 0; const g = grant(8);
  const f = fixture(async () => { calls++; await new Promise<void>(resolve => releases.push(resolve)); return response(); }, g);
  try {
    const operations = Array.from({ length: 8 }, () => f.observer.handle(attempt));
    assert.equal(calls, 8); await assert.rejects(f.observer.handle(attempt), /budget|allocation/);
    releases.forEach(resolve => resolve()); await Promise.all(operations);
    await assert.rejects(f.observer.handle(attempt), /budget|allocation/); assert.equal(calls, 8);
    assert.equal(f.observer.ledger.snapshot(g.id).tokens, 120);
  } finally { f.dispose(); }
});

for (const dimension of ['tokens', 'cost', 'time'] as const) test(`concurrent ${dimension} exhaustion keeps the first original reservation`, async () => {
  const g = grant(); let now = 100, calls = 0;
  if (dimension === 'tokens') g.resources.maxTokens = 239;
  if (dimension === 'cost') g.resources.maxCostUsd = 0.00051;
  if (dimension === 'time') g.resources.maxElapsedMs = 1999;
  const f = fixture(async () => { calls++; return new Promise(() => {}); }, g, () => now);
  try {
    const pending = Promise.allSettled([f.observer.handle(attempt)]);
    if (dimension === 'time') now = 1100;
    await assert.rejects(f.observer.handle(attempt), /budget|allocation/); assert.equal(calls, 1);
    f.observer.cancel(); await pending; assert.equal(f.observer.ledger.snapshot(g.id).tokens, 120);
  } finally { f.dispose(); }
});

test('one timeout aborts every simultaneous outstanding attempt without synthetic zero settlements', async () => {
  const g = grant(); g.requestTimeoutMs = 20; const signals: AbortSignal[] = [];
  const f = fixture((_payload, signal) => { signals.push(signal); return new Promise(() => {}); }, g);
  try {
    await Promise.allSettled([f.observer.handle(attempt), f.observer.handle(attempt)]);
    assert.ok(signals.every(signal => signal.aborted)); assert.equal(f.observer.ledger.snapshot(g.id).tokens, 240);
    assert.ok(f.observer.evidence().every(record => record.usage?.inputTokens === null && record.usage?.costUsd === null));
  } finally { f.dispose(); }
});

test('worker loss reopens two original dispatched identities as unknown without reopening allocation or resetting time', async () => {
  let now = 100; const g = grant(); const f = fixture(async () => response(), g, () => now);
  try {
    const before = f.store.putArtifact(payload);
    for (let index = 0; index < 2; index++) {
      const id = `interrupted-native-${index}`;
      const request: PhysicalRequest = { id, runId: g.id, provider: g.profile.provider, model: g.profile.model, purpose: 'reasoning', promptManifestId: `native:${id}`, reservationId: id, requestDigest: before.sha256, status: 'reserved', usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 } };
      f.observer.ledger.reserve(request); f.store.put('baseline-attempts', id, { requestId: id, before, after: before }, null); f.observer.ledger.dispatched({ ...request, status: 'dispatched' });
    }
    now = 5100; let entered = false;
    const reopened = new BaselineObserver({ store: f.store, grant: g, now: () => now, transport: async () => { entered = true; return response(); } });
    const snapshot = reopened.ledger.snapshot(g.id); assert.equal(snapshot.tokens, 240); assert.equal(snapshot.costUsd, 0.00052); assert.equal(snapshot.elapsedMs, 5000); assert.equal(snapshot.cancelled, true);
    for (const record of reopened.evidence()) { assert.equal(record.outcome, 'unknown'); assert.equal(reopened.ledger.request(record.requestId)!.status, 'uncertain'); }
    await assert.rejects(reopened.handle(attempt), /budget|allocation/); assert.equal(entered, false);
  } finally { f.dispose(); }
});

// Execute the real worker source against injected process/HTTP/native boundaries.
// This is a deterministic bridge policy check, not an actual CLI/native child claim.
function worker(kind: 'codex' | 'claude', maxConcurrency: number) {
  let serve: (request: any, response: any) => Promise<void> = () => { throw new Error('Bridge not ready'); };
  const input = new EventEmitter() as EventEmitter & { close(): void }; input.close = () => {};
  const child = new EventEmitter() as any; child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter(); child.stdin.end = () => {}; child.kill = () => {};
  const records: any[] = []; const processStub = { stdout: { write(line: string) { records.push(JSON.parse(line)); } }, stdin: { destroy() {} }, exitCode: 0 };
  const source = readFileSync(new URL(`./${kind}-worker.mjs`, import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
  runInNewContext(source, { Buffer, process: processStub, mkdirSync() {}, createInterface: () => input,
    claudeInvocation: () => ({ args: [], environment: {} }), spawn: () => child,
    createServer(handler: typeof serve) { serve = handler; return { on() {}, once() {}, listen(_port: number, _host: string, ready: () => void) { ready(); }, address: () => ({ port: 12345 }), closeAllConnections() {}, close(done: () => void) { done(); } }; } });
  input.emit('line', JSON.stringify({ kind: 'start', value: { prompt: 'synthetic fixture', model: 'synthetic-text-model', effort: kind === 'codex' ? 'high' : 'low', maxRequestBytes: 128, maxOutputBytes: 1024, maxConcurrency } }));
  const request = (body: string | AsyncIterable<Buffer> = '{}') => {
    const request = Readable.from(typeof body === 'string' ? [Buffer.from(body)] : body) as any; request.method = 'POST'; request.url = kind === 'codex' ? '/v1/responses' : '/v1/messages'; request.headers = {};
    const response = { status: 0, body: '', writeHead(status: number) { this.status = status; return this; }, end(body = '') { this.body = body; return this; } };
    return { response, completed: serve(request, response) };
  };
  const reply = (record: any, ok = true) => input.emit('line', JSON.stringify({ kind: 'reply', id: record.id, ok, value: { status: 200, contentType: 'text/event-stream', body: 'fixture' } }));
  return { records, request, reply, input, finish() { child.emit('close', 0, null); }, processStub };
}
for (const kind of ['codex', 'claude'] as const) test(`${kind} real bridge source admits two overlapping bodies and refuses overflow before RPC`, async () => {
  const w = worker(kind, 2); await tick();
  const first = w.request(), second = w.request(); await tick();
  assert.equal(w.records.length, 2, 'both overlapping valid requests must reach host RPC');
  const overflow = w.request(); await overflow.completed; assert.equal(overflow.response.status, 403); assert.equal(w.records.length, 2);
  w.records.slice().reverse().forEach(record => w.reply(record)); await Promise.all([first.completed, second.completed]);
  assert.equal(first.response.status, 200); assert.equal(second.response.status, 200); w.finish(); await tick();
});

for (const kind of ['codex', 'claude'] as const) {
  test(`${kind} bridge counts reading bodies against the immutable local slot bound`, async () => {
    const w = worker(kind, 1); await tick(); const first = w.request();
    const overflow = w.request(); await overflow.completed; assert.equal(overflow.response.status, 403);
    await tick(); assert.equal(w.records.length, 1); w.reply(w.records[0]); await first.completed; w.finish(); await tick();
  });
  test(`${kind} oversized bodies and host refusal stop subsequent dispatch`, async () => {
    for (const oversized of [true, false]) {
      const w = worker(kind, 2); await tick(); const first = w.request(oversized ? 'x'.repeat(129) : '{}'); await tick();
      if (!oversized) w.reply(w.records[0], false);
      await first.completed; assert.equal(first.response.status, 502);
      const replacement = w.request(); await replacement.completed; assert.equal(replacement.response.status, 403);
      assert.equal(w.records.length, oversized ? 0 : 1); w.finish(); await tick();
    }
  });
  test(`${kind} duplicate or unknown host replies cannot reopen dispatch`, async () => {
    const w = worker(kind, 2); await tick(); const first = w.request(); await tick();
    w.reply(w.records[0]); await first.completed; w.reply(w.records[0]);
    const replacement = w.request(); await replacement.completed; assert.equal(replacement.response.status, 403); assert.equal(w.processStub.exitCode, 1);
    w.finish(); await tick();
  });
  test(`${kind} a body still being read cannot emit RPC after a sibling stops the bridge`, { timeout: 1000 }, async () => {
    const w = worker(kind, 2); await tick();
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    const slow = w.request((async function* () { await held; yield Buffer.from('{}'); })());
    const bad = w.request('x'.repeat(129)); await bad.completed; release(); await tick();
    assert.equal(w.records.length, 0); await slow.completed; assert.equal(slow.response.status, 502); w.finish(); await tick();
  });
}
