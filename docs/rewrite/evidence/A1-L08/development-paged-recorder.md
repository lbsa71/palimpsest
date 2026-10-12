# A1-L08 CP2-R paged recorder

Status: bounded authored implementation complete at `02ce31bcf8eb8970d2d69f88dcbfb691d75abcd0`; fresh independent CP2/JR3 acceptance pending. Owner `/root/a1_development_acquisition`, worktree `development-paged-recorder`, base `75b7c72`, root claim `eec409e`. The actual finite author goal completes at this handoff. Scope is the root-adopted composition design `ca19314` with responsiveness qualifications `0a0b9ec`; no OD1/DC2/CP3 workload execution or physical qualification. Root moved full-B model projection into separate P1/P2 tasks; it is not silently implemented or qualified here.

## Frozen pre-code contract

A newly signed acquisition plan version 2 adds `captureLayout` and `protocol` to the existing exact version-1 fields. Version-2 attempts must name `complete-pages-bounded-20261012`, use its authenticated signed limits and explicitly constructed raw-store profile. Existing signed version-1 fixture plans retain their original representation, refusals and bounds; they do not opt into this larger profile. No consumed plan can change capacity.

`captureLayout` is `{kind:'complete-pages-global-originals-v1',page:PageCaptureBounds,maxManifestBytes,maxCaptureIndexBytes,referencedOriginalPool:{maxOriginals,maxBytes},sourcePool:{maxArtifacts,maxBytes},proofPool:{maxArtifacts,maxBytes,mandatoryArtifacts},metadata:{behaviorBytes,finalBytes,ownerWithoutBehaviorBytes,ownerBytes}}`. The page bounds are copied exactly into the accepted actual-handle CP1 API. Operational singleton bytes remain at most 1,000,000 regardless of metadata ceilings. Manifest bytes include configuration/path association, clock and the complete SourceCut including every descriptor and original mapping. Owner captures retain only their bounded manifest reference, cursor/digests and clock; page bodies and required-version arrays are not duplicated in owner state.

`protocol` is `{nonRequestObservations,initialCaptures,cycleCaptures,boundaryCaptures,schedule:[{roleId,assignmentId,phase,ordinal}]}`. The schedule exactly bijects the ordinary assignment packet; phases are opportunity, learning, interference, feedback, script, script-feedback. The full adopted profile has 126 deliveries, six initial and six final captures, six cycle and twelve boundary captures: 156 total. Non-request observations are 40; behavioral request observations are additionally protected. Proof slots are 256 (202 mandatory), bounded together at 16 MiB. Proof retention records provenance bytes only; it does not create judgments or sign caller predicates as observations. Driver observation/checker construction remains CP2-O/OD1/DC2.

The full-plan gate constructs a real canonical nonempty signed packet and plan with the adopted role grants. It measures source bytes and all exact signed metadata templates before raw/owner claim. Capture reservation is source pool + S*(serialized page bytes + manifest bytes) + global actual-original pool + protected observations + proof pool. Inventory reservation protects source/page/manifest/original/observation/response/metadata/failure/proof entries. Referenced originals are counted by exact `(uri,sha256)` globally, debited once per pair after re-reading authorized source bytes. Raw digest dedup does not erase global pair count/bytes. Owner persists a pending original pair before any possible raw write; drafts and response accounting are never moved or refunded. All four B/final/owner serialization copies must fit their separately signed limits and aggregate metadata reservation; full index, complete capture indices, observations, proofs, delivery intents, five transitions/request, pending and terminal markers participate.

Public `openAcquiredCapture(ref)` returns `{manifest,assertUsable(),pages():IterableIterator<SourcePage>,resolve(original,maxBytes):Buffer}`. Only an actually accepted capture manifest in this recorder is admitted. Each manifest/page/resolver release calls the current-use gate; cached manifest/source use must call assertUsable. Descriptors and canonical page hashes, tables, row counts, row-chain digests, cursor and complete original mapping are checked privately with bounded page reads. The iterator releases at most one page at a time. Resolver authorization is exact original-pair membership in that capture, with its retained digest and declared byte length. A source path stat remains path identity, never proof of opened SQLite FD identity.

Historical guards derive the exact version union from all accepted committed page captures, including initial captures for every behavioral role before version-2 real or synthetic dispatch. Cached derived arrays are bounded and keyed by accepted capture inventory; they never substitute for current actual-handle historical checks. Acquire source fences in signed role order, then custodian, then owner (deduplicated). An ordinary caller role transaction may already own its actual connection; this is the accepted single-host synchronous scope, not a global cross-process lock-order guarantee. CP2-S permits historical-only nested read fencing; complete capture and current-cut publication remain depth zero. No source/ledger writes, reentry, close, Promise or awaited transaction in a current-use callback.

Guard failure unwinds its own fences before retaining only the bounded signed terminal reason with source:null. It never captures uncommitted provenance. An in-memory fail-closed latch remains set if owner marker persistence fails; reopen rechecks actual invalid sources. Exact mapped dispatched response retention/verification/settlement remain usable after denial; prompts, new work and reconciliation entry do not.

B order is freezing intent, actual bridge freeze outside fences, permanent original marker, final complete committed role cuts, then depth-zero exact-current-cut fences + current custody admitting immutable B publication. A changed cut refuses rather than re-freezing or silently selecting a newer cut. Reviewer accounting suffixes are permitted by historical prefix/version guards after B. Raw reader, cached projection, async model entry, output and close all recheck current use.

The multi-MiB B model-input wire is a cross-owner dependency: bounded deterministic input binds exact full B, indices and outcomes, with accounted scoped reads. Existing full-B input verification cannot silently accept a different projection. Root/H must approve and implement the shared verification contract before adapter composition is claimed.

Validation budget: small synthetic SQLite/file/mock-provider causal cases, focused joins and strict only. Full 126-delivery canonical preclaim is required; full ordinary trace and responsiveness/RSS benchmark are separate. Target 250 ms immediate guard, hard 1 s observed guard, 5 s complete cut, 2 GiB RSS remain unmeasured qualification gates.

Pre-code reader supplement, root agreed: expose `assertUsableNow`, `forEachEvent(visit:(event:StoredEvent)=>void)`, `forEachCurrentDocument(visit:(row:PhysicalDocumentRow)=>void)` excluding reserved journal internals, and `resolveJournalVersion(versionId):{ref:JournalRef,document:Document}` for an exact available version in that capture. Enter one live fence per bounded page, visit detached rows synchronously inside it, reject visitor thenables/write/reentry, release and recheck next page. Exact version resolution uses a private bounded metadata-only page locator, one guarded page read and exact canonical Document commitment. No payload-value graph is returned or cached. Existing bounded pages iterator remains for the actual owned reassembly diagnostic. `assertUsableNow` is the canonical CP3 name; `assertUsable` stays only for the existing frozen reader fixture consumer. This addition does not authorize CP3 observer edits or qualify full workload fit.

Pre-code mandatory-proof supplement, root adopted: NEW unclaimed version-2 `proofPool` adds exact `mandatoryArtifactBytes`. The concrete plan uses 65,536 bytes for each of 202 mandatory identities, reserving 13,238,272 bytes within the unchanged 16-MiB proof pool. Typed `retainProtocolArtifact(kind,ordinal,bytes)` has immutable logical identities: task-output36, feedback36, checker36, script-receipt18, cycle3, learning3, experience9, boundary6, control5, reviewer-output2, review-judgment48; adaptation54 is optional. Each mandatory object is bounded by q, all objects by the 1-MB operational ceiling. Before optional retention protect every remaining mandatory byte/slot; no identity replacement or pool borrowing. Owner proof identity metadata is explicitly added to the canonical template. Earlier preclaim measurements without this future-proof reserve are incomplete and remain recorded failure history; no consumed plan was changed.

The CP1 complete-page interface does not provide an accepted committed withdrawal diagnostic suitable for this task. Version-2 diagnostic retention therefore explicitly refuses; the terminal marker has source:null and does not attest uncommitted source history. Version-1 depth-zero diagnostics remain unchanged. No additional cut, withdrawn-page format or source exception is introduced.

Pre-code named-profile validation clarification: version2 is the adopted finite full-protocol profile, not a customizable paging framework. Its schedule must prove the exact per-role phase/ordinal coverage (candidate and two ablations each12/3/9/12; three scripts each3+3), six initial/six cycle/twelve boundary cuts and40 non-request observations. Bounds may be tighter but cannot exceed the adopted64pages/32768rows/16MiB conservative/4MiB serialized/2048originals/16MiB global/32source objects/256proof objects/16MiB proofs/16MiB B/24MiB final/24MiB owner sans B/40MiB owner ceilings. Actual indexed manifest bytes are additionally <=1,000,000 even though its signed1MiB reserve includes headroom. Every bound is checked before claim. The full preclaim fixture measures a newly signed plan under these limits; it still does not establish ordinary-trace fit or model competence.

Pre-code event-position reader supplement, root requested: `resolveEvent(sequence):StoredEvent` admits only the exact captured sequence and returns a detached row under one current-use fence. Its private index contains at most one event-position range per bounded page; it stores descriptor/row offsets, not event bodies. This is the accepted complete captured event-position index for CP3, with no general query, new retained pool or source scan.

Pre-code fixed-claim immutability refinement: the authenticated detached plan and derived numeric capacity exposed as readonly recorder properties are recursively frozen once at construction. TypeScript readonly alone does not prevent runtime edits to nested capacities. Mutation of caller input before signing remains allowed; mutation of the accepted recorder plan/capacity after claim refuses and cannot expand any pool. This is enforcement of the existing no post-claim increase rule, with no new wire or authority.

## Authored source and dependency receipt

Owned source is `02ce31b`: acquisition-plan.ts, acquire.ts and the new acquisition-pages.test.ts. Pre-code checkpoints are `4b4ca72`, semantic-reader `66fffc3`, mandatory-proof `2702b2e`, finite-profile `a920bd1`, event-position reader `59f0904`, and fixed-claim immutability `bb1832c`. No independent assertion or old signed plan was edited by this author.

Imported exact root-authorized prerequisites: CP2-S source80eaab7 in `4abd66a`; CP2-H contract393df089/sourcee4b22c82 in `941a51f`/`8247ef4`; H-F1 envelope83e76b1 in `cbc3e04`; H-F2 envelope7cfcf79 in `10ee2c9`. H-F2 prerequisite acceptance is root review1fc42ed. Root fixture alignment `15237c4` changes only newly signed/unclaimed model fixture inventory entries from256 to512 and adds the exact old261/256 preclaim refusal regression. Old predicates and old claimed plans remain intact.

The reader manifest is the exact canonical JSON addressed by its capture artifact, not a projection. `forEachEvent`, `forEachCurrentDocument`, `resolveEvent`, `resolveJournalVersion` and `resolve` detach every release under the current source/custodian/owner fence. Visitor writes, thenables and reentry refuse. The bounded locator caches positions/descriptors/version refs rather than event/payload bodies. Normal post-B accounting suffixes remain usable while actual captured-version withdrawal denies both cached and reopened use.

The actual runtime tests include candidate and control DurableRuntime/EffectJournal entries under the ordinary outer source transaction, all six initial role captures, nested historical checks, and receiver writes after the fence releases. Another causal case withdraws a source and records maximal escaped failure detail while a physical request is already dispatched: authentic late response retention and original settlement still succeed, while ordinary evidence use and new work refuse. No provenance is retained from rolled-back or nested uncommitted source state.

## Concrete new-profile preclaim measurement

The fixture signs a real full126-delivery packet and plan, with156 bounded complete cuts. Its original request/role grants remain unchanged. This measurement is a preclaim promise for the declared fixed structures and worst inventory index; it does not execute the full ordinary trace or demonstrate all future request metadata fits. Each actual reserve checks its full serialized metadata promise before original ledger reserve.

| Quantity | Bytes or records |
| --- | ---: |
| Signed plan | 30,954 B |
| Ordinary assignment packet | 38,372 B |
| Exact initial source inventory | 11 artifacts / 40,279 B |
| Mandatory capture pool | 854,228,992 B |
| Draft pool | 9,437,184 B |
| Protected response pool | 2,097,152 B |
| Metadata reservation | 91,193,344 B |
| Failure pool | 65,536 B |
| Total retained reservation | 957,022,208 B |
| Mandatory artifact slots | 13,415 |
| Envelope record promise | 17,066 |
| Maximum original requests | 512 |
| Mandatory proof reserve, 202 ×65,536 | 13,238,272 B |
| Remaining optional proof bytes | 3,538,944 B |

Exact canonical fixed metadata templates measure B5,768,105 / final6,596,227 / owner7,645,765 / aggregate25,778,202 bytes. With the maximum inventory index, they measure B5,826,857 / final6,654,979 / owner7,704,517 / aggregate26,013,210 bytes. The aggregate explicitly includes two B copies, final and owner. Derived terminal raw/owner/disposition marker bounds are2701/4332/1906 bytes. Earlier measurements before mandatory-proof protection were incomplete reservation evidence and are not promoted to a full-trace claim.

## Focused checks and preserved failure history

Pinned Node is `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`; npm check uses this directory prefixed to PATH. No worker/provider or native command is launched by the mock tests.

The new16-case file passes16/16 with no skips in `/tmp/cp2-r-pages-final.log` (22.008 s), and passes again within the broader source join. It covers full-plan preclaim negatives, complete reassembly/original mapping, all-role initial admission, historical suffix and actual nested runtime guards, uncommitted withdrawal rollback, semantic-reader detachment/reentry, mandatory proof pressure, candidate/control physical entries, late response after failure/withdrawal, marker persistence failure/reopen, B publication race, plan immutability and global-original exhaustion. Small guard measurements are about14–15ms; observed peakRSS150,920KiB. These small fixtures do not qualify the full target250ms/hard1s guard,5s cut or2GiB workload limits.

Historical authored failures remain in `/tmp/cp2-r-pages.log` (5/6: a genuine callback-error/source-corruption misclassification, fixed with a private callback-error discriminator), `/tmp/cp2-r-pages-third.log` (9/11: two fixture expectation mistakes) and `/tmp/cp2-r-pages-fourth.log` (12/13: a fixture incorrectly expected detached mutable rows to be frozen). The expectation corrections preserve required detachment and accounting behavior. No failed raw bytes, original charges or consumed claims are reset.

Strict exact source check passes: `PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH npm run check`, log `/tmp/cp2-r-strict-joined.log`, exit0. `git diff --check` passes.

The first nine-file invocation omitted `--experimental-test-module-mocks`: `node --test --test-concurrency=1 acquisition-plan.test.ts acquire.test.ts acquire-review.test.ts acquisition-retention.test.ts acquisition-pages.test.ts model-review.test.ts model-review-audit.test.ts review-envelope.test.ts review-envelope-review.test.ts` (all paths under evaluations/development). Its receipt `/tmp/cp2-r-joined.log` is247total/187pass/9fail/51skip/0cancel,113.979s. Eight failures are inherited v1 full-snapshot ceilings. The ninth is the audit file's deliberate load-time module-mock assertion;51 authored model cases deliberately skipped without that flag. There is no test-name filter, resolver overlay or worker launch. Only the two affected model files are rerun with the required flag; their final receipt follows below.

The eight actually executed inherited acquisition failures, unchanged, are:

1. Independent R4 arithmetic review: admitted physical promise preserves pending response and B/T/final after optional metadata pressure.
2. Admitted small metadata pool stops optional bytes before pending intent and still closes complete B and final inventory.
3. One immutable negative B retains actual source capture without fabricated development boundaries.
4. Manual original cancellation before B is retained as unavailable and never false cancellation anchor.
5. Manual cancellation during T retains no false C while real late response can still settle.
6. B indexes complete durable inventory including an aborted draft and actual source snapshots.
7. T indexes rejected reviewer drafts and retained B bytes once without overlapping B index.
8. Real candidate and control assignments share opportunity ID with distinct one-use deliveries and actual captures.

These all encounter the unchanged old full-snapshot ceiling (including the cancellation expectation preempted by that ceiling). They are real component-join incompatibilities, not green waived tests. Root owns independent fixture rebasing to a newly signed feasible v2 plan while preserving these exact old-plan refusals and behavioral predicates. Author fixture replacement likewise requires a declared follow-up task; this handoff does not silently raise any cap.

Corrected affected-file invocation: `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --experimental-test-module-mocks --test --test-concurrency=1 evaluations/development/model-review.test.ts evaluations/development/model-review-audit.test.ts`, log `/tmp/cp2-r-model-joined.log`, exit1. It executes84 cases:78pass/6fail/0skip/0cancel,105.113s. The six failures all retain the unchanged full-snapshot error:

1. Independent actual recorder join derives both judgments and complete reads from original bytes.
2. Completed read metadata survives invalid later judgment and interrupted claim replay.
3. Actual compaction preserves purpose and refuses summarized B as final evidence.
4. Finite model plan stops further physical work and prevents replay.
5. Re-review caller aliases across awaited provider callback preserve exact host sessions trust and recorder closure.
6. Actual finite recorder callbacks and unchanged final envelope join (tool:true).

The first five are independent audit fixtures; root owns their explicit newly signed v2 fixture rebase with original behavior assertions unchanged. The sixth is an authored fixture needing the same declared follow-up. Across the seven actually completed non-model files (195cases/187pass/8fail) and the corrected two model files (84/78/6), unique executed coverage is279cases/265pass/14fail/0skip. This is assembled from two receipts, not misreported as one all-green suite. All14 inherited failures remain tracked for actual feasible-profile joins; no assertion, grant or old bound is relaxed here.

## Remaining composition and qualification gates

Fresh joined CP2/JR3 review is pending. CP3 may import exact clean reader source to join actual observer projection; no observer code is owned here. P1 helper alias repair and P2 actual bounded model-input/read/reservation composition remain separate: old full-B model input honestly refuses large inputs, and the proof/adaptation pools must be debited explicitly. V2 committed withdrawal provenance diagnostics remain unavailable because the accepted page API has no suitable diagnostic cut; terminal source:null is conservative and existing v1 depth-zero diagnostics remain unchanged.

No full126 ordinary application trace, OD1/DC2 producer/checker/feedback protocol, full benchmark, process/context/boundary qualification, provider execution, product admission or H1 approval is claimed. All caller judgments remain external, and the mechanical recorder alone is not actual acquisition. Exact actual Store handle and immutable journal association remain required; filesystem path identity is not an opened-FD proof. Current-use fences retain the accepted trusted single-host scope, not an all-process lock-order claim. A deferred provider/receiver start still requires its own immediate trusted guard; no source transaction is awaited.
