# ADR 0024: Serving-responsive candidate collection

- **Status:** Selected correction design; implementation and acceptance pending.
- **Recorded:** 2026-10-09.
- **Work:** P04/P05/P09/P10; R04, R09–R11, R14, R17–R19.
- **Specification:** [Serving responsiveness](../serving-responsiveness.md).
- **Preserves:** [Immutable evidence](0004-candidate-bound-evidence.md), [local enforcement](0009-local-enforcement-and-recovery.md) and [worker session supervision](0023-supervised-read-only-worker-sessions.md).

## Context

The plan-serving-policy fixture resets an events connection during an approximately 6.45-second uninterrupted verification/freezing chain. Independent replays reproduce it using the original finite worker while the CLI remains alive. Healthy worker lifetime and HTTP availability are separate contracts. The installed evaluator's complete source hash is already manifest-bound; changing its synchronous implementation would invalidate historical verification without the retained-environment upgrade route.

## Decision

Run each fixed host-selected challenge, freeze, evaluation and full verification operation in a purpose-restricted subprocess importing the unchanged installed collector. Bind copied request and bounded result to job, options, artifact/source and originating authority. Recheck current source/policy/epoch after awaits and before consequential consumption. Full verification must not return to the serving event loop as result validation.

Durably retain outer and nested process ownership. A trusted operation-scoped isolation context records intent before each detached check spawn, actual identity after spawn, and close/cleanup before drain. Git inherits the helper's owned group. Cancellation/deadline prevents new work/admission, but ownership persists until actual cleanup. Unknown spawn, identity or cleanup remains held without arbitrary PID killing, refund or replay. Candidate check confinement stays unchanged; the fixed trusted helper's Git/launcher access does not become a candidate capability.

## Alternatives and consequences

- Yielding between calls can reduce the observed chain but leaves individual synchronous operations blocking.
- Worker threads improve responsiveness but lack an independently owned Git process group; thread termination does not establish descendant cleanup.
- Socket timeout increases hide the source stall and weaken the acceptance signal.
- Optimizing the current evaluator requires separate historical/runtime compatibility admission. Keep its bytes unchanged in this correction.

This adds trusted job identity and descendant ownership across asynchronous boundaries. Crashes can still leave an unknown spawn gap; honest held state is required, and unrestricted automatic recovery is not claimed. Tests must prove current authority, source/evidence fidelity, real nested confinement, actual cleanup and unchanged serving assertions before installation.

## Acceptance and evidence

The [testable specification](../serving-responsiveness.md#acceptance-criteria) covers actual responsive serving, failed-check preservation, cancellation, unknown-process recovery, authority/result negatives and source/frozen/live review. Original red runs and independent diagnostics exist outside Git. This ADR records no implemented helper, new test pass or live repair.
