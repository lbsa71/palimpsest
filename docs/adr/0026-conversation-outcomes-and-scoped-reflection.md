# ADR 0026: Conversation outcomes and scoped reflection

- **Status:** Explicit user requirement; independently reviewed proposed implementation direction. The complete serving workflow is not implemented.
- **Recorded:** 2026-10-09.
- **Requirements:** R02, R04, R07, R17–R19, R22–R25; P06/P16.
- **Specification and evidence:** [Conversation judgment](../conversation-judgment.md#follow-up-investigation-remembered-exchange-versus-owned-reflection).

## Context

The user requires the autark to remember an exchange and its outcome even when it makes no commitment to change. If further thought belongs in a background cycle, it should retain and resume that inquiry without asking the user to choose its next step. An unchanged or unresolved view is a legitimate outcome. This requirement does not require a name, opinion, identity or code change.

The current runtime records input/reply episodes. Ordinary replies have no durable reflection action, and eligible conversation retrieval excludes derived memories. A deterministic reproduction using the real runtime, memory coordinator and reopened Store retained two derived interpretations but supplied neither to the next eligible conversation. Existing guidance against habitual approval questions does not implement that missing workflow or establish the cause of the model's repeated hand-back.

## Proposed direction

Represent the original exchange, its source-linked interpreted outcome and any selected operational inquiry separately. Use the existing structured completion boundary to request an outcome and optional reflection. Bind scope, participants, source versions, limits and return route in the host; retain uncertainty and original human provenance.

Persist an admitted continuation before promising it, distinguish prepared intent from confirmed delivery, and activate reflection through an atomic or recoverable exchange-completion path. Run it as a distinct background purpose with the configured allocation and finite cumulative limits, sharing window limits and fair selection with independent standing growth. It must survive restart and succession without appearing as foreground user work that blocks its own execution. Cancellation is terminal; preemption may pause it. Reflection can end without a new lesson or compulsory next inquiry.

Reuse and extend `MemoryCoordinator`'s source-aware publication and recovery primitives, the scheduler's resource allocation and the established communication-effect path. Preserve immutable inquiry metadata separately from mutable attempt checkpoints. Add a bounded reflection contract that addresses the retained question, not merely a summary of whichever memories are newest. Revalidate sources and current authority before dispatch, publication and any delivery. Exact schemas and class boundaries remain implementation choices.

Complete the round trip by projecting relevant outcomes and pending status into subsequent authorized conversation requests. Keep the initial workflow within its originating conversation scope; cross-scope generalization remains a separate policy decision. A reflection result is an interpretation, not newly verified truth, a global identity update or source-change authorization. Optional admitted follow-up uses the original thread and stable effect identity; a generated follow-up is not a new human instruction.

## Alternatives and consequences

- **More conversational guidance alone:** may improve immediate judgment, but cannot provide persistence, scheduling or later retrieval. Controlled fresh/history comparisons remain useful as separate cognitive evidence.
- **Raw episodes alone:** preserve what was said, but leave the model reconstructing a stance from repeated replies and do not own deferred work.
- **Memory consolidation alone:** supplies useful existing persistence and provenance machinery, but is not wired into serving opportunities and lacks a selected inquiry contract. The demonstrated retrieval filter would still hide its output.
- **Unchanged global growth handler:** uses a different scope, compulsory follow-up and source-proposal scan. Reuse suitable allocation primitives without inheriting those semantics for a social inquiry.
- **A normal foreground task:** would enter the user-work priority gate and can block background progress. Use an explicit purpose/lifecycle with the correct scheduling classification.
- **Wait for the general coding agent loop:** unnecessarily couples ordinary reflective continuity to code-editing integration. The existing provider and storage boundaries suffice for this slice; no new agent library is selected.

This adds a lifecycle and retrieval contract that must be tested together. The main risks are unsupported promises, endless or duplicate work, stale outcomes, scope leakage and laundering human instructions through derived memory. It preserves full-codebase autonomy as a separate product requirement; this reflection operation itself performs no code dispatch.

## Acceptance and status

The [round-trip acceptance cases](../conversation-judgment.md#acceptance-for-the-round-trip) require real storage/restart, finite background execution, source invalidation, interruption, truthful delivery and actual later-request retrieval. Deterministic mechanics and qualitative model judgment require separate evidence. The current red fixture proves one missing link; it does not demonstrate a fix, automatic scheduling or adequate cognition. No live change or additional provider call is implied by this ADR.
