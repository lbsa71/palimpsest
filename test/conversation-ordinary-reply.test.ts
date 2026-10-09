import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConversationActions } from '../src/conversation-actions.ts';
import { AgentRuntime } from '../src/runtime.ts';
import { Store } from '../src/store.ts';

test('ordinary conversation delivers its reply without adding engineering status', async () => {
  const store = new Store(':memory:');
  const sent: string[] = [];
  const reply = 'I prefer the shorter name. I can try it here and reconsider as I learn.';
  const runtime = new AgentRuntime({ store, conversationActions: new ConversationActions({store, userIds: [], allowDirectOperator: true, sourceContext: () => 'Fixture admitted source'}),
    communications: [{ name: 'direct', send: async message => { sent.push(message.text); } }],
    provider: { name: 'fixture', complete: async () => ({ text: JSON.stringify({ reply, disposition: 'converse', rationale: 'Ordinary self-reflection within the existing conversation.', proposal: null }), provider: 'fixture', model: 'fixture', usage: {inputTokens: 1, outputTokens: 1} }) },
  });
  try {
    const task = await runtime.submit({id: 'ordinary-choice', source: 'direct', conversationId: 'ordinary', text: 'Choose a provisional name for yourself.'});
    await runtime.runUntilIdle();
    assert.equal(store.task(task.id)?.state, 'succeeded');
    assert.equal(store.task(task.id)?.output, reply);
    assert.deepEqual(sent, [reply]);
    assert.equal(store.listGrowth().length, 0);
    assert.ok(store.listEvents().some(event => event.type === 'conversation.decision' && event.taskId === task.id));
    assert.equal(JSON.parse(store.listMemories('ordinary')[0]!.content).response, reply);
  } finally { await runtime.stop(); store.close(); }
});
