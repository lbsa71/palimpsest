import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { OperationalStore } from '../../packages/storage/index.ts';
import { BaselineObserver } from './observer.ts';
import type { ObserverGrant } from './observer.ts';

const grant = (): ObserverGrant => ({ id: 'messages-original-grant', resources: { maxRequests: 2, maxTokens: 240, maxCostUsd: 1, maxElapsedMs: 10_000, maxConcurrency: 1 },
  profile: { provider: 'anthropic-fixture', model: 'fixture-model', effort: 'low', contextContract: 'synthetic-only', contextWindowTokens: 100, maxOutputTokens: 20,
    prices: { source: 'synthetic zero', inputUsdPerMillion: 0, cachedInputUsdPerMillion: 0, outputUsdPerMillion: 0 } },
  requestTimeoutMs: 1000, maxRequestBytes: 4096, maxResponseBytes: 4096 });
const payload = () => JSON.stringify({ model: 'fixture-model', system: [{ type: 'text', text: 'Native instructions.', cache_control: { type: 'ephemeral' } }],
  messages: [{ role: 'user', content: 'Do the fixture.' }, { role: 'assistant', content: [{ type: 'tool_use', id: 'tool', name: 'Bash', input: { command: 'true' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool', content: [{ type: 'text', text: 'Observed.' }] }] }],
  tools: [{ name: 'Bash', input_schema: { type: 'object' }, description: 'Native local command' }], max_tokens: 9999, stream: true, output_config: { effort: 'low' } });
const events = () => [
  { type: 'message_start', message: { id: 'msg', type: 'message', role: 'assistant', model: 'fixture-model', usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'fixture' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }, { type: 'message_stop' },
];
const stream = (list = events()) => list.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
function fixture(transform = (body: string) => body, timeout = 1000) {
  const root = mkdtempSync(join(tmpdir(), 'aeon-messages-unit-')); const store = new OperationalStore({ filename: join(root, 'state.sqlite') });
  const g = grant(); g.requestTimeoutMs = timeout; let calls = 0, forwarded = '';
  const observer = new BaselineObserver({ store, grant: g, transport: async body => { calls++; forwarded = body; return new Response(transform(stream()), { headers: { 'content-type': 'text/event-stream' } }); } });
  return { observer, store, g, calls: () => calls, forwarded: () => forwarded, dispose() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}
const attempt = (body = payload()) => ({ method: 'POST', path: '/v1/messages', payload: body });

test('Messages native instructions/tool continuation remain exact and cumulative usage settles once', async () => {
  const f = fixture();
  try {
    await f.observer.handle(attempt()); const before = JSON.parse(payload()), after = JSON.parse(f.forwarded());
    assert.deepEqual(before.system, after.system); assert.deepEqual(before.messages, after.messages); assert.deepEqual(before.tools, after.tools); assert.equal(after.max_tokens, 20);
    await f.observer.handle(attempt()); assert.equal(f.calls(), 2); assert.equal(f.observer.ledger.snapshot(f.g.id).tokens, 30);
    await assert.rejects(f.observer.handle(attempt()), /budget|allocation/); assert.equal(f.calls(), 2);
    for (const record of f.observer.evidence()) { assert.equal(record.usage?.costUsd, 0); assert.equal(record.usage?.outputTokens, 5); }
    assert.throws(() => new BaselineObserver({ store: f.store, grant: { ...f.g, resources: { ...f.g.resources, maxRequests: 3 } }, transport: async () => { throw new Error(); } }), /immutable/);
  } finally { f.dispose(); }
});
for (const [name, mutate] of Object.entries({ media: (b: any): unknown => b.messages.push({ role: 'user', content: [{ type: 'image', source: {} }] }),
  thinking: (b: any): unknown => b.thinking = { type: 'enabled', budget_tokens: 10 }, hosted: (b: any): unknown => b.tools.push({ type: 'web_search_20250305', name: 'web_search' }),
  model: (b: any): unknown => b.model = 'other', opaque: (b: any): unknown => b.messages.push({ role: 'assistant', content: [{ type: 'thinking', thinking: 'opaque', signature: 'x' }] }),
})) test(`Messages ${name} refused and preserved before dispatch`, async () => {
  const f = fixture();
  try { const body = JSON.parse(payload()); mutate(body); await assert.rejects(f.observer.handle(attempt(JSON.stringify(body)))); assert.equal(f.calls(), 0); assert.equal(f.store.list('baseline-refusals').length, 1); } finally { f.dispose(); }
});
for (const [name, transform] of Object.entries({ truncated: (s: string) => s.trimEnd(), incomplete: () => stream(events().slice(0, 4)), duplicateStart: () => stream([events()[0]!, ...events()]),
  afterStop: (s: string) => s + stream([events()[1]!]), cached: (s: string) => s.replace('"cache_read_input_tokens":0', '"cache_read_input_tokens":1'),
  wrongModel: (s: string) => s.replace('"model":"fixture-model"', '"model":"other"'), excessive: (s: string) => s.replace('"output_tokens":5', '"output_tokens":21'),
  failed: (s: string) => s.replace('"end_turn"', '"max_tokens"'),
})) test(`Messages ${name} holds original reservation and prohibits retry`, async () => {
  const f = fixture(transform);
  try {
    await assert.rejects(f.observer.handle(attempt()), /outcome unknown/); const snapshot = f.observer.ledger.snapshot(f.g.id);
    assert.equal(snapshot.cancelled, true); assert.equal(snapshot.tokens, 120); assert.equal(f.observer.evidence()[0]?.outcome, 'unknown');
    await assert.rejects(f.observer.handle(attempt()), /budget|allocation/); assert.equal(f.calls(), 1);
  } finally { f.dispose(); }
});
test('Messages cancellation holds unknown usage and has no automatic replay', async () => {
  const f = fixture();
  try {
    const observer = new BaselineObserver({ store: f.store, grant: f.g, transport: () => new Promise(() => {}) });
    const pending = observer.handle(attempt()); observer.cancel(); await assert.rejects(pending, /outcome unknown/);
    const reopened = new BaselineObserver({ store: f.store, grant: f.g, transport: async () => { throw new Error('cannot enter'); } });
    await assert.rejects(reopened.handle(attempt()), /budget|allocation/); assert.equal(reopened.ledger.snapshot(f.g.id).tokens, 120);
  } finally { f.dispose(); }
});
