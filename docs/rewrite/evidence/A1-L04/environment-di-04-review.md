# DI04 independent memory environment review

2026-10-12. Owner `/root/a1_environment_memory_review`, frozen base `8e257fc`, author `c249aa6` imported at `3cc6ef9`; DI01 `ae3e043`, adopted DI plan `f0bb502`. Isolated branch `codex/a1-environment-di-04-review-20261012`. Only this evidence and new `deployment/environment-di-04-review.test.ts` are writable. Source and existing predicates remain read-only.

```text
/goal Independently review the frozen DI04 memory environmental boundary with held-out causal tests and selected real application integration, run strict and serial targeted checks, and return an exact two-path accepted-or-changes-required handoff without repairing source or awaiting siblings.
```

## Frozen independent criteria (before test execution)

1. Capture each supplied callback once, including accessor-backed ports; invoke it receiver-free. Caller replacement and another instance's fake state cannot alter an existing instance. Production comparison must have the same sign as default `localeCompare`, including Unicode equivalents; equal comparison preserves deterministic Store order. Tie comparison also controls adopted self and due jobs without overriding relevance or recency.
2. Wall time is an ISO timestamp with an explicit timezone, not host-dependent permissive date parsing. Invalid values or a supplier throw must propagate without changing retained state, including source-current-use checks during consolidation claim. The expected timestamp can differ from real host time.
3. Retrieval durations are finite nonnegative differences of supplied nonregressing readings. Exact zero and very large finite readings remain valid; invalid ends and throws cannot change records, self, jobs or journal.
4. At the exact injected expiry boundary, source, descendants and self/history become unavailable; expiry cancels jobs and withdraws actual journal payloads. Before it, leased consolidation works; after lease end it cannot complete or leak sources. Reopen must preserve withdrawal and stale-source rejection.
5. Forget/expiry ID supplier exceptions and collisions with a prior genuine withdrawal atomically roll back memory, self/history, jobs and all journal content. A subsequent good supplier result can complete the same operation. Current-use access to an old withdrawn journal ref must reject after success.
6. Selected real application integration must preserve authenticated memory retrieval/forgetting and actual tool audience boundaries. Use in-process exposed application/tool boundaries only: no listener, subprocess, provider, native mechanism or network. DI14 application-wide injection and DI09 Store internals remain open; no H1 claim.

Validation uses pinned Node `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`, the existing root dependency tree, controlled temporary actual SQLite Stores, explicit ports, serial affected checks and strict TypeScript. No new global/module mocks, changed old tests, source repair, credential access, Slack, benchmark, push or deployment.

## Disposition: changes required

Criteria were committed at `6798f15` before tests. The final 19 held-out checks report **14 passed, 5 failed**, no skips/cancellations, 1.078 seconds. The five failures establish two findings; source and old tests are unchanged. The unchanged author suite plus four existing memory/journal suites report **42/42 passed** (14 author + 28 older), no skips/cancellations, 4.235 seconds. Strict TypeScript and `git diff --check` pass. These finite review results do not accept DI04 until the findings are repaired and independently checked.

### R1 — P2: clock failure becomes durable source cancellation

`packages/development/index.ts:199–201` catches every exception from `activeSources`, writes the queued job as `cancelled` with `source unavailable or revised`, and returns without surfacing the error. In each held-out probe the clock returns valid `at` for ordinary claim admission, then either throws the original supplier error or returns an invalid timestamp during the expiring source's current-use check. Both probes observe a changed full Store snapshot: job revision advances, pending becomes cancelled, and a journal mutation/new payload is retained. The source was valid at the accepted claim time. This violates the frozen environmental failure/no-mutation semantics and irreversibly loses queued work through an unrelated clock fault.

Repair belongs to the source owner: distinguish genuine unavailable/revised source from clock or Store faults, propagating the latter through the transaction. Do not remove valid expired-source cancellation: the paired healthy-clock expired-source control passes. The broad catch predated the DI04 edit; DI04's new environmental contract makes this an unclosed failure path, rather than proof of a newly introduced cancellation regression.

### R2 — P2: the ISO wall callback still accepts host-dependent date parsing

`packages/development/index.ts:31` promises an ISO timestamp but delegates to the permissive `Date.parse` check at line16. All three held-out probes accept `2040-01-02`, `2040-01-02T03:04:05`, and `January 2, 2040 03:04:05 GMT` instead of rejecting. In particular the timezone-free date-time silently depends on the host timezone, defeating the explicit wall-time port. Reject malformed/non-ISO and timezone-free wall callback values at that boundary before using them for expiry/lease decisions. This finding is about the new wall callback contract, not a request to alter every existing timestamp wire validator. The positive explicit-offset ISO control (`2040-01-02T04:04:05+01:00`) preserves the same instant and exact expiry boundary; UTC-only canonicalization would need an explicit stronger contract decision.

## Passing held-out evidence

Accessor-backed callback values are read exactly once per constructor, remain captured after replacement with throwing accessors, and every supplied callback is invoked receiver-free. Separate instances keep wall, elapsed and withdrawal state independent. The concrete Node adapter matches host `localeCompare` signs over ASCII, numbers and Unicode canonical equivalents. Comparator equality retains stable Store order for memories, self and jobs. Zero and maximum finite monotonic samples produce finite exact durations with no mutation; the unchanged author failure matrix supplies thrown/nonfinite/regressing readings. Static inspection confirms relevance and recency precede the injected tie comparator.

Actual SQLite/journal expiry at the exact supplied boundary removes source and descendant retrieval, self/history visibility, and job eligibility. A prior leased job refuses source access at the exact lease end without writes. Successful expiry persists across reopen and the actual `withDevelopmentVersionsAvailable` fence refuses the old journal refs without entering its callback. ID supplier failure and collision with a real previous withdrawal marker preserve complete snapshots; a fresh identity then completes the same expiry and cancels the dependent job.

The new application case constructs the real `AutarkApplication`, exercises its default memory composition and actual `mindDevelopmentTools` retrieval/forget boundaries, reopens its persistent state, and confirms foreign memory survives while owned raw journal content is withdrawn. A second actual tool-boundary case uses explicitly injected memory to prove captured audience and supplied expiry remain authoritative. Neither starts the application, listener, worker, provider or scheduler; no requests are recorded. These are composition/tool integration checks, not a full runtime conversation or physical-worker qualification.

## Reproduction and limitations

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 deployment/environment-di-04-review.test.ts
# exit 1: 19 cases, 14 pass, 5 fail (R1 two, R2 three)
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 deployment/environment-di-04.test.ts packages/development/test/development.test.ts packages/development/test/journal-forgetting.test.ts packages/development/test/journal-retention.test.ts packages/development/test/journal-retention-review.test.ts
# exit 0: 42 pass
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

Final raw receipts: `/tmp/aeon-di04-review-final.log`, `/tmp/aeon-di04-review-regressions.log`, `/tmp/aeon-di04-review-strict-final.log`. Earlier harness-only failures are preserved in `/tmp/aeon-di04-review-first.log` and `/tmp/aeon-di04-review-second.log`: the new fixture initially exceeded Store snapshot bounds and used an unsupported retained-artifact URI/digest. Only new fixture plumbing was corrected; no acceptance predicate or production bound changed.

No dependency installation: this worktree links the existing `/home/palimpsest/src/palimpsest/node_modules`. No ambient/module mocks, source repair, old-test changes, sibling import, network, credentials, provider, native/physical process, Slack, full benchmark, push or deployment. Runtime DI03 proceeds separately. DI09 Store internals, DI14 whole-application composition, live capabilities and H1 remain open. Next owner is root for a finite R1/R2 repair on exact reviewed source followed by unchanged held-out rerun. This review goal completes with a clean two-path changes-required handoff.
