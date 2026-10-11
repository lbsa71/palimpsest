# A1-L08 evaluation

Use Node 24 from the repository root. Public mechanical fixtures and the actual application integration runner make no paid provider calls:

```sh
node --test evaluations/execution/screen.test.ts evaluations/development/assess.test.ts evaluations/baselines/plan.test.ts evaluations/contract-envelope.test.ts evaluations/product/adapter.test.ts
node evaluations/run.ts /tmp/aeon-mechanical-report.json
node evaluations/product/run.ts --fixture /tmp/aeon-application-report.json
```

Outputs use exclusive creation and cannot overwrite earlier reports. The mechanical runner continues to use v1 JSON and [archived v1 prose](../docs/rewrite/evaluation/archive/v1/protocol.md), with the same reference actor and mechanical evidence label. Original reports are unchanged. It is never Pi/model competence. `mechanicalToContract` remains `evaluatorRole: author`, `independent: false` and ineligible for product admission.

The [v2 protocol](../docs/rewrite/evaluation/protocol.md) and [machine manifest](protocol-v2.json) correct unsupported calendar/sample assumptions **before any live scoring**. Finite bootstrap continuity follows actual configured scheduler windows, restart, context reduction, unrelated experiences and later held-out transfer. It does not establish weeks of development. The assessor returns `receipt-shape-pass`, not H1 acceptance. Product scoring remains closed pending comparator-only calibration, justified margins/counts and an independent frozen manifest. No missing result becomes a pass.

`product/adapter.ts` invokes the actual `deployment/application.ts`: authenticated direct input, confined Pi, durable runtime, real tool effects and explicit direct output. It never calls `referenceActor`. The public bounded fixture writes a faulty program, observes a real failing command, reads and repairs it using the actual digest, reruns it and explicitly speaks. A host-side evaluator runs separate signed/zero/random input checks in disposable confinement after stopping the application. Those random inputs are kept in an evaluator-private directory outside all candidate mounts; the fixture algorithm and checker are public and are **not** a secret competence benchmark. Seven provider fixture responses have synthetic zero pricing. Request/token use is actual fixture accounting, not measured provider cost.

The adapter accepts a public `{id, prompt}` projection and a trusted host `evaluate(observation)` callback. Observations include actual run status, explicit output, tool receipts, resource ledger and a bounded regular-file artifact reader which rejects symlinks/traversal. The evaluator may independently execute candidate code in a disposable sandbox. Never execute untrusted candidate code directly in the observer process. The callback is trusted host code; it is not itself a hostile-code sandbox or a hard wall-clock limiter. The candidate is stopped before verification. Reports preserve failures and always state `independent: false`, `admissionEligible: false`; an external evaluator module alone cannot authenticate independent review.

A later explicitly granted live run uses:

```sh
node evaluations/product/run.ts --live /PRIVATE/NEW-REPORT.json /PRIVATE/SPEC.json
```

The private specification has `configurationFile` (normal application JSON), canonical `privateRoot`, `caseFile` (JSON with public `id`/`prompt` and any evaluator-private fields), `evaluatorModule` (an external `.mjs` exporting async `evaluate(observation)`), `observerId`, `timeoutMs` (at most 900000) and `liveSeal` with `grantId`, `calibrationDigest`, `isolationReceipt`. The application must use the runner's exact checkout, an ephemeral direct port, no Slack, separate state/workspace directories, explicit bounded resources/prices/model and existing host-issued authority; the live runner does not bootstrap authority. The normal host environment supplies Mistral/direct secrets; credentials are not copied into reports or candidate context. The actual default gateway remains Mistral. Provider substitutes are not silently configured.

Private evaluator/case files must reside outside source, workspace and state. No answers or private seed may enter the mounted application or public task. The whole application source is currently read-only mounted in the shell worker, including public evaluation fixtures; a fresh private workload is therefore mandatory for acceptance. Path checks are engineering guards, not an authenticated isolation audit. `liveSeal` fields record host prerequisites and are not self-authenticating grants. L09 must freeze and authenticate controls, receipts, calibrated thresholds and isolation before live scoring; this handoff has performed none of those runs.

[Comparator feasibility](../docs/rewrite/evaluation/comparator-feasibility-v2.md) separates fixed-model from best-system comparisons and records missing access honestly. The Codex argument builder never launches a CLI. Full parity, live development, fresh independent acceptance and H1 remain unavailable.
