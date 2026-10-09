import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { digestJson } from '../src/candidates.ts';
import { readGenerationContinuity } from '../src/continuity.ts';
import { Store } from '../src/store.ts';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'palimpsest-continuity-'));
  const store = new Store(join(directory, 'state.sqlite'));
  return { store, close() { store.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('large histories project bounded lessons and exact audit identities without changing records', () => {
  const f = fixture();
  try {
    for (let index = 0; index < 90; index++) {
      const item = f.store.addGrowth({ id: `history:${index}`, dimension: 'code_quality', question: 'Question '.repeat(1000), origin: 'standing mission' });
      f.store.updateGrowth(item.id, { state: 'completed', checkpoint: { input: 'PRIVATE-PROMPT'.repeat(5000) }, outcome: {
        result: { lesson: `Lesson ${index}: ${'🧠\\"'.repeat(2000)}`, proposedChange: { files: [{ content: 'PRIVATE-SOURCE'.repeat(5000) }] } },
      } });
    }
    const active = f.store.addGrowth({ id: 'current-inquiry', dimension: 'interests_curiosity', question: 'What explains the observation?', origin: 'standing mission', nextStep: 'Resume the interrupted discriminating experiment', budget: 2 });
    f.store.updateGrowth(active.id, { state: 'paused' });
    const before = f.store.listGrowth(); const journal = f.store.listEvents();
    const snapshot = readGenerationContinuity(f.store, 'local');
    assert.ok(Buffer.byteLength(JSON.stringify(snapshot.growth)) <= 65_536);
    assert.ok(snapshot.growth.length <= 64);
    assert.ok(snapshot.growthProjection.omittedEntries > 0);
    assert.equal(snapshot.growth[0]?.id, active.id);
    assert.equal(snapshot.growth[0]?.nextStep, 'Resume the interrupted discriminating experiment');
    assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE-PROMPT|PRIVATE-SOURCE/);
    const completed = snapshot.growth.find(item => item.state === 'completed')!;
    const newest = before.filter(item => item.state === 'completed').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))[0]!;
    assert.equal(completed.id, newest.id, 'recent lessons precede historical lessons');
    const record = f.store.growth(completed.id)!;
    assert.equal(completed.recordDigest, digestJson(record));
    assert.equal(completed.outcomeDigest, digestJson(record.outcome));
    assert.equal(completed.checkpointDigest, digestJson(record.checkpoint));
    assert.equal(completed.recordReference, `growth:${record.id}`);
    assert.match(completed.lesson!, /^Lesson/);
    assert.ok(completed.truncatedFields.includes('lesson'));
    assert.deepEqual(f.store.listGrowth(), before);
    assert.deepEqual(f.store.listEvents(), journal);
  } finally { f.close(); }
});

test('finite entry and UTF-8 limits declare omitted entries and shortened identifiers', () => {
  const f = fixture();
  try {
    for (let index = 0; index < 100; index++) f.store.addGrowth({ id: `entry:${index}`, dimension: 'code_quality', question: 'Bounded inquiry', origin: 'standing mission' });
    const longId = 'identifier:🧠\\"'.repeat(1000);
    const item = f.store.addGrowth({ id: longId, dimension: 'code_quality', question: 'Current inquiry', origin: 'standing mission' });
    f.store.updateGrowth(item.id, { state: 'running' });
    const snapshot = readGenerationContinuity(f.store, 'local');
    assert.equal(snapshot.growth.length, 64);
    assert.equal(snapshot.growthProjection.omittedEntries, 37);
    assert.ok(Buffer.byteLength(JSON.stringify(snapshot.growth)) <= 65_536);
    assert.ok(Buffer.byteLength(snapshot.growth[0]!.id) <= 256);
    assert.ok(snapshot.growth[0]!.truncatedFields.includes('id'));
    assert.equal(snapshot.growth[0]!.idDigest, digestJson(longId));
    assert.equal(snapshot.growth[0]!.recordDigest, digestJson(f.store.growth(longId)));
  } finally { f.close(); }
});

test('human proposal provenance stays in its conversation, including linked follow-ups', () => {
  const f = fixture();
  try {
    const task = f.store.enqueue({ source: 'slack', conversationId: 'slack:T:C:123', input: 'PRIVATE-HUMAN-REQUEST', slackAuthor: { teamId: 'T', userId: 'U' } });
    const parent = f.store.addGrowth({ id: `conversation:${task.id}`, sourceTaskId: task.id, origin: `conversation:${task.id}`, question: 'PRIVATE-HUMAN-QUESTION', dimension: 'code_quality' });
    f.store.addGrowth({ id: 'derived', origin: `growth:${parent.id}`, question: 'PRIVATE-FOLLOWUP', dimension: 'code_quality' });
    f.store.addGrowth({ id: 'legacy', origin: 'conversation:unknown', question: 'PRIVATE-LEGACY', dimension: 'code_quality' });
    f.store.addGrowth({ id: 'missing', sourceTaskId: 'absent', origin: 'fixture', question: 'PRIVATE-MISSING', dimension: 'code_quality' });
    f.store.addGrowth({ id: 'cycle', origin: 'growth:cycle', question: 'PRIVATE-CYCLE', dimension: 'code_quality' });
    const other = readGenerationContinuity(f.store, 'local');
    assert.equal(other.growth.length, 0);
    assert.equal(other.growthProjection.excludedByScope, 5);
    assert.doesNotMatch(JSON.stringify(other), /PRIVATE-/);
    const own = readGenerationContinuity(f.store, task.conversationId);
    assert.deepEqual(new Set(own.growth.map(item => item.id)), new Set([parent.id, 'derived']));
    assert.ok(own.growth.every(item => item.sourceTaskId === task.id && item.sourceScope === task.conversationId));
  } finally { f.close(); }
});

test('projection preserves current memories, task commitments and standing next steps', () => {
  const f = fixture();
  try {
    f.store.addMemory({ scope: 'local', kind: 'episodic', content: 'Current complete memory', source: 'fixture', confidence: 1 });
    f.store.enqueue({ source: 'direct', conversationId: 'local', input: 'Keep this complete commitment' });
    for (let index = 0; index < 4; index++) f.store.addGrowth({ id: `standing:${index}`, dimension: 'capability_potential', origin: 'standing mission', question: `Inquiry ${index}`, nextStep: `Next experiment ${index}` });
    const original = f.store.readContinuitySnapshot('local');
    const snapshot = readGenerationContinuity(f.store, 'local');
    assert.deepEqual(snapshot.memories, original.memories);
    assert.deepEqual(snapshot.tasks, original.tasks);
    assert.equal(snapshot.sequence, original.sequence);
    assert.equal(snapshot.growthProjection.omittedEntries, 0);
    assert.equal(snapshot.growth.length, 4);
    assert.ok(snapshot.growth.every(item => item.nextStep.startsWith('Next experiment')));
  } finally { f.close(); }
});
