# Recovery visibility in ordinary reasoning

2026-10-11; A1-L07/L09 integration, RW09/RW11. Root owns this finite change to `deployment/application.ts`, its application regression, and the new `deployment/communication-state.ts` helper. Base: `8acac07`.

Previously `SlackRecovery` durably recorded scoped recovery gaps, but the ordinary model context and tools did not expose them. A persisted diagnostic alone did not make an unrecoverable gap visible to the reasoning process.

Every ordinary shell slice now receives a bounded communication observation in its authenticated host context. `communication_status` refreshes that observation without network access or publication. It exposes declared history start/lookback, scan/retry state and at most 32 recent gaps for the current conversation. Channel-wide gaps apply to its threads; another thread's or channel's gaps are excluded, and configured audience checks precede disclosure. Historical gaps are explicitly not certified repaired by a later successful scan. Finished scan cycles are explicitly not proof of complete message delivery; connectivity remains unprobed. Direct conversations describe only locally admitted inputs. Runs without a conversation target do not receive cross-channel diagnostics.

The application regression uses actual `SlackRecovery`, durable SQLite state, authenticated Slack ingress, the confined Pi worker and host tool execution. Its synthetic Slack API returns missing permission for the current channel, different permission failures for a foreign private channel and a different thread. The captured model transport sees the current channel's permission and retention gaps in both initial context and the status-tool receipt, then sees them again after application close/reopen. No foreign channel/thread diagnostic enters either model request. All API methods are checked to be history reads; no Socket Mode or speech operation occurs.

Validation with Node 24.13.0:

- `npm run check`: passed.
- Node test runner, `deployment/application.test.ts`: 25/25 passed, including the new restart/disclosure regression. These are fixture responses, not live model competence.
- `node --test packages/communications/test/communications.test.ts`: 23/23 passed.
- `git diff --check`: passed.

The separate [actual read-only Slack probe](service-wave.md) recovered the user's referenced message and retained its unverified-retention diagnostic. This change does not claim a live conversational reply, a repaired Slack retention policy, deployment or H1 acceptance.
