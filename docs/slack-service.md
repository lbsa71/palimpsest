# Slack signed ingress (P04)

Status: minimal signed ingress implemented. This service connects the existing verified Slack parser to the shared durable runtime ingress. It adds no task state machine or application memory. Slack remains an optional configured transport; direct calls and the local operator API remain usable without Slack credentials.

## Specification

`createSlackServer(api, options)` exposes `POST /slack/events` on a literal loopback address, defaulting to `127.0.0.1` and an ephemeral port. The caller supplies `api.submit(InboundMessage)`, which must resolve only after durable acceptance, plus the Slack signing secret and configured workspace/channel restrictions. A deployment may explicitly place an operator-controlled HTTPS reverse proxy in front of the loopback endpoint; public proxy deployment and Slack app installation are outside this work item.

Acceptance criteria:

- Verify the raw request signature/timestamp before interpreting events, enforce allowlists, and answer signed URL-verification challenges.
- Acknowledge ordinary messages only after durable `submit` resolves. Preserve Slack event IDs through retries so the existing runtime store deduplicates them across server restarts.
- Keep ingress responsive during ongoing inference because enqueueing and executing work remain separate.
- Reject oversized bodies, invalid content types, malformed events, stale/invalid signatures, browser origins, unsupported routes, and non-loopback bind addresses. Bound body receipt and acknowledgement time.
- If durable acceptance is uncertain or fails, return a retryable failure without exposing exception text. Never claim an unavailable acceptance succeeded.

Non-goals: Slack OAuth/app installation, Socket Mode, a public listener, new task semantics, transport-owned deduplication, or exactly-once external effects. Text command routing for status/cancellation/corrections and progress/result delivery belongs to the shared runtime and configured communications adapter. This minimal ingress does not itself interpret Slack message text as privileged commands.

## Operational contract

Options are `signingSecret`, `allowedTeamIds`, optional `allowedChannelIds`, optional `host`/`port`, and `ackTimeoutMs` (default 2,500 ms, maximum 3,000 ms). An empty team allowlist denies messages. Human users are not filtered by the modification whitelist; authenticated author metadata accompanies accepted messages. The deprecated optional `allowedUserIds` field is ignored. See [ADR 0014](adr/0014-conversation-and-modification-authority.md). The result is `{server,url,close}` with `url` naming the `/slack/events` endpoint.

The timeout bounds acknowledgement, not durable storage completion. A timed-out submission may subsequently commit; Slack may retry it. The runtime must keep stable event-ID deduplication and must not execute an acknowledged event twice. No in-memory seen-ID cache can substitute for that journal. This endpoint returns retryable HTTP 503 if the durable callback rejects or exceeds its deadline; it does not cancel or replay a possibly committing callback.

No incoming body, signing secret, or runtime exception is logged by this service. Ingress content reaches the same external durable store as direct transport. Normal external Slack/provider retention still applies; this is not temporary conversation mode.

## Verification

On 2026-10-08, `node --test test/slack-service.test.ts` passed four checks after the initial missing-implementation failure. Tests use an actual loopback HTTP listener, signed synthetic Slack envelopes, and the shared runtime/SQLite store where deduplication is asserted. They establish signed challenges, authorization, durable acknowledgement, enqueue/inference separation, event retry identity across listener restart, bounded acknowledgement uncertainty, and hostile-input rejection. A targeted strict TypeScript check also passed. They do not send external Slack messages or establish a configured Slack installation. Shared runtime command verification is recorded in [communications](communications.md); CLI startup and credential configuration are separate integration boundaries.
