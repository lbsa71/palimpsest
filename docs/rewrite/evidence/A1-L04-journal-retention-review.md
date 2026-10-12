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
