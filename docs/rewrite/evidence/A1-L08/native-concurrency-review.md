# Independent native concurrency review

2026-10-11, A1-L08-T02/T03/T06. Reviewer `/root/a1_native_concurrency_review`, fresh context, isolated worktree `/home/palimpsest/migration/aeon-1-20261011/native-concurrency-review`, branch `codex/a1-native-concurrency-review-20261011`. The originally supplied branch name already belonged to the author, so this separate review branch was created without modifying it. Exclusive changes are this report and `evaluations/baselines/native-concurrency-review.test.ts`; no production changes were needed.

An actual finite goal was created before review: independently inspect the frozen concurrency implementation, challenge its request/accounting/stop boundaries, audit retained native evidence, and hand off a bounded disposition. Governing criteria are the [predeclared specification](native-affordance-specification.md), active requirements, workflow and A1-L08 lane. Root retains integration and capability acceptance authority.

## Disposition and exact scope

**Accept the bounded bridge concurrency engineering change for integration. No consequential defect was found in the reviewed change. Native child continuation remains unavailable for both products.** This is not native delegation, kernel child enforcement, model competence, best-system parity, live entitlement or H1 acceptance.

Reviewed runtime and fixture source is exactly `f9f55fb93f4bf5875bd1275bfa756a49889c2e67`, including author implementation `7d77ca8e5eb14850410003d51b7abe3ceef57b88` and stop-race repair `b8d65f9e3b59e3b3e7b021030c64e5a5a722615f`. Final author evidence prose was separately read at `6b2433933e519a7a06a4c1571fe25131a6507eb6`; changes after `f9f55fb` are documentation only. Both retained native source inventories match every non-test source file in the review worktree; inventory digest `8bc1dc9d851607cc2e10d0d8a01bf841bb0365ead6ff3e0c6ae6418e1009a278`.

Inspection covered observer grant validation, both worker HTTP/body/RPC lifecycles, immutable runner specification and invocation, existing eight-pending-RPC host boundary, resource ledger reservations/settlements, process lease and attempted-run refusal. The host retains original authority: positive integer concurrency 1–8 does not enlarge request/token/cost/time limits. Local body reads consume slots before buffering, and the repaired stop fence precedes RPC. Unknown outcomes cancel the original allocation and abort active siblings; each sibling settles independently. Existing profile, pricing, beta, tier and full-context reservation checks remain intact. Runner completion records describe process completion; in particular the Claude record with native exit 143 is not a successful workload result.

## Independent adversarial verification

Four new deterministic checks run actual observer code and actual worker source with injected HTTP/process boundaries; they execute no native CLI, namespace, socket or provider call:

- Two distinct requests finish in reverse order. Exact input/instructions, transformed payload digest, reservation/prompt identity, response bytes and differing charges stay attached to the correct request. Mutating the caller's grant cannot expand the live slots or alter prices.
- Cancelling one request while its sibling is blocked reading a partial response aborts both, retains partial response evidence, holds both full reservations and refuses replacement dispatch.
- For each worker, eight partially read bodies exhaust all local slots before any RPC; the ninth is refused. Tagged replies bind by ID, and replaying one completed reply while seven siblings remain pending rejects those siblings and prevents new dispatch.

All four passed on their first review execution. No failed reviewer check was repaired or discarded. The author's earlier four concurrency-barrier failures and two slow-body stop failures remain retained and were inspected separately; their fixes are exercised by the full suite.

Commands and observed results, Node 24.13.0:

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test evaluations/baselines/native-concurrency-review.test.ts
# 4 passed, 0 failed, 0 skipped
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-name-pattern='^(?!actual )' evaluations/baselines/*.test.ts
# 204 passed, 0 failed, 9 explicitly opted-out physical checks; 10.426 seconds
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node /home/palimpsest/src/palimpsest/node_modules/typescript/bin/tsc --noEmit --typeRoots /home/palimpsest/src/palimpsest/node_modules/@types
# strict compilation passed, using the existing dependency installation
git diff --check
# passed
```

The reviewer performed no physical rerun, paid inference, credential discovery, network/auth call, installation, messaging or production mutation. Physical evidence below is the author's original separately authorized execution, independently inspected read-only.

## Retained physical evidence audit

Evidence root: `/home/palimpsest/migration/aeon-1-20261011/native-concurrency-evidence`. Independent SQLite inspection checked all 23 content-addressed artifacts across four databases, original declared grants against persisted grants/allocation envelopes, cancelled root allocations, exact payload/reservation binding, retained native instructions/input/tools/cognition before versus after accounting controls, and source/worker/fixture program hashes.

| Original trial | Observed result | Supported conclusion |
|---|---|---|
| `codex-children-KTQiCm` | Two known parent attempts, each 100 input + 10 output tokens and 0.0006 synthetic USD. Two separately retained child requests contain `agent_message`, attributed from `/root` to `/root/native_child_0` and `/root/native_child_1`, with text and encrypted content. Both fail validation before transport. | Actual native spawn/request emission exists; no admitted child continuation, artifact, parent integration or concurrent child transport. |
| `claude-children-gAsktO` | Actual tool definitions are Bash/Read despite Agent/Bash/Read/Write selection. One admitted fixture transport fails its Agent assertion, leaving unknown usage and the original 1,004,096-token/8.08192 synthetic USD hold. | This exact selected bare configuration does not expose Agent. It does not show that Claude generally lacks delegation. |
| `codex-bridge-only-BV03rb` | Fake-native label retained; two known receipts, peak two, third HTTP 403, 30 tokens/zero USD. | Actual namespace/HTTP bridge concurrency only. |
| `claude-bridge-only-MNaAzO` | Same explicit fake-native label and two-receipt/overflow result. | Actual namespace/HTTP bridge concurrency only. |

Original native trial transcript SHA-256 `79fd24886d778bf029cd6493fccf4b3c505991ae95e35578bb6840a466869250` preserves both failures. Bridge transcript SHA-256 `14dd83c9f442a294dfcf29a96a13ee39f44121a89e61fd3ed62eefaa645bafab` preserves two passes. Earlier first-failure transcripts retain digests `05824154757db39878ee273c1391e2252a36f416c3b1c9e6ca70f4323c1eae6e` and `b6ca9006137ace805dcfc9768dcf59945f2f07f8583a80562ebe8bd697b57a13`. Independent audit summary `reviewer-audit.json` has SHA-256 `5cdd2a157fa88b8db0f8dad403f83507c58d6817d1c62a5b55ea3ff6a296dc8d`; the complete pure-check transcript is `reviewer-pure-checks.txt`.

The next native gates remain narrowly defined: qualify Codex `agent_message` attribution and opaque content before admitting it, and acquire Claude's actual delegation surface and effective instructions under an explicitly declared configuration. External research, durable native recovery/context reduction, compatible issued grants, paid Claude beta qualification, independent workload quality and elapsed development remain open. The 144,000-token proposal still cannot fund the current full-context native reservation. Root may integrate this review and the author change without changing those limits.
