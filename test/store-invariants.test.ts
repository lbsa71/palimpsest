import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';

test('terminal tasks reject stale output and completed growth cannot rewrite evidence', () => {
  const store = new Store(':memory:');
  try {
    const task = store.enqueue({ conversationId: 'c', input: 'work', source: 'direct' });
    store.updateTask(task.id, { state: 'cancelled' });
    assert.throws(() => store.updateTask(task.id, { output: 'stale answer' }), /terminal/);
    assert.equal(store.updateTask(task.id, { state: 'cancelled' }).state, 'cancelled');
    const growth = store.addGrowth({ dimension: 'code_quality', question: 'Can this improve?', origin: 'test' });
    store.updateGrowth(growth.id, { state: 'completed', outcome: 'observed failure' });
    assert.throws(() => store.updateGrowth(growth.id, { outcome: 'pretend success' }), /completed/);
  } finally { store.close(); }
});

test('growth claims atomically debit before work and recovery cannot refill calls', () => {
  const store = new Store(':memory:');
  try {
    const growth = store.addGrowth({ dimension: 'interests_curiosity', question: 'An open question', origin: 'test', budget: 2 });
    const claim = store.claimGrowth(growth.id);
    assert.equal(claim?.remainingBudget, 1);
    assert.equal(store.claimGrowth(growth.id), undefined);
    assert.equal(store.recoverGrowthInterrupted()[0]?.state, 'paused');
    assert.equal(store.claimGrowth(growth.id)?.remainingBudget, 0);
    store.recoverGrowthInterrupted();
    assert.equal(store.claimGrowth(growth.id), undefined);
    assert.throws(() => store.updateGrowth(growth.id, { remainingBudget: 1 }), /increase/);
  } finally { store.close(); }
});

test('idempotent memory publication cannot resurrect a forgotten result after interruption', () => {
  const store = new Store(':memory:');
  try {
    const input = { publicationId: 'growth:one', scope: 'growth', kind: 'episodic' as const,
      content: 'An unverified observation', source: 'growth:one', confidence: 0.3 };
    const first = store.publishMemoryOnce(input);
    assert.equal(first.status, 'published');
    assert.equal(store.publishMemoryOnce(input).status, 'existing');
    store.forgetMemory(first.memory!.id, 'growth');
    assert.equal(store.publishMemoryOnce(input).status, 'forgotten');
    assert.equal(store.listMemories('growth').length, 0);
  } finally { store.close(); }
});
