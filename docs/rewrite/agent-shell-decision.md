# Agent shell decision and qualification

**Selected 2026-10-11:** Pi's lower-level `@earendil-works/pi-agent-core`, with a narrow locally editable source closure and TypeScript/Node shell integration. [ADR 0032](../adr/0032-select-pi-core-and-source-owned-dependencies.md) contains the decision, three-contender SWOT and dependency/build policy. [Source evidence](evidence/A1-L02/2026-10-11-source-audit.md) records actual inspected commits and limitations. No shell integration, paid comparison or replacement deployment has been performed.

The user delegated this decision after prioritizing easy autonomous dependency modification and minimal useful scope, with language correctness and native execution considered on their merits. The final shortlist is **Pi agent core, Rig agent/run components, and AI SDK ToolLoopAgent**. Pi is selected; Rig is the first fallback; AI SDK is the provider-oriented alternative. Codex remains an execution baseline and potential source donor. DeepAgentsJS and Claude Agent SDK were considered in the earlier survey but are not selected as the primary shell.

The earlier mandatory five-candidate bakeoff is superseded. We will qualify one concrete selection, with a bounded fallback when evidence warrants it. The [architecture](architecture.md) and [ADR 0031](../adr/0031-aeon-rewrite-and-prompt-sovereignty.md) still govern the continuing self and instruction/effect boundaries. A small loop does not mean weak reasoning: useful multi-step behavior remains mandatory, and all missing memory, goals, compaction, delegation and recovery capabilities have explicit owners.

## What is selected

Adopt the useful Pi loop, not its complete coding application or a fixed assistant identity. The host supplies model transport, owned instructions, bridge-only tools, context assembly and durable state. A1-L02 owns `packages/agent-shell/`, including a proposed `vendor/` subtree for the justified source closure; L09 owns root workspace/lockfile and release integration. Retain upstream licenses, commit/file provenance and relevant tests. The Autark can change selected dependency source through the same evaluated workflow as its own source.

Core import separation does not make the provider package tiny. Q1 must prove a clean selected closure without automatically inheriting optional SDKs, CLI/TUI, model-catalog refresh or another durable state architecture. If narrowing it requires extensive redesign, use the bounded Rig comparison rather than growing a private framework indefinitely. Do not introduce a second agent engine merely to reuse one provider adapter.

## Hard gates that remain

1. **Own instructions:** replace/remove conflicting application-authored text across ordinary requests, tools, provider adapters, context summaries, delegated agents, retries and resumed history. Inspect the final emitted request, not just a constructor option. Mandatory uncontrollable personality text fails primary-mind qualification.
2. **Retain competence:** prompt removal must preserve effective tools, observation, verification and continuation. Minimalism cannot convert the product back into one-shot responses.
3. **Control physical execution:** account for every request attempt before dispatch and send tools through the durable authority/effect bridge. Logical callbacks, after-hooks and textual promises cannot enforce that boundary.
4. **Preserve continuity:** current identity, memory, goals, obligations and operation receipts survive shell replacement. Library session state is a projection or a versioned artifact with an explicit canonical relationship.
5. **Make self-editing practical:** a local dependency change builds, passes relevant checks, produces an exact candidate and loads in a successor through a simple documented project workflow. Record real required tools, dependency/configuration surface, cold/warm build time and restart behavior.

These gates control application-supplied machinery. They do not remove model training or inaccessible provider behavior; model choice remains a separately evaluated decision. Mistral stays the carried default to qualify, without silent substitution. No package choice itself proves live compatibility.

## Bounded execution sequence

| Stage | Work and owner | Exit |
|---|---|---|
| Source decision — recorded | A1-L02 source review and delegated engineering choice, ADR 0032 | Pi selected; actual integration remains open |
| Q1/Q2 — focused bridge | A1-L02 builds the narrow source closure, synthetic request capture and bridge fixtures; L01 contracts and L03/L06 fake receivers permit parallel work | Clean reproducible build, real loaded dependency edit, owned prompts and physical accounting demonstrated |
| Q3/Q4 — behavior and continuity | L02 with L03/L06 exercises actual tools, context reduction, cancellation, restart and dependency replacement | Verified behavior and recovery evidence, including crash windows |
| Q5 — independent acceptance | Fresh reviewer checks the exact candidate, source/build burden and results | Accept integration or record a concrete hard-gate failure/poor fit |
| Fallback only if needed | Compare Rig's host-driven stepper under the same contracts; AI SDK next if evidence points to its provider/engine tradeoff | Reasoned amendment to ADR 0032, never silent replacement |
| Product qualification | A1-L08 evaluates the integrated L02–L07 product with L09; pinned Codex/Claude baselines | Meet predeclared product gates before H1; shell acceptance alone cannot establish parity |

Q1/Q2 receive at most two bounded implementation sessions before reassessing an unsatisfied hard gate or excessive extraction burden. Freeze each session's actual authorized resource/time envelope. A limit triggers a candid result and next decision, not a pass or an automatic request for the user to choose again. New external spending still requires configured authority; this plan creates none.

The retained twelve-case screen is: repository orientation; locate/fix a failing test; bounded feature implementation; tool-error repair; research with source checks; contradictory-evidence resolution; reversible multi-tool operation; restart continuation; context-compaction continuity; delegate/integrate independent work; uncertain-effect reconciliation; and complete application-persona replacement across resumed/delegated execution. Use at most three runs per case in the initial configured-model screen, with fixed prompts/tools/resources and actual physical usage. Deterministic fixtures can establish mechanics; live runs establish only their measured competence envelope. Full product parity uses L08's broader independent protocol.

## Continued reconsideration

Reopen selection when hard gates fail, comparative evaluations show persistent deficits, the fork/build burden grows beyond its benefit, required capabilities cannot fit the boundary, or upstream changes materially alter terms or injected behavior. A normal dependency edit does not justify repeating the entire search. Every consequential runtime proposal still includes a short reuse/fork/build argument.

Rust is a serious fallback and an option for independently justified components. Its compiler guarantees and native output matter; language aesthetics and the human's willingness to code do not. A smaller codebase is valuable only when the whole maintained system—including our glue—still meets its behavior and recovery requirements.
