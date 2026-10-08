# First seed slice contract

Status: implementation specification, 2026-10-08. Implements the first portions of P01–P06 and P08; full plan completion remains separate.

## Behavior

1. Load explicit provider/model configuration and private credentials from an external local file. Missing configuration is an honest unavailable result, never an implicit fallback.
2. Resolve a repository-specific data directory outside the checkout. Reject direct and symlink-resolved in-repository paths before creating state. State and credential directories/files use owner-only permissions where supported.
3. Accept normalized input through direct calls or an authenticated loopback API. Persist an idempotent task before acknowledgment. Communications providers do not own task execution or conversational state.
4. Execute bounded provider work independently of transport requests; preserve status, result, cancellation, and progress events. Conversation identity scopes memory and replies. A canceled task must not publish a late model result.
5. Recover unfinished work after restart. Never re-execute an effect whose external outcome is uncertain without reconciliation.
6. Record ordinary episodes, beliefs, procedures, and autobiography with source and uncertainty. Corrections retain lineage; forgetting removes all active versions from retrieval.
7. Maintain a separate growth agenda covering personality/judgment, interests/curiosity, code quality, and capability/potential, with durable checkpoints and finite budgets. Do not equate storing these entries with an implemented autonomous growth loop.

## Verification

Tests use temporary external directories and deterministic providers. Cover durable reopen, duplicate ingress, conversation isolation, cancellation races, stale task transitions, uncertain effects, corrections/forgetting, provider failures, HTTP authorization/input limits, and rejection of substrate paths inside the repository. Live Mistral and Slack checks remain explicitly unverified until configured and actually run.

## Non-goals of this slice

This slice does not yet demonstrate candidate freezing, trusted independent review, fenced cutover, probation, rollback, or a self-authored pushed change. Real restricted process execution has since been verified under the separate [isolation contract](isolation.md). Later slices must complete the remaining gates before the goal can be complete. No external-state history or model transcripts are committed as test evidence.
