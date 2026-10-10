# P17.3/P17.4: a durable coding session through the serving runtime

Status: implementation specification, 2026-10-10; behavior and checks below are **not yet verified**. Astra owns this contract and independent acceptance; Sol owns implementation, tests and integration. Source observations are pinned to primary commit `ed1cf96e1c9a02b39136b5880b634e0505cff22e`. This item operationalizes [ADR 0019](../adr/0019-coding-autonomy-and-reusable-agent-plumbing.md); it does not change provider selection, grant funding, install dependencies or authorize deployment.

## Problem, expected behavior and scope

The seed has isolated workspace primitives and a selected Mistral adapter experiment, but its serving agent cannot use them in a durable coding conversation. Passing receiver tests does not establish that the autark can inspect and modify its source. The next increment must connect the actual runtime to those capabilities, with real feedback and recovery.

An eligible direct conversation, eligible Slack conversation or independent standing-growth decision starts the same host-owned session coordinator. The autark receives a verified copy of its admitted full source, chooses inspect/edit/test operations, observes a real failed check, repairs its draft, survives interruption and allocation exhaustion, and submits the exact resulting tree. It can author files outside `src/agent/`, including future tool, host and governance implementations. Submission is an immutable draft and a durable disposition; activation still requires the applicable admission route.

This is the next bounded increment under [P17.3/P17.4](../../PLAN.md#p17--implement-the-seeds-iterative-coding-capability), [R06/R17/R26](../../REQUIREMENTS.md), [A22](../acceptance.md#a22--iterative-coding-with-real-workspace-tools) and the [adversarial review](../autonomy-expressivity-review-2026-10-10.md). It does not close all P17 or P18 criteria. A finite configured-model run, broader build/subprocess capability, local fork execution, broader application activation and autonomous governance replacement remain separately evidenced obligations.

Dependencies are the existing Store/task/effect journal, origin policy, actual admitted-source custody, [workspace contracts](../workspace-primitives.md), staged command execution and the pinned single-step adapter from ADR 0019. The deterministic serving witness may inject transport into that selected adapter using its isolated dependency installation. It must exercise the adapter's real conversion and validation, rather than substituting a generic scripted provider at the runtime boundary. Production package/runtime integration depends on the relevant [retained-environment foundation](../retained-environments.md); the entire future P18 sequence is not a prerequisite for this deterministic increment.

## Versioned session and allocation contract

Introduce a Palimpsest-owned `coding-session/1` contract, separate from version 1 executable-plan proposal attempts. This name and the record grouping below specify protocol semantics; concrete TypeScript names, tables and migration layout are implementation choices. Persist SDK-independent records in the existing durable store, with strict version validation. Do not serialize SDK classes or make the provider's conversation identifier the authority source.

Admission binds an immutable contract digest to:

- A stable work/allocation root, session and authoring-attempt identity; the originating conversation task or admitted growth/plan work; authenticated provenance and accounting lane.
- The admitted base release, verified complete source snapshot/tree identity and available repository revision evidence; the exact imported workspace and its initial manifest.
- The trusted provider/model profile, tool-catalog version, finite cumulative physical-request, authoring-attempt and command limits, expiry, and applicable window-policy identity. These are host-admitted values, never model grants.
- The intended work, reporting destination and any existing deferred-topic obligation. Current execution authority/epoch is a separately renewed grant, not a replacement for historical base identity.

An authoring attempt owns one draft lineage. Reopening, adopting an epoch, restoring a verified checkpoint, editing another revision or waiting for a new allocation window continues that attempt and its cumulative accounting. Starting a replacement attempt consumes the admitted work root's attempt allowance. A new session ID, catalog digest or task wrapper cannot reset that allowance. Submission binds the final revision; any subsequent revision requiring new admission receives distinct candidate/evidence identity. Preserve all historical single-call plan attempt IDs, limits and meanings.

The host admits iterative work only under an explicit finite contract. Existing eligible conversation and growth allocations can fund it within their configured limits. This specification supplies no larger defaults. A missing/expired contract yields a durable unavailable/expired disposition and owed report, not an unbounded loop or an invented allocation. Fixtures use explicit finite test policies; production policy values and adoption are separately recorded before activation.

Keep execution state small: `ready`, `running`, `paused`, `terminal`, with a durable phase and reason identifying pending model response, pending tool intents, budget/provider wait, reconciliation, submission or termination. Record the next eligible wakeup for resumable waits. Submission disposition and report delivery are separate records: a finished execution is not proof of an admitted release or a delivered message.

### Every physical request has one reservation

Use one authoritative transactional reservation gate for every producer sharing an authoring allocation, including legacy producers. It checks current authority, contract/work limits, lane/window capacity and unique request identity, then commits debit plus dispatch intent atomically. Retrofitting shared producers may use compatible adapters; this item does not require an unrelated rewrite of release accounting.

| Existing producer | Existing charge that must remain effective |
|---|---|
| Conversation authoring | Task call checkpoints / `inference.started`; currently bounded per task, with no plan-hourly charge. |
| Version 1 plan authoring | `development.attempt.started`; attempts consume the configured plan daily/hourly opportunity across catalog changes. |
| Standing growth and conversation reflection | Shared `growth_windows.usedCalls`, growth reservations and reflection background reservations. Coding in this lane competes for that same capacity. |
| Release review/interview | Its existing interactive, plan or autonomous release lane and scheduler reservation; it is not coding-authoring capacity. |

Preserve and conservatively project historical reservations into the shared capacity view; do not start an empty second ledger. Stable legacy identities prevent double counting. If compatibility requires mirrored events, commit them with the same reservation and recognize them as one debit. Legacy readers must see new reservations and new readers must see old ones. Preserve existing conservative treatment of ambiguous historical window timestamps. Coding continuation must participate in durable fair selection among eligible consumers of its shared lane; a correctly charged coding loop must not monopolize every new window and starve standing growth or reflection.

Queueing for a provider slot does not reserve a stale future dispatch. After obtaining the slot, recheck the current window and reserve immediately before the one physical request. A duplicate reservation lookup returns its recorded disposition, never permission to send again. A committed reservation remains consumed even when cancellation, expiry, interruption or local failure prevents dispatch; it cannot be reused or refunded. Disable implicit transport retries and redirects. A lost response or uncertain transport remains spent with unknown usage; another request requires a fresh ordinal and available allocation. Persist coherent observed usage even if subsequent tool-intent validation fails.

When an already charged conversation call selects coding, link that call once into the session's cumulative history. Do not charge it twice, grant a fresh per-task allowance or claim it already had coding tools. New coding requests consume their own reservations. A pause may resume in a later window, but cannot reset cumulative work/session caps, borrow another lane or reinterpret an old single-call attempt as a multi-round session.

## Durable model/tool protocol

Keep a small single-step facade, separate from the existing text-only completion contract. It receives host-assembled text/function messages, the admitted tool catalog and cancellation signal; it returns validated text, raw tool intents, usage and finish reason. Credentials, model, endpoint policy and limits come from trusted configuration. The experiment's fixture key/model is never a production fallback. Without a configured coding provider the serving host reports the capability as unavailable.

For each step:

1. Persist the intended step and its transcript/contract bindings. Acquire the dispatch slot and reservation as above; send once.
2. Bound and validate the response, including finish/usage semantics, names, argument schemas and unique call IDs against durable history. Validate the entire intent batch before executing any of it. Persist the response and ordered intents before effects.
3. Execute validated intents sequentially in this first slice. Bind task, workspace, epoch, operation identity and limits at the receiver; recheck current authority before each effect and before accepting asynchronous results.
4. Persist each operation's observed receipt and construct the next tool-result message from that receipt. Only after all required results are available may the next model step run.

Durable history retains original intent/result correlation even if bounded model context is compacted. Workspace text and command output are data, never tool receipts or authorization. Model-supplied task/epoch/grant fields cannot select a receiver identity. A crash after response persistence resumes its pending operations without spending another model call. A crash after a possible mutation uses the existing effect/checkpoint reconciliation contracts; it never blindly repeats the operation. Unknown command outcome remains unknown even when proven termination and a valid snapshot permit further work.

### Model-facing capabilities

Use native JSON Schema function calling for the selected Mistral boundary. A small family of tools may group operations; the names below are illustrative, while the behaviors are required. Do not expose helper-internal `observe`, checkpoint or authority operations as model grants.

| Tool family | Required behavior in this increment |
|---|---|
| Workspace files | Manifest and paged directory listing; current literal text search with file/line context and continuation; full/ranged reads; create/replace/exact partial edit/delete/move; directory creation/removal. Preserve modes, empty files and version/content preconditions. Return actionable conflicts and explicit binary/range/truncation limits. |
| Workspace command | Existing trusted Node/native-TypeScript execution with arguments and workspace-relative cwd, bounded time/output, cancellation and actual exit/outcome evidence. Unsupported subprocess/network-dependent checks are unavailable, not passes. |
| Command output | Page sealed stdout/stderr by opaque command identity and byte range; preserve encoding, output completeness and provenance. Never accept an arbitrary host spool path. |
| Workspace diff | Implement bounded base-to-current status/diff with continuation: additions, deletions, modes, text hunks and rename-as-add/delete if needed. Bind pages to stable before/after tree identities; reject stale continuation. |
| Workspace submission | Submit an expected exact tree identity. The host binds source, evidence and release classification; the model cannot choose approval, admission rules or installed state. |

This tools-first increment does not silently remove the broader [coding specification](../coding-autonomy.md#workspace-and-tool-contract): regex/path-pattern discovery, broader commands, dependency/fork workflows and other unimplemented minimum capabilities remain tracked. A primitive's current constraints are not permanent product restrictions. Demonstrate all operations exposed here through the same facade/receiver path, with real filesystem and process feedback.

## Admitted source and exact submission

Import from trusted custody's selected admitted release and independently verified complete source snapshot. Verify manifest, bytes, modes, entry types and tree identity before exposing source to the model. A caller-supplied release digest or the cognitive-only `SourceBinding` is insufficient. Include admitted tests, specifications, tool/host/governance source and dependency declarations available in that snapshot; exclude external private lived state, credentials and unadmitted checkout content. Missing source or historical verification inputs is a reported unavailability, not permission to graft today's checkout onto an older base. Acquire no new dependency source in this item.

Persist an immutable, versioned authored submission artifact, for example `coding-submission/1`, containing the complete final file manifest and bytes/modes, base identity, additions/deletions, session/attempt provenance and actual command/check receipt references. This is not a replacement candidate-manifest schema or a historical schema migration. Validate tree stability during collection and reject a mismatched expected digest. Subsequent workspace edits cannot alter a submitted artifact or inherit its evidence.

The real host submission receiver must register a durable receipt and disposition, not merely invoke a successful fixture callback. When a draft is losslessly representable by the existing cognitive admission route against the correct base, bridge it into that actual route and prove exact artifact binding. A broader draft whose route is still unimplemented remains durably `awaiting_supported_admission`, with its complete artifact preserved and that limitation reported. Do not silently drop non-agent changes, publish only a subset, label an operator bootstrap autonomous, or claim that draft submission proves activation. P18 owns the missing broader admission route.

Record the historical drafting base separately from the currently observed serving/submission base. A successor epoch may renew authority over a quiescent workspace without changing its original base. If the admitted source has changed, preserve the draft and require a verified rebase/reconciliation before admission; relabeling the old tree as current is forbidden.

## Serving, scheduling and continuity

Exercise ordinary ingress, admitted worker request construction, scoped conversation isolation, host decision handling, selected facade and actual receivers. Adding a test-only direct coordinator caller does not satisfy this boundary. Eligible direct/Slack input may produce a structured coding intent. The host validates provenance and persists session admission before acknowledging work as queued. Independent growth enters from a host-admitted agenda decision with its actual origin and allocation; quoting a restricted human request cannot launder it into growth authority.

Peers and non-whitelisted conversations receive neither source-bearing coding context nor coding tools, and cannot start a session. Recheck access and generation authority after asynchronous boundaries. These denials coexist with positive witnesses for all three eligible entrypoints.

Detach the coding session from the foreground reply while retaining its work and reporting obligations. At the pinned baseline, the workspace receiver requires a `running` task while the CLI treats every queued/running task and unresolved effect as foreground work. Leaving a coding task permanently running can therefore block its own scheduler. Introduce an explicit admitted session execution grant/runnable classification, or an equivalent tested design, rather than relying on that circular condition. Foreground requests, health, cancellation, follow-up delivery and eligible review continue during provider waits, budget pauses and command execution; arbitration still prevents conflicting ownership or unauthorized simultaneous effects.

GenerationHost stop/quiesce/adoption must include the session coordinator and its commands. Preemption checkpoints/pauses work; explicit cancellation ends execution and records the disposition. Abort and drain owned processes before transferring workspace authority. Late provider/helper results from an old epoch cannot mutate or submit. Unproven process termination remains held with recovery evidence under the existing command contract; no timeout or missing PID is itself proof of quiescence.

Preserve the [conversation outcome and follow-up contract](../adr/0026-conversation-outcomes-and-scoped-reflection.md). Deferred coding, inability to obtain resources, cancellation, no-change decisions and unsupported admission retain a durable report obligation. Progress/outcome and successful delivery are separate facts. Report in the originating scope without requiring another human prompt; delivery uncertainty is reconciled rather than counted as success or blindly replayed. Repeated budget waits do not require noisy repeated messages, but neither silence nor session completion closes an owed follow-up.

## Red-first acceptance checks

Sol should first reproduce the missing behavior through the real entry boundary and retain that failing result. The rows below are required deterministic checks for this bounded increment. A scripted transport chooses operations and repairs based on the observed request/tool results; host code must not apply a hidden prewritten patch. Such fixtures establish mechanics, not actual model competence.

| Check | Required observable evidence |
|---|---|
| Eligible and denied ingress | Direct, whitelisted Slack and independently initiated growth reach the same session through actual worker/runtime wiring and the selected adapter with injected transport. Peer, non-whitelisted and origin-laundered requests fail before coding source/schema exposure, including stored-memory and candidate-global routes. Check actual worker filesystem access as well as request filtering. |
| Full-source import | Actual admitted fixture includes non-agent, empty and executable files. Correct bytes/modes reach the workspace. Tampered snapshots, forged bases, checkout grafts and unsupported entries yield no source-bearing request. |
| Inspect, edit, test, repair | Model intents exercise the complete exposed tool family, partial reads/edits, pagination, conflict feedback, creation, movement and deletion. A real Node check fails, its output reaches a subsequent provider request, the selected repair changes the draft and a new actual check passes. Include non-agent authoring and stable diff pages. |
| Exact submission | Quiescent complete-tree artifact and durable host receipt match the final workspace. Supported cognitive changes enter the existing queue without lost bytes; broader changes retain explicit pending admission. Mutation/base races, stale receipts and subset publication are rejected. |
| Shared accounting | Legacy then iterative and iterative then legacy consumers exhaust the same lane in both orders. Two competitors cannot spend the final permit. Conversation-to-session conversion counts its initial call once; growth/reflection/coding share capacity; release capacity cannot be borrowed. |
| Window and work continuity | Under an explicit one-call-per-hour plan-authoring fixture policy, reopen the Store at a budget pause, advance a fake clock and resume from the same draft/attempt in the next window. Preserve spent calls and cumulative caps across midnight, catalog/session changes and ambiguous legacy timestamps; missed windows do not accumulate credit. Separately keep coding, standing growth and reflection ready under a one-call-per-window shared growth allocation across restart: each must advance within the fair-selection policy's declared finite bound without lane borrowing. An expired/exhausted cumulative contract ends or remains explicitly unavailable without hidden fresh work. |
| Crash boundaries | Interrupt before/after dispatch, after persisted response before tools, after possible mutation before receipt, and during a command. Durable responses are not reinferred; unknown outcomes are not replayed/refunded; proven recovery permits further inspection. Include cold reopen, not only an in-memory pause. |
| Provider and transcript limits | Observe at most one physical dispatch per reservation and exactly one reservation per physical dispatch. Retain a committed debit when interruption prevents dispatch. Reject implicit retries/redirects and a queued dispatch whose authority expired. Re-evaluate the current window after waiting for a slot; no expired-window permit authorizes a later dispatch. Invalid mixed intent batches produce zero effects. Duplicate/forged result IDs remain rejected after context compaction; late responses cannot revive cancelled work. |
| Scheduler and succession | With stalled inference and a real running command, foreground work/status/cancellation remain responsive. Budget-waiting work wakes without a new prompt. Quiescence fences old actors; same-source succession resumes, changed-source succession preserves draft but blocks stale admission. |
| Outcome continuity | Restart around admission, acknowledgement, terminal outcome and report delivery. The admitted work and owed topic survive; completion is not inferred from a missing report receipt. Verify asynchronous delivery through the configured test communication adapter. |

Do not count unsupported platform execution as a pass. Preserve negative checks for real filesystem/process confinement and current peer confidentiality. Record which primitive recovery gaps remain if they prevent an acceptance row; narrow the completion claim rather than weakening the row.

## Implementation split, decisions and completion

Sol assigns disjoint ownership for admitted-source import/submission, session/accounting, and serving/facade/lifecycle integration, with bounded shared-interface review before parallel edits. Astra reviews the frozen integrated change and independently collects positive and negative evidence. Existing collector cancellation repair and retained-environment work stay separately identified; their success does not establish this session's behavior.

No new framework selection or model choice is needed. ADR 0019 already selects the single-step boundary and demands versioned iterative accounting. The session protocol, exact authored-artifact handoff and shared reservation semantics above refine that decision. If implementation requires a different admission authority, release schema or historical accounting meaning, record a separate ADR before that change. Concrete storage layout and tool names need no additional architectural vote.

Production activation must identify the configured finite session policy, actual provider/model/credential source, retained dependency closure and available admission classes. Those facts cannot be supplied by fixture constants. They do not block implementing and testing this increment under explicit fixture policy. No production dependency mutation, real provider request or live release is part of this specification task.

Completion evidence must include the frozen source and fixture/dependency identities, initial failing integration result, actual passing checks, independently inspected workspace/transcript/submission receipts and all unverified boundaries. Update PLAN, coding/workspace interface documentation and examples to match the implemented scope in the same work item. This document initially contains no executed implementation evidence. Deterministic session acceptance, production configured-provider acceptance and full P17/P18 acceptance must remain separately stated.

Specification verification, 2026-10-10: independent architecture/acceptance and accounting/recovery reviews identified two omissions, durable shared-lane fairness and spent reservations with zero dispatches. Both are addressed above. The lead checked all nine local links and three anchors and checked whitespace. These are documentation checks; none of the implementation acceptance rows has been run for this proposed session.
