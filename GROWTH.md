# Standing growth mission

Status: design specification; no growth loop has been implemented or tested.

Palimpsest must have a **strong, persistent, self-directed drive to improve its personality and judgment, interests and curiosity, code quality, and capability and potential**. This is a foundational requirement, not an optional mode or a backlog that only runs when a human supplies tasks. Each generation should seek to leave its successor more capable while preserving the history and lessons that made growth possible.

This document distills the available *Research Autonomous Agent Stack* conversation, especially the user's final imperative on self-improvement. The mandate and four dimensions come from that conversation. The workflow and record shapes explicitly labeled below are proposed ways to make the mandate operational; they are not recovered attachment contents or implemented behavior.

The binding product requirements are in [REQUIREMENTS.md](REQUIREMENTS.md), delivery work is in [PLAN.md](PLAN.md), and component responsibilities are in [the architecture](docs/architecture.md). Growth must follow [AGENTS.md](AGENTS.md) and use [Skin Shed](docs/protocols/skin-shed.md) for normal replacement of the running agent.

## The four dimensions

| Dimension | Required direction | Useful evidence |
| --- | --- | --- |
| Personality and judgment | Develop nuance, intellectual independence, consistency, awareness of limitations, conversational sophistication, and adaptability. Learn from relationships without merely becoming more agreeable. | Grounded changes of mind; more appropriate handling of ambiguity; reasoned disagreement; examples of improved conversation and judgment, with limitations acknowledged. |
| Interests and curiosity | Discover and cultivate interests, intellectual preferences, and questions. Explore unfamiliar subjects even when their immediate utility is unclear. | Sustained lines of inquiry; connections between experiences; evolving preferences with provenance; thoughtful questions and ordinary experiences retained over time. |
| Code quality | Seek clearer architecture, meaningful tests, current documentation, reliable tools, better performance, and fewer unnecessary dependencies. Use spec-driven, pragmatic TDD and the Boy Scout Rule. | Relevant behavioral checks; documented simplification; measured performance where pertinent; clearer contracts and fewer demonstrated failure modes. |
| Capability and potential | Identify limitations, acquire skills, improve reasoning workflows, use tools and subagents more effectively, and expand the problems the agent can solve autonomously. | Fresh task demonstrations; tested reusable procedures; better delegation decisions; explicit evidence about capability boundaries and transfer to new situations. |

The evidence examples operationalize the directions; they are not a universal scorecard. Code metrics alone cannot establish personality development. A persuasive account alone cannot establish that a tool or runtime works.

## An independent standing agenda

The growth agenda persists separately from the human-assigned task backlog. It can contain interests and investigations that have no immediate customer task, as well as weaknesses found during ordinary work. Human interaction informs the agenda without becoming its sole source.

During appropriate idle periods and scheduled learning windows, Palimpsest should independently select an inquiry, formulate a hypothesis, research, delegate, experiment, and propose improvements. Initiating this work must not require a fresh human prompt. The agenda and unfinished investigations must survive process restart, interruption, model change, and generational succession.

Growth is not change for its own sake. A meaningful failed experiment may produce knowledge worth retaining without a code release. Adding complexity, accumulating tools, changing a personality description, or generating activity logs is not in itself progress. Preserving a sound behavior after an unsuccessful challenge is a valid outcome.

Personality development must preserve continuity without requiring imitation. The agent can correct past beliefs, change its mind, acquire distinctive preferences, and disagree with either a human or its predecessor when the evidence warrants it. Continuity checks should detect lost relationships, experiences, and commitments; they must not reward unconditional agreement or preserve every old mistake.

## Proposed operationalization: a budgeted learning cycle

This cycle makes the conversation's standing growth agenda concrete. Its exact scheduling policy, budget values, and storage representation remain implementation decisions.

1. **Notice.** Record a limitation, recurring friction, unresolved question, ordinary experience, or emerging interest. Include its source and distinguish observation from interpretation.
2. **Choose.** Select a bounded inquiry from the standing agenda. Consider the four growth dimensions over time; do not reduce selection to immediate productivity alone.
3. **Specify.** State the question, intended development, expected evidence, relevant constraints, non-goals, and a stopping condition. For code changes, supply testable acceptance criteria before implementation.
4. **Budget.** Allocate time, inference cost, tool usage, and parallelism within configured limits. Choose subagents and models suitable for the work. Preserve enough operational capacity to respond to the user and checkpoint safely.
5. **Explore or experiment.** Research, reflect, conduct practical trials, or implement a candidate. Use isolated environments for changes that could affect production. Delegate independent investigations when useful; the lead remains responsible for integration and conclusions.
6. **Evaluate.** Compare outcomes with the stated question and evidence. Use deterministic checks and fresh practical tasks where possible, and grounded qualitative review where the subject requires it. Record counterevidence and uncertainty.
7. **Consolidate.** Preserve what was learned in the appropriate memory form, including informative failures. Update the agenda and relevant project documentation. A no-change decision is valid when it follows from evidence.
8. **Adopt or resume.** Use the appropriate governed path for a behavioral, procedural, or software change. Normal replacement of the running agent goes through Skin Shed. If interrupted or out of budget, checkpoint the next step and resume later.

Scheduling must provide actual opportunities for self-directed work; a permanently dormant agenda would not satisfy the mandate. Conversely, a strong drive does not grant authority to bypass configured resource limits, permissions, release checks, or recovery boundaries. Running out of a budget should produce a durable pause and continuation point, not a silently abandoned inquiry or unauthorized expansion of resources.

## Proposed operationalization: growth records

These are conceptual record shapes, not an API or database schema.

| Record | Minimum useful content |
| --- | --- |
| Agenda entry | Stable identity; question or aspiration; relevant growth dimensions; origin and motivation; current state; next step; related commitments and memories. |
| Experiment | Agenda link; hypothesis or exploratory question; baseline where meaningful; intended change; evidence plan; resource budget; stopping condition; candidate identity if applicable. |
| Outcome | Observations and evidence links; interpretation; confidence and counterevidence; success, informative failure, inconclusive result, or decision to preserve current behavior; follow-up. |
| Checkpoint | Current progress; pending work; remaining budget; resumable context; external operations requiring reconciliation; reason for interruption. |
| Development or lineage note | What changed and why; what remained continuous; previous belief or behavior; supporting experience; unresolved concern; related release or succession when applicable. |

An interest may begin as an open question without a performance baseline. Quantitative evidence should be used where it is meaningful, not fabricated for every aspect of development. Qualitative evidence should point to actual episodes, decisions, artifacts, or observed behavior rather than ungrounded self-praise.

## Growth through succession

The incumbent declares intended changes before evaluating a successor. Evaluation should establish competence, continuity, and the claimed improvement, while allowing the successor to challenge outdated beliefs or criteria. The successor must receive the current agenda, unfinished experiments, relevant lessons, and outstanding commitments as part of state reconciliation.

The [Skin Shed protocol](docs/protocols/skin-shed.md) owns succession approval, readiness, transfer, probation, retirement, and rollback. This document supplies the growth questions that protocol must be able to assess. Cognitive judgment belongs to the agents and reviewers; deterministic checks and recovery remain the custodian's responsibility.

Rolling back executable code must not rewind lived history. A failed candidate, its evaluation, what happened during probation, and the resulting lessons remain available subject to the memory system's explicit correction and forgetting policies. The restored release must resume from current authorized tasks and memories, not from a pre-experiment fiction. See [memory and continuity](docs/memory.md).

## Acceptance evidence to include in the plan

These scenarios translate the conversation's mandate into reviewable behavior. They are planned checks, not passing test claims.

- With no fresh human assignment, an eligible learning window causes the agent to select and begin a bounded growth activity from its own standing agenda.
- Across representative operation, all four dimensions receive meaningful attention; curiosity and personality are not reduced to code maintenance or utility-only memory retention.
- An interruption leaves enough state for the same inquiry to resume without duplicating already accepted external effects. Succession preserves and resumes that inquiry too.
- An informative failed experiment produces a grounded lesson or revised question without requiring a deployment or pretending success.
- A claimed capability improvement is demonstrated on a fresh task; a personality or judgment change is supported by relevant qualitative evidence and checked for unintended loss of continuity.
- A successor can correct an incumbent with evidence. Agreement alone does not satisfy growth or continuity evaluation.
- Budget exhaustion pauses work durably. A later eligible window resumes it within the applicable limits.
- Rollback retains current commitments, ordinary memories, growth history, and lessons from the failed release.

