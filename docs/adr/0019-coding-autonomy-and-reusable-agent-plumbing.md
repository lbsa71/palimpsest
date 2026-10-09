# ADR 0019: Iterative coding and autonomy over the whole codebase

- **Status:** Full-codebase autonomy and basic seed coding are explicit user requirements. The architecture below is the implementation design; library selection remains provisional pending P17.1 evidence.
- **Recorded:** 2026-10-09.
- **Requirements:** R03, R05–R06, R09–R19, R22–R26.
- **Work:** P17, P18; [coding specification](../coding-autonomy.md).
- **Refines:** ADR 0008's framework-free choice, ADR 0010/0015's narrow cognitive admission scope, ADR 0016's operator-only host bootstrap and ADR 0017's two-item executable plan.

## Context

The user found the current seed too limited: a single completion proposes full files under `src/agent/`, without search, ranged reads, partial updates, deletion or an iterative test/repair loop. The user explicitly makes full autonomy over the autark's own codebase the main priority and permits a local fork of a library. The user assigns Astra to strategy and Sol to implementation/testing.

Earlier narrow implementation slices remain valid evidence of what ran. They do not define a permanent limit on the product. Keeping the live evaluator independent of a candidate is compatible with authoring a future evaluator in a separate workspace and admitting it under an older mechanism.

## Decision

Make basic coding a P0 seed capability. Provide a durable mutable workspace and typed tools for search/list/read/create/edit/delete/move/diff and command execution. Run an iterative model/tool conversation with actual test feedback, bounded allocation and recoverable checkpoints. Freeze the final workspace for evaluation instead of requiring the model to serialize every modification as a complete replacement file.

Iteration does not redefine one provider call as an entire coding session. Reserve each model request under the active lane/window policy and an admitted finite session/attempt contract; checkpoint at exhaustion without borrowing other allocations. The current version 1 plan catalog's single-call proposal attempts retain their meaning. P17.3 must explicitly evolve that contract and accounting before multi-round use, without granting additional funding through this ADR.

Authoring can cover the full codebase, including tools, orchestration, memory, providers, dependency sources and local forks. Release admission uses the actual component changes and existing authority. Broaden ordinary application admission; implement autonomous outer-host/dependency release and a distinct autonomous governance/custodian upgrade path. The currently active admission rules cannot authorize their own replacement using newly authored rules. Keep an independently usable older rescue throughout each relevant transaction. Protected components can evolve across transactions; none are permanently human-authored by policy.

Reuse a maintained, inspectable and replaceable model/tool protocol library when it reduces total maintenance. The initial evaluation preference is AI SDK core plus direct Mistral integration, with Pi core/SDK as a comparison or alternative. This ADR does not select a package/version or require a framework. Preserve host control of each request/effect, durable truth, provenance and recovery. Adopt, adapt, fork or retain a smaller custom component according to measured compatibility and maintenance evidence in P17.1.

Forked dependencies are part of the autark's evolvable source/build inputs. Record upstream identity, license, local changes, reproducible build and evaluation; upstream acceptance is not a prerequisite to using a locally admitted fork. Pin exact inputs and keep a recovery artifact independent of network availability.

## Alternatives and consequences

- **Keep whole-file proposals and cognitive-only admission:** Small and already demonstrated, but cannot meet the explicit seed tooling and full-codebase autonomy requirements. Retain as historical compatibility while replacing the authoring path.
- **Build all provider/tool protocol support custom:** Feasible for a narrow provider contract; increases recurring compatibility/streaming work. Retain only where a library would introduce more complexity than it removes.
- **Adopt a full coding agent unchanged:** Provides more ready-made workflow, but its sessions, discovery, retry behavior and permission model may conflict with durable budgets, scoped context and custody. A fork is valid if its benefits justify owning that larger surface.
- **Replace the live installation directly:** Fails the existing exact-artifact, continuity and recoverable succession requirements. Isolated authoring followed by appropriate admission delivers autonomy without abandoning those contracts.
- **Reserve host/custodian code for humans indefinitely:** Conflicts with the clarified main priority. Operator bootstrap remains a current implementation fact; P18 must replace that limitation with an independently evaluated autonomous route.

This adds real workspace and tool-operation state and broadens release coverage. It should reuse existing task/effect journals, snapshots and custody rather than introduce another competing operational store. A library's defaults are not proof of enforced limits. New coding authority belongs to authorized engineering tasks; peer conversations retain their existing scope and no source-dispatch privilege.

## Acceptance and current evidence

The [specification](../coding-autonomy.md) defines observable tool, retry, interruption, dependency and release contracts. [A22](../acceptance.md#a22--iterative-coding-with-real-workspace-tools), [A23](../acceptance.md#a23--full-codebase-and-fork-evolution) and the full [A17](../acceptance.md#a17--separate-admission-and-custodian-evolution) are completion gates. Rejecting an ordinary governance edit and documenting a disabled upgrade path does not establish autonomous governance evolution.

The assessment inspected current Palimpsest code and upstream primary documentation/package manifests. No library compatibility spike, new tool loop or broadened release has passed on the strength of this ADR. Implementation and live evidence must be recorded separately by the implementation lead.
