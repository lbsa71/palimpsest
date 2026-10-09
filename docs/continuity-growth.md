# Bounded growth continuity

Work item: P06/P08/P14 continuity reliability, 2026-10-09. Status: implemented; focused projection and existing real-worker handoff/recovery checks verified. Broader product continuity acceptance remains open.

## Problem and expected behavior

Every generation checkpoint currently copies every growth record, including historical provider prompts and complete source proposals. Continued inquiry eventually exceeds the bounded interview and worker checkpoint contracts. Human proposal contents from other conversation scopes also enter the local checkpoint.

Transfer bounded growth descriptors, prioritizing current unfinished inquiries and then recent completed lessons. Each descriptor retains state, question, next step, dimension, resource accounting and provenance, plus SHA-256 identities of the complete external record, outcome and checkpoint. Explicit reflection lessons are excerpts of unverified evidence, never release approval. Raw prompts, replacement files and arbitrary outcome fields stay in the external database. Human-origin entries, including linked follow-ups, are visible only in their recorded originating task's conversation scope; missing or cyclic provenance fails closed.

## Acceptance criteria

- The serialized growth descriptor array is at most 65,536 UTF-8 bytes and contains at most 64 entries. Selection and text truncation are declared through accompanying metadata; finite limits apply even to pathological identifiers and Unicode.
- Running and paused inquiries precede queued inquiries, which precede completed history. Recent entries take precedence within each class. Questions, next steps and explicit recent lessons remain inspectable within declared excerpt bounds.
- Complete-record, checkpoint and outcome digests identify the retained authoritative evidence. Descriptor creation never mutates or deletes the external records.
- Private human proposals and linked follow-ups from other conversation scopes do not enter the snapshot. Scoped entries retain author-task provenance; unresolved provenance is excluded.
- Current memory and task continuity remains unchanged. Real-worker handoff and known-good recovery still work with accumulated growth history.

## Dependencies, non-goals and risks

Depends on the existing Store continuity transaction, external records and scoped task identity. This changes only the growth projection in generation checkpoints; it does not grant model access to the database or permission to retrieve referenced records. Memory and task histories are not truncated, and can still exceed the overall custody/interview bound. Growth beyond the finite projection limits remains in the database and is counted as omitted; descriptors are contextual summaries, not a complete work queue or authoritative proof of improvement. The host owns selection and hashes; candidate-authored lessons remain untrusted. No schema migration, retention change, new resource allocation or source-release bypass is introduced.

## Implemented interface and evidence

`readGenerationContinuity(store, scope)` replaces the growth portion of the existing snapshot with descriptors and `growthProjection` metadata. The latter reports format version, byte/entry limits, actual serialized array bytes, omitted entries, scope exclusions and retained complete records. Each descriptor includes `recordReference`, `recordDigest`, `outcomeDigest`, `checkpointDigest`, and `idDigest`; normal references name the external growth record directly. Pathological identifiers are shortened with declared truncation and a digest of the complete identity. Audit matching can compare that digest against the external records; no unchecked path or retrieval command is supplied to a candidate.

Text bounds, measured in UTF-8 bytes before JSON encoding, are 256 for identity/origin/provenance, 1,024 each for question and next step, and 1,536 for a lesson. JSON encoding is measured again against the aggregate limit. Running, paused, queued and completed entries appear in that order; newest timestamps precede older ones, with stable identity ordering for ties. Every shortened field is named in `truncatedFields`. Full checkpoint prompts and proposed files never enter a descriptor. This preserves external evidence rather than treating an excerpt as authoritative history.

Four projection tests passed, including 90 large historical outcomes, Unicode/escaped text, finite entry admission, linked human provenance, exact audit digests, retained current inquiry next steps and unchanged database records/journal/memory/task contents. Ten existing real-worker generation/conversation-release checks passed, including normal succession, restart, fault recovery with provider/observer absent, scoped workers and exact original-thread publication. TypeScript passed. These tests establish the bounded growth projection and compatibility with those fixtures; they do not prove all-memory or all-task continuity will fit the overall snapshot limit, nor independently establish model judgment quality.
