# Keep serving responsive during candidate collection

Status: selected correction contract; implementation and acceptance pending, 2026-10-09. Work: P04/P05/P09/P10, R04, R09–R11, R14, R17–R19; [ADR 0024](adr/0024-serving-responsive-candidate-collection.md).

## Problem and evidence

The standard source run at `c82b58e` passed 450 checks, failed the plan-serving-policy events request with `ECONNRESET`, and skipped one unsupported-platform branch. Independent disposable replays using the original finite worker also failed twice. The CLI remained alive and exited cleanly on subsequent SIGTERM. Retained raw probes measured approximately 6.45 seconds of uninterrupted event-loop delay and an actual socket timeout/close. This is separate from the fixed 300-second cognitive-worker expiry.

`evaluateChallenge` ends with synchronous full verification; its resolved continuation immediately freezes a candidate and begins `evaluateCandidate` with another synchronous verification. The whole chain runs on the serving event loop. Freezing alone took about 2.2 seconds; offloading only that step would leave other collectors and slower snapshots blocking requests. A simple isolated stall probe passed, so the evidence does not establish that every delay alone causes a reset. The source chain, queued connection timing and actual replay jointly establish the observed defect. Private receipts and raw diagnostic files stay outside Git.

## Expected behavior and selected scope

Ordinary API/Slack handling, cancellation and mechanical supervision must remain responsive while trusted source/check collection proceeds. Run the unchanged installed candidate collector through a fixed host-owned subprocess for each challenge, freeze, evaluation or full verification operation. Keep `src/candidates.ts`, manifest semantics, historical verifier identity, check selection, runtime, dependencies, HTTP limits and release assertions unchanged in this slice.

The host selects the helper, executable and imported collector module. Requests bind a stable job ID, immutable copied options, options digest, operation, exact source/base/proposal or artifact identity, and the originating process/epoch. Production capabilities, credentials and writable custody are not inputs. The helper receives purpose-specific read/write grants, its private job directory and only the hash-bound trusted programs needed by the existing collector. The helper's ability to run Git and the protected isolation launcher must not expand the candidate check's existing fork/network/file grants. Verify nested confinement with actual subprocesses before enabling this route.

Keep phase journaling between operations. Validate bounded result shape and job/input/result identity in the parent, then recheck current source, author policy, process/epoch and expected artifact before consuming a result, reserving inference, proposing or cutting over. Full original verification stays off the serving event loop. Candidate-selected modules, paths, check policies, fallback evaluators and generic command execution are excluded. A projected or staged frozen result gains no admission authority by existing on disk.

## Ownership, interruption and recovery

Retain one writer/job owner until actual completion and cleanup. Durably record an outer launch intent before spawn, then its actual process/group identity. Synchronous Git children inherit that group. Existing `runIsolated` checker children form separate detached groups, so add a trusted operation-scoped ownership context to the shared launcher: synchronously record each spawn intent before launching, actual identity immediately after spawn, and actual close plus scratch cleanup before recording drain. This context only observes ownership and supplies cancellation; it adds no candidate-selected grants and must not capture unrelated persistent generation sessions.

Cancellation or the finite observation deadline promptly prevents result admission and new stages. Signal known live owned check children and terminate a positively owned helper group when synchronous Git blocks cooperative cancellation. Cancellation/deadline is not evidence of drain. Preserve job/writer ownership until outer and every nested intent have proven close/cleanup. Journal or observer failure fails closed and attempts cleanup of currently owned children; it cannot erase the unresolved intent.

A crash between spawn and PID recording is deliberately unknown. Missing identity, held pipes, ambiguous identity after restart, failed cleanup or an unresolved launch leaves the job held and blocks conflicting replacement/replay. Persisted PID alone does not authorize killing an arbitrary process. Reopening must distinguish observed completion from interrupted/unknown work; it must preserve prior candidate/evidence, spent calls and uncertain effects. Automatic recovery from every unknown-process case is not established by this correction and must remain explicit in evidence. An outer helper exit or worker-thread termination alone is insufficient.

## Acceptance criteria

1. Reproduce the existing serving reset before implementation. Run both unchanged serving-policy fixtures concurrently with their existing polling, assertions and HTTP limits; both must pass without request retries or relaxed checks. Separately measure authenticated events/API response latency while the actual collection chain runs; response latency and total collector time are different results.
2. The exact installed collector and runtime perform the same authoritative checks. Real failed behavior/typecheck input still fails, original historical identity enforcement remains effective, and no provider call or release can follow failed/held collection.
3. Actual cancellation/deadline during blocked synchronous Git leaves the API responsive and closes positively owned outer children without accepting a result. Actual detached sandbox-child cancellation records close/cleanup before releasing ownership; an unrelated generation worker survives.
4. Inject interruption between spawn intent and PID receipt, helper failure, journal failure and descendant-held pipes. Reopening retains unknown/held state and starts no conflicting collector, provider request or release. Wrong/reused/forged identity cannot authorize arbitrary termination.
5. Mutate caller options after dispatch, change source/base or authority during an await, forge a wrong job/options/epoch/result digest, and tamper with candidate/evidence before review/cutover. Reject each case without promotion or budget refund. Duplicate/late results supply no second effect.
6. Actual nested sandbox probes preserve network/fork/private-file denial, compiler/check execution and finite job bounds. Relevant evolution, development, generation, cancellation, custody and serving regressions plus production typechecking pass. Record skips, actual elapsed timings and any remaining ownership gaps.
7. Source review precedes a frozen exact-artifact review and any authorized installation. Subsequent live observation distinguishes API responsiveness from worker lifetime and does not reset authoring allocations or replay model calls.

## Dependencies, alternatives, non-goals and risks

Depends on the existing immutable collector, source bindings, external operational state, isolation, coordinator ownership and receiving custody checks. A durable job record and process-identity interpretation must be specified and tested before implementation can claim recovery acceptance. Reuse existing ownership mechanisms where sound; avoid a general job platform.

Yielding between existing synchronous calls may reduce the measured uninterrupted chain but does not preserve responsiveness within a single slow operation. A worker thread offloads the loop but supplies no separate group for synchronous Git, and termination does not prove detached check children have drained. Increasing socket timeouts conceals the stall. Modifying the evaluator to optimize Git changes its manifest-bound implementation hash and requires the separate [retained-environment](retained-environments.md) upgrade contract. These alternatives do not satisfy this slice's complete contract.

Non-goals are new inference, SDK integration, broader self-modification grants, changes to admission policy, hard CPU/RSS quotas and universal availability. Risks include authority/source changes across awaits, falsely drained jobs, abandoned child groups, helper grants leaking to candidate checks, blocking the main loop again during result verification and treating unaccepted artifacts as historical authority.

## Evidence status

Existing red source runs and independent original-worker diagnostics are retained. The proposed helper, ownership context and acceptance cases above have not been implemented or run by this specification. The independently admitted supervised-worker repair remains a separate bounded improvement; it does not repair this defect or establish a full-suite pass.
