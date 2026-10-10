# ADR 0024: Serving-responsive candidate collection

- **Status:** Accepted correction design; reviewed source native-installed. Bounded idle/read/restart gates pass; final integrated full-source and destination busy-collector acceptance remain open.
- **Recorded:** 2026-10-09.
- **Work:** P04/P05/P09/P10; R04, R09–R11, R14, R17–R19.
- **Specification:** [Serving responsiveness](../serving-responsiveness.md).
- **Preserves:** [Immutable evidence](0004-candidate-bound-evidence.md), [local enforcement](0009-local-enforcement-and-recovery.md) and [worker session supervision](0023-supervised-read-only-worker-sessions.md).

## Context

The plan-serving-policy fixture resets an events connection during an approximately 6.45-second uninterrupted verification/freezing chain. Independent replays reproduce it using the original finite worker while the CLI remains alive. Healthy worker lifetime and HTTP availability are separate contracts. The installed evaluator's complete source hash is already manifest-bound; changing its synchronous implementation would invalidate historical verification without the retained-environment upgrade route.

## Decision

Run each fixed host-selected challenge, freeze, evaluation and full verification operation in a purpose-restricted subprocess importing the unchanged installed collector. Bind copied request and bounded result to job, options, artifact/source and originating authority. Recheck current source/policy/epoch after awaits and before consequential consumption. Full verification must not return to the serving event loop as result validation.

Actual macOS probes forbid sandbox reinitialization inside the confined helper, including a private broad Sandbox-syscall diagnostic. Keep the helper confined and select an explicit parent-owned finite-check broker over its private pipe. The unchanged collector builds the original options; the host validates exact source/check/runtime/grants, then invokes its existing isolated launcher outside the helper profile. No candidate, public route or model tool can address the broker; candidate stdout remains captured data. Do not add a broad syscall grant or unconfined fallback.

Durably retain outer and checker process ownership. A trusted operation-scoped isolation context in the parent records intent before each detached check spawn, actual identity after spawn, and close/cleanup before drain. Git inherits the helper's owned group. The parent retains actual child references through cancellation or helper death. Cancellation/deadline prevents new work/admission, but ownership persists until actual cleanup. Unknown spawn, identity or cleanup remains held without arbitrary PID killing, refund or replay. Candidate check confinement stays unchanged; the fixed trusted helper's Git/launcher access does not become a candidate capability. Mechanical recovery cancels/drains ordinary collection before collecting the retained fallback; held ownership still blocks a new launch.

Keep ordinary serving collection's current live-worker/tool-authority checks separate from the private custody artifact-integrity hook. The hook verifies the exact requested artifact and unchanged custody fence even when a retained observer has been stopped; it does not confer proposal or production authority. Its purpose is host-selected and unavailable in public collector controls. New admission still passes the queued current-origin validator after verification, while actual recovery retains its separate preemption/drain contract. The full source run exposed this distinction through three unchanged stopped-observer/offline recovery failures.

Operator installation carries its caller's stop signal through collection and queued admission. Private artifact verification inherits it only before the installation fence, and its asynchronous result is revalidated before consumption. The exclusive custody operation records its entry epoch to distinguish pre-fence admission from its own fenced transfer. Mechanical completion and retained recovery do not inherit a stopped admission signal. This preserves the existing Custodian bytes and installation/recovery rules; [the interruption work item](../work-items/operator-installation-interruption.md) records the actual race and repair evidence.

## Alternatives and consequences

- Yielding between calls can reduce the observed chain but leaves individual synchronous operations blocking.
- Worker threads improve responsiveness but lack an independently owned Git process group; thread termination does not establish descendant cleanup.
- Socket timeout increases hide the source stall and weaken the acceptance signal.
- Optimizing the current evaluator requires separate historical/runtime compatibility admission. Keep its bytes unchanged in this correction.

This adds trusted job identity and descendant ownership across asynchronous boundaries. Crashes can still leave an unknown spawn gap; honest held state is required, and unrestricted automatic recovery is not claimed. Tests must prove current authority, source/evidence fidelity, real nested confinement, actual cleanup and unchanged serving assertions before installation.

## Acceptance and evidence

The [testable specification](../serving-responsiveness.md#acceptance-criteria) covers actual responsive serving, failed-check preservation, cancellation, unknown-process recovery, authority/result negatives and source/frozen/live review. Original red runs and independent diagnostics exist outside Git. Its [evidence status](../serving-responsiveness.md#evidence-status) retains the failed full source run: 519 passes, five failures and one platform skip with test concurrency capped at two. After correcting relocated-fixture imports and private custody-integrity verification, the integrated run at `f7f4415` passed 565 checks with one platform skip and no failures under the same concurrency bound. All 229 source pins remained unchanged and the original operator deadlines were retained. Fresh confined helpers still repeat costly Xcode Git discovery; no supported narrow environment correction has been demonstrated. Subsequent operator interruption repair has its own source evidence and review. Subsequent source8d2e63e passed renewed independent review and the four unchanged native floors, then was installed as aa687d2f through the supported operator baseline. [Migration acceptance](../migration-acceptance-2026-10-10.md) records retained rescue, current-history recovery and two successful quiet/read/restart cycles. This does not replace a final integrated full-source run or destination busy-collector latency/reporting evidence. The companion idle-selector repair narrows complete event sets in SQL while preserving default full audit and admission/evaluator bytes; no cache or history truncation was selected.
