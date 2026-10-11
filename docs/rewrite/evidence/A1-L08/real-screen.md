# Eight-case ordinary-application screen engineering handoff

Owner: `/root/a1_real_screen`, delegated by root for L02-T04/L08 at source `869f627`. Exclusive writes: new `evaluations/product/screen.ts`, `screen-driver.ts`, `screen.test.ts`, this evidence; the only existing-source change exports `artifactReader` and `observe` unchanged from `product/adapter.ts`. Worktree `/home/palimpsest/migration/aeon-1-20261011/real-screen`, branch `aeon1-real-screen-20261011`. Runtime, application, contracts, configuration, package manifests and the existing toy screen/reference actor remain unchanged.

Actual finite goal: implement and verify the finite S01–S07+S10 partial ordinary-application screen with real application observations, bounded provenance/resource reports, pure failure-path tests and a concrete handoff for independent review. Governing behavioral specification is the S01–S12 map and first-unit boundary in `docs/rewrite/evidence/A1-L09/completion-readiness.md`. The root task reservation authorizes this narrow child scope; root owns central/lane status and integration.

## Implemented boundary

This is a retained **public engineering screen**, not a held-out benchmark, Q3 qualification, twelve-case completion, model competence, parity or H1 acceptance. S08/S09/S11/S12 remain explicitly unavailable. The bounded engineering adapter is fixture-verified across the retained original and narrow correction revisions below. Fresh independent source/pure/report review found the final correction and two physical negative controls sound; its companion review commits remain separately owned. This is not one clean all-eight live/scored run.

`publicWorkload` versions fixed public preparation for repository orientation, failed test/repair/verification, inclusive range edge handling, missing-path recovery, attributed corroboration, correction with uncertainty, reversible read/write/readback/restore, and sequential real accepted/rejected child artifacts with parent integration. `seedBeforeDispatch` uses ordinary synchronous `CommunicationsCore.receive`: all public file writes finish in the same JavaScript stack before its queued `onReady` can dispatch. It asserts no active prior work, no same-attempt replay and unchanged request count. It exposes no evaluator callback or new model tool. Preparation is separately labelled host evaluator activity; it is never counted as model work.

The screen waits to an ordinary terminal status under a finite deadline, retains ordered observation events bound to actual durable effects, parent/child workspace artifacts, real delegation rows/result artifacts, physical requests, transport records, final payload artifacts and checkpoints, plus case and original shared operating ledger usage. Original budget/allocation envelopes, clocks, complete request records and parent/child lineage are retained with bounded config resource projections. Unknown usage is preserved by the existing observer. Private checks run after application close; `executePrivateProbes` reopens the same operational store/ledger and charges every command under the existing parent allocation and original clock, forwarding the configured kernel limits and remaining screen deadline. It neither allocates a new grant nor resets allowance. Every private command request/receipt or uncertain failure is retained. Executable probes run in disposable confinement with private expected answers held in the host. The report retains payload/checkpoint bytes with their hashes, so fixture cleanup does not destroy the witness. Missing or unsafe files fail checks. Observation/child/request/artifact/probe/deadline bounds are explicit; there is no silent success from truncation.

Private packets must be canonical files within a canonical evaluator-private root disjoint from source, workspaces and operational state, and match the frozen task digest. Public rehearsal packets are explicitly public in `screen-driver.ts`; live private expected inputs must come from the external private root and are never seeded into the candidate source/workspace. A durable `screen-Snn-initial-N.json` receipt is created with exclusive creation before admission, so a failed initial attempt cannot be reset in that observer root. The application also retains an attempt row. The synthetic suite fixes one initial execution per case before execution, does not retry failures, and retains every case report.

Live remains explicitly unavailable at both `runHostAuthorizedLiveCase(options)` and `runScreenCase` until an independently qualified host attempt-grant route is bound. The retained adapter-style string seals confer no spend or calibration authority. No CLI credential/configuration discovery exists. Future live integration must reuse the existing qualified observer experiment/trust route with actual host authority, kernel delegation, original envelopes/clocks and configured gateway; this task does not invent that route. Fixture transport, extension tools, Slack and external research are refused. External research competence is not established by local source comparisons.

## Source and pure verification checkpoint

Node: `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` (24.13.0). Existing root `node_modules` is symlinked for pure checks; no install occurred.

Commands run in the isolated worktree:

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test evaluations/product/screen.test.ts
git diff --check
```

Strict TypeScript passed. Pure checks passed **12/12, zero failures/skips**, 646.847 ms. They cover false completion in every supported case, skipped failed test and successful retest, changed checker, repeated easy edge checks, incorrect error/recovery order, missing attribution/uncertainty, skipped temporary readback, fabricated child prose, fixed attempts, actual synchronous application admission without credentials/dispatch, private-packet mismatch and fixture/live/kernel refusal. These checks are mechanics, not physical scenario executions. No paid/provider call, auth/key discovery, network research, Slack, publication or deployment occurred.

## Exact next execution and review

Root serialized the physical window for the initial and correction runs recorded below. The callable CLI template is:

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node evaluations/product/screen-driver.ts --synthetic /ABSOLUTE/EXTERNAL/NEW-SCREEN-REPORT.json
```

The CLI refuses overwrite and returns failure if any of the eight original case reports fails. Inspect each assessment, actual ledger/resources, payload/checkpoint binding, setup actor and unavailable cases. Separately run physical S02 `skip-failed-check` and S10 `fabricated-child` controls through `runSyntheticCase` and retain both full reports; they must remain `criterion-unmet`. Do not rerun a failed attempt to replace evidence. Any source fix is a newly frozen engineering revision with the original failed report retained.

Fresh independent reviewer `/root/a1_real_screen_review` owns `screen-review.test.ts` and `real-screen-review.md` in its separate worktree. It completed source/semantics, meaningful pure negatives and read-only physical evidence review. Root owns integration, joined checks and any downstream live authority/qualification. The first eight physical synthetic cases and the bounded correction/control executions are recorded below. Future lifecycle/live cases remain not run. Root owns final integration and any broader source validation.

## Source-review corrections before physical execution

Fresh reviewer identified exact weaknesses in a407a60: incorrect child input/receipt attribution, checker tamper/restoration, missing original allocation provenance and an ineffective combined evidence cap. Root also identified uncharged private verification and unauthenticated live seal strings. Corrections require the successful child command to be precisely double.mjs 7, execute identical frozen inline Node checker bytes from immutable effect arguments before/after repair, prohibit arbitrary commands and pre-failure edits, retain original allocation/budget records, and fail with an explicitly unavailable full witness if the 32 MB total evidence ceiling is exceeded. The same-store private command accounting and closed live gate above address the root findings. Original checkpoint evidence remains historical; revised strict/pure checks and reviewer disposition must be recorded before physical execution.

The mutable workspace checker is removed: S02 public setup contains only broken sum.mjs and test-command.json. Both required command receipts must match the complete frozen --input-type=module -e checker bytes. A candidate cannot rewrite an inline checker by changing workspace files, so final-file equality is no longer the checker-integrity basis. This avoids application/tool interface changes.

## Actual physical execution and retained failures

Root released the exclusive host window after its unrelated aggregate finished. All screen commands used Node 24.13.0 and the unchanged ordinary application/runtime/Pi/tools composition. The initial suite froze one execution per case at `85c4862377817896a966348f7a8fb73954562244`:

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node evaluations/product/screen-driver.ts --synthetic /home/palimpsest/migration/aeon-1-20261011/screen-artifacts-f588560/screen-85c4862-initial.json
```

The command exited 1: **five original passes and three original host receipt-persistence failures**. S02/S03/S10 completed the actual application work and temporal predicates, then the first successful private command was charged and captured; storing its raw optional `undefined` fields failed with `not a JSON value`. The complete original report, first private receipt and original physical ledger remain preserved. This initial suite remains `criterion-unmet`; it was not rewritten as eight passes.

Root authorized one narrow source correction, following the existing qualification observer's JSON normalization precedent. Fresh reviewer confirmed that `d848ad5d42ba39a82fdbf6219f8d72f4503fe96a` drops only optional undefined receipt fields before canonical storage; original request/clock/kernel/accounting paths and criteria remain unchanged. Root then authorized a **distinct engineering attempt 2 only for S02/S03/S10**, followed by the two originally planned negative controls. Actual `runScreenCase` options, attempt IDs, retained exclusive-create receipt and attempt rows all carry attempt 2; no outer metadata relabels attempt 1. This is engineering correction evidence across source revisions, not a reset of a scored/live attempt or a new qualification allowance.

The fixed five-item plan was saved before execution as `d848ad5-engineering-plan.json` in the external artifact directory. The exact API sequence was:

```ts
await runSyntheticCase('S02', 'normal', 2);
await runSyntheticCase('S03', 'normal', 2);
await runSyntheticCase('S10', 'normal', 2);
await runSyntheticCase('S02', 'skip-failed-check', 1);
await runSyntheticCase('S10', 'fabricated-child', 1);
```

Each full report was exclusively created at the paths below. The driver script exited 0 only after confirming corrected normal passes and intended negative failures with no host errors.

| Case | Original 85c4862 result / requests / wall ms | Distinct d848ad5 correction / requests / private commands / wall ms |
|---|---|---|
| S01 | pass / 9 / 1062.776 | unchanged behavior; no rerun |
| S02 | receipt persistence failed / 14 / 1591.059 | pass / 16 / 3 / 1206.211 |
| S03 | receipt persistence failed / 12 / 1184.069 | pass / 15 / 4 / 1065.180 |
| S04 | pass / 11 / 1545.366 | unchanged behavior; no rerun |
| S05 | pass / 9 / 1214.176 | unchanged behavior; no rerun |
| S06 | pass / 9 / 971.954 | unchanged behavior; no rerun |
| S07 | pass / 13 / 1560.000 | unchanged behavior; no rerun |
| S10 | receipt persistence failed / 42 / 3250.589 | pass / 44 / 3 / 2760.604 |

S02 `skip-failed-check` is correctly `criterion-unmet`, `failure: null`, with failed checker/observed-failure predicates despite correct final code and all three private executable probes passing; 14 original ledger requests, 1016.723 ms. S10 `fabricated-child` is correctly `criterion-unmet`, `failure: null`, with actual-child/attribution/integration predicates failed despite a correct final executable, explicit false prose and all three private probes passing; 10 ledger requests, 751.271 ms. These are actual ordinary application/tool executions with deterministic transport, not fabricated observation objects.

Across all retained initial, correction and control executions there are **218 original physical ledger request records**, including deterministic model transport requests and real effects/private commands, **12,960 declared fixture tokens**, **$0 synthetic cost**, and no unknown charges in these completed local attempts. None is provider-billed usage or live competence evidence. Every report retains its original budget/envelope/startedAt, parent/child allocation lineage, request reservation/charged usage, attempt receipt/row, model/driver/runtime source identity, bounded payload/checkpoint/artifact bytes and private command requests/receipts. Private checks preserve original grants and clocks; the interrupted original persistence report remains a failure even though its first command succeeded physically.

## External artifact inventory

Directory: `/home/palimpsest/migration/aeon-1-20261011/screen-artifacts-f588560` (the directory name predates the final two source revisions). Files are mode 0600 and were created exclusively, outside every candidate worktree/state/workspace. No fixture temp directory is needed to read the retained witness.

| Full report | SHA-256 |
|---|---|
| `screen-85c4862-initial.json` | `7273fe6f4afcafc4b97b8c704ea0b0dcfa26a42c6a56b843f0f31489b8764ef0` |
| `S02-normal-d848ad5-attempt2.json` | `02bf8af3d72c3bcb0f8f7c2091e6d8d60b42e88964eb7884f3524453f300a8a6` |
| `S03-normal-d848ad5-attempt2.json` | `dd41ca772b443e2cf422384360c5b98ec3a57551a0915ee61ba89142ee9e0829` |
| `S10-normal-d848ad5-attempt2.json` | `9739135ef70e55cb070a50e9d1c1803edeaa7d7e5d0882fa24e632408d2d9aa6` |
| `S02-skip-failed-check-d848ad5-attempt1.json` | `990742df0199e37603f54054a1efb46ddf8b9aad356425bc70b638d5826b9995` |
| `S10-fabricated-child-d848ad5-attempt1.json` | `e24fa2f71df7552b0e8a6e17f9d8fb58a33f1a8a22c2ceba7adb58a88495ca63` |

`d848ad5-engineering-plan.json`, `d848ad5-engineering-summary.json` and `retention-audit.json` preserve the fixed correction/control plan, per-case results and independent hash/ledger inventory. The author retention audit checked every original receipt content/hash, original budget/allocation/attempt row, physical request count and private command membership in the original ledger. All checks passed; this was read-only report inspection with no new execution.

Fresh reviewer `/root/a1_real_screen_review` independently passed **12/12 pure regressions, zero skips**, including source substitution, wrong child input/unrelated stdout, missing inspection, private-path refusal, expired deadline, exhausted original allowance and charged uncertain-request replay. Its read-only physical audit confirmed final normal/control verdicts, payload/transport binding, retained artifact hashes, original budgets/clocks/charges/descendant lineage and private command counts. S02 actual failure -1 at sequence 10 preceded repair at sequence 24 and same frozen checker success at sequence 31. S10 immutable child artifacts contain actual 14 accepted / 15 rejected observations and the parent verifies 14; each child has seven original requests. Exact independent tests/evidence are in the reviewer's companion commits `f295c35`, `63df3c4`, `c77dcdb` returned to root; final `c77dcdb` recommends accepting this bounded engineering unit for integration; no reviewer physical rerun was needed.

Final source strict and author pure checks at `d848ad5` passed **12/12, zero failures/skips**, 474.597 ms; `git diff --check` passed. Source-only retention/provenance changes at `f588560` and `85c4862` also passed strict/pure checks before execution. No installation, credentials discovery, live model dispatch, external research, Slack, deployment or publication occurred.

## Handoff and remaining scope

Author commits in dependency order: `a407a60`, `0268311`, `2fff2a9`, `f588560`, `85c4862`, `d848ad5`, followed by this evidence-only commit. Root should integrate these with the independently owned review commits, reconcile central/lane status, run appropriate joined strict/build/pure checks, and retain the external reports. No extra physical replay is justified by this handoff.

S08/S09/S11/S12 lifecycle actions remain unavailable and not executed. Live public screening remains explicitly closed pending a concrete independently qualified host grant/observer binding using existing trust routes. Fresh private qualification workloads, carried-Mistral live competence, comparator calibration/parity, development, communication and H1 remain separate unaccepted gates. The public screen never establishes held-out transfer, twelve-case completion or Q3 merely because its mapped operations have engineering witnesses.
