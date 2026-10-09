# ADR 0026: Conversation outcomes and scoped reflection

- **Status:** Explicit user requirement; local runtime implementation with deterministic round-trip checks and fresh review in progress. Installation and qualitative serving acceptance remain open.
- **Recorded:** 2026-10-09.
- **Requirements:** R02, R04, R07, R17–R19, R22–R25; P06/P16.
- **Specification and evidence:** [Conversation judgment](../conversation-judgment.md#follow-up-investigation-remembered-exchange-versus-owned-reflection).

## Context

The user requires the autark to remember an exchange and its outcome even when it makes no commitment to change. If further thought belongs in a background cycle, it should retain and resume that inquiry without asking the user to choose its next step. An unchanged or unresolved view is a legitimate outcome. This requirement does not require a name, opinion, identity or code change.

The user's subsequent clarification on the same date makes an asynchronous return mandatory for every topic deferred or pending investigation/decision. The original optional-follow-up clause is superseded. The autark must track what it owes a reply about, not wait for the human to reopen the conversation.

The current runtime records input/reply episodes. Ordinary replies have no durable reflection action, and eligible conversation retrieval excludes derived memories. A deterministic reproduction using the real runtime, memory coordinator and reopened Store retained two derived interpretations but supplied neither to the next eligible conversation. Existing guidance against habitual approval questions does not implement that missing workflow or establish the cause of the model's repeated hand-back.

## Proposed direction

Represent the original exchange, its source-linked interpreted outcome, durable topic/follow-up obligation and any selected operational inquiry separately. Use the existing structured completion boundary to request an outcome and optional reflection; a deferral necessarily creates an owed return. Bind scope, participants, source versions, limits and return route in the host; retain uncertainty and original human provenance. Topic identity is distinct from thread identity so multiple topics and related threads retain their own state and owed destinations.

Persist an admitted continuation before promising it, distinguish prepared intent from confirmed delivery, and activate reflection through an atomic or recoverable exchange-completion path. Run it as a distinct background purpose with the configured allocation and finite cumulative limits, sharing window limits and fair selection with independent standing growth. It must survive restart and succession without appearing as foreground user work that blocks its own execution. Cancellation is terminal; preemption may pause it. Reflection can end without a new lesson or compulsory next inquiry.

The host's finite lifetime is an admission and publication boundary, independent of review-loop ordering. At or after expiry, selection and atomic reservation must refuse a new reflection call; a result returning at or after expiry must not revise the topic or enter memory. A previously reserved call remains spent. Durable review ends the inquiry inconclusively and still owes its final report; neither late output nor deadline expiry establishes delivery.

Reuse and extend `MemoryCoordinator`'s source-aware publication and recovery primitives, the scheduler's resource allocation and the established communication-effect path. Preserve immutable inquiry metadata separately from mutable attempt checkpoints. Add a bounded reflection contract that addresses the retained question, not merely a summary of whichever memories are newest. Revalidate sources and current authority before dispatch, publication and any delivery. Exact schemas and class boundaries remain implementation choices.

Complete the round trip with required asynchronous reporting of deferred topics and projection of relevant outcomes/pending status into subsequent authorized conversation requests. Investigation completion and delivery completion are separate states. Revisit pending topics at durable review points, including when no job is running; resource waits do not erase obligations. A holding update leaves a pending topic open. Explicit terminal disposition must be reported, unless the user later waives notification; uncertain or blocked delivery remains unresolved. Retain report revision, effect identity and available external receipt.

Keep the initial workflow within its originating conversation scope; cross-scope retrieval/generalization remains a separate policy decision. A reflection result is an interpretation, not newly verified truth, a global identity update or source-change authorization. Required follow-up uses the original thread; a generated follow-up is not a new human instruction. Maintain the authoritative topic registry locally and permit scoped text/tag indexing of independently admitted exchanges. Slack metadata can mirror non-sensitive topic references on the autark's messages; Slack search is a separate proposed integration subject to its access and retention contract, as documented in the [specification](../conversation-judgment.md#finding-related-threads-and-indexing-topics).

## Alternatives and consequences

- **More conversational guidance alone:** may improve immediate judgment, but cannot provide persistence, scheduling or later retrieval. Controlled fresh/history comparisons remain useful as separate cognitive evidence.
- **Raw episodes alone:** preserve what was said, but leave the model reconstructing a stance from repeated replies and do not own deferred work.
- **Only remember results for the next human turn:** fails the explicit requirement to come back asynchronously. Work state, owed reports and confirmed delivery must remain distinct.
- **Slack tags or search as the task queue:** discovery/indexing cannot establish which report is still owed, its delivery state or recovery identity. Use the durable local registry as the authority for follow-through.
- **Memory consolidation alone:** supplies useful existing persistence and provenance machinery, but is not wired into serving opportunities and lacks a selected inquiry contract. The demonstrated retrieval filter would still hide its output.
- **Unchanged global growth handler:** uses a different scope, compulsory follow-up and source-proposal scan. Reuse suitable allocation primitives without inheriting those semantics for a social inquiry.
- **A normal foreground task:** would enter the user-work priority gate and can block background progress. Use an explicit purpose/lifecycle with the correct scheduling classification.
- **Wait for the general coding agent loop:** unnecessarily couples ordinary reflective continuity to code-editing integration. The existing provider and storage boundaries suffice for this slice; no new agent library is selected.

This adds a lifecycle and retrieval contract that must be tested together. The main risks are unsupported promises, endless or duplicate work, stale outcomes, scope leakage and laundering human instructions through derived memory. It preserves full-codebase autonomy as a separate product requirement; this reflection operation itself performs no code dispatch.

## Acceptance and status

The [round-trip acceptance cases](../conversation-judgment.md#acceptance-for-the-round-trip) require real storage/restart, finite background execution, source invalidation, interruption, truthful delivery and actual later-request retrieval. The [implementation work item](../work-items/p16-conversation-continuity.md) records the local source slice and its finite host policy. Real SQLite/runtime fixtures now cover ordinary and eligible/peer retrieval, shared window fairness, mandatory reports, tentative acknowledgment recovery, source/task correction, forgetting and cancellation races. Deterministic mechanics and qualitative model judgment remain separate evidence. Related-thread discovery/merge, live cognition and installed serving acceptance remain open; no live change or additional provider call is implied by this ADR.

The concrete lifecycle retains tentative exchange intents separately from the current topic. Only confirmed acknowledgment can activate an intent; a conflicting unresolved continuation pauses older thought but preserves the previously accepted obligation. Result publication and reflection completion commit together. Each final report is tied to an outcome revision and communication effect; holding updates, rejected/unknown sends and older acknowledgments cannot clear a newer obligation. Source-linked raw episodes prevent later generated replies from laundering forgotten evidence or another author's authority.
