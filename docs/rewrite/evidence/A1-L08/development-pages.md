# A1-L08-CP1 bounded physical storage pages

2026-10-12. Pre-code specification; implementation and independent review pending. Owner `/root/a1_development_pages`, branch `codex/a1-development-pages-20261012`, worktree `/home/palimpsest/migration/aeon-1-20261011/development-pages`, base `0307436`. Exclusive writes are this evidence, narrow `packages/storage/index.ts`, and new `packages/storage/test/development-pages.test.ts`. An actual finite tool goal preceded inspection. Requirements RW08–RW10, RW16, RW18–RW21; root alone updates central planning status.

```text
/goal Implement complete bounded physical page capture on the actual OperationalStore connection, preserve the old full API and v2 replay/withdrawal invariants, locally verify causal behavior, and commit a finite authored handoff for recorder integration and independent review.
```

The adopted [complete page design](development-incremental-capture-design.md), including its corrected distinction between current-cut admission and historical-use availability, governs. Root explicitly approved the following missing artifact contract on 2026-10-12 before code. This changes no recorder allowance or existing full-snapshot predicate.

## Frozen API and resource contract

Export `PhysicalDocumentRow`, `SourcePage`, `SourcePageDescriptor`, `PageCaptureBounds`, `OperationalArtifactCapture`, `SourceCut`, `HistoricalSourceUse`, and `SourceUseObservation` with the design's fields. `PageCaptureBounds` additionally requires `maxOperationalArtifacts`, `maxOperationalArtifactBytes`, and `maxOperationalArtifactTotalBytes`; `SourceCut` additionally contains `operationalArtifacts: OperationalArtifactCapture[]`, whose entries are `{original: ArtifactRef, retained: ArtifactRef, bytes: number}`. The recorder may lift this mapping into its manifest.

```ts
captureDevelopmentPages(
  bounds: PageCaptureBounds,
  retainPage: (bytes: Uint8Array) => ArtifactRef,
  retainArtifact: (original: ArtifactRef, bytes: Uint8Array) => ArtifactRef,
  resolveRetainedArtifact?: (ref: ArtifactRef, maxBytes: number) => Uint8Array,
): SourceCut;
withDevelopmentSourceCut<T>(
  input: {journalDigest: string; lastSequence: number}, use: () => T,
): T;
withDevelopmentVersionsAvailable<T>(
  input: HistoricalSourceUse, use: (observation: SourceUseObservation) => T,
): T;
```

All capture limits are finite safe integers. Pages have positive rows <=512 and bytes <=1,048,576; artifacts have independently declared count, singleton and aggregate limits. Multiplication/addition must remain safe. Capture physical rows <=maxPages*maxPageRows, conservative/serialized bytes <=maxPages*maxPageBytes. Positive historical page/prefix/version/marker limits are bounded independently; marker bytes <=page bytes. The historical input's exact sorted ref list is supplied by the trusted recorder; deriving the complete attempt-wide list is CP2 ownership.

Every `aeon:artifact` ref is read through bounded `readArtifact` on this existing Store connection. The optional resolver handles only exact `sha256:` refs through an authorized bounded original-inventory read. Its absence means unavailable. Count and mapping deduplicate exact `(uri,sha256)` originals, rather than digest alone. Resolver/retainer arguments are detached refs; returned actual bytes and exact retained SHA/URI are checked. All callbacks are synchronous and source writes/reentrant acquisition are fenced. No nullable-byte substitute or availability assertion is accepted.

Before any row value is selected, scalar SQL checks complete physical document/event counts, types, safe revisions/sequences, whole-table conservative sums and singleton bounds. Event min/max/count/high-water prove the complete prefix. Conservative costs remain `6*(UTF8(namespace)+UTF8(key)+UTF8(valueText))+256` and `6*(UTF8(id)+UTF8(stream)+UTF8(type)+UTF8(dataText))+256`. Preflight reserves `512*maxPages` header bytes; each actual page uses a 512-byte header allowance. A scalar ordered bounded keyset subquery finds the maximal fitting prefix before its value SELECT. BINARY ordering uses UTF-8 byte comparison; bounded reads verify lossless text bytes and exact canonical JSON.

Event replay first constructs only exact refs, current refs and withdrawal IDs. A physical document pass checks every binding/head/payload/application row without hydrating a full snapshot; another bounded event pass retains exact pages. Graph metadata entries are <=`4*maxPhysicalRows`; aggregate canonical index bytes are <=`4*maxConservativeBytes`, with safe arithmetic checked before reading. The descriptor list is <=maxPages and artifact mapping <=maxOperationalArtifacts. Working payload allocations are one bounded decoded page, bounded raw text/verification representations and one encoded page buffer. These canonical budgets bound retained logical data and are **not measurements of JavaScript heap bytes**. No unbounded `documentRows`, `events`, `snapshotForJournalValidation` or full-array validator may implement the new path.

Row chains are exactly `H0=sha256(UTF8('aeon.development.rows.v1:'+table))`, `Hi=sha256(UTF8(canonicalJson([H(i-1),row])))`. All physical internals and all global ordinary events participate. Graph validation checks exact anchor/binding/ref introductions, mutation before/after/revision/deletion/recreation, withdrawal target/cutoff completeness, physical payload dispositions, current heads and current document commitments. A valid withdrawn version is structurally inventoried but cannot authorize historical use.

The current-cut fence authenticates the binding and exact live global count/high-water only at initial observation/B admission. The historical fence recomputes the bounded live retained prefix, verifies each exact required ID and available payload, bounds any current withdrawal marker before reading, then invokes its callback in the same transaction. Later legitimate accounting suffix growth is allowed; modified retained prefix or missing/corrupt/withdrawn old versions refuse. No new namespace, database, dependency, mutable cache or source session is introduced.

## Frozen causal checks

1. Multiple document/event pages retain every physical row, exact chains/global prefix, old/intermediate/deleted/recreated refs and current graph. Monkeypatched full helpers must never run. Small actual application ingress is also exercised if its existing offline fixture can be reused without unauthorized source changes.
2. Scalar refusal precedes value SELECT for singleton/aggregate/page/row limits, unsafe arithmetic and malformed storage types. Escaped, Unicode and invalid UTF-8 fixtures exercise conservative allocation and BINARY ordering.
3. Missing/orphan payload/head, altered event prefix, forged/missing withdrawal marker and incorrect graph refs refuse. Valid withdrawals retain structural pages and historical use reports `document-history-withdrawn`; corruption reports `document-history-corrupt-or-missing`.
4. Retention callbacks cannot mutate the source, reenter capture, return Promises, alter handed-over bytes or substitute SHA/URI. Another SQLite writer cannot interleave. Renamed paths do not switch the open Store handle.
5. Actual descriptor artifact bytes, absent/corrupt references, distinct URI scope, per-artifact/count/aggregate bounds and unavailable external originals are checked.
6. Historical use accepts an old replaced/deleted exact version after new accounting events, with unchanged retained prefix digest. Required old withdrawal/corruption/missing and changed retained prefix refuse before use. Current-cut admission refuses after global growth. Callback mutation and asynchronous results refuse in both fences.

Only small offline local SQLite/application fixtures and pinned Node strict checks are authorized. Provider/native/physical acquisition, network, credentials, external sends, pushes/deployments and recorder/observer source writes are excluded. The isolated original full-snapshot capacity failures remain evidence; no capacity repair, CP2/CP4 acceptance, developmental competence, privacy, autonomy, deployment or H1 claim follows from author tests.

### Additional frozen actual-application measurement

Before running the requested twelve-admission source-only fixture, fix its bounds to page rows 512, page bytes 1,000,000, pages 4, physical rows 1,024, conservative bytes 2,500,000, serialized bytes 400,000, operational artifacts 10, singleton artifact bytes 10,000, and aggregate artifact bytes 20,000. Reuse the root's exact ordinary offline workload/configuration shape with bootstrap disabled, twelve separate conversations and a separate same-message revision control. Capture at initial construction and after each admission; assert zero physical requests/listeners, all complete page captures succeed, and preserve old full-capture refusal independently. Report actual counts/pages/serialized/conservative/artifact bytes for every cut. These are source-read bounds, **not a signed recorder plan or full multi-role feasibility proof**. CP2 must independently prove original no-dedup byte, slot and metadata arithmetic before recorder claim.

### Coordinated DC1 scalar accessor, frozen before code

Root authorized `hasArtifacts(): boolean` for the control owner's initial-freshness contamination check. It executes only `SELECT 1 FROM artifacts LIMIT 1` on this actual Store connection; it selects no artifact digest or bytes and performs no mutation. The empty-store and actually-stored-artifact causal check belongs to this task's new test. This adds no inventory API or capacity allowance and does not open a second filename connection. The narrow source commitment is returned to root for DC1 integration.

## Implemented handoff and verification

**Implemented and fixture-verified; fresh review, CP2/CP3 composition and CP4 acceptance remain pending.** Exact source/test checkpoint: `7d9e1ace47f26e7751823d7dad2476c97f52e7b0`. Pre-code API/causal checkpoint `5c5b468`; adopted root artifact correction `57bd2bc` imported as `3d7db2d` before code; fixed actual-workload bounds `70f0555`; DC1 accessor specification `e64c198`. Root's artifact decision preceded `5c5b468`; its subsequent instruction to import the amended design arrived immediately after that commit and was completed before any implementation.

The source adds complete physical page capture, exact v2 graph validation, row-chain commitments, same-connection artifact reads, current-cut and historical-use fences, and the scalar DC1 accessor. Existing supported mutators and close reject under a source fence. Root explicitly selected a single entry guard on `captureDevelopmentSnapshot` to prevent reentrant full acquisition, while retaining ordinary nested read transactions. The original full API's limits, normal behavior and all historical test predicates are preserved.

Source preflight includes **exact total page count** before any values, using ordered scalar-cost offsets without materializing keys; value reads themselves remain keyset reads. The initial conservative reservation still includes `512*maxPages`. Graph indexes also account for every global event ID and reject repeated IDs. Snapshot-facing metadata reserves a checked canonical upper bound of `maxPageBytes + 512 + 512*maxPages + 512*maxOperationalArtifacts`; each descriptor/mapping separately fits 512 bytes. The separately materialized binding/anchor each fit the page bound. Returned cut/manifest bytes are additional retention and owner-state costs for CP2, not part of page `serializedBytes`.

Historical scope copies only known validated fields and detached exact refs, so extra arbitrary input/prefix/bounds fields are never copied or serialized. Its ref-copy canonical bytes fit `maxVersionBytes`, its payload aggregate independently fits `maxVersionBytes`, and it reads one payload/marker at a time. Prefix replay index entries fit `4*(prefix.rows+maxVersions)` and canonical bytes fit `4*maxPrefixBytes`; the extra version term accommodates many anchor refs in one event. Marker worst-case multiplication is checked. Its observation is frozen and call-local. Required scope completeness, actual application/bridge/ledger/role association, multi-role fence ordering and custodian admission remain trusted recorder responsibilities. Storage does not treat a matching filename or copied binding as proof of that authority.

The first authored run was **55 pass / 1 fail** among 56 checks because Node's SQLite TEXT getter truncated an embedded-NUL key. The corrected reader selects bounded raw BLOB representations of fields after scalar TEXT-type preflight, then decodes and round-trips UTF-8; it preserves valid NUL/Unicode and rejects malformed bytes. Historical payload/withdrawal-marker readers use the same raw-byte decoding. A later refinement of the fragmentation check initially failed because its fixture hit aggregate capacity first; the fixture was adjusted from 10,000 to 12,000 page bytes while retaining three pages, and the assertion now requires specifically page-count refusal before any value SELECT. No original full-capacity or historical acceptance predicate was altered.

All commands ran locally with pinned `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` (Node 24.13.0), the existing ignored dependency symlink, no added dependencies, no provider/native acquisition, network, credentials, external sends or deployment. SQLite emitted its standard experimental-feature warning.

| Final command | Observed result |
|---|---|
| `node node_modules/typescript/bin/tsc --noEmit` using the pinned binary | pass, 1.616 seconds, no diagnostics |
| `node --test --test-concurrency=1 packages/storage/test/*.test.ts packages/development/test/journal-forgetting.test.ts deployment/development-accounting.test.ts deployment/development-accounting-review.test.ts` using the pinned binary | 207 pass, 0 fail/cancel/skip, 22.301 seconds; 65 authored cases plus 142 unchanged focused regressions |
| `git diff --check` | pass |

Final detailed test output remains local at `/tmp/a1-development-pages-final.log`; all fixture state is cleaned up. Earlier focused joined run passed 206 checks in 20.123 seconds before the additional raw-byte withdrawal-identity regression. This is author evidence; independent consequential review has not occurred.

### Actual twelve-admission source measurements

The fixed application fixture runs ordinary ingress plus ordinary `tick`, with bootstrap disabled, zero request records and no listening direct server. All thirteen initial/after-admission page captures pass in both modes. No page, internal row or global ordinary event is omitted. Each cut has **zero reached operational artifact refs/bytes**, despite the application's unreferenced prompt artifacts; separate causal tests verify actually referenced current/historical/event artifacts and scope-preserving external originals. Storage inventories all physical documents/events and every reached artifact, not an unrelated full artifact table.

| Separate admissions | Physical rows | Actual pages | Conservative page bytes | Actual serialized page bytes |
|---:|---:|---:|---:|---:|
| 0 | 18 | 2 | 44,338 | 7,499 |
| 1 | 62 | 2 | 179,586 | 30,389 |
| 2 | 106 | 2 | 314,834 | 53,283 |
| 3 | 150 | 2 | 450,082 | 76,177 |
| 4 | 194 | 2 | 585,330 | 99,071 |
| 5 | 238 | 2 | 720,578 | 121,965 |
| 6 | 282 | 2 | 855,826 | 144,859 |
| 7 | 326 | 2 | 991,074 | 167,753 |
| 8 | 370 | 2 | 1,126,322 | 190,657 |
| 9 | 414 | 2 | 1,261,570 | 213,564 |
| 10 | 458 | 2 | 1,397,052 | 236,510 |
| 11 | 502 | 3 | 1,533,046 | 259,529 |
| 12 | 546 | 3 | 1,668,528 | 282,475 |

The separate-conversation fixture retained 28 distinct page artifacts / 1,883,731 page bytes across these cuts. Its old full snapshot API first refuses at admission eight and remains refused through twelve, exactly as the isolated root red workload. The new conservative number charges each actual page header and omits the old API's separately duplicated binding allowance, so it is intentionally distinct from the root's old full-capture preallocation metric. It does not change the old metric or threshold.

| Same-message revision | Physical rows | Actual pages | Conservative page bytes | Actual serialized page bytes |
|---:|---:|---:|---:|---:|
| 0 | 18 | 2 | 44,338 | 7,499 |
| 1 | 62 | 2 | 179,646 | 30,399 |
| 2 | 82 | 2 | 251,342 | 42,515 |
| 3 | 102 | 2 | 323,038 | 54,631 |
| 4 | 122 | 2 | 394,734 | 66,747 |
| 5 | 142 | 2 | 466,430 | 78,863 |
| 6 | 162 | 2 | 538,126 | 90,979 |
| 7 | 182 | 2 | 609,822 | 103,095 |
| 8 | 202 | 2 | 681,518 | 115,211 |
| 9 | 222 | 2 | 753,214 | 127,327 |
| 10 | 242 | 2 | 825,066 | 139,475 |
| 11 | 262 | 2 | 896,906 | 151,615 |
| 12 | 282 | 2 | 968,746 | 163,762 |

The revision control retained 26 page artifacts / 1,172,118 page bytes; all old full captures still pass. These measured serializations include timestamps/UUIDs from actual local application construction and admissions. They are source-only measurements, not a fully accounted attempt or a forecast of deduplication.

### Remaining gates and current limits

The absolute 512-row/1,048,576-byte full API remains intentionally bounded. Page capture retains the independent 512-row/1,048,576-byte page ceiling and refuses excessive singleton rows, aggregate/page counts, serialized/conservative bytes, referenced artifact count/bytes and unsafe arithmetic. CP2 must constrain page/artifact bytes further to the accepted raw-store singleton ceiling and prove unchanged 512 attempt-record / 8,388,608-byte no-dedup reservations, slots, manifests, complete owner metadata, protected response/failure capacity, pending-write recovery and private authorized `sha256:` resolution before a claim. A successful physical cut containing valid withdrawal markers is structural inventory, not authorization to use withdrawn values; the required historical-use fence rejects them and CP2 must prevent any passing partial B.

The source-only fixture does not include signed manifests, role associations, before/after clocks, original-ledger reviewer reservation/dispatch/settlement, multi-role withdrawals or a custodian attempt-use gate. It shows suffix-growth semantics at the actual Store boundary, with a replaced/deleted old version and later accounting rows/events; actual bridge/recorder B/T composition belongs to CP2/CP3 and fresh CP4. Arbitrary long histories/workloads and oversized rows/artifacts can still refuse honestly. No attempt-wide feasibility, development, competence, privacy, autonomy, deployment, Aeon 2 or H1 qualification is claimed.

Finite CP1 source/evidence work is complete at this authored handoff. Root integrates these exact commits, independently reviews the consequential change, routes `hasArtifacts()` to DC1, and keeps CP2/CP3/CP4 and the original red diagnostic open. This owner does not remain active waiting for review.

## New finite R3 repair specification, before code

Root claim `69f803b` assigns this same owner a **new actual finite goal** after fresh review `1eef9e0` (criteria `1358e0c`, unchanged test `db9d6c2`) of source `7d9e1ac`/handoff `65f6709`. The review test/evidence are imported unchanged. Original review results are 44 cases / 40 pass / 4 fail; original joined results are 251 / 247 pass / 4 fail. The scope is exclusively the in-scope R3 selected-field preflight defect, this author's causal tests and evidence. Root preserves the three stronger arbitrary-SQL diagnostic predicates and explicitly excludes their repair under the adopted trusted-writer model.

```text
/goal Repair R3 historical withdrawal-marker selected-field preflight on the actual Store connection, preserve unchanged independent predicates and the three excluded raw-SQL diagnostics, locally verify exact bounds, and commit a finite honest handoff for fresh re-review.
```

Before any marker value SELECT, the existing same-transaction scalar join will check all selected TEXT field types and UTF-8 byte lengths for `id`, `stream`, `type`, and `data`, plus integer sequence type and safe positive sequence range. Let `textBytes = UTF8(id)+UTF8(stream)+UTF8(type)+UTF8(data)`. Require checked `textBytes+256 <= maxWithdrawalMarkerBytes` (raw selected fields plus row/sequence overhead) and checked `6*textBytes+256+512 <= maxPageBytes` (the unchanged conservative event singleton formula and page header). These are existing fixed budgets, now applied to the complete selected marker row; no budget is increased. Each length, sum and multiplication must be safe before materialization. The bounded raw-byte decoding and exact marker binding/identity/ref checks remain unchanged after admission.

Freeze causal checks for oversized stream/type/id/data, aggregate selected-field and conservative singleton overflow, malformed marker field/sequence storage types, and supported Unicode/embedded-NUL withdrawal identity. Instrument the marker value query and require zero materializations when preflight fails. Boundary checks will permit the exact raw/conservative limit and refuse one byte below it while preserving unavailable semantics. Re-run all unchanged 44 independent predicates: R3 must pass; restored available payload and forged target-revision/incomplete-cutoff probes must remain the same three preserved failures, not be renamed, removed, skipped or declared repaired. Original supported 207 cases plus new author checks and strict compilation must pass. No growing suffix scan, new index, namespace, cap bump, caller change, signing, live/native/provider work or push is authorized.

### R3 authored repair handoff

**R3 implemented and author fixture-verified; fresh re-review pending.** Pre-code repair specification `e666725`; exact repaired source/tests `656f86263a9ce58de9a55b768f99a723df1728b2`. The unchanged review imports are `8e64a3c` (criteria), `64bc4c3` (tests) and `0b168ce` (evidence). `git diff 1eef9e0 -- packages/storage/test/development-pages-review.test.ts docs/rewrite/evidence/A1-L08/development-pages-review.md` is empty: no reviewer assertion, failure, scope or historical report was changed.

The sole source repair replaces the data-only marker scalar-size check with lengths/types for every selected text field and a safe positive sequence check, then enforces the two exact frozen formulas before the existing marker value SELECT. No new table, index, namespace, suffix replay, allowance, resolver, argument or caller mutation is introduced. In particular, later accounting suffix growth remains legitimate. Consumers derive `maxWithdrawalMarkerBytes` for the complete selected raw marker fields plus 256 bytes, within their already accepted metadata/diagnostic headroom; data-body size alone is insufficient. The 512-byte page-header allowance and 6x conservative event formula remain unchanged.

Eleven new author cases independently exercise all four text fields, malformed field storage, aggregate raw-field overflow, conservative singleton overflow, unsafe sequence and exact-versus-one-byte-short raw/conservative budgets. The exact valid boundary includes Unicode and embedded-NUL marker identity and reports `document-history-withdrawn`. Every overflowing or malformed case reports corruption/unavailability with **zero marker value materializations** and no use callback. The original supported 207 tests remain intact; the author's total is now 76 cases.

| Exact command after pinned Node | Observed result |
|---|---|
| `--test --test-name-pattern='R3' packages/storage/test/development-pages.test.ts` | 11 pass, 0 fail/skip/cancel, 2.036 seconds |
| `--test packages/storage/test/development-pages-review.test.ts` | **44 unchanged cases: 41 pass, 3 preserved failures, 0 skip/cancel**, exit 1, 3.513 seconds; `/tmp/a1-development-pages-r3-review.log` |
| `--test --test-concurrency=1 packages/storage/test/*.test.ts packages/development/test/journal-forgetting.test.ts deployment/development-accounting.test.ts deployment/development-accounting-review.test.ts` | **262 cases: 259 pass, the same 3 preserved failures, 0 skip/cancel**, exit 1, 32.952 seconds; `/tmp/a1-development-pages-r3-joined.log` |
| `--test --test-concurrency=1 packages/storage/test/storage.test.ts packages/storage/test/storage-bounds.test.ts packages/storage/test/storage-bounds-review.test.ts packages/storage/test/document-journal.test.ts packages/storage/test/document-journal-review.test.ts packages/storage/test/journal-retention.test.ts packages/storage/test/journal-retention-review.test.ts packages/storage/test/development-pages.test.ts packages/development/test/journal-forgetting.test.ts deployment/development-accounting.test.ts deployment/development-accounting-review.test.ts` | **Original 207 supported cases plus 11 new cases: 218 pass, 0 fail/skip/cancel**, 22.365 seconds; `/tmp/a1-development-pages-r3-supported.log` |
| `node_modules/typescript/bin/tsc --noEmit` | pass, no diagnostics, 1.914 seconds |
| `git diff --check` | pass |

All commands use the same pinned Node 24.13.0 binary, unchanged existing dependency symlink and small local offline fixtures. The two combined runs include the actual twelve-admission application fixtures; all their page/full-snapshot outcomes remain as recorded above. The raw-SQL independent diagnostics are executed unchanged in both review and joined commands, not skipped by the separately enumerated supported-regression command. Standard SQLite experimental warnings remain.

The three remaining failures are exactly: restoring an earlier available payload by raw SQL after valid withdrawal permits historical use; raw SQL forging a later target revision to 99 is denied as withdrawn rather than classified corruption; raw SQL removing one cutoff ref is likewise denied as withdrawn. **None is repaired or declared passing.** Root's explicit task disposition places them outside the adopted trusted-Store-writer authority boundary. The historical-use operation does not authenticate arbitrary malicious host/SQL edits or fully replay the growing post-cut withdrawal suffix. Complete physical capture still rejects these corruptions. The independent review's original four-failure result and stronger diagnostic predicates are preserved; this author's new full joined result remains red with three failures.

The new finite authored R3 goal is complete after this source/evidence handoff. Root assigns fresh exact-source re-review, separately records its gating-versus-archived-diagnostic disposition without weakening the three predicates, and retains CP2/CP3/CP4 and all attempt-wide/qualification gates. This owner releases the slot and does not wait active for review. No live acquisition, credentials, external effect, publication or deployment occurred.
