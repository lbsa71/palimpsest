# A1-L08 foundation result — 2026-10-11

**Implemented and fixture-verified; product qualification remains unavailable.** Protocol was frozen in `20a4159` before execution. Runnable implementation is `3e9d55a`; [machine-readable screen evidence](../../evidence/A1-L08/2026-10-11-mechanical-screen.json) records this source revision plus protocol/workload/evaluator/scripted-actor/configuration digests. The report contains all observations, final synthetic artifacts, failures, action counts and measured case/wall time.

The scripted actor passed all twelve mechanical scenarios. Thirteen tests passed, including held-out parameter variants, omitted verification, duplicate uncertain effects, child scope breach, action exhaustion, missing/duplicate cases, unpinned baseline configuration, absent resource grants, evidence digest mismatch and synthetic-development rejection. These results measure harness mechanics, not any product, model, actual OS restart, live delegation or growth.

Validation (Node 24.13.0, TypeScript 7.0.2; C1 `f11a25b` supplied read-only by temporary local symlink):

```sh
node --test evaluations/execution/screen.test.ts evaluations/development/assess.test.ts evaluations/baselines/plan.test.ts evaluations/contract-envelope.test.ts
node node_modules/typescript/lib/tsc.js --ignoreConfig --noEmit --target ES2024 --module NodeNext --moduleResolution NodeNext --strict --erasableSyntaxOnly --allowImportingTsExtensions --verbatimModuleSyntax --skipLibCheck --types node evaluations/*.ts evaluations/execution/*.ts evaluations/development/*.ts evaluations/baselines/*.ts
node evaluations/run.ts docs/rewrite/evidence/A1-L08/2026-10-11-mechanical-screen.json
```

Tests: 13 passed, 0 failed/skipped. Strict typecheck: exit 0. Screen: 12 passed, 0 failed. No paid calls, network actions by the runner, comparator invocation or authority transfer occurred. Web documentation lookup was read-only. Unknown model token/cost fields are null, not zero. The initial typecheck invocation required TypeScript 7's `--ignoreConfig` when specifying explicit files; the corrected command above passed.

## Actual comparator feasibility

Read-only inspection found `/home/palimpsest/.local/bin/codex`, `codex-cli 0.162.1`, and `codex exec --help` with noninteractive JSON output/config isolation flags. Allowlisted local configuration reports `gpt-6-astra`, effort `ultra`. Authentication file presence was checked without reading its contents; validity and allowed models remain unverified. Ambient permission settings were observed but are not adopted by the baseline plan. No monetary/physical-request grant or effective prompt/context/tool manifest has been frozen for a run.

`command -v claude` found no executable on current PATH. This does not prove global absence or unavailable accounts; it blocks an executable Claude baseline here until provisioned. The [availability inventory](../../../../evaluations/baselines/availability.json) preserves all missing fields. The Codex argv/stdin plan is runnable input preparation, not a resource-enforcing live launcher; the host must supply isolated configuration, request interception and granted budgets before execution. Interface support is corroborated by [official non-interactive documentation](https://learn.chatgpt.com/docs/non-interactive-mode), fetched 2026-10-11.

## Handoff and remaining requirements

T01 workload/rubric and mechanical thresholds are frozen; parity-margin selection remains behind comparator-only calibration, before any candidate scoring. T02 has actual availability inventory and deterministic command preparation; both live baseline datasets and same-model feasibility remain unverified. T03's observer/harness is implemented with evaluator-only expected results in its API; authoritative held-out tasks need new private variants and isolated candidate execution. T04's 28-day/7-day receipt rules and adversarial fixtures are implemented; no real longitudinal window has elapsed. T05 independent integrated runs, model/harness/memory/goal ablations and actual external feedback are outstanding. T06 fresh independent integrity review and authoritative admission evidence are outstanding.

The current evaluator is the implementation author. Its C1 envelope hard-codes `independent: false`, `evaluatorRole: author` and mechanical/deterministic labels. Root L09 owns receipt authentication, immutable controls, grants and admission; a candidate cannot turn this report into accepted product evidence. No Q5, product parity, live development, autonomous qualification, deployment or H1 claim is made.

Next owners: L09 integrates C1 and the evaluation source/tests in the root build; L02 can map its bridge tools to the observer for additional **integration** evidence with separately frozen manifests. A fresh evaluator later freezes the joined L02–L07 candidate, provisions authorized comparators, calibrates margins and runs isolated private tasks. Root may reuse a released agent slot now; the finite foundation goal is complete, while the overall L08 lane remains partial.
