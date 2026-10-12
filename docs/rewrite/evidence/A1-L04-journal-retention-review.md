# Independent JR1 journal-retention component review

2026-10-12. Reviewer `/root/a1_journal_retention_review`, root claim `3a91642`; actual finite tool goal created before inspection. Isolated worktree `/home/palimpsest/migration/aeon-1-20261011/journal-retention-review`, branch `codex/a1-journal-retention-review-20261012`. Review handoff `393e0ea2822ed38f2a22105bfe6d972ec6cf4743`, authored production/test source `8ba2828b17cd42e670571f6276fd8156e1bb0a59`, pre-code specification `dcebb0f`. Exclusive writes: this document and the two new storage/development `journal-retention-review.test.ts` files. All production, historical tests and shared files are read-only. Repairs require a new author/root goal.

## Frozen bounded causal checks

Frozen before test execution. Use synthetic, small temporary SQLite databases, fixed clocks and Node 24.13.0; no physical/native workload, live/provider/network/credential/private-state operation or broad materialization/hash. Existing ignored dependencies are reused.

1. Exact immutable event prefix and owned-version erasure: distinguish equal bytes at other keys/namespaces, delete/recreate revision reuse, fresh versions after withdrawal, earlier handles and reopen. Identical retry must return the original result; stale multi-target CAS and conflicting identities must change nothing.
2. Atomicity: actual SQLite trigger failures after at least one payload update and at withdrawal marker insertion must restore all current state, dispositions and events. Caught nested failure must allow a sibling write. Successful withdrawal inside an outer rollback must not consume its request identity.
3. Structural completeness: reject orphan/missing payloads, extra ref fields, invalid digest/current bytes, forged withdrawal target/reason/identity/order/disposition, future-ref use, missing heads, unsupported reserved metadata, and global prefix gaps. SQL tampering is verifier fault injection, outside writer authority.
4. Bounds: retain hard 512-row/1,048,576-byte capture ceilings; every internal row and UTF8 byte counts before bulk payload/event SELECT. Activation must charge prospective internal rows. Unicode ordering must agree with SQLite BINARY, including BMP/supplementary keys and namespaces.
5. Memory closure: source plus descendant, historical self whose current evidence changed, historical job errors, unrelated current self and separately owned equal bytes. Forget/expiry failures must retain original committed state; expiry retrieval still excludes elapsed memories. Retry and reopen must preserve actual erasure and fixed reasons.
6. Inspect the two existing journal-test adaptations independently against `2c1f64e`; assert original root regression blob equals `b2efacd` and expected `d0517821311224bfc260bcf3c2e36fb5da43f93a`. Rerun bounded focused tests and strict compilation. Do not weaken predicates to obtain passes.

Disposition pending execution. This finite JR1 component review does not accept JR2 recorder/copy-retention adaptation, eventual joined JR3, JR5 checkpoints, journal-backed privacy, H1, full raw replay after withdrawal, external-copy erasure or deployment.

## Results and preserved finding

Pre-execution freeze `e7f7442`; unchanged independent review tests and red result preserved at `3d97697fdf1f6c2af82e61f17b959a8da1d7b83a`. Production source is unchanged from the reviewed handoff. No test expectation was changed after execution.

**JR1-R1 — P2: unknown reserved journal rows bypass the complete inventory verifier.** `packages/storage/index.ts:321` excludes every `system.document-journal.*` namespace from current-document replay validation, while `documentRows()` excludes only the two known implementation namespaces. After ordinary journaled writes and a valid withdrawal, inserting the small synthetic SQL fault row `(namespace='system.document-journal.unexpected', key='raw', revision=1, value='"untracked-journal-value"')` causes `captureDevelopmentSnapshot` to return that raw document successfully. It is neither a validated binding nor an owned payload/head nor an ordinary document matched to the immutable ref graph. The frozen rejection case fails with `AssertionError: Missing expected exception` at storage review test line 69. This contradicts complete reserved metadata/inventory validation: extra raw journal data can be presented in an otherwise validated snapshot. The generic writer rejects this namespace, so this is a verifier corruption-detection gap, not a demonstrated supported-writer erasure leak or a claim of protection against malicious host SQL. Reject unknown reserved inventory explicitly rather than exempting the entire reserved prefix from the completeness check. Root/author must repair under a new goal and preserve this red case for fresh re-review.

Independent passing controls establish exact same-key cutoff across delete/recreate, equal-byte isolation, future fresh versions and no old-ref rehydration through earlier handles/reopen; repeated identity and conflicting/stale multi-target CAS; actual second-payload UPDATE failure after prior SQL work and marker INSERT failure; caught savepoint and outer rollback; orphan/ref-field/current-digest/marker-ID/marker-target/reason/disposition/head/prefix rejection; internal row/UTF8 preflight before bulk reads with unchanged hard ceilings; and explicit BINARY ordering for ASCII, accented BMP, private-use BMP and supplementary namespaces. Existing author tests additionally retain missing-payload, reordered-before-ref, absent-marker, unsupported-v1 and prospective activation bound checks. Source inspection confirms future refs cannot pass registration/known-reference and ordered cutoff checks.

Independent memory controls establish multilevel descendant erasure for forget and expiry, historical facet erasure after current evidence changed, job error erasure, surviving unrelated current facet/history, separately owned equal-byte retention, immutable event prefix, new self versions without rehydration, actual payload/marker failure rollback and expiry retry after reopen. Current expired retrieval remains unavailable while failed sweep state remains honestly uncommitted.

## Exact verification and adaptation audit

All runtime commands use `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` (24.13.0). No dependencies were installed.

```sh
node --test packages/storage/test/journal-retention-review.test.ts
node --test packages/development/test/journal-retention-review.test.ts
node --test packages/storage/test/journal-retention.test.ts packages/development/test/journal-retention.test.ts packages/development/test/journal-forgetting.test.ts packages/development/test/development.test.ts packages/storage/test/document-journal.test.ts packages/storage/test/document-journal-review.test.ts packages/storage/test/storage.test.ts packages/storage/test/storage-bounds.test.ts
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH npm run check
git diff --check
git rev-parse HEAD:packages/development/test/journal-forgetting.test.ts b2efacd:packages/development/test/journal-forgetting.test.ts
git diff 2c1f64e 393e0ea -- packages/storage/test/document-journal.test.ts packages/storage/test/document-journal-review.test.ts
git diff 8ba2828 393e0ea -- packages/storage/index.ts packages/development/index.ts
```

Observed results:

- Independent storage: **14 pass, 1 fail**, zero cancelled/skipped; 1278.333782 ms. Sole failure is JR1-R1 above.
- Independent memory: **4/4 pass**, zero cancelled/skipped; 588.533332 ms.
- Existing focused suite: **83/83 pass**, zero cancelled/skipped; 4943.366532 ms. This includes all four original root regressions.
- Strict TypeScript check: passed, including both new review files. Diff whitespace check: passed.
- Both original regression blob identities are exactly `d0517821311224bfc260bcf3c2e36fb5da43f93a`. Thus every original assertion and fixture remains unchanged, rather than merely having equivalent test names.
- Production diff between authored source `8ba2828` and review handoff `393e0ea` is empty.

Separately inspected `document-journal.test.ts` adaptation: the new helper resolves each available ref to its payload and retains exact before/after document comparisons; anchor fixtures change only schema and ref resolution; the empty snapshot expectation adds `journalPayloads: []`. Anchor/capture rejection ceilings, SQL/CAS/savepoint expectations and event assertions are unchanged. Separately inspected `document-journal-review.test.ts` adaptation: mutable-input fixtures use v2 schema, transition assertions resolve available refs, and the application allocation assertion resolves the new after ref. The exact expected transition sequence, rejection behavior, independent append-forgery predicates and application-constructor checks remain intact. No threshold increases or weakened behavioral predicates were found in either diff.

## Finite disposition and next gate

**Changes required for this finite JR1 component review**, with one unresolved finding, JR1-R1. The finite objective is complete: source inspection, frozen bounded checks, preserved red evidence, fixture-adaptation audit and commands/results are recorded. Root owns a NEW author repair/re-review goal and subsequent integration; this review does not enter an automatic waiting or repair loop. Only the three authorized new files were written.

This evidence covers small synthetic OperationalStore/DevelopmentalMemory checks and existing constructor-only tests. SQLite SQL tampering is fault injection; forensic SQLite pages/WAL/backups, caller buffers and separately retained copies are excluded. Conservative bounds can reject fitting snapshots, and accumulated versions/markers can exhaust the unchanged finite allowance. JR2 recorder withdrawal/copy-retention adaptation and joined JR3 remain unimplemented on this handoff; JR5 is separate. No journal-backed privacy, H1, complete raw replay after withdrawal, live/provider/native/network/credential operation, external-copy erasure or deployment qualification is claimed.
