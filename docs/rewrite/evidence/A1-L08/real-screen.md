# Eight-case ordinary-application screen engineering handoff

Owner: `/root/a1_real_screen`, delegated by root for L02-T04/L08 at source `869f627`. Exclusive writes: new `evaluations/product/screen.ts`, `screen-driver.ts`, `screen.test.ts`, this evidence; the only existing-source change exports `artifactReader` and `observe` unchanged from `product/adapter.ts`. Worktree `/home/palimpsest/migration/aeon-1-20261011/real-screen`, branch `aeon1-real-screen-20261011`. Runtime, application, contracts, configuration, package manifests and the existing toy screen/reference actor remain unchanged.

Actual finite goal: implement and verify the finite S01–S07+S10 partial ordinary-application screen with real application observations, bounded provenance/resource reports, pure failure-path tests and a concrete handoff for independent review. Governing behavioral specification is the S01–S12 map and first-unit boundary in `docs/rewrite/evidence/A1-L09/completion-readiness.md`. The root task reservation authorizes this narrow child scope; root owns central/lane status and integration.

## Implemented boundary

This is a retained **public engineering screen**, not a held-out benchmark, Q3 qualification, twelve-case completion, model competence, parity or H1 acceptance. S08/S09/S11/S12 remain explicitly unavailable. Source-only and pure checks are complete at this checkpoint; synthetic physical executions and fresh review remain pending.

`publicWorkload` versions fixed public preparation for repository orientation, failed test/repair/verification, inclusive range edge handling, missing-path recovery, attributed corroboration, correction with uncertainty, reversible read/write/readback/restore, and sequential real accepted/rejected child artifacts with parent integration. `seedBeforeDispatch` uses ordinary synchronous `CommunicationsCore.receive`: all public file writes finish in the same JavaScript stack before its queued `onReady` can dispatch. It asserts no active prior work, no same-attempt replay and unchanged request count. It exposes no evaluator callback or new model tool. Preparation is separately labelled host evaluator activity; it is never counted as model work.

The screen waits to an ordinary terminal status under a finite deadline, retains ordered observation events bound to actual durable effects, parent/child workspace artifacts, real delegation rows/result artifacts, physical requests, transport records, final payload artifacts and checkpoints, plus case and original shared operating ledger usage. Unknown usage is preserved by the existing observer. Private checks run after application close; executable probes run in disposable confinement with private expected answers held in the host. The report retains payload/checkpoint bytes with their hashes, so fixture cleanup does not destroy the witness. Missing or unsafe files fail checks. Observation/child/request/artifact/probe/deadline bounds are explicit; there is no silent success from truncation.

Private packets must be canonical files within a canonical evaluator-private root disjoint from source, workspaces and operational state, and match the frozen task digest. Public rehearsal packets are explicitly public in `screen-driver.ts`; live private expected inputs must come from the external private root and are never seeded into the candidate source/workspace. A durable `screen-Snn-initial-N.json` receipt is created with exclusive creation before admission, so a failed initial attempt cannot be reset in that observer root. The application also retains an attempt row. The synthetic suite fixes one initial execution per case before execution, does not retry failures, and retains every case report.

Live has only `runHostAuthorizedLiveCase(options)`; no CLI credential/configuration discovery exists. It requires the existing host-issued authority/store, configuration/resources/secrets, kernel resource delegation, original ledger, isolation/calibration/grant seals and the real configured provider gateway. Fixture transport, extension tools, Slack and external research are refused. String seals do not self-authenticate independent qualification; that limitation is explicit. Host grant or private-root replacement remains the host integrity trust boundary, not authority created by this driver. External research competence is not established by local source comparisons.

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
