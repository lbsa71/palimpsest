# ADR 0011: Socket Mode for local Slack connectivity

- **Status:** Accepted; live bot authentication and Socket Mode connection verified on 2026-10-08. A user-initiated mention and thread reply also passed after correcting worker recovery transport bounds.
- **Recorded:** 2026-10-08.
- **Requirements:** R04, R17–R19, R21.

## Context

The user asked how to supply Slack connectivity while the local seed was being built. Signed HTTP ingress is implemented, but requires a reachable HTTPS endpoint for Slack. Direct calls remain essential for testing and do not require Slack.

## Decision

Add Socket Mode as the default local Slack transport. The process opens an authenticated outbound WebSocket using an app-level token, normalizes Events API payloads through the same allowlist and thread contracts, persists accepted tasks, then acknowledges envelope IDs. Reconnection must preserve durable event deduplication. The existing signed HTTP adapter remains available.

Keep bot and app-level tokens in the private external credentials file. Require workspace/user allowlists and configure a dedicated channel. The initial manifest used mentions with `app_mentions:read` and `chat:write`. [ADR 0013](0013-joined-slack-threads.md) supersedes its repeated-mention interaction: the current [manifest](../../config/slack-app-manifest.json) adds public/private channel message subscriptions and required history scopes, with application filtering to already-joined threads. DMs, slash commands and interactive controls remain outside this setup.

## Consequences

Local operation needs no public webhook or inbound tunnel. Socket renewal, bounded reconnects, envelope acknowledgement and shutdown are now explicit adapter responsibilities. An authenticated socket replaces HTTP request-signature verification for that connection; it does not replace application allowlists or production effect fencing. Transport tests do not prove a live workspace installation. Authentication checks do not authorize unsolicited channel messages.

Sources: [Slack Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/), [manifest reference](https://docs.slack.dev/reference/app-manifest/). Follow the [setup instructions](../slack-setup.md).
