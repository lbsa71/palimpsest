# Idle journal selector responsiveness

Status: isolated source repair and offline verification, 2026-10-10; exact review, confined authoritative checks and destination installation/acceptance pending. Scope: P04/P15, R04/R17/R19; follows ADR 0024 without changing collection or admission authority.

## Problem and provenance

Actual destination acceptance measured a settled idle main process at about 101% of one core, with completed-task reads taking 4.775, 6.306 and 5.231 seconds. No active tasks/collectors or journal changes were observed. These are measured failures, not a user-specified latency SLO. Preserved evidence: migration/live-acceptance/quiet-period-observation.json. Historical stopped-state journal has 1158 rows and about 12 MB of payload. Faithful whole-journal read/decode observations took 80–131 ms each; these are not a main-process profile.

Code inspection shows repeated whole-journal decoding in queue/publication/continuity selectors on one-second serving loops. Multiplicity and irrelevant large payload decoding are a testable cause hypothesis; offline before/after evidence must distinguish confirmed selector costs from unmeasured whole-service causality.

## Expected behavior and design

Add optional exact event-type selection to Store.listEvents before payload decoding, combining it with existing exclusive after cursor and task scope. Default full audit behavior, sequence order and row payloads remain unchanged. Convert bounded recurring selectors only where their complete relevant type set is explicit. No journal cache, deletion, schema migration, historical truncation or changed release checks. An empty type set selects nothing. Malformed selected payloads still fail; unrelated payloads are not decoded by scoped selectors.

Growth selectors retain every literal case-sensitive `growth.` prefix, including future types. Prefix input containing NUL is explicitly rejected because SQLite text decoding does not retain embedded NUL suffixes. Full audit is unchanged. Publication reconciliation reads heavy finished reports only after checking published/backoff results. Existing consumer reducers and authority/debit checks remain in place.

## Acceptance

- Semantic fixtures preserve interleaved queue chronology, terminal state, later appends, cursor/task intersections, duplicate type selection and reopen behavior. Default audit remains complete and malformed selected/default reads fail.
- Large unrelated payload fixtures establish no unnecessary unrelated decoding in recurring selectors; offline measurements report wall/CPU time and decoded bytes without asserting a flaky universal runtime bound.
- Affected scheduling, publication, continuity, budget/debit, cancellation and recovery tests plus strict typechecking pass. Source cognition and all four authoritative checks remain unchanged.
- Proposed final host criterion (engineering choice, not prior user SLO): after startup settles and with no active work or competing review benchmark, three 15-second samples each use less than 20% of one core and at least ten authenticated completed-task reads each finish within 500 ms. This leaves substantial headroom for the one-second scheduler and interactive traffic. No provider calls or budget resets for these measurements. Offline success does not establish this gate.

## Boundaries and risks

No live service/state/configuration edits, network/model probes, merging, pushing or installation in this work item. Canonical fd8d2e3 and older rescue stay intact. Work is isolated on codex/idle-journal-responsiveness. Dependencies are existing Store SQLite and selector contracts. Principal risk is omitting a relevant event type and thereby hiding authority, debit or uncertain publication history; inspect callers and run semantic negatives. No full P17/P18 activation or migration acceptance claim. Destination confined checks require host execution because the development session denies Bubblewrap namespaces.

## Offline evidence

Private evidence is retained in `/home/palimpsest/migration/idle-responsiveness-evidence/`. RED queue selection decoded 300 irrelevant large payloads over three reads. New selector/chronology/publication/fresh-connection/cursor/corruption tests pass with affected semantic suites (132/132). Strict typechecking and separate Store/scheduler checks are recorded in the final receipt; child-process fixtures require host execution and are not counted as passes here.

On disposable copies of the approved epoch-139 stopped state, repeated queue reconciliation plus queue/publication-pending selectors made 23 queries per round. Before repair they decoded 26,634 rows/about 281 MB and delayed a zero-delay timer 2.57–2.70 seconds. After repair they decode 1,282 rows/about 225 KB with 26–63 ms timer delay, identical queue outputs and unchanged full audit identity. Instrumentation serializes returned payloads to measure their bytes, so timing includes instrumentation overhead; this is a repeatable selector replay, not a main-process profile or HTTP SLO pass. No inference or publication executor runs. Final measured ranges and exact source/evidence pins are in the private receipt. Host acceptance must use current state (including the peer exchange and spent call), never another import of the older Darwin archive.
