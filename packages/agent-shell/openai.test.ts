import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenAITransport, openaiModel, openaiOutput } from './openai.ts';
import { normalizeContext } from './vendor/pi/ai/index.ts';
import type { AttemptOutcome } from './mistral.ts';
const context = normalizeContext({ messages: [{ role: 'user', content: 'Inspect and verify.', timestamp: 0 }] });
const valid = { id: 'resp_1', model: 'fixture-v1', status: 'completed', output: [{ id: 'rs_1', type: 'reasoning', summary: [], encrypted_content: 'opaque_cipher' }, { id: 'msg_1', type: 'message', role: 'assistant', phase: 'final_answer', status: 'completed', content: [{ type: 'output_text', text: 'Verified.', annotations: [] }] }], usage: { input_tokens: 8, output_tokens: 12, output_tokens_details: { reasoning_tokens: 10 } } };
function transport(fetcher: typeof fetch, retries = 0) {
  const ids: string[] = []; const outcomes: AttemptOutcome[] = [];
  return { ids, outcomes, value: createOpenAITransport({ model: 'fixture-v1', apiKey: () => 'secret-fixture', modelProfile: { contextWindow: 128000, reasoning: true }, reasoningEffort: 'high', maxRequests: 3, maxRetries: retries, fetch: fetcher,
    async reserve(attempt) { ids.push(attempt.id); assert.ok(!attempt.payload.includes('secret-fixture')); }, async dispatched() {}, async settle(_attempt, outcome) { outcomes.push(structuredClone(outcome)); } }) };
}
test('Responses sends explicit stateless profile and counts all output tokens including reasoning without double counting', async () => {
  const t = transport(async (url, init) => { assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal(init?.redirect, 'error'); const payload = JSON.parse(String(init?.body)); assert.equal(payload.model, 'fixture-v1'); assert.deepEqual(payload.reasoning, { effort: 'high' }); assert.equal(payload.store, false); assert.deepEqual(payload.include, ['reasoning.encrypted_content']); return Response.json(valid); });
  const reply = await (await t.value.stream(openaiModel('fixture-v1'), context)).result(); assert.equal(reply.stopReason, 'stop'); assert.deepEqual(reply.openaiOutput, valid.output); assert.equal(reply.usage.output, 12); assert.equal(reply.usage.totalTokens, 20); assert.deepEqual(t.outcomes[0].usage, { inputTokens: 8, outputTokens: 12 });
});
for (const [name, body] of [
  ['unknown hosted tool', { ...valid, output: [{ type: 'web_search_call', id: 'ws_1' }] }],
  ['missing encrypted reasoning', { ...valid, output: [{ type: 'reasoning', id: 'rs_1', summary: [] }] }],
  ['invalid function JSON', { ...valid, output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'inspect', arguments: '[]' }] }],
  ['commentary without final or tool call', { ...valid, output: [{ ...valid.output[1], phase: 'commentary' }] }],
  ['invalid phase', { ...valid, output: [{ ...valid.output[1], phase: 'unknown' }] }],
  ['partial response with complete-looking tool', { ...valid, status: 'incomplete', output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'inspect', arguments: '{}' }] }],
  ['negative usage', { ...valid, usage: { input_tokens: -1, output_tokens: 12 } }],
] as const) test(`Responses rejects ${name} before producing usable tools/history`, async () => {
  const t = transport(async () => Response.json(body)); const reply = await (await t.value.stream(openaiModel('fixture-v1'), context)).result(); assert.equal(reply.stopReason, 'error'); assert.deepEqual(reply.content, []); assert.equal(reply.openaiOutput, undefined); assert.equal(t.outcomes[0].status, 'failed'); assert.equal(t.ids.length, 1);
  if (name !== 'negative usage') assert.deepEqual(t.outcomes[0].usage, { inputTokens: 8, outputTokens: 12 });
});
test('Responses missing usage remains unknown; 429 retry reserves a new request; network/5xx never retry or leak failures', async () => {
  let calls = 0; const t = transport(async () => ++calls === 1 ? new Response('', { status: 429 }) : Response.json({ ...valid, usage: undefined }), 2);
  const reply = await (await t.value.stream(openaiModel('fixture-v1'), context)).result(); assert.equal(reply.stopReason, 'stop'); assert.equal(new Set(t.ids).size, 2); assert.deepEqual(t.outcomes.map(value => value.status), ['failed', 'completed']); assert.equal(t.outcomes[1].usage, undefined);
  for (const fetcher of [(async () => { throw Error('secret-fixture in exception'); }) as typeof fetch, (async () => new Response('secret-fixture', { status: 503 })) as typeof fetch]) {
    const failed = transport(fetcher, 2); const result = await (await failed.value.stream(openaiModel('fixture-v1'), context)).result(); assert.equal(failed.ids.length, 1); assert.equal(failed.outcomes[0].status, 'uncertain'); assert.ok(!JSON.stringify(result).includes('secret-fixture'));
  }
});
test('Responses endpoint overrides and duplicate native function identities are rejected', () => {
  assert.throws(() => createOpenAITransport({ apiKey: () => 'secret', maxRequests: 1, endpoint: 'https://unqualified.example/v1/responses', async reserve() {}, async dispatched() {}, async settle() {} }), /allowlisted HTTPS/);
  const call = { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'inspect', arguments: '{}' }; assert.throws(() => openaiOutput([call, { ...call, id: 'fc_2' }]), /Invalid OpenAI function/);
});
