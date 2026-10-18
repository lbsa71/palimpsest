# Live coding limb and concurrent conversations — 2026-10-18

The user authorized deployment, a real Slack coding question, inspection of its results and a follow-up in the same coding session. The deployed candidate completed both turns and was accepted at 10:51:50 UTC on 2026-10-18 after independent live review. The Autark inspected `code_status`, read the actual files and delivered both reports in the original Slack thread. A separate conversation received a reply while native coding was running.

This completes the finite L06/L09 coding deployment task, including the later Sol 6.1/high pin and temporary-capacity queuing requirement. The [implementation record](../A1-L06/coding-limb.md) describes the provider abstraction, commands, Pi alternative and isolated live five-turn test with a scripted mind. The broader Aeon backlog remains hibernated; this is an engineering pilot, not H1 or general autonomous-development qualification.

## Exact deployment

| Identity | Value |
|---|---|
| Frozen source | `bd8f13e94368ed58c989bf4111189d1444760667` |
| Candidate | `5b1930c8f5fdd992ca7c68f6f43a138bc55f82331cf6264ba812b0670b095e0d` |
| Controls | `af2080362a3cd9cc1282098ad5a657af249bff485ce648a7f575665474bcf79c` |
| Policy | `37b8d467e57b6592404d4eb27c7fa65a25702773f75c603b8ff31302b2fa6a57` |
| Prior judging policy | `831c06244faed7dd87a32ae14c664760075420c737f900cc13ff3efd65dc85b6` |
| Retained recovery candidate | `a96c51a3705c8e61d29e8c40da238b3f4f2e6f2d7dce80cab4535078e9dcc1f2` |
| Service | `aeon-pilot.service`, generation `0a3c835a-c7ff-424c-9d15-58c3faa1100a`, epoch 89 |
| Coding | Codex CLI 0.163.0; `gpt-6.1-sol`; `high`; 240,000 ms maximum invocation; 2,000,000 output bytes |
| Mind | Existing Mistral Large 4 profile, effort `none`; independent of coding provider |

The old coordinator executable remains pinned. Previously accepted controls judged the new control stage and probation. The candidate contains 1,508 source files checked against the clean frozen revision. Dedicated owner-private Codex authentication lives outside the checkout and is denied to native tools. Node is pinned to 24.13.0. Native binaries are root-owned; the service's read-only `/tmp` required policy staging inside its already protected writable state directory.

Existing service/process isolation, memory/PID/CPU/file/workspace bounds, original allocations and seven-day elapsed allowance remain in place. The accepted nullable cumulative caps and all three allowance amendments were preserved. No allowance start was reset. Coding remains one durable agent and one active turn; exact native-session resume is mandatory, with no fallback, automatic replacement or subagent fan-out.

Private deployment evidence is under `/home/palimpsest/migration/coding-limb-deploy-20261018/`; final candidate evidence is in `revision-3/`. These directories contain host inputs, immutable candidate identities, signed stage/probation proofs, raw inspections, independent reviews and retained earlier failures. Credentials and private transcripts are not committed.

## Why threads stalled, and what changed

The first live overlap reproduced a capacity failure before model dispatch: seven old uncertain requests occupied seven of eight execution slots indefinitely. Uncertainty about cost or external outcome had been conflated with whether a physical process was still running.

Execution occupancy now has separate durable release evidence. A completed/aborted HTTP transport, a successfully drained bounded Codex process, or exclusive host recovery after process cleanup can release occupancy without changing the original request, charge or uncertain outcome. Elapsed time alone does not release a live request. A generic effect whose cleanup is unknown retains its slot until trusted cleanup evidence exists. A request cancelled after authorization but before receiver entry releases occupancy while retaining its reservation; a later first dispatch must reacquire capacity.

Temporary capacity exhaustion now waits on capacity-change notifications, keeping the same request identity. It does not reject the conversation or poll/retry the provider. Cancellation and the existing finite worker deadline remove the wait before dispatch; permanent authority or budget failures remain explicit. Subscription precedes the first attempt, avoiding missed wakeups. The health response exposes queued work. Unknown physical dispatches are never automatically replayed.

At the final live snapshot, all 450 pre-activation requests (including eight uncertain records and their revisions), 27 original allocations, three amendments and 328 developmental record digests were preserved. A second comparison against the earliest 394-request deployment baseline also passed. There were 489 requests, ten still uncertain, zero held execution slots, no active/pending runs and no queued capacity waits. Health returned HTTP 200 with execution admission available. Unknown financial accounting was retained throughout; no history was purged to restore availability.

## Actual task, follow-up and inspection

The authorized user/bot DM contains coding thread `1792320071.860979` and overlapping acknowledgement thread `1792320114.027869`. The production coding home contains exactly one native rollout:

```text
native session  01a14e9a-f676-7f22-b71b-08cdc6111a4e
host session    coding:9ec8099a21a6a8f0103a5561279f325d07e6b4d596921f38c91dbbd3ae4a8087
child run       run:009c09d8528041374c733e2b746b7c65aba48d69f86e7a1569b1a21ee7b22890
```

The first question requested finite-number `clamp(value, min, max)` and tests in the thread's scratch workspace. Codex created `clamp.mjs` and `clamp.test.mjs`, ran the tests and retained seven passing cases. The follow-up requested `TypeError` for nonnumeric/nonfinite arguments and `RangeError` for inverted bounds. The exact same session read the existing files, changed only those two files, retained the original seven tests and added 34 cases. Actual native command output reported **41 passed, zero failed**, exit 0.

Both native `turn_context` records identify `gpt-6.1-sol` with `high` effort. Turn 2's exact argv resumes the recorded UUID. There are no observed collaboration events or nested agent-CLI commands. One session and two completed/notified turns remain in the durable host records.

The Autark called `code_status`, inspected both files and reported the results. Its initial absolute `/work/...` reads failed the workspace-relative-path contract; it corrected them to relative reads. Its first attempt to invoke bare `node` was rejected by the executable grant; it did not claim that attempt passed. On the follow-up it successfully executed its own granted test command and observed **41/41**. Both reports have successful exact-thread delivery receipts; the final report is message `1792320472.246819`.

Native `node --test clamp.test.mjs` summarized one test file in that environment. Native direct `node clamp.test.mjs`, the Autark's separate successful test command and independent host execution each exposed all 41 cases. These observations are retained separately.

Fresh artifact inspection ran **117 additional cases**: 24 finite-value cases, 66 invalid argument/position cases, 22 validation-order cases and five inverted-bound cases. All passed, with zero coercion-trap calls. A separate release reviewer passed another 69 held-out cases. Both audits verified original-test retention and unchanged workspace hashes during inspection. These counts are separate checks, not a claim of 186 unique cases.

```text
clamp.mjs       bed08bf254c61d0cfa51649a53fe9071787921a267452b02a745368423f6182e
clamp.test.mjs  6cb5d06a67d81f1466ed2deaad28c601c94c53978e8ccf22f2547a46e42869fd
```

The generated unit stays in its original scratch workspace. It is a deployment test, not a requested product feature to integrate into the application source.

| Native turn | Input tokens | Cached input | Output tokens | Observed process duration |
|---|---:|---:|---:|---:|
| Initial implementation | 60,397 | 56,064 | 1,129 | 30,724 ms |
| Same-session adjustment, incremental | 70,166 | 66,688 | 868 | 23,627 ms |
| Cumulative | 130,563 | 122,752 | 1,997 | — |

The ledger settles incremental tokens, not the cumulative session total again. Actual billed cost and internal physical API request counts remain unknown. The conservative USD 5 charge per invocation is an accounting ceiling, **not** an observed invoice. No measured cost-saving claim follows from this test.

## Preserved failures and parallel-thread result

Two earlier probation attempts were retained and recovered to the accepted incumbent before staging replacements. The first exposed stale capacity. The second restored capacity but stopped before creating any coding session: omitted optional `speech_send.threadTs` caused a pre-send exception and an uncertain receipt. The repaired speech boundary binds an omitted thread to the authenticated conversation, rejects explicit foreign targets before sending and preserves real transport uncertainty. Durable report intents retain the trusted destination for receipt confirmation without rewriting original effect payloads. Older unbound intents retain their strict checks.

During the final trial, the initial coding parent's Mistral transport failed before a response, after queuing the coding task. Its unknown receipt was retained. Native completion subsequently woke the owner with a new observation; the owner inspected the result and completed. This did not replay the failed physical request.

The separate Slack thread delivered an acknowledgement while the Codex process was active. Its subsequent Mistral transport failed, and the host posted an explicit failure notice. Thus the overlap proves concurrent responsiveness, **not** error-free completion of that second conversation. Both new Mistral failures retain unknown usage and no HTTP response; their underlying cause is not established by the available transport record. They no longer permanently consume execution capacity after the host transport ends.

## Checks and release disposition

Focused verification used the pinned Node runtime and `--experimental-test-module-mocks --test --test-concurrency=1`. Relevant suites include `packages/coding/coding.test.ts`, `packages/runtime/test/resource-capacity.test.ts`, `packages/runtime/execution/capacity.test.ts`, `capacity-runtime.test.ts`, `deployment/broker-capacity.test.ts`, `resource-application.test.ts`, coding/process/application/budget tests and speech/initiative/communications tests. Strict compilation and build passed; the frozen candidate's strict check also passed.

The final source checks include 58 passing coding/process checks with one native-binary environment skip, independent 34 passing capacity/runtime/broker/budget checks, and independent 50 passing speech/communications/initiative checks (author joined run: 55). Actual live native execution and real namespace cleanup were separately inspected. Fresh review found and required repairs for unproven effect cleanup release and cancellation between authorization and receiver entry. Those regressions passed after repair. The five pre-existing application assertions documented in the [implementation evidence](../A1-L06/coding-limb.md#verification-and-review) were not weakened; there is no all-repository-green claim.

Reproducible final evidence includes `revision-3/inspect.ts`, `inspect-final-clamp.mjs`, `independent-stage-review.json`, `independent-live-checks.json`, `independent-final-clamp-checks.json`, `final-clamp-independent-audit.json`, `live-complete.json` and the root `final-all-history.json`. The independent evaluator is `sol-slack-pilot-bootstrap-review`. Its accepted `independent-live-review.json` has SHA-256 `6df47b1bd7989a05fc4893630078b48195a1ae791adfde966a5f786a45550315`; the signed `probation-proof.json` binds that exact artifact, candidate and prior judging policy.

The authorized release command was `node /home/palimpsest/migration/coding-limb-deploy-20261018/revision-3/release.ts probation`, using the pinned Node runtime. It completed successfully. `accepted.json`, captured at 10:52:03 UTC, confirms phase `accepted`, the exact candidate above at epoch 89, HTTP 200, available admission, zero queued/pending work, one retained coding session, two completed/notified turns and all baseline-preservation predicates true. `systemctl is-active aeon-pilot.service` returned `active`. No restart or additional inference was needed to accept probation. The handoff revision is the commit containing this record; executable source remains the frozen revision above.

The retained coding session remains bound to its original conversation, audience, workspace and ancestor allowances. Continued work does not renew expired or cancelled grants. Concurrent conversations can wait for temporary capacity within their finite worker deadlines. This task does not add indefinite execution, uncertain-effect replay, automatic agent replacement or a new allowance.
