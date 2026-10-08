# Product capability audit, 2026-10-08

The deployed Slack slice is a conversational prototype backed by durable memory and a separate governed evolution service. It is not yet the complete self-evolving coding companion described by the project. Component verification and one admitted source change do not establish the full conversation-to-code-to-publication workflow.

## What the running installation can do

| Capability | Current evidence | Product boundary |
|---|---|---|
| Slack conversation | Mention/reply and unmentioned joined-thread follow-up passed live; both transport fixtures and restart/dedup checks passed | Conversation turns produce text; periodic progress/error notifications are absent |
| Durable task and episode memory | SQLite lives outside Git; the active Slack thread has persisted episodes; worker renewal/restart preserves records | Retrieval currently uses bounded thread-scoped memories; this does not establish mature developmental judgment |
| Standing growth | Four-dimensional persisted agenda and serving scheduler with finite daily budgets | Separate from ordinary conversation dispatch; useful accepted improvements are not guaranteed |
| Cognitive source evolution | One Mistral-authored change passed frozen checks, fresh review, succession, cutover and probation | Only direct `src/agent/*.ts` changes; successful demonstration was operator-initiated and assisted |
| Automatic evolution queue | Serving discovers completed growth proposals and attempts protected evaluation | Recent six live queue outcomes were four mandatory-check declines, one no-op rejection and one protected-path rejection; no background promotion is claimed |
| Cognitive worker replacement/recovery | Restricted workers, new authority epochs and current-data recovery passed; live renewal continued after repairing the checkpoint frame bound | This replaces restricted cognitive workers, not the outer Slack service; operator diagnostics/recovery CLI and full host deployment remain incomplete |
| Git publication | Admitted model source was committed and pushed as `5044b57` | The development operator performed publication; the application has no Git publication capability |
| General coding/tool work from Slack | No implementation or successful live workflow | `AgentRuntime` makes a text completion and sends it; it does not dispatch file, procedure, source-edit, build or release tools from conversation |

The current worker is running the admitted source manifest `2dd97cf3438a0e9e3197a9bd373882b553ed211019005584ed0dde8d7f651f91`. Its cognitive module is the scope-filtering change recorded in [the release report](self-improvement-2026-10-08.md). Later communications and supervisor fixes are human-directed host changes, not autonomous cognitive upgrades. No claim is made that Palimpsest itself published those fixes.

## Why the Slack answer was misleading

The serving cognitive prompt explicitly says the current conversation has no shell or external action tool. `CompletionRequest` carries text/schema/bounds, and `AgentRuntime` handles text responses plus deterministic status/cancel/correct controls. The conversation model receives the request and selected memories, with no authoritative platform capability inventory, storage status, release lineage, action schemas or dispatcher.

Consequently, the lack of direct file and process control in that turn is real. The blanket denial of any code evolution omits the separate growth/evolution service. The statement that memory is not written to disk is false: the host persists accepted tasks and completed episodes in external SQLite, then retrieves them in later turns. Model self-description is not runtime evidence. The captured answer is itself a remembered assertion, not an accepted platform fact.

`EvolutionCoordinator` is reachable from recorded growth outcomes, not arbitrary conversation requests. It freezes and checks source, then the custodian launches and activates restricted successor workers. This is not a self-rebuild/relaunch of the outer serving process; broader custodian/environment replacement remains disabled. The application performs no Git writes. This seed executes TypeScript through Node and validates types with `tsc --noEmit`; it does not currently produce a separate compiled application bundle.

## Honest milestone position

M1's communications/task/provider infrastructure is exercised, while its general tool-work workflow is incomplete. M2 has storage, procedures and initiative components, with weak live memory generalization and no conversational procedure invocation. M3/M4 have substantial evaluated-release and recovery machinery, one targeted live source demonstration, and an unresolved meaningful-interview criterion. M5 and full seed acceptance are open.

The latest integrated verification is 199 passing tests, one platform-specific skip and a passing TypeScript check. A fresh read-only review independently confirmed the conversation/evolution/publication separation and persisted-memory implementation. This measures the implemented contracts. It does not fill missing product paths.

## Next required vertical slice

Track [P16](../PLAN.md#p16--connect-conversation-to-real-capabilities-and-governed-work), a product integration item spanning P03/P04/P07/P08/P09/P15:

1. Ground capability answers in host-supplied facts about persistent storage, tools, active release and actual authority. Include negative checks for invented actions and denial of real persistence.
2. Connect a bounded conversational action loop to authorized repository/procedure operations and a source-improvement request. Keep real outcomes, failures, budgets and progress addressable through Slack.
3. Route source changes through frozen evaluation, independent review, succession and current-data recovery. Broader source changes require a deliberate separate contract; the existing cognitive-only admission boundary remains in force.
4. Add trusted Git publication under explicit configured authority. Demonstrate that published bytes match the admitted candidate, then report the actual remote result. Current operator publication cannot count as this application capability.
5. Execute a user-requested Slack change end to end, then repeat with worker/provider failure and current-memory continuity. Do not close the product integration item on prompt wording, schemas, fixture callbacks or the operator manually performing missing steps.

These are planned requirements for the unfinished workflow, not available commands or newly granted runtime permissions. Plans must preserve the distinction between the model proposing an action and the trusted host executing it.

## Subsequent policy foundation

The user subsequently separated conversation access from self-modification suggestion eligibility. The host now supplies actual capability/storage and authenticated per-message/per-memory source facts, and Slack admits human conversation independently of the modification whitelist. This addresses the missing host facts identified above; the complete conversation-to-cognition/growth/action/release workflow remains unfinished under P16. See [ADR 0014](adr/0014-conversation-and-modification-authority.md). The historical Slack answer and this audit are evidence of the preceding behavior, not a claim that the new host facts have already passed a live model-quality probe.

A subsequent one-call direct Mistral probe corrected the session-only memory denial and accurately reported absent conversation dispatch/Git publication, but still invented unsupported memory-versioning and growth-input claims. Host facts were expanded in response. Capability-answer quality is therefore not closed by the presence of facts alone.
