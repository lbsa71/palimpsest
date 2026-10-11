# A1-L04 component handoff

Owner: `/root/a1_memory`, branch `codex/a1-memory-20261011`, worktree `/home/palimpsest/migration/aeon-1-20261011/memory`. Finite goal: tested developmental components, shared durable storage integration, exact evidence and explicit remaining live/cross-lane gates. Base `3398077`; C1 `aeon1.c1.v1` acknowledged. Storage source `8dd8ee7`, locally cherry-picked as `bbb224b`. Final component source: **`9c9171acc9c4dc61ca9dcc1b1e15ee942d795795`** (implementation `8e9f4ef`, scope-error correction `013d9c5`, tool job-scope isolation `9c9171a`). Root owns integration/root configuration. No historical runtime code, data or prompts retained; no dependencies added.

T01 implemented/fixture-verified: attributed speech, tool and action episodes distinguish observed input from interpreted claims. Sources, actor, run and time remain explicit; ordinary social experience does not acquire execution authority.

T02 implemented/fixture-verified: structured audience-scoped context with lexical overlap, optional explicit expansion, recency, whole-record byte budgets and provenance. Old relevant content is retrieved after fifteen unrelated exchanges and database reopen. Oversized records are skipped while fitting records remain available. A synonym query (`gnomon`) retrieves zero records without explicit `sundial` expansion: a preserved limitation, not a semantic retrieval claim.

T03 implemented/fixture-verified with L03 persistence: contradiction and correction records coexist with original evidence; supersession affects selection rather than rewriting evidence. Source deadlines propagate to derived content. Forgetting atomically removes descendant content, adopted self/history and job eligibility. Consolidation is a persisted due/leased job API with restart recovery, stale-worker fencing, explicit retry and atomic output/completion. A scheduler has not yet registered this API for ordinary operation.

T04 implemented/fixture-verified: unseeded revisioned self facets retain chosen preferences/interests/descriptions with reasons and declared evidence. A deterministic later fixture selects `tides`, then `optics` after a later adoption, across reopened databases; CAS rejects stale writers. This demonstrates functional influence of retained state on later fixture choices, **not empirical personality or growth**.

T05 partially fixture-verified: component tests join the real SQLite store and C1. Pi context assembly, ordinary consolidation scheduling, self-chosen inquiry linkage, independent longitudinal/transfer evaluation and live behavior remain open. All available parallel slots were assigned by the lead; consequential fresh review is handed to L09/L08, not represented as completed by the author.

Observed 2026-10-11:

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test packages/development/test/*.test.ts packages/storage/test/*.test.ts packages/contracts/conformance/*.test.ts
```

35 passed: 16 development, 2 storage, 17 contracts; zero failed, skipped, cancelled or todo. The final job-name isolation change reran all 16 development cases successfully. Node emits its SQLite experimental warning. Development cases cover delayed retrieval/reopen, attribution, recipient sets, private derived/self context, bounded records, contradictory/corrected beliefs, narrower correction audiences, later revised choice, stale self writers, descendant retention/removal, interrupted/reclaimed consolidation, rollback of partial/widened outputs, failed-job retry, expiry/forgetting during work, procedure test provenance, C1 adapters, source-existence error concealment and cross-audience job-name isolation.

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node /home/palimpsest/src/palimpsest/node_modules/typescript/bin/tsc --ignoreConfig --noEmit --target ES2024 --module NodeNext --moduleResolution NodeNext --strict --erasableSyntaxOnly --allowImportingTsExtensions --verbatimModuleSyntax --skipLibCheck --types node --typeRoots /home/palimpsest/src/palimpsest/node_modules/@types packages/development/index.ts packages/development/test/development.test.ts packages/storage/test/storage.test.ts packages/contracts/conformance/contracts.test.ts
```

Exit 0, no diagnostics. The final component change reran strict checking on development source/tests with the same flags. Tooling was read from the integration checkout; no root build/lockfile or node_modules changes were made in this lane.

A separate local 50-run measurement over 16 synthetic episodes (one old relevant sundial record plus fifteen unrelated exchanges) selected only `episode-0`; serialized selected payload 461 bytes; median 0.809 ms, p95 1.776 ms, maximum 2.101 ms. No general corpus/semantic/production latency qualification follows from this small warm-process measurement. Retrieval still scans stored records and is not an evaluated scalable index.

Handoff API is documented in `packages/development/README.md`. L02/L06 receive data-only `developmentTools(memory, authenticatedAudience)` descriptors: `memory_retrieve` and `memory_schedule_consolidation`. Tool audiences are captured, source errors conceal unauthorized existence, and job names are isolated by destination-scope digest. No hidden prompt is added. L05/L09 can invoke `expire`, `claimConsolidation`, `consolidationSources`, and `completeConsolidation` around separately reserved interpretation work. Leases fence process interruption; no model request occurs in this package.

Remaining gates: fresh consequential review; runtime authentication/source completeness; real Pi context/tool adaptation; periodic scheduling and goal linkage; held-out procedural validation; L08 independent later behavior and transfer; live provider/personality/development evidence; larger retrieval workloads. Forgetting is logical JSON/database-content erasure and excludes erased records immediately; SQLite pages/WAL/backups or upstream copies are not claimed securely destroyed. Tombstones retain IDs, scope, attribution and lineage. Source omission or undeclared semantic copying cannot be detected by mechanical provenance containment. No external effects, provider calls, deployment, autonomous qualification, full L04 acceptance or Aeon 1 completion are claimed.
