# Complete bounded page capture for ordinary developmental sources

2026-10-12. **Specified; proposed for root adoption; no source implementation or capacity pass claimed.** A1-L08/L09, requirements RW08–RW10, RW16, RW18–RW21. Owner `/root/a1_capture_capacity_design`; root claim `3b7a288`; branch `codex/a1-capture-capacity-design-20261012`, worktree `/home/palimpsest/migration/aeon-1-20261011/capture-capacity-design`, base `925c8ccf10861f12a7e0f3a2ff5396aa004d16ea`. Exclusive writes: this new document. All source, tests, earlier evidence and central plans are read-only. An actual finite tool goal preceded investigation.

```text
/goal Complete A1-L08-CP0 by deciding the smallest complete capture repair for the measured ordinary application limit, freezing its interfaces, retention arithmetic, causal checks and exclusive implementation handoff, then committing the design without changing source, limits or the preserved red predicates.
```

## Decision and demonstrated need

Keep `captureDevelopmentSnapshot` unchanged and intentionally bounded. Add a separate **complete paged acquisition** path on the existing OperationalStore connection, consumed by the existing recorder and QualificationStore. Each capture inventories the full physical document/event tables at one transaction cut. Retain bounded immutable pages and a small capture manifest; identical page bytes can reuse an already inventoried artifact. Do **not** initially add a mutable delta log, a candidate-selected cursor, persistent capture sessions in application state, a second database or a new workflow framework. The filename reflects the original inquiry; incremental byte reuse is an optimization, while complete pages are the chosen correctness mechanism.

The [root capacity inquiry](../A1-L09/development-snapshot-capacity.md) records original probe `109cf58`, unchanged diagnostic refinement `a11b21a`, and handback `5be9663`. Read-only inspection used those exact revisions. Twelve separate ordinary ingress conversations, with bootstrap disabled and zero physical requests, reach 546 combined physical rows and 1,668,758 conservative preallocation bytes. Admission eight first refuses at 370 rows/1,127,064 bytes; seven passes at 326/991,816. Twelve revisions of one message pass at 282/969,488. Existing ceilings are 512 combined rows and 1,048,576 bytes. Conservative allocation bytes are not serialized retained bytes.

Tighter serialization or a less pessimistic byte query cannot make **546 physical rows** fit the unchanged 512-row API. Excluding payload/head rows would hide its resource cost; projecting only current documents would lose intermediate values and complete global event provenance. A separate page API is therefore necessary for this measured case. It removes the one-materialization obstacle without asserting that the entire longitudinal workload fits the original allowance. The old all-twelve-full-captures predicate stays red in its isolated branch; the new adapter gets a separate must-succeed predicate under a demonstrably feasible, preregistered synthetic envelope.

Reuse is specific: SQLite already supplies the actual transaction and ordered primary keys; journal v2 already supplies immutable event identities, before/after refs and withdrawal dispositions; QualificationStore already supplies exact content-addressed originals; recorder already owns one-use claims, pending raw writes and bounded inventory. Extend those surfaces. Compression, a generic streaming framework, a CDC service or another agent shell supplies none of the missing source/authority checks and is not justified. No external dependency research or network operation was needed for this local fit decision.

## Exact proposed storage and capture wire

The source author must freeze the implementation checkpoint against these names/types before code. All integers are safe nonnegative integers unless noted; all encoded objects are exact-field canonical JSON. `ArtifactRef`, `AcquisitionClock`, `DocumentJournalBinding`, `JournalRef`, `JournalPayload`, `Document` and `StoredEvent` reuse existing definitions. This is a new accepted plan/capture format, not a silent reinterpretation of a previously claimed v1 plan.

```ts
type PhysicalDocumentRow = {
  namespace: string; key: string; revision: number; value: JsonValue;
};
type SourcePage =
  | { schema: 'aeon.development.source-page.v1'; table: 'documents';
      rows: PhysicalDocumentRow[] }
  | { schema: 'aeon.development.source-page.v1'; table: 'events';
      rows: StoredEvent[] };
type SourcePageDescriptor = {
  table: 'documents' | 'events'; artifact: ArtifactRef;
  rows: number; bytes: number; conservativeBytes: number;
};
type PageCaptureBounds = {
  maxPageRows: number;              // positive, <= 512
  maxPageBytes: number;             // positive, <= min(1_048_576, maxArtifactBytes)
  maxPages: number;                 // total document + event pages per capture
  maxPhysicalRows: number;          // <= maxPages * maxPageRows
  maxConservativeBytes: number;     // <= maxPages * maxPageBytes
  maxSerializedBytes: number;       // aggregate actual page bytes per capture
};
type SourceCut = {
  journalBinding: DocumentJournalBinding;
  documents: number; events: number; lastSequence: number;
  physicalRows: number; conservativeBytes: number; serializedBytes: number;
  pages: SourcePageDescriptor[];
  documentsDigest: string;          // streaming canonical row-chain commitment
  eventsDigest: string;             // streaming complete global prefix commitment
};

// New trusted OperationalStore method; one synchronous transaction, actual db handle.
captureDevelopmentPages(
  bounds: PageCaptureBounds,
  retainPage: (bytes: Uint8Array) => ArtifactRef,
  retainArtifact: (original: ArtifactRef, bytes: Uint8Array) => ArtifactRef,
): SourceCut;

type PagedSourceCapture = {
  schema: 'aeon.development.source-capture.v1';
  planDigest: string; roleId: string; configurationDigest: string;
  source: { journalDigest: string; pathIdentity: { device: string; inode: string } };
  beforeClock: AcquisitionClock; afterClock: AcquisitionClock;
  priorCapture: ArtifactRef | null;
  priorPrefix: { lastSequence: number; digest: string } | null;
  historyStart: { kind: 'anchor'; id: string; sequence: number; digest: string };
  cut: SourceCut;
  operationalArtifacts: { original: ArtifactRef; retained: ArtifactRef; bytes: number }[];
};
```

The synchronous retention callbacks are trusted recorder closures, not model tools or supplied proof. They must return the SHA-256 ref of the exact bytes handed over. Storage cannot accept a callback's claimed count or changed digest. The public recorder `captureApplication` can continue returning an `ArtifactRef`, now referencing a manifest for the newly accepted paged plan. Existing full-snapshot plans retain their explicit format/refusal; no fallback after a capture fails. A changed signed plan cannot reuse a consumed claim or grant.

A document page contains **every physical document row**, including binding, payload and head namespaces. These rows are not copied again into separate hydrated arrays. Document ordering is SQLite BINARY ordering of `(namespace,key)`, matching UTF-8 byte comparison, never locale comparison. Event ordering is numeric sequence. All document pages precede event pages; neither table has empty pages. Descriptor order supplies page position, so page bytes have no clock, capture ID, ordinal or source role that unnecessarily defeats exact reuse. The manifest binds their position and provenance. Identical bytes from different roles do not imply equal authority: keep every role-to-capture/page association even if one digest occupies one raw inventory entry.

Define row chains explicitly: `H0 = sha256(UTF8('aeon.development.rows.v1:' + table))`; `Hi = sha256(UTF8(canonicalJson([H(i-1), row])))`. `documentsDigest` is the final document chain; `eventsDigest` is the final event chain starting at global sequence 1. At the prior capture's sequence, the newly computed event chain must equal its retained digest. This is complete replay/checking of the old prefix, not trusting a previous validator cache. Digests commit to exact ordered canonical row values, independent of page boundaries. Missing/duplicate/reordered rows, repeated event IDs, noncanonical fields or bytes and any unexpected reserved namespace reject.

`SourceCut.events === lastSequence === sqlite_sequence.events`; min/max/count must establish an empty prefix or exactly 1 through lastSequence. Validate the actual binding and anchor; compare complete raw event rows against the prior capture through its cut. A chain comparison is the compact integrity check, backed by available original pages, not permission to discard them. Scalar counts/totals in the manifest must agree with all decoded pages. The manifest includes its own exact page counts/bytes, but its encoded bytes are additional retained bytes; neither a page descriptor nor a digest makes a raw artifact free.

## Transaction, descriptor and bounded materialization

Use the actual application's `OperationalStore` and its existing synchronous `BEGIN IMMEDIATE` transaction. Do not open another connection using a filename to obtain pages. Validate candidate/control/bridge/original-ledger object association before starting, retain that actual handle for the transaction, and fence source mutation/reentrant capture while it is active. The trusted sink writes only the separate recorder state and raw evidence store; it cannot write to the source, await, invoke application work or call the model. Returning a Promise rejects. Source writes from other supported handles cannot interleave with the cut. A long scan is finite and charged to elapsed attempt time; it does not stop clocks or extend a deadline.

The `pathIdentity` field keeps the existing before/after path-substitution check and plan diagnostics. **It is not a descriptor identity attestation.** Source bytes, binding and operational artifacts come from the pinned actual Store connection, which remains authoritative even if the pathname is renamed. Path replacement causes recorder admission failure; the recorder must never switch to the new file. Reopen must re-establish the actual application/bridge/ledger association and durable binding/prefix before accepting new source. Identical path strings or copied binding metadata alone cannot establish association.

Before selecting any payload values into JavaScript, run scalar SQL preflight within that transaction: physical document/event counts, event high-water/min/max, storage-type validity, total conservative bytes and maximum single-row bound. Include all internal namespaces. Do not call current unbounded `documentRows()`, `events()` or `validateJournalSnapshot()` to implement a purported bounded page reader. The current validator's semantics must be retained with bounded page iteration, not its full-array allocation.

Use keyset reads on the ordered primary keys. For each page, find the largest positive prefix of at most `maxPageRows` whose aggregate conservative cost fits `maxPageBytes`, using scalar aggregate queries over an ordered bounded subquery; only then select those values. Include the exact page wrapper and array punctuation before materialization. Keep the existing conservative row costs: documents `6*(UTF8(namespace)+UTF8(key)+UTF8(valueText))+256`; events `6*(UTF8(id)+UTF8(stream)+UTF8(type)+UTF8(dataText))+256`. Add a checked page-header allowance at least 512 bytes; reject if its canonical form exceeds that allowance. Aggregate `conservativeBytes` includes every page header. Binding is already a physical row; any separately materialized binding/manifest copy receives its own bound. Select no oversized single row: this design does not chunk a single document, event or operational artifact across artifacts.

Check aggregate rows/conservative bytes against the signed `PageCaptureBounds` and page count before reading values. Preflight can conservatively reserve extra page-header overhead using `maxPages`. Recheck each page's actual encoded bytes, cumulative bytes and page count before retention. Metadata-only SQL does not authorize unbounded JavaScript arrays of keys. Scalar preflight and bounded keyset queries must preserve integer/type checks, including malformed BLOB/UTF-8 adversarial fixtures.

Working memory is finite: one source page at a time, its encoded buffer, a bounded descriptor list, and a graph index bounded by the signed maximum physical rows and serialized bytes. Explicitly budget graph-index and recorder-state serialization overhead in the implementation checkpoint; do not claim that a serialized byte ceiling measures JavaScript heap bytes. The observer replays with bounded reads and indexed refs; it must not concatenate all retained pages into an unbounded `DevelopmentSnapshot`. Re-reading retained pages is permitted with a finite per-call scan bound fixed by the manifest; nested scans cannot evade elapsed-time bounds. Reject limits whose arithmetic overflows safe integers.

Every `aeon:artifact` reference reached in current rows, available journal values or events is resolved using the existing bounded `store.readArtifact` on this same descriptor/transaction, hash-verified and retained as exact SHA-256 bytes through the recorder. Inventory the original-to-retained mapping in the manifest. A `sha256:` reference must already have an authorized, readable original in the inventory or be explicitly retained; its URI is not evidence of availability. Missing references stop capture. No lookup by namespace/key or similar content substitutes for exact artifact/version identity. Bounds for these referenced artifacts are additional to page bytes and are preregistered below.

## Complete current state, payload and withdrawal semantics

Replay the global structural stream, not just journal events. Validate v2 journal events in that stream against the fixed binding. Anchor refs introduce exact version IDs; mutations consume the exact prior ref and introduce the correct next revision or deletion; withdrawal markers name the exact already-created version set for their target keys and cutoff. Every introduced version has exactly one matching physical payload row, every head matches the replayed current ref, and current application rows match those refs' revisions/digests. Reject orphan heads/payloads, missing/displaced anchor, unexpected internals, event gaps, delete/recreate ID reuse, forged withdrawal markers and payload commitment mismatch. Retain nonjournal events, including scheduler/input/accounting events, unchanged.

`resolveJournalVersion(versionId)` returns the exact available version or a typed unavailable disposition. A withdrawn version never resolves from an earlier retained copy, a later same-key value or an equal digest. Missing without a validated withdrawal is `document-history-corrupt-or-missing`. Valid withdrawal needed by the active full-history attempt is `document-history-withdrawn`: retain available bounded structural evidence and stop unavailable, with no passing partial B. Physical inventory and current logical document inventory are distinct: neither omits internal cost, and the binding row is excluded only when comparing the application-state replay.

Source scans check the **current** disposition of all referenced versions on every complete cut. Pages from earlier captures can be reused only when their exact bytes match that cut; an old available payload page cannot stand in for today's withdrawn row. A complete current-state observation and the later authorized use of historical evidence are different operations. Neither a cached pass nor a caller-selected current ref proves that historical values remain usable.

### Preserved root integration finding and corrected freshness contract

Root found this issue in proposed revision `d64566dd31d366de1d9e4f9bb33532e04ca3ee0b` before adoption: its every-reader exact-global-high-water fence would invalidate B during ordinary reviewer bookkeeping. `DevelopmentAccounting.freezeBehavior()` writes `development.accounting.freeze` into the candidate original Store; `reserve`, `dispatched`, `transition`, `recordResponse`, `recordTransport`, `trustedEffect` and `settle` subsequently write request/latest/outcome rows and append physical transitions there for reviewers too. The old proposal also could not call bridge freeze inside a source fence that rejects reentrant writes. These are observed source relationships, not a newly executed failure. The earlier design commit remains preserved; the corrected contract below supersedes only its overbroad reader fence. No runtime repair or acceptance is claimed.

Keep `withDevelopmentSourceCut({ journalDigest, lastSequence }, use)` **only for establishing a complete current cut at observation admission and initial B publication**. On the actual Store, its synchronous transaction verifies binding and scalar global count/high-water equal the named complete cut, then invokes the trusted read-only use callback while supported source writers are excluded. Reject reentrant source writes/asynchronous results. A changed cut before that admission needs another already-reserved complete capture or an unavailable outcome. It cannot be called around bridge freeze, nor used as the post-B read condition.

Add this smaller source-bound historical-use operation, without a new journal field, withdrawal epoch or mutable cache:

```ts
type HistoricalSourceUse = {
  journalDigest: string;
  prefix: { lastSequence: number; eventsDigest: string };
  requiredVersions: JournalRef[];
  maxPageRows: number; maxPageBytes: number; maxPrefixBytes: number;
  maxVersions: number; maxVersionBytes: number; maxWithdrawalMarkerBytes: number;
};
type SourceUseObservation = {
  journalDigest: string; prefixSequence: number; prefixDigest: string;
  observedLastSequence: number; requiredVersionsDigest: string; checkedVersions: number;
};
// Host-only, actual Store transaction; successful result exists only for this call.
withDevelopmentVersionsAvailable<T>(
  input: HistoricalSourceUse,
  use: (observation: SourceUseObservation) => T,
): T;
```

The recorder derives the input from independently validated retained manifests/graphs and the accepted attempt; a caller cannot supply a smaller ref list. A private bounded manifest loader under owner/custodian authority establishes this scope without recursively invoking the public evidence-read gate; it is not exposed to a reviewer or source callback as an alternate ungated reader. `requiredVersions` is ordered by exact version ID with duplicate/conflicting identities rejected. Before B, it covers the union of every required version in all accepted captures for each behavioral role. At B, freeze that complete per-role set and its digest, alongside the final role capture ref and prefix. Earlier captures and intermediate deleted/replaced versions remain in scope, even when the requested read only mentions a current document. For the active full-history attempt, a required withdrawal in **any** participating behavioral role ends attempt usability, not merely that role's next read. A future JR5 plan may define a separately accepted checkpoint-forward required-value set; this task cannot invent one. Scope entries/index bytes fit the existing signed capture/owner metadata reserve and reuse retained graph refs; they create no new allowance.

The operation runs on the pinned source connection in one synchronous transaction and performs these checks before `use`. Its positive safe-integer page/prefix/version limits come from the accepted capture scopes; `maxPrefixBytes` covers the retained event prefix and `maxWithdrawalMarkerBytes <= maxPageBytes` bounds a single later marker. Run scalar size/type/count checks for the prefix, each payload and any marker before selecting their values; enforce aggregate prefix/version bytes and fail if changed data exceeds its accepted bounds:

1. Validate the immutable binding and source association. Require the current global prefix high-water/count to be at least the retained cut, but **do not require equality**. Reread global events 1 through that cut with the already specified bounded page queries and recompute the exact prefix digest. This preserves old complete-prefix integrity without materializing or retaining the growing post-cut bookkeeping suffix. All later complete captures still inventory the entire suffix. Revalidating the retained pages alone is insufficient to detect a changed live historical prefix.
2. For **every exact required version ID**, preflight its physical payload-row byte/type bound, then read that one bounded row on this connection. Require its ref to equal all fields of the captured ref. An available row must have revision 1, exact v2 available shape and a document digest matching the ref. A withdrawn row must have revision 2 and a matching protected withdrawal marker (binding, withdrawal ID, exact ref membership and bounded schema); it stops unavailable. Missing, malformed or unverifiable row/marker also stops unavailable, never permits old bytes. A marker too large for the fixed read bound is unavailable. No current head, same-key row, equal digest or earlier raw page substitutes for the exact version. `maxVersions`/`maxVersionBytes` are derived from the already accepted scope and its captured row bytes, with the explicit bounded withdrawal-marker diagnostic headroom; enforce both before materialization. No query scans all newly created post-B versions.
3. Construct `SourceUseObservation` from the actual transaction, including its observed current high-water and exact scope digest. Invoke the trusted synchronous use callback under that same transaction. Reject source writes, reentrant acquisition and Promise results. The observation is a call-local withdrawal/identity check, not a generic freshness certificate, new complete capture or assertion that current application state equals B. It cannot be replayed to authorize a later call.

A newer event or document revision therefore does not revoke an older available version. A legitimate later withdrawal changes its protected payload disposition and blocks that version immediately at the next active use. No new mutable withdrawal counter or filtered replacement for the complete global history is needed. The threat boundary remains accepted Store writers and immutable protected journal identities; arbitrary malicious SQL/host code is outside that authority model, while the bounded prefix/payload checks still reject the specified corruption cases. A matching current row with an absent historical version is never accepted.

For a multi-role read/admission, acquire source fences in signed role order, then the local recorder/custodian admission transaction; verify **all** required role scopes and current JR2 attempt-use disposition before yielding any bytes or admitting a result. Release in reverse order. Capture-intent writes finish before a source fence. Do not acquire source locks while retaining a recorder write lock in another path. Source forgetting never waits for a remote custodian callback; unavailable local authority or source/lock failure refuses the read. No cached role pass survives into another call. The host-mediated read checks original live/grant admission separately as already required; this historical-use operation grants no request authority.

### Exact bridge freeze, final capture and B order

1. Validate actual candidate/control bridges and source handles, original accounting/quiescence rules, remaining final-capture/metadata capacity and current attempt-use authority. Persist recorder `freezing` intent. The recorder phase fences all new behavioral and reviewer reservation callbacks during this transition, including the interval after the bridge marker exists but B does not. Outstanding/unknown work retains the existing explicit failure/settlement rules; this step cannot call it complete.
2. Call the original bridge `freezeBehavior()` **outside** any read-only source-use fence and let its ordinary source transaction commit `development.accounting.freeze`. Preserve its returned stopping time/state digest/cancellation state and the durable one-use marker. It is called once for the shared original grant, not once per control. This write remains journaled and cannot be rolled back merely because a later capture fails.
3. Take the reserved final complete page capture for each actual behavioral role in signed order, including the candidate freeze-marker mutation. These remain distinct role/clock cuts, not a claimed simultaneous multi-store snapshot. Retain pages/manifests and derive complete required-version sets. Reviewer dispatch remains disabled by the recorder phase. Build request/end observations from actual bridge records as before; those recorder writes finish outside the final source fences.
4. Acquire each final role's `withDevelopmentSourceCut` fence in signed role order. Require those complete cuts still current, revalidate their full graph/required dispositions, then enter the local recorder/custodian admission transaction. Verify current JR2 use permission, binding, actual original request states/transitions and all freeze predicates. If a source advanced before this point, only another already-reserved final capture may establish a new cut; otherwise freeze fails unavailable. Never omit the intervening rows or call the bridge freeze again. After these fences are held, perform only source reads and separate recorder/raw writes; do not call bridge freeze, reserve, dispatch or settle there.
5. Derive, sign, retain and publish immutable B, its exact final capture/scope refs and complete inventory under the existing pending-write/metadata protocol; set recorder phase `reviewing` only after B is durably published. Release fences. A crash between the bridge marker and B publication leaves the existing consumed `freezing` failure, no reviewer bypass or fabricated B.
6. Reviewer request reservation, dispatch, `evidence_read`, result retention and settlement now legitimately mutate original candidate accounting. They extend the already bounded accounting T; they **do not** trigger behavioral recapture, change B's cut or re-sign B. Each historical source/raw evidence release and each later review/envelope admission uses `withDevelopmentVersionsAvailable` for the frozen multi-role scopes plus current JR2 disposition. T still verifies its immutable B transition prefix and original charges. New post-B activity is not claimed as B behavior or as a complete post-B source snapshot.

For `evidence_read`, retain/capture its request and perform original reservation/dispatch bookkeeping before the short read-only source-use gate. Resolve/authorize the requested retained bytes inside that gate, then release it before response/outcome/settlement bookkeeping. An async receiver must use a synchronous guarded read inside its async operation; it must not hold the source transaction over an await or attempt original-store accounting writes inside the callback. A new model dispatch using fetched evidence and a subsequent judgment/admission each recheck current usability; a past read check is not a reusable permit. Bytes already returned under valid authority cannot be recalled or zeroed by this API, as in JR2. A late withdrawal stops future use/admission and the active attempt even if a prior read succeeded, preserving B/T and consumed charges.

The [adopted JR1/JR2 contract](../A1-L04-journal-retention-design.md) remains prerequisite. Independent evidence retention requires an accepted custodian grant for the exact source/attempt, data scope, purpose, audiences and retention/disposition policy; synthetic fixtures are the other supported path. Plans requiring revocable raw retention, deletion on memory forget or timed destruction remain unsupported by the current immutable raw store. Pages do not turn it into an operational memory cache or supply missing destruction authority. Current authenticated attempt-use withdrawal is terminal and consulted by every reader, cached projection and downstream envelope admission; stale exported B/T cannot establish current eligibility.

JR5 remains separately specified and unimplemented. Its future exact checkpoint wire may extend `historyStart` only under a **new independently accepted** plan with a named checkpoint ID/sequence/digest. Full old structural history, old failed-attempt provenance and all physical inventory still remain present. Only the explicitly authorized checkpoint-forward values may then be claimed complete. Current surviving values may get new refs by the checkpoint transaction; erased past values are not reconstructed. No present `afterSequence` parameter lets a candidate choose a cutoff, and page boundaries are not observation-window boundaries. Continuing state, old consumption and prior failed attempts are never rolled back to create room.

## Original bounded inventory and arithmetic

Keep the original limits absolute: **512 attempt evidence records, 1,000,000 bytes per raw artifact and 8,388,608 retained evidence bytes**, or any smaller accepted manifest limits. The current full API still has its separate 512 physical-row/1,048,576 conservative-byte limit. The new per-page bound is explicitly different; it does not reinterpret the old API. Nested source rows were not the recorder's attempt-record accounting unit: complete manifests/pages must now each consume raw artifact slots in that existing formula. Internal rows still consume declared page rows/bytes and validation work.

For the new plan version, keep existing `maxSnapshots` as the finite number of complete capture manifests and replace its one-snapshot-byte assumption with an exact `captureLayout`:

```ts
captureLayout: {
  kind: 'complete-pages-v1';
  page: PageCaptureBounds;
  maxManifestBytes: number;
  maxReferencedArtifacts: number;      // per capture, worst case newly retained
  maxReferencedArtifactBytes: number;  // aggregate per capture
  maxCaptureIndexBytes: number;        // recorder claim entry incl clock/ref associations
};
```

The signed plan must contain finite positive bounds and demonstrate mandatory assignment/final captures plus all promised ordinary before/after samples fit. Let `S=maxSnapshots`, `P=page.maxPages`, `V=page.maxSerializedBytes`, `C=maxManifestBytes`, `X=maxReferencedArtifacts`, `Y=maxReferencedArtifactBytes`, `K=maxArtifacts`, `N=maxRequests`, `O=maxObservations`, `A0/sourceBytes` be distinct preregistered source artifacts/bytes, and `q=observationBytes`. No worst-case reservation may assume hash reuse or repeated equal pages.

Required capture reserve is `sourceBytes + S*(V+C+Y) + mandatoryObservations*q`. Require it within the unchanged `capacity.captureBytes`. All raw pages, manifests, referenced source artifacts, observations and failed partial captures debit that pool. Per-page `maxPageBytes` and actual bytes, every manifest, and each referenced artifact are also <= `maxArtifactBytes`. Do not reserve `P*maxPageBytes` when the separately enforced aggregate `V` is smaller; both bounds apply independently. Likewise `Y` is an aggregate bound, with separate per-artifact checking.

Required raw slots are at least `A0 + S*(P+1+X) + mandatoryObservations + N + 3`, plus any additional mandatory raw objects introduced by the final implementation. The last existing three slots cover its two metadata artifacts and failure record; JR2's claim-resident withdrawal marker still needs separately protected metadata bytes. Preserve the existing complete attempt-record formula:

```text
R = maxObservations + originalRequests.length + 6*N + K + reviewers.length <= 512
D = sum(role.maxDrafts*(maxPayloadBytes + maxPromptBytes + maxFragmentBytes))
E = sum(role.maxDrafts*maxResponseBytes)
M = envelopeBytes + 5*N*transitionBytes + K*inventoryEntryBytes
T = D + E + M + captureBytes + failureBytes <= 8,388,608
```

`T` must also fit actual original raw-store capacity and the accepted manifest's smaller ceiling. Original physical requests/charges, five-transition reserve, unresolved response allowances and grant elapsed time remain unchanged. Pages cannot borrow protected response, final-capture, failure or terminal-withdrawal headroom. Within `M`, prove bounded signed B/T/envelope bytes, full owner claim serialization, capture/role/page associations, pending intents, delivery/observation/reservation entries and terminal markers fit simultaneously. Specifically reserve `S*maxCaptureIndexBytes` and full worst-case raw inventory metadata; a flat page ref in B does not remove its owner-state copy. Include the recorder owner's accepted R4 signed-B metadata repair; this proposal cannot supersede it.

The implementation must preserve the existing pending-write recovery accounting and make it exact for pages: persist the next artifact digest, actual bytes, pool, role and slot before writing raw bytes; complete its inventory entry before selecting/retaining another page. A manifest ref is appended as a successful capture only after all pages, operational references and validation succeed. The capture-in-progress owner marker is itself reserved metadata. A write interrupted at any point is charged conservatively against the **same** finite allowance. Reopen accounts any possibly written artifact, preserves earlier pages and records terminal unavailable rather than replaying the capture as a fresh uncharged attempt.

B includes every raw original retained through behavior freeze, including unrelated/intervening source rows, failed drafts, rejected work and any completed partial-page retention. T extends that inventory for reviewer work/late reserved responses after B without replacing B. Manifests/pages must be discoverable in the exact complete B/T inventory, not merely transitively referenced while omitted from inventory count/bytes. Signed B itself, accounting tail/envelope metadata and immutable claim copies retain their existing charged treatment. A stopped attempt may lack a valid B: its durable failure inventory still retains every attempted original and consumed charge. Hash reuse is allowed only after verified exact bytes already exist in that attempt's inventory; keep all reference associations. Sorted random version IDs can shift page boundaries, so expected deduplication is **not** a feasibility guarantee.

No numeric feasible full-development allocation is asserted here. The existing probe measures conservative database bytes, not page/manifests, prompts, responses, reviewer work or metadata. Before claim, the author must produce a concrete plan whose worst-case equations pass under the same limits, then freeze it before the new causal twelve-admission run. If required mandatory captures cannot fit that plan, report infeasible; do not shrink obligations after seeing a failure. A smaller diagnostic adapter fixture is not qualification of three W intervals, multiple controls, feedback, interference or reviews.

## Interruption, reopen and consumer adaptation

Capture begins with a durable recorder capture-intent tied to plan, role and previous successful capture. No source checkpoint or binding changes. Crash before/within read transaction leaves ordinary operational state unchanged; any independently retained pages remain inventory. Crash after pages but before manifest/claim commit leaves an explicitly incomplete capture, not usable source. Crash after successful claim publication retains the immutable manifest and all exact refs. Pending or incomplete capture causes a terminal unavailable disposition on reopen, with idempotent failure/withdrawal bookkeeping and protected late-response retention. Do not retry a consumed acquisition, discard partial artifacts, reset a grant, create new clock anchors or turn a process restart into qualified elapsed observation.

After successful reopen, revalidate exact inventory, plan/custodian disposition, binding and actual object associations. Existing host clock/process continuity restrictions still apply; authorized source reopen alone does not qualify a changed process/boot. A new capture scans the full current prefix and dispositions again. Any late memory withdrawal detected before downstream use stops the active attempt; current attempt-use withdrawal also fences already frozen B and T at their admission boundary. Neither operation deletes old raw originals. Failure to read the current authenticated custodian disposition is unavailable, never a cached pass.

OD1 keeps actual ordinary applications, original-ledger identity, registered ingress and asynchronous scheduling. Its before/after captures become manifest refs; no awaited tick is relabeled quiescence or a completed cycle. Reserve mandatory assignment/final pages before optional sampling, and refuse an additional sample that consumes protected capacity. OD2 needs an owner-validated reader, not arbitrary caller-asserted facts:

```ts
interface SourceCaptureReader {
  readonly manifest: PagedSourceCapture;
  forEachEvent(visit: (event: StoredEvent) => void): void;
  forEachCurrentDocument(visit: (row: PhysicalDocumentRow) => void): void;
  resolveJournalVersion(versionId: string): Extract<JournalPayload, { state: 'available' }>;
  assertUsableNow(): void; // call-local historical-version + custodian check; no reusable permit
}
// New recorder-owned entrypoint, only for inventoried accepted capture refs.
openAcquiredCapture(ref: ArtifactRef): SourceCaptureReader;
```

Opening validates the retained complete pages/graph; each actual iteration/version resolution or authorized raw-byte release then enters the multi-role historical-use/custodian gate above. `assertUsableNow` is diagnostic and never replaces those per-operation checks. The reader presents the captured state, not current application state; a newer accounting event alone does not invalidate it. Iteration retains finite scan limits. `forEachCurrentDocument` supplies application rows, explicitly excluding reserved internals after their separate full validation/accounting. `forEachEvent` supplies the entire historical global sequence, unfiltered. The reader's private graph indexes map exact intermediate `JournalRef.versionId` and event positions. It must refuse withdrawn/missing versions rather than substituting current content. Returned objects are detached; mutation does not alter the trusted source view. The observer cannot manufacture a reader or mark it fresh.

Direct coordination with `/root/a1_development_observer` confirms this fits its frozen intermediate-ref and event-position proof semantics. Its current implementation remains on full captures; it owns only its new module and is not authorized to change storage/recorder. Each cycle still binds **its own** before/after capture refs, lower/upper wall bounds and clock kind. “Current” means the trusted host's latest-known capture, not independent proof of freshness. Exact registered input/admitted-or-steering event/run/result-consumption links survive reused runs and multiple message revisions. Independent clock qualification, spontaneity, feedback meaning and learning/transfer judgment remain separate gates. JR2 integration belongs to the recorder owner after R4, not the observer or this design author.

## Frozen causal acceptance and finite source handoff

Root adopts this specification before source work. Do not merge the old failing probe as a passing full-snapshot test or weaken its predicate. Keep `109cf58`, `a11b21a` and `5be9663` as unchanged evidence of that API's supported limit. Proposed checks use tiny synthetic local SQLite/raw-store fixtures, strict compilation and narrowly joined existing checks only; no broad suite, provider, native, physical, account, network or live acquisition operation is authorized here.

1. **Measured workload:** freeze a concretely feasible synthetic signed plan under the equations above; run the same twelve separate admissions through the actual application and new recorder page adapter, retaining all prescribed cuts. Every complete page capture must succeed, with exact physical counts, current state, event prefix and zero requests/listeners. Confirm the old API still refuses at its measured limit in its preserved diagnostic. Keep the same-message revision control. Publish actual serialized page/manifests, unique retained bytes, no-dedup reserve, slots and owner/B/T metadata use. If feasibility or this causal predicate fails, preserve the failure and stop the claimed repair conclusion.
2. **Page boundaries and graph:** force multiple document/event pages; place mutations, deletion/recreation, a reused assignment run and the anchor across boundaries. Inject missing/duplicate/reordered pages or rows, changed old prefix, extra/orphan heads/payloads and hidden internal rows. Every corruption rejects; all intermediate versions and nonjournal events remain independently replayable to the exact current state.
3. **Allocation before read:** oversized singleton rows, escaped/non-ASCII keys/values, malformed storage types, page header overhead, aggregate row/page/byte overflow and unsafe integers refuse before unbounded values are selected. Separately exercise per-artifact and aggregate referenced-artifact overflow. Read one page at a time and instrument bounded SELECT/materialization paths; no call to the full-array helpers is allowed.
4. **Transactions and descriptors:** try a concurrent supported writer, reentrant mutation and async callback; prove no mixed cut. Replace/rename the source path and show no silent switch to another descriptor. Retain a source artifact from the actual open store. Wrong original-ledger/store/role/configuration/binding association rejects even with matching filenames or copied refs.
5. **Retention and stop:** exact page reuse preserves all capture associations; boundary churn does not earn a reservation discount. Interrupt before raw write, after raw write, before manifest, and before claim publication; reopen keeps pending/complete inventory and original charges, never a partially successful capture. Oversubscribe slots, aggregate bytes, signed-B/owner metadata and protected final/response reserves independently. B/T include all retained pages; late reserved responses remain charged and available after failure.
6. **Withdrawal and provenance:** forget/expire between two captures, after capture before projection, after a cached proof before freeze and after B during reviewer bookkeeping; compare exact intermediate refs and terminal current use. Forged/missing withdrawal markers reject as corruption; valid withdrawals stop unavailable and retain independently authorized originals. Stale exported B and reopened readers cannot bypass current attempt-use withdrawal. No custodian authority or incompatible raw-destruction policy refuses before private bytes are acquired.
7. **Ordinary frozen-B use:** freeze through the actual bridge, prove its source marker precedes final candidate capture and B, then perform mocked reviewer reservation/dispatch, an authorized `evidence_read` and settlement through actual bridge/ledger objects. Global high-water must advance while B bytes/digest, final cuts and behavioral capture count remain unchanged; reads and T closure still succeed. Exercise both an older replaced/deleted version and multiple behavioral roles. Withdraw a required old version in a different role after the first successful read; the next read, cached projection use, model-use admission and envelope admission all refuse without re-signing B. Current custodian withdrawal has the same effect. An unrelated newer version/event alone continues to permit the old available version. Missing/forged payload/marker and a changed live pre-B prefix reject; post-B suffix growth never becomes evidence of current application state. Inject a write between final capture and initial B publication: exact-cut admission fails or uses only reserved recapture. Instrument freeze/read callbacks to prove original accounting writes occur outside source read-only fences, and crash after bridge freeze before B to prove no repeat freeze or reviewer bypass.
8. **Consumer causality:** old untimed selections cannot acquire fresh W timestamps by rereading pages; each cycle's own brackets and source links remain required. Deferred ordinary ingress, same-run revisions and automatic work between samples remain visible. JR5 checkpoint/cursor use rejects until its separately accepted implementation and new plan exist.

| Task and routing | Exclusive proposed ownership and dependency | Finite result / parallel eligibility |
|---|---|---|
| A1-L08-CP1, source/storage author, `gpt-6.1-sol` / high | Root reserves narrow `packages/storage/index.ts`, new `packages/storage/test/development-pages.test.ts` and new storage-page evidence after current owner handoff. Read-only journal/retention tests. | Freeze exact bounded query/graph interfaces; implement complete descriptor-consistent page capture; return focused source/evidence. Can start after adoption while CP2 freezes plan fixtures. |
| A1-L08-CP2, existing recorder owner, `gpt-6.1-sol` / high | After its R4 and JR2 dependencies, exclusive `acquire.ts`, `acquisition-plan.ts`, their author tests and new page-recorder evidence, through root reservation. | New accepted layout, arithmetic, pending inventory and reader gate; adapt exact CP1 checkpoint and return a concrete feasible synthetic plan or retained infeasibility. No concurrent writer to recorder. |
| A1-L08-CP3, OD2/OD1 owners, `gpt-6.1-sol` / high | Each owns only its separately claimed observer/driver module/tests/evidence. CP1/CP2 interface fixtures can precede join; actual integration waits for exact source checkpoint. | Preserve full provenance/clock/ordinary-work rules using accepted manifest readers and bounded samples. Coordinate admission changes through recorder owner. |
| A1-L08-CP4, fresh reviewer, `gpt-6-astra` / high | New independent `evaluations/development/page-capture-review.test.ts` and review evidence only, exact joined CP1–CP3 source. Root retains original red diagnostic and integration ownership. | Freeze causal attacks before execution; inspect arithmetic and actual no-hidden-row closure; return bounded acceptance or reproducible repairs to authors. |

```text
/goal Complete A1-L08-CP1 under development-incremental-capture-design.md: implement complete bounded physical page capture on the actual Store connection, preserve the old full API and all v2 replay/withdrawal invariants, and hand off exact focused source for recorder integration and fresh review.

/goal Complete A1-L08-CP2 under development-incremental-capture-design.md after R4/JR2: implement the newly accepted paged plan, complete B/T inventory and current-use reader, prove original worst-case byte/record/metadata arithmetic with interruption/reopen, and hand off a concrete finite synthetic capacity result without qualification claims.

/goal Complete A1-L08-CP3 by adapting the exclusively owned OD1/OD2 modules to accepted manifest readers while preserving actual source association, exact intermediate refs and each cycle's own clock brackets, then hand off the exact joined causal evidence.

/goal Complete A1-L08-CP4 by independently testing the exact joined page-capture closure against its frozen twelve-admission and adversarial predicates, preserving failures and original limits, and returning an evidence-bound disposition to root.
```

Maximum useful parallelism is storage author plus recorder pre-code/fixture work plus independent observer/driver interface preparation, bounded by available slots and existing claims. Serialize source-contract freeze, recorder/shared-file mutations, final joined tests and root adoption. The reviewer may prepare independent cases before join but cannot accept a source it has not reviewed. No additional agent was needed for this single-file decision; active storage/recorder/observer work already provides independent ownership. Root alone assigns paths and updates central lane/plan status.

CP0 completion is a committed design and explicit handoff, not source acceptance. Root must adopt the exact document, reconcile CP1–CP3 reservations with current owners, and require a feasible preclaim plan plus CP4's exact-source disposition before declaring the new adapter solves the observed fixture. OD1's actual acquisition still waits for JR2 authority/current-use enforcement, accepted sensor/control implementations and separate live authorization. Ordinary full snapshots, arbitrary long histories, oversized single rows/artifacts and arbitrary workloads can still refuse honestly. No competence, privacy, autonomy, deployment, Aeon 2 or H1 gate changes.

## Design verification and limitations

Read-only inspection covered AGENTS/requirements/plan/workflow, L08/L09 ownership, accepted v2 storage, adopted retention design, ordinary driver specification, recorder/plan source at `53e8298` and root regression/refinement/handback revisions above. The recorder at that revision still replays v1 full document snapshots; this proposal does not label it v2-ready. Direct OD2 interface coordination confirmed compatibility and its freshness limits. Validation of this document is references, ownership, arithmetic/contract consistency and `git diff --check`; no test, build, source change or runtime operation was executed for CP0. Actual adapter capacity, graph-memory constants, complete R4/JR2 composition and consequential fresh review remain implementation gates.

### CP0 correction handoff

The first CP0 goal/design commit is preserved. Root's post-B bookkeeping finding initiated a **new finite correction goal**, with the same exclusive document ownership and no source/test/runtime writes.

```text
/goal Correct A1-L08-CP0's reader freshness contract by separating complete-cut admission from source-bound historical-version usability, fixing bridge-freeze/final-capture/B ordering and preserving late operational/custodian withdrawal, then commit the amended design for root adoption without executing an acquisition.
```

Additional read-only inspection covered `deployment/development-accounting.ts` freeze and request/transition/response/settlement paths, and recorder freeze/close ordering at `53e8298`. The correction adds exact role-scoped version checks and causal ordinary reviewer-read/late-withdrawal cases; it does not claim those proposed APIs or fixtures exist. Validation remains document/link/diff consistency only. Root adoption and CP1–CP4 source ownership/review gates remain unchanged.
