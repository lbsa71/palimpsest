# ADR 0003: Separate generational judgment from mechanical enforcement

- **Status:** Proposed architecture supporting the user's self-supervision direction.
- **Recorded:** 2026-10-08.
- **Source:** The incumbent/successor exchange in the [source analysis](../research/source-analysis.md).

## Context

The user proposed an incumbent that remains alive, interviews the next instance, approves its handoff, and retires. Two agent prompts alone do not create enforceable checks and balances if both processes can alter permissions, evidence, and recovery.

## Proposal

Use an incumbent, a temporary isolated successor, a fresh independent reviewer session, and a small non-LLM custodian. The incumbent evaluates continuity and improvement; the reviewer examines the engineering change independently; the custodian enforces checks, role permissions, durable authority, staging, probation, and recovery.

Keep approval, transfer, and retirement separate. During probation, the predecessor has read-only operational visibility and can report regressions. After success its process retires, while the runnable release remains recoverable. The successor becomes the next incumbent; do not accumulate an ever-growing council of live ancestors.

Distinguish engineering supervision by the task lead, cognitive supervision by the incumbent, and operational supervision by the custodian. Keep personality, planning, and learning out of the small custodian wherever possible.

## Alternatives and consequences

Unrestricted deployment commands would let agents bypass the governance contract. A permanently frozen supervisor holding most intelligence would obstruct the broader self-evolution goal. Instead, protect the recovery boundary during a given upgrade and permit separate custodian upgrades while an older rescue path remains working.

The proposed environment grants broad administration inside the agent's dedicated environment with recovery authority outside it. Host isolation and rescue bootstrap are unresolved implementation choices. The decisive demonstration must recover from a failed successor even when the predecessor process and model provider are unavailable. It has not been run.

See [architecture](../architecture.md) and [Skin Shed](../protocols/skin-shed.md).
