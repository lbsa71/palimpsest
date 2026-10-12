import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../../contracts/common.ts';
import { OperationalStore, RevisionConflict, DOCUMENT_JOURNAL_NAMESPACE as META, DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE as PAYLOAD, DOCUMENT_JOURNAL_HEAD_NAMESPACE as HEAD, type JournalRef } from '../index.ts';
const options = { stream: 'review:journal', hostId: 'review-host', maxAnchorDocuments: 64, maxAnchorBytes: 150_000 };
const limits = { maxRows: 512, maxBytes: 1_048_576 };
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'jr1-review-')), filename = join(dir, 'state.sqlite'), stores: OperationalStore[] = [];
  t.after(() => { for (const store of stores) store.close(); rmSync(dir, { force: true, recursive: true }); });
  return { filename, open(bound = true) { const store = new OperationalStore({ filename, ...(bound ? { documentJournal: options } : {}) }); stores.push(store); return store; }, sql(fn: (db: DatabaseSync) => void) { const db = new DatabaseSync(filename); try { fn(db); } finally { db.close(); } } };
}
const target = (key: string, expectedRevision: number | null = 1, namespace = 'owner') => ({ namespace, key, expectedRevision });

test('independent cutoff preserves equal-byte owners, immutable prefix and future recreated incarnations', t => {
  const f = fixture(t), old = f.open(false); old.put('owner', 'a', 'same-value', null);
  const store = f.open(); store.put('owner', 'b', 'same-value', null); store.put('other', 'a', 'same-value', null);
  old.put('owner', 'a', 'intermediate', 1); old.delete('owner', 'a', 2); old.put('owner', 'a', 'same-value', null);
  const before = store.captureDevelopmentSnapshot(limits), owned = before.journalPayloads.filter(p => p.ref.namespace === 'owner' && p.ref.key === 'a');
  assert.deepEqual(owned.map(p => p.ref.revision).sort(), [1, 1, 2]);
  const request = { id: 'cutoff', reason: 'forget' as const, targets: [target('a')] }, result = store.withdrawDocumentJournalContent(request);
  assert.deepEqual(new Set(result.withdrawnVersionIds), new Set(owned.map(p => p.ref.versionId)));
  old.delete('owner', 'a', 1); old.put('owner', 'a', 'same-value', null);
  const after = f.open(false).captureDevelopmentSnapshot(limits);
  assert.deepEqual(after.events.slice(0, before.events.length), before.events);
  assert.ok(after.journalPayloads.filter(p => result.withdrawnVersionIds.includes(p.ref.versionId)).every(p => p.state === 'withdrawn'));
  assert.equal(after.journalPayloads.filter(p => p.state === 'available').length, 3);
  assert.deepEqual(old.withdrawDocumentJournalContent(request), result);
  assert.deepEqual(old.captureDevelopmentSnapshot(limits), after);
  assert.throws(() => old.withdrawDocumentJournalContent({ ...request, targets: [target('b')] }), /conflicting/);
  assert.throws(() => old.withdrawDocumentJournalContent({ id: 'stale', reason: 'forget', targets: [target('b'), target('a', 2)] }), RevisionConflict);
  assert.deepEqual(old.captureDevelopmentSnapshot(limits), after);
});

for (const fault of ['second-payload', 'marker'] as const) test(`independent ${fault} failure restores partial SQL work and caught savepoint permits sibling commit`, t => {
  const f = fixture(t), store = f.open(); store.put('owner', 'a', 'old-a', null); store.put('owner', 'b', 'old-b', null);
  const before = store.captureDevelopmentSnapshot(limits), second = before.journalPayloads[1]!.ref.versionId;
  f.sql(db => { if (fault === 'second-payload') db.exec(`CREATE TRIGGER fail_review BEFORE UPDATE ON documents WHEN NEW.namespace='${PAYLOAD}' AND NEW.key='${second}' BEGIN SELECT RAISE(ABORT,'review fault'); END`); else db.exec("CREATE TRIGGER fail_review BEFORE INSERT ON events WHEN NEW.type='document-journal-withdrawal' BEGIN SELECT RAISE(ABORT,'review fault'); END"); });
  const request = { id: 'retry', reason: 'forget' as const, targets: [target('a'), target('b')] };
  store.transaction(() => { assert.throws(() => store.withdrawDocumentJournalContent(request), /review fault/); assert.deepEqual(store.captureDevelopmentSnapshot(limits), before); store.put('sibling', 'ok', true, null); });
  assert.equal(f.open().get('sibling', 'ok')?.value, true);
  assert.ok(store.captureDevelopmentSnapshot(limits).journalPayloads.filter(p => p.ref.namespace === 'owner').every(p => p.state === 'available'));
  f.sql(db => db.exec('DROP TRIGGER fail_review'));
  const committed = store.captureDevelopmentSnapshot(limits);
  assert.throws(() => store.transaction(() => { store.withdrawDocumentJournalContent(request); throw Error('outer abort'); }), /outer abort/);
  assert.deepEqual(f.open().captureDevelopmentSnapshot(limits), committed);
  assert.equal(store.withdrawDocumentJournalContent(request).withdrawnVersionIds.length, 2);
});

for (const fault of ['orphan', 'ref-extra', 'current-digest', 'marker-id', 'marker-target', 'marker-reason', 'available-again', 'missing-head', 'reserved-row', 'prefix'] as const) test(`independent capture rejects ${fault} corruption`, t => {
  const f = fixture(t), store = f.open(); store.put('owner', 'a', 'version-a', null); store.put('owner', 'b', 'version-b', null);
  const before = store.captureDevelopmentSnapshot(limits), payload = before.journalPayloads[0]!;
  store.withdrawDocumentJournalContent({ id: 'withdraw', reason: 'forget', targets: [target('a'), target('b')] });
  f.sql(db => {
    if (fault === 'orphan') { const ref = { ...payload.ref, versionId: 'orphan-id' }; db.prepare('INSERT INTO documents VALUES(?,?,1,?)').run(PAYLOAD, ref.versionId, canonicalJson({ ...payload, ref })); }
    if (fault === 'ref-extra') db.prepare("UPDATE documents SET value=json_set(value,'$.ref.extra','forged') WHERE namespace=? AND key=?").run(PAYLOAD, payload.ref.versionId);
    if (fault === 'current-digest') db.prepare('UPDATE documents SET value=? WHERE namespace=? AND key=?').run(canonicalJson('forged-current'), 'owner', 'a');
    if (fault === 'marker-id') db.prepare("UPDATE events SET data=json_set(data,'$.withdrawalId','wrong') WHERE id='withdraw'").run();
    if (fault === 'marker-target') db.prepare("UPDATE events SET data=json_set(data,'$.targets[0].expectedRevision',9) WHERE id='withdraw'").run();
    if (fault === 'marker-reason') db.prepare("UPDATE events SET data=json_set(data,'$.reason','arbitrary raw content') WHERE id='withdraw'").run();
    if (fault === 'available-again') db.prepare('UPDATE documents SET revision=1,value=? WHERE namespace=? AND key=?').run(canonicalJson(payload), PAYLOAD, payload.ref.versionId);
    if (fault === 'missing-head') db.prepare('DELETE FROM documents WHERE namespace=? AND key=?').run(HEAD, canonicalJson(['owner', 'a']));
    if (fault === 'reserved-row') db.prepare('INSERT INTO documents VALUES(?,?,1,?)').run(`${META}.unexpected`, 'raw', canonicalJson('untracked-journal-value'));
    if (fault === 'prefix') db.prepare('DELETE FROM events WHERE sequence=2').run();
  });
  assert.throws(() => store.captureDevelopmentSnapshot(limits));
});

test('independent byte and row preflight includes hidden payloads before bulk selects and keeps hard ceilings', t => {
  const f = fixture(t), store = f.open(); store.put('owner', 'a', 'tiny', null);
  assert.throws(() => store.captureDevelopmentSnapshot({ ...limits, maxRows: 513 }), /invalid/);
  assert.throws(() => store.captureDevelopmentSnapshot({ ...limits, maxBytes: 1_048_577 }), /invalid/);
  const prepare = DatabaseSync.prototype.prepare; let bulk = 0;
  t.mock.method(DatabaseSync.prototype, 'prepare', function(this: DatabaseSync, sql: string) { if (/^SELECT (namespace,key,revision,value|key,revision,value|key,value|\*) FROM/.test(sql)) bulk++; return prepare.call(this, sql); });
  assert.throws(() => store.captureDevelopmentSnapshot({ ...limits, maxRows: 5 }), /exceeds/); assert.equal(bulk, 0);
  f.sql(db => db.prepare('UPDATE documents SET value=? WHERE namespace=?').run(canonicalJson('😀'.repeat(12_000)), PAYLOAD));
  assert.throws(() => store.captureDevelopmentSnapshot({ ...limits, maxBytes: 200_000 }), /exceeds/); assert.equal(bulk, 0);
});

test('independent anchor and cutoff use SQLite BINARY key order across unicode namespaces', t => {
  const f = fixture(t), old = f.open(false), keys = ['😀', '\uE000', 'é', 'a'];
  for (const [i, namespace] of keys.entries()) old.put(namespace, keys[(i + 1) % keys.length]!, i, null);
  const store = f.open(), snapshot = store.captureDevelopmentSnapshot(limits);
  const refs = (snapshot.events[0]!.data as unknown as { documents: JournalRef[] }).documents;
  assert.deepEqual(refs.map(ref => ref.namespace), ['a', 'é', '\uE000', '😀']);
  const targets = refs.map(ref => target(ref.key, 1, ref.namespace)).reverse();
  assert.equal(old.withdrawDocumentJournalContent({ id: 'unicode-cutoff', reason: 'expiry', targets }).withdrawnVersionIds.length, 4);
  const after = f.open().captureDevelopmentSnapshot(limits);
  assert.deepEqual((after.events.at(-1)!.data as unknown as { targets: typeof targets }).targets.map(t => t.namespace), ['a', 'é', '\uE000', '😀']);
});
