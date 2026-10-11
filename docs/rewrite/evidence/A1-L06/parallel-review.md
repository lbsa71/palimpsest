# Ordinary sibling delegation — fresh consequential review

Owner `/root/a1_parallel_review`; lane A1-L06-T04/T05; branch `codex/a1-parallel-review-20261011`; isolated worktree `/home/palimpsest/migration/aeon-1-20261011/parallel-review`. Reviewed implementation `9e28fa4be10cc07fa8db8de7192bfc598e22d84e`, evidence baseline `4e02016`. Fresh reviewer context, separate from implementation authorship. Contract `aeon1.c1.v1`; no dependency, general runtime, Pi shell or root configuration changes.

Finite goal: review and repair ordinary sibling delegation, seek concrete counterexamples to atomic complete validation, persisted authority/resource limits and joined interruption, then record exact verification and limits. Exclusive writes: delegation package, delegation-only application implementation/tests, and this evidence file. Root retains integration, independent repair inspection, physical-test scheduling and release authority.

## Findings and repairs

1. **Prepared workspace validation occurred after sibling execution began.** Registration accepted an unprepared second workspace because the authenticated preparation and single-workspace checks existed only in `executeChild`. A valid first sibling could therefore start before the invalid packet failed. Host admission now validates the entire packet set synchronously before registration; per-packet checks also protect the single-child path. Registration still uses the existing atomic store transaction.
2. **Delegation grants were reconstructed from current conversation defaults.** A persisted parent with 500,000 tokens received a 10,000,000-token grant; intermediate ancestor ceilings were ignored. The downstream physical ledger still enforced those ceilings, so this was invalid admission/advertised authority, not demonstrated overspending. Grants now intersect the actual persisted parent and every ancestor allocation, preserve the parent's task depth ceiling, and retain the waiting parent receiver's concurrency slot.
3. **Whole-batch capacity was not checked against occupied slots.** Nominal concurrency allowed two siblings while an unrelated uncertain request occupied an ancestor slot; each child could then fail after registration or a sibling had started. Host admission now checks the whole batch against current host run occupancy and reserved, dispatched or uncertain physical requests in every ancestor subtree. It rejects before any delegation record or child allocation survives.

## Verification and disposition

Exact repaired source and tests: `3ef8b2b727d139c354063e19afdf93ea67f71fed`. This document's following evidence-only commit is the handoff revision. Node `24.13.0`, binary `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`; the unchanged dependency closure is accessed through an ignored symlink to the root checkout's `node_modules`.

- **Before:** all three final nonphysical regressions failed against original source `4e02016`: unprepared second workspace and occupied ancestor slots both registered instead of throwing, and the persisted parent received the broader configured token grant. The new actual ordinary occupied-host fixture also failed: the parent became blocked after partial admission rather than receiving an actionable preflight refusal. Original source was restored from Git for each baseline run and repaired source was restored immediately afterwards.
- **After:** full delegation component suite **4/4 passed**. It covers actual isolated file/command artifacts, scope/provenance/model/resource/depth rejection, atomic batch rollback including invalid later packets and count limits, uncertain nonreplay, and a new held-drain test proving that one lost response plus parent cancellation cannot detach the still-draining sibling.
- **After:** selected application suite **11/11 passed** in one serial run. It includes the three new nonphysical regressions; actual ordinary occupied-host refusal before any child run/allocation; original single-child behavior and atomic child-authority registration failure; ordinary overlapping sibling execution, inspection and verdicts; configured concurrency refusal; cancellation, graceful close and actual host SIGKILL recovery.
- Original ordinary overlap assertions still observed two confined children, **31 physical requests**, **3 concurrent reservations**, actual outputs **36 accepted / 35 rejected**, and a persisted parent integration file. Cancellation/close/SIGKILL retained **8 requests and 3 unknown reservations**; SIGKILL left no live captured descendants, and restart made **zero provider calls**. Every completed child still requires its own artifact inspection and criterion verdict.
- The original-parent grant regression additionally verifies narrowed child effect permissions and inherited task depth. The ancestor-capacity regression includes an unrelated uncertain reservation, which remains charged after the rejected batch.
- Strict TypeScript and `git diff --check` passed. Physical tests ran only after root's exclusive-window release; the window was released immediately after completion.

Commands (with the Node binary above on `node`):

```sh
node --test --test-name-pattern='delegation review' deployment/application.test.ts
node --test --test-concurrency=1 --test-name-pattern='ordinary parallel delegation rejects a whole batch' deployment/application.test.ts
node --test packages/delegation/delegation.test.ts
node --test --test-concurrency=1 --test-name-pattern='ordinary (parallel delegation|delegation runs a real bounded child)|child admission cannot leave|delegation review' deployment/application.test.ts
node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

The first two commands were used for the before comparisons; the three nonphysical regressions also pass repaired source both separately and within the final 11-case run. The initial capacity regression fixture incorrectly left configured child concurrency above the reduced root ceiling and failed configuration validation; it was corrected before the baseline/repaired comparison. That setup failure is not a product failure or a pass.

Private evidence directory: `/home/palimpsest/migration/aeon-1-20261011/integration-evidence/parallel-review/` (0700; logs 0600).

| Log | SHA256 |
|---|---|
| `before-final-regressions.log` | `dd444e16aa06f2c2a6d0fd2f183a691ee8d2e6b29d72f0529647fc26601549f4` |
| `occupied-before.log` | `014fc958af123af8b0c8b31242b2895bc96c97b4b7a8d109ff0e33cfb3d6fa06` |
| `components.log` | `6a721c30aa66512c28c2103630a3c041f191f1e05d94bf52cbed13bb2a5dc637` |
| `ordinary-after.log` | `605a564b5a4d9bae0b278c3cca6f7c06ed2eff4d9792c8c88d1e59c9e86b3369` |

Review disposition: the original implementation required these admission repairs. The repaired source satisfies this bounded engineering review and its fixture gates; the reviewer is also the repair author, so root must independently inspect the delta before aggregate acceptance. Root owns integration and plan/lane status updates. No remaining blocking finding was identified within the reviewed ordinary sibling path.

## Limits

No paid calls, external messages, deployment, push or live-model competence claims. Provider responses use deterministic `mistral-fixture-v1`; fixture prompt and configuration identities are bound by the source test revision. Runtime request accounting remains authoritative after preflight; preflight does not reserve future budgets or guarantee successful children. Unknown physical outcomes remain conservatively charged and unreplayed. General tool concurrency and runtime/Pi changes remain outside this review. This is integrated fixture evidence, not independent live-model qualification or deployment approval.
