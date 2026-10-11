# Recover missed Slack thread messages

Status: source implemented and independently reviewed, 2026-10-11; installation and live delivery pending. Requirements R04, R19, R21.

## Problem and provenance

The user identified automatic recovery as vital after a reply in an already joined thread was missed during maintenance. Socket Mode reconnects and retries received events, but ADR 0013 explicitly omitted history reconciliation. A healthy connection therefore cannot prove conversation continuity.

## Expected behavior

Independently reconcile retained Slack history for durably joined, currently allowed threads at startup and periodically, including after disconnection. Authenticate the existing bot token and bind every read to its workspace. Submit missing human replies through ordinary durable ingress with their original author and canonical message identity. Never replay external effects directly or treat history as a second task executor.

Maintain separate durable scan checkpoints. Live arrivals cannot move them past gaps. Paginate in timestamp order, fix a scan's upper bound, and retain progress across restart; advance only after a complete page has been durably admitted or intentionally filtered. Revisit a short overlapping interval to tolerate recent history visibility delay. Rate limiting, request failure, inaccessible threads and incomplete pagination remain visible and retryable rather than marked recovered. Bound each pass, request size, latency and shutdown.

Bootstrap from the earliest canonical inbound message in a thread, bounded below by the latest legacy acceptance time when legacy inbound records also exist. Older legacy event-only records cannot be mapped back to Slack timestamps safely. Exclude synthetic report/control tasks from bootstrap; if a thread has only legacy inbound records, use the latest legacy acceptance time as a conservative migration floor. In both cases historical coverage before a legacy floor is unknown. Never guess duplicate identity from message text.

## Acceptance

- Offline reply is recovered after process restart without a new Slack event, while newer live arrivals cannot conceal it.
- Live/history overlap, repeated pages and interrupted acceptance create only one task per canonical message; already accepted edits and uncertain outgoing effects are not replayed.
- Multi-page catch-up survives a failed page, page budgets, restart and rate limiting without advancing over a gap or starving another thread.
- Enforce current workspace/channel scope, exact joined-thread identity, human-only admission and immutable Slack author provenance.
- Credentials/payloads do not appear in diagnostics. A failed history request leaves live ingress usable. Stop cancels pending HTTP and prevents checkpoint advancement after cancellation.
- Deterministic tests use real SQLite and synthetic Slack responses; live read-only capability checks and actual reply delivery are recorded separately.

## Scope and limits

This change repairs continuity of existing joined conversations. Discovery of entirely new conversations while offline (including mentions in old unjoined threads) remains a separate explicit gap; do not advertise full workspace replay. Slack retention/deletion and legacy records without original timestamps also bound historical coverage. Current bot credentials were read-only tested successfully with `conversations.replies`; no new OAuth grant is necessary for joined-thread recovery. No model budget reset, authority change, retrospective source modification or automated replay of uncertain effects is permitted.

Recovered messages are admitted in timestamp order within each thread. Already admitted live work may execute before older recovered messages; this change adds no global ordering barrier. History becoming visible later than the overlap window is not guaranteed recoverable. An opaque pagination cursor retains its original lower and upper query bounds; expired cursors restart from the last completely admitted page boundary.

## Dependencies and risks

Uses the shared durable task store and ingress, current allowlists, and Slack Web API. Recovered user inputs may produce normal model work and outward replies; deployment and live delivery are separate from deterministic fixture evidence. Large backlogs recover over bounded passes. Independent exact-source review is required before installation.

Checkpoint attempts and completions are journaled. Three idle threads polled every minute produce approximately 8,640 small checkpoint events per day; journal compaction/retention is not implemented here and remains an operational follow-up for larger or longer-running installations.

## Verification

The missing implementation check failed before the coordinator existed. Independent review then reproduced two defects: an unclassified malformed human record could close a gap, and authentication rate limits were not retained. Regression checks failed before those fixes and pass afterward. The affected transport/store/CLI suite passed 68 checks with seven existing platform-specific skips (75 total); full TypeScript validation passed. Platform-specific serving tests skipped on Linux do not establish installed CLI behavior.

A read-only Slack dry run used a private SQLite backup and the configured bot's existing credentials. It completed all three joined-thread scans, preserving every original copied task, and queued two missed messages in the copy, including the user's reported message. Production task/effect/memory/journal counts were unchanged. No provider request, Slack post or production ingress occurred. This is read/admission evidence, not live delivery or installation evidence. Installation remains pending.

Fresh independent review of the final source found no unresolved blocking issue. It separately passed 49 affected checks, full TypeScript validation, both repaired negative probes, preservation of a longer rate-limit hold across restart, and a synthetic SQLite scenario with 30 unique tasks across three threads, nine restart passes and 18 history requests. That scenario included live/history overlap, an expired cursor, failed requests, uncertain durable acceptance and preservation of an unknown outgoing effect. Its initial fixture setup error was corrected before the successful run; no provider or Slack post was involved.
