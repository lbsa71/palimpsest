# A1-L02 — selected agent shell and qualification

Status: **reviewing engineering disposition; live Q3 remains open**. Current disposition owner: **Codex /root/a1_shell_disposition**; original implementation owner: **Codex /root/a1_shell**. Accountable actor: Codex. Governing method: [workflow](../workflow.md); [ADR 0032](../../adr/0032-select-pi-core-and-source-owned-dependencies.md) selects Pi agent core; [qualification](../agent-shell-decision.md) defines Q1–Q5. The 2026-10-11 source/decision subtask is recorded, not completion of this lane.

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
| Owner session | Codex /root/a1_shell_disposition; finite static E3 qualification disposition (original implementation: /root/a1_shell) |
| Branch / worktree | `codex/a1-shell-disposition-20261011`; `/home/palimpsest/migration/aeon-1-20261011/shell-disposition` |
| Base source / contract revision | Disposition source `fbaa610`; C1 `aeon1.c1.v1`, separately accepted by L01/root; pinned Pi `89e5c2c075535e2f427c30fc74720d65b2944ff9` |
| Additional path reservations | None; use the exclusive scope above and L09 for shared build files |
| Last handoff / evidence | [Current Q1–Q5/T01–T06 disposition](../evidence/A1-L02/qualification-disposition.md), source `fbaa610`; final independent dependency review `79b6df2`, execution `c7ca96e` (1/1, 27.689 s). Original reports and failures remain historical evidence. |
| Blockers / next eligible task | T01/T02/T03/T05 integrated; bounded Q1/Q2/Q4 engineering evidence mapped, Q5 recommends continuing Pi. Root E1 owns final integrated checks. T04/Q3 live twelve-case Mistral screen remains unexecuted. Fresh completion audit found the existing screen is reference-actor-only; its real-application adapter must be implemented before a live attempt. Root assigned the first eight-case unit below. A configured grant and independent outcomes remain necessary; final Q5/full lane acceptance stays open. No Rig trigger established. |

### Exact dependency succession evidence task — 2026-10-11

Root assigned `/root/a1_dependency_succession` a finite T06 engineering subtask at base `e542f49`, branch `codex/a1-dependency-succession-20261011`, worktree `/home/palimpsest/migration/aeon-1-20261011/dependency-succession`. Exclusive writes: new `deployment/dependency-succession.test.ts`, `docs/rewrite/evidence/A1-L02/dependency-succession.md`, and this coordination subsection. Shared application, source tools, supervisor and build contracts remain root-owned.

`/goal Close the exact retained-dependency/admitted-successor evidence gap: edit an invoked locally owned validator in disposable source, pass pinned check/build, admit and execute those bytes under prior controls, preserve latest memory/goals/obligations, and hand off a reviewable fixture with actual results and exact manifest limitations.` Actual finite goal created without a token budget. Read/write/check preparation can proceed independently; root serializes the heavy fixture window and aggregate/installed reruns. Existing fresh-process schema probes and unrelated runtime/bootstrap succession do not jointly establish this exact witness. Live screen, independent qualification and comparator gates remain open.

Bounded author task is **fixture-verified** at `b8ade3a8849de990a4a3bffd8ef385f876f2f800`: real confined retained-validator edit → actual failed/repaired pinned check/build → old-control staged successor and fresh old-policy probation → changed function invoked by ordinary service/broker/tools at epochs 1→3→5 with latest real memory/goals/owed obligations retained. Case passed 1/1, zero skips, 24.309 seconds. Two original fixture failures remain preserved. [Exact evidence and review instructions](../evidence/A1-L02/dependency-succession.md). Fresh final reviewer `/root/a1_engineering_proof_review` subsequently reproduced the unchanged fixture at `c7ca96e`: 1/1, 27.689 seconds; final review `79b6df2` recommends accepting this bounded witness. The current Q1–Q5/T06 disposition below maps the separate real pending-effect and prompt evidence; full lane acceptance remains open on live Q3 and applicable final integration checks.

### Qualification disposition claim — 2026-10-11

Root assigned `/root/a1_shell_disposition` a finite E3/T01–T06 synthesis at source `fbaa610`, branch `codex/a1-shell-disposition-20261011`, worktree `/home/palimpsest/migration/aeon-1-20261011/shell-disposition`. Exclusive writes: new `docs/rewrite/evidence/A1-L02/qualification-disposition.md` and this lane's status/coordination. Source, shared ADRs and root acceptance remain with their owners.

`/goal Consolidate the exact Q1–Q5/T01–T06 source, evidence and complexity disposition; identify remaining engineering versus live gates; persist an executable handoff and reasoned Pi continue/fallback decision without accepting missing evidence.` Actual finite goal created without a token budget. This task uses bounded static reads and existing observations only; no build, freeze, mount, paid/authenticated request, external message or production action.

Disposition task complete: [qualification-disposition.md](../evidence/A1-L02/qualification-disposition.md) maps all gates/tasks, current request ownership, actual journal evidence, reproducible inventory, measured build observations and exact successor identities. It distinguishes the real L03 uncertain-effect witness from arbitrary fixture storage markers, records batch-delegation/schema and cumulative comparator updates, and gives the next owners/entry gates. Continue Pi; do not infer full L02 acceptance without live Q3. Only read-only source/inventory checks and documentation consistency validation were performed in this task. Exact handoff is the commit containing this report and lane update, returned to root; root owns integration and central E3/E1 status.

### Real application screen claim — 2026-10-11

Root assigned `/root/a1_real_screen` a finite T04/L08 implementation goal at `869f627`, worktree `/home/palimpsest/migration/aeon-1-20261011/real-screen`. Routing: `gpt-6.1-sol` / high; fresh independent review follows. The [completion audit](../evidence/A1-L09/completion-readiness.md) fixes the behavioral map and first-unit boundary before implementation. Exclusive writes are new `evaluations/product/screen.ts`, its bounded driver/tests and `evidence/A1-L08/real-screen.md`; a minimal read-only observation-helper extraction from `product/adapter.ts` is permitted while preserving its API. Other runtime/contracts/configuration require root coordination.

`/goal Implement and verify the eight-case partial real-application screen S01–S07 and S10 with actual tools, child work, pre-dispatch public setup, bounded observation evidence and original resource accounting; preserve failures and hand off exact source for fresh review without claiming live competence.` Four lifecycle cases S08/S09/S11/S12 remain the next fixed-intervention unit. The reference actor stays mechanical. Pure checks and strict compilation precede a root-coordinated confined synthetic window; no paid calls, private key access or external effects are authorized by this claim.
