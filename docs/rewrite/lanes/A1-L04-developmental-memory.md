# A1-L04 — developmental memory and a revisable self

Status: **implementing**. Session owner: **`/root/a1_memory`**. Accountable actor: Codex. Governing method: [workflow](../workflow.md).

Requirements: [RW06, RW08, RW09, RW19](../../../REQUIREMENTS.md).

```text
/goal Complete A1-L04 by implementing a developmental memory and self-state system that retrieves relevant experience beyond the recent transcript, consolidates and corrects it with provenance, and demonstrably changes later judgments, interests and conduct across restarted sessions without prescribing a fixed personality.
```

## Ownership and dependencies

Own `packages/development/`, this lane file and `docs/rewrite/evidence/A1-L04/`. Own experience interpretation, memory lifecycle, retrieval and revisable self-state. L03 supplies durable storage; L05 owns commitments and scheduling; L02 owns the final prompt assembler. Supply structured context, not a second hidden system-prompt layer.

Specification dependencies: C1 experience/self-state contracts, including privacy and provenance. Component implementation uses fake events/storage. Integration dependencies: L03 persistence, L05 goal linkage, L02 context assembly and L08 independent longitudinal fixtures. Ordinary social context must not be erased merely because its speaker lacks code-modification authority.

## Delegable tasks

| Task | Deliverable and exclusive child scope | Model / effort | Dependencies | Acceptance |
|---|---|---|---|---|
| A1-L04-T01 | Episodic ingestion with observation/interpretation separation and source lineage in `packages/development/experience/` | `gpt-6.1-sol` / high | C1; L03 append interface | Incoming speech is attributed experience; unverified claims remain unverified; tool observations and the Autark's interpretations are distinct; mixed-author conversation can inform cognition without acquiring another author's permissions |
| A1-L04-T02 | Relevant retrieval, salience, query expansion and context assembly in `packages/development/retrieval/` | `gpt-6.1-sol` / high | C1; T01 interface | A relevant old experience is retrieved after more than twelve intervening exchanges; context limits degrade by declared policy rather than arbitrary prefix loss; provenance/privacy survive selection; retrieval quality and latency are measured |
| A1-L04-T03 | Consolidation, contradiction handling, revision, forgetting and procedural memory in `packages/development/consolidation/` | `gpt-6-astra` / high | C1; T01 interface; L03 durable job boundary | Consolidation is scheduled in real operation; conflicting claims remain distinguishable until resolved; corrected beliefs supersede rather than silently rewrite evidence; deletion/retention policy propagates to indexes and derived memories |
| A1-L04-T04 | Versioned self-state for interests, values, abilities, uncertainties and chosen self-description in `packages/development/self/` | `gpt-6-astra` / high | C1; T01 interface; L05 drive interface | The Autark can retain and revise a stance, preference or self-description with reasons and evidence; a chosen name is possible but not required; self-state affects a later decision; no seeded identity or generic helper persona is presented as lived discovery |
| A1-L04-T05 | Integrated developmental fixtures and independent evidence in `packages/development/test/` | `gpt-6.1-sol` / high; fresh `gpt-6-astra` / high reviewer | T01–T04; L02/L03/L05; L08 rubric | Delayed retrieval, correction, interrupted consolidation, social-to-self-chosen inquiry and later transfer are demonstrated; irrelevant private context is excluded; measurable behavioral revision is separated from a fluent autobiography |

T02–T04 can run concurrently against T01's contract and synthetic experiences. The lead integrates lineage and retention changes; those invariants must not be duplicated inconsistently across child implementations.

## Completion evidence and exclusions

Record retrieval fixtures and misses, provenance traces, real consolidation job outcomes, superseded self-state revisions and later decisions influenced by retained experience. Include counterexamples where retrieval or interpretation fails. L08 evaluates novelty, judgment and transfer independently; memory volume or similarity scores alone do not close the lane.

Non-goals: proving consciousness, defining a permanent personality, treating every statement as a fact, making all memory globally readable, importing old conversation history automatically, or replacing genuine later behavior with a self-rated growth score.

## Coordination

Owned by the lead who claims this lane; update here before concurrent implementation.

| Field | Current value |
|---|---|
| Owner session | `/root/a1_memory` |
| Branch / worktree | `codex/a1-memory-20261011`; `/home/palimpsest/migration/aeon-1-20261011/memory` |
| Base source / contract revision | `3398077`; `aeon1.c1.v1` acknowledged; storage commit `8dd8ee7` consumed |
| Additional path reservations | None; use the exclusive scope above |
| Last handoff / evidence | Component implementation active; finite goal created |
| Blockers / next eligible task | T01–T04 component work; joined L02/L05/L08 and live longitudinal gates remain |
