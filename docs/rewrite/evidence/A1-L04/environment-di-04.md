# Memory environmental dependency injection

2026-10-12. Root DI04 under the active Aeon1 goal, isolated environment-di-04. Governing AGENTS environmental requirement, adopted DI planf0bb502 and DI01ae3e043. Own memory index, optional retrieval helper, new local environment adapter, new deployment/environment-di-04.test.ts and this evidence. All existing tests and Store implementation read-only.

```text
/goal Inject memory's wall/monotonic clocks, withdrawal ID and collation at its explicit host composition boundary, preserve retrieval/forget/expiry/source retention behavior, and hand off deterministic causal tests plus unchanged memory regressions for fresh review.
```

## Precode contract

Keep the existing useful positional Store and optional ISO wall-clock callback. Add one optional narrowly typed third dependency argument for memory's other host capabilities: monotonicNow(), withdrawalId(), compareIds(left,right). A local named production factory captures actual Node clock/randomness/collation callbacks at construction; the existing public constructor is the host composition facade. Pure retrieval/mutation methods use only captured functions. No shared registry/container, changes to Store protocol, model-supplied host options or compatibility layer.

Capture supplied function identities once; callbacks are receiver-free, native adapters bound by their factory. The ISO wall callback remains replaceable; validate timestamp on use. Retrieval requires finite nonnegative monotonic readings with a nonregressing end; clock failure propagates without inventing elapsed or mutating memories. Collation is injected because host default locale affects tie ordering; the production factory preserves existing default-locale behavior, frozen once. Do not silently choose a new lexical policy/schema.

Withdrawal ID is read and validated inside the existing atomic forget transaction; failure or collision cannot leave partially forgotten memories, self history, jobs or journal rows. The actual Store remains the authority for withdrawal uniqueness/current-use behavior. Preserve real Store/journal test adapters and all original predicates; storage's own IDs/SQLite/FS remain DI09, not secretly claimed complete here.

Causal checks: known injected retrieval duration and equal unchanged content/budget selection; thrown/regressed/nonfinite readings propagate; separate instances do not share fake state; captured callback identity survives caller replacement; deterministic injected collation orders ties; injected wall time controls expiry; chosen withdrawal ID appears in actual journal, and ID failure/collision rolls back complete state. Run old memory and source-retention suites serially plus strict/diff. No physical child, network, credentials, benchmark, publication or deployment.

## Authored result

The scoped implementation passes **42/42**, zero failures/skips/cancellations,4.846seconds:14 new explicit-DI causal cases and28 unchanged memory/journal cases. Strict TypeScript and diff pass on the first check. Actual Store snapshot equality proves clock/collation/ID failures leave state unchanged, including rollback of self/job/journal mutations; chosen ID is retained in a real withdrawal event, and inherited expiry remains enforced. Existing default host collation remains selected once by the Node adapter. No old test or retrieval-helper code was changed. The default public constructor is the documented production composition facade; application-wide wiring is DI14 and Store internals DI09.

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 deployment/environment-di-04.test.ts packages/development/test/development.test.ts packages/development/test/journal-forgetting.test.ts packages/development/test/journal-retention.test.ts packages/development/test/journal-retention-review.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

Raw receipts `/tmp/aeon-memory-di-first.log` and `/tmp/aeon-memory-di-strict-first.log`. New source imports only existing Node facilities at an invoked composition boundary, adds no dependency, and retains original policy/wire identities. Remaining Date.parse/new Date(explicit) operations transform supplied values and do not sample host time. Node ICU/runtime closure still determines concrete production locale behavior; injection makes that choice controllable, not provider-independent qualification. Fresh independent acceptance remains required; no whole-DI, real elapsed, model growth or H1 claim follows.
