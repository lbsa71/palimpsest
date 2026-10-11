# A1-L02 — agent shell, prompt control and selection

Status: **planned**. Session owner: **unclaimed**. Accountable actor: Codex. Governing method: [workflow](../workflow.md); technology criteria: [agent-shell decision](../agent-shell-decision.md).

Requirements: [RW01, RW02, RW04, RW05, RW13, RW16, RW17, RW19](../../../REQUIREMENTS.md).

```text
/goal Complete A1-L02 by selecting and integrating a replaceable agent shell through a finite, reproducible comparison, demonstrating inspectable and replaceable local prompts, genuine tool-observation iteration, context continuation and complete provider accounting, with an ADR that justifies reuse, a maintained fork or a custom core from measured evidence.
```

## Ownership and dependencies

Own `packages/agent-shell/`, `experiments/agent-shell/`, this lane file and `docs/rewrite/evidence/A1-L02/`. Candidate spike subdirectories are disjoint; only the lead integrates the selected adapter. Own shell-specific prompt composition and audit instrumentation, not personality content in L04 or permission enforcement in L09.

Specification dependency: C1 for the final adapter; audit and throwaway spikes start immediately. Implementation dependencies: L08 benchmark fixtures; L03/L06 adapters only for final integrated runs. Supply a fake tool receiver so framework selection does not block other modules. Consult L09 early about subprocess, cancellation and confinement requirements.

## Delegable tasks

| Task | Deliverable and exclusive child scope | Model / effort | Dependencies | Acceptance |
|---|---|---|---|---|
| A1-L02-T01 | Source and license inventory, prompt injection map, fork/update cost and operational fit for each candidate in `experiments/agent-shell/audit/` | `gpt-6-astra` / high | None; verify current official sources and pinned candidate code | Inventory covers system/developer templates, built-in tool descriptions, middleware, discovered project files, subagent instructions, compaction, retry/reminder overlays, resumed sessions and provider request assembly; marks inaccessible behavior unknown; identifies which surfaces can actually be replaced |
| A1-L02-T02 | Tiny deterministic prompt/effect-interception fixtures for the five reusable candidates in separate `experiments/agent-shell/audits/<candidate>/` scopes | `gpt-6.1-sol` / high | Draft execution boundary; T01 draft findings | At most one bounded audit session per candidate captures actual instruction replacement and interception behavior, including retry/resume; source ownership, provider fit and hard-gate failures are evidenced; unfinished audits remain unfinished |
| A1-L02-T03 | At most two shortlisted bridge integrations in separate `experiments/agent-shell/integrations/<candidate>/` scopes, plus a small custom control | `gpt-6.1-sol` / high | T01–T02; C1 draft; L08 frozen screening cases | Selection follows hard-gate feasibility and estimated effort; at most two implementation sessions per shortlisted candidate establish the same tools, checkpoint, cancellation and prompt manifest; caps and actual authorized resources are frozen before work |
| A1-L02-T04 | Ranked, bounded bakeoff and decision proposal in `experiments/agent-shell/results/` | `gpt-6-astra` / high | T03; L08 screening protocol, not its later integrated results | Applies the twelve-case, three-run maximum screen in the shell decision; uses same-model comparisons where supported, source/control audits and measured integration effort; hard-gate failures cannot average into a pass; selected option, fork burden and rejected alternatives have evidence; broader product parity is assessed later by L08/L09 |
| A1-L02-T05 | Selected `AgentShell` adapter, default-free prompt assembly, full call/effect instrumentation and shell conformance checks in `packages/agent-shell/` | `gpt-6.1-sol` / high | C1; T04 decision | Multi-step tools, streaming/steering, cancellation, checkpoint reconstruction and context reduction work through application contracts; auxiliary compaction/review/subagent calls are accounted; library defaults cannot silently reintroduce removed persona instructions |
| A1-L02-T06 | Fresh prompt/control and integration audit with upgrade regression fixtures | `gpt-6-astra` / xhigh | T05; L03/L06 integrated adapters | Audited effective requests at every supported inference surface match the declared manifest; realistic repair and interruption checks pass; opaque provider constraints remain explicitly documented; dependency upgrade changes are detectable |

Candidate audits within T01/T02 run concurrently; shortlisted integrations within T03 run concurrently after the audit gate. Use the bounded stages in the [shell decision](../agent-shell-decision.md). A disqualified candidate needs evidence and a short disposition, not a full implementation. If no candidate qualifies, T04 must justify a custom core and scope it against the same fixtures; do not silently build another shallow wrapper.

## Completion evidence and exclusions

Retain pinned source references, source licenses, redacted prompt manifests, request traces, real observations, comparison results, engineering effort estimates, chosen ADR and independent audit. Proposed parity is not accepted here; L08 owns product-level claims. A replacement prompt alone is insufficient if hidden local middleware or compaction subsequently restores a prescribed servant identity.

Non-goals: bypassing inaccessible provider policies, asserting personality growth from prompt wording, requiring a specific framework because it is fashionable, hosting production, or inventing a new agent ecosystem before testing existing shells. Provider/model substitution and paid comparison runs require the actual configured authority and resources available to the implementing session.

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
