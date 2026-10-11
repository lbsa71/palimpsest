# Ordinary bounded parallel children — A1-L06-T04/T05

Owner `/root/a1_parallel_children`; base `8fa6be5`; contract `aeon1.c1.v1`; branch `codex/a1-parallel-children-20261011`. Finite objective: expose bounded overlapping child runtimes to an ordinary parent and verify artifact inspection, integration, rejection, cancellation, uncertain recovery and enforced concurrency. Exact source handoff: `9e28fa4` (the source implementation commit). The following evidence-only commit is the final lane handoff; it changes no runtime code or tests.

## Behavioral specification and design

Before: the ordinary shell executes tool calls sequentially and `delegation_start` waits for its single child. Calling the coordinator twice directly established component overlap but did not make parallel sibling work available to the ordinary parent.

After: `delegation_start_batch` is one durable receiver effect with complete finite task packets. It validates and registers all packets in one transaction, rejects duplicate identity/overlap/excess count or concurrency/foreign parent/model/resource/scope/depth errors, then starts siblings and waits for every settled result. It returns each persisted record and any failure. Sole-child `delegation_start` remains available. The existing runtime, source-owned Pi shell, physical ledger, isolated worker lifecycle and artifact exchange are reused; no general shell parallelization, new grant source or dependency is introduced.

The host already counted children against `maxConcurrentRuns`; its delegation grant now reflects the parent slot and physical receiver reservation. Two siblings require at least three host run slots and ancestor request concurrency slots; default hosts with two slots retain valid single-child use. Child workspace preparation remains finite (eight per parent), and runtime admission authenticates prepared workspace ownership. All children retain their parent lineage and narrowed effect permissions; ordinary children have no developmental extension tools.

Every completed result still requires actual immutable artifact reads and a separate parent verdict for all declared criteria. Interrupted batches remain uncertain conservatively, retaining sibling receipts and physical charges; restart cannot replay the batch or uncertain/cancelled children. Batch failure does not detach active siblings.

## Validation

- Strict TypeScript check passed on Node 24.13.0 using the existing dependency closure.
- Component delegation suite: 3 passed, including atomic rollback, excess concurrency rejection before any child execution, complete plus lost child response retention, and no replay.
- Ordinary application physical fixtures: all seven selected cases passed across the initial six successful cases and the corrected oversubscription case. Actual host fixtures use the ordinary `AutarkApplication`/confined Pi path, rather than concurrent coordinator calls alone. Two child provider transports were simultaneously entered while all three runtimes were running; the shared ledger measured three concurrent physical reservations (parent batch receiver plus both children). Actual workspace writes, command executions and reads produced 36 and 35. The parent read both immutable result artifacts, accepted the first child, rejected the second against the same criterion, and retained its integration file. The finished tree had exactly 31 physical requests and zero active reservations.
- Sole-child regression and injected atomic child-registration failure passed. The valid oversubscription fixture gives the parent an ancestor concurrency allowance of two while the root and host have spare capacity. Its grant permits one child; a two-child batch is rejected before any delegation record, child run, or child allocation is created.
- Parent cancellation and graceful close each drained both child transports. Reopening the real operational store retained eight requests, positive token/cost charges, and three uncertain reservations; neither original child nor batch was replayed. A real host `SIGKILL` additionally verified every captured descendant had exited or become non-live before restart. Startup marked both running child records uncertain, held the parent blocked on its one unresolved batch effect, preserved all eight requests, and made zero fixture-provider calls after restart.
- Initial selected run: six passed and one fixture setup failed (`Invalid run concurrency`, because host run ceiling three exceeded root request concurrency two). The correction applies the restrictive concurrency to the parent conversation allocation while retaining a valid larger root/host grant. The corrected case passed; the failure is retained here rather than represented as a clean initial run.
- Fresh independent review: pending root handoff.

Executed commands (Node binary `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`):

```sh
node --test packages/delegation/delegation.test.ts
node --test --test-name-pattern='bounded batch registration' packages/delegation/delegation.test.ts
node --test --test-concurrency=1 --test-name-pattern='ordinary (parallel delegation|delegation runs a real bounded child)|child admission cannot leave' deployment/application.test.ts
node --test --test-concurrency=1 --test-name-pattern='ordinary parallel delegation grant' deployment/application.test.ts
node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

Private persisted evidence directory: `/home/palimpsest/migration/aeon-1-20261011/integration-evidence/parallel-children/` (directory mode 0700, logs mode 0600).

| Log | SHA256 |
|---|---|
| `focused-before-grant-correction.log` | `f290a92dcfcf68d0a01ea68efdaf84262a6977b4ffa7a8bf8721e79e4f46ba92` |
| `grant-corrected.log` | `4f052c072a5c1c2a5c6db2969c94f5723c4d896097f53e1e97eeae0f4bec5673` |

Both logs exercise the same final runtime/tool source. The first used the invalid pre-correction concurrency fixture described above; the corrected log exercises the final valid grant case in source `9e28fa4`. TypeScript and diff checks passed. Dependency source remains unchanged; the worktree uses the preexisting dependency closure through an ignored local `node_modules` symlink.

## Limits and next owner

Evidence uses deterministic `mistral-fixture-v1` responses and actual confined runtime/tool execution with fixture instructions; no paid provider, production activation, external messages or live-model competence claim. A failed or unknown child conservatively holds the batch for explicit reconciliation; this change does not add a model-callable reconciliation mechanism or claim independent product qualification. Root owns aggregate integration, source-bound independent review and remaining L08/L09 gates.
