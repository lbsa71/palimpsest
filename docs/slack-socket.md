# Slack Socket Mode (P04)

Status: transport implemented and fixture-tested; live Slack configuration remains separate. [ADR 0011](adr/0011-slack-socket-mode.md) selects outbound Socket Mode for the local seed. The existing signed HTTP service remains available. This adapter adds no task store, execution loop, or model access.

## Testable specification

`SlackSocketClient(api, options)` accepts the shared durable `api.submit(InboundMessage)` callback. Construction has no network effect. `start()` obtains a connection URL from the fixed Slack `apps.connections.open` endpoint and waits for its WebSocket to open; `close()` stops the socket, reconnect timers and bounded ingress handlers. `status()` exposes connection state and reconnect count without credentials or payloads.

Acceptance criteria:

- An app token is sent only as a bearer header to the fixed HTTPS endpoint. Redirects are rejected; response bytes and time are bounded. Only `wss` URLs on a Slack domain without user information, unusual ports or fragments are accepted.
- Authenticated socket Events API payloads use the same allowlist, bot filtering, thread and stable event-ID normalization as signed HTTP. Factoring normalization must preserve HTTP signature verification.
- Send an envelope acknowledgement only after durable submit resolves. A late or failed submit remains unacknowledged; Slack retries rely on shared durable event-ID deduplication, including across connections and process restarts.
- Refresh, connection failure, oversized/malformed frames and acceptance timeout close the affected connection and reconnect with bounded exponential backoff. A disabled link stops automatic reconnection. Retry windows have a finite configured budget; exhaustion starts a five-minute cooldown before another automatic retry window. Routine refreshes must remain recoverable after more than eight connections.
- Reset the retry count only after an authenticated hello followed by 60 seconds continuously connected. Immediate opens or hello frames cannot turn repeated failures into a tight retry loop.
- Closing cancels connection establishment, reconnect timers and acknowledgement handlers. Old sockets never acknowledge after replacement. Input, connection tickets, app tokens and callback exceptions are never logged or returned in errors.

Dependencies: P03 durable ingress, the P04 shared parser, and CLI credential/configuration wiring. Non-goals: app installation, OAuth, slash-command or interactive payload execution, exactly-once external effects, public endpoints, SDK dependencies, or live Slack validation without supplied configuration. The initial app manifest subscribes to mentions only.

## Interface and bounds

Options require `appToken`, `allowedTeamIds` and `allowedUserIds`; `allowedChannelIds` is optional. Empty allowlists deny access. `fetch` and `createSocket` are injectable boundaries for deterministic tests. Defaults are a 10-second connection deadline, 2.5-second durable acceptance deadline, eight reconnect attempts per retry window, and a 1-second initial delay doubling to 30 seconds. A sustained healthy session replenishes this budget, so normal Slack refreshes do not accumulate an irrecoverable lifetime limit. Exhaustion keeps status `reconnecting` during a five-minute cooldown, then starts a fresh bounded retry window automatically. `reconnectAttempts` counts attempts in the current window. An explicit zero attempt budget disables automatic reconnects. Initial connection failure and a disabled link still report `failed`. Each frame and authentication response is limited to 64 KiB, and at most 32 ingress handlers run concurrently.

The CLI enables this client only for `serve`, when both bot and app tokens are configured with team/user allowlists. Socket Mode takes precedence if a signing secret is also present. `start()` rejection exits `serve` and closes the local listener; ordinary later failures use the automatic retry windows. The CLI prints socket state only in its startup record. `status()` is a library interface, not an exposed local HTTP route, and a reported open connection does not by itself prove subscribed-event delivery. The bot token is used by the separate outgoing communications adapter.

An acceptance deadline bounds acknowledgement, not a database operation that may already be committing. Shutdown stops handlers from acknowledging but cannot revoke an accepted durable operation. The shared runtime owns that operation and its interruption recovery. The adapter never retries a submit itself, caches completed event IDs as authority, or replays an outbound effect.

The transport contract follows Slack's official [Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/) and [`apps.connections.open`](https://docs.slack.dev/reference/methods/apps.connections.open/) documentation, checked 2026-10-08. Socket authentication replaces per-event HTTP HMAC verification only inside this authenticated connection. Application allowlists and runtime authority checks still apply.

## Verification

On 2026-10-08, the initial missing-module check failed, then all eight `test/slack-socket.test.ts` checks passed after implementation and reliability refinement. The new healthy-refresh and cooldown checks failed against the former lifetime budget before the fix. Node test timers exercise twelve healthy refreshes, exponential minimum waits, immediate hello/failure loops, automatic retry after cooldown and shutdown during cooldown without wall-clock sleeps. Tests use injected HTTP responses and an EventTarget WebSocket fixture, plus the real SQLite store for restart/deduplication behavior. The combined communications, signed HTTP and Socket Mode suite passed 20 checks, and `npm run check` passed. These checks do not establish live Slack connectivity or the native WebSocket network implementation. No real Slack connection or message is part of this work item.
