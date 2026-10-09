import assert from 'node:assert/strict';
import test from 'node:test';

// No fixture can fall back to network or process credentials. All keys are synthetic.
globalThis.fetch = async () => { throw new Error('Unmocked network forbidden'); };
const { generateText, streamText, jsonSchema, isStepCount } = await import('ai');
const { createMistral } = await import('@ai-sdk/mistral');
const { z } = await import('zod');
const schema = jsonSchema({ type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false });
const tools = { readFile: { description: 'Synthetic host intent', inputSchema: schema } };
const usage = { prompt_tokens: 13, completion_tokens: 7, total_tokens: 20, num_cached_tokens: 3, service_tier: 'fixture', custom_metric: 17 };
const intent = { id: 'call00001', type: 'function', function: { name: 'readFile', arguments: '{"path":"fixture.ts"}' } };
function completion({ calls, text = 'fixture response', tokens = usage } = {}) {
  return { id: 'fixture-response', object: 'chat.completion', created: 1, model: 'fixture-model', choices: [{ index: 0, message: { role: 'assistant', content: calls ? null : text, ...(calls ? { tool_calls: calls } : {}) }, finish_reason: calls ? 'tool_calls' : 'stop' }], ...(tokens === undefined ? {} : { usage: tokens }) };
}
function fixture(handler) {
  const requests = [];
  const model = createMistral({ apiKey: 'synthetic-fixture-key', fetch: async (url, init) => {
    assert.equal(String(url), 'https://api.mistral.ai/v1/chat/completions');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer synthetic-fixture-key');
    requests.push({ url: String(url), body: JSON.parse(init.body), signal: init.signal });
    return handler(requests.at(-1), requests.length);
  } })('fixture-model');
  return { model, requests };
}
const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const run = (model, extra = {}) => generateText({ model, prompt: 'synthetic task', tools, maxRetries: 0, stopWhen: isStepCount(1), ...extra });

test('single step exposes intents before host-owned effect; direct adapter sends no discovery', async () => {
  const order = [];
  const f = fixture(() => { order.push('transport'); return json(completion({ calls: [intent] })); });
  const result = await run(f.model, { onStepStart: () => order.push('reserve') });
  assert.deepEqual(order, ['reserve', 'transport']);
  assert.equal(f.requests.length, 1);
  assert.equal(result.steps.length, 1);
  assert.deepEqual(result.toolCalls[0].input, { path: 'fixture.ts' });
  assert.equal(result.toolCalls[0].toolCallId, intent.id);
  assert.equal(result.toolResults.length, 0);
  assert.equal(result.finishReason, 'tool-calls');
  order.push('host-authorized-effect');
  assert.deepEqual(order, ['reserve', 'transport', 'host-authorized-effect']);
});

test('negative control: one step DOES auto-execute an attached execute callback', async () => {
  let effects = 0;
  const f = fixture(() => json(completion({ calls: [intent] })));
  const result = await run(f.model, { tools: { readFile: { ...tools.readFile, execute: async () => { effects++; return { synthetic: true }; } } } });
  assert.equal(effects, 1);
  assert.equal(result.toolResults.length, 1);
  assert.equal(f.requests.length, 1);
});

test('negative control: throwing onStepStart does NOT veto transport dispatch', async () => {
  const f = fixture(() => json(completion()));
  const result = await run(f.model, { onStepStart: () => { throw new Error('Synthetic reservation denial'); } });
  assert.equal(result.text, 'fixture response');
  assert.equal(f.requests.length, 1);
});

test('maxRetries zero preserves one attempt on transient HTTP failure', async () => {
  const f = fixture(() => new Response(JSON.stringify({ object: 'error', message: 'synthetic transient', type: 'server_error', param: null, code: null }), { status: 503 }));
  await assert.rejects(run(f.model), error => error.statusCode === 503);
  assert.equal(f.requests.length, 1);
});

test('maxRetries zero does not replay a thrown transport failure', async () => {
  const f = fixture(() => { throw new TypeError('Synthetic connection reset after dispatch'); });
  await assert.rejects(run(f.model));
  assert.equal(f.requests.length, 1);
});

test('abort is delivered to pending transport with no retry', async () => {
  const controller = new AbortController();
  let observed = false;
  let enter;
  const entered = new Promise(resolve => { enter = resolve; });
  const f = fixture(request => new Promise((resolve, reject) => {
    assert.ok(request.signal);
    request.signal.addEventListener('abort', () => { observed = true; reject(request.signal.reason); }, { once: true });
    enter();
  }));
  const pending = run(f.model, { abortSignal: controller.signal });
  await entered;
  controller.abort(new DOMException('Synthetic cancellation', 'AbortError'));
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(observed, true);
  assert.equal(f.requests.length, 1);
});

test('known token totals and provider raw usage survive', async () => {
  const f = fixture(() => json(completion()));
  const result = await run(f.model);
  assert.equal(result.usage.inputTokens, 13);
  assert.equal(result.usage.outputTokens, 7);
  assert.equal(result.usage.totalTokens, 20);
  assert.deepEqual(result.usage.raw, usage);
});

test('observed gap: absent nonstream usage is rejected, never silently replaced by zero', async () => {
  const response = completion();
  delete response.usage;
  const f = fixture(() => json(response));
  await assert.rejects(run(f.model), error => error.name === 'AI_APICallError' && error.message === 'Invalid JSON response');
  assert.equal(f.requests.length, 1);
});

test('serialized prior intent and host result continue through independently invoked step', async () => {
  const f = fixture((request, count) => json(count === 1 ? completion({ calls: [intent] }) : completion({ text: 'continued' })));
  const first = await run(f.model);
  const priorMessages = JSON.parse(JSON.stringify(first.response.messages));
  const messages = [{ role: 'user', content: 'synthetic task' }, ...priorMessages, { role: 'tool', content: [{ type: 'tool-result', toolCallId: intent.id, toolName: 'readFile', output: { type: 'json', value: { text: 'host-approved synthetic result' } } }] }];
  const second = await run(f.model, { prompt: undefined, messages });
  assert.equal(second.text, 'continued');
  assert.equal(f.requests.length, 2);
  const last = f.requests[1].body.messages.at(-1);
  assert.equal(last.role, 'tool');
  assert.equal(last.tool_call_id, intent.id);
  assert.match(last.content, /host-approved synthetic result/);
});

test('streaming completion without usage preserves unknown totals', async () => {
  const chunk = { id: 'fixture-stream', created: 1, model: 'fixture-model', choices: [{ index: 0, delta: { content: 'fixture stream text' }, finish_reason: 'stop' }] };
  const f = fixture(() => new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } }));
  const result = streamText({ model: f.model, prompt: 'synthetic task', maxRetries: 0 });
  assert.equal(await result.text, 'fixture stream text');
  assert.equal((await result.usage).inputTokens, undefined);
  assert.equal((await result.usage).outputTokens, undefined);
  assert.equal((await result.usage).totalTokens, undefined);
  assert.equal(f.requests.length, 1);
});

test('raw adapter retains exact malformed intent before any effect or core normalization', async () => {
  const malformed = { ...intent, function: { ...intent.function, arguments: '{untrusted malformed JSON' } };
  const f = fixture(() => json(completion({ calls: [malformed] })));
  const result = await f.model.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'synthetic task' }] }], tools: [{ type: 'function', name: 'readFile', inputSchema: { type: 'object' } }] });
  const raw = result.content.find(part => part.type === 'tool-call');
  assert.equal(raw.input, malformed.function.arguments);
  assert.equal(raw.toolCallId, intent.id);
  assert.equal(f.requests.length, 1);
});

test('raw core response capture retains exact argument text while continuation normalizes it', async () => {
  const spaced = { ...intent, function: { ...intent.function, arguments: '{ "path" : "fixture.ts" }' } };
  const f = fixture(() => json(completion({ calls: [spaced] })));
  const result = await run(f.model, { include: { requestBody: true, requestMessages: true, responseBody: true } });
  assert.equal(result.response.body.choices[0].message.tool_calls[0].function.arguments, spaced.function.arguments);
  assert.deepEqual(result.toolCalls[0].input, { path: 'fixture.ts' });
  assert.equal(result.toolResults.length, 0);
  assert.ok(result.request.body);
});

test('direct adapter resumes a host-normalized prior intent/result with no tool loop', async () => {
  const f = fixture((request, count) => json(count === 1 ? completion({ calls: [intent] }) : completion({ text: 'direct continued' })));
  const initialPrompt = [{ role: 'user', content: [{ type: 'text', text: 'synthetic task' }] }];
  const first = await f.model.doGenerate({ prompt: initialPrompt });
  const raw = first.content.find(part => part.type === 'tool-call');
  // Host-owned validation/normalization must occur before converting raw input back to prompt input.
  const validated = z.object({ path: z.string() }).strict().parse(JSON.parse(raw.input));
  const prompt = [...initialPrompt, { role: 'assistant', content: [{ type: 'tool-call', toolCallId: raw.toolCallId, toolName: raw.toolName, input: validated }] }, { role: 'tool', content: [{ type: 'tool-result', toolCallId: raw.toolCallId, toolName: raw.toolName, output: { type: 'json', value: { text: 'host-owned result' } } }] }];
  const second = await f.model.doGenerate({ prompt });
  assert.equal(second.content.find(part => part.type === 'text').text, 'direct continued');
  assert.equal(second.usage.inputTokens.total, 13);
  assert.deepEqual(second.usage.raw, usage);
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].body.messages.at(-1).tool_call_id, intent.id);
});

test('direct adapter transient failure has no core retry layer', async () => {
  const f = fixture(() => new Response('synthetic service unavailable', { status: 503 }));
  await assert.rejects(f.model.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'synthetic task' }] }] }));
  assert.equal(f.requests.length, 1);
});

test('core marks malformed intent invalid without executing or repairing it', async () => {
  const malformed = { ...intent, function: { ...intent.function, arguments: '{bad JSON' } };
  const f = fixture(() => json(completion({ calls: [malformed] })));
  const result = await run(f.model);
  assert.equal(result.toolCalls[0].invalid, true);
  assert.equal(result.toolResults.length, 0);
  assert.equal(f.requests.length, 1);
});

test('negative control: jsonSchema without a validator does not enforce semantic input shape', async () => {
  const wrongShape = { ...intent, function: { ...intent.function, arguments: '{"path":42,"extra":"untrusted"}' } };
  const f = fixture(() => json(completion({ calls: [wrongShape] })));
  const result = await run(f.model);
  assert.notEqual(result.toolCalls[0].invalid, true);
  assert.deepEqual(result.toolCalls[0].input, { path: 42, extra: 'untrusted' });
  assert.equal(result.toolResults.length, 0);
});

test('validated schema rejects semantic input violations before any effect', async () => {
  const wrongShape = { ...intent, function: { ...intent.function, arguments: '{"path":42,"extra":"untrusted"}' } };
  const f = fixture(() => json(completion({ calls: [wrongShape] })));
  const result = await run(f.model, { tools: { readFile: { inputSchema: z.object({ path: z.string() }).strict() } } });
  assert.equal(result.toolCalls[0].invalid, true);
  assert.equal(result.toolResults.length, 0);
  assert.equal(f.requests.length, 1);
});

test('observed gap: SDK accepts response and request beyond a 1 MiB application byte budget', async () => {
  const largeText = 'x'.repeat(2 * 1024 * 1024);
  const f = fixture(() => json(completion({ text: largeText })));
  const result = await run(f.model, { prompt: largeText });
  assert.equal(result.text.length, largeText.length);
  assert.ok(Buffer.byteLength(JSON.stringify(f.requests[0].body)) > 1024 * 1024);
});

test('observed gap: API errors retain synthetic private request, response and header fields', async () => {
  const f = fixture(() => new Response(JSON.stringify({ object: 'error', message: 'SYNTHETIC_PRIVATE_ERROR', type: 'server_error', param: null, code: null }), { status: 503, headers: { 'x-fixture-private': 'SYNTHETIC_PRIVATE_HEADER' } }));
  let captured;
  try { await run(f.model, { prompt: 'SYNTHETIC_PRIVATE_PROMPT' }); } catch (error) { captured = error; }
  assert.ok(captured);
  assert.match(captured.message, /SYNTHETIC_PRIVATE_ERROR/);
  assert.match(captured.responseBody, /SYNTHETIC_PRIVATE_ERROR/);
  assert.equal(captured.responseHeaders['x-fixture-private'], 'SYNTHETIC_PRIVATE_HEADER');
  assert.match(JSON.stringify(captured.requestBodyValues), /SYNTHETIC_PRIVATE_PROMPT/);
  // An illustrative host allowlist, not an adopted application implementation.
  const safeDiagnostic = { kind: 'provider_failed', statusCode: captured.statusCode, retryable: captured.isRetryable };
  assert.equal(JSON.stringify(safeDiagnostic).includes('SYNTHETIC_PRIVATE'), false);
});
