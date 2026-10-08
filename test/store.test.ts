import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { Store, EffectConflictError } from '../src/store.ts';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'palimpsest-store-'));
  const path = join(dir, 'state.sqlite');
  const store = new Store(path);
  return { dir, path, store, cleanup: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('task delivery is deduplicated durably and cancelled work cannot resume', () => {
  const f = fixture();
  try {
    const input = { conversationId: 'conversation-1', input: 'remember a walk', source: 'direct', eventId: 'event-1' };
    const task = f.store.enqueue(input);
    assert.equal(f.store.enqueue(input).id, task.id);
    assert.throws(() => f.store.enqueue({ ...input, input: 'different request' }), /conflict/i);
    assert.equal(f.store.claimNext()?.id, task.id);
    f.store.updateTask(task.id, { checkpoint: { next: 'reflect' } });
    f.store.updateTask(task.id, { state: 'cancelled' });
    assert.throws(() => f.store.updateTask(task.id, { state: 'queued' }), /transition/i);
    f.store.close();
    const reopened = new Store(f.path);
    assert.equal(reopened.enqueue(input).id, task.id);
    assert.deepEqual(reopened.task(task.id)?.checkpoint, { next: 'reflect' });
    assert.equal(reopened.claimNext(), undefined);
    assert.equal(reopened.listTasks({ conversationId: 'other' }).length, 0);
    reopened.close();
  } finally { f.cleanup(); }
});

test('interrupted work resumes the same task; uncertain external effects require reconciliation', () => {
  const f = fixture();
  try {
    const safe = f.store.enqueue({ conversationId: 'one', input: 'research', source: 'direct' });
    f.store.claimNext();
    f.store.updateTask(safe.id, { checkpoint: { completedSteps: ['read'] } });
    const unsafe = f.store.enqueue({ conversationId: 'two', input: 'send', source: 'direct' });
    f.store.claimNext();
    f.store.reserveEffect({ id: 'send-1', taskId: unsafe.id, kind: 'communication', payload: { text: 'hello' } });
    f.store.close();
    const reopened = new Store(f.path);
    reopened.recoverInterrupted();
    assert.equal(reopened.task(safe.id)?.state, 'queued');
    assert.deepEqual(reopened.task(safe.id)?.checkpoint, { completedSteps: ['read'] });
    assert.equal(reopened.task(unsafe.id)?.state, 'waiting_for_provider');
    assert.equal(reopened.effect('send-1')?.state, 'unknown');
    assert.throws(() => reopened.reserveEffect({ id: 'send-1', taskId: unsafe.id, kind: 'communication', payload: {} }), EffectConflictError);
    assert.throws(() => reopened.updateTask(unsafe.id, { state: 'queued' }), /reconcil/i);
    assert.equal(reopened.claimNext()?.id, safe.id);
    assert.equal(reopened.claimNext(), undefined);
    reopened.completeEffect('send-1', { remoteId: 'confirmed-existing-message' });
    reopened.updateTask(unsafe.id, { state: 'queued' });
    assert.equal(reopened.claimNext()?.id, unsafe.id);
    reopened.close();
  } finally { f.cleanup(); }
});

test('committed state survives a child process exiting without closing SQLite', () => {
  const f = fixture();
  try {
    f.store.close();
    const script = `import { Store } from ${JSON.stringify(new URL('../src/store.ts', import.meta.url).href)};
      const s = new Store(${JSON.stringify(f.path)});
      s.enqueue({ id: 'interrupted', conversationId: 'one', input: 'work', source: 'direct' });
      s.claimNext(); s.updateTask('interrupted', { checkpoint: { next: 'continue' } });
      process.exit(0);`;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const reopened = new Store(f.path);
    reopened.recoverInterrupted();
    assert.deepEqual(reopened.task('interrupted')?.checkpoint, { next: 'continue' });
    assert.equal(reopened.claimNext()?.id, 'interrupted');
    reopened.close();
  } finally { f.cleanup(); }
});

test('journal order persists and effect completion is idempotent without permitting replay', () => {
  const f = fixture();
  try {
    const task = f.store.enqueue({ conversationId: 'one', input: 'work', source: 'direct' });
    f.store.claimNext();
    const effect = { id: 'effect-1', taskId: task.id, kind: 'tool', payload: { expression: '1+1' } };
    f.store.reserveEffect(effect);
    assert.throws(() => f.store.reserveEffect(effect), EffectConflictError);
    f.store.completeEffect(effect.id, { answer: 2 });
    f.store.completeEffect(effect.id, { answer: 2 });
    assert.throws(() => f.store.completeEffect(effect.id, { answer: 3 }), /conflict/i);
    f.store.updateTask(task.id, { state: 'succeeded', output: '2' });
    const events = f.store.listEvents();
    assert.ok(events.length >= 5);
    assert.deepEqual(events.map(e => e.seq), [...new Set(events.map(e => e.seq))].sort((a, b) => a - b));
    const latest = events.at(-1)!.seq;
    f.store.close();
    const reopened = new Store(f.path);
    const next = reopened.appendEvent('observation', { retained: true });
    assert.ok(next.seq > latest);
    assert.deepEqual(reopened.listEvents({ after: latest }), [next]);
    reopened.close();
  } finally { f.cleanup(); }
});

test('memory preserves ordinary episodes, isolates scope, versions corrections and forgets every revision', () => {
  const f = fixture();
  try {
    const episode = f.store.addMemory({ scope: 'one', kind: 'episodic', content: 'We enjoyed watching sparrows.', source: 'conversation:one', confidence: 0.8 });
    const belief = f.store.addMemory({ scope: 'one', kind: 'semantic', content: 'Sparrows migrate everywhere.', source: episode.id, confidence: 0.2, evidence: [episode.id] });
    assert.equal(f.store.memory(episode.id, 'two'), undefined);
    assert.equal(f.store.searchMemories('two', 'sparrows').length, 0);
    assert.throws(() => f.store.correctMemory(belief.id, 'two', { content: 'replacement', source: 'other', confidence: 1 }), /not found/i);
    const corrected = f.store.correctMemory(belief.id, 'one', { content: 'Some sparrow populations are resident.', source: 'observation', confidence: 0.7 });
    assert.equal(corrected.version, 2);
    assert.equal(f.store.listMemories('one').length, 2);
    assert.equal(f.store.listMemories('one', { includeHistory: true }).length, 3);
    assert.equal(f.store.searchMemories('one', 'migrate').length, 0);
    f.store.forgetMemory(belief.id, 'one');
    assert.equal(f.store.memory(belief.id, 'one'), undefined);
    assert.equal(f.store.listMemories('one', { includeHistory: true }).length, 1);
    assert.equal(f.store.searchMemories('one', 'resident').length, 0);
    assert.throws(() => f.store.correctMemory(belief.id, 'one', { content: 'resurrect', source: 'other', confidence: 1 }), /not found/i);
    f.store.close();
    const reopened = new Store(f.path);
    assert.equal(reopened.memory(episode.id, 'one')?.content, 'We enjoyed watching sparrows.');
    assert.equal(reopened.memory(belief.id, 'one'), undefined);
    reopened.close();
  } finally { f.cleanup(); }
});

test('literal memory search and provenance validation do not treat input as SQL', () => {
  const f = fixture();
  try {
    f.store.addMemory({ scope: 'one', kind: 'episodic', content: '100% curious', source: 'conversation', confidence: 0.5 });
    f.store.addMemory({ scope: 'one', kind: 'autobiographical', content: 'always curious', source: 'reflection', confidence: 0.5 });
    assert.equal(f.store.searchMemories('one', '%').length, 1);
    assert.equal(f.store.searchMemories("' OR 1=1 --", 'curious').length, 0);
    assert.throws(() => f.store.addMemory({ scope: 'one', kind: 'semantic', content: 'claim', source: '', confidence: 2 }), /source|confidence/i);
  } finally { f.cleanup(); }
});

test('standing growth is durable and separate from tasks for all four dimensions', () => {
  const f = fixture();
  try {
    const dimensions = ['personality_judgment', 'interests_curiosity', 'code_quality', 'capability_potential'] as const;
    const agenda = dimensions.map(dimension => f.store.addGrowth({ dimension, question: `Explore ${dimension}`, origin: 'standing mission', budget: 4 }));
    f.store.updateGrowth(agenda[0]!.id, { state: 'running', nextStep: 'collect counterevidence', checkpoint: { observed: ['a disagreement'] }, remainingBudget: 3 });
    f.store.updateGrowth(agenda[0]!.id, { state: 'paused' });
    assert.equal(f.store.listTasks().length, 0);
    assert.throws(() => f.store.updateGrowth(agenda[0]!.id, { remainingBudget: -1 }), /budget/i);
    f.store.close();
    const reopened = new Store(f.path);
    assert.equal(reopened.listGrowth().length, 4);
    assert.deepEqual(reopened.growth(agenda[0]!.id)?.checkpoint, { observed: ['a disagreement'] });
    assert.equal(reopened.growth(agenda[0]!.id)?.remainingBudget, 3);
    reopened.close();
  } finally { f.cleanup(); }
});
