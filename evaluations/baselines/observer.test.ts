import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { OperationalStore } from '../../packages/storage/index.ts';
import { BaselineObserver, OPENAI_RESPONSES_ENDPOINT, openAITransport } from './observer.ts';
import type { BaselineTransport, ObserverGrant } from './observer.ts';

export function fixtureGrant(): ObserverGrant {
  return { id: 'synthetic-host-grant', resources: { maxRequests: 2, maxTokens: 240, maxCostUsd: 1, maxElapsedMs: 10_000, maxConcurrency: 1 },
    profile: { provider: 'openai', model: 'synthetic-text-model', effort: 'high', contextContract: 'fixture-only maximum 100 input tokens, not a real provider contract', contextWindowTokens: 100, maxOutputTokens: 20,
      prices: { source: 'synthetic prices, not provider pricing', inputUsdPerMillion: 2, cachedInputUsdPerMillion: 1, outputUsdPerMillion: 3 } },
    requestTimeoutMs: 1000, maxRequestBytes: 4096, maxResponseBytes: 4096 };
}
export function fixturePayload(model = 'synthetic-text-model'): string {
  return JSON.stringify({ model, stream: true, store: true, max_output_tokens: 9999, tool_choice: 'auto', parallel_tool_calls: true,
    reasoning: { effort: 'high', context: 'all_turns' }, include: ['reasoning.encrypted_content'], text: { verbosity: 'low' }, client_metadata: { fixture: 'no-secret' },
    instructions: 'Preserve native effective instructions exactly.\nSecond line.', input: [
      { type: 'additional_tools', id: 'tools', role: 'developer', tools: [{ type: 'namespace', name: 'functions', tools: [{ type: 'custom', name: 'exec', description: 'Synthetic native custom tool' }, { type: 'function', name: 'read', parameters: { type: 'object' } }] }] },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Run the synthetic fixture.' }] },
      { type: 'custom_tool_call', name: 'exec', call_id: 'call', input: 'text(1)' },
      { type: 'custom_tool_call_output', call_id: 'call', output: [{ type: 'text', text: '1' }] },
    ] });
}
export function fixtureSSE(model = 'synthetic-text-model', change: Record<string, unknown> = {}): string {
  const response = { id: 'resp_fixture', status: 'completed', model, output: [], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 4 }, output_tokens_details: { reasoning_tokens: 2 } }, ...change };
  return `event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response })}\n\n`;
}
function fixture(options: { grant?: ObserverGrant; transport?: BaselineTransport; now?: () => number } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'aeon-observer-unit-')); const filename = join(root, 'state.sqlite');
  const store = new OperationalStore({ filename }); const grant = options.grant ?? fixtureGrant(); let calls = 0;
  const transport: BaselineTransport = async (...args) => { calls++; return options.transport ? options.transport(...args) : new Response(fixtureSSE(grant.profile.model), { headers: { 'content-type': 'text/event-stream' } }); };
  const observer = new BaselineObserver({ store, grant, transport, now: options.now });
  return { root, filename, store, grant, transport, observer, calls: () => calls, dispose() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}
const attempt = (payload = fixturePayload()) => ({ method: 'POST', path: '/v1/responses', payload });

test('native instructions and tools survive explicit output/store/stream controls; final usage settles exact artifacts', async () => {
  let forwarded = '';
  const f = fixture({ transport: async payload => { forwarded = payload; return new Response(fixtureSSE(), { headers: { 'content-type': 'text/event-stream' } }); } });
  try {
    const original = fixturePayload(); const reply = await f.observer.handle(attempt(original)); const after = JSON.parse(forwarded), before = JSON.parse(original);
    assert.equal(after.instructions, before.instructions); assert.deepEqual(after.input, before.input); assert.deepEqual(after.reasoning, before.reasoning);
    assert.equal(after.max_output_tokens, 20); assert.equal(after.store, false); assert.equal(after.stream, true);
    const evidence = f.observer.evidence()[0]!;
    assert.equal(Buffer.from(f.store.readArtifact(evidence.before)).toString(), original);
    assert.equal(Buffer.from(f.store.readArtifact(evidence.after)).toString(), forwarded);
    assert.equal(Buffer.from(f.store.readArtifact(evidence.response!)).toString(), reply.body);
    const physical = f.observer.ledger.request(evidence.requestId)!;
    assert.equal(physical.requestDigest, evidence.after.sha256); assert.equal(physical.status, 'succeeded');
    assert.deepEqual(physical.usage, { requests: 1, inputTokens: 10, outputTokens: 5, costUsd: 31 / 1_000_000, elapsedMs: physical.usage.elapsedMs });
    assert.equal(f.observer.ledger.snapshot(f.grant.id).tokens, 15); assert.equal(f.calls(), 1);
  } finally { f.dispose(); }
});

for (const dimension of ['requests', 'tokens', 'cost', 'time'] as const) test(`host ${dimension} grant refuses dispatch before transport entry`, async () => {
  const grant = fixtureGrant(); let now = 100;
  if (dimension === 'requests') grant.resources.maxRequests = 1;
  if (dimension === 'tokens') grant.resources.maxTokens = 119;
  if (dimension === 'cost') grant.resources.maxCostUsd = 0.00025;
  if (dimension === 'time') { grant.resources.maxElapsedMs = 1000; }
  const f = fixture({ grant, now: () => now });
  try {
    if (dimension === 'requests') await f.observer.handle(attempt());
    if (dimension === 'time') now++;
    await assert.rejects(f.observer.handle(attempt()), /budget|allocation/);
    assert.equal(f.calls(), dimension === 'requests' ? 1 : 0);
  } finally { f.dispose(); }
});

test('identical physical payloads are separate attempts and reopen cannot reset or change the grant', async () => {
  const f = fixture();
  try {
    await f.observer.handle(attempt());
    const reopened = new BaselineObserver({ store: f.store, grant: fixtureGrant(), transport: f.transport });
    await reopened.handle(attempt()); await assert.rejects(reopened.handle(attempt()), /budget|allocation/);
    assert.equal(f.calls(), 2); assert.equal(reopened.evidence().length, 2);
    assert.notEqual(reopened.evidence()[0]!.requestId, reopened.evidence()[1]!.requestId);
    const changed = fixtureGrant(); changed.resources.maxRequests++;
    assert.throws(() => new BaselineObserver({ store: f.store, grant: changed, transport: f.transport }), /immutable/);
    assert.throws(() => new BaselineObserver({ store: f.store, grant: { ...fixtureGrant(), id: 'reset' }, transport: f.transport }), /different grant/);
    assert.throws(() => { f.observer.grant.resources.maxRequests = 100; }, TypeError);
  } finally { f.dispose(); }
});

test('actual process death after dispatch leaves conservative usage and prevents restart retry', () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-observer-crash-')), filename = join(root, 'state.sqlite');
  const script = `import {OperationalStore} from ${JSON.stringify(new URL('../../packages/storage/index.ts', import.meta.url).href)};
    import {BaselineObserver} from ${JSON.stringify(new URL('./observer.ts', import.meta.url).href)};
    const store=new OperationalStore({filename:${JSON.stringify(filename)}});
    const observer=new BaselineObserver({store,grant:${JSON.stringify(fixtureGrant())},transport:async()=>{process.exit(0)}});
    await observer.handle(${JSON.stringify(attempt())});`;
  try {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 5000 });
    assert.equal(child.status, 0, child.stderr);
    const store = new OperationalStore({ filename }); let entered = false;
    try {
      const observer = new BaselineObserver({ store, grant: fixtureGrant(), transport: async () => { entered = true; throw new Error('must not enter'); } });
      const snapshot = observer.ledger.snapshot(fixtureGrant().id);
      assert.equal(snapshot.requests, 1); assert.equal(snapshot.tokens, 120); assert.equal(snapshot.costUsd, 0.00026); assert.equal(snapshot.cancelled, true);
      assert.equal(observer.ledger.request(observer.evidence()[0]!.requestId)!.status, 'uncertain'); assert.equal(observer.evidence()[0]!.outcome, 'unknown');
      return assert.rejects(observer.handle(attempt()), /budget|allocation/).then(() => { assert.equal(entered, false); }).finally(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
    } catch (error) { store.close(); throw error; }
  } catch (error) { rmSync(root, { recursive: true, force: true }); throw error; }
});

for (const [label, mutate] of Object.entries({
  hostedTool: (body: any) => { body.tools = [{ type: 'web_search_preview' }]; },
  nestedHostedTool: (body: any) => { body.input[0].tools[0].tools.push({ type: 'file_search', name: 'paid' }); },
  previousResponse: (body: any) => { body.previous_response_id = 'old'; },
  conversation: (body: any) => { body.conversation = 'old'; },
  media: (body: any) => { body.input[1].content = [{ type: 'input_image', image_url: 'data:image/png;base64,x' }]; },
  mediaOutput: (body: any) => { body.input[3].output = [{ type: 'image', data: 'x' }]; },
  serverReference: (body: any) => { body.input.push({ type: 'item_reference', id: 'old' }); },
  model: (body: any) => { body.model = 'unpriced'; },
  effort: (body: any) => { body.reasoning.effort = 'low'; },
  endpoint: (body: any) => { body.base_url = 'https://other.invalid'; },
  hiddenMedia: (body: any) => { body.input[1].content[0].image_url = 'data:image/png;base64,x'; },
  toolChoice: (body: any) => { body.tool_choice = { type: 'web_search_preview' }; },
})) test(`refuses ${label} before any physical provider call`, async () => {
  const f = fixture();
  try { const body = JSON.parse(fixturePayload()); mutate(body); await assert.rejects(f.observer.handle(attempt(JSON.stringify(body)))); assert.equal(f.calls(), 0); } finally { f.dispose(); }
});

const badStreams: Record<string, () => Response> = {
  noFinal: () => new Response('data: {"type":"response.created","response":{"id":"r"}}\n\n'),
  truncated: () => new Response(fixtureSSE().trimEnd()),
  failedHttp: () => new Response(fixtureSSE(), { status: 500 }),
  missingUsage: () => new Response(fixtureSSE(undefined, { usage: null })),
  failedStatus: () => new Response(fixtureSSE(undefined, { status: 'failed' })),
  wrongModel: () => new Response(fixtureSSE('other-model')),
  duplicateFinal: () => new Response(fixtureSSE() + fixtureSSE()),
  inconsistentTotal: () => new Response(fixtureSSE(undefined, { usage: { input_tokens: 10, output_tokens: 5, total_tokens: 99, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } })),
  exceedsContext: () => new Response(fixtureSSE(undefined, { usage: { input_tokens: 101, output_tokens: 5, total_tokens: 106, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } })),
  invalidCache: () => new Response(fixtureSSE(undefined, { usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 11 }, output_tokens_details: { reasoning_tokens: 0 } } })),
};
for (const [label, response] of Object.entries(badStreams)) test(`${label} holds unknown usage and forbids retry`, async () => {
  const f = fixture({ transport: async () => { const raw = response(); return new Response(raw.body, { status: raw.status, headers: { 'content-type': 'text/event-stream' } }); } });
  try {
    await assert.rejects(f.observer.handle(attempt()), /outcome unknown/);
    const snapshot = f.observer.ledger.snapshot(f.grant.id); assert.equal(snapshot.tokens, 120); assert.equal(snapshot.costUsd, 0.00026); assert.equal(snapshot.cancelled, true);
    assert.equal(f.observer.evidence()[0]!.usage!.inputTokens, null); await assert.rejects(f.observer.handle(attempt()), /budget|allocation/); assert.equal(f.calls(), 1);
  } finally { f.dispose(); }
});

test('concurrent, cancelled and timed out attempts cannot release held charges', async () => {
  const grant = fixtureGrant(); grant.requestTimeoutMs = 30;
  const f = fixture({ grant, transport: () => new Promise(() => {}) });
  try {
    const pending = f.observer.handle(attempt());
    await assert.rejects(f.observer.handle(attempt()), /budget|allocation/);
    await assert.rejects(pending, /outcome unknown/); assert.equal(f.calls(), 1); assert.equal(f.observer.ledger.snapshot(grant.id).tokens, 120);
  } finally { f.dispose(); }
  const cancelled = fixture({ transport: () => new Promise(() => {}) });
  try { const pending = cancelled.observer.handle(attempt()); cancelled.observer.cancel(); await assert.rejects(pending, /outcome unknown/); assert.equal(cancelled.observer.ledger.snapshot(cancelled.grant.id).cancelled, true); } finally { cancelled.dispose(); }
});

test('bounded reads retain only allowed response bytes and cancelled signals prevent dispatch', async () => {
  const grant = fixtureGrant(); grant.maxResponseBytes = 40;
  const f = fixture({ grant });
  try { await assert.rejects(f.observer.handle(attempt()), /outcome unknown/); assert.equal(f.store.readArtifact(f.observer.evidence()[0]!.response!).length, 40); } finally { f.dispose(); }
  const stopped = fixture(); const controller = new AbortController(); controller.abort();
  try { await assert.rejects(stopped.observer.handle(attempt(), controller.signal)); assert.equal(stopped.calls(), 0); } finally { stopped.dispose(); }
});

test('OpenAI transport has a pinned endpoint, refuses redirects and keeps its credential out of request artifacts', async () => {
  let calls = 0;
  const transport = openAITransport('HOST_PRIVATE_FIXTURE_KEY', (async (url, options) => {
    calls++; assert.equal(url, OPENAI_RESPONSES_ENDPOINT); assert.equal(options!.redirect, 'error'); assert.equal((options!.headers as Record<string, string>).Authorization, 'Bearer HOST_PRIVATE_FIXTURE_KEY');
    assert.equal(String(options!.body).includes('HOST_PRIVATE_FIXTURE_KEY'), false);
    return new Response(fixtureSSE(), { headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch);
  const f = fixture({ transport });
  try { await f.observer.handle(attempt()); assert.equal(calls, 1); assert.equal(JSON.stringify(f.observer.evidence()).includes('HOST_PRIVATE_FIXTURE_KEY'), false); } finally { f.dispose(); }
});
