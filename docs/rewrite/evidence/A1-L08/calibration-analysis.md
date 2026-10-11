# A1-L08 calibration-analysis engineering evidence

Status: implemented, fixture-verified; no live calibration or parity claim. Owner `/root/a1_calibration_analysis`; base `dbab4be`; branch `codex/a1-calibration-analysis-20261011`. Scope: A1-L08-T01/T02/T05/T06; RW03/RW16/RW18/RW19/RW20. The [method and host contract](../../evaluation/calibration-analysis.md) define the finite behavioral specification and unresolved qualification boundary.

Before this change, protocol v2 specified a comparator-only power procedure but had no implementation of pilot ingestion, finite selection, sealed acceptance plan validation or paired score analysis. The new dependency-free TypeScript module supplies those operations with exact identities, retained failed/missing outcomes and inadmissible-by-default reports. No live provider, comparator generation, production process, Slack, credentials or paid calls were used. No task count, margin or floor is proposed from synthetic data.

Validation on Node v24.13.0:

```text
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test evaluations/calibration/index.test.ts
12 passed, 0 failed, 0 skipped
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
exit 0
```

The worktree reuses the existing root `node_modules` by symlink for checks; no dependencies or lockfiles were installed/modified. Focused tests cover analytical bounds and seeded synthetic distributions, repeat clustering, paired variance, deterministic finite selection, missing/failed outcomes, grant/power insufficiency, identity/authentication tampering, candidate contamination, freeze integrity and nonregression gates. Tests are engineering checks only. The primary statistical source was read directly; the method document records its formula, assumptions and conservative limits.

Remaining limitations: the host must authenticate scoring and seal chronology, establish independent representative task sampling, justify equality/sensitivity assumptions and failure costs, enforce actual resources, randomize dispatch and independently review the implementation. Digests and fixture callbacks cannot establish those facts. Both comparator live claims and H1 remain unaccepted. Fresh review disposition and exact handoff commit are reported to the integrating owner; this record does not self-certify independent review.
