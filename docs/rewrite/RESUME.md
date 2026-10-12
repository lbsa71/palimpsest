# Resume Aeon 1 after the 2026-10-12 hibernation

**Later user instruction, 2026-10-12:** the [Slack pilot](slack-pilot.md) is resumed as a narrow task. Get an ordinary live instance working; fix only actual launch/conversation blockers. Sol-only delegates. The remaining broad Aeon 1 work is still hibernated; the historical restart sequence below is not a prerequisite for this pilot.

**Work is hibernated at the user's request. Aeon 1 is unfinished; no agent is authorized to continue automatically.** The user asked every agent to finalize only its current item, deactivate its goal, preserve current work and stop. All three remaining child goals finished their finite handoffs, and all child agents were stopped/completed. The overall unfinished goal is paused at final shutdown. The available goal API supports pause/completion, not deleting goal history; completed child goals are inactive. Historical owner names and `/goal` examples elsewhere are not active assignments.

This guide supersedes stale current-owner labels in older evidence. Requirements, adopted ADRs and acceptance criteria still govern the work. No source or evidence is upgraded to accepted by hibernating it.

## Repository and preserved checkpoints

Main checkout: `/home/palimpsest/src/palimpsest`, branch `codex/aeon-1-implementation-20261011`, remote `git@github.com:lbsa71/palimpsest.git`. The last code/review checkpoint before shutdown documentation is **`1a72ad8`**. Read `git log` for the later documentation checkpoint. No shutdown push or deployment occurred. Source worktrees are under `/home/palimpsest/migration/aeon-1-20261011/`; retain them and their refs.

| Item | Exact state | Next action after resumption |
|---|---|---|
| DI02 timing/driver | Fresh acceptance `9f6790a`,52/52 | Preserve; full application forwarding is still DI14 |
| DI03 runtime | Fresh acceptance `bddd9bf`,53/53 | Preserve durable elapsed-floor semantics |
| DI04 memory | Fresh acceptance `f501511`,79/79 | Preserve clock and error propagation |
| DI05 initiative | Fresh acceptance `9ad8a20`,61/61 plus selected driver1/1 | Preserve primary/cleanup failure identity |
| DI06a schema | Fresh acceptance `63a67fb`,123/123 and source audit | Preserve deterministic base and immutable provenance |
| DI07 communications | Repair `fae9434`; fresh acceptance `f0f297b`,120/120; main `7ad4aa4` | Accepted bounded environmental/cleanup slice; live interaction remains open |
| DI06 shell | Source `1667278` plus Pi metadata `abad092` joined at `d53ccda`. Fresh review `ea97739` imported at `1a72ad8`: prior73/73, independent17/21 | Repair two findings below; subsequent fresh review required |
| DI09 storage | Author `39d995b` imported at `af817a9`; fresh review `d8cd34b` imported at `be84643` | Import isolated repair below by exactly seven paths, then fresh review; two older fixtures remain separate |
| DI10 supervisor | Author `5b1463c`, source/test `f123c26`, imported at `93cdf45`:60/60 plus strict | Fresh review queued, not started |
| DC2 R5 attribution | Clean three-path `1a04f411238f1428f387ade59078da7e0e925bf6`:48/48 focused, strict | Unintegrated; exact import then fresh review before semantic b2b |
| Recorder/driver | Mechanical b2a accepted `2b3c16f`,83/83; timing/forwarding accepted | DC2 acceptance → semantic b2b → b3b driver → fresh semantic join |

Passing counts refer to the recorded bounded revisions and commands, not a new aggregate. Current main contains preserved failing independent cases. Last historical aggregate green was `746afac525d1112f3e3beb4c1c0fec7967e50697`:1,256 total,1,238 pass,18 opt-in skips, strict/build. It does not qualify current HEAD.

### Clean, unintegrated authored repairs

**DC2:** branch `codex/a1-development-control-attribution-repair-20261012`, worktree `development-control-attribution-repair`, handoff `1a04f411238f1428f387ade59078da7e0e925bf6`, parent `0b967f4`, precode `cc26596`. Owns exactly:

- `evaluations/development/development-control-proof.ts`
- `evaluations/development/development-control-attribution-repair.test.ts`
- `docs/rewrite/evidence/A1-L08/development-control-attribution-repair.md`

Production blob `e3f6427355c0dcf54f77dd37953ff905cf3a46fd` validates original physical attribution before exclusions. Final affected32/32 and authored8 plus prior independent8 give48/48; strict passed. Original counterexamples, initial fixture construction and payload-diagnostic ordering failures are preserved in the evidence. Root's deterministic old binding-selector change `54f428c`, main `c2c078f`, was used as a separate test dependency (`4a1daab`) but deliberately excluded from the three-path handoff. **Do not overwrite that main test file with the author's older baseline.** Full proof with imported pre-registration anchors remains blocked by the unchanged first-profile application guard; no acceptance is inferred from accounting-only anchor checks.

**DI09:** branch `codex/a1-environment-di-09-repair-20261012`, worktree `environment-di-09-repair`, handoff **`65b1c18fef18c04c98e8b242e85ceee3bbc4e696`**, claim/base `f19aadf`, precode `cb2c1e6`. Owns exactly:

- `packages/storage/index.ts` and `packages/storage/environment.ts`
- `deployment/environment-di-09-repair.test.ts`
- `deployment/environment-di-09.test.ts` and `deployment/environment-di-09-review.test.ts`: only one actual `transactionActive` forwarding property each; every other old byte verified unchanged
- `docs/rewrite/evidence/A1-L03/environment-di-09-repair.md`
- `docs/rewrite/evidence/A1-L09/environment-di-09-port-integration.md`

Adds the captured native `transactionActive()` port to handle real BEGIN followed by a thrown acknowledgement: prove no transaction, roll back, or fence uncertainty before further acknowledgements. Original independent R1 reproduced0/1 with an acknowledged artifact disappearing on reopen. After repair, original50/50 and new15/15 pass, strict passes. Before/after entry and rollback, non-Error failures, failed observation, nested savepoints and captured identities are covered. Fresh acceptance and exact joined compilation remain pending. Both isolated repair trees are clean and committed.

Import only the enumerated paths into a newly claimed integration/review base. Inspect any intervening diff before restoring paths; do not merge whole historical worktree branches or silently replace main tests. Preserve the author commit IDs and observed failures in the integration evidence. Source import is not fresh acceptance.

## Known failures and queued work

**DI06 R1:** OpenAI response reader cancellation/unlock failure is settled as `failed` instead of `uncertain`; actual ledger reproduction refunds elapsed50→0 and releases concurrency1→0 despite failed cleanup. Three independent cases fail. Mistral passes the analogous cases. **R2:** a caller callback can replace `ShellBridge.settle` after run entry; completion can skip the original receiver. Capture the full receiver family before caller callbacks, preserving receiver binding. One independent case fails. See [fresh review](evidence/A1-L02/environment-di-06-review.md); do not turn genuine protocol-only errors into cleanup uncertainty indiscriminately. No repair has started.

**DI09 older fixtures:** the separate-conversations physical-page test observes603 rows versus551 after accepted elapsed-floor history adds52; the journal test compares first allocation revision1/floor0 to current revision2/floor5–6 before close/reopen. Both were reproduced against older storage; neither establishes a reopen failure. Keep these DI27 gates open. Prefer explicit deterministic application clock composition under DI14 before claiming a fixture correction; preserve original complete-page/capacity and first/current history obligations. Do not raise caps or weaken assertions to make them pass.

**DI10 review:** `environment-di-10-review`, branch `codex/a1-environment-di-10-review-20261012`, was created at `2c4e840`. No reviewer was launched and no goal, review precode or test was created. Rebase/recreate a clean isolated review base deliberately if integrating newer dependencies. Read [author evidence](evidence/A1-L09/environment-di-10.md) and the exact final review claim in [execution](execution.md). Only the positive four preflight selectors from author evidence are authorized by that old claim; broad process suites can launch physical operations.

**Environmental backlog:** the adopted [29-task plan](evidence/A1-L09/environment-di-plan.md) remains authoritative for interfaces and dependencies. DI08 and DI11–DI25 remain open except their explicitly recorded narrow slices. DI26 schema/Pi provenance work does not finish its scripts. DI27 fixture integration is partial; DI28 whole-environment closure is unstarted. Full application/worker/entry composition must forward the accepted ports. No legacy support is required.

## Restart procedure and parallel tasks

1. Wait for the user to resume. In a new session read this guide, [AGENTS](../../AGENTS.md), [PLAN](../../PLAN.md), [workflow](workflow.md), [execution](execution.md), the affected lane and its exact evidence. Inspect current branch/status/log and existing worktrees. Do not recreate the old service or repeat a consumed attempt.
2. Resume/create the overall goal only under that new user instruction. The existing paused goal cannot be resumed by `update_goal`; use the client's resume control where applicable. In a fresh thread, an explicitly requested new goal can use the statement below. Each new child must create its own finite goal before work; no historical completed goal needs resurrection.
3. Root claims exact-path integration of the two clean repair handoffs and checks the resulting types/call sites before fresh review. Preserve independent tests, accepted deterministic selectors, limits and diagnostics. Commit the integration base so reviewers have an exact source revision.
4. Fill at most three child slots concurrently, with root as the fourth agent: first DC2 fresh review, DI06 repair and DI09 fresh review. As a slot frees, launch DI10 fresh review. If an integration prerequisite is unresolved, DI10 can occupy that slot without waiting. All ownership must be recorded before edits; use isolated worktrees.
5. After acceptance, proceed through semantic b2b/b3b and the DI dependency graph. Full aggregate and physical/live qualification belong to their later explicitly scoped gates, not shutdown or an incidental selector.

```text
/goal Resume and implement the remaining Aeon 1 work from docs/rewrite/RESUME.md with maximal useful parallelism, explicit finite subagent goals and exact ownership; close the recorded repair/review, environmental DI, semantic integration and qualification gates without weakening evidence, then demonstrate H1. Preserve all historical failures and consumed attempts; do not claim completion from fixture counts alone.
```

| Finite next task | Model/effort | Exclusive scope and completion |
|---|---|---|
| DC2 fresh acceptance | Fresh `gpt-6-astra` / high | New `evaluations/development/development-control-attribution-review.test.ts` and new `docs/rewrite/evidence/A1-L08/development-control-attribution-review.md`; source/prior tests read-only. Challenge canonical physical/bridge/anchor inventory before exclusion, foreign-root/reparent/delete families, alias/duplicate diagnostics and real bearing bindings. Audit separately integrated selectors. Return accepted or concrete preserved failures; do not wait for repairs. |
| DI06 repair | `gpt-6.1-sol` / high | Claim only `packages/agent-shell/index.ts`, `packages/agent-shell/openai.ts`, new `deployment/environment-di-06-repair.test.ts` and new `docs/rewrite/evidence/A1-L02/environment-di-06-repair.md`. Reproduce original four reds unchanged; fix cleanup classification/accounting and capture every used bridge receiver before callbacks. If another file is necessary, amend root ownership before editing. Retained Pi edits require their own metadata update/review. Return clean finite authored handoff for fresh review. |
| DI09 fresh acceptance | Fresh `gpt-6-astra` / high | New `deployment/environment-di-09-entry-review.test.ts` and new `docs/rewrite/evidence/A1-L03/environment-di-09-entry-review.md`; source/prior tests read-only. Challenge before/after entry, transaction-state sensor/cleanup failure, nesting, uncertain fences and real reopen survival; audit exactly two old handle insertions. Keep two unrelated fixture gates explicit. |
| DI10 fresh acceptance | Fresh `gpt-6-astra` / high | New `deployment/environment-di-10-review.test.ts` and new `docs/rewrite/evidence/A1-L09/environment-di-10-review.md`; source/prior tests read-only. Use the already persisted final claim, author60 and held-out fake kernel/process/lease/drain cases. Physical enforcement remains separately unqualified. |

Copyable finite goals:

```text
/goal Independently accept or reject the exact integrated DC2 R5 attribution repair and separately owned deterministic selectors with preserved causal tests and evidence; return a clean two-path review handoff without source edits or waiting for repair.
/goal Repair the four preserved DI06 failures by maintaining OpenAI cleanup uncertainty and capturing shell bridge receiver identities before callbacks; preserve old predicates and return a verified four-path authored handoff for fresh review.
/goal Independently accept or reject the exact DI09 transaction-entry repair and two narrowly forwarded native-state callbacks, preserving real durability/uncertainty/nesting checks and the separate old fixture gates; return a clean two-path review handoff.
/goal Independently accept or reject the exact DI10 environmental supervisor handoff using the persisted review scope, original60 and causal injected-boundary cases; retain physical qualification limits and return a clean two-path review handoff.
```

No new tests should be broad mirrors of implementation. Freeze behavioral predicates before source changes, exercise the actual boundary/failure, record negative baselines and all failures, and keep consequential review independent. Root owns shared documentation/configuration and serializes cross-owner changes.

## Runtime, commands and qualification limits

Pinned runtime: `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`; existing TypeScript7.0.2 and Node types24.19.1. Isolated worktrees use an ignored `node_modules` symlink to the main checkout; no dependency installation is needed to restart. Four CPU host: run expensive tests serially, `--test-concurrency=1`, and coordinate simultaneous test processes. Use exact positive anchored selectors. Negative regex selection previously ran physical fixtures because the file parent matched; those incidents are preserved in evidence and should not be repeated.

```sh
cd /home/palimpsest/src/palimpsest
git status --short
git log -8 --oneline
git show --stat 1a04f411238f1428f387ade59078da7e0e925bf6
git show --stat 65b1c18fef18c04c98e8b242e85ceee3bbc4e696
# After an explicitly claimed integration, run strict against that exact tree:
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
```

Mistral `mistral-large-4-0` / high is the user-selected target ([ADR0034](../adr/0034-select-mistral-large-4-reasoning.md)); selection is not deployment or competence qualification. Exact runtime profile/tokenizer/context remains open. The cached Medium tokenizer is not Large4 proof. Pi remains the selected editable shell; preserve prompt ownership and the audited dependency closure.

Both original native recovery first attempts were consumed and failed; do not retry automatically or reset grants. Actual Slack read-only recovery evidence exists, but it does not prove live speech/follow-through. The old systemd installation remains decommissioned. H1, E1–E5, matched native comparisons, private workload/checker qualification, original resource grants, real developmental transfer and whole-system evolution remain open.

Boundary plan `7e5abfa` is a proposal, not adopted runtime qualification. Current full six-restart schedule has166 cuts/22 boundary slots against156/12 in the profile; raw capacity, parent duplicate charging, descendant drain and exact context still need resolution. Do not confuse the bounded compact representation or fixture passes with a successful full original experiment. Aeon 2's five lanes/26 tasks remain an internal plan gated on H1.

## Shutdown preservation record

No task test/check process was found running with a repository/worktree current directory during the shutdown scan; the last child independently reported all of its test/check processes completed. No new benchmark, provider/native/Slack request, install, publish or deployment was started. Root performed documentation, exact checkpoint/import and preservation checks only. Final strict TypeScript against main code/review checkpoint `1a72ad8` passed with exit0; planning links in15 documents and all six archive/patch hashes were verified. No aggregate test was run for shutdown.

All current repair/review worktrees were clean and committed at checkpoint. A read-only inventory of232 worktrees found **three older dirty trees**. They were left unchanged and additionally snapshotted, including untracked files/symlinks without dereferencing. Do not describe all historical worktrees as clean or silently apply these changes:

| Older worktree | Preserved material |
|---|---|
| `installation-integration`, HEAD `806dd52` | Installation source/test, operations/evidence and untracked installation entry |
| `provider-review-before`, HEAD `401a70c` | Old handoff/proposal/shell test changes and untracked provider review test |
| `shell`, HEAD `9efe9a0` | Untracked `packages/contracts` entry |

The committed [snapshot manifest](evidence/A1-L09/hibernation-worktrees-20261012.json) records exact heads, paths, archive and patch SHA-256 values. Backups are local at `/home/palimpsest/migration/aeon-1-20261011/hibernation-20261012/`. Their preservation is not adoption or review. Original paths, commits and failures remain available; no worktree was deleted or reset for hibernation.

To restart, tell the next session: **“Resume Aeon 1 from docs/rewrite/RESUME.md, reclaim finite goals, and run the next independent tasks in parallel.”**
