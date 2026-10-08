# ADR 0006: Preserve developmental memory and reusable procedures

- **Status:** Accepted direction in the broad synthesis; storage and processes remain open.
- **Recorded:** 2026-10-08.
- **Source:** Memory and procedural-learning discussion in the [source analysis](../research/source-analysis.md).

## Context

A store of only verified facts and immediately useful outcomes is narrower than the described human-inspired memory objective. Reusable scripts can capture learned competence but cannot replace autobiographical continuity, personality, or ordinary experience.

## Direction

Preserve experiences with provenance and uncertainty, consolidate them into beliefs, procedures, and autobiographical understanding, and allow retrieval, correction, supersession, and appropriate forgetting. Retain experiences and interests even when their future utility is not obvious. Support growth and justified change rather than require every successor to preserve every predecessor belief.

Adopt reusable, tested, parameterized procedures with input/output contracts, permissions, versions, and tests when ordinary code suits the task. Distinguish publishing a procedure from executing it. Treat procedures as one form of memory alongside experiential and autobiographical memory.

## Proposed mechanics and consequences

Use disposable fixtures for ordinary staging and a narrowly authorized consistent read-only snapshot for a separate continuity interview. Catch up later events before cutover. The proposed reconciliation contract must also apply current forgetting and access-scope changes to snapshots and derived context before cutover or restoration; obsolete context must not resurrect disallowed information. Preserve lineage: what changed, why it was accepted, observed evidence, and unresolved concerns, subject to those current policies.

Memvid is a storage/retrieval candidate to investigate, not an adopted dependency or the whole memory process. Privacy scope, retention, memory authorization, consolidation policy, data layout, rollback compatibility, and provenance representation remain open. Optional temporary mode would need to cover every agent-controlled storage path and cannot promise deletion from Slack or external providers.

See [architecture](../architecture.md) and [requirements](../../REQUIREMENTS.md).
