# Communications providers

Work item: P04, direct-call slice and Slack transport foundation. User direction on 2026-10-08 explicitly adds a communications abstraction so seed tests can interact through calls without Slack. This supplements R04's Slack direction. Status: adapters and shared CLI/runtime integration implemented with fixture coverage; live Slack validation and full P04 acceptance remain separate.

## Specification

The runtime accepts the same inbound message regardless of transport. A message has a stable external `id`, `conversationId`, `text`, `source`, and optional `replyTo`. Authenticated Slack adapters additionally attach `slackAuthor: {teamId, userId}`; direct/local JSON rejects this field. The host stores author provenance atomically with the task. The outgoing interface supports progress, result, and error messages carrying the originating conversation and task IDs. The current runtime emits result messages; periodic progress and separate error notifications are not yet implemented. The runtime owns durable deduplication, task state, corrections, cancellation, context retrieval, and authority checks; adapters must not create a second task loop.

Explicit `status <task-id>`, `cancel <task-id>`, and `correct <task-id> <replacement text>` commands use the same durable task/effect records and can respond while inference runs. The target must belong to the command's conversation. Slack-origin cancellation/correction additionally requires the original authenticated author; status is shared in the thread. Legacy anonymous tasks cannot be cancelled or corrected by a Slack participant. The bearer-authenticated local operator retains whole-seed controls. Correction preserves the original input/history and queues one replacement in the originating thread; repeated command ingress cannot duplicate it. Commands use no inference. During quiescence, new commands remain queued for the current authorized generation to resume. Quiescence and shutdown settle every already-started command and ordinary task before returning, including when another task loses authority and rejects. An unsettled delivery cannot be mistaken for a completed handoff.

Acceptance criteria:

- Direct calls reach the supplied ingress function and expose immutable output snapshots scoped to one conversation.
- Local HTTP exposes submit, status, cancellation, and event polling through that same runtime API. Every request requires a configured bearer token; the server binds only to a literal loopback address. Invalid or excessive input never reaches the runtime.
- Signed Slack HTTP authenticates the raw event body and rejects timestamps outside five minutes. Socket Mode authenticates the connection instead. Both enforce configured workspace/channel restrictions, normalize stable message identities for durable runtime deduplication, and separate conversation threads.
- Slack sends progress/results/errors to the exact originating thread and reports rejected or uncertain delivery honestly. It never automatically retries an operation with an uncertain outcome.

Dependencies: P03 provides durable task ingress and state; the supervised generation host supplies P12 effect fencing. Non-goals: a website, Slack installation/deployment, durable state inside adapters, exactly-once external delivery, temporary conversation retention, and bypassing runtime authority. Material risks: bearer tokens grant local operator access; a shared token is not multi-user isolation; Slack timeouts may leave an uncertain external outcome; in-memory direct output is not durable history.

## Interfaces

`DirectCommunications.receive(message, ingress)` validates and copies the input before calling the supplied runtime ingress. `send(message)` stores a copy. `messages(conversationId)` returns copies of that conversation's output only. Runtime task history remains the durable source of truth.

`createLocalServer(api, { token, host?, port? })` returns `{ server, url, close }`. Host defaults to `127.0.0.1`; `::1` is also permitted. Port defaults to an available ephemeral port. A token must contain at least 16 characters; use a randomly generated value. The token is passed in `Authorization: Bearer …`, never in a URL. The HTTP surface is local operator access to the whole seed, not a per-conversation authorization boundary.

| Method | Route | Behavior |
|---|---|---|
| POST | `/messages` | Submit an inbound message; return the accepted task and HTTP 202, then poll status for completion |
| GET | `/tasks/:id` | Read status; missing task returns HTTP 404 |
| POST | `/tasks/:id/cancel` | Request runtime cancellation; return runtime result |
| GET | `/events?after=N` | Poll events after a nonnegative safe integer cursor |

The JSON submit body contains `id`, `conversationId`, `text`, and optional `replyTo` and `source: "direct"`. Transport identity is fixed to `direct`. Unknown fields, invalid shapes, empty fields, non-JSON input, and bodies exceeding 64 KiB are rejected. Error responses contain stable error codes, not exception stacks or provider credentials. There is no CORS grant. Requests with a browser Origin header are rejected to keep this an operator API.

## Slack boundary

`parseSlackEvent(rawBody, options)` requires the signing secret, request signature and timestamp, allowed team IDs. Allowed channel IDs may additionally restrict access. It returns `message`, `challenge`, or `ignored`. Only ordinary user messages and app mentions become tasks; bot messages and message subtypes are ignored. A Slack thread's context ID is `slack:TEAM:CHANNEL:ROOT_TIMESTAMP`. A message's workspace/channel/timestamp produces the same inbound `id` across retries and overlapping mention/message subscriptions; durable ingress deduplicates it before work. An empty team allowlist or explicitly empty channel allowlist denies messages. User IDs are not a conversation gate: the deprecated parser `allowedUserIds` option is ignored. Host modification eligibility uses its separate whitelist. Challenge responses are still signature-verified.

`parseSlackPayload(body, allowlists)` is normalization only. The signed HTTP wrapper invokes it after signature verification; [Socket Mode](slack-socket.md) invokes it inside its authenticated connection. It does not authenticate an arbitrary caller.

The [bundled manifest](../config/slack-app-manifest.json) subscribes to app mentions and public/private channel message events. Mention the bot to start or invite it into a thread; joined-thread follow-ups and commands need no repeat mention. Slack slash-command envelopes and interactive payloads are not supported. Thread scope is shared by human participants admitted to that thread.

`SlackCommunications({ token, fetch? }).send(message)` posts to `chat.postMessage` with the originating channel and root `thread_ts`, disables unfurls, and uses plain-text output. The fixed HTTPS endpoint rejects redirects and uses a 10-second deadline. It validates HTTP and Slack application success separately. Network errors, server errors, and malformed success responses are uncertain delivery; callers must reconcile instead of blindly replaying. Slack rate limits and explicit API rejections are surfaced as rejected delivery.

Slack integration follows the current official [request-signature contract](https://docs.slack.dev/authentication/verifying-requests-from-slack/), [Events API envelope and retries](https://docs.slack.dev/apis/events-api/), and [`chat.postMessage` API](https://docs.slack.dev/reference/methods/chat.postMessage/), checked 2026-10-08. No live Slack message has been sent as part of adapter tests.

## Verification

Behavior checks live in `test/communications.test.ts`. On 2026-10-08, `node --test test/communications.test.ts` passed all eight checks after the initial missing-implementation failure. The checks exercise copied and scoped direct output, authenticated loopback HTTP, continued addressability during pending ingress, rejected malformed/oversized input, Slack signature and authorization failures, retry event identity, thread isolation, and uncertain egress outcomes. Adapter tests use an actual loopback HTTP server and injected Slack HTTP fixtures; they do not establish live Slack installation, durable runtime deduplication, or P12 fencing.

Runtime/host verification on the same date passed 19 checks across `test/runtime.test.ts` and `test/generations.test.ts`, including reproduced command-settlement failures, duplicate command ingress, paused execution, correction thread preservation, real worker death during inference, and adversarial module-state/checkpoint isolation across local and two other conversations. Provider and outbound transport boundaries remain fixtures in these process integration checks.

## Joined-thread follow-ups (2026-10-08 refinement)

A mention by a human in configured workspace/channel scope is the entry point. Once durably accepted, its Slack conversation ID identifies a joined thread; subsequent ordinary channel-thread messages from any human participant become tasks without another mention. The trusted CLI looks up existing Slack tasks for that exact conversation ID, preserving membership across restart and accepting follow-ups while the first request is still queued. Direct tasks cannot enroll Slack threads. An ordinary message needs `thread_ts` and `channel_type` of `channel` or `group`; unrelated top-level messages, unjoined threads, DMs, bots, edits/subtypes and denied workspaces/channels are ignored before persistence or inference. No Slack history fetch or backfill occurs.

Both transports receive a trusted `hasJoinedThread(conversationId)` callback, fail closed for ordinary messages without it, and share the same normalization. Use workspace, channel and individual message timestamp for durable ingress identity, so mention/message subscriptions cannot produce duplicate replies for the same message. The message timestamp is separate from the root timestamp used for conversation scope. The installed app must subscribe to `message.channels` and `message.groups` and grant `channels:history`/`groups:history`, in addition to the original mention/reply configuration.

The refinement passed parser and actual SQLite/socket restart checks plus signed HTTP/runtime follow-up and command checks. Same-event legacy retries retain their old durable ID; new messages use canonical workspace/channel/message-time identity. A follow-up delivered before the initial mention is accepted is ignored. Pre-upgrade tasks cannot always match a different subscription event for the same historical message. See [ADR 0013](adr/0013-joined-slack-threads.md).

## Conversation and modification authority

[ADR 0014](adr/0014-conversation-and-modification-authority.md) separates broad conversation from eligibility to originate self-modification suggestions. Tasks preserve authenticated workspace/user provenance; conflicting duplicate authors are rejected, and old anonymous tasks stay anonymous. The host supplies current requester eligibility and per-memory source facts from stored task references, alongside actual SQLite persistence and runtime capability facts. These facts are appended outside candidate execution. A quote, shared thread or candidate-generated identity cannot replace the author.

`SLACK_SELF_MODIFICATION_USER_IDS` selects the host whitelist; legacy `SLACK_ALLOWED_USER_IDS` is used only if the new setting is absent. Explicit blank means nobody is eligible while conversation remains available. Eligibility permits consideration, not execution or release. The bounded [conversational dispatcher](conversation-self-modification.md) preserves source-task identity, filters proposal memories before candidate request construction and rechecks current author policy before privileged release/publication. Broader derived-memory and general-action integration remain P16 acceptance gates.
