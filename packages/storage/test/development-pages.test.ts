import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson, identity, type ArtifactRef } from '../../contracts/common.ts';
import { DOCUMENT_JOURNAL_HEAD_NAMESPACE, DOCUMENT_JOURNAL_NAMESPACE, DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE, OperationalStore, type HistoricalSourceUse, type JournalRef, type PageCaptureBounds, type PhysicalDocumentRow, type SourceCut, type SourcePage, type StoredEvent } from '../index.ts';
import { AutarkApplication } from '../../../deployment/application.ts';
import type { ApplicationConfig } from '../../../deployment/config.ts';
import { AuthorityStore } from '../../supervisor/authority.ts';

const journal = { stream: 'development:bounded', hostId: 'host:bounded', maxAnchorDocuments: 100, maxAnchorBytes: 100_000 };
const bounds: PageCaptureBounds = { maxPageRows: 2, maxPageBytes: 16_000, maxPages: 100, maxPhysicalRows: 200, maxConservativeBytes: 1_000_000, maxSerializedBytes: 1_000_000, maxOperationalArtifacts: 10, maxOperationalArtifactBytes: 10_000, maxOperationalArtifactTotalBytes: 20_000 };
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'aeon-development-pages-')), filename = join(dir, 'operational.sqlite'), stores = new Set<OperationalStore>(), retained = new Map<string, Buffer>();
  t.after(() => { for (const store of stores) store.close(); rmSync(dir, { recursive: true, force: true }); });
  const retain = (bytes: Uint8Array): ArtifactRef => { const digest = sha(bytes); retained.set(digest, Buffer.from(bytes)); return { uri: `sha256:${digest}`, sha256: digest }; };
  const open = (bind = true) => { const store = new OperationalStore({ filename, ...(bind ? { documentJournal: journal } : {}) }); stores.add(store); return store; };
  const sql = (fn: (db: DatabaseSync) => void) => { const db = new DatabaseSync(filename); try { fn(db); } finally { db.close(); } };
  const capture = (store: OperationalStore, limits = bounds, resolve?: (ref: ArtifactRef, maxBytes: number) => Uint8Array) => store.captureDevelopmentPages(limits, retain, (_ref, bytes) => retain(bytes), resolve);
  const pages = (cut: SourceCut) => cut.pages.map(page => JSON.parse(retained.get(page.artifact.sha256)!.toString()) as SourcePage);
  return { dir, filename, open, sql, retain, capture, pages, retained };
}
function chain(table: 'documents' | 'events', rows: (PhysicalDocumentRow | StoredEvent)[]) { let digest = sha(`aeon.development.rows.v1:${table}`); for (const row of rows) digest = sha(canonicalJson([digest, row])); return digest; }
function refs(f: ReturnType<typeof fixture>, cut: SourceCut): JournalRef[] { return f.pages(cut).flatMap(page => page.table === 'documents' ? page.rows.filter(row => row.namespace === DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE).map(row => (row.value as unknown as { ref: JournalRef }).ref) : []).sort((a, b) => a.versionId < b.versionId ? -1 : 1); }
function historical(cut: SourceCut, requiredVersions: JournalRef[]): HistoricalSourceUse { return { journalDigest: identity(cut.journalBinding), prefix: { lastSequence: cut.lastSequence, eventsDigest: cut.eventsDigest }, requiredVersions, maxPageRows: bounds.maxPageRows, maxPageBytes: bounds.maxPageBytes, maxPrefixBytes: bounds.maxConservativeBytes, maxVersions: bounds.maxPhysicalRows, maxVersionBytes: bounds.maxConservativeBytes, maxWithdrawalMarkerBytes: bounds.maxPageBytes }; }
function valueReads(t: TestContext) {
  const original = DatabaseSync.prototype.prepare, reads: string[] = [];
  t.mock.method(DatabaseSync.prototype, 'prepare', function(this: DatabaseSync, query: string) { if (/^SELECT (CAST\(namespace AS BLOB\)|CAST\(id AS BLOB\)|sequence,CAST\(id AS BLOB\)|namespace,key,revision,value|sequence,id,stream,type,data|key,revision,value|revision,CAST\(value AS BLOB\)|revision,value|key,value|sequence,stream,type,data)/.test(query)) reads.push(query); return original.call(this, query); });
  return reads;
}

test('complete pages include all physical internals and exact intermediate graph/global row chains', t => {
  const f = fixture(t), initial = f.open(false); initial.put('z', 'old', 'anchor', null); initial.append({ id: 'ordinary-before', stream: 'ordinary', type: 'input', data: { x: 1 } });
  const store = f.open(); store.put('z', 'old', 'middle', 1); store.put('z', 'old', 'last', 2); store.delete('z', 'old', 3); store.put('z', 'old', 'recreated', null);
  store.put('α', '\u0000😀', { text: 'λ😀\u0000\\"' }, null); store.append({ id: 'accounting', stream: 'ledger', type: 'settlement', data: { status: 'unknown' } });
  const expectedEvents = store.events(), cut = f.capture(store), pages = f.pages(cut), docs = pages.flatMap(page => page.table === 'documents' ? page.rows : []), events = pages.flatMap(page => page.table === 'events' ? page.rows : []);
  let physical = 0; f.sql(db => { physical = (db.prepare('SELECT count(*) AS n FROM documents').get() as { n: number }).n; });
  assert.ok(cut.pages.filter(page => page.table === 'documents').length > 1); assert.ok(cut.pages.filter(page => page.table === 'events').length > 1);
  assert.equal(cut.documents, physical); assert.equal(docs.length, physical); assert.equal(cut.physicalRows, physical + events.length); assert.deepEqual(events, expectedEvents);
  assert.equal(cut.documentsDigest, chain('documents', docs)); assert.equal(cut.eventsDigest, chain('events', events)); assert.equal(cut.lastSequence, events.length);
  assert.equal(docs.filter(row => row.namespace === DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE).length, 5); assert.equal(docs.filter(row => row.namespace === DOCUMENT_JOURNAL_HEAD_NAMESPACE).length, 2);
  const values = docs.filter(row => row.namespace === DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE).map(row => (row.value as unknown as { document: { value: unknown } }).document.value);
  for (const value of ['anchor', 'middle', 'last', 'recreated']) assert.ok(values.includes(value));
  assert.equal(cut.serializedBytes, cut.pages.reduce((sum, page) => sum + page.bytes, 0)); assert.equal(cut.conservativeBytes, cut.pages.reduce((sum, page) => sum + page.conservativeBytes, 0));
  for (const page of cut.pages) { assert.ok(page.rows <= bounds.maxPageRows); assert.ok(page.bytes <= page.conservativeBytes && page.conservativeBytes <= bounds.maxPageBytes); }
  const second = f.capture(store); assert.deepEqual(second, cut); assert.equal(f.retained.size, cut.pages.length);
});

test('paged path never invokes full document/event/snapshot validation helpers', t => {
  const f = fixture(t), store = f.open(); store.put('memory', 'belief', 1, null);
  const methods = store as unknown as Record<string, () => never>;
  for (const name of ['documentRows', 'events', 'snapshotForJournalValidation', 'validateJournalSnapshot']) t.mock.method(methods, name, () => { throw new Error(`unbounded helper ${name}`); });
  assert.ok(f.capture(store).physicalRows > 0);
});

test('historical graph supports many initial anchor refs within its byte and version budgets', t => {
  const f = fixture(t), initial = f.open(false); for (let i = 0; i < 20; i++) initial.put('initial', `key-${i}`, i, null);
  const store = f.open(), limits = { ...bounds, maxPageBytes: 100_000, maxPages: 100, maxConservativeBytes: 1_000_000 }, cut = f.capture(store, limits), input = { ...historical(cut, refs(f, cut)), maxPageBytes: 100_000 };
  assert.equal(cut.events, 1); assert.equal(store.withDevelopmentVersionsAvailable(input, observation => observation.checkedVersions), 20);
});

test('row chain does not depend on page boundaries and document order uses SQLite BINARY UTF-8', t => {
  const f = fixture(t), store = f.open(); for (const key of ['😀', 'é', 'a', 'z', '\u0001', '中']) store.put('keys', key, key, null);
  const a = f.capture(store), b = f.capture(store, { ...bounds, maxPageRows: 5 }); assert.equal(a.documentsDigest, b.documentsDigest); assert.equal(a.eventsDigest, b.eventsDigest);
  const keys = f.pages(a).flatMap(page => page.table === 'documents' ? page.rows.filter(row => row.namespace === 'keys').map(row => row.key) : []);
  assert.deepEqual(keys, [...keys].sort((x, y) => Buffer.compare(Buffer.from(x), Buffer.from(y))));
});

for (const variant of ['rows', 'aggregate', 'singleton', 'pages', 'overflow'] as const) test(`${variant} capacity refusal does not materialize row values`, t => {
  const f = fixture(t), store = f.open(); store.put('memory', 'entry', '😀'.repeat(60), null); const reads = valueReads(t);
  const limit = { ...bounds };
  if (variant === 'rows') limit.maxPhysicalRows = 1;
  if (variant === 'aggregate') limit.maxConservativeBytes = 1000;
  if (variant === 'singleton') limit.maxPageBytes = 1000;
  if (variant === 'pages') { limit.maxPages = 0; limit.maxPhysicalRows = 0; limit.maxConservativeBytes = 0; limit.maxSerializedBytes = 0; }
  if (variant === 'overflow') limit.maxPages = Number.MAX_SAFE_INTEGER;
  assert.throws(() => f.capture(store, limit)); assert.equal(reads.length, 0); assert.equal(f.retained.size, 0);
});

for (const variant of ['document-blob', 'event-blob', 'revision-real', 'invalid-utf8', 'noncanonical'] as const) test(`${variant} physical representation refuses honestly`, t => {
  const f = fixture(t), store = f.open(); store.put('memory', 'entry', 'old', null);
  f.sql(db => {
    if (variant === 'document-blob') db.prepare('UPDATE documents SET value=? WHERE namespace=?').run(Buffer.from('"old"'), 'memory');
    if (variant === 'event-blob') db.prepare('UPDATE events SET data=? WHERE sequence=1').run(Buffer.from('{}'));
    if (variant === 'revision-real') db.exec("UPDATE documents SET revision=1.5 WHERE namespace='memory'");
    if (variant === 'invalid-utf8') db.exec("UPDATE documents SET key=CAST(x'80' AS TEXT) WHERE namespace='memory'");
    if (variant === 'noncanonical') db.exec("UPDATE documents SET value=' \"old\"' WHERE namespace='memory'");
  });
  const reads = valueReads(t); assert.throws(() => f.capture(store)); if (!['invalid-utf8', 'noncanonical'].includes(variant)) assert.equal(reads.length, 0);
});

test('fragmentation-induced page overflow is preflighted before any value SELECT', t => {
  const f = fixture(t), store = f.open(); store.put('memory', 'a', 'x'.repeat(700), null); store.put('memory', 'b', 'y'.repeat(700), null);
  const reads = valueReads(t), limits = { ...bounds, maxPageRows: 512, maxPageBytes: 12_000, maxPages: 3, maxPhysicalRows: 100, maxConservativeBytes: 36_000, maxSerializedBytes: 36_000 };
  // Two application rows and two historical payload rows each fit singly but pair poorly.
  assert.throws(() => f.capture(store, limits), /page count exceeds/); assert.equal(reads.length, 0);
});

for (const variant of ['missing-payload', 'orphan-payload', 'orphan-head', 'head-value', 'event-gap', 'event-ref', 'reserved'] as const) test(`${variant} graph corruption rejects`, t => {
  const f = fixture(t), store = f.open(); store.put('memory', 'entry', 'old', null); const cut = f.capture(store), ref = refs(f, cut)[0]!;
  f.sql(db => {
    if (variant === 'missing-payload') db.prepare('DELETE FROM documents WHERE namespace=? AND key=?').run(DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE, ref.versionId);
    if (variant === 'orphan-payload') db.prepare('INSERT INTO documents VALUES(?,?,1,?)').run(DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE, 'orphan', canonicalJson({ ref: { ...ref, versionId: 'orphan' }, state: 'available', document: { revision: 1, value: 'old' } }));
    if (variant === 'orphan-head') db.prepare('INSERT INTO documents VALUES(?,?,1,?)').run(DOCUMENT_JOURNAL_HEAD_NAMESPACE, 'orphan', canonicalJson(ref));
    if (variant === 'head-value') db.prepare('UPDATE documents SET value=? WHERE namespace=?').run(canonicalJson({ ...ref, sha256: '0'.repeat(64) }), DOCUMENT_JOURNAL_HEAD_NAMESPACE);
    if (variant === 'event-gap') db.exec('DELETE FROM events WHERE sequence=2');
    if (variant === 'event-ref') { const event = store.events()[1]!, data = event.data as unknown as { after: JournalRef }; db.prepare('UPDATE events SET data=? WHERE sequence=2').run(canonicalJson({ ...data, after: { ...data.after, versionId: 'forged' } })); }
    if (variant === 'reserved') db.prepare('INSERT INTO documents VALUES(?,?,1,?)').run(`${DOCUMENT_JOURNAL_NAMESPACE}.unknown`, 'entry', '{}');
  });
  assert.throws(() => f.capture(store));
});

test('valid withdrawal retains complete structural pages but old exact versions become unavailable', t => {
  const f = fixture(t), store = f.open(); store.put('memory', 'entry', 'old', null); store.put('memory', 'entry', 'new', 1); const before = f.capture(store), required = refs(f, before);
  store.withdrawDocumentJournalContent({ id: 'forget:entry', reason: 'forget', targets: [{ namespace: 'memory', key: 'entry', expectedRevision: 2 }] });
  const after = f.capture(store); assert.equal(after.lastSequence, before.lastSequence + 1); assert.equal(after.documents, before.documents);
  assert.throws(() => store.withDevelopmentVersionsAvailable(historical(before, required), () => assert.fail('withdrawn callback')), /document-history-withdrawn/);
});

test('bounded withdrawal marker read preserves Unicode and embedded NUL identity bytes', t => {
  const f = fixture(t), store = f.open(); store.put('memory', 'entry', 'old', null); const cut = f.capture(store), input = historical(cut, refs(f, cut));
  store.withdrawDocumentJournalContent({ id: 'forget:\u0000😀', reason: 'forget', targets: [{ namespace: 'memory', key: 'entry', expectedRevision: 1 }] });
  assert.ok(f.capture(store).lastSequence > cut.lastSequence); assert.throws(() => store.withDevelopmentVersionsAvailable(input, () => assert.fail('withdrawn')), /document-history-withdrawn/);
});

function markerReads(t: TestContext): string[] {
  const prepare = DatabaseSync.prototype.prepare, reads: string[] = [];
  t.mock.method(DatabaseSync.prototype, 'prepare', function(this: DatabaseSync, sql: string) { if (sql.startsWith('SELECT CAST(id AS BLOB) AS id,sequence')) reads.push(sql); return prepare.call(this, sql); });
  return reads;
}
for (const field of ['id', 'stream', 'type', 'data', 'aggregate', 'sequence'] as const) test(`R3 ${field} selected marker overflow refuses before marker materialization`, t => {
  const f = fixture(t), store = f.open(); store.put('memory', 'entry', 'old', null); const cut = f.capture(store), required = refs(f, cut), input = historical(cut, required);
  store.withdrawDocumentJournalContent({ id: 'withdraw', reason: 'forget', targets: [{ namespace: 'memory', key: 'entry', expectedRevision: 1 }] });
  f.sql(db => {
    if (field === 'stream' || field === 'type' || field === 'data') db.prepare(`UPDATE events SET ${field}=? WHERE id=?`).run('😀'.repeat(input.maxPageBytes), 'withdraw');
    if (field === 'id') {
      const id = '😀'.repeat(100), event = db.prepare('SELECT data FROM events WHERE id=?').get('withdraw') as { data: string }, marker = JSON.parse(event.data);
      marker.withdrawalId = id; db.prepare('UPDATE events SET id=?,data=? WHERE id=?').run(id, canonicalJson(marker), 'withdraw');
      db.prepare('UPDATE documents SET value=? WHERE namespace=? AND key=?').run(canonicalJson({ ref: required[0], state: 'withdrawn', withdrawalId: id }), DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE, required[0]!.versionId);
      input.maxWithdrawalMarkerBytes = Buffer.byteLength(canonicalJson(marker)) + 256;
    }
    if (field === 'aggregate') { db.prepare('UPDATE events SET stream=?,type=? WHERE id=?').run('x'.repeat(1500), 'y'.repeat(1500), 'withdraw'); input.maxWithdrawalMarkerBytes = 3400; }
    if (field === 'sequence') db.prepare('UPDATE events SET sequence=? WHERE id=?').run(9007199254740992n, 'withdraw');
  });
  const reads = markerReads(t); assert.throws(() => store.withDevelopmentVersionsAvailable(input, () => assert.fail('oversized marker callback')), /document-history-corrupt-or-missing/); assert.equal(reads.length, 0);
});

for (const field of ['id', 'stream', 'type', 'data'] as const) test(`R3 ${field} malformed marker storage refuses before marker materialization`, t => {
  const f = fixture(t), store = f.open(); store.put('memory', 'entry', 'old', null); const cut = f.capture(store), input = historical(cut, refs(f, cut));
  store.withdrawDocumentJournalContent({ id: 'withdraw', reason: 'forget', targets: [{ namespace: 'memory', key: 'entry', expectedRevision: 1 }] });
  f.sql(db => { const row = db.prepare(`SELECT ${field} AS value FROM events WHERE id=?`).get('withdraw') as { value: string }; db.prepare(`UPDATE events SET ${field}=? WHERE id=?`).run(Buffer.from(row.value), 'withdraw'); });
  const reads = markerReads(t); assert.throws(() => store.withDevelopmentVersionsAvailable(input, () => assert.fail('malformed marker callback')), /document-history-corrupt-or-missing/); assert.equal(reads.length, 0);
});

test('R3 exact selected marker budgets permit Unicode/NUL and one byte less refuses before read', t => {
  const f = fixture(t), store = f.open(); store.put('memory', 'entry', 'old', null); const cut = f.capture(store), input = historical(cut, refs(f, cut)), id = 'withdraw:\u0000😀λ';
  store.withdrawDocumentJournalContent({ id, reason: 'forget', targets: [{ namespace: 'memory', key: 'entry', expectedRevision: 1 }] });
  let textBytes = 0; f.sql(db => { textBytes = (db.prepare('SELECT length(CAST(id AS BLOB))+length(CAST(stream AS BLOB))+length(CAST(type AS BLOB))+length(CAST(data AS BLOB)) AS bytes FROM events WHERE id=?').get(id) as { bytes: number }).bytes; });
  input.maxWithdrawalMarkerBytes = textBytes + 256; input.maxPageBytes = 6 * textBytes + 256 + 512;
  const reads = markerReads(t); assert.throws(() => store.withDevelopmentVersionsAvailable(input, () => assert.fail('withdrawn')), /document-history-withdrawn/); assert.equal(reads.length, 1);
  reads.length = 0; input.maxWithdrawalMarkerBytes--;
  assert.throws(() => store.withDevelopmentVersionsAvailable(input, () => assert.fail('raw marker overflow')), /document-history-corrupt-or-missing/); assert.equal(reads.length, 0);
  input.maxWithdrawalMarkerBytes++; input.maxPageBytes--;
  assert.throws(() => store.withDevelopmentVersionsAvailable(input, () => assert.fail('conservative marker overflow')), /document-history-corrupt-or-missing/); assert.equal(reads.length, 0);
});

for (const variant of ['marker-missing', 'marker-forged', 'payload-forged', 'orphan-withdrawal'] as const) test(`${variant} withdrawal fails corruption rather than usable history`, t => {
  const f = fixture(t), store = f.open(); store.put('memory', 'entry', 'old', null); const before = f.capture(store), required = refs(f, before);
  store.withdrawDocumentJournalContent({ id: 'forget:entry', reason: 'forget', targets: [{ namespace: 'memory', key: 'entry', expectedRevision: 1 }] });
  f.sql(db => {
    if (variant === 'marker-missing') db.prepare('DELETE FROM events WHERE id=?').run('forget:entry');
    if (variant === 'marker-forged') { const marker = store.events().at(-1)!; db.prepare('UPDATE events SET data=? WHERE id=?').run(canonicalJson({ ...(marker.data as object), refs: [] }), 'forget:entry'); }
    if (variant === 'payload-forged') db.prepare('UPDATE documents SET value=? WHERE namespace=?').run(canonicalJson({ ref: required[0], state: 'withdrawn', withdrawalId: 'missing' }), DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE);
    if (variant === 'orphan-withdrawal') db.prepare('UPDATE documents SET value=? WHERE namespace=?').run(canonicalJson({ ref: { ...required[0], key: 'other' }, state: 'withdrawn', withdrawalId: 'forget:entry' }), DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE);
  });
  assert.throws(() => f.capture(store)); assert.throws(() => store.withDevelopmentVersionsAvailable(historical(before, required), () => assert.fail('forged callback')), /document-history-corrupt-or-missing/);
});

test('historical old deleted/replaced versions survive accounting growth while exact-current-cut refuses', t => {
  const f = fixture(t), store = f.open(); store.put('memory', 'entry', 'old', null); store.put('memory', 'entry', 'middle', 1); store.delete('memory', 'entry', 2);
  const cut = f.capture(store), required = refs(f, cut), input = historical(cut, required); let calls = 0;
  const frozen = canonicalJson(cut); store.withDevelopmentSourceCut({ journalDigest: input.journalDigest, lastSequence: cut.lastSequence }, () => calls++);
  store.append({ id: 'reviewer-reserved', stream: 'accounting', type: 'reservation', data: { reviewer: true } }); store.put('accounting', 'reviewer', { status: 'settled' }, null); store.put('memory', 'entry', 'recreated', null);
  const observation = store.withDevelopmentVersionsAvailable(input, observed => { calls++; return observed; });
  assert.equal(observation.prefixDigest, cut.eventsDigest); assert.equal(observation.prefixSequence, cut.lastSequence); assert.equal(observation.checkedVersions, 2); assert.ok(observation.observedLastSequence > cut.lastSequence); assert.equal(observation.requiredVersionsDigest, identity(required)); assert.equal(canonicalJson(cut), frozen);
  assert.throws(() => store.withDevelopmentSourceCut({ journalDigest: input.journalDigest, lastSequence: cut.lastSequence }, () => calls++), /source cut changed/); assert.equal(calls, 2);
  store.withdrawDocumentJournalContent({ id: 'late-old-withdrawal', reason: 'expiry', targets: [{ namespace: 'memory', key: 'entry', expectedRevision: 1 }] });
  assert.throws(() => store.withDevelopmentVersionsAvailable(input, () => calls++), /document-history-withdrawn/); assert.equal(calls, 2); assert.equal(canonicalJson(cut), frozen);
});

test('historical input clones only bounded known fields and yields an immutable call-local observation', t => {
  const f = fixture(t), store = f.open(); store.put('memory', 'entry', 'old', null); const cut = f.capture(store), input = historical(cut, refs(f, cut)), expected = identity(input.requiredVersions);
  const prefix = { ...input.prefix, get irrelevant() { throw new Error('unbounded extra prefix'); } };
  const request = { ...input, prefix, get irrelevant() { throw new Error('unbounded extra input'); } };
  const observed = store.withDevelopmentVersionsAvailable(request, observation => { assert.ok(Object.isFrozen(observation)); assert.throws(() => { observation.prefixDigest = 'forged'; }); input.requiredVersions[0]!.key = 'caller mutation'; return observation; });
  assert.equal(observed.requiredVersionsDigest, expected); assert.equal(observed.prefixDigest, cut.eventsDigest);
  assert.throws(() => store.withDevelopmentVersionsAvailable(input, () => assert.fail('mutated scope')));
});

for (const variant of ['payload-missing', 'payload-corrupt', 'prefix-changed', 'ref-forged', 'scope-duplicate', 'prefix-bytes', 'version-bytes', 'marker-bytes'] as const) test(`${variant} historical read rejects before callback`, t => {
  const f = fixture(t), store = f.open(); store.put('memory', 'entry', 'old', null); store.append({ id: 'ordinary', stream: 'ordinary', type: 'input', data: 'before' }); const cut = f.capture(store), required = refs(f, cut), input = historical(cut, required);
  if (variant === 'payload-missing') f.sql(db => { db.prepare('DELETE FROM documents WHERE namespace=? AND key=?').run(DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE, required[0]!.versionId); });
  if (variant === 'payload-corrupt') f.sql(db => { db.prepare('UPDATE documents SET value=? WHERE namespace=?').run(canonicalJson({ ref: required[0], state: 'available', document: { revision: 1, value: 'changed' } }), DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE); });
  if (variant === 'prefix-changed') f.sql(db => { db.prepare('UPDATE events SET data=? WHERE id=?').run(canonicalJson('changed'), 'ordinary'); });
  if (variant === 'ref-forged') input.requiredVersions = [{ ...required[0]!, sha256: '0'.repeat(64) }];
  if (variant === 'scope-duplicate') input.requiredVersions = [required[0]!, required[0]!];
  if (variant === 'prefix-bytes') input.maxPrefixBytes = 1;
  if (variant === 'version-bytes') input.maxVersionBytes = 1;
  if (variant === 'marker-bytes') { store.withdrawDocumentJournalContent({ id: 'forgotten', reason: 'forget', targets: [{ namespace: 'memory', key: 'entry', expectedRevision: 1 }] }); input.maxWithdrawalMarkerBytes = 1; }
  assert.throws(() => store.withDevelopmentVersionsAvailable(input, () => assert.fail('unavailable callback')));
});

for (const operation of ['put', 'delete', 'append', 'artifact', 'withdraw', 'close', 'capture', 'full-capture', 'async', 'substitute', 'mutate-bytes'] as const) test(`${operation} callback cannot invalidate capture transaction`, t => {
  const f = fixture(t), store = f.open(); store.put('memory', 'entry', 'old', null); const before = f.capture(store), events = store.events();
  const callback = (bytes: Uint8Array): ArtifactRef => {
    if (operation === 'put') store.put('memory', 'new', 1, null);
    if (operation === 'delete') store.delete('memory', 'entry', 1);
    if (operation === 'append') store.append({ id: 'bad', stream: 'ordinary', type: 'input', data: null });
    if (operation === 'artifact') store.putArtifact('bad');
    if (operation === 'withdraw') store.withdrawDocumentJournalContent({ id: 'bad', reason: 'forget', targets: [] });
    if (operation === 'close') store.close();
    if (operation === 'capture') f.capture(store);
    if (operation === 'full-capture') store.captureDevelopmentSnapshot({ maxRows: 512, maxBytes: 1_048_576 });
    if (operation === 'async') return Promise.resolve(f.retain(bytes)) as unknown as ArtifactRef;
    if (operation === 'substitute') return f.retain(Buffer.from('other'));
    if (operation === 'mutate-bytes') { const ref = f.retain(bytes); bytes[0] = 0; return ref; }
    return f.retain(bytes);
  };
  assert.throws(() => store.captureDevelopmentPages(bounds, callback, (_ref, bytes) => f.retain(bytes))); assert.deepEqual(store.events(), events); assert.deepEqual(f.capture(store), before);
});

test('both fences reject callback writes, reentrancy and asynchronous results and release on failure', t => {
  const f = fixture(t), store = f.open(); store.put('memory', 'entry', 'old', null); const cut = f.capture(store), input = historical(cut, refs(f, cut));
  assert.throws(() => store.withDevelopmentSourceCut({ journalDigest: input.journalDigest, lastSequence: cut.lastSequence }, () => store.put('memory', 'entry', 'bad', 1)), /writes forbidden/);
  assert.throws(() => store.withDevelopmentSourceCut({ journalDigest: input.journalDigest, lastSequence: cut.lastSequence }, () => Promise.resolve()), /synchronous/);
  assert.throws(() => store.withDevelopmentVersionsAvailable(input, () => store.putArtifact('bad'))); assert.throws(() => store.withDevelopmentVersionsAvailable(input, () => Promise.resolve()));
  assert.throws(() => store.transaction(() => f.capture(store)), /reentrant/); store.put('memory', 'entry', 'allowed', 1); assert.equal(store.get('memory', 'entry')!.revision, 2);
});

test('a caught nested source write leaves the successful source fence unchanged', t => {
  const f = fixture(t), store = f.open(); store.put('memory', 'entry', 'old', null); const cut = f.capture(store), input = historical(cut, refs(f, cut));
  store.withDevelopmentVersionsAvailable(input, () => store.transaction(() => {
    assert.throws(() => store.put('memory', 'entry', 'changed', 1), /writes forbidden/);
    assert.deepEqual(store.documentJournalBinding(), cut.journalBinding);
  }));
  assert.deepEqual(f.capture(store), cut);
});

test('a concurrent descriptor writer cannot interleave with a retained page', t => {
  const f = fixture(t), store = f.open(), other = new DatabaseSync(f.filename); t.after(() => other.close()); other.exec('PRAGMA busy_timeout=1'); let tried = false;
  const cut = store.captureDevelopmentPages(bounds, bytes => { if (!tried) { tried = true; assert.throws(() => other.prepare('INSERT INTO documents VALUES(?,?,1,?)').run('other', 'interleaved', 'null'), /locked/); } return f.retain(bytes); }, (_ref, bytes) => f.retain(bytes));
  assert.ok(tried); assert.equal(cut.documents, 1); assert.equal(store.get('other', 'interleaved'), undefined);
});

test('operational artifacts resolve on the actual open handle after pathname rename', t => {
  const f = fixture(t), store = f.open(), original = store.putArtifact('descriptor original'); store.put('artifacts', 'one', { nested: [original] }, null);
  renameSync(f.filename, join(f.dir, 'renamed.sqlite'));
  const cut = f.capture(store); assert.deepEqual(cut.operationalArtifacts.map(entry => entry.original), [original]); assert.equal(f.retained.get(cut.operationalArtifacts[0]!.retained.sha256)!.toString(), 'descriptor original');
});

test('scalar artifact freshness reads the actual connection without materializing stored bytes', t => {
  const f = fixture(t), store = f.open(); assert.equal(store.hasArtifacts(), false); store.putArtifact('actual artifact'); assert.equal(store.hasArtifacts(), true);
  const prepare = DatabaseSync.prototype.prepare; t.mock.method(DatabaseSync.prototype, 'prepare', function(this: DatabaseSync, sql: string) { assert.equal(sql, 'SELECT 1 FROM artifacts LIMIT 1'); return prepare.call(this, sql); });
  assert.equal(store.hasArtifacts(), true);
});

test('exact URI scope distinguishes source and authorized retained originals with identical bytes', t => {
  const f = fixture(t), store = f.open(), original = store.putArtifact('same'), external = { uri: `sha256:${original.sha256}`, sha256: original.sha256 }; store.put('artifacts', 'both', { original, external }, null);
  let resolved = 0; assert.throws(() => f.capture(store), /unavailable/);
  const cut = f.capture(store, bounds, (ref, maxBytes) => { resolved++; assert.deepEqual(ref, external); assert.ok(maxBytes >= 4); ref.uri = 'changed detached argument'; return Buffer.from('same'); });
  assert.equal(resolved, 1); assert.equal(cut.operationalArtifacts.length, 2); assert.equal(new Set(cut.operationalArtifacts.map(entry => entry.retained.sha256)).size, 1); assert.deepEqual(cut.operationalArtifacts.map(entry => entry.original.uri).sort(), [original.uri, external.uri].sort());
});

for (const variant of ['missing', 'corrupt', 'singleton', 'aggregate', 'count', 'external-substitute', 'external-async', 'external-write'] as const) test(`${variant} operational artifact refuses`, t => {
  const f = fixture(t), store = f.open(), original = store.putArtifact('123456'), other = store.putArtifact('abcde'); store.put('artifacts', 'refs', [original, other], null); const limit = { ...bounds };
  let resolve: ((ref: ArtifactRef, maxBytes: number) => Uint8Array) | undefined;
  if (variant === 'missing') f.sql(db => { db.prepare('DELETE FROM artifacts WHERE digest=?').run(original.sha256); });
  if (variant === 'corrupt') f.sql(db => { db.prepare('UPDATE artifacts SET bytes=? WHERE digest=?').run(Buffer.from('forged'), original.sha256); });
  if (variant === 'singleton') limit.maxOperationalArtifactBytes = 5;
  if (variant === 'aggregate') limit.maxOperationalArtifactTotalBytes = 10;
  if (variant === 'count') limit.maxOperationalArtifacts = 1;
  if (variant.startsWith('external')) {
    store.put('artifacts', 'refs', { uri: `sha256:${original.sha256}`, sha256: original.sha256 }, 1);
    resolve = () => { if (variant === 'external-substitute') return Buffer.from('changed'); if (variant === 'external-async') return Promise.resolve(Buffer.from('123456')) as unknown as Uint8Array; store.put('bad', 'write', 1, null); return Buffer.from('123456'); };
  }
  assert.throws(() => f.capture(store, limit, resolve));
});

// This fixes the same source-only workload as the isolated red full-snapshot probe.
// It is not a recorder capacity plan; no worst-case reserve assumes byte reuse.
const applicationBounds: PageCaptureBounds = { maxPageRows: 512, maxPageBytes: 1_000_000, maxPages: 4, maxPhysicalRows: 1024, maxConservativeBytes: 2_500_000, maxSerializedBytes: 400_000, maxOperationalArtifacts: 10, maxOperationalArtifactBytes: 10_000, maxOperationalArtifactTotalBytes: 20_000 };
function applicationFixture() {
  const root = mkdtempSync(join(tmpdir(), 'aeon-journal-capacity-')), stateDirectory = join(root, 'state'), workspaceDirectory = join(root, 'work'); mkdirSync(stateDirectory); mkdirSync(workspaceDirectory);
  const promptFile = join(root, 'mind.txt'), compactionPromptFile = join(root, 'compact.txt'); writeFileSync(promptFile, 'Synthetic capacity fixture. Preserve attributed observations.'); writeFileSync(compactionPromptFile, 'Retain open work and provenance.');
  const resources = { maxRequests: 100, maxTokens: 10_000_000, maxCostUsd: 100, maxElapsedMs: 300_000, maxConcurrency: 8 };
  const config: ApplicationConfig = {
    stateDirectory, workspaceDirectory, applicationRoot: resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), nodeBinary: process.execPath, workerEntrypoint: 'deployment/shell-worker.ts', artifactId: 'capacity-fixture', controlRevision: 'capacity-controls', promptFile, compactionPromptFile,
    model: { id: 'mistral-fixture-v1', contextWindow: 128000, reasoning: false, effort: 'none', maxOutputTokens: 2048, maxRequestsPerSlice: 12, timeoutMs: 10000, pricesPerMillion: { input: 1, output: 2 } }, resources, conversationResources: resources, bootstrapInitiative: false,
    scheduler: { windowMs: 60000, maxSlicesPerWindow: 8, maxLifetimeSlices: 32, quantumMs: 30000, idleRetryMs: 1000, maxStalls: 2, resources }, maxConcurrentRuns: 2, pollMs: 100, commands: [], researchHosts: [],
    direct: { host: '127.0.0.1', port: 0, actorId: 'synthetic-observer', scope: { kind: 'public' }, modificationEligible: false },
  };
  const authorityStore = new AuthorityStore(join(stateDirectory, 'authority.sqlite')), authority = authorityStore.bootstrap('capacity-instance', config.controlRevision, config.artifactId);
  const app = new AutarkApplication({ config, authorityStore, authority, secrets: { directToken: 'synthetic-local-token' }, documentJournal: { stream: 'capacity-journal', hostId: 'capacity-host', maxAnchorDocuments: 512, maxAnchorBytes: 1_048_576 } });
  return { root, app, authorityStore };
}
for (const mode of ['separate-conversations', 'same-message-revisions'] as const) test(`actual application complete pages cover twelve offline admissions: ${mode}`, async t => {
  const f = applicationFixture(), retained = new Map<string, Buffer>(), samples: { admissions: number; physicalRows: number; conservativeBytes: number; serializedBytes: number; pages: number; operationalArtifacts: number; operationalArtifactBytes: number; fullCaptured: boolean }[] = [];
  const retain = (bytes: Uint8Array): ArtifactRef => { const digest = sha(bytes); retained.set(digest, Buffer.from(bytes)); return { uri: `sha256:${digest}`, sha256: digest }; };
  const capture = (admissions: number) => {
    const cut = f.app.store.captureDevelopmentPages(applicationBounds, retain, (_ref, bytes) => retain(bytes)); let fullCaptured = true;
    try { f.app.store.captureDevelopmentSnapshot({ maxRows: 512, maxBytes: 1_048_576 }); } catch { fullCaptured = false; }
    samples.push({ admissions, physicalRows: cut.physicalRows, conservativeBytes: cut.conservativeBytes, serializedBytes: cut.serializedBytes, pages: cut.pages.length, operationalArtifacts: cut.operationalArtifacts.length, operationalArtifactBytes: cut.operationalArtifacts.reduce((sum, artifact) => sum + artifact.bytes, 0), fullCaptured });
    assert.equal(cut.pages.reduce((sum, page) => sum + page.rows, 0), cut.physicalRows); assert.equal(cut.events, cut.lastSequence);
  };
  try {
    capture(0);
    for (let i = 1; i <= 12; i++) {
      f.app.communications.receive({ source: 'direct', externalId: mode === 'same-message-revisions' ? 'assignment' : `assignment-${i}`, revision: String(i), conversation: mode === 'same-message-revisions' ? 'one-conversation' : `conversation-${i}`, text: `Synthetic bounded observation ${i}.`, actor: { id: 'synthetic-observer', scope: { kind: 'public' }, modificationEligible: false } });
      await new Promise<void>(resolve => setImmediate(resolve)); await f.app.tick(); assert.equal(f.app.store.list('requests').length, 0); assert.equal(f.app.directApi.listening, false); capture(i);
    }
    // The ordinary mode seal adds its document, payload, head, mutation and anchor event (five rows).
    assert.equal(samples.length, 13); if (mode === 'separate-conversations') { assert.equal(samples.at(-1)!.physicalRows, 551); assert.equal(samples.find(sample => !sample.fullCaptured)?.admissions, 8); } else assert.ok(samples.every(sample => sample.fullCaptured));
  } finally {
    t.diagnostic(JSON.stringify({ mode, applicationBounds, samples, uniquePageArtifactBytes: [...retained.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0), uniquePageArtifactCount: retained.size }));
    await f.app.close(); f.authorityStore.close(); rmSync(f.root, { recursive: true, force: true });
  }
});
