import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../../contracts/common.ts';
import { OperationalStore, RevisionConflict, DOCUMENT_JOURNAL_NAMESPACE, DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE, DOCUMENT_JOURNAL_HEAD_NAMESPACE, type JournalRef, type JournalWithdrawalInput } from '../index.ts';

const journal = { stream: 'retention:host', hostId: 'synthetic-retention-host', maxAnchorDocuments: 100, maxAnchorBytes: 100_000 };
const limits = { maxRows: 512, maxBytes: 1_048_576 };
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'aeon-retention-')), filename = join(dir, 'state.sqlite'), stores = new Set<OperationalStore>();
  t.after(() => { for (const store of stores) store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { open(bound = true) { const store = new OperationalStore({ filename, ...(bound ? { documentJournal: journal } : {}) }); stores.add(store); return store; }, close(store: OperationalStore) { store.close(); stores.delete(store); }, sql(fn: (db: DatabaseSync) => void) { const db = new DatabaseSync(filename); try { fn(db); } finally { db.close(); } } };
}
function request(id = 'withdraw', expectedRevision: number | null = 1): JournalWithdrawalInput { return { id, reason: 'forget', targets: [{ namespace: 'memory', key: 'one', expectedRevision }] }; }

test('withdrawal preserves immutable refs, isolates equal bytes, and cannot hydrate old refs from later versions', t => {
  const f = fixture(t), store = f.open();
  store.put('memory', 'one', 'identical', null); store.put('memory', 'two', 'identical', null); store.put('other', 'one', 'identical', null);
  const before = store.captureDevelopmentSnapshot(limits), old = before.journalPayloads.find(p => p.ref.namespace === 'memory' && p.ref.key === 'one')!.ref;
  store.put('memory', 'one', 'changed', 1); store.delete('memory', 'one', 2); store.put('memory', 'one', 'identical', null);
  const versions = store.captureDevelopmentSnapshot(limits).journalPayloads.filter(p => p.ref.namespace === 'memory' && p.ref.key === 'one');
  assert.equal(versions.length, 3); assert.equal(new Set(versions.map(p => p.ref.versionId)).size, 3);
  const prefix = store.events(), outcome = store.withdrawDocumentJournalContent(request());
  assert.deepEqual(new Set(outcome.withdrawnVersionIds), new Set(versions.map(p => p.ref.versionId)));
  const after = f.open().captureDevelopmentSnapshot(limits);
  assert.deepEqual(after.events.slice(0, prefix.length), prefix);
  assert.ok(after.journalPayloads.filter(p => outcome.withdrawnVersionIds.includes(p.ref.versionId)).every(p => p.state === 'withdrawn' && !('document' in p)));
  assert.ok(after.journalPayloads.filter(p => !outcome.withdrawnVersionIds.includes(p.ref.versionId)).every(p => p.state === 'available'));
  // Current live values are not erased by the storage-only diagnostic-history operation.
  assert.equal(store.get('memory', 'one')?.value, 'identical');
  store.put('memory', 'one', 'identical', 1);
  const future = store.captureDevelopmentSnapshot(limits), latest = future.journalPayloads.filter(p => p.ref.namespace === 'memory' && p.ref.key === 'one' && p.state === 'available');
  assert.equal(latest.length, 1); assert.notEqual(latest[0]!.ref.versionId, old.versionId);
  assert.equal(future.journalPayloads.find(p => p.ref.versionId === old.versionId)!.state, 'withdrawn');
  assert.deepEqual(store.withdrawDocumentJournalContent(request()), outcome);
  assert.equal(store.captureDevelopmentSnapshot(limits).journalPayloads.find(p => p.ref.versionId === latest[0]!.ref.versionId)!.state, 'available');
  assert.throws(() => store.withdrawDocumentJournalContent({ ...request(), reason: 'expiry' }), /conflicting withdrawal identity/);
  assert.throws(() => store.withdrawDocumentJournalContent(request('stale', 1)), RevisionConflict);
});

for (const failure of ['payload', 'marker'] as const) test(`actual ${failure} SQL failure rolls back all dispositions and leaves current payloads usable`, t => {
  const f = fixture(t), store = f.open(); store.put('memory', 'one', 'before', null); store.put('memory', 'one', 'now', 1);
  const before = store.captureDevelopmentSnapshot(limits);
  f.sql(db => db.exec(failure === 'payload'
    ? `CREATE TRIGGER fail_withdraw BEFORE UPDATE ON documents WHEN NEW.namespace='${DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE}' BEGIN SELECT RAISE(ABORT,'payload withdrawal fault'); END`
    : "CREATE TRIGGER fail_withdraw BEFORE INSERT ON events WHEN NEW.type='document-journal-withdrawal' BEGIN SELECT RAISE(ABORT,'marker withdrawal fault'); END"));
  assert.throws(() => store.withdrawDocumentJournalContent(request('failure', 2)), /withdrawal fault/);
  assert.deepEqual(f.open().captureDevelopmentSnapshot(limits), before);
  f.sql(db => db.exec('DROP TRIGGER fail_withdraw'));
  assert.equal(store.withdrawDocumentJournalContent(request('failure', 2)).withdrawnVersionIds.length, 2);
});

test('outer and caught savepoint rollback preserve withdrawal identity, visibility and sibling writes', t => {
  const f = fixture(t), store = f.open(), observer = f.open(); store.put('memory', 'one', 'before', null);
  const before = store.captureDevelopmentSnapshot(limits);
  assert.throws(() => store.transaction(() => {
    store.withdrawDocumentJournalContent(request('rollback'));
    assert.equal(store.captureDevelopmentSnapshot(limits).journalPayloads[0]!.state, 'withdrawn');
    assert.deepEqual(observer.events(), before.events);
    assert.equal(observer.get<{ state: string }>(DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE, before.journalPayloads[0]!.ref.versionId)!.value.state, 'available');
    throw Error('outer rollback');
  }), /outer rollback/);
  assert.deepEqual(f.open().captureDevelopmentSnapshot(limits), before);
  store.transaction(() => {
    assert.throws(() => store.transaction(() => { store.withdrawDocumentJournalContent(request('rollback')); throw Error('savepoint rollback'); }), /savepoint rollback/);
    store.put('sibling', 'committed', true, null);
  });
  assert.equal(store.captureDevelopmentSnapshot(limits).journalPayloads.find(p => p.ref.namespace === 'memory')!.state, 'available');
  store.withdrawDocumentJournalContent(request('rollback'));
  assert.equal(observer.captureDevelopmentSnapshot(limits).journalPayloads.find(p => p.ref.namespace === 'memory')!.state, 'withdrawn');
  assert.equal(observer.get('sibling', 'committed')?.value, true);
});

test('activation payloads can be withdrawn and preexisting handles never rehydrate their withdrawn before refs', t => {
  const f = fixture(t), stale = f.open(false); stale.put('memory', 'one', 'anchor-owned', null);
  const owner = f.open(), anchor = owner.events()[0]!.data as unknown as { documents: JournalRef[] };
  assert.equal(anchor.documents.length, 1); assert.equal('value' in anchor.documents[0]!, false);
  owner.withdrawDocumentJournalContent(request()); f.close(owner);
  stale.put('memory', 'one', 'future', 1); stale.delete('memory', 'one', 2);
  const snapshot = f.open(false).captureDevelopmentSnapshot(limits);
  assert.equal(snapshot.journalPayloads.find(p => p.ref.versionId === anchor.documents[0]!.versionId)!.state, 'withdrawn');
  assert.equal(canonicalJson(snapshot).includes('anchor-owned'), false);
  assert.ok(snapshot.journalPayloads.some(p => p.state === 'available' && p.document.value === 'future'));
});

for (const fault of ['missing', 'commitment', 'withdrawn-without-marker', 'wrong-marker', 'reordered', 'head'] as const) test(`snapshot rejects ${fault} ref/payload corruption rather than inferring erasure`, t => {
  const f = fixture(t), store = f.open(); store.put('memory', 'one', 'retained', null); store.put('memory', 'one', 'current', 1);
  const first = store.captureDevelopmentSnapshot(limits).journalPayloads.find(p => p.ref.revision === 1)!;
  if (fault === 'wrong-marker') store.withdrawDocumentJournalContent(request('valid', 2));
  f.sql(db => {
    if (fault === 'missing') db.prepare('DELETE FROM documents WHERE namespace=? AND key=?').run(DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE, first.ref.versionId);
    if (fault === 'commitment') db.prepare('UPDATE documents SET value=? WHERE namespace=? AND key=?').run(canonicalJson({ ...first, document: { revision: 1, value: 'forged' } }), DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE, first.ref.versionId);
    if (fault === 'wrong-marker') db.prepare("UPDATE events SET data=json_set(data,'$.refs',json('[]')) WHERE id='valid'").run();
    if (fault === 'withdrawn-without-marker') db.prepare('UPDATE documents SET revision=2,value=? WHERE namespace=? AND key=?').run(canonicalJson({ ref: first.ref, state: 'withdrawn', withdrawalId: 'forged' }), DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE, first.ref.versionId);
    if (fault === 'reordered') { const data = store.events().filter(e => e.type === 'document-mutation')[1]!.data as unknown as { before: JournalRef }; db.prepare("UPDATE events SET data=json_set(data,'$.before',json(?)) WHERE sequence=2").run(canonicalJson(data.before)); }
    if (fault === 'head') db.prepare('UPDATE documents SET value=? WHERE namespace=?').run(canonicalJson(first.ref), DOCUMENT_JOURNAL_HEAD_NAMESPACE);
  });
  assert.throws(() => store.captureDevelopmentSnapshot(limits));
});

test('all reserved namespaces and withdrawal event type refuse generic writes including mutable caller input', t => {
  const store = fixture(t).open(), before = store.captureDevelopmentSnapshot(limits);
  for (const namespace of [DOCUMENT_JOURNAL_NAMESPACE, DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE, DOCUMENT_JOURNAL_HEAD_NAMESPACE, `${DOCUMENT_JOURNAL_NAMESPACE}.future`]) {
    assert.throws(() => store.put(namespace, 'forged', 'raw', null), /reserved/);
    assert.throws(() => store.delete(namespace, 'forged', 1), /reserved/);
  }
  assert.throws(() => store.append({ id: 'forged', stream: journal.stream, type: 'document-journal-withdrawal', data: {} }), /reserved/);
  const input = { id: 'ordinary', stream: journal.stream, type: 'observation', get data() { this.type = 'document-journal-withdrawal'; return {}; } };
  const event = store.append(input); assert.equal(event.type, 'observation');
  assert.deepEqual(store.captureDevelopmentSnapshot(limits).journalPayloads, before.journalPayloads);
  assert.equal(store.events().filter(e => e.type === 'document-journal-withdrawal').length, 0);
});

test('capture counts payload/head rows and UTF8 bytes before materialization; activation counts prospective internal rows', t => {
  const f = fixture(t), store = f.open(false); store.put('memory', 'one', '😀'.repeat(50), null);
  assert.throws(() => new OperationalStore({ filename: store.filename, documentJournal: { ...journal, maxAnchorDocuments: 3 } }));
  assert.equal(store.documentJournalBinding(), null);
  const bound = f.open(); const snapshot = bound.captureDevelopmentSnapshot(limits); assert.equal(snapshot.documents.length, 2); assert.equal(snapshot.events.length, 1); assert.equal(snapshot.journalPayloads.length, 1);
  const original = DatabaseSync.prototype.prepare; let reads = 0;
  t.mock.method(DatabaseSync.prototype, 'prepare', function(this: DatabaseSync, sql: string) { if (/^SELECT (namespace,key,revision,value|key,revision,value|\*) FROM/.test(sql)) reads++; return original.call(this, sql); });
  assert.throws(() => bound.captureDevelopmentSnapshot({ ...limits, maxRows: 4 }), /exceeds/);
  assert.throws(() => bound.captureDevelopmentSnapshot({ ...limits, maxBytes: 1000 }), /exceeds/);
  assert.equal(reads, 0);
  assert.equal(bound.captureDevelopmentSnapshot({ ...limits, maxRows: 5 }).journalPayloads.length, 1);
});

test('v1 journals refuse explicitly without rewriting historical rows, while unbound withdrawal validates CAS and creates nothing', t => {
  const f = fixture(t), unbound = f.open(false); unbound.put('memory', 'one', 'ordinary', null);
  const before = unbound.captureDevelopmentSnapshot(limits);
  assert.throws(() => unbound.withdrawDocumentJournalContent(request('stale', 2)), RevisionConflict);
  assert.deepEqual(unbound.withdrawDocumentJournalContent(request()), { withdrawalId: null, withdrawnVersionIds: [] });
  assert.deepEqual(unbound.captureDevelopmentSnapshot(limits), before);
  const store = f.open();
  f.sql(db => db.prepare("UPDATE documents SET value=json_set(value,'$.schema','aeon.document-journal.v1') WHERE namespace=?").run(DOCUMENT_JOURNAL_NAMESPACE));
  assert.throws(() => store.documentJournalBinding(), /unsupported document journal schema aeon.document-journal.v1/);
  assert.throws(() => f.open(false), error => error instanceof Error && String(error.cause).includes('unsupported document journal schema aeon.document-journal.v1'));
  f.sql(db => { assert.equal((db.prepare('SELECT value FROM documents WHERE namespace=?').get(DOCUMENT_JOURNAL_NAMESPACE) as { value: string }).value.includes('aeon.document-journal.v1'), true); });
});

test('UTF8 binary ordering agrees across activation, target sorting and replay for BMP and supplementary keys', t => {
  const f = fixture(t), initial = f.open(false);
  for (const namespace of ['\uE000', '😀']) for (const key of ['\uE000', '😀']) initial.put(namespace, key, `${namespace}:${key}`, null);
  const bound = f.open(), before = bound.captureDevelopmentSnapshot(limits);
  const targets = before.documents.filter(row => row.namespace !== DOCUMENT_JOURNAL_NAMESPACE).reverse().map(row => ({ namespace: row.namespace, key: row.key, expectedRevision: row.revision }));
  assert.equal(bound.withdrawDocumentJournalContent({ id: 'unicode', reason: 'forget', targets }).withdrawnVersionIds.length, 4);
  assert.equal(f.open().captureDevelopmentSnapshot(limits).journalPayloads.filter(p => p.state === 'withdrawn').length, 4);
});
