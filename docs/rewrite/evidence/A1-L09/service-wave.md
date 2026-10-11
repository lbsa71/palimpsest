# Integrated service wave and actual Slack intake — 2026-10-11

Author-operated engineering evidence. No H1 or independent product acceptance is claimed. Exact retained log/script/receipt identities are in [service-wave-receipts.json](service-wave-receipts.json); raw records and the private Slack intake store remain outside Git.

At source `50c3c24`, with Node 24.13.0 selected in PATH, `npm run verify` passed strict check, **356 tests with zero failures and one skip**, and build (357 total). The skipped administrator workspace test requires an explicit disposable mount and was exercised separately by installation work. This aggregate predates provider portability, Slack origin repairs, whole-host replacement and later review changes. It cannot qualify those later revisions.

## Actual Slack transport identity repairs

The real Slack adapter records `source: slack:<team>` and `actorId: slack:<team>:<user>`. The evolution integration had compared only the bare source label `slack` and raw configured user IDs. That rejected eligible Slack suggestions. It also omitted Slack steering when checking whether autonomous goal ancestry was independently originated.

The preserved pre-fix run failed both actual Slack proposal admission and a Slack-steered grandchild-origin regression; the corresponding direct-steering case passed. Repair `746b9fe` centralizes human-source detection and constructs eligible actors from the configured workspace/user pair. Three targeted tests passed after repair, including real SlackIngress → CommunicationsCore → DurableRuntime → ordinary evolution tool composition, broad conversation admission, eligible proposals, ineligible follow-up denial and both direct/Slack lineage checks. Strict check passed. Subsequent independent review additionally examines bootstrap and transitive ancestry; this repair is not represented as exhaustive review.

## Bounded read-only live recovery probe

At source `4aa0b72`, the actual SlackClient and SlackRecovery fetched the user-linked thread in channel `C0C7N7RUH7D`, including message `1791706207.239829` under thread `1791524467.323209`. The probe ran at 18:20:16–18:20:17 UTC against existing configured bot credentials without printing or copying them.

- Four read-only calls: `auth.test`, channel history, thread replies, and a bounded exact-message reread.
- Sixteen real messages admitted into a fresh private engineering store. The target message was recovered through ordinary history intake.
- SQLite was closed and reopened. Recovery cursor/state and the target admission were retained.
- The exact target was admitted twice more through ordinary ingress. The durable input count remained unchanged.
- Zero physical model requests, zero dispatched effects, zero messages sent. No systemd service was started.

The recovery state explicitly retained a **retention-unverified** gap: Slack may omit deleted or expired messages. The probe does not establish complete historical coverage, Socket Mode responsiveness, external speech, cognition or readiness for production. Real model-backed conversation, live reconnect and the full H1 witness remain open.
