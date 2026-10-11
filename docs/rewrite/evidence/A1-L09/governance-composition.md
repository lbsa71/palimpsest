# A1-L09 ordinary governance replacement with physical reviewers

Status: **integrated physical engineering fixture passed**. Owner `/root/a1_succession_final_review`; branch `codex/a1-governance-composition-20261011`; worktree `/home/palimpsest/migration/aeon-1-20261011/governance-composition`; base `2bb7227`. Verified source `19327fdfcee2432b5cee041936dfa4637b1a07f4`. This completes this bounded A1-L09-T05 composition demonstration, not live reviewer qualification, autonomous governance judgment or H1.

## Goal, ownership and dependencies

An actual finite tool goal was created before work, without a token budget: demonstrate ordinary-service source proposals changing cases and executable reviewer code, original physical admission/probation judgment, accepted restart with durable reviewer binding, and a later physical evaluation under the new policy; preserve failures and exact evidence. Governing requirements/workflow and A1-L09 remain the same as the preceding source-bound implementation task.

The lead assigned `deployment/evaluation-dispatch.test.ts` and this new evidence file exclusively. The source-bound registry implementation is documented in [governance proposals](governance-proposals.md); root integration `60d3349` is present in the base. Independent reviewer `/root/a1_governance_review` supplied snapshot-directory replacement repair `71cbc37`, applied here as `9054219` before either physical trial. No product file was authored in this task. The lead serialized the heavy execution window after the separate baseline kernel trial; no competing physical/source-freeze suite ran during these trials.

## Actual exercised path

The new case extends the existing external-dispatch fixture without removing any existing fault or activation assertions. The fixture's captured model transport runs in the actual frozen service child and invokes ordinary tools:

1. `source_checkout`, the existing source-marker edit, and `governance_profile`.
2. Three ordinary `workspace_write` calls create a new reviewer module, its imported rules module, and `deployment/governance-proposal.json`. The proposal is constructed from the actual public profile, retaining exact inherited Node/library mounts, signing identity and private resource bounds. Its required case changes from `held-out-exact-source` to `governance-future-source`; both reviewer and imported rules bytes change.
3. `change_propose`, `candidate_freeze`, `candidate_evaluate`, result-driven continuation, `change_status`, `release_submit`, and `control_activate` pass through the ordinary service tools and real supervisor.
4. The original physically executed sealed reviewer supplies admission evidence, then separately executes for fresh probation. Both proofs bind the original policy, control revision and evaluator artifact; probation evidence IDs differ from admission evidence. The controller accepts the changed candidate/policy.
5. The actual supervisor/service closes and reopens using the same original configuration and only the original externally configured policy. Its durable registries resolve the accepted new policy/reviewer without manual per-revision edits. A latest-state/uncertain-effect fixture record remains byte-for-byte/revision-equal, the authority epoch advances, and neither completed review repeats.
6. A separately admitted ordinary run invokes `source_checkout`, `governance_profile`, proposal/freeze/evaluation. Its actual external reviewer process uses the accepted new policy and changed runnable closure. Its signed observation contains `reviewerGeneration: source-owned-future-reviewer-v2`, imported from the newly written rules module, and reports the new required case. This witnesses executed changed code, not merely a changed declared hash.

The original reviewer admission/probation requests share the originating author's unchanged allocation lineage. The future evaluation belongs to the explicitly admitted future run. Exactly three actual external-review requests settle successfully with positive measured elapsed usage. Both public profiles omit private host paths and `keyFile`; the private key's bytes remain unchanged. No new grant, externally edited policy registry or self-judgment substitutes for old-policy admission/probation.

The standalone supervisor fixture explicitly restarts after acceptance to materialize accepted-policy metadata. It does not claim to exercise the separately covered installed systemd host handoff in the same case. The lived-state/effect marker is synthetic; it does not prove real autobiographical continuity or reconciliation of an actual uncertain external effect.

## Before/after and exact observations

First trial at fixture source `ed3616a79dac564f5648b6985ce4fac9833ebb65` failed after **77.122 seconds**. Retained state showed both original-policy reviews, accepted restart and the future new-policy review completed, but the fixture waited for `job.runId`. `EvolutionJob` carries the author only inside its immutable request's `proposal.runId`, so the lookup always returned undefined. The repair resolves that actual request binding. The follow-up also reads signed observation bytes from their actual SQLite artifact store. Neither production code nor an authority/admission assertion was weakened. Full failure diagnostics were archived before cleanup.

The corrected physical trial at `19327fd` passed **1/1, 0 failures, 0 skips** in **54.385 seconds** (test body 54.074 seconds):

```sh
AEON_GOVERNANCE_LOG_DIRECTORY=/home/palimpsest/migration/aeon-1-20261011/integration-evidence/governance-composition \
  /opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test \
  --test-name-pattern='ordinary governance proposal uses old physical' deployment/evaluation-dispatch.test.ts
```

| Identity | Observed SHA-256 / value |
|---|---|
| Incumbent candidate | `e2e911ac4df53077947ceff7f76a4c1308667dcdc17c13a06695ed5bb3485fbf` |
| Accepted governance candidate | `b4f4878e56440edeb9b61661b785ac5cbf569d719df27c1d9ac2c74ffcfe6de5` |
| Original policy | `35596db25bd129146676cd0537dba4dfe31fb0b349f2e922246268763ae9a669` |
| Accepted future policy | `0e9a077d1897190e166e3219412c1d2e555522c9d15a35a4341a5e1a50f75352` |
| Original reviewer artifact | `1d063cc8cbe0f21596d32a7d4442a2411f2ca121eb3a2664a0d79beb9a223b17` |
| New reviewer artifact | `71d09c1227d2006bc2fba4c9f3df714bab79e036172630558d092ed6705c3853` |
| Original admission / fresh probation / future review elapsed charges | 2,346 ms / 6,354 ms / 2,303 ms |

The success log retains all three physical request IDs, author run IDs and distinct evidence IDs. Original admission evidence is `external:18c6e354a0575e5f43783b1134edc4e36b8097aa4ab700311b7ff4646ff48af6`; fresh probation is `external:probation:b3fb7e531c78c0bb1d7b7f6ef6229ee37eccd7e620215010a604c272dfaaf606`; future evidence is `external:e6b594065af6f5f0483d28c266a366aa4ad3738785bf8c677ddd6974ddfd7b28`.

Artifacts remain outside Git under `/home/palimpsest/migration/aeon-1-20261011/integration-evidence/`:

| File | SHA-256 |
|---|---|
| `governance-composition-before.log` | `ff4c377db2150d37a3bfceb32d524b8d77b0f8bbeff3402fe77f2c95c056499a` |
| `governance-composition-after.log` | `cd300849efc07586e68b407620e0b8ddf22167850397940837293452e48fbe5d` |
| `governance-composition/failure-800952.json` | `620e2ab1e4251081792809d5eb3f7c95645ffa6d8496cebde7d8ea147e8544af` |

Node 24.13.0 strict `npm run check`, `npm run build` and `git diff --check` passed at final fixture code. Lockfile SHA-256 remained `cc2956d305c7bbb1be7d58bde7b1d257ff8329ca73d55d1cfb8ee92d2712efc0`; dependencies were reused without changes. Both trials closed the supervisor/stores and removed their temporary trees; a subsequent `/tmp/aeon-external-dispatch-*` inventory found no leftovers.

## Handoff and limits

Integrate fixture commits `ed3616a`, `19327fd` and this evidence commit. Do not duplicate prerequisite `9054219` when the root already contains original `71cbc37`. The lead owns the complete original dispatcher/fault/activation suite and broader aggregate at the final integrated source, plus consistent lane/status records and fresh review of the composed result. Only the new physical case ran in this serialized window; existing assertions remain present and unchanged, but are not counted as passes here.

The observed old-judge → fresh old-probation → new-future-judge transition closes the isolated proposal/registry composition gap for this synthetic engineering setup. Captured model responses and deterministic physical evaluator judgments do not establish competence, valid autonomous governance choices, live paid inference, H1 or product-policy qualification. No network generation, external message, production service change, systemd installation or push occurred.
