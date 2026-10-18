# External coding limb — 2026-10-18

Implemented and exercised through the ordinary `AutarkApplication` runtime. Codex CLI is the default coding provider; Pi remains an explicit option. The continuing mind chooses tasks, receives observations and judges evidence. Coding uses separate worker instructions and does not become the mind's identity or conversational voice.

Scope: [L06 coding claim](../../lanes/A1-L06-tools-and-delegation.md#coding-limb-claim--2026-10-18), requirements RW13/RW17. Base revision `d9a1b08b5c62d9fb5e90f7f6de3d37859dbccf76`; exact handoff is the commit containing this record. This is implementation and test evidence, not a deployment of the pilot service or completion of the hibernated Aeon backlog.

## Commands and configuration

The mind receives three commands alongside its existing explicit speech action:

```text
code({"message":"Inspect the source, implement the requested change and run relevant checks."})
code_status({"offset":0,"limit":20})
code({"sessionId":"<sessionId returned by code>","message":"Clarification: also handle empty input. Adjust and rerun the checks."})
code_cancel({})
```

`code` durably queues a finite message and returns promptly. Completion wakes its waiting owner with an attributed observation. `code_status` exposes the reply, paginated CLI events, exit status, per-turn usage, cumulative native totals and an artifact reference containing exact arguments/prompt, JSONL stdout and stderr. History retains earlier result artifacts. The mind can inspect command and edit events before requesting another adjustment. `code_cancel` stops the current turn and preserves the session and partial evidence; it does not undo edits.

Use `source_checkout` first when the coding task needs the accepted source. The original workspace is retained across later messages in the same conversation. Parent workspace mutations are blocked while coding is queued, running or uncertain. The worker has no speech, release or delegation tools.

Frozen application configuration accepts:

```json
{"coding":{"provider":"codex","timeoutMs":900000,"maxOutputBytes":2000000}}
```

Omitting `coding` selects Codex with those defaults. The user's live follow-up pins Codex to `gpt-6.1-sol` at `high` reasoning effort. Both start and exact-session resume pass those settings explicitly with user config ignored; application configuration rejects another Codex model. Timeout cannot exceed 30 minutes and output cannot exceed 8 MB. Each invocation is shortened to the remaining ancestor allowance, including process cleanup headroom. `{"coding":{"provider":"pi"}}` explicitly selects the existing accounted Pi broker and its configured mind model profile. There is no automatic provider fallback. The mind model configuration is independent of the default coding choice.

Production host bindings must supply canonical `codexBinary` and `codexHome` together, with optional `codexCodeModeHost`. Provision a separate owner-private coding home (0700) with an owner-private ordinary `auth.json` (0600), not the user's full `.codex` directory. Keep it disjoint from state, artifacts and workspaces. The service passes the frozen application's pinned `node_modules` read-only at `/app/node_modules`. Missing Codex host bindings fail before any session or external invocation is created. No credentials are stored in source, prompts or invocation receipts.

## One agent and retained sessions

`packages/coding` defines the provider/request/result/execution ports. `CodingLimb` owns one durable session record, bound to the originating conversation, disclosure scope and workspace. It admits one active turn globally. The first CLI invocation starts a native thread; every follow-up uses `codex exec resume <exact UUID>`. Reopening the application retains this identity and its usage baseline. No latest-session selection, replacement, implicit retry or provider fallback is used. A lost running outcome becomes uncertain and requires host inspection before further execution.

The CLI runs with `agents.max_threads=1`; multi-agent features, hooks, apps and plugins are disabled. Explicit worker instructions prohibit creating subagents, forking or invoking other agent CLIs even when project instructions request parallelism. The host launch uses Linux namespaces, a bounded process tree, a sanitized environment and finite deadline/output limits. Native tool network access is disabled and managed policy denies reading the authentication file. The inference process has network access for its own provider transport. Controls and state are not mounted in the worker's workspace.

Native sandbox operation requires the Codex executable and launcher files to remain visible. These controls do not constitute a separate executable allowlist or an independent audit of the upstream sandbox. An unauthenticated nested process could start, but native tools cannot read the provisioned credential or reach inference endpoints. Unexpected collaboration events are retained and make the result uncertain. The live test observed no collaboration events.

The durable child remains under its original parent allocation. Session continuation does not refresh elapsed/token/cost allowances or undo a transport-level cancellation of that parent. `code_cancel` is the supported resumable interruption. A terminally cancelled or exhausted lineage requires explicit host resolution; it never silently starts a replacement agent.

## Actual live run and inspected failures

Private evidence root: `/home/palimpsest/migration/coding-limb-20261018/`; live fixture: `live-13uqVP/`. It contains `invocation-1.json` through `invocation-5.json`, corresponding receipts/results, `inspection.json`, `accounting-inspection.json`, `independent-checks.json`, original failure records and the dedicated native rollout history. The coding home contains private authentication and must not be committed or published.

The test used the real installed Codex CLI **0.163.0**, Node **24.13.0**, an isolated actual workspace and the ordinary durable application/effect/runtime path. Only the mind transport was scripted offline: **zero live Mistral calls**. A fresh reviewer inspected the raw evidence and independently ran the resulting tests.

All five turns used native session `01a14e4b-247b-7961-a316-6b36b62e1975`: **one initial start, four exact-session resumes**, zero observed agent-collaboration events.

| Turn | Requested work and observed outcome |
|---|---|
| 1 | Wrote `sum.mjs` and tests. Native command launch failed because the sanitized shell lacked a PATH needed to find bubblewrap. The final reply reported the failure; model-turn completion was not treated as successful test verification. |
| 2 | Same-session follow-up added finite-number validation. Commands still failed. Original receipts and failed verification were preserved. |
| 3 | After repairing the shell PATH, resumed the same agent. Actual file-inspection and test command events exited 0. An offline regression reproduces the native launch defect and validates the fix. |
| 4 | Same-session adjustment added array-container validation and corresponding tests. Actual edit and successful test-command events were inspected. |
| 5 | Final repaired implementation resumed the same agent, inspected existing files, reran tests and ran the pinned compiler. All three commands exited 0; TypeScript reported 7.0.2. No files changed. The actual ledger receipt matched the new per-turn token delta. |

Independent host execution of `node --test sum.test.mjs` passed **16/16**, with additional assertions for negative/fractional sums, empty arrays, invalid containers and nonfinite/nonnumber elements. The native sandbox's Node test output reports the file as one passing test; it is not represented here as 16 observed native test events. Host checks establish the individual cases. Final source SHA-256 values:

```text
sum.mjs       086b60b9ec37aaf0873e1943d0f6d49dae8efc482de64e256f1f46768e059afc
sum.test.mjs  101895db019ea614cd4b435bf343033b6bcefbcb7e7fc71e5c3279e7bda9424a
```

The live trace also exposed cumulative usage accounting: native `turn.completed.usage` includes previous session turns. The original four totals were 58,339/490; 89,241/894; 121,464/1,111; 155,375/1,580 input/output tokens. Charging all four as new work would incorrectly charge 428,494 tokens instead of 156,955. The implementation now persists the baseline atomically with the result and settles only nonnegative deltas. Missing or regressed baselines produce unknown charges; raw totals remain inspectable. Provider regressions use these exact observed totals and cache counts, and application restart coverage checks durable settlement.

For final live validation, the fixture explicitly reconciled its baseline from the retained fourth result; it did not rewrite the original ledger. The fifth native total was 191,227 input / 1,856 output / 176,128 cached input, and the settled fifth-turn delta was **35,852 input / 276 output / 29,568 cached input**. `accounting-baseline-reconciliation.json` and `accounting-inspection.json` preserve that distinction. Cost and physical provider request counts remain unknown: one ledger request means one CLI invocation, not one underlying inference call. No claim of free execution or precise billing is made.

An offline mind fixture also initially mishandled a compaction request during observation. `harness-compaction-finding.json` retains that failure; the repaired observer inspected the existing results without another Codex invocation. This test demonstrates the external coding path and inspection, not unassisted mind competence or matched development qualification.

## Verification and review

Use the pinned Node 24 runtime in PATH. Final command/results are recorded below; retained output lives alongside the live fixture.

```sh
export PATH=/home/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH
AEON_CODEX_TEST_BINARY=/home/palimpsest/.local/bin/codex \
  node --experimental-test-module-mocks --test --test-concurrency=1 \
  packages/coding/coding.test.ts deployment/codex-process.test.ts \
  deployment/coding-limb.test.ts deployment/coding-application.test.ts \
  deployment/coding-budget.test.ts deployment/application-shutdown.test.ts \
  deployment/coding-policy.test.ts deployment/evolution-continuation.test.ts \
  deployment/development-controls-rereview.test.ts deployment/installation.test.ts
node --experimental-test-module-mocks --test --test-concurrency=1 \
  deployment/service-process.test.ts deployment/supervisor.test.ts
npm run check
npm run build
```

Results: **90 passed, zero failed, two skipped** in the first command (`final-verification.txt`); the skips require administrator-provisioned workspace/host-data capacity fixtures. **5/5 passed** in the service/supervisor command. Strict compilation and build passed. The native launcher regression was enabled and passed. Fresh review independently passed all 55 coding provider/process/orchestration checks (including the native launcher check), then inspected the final live receipt and read-only SQLite ledger. `live-final-output.txt` records the successful fifth-turn application harness run.

Fresh review reproduced and resolved remaining-time admission, aggregate invocation reservation, cleanup-time accounting, source snapshots without `.git`, queued authority adoption, lost exception details, later-parent workspace continuity, blocked-owner wakeup, native PATH, pinned compiler access and cumulative session usage. The final reviewer also independently checked the generated files and command receipts.

The first broader run had 115 passed, 10 failed and 2 skipped. The five application failures and frozen-service startup defect reproduced on untouched base `d9a1b08`. The service test and four supervisor scenarios failed during startup because an absent `resourceLimits` was materialized as an undefined JSON field; this already-touched composition boundary now omits the absent field, and those **5/5 checks pass**. Baseline service reproduction and startup stacks are retained in `baseline-service-pWg92s/`; the four supervisor cases were rerun after repair rather than separately reproduced on baseline.

The five remaining baseline failures are in `deployment/application.test.ts`: offline recovery compares mutable elapsed/revision accounting with an older snapshot; a Slack report fixture and three OpenAI negative fixtures assume no host failure notice. The baseline Slack diagnostic confirms one intended report plus one explicit host status notice, not a repeated report. These unrelated assertions were not weakened. Reproductions are in `baseline-application-check/`, with output `baseline-application-failures.txt`; the initial complete output is `verification.txt`. This change does not claim a completely green repository suite.
