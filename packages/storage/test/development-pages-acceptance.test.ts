import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson, type ArtifactRef } from '../../contracts/common.ts';
import { DevelopmentalMemory } from '../../development/index.ts';
import { OperationalStore, DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE as PAYLOAD, type SourceCut, type SourcePage, type JournalRef, type HistoricalSourceUse } from '../index.ts';

const journal = { stream: 'supported-review', hostId: 'supported-review-host', maxAnchorDocuments: 100, maxAnchorBytes: 100_000 };
const bounds = { maxPageRows: 4, maxPageBytes: 25_000, maxPages: 80, maxPhysicalRows: 320, maxConservativeBytes: 1_500_000, maxSerializedBytes: 1_500_000, maxOperationalArtifacts: 10, maxOperationalArtifactBytes: 2_000, maxOperationalArtifactTotalBytes: 4_000 };
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'cp1-supported-review-')), filename = join(dir, 'source.sqlite'), store = new OperationalStore({ filename, documentJournal: journal }), bytes = new Map<string, Buffer>();
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const retain = (value: Uint8Array): ArtifactRef => { const sha256 = hash(value); bytes.set(sha256, Buffer.from(value)); return { uri: `sha256:${sha256}`, sha256 }; };
  const capture = () => store.captureDevelopmentPages(bounds, retain, (_ref, value) => retain(value));
  const sql = <T>(fn: (db: DatabaseSync) => T) => { const db = new DatabaseSync(filename); try { return fn(db); } finally { db.close(); } };
  const scope = (cut: SourceCut): HistoricalSourceUse => {
    const refs = cut.pages.flatMap(p => { const page = JSON.parse(bytes.get(p.artifact.sha256)!.toString()) as SourcePage; return page.table === 'documents' ? page.rows.filter(r => r.namespace === PAYLOAD).map(r => (r.value as unknown as { ref: JournalRef }).ref) : []; }).sort((a, b) => a.versionId < b.versionId ? -1 : 1);
    return { journalDigest: hash(canonicalJson(cut.journalBinding)), prefix: { lastSequence: cut.lastSequence, eventsDigest: cut.eventsDigest }, requiredVersions: refs, maxPageRows: bounds.maxPageRows, maxPageBytes: bounds.maxPageBytes, maxPrefixBytes: bounds.maxConservativeBytes, maxVersions: 100, maxVersionBytes: 100_000, maxWithdrawalMarkerBytes: bounds.maxPageBytes };
  };
  const withdraw = (id = 'withdraw:review') => store.withdrawDocumentJournalContent({ id, reason: 'forget', targets: [{ namespace: 'owner', key: 'k', expectedRevision: 1 }] });
  return { store, capture, scope, sql, withdraw };
}
function markerReads(t: TestContext) {
  const prepare = DatabaseSync.prototype.prepare, queries: string[] = [];
  t.mock.method(DatabaseSync.prototype, 'prepare', function(this: DatabaseSync, sql: string) { if (sql.startsWith('SELECT CAST(id AS BLOB) AS id,sequence')) queries.push(sql); return prepare.call(this, sql); });
  return queries;
}

for (const field of ['id', 'stream', 'type', 'data'] as const) test(`supported R3 ${field} byte overflow rejects before marker materialization`, t => {
  const f = fixture(t); f.store.put('owner', 'k', 'old', null); const input = f.scope(f.capture()); f.withdraw(); input.maxWithdrawalMarkerBytes = 1_500;
  // Adversarial stored bytes test allocation safety, not malicious-host authority.
  f.sql(db => {
    const oversized = '😀'.repeat(500); // 2,000 UTF-8 bytes, 1,000 UTF-16 code units.
    if (field === 'id') {
      db.prepare("UPDATE events SET id=? WHERE id='withdraw:review'").run(oversized);
      const row = db.prepare('SELECT value FROM documents WHERE namespace=?').get(PAYLOAD) as { value: string }; const payload = JSON.parse(row.value); payload.withdrawalId = oversized;
      db.prepare('UPDATE documents SET value=? WHERE namespace=?').run(canonicalJson(payload), PAYLOAD);
    } else db.prepare(`UPDATE events SET ${field}=? WHERE id='withdraw:review'`).run(oversized);
  });
  const reads = markerReads(t); assert.throws(() => f.store.withDevelopmentVersionsAvailable(input, () => assert.fail('oversized marker')), /document-history-corrupt-or-missing/); assert.equal(reads.length, 0);
});

for (const field of ['id', 'stream', 'type', 'data'] as const) test(`supported R3 ${field} BLOB storage rejects before marker materialization`, t => {
  const f = fixture(t); f.store.put('owner', 'k', 'old', null); const input = f.scope(f.capture()); f.withdraw();
  f.sql(db => db.exec(`UPDATE events SET ${field}=CAST(${field} AS BLOB) WHERE id='withdraw:review'`));
  const reads = markerReads(t); assert.throws(() => f.store.withDevelopmentVersionsAvailable(input, () => assert.fail('BLOB marker')), /document-history-corrupt-or-missing/); assert.equal(reads.length, 0);
});

for (const sequence of ['0', '-1', '9007199254740992'] as const) test(`supported R3 unsafe/nonpositive sequence ${sequence} rejects before marker materialization`, t => {
  const f = fixture(t); f.store.put('owner', 'k', 'old', null); const input = f.scope(f.capture()); f.withdraw();
  f.sql(db => db.exec(`UPDATE events SET sequence=${sequence} WHERE id='withdraw:review'`));
  const reads = markerReads(t); assert.throws(() => f.store.withDevelopmentVersionsAvailable(input, () => assert.fail('invalid sequence')), /document-history-corrupt-or-missing/); assert.equal(reads.length, 0);
});

for (const budget of ['exact', 'raw-minus-one', 'conservative-minus-one'] as const) test(`supported R3 genuine Unicode/NUL marker at ${budget} budgets`, t => {
  const f = fixture(t); f.store.put('owner', 'k', 'old', null); const input = f.scope(f.capture()), id = `withdraw:\0😀é${'π'.repeat(180)}`; f.withdraw(id);
  const lengths = f.sql(db => {
    const row = db.prepare('SELECT CAST(id AS BLOB) AS i,CAST(stream AS BLOB) AS s,CAST(type AS BLOB) AS t,CAST(data AS BLOB) AS d FROM events WHERE id=?').get(id) as { i: Uint8Array; s: Uint8Array; t: Uint8Array; d: Uint8Array };
    return { text: row.i.byteLength + row.s.byteLength + row.t.byteLength + row.d.byteLength, id: row.i.byteLength };
  });
  assert.equal(lengths.id, Buffer.byteLength(id)); assert.ok(lengths.id > id.length);
  input.maxWithdrawalMarkerBytes = lengths.text + 256; input.maxPageBytes = 6 * lengths.text + 256 + 512;
  if (budget === 'raw-minus-one') input.maxWithdrawalMarkerBytes--;
  if (budget === 'conservative-minus-one') input.maxPageBytes--;
  const reads = markerReads(t); assert.throws(() => f.store.withDevelopmentVersionsAvailable(input, () => assert.fail('withdrawn marker')), budget === 'exact' ? /^Error: document-history-withdrawn$/ : /document-history-corrupt-or-missing/); assert.equal(reads.length, budget === 'exact' ? 1 : 0);
});

for (const overflow of ['version-marker-product', 'prefix-index-product', 'page-hard-ceiling'] as const) test(`supported R3 existing ${overflow} refuses without a marker read`, t => {
  const f = fixture(t); f.store.put('owner', 'k', 'old', null); const input = f.scope(f.capture()); f.withdraw();
  if (overflow === 'version-marker-product') input.maxVersions = Math.floor(Number.MAX_SAFE_INTEGER / 4);
  if (overflow === 'prefix-index-product') input.maxPrefixBytes = Number.MAX_SAFE_INTEGER;
  if (overflow === 'page-hard-ceiling') input.maxPageBytes = 1_048_577;
  const reads = markerReads(t); assert.throws(() => f.store.withDevelopmentVersionsAvailable(input, () => assert.fail('invalid limits')), /overflow|invalid/); assert.equal(reads.length, 0);
});

for (const mode of ['forget', 'expiry'] as const) test(`supported memory ${mode} revokes old source/derived/self refs after legitimate accounting growth`, t => {
  const f = fixture(t), at = '2026-10-12T00:00:00.000Z', scope = { kind: 'public' as const }, memory = new DevelopmentalMemory(f.store, () => at);
  memory.ingest({ id: 'source', runId: 'run', sourceId: 'input', actorId: 'actor', at, channel: 'speech', scope, content: 'synthetic owned memory' }, mode === 'expiry' ? '2026-10-12T00:01:00.000Z' : null);
  memory.derive({ id: 'derived', sourceIds: ['source'], actorId: 'actor', at, kind: 'belief', scope, content: 'synthetic derived belief', confidence: 0.5 });
  memory.adoptSelf({ id: 'self', memoryIds: ['derived'], actorId: 'actor', at, scope, category: 'preference', value: 'synthetic preference', reason: 'synthetic reason' }, null);
  const cut = f.capture(), input = f.scope(cut); f.store.put('accounting', 'reviewer', { state: 'reserved' }, null); f.store.append({ id: 'settled', stream: 'accounting', type: 'settled', data: { physical: 0 } });
  const observed = f.store.withDevelopmentVersionsAvailable(input, o => o); assert.ok(observed.observedLastSequence > cut.lastSequence); assert.equal(observed.checkedVersions, input.requiredVersions.length);
  const withdrawn = mode === 'expiry' ? memory.expire('2026-10-12T00:02:00.000Z') : memory.forget(['source']); assert.deepEqual(new Set(withdrawn), new Set(['source', 'derived']));
  assert.equal(memory.get('source', scope), undefined); assert.equal(memory.get('derived', scope), undefined); assert.deepEqual(memory.selfHistory('self', scope), []);
  assert.ok(f.capture().events > cut.events); assert.throws(() => f.store.withDevelopmentVersionsAvailable(input, () => assert.fail('revoked memory')), /^Error: document-history-withdrawn$/);
});
