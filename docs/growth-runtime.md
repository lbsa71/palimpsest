# Continuing bounded growth runtime (P08)

## Specification

Problem: a seeded agenda or manually invoked reflection is not continuing
initiative. A running companion must initiate learning without another prompt,
retain the agenda through restart, and stop at configured resource limits.

The trusted scheduler starts an idle tick immediately and then on a bounded
interval. It selects among all four growth dimensions using persisted attempt
order. A queued or paused inquiry, including a model-discovered question with
zero allocation, may receive one call from the current trusted allocation window.
The model never allocates its own resources. Source proposals remain data for the
separate governed release process. While `serve` runs, the trusted host enqueues
those exact recorded proposals automatically for that process; a proposal is not
itself approval or production authority.

The default window is one fixed UTC day and four provider calls. Window identity,
limits, usage, per-inquiry allocation, and call debit are external durable state.
Claiming an inquiry and consuming its window call form one SQLite transaction
before provider invocation. A crash or cancellation never refunds an uncertain
attempt. Restarting the process does not reset the allowance, changing limits
within an existing window is rejected, and overlapping windows cannot mint a
second allowance. Windows may have zero calls to disable new inference.

Active user work prevents a new inquiry. The running timer continues checking
for user work during inference and aborts a growth call when work arrives. The
provider deadline remains the final bound for an uncooperative remote request.
Late output after cancellation does not become a lesson or proposal.

Completed proposals can be delivered through an optional trusted callback using
the growth record's stable identity. Dispatch is durably reserved before invoking
the callback. Reserved or uncertain dispatch is not blindly repeated on restart;
the proposal remains inspectable in the growth outcome for reconciliation.
Callbacks do not grant permission to modify or deploy source.

Callbacks receive a cancellation signal and have a 30-second default deadline.
They should durably enqueue governed work and return promptly. Cancellation or a
deadline marks delivery uncertain; the scheduler does not infer that a remote or
callback side effect was undone. A timer/configuration error stops the growth
timer after one durable error instead of producing repeated failing activity.

The CLI callback performs only a synchronous external-journal enqueue. Its
`EvolutionScheduler` runs the long release separately, so cutover can stop this
growth scheduler without waiting on the callback that started it. On serving
startup, exact immutable completed outcomes reconcile a missing or uncertain
local queue delivery. This observes a stable local enqueue; it does not retry
an uncertain provider call or remote effect. Reusing a growth identity cannot
enqueue a second release attempt or change the outcome.

Acceptance: exercise actual timer initiation; user-work priority and cancellation;
all four dimensions; per-window stopping; a new window advancing discovered
questions; SQLite close/reopen with spent budget retained; concurrent debit
limits; proposal dispatch uncertainty; and no repeated state churn when idle or
exhausted. Non-goals are task inference budgets, authority transfer, unattended
custodian upgrades, and a promise that four calls prove personal development.

Dependencies: the [growth mission](../GROWTH.md), `GrowthCoordinator`, SQLite
Store, and a host that owns the production coordinator lock. Separate scheduler
instances share the same durable budget, but the host must still serialize
production ownership. Material risks include an unknown provider outcome after
interruption, clock/configuration changes, and correlated model judgments.
Qualitative reflections remain unverified evidence until independently evaluated.

## Integration API and state

Create `GrowthScheduler({store, provider, hasUserWork, ...options})`, then call
`start()` while the local service runs. `tick()` runs at most one inquiry for
explicit process-loop integration. `stop()` clears the timer, aborts the current
inquiry/dispatch, and waits for its bounded completion. A stopped instance cannot
restart; the host creates a new one after resolving any error. `hasUserWork` must
reflect authoritative queued/running commitments; the timer checks it even while
inference is outstanding. No scheduler constructor recovers another live owner.
The host calls `recoverGrowthInterrupted()` only after confirming old workers are
stopped and obtaining exclusive coordinator authority.

Options include `schedulerId` (default `standing-growth-v1`), `callsPerWindow`
(four), `windowMs` (86,400,000), `intervalMs` (1,000), `proposalTimeoutMs` (30,000),
and the coordinator's `context`, `memoryScope`, and `maxOutputTokens`. The injectable
`now` clock is a trusted testing seam. Window boundaries are fixed UTC epoch
intervals, independent of process startup and local timezone. Clock changes do
not alter existing allocation records. Intentional policy changes must respect
already-open immutable windows; the scheduler does not silently replace them.

`onProposedChange({proposalId, growth, proposedChange, signal})` observes an already
persisted completed outcome. The stable proposal ID is `growth:<growth-id>`.
`growthProposalDelivery(id)` reports `reserved`, `delivered`, or `uncertain`.
Reserved means delivery may have happened before interruption. Reconciliation can
confirm it via `settleGrowthProposal`; no automatic retry interprets an unknown
outcome as a failure. The original proposal remains in external growth state.

Store's `openGrowthWindow` and `claimGrowthInWindow` are trusted scheduling
operations. Ordinary `updateGrowth` still cannot refill an inquiry. The latter
operation atomically charges the shared window and allocates/debits one inquiry
call before returning its running state. Concurrent connections/processes cannot
spend a single remaining call twice. This is a standing-growth allowance, separate
from task/review/release inference allocations owned by the host.

Serving release review/interview has its own `PALIMPSEST_EVOLUTION_CALLS_PER_DAY`
allocation, default eight per UTC day; zero preserves proposals without starting
new release attempts. It is additional to the four-call inquiry default. Durable
debits precede each release call and survive restart, failure and cancellation.
The same serialized configured provider serves inquiries, tasks and release roles.
See [source evolution](evolution.md) and [ADR 0012](adr/0012-queued-background-evolution.md).

## Verification

`node --test test/scheduler.test.ts` exercises 11 scenarios, including a real timer
with no manual growth tick, cancellation while a fixture provider waits, all four
dimensions, no journal churn after exhaustion, close/reopen budget continuity,
later-window allocation to discovered questions, two simultaneous child-process
claims for the final call, and bounded uncertain proposal dispatch. Tests were
observed red before implementation and before stopping repeated timer errors.
These deterministic fixtures do not claim a real model improved its personality
or code; meaningful outcomes still require the corresponding external evidence.
