import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../../contracts/common.ts';
import { DOCUMENT_JOURNAL_KEY, DOCUMENT_JOURNAL_NAMESPACE, OperationalStore, RevisionConflict, type Document, type DocumentJournalOptions } from '../index.ts';

const journal: DocumentJournalOptions = { stream: 'development:attempt', hostId: 'qualified-host:observer', maxAnchorDocuments: 100, maxAnchorBytes: 100_000 };
const limits = { maxRows: 512, maxBytes: 1_048_576 };
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'aeon-document-journal-')), filename = join(dir, 'state.sqlite'), stores = new Set<OperationalStore>();
  t.after(() => { for (const store of stores) store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { filename, open(option?: DocumentJournalOptions | null) { const store = new OperationalStore({ filename, documentJournal: option }); stores.add(store); return store; }, close(store: OperationalStore) { store.close(); stores.delete(store); }, sql(fn: (db: DatabaseSync) => void) { const db = new DatabaseSync(filename); try { fn(db); } finally { db.close(); } } };
}
function mutations(store: OperationalStore) { return store.events<{ namespace: string; key: string; before: Document | null; after: Document | null; hostId: string }>(journal.stream).filter(event => event.type === 'document-mutation'); }
function observeRows(t: TestContext, beforeRows?: () => void) {
  const original = DatabaseSync.prototype.prepare; let documents = 0, events = 0;
  t.mock.method(DatabaseSync.prototype, 'prepare', function(this: DatabaseSync, sql: string) {
    if (sql === 'SELECT namespace,key,revision,value FROM documents ORDER BY namespace,key') { documents++; beforeRows?.(); }
    if (sql === 'SELECT * FROM events WHERE sequence>? ORDER BY sequence') events++;
    return original.call(this, sql);
  });
  return { get documents() { return documents; }, get events() { return events; } };
}

test('one atomic anchor preserves initial rows and every intermediate update, deletion and recreation', t => {
  const f = fixture(t), initial = f.open(); initial.put('z', 'old', { note: 'before activation' }, null); initial.put('a', 'first', false, null);
  initial.append({ id: 'prior', stream: 'ordinary', type: 'observation', data: 1 });
  const store = f.open(journal), binding = store.documentJournalBinding()!;
  assert.equal(binding.anchorSequence, 2);
  assert.deepEqual(store.events(journal.stream)[0]!.data, { schema: 'aeon.document-journal.v1', hostId: journal.hostId, maxAnchorDocuments: journal.maxAnchorDocuments, maxAnchorBytes: journal.maxAnchorBytes, documents: [{ namespace: 'a', key: 'first', revision: 1, value: false }, { namespace: 'z', key: 'old', revision: 1, value: { note: 'before activation' } }] });
  store.put('z', 'old', { note: 'middle' }, 1); store.put('z', 'old', { note: 'last' }, 2); store.delete('z', 'old', 3); store.put('z', 'old', 'recreated', null);
  const history = mutations(store);
  assert.deepEqual(history.map(event => [event.data.before, event.data.after]), [
    [{ revision: 1, value: { note: 'before activation' } }, { revision: 2, value: { note: 'middle' } }],
    [{ revision: 2, value: { note: 'middle' } }, { revision: 3, value: { note: 'last' } }],
    [{ revision: 3, value: { note: 'last' } }, null], [null, { revision: 1, value: 'recreated' }],
  ]);
  assert.deepEqual(history.map(event => event.sequence), [3, 4, 5, 6]); assert.equal(new Set(history.map(event => event.id)).size, 4);
  assert.ok(history.every(event => event.data.hostId === journal.hostId && event.data.namespace === 'z' && event.data.key === 'old'));
});

test('CAS and JSON serialization refusal create neither new document state nor journal records', t => {
  const store = fixture(t).open(journal); store.put('memory', 'belief', { confidence: 0.5 }, null);
  const before = store.captureDevelopmentSnapshot(limits);
  assert.throws(() => store.put('memory', 'belief', { confidence: 1 }, null), RevisionConflict);
  assert.throws(() => store.delete('memory', 'belief', 2), RevisionConflict);
  assert.throws(() => store.put('memory', 'belief', { confidence: NaN }, 1));
  assert.deepEqual(store.captureDevelopmentSnapshot(limits), before);
});

test('SQLite journal INSERT failure rolls back actual put and delete while preserving committed history', t => {
  const f = fixture(t), store = f.open(journal); store.put('memory', 'belief', 'old', null);
  const before = store.captureDevelopmentSnapshot(limits);
  f.sql(db => db.exec("CREATE TRIGGER refuse_journal BEFORE INSERT ON events WHEN NEW.type='document-mutation' BEGIN SELECT RAISE(ABORT,'journal fault'); END"));
  assert.throws(() => store.put('memory', 'belief', 'new', 1), /journal fault/);
  assert.throws(() => store.put('memory', 'new', 'new', null), /journal fault/);
  assert.throws(() => store.delete('memory', 'belief', 1), /journal fault/);
  assert.deepEqual(store.captureDevelopmentSnapshot(limits), before);
});

test('SQLite document SQL failure cannot publish a mutation event', t => {
  const f = fixture(t), store = f.open(journal); store.put('memory', 'belief', 'old', null);
  const before = store.captureDevelopmentSnapshot(limits);
  f.sql(db => db.exec("CREATE TRIGGER refuse_document BEFORE INSERT ON documents BEGIN SELECT RAISE(ABORT,'document fault'); END; CREATE TRIGGER refuse_delete BEFORE DELETE ON documents BEGIN SELECT RAISE(ABORT,'delete fault'); END"));
  assert.throws(() => store.put('memory', 'belief', 'new', 1), /document fault/); assert.throws(() => store.delete('memory', 'belief', 1), /delete fault/);
  assert.deepEqual(store.captureDevelopmentSnapshot(limits), before);
});

test('outer rollback removes nested documents and events; a caught savepoint failure leaves valid sibling writes', t => {
  const f = fixture(t), store = f.open(journal), observer = f.open(); const before = store.captureDevelopmentSnapshot(limits);
  assert.throws(() => store.transaction(() => {
    store.put('memory', 'one', 1, null); store.put('memory', 'one', 2, 1); store.delete('memory', 'one', 2);
    assert.equal(observer.get('memory', 'one'), undefined); assert.deepEqual(observer.events(), before.events);
    throw Error('outer failure');
  }), /outer failure/);
  assert.deepEqual(store.captureDevelopmentSnapshot(limits), before);
  store.transaction(() => {
    store.put('memory', 'one', 1, null);
    assert.throws(() => store.transaction(() => { store.put('memory', 'one', 2, 1); throw Error('nested failure'); }));
    store.put('memory', 'two', 2, null);
  });
  assert.equal(mutations(store).length, 2); assert.deepEqual(observer.get('memory', 'one'), { revision: 1, value: 1 }); assert.equal(observer.get('memory', 'two')?.value, 2);
});

test('durable binding is honored by reopen and handles opened before activation, without constructor options', t => {
  const f = fixture(t), earlier = f.open(), owner = f.open(journal), binding = owner.documentJournalBinding(); f.close(owner);
  earlier.put('memory', 'one', 1, null);
  const reopened = f.open(); reopened.put('memory', 'one', 2, 1); earlier.delete('memory', 'one', 2);
  assert.deepEqual(reopened.documentJournalBinding(), binding); assert.equal(mutations(reopened).length, 3);
  assert.deepEqual(mutations(reopened).map(event => event.data.after), [{ revision: 1, value: 1 }, { revision: 2, value: 2 }, null]);
});

test('explicit disable and contradictory stream, host or bounds refuse on reopen and stale disabled writers', t => {
  const f = fixture(t), disabled = f.open(null), owner = f.open(journal);
  for (const option of [null, { ...journal, stream: 'foreign' }, { ...journal, hostId: 'foreign' }, { ...journal, maxAnchorBytes: journal.maxAnchorBytes + 1 }, { ...journal, maxAnchorDocuments: journal.maxAnchorDocuments + 1 }]) assert.throws(() => f.open(option), /cannot open operational state/);
  assert.throws(() => disabled.put('memory', 'new', 1, null), /cannot be disabled/);
  assert.equal(owner.get('memory', 'new'), undefined); assert.equal(mutations(owner).length, 0);
  assert.deepEqual(f.open({ ...journal }).documentJournalBinding(), owner.documentJournalBinding());
});

test('generic mutation cannot change/delete reserved binding or forge journal events', t => {
  const store = fixture(t).open(journal), before = store.captureDevelopmentSnapshot(limits);
  assert.throws(() => store.put(DOCUMENT_JOURNAL_NAMESPACE, DOCUMENT_JOURNAL_KEY, {}, 1), /reserved/);
  assert.throws(() => store.put(DOCUMENT_JOURNAL_NAMESPACE, 'other', {}, null), /reserved/);
  assert.throws(() => store.delete(DOCUMENT_JOURNAL_NAMESPACE, DOCUMENT_JOURNAL_KEY, 1), /reserved/);
  for (const type of ['document-mutation', 'document-journal-anchor']) assert.throws(() => store.append({ id: 'forged', stream: 'unrelated', type, data: {} }), /reserved/);
  assert.deepEqual(store.captureDevelopmentSnapshot(limits), before);
});

test('changed or deleted durable metadata and missing anchor refuse further writes and reopen', t => {
  for (const sabotage of ['changed', 'deleted', 'anchor'] as const) {
    const f = fixture(t), store = f.open(journal), binding = store.documentJournalBinding()!;
    f.sql(db => {
      if (sabotage === 'changed') db.prepare('UPDATE documents SET value=? WHERE namespace=?').run(canonicalJson({ ...binding, hostId: 'foreign' }), DOCUMENT_JOURNAL_NAMESPACE);
      if (sabotage === 'deleted') db.prepare('DELETE FROM documents WHERE namespace=?').run(DOCUMENT_JOURNAL_NAMESPACE);
      if (sabotage === 'anchor') db.prepare('DELETE FROM events WHERE id=?').run(binding.anchorId);
    });
    assert.throws(() => store.put('memory', 'new', 1, null)); assert.throws(() => store.captureDevelopmentSnapshot(limits)); assert.throws(() => f.open(), /cannot open operational state/);
    assert.equal(store.get('memory', 'new'), undefined);
  }
});

test('anchor row and UTF8 byte ceilings refuse before row materialization and leave no partial binding', t => {
  const f = fixture(t), initial = f.open(); initial.put('memory', '😀', '😀'.repeat(30), null); const seen = observeRows(t);
  assert.throws(() => f.open({ ...journal, maxAnchorDocuments: 0 }), /cannot open operational state/);
  assert.throws(() => f.open({ ...journal, maxAnchorBytes: 750 }), /cannot open operational state/);
  assert.equal(seen.documents, 0); assert.equal(initial.documentJournalBinding(), null); assert.equal(initial.events().length, 0);
  assert.deepEqual(f.open(journal).events(journal.stream)[0]!.data, { schema: 'aeon.document-journal.v1', hostId: journal.hostId, maxAnchorDocuments: journal.maxAnchorDocuments, maxAnchorBytes: journal.maxAnchorBytes, documents: [{ namespace: 'memory', key: '😀', revision: 1, value: '😀'.repeat(30) }] });
});

test('anchor INSERT or binding INSERT failure rolls back activation, leaving ordinary state unchanged', t => {
  for (const target of ['events', 'documents']) {
    const f = fixture(t), store = f.open(); store.put('memory', 'old', 1, null);
    f.sql(db => db.exec(`CREATE TRIGGER refuse_anchor BEFORE INSERT ON ${target} BEGIN SELECT RAISE(ABORT,'activation fault'); END`));
    assert.throws(() => f.open(journal), /cannot open operational state/);
    assert.equal(store.documentJournalBinding(), null); assert.equal(store.events().length, 0); assert.deepEqual(store.get('memory', 'old'), { revision: 1, value: 1 });
  }
});

test('snapshot contains exact global events and all current documents, through deletion and reopen', t => {
  const f = fixture(t), store = f.open(journal); store.put('memory', '😀', { text: 'λ😀\u0000' }, null);
  store.append({ id: 'external', stream: 'runtime', type: 'observation', data: { observation: 'complete' } }); store.delete('memory', '😀', 1);
  const snapshot = store.captureDevelopmentSnapshot(limits);
  assert.equal(snapshot.events.length, 4); assert.deepEqual(snapshot.events, store.events()); assert.equal(snapshot.documents.length, 1);
  assert.equal(snapshot.documents[0]!.namespace, DOCUMENT_JOURNAL_NAMESPACE); assert.deepEqual(snapshot.documents[0]!.value, snapshot.journalBinding);
  f.close(store); assert.deepEqual(f.open().captureDevelopmentSnapshot(limits), snapshot);
});

test('snapshot invalid, zero, row and Unicode byte ceilings refuse before materializing values', t => {
  const f = fixture(t), store = f.open(); store.put('memory', '😀', '😀'.repeat(50), null); store.append({ id: 'one', stream: 'runtime', type: 'observation', data: 1 }); const seen = observeRows(t);
  for (const maxRows of [-1, 513, Infinity, NaN, 0.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => store.captureDevelopmentSnapshot({ ...limits, maxRows }), /invalid/);
  for (const maxBytes of [-1, 1_048_577, Infinity, NaN, 0.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => store.captureDevelopmentSnapshot({ ...limits, maxBytes }), /invalid/);
  assert.throws(() => store.captureDevelopmentSnapshot({ ...limits, maxRows: 0 }), /exceeds/);
  assert.throws(() => store.captureDevelopmentSnapshot({ ...limits, maxRows: 1 }), /exceeds/);
  assert.throws(() => store.captureDevelopmentSnapshot({ ...limits, maxBytes: 0 }), /exceeds/);
  assert.throws(() => store.captureDevelopmentSnapshot({ ...limits, maxBytes: 1200 }), /exceeds/);
  assert.equal(seen.documents, 0); assert.equal(seen.events, 0);
  assert.equal(store.captureDevelopmentSnapshot({ ...limits, maxRows: 2 }).documents[0]!.value, '😀'.repeat(50));
});

test('snapshot preflight and materialization hold the same transaction against real competing writes', t => {
  const f = fixture(t), store = f.open(journal); store.put('memory', 'belief', 1, null);
  const other = new DatabaseSync(f.filename); other.exec('PRAGMA busy_timeout=1'); t.after(() => other.close()); let attempted = false;
  observeRows(t, () => {
    attempted = true;
    assert.throws(() => other.prepare('UPDATE documents SET value=? WHERE namespace=? AND key=?').run(canonicalJson('much larger replacement'), 'memory', 'belief'), /locked/);
    assert.throws(() => other.prepare('DELETE FROM events WHERE type=?').run('document-mutation'), /locked/);
  });
  const snapshot = store.captureDevelopmentSnapshot(limits); assert.equal(attempted, true);
  assert.deepEqual(snapshot.documents.find(row => row.namespace === 'memory'), { namespace: 'memory', key: 'belief', revision: 1, value: 1 }); assert.equal(snapshot.events.length, 2);
});

test('snapshot rejects corrupt JSON and oversized raw sources rather than returning partial evidence', t => {
  const f = fixture(t), store = f.open(journal); store.put('memory', 'belief', 1, null);
  f.sql(db => db.prepare('UPDATE documents SET value=? WHERE namespace=?').run('{broken', 'memory'));
  assert.throws(() => store.captureDevelopmentSnapshot(limits), SyntaxError);
  f.sql(db => db.prepare('UPDATE documents SET value=? WHERE namespace=?').run(canonicalJson('😀'.repeat(50_000)), 'memory'));
  const seen = observeRows(t); assert.throws(() => store.captureDevelopmentSnapshot(limits), /exceeds/); assert.equal(seen.documents, 0); assert.equal(seen.events, 0);
});

test('ordinary unbound stores keep ordinary event/document behavior and report null journal completeness', t => {
  const store = fixture(t).open(null); store.put('memory', 'one', 1, null); store.put('memory', 'one', 2, 1); store.delete('memory', 'one', 2); store.put('memory', 'one', 3, null);
  assert.equal(store.events().length, 0); assert.equal(store.documentJournalBinding(), null);
  store.append({ id: 'ordinary', stream: 'runtime', type: 'input', data: 1 });
  const snapshot = store.captureDevelopmentSnapshot(limits); assert.equal(snapshot.journalBinding, null); assert.equal(snapshot.events.length, 1); assert.deepEqual(snapshot.documents, [{ namespace: 'memory', key: 'one', revision: 1, value: 3 }]);
});

test('fresh omitted-option reopen refuses changed persisted anchor ceilings', t => {
  for (const field of ['maxAnchorDocuments', 'maxAnchorBytes'] as const) {
    const f = fixture(t), store = f.open(journal), binding = store.documentJournalBinding()!;
    f.sql(db => db.prepare('UPDATE documents SET value=? WHERE namespace=?').run(canonicalJson({ ...binding, [field]: binding[field] + 1 }), DOCUMENT_JOURNAL_NAMESPACE));
    assert.throws(() => f.open(), /cannot open operational state/); assert.throws(() => store.put('memory', 'new', 1, null), /changed/);
  }
});

test('snapshot refuses missing internal or trailing events before materializing a partial prefix', t => {
  for (const deleted of [1, 2]) {
    const f = fixture(t), store = f.open(); store.append({ id: 'one', stream: 'runtime', type: 'input', data: 1 }); store.append({ id: 'two', stream: 'runtime', type: 'input', data: 2 });
    f.sql(db => db.prepare('DELETE FROM events WHERE sequence=?').run(deleted)); const seen = observeRows(t);
    assert.throws(() => store.captureDevelopmentSnapshot(limits), /event prefix incomplete/); assert.equal(seen.documents, 0); assert.equal(seen.events, 0);
  }
});

test('snapshot corrupt event JSON refuses while empty ordinary snapshot remains complete', t => {
  const f = fixture(t), store = f.open(); assert.deepEqual(store.captureDevelopmentSnapshot(limits), { documents: [], events: [], journalBinding: null });
  store.append({ id: 'one', stream: 'runtime', type: 'input', data: 1 }); f.sql(db => db.prepare('UPDATE events SET data=? WHERE id=?').run('{broken', 'one'));
  assert.throws(() => store.captureDevelopmentSnapshot(limits), SyntaxError);
});

test('invalid host anchor options refuse without persisting a partial anchor', t => {
  const f = fixture(t), store = f.open();
  for (const bound of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => f.open({ ...journal, maxAnchorDocuments: bound }), /cannot open/); assert.throws(() => f.open({ ...journal, maxAnchorBytes: bound }), /cannot open/);
  }
  assert.throws(() => f.open({ ...journal, hostId: '' }), /cannot open/); assert.throws(() => f.open({ ...journal, stream: '' }), /cannot open/);
  assert.throws(() => f.open({ ...journal, extra: 1 } as DocumentJournalOptions), /cannot open/);
  assert.equal(store.documentJournalBinding(), null); assert.equal(store.events().length, 0);
});
