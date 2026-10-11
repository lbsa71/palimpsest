# A1-L06 — tools, iterative coding and delegation

Status: **planned**. Session owner: **unclaimed**. Accountable actor: Codex. Governing method: [workflow](../workflow.md).

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
| Owner session | Unclaimed |
| Branch / worktree | Not yet assigned |
| Base source / contract revision | Pin at claim; contracts not yet implemented |
| Additional path reservations | None; use the exclusive scope above |
| Last handoff / evidence | Planning specification only |
| Blockers / next eligible task | Apply the dependencies above; no implementation is claimed |
