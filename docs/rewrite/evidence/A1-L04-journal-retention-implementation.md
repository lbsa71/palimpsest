# A1-L04-JR1 journal retention implementation

2026-10-12. Author `/root/a1_journal_retention`; actual finite tool goal created before inspection. Root claim `7b4c6b5`; branch `codex/a1-journal-retention-20261012`, worktree `/home/palimpsest/migration/aeon-1-20261011/journal-retention`, exact source base `333a2a7` plus design `2c1f64e`. Exclusive paths are storage/development implementation, development README, new author retention tests, unchanged root forgetting regressions, narrow v2 fixture/ref adaptations to the two existing storage journal test files, and this evidence. Root owns shared application/recorder/envelope integration and fresh JR3 review. No JR5 checkpoint implementation.

## Pre-code schema freeze

Reuse existing SQLite documents/events and private synchronous SQL helpers. `system.document-journal/binding` remains revision 1 with existing option/anchor fields and schema `aeon.document-journal.v2`. Reserve that namespace and every namespace beginning `system.document-journal.` against generic put/delete. Internal namespaces: `system.document-journal.payloads` keyed by fresh UUID versionId; `system.document-journal.heads` keyed by canonical JSON `[namespace,key]`. Payload rows start at revision 1, become revision 2 on withdrawal, and contain exactly `{ref,state:'available',document}` or `{ref,state:'withdrawn',withdrawalId}`. Head rows contain exactly the current `JournalRef`; private replacement advances row revision, deletion removes the head. Refs are exactly `{versionId,namespace,key,revision,sha256}`, commitment SHA-256 of canonical `{revision,value}` bytes. Equal bytes never share IDs.

Anchor data remains `{schema,hostId,maxAnchorDocuments,maxAnchorBytes,documents}` with `documents: JournalRef[]` sorted namespace/key. Mutation data remains `{schema,hostId,namespace,key,before,after}` with nullable refs. New `document-journal-withdrawal` data is exactly `{schema,hostId,withdrawalId,reason,targets,refs}`; event ID equals trusted request ID, reason is `forget|expiry`, targets are exact `{namespace,key,expectedRevision}` sorted namespace/key, refs sorted versionId. This event is the durable idempotency record; identical targets/reason retry returns its original IDs without rechecking now-changed revisions, conflicting reuse rejects. Every current target is CAS-validated before first withdrawal; unbound stores validate and return a no-op. Every available prior payload at selected keys is replaced by a payload-free disposition in the same transaction as the marker. Heads keep refs, including withdrawn refs; a later write verifies current bytes against the digest but never reconstructs the withdrawn payload.

Public exported `JournalRef`, `JournalPayload`, `JournalWithdrawalInput` follow adopted design. `withdrawDocumentJournalContent(input)` returns `{withdrawalId:string|null,withdrawnVersionIds:string[]}`. Snapshot gains `journalPayloads: JournalPayload[]`, sorted versionId, includes ordinary application documents and binding in `documents`, excludes payload/head implementation rows from generic list and document snapshot output, but preflight counts every internal row/byte plus output overhead. All payload dispositions must match the complete structural ref graph, with no missing/orphan payloads, duplicate new version IDs, malformed commitments, forged withdrawal state, wrong host/key/revision/order, absent marker, or mismatched heads. Capture validates structural replay and dispositions; withdrawn refs cannot supply raw replay values. Original global event bytes remain unchanged on withdrawal. Binding rereads refuse unsupported v1 journals explicitly; no migration or historical database modifications.

Activation conservative SQL preflight charges prospective payload/head rows, ref metadata and current bytes before selecting source rows; final canonical anchor also fits existing options. Capture preserves 512 total underlying rows / 1,048,576 byte hard ceilings, conservatively includes every internal value and duplicated returned payload/binding metadata before materialization, then checks exact result size. No compaction, deduplication, new tables/dependencies, artifact deletion, or process-local retention cache.

Memory computes source descendants and collects memories/current affected self/affected histories/jobs before mutation; each affected historical facet also selects its self key even when current evidence differs. It clears current fields/deletes histories/cancels jobs, then withdraws every selected key at its post-write revision, under the same outer transaction. Current unrelated self/history remains intact. Same-key all-version withdrawal deliberately loses additional diagnostic history. Expiry passes fixed reason `expiry`. Failures roll back current writes, payload changes and marker together.

Validation will retain original `b2efacd` test blob unchanged and original red evidence; prove focused transaction/savepoint/real SQL failures, stale revision/idempotency, reopen/stale handles, anchor after ingestion, reserved metadata and bounds, unrelated equal bytes and later same-key versions. Existing journal behavioral/rejection assertions remain; only v2 fixture/ref resolution and necessary internal-row bound accounting are adapted, with exact diff retained for review. No privacy qualification or H1 claim.

## Preserved execution observations and ordering repair freeze

Schema freeze `dcebb0f` imported the root regression blob unchanged and reproduced **1 pass / 3 failures**, each journal mode exposing both event and snapshot content. The first edit script used unavailable `python` (exit 127); `python3` executed it. No dependency install occurred. Initial v2 source passed the four root cases and all 43 existing storage/journal checks; strict compilation passed.

Initial new author cases yielded **13 pass / 5 failures**. Four were mistaken test expectations: attributed episode content is structured, expiry IDs have no requested output order, and there are five source-bearing versions across the four selected namespaces. The fifth attempted a second connection's `captureDevelopmentSnapshot` inside an uncommitted writer transaction; capture deliberately uses BEGIN IMMEDIATE and correctly returned `database is locked`. The test now reads ordinary events/current payload via the observer connection to verify committed visibility during the transaction, and captures after rollback. Those changes preserve the original tests and all rejection predicates. Corrected new cases passed 18/18. The first complete focused storage/development command passed **81/81**, zero skips/cancellations, plus strict compilation and diff checking.

Source inspection identified a real new ordering defect: JavaScript UTF16 relational ordering disagrees with SQLite BINARY UTF8 ordering between U+E000 and supplementary characters. A new four-document activation/withdrawal case against the current author source failed **0 pass / 1 failure**, `unordered document journal anchor`. Preserve that red checkpoint before repairing it. Canonical namespace/key order is now explicitly frozen as SQLite BINARY UTF8 order; the private comparator will use `Buffer.compare` on UTF8 encodings for namespace then key. This changes no wire fields, identity, bounds or behavior/rejection predicate; it makes anchor validation and target canonicalization agree with actual source ordering. UUID versionId ordering remains ASCII. The same unchanged new case must pass after this repair.

## Final authored handoff

Exact production/test source `8ba2828b17cd42e670571f6276fd8156e1bb0a59`; schema/root-regression freeze `dcebb0f`; preserved author Unicode red checkpoint `a102092`. Source remains based on `333a2a7` plus adopted design `2c1f64e`. The four root regression cases are unchanged, Git blob `d0517821311224bfc260bcf3c2e36fb5da43f93a` both here and at `b2efacd`. Original root red evidence and prior independent append-forgery evidence remain untouched.

Final command (Node 24.13.0, ignored existing dependency symlink):

```sh
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH node --test packages/storage/test/journal-retention.test.ts packages/development/test/journal-retention.test.ts packages/development/test/journal-forgetting.test.ts packages/development/test/development.test.ts packages/storage/test/document-journal.test.ts packages/storage/test/document-journal-review.test.ts packages/storage/test/storage.test.ts packages/storage/test/storage-bounds.test.ts
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH npm run check
git diff --check
```

The final focused runtime command passed **83/83**, zero failures/skips/cancellations (43 existing storage/journal predicates, 16 ordinary development cases, four unchanged root cases, 16 new storage retention and four new memory retention cases), duration 3716.736446 ms. The unchanged Unicode reproduction now passes. Strict compilation initially rejected the new throwing test getter's inferred `void` return (`TS2322`); annotating its existing target-array return type corrected the fixture without runtime changes. Strict compilation then passed; diff checking passed. No broad suite or repeated checks after success without a changed source/reason.

Implementation includes actual payload UPDATE and withdrawal marker INSERT trigger failures at both store and memory boundaries, committed/uncommitted reopen visibility, outer and caught savepoint rollback, stale CAS/conflicting and repeated request identities, activation after existing documents, unsupported-v1 refusal without rewriting raw rows, reserved namespace/event/input serialization refusal, missing/forged/reordered refs and markers, internal-row/UTF8 preallocation counting, equal-byte isolation across keys/namespaces/incarnations, and a future same-key version leaving old refs withdrawn. Historical self and job errors are withdrawn; unrelated current self/history stays usable. Newly written payload-free tombstones can themselves have withdrawn refs, as specified. Generic application document output excludes payload/head internals; snapshot explicitly returns dispositions while charging every underlying row/byte. Private withdrawal validation does not impose the observer's 512-row ceiling on operational forgetting. All relevant operations reread binding and durable disposition; no cache, new table/dependency, artifact deletion or host checkpoint.

Activation conservative preflight charges three document rows per existing source plus the binding, UTF8 namespace/key costs at 48 times, existing encoded value bytes at 12 times, 4096 bytes per source and 2048 fixed bytes plus duplicated host metadata. This includes prospective payload/head/ref costs before selecting source rows; final canonical anchor size is checked too. Capture retains its previous SQL preflight over *all* underlying document/event rows, including internal rows, and exact canonical output check. Conservation can reject a fitting request. Accumulated versions/dispositions/markers can exhaust the unchanged finite capture allowance; no history pruning or compaction is introduced.

Status: **implemented, fixture-verified authored handoff; independent JR3 acceptance and joined JR2 integration pending**. The current base's v1 recorder is deliberately not edited and requires the separately owned v2 adapter/disposition work. Root owns that integration, fresh independent review, shared application/verification wiring, and lane/execution disposition. This handoff does not qualify journal-backed privacy, actual acquisition, external evidence retention/retirement, H1, live/provider/native operation or deployment. Operational withdrawal cannot erase already returned buffers, independent evidence originals, SQLite pages/WAL/backups or separately attributed runtime/communication copies. JR5 remains separately planned and unavailable here.

## Exact compatibility/fixture adaptation diff for fresh review

Only imports, v2 schema fixtures, available-ref resolution and the new empty payload inventory were adapted. Every prior behavioral/rejection assertion remains, including complete intermediate values, failed CAS/SQL/savepoints, prefix gaps, reserved input forgeries, stale handles, anchor bounds and actual application construction. No row/byte rejection threshold was raised. The exact diff against adopted source base follows:

```diff
diff --git a/packages/storage/test/document-journal-review.test.ts b/packages/storage/test/document-journal-review.test.ts
index 5739b05..9c1cec6 100644
--- a/packages/storage/test/document-journal-review.test.ts
+++ b/packages/storage/test/document-journal-review.test.ts
@@ -5,7 +5,7 @@ import { tmpdir } from 'node:os';
 import { dirname, join } from 'node:path';
 import { fileURLToPath } from 'node:url';
 import { DatabaseSync } from 'node:sqlite';
-import { OperationalStore, RevisionConflict, DOCUMENT_JOURNAL_NAMESPACE, type DocumentJournalOptions, type EventInput } from '../index.ts';
+import { OperationalStore, RevisionConflict, DOCUMENT_JOURNAL_NAMESPACE, type DocumentJournalOptions, type EventInput, type JournalRef } from '../index.ts';
 import { AutarkApplication } from '../../../deployment/application.ts';
 import type { ApplicationConfig } from '../../../deployment/config.ts';
 import { AuthorityStore } from '../../supervisor/authority.ts';
@@ -25,8 +25,8 @@ for (const reserved of ['document-mutation', 'document-journal-anchor']) for (co
   const before = store.captureDevelopmentSnapshot(bounds);
   let reads = 0;
   const event: EventInput = fault === 'data-getter'
-    ? { id: 'forged', stream: journal.stream, type: 'observation', get data() { this.type = reserved; return { hostId: journal.hostId, schema: 'aeon.document-journal.v1' }; } }
-    : { id: 'forged', stream: journal.stream, get type() { return ++reads <= 2 ? 'observation' : reserved; }, data: { hostId: journal.hostId, schema: 'aeon.document-journal.v1' } };
+    ? { id: 'forged', stream: journal.stream, type: 'observation', get data() { this.type = reserved; return { hostId: journal.hostId, schema: 'aeon.document-journal.v2' }; } }
+    : { id: 'forged', stream: journal.stream, get type() { return ++reads <= 2 ? 'observation' : reserved; }, data: { hostId: journal.hostId, schema: 'aeon.document-journal.v2' } };
   try { store.append(event); } catch (error) { assert.match(String(error), /reserved/); }
   const after = store.captureDevelopmentSnapshot(bounds);
   assert.equal(after.events.filter(e => e.type === reserved).length, before.events.filter(e => e.type === reserved).length, 'generic caller minted a reserved host event');
@@ -49,7 +49,15 @@ test('committed transitions remain reconstructable through delete/recreate, stal
   early.delete('memory', 'x', 2); store.put('memory', 'x', 'recreated', null);
   const snapshot = f.open().captureDevelopmentSnapshot(bounds);
   assert.equal(snapshot.journalBinding?.anchorId, binding.anchorId);
-  const transitions = snapshot.events.filter(e => e.type === 'document-mutation').map(e => e.data as { before: unknown; after: unknown });
+  const resolveRef = (ref: JournalRef | null) => {
+    if (!ref) return null;
+    const payload = snapshot.journalPayloads.find(payload => payload.ref.versionId === ref.versionId);
+    assert.ok(payload && payload.state === 'available'); return payload.document;
+  };
+  const transitions = snapshot.events.filter(e => e.type === 'document-mutation').map(e => {
+    const data = e.data as unknown as { before: JournalRef | null; after: JournalRef | null };
+    return { before: resolveRef(data.before), after: resolveRef(data.after) };
+  });
   assert.deepEqual(transitions.map(e => [e.before, e.after]), [[{ revision: 1, value: 'anchor' }, { revision: 2, value: 'intermediate' }], [{ revision: 2, value: 'intermediate' }, null], [null, { revision: 1, value: 'recreated' }]]);
   assert.deepEqual(snapshot.documents.find(d => d.namespace === 'memory'), { namespace: 'memory', key: 'x', revision: 1, value: 'recreated' });
 });
@@ -135,7 +143,8 @@ test('actual application binds before initial allocation and omitted-option reop
     assert.equal(binding.anchorSequence, 1);
     assert.deepEqual((first.events[0]!.data as { documents: unknown[] }).documents, []);
     const allocation = first.events.filter(e => e.type === 'document-mutation').map(e => e.data as { namespace: string; key: string; before: unknown; after: unknown }).find(e => e.namespace === 'allocations' && e.key === 'operating-envelope:v1');
-    assert.ok(allocation); assert.equal(allocation.before, null); assert.deepEqual(allocation.after, app.store.get('allocations', 'operating-envelope:v1'));
+    assert.ok(allocation); assert.equal(allocation.before, null); const allocationPayload = first.journalPayloads.find(payload => payload.ref.versionId === (allocation.after as JournalRef).versionId);
+    assert.ok(allocationPayload && allocationPayload.state === 'available'); assert.deepEqual(allocationPayload.document, app.store.get('allocations', 'operating-envelope:v1'));
     await app.close(); app = undefined;
     app = new AutarkApplication(options); assert.deepEqual(app.store.documentJournalBinding(), binding);
     assert.deepEqual(app.store.captureDevelopmentSnapshot(bounds), first); assert.equal(requests, 0); assert.equal(app.directApi.listening, false);
diff --git a/packages/storage/test/document-journal.test.ts b/packages/storage/test/document-journal.test.ts
index 6516856..a93f0ac 100644
--- a/packages/storage/test/document-journal.test.ts
+++ b/packages/storage/test/document-journal.test.ts
@@ -5,7 +5,7 @@ import { tmpdir } from 'node:os';
 import { join } from 'node:path';
 import { DatabaseSync } from 'node:sqlite';
 import { canonicalJson } from '../../contracts/common.ts';
-import { DOCUMENT_JOURNAL_KEY, DOCUMENT_JOURNAL_NAMESPACE, OperationalStore, RevisionConflict, type Document, type DocumentJournalOptions } from '../index.ts';
+import { DOCUMENT_JOURNAL_KEY, DOCUMENT_JOURNAL_NAMESPACE, OperationalStore, RevisionConflict, type Document, type DocumentJournalOptions, type JournalRef } from '../index.ts';
 
 const journal: DocumentJournalOptions = { stream: 'development:attempt', hostId: 'qualified-host:observer', maxAnchorDocuments: 100, maxAnchorBytes: 100_000 };
 const limits = { maxRows: 512, maxBytes: 1_048_576 };
@@ -14,7 +14,18 @@ function fixture(t: TestContext) {
   t.after(() => { for (const store of stores) store.close(); rmSync(dir, { recursive: true, force: true }); });
   return { filename, open(option?: DocumentJournalOptions | null) { const store = new OperationalStore({ filename, documentJournal: option }); stores.add(store); return store; }, close(store: OperationalStore) { store.close(); stores.delete(store); }, sql(fn: (db: DatabaseSync) => void) { const db = new DatabaseSync(filename); try { fn(db); } finally { db.close(); } } };
 }
-function mutations(store: OperationalStore) { return store.events<{ namespace: string; key: string; before: Document | null; after: Document | null; hostId: string }>(journal.stream).filter(event => event.type === 'document-mutation'); }
+function resolveRef(store: OperationalStore, ref: JournalRef | null): Document | null {
+  if (!ref) return null;
+  const payload = store.captureDevelopmentSnapshot(limits).journalPayloads.find(payload => payload.ref.versionId === ref.versionId);
+  assert.ok(payload && payload.state === 'available'); return payload.document;
+}
+function anchorData(store: OperationalStore) {
+  const data = store.events(journal.stream)[0]!.data as unknown as { documents: JournalRef[] };
+  return { ...data, documents: data.documents.map(ref => ({ namespace: ref.namespace, key: ref.key, ...resolveRef(store, ref)! })) };
+}
+function mutations(store: OperationalStore) {
+  return store.events<{ namespace: string; key: string; before: JournalRef | null; after: JournalRef | null; hostId: string }>(journal.stream).filter(event => event.type === 'document-mutation').map(event => ({ ...event, data: { ...event.data, before: resolveRef(store, event.data.before), after: resolveRef(store, event.data.after) } }));
+}
 function observeRows(t: TestContext, beforeRows?: () => void) {
   const original = DatabaseSync.prototype.prepare; let documents = 0, events = 0;
   t.mock.method(DatabaseSync.prototype, 'prepare', function(this: DatabaseSync, sql: string) {
@@ -30,7 +41,7 @@ test('one atomic anchor preserves initial rows and every intermediate update, de
   initial.append({ id: 'prior', stream: 'ordinary', type: 'observation', data: 1 });
   const store = f.open(journal), binding = store.documentJournalBinding()!;
   assert.equal(binding.anchorSequence, 2);
-  assert.deepEqual(store.events(journal.stream)[0]!.data, { schema: 'aeon.document-journal.v1', hostId: journal.hostId, maxAnchorDocuments: journal.maxAnchorDocuments, maxAnchorBytes: journal.maxAnchorBytes, documents: [{ namespace: 'a', key: 'first', revision: 1, value: false }, { namespace: 'z', key: 'old', revision: 1, value: { note: 'before activation' } }] });
+  assert.deepEqual(anchorData(store), { schema: 'aeon.document-journal.v2', hostId: journal.hostId, maxAnchorDocuments: journal.maxAnchorDocuments, maxAnchorBytes: journal.maxAnchorBytes, documents: [{ namespace: 'a', key: 'first', revision: 1, value: false }, { namespace: 'z', key: 'old', revision: 1, value: { note: 'before activation' } }] });
   store.put('z', 'old', { note: 'middle' }, 1); store.put('z', 'old', { note: 'last' }, 2); store.delete('z', 'old', 3); store.put('z', 'old', 'recreated', null);
   const history = mutations(store);
   assert.deepEqual(history.map(event => [event.data.before, event.data.after]), [
@@ -128,7 +139,7 @@ test('anchor row and UTF8 byte ceilings refuse before row materialization and le
   assert.throws(() => f.open({ ...journal, maxAnchorDocuments: 0 }), /cannot open operational state/);
   assert.throws(() => f.open({ ...journal, maxAnchorBytes: 750 }), /cannot open operational state/);
   assert.equal(seen.documents, 0); assert.equal(initial.documentJournalBinding(), null); assert.equal(initial.events().length, 0);
-  assert.deepEqual(f.open(journal).events(journal.stream)[0]!.data, { schema: 'aeon.document-journal.v1', hostId: journal.hostId, maxAnchorDocuments: journal.maxAnchorDocuments, maxAnchorBytes: journal.maxAnchorBytes, documents: [{ namespace: 'memory', key: '😀', revision: 1, value: '😀'.repeat(30) }] });
+  assert.deepEqual(anchorData(f.open(journal)), { schema: 'aeon.document-journal.v2', hostId: journal.hostId, maxAnchorDocuments: journal.maxAnchorDocuments, maxAnchorBytes: journal.maxAnchorBytes, documents: [{ namespace: 'memory', key: '😀', revision: 1, value: '😀'.repeat(30) }] });
 });
 
 test('anchor INSERT or binding INSERT failure rolls back activation, leaving ordinary state unchanged', t => {
@@ -205,7 +216,7 @@ test('snapshot refuses missing internal or trailing events before materializing
 });
 
 test('snapshot corrupt event JSON refuses while empty ordinary snapshot remains complete', t => {
-  const f = fixture(t), store = f.open(); assert.deepEqual(store.captureDevelopmentSnapshot(limits), { documents: [], events: [], journalBinding: null });
+  const f = fixture(t), store = f.open(); assert.deepEqual(store.captureDevelopmentSnapshot(limits), { documents: [], events: [], journalBinding: null, journalPayloads: [] });
   store.append({ id: 'one', stream: 'runtime', type: 'input', data: 1 }); f.sql(db => db.prepare('UPDATE events SET data=? WHERE id=?').run('{broken', 'one'));
   assert.throws(() => store.captureDevelopmentSnapshot(limits), SyntaxError);
 });
```
