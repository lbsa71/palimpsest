import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { OperationalStore, DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE } from '../../storage/index.ts';
import { canonicalJson } from '../../contracts/index.ts';
import { DevelopmentalMemory } from '../index.ts';
const at = '2026-10-12T00:00:00.000Z', expiry = '2026-10-12T00:01:00.000Z', later = '2026-10-12T00:02:00.000Z', scope = { kind: 'public' as const };
const journal = { stream: 'memory:retention', hostId: 'synthetic-memory-host', maxAnchorDocuments: 100, maxAnchorBytes: 200_000 };
const limits = { maxRows: 512, maxBytes: 1_048_576 };
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'aeon-memory-retention-')), filename = join(dir, 'state.sqlite'), stores = new Set<OperationalStore>(); let clock = at;
  t.after(() => { for (const store of stores) store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { open() { const store = new OperationalStore({ filename, documentJournal: journal }); stores.add(store); return { store, memory: new DevelopmentalMemory(store, () => clock) }; }, now(value: string) { clock = value; }, sql(fn: (db: DatabaseSync) => void) { const db = new DatabaseSync(filename); try { fn(db); } finally { db.close(); } } };
}
function ingest(memory: DevelopmentalMemory, id: string, content: string, deadline: string | null = null) { memory.ingest({ id, runId: 'run', sourceId: `input:${id}`, actorId: 'actor', at, channel: 'speech', scope, content }, deadline); }

test('historical self evidence selects old facet journal versions while unrelated current self/history stays usable', t => {
  const f = fixture(t), { store, memory } = f.open(), content = 'synthetic-old-self-private-content';
  ingest(memory, 'source', content); ingest(memory, 'unrelated', 'current unrelated evidence');
  memory.derive({ id: 'derived', sourceIds: ['source'], actorId: 'actor', at, kind: 'belief', scope, content, confidence: 0.7 });
  memory.adoptSelf({ id: 'facet', memoryIds: ['derived'], actorId: 'actor', at, scope, category: 'preference', value: content, reason: content }, null);
  memory.adoptSelf({ id: 'facet', memoryIds: ['unrelated'], actorId: 'actor', at, scope, category: 'preference', value: 'usable current preference', reason: 'usable current reason' }, 1);
  memory.scheduleConsolidation('job', ['derived'], scope, at);
  // Trusted historical job error field can carry source text even though the public fail method uses a fixed code.
  const job = store.get('development.jobs', 'job')!;
  store.put('development.jobs', 'job', { ...(job.value as object), error: content }, job.revision);
  const before = store.captureDevelopmentSnapshot(limits), old = before.journalPayloads.filter(p => p.state === 'available' && canonicalJson(p.document).includes(content)).map(p => p.ref.versionId);
  assert.deepEqual(new Set(before.journalPayloads.filter(p => old.includes(p.ref.versionId)).map(p => p.ref.namespace)), new Set(['development.memories', 'development.self', 'development.self-history', 'development.jobs']));
  assert.deepEqual(memory.forget(['source']), ['source', 'derived']);
  const reopened = f.open(), after = reopened.store.captureDevelopmentSnapshot(limits);
  assert.equal(canonicalJson(after).includes(content), false);
  assert.ok(old.every(id => after.journalPayloads.find(p => p.ref.versionId === id)?.state === 'withdrawn'));
  assert.equal(reopened.memory.selfHistory('facet', scope).length, 1);
  assert.equal(reopened.memory.selfHistory('facet', scope)[0]!.preferences.value, 'usable current preference');
  assert.equal(reopened.memory.context({ query: '', audience: scope, maxRecords: 10, maxBytes: 10_000 }).self[0]!.preferences.reason, 'usable current reason');
  assert.equal(reopened.memory.jobs(scope)[0]!.state, 'cancelled');
  assert.throws(() => ingest(reopened.memory, 'source', 'resurrection'));
  memory.adoptSelf({ id: 'facet', memoryIds: ['unrelated'], actorId: 'actor', at, scope, category: 'preference', value: 'future preference', reason: 'future reason' }, 2);
  const future = store.captureDevelopmentSnapshot(limits);
  assert.ok(future.journalPayloads.some(p => p.ref.namespace === 'development.self' && p.state === 'available' && p.document.revision === 3));
  assert.ok(future.journalPayloads.filter(p => p.ref.namespace === 'development.self' && p.ref.revision < 3).every(p => p.state === 'withdrawn'));
  memory.forget(['source']); assert.equal(canonicalJson(store.captureDevelopmentSnapshot(limits)).includes(content), false);
});

for (const fault of ['payload', 'marker'] as const) test(`forget rejects ${fault} SQL failure and atomically retains source, descendant and self for retry`, t => {
  const f = fixture(t), { store, memory } = f.open(); ingest(memory, 'source', 'source content');
  memory.derive({ id: 'derived', sourceIds: ['source'], actorId: 'actor', at, kind: 'belief', scope, content: 'derived content', confidence: 0.5 });
  memory.adoptSelf({ id: 'facet', memoryIds: ['derived'], actorId: 'actor', at, scope, category: 'preference', value: 'derived content', reason: 'derived content' }, null);
  const before = store.captureDevelopmentSnapshot(limits);
  f.sql(db => db.exec(fault === 'payload' ? `CREATE TRIGGER fail_retention BEFORE UPDATE ON documents WHEN NEW.namespace='${DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE}' BEGIN SELECT RAISE(ABORT,'retention fault'); END` : "CREATE TRIGGER fail_retention BEFORE INSERT ON events WHEN NEW.type='document-journal-withdrawal' BEGIN SELECT RAISE(ABORT,'retention fault'); END"));
  assert.throws(() => memory.forget(['source']), /retention fault/);
  assert.deepEqual(f.open().store.captureDevelopmentSnapshot(limits), before);
  assert.equal((memory.get('source', scope)?.content as { attributedContent: string }).attributedContent, 'source content'); assert.equal(memory.selfHistory('facet', scope).length, 1);
  f.sql(db => db.exec('DROP TRIGGER fail_retention'));
  assert.deepEqual(memory.forget(['source']), ['source', 'derived']); assert.equal(memory.get('source', scope), undefined);
});

test('expiry uses durable expiry reason, inherited deadline and failure reporting without retrieving expired sources', t => {
  const f = fixture(t), { store, memory } = f.open(); ingest(memory, 'source', 'expired-content', expiry);
  memory.derive({ id: 'derived', sourceIds: ['source'], actorId: 'actor', at, kind: 'belief', scope, content: 'expired-descendant', confidence: 0.5 });
  f.now(later); assert.equal(memory.get('source', scope), undefined); assert.equal(memory.get('derived', scope), undefined);
  const before = store.captureDevelopmentSnapshot(limits);
  f.sql(db => db.exec("CREATE TRIGGER fail_expiry BEFORE INSERT ON events WHEN NEW.type='document-journal-withdrawal' BEGIN SELECT RAISE(ABORT,'expiry fault'); END"));
  assert.throws(() => memory.expire(), /expiry fault/); assert.deepEqual(f.open().store.captureDevelopmentSnapshot(limits), before);
  assert.equal(memory.get('source', scope), undefined);
  f.sql(db => db.exec('DROP TRIGGER fail_expiry'));
  assert.deepEqual(new Set(memory.expire()), new Set(['source', 'derived'])); assert.deepEqual(memory.expire(), []);
  const snapshot = f.open().store.captureDevelopmentSnapshot(limits);
  assert.equal(canonicalJson(snapshot).includes('expired-content'), false); assert.equal(canonicalJson(snapshot).includes('expired-descendant'), false);
  assert.equal((snapshot.events.find(e => e.type === 'document-journal-withdrawal')!.data as { reason: string }).reason, 'expiry');
});
