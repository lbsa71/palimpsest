# Deterministic selection of physical request bindings

Root finite fixture integration under the active Aeon 1 goal, base/claim `de92a74`, isolated `development-control-binding-integration`. Own only the three selector blocks specified in the execution record and this evidence. Production and every other prior test remain read-only.

```text
/goal Correct the three R4 author fixture selectors to mutate an actual represented physical request's binding, preserve all existing causal assertions and unrelated bytes, and supply exact evidence for the independent attribution repair review.
```

## Precode behavior

The unchanged R4 tests select `originalStore.list<RunBinding>('development.accounting.allocations')[0]`. These keys are hashes of registration, role and local ID. The registration contains the fixture's temporary paths/time, so key order is variable. Application construction includes an unused `initiative:ordinary` allocation, even in scripted roles. The production inventory validates actual request ancestry; mutating an unused binding does not exercise that path. Review `77ba11a` preserves one failure and a deterministic used/unused contrast. The exact binding of the historical failed run was not retained, and is not claimed here.

Three selectors have this defect: missing/aliased binding, the five attribution mutations, and the missing declared-after binding. Select a represented bridge request from `development.accounting.latest`, require its actual original physical row, and select the binding by that physical request's run ID. Keep all existing assertions, mutations, limits and restoration behavior unchanged. All bridge rows in these scripted fixtures correspond to actual represented work, so their ordering does not affect the predicate. Do not broaden production validation to irrelevant unused allocations to satisfy a defective selector.

Run the original three cases once and retain whichever results occur; never search for a favorable random order. Then run the corrected cases and strict. Compare the old and new source after replacing only the three selector blocks with a marker; exact equality must hold. A fresh reviewer must inspect this fixture adjustment separately from the R5 production repair. No aggregate, semantic, live or H1 qualification follows.

## Verification and handoff

Precode `9c5bcb3`. The unchanged three-case baseline passed 3/3 in 16.954s on this single run; `/tmp/aeon-binding-selector-baseline.log` retains the receipt. This does not erase the review's earlier failure or establish deterministic coverage. No repeated baseline was used. After replacing only the three selectors and adding actual-physical/binding-presence prerequisites, all three pass in 17.556s; `/tmp/aeon-binding-selector-corrected.log`. Zero skips, cancellations or failures in either run. Strict TypeScript and `git diff --check` pass.

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 --test-name-pattern='^inventory repair: (missing and aliased keyed run bindings refuse and exact restoration recovers|run role, registration, local identity, parent and envelope cannot change attribution|restored current binding cannot fill a missing declared after binding)$' evaluations/development/development-control-inventory-repair.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
```

A source comparison normalizes exactly three occurrences of the old selector and exactly three complete replacement blocks. The remaining byte strings are equal to `de92a74`, so every original refusal/restoration assertion and all other cases remain intact. No production code, limit, grant or mutation changed. Only this evidence and the named prior fixture differ from base. The unchanged R5 production failure remains open until the separate attribution repair is accepted. Root will supply this exact adjustment to its fresh reviewer.
