import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentRuntime } from '../src/runtime.ts';
import { ConversationContinuity } from '../src/conversation-continuity.ts';
import { Store } from '../src/store.ts';
import type { Provider } from '../src/providers.ts';

const forbidden: Provider = { name: 'forbidden', async complete() { assert.fail('Recovery must retain the consumed inference'); } };
const pending = { question: 'Private question', stance: 'Private stance', rationale: 'PRIVATE_RATIONALE', unresolved: ['Private uncertainty'], status: 'pending' as const };

test('saved legacy continuity envelope waits when its receiver is unavailable, never publishing raw internal JSON', async () => {
  const store = new Store(':memory:'); const sent: string[] = [];
  const task = store.enqueue({ source: 'direct', conversationId: 'scope', input: 'Old observation' });
  const decisionText = JSON.stringify({ reply: 'Public words', outcomes: [{ ...pending, reflection: null, topicId: null }] });
  store.updateTask(task.id, { checkpoint: { calls: 1, interactive: false, decisionText } });
  const runtime = new AgentRuntime({ store, provider: forbidden, communications: [{ name: 'direct', async send(message) { sent.push(message.text); } }] });
  try {
    await runtime.runUntilIdle(); assert.deepEqual(sent, []);
    assert.equal(store.task(task.id)?.state, 'waiting_for_provider');
    assert.equal((store.task(task.id)?.checkpoint as Record<string, unknown>).decisionText, decisionText);
    assert.equal(store.listEffects(task.id).length, 0);
  } finally { await runtime.stop(); store.close(); }
});

test('bound deferred report waits for its receiver while retaining the report debt', async () => {
  const store = new Store(':memory:'); const sent: string[] = [];
  const origin = store.enqueue({ source: 'direct', conversationId: 'scope', input: 'A retained inquiry' });
  store.updateTask(origin.id, { state: 'running' });
  const [topic] = store.prepareConversationTopics(origin.id, [{ outcome: pending }], [], { now: 0, reviewMs: 10, lifetimeMs: 100, maxAttempts: 1 });
  store.finishConversationTask(origin.id, 'Historic speech', { scope: 'scope', kind: 'episodic', content: 'Historic exchange', source: `task:${origin.id}`, confidence: 1 });
  const report = store.prepareConversationReport(topic!.id, 'PRIVATE_LEGACY_REPORT', 'final', 10)!;
  const { preparedSpeech: _prepared, ...checkpoint } = report.checkpoint as Record<string, import('../src/store.ts').Json>;
  store.updateTask(report.id, { checkpoint });
  const runtime = new AgentRuntime({ store, provider: forbidden, communications: [{ name: 'direct', async send(message) { sent.push(message.text); } }] });
  try {
    await runtime.runUntilIdle(); assert.deepEqual(sent, []);
    assert.equal(store.task(report.id)?.state, 'waiting_for_provider');
    assert.equal(store.conversationTopic(topic!.id)?.report.owedRevision, 1);
    assert.equal(store.listEffects(report.id).length, 0);
  } finally { await runtime.stop(); store.close(); }
});

test('saved explicit say is withheld when its remembered source changes before dispatch', async () => {
  const store = new Store(':memory:'); const sent: string[] = [];
  const memory = store.addMemory({ scope: 'scope', kind: 'episodic', content: 'Original evidence', source: 'fixture', confidence: 1 });
  const task = store.enqueue({ source: 'direct', conversationId: 'scope', input: 'Interpret the evidence' });
  store.updateTask(task.id, { checkpoint: { calls: 1, deliberationProtocol: 'autark-turn/1', decisionAccepted: true,
    answer: 'Stale explicit speech', conversationSourceRefs: [{ id: memory.id, version: memory.version }] } });
  store.correctMemory(memory.id, 'scope', { content: 'Corrected evidence', source: 'correction', confidence: 1 });
  const runtime = new AgentRuntime({ store, provider: forbidden, conversationContinuity: new ConversationContinuity({ store, provider: forbidden }),
    communications: [{ name: 'direct', async send(message) { sent.push(message.text); } }] });
  try {
    await runtime.runUntilIdle(); assert.deepEqual(sent, []);
    assert.equal(store.listEffects(task.id).length, 0);
    assert.notEqual(store.task(task.id)?.state, 'succeeded');
  } finally { await runtime.stop(); store.close(); }
});
