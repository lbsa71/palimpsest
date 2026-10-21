import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../../contracts/common.ts';
import { DOCUMENT_JOURNAL_KEY, DOCUMENT_JOURNAL_NAMESPACE, OperationalStore, type DocumentJournalOptions, type JournalRef } from '../index.ts';

const journal: DocumentJournalOptions = { stream: 'development:attempt', hostId: 'qualified-host:observer', maxAnchorDocuments: 100, maxAnchorBytes: 100_000 };
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'aeon-document-journal-')), filename = join(dir, 'state.sqlite'), stores = new Set<OperationalStore>();
  t.after(() => { for (const store of stores) store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { filename, open(option?: DocumentJournalOptions | null) { const store = new OperationalStore({ filename, documentJournal: option }); stores.add(store); return store; }, close(store: OperationalStore) { store.close(); stores.delete(store); }, sql(fn: (db: DatabaseSync) => void) { const db = new DatabaseSync(filename); try { fn(db); } finally { db.close(); } } };
}
function legacyFixture(t: TestContext) {
  const f = fixture(t);
  f.sql(db => {
    db.exec(`
      CREATE TABLE documents(namespace TEXT NOT NULL, key TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), value TEXT NOT NULL, PRIMARY KEY(namespace,key));
      CREATE TABLE events(sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, stream TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX event_stream ON events(stream,sequence);
      CREATE TABLE artifacts(digest TEXT PRIMARY KEY, bytes BLOB NOT NULL);
      PRAGMA user_version=1;`);
    db.prepare('INSERT INTO documents VALUES(?,?,?,?)').run('legacy', 'kept', 3, '{ "note": "original bytes" }');
    for (let i = 0; i < 3; i++) db.prepare('INSERT INTO events(id,stream,type,data) VALUES(?,?,?,?)').run(`legacy-${i}`, 'ordinary', 'observation', `{ "value": ${i} }`);
    assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='event_type'").get(), undefined);
  });
  return f;
}
function physicalRows(db: DatabaseSync) {
  return { documents: db.prepare('SELECT * FROM documents ORDER BY namespace,key').all(), events: db.prepare('SELECT * FROM events ORDER BY sequence').all() };
}

test('schema version 1 upgrade installs the type index without changing history or journal behavior', t => {
  const f = legacyFixture(t); let before: ReturnType<typeof physicalRows>;
  f.sql(db => { before = physicalRows(db); });
  const store = f.open();
  f.sql(db => {
    assert.ok(db.prepare('PRAGMA index_list(events)').all().some(row => row.name === 'event_type'));
    assert.deepEqual(db.prepare('PRAGMA index_info(event_type)').all().map(row => row.name), ['type']);
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 1);
    assert.deepEqual(physicalRows(db), before);
  });
  assert.equal(store.documentJournalBinding(), null);
  assert.equal(store.put('ordinary', 'temporary', { works: true }, null), 1);
  store.delete('ordinary', 'temporary', 1); assert.equal(store.get('ordinary', 'temporary'), undefined);
  const appended = store.append({ id: 'after-upgrade', stream: 'ordinary', type: 'observation', data: { works: true } });
  assert.equal(appended.sequence, 4);
  const reopened = f.open(); assert.equal(reopened.documentJournalBinding(), null);
  const owner = f.open(journal), binding = owner.documentJournalBinding()!;
  assert.equal(binding.anchorSequence, 5); assert.deepEqual(reopened.documentJournalBinding(), binding);
  assert.deepEqual(owner.get('legacy', 'kept'), { revision: 3, value: { note: 'original bytes' } });
  f.sql(db => {
    assert.deepEqual(db.prepare('SELECT * FROM events WHERE sequence<=3 ORDER BY sequence').all(), before.events);
    assert.deepEqual(db.prepare('SELECT * FROM documents WHERE namespace=?').all('legacy'), before.documents);
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 1);
  });
});

test('upgraded journal absence lookup uses the covering event_type index', t => {
  const f = legacyFixture(t), store = f.open();
  assert.equal(store.documentJournalBinding(), null);
  f.sql(db => {
    const plan = db.prepare('EXPLAIN QUERY PLAN SELECT 1 FROM events WHERE type IN (?,?,?) LIMIT 1')
      .all('document-journal-anchor', 'document-mutation', 'document-journal-withdrawal').map(row => String(row.detail)).join('\n');
    assert.doesNotMatch(plan, /SCAN events/i);
    assert.match(plan, /SEARCH events USING COVERING INDEX event_type \(type=\?\)/i);
  });
});

test('an upgraded handle observes another writer activating the journal before its put and delete', t => {
  const f = legacyFixture(t), earlier = f.open();
  assert.equal(earlier.documentJournalBinding(), null);
  const owner = f.open(journal), binding = owner.documentJournalBinding()!;
  earlier.put('memory', 'same-handle', 'observed', null);
  earlier.delete('memory', 'same-handle', 1);
  assert.deepEqual(earlier.documentJournalBinding(), binding);
  const changes = owner.events<{ before: JournalRef | null; after: JournalRef | null }>(journal.stream).filter(event => event.type === 'document-mutation');
  assert.equal(changes.length, 2);
  assert.equal(changes[0]!.data.before, null); assert.equal(changes[0]!.data.after?.key, 'same-handle');
  assert.deepEqual(changes[1]!.data.before, changes[0]!.data.after); assert.equal(changes[1]!.data.after, null);
  assert.equal(owner.get('memory', 'same-handle'), undefined);
});

for (const type of ['document-journal-anchor', 'document-mutation', 'document-journal-withdrawal']) test(`upgraded unbound stores refuse a raw forged ${type}`, t => {
  const f = legacyFixture(t), store = f.open();
  assert.equal(store.documentJournalBinding(), null);
  f.sql(db => db.prepare('INSERT INTO events(id,stream,type,data) VALUES(?,?,?,?)').run('forged', 'foreign', type, '{}'));
  let before: ReturnType<typeof physicalRows>; f.sql(db => { before = physicalRows(db); });
  assert.throws(() => store.documentJournalBinding(), /document journal binding missing/);
  assert.throws(() => store.put('legacy', 'kept', 'lost', 3), /document journal binding missing/);
  assert.throws(() => store.delete('legacy', 'kept', 3), /document journal binding missing/);
  assert.throws(() => f.open(), /cannot open operational state/);
  f.sql(db => assert.deepEqual(physicalRows(db), before));
});

for (const fault of ['missing-binding', 'changed-binding'] as const) test(`upgraded journal handles refuse ${fault} without changing retained data`, t => {
  const f = legacyFixture(t), store = f.open(), owner = f.open(journal), binding = owner.documentJournalBinding()!;
  assert.deepEqual(store.documentJournalBinding(), binding);
  f.sql(db => {
    if (fault === 'missing-binding') db.prepare('DELETE FROM documents WHERE namespace=? AND key=?').run(DOCUMENT_JOURNAL_NAMESPACE, DOCUMENT_JOURNAL_KEY);
    else db.prepare('UPDATE documents SET value=? WHERE namespace=? AND key=?').run(canonicalJson({ ...binding, hostId: 'foreign' }), DOCUMENT_JOURNAL_NAMESPACE, DOCUMENT_JOURNAL_KEY);
  });
  let before: ReturnType<typeof physicalRows>; f.sql(db => { before = physicalRows(db); });
  assert.throws(() => store.documentJournalBinding(), /document journal binding missing|changed document journal binding/);
  assert.throws(() => store.put('legacy', 'kept', 'lost', 3));
  assert.throws(() => store.delete('legacy', 'kept', 3));
  assert.throws(() => f.open(), /cannot open operational state/);
  f.sql(db => assert.deepEqual(physicalRows(db), before));
});
