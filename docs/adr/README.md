# Architecture decision records

These records preserve the decisions and proposals recoverable from the [referenced conversation](../research/source-analysis.md). They describe design intent, not implemented behavior. They were distilled on 2026-10-08; their status labels describe the recovered evidence, not implementation progress.

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

Use [requirements](../../REQUIREMENTS.md) for acceptance obligations and [plan](../../PLAN.md) for work sequencing. [Architecture](../architecture.md) and [Skin Shed](../protocols/skin-shed.md) develop these records. Future decisions should identify the evidence, alternatives, affected requirements, and changed status; do not silently turn an open question into an accepted dependency.
