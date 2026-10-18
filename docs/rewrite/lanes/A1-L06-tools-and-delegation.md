# A1-L06 — tools, iterative coding and delegation

**Hibernated at user request, 2026-10-12. No active session owner or goal.** Read [RESUME](../RESUME.md) for the current checkpoint and restart order; older ownership/status entries below are historical unless reaffirmed there.

Status: **reviewing** — ordinary tools and overlapping sibling delegation implemented, integrated and fixture-verified with fresh boundary review; live competence and independent task qualification remain open. Session owner: **a1_tools**. Accountable actor: Codex. Governing method: [workflow](../workflow.md).

Requirements: [RW02, RW05, RW09, RW13, RW16, RW19, RW21](../../../REQUIREMENTS.md).

```text
/goal Complete A1-L06 by providing usable research, workspace and command tools plus bounded delegated sessions, demonstrating an inspect-edit-test-repair workflow and a multi-agent task with verified results, durable artifacts and enforced resource and authority boundaries through the production runtime.
```

## Ownership and dependencies

Own `packages/tools/`, `packages/delegation/`, this lane file and `docs/rewrite/evidence/A1-L06/`. Own tool implementations, isolated development workspaces, task delegation and result/artifact exchange. L02 binds tools into the selected shell; L03 owns durable effects; L09 owns deployment/release authority. No special source directory is permanently the only self-editable domain.

Specification dependencies: C1 tools, artifacts, capabilities and child-run contracts. Tool implementations can start with a fake effect receiver. Integration dependencies: L03 effects/cancellation, L02 shell binding, L09 isolation and release boundary. L08 owns independent task acceptance; a subagent's result text is not accepted evidence by itself.

## Delegable tasks

| Task | Deliverable and exclusive child scope | Model / effort | Dependencies | Acceptance |
|---|---|---|---|---|
| A1-L06-T01 | File discovery/search/read/create/update/delete/move/diff tools in `packages/tools/workspace/` | `gpt-6.1-sol` / high | C1; L09 workspace confinement contract | Tools support whole and partial edits with actual resulting diffs; paths, symlinks and concurrent edits cannot escape or silently overwrite another task's workspace; results are bounded and preserve source provenance |
| A1-L06-T02 | Finite command execution, process observation, cancellation and artifact retention in `packages/tools/commands/` | `gpt-6.1-sol` / high | C1; L03 effects; L09 process boundary | Tests/builds execute in an authorized workspace; exit status and truncated output are explicit; interruption identifies surviving descendants and uncertain outcomes; drafts and relevant observations survive restart |
| A1-L06-T03 | Research/retrieval and explicit communication action tools in `packages/tools/information/` | `gpt-6.1-sol` / high | C1; L07 send contract | Inquiry can obtain new external evidence with attributed sources under configured access; model inferences and retrieved claims remain distinguishable; outward messages use the same durable effect path as other sends; tool descriptions do not prescribe a generic assistant identity |
| A1-L06-T04 | Delegated sessions, ownership, model routing and bounded result collection in `packages/delegation/` | `gpt-6-astra` / high | C1; L03 child-run/resource contract; L02 session interface | Parent creates explicit objectives, disjoint workspace scopes, budgets and acceptance criteria; model/effort availability is checked; cancellation and limits include children; nested delegation cannot escape cumulative limits; a completed child requires inspected artifacts before acceptance |
| A1-L06-T05 | Real iterative coding and cross-domain delegation scenarios in `packages/tools/test/` | `gpt-6.1-sol` / high; fresh `gpt-6-astra` / high reviewer | T01–T04; L02/L03/L09; L08 workloads | A novel failing task requires inspection, edits, actual failed test feedback, repair and independent verification; a parallel task integrates disjoint child results and resolves a rejected result; interrupted drafts resume; changes outside the former cognition-only surface can be submitted to L09 |

T01–T04 are independent once their shared interfaces are agreed. Split tool groups by path and effect category. Integration does not permit ad hoc direct subprocess or network calls that bypass the registered observation/effect boundary.

## Completion evidence and exclusions

Record command/effect receipts, rejected out-of-scope attempts, real draft history, test failures and repairs, child session resource usage, fresh review and integration traces. At least one demonstration must go through the ordinary running application path; a library constructor exercised only in tests does not establish availability.

Non-goals: deploying self-authored changes directly, allowing arbitrary parent-provided tool claims to grant authority, unrestricted recursive swarms, rebuilding a full IDE, or requiring a specific vendor for the Autark's reviewer. Model routing is measured and configurable, not a fixed hierarchy of worth.

## Coordination

Owned by the lead who claims this lane; update here before concurrent implementation.

| Field | Current value |
|---|---|
| Owner session | a1_tools |
| Branch / worktree | codex/a1-tools-20261011 / /home/palimpsest/migration/aeon-1-20261011/tools |
| Base source / contract revision | 4e55167 / aeon1.c1.v1 |
| Additional path reservations | None; use the exclusive scope above |
| Last handoff / evidence | [Bounded component evidence](../evidence/A1-L06/component-handoff.md); exact handoff is the commit containing this record |
| Blockers / next eligible task | T01–T05 engineering evidence now includes ordinary actual repair, inspected accepted/rejected siblings, cancellation/SIGKILL and interrupted coding recovery. [Parallel review](../evidence/A1-L06/parallel-review.md), [application review](../evidence/app-review/README.md) and [joined recovery review](../evidence/A1-L09/engineering-proof-review.md) supersede the blanket wiring/review blockers. L08 independent live coding/research/delegation competence remains open |
| Documentation disposition | `/root/a1_middle_lane_disposition`; `codex/a1-middle-lane-disposition-20261011`; `/home/palimpsest/migration/aeon-1-20261011/middle-lane-disposition`; frozen source `1909053`. Owns only these status/coordination sections and the [task/source/review matrix](../evidence/A1-L09/middle-lane-disposition.md); original component handoff above remains historical. |

## Ordinary parallel-child gap claim — 2026-10-11

Owner: `/root/a1_parallel_children`; branch `codex/a1-parallel-children-20261011`; worktree `/home/palimpsest/migration/aeon-1-20261011/parallel-children`; frozen base `8fa6be5`. Finite goal: implement and verify bounded overlapping ordinary-parent child runtimes with inspected acceptance/rejection. Exclusive writes: `packages/delegation/**`, narrow `packages/tools/index.ts` tool registry, delegation handlers in `deployment/application.ts`, delegation cases in `deployment/application.test.ts`, and [parallel-child evidence](../evidence/A1-L06/parallel-children.md). L03 runtime/start claims, general shell execution and L09 evolution controls remain with their owners. This claim addresses the ordinary-path T04/T05 gap only; independent and live qualification remain open.

Ordinary parallel-child delta status: **implemented and integrated through deterministic application fixtures**, with actual overlapping confined sibling shells, accepted/rejected inspected command artifacts, explicit integration, grant rejection before child admission, cancel/close recovery, and real host SIGKILL recovery. [Evidence and exact command results](../evidence/A1-L06/parallel-children.md). The finite implementation/fixture goal and subsequent [fresh review](../evidence/A1-L06/parallel-review.md) are integrated. That review reproduced and repaired whole-batch workspace/capacity preflight and persisted ancestor grant attenuation; it found no remaining blocking finding in the reviewed sibling path. The [current disposition matrix](../evidence/A1-L09/middle-lane-disposition.md) also maps ordinary real repair and independently reviewed interrupted coding evidence. Live competence and independent task qualification remain open.


## Coding limb claim — 2026-10-18

Status: completed for the finite implementation, inspected live test and review. Owner `/root`, branch `codex/aeon-slack-pilot-20261012`, checkout `/home/palimpsest/src/palimpsest`, base `d9a1b08b5c62d9fb5e90f7f6de3d37859dbccf76`. This user-requested finite task reclaims L06 coding and narrow L09 integration only; the broader backlog remains hibernated.

/goal Implement an external coding limb with Codex CLI as default and Pi as an explicit alternative; permit only one coding agent, retain its session for follow-up messages, and inspect a real start/follow-up test with retained event, file and command evidence.

Behavioral specification: the mind invokes `code` with a finite message, receives a durable session/turn acknowledgement and later an attributed result. `code_status` exposes actual retained events and results; `code_cancel` stops active work. One coding session is bound to its originating conversation/scope/workspace and one turn may execute at a time. Follow-ups resume the exact native session; neither automatic new sessions, retries, fallback providers nor Codex subagent fan-out are allowed. Coding has its own replaceable provider, instructions and limits and does not assume the mind's identity. Cancellation, output/deadline limits and interrupted outcomes remain explicit. Raw logs and billed cost uncertainty are retained; CLI aggregate usage is not physical API request accounting.

Exclusive paths: root owns `deployment/application.ts`, `deployment/config.ts`, narrow service/materialization composition, new coding orchestration/integration tests, mind prompt and planning/evidence docs. Provider author owns new `packages/coding/**`; process author owns new `deployment/codex-process.ts` and its tests. Root serializes shared contract changes. All agents use inherited Sol/high; offline author checks first. User explicitly requests a real final test run and inspection; no service deployment or unrelated live work is included.

Tasks: CL01 provider contract, Codex start/resume event parser and single-agent guards (provider author); CL02 injected bounded external CLI process and isolated host composition (process author); CL03 durable session command, Pi adapter and ordinary runtime wiring (root); CL04 fresh review, live start/follow-up inspection and handoff (fresh reviewer/root). Dependencies: CL03 consumes CL01; CL04 follows integration. Acceptance evidence belongs in `docs/rewrite/evidence/A1-L06/coding-limb.md`.

Completion: CL01–CL04 accepted with [retained evidence](../evidence/A1-L06/coding-limb.md). Final checks: 90 passed, two installation-environment skips, plus five service/supervisor checks passed; strict compilation and build passed. One real native thread handled five turns; independent generated tests passed 16/16. Fresh reviewer found no remaining blocker after repairing cumulative-token double counting. Five pre-existing application assertions remain documented separately; no all-repository green claim or production deployment. Additional narrow integration paths were `deployment/installation.ts`, `deployment/supervisor.ts`, `deployment/materialize.ts`, `deployment/service-child.ts`, `deployment/development-controls-rereview.test.ts`, `deployment/coding-shell.ts` and the new coding test files. Exact handoff revision is the commit containing this record. No active coding task remains queued by this implementation session.
