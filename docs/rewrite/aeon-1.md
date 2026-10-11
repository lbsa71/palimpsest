# Aeon 1 — build the conditions for an evolving autark

Status: **planned; no rewrite implementation is accepted**. Owner: Codex-led implementation sessions. This is an implementation backlog, not a claim about the stopped installation. The [workflow](workflow.md) governs every lane and task. The [architecture](architecture.md) and [shell decision](agent-shell-decision.md) record proposed designs and the Pi-core selection in ADR 0032; integration qualification and other technology choices remain open.

Aeon 1 ends with an autark that can pursue a durable agenda, reason through real observations, act, verify, remember and revise its conduct across sessions. It must also conduct an independently checked improvement to its own system. Fluent descriptions of those abilities do not satisfy the gate. Coding is a required capability; it is not a prescribed identity or the only form of growth.

## Scope and completion

This is a full rewrite with a fresh data model and deployment. There is no requirement to read old databases, preserve old API shapes, support old configuration names, reproduce the previous custodian protocol, or keep the old process installable. Old evidence remains available for diagnosis. Any code or design retained must pass a written reuse justification based on the new requirements, not the cost of replacing it.

The implementation owns personality instructions and their composition. Reused shells must expose and permit replacement of their local system instructions and relevant defaults, including subagents and compaction. The evaluation distinguishes that control from inaccessible provider training or service behavior. A configurable name or assertive prompt does not constitute a developing self: the runtime must connect experience, durable priorities, self-understanding, decisions and subsequent revision.

Completion requires all nine lanes accepted, the resource-normalized comparisons in L08 honestly reported with the predeclared product parity and non-regression thresholds met, and the handoff in L09 accepted. A completed evaluation with negative results does not accept H1 or finish Aeon 1. The target is reasoning/action quality at least comparable to Claude Code and Codex on declared workloads, with additional longitudinal development. If either comparator cannot be run, that parity claim remains unverified; implementation progress may continue, but the full Aeon 1 gate is not silently weakened. A larger feature list, more tokens, or a self-awarded score cannot establish parity.

## Lanes and ownership

All owners begin unclaimed. Claim one lane through the [workflow](workflow.md), then copy its exact `/goal` statement into a new session. A lane owns its listed implementation paths, its lane document and its evidence directory. Shared contracts are owned by L01; a consumer requests a contract change instead of editing another lane's boundary. Proposed paths below become concrete at L01's contract gate; they do not imply an existing package layout.

| Lane | Outcome | Exclusive implementation ownership proposed for contract gate | Principal integration dependencies |
|---|---|---|---|
| [A1-L01](lanes/A1-L01-contracts.md) | Executable contracts and architecture decisions | `packages/contracts/`, `docs/rewrite/contracts/` | None; incorporates boundary proposals from all lanes |
| [A1-L02](lanes/A1-L02-agent-shell.md) | Qualified selected Pi core with owned prompts and editable dependencies | `packages/agent-shell/`, `experiments/agent-shell/` | L01 contracts; L08 shared fixtures |
| [A1-L03](lanes/A1-L03-durable-runtime.md) | Durable action/observation execution and recovery | `packages/runtime/`, `packages/effects/`, `packages/storage/` | L01 contracts; L02 binding at final integration |
| [A1-L04](lanes/A1-L04-developmental-memory.md) | Retrieval, consolidation and revisable self-state | `packages/development/` | L01 contracts; L03 event and storage adapters |
| [A1-L05](lanes/A1-L05-goals-and-drives.md) | Persistent goals, initiative, resource-aware scheduling | `packages/initiative/` | L01 contracts; L03 durable execution; L04 retrieval |
| [A1-L06](lanes/A1-L06-tools-and-delegation.md) | Real tools, iterative coding, bounded delegation | `packages/tools/`, `packages/delegation/` | L01 contracts; L03 effect ownership; L02 shell binding |
| [A1-L07](lanes/A1-L07-communications.md) | Responsive Slack and direct API with durable follow-through | `packages/communications/` | L01 contracts; L03 task/effect interfaces; L05 obligations |
| [A1-L08](lanes/A1-L08-evaluation.md) | Independent evidence of competence, personality and growth | `evaluations/`, `docs/rewrite/evaluation/` | Baselines start immediately; final runs consume L02–L07 |
| [A1-L09](lanes/A1-L09-integration-and-handoff.md) | Whole-system integration, autonomous upgrades and accepted handoff | `packages/supervisor/`, `packages/release/`, `deployment/` | Boundary specification starts immediately; final gate depends on L01–L08 |

Each lane's evidence belongs under `docs/rewrite/evidence/<lane-id>/`; private transcripts and credentials remain outside Git. Root workspace configuration and cross-package wiring are coordinated by L09 after consultation with affected owners. Do not let independent sessions edit the root lockfile simultaneously: each submits its dependency request and L09 serializes integration. Shared ADRs are proposed by the relevant owner and integrated by the lead with L01; an ADR filename is reserved before use.

## Parallel execution and critical path

Dependencies have three distinct meanings: **specification** means an interface must be agreed; **implementation** means an adapter is needed to exercise actual behavior; **integration** means acceptance must run against the joined system. A missing downstream implementation does not block work against a contract fixture.

| Wave | Work that can run in parallel | Gate to the next work |
|---|---|---|
| W0 — investigate and specify | L01 contract drafts; L02 selected-core extraction and prompt/transport audits; L08 baseline design and comparator availability; L09 release/control threat and failure model; other lane owners propose their contract needs | Contract gate C1: schemas, ownership, executable examples and compatibility policy for the new interfaces are agreed |
| W1 — build independent components | L03 persistence/effects with fake shell; L04 memory with fake event stream; L05 goals with fake clock/executor; L06 tools with fake effect receiver; L07 transport with fake runtime; L02 qualifies the selected core; L08 builds held-out evaluations; L09 builds supervisor/release machinery | Each lane's component checks pass against C1. ADR 0032 supplies the shell choice; a qualified bridge is required for actual binding, not for all earlier work |
| W2 — integrate vertical slices | L02+L03 real action loop; L04+L05 longitudinal initiative; L06 coding/delegation; L07 communication/recovery; L09 joins components incrementally; L08 independently evaluates frozen slices | An integrated candidate meets mechanical, authority, continuity and qualitative checks |
| W3 — demonstrate and hand off | Fresh independent L08 evaluation; L09 whole-system self-change and offline recovery; Aeon 2 owners may inspect evidence and prepare experiments without claiming operational takeover | H1 handoff accepted with open limitations and operating envelope; all required comparator evidence exists |

The critical path is C1 → durable action loop and usable shell → joined system → independent evidence and H1. L09's release design and L08's evaluation design start in W0 to avoid a late integration bottleneck. There is no requirement for one session to finish all of Aeon 1 before another can begin a lane.

## Task delegation and review

Each task table names an available development-session model and effort as a recommendation, not a claim that a model was invoked. `gpt-6.1-sol` is the normal implementation workhorse; `gpt-6-astra` is reserved for consequential architecture or adversarial assessment; `gpt-6-luna` is suitable for bounded clerical checking with lead verification. If unavailable, use the closest available capability and record the substitution. These are Codex development-session choices, separate from the Autark's configurable inference providers and its measured task routing policy.

Parallel subagents receive a task ID, owned paths, input contract revision, deliverable, acceptance criteria and resource/authority limits. Table dependencies are prerequisites for that task, not an instruction to serialize unrelated tasks. A lead may split a task further only when each child has its own file or worktree ownership and an inspectable result. Reviewers receive a fresh context with the frozen diff, governing contracts and actual evidence; author self-assessment does not replace review.

## Handoff to Aeon 2

The [Aeon 2 plan](aeon-2.md) begins operationally only after H1 in L09. The handoff includes a usable internal plan and tool-accessible task registry; known capabilities and limitations; identities and provenance rules; live goals and commitments; resource allocations; the exact current release; recovery procedures; and authority boundaries. The Autark must demonstrate that it can retrieve this state, select a justified next task, delegate when useful, verify the result, retain what it learned and revise the plan. A generated statement that it understands the plan is insufficient.

Aeon 1 must not outsource unimplemented essentials to an aspirational Aeon 2 backlog. General tool iteration, usable memory, persistent initiative, real coding, recovery, prompt control, independent evaluation and a working whole-system upgrade path are prerequisites for the takeover.
