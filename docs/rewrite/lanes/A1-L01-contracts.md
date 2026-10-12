# A1-L01 — contracts and architecture foundations

**Hibernated at user request, 2026-10-12. No active session owner or goal.** Read [RESUME](../RESUME.md) for the current checkpoint and restart order; older ownership/status entries below are historical unless reaffirmed there.

Status: **accepted — C1 engineering interface gate only**. Session owner: **Codex /root/a1_contract_closeout**. Accountable actor: Codex. Governing method: [workflow](../workflow.md). Phase and dependencies: [Aeon 1](../aeon-1.md).

Requirements: [RW01, RW04, RW09, RW12, RW15, RW16, RW19, RW21](../../../REQUIREMENTS.md).

```text
/goal Complete A1-L01 by delivering reviewed, executable contracts for the rewrite's reasoning, tools, durable state, memory, goals, communications, evaluation and release boundaries, with ownership and failure semantics agreed by every consumer, so the remaining lanes can implement independently without importing legacy compatibility.
```

## Ownership and interfaces

Own `packages/contracts/`, `docs/rewrite/contracts/`, this lane file and `docs/rewrite/evidence/A1-L01/`. These paths are frozen under C1 `aeon1.c1.v1`; coordinate revisions with affected consumers. Do not implement other modules or edit their owned interfaces without their owner. Coordinate root build scaffolding with L09. Record decisions in reserved ADRs through the lead.

Specification dependencies: none; solicit needs from L02–L09, especially L09's authority and release boundary. Implementation dependencies: none; fixtures use deterministic in-memory implementations. Integration dependency: every consumer acknowledges the same C1 revision. C1 is a narrow interface gate, not a demand to solve every implementation choice first.

## Delegable tasks

| Task | Deliverable and exclusive child scope | Model / effort | Dependencies | Acceptance |
|---|---|---|---|---|
| A1-L01-T01 | Requirements-to-contract map and keep/adapt/discard ledger in `docs/rewrite/contracts/scope.md`; classify user requirements, proposed designs and unknowns | `gpt-6-astra` / high | None | Every new requirement has an owning contract and acceptance lane; every proposed retained subsystem has a reason it would be chosen in a fresh design; no old API or database compatibility obligation survives by implication |
| A1-L01-T02 | Run, step, tool, observation, effect, checkpoint and cancellation schemas plus positive/negative fixtures under `packages/contracts/execution/` | `gpt-6.1-sol` / high | T01 draft; L03/L06 boundary proposals | An effect with an uncertain outcome, duplicate input, cancelled run and resumed checkpoint have unambiguous identities and transitions; library session IDs are not the sole durable task identity |
| A1-L01-T03 | Experience, memory, self-state, goal, drive and obligation schemas under `packages/contracts/development/` | `gpt-6-astra` / high | T01 draft; L04/L05/L07 boundary proposals | Observations, interpretations, beliefs and commitments are distinguishable; revision/provenance/scoping survive summarization; a conversation delivery obligation does not disappear when a goal is paused or a memory is forgotten |
| A1-L01-T04 | Capability, provider accounting, prompt manifest, evaluation and release schemas under `packages/contracts/control/` | `gpt-6-astra` / high | T01 draft; L02/L08/L09 proposals | Every physical request and effect can be attributed; effective local prompt composition is inspectable; candidate/reviewer/current authority are distinct; a candidate cannot approve its own altered controls |
| A1-L01-T05 | C1 contract gate report, consumer conformance fixtures and package dependency map in `docs/rewrite/contracts/C1.md` and `packages/contracts/conformance/` | `gpt-6.1-sol` / high; fresh `gpt-6-astra` / high reviewer | T02–T04 | All consumers acknowledge the frozen revision; executable examples pass; circular dependencies and ownership collisions are resolved; changes after C1 have an explicit coordinated revision process |

T02–T04 run concurrently once T01 supplies the scope draft. Each author receives only its owned contract namespace; shared primitives are proposed to the lead for serialized integration.

## Completion evidence and exclusions

Record schema examples, conformance command/results, accepted consumer feedback, unresolved design choices, reuse ledger and fresh review in the lane evidence directory. The lane is accepted when C1 is reproducible and other lanes can implement against it. A prose architecture without executable examples is incomplete.

Non-goals: selecting a framework without L02 evidence, building the application, retaining old source layouts, writing a migration tool, or treating every historical implementation safeguard as a fixed new mechanism. Stable new interfaces are for parallel work; they do not create a promise to support old interfaces indefinitely.

## Coordination

Owned by the lead who claims this lane; update here before concurrent implementation.

| Field | Current value |
|---|---|
| Owner session | Codex /root/a1_contract_closeout; fresh finite closeout delegated by integration owner; evidence/handoff recorded |
| Branch / worktree | `codex/a1-contract-closeout-20261011` / `/home/palimpsest/migration/aeon-1-20261011/contract-closeout` |
| Base source / contract revision | `dbab4be`; C1 `aeon1.c1.v1`; frozen consumer integration review |
| Additional path reservations | None; use the exclusive scope above |
| Last handoff / evidence | Closeout commit containing this lane update; frozen source `dbab4be4e05a6be358fae376b2ca19934b35e5d2`; C1 unchanged. Fresh 17/17 contract + 7/7 consumer-schema/envelope checks, zero skips, strict TypeScript pass; [review/matrix](../evidence/A1-L01/closeout.md), [manifest](../evidence/A1-L01/closeout-manifest.json). Original implementation handoff retained in [historical evidence](../evidence/A1-L01/implementation.md). |
| Blockers / next eligible task | No remaining C1 interface blocker. Integration owner accepted fresh delegated L02–L09 conformance dispositions; these are not original-author acknowledgements. New batch/qualification consumer changes require acknowledgement and any API change a coordinated revision. Other lanes, live gates and H1 remain separate. |

## Fresh closeout task and acceptance

A1-L01-T05-closeout: at frozen `dbab4be`, inspect actual L02–L09 consumers and fresh review evidence, run bounded conformance/compilation checks, replace stale pending acknowledgements with explicitly delegated integration dispositions, and record the exact source/evidence handoff. Exclusive scope remained this lane, contracts documentation and L01 evidence; no shared API edit was needed. The integration owner received the recommendation and explicitly accepted C1 before this status change. T01–T04's unchanged executable contracts and scope map, plus T05's [fresh matrix and evidence](../evidence/A1-L01/closeout.md), satisfy the lane's engineering acceptance. No claim of full consumer-lane or Aeon 1 acceptance follows.
