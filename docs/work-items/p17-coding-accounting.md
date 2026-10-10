# P17: durable coding accounting and state

Status: implemented local accounting mechanics, 2026-10-10; serving integration
and independent frozen acceptance remain pending. This bounded
item implements the accounting portion of [the serving session contract](p17-durable-coding-session.md)
and [ADR 0019](../adr/0019-coding-autonomy-and-reusable-agent-plumbing.md).

## Problem and expected behavior

Iterative authoring must share existing opportunities with legacy authoring,
growth and reflection. A second empty ledger, a new wrapper task, a catalog
change or restart must not create calls. Every physical coding request needs a
transactional, durable debit and intent, checked after its provider slot is
obtained. A duplicate lookup is a consumed disposition, never another dispatch
permit. A committed debit survives interruption, unknown outcome and zero
dispatches. These are accepted requirements from the parent contract, not new
resource grants.

Host-admitted `coding-session/1` contracts bind session/work-root/attempt/origin
identities, an explicit conversation/plan/growth lane, finite cumulative call,
attempt and command limits, expiry and immutable SDK-independent source,
workspace, provider, catalog, provenance and reporting bindings. The journal
stores versioned state and request records. Execution is ready/running/paused/
terminal, with a phase/reason/wakeup; transcript and operation receipts remain
host-owned JSON data. Optimistic revisions reject late writes. Terminal
execution and report delivery remain separate.

Plan reservations project into the existing development journal and use the
same immutable UTC window policy and conservative historical timestamp rules.
New readers recognize each legacy start once, and old readers see each coding
debit once. Growth coding debits the actual shared growth window. A durable
least-recently-served turn among eligible coding, growth and reflection kinds
provides a three-successful-reservations bound when all three remain eligible,
including one-call windows across reopen. Existing behavior without admitted
coding consumers is retained. Conversation conversion links an already charged
checkpoint once; later coding requests consume the original task's remaining
allowance rather than a fresh wrapper allocation.

Independent growth conversion also links its actual already charged scheduler
decision into cumulative work, session and attempt spending once. The link
names the original Growth record and `growth.window.call_reserved` journal
sequence. It requires an independent growth record, the matching host-admitted
`coding-origin` task and its `coding.growth.origin.admitted` grant, and the
actual matching scheduler/window allocation. Linking never increments
`growth_windows.usedCalls`, allocates another inquiry call or manufactures a
physical request record. An unavailable or forged source event cannot fund
admission. This is a repair of the existing cumulative-call contract, not a new
growth allocation or an expansion of author authority.

## Acceptance checks

- Real file-backed Store reopen preserves contracts, cumulative work/session/
  attempt caps, request intents, observed usage and zero-dispatch spending.
- Legacy plan then coding and coding then legacy exhaust the same immutable
  hourly/daily opportunity. Concurrent final-permit contenders cannot both win.
  Catalog changes and ambiguous legacy timestamps do not erase spending.
- Initial conversation conversion is linked once, does not debit twice, and
  existing task checkpoints constrain new calls. Release lanes are unavailable.
- Initial growth conversion validates the actual reservation/origin, counts once
  across reopen against each cumulative call cap, and never charges its original
  window twice. Wrong growth, event type, origin, scheduler/window or derived
  conversation provenance rolls admission back without a new link or session.
- Growth/reflection/coding share actual `usedCalls`, and each continuously
  eligible kind advances within three successful reservations across windows.
- Current authority and expiry are checked synchronously at reservation time;
  stale queued windows cannot fund a later request. Duplicate identities,
  conflicting intents, expired contracts and cumulative exhaustion never permit
  dispatch. No missed-window credit, refunds or implicit retries.
- Store transaction callbacks are synchronous: async callbacks are rejected,
  synchronous writes rolled back on failure, and escaped async mutation is
  contained. Nested operations commit as one unit. Foreground task selection
  can explicitly exclude trusted internal coding sources without changing
  workspace receiver authorization.

## Non-goals, dependencies and risks

The coordinator owns provider slots, transcripts, tools, commands, source
import, exact submission and reports. This item does not run models, mutate
dependencies, publish, install or change activation authority. Existing version
1 plan attempts keep their IDs and single-call meaning. Production funding and
retained environments remain separate. Dependencies are Store/task journals,
existing development UTC windows and growth/reflection claims. Material risks
are double-counted mirrored events, stale authority, malformed historical
records, fairness blocked by an ineligible consumer, and escaped asynchronous
transaction writes. Verification must distinguish deterministic local evidence
from actual provider/serving and deployment acceptance.

## Implemented interface and evidence

`CodingAccounting` exports `admit`, `get`, `list`, `listRunnable`, optimistic
`update`, `reserve`, `reservations`, `setReservationOutcome` and `reserveCommand`.
The current-authority callbacks run synchronously inside the debit transaction.
Provider-slot acquisition remains the coordinator's responsibility; neither a
request duplicate nor a command duplicate authorizes dispatch. Command permits
retain a separate work-root cumulative cap without charging provider calls.
Completed conversation origins retain their immutable execution/result state;
their `inference.started` history continues to bound coding calls alongside the
existing checkpoint. Live origins also receive the mirrored checkpoint debit.

`Store.transaction` uses immediate SQLite transactions and nested savepoints;
async callbacks are rejected and escaped asynchronous mutators are fenced by
their callback context. `claimNext({excludeSources})` is trusted scheduling,
not a workspace grant. `backgroundTurn` and `reserveCodingInGrowthWindow` use
actual growth windows. Initial ties match the existing reflection-first
scheduler, avoiding a mutual veto between the scheduler and coding continuation.
Expired/exhausted/stalled coding consumers cannot hold another consumer's turn.

The author-collected deterministic accounting run passed **99 checks**, no
failures/skips, concurrency two, across coding-accounting, development-executor,
Store invariants/Store, growth and conversation continuity. Twenty new
accounting cases include the actual background scheduler with deterministic
provider responses, six one-call windows and cold reopen. Existing development
attempt IDs, counts, hourly/daily policy transition checks and recovery checks
remain green. Full source TypeScript checking also passed while integration was
still under development. Evidence is retained externally under
`/tmp/palimpsest-p17-accounting-evidence`; exact source/evidence pins accompany
the handoff receipt. These results are candidate-authored mechanics, not
authoritative release admission.

Baseline source pinned to `1748fbb8d2bb3d687c2acffe0ea93b7bfa7d65e0` failed
foreground exclusion and compound-transaction availability checks. Its actual
development executor also failed a concurrent same-attempt identity check
(two physical proposal callbacks for one identity) and smeared a timestamped
coding debit from daily into later hourly capacity. The first timestamp fixture
used hourly cadence and already passed on baseline; it is retained and is not
counted as causal RED. A separate actual-scheduler RED caught the initial fair
tie mismatch (zero progress in the first window); the matching tie and six-window
GREEN are retained. All original failed and passed observations remain intact.

No actual provider, production allocation, worker/CLI integration, publication,
dependency change or installation was performed by this accounting subtask.
Provider-slot/transport and workspace effect reconciliation are enforced by
the coordinator/adapter/receivers and need their own integration evidence.

## Growth admission decision repair

Integration review found that the coordinator's growth decision had already
consumed `growth.window.call_reserved` capacity but was absent from cumulative
coding work/session/attempt spending. The additive `CodingInitialCall` union
now accepts `{growthId,eventSeq}` alongside the existing `{taskId,ordinal}`.
The ledger validates the actual journal reservation, independent growth record,
current host-admitted origin grant and matching finite scheduler/window before
appending one uniquely identified `coding.initial_call.linked` fact atomically
with admission. It neither creates a physical request nor changes window usage.

Six additional behavioral cases bring accounting to **26 passing checks**.
They exercise each cumulative ceiling across SQLite reopen, a later current
window without recharging the original decision, rejected provenance/window
claims, rejection of mixed initial-call shapes and two independent Store owners
contending to link the same decision. Earlier conversation-call, shared legacy,
fairness, zero-dispatch and command accounting cases remain green.

The corrected pre-repair RED passed 21/26 and failed the five positive growth
link cases. Its exact ledger pin was
`97229937fd36e2d0f82790fd3df4de79c616d8d844b88fe7881ae21729ae5d04`;
`growth-initial-corrected-red-receipt.json` retains full source/test pins.
An earlier run had a max-work fixture whose child caps exceeded the work cap
and a negative test that matched an unnecessary error string. That initial
run is preserved as `growth-initial-red-receipt.json`; those setup/message
failures are not claimed as causal accounting RED evidence.

The final affected seven-file run passed **113 checks**, no failures/skips,
concurrency two, 1213.373417 ms, and strict full-source TypeScript checking passed.
`/tmp/palimpsest-p17-accounting-evidence/growth-initial-final-receipt.json`
binds the logs and fourteen stable before/after source/test pins. The narrow
repair's frozen owned runtime/test pins are:

| File | SHA-256 |
| --- | --- |
| `src/coding-accounting.ts` | `599bdef1cc2d3c97a2b3ff98ea0b2709af1d6e013fd4cbcd27ddb56bff70c53b` |
| `src/coding-state.ts` | `1844da18d36d4afdddf980bb0f9fbbebcbff3e5e93c155eac4dd0fd873a40689` |
| `test/coding-accounting.test.ts` | `f32aae43f967959221f9c6d1944aea8a517bbbba0c358da314ddf7e8f5bd1be2` |

Store and development-executor source were unchanged by this narrow repair.
There were no new allocations/defaults, refunds, dependencies, live provider
calls, workers, CLI batches, installations or publications. The coordinator's
actual selection and native serving witnesses remain the parent/native owner's
integration evidence; these mechanics are not deployment admission.
