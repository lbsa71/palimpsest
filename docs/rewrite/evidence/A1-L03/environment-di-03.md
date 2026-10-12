# DI03 runtime environmental ports

2026-10-12. A1 → L03 → DI03. Author `/root/a1_environment_runtime`, branch `codex/a1-environment-di-03-20261012`, isolated worktree `environment-di-03`, baseline `013e258`. Claimed by [execution](../../execution.md), following [DI01](../A1-L01/environment-di-01.md) (`ae3e043`) and the adopted [DI plan](../A1-L09/environment-di-plan.md) (`f0bb502`). Only the three claimed domain files, optional runtime environment adapter, new deployment test and this evidence are writable.

```text
/goal Implement captured local runtime/resource/effect environmental dependencies, preserve original authority/accounting/recovery rules, demonstrate deterministic independent instances and causal failures, and deliver a clean exact owned-path commit for fresh review without waiting on other lanes.
```

## Precode interface freeze

`RuntimeOptions` retains `now?: () => number` for finite epoch milliseconds and adds `elapsedNow?: () => number` for finite nonnegative monotonic milliseconds and `newId?: () => string` for nonempty journal identities. Callbacks are captured once at construction; later changes to the options object do not replace them. Runtime effect duration uses elapsed time, while messages, cancellation and observation provenance use wall time. Regression/nonfinite elapsed readings fail rather than reporting zero duration. After receiver entry, a timing failure retains the dispatched request's original conservative charge and leaves recovery to existing rules; a known effect receipt remains durable.

`EffectJournal(store, fence, receiver, newId?: () => string)` preserves its three existing arguments and captures the optional fourth callback. IDs cover creation, transition, recovery, adoption and receipts. Store transaction failure on conflicting IDs or a throwing supplier rolls back logical state; no fallback entropy is used.

`ResourceLedger(store, ceiling, now?: () => number)` keeps its existing signature. Finite wall time is sampled through a captured callback. Observed wall duration is persisted as an elapsed floor in existing budget/allocation documents, including before admission/dispatch denial, so reopening or clock rollback cannot replenish allowance. Root/child starts use one sample each. Floors describe wall duration, not conservative per-request charges: known settlement still releases the original unused reservation as before.

Precode refinement from root: `snapshot` remains strictly read-only under the actual development/source fence. It may retain a process-local conservative observation, but persisted floors are written only at explicit `allocate`/`reserve`/`dispatched` boundaries. A standalone admission/dispatch persists its timing observation before a denial. When a caller encloses that mutation in a larger transaction, its rollback also rolls back the floor write; no nested independent durable commit is claimed. Such uncommitted observations remain conservative within the current ledger instance; only committed floors survive reopen. A new fence test checks snapshot under `withDevelopmentReadOnly`, unchanged document revisions and subsequent explicit persistence.

Named production factories in `packages/runtime/environment.ts` provide wall, elapsed and ID callbacks. Existing public constructors are documented thin host production composition facades under DI01; fully supplied fixtures avoid ambient defaults. No shared framework, C1 data/schema changes, model configuration callbacks, or changes to Store internals. Store artifact/SQLite operations remain on the existing explicit adapter (DI09 owns its internals).

## Frozen causal tests

The new serial suite uses controlled actual SQLite and explicit synthetic clock/ID suppliers. It checks independent runtime timestamps, elapsed charges and journal identity sequences; options callback replacement after construction; status/checkpoint/adoption/cancellation/observation and effect event IDs; duplicate-ID and supplier failures rolling back claims, checkpoint state, cancellation and receiver-entry reservations; finite wall/monotonic failures; durable wall floors across denied dispatch and reopen; original unknown tokens/cost/elapsed/concurrency across recovery; cancellation preventing further receiver entry while retaining late receipts; receiver-entry timing regression/failure preserving unknown request charges. Existing source and test predicates stay read-only.

Precode conflict recorded before implementation: `packages/runtime/test/resources.test.ts`, “request immutable identity and deadline enforced before dispatch; over-ceiling usage freezes budget”, explicitly permits dispatch after resetting time from 11 to 0 following an expiration. This conflicts with DI01's no-replenishment rule. Root was notified to own an exact separate fixture correction; its unchanged failure must remain in this task's receipts.

## Validation and disposition

Author implementation complete. Interface/test freeze is `fd05e1a`, refined before implementation at `f8cbfb9`; production source is exactly `1d25d5d`; expanded boundary checks are `1d738c4`. The commit containing this final evidence is the exact six-owned-path handoff, with no old test or other source modifications. Root owns central lane status and fresh independent source acceptance.

The captured runtime wall callback supplies messages, cancellation and provenance; the separate monotonic callback supplies effect duration and rejects regression/nonfinite/negative readings. Runtime IDs cover status, cancellation, adoption, observations and checkpoints. Effect IDs cover every effect-journal event, including receipt/recovery/adoption. Named Node factories are the only clock/entropy calls in this slice. Existing explicit Store, fence, shell and receiver adapters remain unchanged. `new Date(explicitMilliseconds)` and pure hashing are not ambient observations; inert AbortController creation follows DI01.

Checkpoint artifact, execution state and event now commit together. An ID supplier failure or conflicting event ID rolls back their logical transaction; the prior assigned checkpoint stays readable. The original joint effect/resource dispatch transaction still fences receiver entry. Clock failure before entry retains an authorized effect and reserved request. Failure after actual receiver entry leaves the original conservative request charge outstanding and preserves the actual effect receipt; normal recovery changes the dispatched request to uncertain. Late cancellation receipts remain evidence, and cancellation bars further effect entry.

Resource floor state describes only observed wall duration, independently of original request ceilings/charged usage. This prevents committed clock consumption from decreasing on wall rollback while allowing known settlements to release unused conservative reservation as before. `snapshot` changes no Store documents/events/artifacts, including under actual `withDevelopmentReadOnly`; its process-local conservative observation may be committed by a subsequent explicit mutation. The outer-transaction test confirms floor persistence shares the caller's rollback while local conservative memory remains. Across reopen, only committed floors and original durable request charges survive; uncommitted source-read or rolled-back observations are not cross-process elapsed proof. No API/adapter alone authenticates live timing.

### Commands and retained receipts

All commands used `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` (v24.13.0), and `node_modules` is a symlink to existing `/home/palimpsest/src/palimpsest/node_modules`; no installation occurred. Original failed logs remain at the listed `/tmp` paths. Their hashes and representative failures below retain the failed evidence in this committed document as well.

| Receipt | Exact command after the pinned Node path | Observed result |
| --- | --- | --- |
| Initial precode `/tmp/environment-di-03-precode.log` | `--test --test-concurrency=1 deployment/environment-di-03.test.ts` at `fd05e1a` | Test-source syntax failure: `ERR_INVALID_TYPESCRIPT_SYNTAX: Expected '{', got '=>'`. Fixed the missing object-closing brace at the next precode commit; retained this failed receipt. |
| Behavioral precode `/tmp/environment-di-03-precode-behavior.log` | Same command at `f8cbfb9` | 12 checks: 1 passed, 11 failed. Unknown usage already passed. Representative failures: injected elapsed expected 3, actual 0; duplicate-ID rollback missing expected rejection; denied-dispatch/reopen expected elapsed 11, actual 1; snapshot rollback expected 4, actual 0; cancellation late elapsed expected 4, actual 0. |
| First implementation `/tmp/environment-di-03-first.log` | Same command | All 12 checks passed. Strict compilation passed in `/tmp/environment-di-03-strict-first.log`. |
| Initial regression `/tmp/environment-di-03-regression-first.log` | `--test --test-concurrency=1 packages/runtime/test/*.test.ts packages/effects/test/effects.test.ts deployment/environment-di-03.test.ts` | 38 checks: 37 passed, 1 failed at the predeclared expired-grant reset fixture. **Command scope error:** the wildcard also ran the real confined recovery composition fixture; details below. |
| Final author causal `/tmp/environment-di-03-final-causal.log` | `--test --test-concurrency=1 deployment/environment-di-03.test.ts` at `1d738c4` | 16/16 passed, including pre-entry clock failure, empty IDs and actual outer-transaction/read-fence tests. |
| Focused original regression `/tmp/environment-di-03-final-focused.log` | `--test --test-concurrency=1 deployment/environment-di-03.test.ts packages/effects/test/effects.test.ts packages/runtime/test/resources.test.ts packages/runtime/test/runtime.test.ts packages/runtime/test/shell-joined.test.ts packages/runtime/test/start-gate.test.ts` | 41 checks: 40 passed, the same old combined resource case failed. No physical recovery-composition file included. |
| Root fixture join `/tmp/environment-di-03-joined-focused.log` | Same explicit six-file command in isolated `environment-di-03-verification` at `39ccde7bb909fef3fbc5583513d9ab1ed3900979` | 41/41 passed; Node exit 0. |
| Strict `/tmp/environment-di-03-joined-strict.log` | `node_modules/typescript/bin/tsc --noEmit` in that join | Exit 0, empty diagnostics. Author strict also passed. |

Root independently corrected the exact old resource fixture at `9b57ba6`. The correction preserves model-identity mismatch and 11ms expiry, adds refusal after clock resets to 0, then uses a separate fresh allocation/request to reach the original 31-token overrun/cancel predicate. Only root's exact `packages/runtime/test/resources.test.ts` blob was imported as a read-only dependency into the detached verification worktree; it was committed separately at `39ccde7`. The author worktree and handoff do not change the old test. Production in that join matches `1d25d5d`; new tests match `1d738c4`.

The unchanged old failure is retained verbatim:

```text
test at packages/runtime/test/resources.test.ts:24:1
request immutable identity and deadline enforced before dispatch; over-ceiling usage freezes budget
BudgetExceeded: allocation cancelled or expired
at TestContext.<anonymous> (.../packages/runtime/test/resources.test.ts:26:183)
```

Receipt SHA-256 values:

```text
8b08bb6e4beecfc64a8a3ae3d124458fa672c59460a886c84884009fe8633c02  environment-di-03-precode.log
8bf632eca6a4def4818457f9a2651333ae4756de212ccc8472dc54ee41ebea46  environment-di-03-precode-behavior.log
9bc1259d70c70a600c25dfaa89ee3ba590d0fa16116a872ac042b51a15247226  environment-di-03-regression-first.log
0bf55ecc173d3cc656bbb694dee1d1c10af86a6db6c8c201bd578c567db660f7  environment-di-03-final-focused.log
5f79c2d720d41b3971666854e52b17f83218ad2b5329947a627aac8b030df0b8  environment-di-03-final-causal.log
b0745928eed5b3946cb161605a5fb207c5ddea327119389715ed2f52c2b6b0e4  environment-di-03-joined-focused.log
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  environment-di-03-joined-strict.log
```

### Scope error disclosure and remaining integration

The initial wildcard regression unintentionally executed `packages/runtime/test/recovery-composition.test.ts`, contrary to the no-physical instruction. It passed the existing local confined inspect/edit/test/repair fixture and reported 5 effects, 7 deterministic fixture-model requests, 12 total requests and 1 unknown provider request. Its “provider” was an injected deterministic transport; no real provider/network/native comparator/credentials/Slack/deployment/full benchmark ran. The author notified root immediately after inspecting the selected file and has not rerun it. Its existing finally blocks closed state, killed the fixture process group and removed the temporary root. A subsequent actual cleanup inspection found `remaining recovery fixture roots: []` under `/tmp/aeon-recovery-composition-*` and `remaining recovery fixture process IDs: []` for the exact recovery fixture executable argument. This is factual disclosure of the scope mistake, not new physical qualification or an authorization claim.

No out-of-scope production wiring is required to compile this slice: the explicitly documented production constructor facades remain valid under DI01. For DI14's complete application injection, root/application owner should supply the captured wall clock to `deployment/application.ts:95` ResourceLedger, ID callback to `:191` EffectJournal, and wall/elapsed/ID callbacks to `:216` DurableRuntime. Those sites are read-only here. Other existing positional ResourceLedger consumers, including `deployment/evaluation-resources.ts` and `evaluations/development/development-driver.ts`, remain valid and retain their respective DI owners; snapshot remains safe under their source read fences.

Exact owned handoff paths: `packages/runtime/execution/index.ts`, `packages/runtime/resources/index.ts`, `packages/effects/index.ts`, NEW `packages/runtime/environment.ts`, NEW `deployment/environment-di-03.test.ts`, NEW this evidence. `git diff --check` and exact-path inspection passed. Fresh independent review, root's fixture integration and the later DI14/DI09/DI28 closure gates remain explicitly separate from this finite author result.
