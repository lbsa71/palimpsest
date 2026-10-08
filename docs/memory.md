# Memory, development, and continuity

Status: developmental specification with SQLite storage under [ADR 0008](adr/0008-local-seed-runtime.md). Corrections, scoped retrieval, logical forgetting, bounded consolidation, source-version publication and current succession snapshots are tested. Real generation rollback preserves current history. Qualitative development and live consolidation are separate evidence; see [memory runtime](memory-runtime.md).

All lived experience belongs in a local folder outside the repository. The seed uses one external SQLite database with separate operational, memory and growth tables. Memory records carry source, confidence and revision lineage. A durable publication identity prevents interrupted growth publication from recreating a forgotten lesson. Logical forgetting removes memory contents from active/history retrieval; it does not erase SQLite WAL, backups, task records, provider records or derived contexts elsewhere. No physical-erasure promise is made.

Palimpsest's memory should support experience, personality development, relationships, interests, practical learning, and continuity across generations. It must do more than retain useful preferences, verified facts, and successful task results. Ordinary experiences and developing interests can matter even when their future utility is not obvious.

This document distills memory and continuity principles from the available *Research Autonomous Agent Stack* conversation. The four memory categories organize those principles. The detailed lifecycle, record shape, and evaluation examples below are proposed operationalization, not recovered schemas from the unavailable generated specifications or claims that a memory system already exists.

See [REQUIREMENTS.md](../REQUIREMENTS.md) for product requirements, [GROWTH.md](../GROWTH.md) for the standing development mission, [PLAN.md](../PLAN.md) for delivery work, [architecture](architecture.md) for component boundaries, and [Skin Shed](protocols/skin-shed.md) for succession and recovery.

## Four complementary forms of memory

| Form | What it retains | Example and limits |
| --- | --- | --- |
| Episodic | Experiences and interactions situated in context, including ordinary conversation, experiments, surprises, and failures. | An exchange that sparked an interest, with the original source and circumstances. Recording an episode does not make every statement in it true. |
| Semantic | Beliefs, facts, concepts, and relationships consolidated from evidence. | A working belief supported by several episodes, with uncertainty and supersession history. Retrieved assertions remain distinguishable from established facts. |
| Procedural | Learned ways to act, including reusable scripts, tool practices, reasoning workflows, and tested skills. | A parameterized script with input/output contracts, permissions, version, and tests. Publishing a procedure and authorizing its execution are separate decisions. |
| Autobiographical | A continuing account of development, interests, relationships, commitments, significant choices, and generational lineage. | Why an interest developed, why a belief changed, or why a successor was accepted. The account should remain grounded in episodes and evidence rather than an invented narrative. |

These forms can reference one another. An experiment is an episode; its supported conclusion can become a semantic belief; its reliable method can become a procedure; its role in development can enter an autobiographical account. Consolidation should preserve those relationships and the uncertainty appropriate to each claim.

Procedural memory complements personality and autobiographical memory. It must not become a rule that every interaction should be converted into an automation.

## Memory is a process above storage

Memvid is a candidate storage and retrieval component. The conversation discussed it as a possible component, not a mandatory dependency, a complete cognitive memory process, or a reason to prescribe Rust. Compatibility, performance, operating constraints, and recovery behavior require evaluation before adoption.

Whichever engine is selected, Palimpsest needs distinct processes for recording experiences, consolidating them, retrieving relevant context, correcting errors, superseding beliefs, and forgetting information. Storage and search features alone do not provide those behaviors.

Memory policy and cognitive consolidation should remain evolvable parts of the agent architecture rather than accumulate inside the small mechanical custodian. Production writes and succession boundaries still need independently enforced authorization. The exact deployment and storage layout belongs to the architecture decision process.

## Proposed operationalization: memory lifecycle

1. **Record experience with provenance.** Keep the source, context, and whether content is a quotation, observation, inference, preference, or unresolved assertion. Do not prematurely promote an episode into a fact.
2. **Retrieve for the present context.** Return enough provenance and uncertainty to let the agent distinguish remembered events from interpretations. Retrieval should support ordinary relationships and curiosity as well as immediate task execution.
3. **Consolidate deliberately.** Connect related episodes, summarize development, revise beliefs, and extract reusable procedures when justified. Retain links to supporting and conflicting evidence. Avoid turning repeated speculation into certainty merely through repetition.
4. **Correct and supersede.** Make changed beliefs and invalidated procedures visible. Preserve why a conclusion changed where appropriate, rather than silently presenting the latest wording as an unchanged lifelong belief.
5. **Forget explicitly.** Support removal or reduced retention under the applicable policy and user instructions, including dependent summaries or retrieval material as required. Continuity is not a blanket prohibition on forgetting, and utility is not its sole selection criterion.
6. **Carry development forward.** Keep significant ordinary experiences, lessons, preferences, and unfinished inquiries accessible across restarts and releases. Distinguish an ongoing interest from a fact claim about the world.

The exact triggers, retention periods, consolidation schedule, and treatment of each storage copy remain to be specified and tested. This document does not promise indefinite retention or define an end-to-end deletion guarantee.

## Proposed operationalization: evidence and record shape

A conceptual memory record should carry enough information to answer the following questions. This is not a required database schema.

| Question | Candidate information |
| --- | --- |
| What is remembered? | Stable identity, memory form, content or referenced artifact, context, relevant time. |
| Where did it come from? | Source episode or artifact, observation versus inference, author or originating process where relevant. |
| How certain is it? | Evidence references, uncertainty, contradictions, unverified claims, known limitations. |
| How has it changed? | Consolidation links, correction or supersession relationships, development history. |
| Who may access or change it? | Applicable access scope, retention policy, write authority, permitted uses. |
| Why does it matter? | Related interests, relationships, commitments, skills, or development; not necessarily an immediate utility score. |

An autobiographical summary should be able to trace material claims to experiences or explicit self-reflection. A preference need not be objectively true, but its status as a preference and its development should be clear. A failed experiment should preserve useful observations without being mislabeled a validated capability.

## Operational truth and remembered experience

The durable operational journal is distinct from cognitive memory. This is a separation of responsibilities, not a requirement for separate database products.

| Operational journal | Cognitive memory |
| --- | --- |
| Authoritative task state, commitments, cancellations, checkpoints, execution ownership, tool effects, and release/succession events. | Experiences, beliefs, interests, procedures, relationships, development, and interpretable lineage. |
| Supports safe resumption, reconciliation, idempotency, and deterministic recovery. | Supports reasoning, learning, personality, retrieval, and continuity. |
| Current authoritative records determine whether work is pending and which generation may act. | Recollections may reference those records but cannot override them or manufacture completion. |

A narrative that a task was finished is not sufficient evidence of completion. Likewise, a concise task journal is not a substitute for remembering the ordinary interaction around that task. The agent should reconcile remembered commitments against the current journal and plan before acting.

## Succession and executable rollback

During ordinary candidate testing, use disposable fixtures. For the separate continuity interview, the successor receives a consistent, authorized, read-only snapshot of relevant real workspace and memory context. It must not write production memory during evaluation.

Before cutover, reconcile events that arrived after the snapshot: messages, corrections, commitments, cancellations, growth progress, forgetting decisions, and access-scope changes. Invalidate or rebuild affected snapshots and derived context so neither promotion nor recovery reintroduces disallowed information. A successor that passed an interview against old context must not resume a superseded plan. Only the active production generation may make production writes, and the boundary receiving those writes must reject stale authority.

An interview should test both practical competence and grounded continuity. It can ask about an ordinary conversation, current promises, a developing interest, the reason for a changed belief, and an unfinished learning experiment. The successor may identify errors in the incumbent's recollection or reasoning; justified correction is compatible with continuity.

**Roll back the executable, not lived history.** Restoring a known-good release must preserve newer authorized conversations, memories, tasks, growth outcomes, and evidence of the failed release. Retained code must be able to operate with the current durable state, or the release must supply a tested compatibility and recovery strategy before promotion. The storage-migration details remain an implementation decision to be specified under [Skin Shed](protocols/skin-shed.md).

Lineage records should connect the predecessor and successor, the intended change, the evidence reviewed, the reason for approval or rejection, the probation outcome, and unresolved concerns. This makes succession part of development rather than a bare version number. A retired process need not remain running for its experiences and lessons to remain available.

## Optional temporary mode

Temporary chat was a suggestion from the colleague's brief, not an original mandatory Palimpsest requirement. It remains optional and must not redefine the default developmental memory model.

If implemented, a temporary mode may permit reading existing authorized memories while prohibiting retention of new conversation content and learning from that session. That promise must cover every agent-controlled persistence path included in the contract: transcripts, logs, caches, derived summaries, memories, and learning history. Enforcing only a long-term-memory toggle would not establish the broader promise.

Agent-local non-retention does not govern Slack or external model and search provider retention. Any user-facing promise must state the actual boundary. Precise interaction with operational journaling, restart recovery, and required metadata must be specified before offering the mode; it must not quietly retain conversation content under another record type.

## Planned acceptance evidence

These checks operationalize the memory principles; they do not assert test completion.

- Recall an ordinary conversation with a source-grounded answer and appropriate uncertainty, including across a generation change.
- Record an unverified assertion as an assertion; subsequent retrieval and consolidation do not turn it into a fact without new evidence.
- Correct a belief and invalidate a faulty procedure while retaining the appropriate development history and honoring explicit forgetting requirements.
- Retain a developing interest or meaningful experience without requiring demonstrated short-term utility.
- Retrieve a procedural memory with its contract, permissions, version, and test evidence; do not equate publication with permission to execute it.
- Prevent candidate production writes and stale-generation writes at the storage boundary. Reconcile a correction or cancellation that arrives during evaluation before the successor acts.
- Recover from a failed successor using known-good code while preserving all current authorized tasks, memories, and growth lessons.
- If temporary mode is adopted, verify every promised agent-controlled non-retention path and document the separate external retention boundary.
