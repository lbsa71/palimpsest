# A1-L07 — responsive communication and durable follow-through

Status: **reviewing** (bounded components implemented and fixture-integrated; full lane acceptance pending). Session owner: **`/root/a1_communications`**. Accountable actor: Codex. Governing method: [workflow](../workflow.md).

Requirements: [RW09, RW10, RW11, RW12, RW19](../../../REQUIREMENTS.md).

```text
/goal Complete A1-L07 by implementing Slack and direct API communication over one runtime, proving responsive conversation during long tasks, automatic recovery of missed joined-thread messages, authenticated scoped provenance, durable corrections and cancellations, and current owed reports that remain open until their delivery is reconciled.
```

## Ownership and dependencies

Own `packages/communications/`, this lane file and `docs/rewrite/evidence/A1-L07/`. Own transport authentication, admission, channel/thread mapping, history recovery, egress adapters and direct API. L03 owns task/effect identities; L05 owns commitments; L04 owns developmental interpretation. Incoming text is attributed observation, not authority to modify the host.

Specification dependencies: C1 input/effect/provenance contracts and L05 obligation interface. Component tests use fake runtime and Slack endpoints. Integration dependencies: L03 persistence/effects, L05 obligations and L09 process authority. Retain the old incident as a failure fixture, not a reason to carry its implementation.

## Delegable tasks

| Task | Deliverable and exclusive child scope | Model / effort | Dependencies | Acceptance |
|---|---|---|---|---|
| A1-L07-T01 | Shared communication boundary and authenticated direct API in `packages/communications/api/` and `packages/communications/core/` | `gpt-6.1-sol` / high | C1 | Direct and Slack inputs produce the same runtime semantics; identifiers and authenticated roles cannot be supplied by message text; concurrent read/status/control requests remain usable during long execution |
| A1-L07-T02 | Slack authentication, configured scope and conversation admission in `packages/communications/slack/ingress/` | `gpt-6.1-sol` / high | C1; T01 interface | A mention admits a configured conversation and later joined-thread replies need no fresh mention; every author remains attributed; ordinary participation and modification eligibility differ; duplicates and conflicting origin metadata are handled explicitly |
| A1-L07-T03 | Durable cursor/backfill and reconnect recovery in `packages/communications/slack/recovery/` | `gpt-6-astra` / high | C1; T02 input interface; L03 persistence | Messages sent while down or disconnected are recovered in the admitted scope without requiring resend; pagination/rate limits/restart resume safely; overlapping live and history delivery deduplicate; retention or permission gaps are exposed rather than declared empty |
| A1-L07-T04 | Explicit speech, edits/status, cancellation/correction routing and delivery reconciliation in `packages/communications/egress/` | `gpt-6.1-sol` / high | C1; L03 effect journal; L05 obligation interface | Internal drafts are not posted automatically; a current owed report is cleared only by its actual delivery disposition; lost receipts and revised outcomes remain unresolved correctly; controls reach the intended owned task while it is running |
| A1-L07-T05 | Concurrent workload, offline recovery and finite live acceptance in `packages/communications/test/` | `gpt-6.1-sol` / high; fresh `gpt-6-astra` / high reviewer | T01–T04; L03/L05/L09 | Busy coding does not make the interaction surface unresponsive; missed-message fixture reproduces the old failure and passes; authentic live smoke test confirms configured scopes and follow-through; absence of credentials is reported as unavailable, never a live pass |

T02–T04 use separate namespaces and run concurrently after T01's interface draft. T03 tests supply history fixtures independently of a live workspace. Live sends occur only in the authorized test scope of the implementing session.

## Completion evidence and exclusions

Record accepted/rejected input examples, backfill cursor traces, reconciliation of duplicates, controlled downtime/reconnect results, observed response latency under load and actual delivery receipts. Redact private conversations and credentials; keep access-controlled raw evidence outside Git.

Non-goals: preserving old webhook paths or config aliases, reading every channel by default, fabricating a receipt from successful model generation, turning every conversational preference into a code request, or forcing the Autark to ask permission for ordinary reversible conversational judgment.

## Coordination

Owned by the lead who claims this lane; update here before concurrent implementation.

| Field | Current value |
|---|---|
| Owner session | `/root/a1_communications` |
| Branch / worktree | `codex/a1-communications-20261011` / `/home/palimpsest/migration/aeon-1-20261011/communications` |
| Base source / contract revision | `4e55167` / `aeon1.c1.v1`; actual OperationalStore, DurableRuntime, EffectJournal |
| Additional path reservations | None; use the exclusive scope above |
| Last handoff / evidence | Component handoff being recorded; 20 communication tests, joined actual runtime/obligation receipt case, strict typecheck and compiled build pass |
| Blockers / next eligible task | Root L09 host/scheduler/tool assembly, authenticated live Slack/API smoke and fresh independent review; no external sends authorized for this task |

## Bounded component result — 2026-10-11

T01–T04 and the deterministic portion of T05 are implemented in fresh TypeScript
source against actual C1 storage/runtime/effect contracts. Twenty local tests pass:
authenticated HTTP remains responsive during a running shell; source revisions and
controls reach their owned run; Slack mention admission persists joined threads;
channel/history/reply recovery resumes paginated cursors, rate limits and intake
transactions; authenticated Socket Mode reconnects and ACKs committed intake; and
explicit speech remains uncertain until a trusted bot receipt reconciles. A joined
L05 obligation fixture closes only after actual delivery reconciliation.

The bounded component goal does not claim full lane acceptance. No private key,
external Slack message or paid model request was used. Parent-thread lookback,
retention and permission limitations are explicit in durable recovery gaps.
Authentic live smoke, host scheduler/tool assembly, process-crash communication
coverage and fresh independent review remain next acceptance tasks. See the
package README for exact transport/configuration interfaces and limits.
