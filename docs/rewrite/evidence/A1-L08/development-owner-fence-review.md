# Independent P3-R1 owner current-use fence re-review

2026-10-12. Reviewer `/root/a1_development_owner_fence_review`; actual finite goal created before inspection. Isolated `codex/a1-development-owner-fence-review-20261012`, claim/base `db5f6ba`, repaired source `bcd5921`, final author evidence `6eaf660`. Write ownership is only this new evidence and `evaluations/development/current-use-owner-fence-review.test.ts`; all source and old tests remain read-only.

## Frozen independent criteria (before new tests)

1. Both snapshot and paged public current-use/read callbacks must reject each actual owner, custodian, original-ledger and captured-source mutation before it changes state or releases bytes predicated on that mutation. Nested ordinary transactions and caught nested failures must not weaken the fence. Signed attempt withdrawal and signed custodian status changes are included.
2. Reentry, callback exceptions and object/function thenables must reject without poisoning valid evidence. Hostile thenable property-presence traps run only while writes remain refused; retained readers expire on every exit. Guard cleanup must restore subsequent ordinary writes and keep surrounding ordinary transaction rollback semantics.
3. Custodian/source entry withdrawal prevents callback invocation and persists exact terminal disposition after guard unwind. Callback-controlled errors resembling source corruption must not fabricate terminal evidence.
4. Legitimate synchronous reads through nested ordinary transactions continue to work, even after a refused mutation. Previously existing final publication and authentic original late-response settlement remain required regressions; new work after actual withdrawal remains denied.
5. All unchanged 50 P2 component checks (including the original two P3 causal assertions), 18 authored owner-fence checks and strict typing must pass. Held-out checks extend causal combinations and adversarial exits, not implementation text assertions. Setup may copy the existing synthetic snapshot plan and custodian fixture and reuse the public paged fixture; assertions are independently written.

Only small synthetic SQLite and in-process explicitly mocked provider fixtures; Node `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`, module-mock flag where required. No physical/native/provider/network/private credentials/Slack/full benchmark/push/deploy. Original P3 failures and author intermediate 49/50 thenable regression remain preserved in their original evidence; this review will preserve every local failure and distinguish fixture defects. Root retains signing integration and H1.

Inspection initially used the nonexistent short lane path `A1-L08.md`; corrected to `A1-L08-evaluation.md`. No runtime check was affected.

## Inspection and preserved attempts

The public storage wrapper reuses the existing synchronous read fence. Both recorder paths include the owner, optional custodian, original ledger and every captured behavioral store; paged sources already fenced by historical-version validation are deduplicated by actual object identity. Mutation methods check the fence before storage writes. Guarded authority observations defer terminal marker writes until unwind. The paged authority-error path preserves callback refusals instead of relabeling them as source corruption. Final publication and original response maintenance are separate existing paths, exercised by the unchanged component suite.

- First strict command `/tmp/p3-r1-independent-strict-first.log` exited127 because the fresh worktree had no `node_modules` link (`tsc: not found`). Added an ignored link to the existing main checkout dependencies; no install or tracked dependency change.
- Second strict `/tmp/p3-r1-independent-strict-second.log` exited1 for one new test setup type error: `delete` requires a numeric expected revision, but the draft supplied null. Corrected the owned probe to revision1; its expected write-fence assertion is unchanged.
- First held-out runtime `/tmp/p3-r1-independent-heldout-first.log`:9/9 pass,0 failures/skips/cancellations,exit0,9.790s. Subsequently added direct replacement of the real recorder owner row and actual source withdrawal to the same before-byte-release probe. This produces a final source-stable rerun below.

No production finding has arisen from inspection or the initial held-out run. Final disposition depends on the full unchanged component receipt and corrected strict run.

## Exact command manifest

Workdir `/home/palimpsest/migration/aeon-1-20261011/development-owner-fence-review`, source fixed at claim `db5f6ba` (the repaired storage/acquisition files are byte-identical to `bcd5921`). New held-out test revision `4f0218f`; frozen criteria `ee8cc7e`.

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --experimental-test-module-mocks --test --test-concurrency=1 evaluations/development/acquisition-pages.test.ts evaluations/development/review-projection-adapter.test.ts evaluations/development/review-projection-adapter-review.test.ts packages/storage/test/development-owner-read-fence.test.ts evaluations/development/current-use-owner-fence.test.ts > /tmp/p3-r1-independent-regressions.log 2>&1
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 evaluations/development/current-use-owner-fence-review.test.ts > /tmp/p3-r1-independent-heldout-final.log 2>&1
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH npm run check > /tmp/p3-r1-independent-strict-final.log 2>&1
git diff --check
git diff db5f6ba --name-only
git diff bcd5921 -- packages/storage/index.ts evaluations/development/acquire.ts
sha256sum evaluations/development/review-projection-adapter-review.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --version
```

The initial held-out and strict commands have identical options with their respective first/second log destinations above. Original independent P3 test SHA256 remains `9440ed0d7a5f2314d2128c2eaa84d16392379a190d4d6940db3c8fbfff265672`. The dependency link is ignored and untracked; only the two claimed new paths are changed.

## Final results and disposition

**Accepted within the bounded P3-R1 repair scope. No changes required.**

- Unchanged component/repair run:68/68 pass,0 failures/skips/cancellations,exit0,234.104s. This includes all50 P2 cases (29 author plus21 independent) and all18 authored storage/current-use repair cases.
- Both original causal assertions pass unchanged: synchronous attempt withdrawal refuses with `source writes forbidden during development fence`, `releasedBytes:0`, and no terminal marker; the direct owner write refuses and `committed:false`.
- Final held-out run:9/9 pass,0 failures/skips/cancellations,exit0,20.781s. Both profiles reject nested mutations and all four withdrawal/real-owner-row attacks before byte release, yet allow legitimate reads after caught refusal. Callable thenable traps cannot mutate authority; callback errors preserve exact error identity and current evidence; leaked readers expire. Custodian destruction races persist the exact terminal marker, independently observed through a newly opened owner connection. Storage restores outer transaction semantics and rollback.
- Strict final exit0; `git diff --check` exit0. Pinned runtime reports `v24.13.0`. Source diff against `bcd5921` is empty; every pre-existing test remains unchanged.

The unchanged suite additionally confirms source-entry withdrawal markers, committed final-cut publication, exact original response accounting and authentic late response settlement after withdrawal, with new requests refused. Prior P3 reds and author's intermediate49/50 regression remain in the old evidence without alteration. The author's separate76 storage/historical/retention checks were not rerun here; this review independently reran the required68 and added9, totaling77 passing runtime cases. Synthetic checkpoint/tool failure diagnostics in the component log are expected negative-case observations; the completed runner reports zero failures.

This finite goal is complete at this document's enclosing clean two-path commit. Root owns import and later signing integration. This review does not establish provider competence, physical isolation, the old broad snapshot capacity gate, full developmental qualification, autonomous deployment or H1; no such acquisition was performed.
