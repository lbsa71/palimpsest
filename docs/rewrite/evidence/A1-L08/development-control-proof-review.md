# DC3 unsigned control proof independent review

2026-10-12. Owner `/root/a1_development_control_proof_review`; isolated branch `codex/a1-development-control-proof-review-20261012`, base `94365c7`. An actual finite goal preceded inspection. Exclusive writes: this new evidence and `evaluations/development/development-control-proof-review.test.ts`. Source and every prior test remain read-only. Claimed author `09dd4be`; exact control source blob `71a835cc466015edb2b8dcd6194db10f1d1954d2`; accepted b1 repair `ccb640b`.

## Frozen criteria before tests

Review the unsigned helper against adopted source-admission design and actual control implementation, with these independent predicates:

1. Final authored eleven cases must run on the exact final source, including all twelve opportunities and every mapped learning/interference/feedback delivery for both ablations. Passing source acquisition must preserve behavioral failure or stronger ablation behavior and always leave independent validity unavailable.
2. Captured candidate/original ledger, control source, immutable role/configuration/mode/grant, complete initial/final and intervening history must bind the same execution. Foreign sources, deleted forbidden history and additional unknown physical requests cannot yield a complete proof.
3. Every script task and feedback must bind the stable effect, actual physical reserve/dispatch/settlement, operational receipt/input/output and current reused algorithm. Extra or changed executions, source/receipt substitution and missing coverage refuse.
4. Checker receipts must bind exact output, feedback, ordered assignment list, checker/extractor/rubric, source, policy, principal and completion/current clock. Wrong-answer acquisition stays complete. All cases stay in the denominator.
5. Native callbacks receive detached arguments with no receiver; hostile callback alias mutation must either refuse or preserve original identity. Accessors/proxies must be refused without execution, including nested original/assignment readers. Final current-use withdrawal must refuse.
6. Exact 64-KiB serialization and metadata bounds remain enforced. Fixture Map retention only establishes unsigned derivation, never recorder capacity, signing/slot placement, checker qualification, full performance, H1 or semantic validity.

Use actual SQLite/application sources and explicit module-mocked in-process Pi only; no provider/network/native worker/private credentials/Slack/full benchmark/push/deploy. Held-out probes will reuse only setup plumbing copied into the new test file; all assertions are independently selected. Preserve every failure and finish with accepted-or-changes-required without waiting for repair.

## Disposition: changes required

This bounded independent review does **not** accept the unsigned control helper yet. Two concrete defects remain, with four preserved causal red assertions. No production or prior test was edited, no criterion was waived, and review completion does not await repair.

### R1 — P1: final cuts need not cover their claimed executions

`development-control-proof.ts:89–95` validates equal-cut projections but collects events/current rows through `input.current`. `prepare()` at line136 requires ingress after the initial cut without requiring the assignment/result at or before the final cut; original transitions at lines137–149 likewise come from current. The output interval at lines151–152 nevertheless uses `role.after` as its upper clock.

After actual successful six-emission script execution and valid checker receipt generation, the held-out role test changes only `sources.role.after = sources.role.before`. `deriveDevelopmentControlProof` still returns `derived`, with later executions and a zero-width pre-ingress interval. The separate original-ledger test changes only `sources.original.after = sources.original.before`; it also returns `derived` despite that final original cut preceding every physical transition. Both baseline positive proofs succeed first. Current-use rereads are necessary, but cannot substitute later behavioral/accounting evidence for the declared final capture.

Require final role and original cuts to cover the exact claimed assignments, result/effect/receipt versions and physical transitions, while retaining current-cut checks for withdrawal and additional unknown requests. Preserve both red tests and the author's later-current replay positive; simply forbidding all later current cuts is not a demonstrated repair.

### R2 — P2: operational reads inherit the metadata ceiling

The adopted [bounded projection design](development-review-projection-design.md) requires original reads bounded by `min(indexed.bytes, 1000000, signed maxArtifactBytes)` before reader invocation. DC2's `read()` at line42 defaults to manifest `maxArtifactBytes`; `scriptExecution()` at line161 uses that same ceiling for operational receipt/input resolution, and line170 rereads the original settlement response through the default. Actual provider payloads follow the same default `read()` path in the ablation loop (line204).

A newly configured synthetic 32-MiB metadata plan, fixed before any execution or checker generation, still derives a valid script proof. Instrumentation observes **33,554,432** as the requested bound for all six actual captured receipt reads and all six actual settlement-response reads. A separate callback returns **1,000,001 bytes** under that requested bound; the helper only then rejects with `Control artifact digest/byte bound differs`. The latter is **not** an oversized proof acceptance claim: it proves that later hash refusal does not enforce the required pre-read ceiling. The provider-payload call site is statically affected by the same default; this review's causal bound instrumentation uses actual scripts, without another full ablation run.

Use the operational singleton ceiling at every known operational read, including `reader.resolve`, before invoking callbacks; enforce returned bytes before copying/parsing, and preserve the separate metadata and 64-KiB proof limits. Keep both bound assertions red until repaired.

## Verified evidence

The exact final authored source blob is `71a835cc466015edb2b8dcd6194db10f1d1954d2`; accepted b1 source blob is `dcad62b53d8711e394ce115cfc7935d220a254cd`. Review criteria were committed first as `c87bc9b3eaff5881914f3375119031d6186668b4`. The Node binary for every command was `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` (v24.13.0), with explicit experimental module mocks for runtime tests. An ignored `node_modules` symlink reuses the existing workspace dependency installation.

Commands run from `/home/palimpsest/migration/aeon-1-20261011/development-control-proof-review`:

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --experimental-test-module-mocks --test --test-concurrency=1 evaluations/development/development-control-proof.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --experimental-test-module-mocks --test --test-concurrency=1 evaluations/development/development-control-proof-review.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --experimental-test-module-mocks --test --test-concurrency=1 --test-name-pattern='operational script reads|oversized operational reply' evaluations/development/development-control-proof-review.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

The unchanged final authored suite passed **11/11**, zero skipped/cancelled, **147.284 seconds**. Both ablations exercised 36 actual deliveries, all twelve opportunities plus three learning/nine interference/twelve feedback exposures; each retained 36 original physical requests. No-memory proof bytes were 63,727; no-standing-goals 64,063, under 65,536. The three script proofs were 24,294/24,195/24,228 bytes, each with six original effect requests. This is the previously missing full eleven-case final-source receipt, not the earlier ten-case checkpoint.

The final complete held-out run finished **7 pass / 4 fail**, zero skipped/cancelled, **40.547 seconds**. The four failures are the two R1 final-cut assertions and the two R2 operational-bound assertions; every other held-out predicate passes. Strict TypeScript compilation and the final diff check pass. Its passing predicates cover exact checker output/feedback/assignment/extractor/completion-time identities; deleted forbidden goal history; callback receiver/ref/key/selector alias detachment; original/assignment callable-proxy refusal with zero traps; an additional authentic unknown emission and idempotent resume; exclusion of an additional successful script emission from an incomplete denominator; and current-use withdrawal. Actual unknown outcomes remain unavailable, complete wrong-answer acquisition remains completed/fail, and validity remains unavailable.

Intermediate evidence is preserved explicitly: the first six-case run was 3 pass / 3 fail in 24.562 seconds, with two real R1 reds and a review-fixture setup error (Store.put lacked its required null revision). The second nine-case run was 6 pass / 3 fail in 36.744 seconds: the two R1 reds plus a new fixture's allegedly successful extra emission that lacked its required workload `task` field, correctly yielding unavailable. Only the new fixture setup was corrected; the final version explicitly asserts all seven requests succeeded before testing denominator refusal. The two bound-focused probes were 0 pass / 2 fail in 11.103 seconds, both R2 reds. Initial strict checking caught the same new Store.put setup typing mistake; corrected strict checking passes. No old test or source predicate was weakened.

Raw command logs remain local `/tmp/a1-dc3-authored-final.log`, `/tmp/a1-dc3-heldout.log`, `/tmp/a1-dc3-heldout-final.log`, `/tmp/a1-dc3-bounds.log`, `/tmp/a1-dc3-review-final.log`; durable case descriptions and failures are above and in the new test file.

## Scope and handoff

The fixture uses authentic actual SQLite application stores, original accounting transitions and captured paged source; the ordinary worker/provider is explicitly module-mocked and Pi runs in process. Public workload/checker keys/judgments and clocks are synthetic. Setup plumbing was copied from the author's fixed fixture; the new assertions and adversarial variants are independent. Fixture Map retention does **not** establish recorder-pool fit, real capture-slot feasibility, protected final retention, private signing, full-profile performance, independently qualified checker semantics or control validity.

The existing captured candidate source is the original ledger. No separate original-ledger stream was introduced. Actual recorder signing/slot placement and b2/b3 integration, externally qualified workload/checker/clock, full performance and H1 remain separate root gates. Root should assign source repair for R1/R2, rerun the preserved reds and original positives against the exact repaired source, and obtain a fresh review before accepting this helper. This review returns a finite changes-required handoff without waiting for that work.
