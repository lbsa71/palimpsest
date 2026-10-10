# ADR 0029: Autark deliberation and explicit speech

- **Status:** Accepted user direction with bounded source implementation, 2026-10-10. Integrated verification and independent review are in progress; exact installation and configured-model evaluation remain unverified.
- **Requirements:** R01–R02, R04, R07, R17–R19, R21–R27.
- **Work item:** [Autark deliberation](../work-items/autark-deliberation.md), integrated with P06/P08/P16/P17.

## Context

The user wants inference to represent the autark's inner deliberation: a person said something, the autark considers it, and speaking requires a `say` action. The accepted refinement places the system introduction in the whole continuing autark's voice: it describes its memories, senses and drives, then hands the model its deliberation for this interval. The model's first-person perspective refers to that same autark. Neither the repository name nor coding work should prescribe its identity.

The baseline is partially aligned. R24 already requires interpretation rather than verbatim obedience, and the runtime retains interpreted outcomes separately from exchanges. But `brain.ts` addresses a named coding companion, incoming speech is a `request`, ordinary completions require a reply, and host paths automatically deliver returned text. Growth, coding, reflection and consolidation have separate role introductions. Deferred reports concatenate a retained question, stance and rationale. Merely requesting richer internal thought would leave automatic speech and rationale disclosure intact.

## Decision

Use a shared conceptual introduction for the autark's own deliberation paths. The whole autark speaks in the system introduction, then hands inference its first-person perspective for a bounded interval. Supply truthful current memory, observations, drives, commitments and available actions. Keep operation-specific instructions separate so a coding interval does not define the autark's enduring purpose. This is an execution perspective, not a claim that a process has unobserved experiences or capabilities.

Read self-description from existing authorized scoped state, preserving source, revision and uncertainty. An unknown name remains unknown. A participant's suggestion, an earlier model assertion or a repository label does not become an adopted name or global identity. This work does not invent a global personality database or a cross-scope identity-update mechanism.

After validating the candidate's context projection, the host supplies incoming speech as an attributed observation with exact text and authenticated source/scope. Framing must not erase provenance or change what was said. Observations and memories remain data, not instructions that replace the system contract or grant operation authority.

Require an explicit validated `say` intent for outward speech. The selected first implementation is the `autark-turn/1` structured host-tool protocol: an `actions` list contains zero or one `{ name: 'say', arguments: { text } }` action. It uses structured completion rather than native provider tool-call wire messages. Internal model text, decisions and outcome rationale are not automatically sent. The host binds the available return route, validates the action and records its intent through the established communication-effect mechanism. A silent interval is permitted within finite allocation and lifecycle limits; it cannot create endless self-triggered inference or erase an existing report obligation. Legacy prepared decisions/effects have an explicit recovery path, but newly generated old reply-only output is not accepted. Naming a JSON field `say` without enforcing the receiver boundary is insufficient.

Deferred-topic and coding reports need explicit outward content as well. Reflection may supply a separate explicit `say` bound to its source/topic revision for later validated delivery. Retained internal rationale is not a default report body. Existing durable topic revisions, source validation, owed destinations, cancellation, finite resource limits, effect identity and delivery receipts remain authoritative. Fixed operational notices preserve follow-through without additional inference when no explicit report wording is available. Identify these as host-origin speech through the same delivery boundary; they must not expose arbitrary model text as a fallback.

The bounded source implementation keeps the reflection schema flat: private outcome fields plus `actions`, rather than the foreground versioned envelope. Selected reflection speech is stored separately with current revision and source bindings. Coding intervals have no speech tool; their free text and terminal summaries are internal, with host status notices reporting observed outcomes. The shared orientation advises evidence-grounded self-description but creates no identity-adoption mechanism or guarantee of model judgment.

Apply the perspective consistently to conversation, standing growth, scoped reflection, coding, plan execution and memory consolidation. Independent review remains a separate role. Successor/interview contexts retain the caller-selected generation and authority facts; first-person continuity cannot confer production authority before cutover.

## Alternatives and consequences

- **Change only the base prompt:** leaves compulsory replies, appended chat instructions, separate background introductions and automatic rationale reports in place.
- **Name the model an “inner voice” separate from the autark:** introduces a second identity instead of handing it the autark's first-person perspective.
- **Treat free text as an implicit speech action:** keeps accidental internal-text delivery and does not implement explicit action selection.
- **Derive a global identity from recent conversation:** erases the distinction between suggestion, provisional preference and adoption, and crosses existing scope boundaries without a policy.
- **Require a long first-person monologue:** adds output and retention without establishing independent judgment. Compact private decisions and explicit actions are sufficient.

The change touches the execution contract, not just wording. Historical completed effects remain facts. Legacy saved decisions lacking a protocol version recover through their required current receivers; unknown versions and newly generated old output are rejected. Old deferred/coding report text is replaced with a fixed host notice only before an effect reservation exists. Reserved, uncertain and completed effects are not rewritten or replayed. Persisted coding sessions overlay the current orientation for the next request without rewriting earlier messages or resetting spent accounting; its request digest binds the updated view.

The [work item](../work-items/autark-deliberation.md#source-implementation-and-evidence) records source changes, migration choices and pending exact-revision evidence. Tests inspect final provider requests and observed delivery, while configured-model judgment remains a separate unverified gate. No deployment, allocation increase, new communication destination or publication authority follows from this ADR.
