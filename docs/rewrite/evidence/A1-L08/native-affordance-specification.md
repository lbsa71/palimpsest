# Native comparator affordances

2026-10-11. Root preparation for A1-L08-T03/T04, based on source `f530ada` and the [completion audit](../A1-L09/completion-readiness.md). This is a bounded implementation specification, not a comparator score or a grant. Preserve native instructions and cognition; disclose imposed tool, context and resource differences in every eventual comparison.

## Five-family coverage at this revision

| Product family | Codex 0.162.1 adapter | Claude Code 2.1.296 selected high/adaptive adapter | Remaining qualification |
|---|---|---|---|
| Coding/debugging | Actual CLI/helper command and workspace artifact through two synthetic Responses requests | Actual Bash command and tool-result/thinking continuation through two synthetic Messages requests; captured tool set Bash/Edit/Read | Fresh failure/repair tasks, other claimed tools and actual model quality; selected Claude profile still synthetic-only |
| Source-based research | Local source reads possible; `web_search` disabled, hosted tools refused and namespace has no external network | Local source reads possible; selected rehearsal supplied coding tools, no qualified external research route | Freeze attributed research affordances and verify their physical accounting; local documents alone do not qualify general external research |
| Multistep operations | Actual local command path; no authentic multi-operation workload score | Actual local Bash path; no authentic multi-operation workload score | Independently assigned state changes, verification and failure handling within declared authority |
| Recovery/context continuity | `--ephemeral`, private temporary native home; runner refuses reuse of attempted state | `--no-session-persistence`, private temporary native home; runner refuses reuse of attempted state | Native durable continuation under the same original resource lineage, actual interruption and context reduction; do not call a fresh prompt a recovered session |
| Delegation | Worker rejects a second simultaneous local provider request; observer requires concurrency one | Same transport/observer restriction; selected rehearsal does not exercise Agent/children | Native children and their requests, original shared allowance, parent inspection/integration, cancellation and unknown-outcome behavior |

Both native runners presently return `engineering-baseline`. Neither has a scored pilot. The kernel witnesses cover their recorded native profiles; the selected Claude high/adaptive profile has only namespace evidence. Same-model tables require truly identical models/effort and comparable affordances; best-system tables require a disclosed native capability profile. Disabling a workload's needed capability cannot quietly become evidence of product inferiority.

## Next finite engineering unit: concurrent native requests

```text
/goal Qualify bounded simultaneous native provider requests through the existing Codex and Claude bridges and original host ledger, preserving every request, cancellation and unknown charge; demonstrate actual native child continuation where the pinned tool surface supports it, without claiming best-system or live qualification.
```

The demonstrated preparation gap is concrete: `codex-worker.mjs` and `claude-worker.mjs` use a single `busy` flag, while `validateObserverGrant` requires `maxConcurrency === 1`. The existing `runWorker` already supports at most eight pending RPC requests. Use that bound; do not invent a second broker or new provider route.

Before changing behavior, reproduce overlapping valid requests being refused under an explicitly declared synthetic concurrency grant. Then permit only the original host-granted positive integer concurrency, at most eight. Propagate that exact limit into the worker's immutable start specification and retained invocation. Bound local in-flight request bodies as well as host dispatch; an untrusted worker cannot enlarge the ledger's limit. Each admitted physical attempt keeps its own request, payload, prompt, response, reservation and settlement identity. All native children share the original root request/token/cost/time allowance. Preserve the existing full-context reservation, protocol, price, tier and beta guards.

An unknown outcome stops further dispatch and aborts outstanding siblings. Preserve each sibling's actual known or unknown settlement; cancellation must not turn unknown usage into zero or erase a reservation. Late replies, worker loss, duplicate messages, reopening state and replay must not reset the allocation or permit replacement requests. The process lease still fences concurrent host owners; allowing multiple observed requests within one owner does not permit multiple owners.

Verify bounded concurrent success, overflow refusal before transport, mixed known/unknown outcomes, original clock/deadline, exhaustion, cancellation, worker loss and reopen. Pure observer checks can precede physical work. A bridge-only synthetic HTTP check proves the bridge; a native child claim additionally needs the actual pinned CLI, its emitted tool definitions, original parent/child requests, child artifact and parent continuation. If the native tool surface exposes another unsupported protocol, retain that exact refusal and specify the next narrow unit instead of weakening validation. Public synthetic replies and keys remain permanently labelled fixtures.

Own only the concrete baseline observer/workers/runner, focused baseline tests and evidence in an isolated worktree. Shared worker/runtime/contracts/config require a demonstrated need and coordinated ownership. Obtain fresh independent review before integration. Serialize resource-sensitive physical checks with root. No account discovery, paid inference, external messaging, installations, new dependencies or changes to accepted evaluation thresholds are part of this unit.

External research, native persistence/context reduction, exact paid Claude beta qualification and compatible issued grants remain later explicit tasks. A completed concurrency unit cannot mark those cells available. The proposed 144,000-token experiment envelope remains incompatible with the current full-context native reservation; this specification neither changes that bound nor issues a larger grant.
