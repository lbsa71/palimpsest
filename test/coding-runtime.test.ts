import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { AgentRuntime } from '../src/runtime.ts';
import { DirectCommunications } from '../src/communications.ts';
import { ConversationActions } from '../src/conversation-actions.ts';
import type { CompletionRequest, Provider } from '../src/providers.ts';
import type { Task } from '../src/store.ts';

test('eligible cognition selects a durable coding session before its reply is delivered', async () => {
  const store = new Store(':memory:'); const direct = new DirectCommunications();
  const observed: string[] = [];
  const provider: Provider = { name: 'fixture', async complete(request) {
    assert.match(request.system, /coding session/);
    return { text: JSON.stringify({ reply: 'I will inspect the failure and work on a repair.', disposition: 'code',
      rationale: 'The request needs iterative repository work.', proposal: null, coding: { objective: 'Repair the failing module.' } }),
      provider: 'fixture', model: 'fixture', usage: { inputTokens: 1, outputTokens: 1 } };
  } };
  const actions = new ConversationActions({ store, userIds: [], allowDirectOperator: true, sourceContext: () => 'Synthetic admitted context.' });
  const coding = {
    eligible: (task: Task) => task.source === 'direct',
    prepare: (_task: Task, request: CompletionRequest) => ({ ...request, system: request.system + '\nAn eligible request may select a coding session.' }),
    accept: async (task: Task, raw: string) => {
      const value = JSON.parse(raw); if (value.disposition !== 'code') return undefined;
      assert.equal(store.task(task.id)?.state, 'running');
      assert.equal(store.listEvents({ taskId: task.id }).filter(event => event.type === 'inference.started').length, 1);
      assert.equal(direct.messages('local').length, 0);
      store.appendEvent('coding.session.test_admitted', { objective: value.coding.objective }, task.id);
      observed.push(task.id); return 'The durable coding session is queued.';
    },
  };
  const runtime = new AgentRuntime(Object.assign({ store, provider, communications: [direct], conversationActions: actions }, { coding }));
  try {
    const task = await runtime.submit({ id: 'coding-request', source: 'direct', conversationId: 'local', text: 'Repair the failing module.' });
    await runtime.runUntilIdle();
    assert.equal(store.task(task.id)?.state, 'succeeded');
    assert.deepEqual(observed, [task.id]);
    assert.equal(direct.messages('local')[0]?.text, 'The durable coding session is queued.');
    assert.equal(store.listEvents().filter(event => event.type === 'inference.started').length, 1);
  } finally { await runtime.stop(); store.close(); }
});

test('runtime keeps foreground execution paused until coding adoption succeeds', async () => {
  const store = new Store(':memory:'), direct = new DirectCommunications(); let calls = 0, release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const runtime = new AgentRuntime({ store, communications: [direct], initiallyPaused: true,
    provider: { name: 'fixture', complete: async () => { calls++; return { text: 'Observed reply.', provider: 'fixture', model: 'fixture', usage: { inputTokens: 1, outputTokens: 1 } }; } },
    coding: { eligible: () => false, prepare: (_task, request) => request, accept: async () => undefined, resume: () => barrier } });
  try {
    const task = await runtime.submit({ id: 'adoption', source: 'direct', conversationId: 'local', text: 'Ordinary request.' });
    const resuming = runtime.resume({ drain: false });
    await runtime.runUntilIdle(); assert.equal(calls, 0); assert.equal(store.task(task.id)?.state, 'queued');
    release(); await resuming; assert.equal(calls, 0);
    await runtime.runUntilIdle(); assert.equal(calls, 1); assert.equal(store.task(task.id)?.state, 'succeeded');
  } finally { release(); await runtime.stop(); store.close(); }
});

test('failed coding adoption leaves foreground execution paused', async () => {
  const store = new Store(':memory:'), direct = new DirectCommunications(); let calls = 0;
  const runtime = new AgentRuntime({ store, communications: [direct],
    provider: { name: 'fixture', complete: async () => { calls++; return { text: 'Observed reply.', provider: 'fixture', model: 'fixture', usage: { inputTokens: 1, outputTokens: 1 } }; } },
    coding: { eligible: () => false, prepare: (_task, request) => request, accept: async () => undefined, resume: async () => { throw new Error('Adoption unavailable'); } } });
  try {
    await runtime.quiesce(); await runtime.submit({ id: 'failed-adoption', source: 'direct', conversationId: 'local', text: 'Ordinary request.' });
    await assert.rejects(runtime.resume(), /Adoption unavailable/); await runtime.runUntilIdle(); assert.equal(calls, 0);
  } finally { await runtime.stop(); store.close(); }
});

test('quiescence during coding adoption prevents a delayed resume from reopening execution', async () => {
  const store = new Store(':memory:'), direct = new DirectCommunications(); let calls = 0, release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const runtime = new AgentRuntime({ store, communications: [direct],
    provider: { name: 'fixture', complete: async () => { calls++; return { text: 'Observed reply.', provider: 'fixture', model: 'fixture', usage: { inputTokens: 1, outputTokens: 1 } }; } },
    coding: { eligible: () => false, prepare: (_task, request) => request, accept: async () => undefined, resume: () => barrier } });
  try {
    await runtime.quiesce(); await runtime.submit({ id: 'interrupted-adoption', source: 'direct', conversationId: 'local', text: 'Ordinary request.' });
    const resuming = runtime.resume(); const observed = assert.rejects(resuming, /resume interrupted/);
    await runtime.quiesce(); release(); await observed; await runtime.runUntilIdle(); assert.equal(calls, 0);
  } finally { release(); await runtime.stop(); store.close(); }
});
