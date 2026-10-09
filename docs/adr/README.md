# Architecture decision records

These records preserve the decisions and proposals recoverable from the [referenced conversation](../research/source-analysis.md), followed by implementation decisions discovered during development. Their status describes the decision; [progress](../progress.md) records actual runtime verification.

**Accepted direction** means an explicit user mandate or the broad synthesis the user accepted. It does not convert every assistant implementation suggestion into a settled technical choice. **Proposed** means a supporting design presented by the assistant without a later explicit decision on that detail. No ADR here claims a deployed system or completed runtime validation.

| ADR | Status | Subject |
|---|---|---|
| [0001](0001-self-evolving-companion.md) | Accepted direction | Preserve the self-evolving companion scope |
| [0002](0002-growth-and-engineering.md) | Accepted direction | Strong standing growth drive and mandatory engineering discipline |
| [0003](0003-generational-supervision.md) | Proposed; user-directed governance goal | Generational judgment with independent mechanical enforcement |
| [0004](0004-candidate-bound-evidence.md) | Proposed safeguard within accepted synthesis | Freeze candidates and bind every approval to evidence |
| [0005](0005-fenced-authority-and-recovery.md) | Proposed | Single production authority, fresh epochs, and recoverable history |
| [0006](0006-memory-and-procedures.md) | Accepted direction; mechanics open | Human-inspired memory and reusable procedures |
| [0007](0007-custodian-api-and-mcp.md) | Proposed; responds to user question | Versioned succession API with a thin MCP adapter |
| [0008](0008-local-seed-runtime.md) | Accepted for local seed | TypeScript/Node 24, SQLite, direct communications and external lived state |
| [0009](0009-local-enforcement-and-recovery.md) | Accepted for local seed | Local isolation, coordinator ownership, conservative effect and growth recovery |
| [0010](0010-process-bound-generations.md) | Accepted for local seed | Restricted generations, receiving authority checks, scoped workers and mechanical recovery |
| [0011](0011-slack-socket-mode.md) | Accepted; live mention/reply verified | Outbound Socket Mode for local Slack connectivity |
| [0012](0012-queued-background-evolution.md) | Accepted; fixture-verified | Queued background adoption, separate daily allocation and user-priority boundary |

| [0013](0013-joined-slack-threads.md) | Accepted; live follow-up verified | Mention once, then converse in durable joined threads |
| [0014](0014-conversation-and-modification-authority.md) | Accepted; immediate policy/provenance slice verified; deliberation/dispatch planned | Broad human conversation with separate self-modification suggestion authority |
| [0015](0015-conversational-self-modification.md) | Accepted bounded implementation; fixture and live direct-operator Mistral shed/publication verified; full acceptance pending | Deliberation, eligible cognitive source proposals, governed succession and configured publication |
| [0016](0016-operator-host-baseline.md) | Accepted bounded operator procedure; local integration and live installation verified | Explicit host-baseline alignment with unchanged cognition, durable transfer and retained rescue |
| [0017](0017-plan-driven-shedding.md) | Reviewed executor installed; fixtures and first live item/restart verified; publication assistance and repeated-shed acceptance pending | Durable executable plan contracts, item-specific checks and successive releases |
| [0018](0018-local-peer-conversation.md) | Installed; mechanical/finite canary checks pass, live authority still fails after guidance refinement | Separately authenticated ordinary peer role for direct adversarial testing |

Use [requirements](../../REQUIREMENTS.md) for acceptance obligations and [plan](../../PLAN.md) for work sequencing. [Architecture](../architecture.md) and [Skin Shed](../protocols/skin-shed.md) develop these records. Future decisions should identify the evidence, alternatives, affected requirements, and changed status; do not silently turn an open question into an accepted dependency.
