# A1-L09 SS01–SS05 — Skin Shed and persistent coding source

Status, 2026-10-22: simplified implementation passes the focused offline checks below. **The simplified release and the responsiveness correction are installed.** Actual configured-model succession and the final main handoff remain open. Root owns integration, live operations and publication; delegates used Sol6.1/high with disjoint implementation or review scopes. Broader H1 qualification remains hibernated.

```text
/goal Complete one durable skin_shed entry point using the existing proposal, review mailbox and control continuation; retain actual incumbent–successor dialogue and probation observation; use one persistent Git coding tree and native session; inspect a real live cycle, preserve history and uncertain charges, and publish the verified result to main.
```

## Implemented composition

Ordinary coding goes through `develop`, followed by inspection of its retained result. `change_propose` records the intended improvement; `skin_shed({changeId})` enqueues its exact host-bound intent and yields the author. The ordinary tool surface exposes this single lifecycle action, with `change_status` for inspection. It does not expose `candidate_freeze`, `candidate_evaluate`, `release_submit` or `control_activate`.

The implementation extends the existing owners:

| Owner | Durable responsibility |
|---|---|
| `ChangeProposals` / `release.changes` | Proposal provenance, frozen candidate, evaluation and staged submission receipts |
| `EvolutionMailbox` | Independent evaluation and submission jobs with exact identities and retained outcomes |
| `ControlContinuation` / `host.control-continuations` | Immutable early Skin Shed intent, preparation, interview, activation and fresh probation |
| `ControlAuthorContinuations` | Local enqueue acknowledgment, author hold, global activation drain and one terminal outcome wake |
| `SuccessionHost` and dialogue | Authenticated generation exchange, continuity evidence, incumbent verdict, successor readiness and predecessor observation |
| `ServiceSupervisor` / `ReleaseController` | Exclusive production authority, actual transfer, acceptance, recovery and coordinator handoff |

The separate `SkinShedService`, `SkinShedOrchestrator` and `SkinShedContinuations` owners and their additional polling loop are removed. Proposal/mailbox records retain preparation progress; the original control intent is not rewritten as stages become available. Temporary rollout capability flags are also removed. Missing judging metadata remains an explicit unavailable capability, not an alternate deployment path.

The supervisor executes the exact frozen incumbent and successor minds with their own prompt/model/runtime bindings. Mailbox events require actual retained model-response witnesses. The exchange checks authorized continuity and the proposed improvement, with explicit incumbent verdict and successor readiness. The predecessor resumes its retained context after cutover; actual successor observations and fresh independent probation precede acceptance. Source review cannot substitute for these judgments. Privacy withdrawals and author steering invalidate stale evidence; regression recovery preserves current lived state and unknown results are not replayed.

Activation queues new normal inference/coding while existing work drains; the serving probe is exempt. Acceptance checks authority, allowance and observer evidence under the existing locks, then retires the observer before host handoff. The old coordinator stops advancing control work; restart authenticates the recorded acceptance and retirement under the new authority epoch. Direct lifecycle commands cannot bypass retained Skin Shed ownership.

## Coding source and deployment artifacts

The one retained Codex session uses a stable `/work/source` Git repository inside its existing workspace. Confined setup seeds it once from the then-accepted application and commits that baseline. Later turns reuse the tree, branches, commits and dirty work; changed accepted images do not reset it. Earlier directories and receipts remain preserved. Failed seeding requires inspection rather than automatic retry.

`CodingSource.candidateId` identifies the seed; `acceptedCandidateId` identifies the serving image supplied by the host. Instructions require checking Git status/diffs and preserving unfinished work. Branches, commits and reverts manage source history; there is no automatic merge of external releases. The native UUID and single-agent restriction remain unchanged.

Immutable deployment packaging remains separate: release freezes exact source, dependencies/runtime, prompts and controls for review, deployment and recovery. Git source history does not replace that identity or authorize release. Review bounds, previous-policy judgment, signatures and accounting remain in force.

## Offline acceptance evidence

All counts below are separate focused runs with zero failures and skips; they are not a claim that the entire repository suite ran. Paths are private evidence roots under `/home/palimpsest/migration/`.

| Check | Result | Retained log |
|---|---:|---|
| Coding, control and actual application shell | 66/66 | `skin-shed-simplify-20261022/responsive-coding-control-app-final.log` |
| Generation, dialogue, probes and persistent Git source | 61/61 | `skin-shed-simplify-20261022/generation-and-git.log` |
| Actual frozen `ServiceSupervisor` prompt-only lifecycle | 1/1 | `skin-shed-simplify-20261022/frozen-i7-supervisor.log` |
| Reviewer bounds, source reconstruction and evidence regressions | 26/26 | `skin-shed-simplify-20261022/reviewer-bounds-regression.log` |
| Strict TypeScript and build | exit 0 each | `skin-shed-simplify-20261022/responsive-strict-final.log`, `responsive-build-final.log` |

The application run initially passed **4/5**. A duplicate `controls.eligibleRun` check blocked the serving probe despite its intended drain exemption. The source now uses the single eligibility predicate; the unchanged drain behavior check passes. The failed run remains at `skin-shed-20261021/unified-control-tests-20261022/application.txt`.

Git checks include real confined branch/commit/revert behavior, changed-candidate preservation and retained seed failure. The supervisor uses real frozen child processes and authority transitions; its synthetic ownership rows are explicitly fixtures. Application/generation transports are controlled, so these checks do not establish live cognition. Independent static review found no remaining blocker in its scope: `skin-shed-20261021/independent-simplified-integration-review.json`.

## Live installation and actual cycle — open

The simplification entry records accepted application `9c0cb054…` at authority183. Earlier installation, refusals and unknowns remain in repository history and private `skin-shed-20261021` evidence; they do not establish live cognitive succession.

The reviewer capacity prerequisite `288dd18c…` is accepted at authority 187 with actual admission, fresh probation and automatic coordinator handoff. Original job `ss-install-i2-evaluate` remains uncertain before physical reservation: exact readonly preconditions passed and source copy needed 1,705 inodes against 907 free. The existing workspace filesystem was expanded online from 512 MiB to 2 GiB, preserving its image, mount, UUID and contents; existing `checkWorkspace` passes.

The separately recorded I4 source review passed. Its staging attempt found the existing reviewer registry under `/etc` read-only in the service namespace. The exact registry directory is now declared in a systemd write-path drop-in for the next normal restart. Accepted registry APIs provisioned the exact reviewed plan under original authority; the supervisor staged the original signed proof and the existing mailbox reconciled the actual receipt. No reevaluation or fabricated acceptance occurred. The original uncertain submission revision remains in history. Private evidence includes `i2-predispatch-diagnosis.json`, `phase-i4/reconciled-*`, and `workspace-2g-growth.json`.

The coherent simplification is frozen as `63780d44…`; its 28 changed/deleted files encode to 759,044 bytes under the accepted 786,432-byte plan. Its first actual source review, I3, refused. Direct inspection confirms the complete deleted-file before text was present, contrary to one finding. The genuine evidence limitation was that the host review recorded compilation but no behavioral execution. A separate I5 proposal adds five raw operator reports, exact source bindings, a deletion index, unchanged registry source and the actual predecessor acceptance receipt. The supervisor lifecycle was rerun directly from the exact frozen candidate and passed 1/1. These results are explicitly operator evidence, not host-reviewer execution or live cognition. The original refusal remains; I5 admission and fresh probation both passed, and the new coordinator served `63780d44…` at authority 191. Direct inspection retained distinct real source-review requests, exact schema identities and context totals 888,347 and 888,555, each below 1M. The original refusal remains.

The actual Slack test then exposed a scheduler stall. Authenticated `auth.test` succeeded through the exact accepted SlackClient and raw transport, but the live child spent its CPU repeatedly decoding full control rows. The pending filter called eligibility before checking runnable status; 57 unmanaged runs and duplicate drain calls decoded about 833 MB per pass. The narrow correction puts the unchanged runnable predicate first and removes the duplicate scan. Existing conversation and atomic coding gates also queue new work throughout managed activation/probation, while retaining Skin Shed freezing exclusion and the serving-probe exemption. This does not broaden already-running-work drain guarantees for operator releases.

Three causal failures remain: terminal history caused 33 unnecessary eligibility calls; operator activation did not hold unrelated work; direct coding claims could bypass the application guard. All 66 joined checks now pass. I7 `5ce633f2…` passed real admission and fresh probation and is serving at authority 195. The original pending Slack message was recovered without a duplicate and started retained native turn28 at `/work/source`, seeded from this same release. Native UUID, Sol6.1/high and single-agent configuration verify. The serving transport has recorded no new socket failure since its restart. Complete live coding and cognitive succession results remain pending.

The existing coordinator still decodes completed control payloads during idle polling; the correction does not claim all idle CPU is eliminated. Private evidence: `slack-stall-analysis.md`, `slack-transport-diagnosis.json`, the three causal red logs, `phase-i7/`, and `live-coding-persistent-git-question-running.json` under the two private evidence roots. Earlier standalone verification JSONs describe their named historical source images; they are not current aggregate or live competence claims.

The first real Cairn-authored prompt cycle committed `f28ef260…` in the same `/work/source` branch/session. Its independent admission and submission passed, but dialogue `control:e1fe8341…` stopped uncertain before cutover. Read-only inspection proves the original completed native checkpoint had all five calls paired; the first interview response made a fresh `speech_send` choice. This was not pending-tool replay. The input duplicated original history five times and included host validation indexes, then hit the worker deadline during repeated compaction. Original requests, charges, failed turn and uncertain operation remain retained.

The bounded correction projects mind-relevant context while keeping raw captures and privacy/steering fences unchanged. The incumbent retains its original checkpoint; successor receives the authorized history once; observer retains the same incumbent session. Evidence remains in the host-attested system fragment even if the worker omits ordinary messages; only the short current interview request is echoed into native dialogue. The causal finite/unlimited cases failed `5 != 1`, then all55 generation/host/dialogue/probe cases passed with zero skips. Strict/build pass. Independent source review approves exact hashes, without claiming live competence: private `independent-dialogue-context-review.json`. I8 admission/deployment and a new explicitly authorized cycle remain in progress.

## Main handoff — open

Completion record: reviewed source revision, remote main revision, running coordinator and verified accepted boot/rescue targets after the live gate. Deployment of the simplified runtime is observed; full cycle completion and publication remain unclaimed until inspected.
