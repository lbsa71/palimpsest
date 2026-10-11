# A1-L09 finite ordinary control tools and author continuation

Owner: `/root/a1_control_continuation`; branch `codex/a1-control-tools-20261011`; worktree `/home/palimpsest/migration/aeon-1-20261011/control-tools`; base `d1dc0c9`. Finite goal: implement ordinary scoped activation/status tools, durable local acknowledgement and bounded original-author hold/wake across control transfer, preserving resources, cancellation and uncertain outcomes. This contributes to A1-L09-T03/T05 under RW10, RW14, RW15, RW16 and RW19. It does not establish complete Aeon 1/H1 or live evaluation competence.

Exclusive child mutations: new `deployment/control-tools.ts` and test; narrow `ordinaryServiceTools` wiring in `evolution-mailbox.ts`; new application control continuation hooks; this evidence. Root owns supervisor dispatcher defaults, status summaries, provider/budget gates and the full physical cycle. The async evaluation author owns `evolution-continuation.ts`; this child read final acknowledgement fixes but did not edit that module.

`control_activate({changeId})` resolves only this run's exact scoped submitted change and its exact completed staged host receipt. It creates a stable activation identity from original run/change, retaining original submission/stage/proposal/audience/authority. Local enqueue, author watch and a content-addressed local return bound to the host tool effect commit together. The tool immediately returns a compact known status; it does not wait on or invent a probation judgment. `control_status({changeId})` reads the same exact binding and omits the frozen candidate, private allocation lineage and evaluator keys.

The host readiness predicate requires the exact successful local effect and exact settled effect-receiver reservation. It also waits for the producer run to leave `running`: a settled tool can precede the original author's final model response/checkpoint, and pre-reserving the last concurrency slot at that point would interrupt its remaining turn. The host-only supervisor activation seam remains independent when no ordinary acknowledgement exists.

The application preserves a completed author shell as checkpointed while its control watch waits. Pending or uncertain controls consume no automatic goal slices or repeated queued turns. Explicit human steering remains durable and eligible while queued; activation/probation keeps the physical slot held until the host outcome. Successor adoption keeps the same nonterminal run, goal provenance and allocation. Only a known accepted/rejected outcome wakes an eligible original scoped author once, under its current serving grant. Cancelled, completed, expired, foreign-scope or withdrawn authors never wake. Uncertain controls never wake automatically; explicit status inspection can end the watch without changing or retrying the host outcome.

Lost local returns and effect-success-before-ledger-settlement interruptions reconcile only an exact committed local acknowledgement and receiver identity. Reconciliation retains the maximum persisted usage, charged elapsed time and reservation ceiling when the original elapsed observation is missing. It touches no external reviewer reservation. Current host authority can settle a proven old local return without resurrecting terminal/cancelled author work.

## Evidence

Node `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`, v24.13.0; trusted development compiler closure linked in this isolated worktree. Commands:

```text
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test deployment/control-tools.test.ts deployment/control-continuation.test.ts deployment/evaluation-resources.test.ts
```

Observed: TypeScript passed; 27/27 tests passed, zero failures/skips/cancellations, about 8.6 seconds under concurrent host test load. Nine new tool cases exercise the real DurableRuntime/EffectJournal/ResourceLedger with synthetic already-staged host receipts; eight host continuation cases exercise actual tiny frozen successor/rescue processes and original-policy signed engineering proofs; ten resource cases exercise cancellation, preparation, uncertain usage and cross-process dispatch locks.

New cases cover exact pending local return; a finished receiver belonging to a still-running producer; unchanged allocation through successor adoption; reopened state and once-only current-authority steering; both lost-local-return and succeeded-effect/unsettled-ledger recovery; preserved unknown external reviewer records; mismatched payload/authority/receipt/reservation rejection; foreign proposal/scope/read binding rejection; terminal/cancelled/expired/uncertain/withdrawn author exclusion; zero repeated lifetime slices while pending; and known old local accounting settlement without cancelled-author revival. Ordinary activation uses an original concurrency-one fixture. The mixed local/external unknown-record fixtures declare two slots at their initial admission; they never change resource limits during recovery.

Development failures retained: the first TypeScript pass caught the compact artifact reference's incompatible `JsonValue` type; an explicit public URI/digest object fixed it. The first test compile referenced a nonexistent `Document.key`; it was corrected to the known request ID. No executed behavioral assertion was weakened. A temporary test draft that changed concurrency limits during recovery was replaced before execution with an explicitly declared initial fixture envelope; production code never changes allowances.

## Handoff and limits

Source `76bee9a` introduces tools and application hooks; `ef49038` adds the producer gate, exact acknowledgement recovery and nine focused tests. Root integrated the first source revision as `a838d76` and owns the actual dispatcher/supervisor default predicate and full ordinary cycle fixture. Root provider-absence commit `c8a0abc` was locally cherry-picked as `d6445c6`, resolving application hooks to preserve both gates; do not duplicate that already-owned root change when integrating the child. The final evidence commit is reported as the exact child handoff revision.

At this child handoff the full frozen ordinary service → staged control → activation → fresh external probation → accepted result cycle remains the root's pending heavy integration run. This child deliberately did not claim that test, installed takeover, production policy qualification, paid inference or H1. No paid calls, external sends, production install, new resource grant, terminal-author resurrection, automatic uncertain retry or rescue rotation occurred.

Downstream: integrate `ef49038` after the earlier source; freeze exact current source; run root's ordinary full physical cycle using its existing qualified reviewer/host fixtures and original finite allowances; inspect the actual adopted author state and fresh old-policy proof; obtain fresh consequential review before broader readiness claims.
