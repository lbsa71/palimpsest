# DC2 R4 original physical inventory repair

2026-10-12. Owner `/root/a1_development_control_inventory_repair`; branch `codex/a1-development-control-inventory-repair-20261012`, base `3d0ff87`. Actual finite tool goal preceded inspection. Exclusive writes: `evaluations/development/development-control-proof.ts`, NEW `evaluations/development/development-control-inventory-repair.test.ts`, and this evidence. Requirements, plan, workflow, A1-L08 lane and exact execution claim read. All earlier tests and other source remain read-only. Fresh independent acceptance remains required.

## Source criteria frozen before code

1. `ResourceLedger.reserve` writes every actual original physical request to `requests`, with its root and run; dispatched/settle advance that same record. Bridge absence cannot exclude it. Enumerate actual requests independently at both declared original after and authenticated current cuts.
2. Attribute represented-role work from actual `allocations` ancestry rooted in the accepted registration root and role allocation, independently of `development.accounting.latest.roleId`. For every role descendant authenticate the keyed `development.accounting.allocations` value: accepted registration digest, role identity, canonical mapped run from local ID, exact parent mapping and actual envelope. Missing or altered binding, alias substitution, changed run/role lineage and key/request identity must refuse. Expected request IDs cannot escape these checks by moving to another role.
3. The represented actual inventory at each cut must equal the canonical IDs mapped from the complete local declared after inventory. Every required physical row must bind to its exact keyed bridge state and final declared transition; existing immutable request/transition chain and local settlement checks remain. Extra failed/succeeded requests fail completeness; extra reserved/dispatched/uncertain requests make settlement unavailable. A complete current cut cannot replace a missing declared after endpoint.
4. Preserve authentic unrelated other-role work, root/role anchors, later journal activity and exact restoration with newer revisions. Current may be later than after; no equality shortcut or caller completeness assertion is introduced. Preserve existing callback/native-byte/metadata/proof bounds and method receiver behavior; inventories reuse already bounded captured rows without new environmental reads.
5. Reproduce unchanged reviewer R4 before mutation. New controlled-real fixtures use explicit filesystem/time/configuration/store/application/artifact-reader ports from the reviewer pattern, supported ledger operations, and no global/module mocks. Freeze cases for extra failed/succeeded/uncertain work at after and later current; role binding deletion/alias/value corruption; canonical run/parent/root attribution; valid unrelated other-role work; expected request identity/root mutation; restoration and later replay.
6. Run unchanged payload7 plus selected original endpoint/physical/bounded-reader regressions, new causal cases, strict TypeScript and diff checks serially on pinned Node24.13.0 with existing dependencies and concurrency1. Preserve all failures; do not edit prior tests or run the huge47 without causal need. No physical/native/provider/network/private credentials/Slack/full benchmark/push/deploy.

Finite output: exact clean three-path authored handoff with commands, results, remaining gates and completed goal. This is source repair and fixture evidence only; semantic development, workload/checker qualification and H1 remain open.

## Repair and preserved failures

Precode commit `53c5e9c86be706a644c0bcce0153c911d295867b` freezes the criteria above. Before any production change, the unchanged reviewer `unknown original physical work` case fails **0/1**, exit one, **5.048s**: aggregate derives/completes and case derives with seven actual requests but six bridge rows. Its live accounting refusal and authentic run-role binding assertions pass. A new supported-ledger successful extra request at a complete declared after cut also fails **0/1**, exit one, **5.155s**, because both proof paths accept it. These synthetic diagnostic logs remain preserved; neither prior test nor its assertion was changed.

Source/test checkpoint `775b24f` adds an independent inventory traversal over the already bounded original after and current physical rows. Actual allocation ancestry attributes requests to the accepted role; each descendant's exact keyed binding must name the accepted registration and role, map its local ID canonically to the original run, and match its actual parent and envelope. Expected physical IDs cannot escape attribution by changing run, key or root fields. A claimed foreign root also cannot hide extra work when the actual allocation still belongs to the original root.

Each complete actual inventory must exactly equal the canonical request IDs mapped from the local after cut. Extra uncertain/reserved/dispatched requests refuse settlement as unavailable; extra completed failed/successful requests fail inventory completeness. Existing exact keyed bridge/final-transition equality, immutable local/original identity, transition chain and settlement checks remain required. Bridge-row role filtering remains an additional integrity predicate, rather than the source of completeness. Both actual after and actual current are enumerated: newer current cannot supply a missing after binding or endpoint.

The traversal uses no new source/environment reads, callbacks or caller assertions. It builds allocation/binding indexes from metadata already admitted by `sourceInventory`, with at most32 ancestry links per physical request. Existing current availability checks, accepted root/mode/grant checks, complete assignment coverage, operational reader limits, native returned-length-before-copy checks, captured receiver semantics, proof capacity and final-use fences are unchanged. Later journals and value restoration can advance revisions without changing the original interval/executions/source evidence. Authenticated different-role work remains outside this role's settlement denominator, including supported script success and a separately tracked uncertain request.

## Controlled-real causal evidence

New fixture setup reuses the unchanged payload review's explicit environmental ports: temporary filesystem lifecycle and file identity, host application/node configuration, wall clock, Store/authority/raw-store/application factories and retained artifact readers. The new other-role app uses those same factories and actual accounting composition. Extra unbridged requests use supported `ResourceLedger.reserve`, `dispatched` and `settle`; identity/alias/root/binding adversaries use supported Store mutations and newly captured complete pages. No SQL, forged reader/capture, global/module mock or provider dispatch is added. Existing production/fixture environmental internals are not requalified by this repair; broader DI closure remains separately owned.

Initial new causal checkpoint passes **12/12**, zero failures/skips/cancellations, **64.998s**. Before the final run, source attribution was tightened for changed extra root fields, the unrelated-role case gained a real tracked uncertain request, and a complete-current/missing-after-binding case was added. Those changes justify the final new-suite rerun; unchanged large47 was not repeated.

The unchanged payload review now passes **7/7**, zero failures/skips/cancellations, **40.561s**. Selected unchanged original endpoint/physical/bounded-reader regressions pass **11/11**, zero failures/skips/cancellations, **52.088s**. Selection includes the prior nine predicates plus actual later successful work and legitimate later-current replay, directly affected by the new enumeration. Existing module mocking in those read-only historical tests remains their regression mechanism; none is introduced in the new fixture.

### Reproducible commands

Worktree `/home/palimpsest/migration/aeon-1-20261011/development-control-inventory-repair`; pinned Node24.13.0, existing ignored root `node_modules` symlink, no installation. Commands run serially, test concurrency1.

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 --test-name-pattern='unknown original physical work' evaluations/development/development-control-payload-review.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 --test-name-pattern='unbridged succeeded physical work is visible at after' evaluations/development/development-control-inventory-repair.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 evaluations/development/development-control-inventory-repair.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 evaluations/development/development-control-payload-review.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 --experimental-test-module-mocks --test-name-pattern='later original bridge payload mutation|later original and local physical mutations|later successful work|later current carries|captured methods retain|original responses and captured receipts|indexed-size reply overrun|partial declared cuts|every operational alias|smaller source limits|selector getters' evaluations/development/development-control-proof.test.ts evaluations/development/development-control-proof-repair.test.ts evaluations/development/development-control-proof-rereview.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
git diff --check 3d0ff87
git diff --name-only 3d0ff87
git hash-object evaluations/development/development-control-proof.ts evaluations/development/development-control-inventory-repair.test.ts package-lock.json
```

The first two commands are preserved pre-repair reds; their final post-repair counterparts belong to the full unchanged review and new suite. The new-suite command ran once at12 cases and once at final14 after the concrete coverage/source refinements above. All other verification ran once on the repaired source.

## Final receipts and handoff

Final new causal suite passes **14/14**, zero failures/skips/cancellations, **64.460s**. Combined final behavioral disposition is **32/32**: new14 + unchanged payload7 + selected prior11. The earlier R4 and new successful-request reds remain preserved as defects reproduced before repair.

The first strict invocation could not start: this worktree lacked the expected ignored `node_modules` symlink. Restoring only that link to `/home/palimpsest/src/palimpsest/node_modules` used existing dependencies, with no installation. The next strict run found one new helper-only TS7022 inference error in the ancestry loop. Adding the explicit `Allocation` annotation corrects it; final whole-tree strict TypeScript passes, exit zero and empty output, with no unrelated conflict or prior-test edit.

That annotation is the only source change after behavioral tests. A Node `stripTypeScriptTypes(..., { mode: 'transform' })` comparison proves identical emitted executable source to tested `775b24f`. The initial verification-script comparison used default strip mode, which preserves source columns and therefore reported an expected whitespace difference at the added type annotation; its diagnostic is also preserved. Correcting the verification mode yields exact equality, so no repeated runtime suite is warranted by the type-only correction.

Final production blob: `69d6396210c1c97f5ee3f839ea0ecae3e433d575`; tested executable source blob before annotation: `1d4f20b9a0c5908311634a90a57627d30d37957d`. Final test blob: `c9595cbe0020ba616eda7ec258e3261d568674e1`. Base lockfile remains `2ad06e16bdfd028eb7643e5a9020685aceacc74b`. `git diff --check 3d0ff87` passes. Exactly the three reserved paths differ; all prior tests and other source stay byte-identical to base. The final clean three-path commit squashes authored checkpoints onto the base; its exact revision is returned to root. Precode/tested objects and logs preserve chronology.

All receipts contain synthetic fixture data only:

| Receipt | SHA-256 |
|---|---|
| `/tmp/a1-dc2-inventory-baseline.log` — unchanged R4 red0/1 | `b8eb41a1b4e90454a17d5b4a64b0afe01dcc3edae72a86d23e3c57710ba548f5` |
| `/tmp/a1-dc2-inventory-new-red.log` — new successful-after red0/1 | `fe9d02a4184e5f39c63cb57d82dddf8b71d99ea1b11e52b70203840f26578ab3` |
| `/tmp/a1-dc2-inventory-new.log` — initial12/12 | `f6df91c227304f14b063389736f9ece0b84b8e3f6ff958046d3ea5ccac01e4e1` |
| `/tmp/a1-dc2-inventory-payload.log` — unchanged7/7 | `4e6330cb5f34bd2d9bcda2fd00560714d1dc3995b77b90d1569ac23d6eb1ec2e` |
| `/tmp/a1-dc2-inventory-prior.log` — selected11/11 | `daeee66a34cd5b01aaa2535caff105b6ce4ce80b790b6ec41e125be508161f49` |
| `/tmp/a1-dc2-inventory-new-final.log` — final14/14 | `8a2cb8af237f4c2bf9f06a3165f913c58ae56aba33eecb0c4173bcbee656f707` |
| `/tmp/a1-dc2-inventory-strict.log` — initial missing-link setup failure | `c4efeefb20b12a59875e1c8725b31d1f27828e4e39cf04a8e4418470944c6a23` |
| `/tmp/a1-dc2-inventory-strict-final.log` — corrected TS7022 | `e6fd256f87df97d8d01eda9faeb41a62329b23e295bfb6c9e5dc8af667e133ac` |
| `/tmp/a1-dc2-inventory-strict-passed.log` — final strict pass | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `/tmp/a1-dc2-inventory-erased-source-initial.log` — verification mode corrected | `52acaa7cd6286d96001f7ed22f122350c93507095fc58b9330afa07834662b3d` |
| `/tmp/a1-dc2-inventory-erased-source-final.log` — identical executable source | `a8b17a92d25d0dcb4c3268729c9d44df001fae3d9630830423997ce741c1cc84` |

This finite author repair completes with fixture-verified source and an exact handoff. Fresh independent review/acceptance remains required before DC2 adoption. Root owns integration and planning status. No source signer/recorder, semantic development, actual workload/checker qualification, broader DI closure, parity, H1 or deployment gate is closed. No review wait loop or external operation was performed.
