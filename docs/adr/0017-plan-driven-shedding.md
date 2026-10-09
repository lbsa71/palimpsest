# ADR 0017: Durable executable plan contracts across successive sheds

- **Status:** Accepted specification; catalog, durable executor, authoritative item checks and serving integration implemented with fixtures. Reviewed implementation installed; first live item completed with restart and publication assistance. Dependent item and unassisted repeated live sheds pending.
- **Recorded:** 2026-10-09.
- **Requirements:** R01, R03, R06–R07, R09–R19, R22–R24.
- **Specification:** [Plan-driven shedding](../plan-driven-evolution.md).
- **Extends:** ADRs 0012, 0015 and 0016 without relaxing cognitive-only admission or the separate host/rescue boundary.

## Context

The user wants Palimpsest to begin reliably self-evolving according to the implementation plan through shedding iterations. Standing growth records investigations and source hypotheses, and the conversational release path can act on an eligible concrete suggestion. Neither establishes durable repository-work selection, dependency completion or independent evidence of arbitrary proposed improvements. Generic contract checks and persuasive review are insufficient to close a work item.

Successive releases also need a consistent source base. Autonomous local promotion without publication leaves checkout HEAD behind; freezing the next candidate from that checkout can discard an earlier admitted improvement. Current capability must be reconciled after rollback rather than inferred from a permanent historical completion flag.

## Decision

Use a versioned protected host-owned executable catalog linked to repository work items. Each item carries its specification, dependency identities, permitted source paths, authoritative behavior-check IDs and finite attempt limits. Bind the exact catalog, work item, source, proposal and evidence identities throughout execution. Models implement or challenge the item; they cannot alter its admission rules or allocation in the same transaction.

Version 1 contains two real P06 contracts: preserve exact current memory lineage descriptors, then establish a UTF-8 total context budget with newest-first selection while retaining that lineage. These are bounded inspectable cognitive behavior changes, not edits to an arbitrary personality string. The catalog loader accepts only the fixed tracked checkout file, strictly validates fields, identities, graph, scope, budgets and size, and returns immutable records. A pure validator is diagnostic and grants no runtime authority.

The trusted executor stores unfinished work and outcomes outside the repository, selects eligible work without a fresh human request, supplies actual admitted source and previous authoritative failures, and applies both existing mandatory gates and item-specific held-out checks. Fresh review, authenticated continuity interview, fenced succession and real probation remain necessary. Reconcile exact-artifact publication before preparing the next shed. Unknown external outcomes hold progression until observed or safely resolved; no blind replay or hidden budget refill.

The user selected hourly authoring during testing on 2026-10-09. Retain daily mode as the installation default and add explicit fixed UTC-hour plan allocations: one proposal and eight release calls by default. Count actual reservation times across policy changes, retaining old immutable windows and uncertain calls. No unused hours accumulate. This testing cadence preserves complete-attempt funding, item ceilings, user priority and release gates. A separate Codex inspection at minute 45 observes actual quality and failures; it is not the application scheduler.

Standing growth remains a separate mandatory mission and receives fair configured capacity. User commitments retain priority. Interruption before fencing pauses bounded work; after fencing mechanical recovery finishes. Restart and succession preserve item state, reservations, failures and next actions. Rollback retains lived history while reconsidering which dependencies the current source satisfies.

Publication recovery observes the configured remote's ancestry when later authorized host commits advance its tip. The exact reserved publication commit must remain reachable and its cognitive bytes must match the frozen artifact. Remote-tip equality alone incorrectly strands a previously published release; trusting a local completion flag alone does not independently observe the remote. Missing, divergent or unavailable history retains an explicit hold. Recovery performs observation only, without replaying a push or changing checkout source.

The complete implementation plan extends beyond this initial catalog. Unsupported protected host, tooling, memory-infrastructure or custodian work remains explicitly open until a separate evaluated upgrade/rescue contract or suitable candidate-owned application boundary exists. This ADR does not expand those permissions or claim the broader objective complete.

## Alternatives

- **Feed PLAN prose into standing growth:** Useful context, but neither machine-checkable completion nor enforceable per-item acceptance. Rejected as the execution contract.
- **Let the candidate supply checks or edit the catalog:** Lets an implementation define its own success or authority. Rejected.
- **Use only generic checks and model approval:** Preserves old behavior but cannot prove the new behavior. Retain generic checks and add independently collected item evidence.
- **Rewrite host/custodian code through the ordinary candidate lane:** Changes the rules admitting the same candidate and loses the retained rescue boundary. Rejected; separate upgrade required.
- **Make publication optional between iterations:** Can strand the clean source base and overwrite the preceding improvement. Hold progression until exact source/publication reconciliation succeeds.
- **Keep only daily authoring during testing:** Delays observed feedback until tomorrow despite explicit hourly direction. Use an operator-selected hourly lane; avoid changing other installations or refilling daily budgets.
- **Reset allocations when changing cadence:** Would erase actual spending. Count timestamps across both modes and preserve historical windows instead.
- **Reduce growth to delivery work:** Loses personality, curiosity and independent learning obligations. Retain both agendas under visible fair allocations.

## Consequences and validation

Plan execution becomes inspectable and testable across releases, with additional durable identity, dependency, budget and effect-reconciliation state. New executable contracts or broader authority require reviewed host changes; ordinary candidates cannot silently add them. Failed experiments may preserve valuable learning while their implementation work remains unfinished.

Live deployment exposed two operational dependencies separately from author quality: publication must recognize an exact earlier commit beneath later remote host commits, and a relocated host must pass the same canonical dependency path to its compiler and sandbox grants. The first Mistral provenance proposal was minimal and passed its item fixtures, but the copied host's lexical dependency link prevented Node type lookup and admission declined. Repairing host infrastructure does not refund its model call or establish a successful shed. The [quality inspection record](../self-evolution-quality.md) distinguishes these observations.

Five local loader tests pass after an initial missing-module failure, covering content identity/immutability, unknown schema/IDs/checks/paths, graph/size/resource limits, candidate-input exclusion, fixed tracked checkout loading and symlinks. Fifteen executor tests pass after establishing the missing executor, covering durable dependency selection and metadata, exact completion, failed-release feedback, finite attempts/cooldown, immutable budgets, unknown-call recovery without replay, stale-owner output, user priority, source mismatch, protected paths, rollback revalidation and temporary source-observer failure. These are callback fixtures; they neither execute item checks nor prove a real shed. Completion requires independent per-item before/after checks, two useful live model-generated sheds with actual publication and serving successors, a restart between them, failure feedback, interruption/budget continuity and negative authority/publication cases described in the specification. Qualitative developmental acceptance and broader PLAN delivery remain separate.


## Reviewed host follow-up — 2026-10-09

A real informational probe reported both active hourly and inactive daily allocation values as simultaneous limits. An absent standing-growth timer during task quiescence was also interpreted as unscheduled growth. The [facts refinement contract](../publication-diagnostics.md) supplies an explicitly selected plan allocation and separates the configured mission from its current timer state. Retain existing fields with an explicit compatibility/alternative-policy label rather than silently breaking clients; candidates still cannot select budgets or gain authority. The facts and concise evidence-grounded reply instruction passed focused checks and fresh review and are installed in frozen host `c287e026`; later actual model output must establish improved calibration. The probe correctly denied a byte guarantee but overstated chronology and ended midphrase, so no blanket improvement in model calibration is claimed.


The first hourly byte-budget attempt failed its unchanged selected contract before assessment or succession. Exact code inspection also found incorrect aggregate accounting and useful-prefix omission. Refine host-owned instructions using these observed constraints, preserving the failed frozen artifact, its spent call, the catalog and validators. This is engineering feedback, not manual candidate repair or evidence of a successful second shed. The [separate interactive integration gate](../publication-diagnostics.md#p06-provider-request-integration-gate) remains necessary because host request preparation currently replaces the candidate's memory projection.


The staged provider-request bridge preserves the same existing authorized twelve-record input subset and validates/reuses its candidate projection at the final provider boundary. Bind host validation to the active worker manifest rather than candidate-declared capabilities: preserve provenance-only compatibility, then enforce the byte-budget contract only after it is admitted. Pre-P06 ordinary custom roots and standalone legacy factories retain their earlier contracts. Expanding retrieval or enforcing future budget guarantees universally would conflate source serialization with infrastructure and regress the incumbent; both require separate work. Current all-store loading and global-recency limitations remain open.
