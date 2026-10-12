import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { OperationalStore, DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE } from '../../storage/index.ts';
import { canonicalJson } from '../../contracts/common.ts';
import { DevelopmentalMemory } from '../index.ts';
const at = '2026-10-12T01:00:00.000Z', expires = '2026-10-12T02:00:00.000Z', later = '2026-10-12T03:00:00.000Z';
const scope = { kind: 'public' as const }, limits = { maxRows: 512, maxBytes: 1_048_576 };
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'jr1-memory-review-')), filename = join(dir, 'state.sqlite'), stores: OperationalStore[] = []; let clock = at;
  t.after(() => { for (const store of stores) store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { open() { const store = new OperationalStore({ filename, documentJournal: { stream: 'review-memory', hostId: 'synthetic-review', maxAnchorDocuments: 64, maxAnchorBytes: 150_000 } }); stores.push(store); return { store, memory: new DevelopmentalMemory(store, () => clock) }; }, later() { clock = later; }, sql(fn: (db: DatabaseSync) => void) { const db = new DatabaseSync(filename); try { fn(db); } finally { db.close(); } } };
}
function ingest(memory: DevelopmentalMemory, id: string, content: string, deadline: string | null = null) { memory.ingest({ id, runId: 'run', sourceId: `input:${id}`, actorId: 'actor', at, channel: 'speech', scope, content }, deadline); }
for (const mode of ['forget', 'expiry'] as const) test(`independent ${mode} erases historical self and job copies through descendant closure while preserving other owners`, t => {
  const f = fixture(t), { store, memory } = f.open(), raw = 'unique-forgotten-synthetic-payload';
  ingest(memory, 'root', raw, mode === 'expiry' ? expires : null); ingest(memory, 'control', 'unrelated-evidence');
  memory.derive({ id: 'child', sourceIds: ['root'], actorId: 'actor', at, kind: 'belief', scope, content: raw, confidence: 0.6 });
  memory.derive({ id: 'grandchild', sourceIds: ['child'], actorId: 'actor', at, kind: 'belief', scope, content: raw, confidence: 0.6 });
  memory.adoptSelf({ id: 'facet', memoryIds: ['grandchild'], actorId: 'actor', at, scope, category: 'preference', value: raw, reason: raw }, null);
  memory.adoptSelf({ id: 'facet', memoryIds: ['control'], actorId: 'actor', at, scope, category: 'preference', value: 'current-safe-value', reason: 'current-safe-reason' }, 1);
  memory.scheduleConsolidation('job', ['child'], scope, at);
  const job = store.get('development.jobs', 'job')!;
  store.put('development.jobs', 'job', { ...(job.value as object), error: raw }, job.revision);
  store.put('separately-owned', 'equal-bytes', raw, null);
  const before = store.captureDevelopmentSnapshot(limits), selected = before.journalPayloads.filter(p => p.ref.namespace.startsWith('development.') && p.state === 'available' && canonicalJson(p.document).includes(raw));
  assert.deepEqual(new Set(selected.map(p => p.ref.namespace)), new Set(['development.memories', 'development.self', 'development.self-history', 'development.jobs']));
  if (mode === 'expiry') { f.later(); assert.equal(memory.get('root', scope), undefined); assert.equal(memory.get('grandchild', scope), undefined); }
  const result = mode === 'forget' ? memory.forget(['root']) : memory.expire();
  assert.deepEqual(new Set(result), new Set(['root', 'child', 'grandchild']));
  const reopened = f.open(), after = reopened.store.captureDevelopmentSnapshot(limits);
  assert.deepEqual(after.events.slice(0, before.events.length), before.events);
  for (const payload of selected) assert.equal(after.journalPayloads.find(p => p.ref.versionId === payload.ref.versionId)?.state, 'withdrawn');
  assert.equal(canonicalJson(after.journalPayloads.filter(p => p.ref.namespace.startsWith('development.'))).includes(raw), false);
  assert.equal(canonicalJson(after.documents.filter(p => p.namespace.startsWith('development.'))).includes(raw), false);
  assert.equal(canonicalJson(after.events).includes(raw), false);
  assert.equal(reopened.store.get('separately-owned', 'equal-bytes')?.value, raw);
  assert.ok(after.journalPayloads.some(p => p.ref.namespace === 'separately-owned' && p.state === 'available' && p.document.value === raw));
  assert.equal(reopened.memory.selfHistory('facet', scope).length, 1);
  assert.equal(reopened.memory.selfHistory('facet', scope)[0]!.preferences.value, 'current-safe-value');
  assert.equal(reopened.memory.jobs(scope)[0]!.error, 'source forgotten');
  assert.equal((after.events.find(e => e.type === 'document-journal-withdrawal')!.data as { reason: string }).reason, mode);
  const oldSelfIds = after.journalPayloads.filter(p => p.ref.namespace === 'development.self').map(p => p.ref.versionId);
  reopened.memory.adoptSelf({ id: 'facet', memoryIds: ['control'], actorId: 'actor', at: later, scope, category: 'preference', value: 'future-safe', reason: 'future-safe' }, 2);
  const future = reopened.store.captureDevelopmentSnapshot(limits);
  assert.ok(future.journalPayloads.filter(p => oldSelfIds.includes(p.ref.versionId)).every(p => p.state === 'withdrawn'));
  assert.ok(future.journalPayloads.some(p => p.ref.namespace === 'development.self' && p.ref.revision === 3 && p.state === 'available'));
});

for (const failure of ['payload', 'marker'] as const) test(`independent expiry ${failure} failure restores current and historical state; retry after reopen completes`, t => {
  const f = fixture(t), { store, memory } = f.open(); ingest(memory, 'root', 'temporary-source', expires);
  memory.derive({ id: 'child', sourceIds: ['root'], actorId: 'actor', at, kind: 'belief', scope, content: 'temporary-derived', confidence: 0.4 });
  memory.adoptSelf({ id: 'facet', memoryIds: ['child'], actorId: 'actor', at, scope, category: 'preference', value: 'temporary-derived', reason: 'temporary-source' }, null);
  memory.scheduleConsolidation('job', ['child'], scope, at);
  const before = store.captureDevelopmentSnapshot(limits); f.later();
  f.sql(db => db.exec(failure === 'payload' ? `CREATE TRIGGER fail_expiry_review BEFORE UPDATE ON documents WHEN NEW.namespace='${DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE}' BEGIN SELECT RAISE(ABORT,'review expiry fault'); END` : "CREATE TRIGGER fail_expiry_review BEFORE INSERT ON events WHEN NEW.type='document-journal-withdrawal' BEGIN SELECT RAISE(ABORT,'review expiry fault'); END"));
  assert.throws(() => memory.expire(), /review expiry fault/);
  const reopened = f.open(); assert.deepEqual(reopened.store.captureDevelopmentSnapshot(limits), before);
  assert.equal(reopened.memory.get('root', scope), undefined); assert.equal(reopened.memory.get('child', scope), undefined);
  f.sql(db => db.exec('DROP TRIGGER fail_expiry_review'));
  assert.throws(() => store.transaction(() => { memory.expire(); throw Error('review outer abort'); }), /review outer abort/);
  assert.deepEqual(store.captureDevelopmentSnapshot(limits), before);
  assert.deepEqual(new Set(reopened.memory.expire()), new Set(['root', 'child']));
  assert.deepEqual(reopened.memory.expire(), []);
  assert.equal(canonicalJson(reopened.store.captureDevelopmentSnapshot(limits)).includes('temporary-'), false);
});
