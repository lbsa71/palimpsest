# ADR 0024: Serving-responsive candidate collection

- **Status:** Selected correction design; source implementation under review, complete acceptance and installation pending.
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

## Alternatives and consequences

- Yielding between calls can reduce the observed chain but leaves individual synchronous operations blocking.
- Worker threads improve responsiveness but lack an independently owned Git process group; thread termination does not establish descendant cleanup.
- Socket timeout increases hide the source stall and weaken the acceptance signal.
- Optimizing the current evaluator requires separate historical/runtime compatibility admission. Keep its bytes unchanged in this correction.

This adds trusted job identity and descendant ownership across asynchronous boundaries. Crashes can still leave an unknown spawn gap; honest held state is required, and unrestricted automatic recovery is not claimed. Tests must prove current authority, source/evidence fidelity, real nested confinement, actual cleanup and unchanged serving assertions before installation.

## Acceptance and evidence

The [testable specification](../serving-responsiveness.md#acceptance-criteria) covers actual responsive serving, failed-check preservation, cancellation, unknown-process recovery, authority/result negatives and source/frozen/live review. Original red runs and independent diagnostics exist outside Git. Its [evidence status](../serving-responsiveness.md#evidence-status) records passing independent slices and concurrent serving/recovery checks, followed by a failed full source run: 519 passes, five failures and one platform skip with test concurrency capped at two. The missing relocated-fixture imports are corrected and their check passes. Seven selected recovery/origin checks pass the private custody-integrity repair. An unchanged isolated operator rerun passes its original deadline, but fresh confined helpers still repeat costly Xcode Git discovery; no supported narrow environment correction has been demonstrated. Complete source, frozen-artifact and live acceptance remain pending; this correction is not installed.
