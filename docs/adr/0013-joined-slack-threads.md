# ADR 0013: Mention once, then converse in the joined Slack thread

- **Status:** Accepted user direction; implementation, app configuration and live unmentioned reply verified.
- **Recorded:** 2026-10-08.
- **Requirements:** R04, R21.
- **Supersedes:** ADR 0011’s mentions-only interaction, retaining Socket Mode and allowlists.

## Context

The user found repeating an explicit mention for every follow-up inelegant. The original installation only subscribed to `app_mention`, so Slack did not deliver ordinary thread replies. Subscribing to channel messages requires broader delivery scopes, while accepting every channel message would lose the explicit conversation boundary.

## Decision

An allowed mention starts or invites Palimpsest into a Slack thread. Ordinary messages from allowed users in that exact thread subsequently reach the shared runtime without mentions. Trust the external task store for participation: an existing task with source `slack` and that exact conversation ID enrolls the thread. It survives restart, recognizes the initial installed conversations and accepts follow-ups during pending inference. Direct API tasks cannot enroll threads.

Subscribe to `message.channels`/`message.groups` with `channels:history`/`groups:history`, retaining `app_mention` and the existing reply scope. Both signed HTTP and Socket Mode apply the same trusted durable lookup after identity filters. An ordinary message must carry a thread root and public/private channel type; unrelated top-level messages, unjoined threads, DMs, bots/subtypes and denied users/workspaces/channels are ignored before persistence. The app performs no history fetch or backfill.

Normalize durable identity by workspace, channel and individual message timestamp, independently of the root timestamp used for conversation scope. A mention and ordinary event for one message then converge to one task/reply. Preserve legacy same-event retries by looking up previously accepted Slack event IDs before switching to canonical identity. No data migration or new substrate table is required.

## Alternatives and consequences

Repeating mentions preserves minimal Slack scopes but fails the requested conversation flow. Accepting all channel messages consumes unrelated conversations and inference. Fetching channel/thread history adds API traffic and retention without being necessary for future follow-ups. A separate in-memory thread registry loses participation on restart.

Slack delivers broader channel events after reauthorization, but the application stores only accepted joined-thread messages. All currently allowed users share that thread’s context. Revoked identity/channel allowlists still deny follow-ups. Joining occurs at durable acceptance rather than successful reply, so interrupted or unavailable inference does not make the thread disappear.

Ordinary follow-ups delivered before the initiating mention is durably accepted are ignored; there is no buffering/backfill. Pre-upgrade tasks lack original message timestamp metadata, so same-event retries retain identity, but a different subscription’s event for the same historical message cannot always be matched. New messages deduplicate across both subscriptions. These bounds are explicit rather than guessing history from message text.

## Verification

Parser checks cover joined public/private follow-ups, absence of a trusted lookup, unrelated threads/top-level messages, identity restrictions, DMs, bots/subtypes, timestamps and overlap identity. Actual SQLite/socket restart checks cover both overlap arrival orders, durable joined state, legacy retries and rejection of direct-task enrollment. Signed HTTP/runtime checks exercise unmentioned follow-ups during pending work and no-inference thread controls. A fresh read-only reviewer independently probed the gates and duplicate orders. The installed manifest was updated in Slack and reauthorized; the saved bot token authenticated with both required history scopes. A fresh live unmentioned follow-up in an existing mentioned thread subsequently succeeded with one Mistral call and a completed delivered Slack reply. Actual exchange and sanitized integration evidence remain outside Git.

References: [public channel messages](https://docs.slack.dev/reference/events/message.channels/), [private channel messages](https://docs.slack.dev/reference/events/message.groups/), [app mentions](https://docs.slack.dev/reference/events/app_mention/), checked 2026-10-08.
