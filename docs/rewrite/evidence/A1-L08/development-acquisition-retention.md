# JR2 finite recorder retention repair

Pre-code freeze, 2026-10-12. Root claim `83081a3`; isolated branch
`codex/a1-development-acquisition-retention-20261012`, base `c512461`.
The actual finite tool goal is active. This implements the adopted
[journal retention design](../A1-L04-journal-retention-design.md), using only
complete bounded snapshots of the actual v2 OperationalStore. CP2 pages,
JR5 checkpoints, actual acquisition and qualification remain separate.

## Frozen authority and wire

The existing signed synthetic manifest is the explicit synthetic-copy branch.
Live plans additionally carry `retention: Signed<EvidenceRetentionGrant>` and
independently configured trust `retention: {acceptedGrantDigest, issuers,
custodianSigner, custodianKey}`. A plan signature alone cannot accept a grant.
The grant domain is `aeon.development.evidence-retention.v1`; its exact value is
`{version:1, id, attemptDigest, sourceDigest, rawStoreDigest, custodianId,
purpose, audiences, dataScope:'complete-operational-role-sources',
retention:'independent-indefinite', withdrawal:'stop-use-retain-originals'}`.
Source digest commits originalStateFile and the full ordered role plans.
Attempt digest commits the original signed manifest value. Audiences explicitly
name principals, providers and reviewers; all are nonempty bounded strings.
Only this explicit independent-originals policy is supported. Absent authority,
changed source/custodian, timed destruction, revocable raw retention or
deletion-on-memory-forget refuse before any raw/owner claim. No new grant or
allowance is minted on reopen.

Live recorder options additionally supply an actual owner-only
`custodian: {store: OperationalStore, key: string}`. The independently signed
row in `development.evidence-custodian` has domain
`aeon.development.evidence-custodian.v1` and exact value
`{version:1, grantDigest, attemptDigest, custodianId,
status:'active'|'withdrawn'|'destruction-pending'}`. Missing, changed or invalid
rows fail closed. The trusted host owns that store and signer; no model API can
write it. Synthetic fixtures require no invented external grant/custodian.

Recorder `withdrawAttemptUse(reasonCode, destructionRequested=false)` CAS
appends an authenticated terminal marker to the existing owner claim without
rewriting raw bytes, B/T or prior accounting. Marker domain
`aeon.development.attempt-use.v1`; exact value is `{version:1, planDigest,
attemptDigest, grantDigest:string|null, custodianId, status,
reasonCode, behaviorDigest:string|null, inventoryDigest,
source:{roleId,journalDigest,cursor,withdrawalIdsDigest,withdrawalCount}|null}`.
Statuses are withdrawn, destruction-pending, document-history-withdrawn and
document-history-corrupt-or-missing. A source snapshot retains the actual
withdrawal IDs; the fixed-size marker commits those IDs and their count.
Reason code is at most 128 UTF16 units. Custodian IDs and role IDs are measured
from accepted inputs. SHA fields are fixed length; cursor/count are bounded
safe integers. Preflight measures the largest canonical signed marker including
JSON escaping and reserves its owner bytes in existing metadata capacity.
Terminal marker headroom remains protected until used, independently of raw
failure and late-response reserves. Marker addition never increases bounds.

## Frozen source and use ordering

Replay resolves anchor/mutation refs through complete journalPayloads, verifies
canonical Document digests, fresh version IDs and revision order, and compares
the result to actual current documents. Existing actual-handle full capture
validates the complete graph, withdrawal membership and current heads; prior
captured event bytes must remain the exact global prefix. An authenticated
withdrawal retains the structural snapshot, then marks full-history acquisition
unavailable; missing or inconsistent payload/marker is distinct corruption.
No earlier raw capture can fill a withdrawn operational payload.

`assertCurrentUse(): void` and `withCurrentUse<T>(syncuse:()=>T): T` are mandatory
ModelReviewRecorder methods. The recorder privately loads its bounded inventory
to avoid recursively guarding guard inputs. For every previously captured role,
the actual Store object must be pinned again on reopen using
`attachApplication(roleId, app, bridge?)`. Same filename is insufficient.
Each current use rereads full current snapshot on that handle, validates complete
current graph, immutable binding and historical prefix, and requires every
previously captured version to remain available. A new unrelated suffix does
not invalidate frozen B; restoring a withdrawn payload or forging membership
fails current graph validation. Path stat is only path identity.

`withCurrentUse` uses nested synchronous transactions on the owner/custodian
and all actual source handles, then performs this complete graph check and the
trusted synchronous use before releasing them. It never awaits. Its trusted
callback must not write source/ledger/state; the adapter uses it only to initiate
model transport synchronously or return an already prepared result. A thenable
return is rejected. Deferred physical transport initiation requires a separate
immediate trusted recheck; it is not covered by holding a promise. Ordinary
effect receivers recheck at their immediate synchronous boundary and release
before their legitimate writes. Root owns bridge assertCurrentUse coordination.

Normal raw reader, raw draft writer, begin, reserve, assignment ingress,
capture, freeze, close, model initialization, model-entry after asynchronous
resume, saved-result output and final output all check current use. Withdrawal
stops new admission; protected retention and original settlement for already
dispatched physical requests remain usable. Diagnostic status/inventory remain
readable. Reopen preserves terminal markers and refuses evidence use.

`readRetainedResponse(mappedPhysicalRequestId, ref, maxBytes)` is the narrow
maintenance reader: durable reservation identity must equal actual original
physical identity, actual status must be beyond reserved, and ref must belong
to that request's immutable responseArtifacts and durable response inventory.
Exact bytes must fit both original response allowance and caller bound. It
bypasses only attempt/source current-use for response verification/settlement.
It cannot read payload/prompt/general evidence or reserve/dispatch. Root's
bridge uses ordinary raw reader only when this hook is absent, never after
hook rejection. Source/custodian withdrawal cannot release original charges.

## Finite causal checks and limits

Use v2 available update/delete/recreate replay, real store withdrawal after
capture and after freeze, current restored-payload/marker corruption, independent
copy grant mismatch and unsupported policy preclaim, durable host withdrawal
and reopen, destruction-pending, raw preservation, protected late response,
bounded marker pressure, and asynchronous model-entry/output rechecks. Preserve
existing independent assertions; only unavoidable synthetic hook fixture wiring
is coordinated with root. Small local SQLite/inprocess checks and strict only.
No CP1 history API is trusted: fresh review currently has four causal failures.
The full-snapshot limitation remains explicit; no delta/cap increase/fallback.

Pre-code refinement before causal guard tests: transactions here are a single
trusted host's synchronous scopes, including when the runtime already owns a
role-store transaction. No global cross-worker lock ordering or crash/restart
concurrency claim is made. Grant audiences must explicitly include
`principal:<observerId>`, every registered `provider:<provider>` and assigned
`reviewer:<assignmentId>`. Live dispatch requires initial complete captures of
all behavioral roles; trusted attachment alone cannot establish their history.
A full-snapshot overflow is capacity-unavailable, never authenticated withdrawal
or corruption. Complete current snapshot overflow remains a CP2 dependency.
The trusted custodian handle must be outside every operational role state file.

Pre-code terminal structural-retention refinement: one slot within existing
maxSnapshots and captureBytes is reserved for the first authenticated source
withdrawal snapshot. MandatorySnapshots includes this slot; ordinary/final
capture cannot consume it. The signed source marker additionally records
`artifact: ArtifactRef|null` and
`retentionStatus:'retained'|'capacity-unavailable'`. Its measured canonical
owner reserve includes these fields. The new snapshot wrapper must fit the
same maxSnapshotBytes. If the full source/wrapper overflows those unchanged
bounds, the marker explicitly reports capacity-unavailable; it never claims
that absent bytes were retained. This remains a CP2 dependency, not a partial
history or new allowance. Optional raw pressure cannot consume the protected
terminal snapshot slot/bytes.

New model-await causal probes use short role IDs in an optional branch of the
existing owned fixture so a new valid 256-byte index plan reaches the guards.
Existing fixture defaults and independent assertions/caps remain unchanged.
The original adapter fixture's 261/256 inventory entry incompatibility is
preserved independently from the new disposition reserve.

Pre-code root correction for an existing runtime outer transaction: a failed
current-use guard must NEVER retain its in-transaction snapshot or claim its
withdrawal IDs are committed. The guard persists only a conservative terminal
refusal with source=null. Structural provenance requires a later depth-zero
capture/diagnostic against the actual committed source. Terminal capture
capacity remains reserved, but cannot turn an uncommitted source into evidence.
The full capture host currently has no public transaction activity observation;
root is coordinating that minimal ownership hook. No CP1 fence qualification
is inferred. This restriction applies even when the outer writer later rolls
back and would make values available again: the consumed attempt stays stopped.

Pre-code diagnostic API, using root's actual transactionActive getter `4791eb0`:
`captureWithdrawalDiagnostic(roleId, app, bridge?)` is trusted host-only and
requires an existing terminal document-history-withdrawn disposition, the exact
attached application/bridge source, and transactionActive=false. It reads a
complete current snapshot, validates prior prefix and actual withdrawal graph,
retains that exact bounded structural snapshot in the protected terminal slot,
and returns its original ArtifactRef. It cannot reopen acquisition, read model
evidence, modify the existing disposition, resign B/T or release accounting.
It may run after a conservative nested-guard refusal, including after reopen.
No transaction is awaited; normal full capture also rejects existing source
transactions before clock/owner/raw changes. Diagnostic retention failure is
surfaced, leaving the marker/current inventory/pending intent authoritative.

## Authored handoff and reproduced results

Exact authored source `d77e23cae16017b565c528adbce20992e2428021`.
Pre-code freezes `5446ccb`, `ed736eb`, `735e9ea`, `60c7223`, `515dd68`.
Root dependencies imported as `4fe1557`/`4903760`/`a2a38eb` (original source
02b90f3/9d68465/ed3689f); audit forwarding only `c1b92e5`. Transaction getter
`4791eb0` imported as `42cb92c`: conflict resolution retained this tree's
existing close/transactions and added only the exact two getter lines; no
unaccepted CP1 fence code was imported. The diagnostic freeze was written
before source edits; its first commit attempt failed during that cherry-pick
conflict, then committed separately after the exact dependency resolution.

Commands from this worktree with pinned Node24:

```sh
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH npm run check
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --experimental-test-module-mocks --test evaluations/development/acquisition-retention.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --experimental-test-module-mocks --test --test-name-pattern=JR2 evaluations/development/model-review.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --experimental-test-module-mocks --test evaluations/development/acquisition-plan.test.ts evaluations/development/acquire.test.ts evaluations/development/acquire-review.test.ts evaluations/development/acquisition-retention.test.ts evaluations/development/model-review.test.ts evaluations/development/model-review-audit.test.ts deployment/development-accounting.test.ts packages/storage/test/storage.test.ts
```

Strict passes. Owned retention **25/25**, 0 skips; new model guard **3/3**,
0 skips. They include actual v2 deletion/recreation, actual Memory.forget,
complete-current restored-payload corruption, unchanged old copies, post-B
withdrawal, custodian destruction-pending/reactivation refusal, exact mapped
late response/settlement, optional metadata pressure with escaped marker,
preserved pending raw intent and original dispatched charges, actual
DurableRuntime/EffectJournal outer transactions and late receipt, nested source
rollback with no retained uncommitted provenance, depth-zero capture refusal,
and reopened committed withdrawal diagnostics. New short-role plans affect only
new cases; all existing fixtures retain their original defaults and signed caps.

Final focused join: **256 total, 214 pass, 42 fail, 0 skips**, 71.765 seconds.
All 28 new JR2 cases pass in that exact join. The remaining failures are explicit:

- **8 unchanged snapshot-capacity failures**: independent R4 dispatched promise;
  owned small-metadata closure, immutable B, cancellation before B, cancellation
  during T, complete B index, complete T index, and matched assignment captures.
  Actual v2 internal payload/head/event cost exceeds their original 300,000-byte
  conservative full-snapshot ceiling. No cap, delta or fallback was introduced.
  CP2 must implement separately adopted complete pages and distinguish SQL
  conservative preallocation from retained serialized bytes before these cases
  can reach their preserved behavioral assertions.
- **33 existing adapter fixture incompatibilities** (31 independent plus two
  owned): preclaim inventory template is **261 bytes versus signed 256**. The
  exact gate already exists in base c512461/accepted terminal source. The owned
  example measures B 92,129/250,000, final 87,939/250,000 and combined metadata
  210,423/915,536; this is not disposition-slot exhaustion. Preserve the old
  plan as infeasible, then separately declare/sign a new feasible fixture plan;
  never raise a consumed plan or weaken entry preflight. Root owns independent
  fixture corrections. New small-ID plans prove JR2 guard behavior within the
  original 256-byte bound without changing these old defaults.
- **1 independent live-path sibling fixture** has no newly required independent
  copy grant. Root must adapt only its wire with a separately accepted signed
  grant naming source/attempt/store/custodian and actual provider/reviewer/
  observer audiences. Existing disjoint-path assertions remain unchanged.

Earlier development runs are retained as causal history: initial recorder join
93=82 pass/11 fail, followed by 93=83/10 after author live grant wiring; the
remaining earlier error regex was subsequently preserved through normalized
source-corruption diagnostics. Initial new retention checks 19=16/3 failed due
to a nonexistent fixture accounting method and prototype-sensitive equality;
then 21=19/2 failed due to scalar forget input and the known full snapshot
limit. Fixtures were repaired using actual APIs, identity comparison and a new
bounded control-only v2 source, with no existing predicate/cap changes. Initial
hook join153=117/36 exposed the old261/256 join incompatibility plus three new
unreachable async probes; new short-ID unclaimed plans then reach and pass all
three. No suppressed skip/green waiver is claimed.

This is a bounded mechanical authored handoff, with fresh JR3 acceptance
pending and the above joined failures open. Full actual acquisition still lacks
real cycles/opportunities/controls/interference/restart/retrieval/initiative/
feedback/context drivers and qualified host/process/context boundaries. CP2,
new feasible adapter fixture plans, direct independent JR3 review and root
integration are the next composition. No private retention authority, current
privacy qualification, live/provider execution, automatic release or H1 is
conferred. Independently retained originals remain write-once; destruction
requests are retained/pending and stop qualification, never reported erased.
