# Independent development journal review

A1-L09 finite prerequisite review, 2026-10-12. Reviewer `/root/a1_development_journal_review`; actual finite tool goal active before inspection. Clean base `fd680a97501a45f864b0473860564020a08099d9`; implementation `26328ad55e1537bbeaaeeac611aad8baefe1d6a0`; author freezes `4ef17d6`, `508852d`, `54dbf45`. Root owns lane coordination (claim `9b17345`). Exclusive writes are this evidence and `packages/storage/test/document-journal-review.test.ts`. Production and author evidence/tests remain read-only; repairs go to the author. This is neither lane nor H1 acceptance.

## Frozen review scope and causal hypotheses

Before tests: inspect exact source diff and independently exercise real temporary SQLite and the actual application constructor. No native/confined workload, providers, credentials, network, installed service, bulk materialization or dependency changes.

1. Journal records must reconstruct actual revisions and deletions despite failed CAS, nested rollback and failed event inserts. Retained controls use an initial anchor and explicit expected transitions; counts alone do not prove completeness.
2. Earlier/reopened writers must adopt the durable binding. Explicit disable and changed or absent binding/anchor must fail, including changing each bound identity field. Raw SQL is fault injection, not claimed writer authority.
3. Generic append must never create a reserved host event. Inspect mutable/accessor-bearing event inputs for a time-of-check/time-of-use gap between the public reserved-type guard and SQL insertion, with ordinary append as retained control.
4. Bounded capture must use the existing connection, retaining WAL state and identity despite pathname replacement. SQL preflight must reject excessive rows and actual UTF-8/escaped metadata bytes before selecting payloads; include zero/unsafe bounds, BLOB-sized fault sources and malformed binding/event values.
5. Global prefix checks must reject missing first/intermediate/trailing rows and missing/changed SQLite high-water. No caller completeness flag or replay claim substitutes for observed rows.
6. The actual application constructor must bind before its first allocation mutation; a fresh bound construction and reopened omitted-option construction must retain that anchor/history. Constructor-only, no start/listen/request.

Reproduced defects will remain in a committed red checkpoint before exact author repairs are reviewed and rerun. Existing author tests are useful corroboration, not independent qualification. Existing `readArtifact` and original bridge methods remain outside edit scope and will be checked for unchanged source.

## Preserved red checkpoint

Node 24.13.0 command `node --test packages/storage/test/document-journal-review.test.ts` against unchanged `26328ad` production: **6 passed, 2 failed, zero cancelled/skipped**. Both reserved types are forgeable by generic `append`: its initial guard reads `type='observation'`, then an input `data` getter changes the same object's `type` to `document-mutation` or `document-journal-anchor` during canonical serialization. `insertEvent` rereads `input.type` for SQL and persists the forged host record. The mutation count becomes 1 instead of 0; anchor count becomes 2 instead of 1. Capture returns these rows without a storage-level refusal. This is an in-process EventInput boundary defect; no claim of a JSON-only remote exploit. A safe fix may reject the input or capture a stable ordinary event; the test grades only the reserved-host-record guarantee.

Initial test-authoring run was 5 passed/3 failed: two expected forgeries and one incorrect byte-fixture assumption (500 escaped one-byte control characters conservatively still fit 4,000 bytes). The byte fixture was corrected to 600 characters; that case passes. Initial forgery assertions required rejection; before handoff they were narrowed to the actual contract (no new reserved record) so safe input snapshotting is also accepted. These are test-design corrections, not production repairs or erased runtime failures.

Retained passing controls cover exact delete/recreate transitions across earlier handles, failed event insertion with nested rollback and stale CAS, actual WAL/open-handle identity after directory-symlink replacement, bounded preflight before payload SELECT for UTF-8/escaped metadata/BLOB/rows, six prefix/high-water corruptions, five binding/anchor corruptions with unchanged documents, and actual constructor-before-allocation ordering plus omitted-option reopen. Application checks perform no start/listen/model request.

At red checkpoint `dc88a91`, existing author/storage/artifact focused command `node --test packages/storage/test/document-journal.test.ts packages/storage/test/storage.test.ts packages/storage/test/storage-bounds.test.ts` independently reran **31/31 passed**, zero failures/cancellations/skips. `PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH npm run check` passed (approved ignored symlink to the already installed root node_modules; no install). `git diff --check` passed. Direct substring comparison confirmed `readArtifact` byte-identical to `26328ad^` original grant-bridge source. These passes do not resolve the two held-out failures. Root and author received the red checkpoint and exact mechanism before any repair.

Before receiving a repair, the frozen mutable/accessor-input hypothesis was additionally checked with a `type` getter returning ordinary values for the public guard and a reserved kind on subsequent reads. Both reserved variants fail identically. Expanded independent command is **6 passed/4 failed**, zero cancellations/skips. This prevents a repair limited to the data-getter reproduction from overlooking repeated type reads.

## Exact repair verification and disposition

Author repair `84f551872821912d5c358fd328c51f17b66e7048` was inspected and imported as `02334a2570ae4e80e663fe235e3af7c2a3fa4a34`. Public append captures id/stream/type once, checks that stable type, and forwards a fresh input literal while data remains read inside the existing transaction. The private insertion path also uses one-read local identities throughout validation, serialization, duplicate comparison, SQL and returned metadata. This addresses the demonstrated inconsistent rereads without changing journal binding, snapshot bounds, application construction or artifact reads. The author's two additional cases retain ordinary event identity/deduplication and rollback of nested payload-serialization side effects.

On clean repaired source `02334a2570ae4e80e663fe235e3af7c2a3fa4a34`:

- `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test packages/storage/test/document-journal-review.test.ts packages/storage/test/document-journal.test.ts packages/storage/test/storage.test.ts packages/storage/test/storage-bounds.test.ts`: **43 passed, zero failed/cancelled/skipped**. All ten independent review cases pass, including the four unchanged red cases.
- `PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH npm run check`: passed.
- `git diff --check`: passed; working tree clean before this evidence update.
- Exact diff comparison confirms review tests unchanged from red checkpoint `bc6cf7d`, and storage/application/author test source matches author `84f5518`.

**Disposition: accepted for this finite source/SQLite/application-constructor engineering review.** No unresolved finding remains within the frozen scope. Red checkpoints remain in history and are not reclassified. Capture uses an actual transaction/connection and conservative finite bounds; it can reject a fitting snapshot. Raw SQL outside the OperationalStore writer closure remains outside the authority claim; immutable-prefix/replay semantics, recorder coverage and source qualification belong to the acquisition owner. Prior-to-anchor history is not established. Full joined root checks, recorder integration, actual developmental acquisition and H1 remain root/downstream gates. No physical/native/provider/network/credential/Slack/deployment activity occurred. This finite review does not accept A1-L09 or H1.
