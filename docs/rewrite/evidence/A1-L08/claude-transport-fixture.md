# Native Claude Code synthetic transport inquiry

2026-10-11. **Finite transport inquiry fixture-verified; independent review pending with parent.** A1-L08-T02, owner Codex `/root/a1_claude_transport`, branch `codex/a1-claude-transport-20261011`, isolated worktree `/home/palimpsest/migration/aeon-1-20261011/claude-transport`, base `c3398ce8ebb39b79fe39e1d95519ee78aacdb520`. This is a finite engineering comparator inquiry; it establishes no live inference, competence score, parity, full L08 acceptance or H1. Product Pi/Mistral defaults are unaffected.

```text
/goal Implement and rehearse a bounded actual native Claude Code synthetic comparator transport using the existing baseline observer, lifecycle and isolation; retain exact identities, failures and finite-grant evidence, and report live-accounting/qualification limitations truthfully.
```

## Pinned native artifact and interface

The parent downloaded the exact public native Claude Code 2.1.296 binary, without executing its installer or performing a global installation. Its detached manifest signature verified against fingerprint `31DDDE24DDFAB679F42D7BD2BAA929FF1A7ECACE`, documented by [Anthropic's setup instructions](https://code.claude.com/docs/en/setup). The binary is `/home/palimpsest/migration/aeon-1-20261011/claude-native-feasibility/claude-2.1.296`, 257,068,216 bytes, SHA256 `24972e3bc859fab2b46ed4c1e51f7d6130f06d3bd550811a114640de3370d0de`. Manifest, signature, public key, verification transcript and `version-output.txt` remain colocated outside the checkout. Confined `--version` returned `2.1.296 (Claude Code)`.

Confined `--help` completed with exit 0 in approximately 0.04 seconds. Its observed interface includes `--print`, `--bare`, `--setting-sources`, `--tools`, `--strict-mcp-config`, `--no-session-persistence`, `--disable-slash-commands`, `--model` and `--effort`. The retained help describes bare mode as skipping configuration hooks, automatic CLAUDE.md discovery, prefetch and keychain reads; the namespace independently prevents access to host accounts, home and evaluator storage. [Anthropic's gateway documentation](https://code.claude.com/docs/en/llm-gateway-connect) describes an Anthropic-compatible gateway through `ANTHROPIC_BASE_URL`; this is interface evidence, not an assertion of entitlement.

## Boundary and finite fixture

`runClaudeBaseline` and the existing Codex entry point use the factored `run-native.ts` lifecycle, existing `ProcessLease`, `OperationalStore`, `ResourceLedger`, `runWorker` and Linux confinement. The worker invokes the actual pinned `/app/claude`; it is not an agent SDK or simulated CLI. A local endpoint accepts only bounded POST Messages requests inside the network namespace and converts each to host RPC. Other routes and WebSocket upgrades are refused. The fresh child environment contains a dummy `ANTHROPIC_API_KEY=no-provider-authority`, a local gateway URL and no inherited provider credentials. Native permission bypass applies inside independent namespace confinement only. Bash is the sole enabled native tool, and skills/MCP/session persistence are disabled for this declared comparator fixture profile.

The Messages codec accepts explicit text and local tool continuations, preserves native system/messages/tool payloads, and changes only host output/stream ceilings. `anthropic-fixture` requires low CLI effort and zero synthetic prices; it exports no paid Anthropic transport. Cached usage, hosted/server tools, media, opaque thinking and unrecognized request forms are refused. Missing/truncated/inconsistent usage cancels the original durable grant and holds its conservative reservation. Completed or stopped runs cannot automatically replay. Only explicit `thinking: {type: "disabled"}` is admitted; enabled/adaptive thinking is unavailable. Unsupported requests are retained as bounded refusal artifacts before dispatch; they are distinguished from physical synthetic provider attempts.

The prescribed rehearsal supplies two synthetic Messages streams: a Bash invocation executes a real command that checks private-file and ambient-key exclusion, attempts an independent external socket connection to verify network denial, and writes `proof.txt`; the second response completes only when the captured native continuation contains that command's observed output. The preserved private evaluator sentinel must remain unchanged. Synthetic token figures are fixture accounting data, not measured model tokens or actual inference.

| Original fixture ceiling | Value |
|---|---:|
| Physical synthetic Messages requests | 2 |
| Total reserved tokens | 400,040 |
| Synthetic context / output cap per request | 200,000 / 20 |
| Money grant / synthetic prices | USD 1 finite ceiling / USD 0 declared synthetic prices |
| Whole run / each request / test timeout | 30,000 / 10,000 / 45,000 ms |
| Request / response / combined CLI output bytes | 1,000,000 each |
| Active provider attempts | 1 |

The manifest binds the native binary, native version, copied worker, exact Node binary/version, all source-owned package/baseline runtime files, prompt, original grant, configuration, transport kind and protected paths. Captured request artifacts contain the effective native instruction/tool path and continuation; HTTP metadata records the actual Messages path and headers with the dummy token. Dynamic gateway port and the child invocation/environment are recorded in the result.

## Observations and reproduction

Implementation checkpoint: `4df7662`; final source is identified by the manifest below and the follow-up commit in the handoff. Strict TypeScript passed. Light baseline checks passed 60 cases, with three explicitly opted-out physical tests; these include existing Codex grant/state checks and new Messages continuation, refusal, usage, cancellation and no-replay cases.

The first actual native trial failed safely after approximately 4.94 seconds, with zero host synthetic provider dispatches and no real provider requests. Its original refused request was not captured, so the precise cause remains unverified. Its original manifest/SQLite state and `fixture-trial-1.txt` are preserved in `/home/palimpsest/migration/aeon-1-20261011/claude-native-feasibility`, including `aeon-claude-fixture-zvjsGm`. That preliminary failure exposed missing durable request-shape refusal diagnostics. The revised runner retains those artifacts and stops the native child on host refusal. The later successful native request explicitly includes `thinking: {type: "disabled"}`; the initial codec had rejected all thinking fields, and the correction admits this disabled-only form. This supports the repair without retroactively inventing a captured first-trial payload.

The final actual Claude test passed **1/1, zero skips**, in approximately 6.34 seconds (6.69 seconds including test startup). Exactly two synthetic physical attempts settled under the original `claude-synthetic-original-grant`, each with synthetic usage 100 input/10 output tokens and USD 0. Native Bash produced `native-claude-observed-command`, wrote matching `proof.txt`, verified the private evaluator path and real provider keys were unavailable, and observed an external socket connection fail inside the isolated network namespace. The second captured request contains that actual tool result. The evaluator sentinel remained unchanged, CLI exited 0 without exceeding its output cap, and the same runner/grant could not be replayed. There were zero refused local routes and zero durable payload refusals on this successful trial.

The actual Codex wrapper regression also passed **1/1, zero skips**, in approximately 13.29 seconds (13.70 seconds including startup), with two physical synthetic Responses attempts, its actual command proof and intact private sentinel. This exercises the refactored lifecycle through the original Codex public entry point. The new optional `AEON_CODEX_FIXTURE_EVIDENCE` retains that test's external SQLite/artifact/result evidence. Claude kernel qualification was not run.

Retained successful evidence:

| Artifact | Identity/location |
|---|---|
| Claude evidence root | `/home/palimpsest/migration/aeon-1-20261011/claude-native-feasibility/aeon-claude-fixture-bCeBjC` |
| Claude manifest | `356edf388a03aed592eb642518325522be82b9acce281c05625372ed5f8bff92` |
| Claude result | `9198cac4d164ae7b7115527da8fcaafb28f137474cb219fde08367479bbf9bc0` |
| Runtime source inventory | `93be9d13db97c198200b0a87e41ef87405a330d614a2d95a88edc53eb05dedc1` |
| Claude worker | `d90c9eea7a038f46b88bab7c158f096f815e507d1d779c3542c8598b1ccfd32d` |
| `run-claude.test.ts` fixture/check source | `86feab07f0fc6d2b74ad165028fd394c6235abf14c0776d8c159ecd2245c87a0` |
| `run-codex.test.ts` fixture/check source | `7360e3298c341659fad0a1f18e45f6474e8a9f8b53b800fd0819962f0db81415` |
| `claude-fixture-codec.test.ts` fixture/check source | `596fc703d6a056e09fb91a811704a4c950c216c377aa2acc4b49246fa8b0255c` |
| Codex manifest / result | `7c75156cb8f2d52b027c0e648fec4766e8b386a0284b630a453a1c3145cb37d4` / `45fb0dc30feee891796b53594be495fa73af4f4a17d123dce7e7381251a266e9` |
| Codex regression root | `/home/palimpsest/migration/aeon-1-20261011/claude-native-feasibility/aeon-baseline-runner-6bf3fz` |
| Transcripts | `fixture-trial-2.txt`, `codex-wrapper-regression.txt`, `light-tests-final.txt` under the external feasibility root |

The Claude `summary.json` indexes both immutable original/forwarded payloads, native HTTP metadata, synthetic response receipts and completed usage; the complete manifests reside in each retained `state/observer.sqlite`. These contain public native instructions, never host account credentials. Source inventory uses content hashes because the actual trial preceded the final evidence commit; its runtime files match the delivered runtime source. Tests/evidence prose are outside that runtime inventory; the test source hashes above bind the exact rehearsal/check logic. `transport-evidence-index.json` in the external feasibility root hashes retained transcripts, SQLite evidence, proof/sentinel files and summaries, including the failed trial.

The exact runtime is `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`, version 24.13.0, binary SHA256 `53fb205ae78805130177e24bcb459a69a1518c8d98f8965f31d85aae7ea840fc`. From the isolated worktree:

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test evaluations/baselines/claude-fixture-codec.test.ts evaluations/baselines/observer.test.ts evaluations/baselines/run-codex.test.ts evaluations/baselines/run-claude.test.ts evaluations/baselines/plan.test.ts
AEON_CLAUDE_RUNNER_FIXTURE=1 \
AEON_CLAUDE_FIXTURE_BINARY=/home/palimpsest/migration/aeon-1-20261011/claude-native-feasibility/claude-2.1.296 \
AEON_CLAUDE_FIXTURE_EVIDENCE=/home/palimpsest/migration/aeon-1-20261011/claude-native-feasibility \
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-name-pattern='actual Claude' evaluations/baselines/run-claude.test.ts
AEON_CODEX_RUNNER_FIXTURE=1 \
AEON_CODEX_FIXTURE_EVIDENCE=/home/palimpsest/migration/aeon-1-20261011/claude-native-feasibility \
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-name-pattern='actual native Codex CLI and tool runner' evaluations/baselines/run-codex.test.ts
```

No authentication/login/account creation, installer execution, paid generation, external message, production install, push or dependency/lockfile change occurred. The retained public binary is an explicitly downloaded fixture artifact and remains absent from normal PATH. Full native tool/delegation/recovery configurations, kernel resource qualification for Claude, live Anthropic cache/tier/media/thinking accounting, account entitlement, a paid grant, comparator calibration and independent scored comparisons remain unavailable. The observed synthetic transport pass cannot relax those gates. Baseline availability/comparator-feasibility inventories are integrated by the parent to preserve shared ownership; their proposed status is downloaded pinned native runtime plus namespace/tool fixture verified, with PATH installation/account entitlement/live accounting/best-system scoring/parity still unavailable.
