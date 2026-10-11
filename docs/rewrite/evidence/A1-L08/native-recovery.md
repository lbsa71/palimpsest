# Native recovery author source handoff

2026-10-11. A1-L08-T02/T03, RW03/RW19. Owner `/root/a1_native_recovery`, branch `codex/a1-native-recovery-20261011`, worktree `/home/palimpsest/migration/aeon-1-20261011/native-recovery`. Frozen base `f280a6d`; pre-code claim/plan `bbb8095`; implementation source **`7b2ba85`**. Governing [specification](native-recovery-specification.md) and [author claim](native-recovery-plan.md). **Source implemented and pure fixture-verified; fresh review, native acquisition, interruption proof and live qualification outstanding.** The actual finite goal remains active for review/acquisition. Whole L08/Aeon 1/H1 remains open.

Ordinary native attempts retain their one-attempt replay refusal and unconditional allocation cancellation. Explicit synthetic `recovery: { mode: 'start', checkpointId }` opts in before the first request, requires an empty original workspace, uses fixed workspace-local native homes and removes the ordinary persistence-disabling flag. Claude additionally requires its original isolated safe-mode real native profile with synthetic transport, explicit same-model roles and unchanged cognition/configuration. Native data remains inside `/work/.aeon-native-state/<product>`; observer/lease/artifacts remain private outside confinement.

The runner publishes readiness only after a successful native exit, a complete attributed native turn/tool/child observation, zero pending host/worker operations, known settled receipts, an uncancelled original allocation, and successful return through runWorker's awaited confinement cleanup. It records that host cleanup observation separately from lease ownership and exit. The existing OperationalStore commits sealed artifacts and readiness atomically. No shared runtime/kernel/storage contract was changed.

Explicit `recovery: { mode: 'resume', checkpoint: { id, generation, revision } }` acquires the existing process lease, verifies the original manifest/configuration/grant/ledger and remaining original allowance, verifies opaque native/workspace bytes, and consumes the exact ready revision into running before launch. Reopening the observer never allocates again; its original budget start/deadline, receipts, reservations and unknown charges remain. A consumed/crashed generation cannot be replayed; another checkpoint requires a newly observed quiescent turn and an explicitly requested new checkpoint ID under the same original allowance. Lease ownership plus a durable prior cleanup receipt supply different prerequisites; an already-held lease blocks another host.

Sealing retains directory paths/modes and ordinary file bytes/hashes/modes, uses pinned directory descriptors and no-follow opens, checks current ownership and hardlinks, refuses special files, and checks concurrent file/directory changes. Conservative checkpoint limits are 256 regular files, 512 total entries and 16 MiB for **each native tree and complete workspace snapshot**, declared in the original manifest. These bounds may refuse otherwise usable large workspaces; they do not truncate or increase the original grant/storage profile. Resume compares actual current bytes and refuses later workspace edits. Native-only restoration is deliberately unavailable in this slice; workspace effects are never restored or replayed. No transcript schema, fabricated history, synthetic summary, reset clock/grant or active-child continuation exists.

Workers parse bounded actual stdout and refuse provider RPC before a complete matching startup identity. Raw startup observations are retained with the original request artifacts; full raw stdout/invocation/environment remains in generation results. Known acquired initial schemas are Codex `thread.started.thread_id` and Claude `system.init.session_id`. Missing, late, wrong, duplicated or unsupported observations stop dispatch; no waiting/retry discovers identity after transport. Fixed UUID resume only; no latest, name, picker, fork, caller path/environment/hook or extra endpoint.

Root's preliminary source read identified a real draft defect: a different completion type could clear a pending Codex operation, and repeated completion IDs lacked attribution. Exact archived native command and collaboration positives reproduced it, with eight failed negative controls preserved in `quiescence-reproduction.log`. Repair binds started type/ID/command or collaboration identity and refuses duplicate/unstarted operations while allowing acquired unstarted reasoning/agent-message completions. Extended acquired causal controls also refuse failed commands/operations and active children. This author-stage feedback is **not** the required fresh independent review.

The command positive is the exact public stdout from original kernel trial `baseline-kernel-evidence/aeon-baseline-runner-dYnKPr/state/observer.sqlite`; its result artifact digest was recomputed before embedding the bytes in a new focused test. The collaboration positive is exact Codex attempt-2 stdout in `native-delegation-evidence/codex-delegation-attempt-2-nJYEbF/result.json`. These originals remain unchanged. Offline processing of the separate acquired successful Claude handback stdout also accepted session `056378eb-893e-4dd2-bde2-79af5d1bbcb0`, including full init/native plugin sources. This proves the acquired initial event parser, not resumed identity timing or native persistence.

Author evidence directory: `/home/palimpsest/migration/aeon-1-20261011/native-recovery-author-evidence/`. Every original failing log remains, including initial missing-module red, incomplete test-request fields, post-completion identity fixture misuse, the removed-import regression, and the actual quiescence reproduction. The source-injected worker tests run real worker code with fake process/HTTP boundaries. Runner tests mock only runWorker, exercising the real runner/observer/OperationalStore/ResourceLedger/ProcessLease through store and lease closure; no real native binary is launched.

Commands at source checkpoint:

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
env -i /opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --experimental-test-module-mocks --test evaluations/baselines/native-recovery*.test.ts
git diff --check
```

Future focused checks during a root physical window use `--test-concurrency=1`; no additional broad regression is planned after the final pass.

Strict compilation and whitespace check passed. Focused **59 passed, zero failed/skipped** (`focused-3.log`). Original observer cancellation/charges, actual held reserved/dispatched/uncertain records, unchanged original fake clock/allocation, changed launch identity/workspace/native bytes/ledger/lease/revision/generation, consumed replay, failed exit, missing completion, pending RPCs, tool/child failures, links/hardlinks/oversize, and actual startup-before-RPC causes are covered. Real runner controls verify refusal before next native launch or provider dispatch, except a wrong actual resumed startup is observed only after launch and refuses transport.

The broad pre-final-repair baseline command `env -i /opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --experimental-test-module-mocks --test evaluations/baselines/*.test.ts` passed **392, zero failed, 14 gated skips** (`baselines-2.log`). Its first run preserves the removed-import failure. The final broad run after the attribution repair passed **406, zero failed, 14 gated skips** (420 total; `baselines-final.log`). Empty environment disables physical opt-ins and native binary discovery. Historical/reviewer tests and evidence were not edited.

| Frozen source at `7b2ba85` | SHA-256 |
|---|---|
| `native-recovery.ts` | `b81d6470a6dd2118c5840e578a5f82028860a569a7558153dc704f787987d21c` |
| `run-native.ts` | `b876629c7c4cf288f9a15b64130103caf148afc4e1e5ead634b05ab2525891b9` |
| `observer.ts` | `76f4eada9cbd299691bcae45bead16c84a1919f4414147cefb6ef485ba992706` |
| `codex-worker.mjs` | `4731b9270c0d4e31e2b0e35be612cfda818da92296dcac98c687c692142aa671` |
| `claude-worker.mjs` | `bdd449eb4c11ffdd6292eff1d243e0094f225b04f0ad87832c5ae1f71ac1c3fb` |
| `claude-configuration.ts` | `90f798d73de915f82bead764aa234d0be192b6af2ce941525eb7f4fe0e60b502` |

Next entry gate: root assigns fresh independent review of this exact source and causal evidence. Only after its disposition may root allocate a serialized physical window. No CLI/help/native process, credential/account/provider access, paid inference, external network/message, installation, service, deployment or push occurred here.

The unchanged later physical plan is maximum **one acquisition, one positive and one negative per product**, serialized by root under the [fixed original caps](native-recovery-specification.md). Freeze exact native/source/runtime/kernel/configuration/argv, public response bytes, tool/result sentinels and an external instruction/charge/artifact inventory before first dispatch. Acquisition must capture complete pinned native store/flush/history and both actual UUID startup events before dispatch under one original grant. Acquisition failure blocks positive without fallback, retry or enlarged cap. Positive then requires a distinct host process after durable readiness, exact session/history continuation with a follow-up omitting prior marker/task/output, an actual new read and known completion. Negative interrupts an actual dispatched request and requires no new launch/transport, held uncertain charges, cancelled original allocation and cleanup. All first failures and unknowns remain. Exact resumed event ordering, same-session instructions/history, storage auxiliaries, active-child recovery, native context reduction, live competence/parity and H1 remain unavailable.


## Fresh review repair handoff

Root resumed this same active finite goal for the bounded findings in fresh reviewer `b10d8ce` (claim `a0522cf`); reviewer acceptance was withheld at the original source. Repair source **`6b51c3c`** changes only `native-recovery.ts`, `run-native.ts` and new author `native-recovery-claude-events.test.ts`. Reviewer-owned tests/evidence and all original native artifacts remain unchanged. The original source/hash table and first failures above remain historical checkpoints.

The author reproduced the exact seven reviewer controls against the original source: **one acquired positive passed, six controls failed**, retained in `native-recovery-author-evidence/review-author-reproduction.log`. A byte-identical temporary copy of the review test (SHA256 `e812b93d3a1ad8bf74098620c76604c479fd9925ce7d8400b846757a9cf76dde`) resolved imports against the author worktree; it was never edited or committed and was removed after verification. The reviewer's original failing logs remain in `native-recovery-review-evidence/review-first.log` and `review-kernel-first.log`.

The repair refuses explicit `is_error: true` regardless of completion metadata. It retains legitimate acquired Agent results with omitted error flags, binds each task to its original run/call IDs and unique observed Agent call, binds each child message/tool result to that task's original parent call, rejects task identity reuse, and attributes progress/updates and completed handbacks to the original task. An Agent handback must identify its completed child; notification cannot complete a child with active tools. The new author controls embed the complete unchanged acquired successful Claude stdout and its hash, preserve the original omitted error flags and native wrappers, and accept reversed independent sibling-result arrival. Additional tightly coupled mutations reject duplicate calls, foreign handback IDs, early handback and foreign task progress.

The runner observes actual `node:os` platform, architecture, kernel release and build version and includes them in the original immutable manifest before checkpoint consumption. Changed observed release/build metadata now refuses before another launch/dispatch while retaining the original allocation and ready checkpoint state. No caller kernel label supplies this identity. Existing original grant/clock/charges and runtime isolation contracts remain unchanged.

`NativeRecovery` is explicitly documented as a trusted host-internal coordinator. Its caller-provided outcome/artifact objects are not independently authenticated cleanup/admission proof. The public runner remains the authority boundary: it mints the cleanup observation only after runWorker resolves through awaited confinement cleanup. No new caller proof field or alternate public admission path was added.

Commands (serialized, no native/process trial):

```sh
env -i /opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --experimental-test-module-mocks --test --test-concurrency=1 evaluations/baselines/native-recovery-review.test.ts
env -i /opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --experimental-test-module-mocks --test --test-concurrency=1 evaluations/baselines/native-recovery*.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

Exact reviewer controls **7 passed, zero failed/skipped** (`review-author-repair.log`). Combined focused suite **73 passed, zero failed/skipped** (`review-repair-focused.log`), including the unchanged seven temporary reviewer controls and seven new acquired author controls. Strict TypeScript and whitespace passed (`review-repair-strict.log`). No additional broad sweep was run. The external author evidence index retains all previous logs and these new logs. These author executions support a repair handoff; they do not replace fresh reviewer acceptance.

The actual goal remains **ACTIVE**. Next owner is the same fresh reviewer, with root managing integration and slot/window allocation. No physical window or clearance was issued; acquisition/interruption/session-history/instruction gates and all live/context-reduction exclusions above remain unchanged.

| Repair source at `6b51c3c` | SHA-256 |
|---|---|
| `native-recovery.ts` | `9110d64396c9f89c6a76e07cfa175845c3e9c4c52697fa1238f2b611d8a2ba08` |
| `run-native.ts` | `7e6fc39c09e2b36ee75effaf56f15758adc93e7d5846554b977f8e80353d7ea7` |
| `native-recovery-claude-events.test.ts` | `64b3db769a17d31794ae1a156fc625b6fe0685ead5822caa9e135159c9fb0fe8` |
