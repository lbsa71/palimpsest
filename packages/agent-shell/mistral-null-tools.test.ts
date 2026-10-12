import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMistralTransport, mistralModel, type AttemptOutcome } from './mistral.ts';
import { normalizeContext } from './vendor/pi/ai/index.ts';

async function completion(toolCalls: unknown, omitted = false) {
  const outcomes: AttemptOutcome[] = [];
  const transport = createMistralTransport({
    apiKey: () => 'synthetic-key', maxRequests: 1,
    environment: { wallNow: () => 0, monotonicNow: () => 0, newId: () => 'request-1', scheduleTimeout: () => () => {} },
    modelProfile: { contextWindow: 1_048_576, reasoning: true }, reasoningEffort: 'high',
    reserve: async () => {}, dispatched: async () => {}, settle: async (_attempt, outcome) => { outcomes.push(outcome); },
    fetch: async () => Response.json({ id: 'response-1', model: 'mistral-large-4-0',
      choices: [{ finish_reason: Array.isArray(toolCalls) && toolCalls.length ? 'tool_calls' : 'stop',
        message: { content: 'complete', ...(omitted ? {} : { tool_calls: toolCalls }) } }],
      usage: { prompt_tokens: 12, completion_tokens: 3 } }),
  });
  const stream = await transport.stream(mistralModel('mistral-large-4-0', { contextWindow: 1_048_576, reasoning: true }), normalizeContext({ messages: [] }));
  const message = await stream.result();
  return { message, outcomes };
}

test('Mistral null, omitted and empty tool calls complete without calls and settle measured usage', async () => {
  for (const [calls, omitted] of [[null, false], [undefined, true], [[], false]] as const) {
    const { message, outcomes } = await completion(calls, omitted);
    assert.equal(message.stopReason, 'stop');
    assert.deepEqual(message.content, [{ type: 'text', text: 'complete' }]);
    assert.equal(message.providerThinkingLevel, 'high');
    assert.deepEqual(outcomes, [{ status: 'completed', httpStatus: 200, usage: { inputTokens: 12, outputTokens: 3 } }]);
  }
});

test('Mistral valid tool calls retain their parsed function and arguments', async () => {
  const { message, outcomes } = await completion([{ id: 'call-1', type: 'function', function: { name: 'inspect', arguments: '{"path":"file.ts"}' } }]);
  assert.equal(message.stopReason, 'toolUse');
  assert.deepEqual(message.content.at(-1), { type: 'toolCall', id: 'call-1', name: 'inspect', arguments: { path: 'file.ts' } });
  assert.equal(outcomes[0]?.status, 'completed');
});

test('Mistral non-null nonarray tool calls remain invalid and never complete', async () => {
  for (const calls of [{}, 'call-1', 0, false]) {
    const { message, outcomes } = await completion(calls);
    assert.equal(message.stopReason, 'error');
    assert.equal(message.errorMessage, 'Invalid Mistral tool calls');
    assert.deepEqual(message.content, []);
    assert.notEqual(outcomes[0]?.status, 'completed');
  }
});
