# CP2-P bounded reviewer projection

2026-10-12. **Specified proposal; root adoption and implementation required.** A1-L08/L09, RW09, RW15–16, RW18–21. Owner `/root/a1_development_review_projection_design`; branch `codex/a1-development-review-projection-design-20261012`, base `4b4ca72`. Exclusive write: this document. Actual finite tool goal preceded work. All source/tests and existing contracts remained read-only.

```text
/goal Specify the smallest exact profile-selected developmental review input and accounted bounded evidence reads, preserving immutable B, original authority and final-verifier derivation; return a clean finite schema/API/capacity/ownership proposal for root adoption without implementing or qualifying reviewers.
```

## Decision and inspected constraints

Keep the signed full `DevelopmentBehavior` B and existing Pi/broker/accounting loop. Add one pure projection helper, a profile-selected input/read branch in the existing envelope verifier, and narrow existing adapter/plan call sites. No paged B store, Merkle tree, query language, generic retrieval framework, new scheduler, additional signing principal or raw-store range API. Deterministic views are authenticated by rederivation from the already authenticated complete B; an observer assertion or model summary is insufficient.

Inspected source at `4b4ca72`: `developmentReviewInput` in `review-envelope.ts:279` returns literal full B. `modelExecution` at line 305 recomputes that exact input, verifies its presence in the final provider payload, then checks actual ToolCall identity, local-to-original mapping, response digest, complete succeeded-read inventory, and ordering before final dispatch. Current reads require an exact B-index ArtifactRef and return that full artifact as the settlement response. `model-review.ts` uses one-use isolated claims, original-root accounting, recorder current-use gates and exact final response derivation. Its initial input, tool observation, checkpoints and subsequent payloads make additional copies. These predicates must be explicitly branched, not weakened accidentally.

Dependencies read: [model-review specification](development-model-review-specification.md), [acquisition specification](development-acquisition-specification.md), [adopted composition design](development-composition-design.md) `ca19314` with root adoption `0a0b9ec`, recorder contract `4b4ca72`/[paged recorder](development-paged-recorder.md), and CP2-H frozen contract `393df08`. The absolute root execution record was read at the current claim; it gives H exclusive witness/envelope/store ownership and R exclusive acquisition/adapter ownership. H exports `developmentCapacityProfile = 'complete-pages-bounded-20261012'`, `developmentOperationalArtifactBytes = 1000000`, and authenticated `verifyDevelopmentAttempt`. This proposal does not modify their in-flight contracts.

The full schedule reserves 126 deliveries, 156 captures, raw signed B up to 16 MiB, final envelope up to 24 MiB, and an example 8,192-byte model payload/4,096-byte response. B is not an artifact inside its own `artifactIndex`: inserting its digest there creates a reference cycle. The bounded input consequently refers to B by `behaviorDigest`, never by a fabricated available ArtifactRef. T, final envelopes, reviewer outputs and other reviewers' responses remain outside this read surface.

## Profile and exact input

The existing attempt-v1 branch retains byte-identical input construction, ToolCall schema, execution schema and full-input/read verifier predicates. No fallback on an old limit failure. The new branch requires an authenticated attempt version 2 with exactly H's named profile, and root acceptance of this projection contract in the qualified host/observer closure. Unknown/mixed profiles fail before role claims or reads. B, registration, review binding and signature domains retain their existing versions; this is an explicit named-profile wire branch, not reinterpretation of old version-2 envelopes.

Proposed exact input (all listed fields required, no extras):

```ts
type BoundedDevelopmentReviewInput = {
  version: 2;
  capacityProfile: 'complete-pages-bounded-20261012';
  readProtocol: 'development-review-sections-v1';
  registrationDigest: string;
  behaviorDigest: string;
  roleId: string;
  collections: { name: CollectionName; records: number }[];
  cases: { kind: 'opportunity' | 'control' | 'boundary'; records: number }[];
};
```

`collections` is the exact ordered catalogue below, including empty collections; `cases` has the three listed entries in that order with manifest array lengths. These counts are mechanical facts about B, not outcomes or a read claim. The packet contains no model-generated prose, excerpts chosen for favorability, omitted-case summary or implicit completeness assessment. Actual canonical input bytes must fit the reserved input artifact and complete provider payload with the owned instructions and tool definition. An 8 KiB payload is a conditional engineering example, not a guaranteed fit for arbitrary accepted instructions/IDs. Refuse before claim if the actual initial payload cannot fit; subsequent actual payloads retain pre-dispatch refusal.

`developmentReviewInput(b, roleId)` retains its two arguments and dispatches by the verified manifest profile. The pure helper validates the discriminant as defense in depth; only the caller authenticates trust. The final verifier recomputes the new packet and still requires exact canonical input bytes in the actual final model request. Compaction which removes it cannot produce an accepted final review. No implicit reinsertion of synthetic model history.

## Fixed collections and exact lookup

A projection record is canonical JSON for `{source: string, value: JsonValue}`. `source` is a helper-generated location from the fixed grammar below, never caller-supplied JSONPath. Array positions use ordinary decimal indexes and retain B order. Complete collection enumeration reconstructs every original B field without losing duplicate inline copies, negative observations, null uncertainty, findings, signatures or exact original references.

| CollectionName (fixed order) | Ordered records / source locations |
|---|---|
| `behaviorHeader` | One object containing exactly B `version,registrationDigest,frozenAt,rootCancelled`; source `behaviorHeader` |
| `manifest` | Entire signed `B.manifest`; source `manifest` |
| `observations` | Every signed `B.observations[i]`; source `observations/i` |
| `requests` | Every `B.requests[i]`; source `requests/i` |
| `transitions` | Every `B.transitions[i]`; source `transitions/i` |
| `evidenceHeader` | Exactly `version,kind,evidenceKind,trustProvenance,originalAccounting,finalAccounting` from `B.evidence`; source `evidenceHeader` |
| `evidenceManifest` | Entire signed `B.evidence.manifest`; source `evidence/manifest` |
| `evidenceObservations` | Every signed `B.evidence.observations[i]`; source `evidence/observations/i` |
| `evidenceArtifacts` | Every `B.evidence.artifacts[i]`; source `evidence/artifacts/i` |
| `findings` | Every `B.evidence.findings[i]`, including failures/unavailable; source `evidence/findings/i` |
| `artifactIndex` | Every `B.artifactIndex[i]`, canonical sorted exact ArtifactRef/length; source `artifactIndex/i` |
| `cases` | All original opportunity entries, then control entries, then boundary values, with sources `manifest/value/opportunities/i`, `manifest/value/controls/i`, `manifest/value/boundaries/i` |

These are bounded existing fields, not a general schema walker. Extra/missing B/evidence fields fail the existing exact validators rather than disappearing from the projection.

Exact selector union:

```ts
type ReviewSelector =
  | { kind: 'collection'; name: CollectionName }
  | { kind: 'case'; caseKind: 'opportunity' | 'control' | 'boundary'; id: string }
  | { kind: 'observation'; id: string }
  | { kind: 'request'; id: string }
  | { kind: 'original'; artifact: ArtifactRef };
type ReviewCursor = { index: number; offset: number };
```

`case` selects the exact declared manifest entry first, followed by complete signed B observations in original order with these **only** mechanical memberships:

- Opportunity: `opportunity.assignmentId === id`, `learning.opportunityId === id`, and `experience.assignmentId` in that opportunity's exact declared `interferenceIds`.
- Control: `control.assignmentId === id`.
- Boundary: `boundary.boundary === id`.

Here each field comparison is guarded by its explicit observation `data.kind`. Do not infer provenance from prose, key prefixes, equal artifact hashes, timestamps or model judgments. These memberships locate registered evidence; they do not assert it proves the case. Global interventions, invariant violations and findings remain separately enumerated, prominently described in the owned tool instructions. The adapter may not label a case view complete evidence for that judgment. Missing case observations produce just the assignment record; global counts/findings and the unchanged witness still expose missing coverage.

`observation` selects the one exact signed observation by `value.id`. `request` selects the one exact `B.requests` request by physical request ID, then every B transition whose `state.request.id` matches, preserving order. Original preregistration requests already occur through manifest original accounting/retained provenance; this selector does not fabricate their absence from B.requests. Missing/duplicate IDs refuse; an exact case with no observations is legitimate. `original` requires exact `(uri,sha256)` membership, not digest-only aliases. It selects one raw byte record and does not wrap/change the original content.

Exact case/ID lookup and direct original membership avoid a linear **model** scan of the multi-MiB artifact index. A helper may scan already bounded authenticated B arrays once or cache maps keyed by exact B digest; no new persistent index or model-authored query plan. Source locations identify evidence provenance, not permission. Full global-negative/finding/assignment coverage remains reachable. The 64-request example does not guarantee visiting every case, every failure or every page. Qualification must measure the actual review workflow; no automatic claim that a completed reviewer read or understood all B.

## Exact accounted request and deterministic receipt

Only the new profile changes `evidence_read.arguments`:

```ts
type BoundedReadArguments = {
  version: 1;
  behaviorDigest: string;
  selector: ReviewSelector;
  cursor: ReviewCursor;
};
type BoundedReadReceipt = {
  version: 1;
  behaviorDigest: string;
  selector: ReviewSelector;
  cursor: ReviewCursor;
  records: {
    index: number; bytes: number; offset: number;
    encoding: 'utf8' | 'base64'; content: string;
  }[];
  next: ReviewCursor | null;
};
```

All integers are nonnegative safe integers. Start is `{index:0,offset:0}`. Fixed protocol receipt maximum is **2,048 UTF-8 canonical JSON bytes**, not content characters, decoded body bytes or an estimate. `bytes` is the selected complete record's byte length, `offset` its byte offset. Content uses strict round-trip UTF-8 where possible, otherwise canonical RFC4648 base64. A UTF-8 source uses complete code points: a fragment ends at a UTF-8 boundary; a caller offset inside a code point refuses. Arbitrary original binary bytes use base64. Encoding choice is deterministic from the complete selected record's validity; never decode invalid bytes with replacement. All partial JSON is explicitly a fragment, never presented as a standalone parsed object.

Pagination is record-aware: append successive complete records while the complete canonical receipt fits 2,048 bytes; when the next record cannot fit, append the largest positive prefix fitting that receipt, no more than the remaining 2,048 source bytes considered for that fragment, then stop. Choose the largest UTF-8-boundary prefix (or byte prefix for binary) whose **actual canonical receipt including next cursor** fits. Bounded descending examination of at most 2,048 byte positions is sufficient; no unbounded packing algorithm. If a nonempty page has no room for another code point/byte, return its existing records with the next unconsumed cursor. If even one code point/byte cannot fit on an otherwise empty page, refuse that accepted configuration during preflight. Do not drop fields to fit. Complete record processing advances `index`, resets offset to zero; a partial record advances offset by actual decoded bytes. `next:null` occurs exactly at the end of the selected sequence. An empty valid collection returns empty records and null. An out-of-range/terminal cursor, nonzero empty-collection cursor, nonexistent selector or extra field refuses without original reads. A caller can revisit or start at a valid location; this grants no claim to skipped prefixes. A repeated page is a new accounted read.

The helper returns the exact receipt bytes, their ArtifactRef and deterministic debit described below. It does not retain/sign anything. The adapter retains those exact bytes using the existing role draft/capacity path before reporting success; the **receipt**, not the original artifact, is the effect settlement response. The tool observation contains the exact canonical receipt text plus its receipt ArtifactRef. No second unrestricted reread after settlement, reconstructed friendly summary, or unaccounted decoded-content side channel. The tool's owned instructions explain fragment assembly/continuation, collections and global negatives. Tool schema/description and instructions remain actual captured prompt fragments. Their bytes consume the existing payload/fragment reserves.

## Original bounds, authority and release ordering

Originals continue to require full authenticated read through `recorder.readArtifact(ref, bound)` where `bound = min(indexed.bytes, 1000000, signed maxArtifactBytes)`. Check exact membership, positive available byte/read budgets and indexed length **before invoking the reader**, then returned length/hash before copying or slicing. An indexed original larger than 1,000,000 is not readable under this protocol. No call reads it under the 32-MiB metadata allowance; no chunk API silently bypasses H's singleton policy. Zero-byte originals can be authenticated with the existing store's supported finite positive bound, return an explicit zero-byte record, and consume receipt bytes.

To promise complete indexed-original access, new-profile admission must check **every actual B index singleton <=1,000,000** and the signed plan's participating pools must enforce that rule before their writes. The composition table's 1,048,576-byte capture-manifest reserve is reserve headroom, not operational read permission: an actual 1,000,001-byte indexed manifest is a preserved infeasibility, and cannot qualify this access contract. R must enforce/measure an actual <=1,000,000 cap for indexed manifests/proofs/source originals under the new unclaimed plan or report infeasible; do not shrink already signed reservations or assert that every worst-case manifest fits. B/T/final remain separately qualified larger metadata objects, outside B's own index/readable-original surface. If future required originals truly exceed 1M, that needs a separate explicitly adopted source-format/read-policy design, not this implementation.

Every page/lookup and every cached-use release invokes the recorder's whole-attempt historical source/custodian check, all exact role scopes included. Both reviewer scopes must be allowed for the entire B index before the first role claim, as today; metadata projections require the same whole-B disclosure eligibility, not just a favorable selected source. Original alias rejection is unchanged. No bytes move into a broader audience through a derived receipt.

Preserve existing ordering: validate frozen exact B/registration/session/profile/source identities; current-use and finite-plan checks; retain actual ToolCall; reserve original-root request; dispatch; invoke current-use again at immediate receipt generation/release; retain exact receipt through accounted response machinery; settle; check current use before returning tool observation and again before next model entry/final signing. Never hold a source fence across await or mutations. On withdrawal in a gap, no later receipt/content/claim is released. Already dispatched exact response retention/settlement remains available through existing maintenance hooks with original charge and identity; it is not new-use authority. Completed saved claims must rerun the same input/read verification and current-use gates before re-export, not merely trust their old signature.

## Execution schema and final rederivation

The new-profile `DevelopmentReviewExecution` keeps existing fields, adds exactly `inputMode:'bounded-sections-v1'`, and replaces each evidenceReads entry with:

```ts
{
  requestId: string; selector: ReviewSelector; cursor: ReviewCursor;
  receipt: ArtifactRef;
  localToolCallId: string; localRunId: string; stepId: string;
}
```

`artifact` is absent in this branch; original identity occurs exactly inside an original selector. The old branch forbids `inputMode` and keeps old entry fields/predicates. Profile selection derives from authenticated B, never from an untrusted execution mode or presence of fields. New ToolCalls cannot be smuggled into old executions or vice versa.

Final verification first authenticates/reconstructs full B and its exact index under H limits, as today. Then it must:

1. Recompute canonical bounded input and match `x.input` and the actual final provider payload; preserve model/purpose/role, original-root lineage, final response/decoder/output/reason and case-coverage predicates.
2. Require unique execution read request IDs and the exact complete set of all succeeded original reviewer `effect-receiver/evidence_read` requests. Preserve failure/uncertainty accounting; an omitted succeeded call cannot disappear because its result was not useful.
3. For every entry, load and compare canonical actual ToolCall bytes, exact argument schema, B digest, selector/cursor and local IDs. Preserve existing deterministic original request/reservation/prompt-manifest/run mapping, actual role and purpose, succeeded settlement and transition/time ordering before final dispatch.
4. Require `settlement.response === entry.receipt` as an exact ArtifactRef. Recompute the page from authenticated B plus bounded original reader, compare canonical bytes and digest with the retained receipt, including encoding, every record byte offset/length, membership, and continuation. Receipt artifacts belong in T's actual inventory, never retroactively in B. Tail raw reads must not become authorization for evidence outside B.
5. Reject truncation, altered ordering, foreign source rows, skipped members within a returned page, forged exhaustion, changed original aliases, request/response swaps or a page generated for another B. Keep the existing final whole-envelope record/byte/accounting and current-use admission gates.

The original verifier establishes that succeeded reads preceded final dispatch, not that all were retained in the model's final context after compaction. This proposal preserves that honest meaning. The adapter proves it returned the exact accounted observation and retains ordinary checkpoints/payloads. It must not assert final-context consumption of every page without an additional accepted predicate. The initial bounded packet itself still must occur exactly in final input. A read of a fragment is only that fragment, even though the host hashed the whole original to authenticate it.

## Small pure API and ownership

NEW `evaluations/development/review-projection.ts` exports types/constants plus:

```ts
boundedDevelopmentReviewInput(b: DevelopmentBehavior, roleId: string): BoundedDevelopmentReviewInput;
projectDevelopmentReviewRead(
  b: DevelopmentBehavior,
  args: BoundedReadArguments,
  readOriginal: BoundedArtifactReader,
  bounds: { maxReceiptBytes: number; remainingReadBytes: number }
): { bytes: Uint8Array; artifact: ArtifactRef; debitBytes: number };
```

The supplied limits must be positive, `maxReceiptBytes >= 2048`, <=1M and within signed limits; the protocol output remains <=2048 regardless of a larger caller limit. `debitBytes = canonical receipt bytes + indexed original bytes actually read` for original selection, and just receipt bytes for a B projection. Each original page reauthenticates the entire <=1M original and pays that I/O debit again; no cache discount. Helper preflights worst-case 2048 plus indexed length against remaining before reading, then returns actual debit. Receipt retention and physical-response charges are separate from this session read budget. B metadata is already authenticated/resident; record serialization is bounded by signed B limits and is not a physical model or original read. Do not allocate a complete serialized projection catalogue: iterate the selected bounded records, serializing at most one selected record at a time. Temporary record encoding may reach the signed metadata ceiling; it is host memory, separately measured, never a tool/prompt artifact. A serialized page is <=2048 before an owned retained copy.

A narrower helper may factor schema validation internally; no public generic JSON evaluator. Runtime imports avoid an envelope/helper cycle: the helper uses type-only envelope imports and H constants, while the envelope imports helper functions.

Implementation waits for root's exact adoption and release of H/R paths, not for speculative concurrent edits. Proposed owners:

| Task | Exclusive paths after root claim | Dependency / finish |
|---|---|---|
| CP2-P1, sol/high | NEW helper, NEW helper tests/evidence; narrow `review-envelope.ts` and NEW projection-envelope tests | H handoff plus adopted schema; old branch preserved; independent adversarial receipt rederivation works |
| CP2-P2, sol/high (existing R owner) | narrow `model-review.ts`, authored model tests; `acquisition-plan.ts`/`acquire.ts` only required preclaim/draft/index constraints; NEW projection-adapter tests/evidence | Frozen P1 API and R handoff; actual recorder/accounting integration and exact capacity admission |
| CP2-P3, fresh astra/high | NEW independent projection-review test/evidence only | Exact P1+P2 closure; no production repair or editing prior assertions |

P1 may implement/test its pure fixture portion while R finishes, after root ownership release. Envelope and adapter mutations are serialized by owners. Root owns central execution/lane adoption and changed independent fixture policy. No task may overwrite H's in-flight envelope or R's adapter. Existing source/tests remain read-only in this design task.

## Capacity and feasibility gates

There is no new grant. `maxModelRequests + maxToolReads <= role.resources.maxRequests` and both consume that role's original `maxDrafts`; compaction/retries also consume model slots. Under the example 64 total slots per reviewer, even reading 64 maximally full receipts yields at most 131,072 receipt bytes **before leaving any slot for model requests**. It cannot prove review of a 16-MiB B. Exact case/ID access makes relevant evidence reachable; successful semantic review remains empirical and may fail the finite plan.

The old `DevelopmentReviewPlan` shape can remain: require new-profile `maxReadBytes >= 2048`, `maxReadBytes <= maxResponseBytes`, and measure `maxTotalReadBytes` using the helper's debit above (old branch unchanged). Existing session descriptors are externally accepted by exact digest. Changed values require a new accepted unclaimed session/plan; no recovery expansion. Final verifier enforces protocol caps and actual accounting; it does not infer externally accepted session budgets from an unsigned caller statement.

Preclaim serialization/reserve inventory must count all of the following; same hash does not erase a distinct budget/copy obligation:

- One input artifact per role; each physical payload's inline input, owned tool definitions, instructions, and transcript; prompt manifest/fragments; captured payload copies through the original bridge; repeated tool observations and any compaction input/output.
- Each actual ToolCall raw artifact and local evidence, each canonical receipt raw artifact/accounted response, its tool observation content and reference, and repeated receipt text in every later payload/checkpoint. The original source remains charged in its original pool; it is not moved into a receipt pool.
- Claim's evidenceReads array, signed execution inline in binding, retained raw binding, final-envelope inline binding, tail/index entries, checkpoint artifacts and local operational checkpoint/state copies. Execution selectors/cursors/ref fields are larger than old artifact-only entries; regenerate exact canonical metadata templates rather than reusing 4,096-byte transition/index guesses.
- Existing raw B, owner-inline B, final-inline B, owner inventory, T, signed metadata and protected pending/failure/late-response pools retain every existing debit. The helper adds no retained whole-B/section/index copy. Any implementation cache serialized to disk becomes an additional explicit debit.

For exact preclaim arithmetic, let `M=maxModelRequests`, `R=maxToolReads`, `Q=3*M+3*R+4`, `P=rp.maxPayloadBytes`, `U=rp.maxPromptBytes`, `F=rp.maxFragmentBytes`, `C` be the maximum canonical actual bounded-read ToolCall with accepted local-ID maxima, `I` the exact initial input length (or its frozen pre-B worst-case template), `J` the maximum canonical signed binding including R new execution entries, `L` the sum of actual distinct owned instruction artifact lengths, and `K=maxTotalCheckpointBytes`. Let `V=maxResponseBytes`. Use this conservative reviewer draft-byte requirement:

```text
Dreview = M*(P+U+F) + R*(C+2048) + I + J + L + K + 2*V
Dreview <= rp.maxDrafts*(P+U+F)
M+R <= rp.maxDrafts
Ereview = (M+R)*V <= role's existing protected response reservation
```

`2*V` bounds final output text plus all extracted reason bytes together (both derive from one <=V UTF-8 JSON response); validate that property for both actual decoders and reject if a future decoder changes it. The receipt's draft and response reservations are both counted, regardless of eventual hash dedup. `L` is additional to captured per-request fragments, without optimistic reuse. `K` reserves every checkpoint artifact; `Q` bounds their count. Actual tool observations are held in local checkpoints/transcripts, not another raw artifact at the inspected call site; if implementation retains them separately, add `R*maxObservationBytes` and R slots explicitly. The tool observation's canonical maximum is calculated from a 2048-byte receipt **as escaped text** plus its exact IDs/provenance/ref, not 2048 again.

A conservative raw-slot reserve is `M*(2+f) + 2*R + 2 + l + Q + (caseCount+2) + (M+R)`, where `f` is the frozen maximum prompt-fragment artifact count per model request, `l` is the owned instruction artifact count, `caseCount=opportunities+controls+boundaries`, the first 2 are input/binding, `caseCount+2` are per-case/overall reason artifacts plus output, and the last term protects responses. It counts complete per-request raw payload, captured prompt and fragments; raw reuse may lower actual storage but never this reservation. Existing proof reservations for output/reasons can satisfy those exact designated terms, provided the preclaim table names their pool and does not reserve them twice or borrow mandatory nonreview slots. All other new terms must have protected finite inventory slots before claim. No role request count is confused with a raw-artifact count.

P2 exposes a small pure `developmentReviewReservation(session, rolePlan, templates)` calculation within its owned adapter/plan modules and uses its result in the full-plan preclaim compiler. Supply externally accepted session descriptors and bounded identity/prompt/binding templates **before acquisition claim**; missing descriptors/templates are an infeasible preclaim, not guessed future numbers. This need not add a new signed-plan field: the existing exact signed role draft/response/metadata/inventory capacities remain the limits, and the compiler proves these sums fit them. At actual reviewer entry recompute with the accepted actual descriptor/B and check remaining role/pool capacity before the reviewer claim. A later different accepted descriptor must independently satisfy those same unchanged signed capacities; no cached preclaim certificate authorizes it. Protected metadata templates include R execution entries in raw binding, claim binding/read list and final-inline binding with actual maximum escaped local IDs, plus T/inventory/response indices. `J` and every operational artifact must stay <=1M independently of aggregate capacity.

An 8-KiB payload/4-KiB response example is admitted only after exact escaping/tool-schema/receipt/transcript/checkpoint templates fit; there is no claimed numeric full-profile pass in this document. If these conservative requirements exceed the already signed finite capacities, preserve the refusal and propose a separately accepted unclaimed allocation. Do not expand it during acquisition.

Canonical byte counts are UTF-8 `Buffer.byteLength(canonicalJson(value))`; raw originals use actual byte length. Base64 expands by `4*ceil(n/3)` and JSON quotes/escapes must be counted after encoding. Do not substitute UTF-16 lengths, raw content lengths or token estimates. Before each actual dispatch, the broker still checks the complete actual payload. If continuation history fills it, the configured finite Pi compaction may run under its original accounting; this proposal adds no second loop or automatic enlarged request. If the immutable initial packet is lost, final derivation is unavailable.

## Causal acceptance and finite handoff

Small offline real-store/accounting fixtures and synthetic captured provider responses only; no product-test execution in this design, no physical/native/provider/network/private credentials/Slack/push/deployment or broad benchmark. Author tasks must preserve all existing independent assertions/red evidence and obtain a fresh consequential review. Required cases:

1. Old attempt/input/read/execution examples remain byte-identical, including old oversize refusals. Unknown profile, unaccepted attempt, mode downgrade/mix and extra fields fail before readers/claims.
2. A multi-MiB synthetic B yields a bounded exact initial input without storing full B again. Reconstruct every B field from collections, including duplicate evidence copies, long IDs/reasons, all failures/unavailable/null fields and exact index associations. Corrupt a single omitted negative and show final rederivation rejects the forged projection. Show exact case lookup reaches late-index evidence without earlier model reads.
3. Empty collections, final record, oversized single record, embedded quotes/NUL/lone surrogates as canonical JSON, multibyte UTF-8, invalid UTF-8 original, binary base64 and exact continuation boundaries. Reassemble exact original bytes; detect wrong offset, forged EOF, overflow integers, invalid code-point cursor and noncanonical encodings.
4. Prove original size/membership/audience/remaining-budget refusal happens before reader allocation/call; 1,000,001-byte original fails despite 32-MiB metadata allowance and cached bytes. Exact 1M reads keep their ceiling. B is never read as a self-indexed fake artifact. Alias/digest-only authority and a T-only/other-review artifact fail.
5. Through actual recorder and DevelopmentAccounting, match exact canonical ToolCall, original reservation/run/role, succeeded receipt bytes and returned observation. Independently tamper each selector/cursor/receipt/order/mapping, omit/duplicate a succeeded read, change final input and forge response provenance. Final verifier rejects every tamper and accepts retained negative/unavailable model judgments with genuine known accounting.
6. Exercise reserve, dispatched, response, observation, checkpoint and final-claim capacity boundaries and reopen. Insufficient escaped input/tool/receipt/execution metadata refuses without claim or physical entry as appropriate, preserves consumed drafts/charges/pending response and never refunds a read on failure. Measure actual source I/O debit on repeated original pages and actual retained/inline copies.
7. Whole-role source withdrawal or custodian denial before lookup, after cache fill, during async receiver/model gap, after succeeded read and after saved review. Deny next release/entry/export; exact late-response maintenance still succeeds. No source fence held across await or ordinary ledger writes.
8. A bounded workflow over all registered case IDs plus global negatives with selective originals reports its actual model/read counts and bytes. Exhaustion is unavailable, never a silently truncated case list or a claim to have read all raw evidence. No fixture establishes reviewer competence, control validity, private checker independence or complete workload fit.

Copyable future goals (root must claim exact source paths and revisions first):

```text
/goal Complete A1-L08 CP2-P1 from the adopted development-review-projection-design.md: as gpt-6.1-sol/high author, create an actual finite goal, freeze the exact helper/envelope contract, implement only the claimed projection helper and profile-specific verifier branch after H releases shared paths, preserve old predicates, prove bounded/rederived receipts with small offline causal fixtures, and return clean exact source/evidence for independent review. No adapter, live acquisition or qualification claim.

/goal Complete A1-L08 CP2-P2 from adopted CP2-P1 and the frozen CP2-R recorder handoff: as gpt-6.1-sol/high author, create an actual finite goal and integrate only claimed adapter/acquisition paths, preserve actual ToolCalls and original accounting/current-use/late-response rules, preclaim every input/read/execution/copy reserve and 1M original constraint, demonstrate actual-recorder offline cases, and return clean exact evidence including infeasibility. No grant expansion, second loop or reviewer competence claim.

/goal Complete A1-L08 CP2-P3 in fresh gpt-6-astra/high context: create an actual finite goal, freeze independent criteria from the adopted projection contract and exact P1/P2/H/R closure, own only new review tests/evidence, causally challenge membership, byte continuation, actual ToolCall/receipt/final derivation, capacity and withdrawal, preserve prior assertions and failures, and return a clean accepted-or-changes-required bounded disposition. Return source repairs to the owner; no live or autonomous qualification.
```

Completion of this proposal means a clean document and root adoption handoff. Candidate/control private checkers, host/observer integrity, empirical reviewer independence/competence, full workload/resource fit, ordinary restart/context sensors, JR3 and H1 remain separately unqualified. No source/test result is claimed.

Validation performed: read-only actual source/specification inspection, local Markdown destination and exclusive-path checks, `git diff --check`; no implementation/tests or acquisition. Root is the adoption owner. The next runnable action is to adopt/reject this exact wire and assign P1 after CP2-H releases `review-envelope.ts`, with P2 reserved to R after its current finite handoff.

## Root adoption and P1 author claim

Root adopts design `a0035e01d4b0a21f1a63d88a1b449bf9eaf2ac5e` for finite engineering implementation, without semantic-review or whole-workload acceptance. Explicit indexed operational singletons remain at most1,000,000 bytes; any larger manifest reserve is accounting headroom only. Exact canonical preclaim measurement and actual request/copy limits remain mandatory. Prefer the smallest fixed helper/call-site changes; no new package, query engine, durable index or model loop.

NEW CP2-P1 author `/root/a1_development_review_projection`, `gpt-6.1-sol`/high, isolated `development-review-projection`, branch `codex/a1-development-review-projection-20261012`, base `8f4ea2e`. Own NEW `evaluations/development/review-projection.ts`, NEW `review-projection.test.ts`, NEW `review-projection-envelope.test.ts`, narrow profile-specific branch changes in `review-envelope.ts`, and NEW `docs/rewrite/evidence/A1-L08/development-review-projection.md`. All existing tests and other source are read-only. H finite author released envelope; fresh H review remains in progress against frozen8f4ea2e and may return a separate repair. Coordinate any overlapping fixes with root, do not silently repair H's unrelated mechanisms. R retains recorder/plan/adapter ownership and its current finite goal; P2 follows R handoff. Create actual finite goal and freeze exact behavioral contract before code. Local small in-process fixtures and strict checks only; no physical/native/provider/network, private credentials, Slack, publication, deployment or full benchmark. Return clean exact evidence and source for fresh P3 after adapter join.
