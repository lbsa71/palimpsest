# A1 consequential core review — 2026-10-11

Status: **fixture-verified and integrated against the frozen base**. This finite review is complete; it does not accept A1-L02, A1-L03, A1-L09, live competence, deployment, or Aeon 1 as a whole.

## Claim and finite task

Owner: `/root/a1_core_review`, fresh review context. Branch/worktree: `codex/a1-core-review-20261011`, `/home/palimpsest/migration/aeon-1-20261011/core-review`. Reviewed base: `c410bb4`. Contract: `aeon1.c1.v1`. Requirements: RW02, RW04, RW10, RW15, RW16, RW19. Parent owns integration and acceptance.

```text
/goal Independently review and repair consequential core defects in frozen Aeon1 c410bb4 within the assigned runtime/effects/shell/broker paths, preserve reproducible regression evidence, and hand off exact commits and residual limits.
```

| Task | Inputs and ownership | Acceptance and result |
|---|---|---|
| CR01 | Frozen source, requirements/workflow, architecture, L02/L03/L09; read authority, recovery, resources, shell and worker protocol boundaries | Consequential failures reproduced, with severity and dispatch/accounting implications distinguished below |
| CR02 | Exclusive writes: `packages/runtime/**`, `packages/effects/**`, shell adapter and corresponding tests, `deployment/broker-shell.ts` and its test | Repair each reproduced core failure without retrying uncertain effects or erasing unknown usage; actual child-process SIGKILL and isolated broker regressions pass |
| CR03 | `docs/rewrite/evidence/core-review/**`; no root configuration/vendor/dependency edits | Preserve failing frozen-base results, passing exact implementation results, limits and integration handoff |

The parent explicitly assigned this review and later included safe undispatched-effect adoption plus removal of TypeBox builders in owned tests. No children were spawned: the parent's useful concurrency slots were occupied. All execution was local with synthetic providers and disposable state. No live inference, messages, publication, push, credential access or old-service restart was performed.

## Findings and dispositions

| ID / severity | Reproduced before behavior | Repair and evidence |
|---|---|---|
| CR-F01 / P1 | A checkpoint ending in assistant `error`, `aborted` or `length` was passed back to Pi's continuation API, which rejects a last assistant message. Every explicit resume stayed blocked without a new request. A checkpoint saved after a successful final assistant but before terminal status had the same dead end. | Keep incomplete assistant turns and synthetic results in durable audit snapshots while projecting them out of continuation requests. A retained final `stop` with no new input completes without another paid request. Four failed-turn variants plus the interrupted-final case are covered. Original request records/usage remain identical. |
| CR-F02 / P1 | A length-truncated tool call generated a synthetic error result and automatically caused Pi to make another physical model request, despite the first turn being incomplete. | End the turn on `length`, return blocked, and require explicit continuation. The regression proves exactly one initial physical request and zero tool effects; explicit continuation makes one new accounted request. |
| CR-F03 / P1 | `DurableRuntime.resume` accepted newly invented shell observations into the authoritative observation store and accepted any readable artifact as a returned checkpoint receipt. | Returned observations must exactly equal already issued durable receiver observations. Returned checkpoints must equal the current run's issued receipt, allowing its current run revision. Separate invented-observation and substituted-checkpoint cases fail on the frozen base and pass after repair. |
| CR-F04 / P1 | An isolated worker could attach the legitimate fragment inventory to a payload containing different system instructions or different tools. Hash capture alone bound the worker's bytes, not those bytes to the host-owned instruction inventory. | Broker checks the exact host-selected fragment inventory, ordered system layer, tools, payload digest and allowed provider options before forwarding capture/reservation. Normal and compaction paths run through a real isolated Pi worker. Hostile system/manifest/tools cases reproduce the gap. The digest case additionally checks broker defense in depth: the original durable runtime already rejected bad hashes. |
| CR-F05 / P1 | After an actual provider reply, a worker could omit `settle` or exit and leave the durable request marked dispatched with conservative charges, despite the host holding trusted final usage. | Host settles its trusted receipt before delivering the reply; a worker settlement becomes advisory/idempotent. On worker exit the broker drains tracked provider work and settles retained reservations. Skip-settle and real worker-exit cases retain exact trusted tokens/cost. Provider failures/absent usage retain uncertainty/conservative accounting. |
| CR-F06 / P1 | Public `EffectJournal.reconcile` and `recordReconciliation` accepted a withdrawn authority and could turn an uncertain effect into success. | Fence explicit reconciliation admission against current authority. Trusted late receipts from a dispatch admitted before withdrawal still use the internal evidence transition. Tests prove stale rejection, current-generation reconciliation and retained late-receipt behavior. |
| CR-F07 / P1 | Explicit run adoption changed the run grant but left pending/authorized effects on the prior grant, so recovery could not dispatch them. A crash after resource dispatch but before effect dispatch additionally left an authorized effect with an unusable uncertain request reservation. | Adoption explicitly reauthorizes only pending/authorized intents, preserves identity/payload and earlier authority events, and records `reauthorized-undispatched`. Recovery repairs only reservations backed by authoritative still-authorized effect intent; existing charges remain. Resource and effect dispatch markers now commit atomically before receiver entry. Three actual SIGKILL/reopen cases cover pending, authorized and the old split-marker gap; a failure injected after the resource mutation proves both markers roll back together. Actual dispatched/uncertain effects retain the original authority and never automatically replay. |

Resource review also inspected allocation lineage, sibling/descendant cancellation, shared root ceilings, narrow intermediate grants, dispatch deadlines and unknown usage across reopen. Existing regressions pass; no additional descendant-ceiling bypass was established. No speculative resource-policy relaxation was introduced.

## Exact code and validation

Implementation and regression commit: **`31fafaea32113290d7931c69523eddcf0c50bca3`**. It changes only the assigned source/test paths. All four owned tests that used TypeBox builders now use ordinary JSON schemas, ready for the separately owned dependency replacement. This revision still uses the frozen base's TypeBox validator/dependency closure; replacement validation belongs to integration.

Toolchain: Node `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` (24.13.0), frozen package/lock configuration. An untracked local copy of the existing `node_modules` was used. A symlink to another checkout worked for host tests but correctly failed in the isolated `/app` worker because its external target was not mounted; copying the dependencies into the test application image resolved the fixture setup without weakening confinement.

Frozen implementation reproduction: temporarily materialize the five production files from `git show c410bb4:<path>`, leave the new tests in place, run the following, and restore the exact implementation files in a `finally` block:

```sh
node --test deployment/broker-shell.test.ts packages/agent-shell/agent-shell.test.ts packages/effects/test/effects.test.ts packages/runtime/test/runtime.test.ts
```

Observed: **exit 1, 41 cases, 23 pass, 18 fail, zero skipped**. The failures are the new boundary regressions, including the separate checkpoint and observation cases. Full output: [frozen-regressions.txt](frozen-regressions.txt). No failing checks were weakened or relabeled passes.

Final implementation validation:

```sh
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH npm run verify
git diff --check
```

Observed: **exit 0; TypeScript check, all 145 tests, and emitted build passed; zero failures/skips**. Full output: [verification.txt](verification.txt). The suite includes the actual isolated worker, actual child-process SIGKILL/reopen, late receipts, cancelled descendants, prompt compaction, durable tools, release and supervisor cases available in the frozen base.

## Handoff and limits

Cherry-pick the implementation commit, then this evidence commit. Root should review the changes and rerun verification after integrating the independent schema/dependency and application/release work. This reviewer was independent of the frozen implementation; the repairs themselves are authored here and still need parent integration review.

The broker's prompt checks authenticate application-side system/tool inventory and configured provider options. They do not prove that every cognitive transcript statement is true, nor authenticate a model vendor's inaccessible internal instructions. Checkpoint content remains a shell projection; the issued receipt and authoritative observation records have distinct meanings.

Unknown provider/effect outcomes still consume conservative reservations and may block narrow concurrency/budget envelopes. Explicit continuation is not permission to forgive those charges or retry an uncertain external effect. SIGKILL recovery assumes the documented exclusive-host startup authority; no multi-host database/distributed lease claim was tested. Dependency replacement, live Mistral behavior, external speech, autonomous operation, successor qualification and H1 remain outside this finite deliverable.
