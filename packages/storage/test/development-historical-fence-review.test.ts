import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalJson, type ArtifactRef } from '../../contracts/index.ts';
import { OperationalStore, DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE, type HistoricalSourceUse, type SourcePage, type SourceCut, type JournalRef } from '../index.ts';

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const journal = { stream: 'historical-fence', hostId: 'fixture-host', maxAnchorDocuments: 512, maxAnchorBytes: 500_000 };
const bounds = { maxPageRows: 8, maxPageBytes: 100_000, maxPages: 128, maxPhysicalRows: 1024, maxConservativeBytes: 4_000_000, maxSerializedBytes: 2_000_000, maxOperationalArtifacts: 64, maxOperationalArtifactBytes: 100_000, maxOperationalArtifactTotalBytes: 200_000 };
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'cp2-historical-')), stores: OperationalStore[] = [], retained = new Map<string, Buffer>();
  t.after(() => { for (const store of stores) store.close(); rmSync(dir, { recursive: true, force: true }); });
  const open = (name = 'source') => { const store = new OperationalStore({ filename: join(dir, `${name}.sqlite`), documentJournal: journal }); stores.push(store); return store; };
  const retain = (bytes: Uint8Array): ArtifactRef => { const sha256 = hash(bytes); retained.set(sha256, Buffer.from(bytes)); return { uri: `sha256:${sha256}`, sha256 }; };
  const capture = (store: OperationalStore) => store.captureDevelopmentPages(bounds, retain, (_original, bytes) => retain(bytes));
  const scope = (cut: SourceCut): HistoricalSourceUse => {
    const refs = cut.pages.flatMap(descriptor => {
      const page = JSON.parse(retained.get(descriptor.artifact.sha256)!.toString()) as SourcePage;
      return page.table === 'documents' ? page.rows.filter(row => row.namespace === DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE).map(row => (row.value as unknown as { ref: JournalRef }).ref) : [];
    }).sort((a, b) => a.versionId < b.versionId ? -1 : 1);
    return { journalDigest: hash(canonicalJson(cut.journalBinding)), prefix: { lastSequence: cut.lastSequence, eventsDigest: cut.eventsDigest }, requiredVersions: refs, maxPageRows: bounds.maxPageRows, maxPageBytes: bounds.maxPageBytes, maxPrefixBytes: bounds.maxConservativeBytes, maxVersions: 512, maxVersionBytes: 1_000_000, maxWithdrawalMarkerBytes: bounds.maxPageBytes };
  };
  return { dir, open, capture, scope, retained, retain };
}

// Reuse only real-store fixture construction, not author assertions.
test('review: failed inner ordinary transaction restores the exact two-level source state', t => {
  const f = fixture(t), s = f.open(); s.put('memory', 'value', 'v1', null); const original = f.capture(s), scope = f.scope(original);
  s.transaction(() => {
    s.put('ordinary', 'keep', true, null);
    assert.throws(() => s.transaction(() => {
      s.put('memory', 'value', 'v2', 1);
      s.transaction(() => s.withDevelopmentVersionsAvailable(scope, o => assert.equal(o.checkedVersions, scope.requiredVersions.length)));
      throw Error('inner abort');
    }), /inner abort/);
    assert.equal(s.get('memory', 'value')!.value, 'v1'); assert.equal(s.transactionActive, true);
    s.withDevelopmentVersionsAvailable(scope, () => assert.throws(() => s.close(), /writes forbidden/));
    s.put('ordinary', 'after', true, null);
  });
  assert.equal(s.transactionActive, false); assert.equal(s.get('ordinary', 'keep')!.value, true); assert.equal(s.get('ordinary', 'after')!.value, true);
  assert.throws(() => s.withDevelopmentSourceCut({ journalDigest: scope.journalDigest, lastSequence: original.lastSequence }, () => {}), /cut changed/);
});

test('review: then accessor throws under the fence and restoration survives an outer rollback', t => {
  const f = fixture(t), s = f.open(); s.put('memory', 'value', 'v1', null); const cut = f.capture(s), scope = f.scope(cut); let accessed = 0;
  assert.throws(() => s.transaction(() => {
    assert.throws(() => s.withDevelopmentVersionsAvailable(scope, () => ({ get then() { accessed++; throw Error('getter'); } })), /document-history-corrupt-or-missing/);
    s.put('ordinary', 'rolled-back', true, null); throw Error('outer abort');
  }), /outer abort/);
  // A then property must be rejected without evaluating a user-controlled getter.
  assert.equal(accessed, 0); assert.equal(s.transactionActive, false); assert.equal(s.get('ordinary', 'rolled-back'), undefined); assert.deepEqual(f.capture(s), cut);
  s.put('ordinary', 'committed', true, null);
});

test('review: exact prefix rejects a later same-key version substituted for the accepted old version', t => {
  const f = fixture(t), s = f.open(); s.put('memory', 'value', 'v1', null); const old = f.scope(f.capture(s));
  s.put('memory', 'value', 'v2', 1); const current = f.scope(f.capture(s)), later = current.requiredVersions.find(r => r.namespace === 'memory' && r.key === 'value' && r.revision === 2)!;
  assert(later); let entered = 0;
  const forged = { ...old, requiredVersions: [later] };
  assert.throws(() => s.transaction(() => s.withDevelopmentVersionsAvailable(forged, () => entered++)), /document-history-corrupt-or-missing/);
  assert.equal(entered, 0); assert.equal(s.withDevelopmentVersionsAvailable(old, o => o.checkedVersions), old.requiredVersions.length);
});

test('review: failure in a second source releases the first fence and preserves outer transaction writes', t => {
  const f = fixture(t), a = f.open('a'), b = f.open('b');
  a.put('memory', 'a', 'a1', null); b.put('memory', 'b', 'b1', null);
  const sa = f.scope(f.capture(a)), sb = f.scope(f.capture(b));
  b.withdrawDocumentJournalContent({ id: 'withdraw-b', reason: 'forget', targets: [{ namespace: 'memory', key: 'b', expectedRevision: 1 }] }); let entered = 0;
  a.transaction(() => {
    a.put('ordinary', 'before', true, null);
    assert.throws(() => a.withDevelopmentVersionsAvailable(sa, () => b.withDevelopmentVersionsAvailable(sb, () => entered++)), /document-history-corrupt-or-missing|document-history-withdrawn/);
    assert.equal(b.transactionActive, false); a.put('ordinary', 'after', true, null);
    assert.throws(() => f.capture(a), /reentrant/);
    assert(safeSnapshot(a));
  });
  assert.equal(entered, 0); assert.equal(a.transactionActive, false); assert.equal(a.get('ordinary', 'after')!.value, true);
  b.put('ordinary', 'after', true, null);
  function safeSnapshot(s: OperationalStore) { return s.captureDevelopmentSnapshot({ maxRows: 512, maxBytes: 1_000_000 }).events.length; }
});
