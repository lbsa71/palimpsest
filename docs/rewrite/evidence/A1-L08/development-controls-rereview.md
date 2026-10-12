# DC1-R1 fresh independent repair review

Status: acceptance criteria frozen before tests. Reviewed production source is exactly `d4be23ebb524a4ecb7dbf1ef21268fd19841b1cc`; repair specification `931f271`, original independent review `2efc20f`, root claim `d81415c`. This finite A1-L08 review owns only this document and, if useful, new `deployment/development-controls-rereview.test.ts` in branch `codex/a1-development-controls-rereview-20261012`. Production and every existing test are read-only. Routing is fresh consequential review under the inherited model/effort; no further agents are needed.

Actual tool goal: independently review the exact repaired source, freeze causal criteria, retain failures, and return a clean bounded engineering disposition without waiting for another repair. Requirements RW04, RW09–10, RW16, RW18–20 and the adopted development-control design govern.

## Frozen criteria

1. Reproduce the original two retained-options payload leak triggers using their unchanged independent tests. After constructor admission, neither property replacement nor getter switching may admit a previously absent Store-reading extension into actual no-memory model payloads.
2. Inspect every declared ApplicationOptions field and every constructor/instance consumer. Each accepted property value, including inherited and non-enumerable getters, must be read once into the same detached immutable shallow record. Preserve original service and callback identities, supported shared secret references and ordinary dynamic invocation of an accepted extension. Do not infer protection against arbitrary behavior inside a trusted accepted callback.
3. Inspect and exercise actual parent, task child, initiative, consolidation and restart/recovery paths as relevant to the captured options. They must use the accepted references and preserve original current task/effect/request state. Explicit profiles must still reject an extension present at admission; ordinary non-evaluation extensions must remain functional.
4. New reviewer cases must add causal evidence beyond simply copying author cases: target complete option capture and accessor representation, or an uncovered genuine path. Reuse fixture plumbing only with attribution. Existing author and independent checks remain supplementary/retained evidence, with no changed assertions, grants, ceilings or source.
5. Run focused in-process SQLite/module-mocked worker checks and strict compilation with the pinned Node 24.13.0 runtime. Record exact commands/results, initial fixture or production failures, and byte-unchanged existing tests. A residual causal defect yields changes required; otherwise accept only this bounded R1 engineering repair.

## Scope and limits

No physical worker/native process, provider request, network, private credentials, Slack, publication or deployment. Module mocks exercise actual local application, Pi, SQLite and accounting paths without establishing physical isolation. CP1 marker/hook integration and later joined JR3/DC3 review remain separate; DC2 proof completeness, private checker competence, workload/semantic control validity, live development, parity and H1 remain unavailable from this review. No-memory retains explicit operational mediators and is not statelessness. No arbitrary accepted-host-callback threat model is introduced.

## Exact-source disposition: accepted bounded engineering repair

Criteria commit: `d58cdbbb7857180b1f9a1d67f75ead55abd5826c`. Production remains exactly `d4be23ebb524a4ecb7dbf1ef21268fd19841b1cc`. The two original DC1-R1 no-memory descriptor leaks now pass their unchanged captured-payload predicates. No residual R1 defect was found. This supersedes the R1 changes-required disposition for this repaired source only; the original [review and failures](development-controls-review.md) remain unchanged historical evidence.

The five new reviewer cases are causal additions, with fixture/worker plumbing explicitly attributed to the existing composition test. Both own and inherited non-enumerable representations supply all eleven declared options through getters that reject a second read. Every caller property is then poisoned. Actual parent and task-child requests, health reads, close and same-mode reopen succeed using the accepted snapshot; the original request identities remain. The caller-provided real SQLite ProcessLease remains held after application close, preserving ownership. Mutating the accepted secrets object's key changes the local credential-availability check and restoring it restores availability, demonstrating the intended shared-reference semantics without any network access. All eleven captured values retain identity, including distinct Slack API sentinels, the accounting factory and transport callback. The Slack sentinels are never invoked; this is option-binding evidence, not Slack transport qualification.

Two further cases admit a non-enumerable extension, once own and once inherited: construction rejects before the accounting factory, extension invocation or model transport, with zero original requests. The fifth case creates and accepts a real current-input-grounded goal, observes an actual scheduler initiative request, and verifies that replacement of both caller transport and Store-reading extension after construction affects neither its transport nor descriptor bytes. Explicit post-seal historical corruption supplies the same secret as the attributed fixture; no-memory excludes it while the current goal remains present. This is a synthetic mediation check, never fresh acquisition or semantic transfer evidence.

## Source inspection and retained comparisons

The `ApplicationOptions` interface declares exactly `config`, `secrets`, `authority`, `authorityStore`, `performRequest`, `slackBotApi`, `slackAppApi`, `lease`, `developmentAccounting`, `documentJournal`, and `additionalTools`. Constructor lines 75–77 read each once through ordinary property lookup, so inherited/non-enumerable values are included; the result is a detached shallow frozen record. The new test inventory uses `Record<keyof ApplicationOptions, unknown>` so adding another declared field requires updating this review fixture. No undeclared properties are copied.

| Consumer inspected at repaired source | Binding consequence and evidence |
|---|---|
| Constructor admission, Store/journal, authority, lease and accounting, lines 78–100 | Validation/extension refusal and bridge construction use the detached record. Configuration retains its existing validation/detachment behavior. Actual service references are preserved. New complete-inventory and rejection cases exercise this path. |
| Speech/extension receivers and delegation callbacks, lines 101–186 | Closures capture the reassigned local options record. Extension dispatch resolves `mindTools` afresh against the same accepted callback. Unchanged ordinary extension test executes a real Store mutation and checks actual callback context; promise/delivery and receiver-replay comparisons pass. |
| Shared shell closure, lines 187–210 | Every ordinary parent, child, initiative, obligation and consolidation run uses the captured transport; credential fallback reads the accepted secrets reference. Actual no-memory parent/child and new initiative probes confirm request entry after caller replacement. |
| Runtime/communications/initiative/bootstrap/recovery, lines 211–240 and later instance methods | Authority and other constructor values use the same snapshot; instance reads use `this.options`. Existing all-profile absence/reopen tests and interrupted-current-conversation recovery tests retain original speech receipts and uncertain requests. |
| `mindTools`, lines 284–304; `providerAvailable`, `health`, `deliverObligation`, `close` | Later instance reads use the snapshot. Children return no mind descriptors; consolidation returns its assigned tools; other ordinary runs invoke the accepted extension at each descriptor/dispatch evaluation. New poisoned-caller/lease/secret cases exercise the later reads. |
| `AccountedConsolidation` and `InitiativeRunner` | Both receive accepted authority/runtime/context references. Consolidation uses the shared runtime shell; no-memory denies it before broker entry. Initiative constructs its admitted frame through the bound context hook and executes through that same runtime. Existing ordinary/no-goals consolidation positives and no-memory denial pass; the new initiative test directly covers late transport/extension replacement. |

The unchanged twenty prior independent cases continue to pass, including both original leak triggers. The unchanged thirty-four original authored cases and eleven authored repair cases also pass. These retained comparisons cover all six profiles, actual ordinary extension execution, parent/child/initiative/compaction/consolidation payloads, direct/replayed receiver denials, ancestry, scripts with real local receipts, original grants, default lived-state retention and interrupted conversation recovery. They are supplementary evidence, not relabelled as five new independently authored cases.

The capture is intentionally shallow. Trusted callback identities and service references remain usable and may retain their intended mutable internal state. The repair promises stable top-level option selection; it does not promise to constrain arbitrary behavior within an accepted callback, cryptographically defend host objects, or change the adopted threat model.

## Commands and observed results

Run from the isolated review worktree, using pinned Node 24.13.0:

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --experimental-test-module-mocks --test --test-concurrency=1 deployment/development-controls-rereview.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --experimental-test-module-mocks --test --test-concurrency=1 deployment/development-controls.test.ts deployment/development-controls-composition.test.ts deployment/development-controls-review.test.ts deployment/development-controls-rereview.test.ts
git diff --check
git diff d4be23ebb524a4ecb7dbf1ef21268fd19841b1cc -- deployment/application.ts deployment/development-controls.test.ts deployment/development-controls-composition.test.ts deployment/development-controls-review.test.ts deployment/application.test.ts
```

- New independent cases: **5/5 passed**, zero failed/cancelled/skipped/todo, 1.753 seconds. First run passed; no initial fixture or source failure occurred.
- Strict compilation: exit 0, no diagnostics.
- Joined focused suite: **70/70 passed**, zero failed/cancelled/skipped/todo, 23.875 seconds; exit 0. Composition is 34 original authored + 11 authored repair + 20 unchanged original independent + 5 new independent cases.
- Whitespace validation passed; the listed source and every existing test remain byte-unchanged. The final changed-path inventory contains only the two reserved new review files. Terminal output was retained during review in `/tmp/dc1-rereview-new-results.txt` and `/tmp/dc1-rereview-joined-results.txt`; these temporary files are not durable evidence dependencies.

## Finite handoff

The finite review is complete with **accepted bounded DC1-R1 engineering repair**. Root may integrate this evidence and the five new tests together with the exact repaired source. Root owns the current execution/lane status and exact later source join. CP1 marker/hook integration, JR3/DC3 joined review, OD1 matching/physical workspace isolation, DC2 proof/capture completeness, private checker competence and semantic control validity remain separate. This review ran no physical worker/native/provider/network/private-credential/Slack/publication/deployment acquisition and establishes no live development, parity, autonomy or H1.
