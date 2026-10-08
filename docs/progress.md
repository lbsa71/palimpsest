# Implementation progress and evidence

Updated 2026-10-08. This report records local verification, not full seed acceptance. The implementation lead integrates delegated work and owns this record. [PLAN.md](../PLAN.md) retains the full completion criteria.

## Verified first slice

On macOS arm64 with Node 24.13.0, the checkpoint suite passed **67 tests, with one platform-specific test skipped**, and `npm run check` passed. The skipped test is the unsupported-platform isolation branch; the real macOS sandbox tests ran. Later increments must record their own results rather than inherit this total.

| Area / plan | Evidence | Limits and next gate |
|---|---|---|
| Configuration / P01 | `test/config.test.ts`: external paths, repository discovery, symlink and dangling-path rejection, private credentials and safe inspection | Live model identity not configured/verified yet |
| Durable tasks / P03 | `test/store.test.ts`, `test/store-invariants.test.ts`, `test/runtime.test.ts`: reopen, idempotent ingress, cancellation, task budget, uncertainty, immutable outcomes, atomic episode publication | Full process crash matrix and generation fencing pending |
| Providers / P03 | `test/providers.test.ts`: bounded responses, explicit selection, timeout/cancellation, safe failures, Codex subprocess arguments; live Mistral structured output and direct task passed | Native Codex smoke and broader live outage scenarios pending |
| Communications / P04 | `test/communications.test.ts`: direct ingress/egress, authenticated loopback API, Slack signature/allowlists/thread mapping | Live Slack service and smoke pending; no Slack messages sent |
| Isolation / P05 | `test/isolation.test.ts`: real Seatbelt subprocesses deny private reads, symlink escape, protected writes, network and shell execution; bound time/output | Local macOS only; no hard RAM/disk/CPU quota or integrated custodian recovery yet |
| Memory / P06 | Store tests verify four categories, scope, provenance, revisions, logical forgetting and publication identities | Cognitive consolidation, derived-copy forgetting and succession snapshot catch-up pending |
| Procedures / P07 | `test/procedures.test.ts`: actual restricted CSV procedure, schemas, fixtures, content identity, review callback, reuse, revocation | Independent review callback wiring into release governance pending |
| Growth / P08 | `test/growth.test.ts`: four dimensions, finite allocation, task priority, resume without duplicate inference/publication, forgotten lesson stays forgotten | CLI tick exists; continuous idle scheduling, later budget windows and governed code promotion pending |
| Ownership / P05 | `test/ownership.test.ts`: only one coordinator owns the lock; release permits another owner | Generation-specific capabilities remain separate work |

The original red checks and subsequent green runs drove implementation and reproduced review findings. The current test files are the reproducible evidence. Real prompts, completions, memory and per-run records belong in external local state; this report contains only sanitized summaries.

## Review findings resolved

- Terminal tasks and completed experiments could accept stale mutations: completion evidence is now immutable.
- Growth budgets could be refilled through ordinary updates: atomic claims consume a finite allocation before inference.
- A dangling SQLite symlink could bypass placement checks: dangling ancestors are rejected before state creation.
- Ordinary object inspection could expose an API key: the key is non-enumerable and excluded from diagnostic serialization.
- Shutdown during uncertain delivery could attempt an invalid requeue: unresolved effects remain waiting for reconciliation.
- Interrupted growth publication could recreate a forgotten lesson: durable publication identities retain the forget decision across restart.

## Work still required

P09–P14 are being implemented: frozen candidates and protected checks, fresh review, bounded continuity interviews, process-bound authority, fenced cutover, probation, provider-independent rollback, and the separate custodian-upgrade boundary. None has an integrated pass at this checkpoint. The local self-authored behavior change and its pushed provenance remain required. See acceptance A10–A17.

Live Mistral verification passed after the user supplied the private key. `GET /v1/models` confirmed `mistral-large-2512`; a strict structured-output arithmetic check returned the correct result (34 input / 8 output tokens), and `node src/cli.ts ask ...` completed through the real durable runtime (146 input / 10 output tokens). The versioned model is saved in the external credentials file. Full per-run records remain under the external state directory; credentials were not printed or copied into Git. This is a successful small smoke, not a broad capability evaluation.

Direct interactions need no Slack configuration. Full seed acceptance additionally needs memory consolidation, a continuing autonomous growth schedule, live communications integration where configured, operational recovery instructions and the combined failure demonstration A15.
