# ADR 0016: Explicit operator installation of a host baseline

- **Status:** Accepted bounded operator procedure implemented; local integration and live baseline installation verified.
- **Recorded:** 2026-10-08.
- **Requirements:** R09–R11, R14–R19, R22.
- **Specification:** [Operator host-baseline installation](../host-installation.md).
- **Preserves:** ADRs 0010 and 0015's cognitive-only admission boundary and separate host authority.

## Context

A live conversational proposal generated its requested complete cognitive policy change and passed mandatory checks, but custodian proposal registration rejected `governance_change_disabled`. The installed trusted host code had changed while its retained incumbent artifact still carried the older frozen governance identity. This is correct enforcement: ordinary worker succession must not change the host rules admitting it.

The current APIs deliberately cannot overwrite that identity. Bootstrap requires an empty installation; recovery uses retained known-good bytes; ordinary proposal requires equal governance. Silently resetting those records would discard continuity or bypass admission. A reviewed operator host deployment needs an explicit baseline transition while preserving current lived state and an older rescue path.

## Decision

Add a separate trusted operator installation operation, unavailable through candidate/Slack/conversation tools. `GenerationHost` verifies an exact frozen reviewed baseline, independent evidence passing all three protected checks, current expected incumbent and compatible schema/configuration/model. The new baseline must preserve the incumbent's complete cognitive `sourceDigest`; it may not smuggle the human's pending source proposal into installation.

The custodian records an old/new/evidence-bound installation intent, retains old known-good and rescue bytes, stages/probes the new restricted worker, takes a fresh quiesced checkpoint, durably retains both process identities before fencing under a fresh epoch, catches up/activates and requires configured bounded runtime health probes (three by default). Commit new known-good only after success. Failed/interrupted installation before that commit recovers old known-good with current memory/task/effect history; after commit recover the new baseline. Retained staging and stop intents remain subject to reconciliation, bounded fallback and recovery-required handling.

Provide a bound operator restore route for the installed baseline only. Durable restoration intent retains the installed descriptor so a failed/interrupted rescue can be retried after recovery. It cannot silently roll back later cognitive promotions. Retain normal `propose` governance equality and all conversational proposal checks. This baseline operation is not full autonomous custodian evolution or outer-host self-restart.

## Alternatives

- **Relax governance comparison:** Would let an ordinary cognitive proposal change its own trusted environment. Reject.
- **Rewrite/delete the custodian journal or bootstrap a fresh store:** Would bypass release history, epochs, uncertain effects and lived continuity. Reject.
- **Freeze the pending human proposal as the new baseline:** Would skip its cognitive interview/admission. Reject; preserve the already admitted source exactly.
- **Generate candidates against old host source while running new host code:** Would conceal the installed governance mismatch instead of recording a truthful deployment identity. Reject.
- **Implement full custodian self-evolution immediately:** Requires a larger separately evaluated upgrade/rescue contract. Defer; this explicit operator procedure is bounded to the present local deployment need.

## Consequences and validation

Developer host deployments gain an explicit recoverable baseline-alignment step. More installation intent/rescue state and failure checks are necessary; they must not be confused with ordinary cognitive lineage approval. The operator still owns outer software deployment and any authority needed for it.

Custodian fixtures passed for normal governance rejection, bound rescue, later epochs/current history, unresolved effects, failed activation and abrupt process death during installation/restoration transfer with both process identities retained. Real-worker integration passed a checked operator installation preserving memory before subsequent conversational succession; negative cases rejected changed cognitive source/configuration and missing protected checks. The CLI fixture exercises preparation, wrong-incumbent rejection, installation, memory continuity and restoration under a later epoch.

The baseline was installed live while preserving external state, and a subsequent real Mistral cognitive release completed succession and publication. An accumulated-history interview limit discovered during a declined live attempt was repaired and installed through the same operator boundary. See [progress](../progress.md). Local fixtures also reject stale restoration after a later cognitive promotion and recover interrupted restoration. Broader environment compatibility and full host/custodian evolution remain separate contracts.
