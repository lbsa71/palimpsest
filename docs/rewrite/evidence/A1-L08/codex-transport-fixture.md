# Native Codex transport and tool feasibility

2026-10-11, root integration work for A1-L08. Engineering transport fixture only: no live model generation, comparator scoring, product parity or H1 acceptance.

The new `evaluations/baselines/codex-worker.mjs` runs the actual installed Codex binary inside the existing network/PID/mount-isolated worker. Its only provider connection is a local HTTP endpoint inside that namespace; each Responses attempt crosses the bounded worker pipe to the host. The CLI receives a dummy bridge token and a fresh empty home, no inherited authentication or user configuration. Web search is disabled. Native command sandboxing is disabled only inside the separately enforced namespace. This is an explicitly configured comparator profile, not proof of equivalence to every native deployment.

The test copies the exact CLI and its separate code-mode helper into the read-only image. The host supplies two synthetic streaming Responses replies: a `functions.exec` custom tool call invokes the actual native command tool, writes `proof.txt` and checks that a private evaluator file and provider keys are unavailable; a subsequent reply finishes only after the actual command output appears in the next captured request. The host sees both requests, including the native instruction/tool definitions and continuation. The private evaluator sentinel remains unchanged outside all candidate mounts. No API key, external provider endpoint or network access is available to this fixture.

Observed installed closure, version `codex-cli 0.162.1`:

| File | Bytes | SHA256 |
|---|---:|---|
| `codex` | 294415048 | `628e35487d888a28f0427fc37501da529dd3d81fcbad7a2c3421c1e8670d92e1` |
| `codex-code-mode-host` | 74036112 | `ec71830690a7c0024916ee0c99fbdc635bc6e747ff665ea4f03a8389bbcb6b30` |

The native protocol in this version carries tool namespaces in `additional_tools` input items; the custom tool call carries `namespace: functions`, `name: exec`. Assuming a top-level `tools` list or a direct `exec_command` function call failed. Omitting the separate helper caused a reported code-mode initialization failure, despite a text-only fixture being able to finish. These failed qualification attempts motivated the explicit closure and actual tool check; they were not comparator outcomes.

Validation: `node --test evaluations/baselines/codex-worker.test.ts` passed the actual two-request/tool fixture (one test, zero skips, approximately nine seconds); strict TypeScript check passed. The test discovers a local CLI or uses the explicit `AEON_CODEX_FIXTURE_BINARY`; it skips if none is installed and never downloads one. The copied image and disposable workspace are removed. Native CLI emits a warning that PATH helper aliases are not created beneath `/tmp`; the actual code-mode command tested here works, but untested helper-dependent behavior remains unqualified.

Remaining before paid baseline execution: an independently reviewed host runner with durable total and per-request money/token/time reservations, trustworthy streaming usage settlement, unknown-outcome handling, cumulative retry/subagent accounting, exact CLI/helper/instruction/configuration capture, real kernel resource profile and held-out evaluator isolation. The worker pipe and CLI retry settings alone are **not** a spending grant or a complete physical-budget observer. Authentication/entitlement and the user's API grant remain unresolved. Claude Code remains unavailable on the inspected PATH. No calibration or acceptance execution has run.
