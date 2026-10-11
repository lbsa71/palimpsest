# ADR 0030: Recover missed messages in joined Slack threads

- **Status:** Accepted user requirement and selected bounded design; source implemented with deterministic test progress. Installation and live recovered-message delivery remain pending.
- **Recorded:** 2026-10-11.
- **Requirements:** R04, R19, R21.
- **Supersedes:** ADR 0013's exclusion of history recovery for already joined conversations; its conversation-admission boundary remains.
- **Work item:** [Slack history recovery](../work-items/slack-history-recovery.md).

## Context

A message sent during maintenance was absent from durable ingress after the service returned. An active Socket Mode connection proves neither receipt of earlier events nor complete conversational continuity. The user explicitly identified automatic missed-message recovery as vital. Requiring another prompt or relying only on socket retries does not meet that requirement.

## Decision

Enable a separate history reconciler whenever Slack is configured in `serve`, using the existing bot token and history scopes. Authenticate the workspace/bot with `auth.test`; read only currently allowed, durably joined threads through `conversations.replies`. Feed eligible human messages into ordinary durable ingress with their original Slack author and canonical workspace/channel/message timestamp identity. Keep task execution, inferred actions and outgoing-effect reconciliation in the existing runtime.

Retain independent per-thread scan progress in an additive external SQLite table and sanitized journal events. Live arrivals cannot advance this progress. A scan fixes its lower/upper query bounds and saves its opaque cursor only after the whole page has been admitted or intentionally filtered. Preserve continuation across interruption and page budgets; invalid cursors restart at the last fully admitted page boundary. Older source can read existing state while ignoring this metadata, but does not run reconciliation.

Default bounds are startup and socket-connection/reconnection wake-ups, a one-minute interval after each pass, ten pages per pass across rotating threads, and 100 requested items per page. Requests use fixed Slack HTTPS endpoints, ten-second deadlines and a 1 MiB response cap; admission waits also have a ten-second deadline. Validate exact thread/channel identity, plain-message fields and timestamp ordering using integer microseconds before admitting a page. Fix the upper bound two seconds behind current time and overlap completed scans by sixty seconds. Persist authentication and thread-read rate backoff, preserving any longer existing hold; do not label failed or partial scans recovered. Shutdown cancels waits and prevents checkpoint advancement after cancellation; stable ingress identity handles a late commit.

Bootstrap from the earliest canonical inbound timestamp, bounded below by the latest legacy `Ev*` acceptance time and thread root. Legacy-only threads use the legacy floor. Synthetic report/control tasks cannot establish a floor. Coverage before a legacy floor is unknown even when canonical messages coexist; unusable legacy timestamps cannot establish safe coverage. Never infer duplicate identity from message text.

Expose current observations through operator-authenticated `GET /slack/status`: `socket` describes transport, while `recovery` describes pending scans, safe failures/retry times and legacy floors. No payload, token or opaque cursor appears in diagnostics. No new environment setting is required.

## Alternatives and consequences

Socket retries alone do not recover an event never durably received. Requiring user resends loses continuity. Scanning the whole workspace would broaden discovery, permissions and retained data beyond the joined-thread contract. This change therefore does not discover offline first mentions, including those in old unjoined threads.

Recovered messages are admitted in timestamp order within each thread; already queued live work can execute before older recovered messages. Slack retention/deletion and history becoming visible later than the overlap bound remain limitations. These gaps are not evidence of full historical replay. Recovery may initiate ordinary authorized conversation work, but never directly replays an uncertain outgoing effect or refunds model allocations.

## Evidence boundary

A bounded live read-only check with the existing bot token succeeded for `auth.test` and `conversations.replies`; no new token or OAuth scope is required for this installation. Source tests cover transport and durable recovery separately. The work item records executed validation; this ADR does not claim installation or recovered-message delivery.

Current Slack documentation lists bot history scopes for [`conversations.replies`](https://docs.slack.dev/reference/methods/conversations.replies/). Internal customer-built applications retain Tier 3 limits; actual HTTP 429 responses require method/workspace backoff using `Retry-After`, as described in [Web API rate limits](https://docs.slack.dev/apis/web-api/rate-limits/). Checked 2026-10-11.
