# A1-L02 — selected agent shell and qualification

Status: **implementing**. Session owner for implementation: **Codex /root/a1_shell**. Accountable actor: Codex. Governing method: [workflow](../workflow.md); [ADR 0032](../../adr/0032-select-pi-core-and-source-owned-dependencies.md) selects Pi agent core; [qualification](../agent-shell-decision.md) defines Q1–Q5. The 2026-10-11 source/decision subtask is recorded, not completion of this lane.

Requirements: [RW01, RW02, RW04, RW05, RW13, RW16, RW17, RW19, RW21](../../../REQUIREMENTS.md).

```text
/goal Complete A1-L02 by integrating and independently qualifying the selected Pi agent core with a narrow locally editable dependency closure: demonstrate owned effective prompts, real tool-observation iteration, context continuation, physical request accounting, crash recovery and a dependency edit/build/successor-restart cycle under ADR 0032 Q1–Q5; retain evidence and invoke its bounded Rig fallback only if Pi fails those gates or proves excessively costly to maintain.
```

## Ownership and dependencies

Own `packages/agent-shell/`, including the proposed `vendor/` source subtree, `experiments/agent-shell/`, this lane file and `docs/rewrite/evidence/A1-L02/`. Only the lead integrates the adapter. Own shell-specific prompt composition and audit instrumentation, not personality content in L04 or permission enforcement in L09. L09 serializes root workspace/build/lockfile integration.

Specification dependency: C1 for final adapter; source-closure/build/request fixtures can start now. Implementation dependencies: L08 screening cases; L03/L06 receivers for final integrated runs. Fake model/tool receivers allow independent work. Coordinate cancellation, recovery and supervisor boundaries early. No dependency on a five-framework bakeoff remains; ADR 0032 already records the engineering choice.

## Delegable tasks

| Task | Deliverable and exclusive child scope | Model / effort | Dependencies | Acceptance |
|---|---|---|---|---|
| A1-L02-T01 | Complete the selected-source/license/import/patch manifest under `experiments/agent-shell/audit/`, using the [recorded audit](../evidence/A1-L02/2026-10-11-source-audit.md) as input | `gpt-6-astra` / high | Source decision available; C1 draft helpful | Every retained module, provider, instruction source and build input has a reason/owner; distinguish core from broad pi-ai installation closure; preserve notices/tests and exclude optional loaders/OAuth/catalog refresh unless specifically justified |
| A1-L02-T02 | Deterministic final-request, retry/transport, tool-preflight and resume fixtures in `experiments/agent-shell/audits/pi/` | `gpt-6.1-sol` / high | T01 draft; execution boundary draft | Actual emitted requests match owned manifest after replacement/resume; every physical attempt is intercepted before dispatch; before/after hooks alone are not claimed as durable effect enforcement; no live calls required for synthetic mechanics |
| A1-L02-T03 | Narrow source workspace and screening-capable bridge proof (including prototype context/delegation hookups) under `experiments/agent-shell/integrations/pi/`; build requests to L09 for shared files | `gpt-6.1-sol` / high | T01; C1 draft; T02 fixtures can evolve in parallel | Q1/Q2 pass: clean reproducible selected closure, no routine network catalogue refresh, real loaded local dependency edit, measured build/configuration surface, bridge-only tools and owned transport; reassess after at most two bounded implementation sessions if hard gates remain unsatisfied |
| A1-L02-T04 | Fixed screening/qualification results and decision disposition under `experiments/agent-shell/results/` | `gpt-6-astra` / high | T02–T03; L08 frozen twelve-case protocol; needed L03/L06 component adapters or explicit experimental equivalents | Q3 results retain failures/usage and at most three initial runs per case; source selection is not misreported as empirical success; update ADR only for evidenced changes; use the bounded Rig comparison if hard failures or excessive maintenance justify it |
| A1-L02-T05 | Production `AgentShell` adapter and justified local source closure in `packages/agent-shell/`, including prompt assembly, context reduction and checkpoint bridge | `gpt-6.1-sol` / high | C1; T03 qualified bridge; T04 disposition | Real multi-step tools, steering/cancellation and continuation work; context summaries and child/reviewer calls are accounted; pending assistant/tool crash state reconstructs correctly; upstream conformance cases retained; dependency edits use ordinary evaluated source workflow |
| A1-L02-T06 | Fresh Q4/Q5 prompt/effect, restart, dependency-replacement and upgrade-regression audit | `gpt-6-astra` / xhigh | T05; L03/L06 integrated adapters; L09 successor operation | Successor actually loads a changed local dependency, preserves current goals/memory/obligations and reconciles pending effects; final requests stay owned across upgrade/resume; exact source/build/evidence identities match; complexity and unresolved limits are honestly accepted or rejected |

T01 closure work and T02 fixture design run concurrently. T03 can use fake receivers while L03/L06 develop. T04 does not await L08's eventual integrated product comparison. Pi's separate durable package or selected tool utilities may be evaluated as donors; adopting another whole state architecture requires a new explicit decision. A fallback has its own disjoint directory, fixed gate and resource envelope; do not silently introduce a second active shell.

## Completion evidence and exclusions

Retain exact source/patch/license manifests, reduced build/import closure, actual request traces, transport reservations, tool observations, recovery outcomes, dependency edit/load proof, cold/warm build measurements, screening results, ADR disposition and independent review. L08 owns product-level parity; none is accepted merely by selecting Pi. Source code inspection and upstream tests are not executed integration evidence.

Non-goals: implementing all upstream optional capabilities, runtime hot-patching, manual installed-package edits, requiring upstream publication for a local change, unsupported provider policy bypass, fabricated growth, production hosting or silently weakening gates to fit a minimal codebase. Paid runs use configured authority/resources, not an entitlement created by this lane.

## Coordination

Owned by the lead who claims implementation; update before concurrent edits.

| Field | Current value |
|---|---|
| Owner session | Codex /root/a1_shell; implementation session 1, deterministic fixtures only |
| Branch / worktree | `codex/a1-shell-20261011`; `/home/palimpsest/migration/aeon-1-20261011/shell` |
| Base source / contract revision | Base `14c7420`; pinned Pi `89e5c2c075535e2f427c30fc74720d65b2944ff9`; C1 being coordinated with L01 |
| Additional path reservations | None; use the exclusive scope above and L09 for shared build files |
| Last handoff / evidence | Session 1 implementation `6d806a7`, review/reasoning corrections `44ca88c`, 22 passing mechanical cases; [evidence](../evidence/A1-L02/2026-10-11-implementation.md) and [dependency reassessment](../evidence/A1-L02/2026-10-11-typebox-reassessment.md) |
| Blockers / next eligible task | T01/T02/T03/T05 executable foundation implemented against C1 f11a25b; Q1 whole-dependency edit ownership, Q3 live screen, integrated Q4 and independent Q5 remain. L03/L06/L09 integration next. |
