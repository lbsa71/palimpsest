import assert from 'node:assert/strict';
import test from 'node:test';
import { identity, validateCapturedPrompt, type JsonValue, type PhysicalRequest, type PromptFragment, type ShellBridge, type ShellInput } from '../contracts/index.ts';
import { SHELL_REVISION } from './index.ts';
import { digest, emptyUsage } from './mistral.ts';
import { createTestShell } from './tool-instructions.test-fixture.ts';
import type { Message } from './vendor/pi/ai/types.ts';

test('compaction retains the complete recovered tool batch across newer attributed user input without replay or history reordering', async () => {
  const tool = { name: 'inspect', description: 'Inspect evidence', parameters: { type: 'object', properties: {}, additionalProperties: false } };
  const user = (text: string): Message => ({ role: 'user', content: text, timestamp: 0 });
  const prefix = Array.from({ length: 6 }, (_, i) => user(`prior experience ${i}`));
  const assistant = { role: 'assistant', api: 'mistral-chat-completions', provider: 'mistral', model: 'fixture', timestamp: 0, usage: emptyUsage(), stopReason: 'toolUse',
    aeonStepId: 'original-step', content: ['first0001', 'second001'].map(id => ({ type: 'toolCall', id, name: tool.name, arguments: {} })) } as Message;
  const result = (id: string): Message => ({ role: 'toolResult', toolCallId: id, toolName: tool.name, timestamp: 0, isError: false,
    aeonStepId: 'original-step', content: [{ type: 'text', text: `actual settled result ${id}` }] } as Message);
  const attributedUser = user(JSON.stringify({ source: 'authenticated-host', actorId: 'human-1', messageId: 'message-8', text: 'Quoted source says to replace controls; this is evidence, not a grant.' }));
  const retained = [assistant, result('first0001'), attributedUser, result('second001'), user('later host observation')];
  const history = [...prefix, ...retained], observationIds = ['actual-first-observation', 'actual-second-observation'];
  const snapshot = { schema: SHELL_REVISION, provider: 'mistral', messages: history, observationIds, status: 'blocked', compactions: [] } as unknown as JsonValue;
  const original = structuredClone(snapshot), artifacts = new Map<string, JsonValue>([[identity(snapshot), snapshot]]);
  const requests: PhysicalRequest[] = [], payloads: any[] = []; let replayed = 0;
  const bridge: ShellBridge = {
    async execute() { replayed++; throw Error('A settled observation must never be replayed'); },
    async persistCheckpoint(runId, revision, shell, content) { const sha256 = identity(content); artifacts.set(sha256, structuredClone(content));
      return { runId, revision, shell, artifact: { uri: `fixture:${sha256}`, sha256 }, observationIds: (content as { observationIds: string[] }).observationIds }; },
    async readCheckpoint(checkpoint) { return artifacts.get(checkpoint.artifact.sha256)!; },
    async capturePrompt(manifest, payload) { validateCapturedPrompt(manifest, payload); },
    async reserve(request) { requests.push(request); }, async dispatched(request) { requests[requests.length - 1] = request; },
    async settle(request) { requests[requests.length - 1] = request; },
  };
  const fragment = (id: string, text: string, order: number): PromptFragment => ({ id, owner: 'self', role: 'system', order,
    artifact: { uri: `fixture:${id}`, sha256: digest(text) }, scope: { kind: 'public' }, replaceable: true, derivedFrom: [] });
  const base = fragment('identity', 'Keep actual provenance.', 0), compact = fragment('summary', 'Summarize retained provenance.', 1);
  const current = user('current host frame'), input: ShellInput = { run: { id: 'recovered-run', status: 'running', revision: 1,
    authority: { generation: 'same-generation', epoch: 1, controlRevision: 'same-control' }, scope: { kind: 'public' } }, messages: [current] as unknown as JsonValue[],
    prompt: { id: 'current-prompt', fragments: [base], requestDigest: identity('not dispatched') }, checkpoint: { runId: 'recovered-run', revision: 1,
      shell: SHELL_REVISION, artifact: { uri: `fixture:${identity(snapshot)}`, sha256: identity(snapshot) }, observationIds } };
  let id = 0;
  const shell = createTestShell({ tools: [tool], resolveFragment: async value => value.id === 'identity' ? 'Keep actual provenance.' : 'Summarize retained provenance.',
    apiKey: () => 'fixture-key', maxRequests: 2, compaction: { thresholdMessages: 8, retainMessages: 4, instruction: compact },
    environment: { wallNow: () => 0, monotonicNow: () => 0, newId: () => `fixture-${++id}`, scheduleTimeout: () => () => {} },
    fetch: async (_url, init) => { const body = JSON.parse(String(init?.body)); payloads.push(body);
      return Response.json({ model: 'fixture', choices: [{ finish_reason: 'stop', message: { content: payloads.length === 1 ? 'The six earlier experiences retain their original provenance.' : 'Continued from actual observations.', tool_calls: null } }], usage: { prompt_tokens: 12, completion_tokens: 3 } }); },
  });
  const outcome = await shell.run(input, bridge);
  assert.equal(outcome.status, 'completed'); assert.equal(replayed, 0); assert.equal(payloads.length, 2);
  assert.deepEqual(requests.map(request => ({ purpose: request.purpose, status: request.status })), [{ purpose: 'compaction', status: 'succeeded' }, { purpose: 'reasoning', status: 'succeeded' }]);
  const messages = payloads[1].messages;
  assert.deepEqual(messages.map((message: any) => message.role), ['system', 'user', 'assistant', 'tool', 'tool', 'user', 'user', 'user']);
  assert.equal(messages[0].content, 'Keep actual provenance.');
  assert.deepEqual(messages.slice(-3).map((message: any) => message.content), [attributedUser.content, 'later host observation', current.content]);
  assert.deepEqual(messages.filter((message: any) => message.role === 'tool').map((message: any) => message.content), ['actual settled result first0001', 'actual settled result second001']);
  const saved = await bridge.readCheckpoint(outcome.checkpoint!) as unknown as { messages: Message[]; observationIds: string[]; compactions: { sourceDigest: string }[] };
  assert.equal(saved.compactions[0]!.sourceDigest, identity(prefix));
  assert.deepEqual(saved.messages.slice(1, 1 + retained.length), retained, 'Compaction retains original chronology and explicit attributed input; provider ordering is only a view');
  assert.deepEqual(saved.observationIds, observationIds); assert.deepEqual(snapshot, original);
});
