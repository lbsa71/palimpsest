# Eight-case ordinary-application screen engineering handoff

Owner: `/root/a1_real_screen`, delegated by root for L02-T04/L08 at source `869f627`. Exclusive writes: new `evaluations/product/screen.ts`, `screen-driver.ts`, `screen.test.ts`, this evidence; the only existing-source change exports `artifactReader` and `observe` unchanged from `product/adapter.ts`. Worktree `/home/palimpsest/migration/aeon-1-20261011/real-screen`, branch `aeon1-real-screen-20261011`. Runtime, application, contracts, configuration, package manifests and the existing toy screen/reference actor remain unchanged.

Actual finite goal: implement and verify the finite S01–S07+S10 partial ordinary-application screen with real application observations, bounded provenance/resource reports, pure failure-path tests and a concrete handoff for independent review. Governing behavioral specification is the S01–S12 map and first-unit boundary in `docs/rewrite/evidence/A1-L09/completion-readiness.md`. The root task reservation authorizes this narrow child scope; root owns central/lane status and integration.

## Implemented boundary

This is a retained **public engineering screen**, not a held-out benchmark, Q3 qualification, twelve-case completion, model competence, parity or H1 acceptance. S08/S09/S11/S12 remain explicitly unavailable. Source-only and pure checks are complete at this checkpoint; synthetic physical executions and fresh review remain pending.

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

Root currently owns the physical window for the frozen joined aggregate. Only after root releases that window, execute once:

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node evaluations/product/screen-driver.ts --synthetic /ABSOLUTE/EXTERNAL/NEW-SCREEN-REPORT.json
```

The CLI refuses overwrite and returns failure if any of the eight original case reports fails. Inspect each assessment, actual ledger/resources, payload/checkpoint binding, setup actor and unavailable cases. Separately run physical S02 `skip-failed-check` and S10 `fabricated-child` controls through `runSyntheticCase` and retain both full reports; they must remain `criterion-unmet`. Do not rerun a failed attempt to replace evidence. Any source fix is a newly frozen engineering revision with the original failed report retained.

Fresh independent reviewer `/root/a1_real_screen_review` owns `screen-review.test.ts` and `real-screen-review.md` in its separate worktree. It will inspect source/semantics and meaningful negative controls before accepting the bounded engineering result. Root owns integration, joined checks and any downstream live authority/qualification. Required physical cases are currently **not run**, and fresh disposition is pending.

## Source-review corrections before physical execution

Fresh reviewer identified exact weaknesses in a407a60: incorrect child input/receipt attribution, checker tamper/restoration, missing original allocation provenance and an ineffective combined evidence cap. Root also identified uncharged private verification and unauthenticated live seal strings. Corrections require the successful child command to be precisely double.mjs 7, execute identical frozen inline Node checker bytes from immutable effect arguments before/after repair, prohibit arbitrary commands and pre-failure edits, retain original allocation/budget records, and fail with an explicitly unavailable full witness if the 32 MB total evidence ceiling is exceeded. The same-store private command accounting and closed live gate above address the root findings. Original checkpoint evidence remains historical; revised strict/pure checks and reviewer disposition must be recorded before physical execution.

The mutable workspace checker is removed: S02 public setup contains only broken sum.mjs and test-command.json. Both required command receipts must match the complete frozen --input-type=module -e checker bytes. A candidate cannot rewrite an inline checker by changing workspace files, so final-file equality is no longer the checker-integrity basis. This avoids application/tool interface changes.
