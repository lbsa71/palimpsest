# DC2 payload integrity independent review

Owner `/root/a1_development_control_payload_review`, 2026-10-12. Actual finite goal created. Isolated branch `codex/a1-development-control-payload-review-20261012`, base `4001212`, target author `55ac335` imported `51066f0`, source blob `64757b2382832f2620599004f9342b93e588cd6e`. Governing inputs: AGENTS, REQUIREMENTS, PLAN, workflow, A1-L08 and execution claim. Only this new evidence and `evaluations/development/development-control-payload-review.test.ts` are writable. Source, existing tests and moving sibling branches remain read-only.

## Independent criteria frozen before tests

1. A complete current original bridge value at the expected physical request key must equal the final transition from the declared original after cut. A matching embedded request ID under another key must not substitute for that row; altered role identity must not hide a changed required row behind role filtering.
2. Actual supported Store deletion, insertion, value replacement and exact restoration must be observed through newly captured current pages. Missing required keyed state and key/request permutations must refuse both aggregate derivation and script inspection. Restoration may advance journal revisions and must recover the original interval/executions/transitions without requiring current=after.
3. Additional current bridge rows for the represented role, including duplicate embedded request IDs, must not silently expand or corrupt the accepted physical inventory. Authentic unrelated rows and other-role journal activity should not invalidate the represented role merely because current is later. Distinguish identity facts from document revisions.
4. Actual later unknown physical work must refuse a completed old proof even where the declared after cut is complete. Complete later current cannot fill missing declared role or original after-cut endpoints. Preserve original R3, after-cut and physical-inventory assertions unchanged.
5. Preserve operational callback limits, native returned-length checks before copy, receiver/callback semantics, and metadata/proof ceilings by source comparison and selected existing causal regressions. Do not rerun all47 without a causal reason.
6. New cases use explicit environmental adapters and controlled real Store/application seams, with no new module/global mocks. Script-only execution forbids provider dispatch. Existing ambient Store/application coupling remains the separate DI workstream. Pinned Node24.13.0, existing root node_modules symlink, serial targeted checks and strict TypeScript; no install, physical/native/provider/network/private credentials/Slack/full benchmark/push/deploy.

The finite result is bounded accepted-or-changes-required evidence, exact two-path clean handoff and a completed goal. Semantic signing, actual workload/checker qualification, broader DI and H1 remain open. Recorder/runtime/memory sibling work is neither imported nor accepted here.

## Disposition: changes required — R4 original physical inventory is not complete

The targeted R3 repair is correct in the tested scope. Complete current state is compared at the expected row key with the final declared transition. New relocation/deletion, swapped-key and role-filtered alias probes cannot substitute a matching embedded request for that row. Duplicate same-role current identities refuse. Exact restoration, application reopen, identical-value revision advance and unrelated later journal writes preserve the original source evidence, executions and interval. Actual later unknown local/original emission refuses with both original and role after cuts fixed, including after reopen without another request.

**R4 (high priority): an unbridged original physical request under a represented role/run is omitted.** The new test begins with a completed six-request script control. Through the injected controlled-real original `ResourceLedger`, it reserves, marks dispatched and settles uncertain a seventh request under an existing represented original run. Its ID uses the canonical development-request mapping; the persisted `development.accounting.allocations` row independently attributes that run to this control role. No SQL, forged reader, altered capture, changed prior transition or actual receiver/provider dispatch is used. The six bridge rows remain unchanged. The original after capture stays fixed; only an authenticated later current capture advances.

`prepare` at `evaluations/development/development-control-proof.ts:162` derives its current original inventory solely from `development.accounting.latest` rows filtered by role. The later request has no such row. Its checks of current original `requests` at lines176–180 visit only the six expected local request keys. Thus the seventh uncertain physical request is never inspected. Aggregate derivation incorrectly returns `derived` / `acquisition: completed` (validity remains unavailable), and script inspection also derives. This is a completeness gap in the existing inventory logic, not a regression introduced by the two-line R3 repair.

The actual `DevelopmentAccounting.checkInventory` rule at `deployment/development-accounting.ts:122` already refuses unobserved physical requests under the original root. The test additionally attempts an ordinary allocation through `f.app.resources` and requires that exact existing refusal, `Unobserved or changed original physical request`. This confirms that the same live accounting source is inadmissible while the proof helper accepts it.

Required next repair: independently enumerate the relevant actual original physical request inventory and bind every represented-role request to its keyed bridge/transition identity. Missing, unknown or untracked applicable physical work cannot disappear because its bridge row is missing or changes role. Preserve correctly scoped other-role activity, original anchors, legitimate later journal replay, declared after endpoints and all existing resource/operational bounds. Do not solve this by requiring current=after or accepting a caller's completeness assertion. Root must assign finite production ownership and a fresh review; this reviewer makes no source repair and does not wait for it.

## Evidence and scope

Precode criteria: `2765c42d69108d3843988b7fa282cf0f795cf984`. The new fixture copies only controlled-real adapter setup from frozen author `55ac335`; all review assertions are new. Environmental ports inject temporary filesystem lifecycle, file identity, host configuration, wall time, Store/authority/raw-store/application factories and retained artifact readers. No new module/global mocks or environmental monkeypatches were added. Script-only provider callbacks throw if reached. Existing ambient Store journal IDs, authority/application lifecycle clocks and database internals remain the separate DI workstream; these tests do not establish whole-environment injection.

The first six-case run passed **6/6**, zero skips/cancellations, **33.349s**. An additional targeted supported-resource probe preserved the R4 red: **0/1**, **5.710s**, exit one, against the same frozen production source. The final test strengthens attribution with the canonical ID, explicit original allocation-role check, live accounting refusal and both aggregate/case outcomes. Initial strict checking found one review-helper-only TypeScript assertion-narrowing error; removing the redundant discriminant check fixed it without changing the runtime assertion.

Selected unchanged prior predicates pass **9/9**, zero failures/skips/cancellations, **43.274s**. Selection covers original independent R3; original/local current physical mutations; missing declared role/original endpoints; captured method receivers and detached raw callbacks; nonnative returns without traps; native indexed overrun before copying; indexed operational/configuration source-pool bounds; smaller source bounds; and exact proof capacity. Old global/module instrumentation remains unchanged regression evidence only. A redundant full47 run was unnecessary: static comparison of author source with its parent shows exactly the current keyed lookup and complete-state equality change, leaving after-cut, physical-inventory, operational-read, metadata and proof predicates untouched. All original tests and source files remain byte-identical to base.

### Reproducible commands

Run in `/home/palimpsest/migration/aeon-1-20261011/development-control-payload-review`; pinned Node `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`, ignored `node_modules` symlink to `/home/palimpsest/src/palimpsest/node_modules`, no install.

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 evaluations/development/development-control-payload-review.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 --test-name-pattern='unknown original physical work' evaluations/development/development-control-payload-review.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 --experimental-test-module-mocks --test-name-pattern='later original bridge payload mutation|later original and local physical mutations|captured methods retain|original responses and captured receipts|indexed-size reply overrun|partial declared cuts|every operational alias|smaller source limits|selector getters' evaluations/development/development-control-proof.test.ts evaluations/development/development-control-proof-repair.test.ts evaluations/development/development-control-proof-rereview.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
git diff --check 4001212
git diff --name-only 4001212
git hash-object evaluations/development/development-control-proof.ts
```

The first command is used once for the initial six-case checkpoint and once for the final seven-case checkpoint after the meaningful added inventory probe and attribution assertions. No old regression is repeated without cause.

## Final receipts and finite handoff

Exact tested checkpoint: `8d4d528`; test blob `3c11aad4f567e754b2edb57d848c41946c2b3d75`. Final new run: **6 pass / 1 fail**, zero skips/cancellations, **42.743s**, exit one. The only failure is R4; its diagnostic confirms aggregate `derived/completed`, case `derived`, seven original physical requests and six bridge rows. The original accounting guard refusal and run-role attribution assertions pass before that failure. Selected old regressions remain9/9; combined bounded disposition is15pass/1preservedfailure, not overall acceptance.

Final strict TypeScript passes, exit zero and empty output. Final staged diff caught one trailing blank line in the newly added test; removing only that line yields final test blob `02b89364d108f9d5afd52013d17607174f4a0ac6`, with all tested statements unchanged. Final diff check passes. Source remains blob `64757b2382832f2620599004f9342b93e588cd6e`; base lockfile remains `2ad06e16bdfd028eb7643e5a9020685aceacc74b`. The old-test/production diff is empty. Exactly the two reserved new paths differ from `4001212`. The final clean two-path handoff squashes the precode/tested checkpoints onto the base with that whitespace-only cleanup; its exact revision is returned to root. Precode and tested commits retain the chronological evidence.

All logs contain synthetic fixture data only:

| Receipt | SHA-256 |
|---|---|
| `/tmp/a1-dc2-payload-review-new.log` — initial6/6 | `9ecfd75466e1fae85d9d408d63fbd239a813977b7365b482f87438b4a6399dc5` |
| `/tmp/a1-dc2-payload-review-unbridged.log` — initial R4 red | `e803f9c9b2d7f7df60b4d42b4a768777b6779c10ede2b78d4dc9d5194346c813` |
| `/tmp/a1-dc2-payload-review-prior.log` — unchanged9/9 | `1245fbaf2d5f8644efdffb19caf9fe1f1b5958c47afe94180418dda563fa2873` |
| `/tmp/a1-dc2-payload-review-final.log` — final6/7 | `cbcc7b294f4d55ae0992cf90467df1bc4a69b0580a0a2d8d3e8ce46425616ff9` |
| `/tmp/a1-dc2-payload-review-strict-initial.log` — corrected review typing error | `773333f930508c3129133b5e42efb70f8211f6fc9a767a3ba46c472b713af048` |
| `/tmp/a1-dc2-payload-review-strict-final.log` — strict pass | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

The finite independent review completes with **changes required**. Root receives exact reproduction and production repair entry criteria. No source was changed, no moving sibling work imported, and no repair/review wait loop remains. Actual semantic signing, checker/workload qualification, source-admission recorder acceptance, broader DI, parity and H1 remain open.
