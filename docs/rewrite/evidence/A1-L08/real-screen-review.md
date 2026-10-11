# Independent review of the eight-case ordinary application screen

Reviewer: `/root/a1_real_screen_review`; author: `/root/a1_real_screen`. Review base `869f627`; author's first frozen checkpoint `a407a60`, cherry-picked into the isolated review worktree as `9c1144b`. Review worktree `/home/palimpsest/migration/aeon-1-20261011/real-screen-review`, branch `aeon1-real-screen-review-20261011`. Exclusive changes: this record and `evaluations/product/screen-review.test.ts`. Runtime, configuration, contracts and author files are read-only to this reviewer. Root owns integration and physical-test scheduling.

The actual finite review goal covers only S01–S07 and S10 against the fixed mapping in `docs/rewrite/evidence/A1-L09/completion-readiness.md`. It does not qualify Q3, parity, development, twelve-case completion, deployment or H1. Governing inputs read: root `AGENTS.md`, `REQUIREMENTS.md`, `PLAN.md`, rewrite workflow, L02/L08 lanes and the fixed completion-readiness map. Review uses the inherited model and effort; no additional reviewer agent or model was substituted.

## Initial findings retained

The independent test file uses explicitly synthetic adversarial predicate witnesses; those are not actual model/tool executions. At checkpoint `a407a60`, the initial six checks produced three passes and three failures (zero skips), preserving the following concrete false positives:

1. S10 accepted a rejected child that correctly doubled 8 to 16, despite never failing the required 7-to-14 check.
2. S10 accepted rejection of a child that correctly doubled 7 to 14 when an unrelated command produced different output.
3. S02 accepted a sequence that replaced `check.mjs` with forced-failure and forced-success programs, then restored its original bytes. Final checker equality did not prove the original checker ran at the relevant times.

Passed independent checks at that checkpoint: missing child/parent inspection refuses acceptance; artifact reads reject traversal, absolute paths, symlinks and files larger than one million bytes; actual application admission followed by close/reopen preserves the original attempt row and original root budget/clock, rejects replay, and records zero physical requests. The reopen test cancels the admitted run before any provider is available; it is an admission/reopen check, not S08 process-restart evidence.

Source review also identified: the combined evidence cap retained the large witness/observation after clearing only payloads/checkpoints; original grant envelopes/start times were absent from the report despite synthetic state cleanup; string-only live seals could reach a route without authenticated observer grant binding. Root independently identified unaccounted private executable checks and omitted kernel limits. These findings were sent to the author; resolution and final validation follow below.

## Verification record and remaining gate

Node executable: `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` (24.13.0). Existing root dependencies are linked; no install occurred. On `a407a60` plus the first six independent tests, `node node_modules/typescript/bin/tsc --noEmit` passed. `node --test evaluations/product/screen-review.test.ts` exited 1 with 3/6 passing and the three intentionally exposed false positives above (764.731226 ms). These are original failed checks, not erased by subsequent fixes.

Author corrections `0268311` and `2fff2a9` were cherry-picked sequentially as `18e3ac1` and `ddce969`. The final semantic checkpoint uses exact frozen inline Node checker arguments, so writable checker restoration cannot satisfy S02. S10 now requires actual successful `double.mjs 7` receipts for both child judgments. Private executable probes reopen the original operational store, reserve under the existing run lineage and original clocks, propagate configured kernel limits, preserve physical command receipts, stop on uncertainty and cannot replay a used request identity. Reports retain original allocations/budgets/physical reservation charges and resource configuration; over-limit evidence fails and drops the full oversized projection. Both live entrypoints remain unavailable pending a separately qualified authenticated host route.

Independent checks at `2fff2a9` plus the reviewed test changes passed **12/12, zero failures/skips**, 1018.661923 ms; strict TypeScript also passed. New checks refuse private packets beneath candidate workspace mounts; require live closure despite self-asserted seal strings; reject substitution of either immutable inline checker; and call the real exported private-probe accounting function with an exhausted original request grant, an already uncertain original probe identity, and an expired original deadline. All three refuse before command execution and leave original budget, allocation and request rows unchanged. The uncertainty fixture retains its original 17-token charge and `uncertain` status. Those are synthetic ledger fixtures exercising the real preflight path; no lost physical command outcome is claimed.

An intermediate run at `0268311` had 10/11 passing: the live wrapper returned its argument-validation error before the requested explicit unavailable error. `runScreenCase` was already closed to live dispatch at that revision; this was error-routing evidence, not a demonstrated live-authority bypass. `2fff2a9` closes the wrapper directly.

Retained actual synthetic report audit, exact limits and final handoff disposition are pending. No physical scenario, paid model, provider network call, ambient credential read, Slack send, deployment or publication was performed by this reviewer.
