import test from 'node:test';
import assert from 'node:assert/strict';
import { createCodingProvider } from '../facade.ts';
import type { TrustedCodingProviderOptions } from '../facade.ts';
const readTool = { name: 'readFile', description: 'Return a host-owned file-read intent only', inputSchema: { type: 'object', properties: { path: { type: 'string', minLength: 1, maxLength: 512 } }, required: ['path'], additionalProperties: false }, validateArguments: (value: unknown) => typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 1 && typeof Reflect.get(value, 'path') === 'string' && Reflect.get(value, 'path').length > 0 && Reflect.get(value, 'path').length <= 512 };
function createFacade(options: Omit<TrustedCodingProviderOptions, 'model' | 'apiKey' | 'tools'>) { return createCodingProvider({ model: 'mistral-small-latest', apiKey: 'synthetic-fixture-key', tools: [readTool], ...options }); }
import type { StepInput } from '../facade.ts';

globalThis.fetch = async () => { throw new Error('Unmocked network forbidden'); };
const input = { messages: [{ role: 'user', text: 'synthetic task' }] } satisfies StepInput;
test('preauthorization veto prevents every transport/reservation call', async () => {
  let sent = 0, reserved = 0;
  const facade = createFacade({ transport: async () => { sent++; return new Response(); }, preauthorize: async () => { throw new Error('PRIVATE_DENIAL'); }, reserve: async () => { reserved++; } });
  const result = await facade.step(input);
  assert.deepEqual(result, { status: 'failed', error: { kind: 'authorization' }, usage: { status: 'unknown' }, dispatch: 'not-sent' });
  assert.equal(sent, 0);
  assert.equal(reserved, 0);
});
test('transport reservation veto prevents dispatch', async () => {
  let sent = 0;
  const facade = createFacade({ transport: async () => { sent++; return new Response(); }, preauthorize: async () => {}, reserve: async () => { throw new Error('PRIVATE_RESERVATION'); } });
  const result = await facade.step(input);
  assert.deepEqual(result, { status: 'failed', error: { kind: 'authorization' }, usage: { status: 'unknown' }, dispatch: 'not-sent' });
  assert.equal(sent, 0);
});

function completion(calls?: unknown[], usage: unknown = { prompt_tokens: 13, completion_tokens: 7, total_tokens: 20 }) {
  return { id: 'fixture', created: 1, model: 'mistral-small-latest', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: calls ? null : 'synthetic reply', ...(calls ? { tool_calls: calls } : {}) }, finish_reason: calls ? 'tool_calls' : 'stop' }], usage };
}
const intent = (id = 'call00001', args = '{ "path" : "fixture.ts" }', name = 'readFile') => ({ id, type: 'function', function: { name, arguments: args } });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function fixture(reply: (init: RequestInit) => Response | Promise<Response> = () => response(completion()), limits: Record<string, number> = {}) {
  let sent = 0, reserved = 0;
  const requests: Record<string, unknown>[] = [];
  const facade = createFacade({ limits, preauthorize: async () => {}, reserve: async () => { reserved++; }, transport: async (url: string | URL | Request, init: RequestInit | undefined) => {
    sent++;
    assert.equal(String(url), 'https://api.mistral.ai/v1/chat/completions');
    assert.ok(init);
    requests.push(JSON.parse(String(init.body)));
    return reply(init);
  } });
  return { facade, requests, get sent() { return sent; }, get reserved() { return reserved; } };
}

test('fixed advertised tool definitions, ordered raw IDs and known usage, no effects', async () => {
  const f = fixture(() => response(completion([intent(), intent('call00002', '{"path":"second.ts"}')])));
  const result = await f.facade.step(input);
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') assert.fail();
  assert.deepEqual(result.intents.map(call => call.callId), ['call00001', 'call00002']);
  assert.equal(result.intents[0]?.arguments, '{ "path" : "fixture.ts" }');
  assert.deepEqual(result.usage, { status: 'known', input: 13, output: 7, total: 20 });
  assert.equal(f.sent, 1);
  assert.equal(f.reserved, 1);
  const tools = f.requests[0]?.tools as { type: string; function: { name: string; parameters: unknown } }[];
  assert.equal(tools.length, 1);
  assert.equal(tools[0]?.type, 'function');
  assert.equal(tools[0]?.function.name, 'readFile');
  assert.equal(f.requests[0]?.max_tokens, 512);
  assert.deepEqual(tools[0]?.function.parameters, { type: 'object', properties: { path: { type: 'string', minLength: 1, maxLength: 512 } }, required: ['path'], additionalProperties: false });
});

test('validated continuation advertises tools and carries success then failure results', async () => {
  const f = fixture(() => response(completion()));
  const result = await f.facade.step({ messages: [
    ...input.messages,
    { role: 'assistant', text: '', intents: [{ callId: 'call00001', name: 'readFile', arguments: '{"path":"a.ts"}' }, { callId: 'call00002', name: 'readFile', arguments: '{"path":"b.ts"}' }] },
    { role: 'tool', name: 'readFile', callId: 'call00001', outcome: { ok: true, text: 'host-owned contents' } },
    { role: 'tool', name: 'readFile', callId: 'call00002', outcome: { ok: false, kind: 'tool_failed', message: 'host-owned safe failure' } },
  ] });
  assert.equal(result.status, 'ok');
  const messages = f.requests[0]?.messages as { role: string; tool_call_id?: string; content: string }[];
  assert.equal(messages[2]?.tool_call_id, 'call00001');
  assert.equal(messages[3]?.tool_call_id, 'call00002');
  assert.match(messages[3]?.content ?? '', /tool_failed/);
  assert.ok(f.requests[0]?.tools);
});

for (const args of ['{bad JSON', '{"path":42}', '{"path":"a.ts","extra":true}']) {
  test(`invalid semantic/syntax intent is rejected before host effects: ${args}`, async () => {
    const f = fixture(() => response(completion([intent('call00001', args)])));
    const result = await f.facade.step(input);
    assert.equal(result.status, 'failed');
    if (result.status !== 'failed') assert.fail();
    assert.equal(result.error.kind, 'invalid-intent');
    assert.equal(result.usage.status, 'known');
    assert.equal(f.sent, 1);
  });
}
test('unknown tool and duplicate response IDs rejected', async () => {
  for (const calls of [[intent('call00001', '{}', 'webSearch')], [intent(), intent()]]) {
    const f = fixture(() => response(completion(calls)));
    const result = await f.facade.step(input);
    assert.equal(result.status, 'failed');
    if (result.status !== 'failed') assert.fail();
    assert.equal(result.error.kind, 'invalid-intent');
  }
});
test('forged configuration, assets and orphan continuation never reach authorization', async () => {
  for (const forged of [{ ...input, model: 'untrusted-model' }, { messages: [{ role: 'user', text: 'x', assets: ['https://private.invalid/'] }] }, { messages: [{ role: 'tool', name: 'readFile', callId: 'call00001', outcome: { ok: true, text: 'orphan' } }] }]) {
    const f = fixture();
    const result = await f.facade.step(forged as StepInput);
    assert.equal(result.status, 'failed');
    if (result.status !== 'failed') assert.fail();
    assert.equal(result.error.kind, 'invalid-input');
    assert.equal(f.sent, 0);
    assert.equal(f.reserved, 0);
  }
});
test('UTF-8 outgoing cap applies before reservation and network', async () => {
  const f = fixture(undefined, { maxRequestBytes: 600 });
  const result = await f.facade.step({ messages: [{ role: 'user', text: '🦉'.repeat(200) }] });
  assert.equal(result.status, 'failed');
  if (result.status !== 'failed') assert.fail();
  assert.equal(result.error.kind, 'request-too-large');
  assert.equal(f.sent, 0);
  assert.equal(f.reserved, 0);
});
test('multi-chunk response cap cancels before consuming the remainder', async () => {
  let pulls = 0, cancelled = 0;
  const f = fixture(() => new Response(new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(400)); }, cancel() { cancelled++; } }, { highWaterMark: 0 })), { maxResponseBytes: 700 });
  const result = await f.facade.step(input);
  assert.equal(result.status, 'failed');
  if (result.status !== 'failed') assert.fail();
  assert.equal(result.error.kind, 'response-too-large');
  assert.equal(cancelled, 1);
  assert.equal(pulls, 2);
  assert.deepEqual(result.usage, { status: 'unknown' });
  assert.equal(result.dispatch, 'uncertain');
});
test('oversized content-length cancels without reading', async () => {
  let pulls = 0, cancelled = 0;
  const f = fixture(() => new Response(new ReadableStream({ pull() { pulls++; }, cancel() { cancelled++; } }, { highWaterMark: 0 }), { headers: { 'content-length': '10000' } }), { maxResponseBytes: 700 });
  const result = await f.facade.step(input);
  assert.equal(result.status, 'failed');
  assert.equal(pulls, 0);
  assert.equal(cancelled, 1);
});
test('provider raw error fields are absent from safe result, with no retry', async () => {
  const f = fixture(() => new Response(JSON.stringify({ object: 'error', message: 'PRIVATE_PROVIDER_ERROR', type: 'server_error', param: null, code: null }), { status: 503, headers: { 'x-private': 'PRIVATE_HEADER' } }));
  const result = await f.facade.step({ messages: [{ role: 'user', text: 'PRIVATE_PROMPT' }] });
  assert.equal(result.status, 'failed');
  if (result.status !== 'failed') assert.fail();
  assert.deepEqual(result.error, { kind: 'provider', statusCode: 503 });
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.deepEqual(result.usage, { status: 'unknown' });
  assert.equal(result.dispatch, 'uncertain');
  assert.equal(f.sent, 1);
});
for (const tokens of [undefined, {}, { prompt_tokens: 13 }, { prompt_tokens: -1, completion_tokens: 7, total_tokens: 6 }, { prompt_tokens: 0.5, completion_tokens: 7, total_tokens: 7.5 }, { prompt_tokens: Number.MAX_SAFE_INTEGER + 1, completion_tokens: 7, total_tokens: 20 }]) {
  test(`missing/partial/unsafe counts preserve unknown spent usage: ${JSON.stringify(tokens)}`, async () => {
    const body = completion(undefined, tokens);
    if (tokens === undefined) delete (body as { usage?: unknown }).usage;
    const f = fixture(() => response(body));
    const result = await f.facade.step(input);
    assert.equal(result.status, 'failed');
    assert.deepEqual(result.usage, { status: 'unknown' });
    assert.equal(f.sent, 1);
  });
}
test('partial JSON interruption leaves usage unknown without printing raw content', async () => {
  const f = fixture(() => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"PRIVATE_PARTIAL":')); controller.error(new Error('PRIVATE_STREAM_ERROR')); } })));
  const result = await f.facade.step(input);
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.usage, { status: 'unknown' });
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});
test('actual deadline settles even when transport ignores abort; no late replay', async () => {
  let signal: AbortSignal | undefined, settle: ((response: Response) => void) | undefined;
  const f = fixture(init => { signal = init.signal ?? undefined; return new Promise(resolve => { settle = resolve; }); }, { deadlineMs: 30 });
  const result = await f.facade.step(input);
  assert.equal(result.status, 'failed');
  if (result.status !== 'failed') assert.fail();
  assert.equal(result.error.kind, 'deadline');
  assert.equal(signal?.aborted, true);
  assert.equal(f.sent, 1);
  settle?.(response(completion()));
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.sent, 1);
});
test('abort cancels a pending reader and preserves unknown usage', async () => {
  let cancelled = 0, readerStarted: (() => void) | undefined;
  const started = new Promise<void>(resolve => { readerStarted = resolve; });
  const controller = new AbortController();
  const f = fixture(() => new Response(new ReadableStream({ pull() { readerStarted?.(); }, cancel() { cancelled++; } }, { highWaterMark: 0 })));
  const pending = f.facade.step({ ...input, signal: controller.signal });
  await started;
  controller.abort(new Error('PRIVATE_ABORT_REASON'));
  const result = await pending;
  assert.equal(result.status, 'failed');
  if (result.status !== 'failed') assert.fail();
  assert.equal(result.error.kind, 'aborted');
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.equal(cancelled, 1);
});

test('late transport response is cancelled after an independently settled deadline', async () => {
  let finish: ((response: Response) => void) | undefined, cancelled = 0;
  const f = fixture(() => new Promise(resolve => { finish = resolve; }), { deadlineMs: 20 });
  const result = await f.facade.step(input);
  assert.equal(result.status, 'failed');
  finish?.(new Response(new ReadableStream({ cancel() { cancelled++; } }, { highWaterMark: 0 })));
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(cancelled, 1);
});

test('expired authorization hook cannot dispatch when it later completes', async () => {
  let finish: (() => void) | undefined, sent = 0, reserved = 0;
  const f = createFacade({ transport: async () => { sent++; return response(completion()); }, reserve: async () => { reserved++; }, preauthorize: () => new Promise(resolve => { finish = resolve; }), limits: { deadlineMs: 20 } });
  const result = await f.step(input);
  assert.equal(result.status, 'failed');
  finish?.();
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(sent, 0);
  assert.equal(reserved, 0);
});

test('measured zero tokens remain known, distinct from missing counts', async () => {
  const f = fixture(() => response(completion(undefined, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 })));
  const result = await f.facade.step(input);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.usage, { status: 'known', input: 0, output: 0, total: 0 });
});

test('pre-aborted input never authorizes, reserves or dispatches', async () => {
  const controller = new AbortController(); controller.abort();
  let authorized = 0, reserved = 0, sent = 0;
  const facade = createFacade({ preauthorize: () => { authorized++; }, reserve: () => { reserved++; }, transport: async () => { sent++; return response(completion()); } });
  const result = await facade.step({ ...input, signal: controller.signal });
  assert.equal(result.status, 'failed');
  assert.equal(authorized, 0); assert.equal(reserved, 0); assert.equal(sent, 0);
});

test('thrown transport failure is uncertain, sanitized and never retried', async () => {
  const f = fixture(() => { throw new TypeError('PRIVATE_TRANSPORT_FAILURE'); });
  const result = await f.facade.step(input);
  assert.equal(result.status, 'failed');
  if (result.status !== 'failed') assert.fail();
  assert.equal(result.dispatch, 'uncertain');
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.equal(f.sent, 1);
});

for (const [finish, calls, text] of [
  ['length', undefined, 'truncated'], ['unknown_reason', undefined, 'text'],
  ['stop', [intent()], null], ['tool_calls', undefined, 'text'], ['stop', undefined, '   '],
] as const) {
  test(`incomplete/inconsistent completion ${finish} is rejected with measured usage`, async () => {
    const body = completion(calls ? [...calls] : undefined);
    body.choices[0]!.finish_reason = finish;
    body.choices[0]!.message.content = text;
    const f = fixture(() => response(body));
    const result = await f.facade.step(input);
    assert.equal(result.status, 'failed');
    if (result.status !== 'failed') assert.fail();
    assert.equal(result.error.kind, 'incomplete-response');
    assert.deepEqual(result.usage, { status: 'known', input: 13, output: 7, total: 20 });
    assert.equal(f.sent, 1);
  });
}
test('trusted output-token ceiling is advertised and accepted completion exposes finish reason', async () => {
  const f = fixture(undefined, { maxOutputTokens: 96 });
  const result = await f.facade.step(input);
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') assert.fail();
  assert.equal(result.finishReason, 'stop');
  assert.equal(f.requests[0]?.max_tokens, 96);
});
for (const extra of [{ total_tokens: 21 }, { num_cached_tokens: 14 }, { num_cached_tokens: -1 }, { prompt_tokens_details: { cached_tokens: 14 } }, { num_cached_tokens: 3, prompt_tokens_details: { cached_tokens: 4 } }]) {
  test(`inconsistent total/cache fields leave spent usage unknown: ${JSON.stringify(extra)}`, async () => {
    const tokens = { prompt_tokens: 13, completion_tokens: 7, total_tokens: 20, ...extra };
    const f = fixture(() => response(completion(undefined, tokens)));
    const result = await f.facade.step(input);
    assert.equal(result.status, 'failed');
    if (result.status !== 'failed') assert.fail();
    assert.equal(result.error.kind, 'invalid-usage');
    assert.deepEqual(result.usage, { status: 'unknown' });
  });
}
test('valid optional raw cache counts are checked without computing unsupported aggregates', async () => {
  const f = fixture(() => response(completion(undefined, { prompt_tokens: 13, completion_tokens: 7, total_tokens: 20, num_cached_tokens: 3, prompt_tokens_details: { cached_tokens: 3 } })));
  const result = await f.facade.step(input);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.usage, { status: 'known', input: 13, output: 7, total: 20 });
});

test('unsupported Node timer range is rejected as trusted configuration', () => {
  assert.throws(() => createFacade({ transport: async () => response(completion()), preauthorize: () => {}, reserve: () => {}, limits: { deadlineMs: 2 ** 31 } }), /Invalid trusted deadline/);
});

test('returned IDs cannot collide with completed supplied history', async () => {
  const f = fixture(() => response(completion([intent()])));
  const result = await f.facade.step({ messages: [
    ...input.messages,
    { role: 'assistant', text: '', intents: [{ callId: 'call00001', name: 'readFile', arguments: '{"path":"a.ts"}' }] },
    { role: 'tool', name: 'readFile', callId: 'call00001', outcome: { ok: true, text: 'prior host-owned result' } },
  ] });
  assert.equal(result.status, 'failed');
  if (result.status !== 'failed') assert.fail();
  assert.equal(result.error.kind, 'invalid-intent');
  assert.deepEqual(result.usage, { status: 'known', input: 13, output: 7, total: 20 });
});
