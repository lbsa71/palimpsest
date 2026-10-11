import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { OperationalStore } from '../../packages/storage/index.ts';
import { BaselineObserver } from './observer.ts';
import type { BaselineTransport, ObserverGrant } from './observer.ts';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const grant = (): ObserverGrant => ({ id: 'independent-review-original-grant', resources: { maxRequests: 8, maxTokens: 960, maxCostUsd: 1, maxElapsedMs: 10_000, maxConcurrency: 2 },
  profile: { provider: 'openai', model: 'review-synthetic', effort: 'high', contextContract: 'Public synthetic review only', contextWindowTokens: 100, maxOutputTokens: 20,
    prices: { source: 'synthetic rates', inputUsdPerMillion: 2, cachedInputUsdPerMillion: 1, outputUsdPerMillion: 3 } }, requestTimeoutMs: 1000, maxRequestBytes: 8192, maxResponseBytes: 8192 });
const attempt = (tag: string) => ({ method: 'POST', path: '/v1/responses', payload: JSON.stringify({ model: 'review-synthetic', reasoning: { effort: 'high' }, instructions: `instructions-${tag}`, input: [{ role: 'user', content: tag }] }) });
const receipt = (tag: string, input: number) => `data: ${JSON.stringify({ type: 'response.completed', response: { id: tag, model: 'review-synthetic', status: 'completed', usage: { input_tokens: input, output_tokens: 2, total_tokens: input + 2, input_tokens_details: { cached_tokens: 1 }, output_tokens_details: { reasoning_tokens: 1 } } } })}\n\n`;
const response = (body: string) => new Response(body, { headers: { 'content-type': 'text/event-stream' } });
function fixture(transport: BaselineTransport) {
  const root = mkdtempSync(join(tmpdir(), 'native-concurrency-review-'));
  const store = new OperationalStore({ filename: join(root, 'state.sqlite') });
  const g = grant(), observer = new BaselineObserver({ store, grant: g, transport });
  return { store, observer, g, close() { observer.cancel(); store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('reverse completion binds distinct instructions, transformed requests, responses and charges to their original attempt', async () => {
  const releases = new Map<string, (value: Response) => void>();
  const f = fixture((body) => new Promise(resolve => releases.set(JSON.parse(body).input[0].content, resolve)));
  try {
    const first = f.observer.handle(attempt('first')), second = f.observer.handle(attempt('second'));
    // Mutating the caller-owned grant cannot alter either concurrent reservation.
    f.g.resources.maxConcurrency = 8; f.g.profile.prices.inputUsdPerMillion = 0;
    await assert.rejects(f.observer.handle(attempt('overflow')), /budget|allocation/);
    releases.get('second')!(response(receipt('second', 17))); await second;
    releases.get('first')!(response(receipt('first', 11))); await first;
    for (const evidence of f.observer.evidence()) {
      const before = JSON.parse(Buffer.from(f.store.readArtifact(evidence.before)).toString());
      const after = JSON.parse(Buffer.from(f.store.readArtifact(evidence.after)).toString());
      const tag = before.input[0].content, input = tag === 'first' ? 11 : 17;
      assert.deepEqual(after.input, before.input); assert.equal(after.instructions, before.instructions);
      assert.equal(after.max_output_tokens, 20); assert.equal(after.store, false);
      assert.equal(Buffer.from(f.store.readArtifact(evidence.response!)).toString(), receipt(tag, input));
      assert.equal(evidence.usage?.costUsd, ((input - 1) * 2 + 1 + 6) / 1_000_000);
      const physical = f.observer.ledger.request(evidence.requestId)!;
      assert.equal(physical.requestDigest, evidence.after.sha256); assert.equal(physical.reservationId, evidence.requestId);
      assert.equal(physical.promptManifestId, `native:${evidence.requestId}`);
    }
    assert.equal(f.observer.ledger.snapshot(f.g.id).tokens, 32);
  } finally { f.close(); }
});

test('one externally cancelled request aborts a sibling blocked reading its response and retains its partial evidence', async () => {
  const signals: AbortSignal[] = []; let calls = 0;
  const partial = 'data: {"type":"response.created","response":{"id":"partial"}}\n\n';
  const f = fixture(async (_body, signal) => {
    signals.push(signal); calls++;
    if (calls === 1) return new Promise(() => {});
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.from(partial)); } }), { headers: { 'content-type': 'text/event-stream' } });
  });
  try {
    const cancellation = new AbortController();
    const first = f.observer.handle(attempt('cancelled'), cancellation.signal), second = f.observer.handle(attempt('reading'));
    const settled = Promise.allSettled([first, second]); await tick(); cancellation.abort();
    assert.deepEqual((await settled).map(result => result.status), ['rejected', 'rejected']);
    assert.ok(signals.every(signal => signal.aborted));
    const evidence = f.observer.evidence(); assert.ok(evidence.every(item => item.outcome === 'unknown' && item.usage?.costUsd === null));
    assert.ok(evidence.some(item => Buffer.from(f.store.readArtifact(item.response!)).toString() === partial));
    assert.equal(f.observer.ledger.snapshot(f.g.id).tokens, 240);
    assert.equal(f.observer.ledger.snapshot(f.g.id).costUsd, 0.00052);
    await assert.rejects(f.observer.handle(attempt('replacement')), /budget|allocation/); assert.equal(calls, 2);
  } finally { f.close(); }
});

// Exercise the unchanged worker source with fake process/HTTP/child boundaries.
// This starts no native binary, namespace, socket or provider request.
function bridge(kind: 'codex' | 'claude') {
  let handler!: (request: any, response: any) => Promise<void>;
  const input = Object.assign(new EventEmitter(), { close() {} });
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), stdin: Object.assign(new EventEmitter(), { end() {} }), kill() {} });
  const records: any[] = [];
  const source = readFileSync(new URL(`./${kind}-worker.mjs`, import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
  runInNewContext(source, { Buffer, process: { stdout: { write(line: string) { records.push(JSON.parse(line)); } }, stdin: { destroy() {} }, exitCode: 0 }, mkdirSync() {}, createInterface: () => input, spawn: () => child, claudeInvocation: () => ({ args: [], environment: {} }),
    createServer(callback: typeof handler) { handler = callback; return { on() {}, once() {}, listen(_port: number, _host: string, ready: () => void) { ready(); }, address: () => ({ port: 1 }), closeAllConnections() {}, close(done: () => void) { done(); } }; } });
  input.emit('line', JSON.stringify({ kind: 'start', value: { prompt: 'review fixture', model: 'review-synthetic', effort: kind === 'codex' ? 'high' : 'low', maxConcurrency: 8, maxRequestBytes: 128, maxOutputBytes: 1024 } }));
  return { records, input, finish() { child.emit('close', 0, null); },
    request(body: AsyncIterable<Buffer>) {
      const request = Object.assign(Readable.from(body), { method: 'POST', url: kind === 'codex' ? '/v1/responses' : '/v1/messages', headers: {} });
      const response = { status: 0, body: '', writeHead(status: number) { this.status = status; return this; }, end(body = '') { this.body = body; return this; } };
      return { response, completed: handler(request, response) };
    } };
}

for (const kind of ['codex', 'claude'] as const) test(`${kind}: eight partial bodies hold every slot; replies bind by id and stale replay stops all siblings`, async () => {
  const b = bridge(kind); await tick();
  let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
  const requests = Array.from({ length: 8 }, (_, index) => b.request((async function* () { yield Buffer.from('{'); await barrier; yield Buffer.from(`"tag":${index}}`); })()));
  await tick(); assert.equal(b.records.length, 0);
  const overflow = b.request((async function* () { yield Buffer.from('{}'); })());
  await overflow.completed; assert.equal(overflow.response.status, 403); release(); await tick();
  assert.equal(b.records.length, 8);
  const chosen = b.records[7];
  b.input.emit('line', JSON.stringify({ kind: 'reply', id: chosen.id, ok: true, value: { status: 200, body: 'only-the-eighth', contentType: 'text/plain' } }));
  await requests[7]!.completed; assert.equal(requests[7]!.response.body, 'only-the-eighth');
  b.input.emit('line', JSON.stringify({ kind: 'reply', id: chosen.id, ok: true, value: { status: 200, body: 'stale', contentType: 'text/plain' } }));
  await Promise.all(requests.map(request => request.completed));
  assert.ok(requests.slice(0, 7).every(request => request.response.status === 502));
  const replacement = b.request((async function* () { yield Buffer.from('{}'); })());
  await replacement.completed; assert.equal(replacement.response.status, 403); assert.equal(b.records.length, 8);
  b.finish(); await tick();
});
