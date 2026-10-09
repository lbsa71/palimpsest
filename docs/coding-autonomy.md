# Coding capability and full-codebase autonomy

Status: testable implementation specification, 2026-10-09. The user requires basic coding capability in the seed and full autonomy over the autark's own codebase, potentially including a local library fork. These are explicit requirements from “Explain code change tooling.” The design below operationalizes them; it does not claim implementation, library adoption, deployment or new spending authority. Owners and sequencing are in [P17/P18](../PLAN.md#p17--implement-the-seeds-iterative-coding-capability); the architecture decision is [ADR 0019](adr/0019-coding-autonomy-and-reusable-agent-plumbing.md).

## Problem and expected outcome

The current completion boundary rejects tool calls. The model receives selected source and proposes complete replacement files; ordinary candidate admission permits only direct `src/agent/*.ts` changes. That proves a narrow succession path, but cannot support repository investigation, incremental repair, deletions or sustained engineering across the implementation.

An authorized coding task must let the autark inspect its repository, make and test changes in a durable workspace, interpret real failures, revise, and submit the resulting artifact through succession. The autark must also be able to evolve the tools, orchestration, memory, providers, dependencies and release machinery enabling that work. No application source directory is permanently reserved for human authors. A component's currently authoritative implementation remains independent of the candidate it admits; its replacement uses the separate evaluated upgrade route.

Full source autonomy does not turn every conversation into an authorized coding task. Preserve authenticated origin, current policy, standing-growth provenance, confidentiality, configured resource limits and R23–R25. Existing peer findings remain open. A peer response must not inherit the autonomous engineer's repository, credentials or task authority.

## Requirements, decisions and open choices

| Class | Disposition |
|---|---|
| Explicit user requirement | Full-codebase autonomy, including the ability to maintain a library fork; basic searching, full/partial reading and editing, creation and deletion in the seed. |
| Existing requirement | Mistral default, explicit alternatives, persistent growth, pragmatic TDD, source-bound checks, continuity, separately evaluated governance changes and older rescue. |
| Implementation design | A mutable task workspace, typed tool receiver, durable model/tool steps, then immutable candidate freezing and the appropriate release contract. |
| Provisional library preference | Evaluate AI SDK core with its direct Mistral adapter first. Pi core/SDK is the comparison candidate. Neither package is selected or installed by this specification. |
| Open implementation choices | Exact compatible package versions, edit representation, execution backend, storage schema, snapshot/import API, release classification and host/custodian upgrade mechanism. Resolve in the relevant slice before its implementation. |

## Workspace and tool contract

Each coding task receives a workspace with a recorded repository/base identity, owner/origin, authorized scope, lifetime, allocation and resumable state outside the live installation. Starting a new task must include the actual admitted source identity; stale or unpublished source requires explicit reconciliation. Preserve user changes and other task workspaces. A clean publication checkout must not be used as a scratch area.

Authoring scope covers the project's source, tests, specifications, dependency declarations and explicitly available dependency source/forks. A draft change to the custodian is allowed to exist; it has no power over the installed custodian or the checks evaluating that draft. Private lived state and credentials are separate resources, not implicitly readable files in a coding workspace. Candidate-authored tests may evolve in the workspace; the authoritative suite used to admit this transaction is retained elsewhere under its old identity.

The following are required observable capabilities, not prescribed tool names or wire schemas:

| Capability | Required behavior |
|---|---|
| List and locate | List directories and locate files by path/pattern; handle ignored files explicitly and expose pagination/truncation. |
| Search text | Search repository text with literal/regex options and useful file/line context; bound results and make continuation possible. |
| Read | Read entire files when within the configured output limit, or selected line/byte ranges with reliable coordinates. Report binary/encoding limitations and whether output is complete. Large files must remain accessible through successive reads. |
| Create and replace | Create files/directories and replace complete content, including valid empty files. Preserve intended modes and distinguish replacement from deletion. |
| Edit and patch | Apply precise partial changes with content/version preconditions. Ambiguous matches, stale content and failed patches return actionable conflicts without silently changing another occurrence. |
| Delete and move | Delete, move and rename workspace entries with an inspectable change record. Distinguish file and recursive directory operations; prevent accidental overwrite through declared preconditions. |
| Inspect changes | Show status and diffs, including additions, deletions, modes and renames or equivalent add/delete changes. |
| Execute and observe | Run build/test/development commands inside the workspace execution boundary. Provide exit status, bounded output/continuation, cancellation, deadlines and owned-process cleanup. Shell semantics, if offered, receive the same resource boundary as direct executable/argv calls. |

Every receiver verifies current task/generation authority and workspace scope at each operation, including the active epoch and before accepting late asynchronous results. Paths must not escape through traversal, symlinks, alternate Git metadata or concurrent path changes. Serialize conflicting mutations or use enforceable content preconditions. A changed working directory by itself is not isolation: tests, build scripts and package lifecycle scripts execute candidate code. The execution boundary must keep unrelated host files, live stores, admission evidence, credentials and unconfigured network effects out of reach.

Path-prefix or `realpath` validation in the unrestricted host is insufficient against concurrent parent replacement; `O_NOFOLLOW` on the final file alone does not fix that race. P17.2 must choose and test a race-resistant execution backend, such as an isolated trusted filesystem helper or a proven directory-handle-based implementation. An owned plain-copy snapshot without external Git metadata, refusal of symlink/hardlink/nonregular entries, and serialization between tools and command writers are initial design candidates, not claimed existing protections. The final contract must define any supported link behavior and test parent replacement and competing writers through the real backend.

Record the execution backend's actual resource guarantees. The existing `runIsolated` provides wall-time/stdin/output limits and network denial but not hard RSS/CPU/disk/process quotas or paged command output; overflow terminates execution. P17.2 must implement the required output retrieval and owned-process lifecycle, including detached-descendant failure cases, and state which configured resource limits are enforced. Do not infer hard quotas from a timeout or mark unavailable enforcement as tested.

Workspace mutations are reversible development operations, so ordinary edits do not invoke Skin Shed individually. They return observations to the same coding task. Dependency acquisition and external Git publication remain separately identified operations under existing configured authority; a package install script cannot silently gain broader host access.

## Iterative execution and interruption

The host records the accepted model response and tool intents before executing mutations. A durable step records task/workspace identity, origin, source release, operation ID, authority epoch, reservation, arguments or protected reference, preconditions and actual outcome. Sensitive contents stay external. Record provider usage when known; do not label unknown usage zero.

The model can perform multiple rounds of inspect, edit, test and repair. Successful tool dispatch is not proof that the engineering task succeeded. Completion requires observed acceptance behavior and a verified final workspace diff. Test failures are ordinary feedback within the existing allocation; a failed proposal should not require a human to write the next patch.

Before each provider request and tool effect, check cancellation, current authority and remaining allocation. Library defaults for retries, automatic tool execution or hidden background requests must not bypass these checks. Either invoke one model step at a time or demonstrate equivalent interception before every request and effect. Framework events alone do not establish durable recovery.

Each physical provider request needs its own durable call reservation; an iterative coding session is not one model call. Enforce both the applicable lane/window allowance and every applicable finite task, item, session and attempt limit. When inference allocation is exhausted, checkpoint the draft and observations and report the reason for waiting. Already admitted local tools can finish within their own authority and resource limits; another model round waits for an eligible allocation. Do not borrow release, interactive or standing-growth calls, accumulate missed slots, or reset cumulative limits at a new window. Interrupted or uncertain dispatched calls remain spent.

The [current hourly testing contract](plan-driven-evolution.md#hourly-testing-cadence--user-directed-refinement-2026-10-09) defaults to one authoring call and eight separate release calls per UTC hour. Its version 1 catalog also fixes one proposal call and eight release calls per attempt, with at most three attempts; the implementation currently debits one attempt before one provider call. P17.3 must introduce an explicitly bounded, admitted iterative-session contract and per-round accounting instead of reinterpreting those frozen single-call attempts. A future session can span windows only while its own cumulative limits and current authority permit. These current limits are implementation facts, not permanent product ceilings. Increasing allocation requires the corresponding configured policy and authority; this specification changes neither funding nor the running policy.

Persist drafts and completed observations across process restart, provider outage, budget pause and succession. Content hashes and atomic mutations can establish whether a local file operation completed after a crash. A command with an uncertain effect is held for reconciliation, rather than blindly rerun because the agent transcript lacks its result. New authority must reject delayed predecessor writes and results. User work and status/cancellation remain responsive while coding proceeds.

The SQLite journal and filesystem are separate transactional resources. A mutation needs a durable operation record plus staged same-filesystem content/manifest and independently checked postconditions (or an equivalent demonstrated protocol); writing an effect row is not an atomic filesystem transaction. Define multi-file partial-failure and recovery semantics explicitly. Reconciliation must preserve concurrent-work ownership and distinguish definitely completed local edits from unknown command effects.

## Freezing and release routes

Freeze the actual resulting workspace, including creations, deletions, modes, lockfile and any forked source/build inputs. Bind base source, artifact, configuration, acceptance contract and independently collected evidence. A rename may be represented by add/delete if final identity and evidence are exact. Edits after freezing require a new candidate and fresh admission evidence.

| Change | Target admission behavior |
|---|---|
| Application cognition, planning, tools, memory logic and other ordinary runtime modules | Broader application release under the current protected checks; candidate scope is not limited to `src/agent/*.ts`. Identify compatibility and affected behavior from the actual change. |
| Outer service, dependency set or local library fork | Evaluate the complete built artifact and serving/restart compatibility; retain the previous runnable release and current external state. Dependency changes are executable changes, not an exception to freezing. |
| Admission rules, authoritative tests, custodian or rescue components | Separate upgrade evaluated by previously accepted controls, with an independently usable older recovery path retained throughout. No new rule can admit itself in the same transaction. |

Release classification is performed by the currently trusted mechanism from the actual artifact change and dependencies, not from a model-supplied label. The per-release protected set and its classification policy must be explicit; modifying the evaluator's own helper must not disguise a governance change as an ordinary module edit. Distinguish evaluator/support dependencies from declared candidate-under-test inputs: intentionally loading a candidate module in its test sandbox does not make all tested application code part of the trusted evaluator. Conservative rejection is an implementation state to resolve through the appropriate upgrade route, not a permanent human-only directory policy.

P17.4 must define a versioned full-tree/base manifest and import/verification contract. The existing freezer rejects deletion and non-agent additions, and its `sourceDigest` identifies only cognitive source. Relaxing its path check without changing those semantics cannot establish a verified broader artifact. Keep historical manifests interpretable under their original version and protect their existing evidence bindings.

The existing operator host-baseline procedure is a bootstrap mechanism. Its existence does not satisfy autonomous host/custodian evolution. P18 must supply the autonomous route and demonstrate successful handoff and failure recovery. The retained rescue can evolve in a subsequent transaction after another independently usable rescue exists; replacing the last recovery mechanism together with the code it must rescue is excluded.

Rollback restores executable behavior while retaining current memories, tasks, reservations and effect records. Data/schema evolution requires old-release compatibility or a tested forward recovery plan. Merely restoring an older database is not acceptable continuity.

## Reuse and fork ownership

Prefer a small replaceable library for provider protocol, streaming and tool-call representation when it reduces total maintenance. Keep durable scheduling, workspace effects, authority and admission under explicit Palimpsest contracts. An upstream agent's default permissions or session store cannot become the application's authority source by accident.

P17.1 compares AI SDK core plus a direct Mistral provider with a suitably bounded Pi integration using the same fixtures. Start with the first candidate; expand the comparison only for an observed mismatch or material maintenance advantage. The spike must record exact versions and licenses, dependency footprint, provider route, automatic discovery/network behavior, tool execution ordering, retry/cancellation behavior, per-call interception, raw usage availability and resumption seams. A library failing these contracts may be adapted, forked or rejected; retaining custom code for a demonstrably smaller boundary is a valid outcome.

Forkability is an engineering capability, not a requirement to fork everything immediately. Retain source provenance, license obligations, exact upstream revision, local diff and reproducible build inputs. The autark must be able to inspect the relevant dependency source, make a local change, test it, build the resulting artifact and submit it under the dependency/governance contract without waiting for upstream approval. Record the choice to merge upstream fixes, diverge or replace the dependency. Test against a pinned fork; a mutable branch or registry tag cannot identify a frozen release.

Primary-source assessment on 2026-10-09: [AI SDK tool calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling), [direct Mistral adapter](https://ai-sdk.dev/providers/ai-sdk-providers/mistral), [Pi core](https://github.com/earendil-works/pi/blob/main/packages/agent/README.md), [Pi embedding](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md) and [Pi package dependencies](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/package.json). This is a documentation/source assessment, not a completed compatibility benchmark or a guarantee of future support.

## Acceptance and evidence

The normative scenarios are [A22/A23 and revised A17](acceptance.md#a22--iterative-coding-with-real-workspace-tools). The implementation lead must establish failing behavior checks before each behavioral slice, preserve trusted fixture ownership and record real results. At minimum:

1. A task discovers a defect by search and partial reads, edits existing code, creates a helper/test, removes an obsolete file, runs a failing check, repairs the cause and produces a passing artifact. Exercise every tool contract, including empty files and conflict paths.
2. Repeat with restart between response and mutation, restart after a mutation before its receipt, unavailable provider, exhausted budget, cancellation and stale predecessor authority. Preserve drafts, history and spent reservations; reconcile unknown commands.
3. Exercise actual execution confinement and final provider requests through the serving integration. A filesystem test invoked directly in a test process is insufficient evidence for the live agent path. Keep peer/source confidentiality and noneligible-origin negatives in that integration.
4. Show a useful model-authored change outside `src/agent/` reaching the running successor with exact publication where configured, then continuing after restart. Operator-authored substitution does not satisfy autonomous acceptance.
5. Show a local dependency/fork change and a separate governance/custodian upgrade under old checks, including failure with the observer stopped and provider unavailable. Retain current external state and an older working rescue.

Deterministic fake providers prove protocol and recovery behavior. A finite real configured Mistral run proves the integration can perform the workflow; it does not prove general coding quality. Live calls, publication and installation use the authority and resources already configured or explicitly granted for those operations. This document grants none by itself.

## Work split and review checkpoints

The user assigned “Explain code change tooling” (Astra) to reasoning/strategy and “Distill autonomous agent research” (Sol) to implementation/test. Astra owns this specification, cross-document consistency, architectural tradeoffs and acceptance review. Sol owns source/tests, the dependency spike, measured evidence, implementation sequencing feedback and deployment work already authorized in that chat. Use isolated worktrees and explicit file ownership; coordinate before either session edits the other's policy documents or advances the shared publication branch.

The sessions agreed this split on 2026-10-09, with separate strategy and implementation worktrees based on `081504c`. Sol's first proposed fixture verifies that one SDK request returns tool intents without executing them, automatic retries are disabled, abort/usage semantics are preserved, and staged file operations reject stale contents and path/symlink escapes. Agreement on that fixture is planning evidence; execution results belong in P17.1's record.

Sol's implementation assessment identified parent-path races, nontransactional SQLite/filesystem effects, missing hard resource quotas/paged command output, detached descendants and narrow manifest semantics. These are explicit implementation gaps above. Independent strategy review checked the current source claims, all local references and requirements/acceptance consistency; its evaluator-dependency clarification is incorporated. No runtime implementation pass is inferred from that documentation review.

Review checkpoints: (1) agree the contract and first red checks; (2) inspect the dependency-spike evidence before recording a selected package; (3) review tool/restart integration before broadened admission; (4) review exact frozen artifacts independently before consequential installation; (5) reconcile plan status with actual live results. Follow-up findings change the specification explicitly rather than silently narrowing full autonomy.

## Non-goals and material risks

This work does not require a new chat UI, distributed agent platform, automatic upstream contributions, model-weight training or a new provider. It does not turn a documentation branch or compatibility spike into a deployed capability.

Material risks are overlapping workspace ownership, stale edits, library behavior bypassing per-call accounting, unsafe command/build effects, dependency or fork maintenance, replay after uncertain execution, classification that misses transitive governance changes, incompatible current memory after rollback, and confidential material reaching an unauthorized model context. Tests must address the touched contracts. A tool loop improves engineering capability; it does not by itself resolve the recorded peer social-engineering failures.

## Strategy-package verification

On 2026-10-09, lead and fresh independent review checked the 16 changed/new Markdown documents, all 165 local link targets (including 19 heading anchors), whitespace and cross-document requirement/work-item/acceptance consistency. Current provider, isolation and manifest claims were inspected against source; upstream assessment references were checked. Review found no remaining blocker after clarifying evaluator dependencies. No diagrams were added or modified. These are documentation checks only; P17/P18 implementation, real-provider compatibility and deployment remain unverified by this package.

The subsequent P17.3 accounting clarification was checked against the current configuration, catalog, executor and provider invocation, with 56 local references verified across five affected documents. It records the existing single-call/attempt constraints and the proposed iterative-session contract; it changes no runtime allocation and claims no implementation or live-test pass.
