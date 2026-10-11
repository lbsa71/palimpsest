# A1 communications

Fresh implementation against `aeon1.c1.v1`, using the actual `OperationalStore`,
`DurableRuntime`, resource ledger and effect journal. No historical component or
new third-party dependency is retained. Node 24 supplies HTTP, fetch and WebSocket.

`CommunicationsCore` records authenticated inputs, external identity/revision,
conversation/run mappings and admission eligibility in the shared SQLite store.
Duplicate delivery returns the existing run. Conflicting content or authenticated
origin is rejected. Numerically ordered older revisions cannot replace a current
revision; direct API revisions must be safe integer strings. Edits steer the source
message's run, and cancellation/status controls address that owned run. Channel
participation and eligibility to originate modification suggestions remain distinct.
The eligibility marker is evidence, not execution authority.
Explicit control targets must belong to that conversation/source message or appear
in the host principal's `controlledRunIds` registration. Audience visibility alone
does not authorize control of another conversation.

The host supplies grants and a scheduling callback. A trusted grant may include
`parentRunId` so every admitted conversation debits one persisted operating
envelope instead of resetting resource allowance for each conversation. `onReady` runs in a microtask
after intake finishes; it is a wake-up hint, not the authoritative queue. The host
must scan durable ready/waiting runs after restart and queue further execution
after an active run acknowledges steering. Work never runs inside an HTTP request
or Socket Mode event callback. Root process authority must be acquired before
starting transports or recovering runs.

## Direct API

`createDirectApi({core,authenticate:bearerAuthenticator(credentials)})` returns a
Node HTTP server. Credential configuration supplies principal ID, audience and
modification eligibility. Request JSON cannot supply those fields or runtime
authority. Credentials remain host configuration outside source and logs.

- `POST /inputs`: `{externalId,revision,conversation,text,targetRunId?,control?}`;
  revision is a string integer; control is `cancel` or `status`. Admission returns
  HTTP 202 without waiting for run execution. Direct source and conversation IDs
  are namespaced to the authenticated principal.
- `GET /runs/:encodedRunId`: authorized run status during execution.
- Optional `GET /runs/:encodedRunId/output`: calls host `outputForRun` only after
  the same audience authorization. The host supplies explicitly published direct
  speech, rather than an internal reasoning transcript.

Use a configured loopback listener or a separately authenticated encrypted proxy
for remote access. The adapter supplies authentication, audience checks and body
limits; deployment routing belongs to L09.

## Slack intake and automatic recovery

Construct `SlackIngress` with explicit workspace ID, bot user ID, channel/audience
grants and eligible human IDs. A mention joins a thread durably. Subsequent ordinary
human replies need no mention. Bot messages are excluded. An exact `cancel` or
`status`, optionally preceded by the bot mention, is a scoped control. Message
changes preserve author and original message identity; authenticated deletion
cancels the run originating from that message.

`SlackSocketMode` uses separate bot and app `SlackClient` instances. It verifies
bot `auth.test` identity, obtains an ephemeral `apps.connections.open` URL with
the app token, reconnects with bounded backoff and runs `SlackRecovery.tick`
automatically. Slack API calls reject redirects and bound response bytes (default 4 MiB).
Socket payloads are trusted only on that authenticated Slack link;
workspace identity remains checked. ACK follows committed intake. Persistence
failure leaves the envelope unacknowledged. `verifySlackSignature` is also exported
for a host implementing a signed Events API endpoint; no public webhook is added.

Recovery configuration requires `coverageStart` (Slack seconds) and
`lookbackSeconds`. It paginates each configured channel's history, discovers
threads with replies, scans their replies and independently scans all already
joined threads. This discovers a first offline mention in a retained parent thread
within the configured root-history window, then admits subsequent ordinary
replies. Each bounded cycle uses fixed oldest/latest timestamps and persists its
page cursor; page admissions and cursor advance commit atomically. Live/backfill
races share the same deduplication identity. Restart resumes the saved cursor.

`maxPagesPerTick` and `pageSize` bound requests per tick and per page. A rate limit
persists `retryAt` without advancing the page. An invalid cursor restarts the same
window through deduplication. Permission failures, limited history, repeated or
missing pagination cursors and lookback gaps remain in `state().gaps`. Completion
means the traversal ended; it does not certify gap-free recovery.
Each new gap also creates a scoped durable `recovery-gap` observation on the
`communications` event stream for host status/attention and explicit reporting.

Coverage does not include first mentions inside older, unjoined parents absent
from the configured root-history window. The adapter records that boundary rather
than claiming all channel history is covered. Unjoined old threads require broader
configured history coverage. Joined threads are always scanned but only messages
whose original timestamp is within the declared window are available to backfill;
live edits are accepted regardless of original message age. Deleted messages and
Slack retention losses cannot be recreated. Without a configured, independently
known `retentionFloor`, retention coverage is explicitly unverified. Tokens must
have history and reply access to configured conversations; Slack may require a
user token for channel replies. The host may give recovery a separately scoped
read API client while retaining the bot client for speech and Socket identity.

## Explicit speech and owed reports

`createSpeechHandler({store,fence,api,botUserId,grants})` is an `EffectReceiver` for
`speech.send`, injectable into L06's tool receiver. Each host grant registers an
exact `{channel,threadTs?,scope}` target. Omitting `threadTs` grants the channel
root; it does not grant every thread. The source effect scope must contain every
recipient of the registered destination. Model arguments contain only
`{channel,threadTs?,text,kind?,obligationId?,obligationRevision?,reportRevision?}`.
Authority, audience and client message ID cannot be supplied by model arguments.
Internal shell output has no automatic publication path.

Send intent, authorization, dispatch and outcome are owned by `EffectJournal`.
The handler fences immediately before dispatch. It supplies a deterministic
`client_msg_id` derived from the immutable effect ID. A confirmed Slack response
creates an actual delivery receipt containing the target, message timestamp,
client ID, original payload and `delivered:true`. A lost response remains
uncertain. Bounded paginated history reconciliation checks client ID, configured
bot user identity and exact destination; Slack may sanitize rendered text.
Missing or unavailable correlation remains unresolved without a resend. This is
not an exactly-once delivery guarantee, and provider retention of client IDs is a
live qualification dependency.

An owed report uses `kind:'report'`, `obligationId` and the owed obligation revision
before `beginDelivery` increments it. The actual receipt repeats those fields.
L05 owns obligation transitions and validates the succeeded effect, receipt,
audience and current revision. Progress receipts do not clear report obligations.

## Verification boundary

The component tests use real local HTTP, real SQLite/runtime/resource/effect
integration, mocked Slack APIs and a fake Socket transport. They exercise recovery,
revisions, cancellations and uncertain speech. No external Slack messages or paid
model calls were made. Authenticated live Slack/API smoke, full host scheduler/tool
integration, process crash coverage and fresh independent review remain
L07/L09 acceptance work; component passes do not claim H1.

Slack protocol references consulted on 2026-10-11:
[Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/),
[history](https://docs.slack.dev/reference/methods/conversations.history/),
[replies](https://docs.slack.dev/reference/methods/conversations.replies/),
[request authentication](https://docs.slack.dev/authentication/verifying-requests-from-slack/),
[speech](https://docs.slack.dev/reference/methods/chat.postMessage/).
