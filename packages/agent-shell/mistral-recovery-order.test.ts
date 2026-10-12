import assert from 'node:assert/strict';
import { test } from 'node:test';
import { identity, validateCapturedPrompt, validatePhysicalRequest } from '../contracts/index.ts';
import type { JsonValue, PhysicalRequest, PromptFragment, ShellBridge, ShellInput } from '../contracts/index.ts';
import { SHELL_REVISION } from './index.ts';
import { digest, emptyUsage, mistralPayload, createMistralTransport, mistralModel } from './mistral.ts';
import { createTestShell } from './tool-instructions.test-fixture.ts';
import { normalizeContext } from './vendor/pi/ai/index.ts';
import type { AssistantMessage, Message, ToolResultMessage } from './vendor/pi/ai/types.ts';

const tool = { name: 'workspace_read', description: 'Read an owned source file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } };
const thinking = { type: 'thinking', thinking: [{ type: 'text', text: 'fixture reasoning', marker: 'retained-native' }] };
function assistant(ids = ['read0001', 'read0002', 'read0003', 'read0004']): AssistantMessage & { aeonStepId: string } {
  return { role: 'assistant', api: 'mistral-chat-completions', provider: 'mistral', model: 'fixture', timestamp: 0, usage: emptyUsage(), stopReason: 'toolUse', aeonStepId: 'settled-step', content: [
    { type: 'thinking', thinking: 'fixture reasoning', thinkingSignature: `mistral-chunk:${JSON.stringify(thinking)}` },
    { type: 'text', text: 'Inspect the source.' },
    ...ids.map(id => ({ type: 'toolCall' as const, id, name: tool.name, arguments: { path: `${id}.ts` } })),
  ] };
}
function result(id: string): ToolResultMessage & { aeonStepId: string } {
  return { role: 'toolResult', toolCallId: id, toolName: tool.name, timestamp: 0, isError: false, aeonStepId: 'settled-step', content: [{ type: 'text', text: `${id}: first record` }, { type: 'text', text: `${id}: second record` }] };
}
const user = (content: string): Message => ({ role: 'user', content, timestamp: 0 });
const payload = (messages: Message[]) => JSON.parse(mistralPayload(normalizeContext({ systemPrompt: 'fixture identity', tools: [tool], messages }), 'fixture', 8192, 'high'));

function validOrder(messages: { role: string; tool_calls?: { id: string }[]; tool_call_id?: string }[]): boolean {
  let pending = new Set<string>();
  for (const message of messages) {
    if (message.role === 'tool') {
      if (!message.tool_call_id || !pending.delete(message.tool_call_id)) return false;
    } else {
      if (pending.size) return false;
      if (message.role === 'assistant') pending = new Set((message.tool_calls ?? []).map(call => call.id));
    }
  }
  return pending.size === 0;
}

test('Mistral groups a complete resumed batch before deferred users without changing native content or inputs', () => {
  const messages = [assistant(), result('read0001'), user('host update one'), result('read0002'), user('host update two'), result('read0003'), result('read0004')];
  const original = structuredClone(messages);
  const body = payload(messages);
  assert.equal(validOrder(body.messages), true);
  assert.deepEqual(body.messages.map((item: { role: string }) => item.role), ['system', 'assistant', 'tool', 'tool', 'tool', 'tool', 'user', 'user']);
  assert.deepEqual(body.messages.slice(-2).map((item: { content: string }) => item.content), ['host update one', 'host update two']);
  assert.deepEqual(body.messages[1].content, [thinking, { type: 'text', text: 'Inspect the source.' }]);
  for (let i = 1; i <= 4; i++) assert.equal(body.messages[i + 1].content, `read000${i}: first record\nread000${i}: second record`);
  assert.deepEqual(body.tools, [{ type: 'function', function: tool }]);
  assert.equal(body.reasoning_effort, 'high');
  assert.deepEqual(messages, original);
});

test('Mistral preserves an already valid order and independent batches with reused provider call IDs', () => {
  const second = { ...assistant(['read0001']), aeonStepId: 'second-step' };
  const messages = [user('start'), assistant(['read0001']), result('read0001'), user('continue'), second, { ...result('read0001'), aeonStepId: 'second-step' }, user('latest')];
  const original = structuredClone(messages);
  const body = payload(messages);
  assert.deepEqual(body.messages.slice(1).map((item: { role: string }) => item.role), messages.map(item => item.role === 'toolResult' ? 'tool' : item.role));
  assert.equal(validOrder(body.messages), true);
  assert.deepEqual(messages, original);
});

test('Mistral rejects incomplete, duplicate, unmatched, misbound and truncated tool batches locally', async () => {
  const one = assistant(['read0001']);
  const cases: Message[][] = [
    [one, user('new host frame')],
    [one, result('read0001'), user('new host frame'), result('read0001')],
    [one, result('other-call')],
    [result('read0001')],
    [one, { ...result('read0001'), toolName: 'different_tool' }],
    [one, { ...result('read0001'), aeonStepId: 'another-step' }],
    [one, { ...assistant(['read0002']), aeonStepId: 'another-step' }, result('read0001'), { ...result('read0002'), aeonStepId: 'another-step' }],
    [{ ...one, stopReason: 'length' }, result('read0001')],
    [assistant(['read0001', 'read0001']), result('read0001')],
  ];
  let reserved = 0; let fetched = 0;
  const transport = createMistralTransport({ apiKey: () => 'fixture-key', maxRequests: 1,
    environment: { wallNow: () => 0, monotonicNow: () => 0, newId: () => 'unused', scheduleTimeout: () => () => {} },
    reserve: async () => { reserved++; }, dispatched: async () => {}, settle: async () => {},
    fetch: async () => { fetched++; return Response.json({}); },
  });
  for (const messages of cases) {
    const original = structuredClone(messages);
    assert.throws(() => payload(messages), /Mistral tool/);
    assert.equal((await (await transport.stream(mistralModel(), normalizeContext({ messages }))).result()).stopReason, 'error');
    assert.deepEqual(messages, original);
  }
  assert.equal(reserved, 0); assert.equal(fetched, 0);
});

test('real shell resumes the 73-message recovered shape with a valid Mistral request, no settled replay and full durable history', async () => {
  const failed: AssistantMessage & { aeonStepId: string } = { ...assistant([]), content: [], stopReason: 'error', aeonStepId: 'failed-request', errorMessage: 'prior provider order failure' };
  const history: Message[] = [...Array.from({ length: 66 }, (_, index) => user(`retained input ${index}`)), assistant(), result('read0001'), result('read0002'), result('read0003'), user('historical host frame'), result('read0004'), failed];
  assert.equal(history.length, 73);
  assert.equal(validOrder([{ role: 'assistant', tool_calls: ['read0001', 'read0002', 'read0003', 'read0004'].map(id => ({ id })) }, { role: 'tool', tool_call_id: 'read0001' }, { role: 'tool', tool_call_id: 'read0002' }, { role: 'tool', tool_call_id: 'read0003' }, { role: 'user' }, { role: 'tool', tool_call_id: 'read0004' }]), false);
  const observationIds = ['obs1', 'obs2', 'obs3', 'obs4'];
  const snapshot = { schema: SHELL_REVISION, provider: 'mistral', messages: history, observationIds, status: 'blocked', compactions: [] } as unknown as JsonValue;
  const original = structuredClone(snapshot);
  const artifacts = new Map<string, JsonValue>([[identity(snapshot), snapshot]]);
  const requests: PhysicalRequest[] = []; const captured: string[] = []; let replayed = 0; let http400 = 0;
  const bridge: ShellBridge = {
    async execute() { replayed++; throw Error('settled tool must not replay'); },
    async persistCheckpoint(runId, revision, shell, content) {
      const sha256 = identity(content); artifacts.set(sha256, structuredClone(content));
      return { runId, revision, shell, artifact: { uri: `fixture:${sha256}`, sha256 }, observationIds: (content as { observationIds: string[] }).observationIds };
    },
    async readCheckpoint(checkpoint) { return artifacts.get(checkpoint.artifact.sha256)!; },
    async capturePrompt(manifest, content) { validateCapturedPrompt(manifest, content); captured.push(content); },
    async reserve(request) { validatePhysicalRequest(request); requests.push(request); },
    async dispatched(request) { requests[requests.length - 1] = request; },
    async settle(request) { validatePhysicalRequest(request); requests[requests.length - 1] = request; },
  };
  const fragment: PromptFragment = { id: 'fixture-identity', owner: 'self', role: 'system', order: 0, artifact: { uri: 'fixture:identity', sha256: digest('fixture identity') }, scope: { kind: 'public' }, replaceable: true, derivedFrom: [] };
  const input: ShellInput = { run: { id: 'recovered-run', status: 'running', revision: 1, authority: { generation: 'same-generation', epoch: 1, controlRevision: 'same-control' }, scope: { kind: 'public' } }, messages: [user('current host frame')] as unknown as JsonValue[], prompt: { id: 'current-prompt', fragments: [fragment], requestDigest: identity('not dispatched') }, checkpoint: { runId: 'recovered-run', revision: 1, shell: SHELL_REVISION, artifact: { uri: `fixture:${identity(snapshot)}`, sha256: identity(snapshot) }, observationIds } };
  let id = 0;
  const shell = createTestShell({ tools: [tool], resolveFragment: async () => 'fixture identity', apiKey: () => 'fixture-key', maxRequests: 1,
    environment: { wallNow: () => 0, monotonicNow: () => 0, newId: () => `fixture-${++id}`, scheduleTimeout: () => () => {} },
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (!validOrder(body.messages)) { http400++; return Response.json({ error: { code: 3230, message: 'Unexpected role tool after user' } }, { status: 400 }); }
      assert.deepEqual(body.messages.slice(-2).map((item: { content: string }) => item.content), ['historical host frame', 'current host frame']);
      return Response.json({ model: 'fixture', choices: [{ finish_reason: 'stop', message: { content: 'continued reasoning accepted', tool_calls: null } }], usage: { prompt_tokens: 12, completion_tokens: 3 } });
    },
  });
  const resumed = await shell.run(input, bridge);
  assert.equal(resumed.status, 'completed'); assert.equal(http400, 0); assert.equal(replayed, 0);
  assert.equal(captured.length, 1); assert.equal(requests.length, 1); assert.equal(requests[0].purpose, 'reasoning'); assert.equal(requests[0].status, 'succeeded');
  const saved = await bridge.readCheckpoint(resumed.checkpoint!) as unknown as { messages: Message[]; observationIds: string[] };
  assert.deepEqual(saved.messages.slice(0, history.length), history);
  assert.deepEqual(saved.observationIds, observationIds);
  assert.deepEqual(snapshot, original);
});
