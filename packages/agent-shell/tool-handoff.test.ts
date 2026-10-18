import assert from 'node:assert/strict';
import test from 'node:test';
import { identity, type JsonValue, type Observation, type PhysicalRequest, type ShellBridge, type ShellInput, type ToolCall } from '../contracts/index.ts';
import { createTestShell } from './tool-instructions.test-fixture.ts';
import { digest } from './mistral.ts';

const input: ShellInput = { run: { id: 'handoff', revision: 1, status: 'running', authority: { generation: 'g', epoch: 1, controlRevision: 'c' }, scope: { kind: 'public' } }, messages: [{ role: 'user', content: 'Delegate and inspect', timestamp: 0 }], prompt: { id: 'p', fragments: [], requestDigest: identity('p') } };
const tools = ['code', 'inspect'].map(name => ({ name, description: name, parameters: { type: 'object', properties: {}, additionalProperties: false } }));
const call = (name: string) => ({ id: `call-${name}`, type: 'function', function: { name, arguments: '{}' } });
const reply = (calls: unknown[] = []) => Response.json({ model: 'fixture-v1', choices: [{ finish_reason: calls.length ? 'tool_calls' : 'stop', message: { content: calls.length ? null : 'Inspected result', ...(calls.length ? { tool_calls: calls } : {}) } }], usage: { prompt_tokens: 5, completion_tokens: 2 } });

function fixture(options: { outcome?: 'result' | 'error' | 'uncertain' | 'foreign'; handoff?: string[]; compact?: boolean; crashAfterCode?: boolean } = {}) {
  let sequence = 0, requests = 0, effects = 0, crashed = false;
  const artifacts = new Map<string, JsonValue>(), settled = new Map<string, PhysicalRequest>(), cache = new Map<string, Observation>(), calls: ToolCall[] = [], payloads: string[] = [];
  const bridge: ShellBridge = {
    async execute(call) {
      calls.push(call);
      let observation = cache.get(call.id);
      if (!observation) { effects++; observation = { id: `observation:${call.id}`, runId: options.outcome === 'foreign' ? 'other-run' : call.runId, stepId: call.stepId, sourceId: call.id, kind: call.name === 'code' && options.outcome && options.outcome !== 'foreign' ? options.outcome : 'result', value: call.name === 'code' ? 'coding turn queued' : 'inspected sibling', provenance: { sourceIds: [call.id], actorId: 'fixture', recordedAt: '1970-01-01T00:00:00.000Z', derivation: 'observed' } }; cache.set(call.id, observation); }
      if (options.crashAfterCode && call.name === 'code' && !crashed) { crashed = true; throw Error('Lost tool reply after the known effect completed'); }
      return observation;
    },
    async capturePrompt() {}, async reserve(request) { settled.set(request.id, request); }, async dispatched(request) { settled.set(request.id, request); }, async settle(request) { settled.set(request.id, request); },
    async persistCheckpoint(runId, revision, shell, content) { const sha256 = identity(content); artifacts.set(sha256, structuredClone(content)); return { runId, revision, shell, artifact: { uri: `fixture:${sha256}`, sha256 }, observationIds: (content as { observationIds: string[] }).observationIds }; },
    async readCheckpoint(checkpoint) { return artifacts.get(checkpoint.artifact.sha256)!; },
  };
  const shell = createTestShell({ model: 'fixture-v1', tools, finishAfterSuccessfulTools: options.handoff ?? ['code'], maxRequests: 12, apiKey: () => 'fixture',
    environment: { wallNow: () => 0, monotonicNow: () => 0, newId: () => `id-${++sequence}`, scheduleTimeout: () => () => {} },
    resolveFragment: async () => 'Summarize retained observations',
    ...(options.compact ? { compaction: { thresholdMessages: 4, retainMessages: 1, instruction: { id: 'summary', owner: 'application', role: 'system' as const, order: 0, artifact: { uri: 'fixture:summary', sha256: digest('Summarize retained observations') }, scope: { kind: 'public' as const }, replaceable: true, derivedFrom: [] } } } : {}),
    fetch: async (_url, init) => { requests++; payloads.push(String(init?.body)); return requests === 1 ? reply([call('code'), call('inspect')]) : reply(); },
  });
  return { shell, bridge, calls, settled, payloads, requests: () => requests, effects: () => effects };
}

test('successful handoff saves the entire assistant batch before a second model request and does not yield old calls again', async () => {
  const f = fixture();
  const first = await f.shell.run(input, f.bridge);
  assert.equal(first.status, 'completed'); assert.equal(f.requests(), 1); assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls.map(call => call.name), ['code', 'inspect']); assert.equal(first.observations.length, 2);
  const snapshot = await f.bridge.readCheckpoint(first.checkpoint!) as unknown as { messages: { role: string }[]; status: string };
  assert.equal(snapshot.status, 'completed'); assert.equal(snapshot.messages.filter(m => m.role === 'toolResult').length, 2);
  const prior = structuredClone([...f.settled.values()]);
  const next = await f.shell.run({ ...input, checkpoint: first.checkpoint, messages: [{ role: 'user', content: 'coding result ready: review it now', timestamp: 1 }] }, f.bridge);
  assert.equal(next.status, 'completed'); assert.equal(f.requests(), 2); assert.equal(f.calls.length, 2); assert.equal(f.effects(), 2);
  assert.match(f.payloads[1], /coding result ready/); assert.match(f.payloads[1], /coding turn queued/); assert.match(f.payloads[1], /inspected sibling/);
  assert.deepEqual([...f.settled.values()].slice(0, 1), prior);
});

test('a handoff yields before context compaction triggered by its completed batch', async () => {
  const f = fixture({ compact: true });
  const result = await f.shell.run({ ...input, messages: [0, 1, 2].map(i => ({ role: 'user', content: `detail-${i}`, timestamp: i })) }, f.bridge);
  assert.equal(result.status, 'completed'); assert.equal(f.requests(), 1); assert.equal(f.calls.length, 2);
  assert.deepEqual([...f.settled.values()].map(r => r.purpose), ['reasoning']);
});

for (const outcome of ['error', 'uncertain', 'foreign'] as const) test(`${outcome} tool result does not produce a successful handoff`, async () => {
  const f = fixture({ outcome });
  const result = await f.shell.run(input, f.bridge);
  assert.equal(result.status, outcome === 'error' ? 'completed' : 'blocked');
  assert.equal(f.requests(), outcome === 'error' ? 2 : 1);
  assert.equal(f.calls.length, outcome === 'error' ? 2 : 1);
});

test('without a configured handoff the ordinary tool loop continues', async () => {
  const f = fixture({ handoff: [] }); assert.equal((await f.shell.run(input, f.bridge)).status, 'completed'); assert.equal(f.requests(), 2);
});

test('recovery of an old committed enqueue consumes new coding-result input instead of yielding again', async () => {
  const f = fixture({ crashAfterCode: true });
  const first = await f.shell.run(input, f.bridge); assert.equal(first.status, 'blocked'); assert.equal(f.requests(), 1); assert.equal(f.effects(), 1);
  const next = await f.shell.run({ ...input, checkpoint: first.checkpoint, messages: [{ role: 'user', content: 'coding result arrived after the lost reply', timestamp: 1 }] }, f.bridge);
  assert.equal(next.status, 'completed'); assert.equal(f.requests(), 2); assert.equal(f.effects(), 2); assert.equal(f.calls.length, 3);
  assert.equal(f.calls[0].id, f.calls[1].id); assert.match(f.payloads[1], /coding result arrived after/); assert.match(f.payloads[1], /coding turn queued/);
});
