# ADR 0023: Supervised read-only worker sessions

- **Status:** Implemented, source/frozen reviewed, installed and accepted at bounded local worker scope after a six-minute live interval. Separate serving responsiveness remains unresolved under [ADR 0024](0024-serving-responsive-candidate-collection.md).
- **Recorded:** 2026-10-09.
- **Work:** P05/P10, R17–R19; [worker specification](../supervised-workers.md).
- **Refines:** [ADR 0009](0009-local-enforcement-and-recovery.md), [ADR 0010](0010-process-bound-generations.md), [isolation contract](../isolation.md).

## Context

The cognitive worker was launched through a finite-job adapter. Its unconditional300s deadline caused a healthy idle source to fail and custody to fence/recover it every five minutes, while outer API/Slack availability concealed the churn. Cumulative1MiB stdout capture would also eventually reject valid successive RPC responses. Removing only the timer would retain lifetime buffering and grant persistent writable scratch.

## Decision

Separate supervised descriptor sessions from finite candidate jobs. `runIsolatedSession` shares the existing launcher/confinement/cleanup but requires an owner signal and synchronous PID/stdout observers; it allows current Node/read-only source and denies fork, network and writable source/HOME/TMPDIR. It accepts no candidate-supplied timeout or write/executable override. Finite `runIsolated` retains its default/max deadline and combined capture; an explicitly selected finite worker lifetime remains available.

Stream stdout into the existing bounded/correlated protocol receiver without retaining a lifetime transcript. Retain bounded cumulative stderr diagnostics. Startup, request/checkpoint/probe deadlines, frame/descriptor/scope validation, observer failure and owner cancellation still terminate/drain. Trusted authority callbacks remain synchronous and throw to deny: Promise/thenable returns fail closed, eventual rejections are consumed and denial waits for actual close before returning. Accepted request data is copied before the wrapper yields for process drain. Trusted custody continues periodic behavioral probes and genuine failure recovery.

## Alternatives and consequences

- **Increase the job deadline:** Delays routine failure and retains lifetime transcript accounting and writable scratch. It does not supply the persistent lifecycle required by the product.
- **Recycle at five minutes:** Could be implemented as a planned checkpoint/ownership transfer, but current timer expiry is a failure with potential uncertain effects. Routine healthy-worker replacement adds unnecessary transitions; explicit evaluated succession remains available when a change requires it.
- **Remove finite job bounds globally:** Would expose coding/check commands to unbounded execution. The separate trusted entry point retains their existing contract.
- **Retain all session output:** Creates lifetime memory growth or eventual false failure. The protocol receiver needs bounded current frames; durable task results belong in the existing external host store.

This does not provide CPU/RSS quotas or an independent watchdog after the outer host dies. Existing retained-process reconciliation remains required. Stderr diagnostic overflow still intentionally fails the worker. Scope, model, cognition, schema, dependencies and allocation remain unchanged. Actual-process accelerated-clock fixtures establish the selected contract; the exact reviewed installation and elapsed live gate below establish absence of the observed five-minute churn during one bounded interval. Evidence and limits are in the [specification](../supervised-workers.md#verification-record).

## Acceptance and remaining limits

Exact candidate `beecd06d` from commit `c82b58e` passed fresh frozen review with 142 checks, one platform skip and four protected gates before authorized installation. The subsequent 361,387 ms live interval retained the same actual worker PID/instance and epoch across 13 API-200 samples, with no worker failure/recovery. All prior task/effect/memory prefixes were preserved while one new authorized Slack task completed. The original collector's total-table equality failure is retained separately from the successful prefix reconciliation; neither receipt is rewritten.

The full source run still failed its serving-policy events request (450 passes, one failure, one skip). Independent replays with the original finite worker reproduced that reset, so worker-session acceptance does not close [serving responsiveness](../serving-responsiveness.md). No collector inference or allocation reset was needed for the live gate. Broader product and security acceptance, hard resource quotas and universal availability remain open.
