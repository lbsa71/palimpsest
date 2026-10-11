# A1-L09 bounded evolution tools handoff

Status: implemented and fixture-verified. This is a finite bootstrap engineering delivery. Ordinary application wiring, external live evaluation and H1 remain root/L08 integration gates; this record does not establish autonomous takeover or product qualification.

## Ownership and finite goal

Owner: `/root/a1_evolution_tools`. Branch: `codex/a1-evolution-tools-20261011`. Worktree: `/home/palimpsest/migration/aeon-1-20261011/evolution-tools`. Base: `ccc0628220bb6e0cb93310468cd38833f95fffcb`. Exclusive writes: `deployment/evolution-tools.ts`, its test, `packages/release/proposals.ts`, and this evidence record. Root retains `deployment/application.ts`, `deployment/candidate.ts`, `deployment/source-workspace.ts`, service/CLI lifecycle and lane coordination.

```text
/goal Implement and verify host-bound model release proposal → immutable candidate → external evaluation request → admission submission tools, with durable state and an actual source dependency change integration test, in the assigned evolution-tools worktree.
```

Requirements: RW12, RW14, RW15, RW21; A1-L06 coding path and A1-L09-T03/T04 engineering integration. C1 revision: `aeon1.c1.v1`. Reuse: existing OperationalStore, DevelopmentalMemory, freezeApplication/verifyApplication and L09 ReleaseController; no new dependency or upstream publication.

## Integration contract

`evolutionTools(context, options): ApplicationTool[]` installs through `ApplicationOptions.additionalTools`. Context is `{runId, scope, workspace, store, authority}`. Descriptors provide data-only JSON schemas and `change_propose`, `candidate_freeze`, `candidate_evaluate`, `release_submit`, `change_status`.

Host options pin artifact store, accepted candidate, Node binary, frozen judging policy digest, finite file/entry/byte bounds, eligible authenticated human authors and qualified model IDs. The authority assertion and origin callback are trusted host services. No tool argument chooses host paths, evaluator credentials, release authority or policy. Host artifact/state locations must be protected from **all** worker namespaces. The producer mechanically checks that its store and operational state are outside the current workspace.

`provenanceForRun` must identify a concrete admitted/steering input. Human proposals require a configured eligible actor; ineligible human steering also denies the current run's modification path. Broad conversation admission remains independently allowed. Self proposals require an authenticated initiative input by the current generation, matching `initiative.execution`, a finite goal whose immutable origin is `self`, and available experience records scoped to the run. Because `initiative_goal_propose` can run during human conversation and writes `origin:self`, that body label is **insufficient**. A host-private `host.release-self-origins[goalId]` record must attest the exact `goalDefinitionIdentity(goal)`, under `basis:accepted-bootstrap` or `basis:independent-initiative` with an authenticated unsteered initiative `originRunId`. Accepted host bootstrap or a trusted wrapper observing autonomous goal creation writes this record; model source/configuration arguments cannot. Missing or stale attestations fail closed. Human-request runs or human-steered initiatives cannot silently become self proposals. The producer rechecks trusted provenance before freeze/evaluation/submission. Independent self proposals can still originate from experience in later unsteered initiative runs; host origin binding is required to prevent laundering a request into eligibility.

`requestEvaluation` receives a deterministic request ID, exact verified FrozenCandidate, immutable change proposal and frozen policy digest. It returns a host receipt bound to those fields, plus independently issued evidence. The tool rejects author evidence and mismatched judging controls, retains failure/inconclusive evidence, and never signs evidence. `submitRelease` receives that external receipt and exact candidate. The host callback must use the admitted L09 mechanism to reject/admit/stage; it must not treat receipt text as authorization. For changed controls it stages under the prior accepted policy. Callbacks must durably reconcile by request ID; retries use the same canonical request. A dispatched operation remains durable across reply loss, rejection/invalid receipt, interruption or host failure. Such failures carry `mayHaveApplied: true`. Submission decisions may be persisted after an authority transfer withdraws the submitting run.

Proposal identity is per run; durable records and exact experience/evaluation/submission artifacts use the external OperationalStore. Candidate/manifests are stored externally in the host artifact store. Descriptor reconstruction and a new database handle recover the exact recorded candidate and receipts.

## Snapshot and actual closure

The host copies only `rewriteSourceEntries`; author-created `node_modules` and `dist` are excluded. Each absolute ancestor and source directory is descriptor-pinned with `O_NOFOLLOW`. Every file is regular and singly linked; reads are bounded by the initial file size and cumulative grant, detect appended bytes, compare descriptor metadata, and undergo a second complete bounded inventory/hash check. Directory entry and depth limits also bound empty directory trees. Source and accepted compiler copies share the total entry/byte grant. Temporary staging is removed on all outcomes.

The verified accepted candidate supplies its concrete compiler closure. That closure is copied against the exact accepted file hashes, and `freezeApplication` then produces the whole application manifest from the trusted staging copy. The final source workspace cannot mutate the frozen payload or its metadata.

Actual `deployment/prompts/mind.md` and `compaction.md` bytes become the proposed prompt metadata. Optional source-owned `deployment/candidate-settings.json` contains `{configuration}`. This bounded bootstrap settings path permits qualified model ID/profile changes within accepted request ceilings and `pollMs`; it rejects any changes to effect/network/author grants, resource allowances, host paths, policy or host prices. All other source components remain proposal-editable and are classified by the existing host execution closure. Wider grant/configuration/toolchain evolution needs a separately reviewed host control upgrade path; this helper does not confer that authority. Accepted runtime, policy and compiler metadata come from the accepted host artifact.

## Observed verification

Runtime: pinned Node `v24.13.0`, `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`. The worktree's uncommitted check-only `node_modules` link points to the lead checkout's installed compiler; the fixture copies that concrete compiler into an ordinary accepted source tree, verifies it, and then supplies it from the accepted candidate payload.

Commands:

```text
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc --noEmit false --rewriteRelativeImportExtensions --outDir dist
node --test deployment/evolution-tools.test.ts packages/release/release.test.ts packages/release/controller.test.ts
```

Observed: type check and emitted build passed; combined targeted suite passed 22 tests, including eight new evolution cases (parent plus seven subcases), with no skips. The fixture took about 19 seconds with the concurrent existing release/controller cases. A final focused rerun passed all eight evolution cases and verified combined source-plus-compiler resource accounting.

The integration fixture edits the retained cfworker dependency at `packages/narrow-schema/vendor/cfworker/ucs2-length.ts`, adds an explicitly synthetic revision export, changes actual prompt text and permitted model/configuration settings, and freezes them. Its external host callback compiles the **complete frozen source** with the accepted compiler, loads the emitted modified dependency, and observes `{length:2, revision:"changed-dependency-v1"}`. It signs exact candidate evidence in host memory, and the submission callback executes the real `ReleaseController.stageControlUpgrade` under the prior policy. The incumbent authority and accepted rescue remain unchanged. The synthetic export establishes edited dependency build/load, not an independently measured improvement.

Boundary cases reject ineligible human proposals, model-supplied origin/evidence, human-to-self laundering, missing/private self evidence, mismatched self goal binding, symlink ancestors, hardlinks, FIFOs, oversize reads and grant increases. A deterministic actual file-growth injection after a descriptor read proves appended bytes abort freezing. Lost evaluator and submission responses retain durable dispatch state and reconcile without repeating their host decision. Self evaluator evidence cannot be submitted; a new database handle retrieves exact receipts.

## Remaining gates

Root must install the descriptors with authenticated provenance and host-private callbacks in the ordinary application/service path, provide cross-workspace namespace protection and actual external evaluator policy/keys, and perform fresh consequential review. This fixture neither runs a live evaluator nor activates a successor. Existing controller tests separately cover succession/recovery, but combining this producer with an ordinary model-authored improvement and live independent product acceptance remains A1-L09/L08 work. H1 is open.

Exact handoff is the commit containing this record; root receives that commit ID in the coordination message.
