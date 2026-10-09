// Historical broad probe: expected nonzero for malformed required-object absence.
// This is not a requirement to relax the provider's documented success schema.
import assert from 'node:assert/strict';
import { generateText } from 'ai';
import { createMistral } from '@ai-sdk/mistral';
globalThis.fetch = async () => { throw new Error('Unmocked network forbidden'); };
const response = { id: 'fixture', object: 'chat.completion', model: 'fixture-model', created: 1, choices: [{ index: 0, message: { role: 'assistant', content: 'synthetic' }, finish_reason: 'stop' }] };
const model = createMistral({ apiKey: 'synthetic-fixture-key', fetch: async () => new Response(JSON.stringify(response), { headers: { 'content-type': 'application/json' } }) })('fixture-model');
try {
  const result = await generateText({ model, prompt: 'synthetic', maxRetries: 0 });
  assert.equal(result.usage.totalTokens, undefined);
} catch {
  // Never print the SDK error: it can embed private request/response content.
  console.error('UNMET: absent nonstream usage must remain unknown; pinned adapter rejects it.');
  process.exitCode = 1;
}
