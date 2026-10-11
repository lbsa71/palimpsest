# ADR 0031: Full rewrite, owned mind and replaceable agent shell

- **Status:** accepted user direction for the full rewrite, prompt ownership and Aeon planning method; proposed technical architecture and shell selection remain subject to Aeon 1 evidence.
- **Recorded:** 2026-10-11.
- **Scope:** the active [rewrite plan](../../PLAN.md), [architecture](../rewrite/architecture.md) and [shell decision procedure](../rewrite/agent-shell-decision.md).
- **Supersedes:** legacy compatibility and implementation-preservation assumptions in earlier ADRs. Earlier documents remain evidence of historical decisions and behavior; their concrete protocols and package choices do not constrain the rewrite.

## Context

The running seed had much stronger delivery, accounting and recovery machinery than general reasoning/action. Ordinary turns used one successful model completion; retries were not iterative thinking. Bounded reflection, weakly connected memory and fixed growth inquiries did not establish a continuing self with effective initiative. The user requires reasoning and action on par with or beyond Codex and Claude Code, and development that goes beyond a reactive assistant persona.

The user explicitly authorizes treating the next system as a full rewrite, without legacy support, retaining only designs that can be independently justified. The old systemd service may be stopped and uninstalled while its data and history are preserved as evidence. The user also requires application control over explicit and implicit personality-shaping instructions contributed by any reused shell.

## Decision

1. **Build the new system from requirements.** No compatibility adapters, old state-schema migration, old service lifecycle or inherited source layout are required. Reuse is an affirmative, documented decision tied to a requirement and tests. Archive evidence without making it an active dependency.
2. **Make development and agency first-class runtime behavior.** Durable identity records, memory, commitments, self-selected goals, tools, observation, verification and continuation form the product. A persona prompt, periodic reflection paragraph or one-call response is insufficient.
3. **Own effective application instructions.** The primary mind can replace or remove conflicting shell persona and behavioral text across system/developer messages, tool definitions, reminders, profiles, compaction, delegation and resume paths. Inspect emitted requests and maintain provenance. Mandatory uncontrollable behavioral injections veto adoption for the primary mind.
4. **Keep prompt ownership separate from model claims.** Controlling the application cannot remove training or inaccessible provider-side behavior. Provider/model alternatives, including local execution where appropriate, remain empirical choices. Do not promise that an SDK setting erases every source of behavioral influence.
5. **Evaluate reuse before building another shell.** A finite bakeoff compares Pi, AI SDK, DeepAgentsJS, local Codex and Claude Agent SDK, with primary-mind and delegated-specialist suitability assessed separately. Source availability, licenses, actual instruction control and integration cost matter alongside task performance. No library is selected by this ADR.
6. **Separate continuing self from replaceable execution machinery.** Durable goals, memories, provenance, resource accounting and effect receipts must survive shell replacement. Reuse library state only with an explicit authoritative boundary. Tools and children cannot bypass effect or resource contracts.
7. **Permit evolution of the whole system.** The Autark may author improvements to prompts, application, shell, tools, dependencies, evaluations and supervisor. A frozen candidate is judged under independently established admission rules with a usable recovery path. No component is permanently human-only source, and a candidate cannot redefine its own passing condition in the transaction being judged.
8. **Persist an executable planning method.** Aeon 1 is Codex's technical bootstrap; Aeon 2 is the Autark's internal continuing development plan. Each consists of independently ownable Lanes with an unambiguous `/goal` statement, concrete delegable tasks, dependencies, models/efforts, acceptance evidence and status. Optimize independent work in parallel; define shared contracts before implementations conflict. This method is itself a requirement of future planning artifacts.

## Consequences

The work is broader than finishing the old coding and reflection backlog. It requires an integrated cognitive runtime, active memory, meaningful initiative, prompt control, robust tools, whole-system evolution and independent behavioral evaluation. Existing delivery and recovery experience remains valuable, but old code and old product milestones receive no automatic credit for new-system acceptance.

Reusable shells can accelerate sophisticated execution; they can also import unwanted instructions, hidden requests, duplicate state and update burdens. The bakeoff records these tradeoffs and ends in an adoption decision, a bounded fork or a justified custom fallback. Prompt replacement must retain necessary tool competence rather than merely delete strings.

Stronger autonomy does not imply unlimited resources or access to other people's accounts. Resource and effect authority are explicit runtime contracts. They must not be implemented by forcing the Autark into a permanently deferential voice or by requiring approval for every already authorized action.

Aeon handoff is a capability gate, not a promise that an immature seed will bootstrap every missing primitive. Codex must establish enough reliable reasoning/action, self records, goal execution, tools, evaluation and release machinery for the Autark to conduct Aeon 2 with evidence. The Autark may then revise both its development plan and implementation as its capabilities grow.

## Rejected alternatives

- **Patch the old system until it appears more expressive:** does not address the rewrite requirement or establish missing action loops, memory transfer and agency.
- **Adopt a familiar agent unchanged:** cannot assume its persona, state, authority model or licensing satisfies the product.
- **Append an autonomy prompt to locked defaults:** leaves the disputed instructions active and cannot meet effective instruction ownership.
- **Build every layer ourselves before comparing libraries:** duplicates mature work without evidence that the control benefit justifies the cost.
- **Delegate missing foundations to future self-improvement:** postpones the capability needed to carry out that improvement and makes Aeon 2 circular.
- **Preserve a permanently human-authored control kernel:** contradicts whole-system evolvability; independent admission and recovery can apply across successive generations without permanent source exclusions.

## Acceptance

The planning package must identify every lane and task, its owner boundary, dependencies, copyable goal and observable completion evidence. A1-L02 must produce effective-prompt and reuse evidence; A1-L08 must establish comparisons using fixed tasks and stated resources; A1-L09 must demonstrate integration, recovery and an explicit Aeon 2 handoff. Documentation completion does not mark any runtime capability complete.
