# Communications providers

Work item: P04, direct-call slice and Slack transport foundation. User direction on 2026-10-08 explicitly adds a communications abstraction so seed tests can interact through calls without Slack. This supplements R04's Slack direction. Status: adapters and shared CLI/runtime integration implemented with fixture coverage; live Slack validation and full P04 acceptance remain separate.

## Specification

The runtime accepts the same inbound message regardless of transport. A message has a stable external `id`, `conversationId`, `text`, `source`, and optional `replyTo`. The outgoing interface supports progress, result, and error messages carrying the originating conversation and task IDs. The current runtime emits result messages; periodic progress and separate error notifications are not yet implemented. The runtime owns durable deduplication, task state, corrections, cancellation, context retrieval, and authority checks; adapters must not create a second task loop.

Explicit `status <task-id>`, `cancel <task-id>`, and `correct <task-id> <replacement text>` commands use the same durable task/effect records and can respond while inference runs. The target must belong to the command's conversation. Correction preserves the original input/history and queues one replacement in the originating thread; repeated command ingress cannot duplicate it. Commands use no inference. During quiescence, new commands remain queued for the current authorized generation to resume. Quiescence and shutdown settle every already-started command and ordinary task before returning, including when another task loses authority and rejects. An unsettled delivery cannot be mistaken for a completed handoff.

Acceptance criteria:

- Direct calls reach the supplied ingress function and expose immutable output snapshots scoped to one conversation.
- Local HTTP exposes submit, status, cancellation, and event polling through that same runtime API. Every request requires a configured bearer token; the server binds only to a literal loopback address. Invalid or excessive input never reaches the runtime.
- Signed Slack HTTP authenticates the raw event body and rejects timestamps outside five minutes. Socket Mode authenticates the connection instead. Both enforce configured team/user restrictions, preserve event IDs for durable runtime deduplication, and separate conversation threads.
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

`parseSlackEvent(rawBody, options)` requires the signing secret, request signature and timestamp, allowed team IDs, and allowed user IDs. Allowed channel IDs may additionally restrict access. It returns `message`, `challenge`, or `ignored`. Only ordinary user messages and app mentions become tasks; bot messages and message subtypes are ignored. A Slack thread's context ID is `slack:TEAM:CHANNEL:ROOT_TIMESTAMP`. Event retries produce the same inbound `id`; durable ingress deduplicates them before performing work. Empty allowlists deny all messages. Challenge responses are still signature-verified.

`parseSlackPayload(body, allowlists)` is normalization only. The signed HTTP wrapper invokes it after signature verification; [Socket Mode](slack-socket.md) invokes it inside its authenticated connection. It does not authenticate an arbitrary caller.

The [bundled manifest](../config/slack-app-manifest.json) subscribes only to app mentions, even though normalization supports ordinary message events for other explicitly configured subscriptions. Mention the bot for every request and command, including thread follow-ups. Slack slash-command envelopes and interactive payloads are not supported. Thread scope is shared by the allowed users participating in that thread.

`SlackCommunications({ token, fetch? }).send(message)` posts to `chat.postMessage` with the originating channel and root `thread_ts`, disables unfurls, and uses plain-text output. The fixed HTTPS endpoint rejects redirects and uses a 10-second deadline. It validates HTTP and Slack application success separately. Network errors, server errors, and malformed success responses are uncertain delivery; callers must reconcile instead of blindly replaying. Slack rate limits and explicit API rejections are surfaced as rejected delivery.

Slack integration follows the current official [request-signature contract](https://docs.slack.dev/authentication/verifying-requests-from-slack/), [Events API envelope and retries](https://docs.slack.dev/apis/events-api/), and [`chat.postMessage` API](https://docs.slack.dev/reference/methods/chat.postMessage/), checked 2026-10-08. No live Slack message has been sent as part of adapter tests.

## Verification

Behavior checks live in `test/communications.test.ts`. On 2026-10-08, `node --test test/communications.test.ts` passed all eight checks after the initial missing-implementation failure. The checks exercise copied and scoped direct output, authenticated loopback HTTP, continued addressability during pending ingress, rejected malformed/oversized input, Slack signature and authorization failures, retry event identity, thread isolation, and uncertain egress outcomes. Adapter tests use an actual loopback HTTP server and injected Slack HTTP fixtures; they do not establish live Slack installation, durable runtime deduplication, or P12 fencing.

Runtime/host verification on the same date passed 19 checks across `test/runtime.test.ts` and `test/generations.test.ts`, including reproduced command-settlement failures, duplicate command ingress, paused execution, correction thread preservation, real worker death during inference, and adversarial module-state/checkpoint isolation across local and two other conversations. Provider and outbound transport boundaries remain fixtures in these process integration checks.
