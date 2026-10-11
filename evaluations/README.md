# A1-L08 evaluation foundation

Run with Node 24 from the repository root:

```sh
node --test evaluations/execution/screen.test.ts evaluations/development/assess.test.ts evaluations/baselines/plan.test.ts evaluations/contract-envelope.test.ts
node evaluations/run.ts /tmp/aeon-screen-report.json
```

The output path must not already exist. The runner makes no network/model call and changes no operational state. Its twelve-case report is **mechanical**, scripted and ineligible for release admission. Protocol v1 was committed as `20a4159` before the first execution. [Protocol](../docs/rewrite/evaluation/protocol.md) and [development horizon](../docs/rewrite/evaluation/development.md) define limits and gates.

`runScreen(actor, seed, maxActions)` exposes task text/file names and observer-mediated tools, retaining expected outputs and verification inputs outside the actor's function arguments. Repository fixtures are visible to developers; acceptance needs fresh evaluator-held variants and process/mount isolation. The in-process callback is trusted and is not a security sandbox or hard wall-clock limiter. An actual shell adapter can map declared tools to the provided tool function and observe results; do not present the scripted reference actor as Pi or configured-model competence.

`mechanicalToContract` maps the report to C1's `MeasurementEnvelope` with `evaluatorRole: author` and `independent: false`. It requires a manifest for the scripted actor, not the product. Digests in the harness address UTF-8 `JSON.stringify(value)` bytes without a trailing newline; the host must store those exact bytes or re-envelope its own artifact format. Artifact references must come from host storage; conversion is not receipt authentication. L09 verifies artifacts and keeps signing keys outside candidate access.

[Baseline availability](baselines/availability.json) captures observations, unknowns and missing access. `prepareCodexBaseline` constructs argv/stdin for a later authorized run without executing it. The CLI command interface was confirmed with installed `codex exec --help`; [official non-interactive documentation](https://learn.chatgpt.com/docs/non-interactive-mode) describes `codex exec` and JSON output. Ambient user configuration is not a frozen baseline. No Claude interface or account is assumed.

Future live runner integration must enforce resource ceilings before every physical request, freeze native effective instructions/tool/context manifests, isolate candidates from expected answers and the observer, and preserve failures. Current code neither provisions comparator accounts nor launches paid agents. Full parity, fresh independent acceptance, live elapsed development and H1 remain unavailable.
