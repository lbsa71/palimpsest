# A1-L08 first native recovery acquisition

Status: pre-code preparation claim, no native launch authorized or performed. Owner `/root/a1_native_recovery`, existing ACTIVE finite goal from [native-recovery-specification.md](native-recovery-specification.md). Additional exclusive files: this procedure and `evaluations/baselines/native-recovery-physical.test.ts`. Existing assigned worker files may gain observed child-close metadata only. Review basis: repaired source `6b51c3c`, independent acceptance `8500652`, acquired-positive provenance `653aed5`; root joined through `eea7ef6`. Reviewer owns its tests/evidence. Shared runtime, store, ledger, confinement and historical records remain read-only.

This bounded unit prepares **one acquisition per product**, Codex first and Claude independently cleared afterward. It consumes neither the later interruption positive nor negative. Root expressly selected the existing namespace fixture route and excluded a new help process. Existing pinned argv/source support an attempt; unsupported flags, startup ordering, persistence, profiles or history are retained failures. Claude's existing help may be rehashed read-only. No retry, replacement grant, fallback, extra request, protocol change or enlarged cap follows from failure.

## Frozen acquisition protocol

The driver will be opt-in only, selected with `AEON_NATIVE_RECOVERY_ACQUIRE=codex` or `claude`, never both in one invocation. A root-owned clearance JSON path is supplied through `AEON_NATIVE_RECOVERY_CLEARANCE`. Before any preflight/native process, an exclusive, fsynced `attempt.json` consumes the fixed attempt directory. Existing directory/marker is refusal, never a new temporary attempt. Clearance must bind product, clean joined source revision, driver/procedure/full baseline-package source hashes, Node hash/version, actual OS platform/architecture/release/version, host-tool hashes, native closure, public-plan hash, reviewer revision and root window ID. It is a freeze check; root still assigns the physical window. No clearance exists at this preparation checkpoint.

Fixed evidence roots:

- `/home/palimpsest/migration/aeon-1-20261011/native-recovery-physical-evidence/codex-acquisition-1`
- `/home/palimpsest/migration/aeon-1-20261011/native-recovery-physical-evidence/claude-acquisition-1`

Each contains initially blank `workspace/`, blank `checkout/`, private `state/`, `protected/sentinel`, and retained evidence outside the workload. Both phases use that same persistent workspace, unchanged checkout/source/configuration and one original grant. The fixed native-created public file is `recovery-observed.txt`, containing `native-recovery-write-observed` with no newline. Phase 1 prompt asks one local write and observation; phase 2 prompt is exactly `Read recovery-observed.txt with one local command, report its observed contents and finish. Do not create agents or use external services.` It omits the previous task, marker, final and command result.

Phase 1 emits exactly one command through the acquired Codex `functions.exec`/`exec_command` or Claude `Bash` surface:

```text
/runtime/node -e 'require("node:fs").writeFileSync("recovery-observed.txt","native-recovery-write-observed");console.log("native-recovery-write-observed")'
```

Phase 2 emits exactly one command:

```text
/runtime/node -e 'console.log(require("node:fs").readFileSync("recovery-observed.txt","utf8"))'
```

Command IDs are `call_recovery_write` / `call_recovery_read` (Codex item IDs `fc_recovery_write` / `fc_recovery_read`), or `tool_recovery_write` / `tool_recovery_read` (Claude). Codex uses acquired `text(await tools.exec_command(...));`, max output 1000 and yield 1000; Claude uses acquired Bash input `{command,description:"Observe the public recovery artifact",timeout:5000}`. Second request in each phase must contain exactly that attributed successful result, in the acquired result envelope and after its actual command. Only then is public terminal `native-recovery-write-complete` or `native-recovery-read-complete` emitted. Exact SSE bytes, usage, IDs, tool arguments, prompts, responses and SHA256s are written in `declared-plan.json` before phase 1. Response formats are the unchanged acquired synthetic Responses/Messages formats; no tool/session/storage schema is invented.

Phase 1 must return exit zero, no signal/output overflow/recovery error, exactly two known successful requests, actual completed turn, drained RPCs and awaited confinement cleanup, nonempty actual native files and a durable ready checkpoint. Phase 2 consumes its exact ready reference and must expose the identical UUID before its first provider dispatch. Its first request must retain the phase-1 actual tool call/result and terminal message; the prompt cannot supply them. Absence or change of acquired history stops transport. Phase 2 requests exactly twice, observes the same file, and publishes a second quiescent checkpoint for an after-store seal; acquisition then ends without a third launch. This does not claim host interruption recovery. Ready allocation stays under its original finite deadline; no continuation beyond the frozen procedure is authorized.

## Original envelope and confinement

Both: original grant `original-{product}-native-recovery-acquisition-1`, requests 8, concurrency 4, elapsed 60000 ms, request timeout 10000 ms, output allowance 4096, cost USD100 synthetic accounting, request/response/CLI bytes 1000000. Driver independently refuses request 3 in either phase and any overlapping/child request: four total maximum, with no new ledger/framework. Codex reserves original input context 200000 (tokens 1632768), model `gpt-6-astra`, high, acquired agent-message protocol/native-helper hashes. Claude reserves original input context 1000000 (tokens 8032768), model `claude-opus-5-5`, high/adaptive, standard/global/standard, acquired native delegation beta, safe isolated mode, same-model haiku/sonnet/opus/subagent roles and original tools `Agent,Bash,Read,Write`. Prices stay input4/cached0.2/output20 per million, Claude cache-write5m5/hour8; these are synthetic fixture categories, no paid provider rates. Four known replies each bill input100/output10; exact real measured elapsed is retained.

Pre-code amendment authorized by root: the fixture runner gains an optional positive `provider.maxRequestsPerLaunch`, no larger than the original grant request ceiling. Acquisition fixes it at 2 and binds it in immutable launch identity. The host handler retains the third raw attempt/refusal and cancels the original allocation **before** `observer.handle` can reserve or dispatch that third request. Transport-only counting was insufficient because the existing observer marks dispatch before calling transport. The ledger still allocates once with its original eight requests/full-context reservation/clock; this lower per-launch admission cap creates no allowance. Paid paths reject this fixture-only option. A causal module-mock test will drive two known requests and a third attempt through the real runner/store/observer boundary and require two dispatches, unchanged original envelope, retained third bytes, cancellation and no ready checkpoint. Fresh review includes this owned-source delta.

Existing `--unshare-all` user/PID/mount/network namespace, disabled nested user namespaces, dropped capabilities, die-with-parent/new-session, read-only `/usr`, pinned Node and application closure, isolated 64MiB `/tmp`, same persistent `/work`, and clear environment/dummy bridge token apply unchanged. Private observer/lease/evidence/protected sentinel are outside. **No cgroup, CPU, memory or runtime disk enforcement claim**: 16MiB/256file/512entry native/workspace seal is bounded post-exit admission, not runtime storage enforcement. Actual kernel and host-tool identities are observed and frozen, not caller labels. Kernel-qualified comparator/recovery remains separate. Native stdout metadata may retain the actual namespace child PID and its observed close event, never infer surviving-host absence from a PID guess or lease alone.

## Evidence and failure retention

The driver preserves raw `request-N.json` and exact emitted `response-N.sse` before response dispatch, original native HTTP/session attribution from observer rows, complete effective instruction/system/tool/input bytes, manifests, native invocation/environment/stdout/stderr/exit, cleanup artifacts, original allocation/grant/budget/request revisions/charges/events, checkpoint/native/workspace byte manifests, and raw artifact bytes rehashed on export. `before.json`, `ready.json`, `resumed-ready.json` and `failure-state.json` describe each boundary with host PID/start ticks/namespaces/cgroup, lease owner rows, store rows, and opaque native/workspace files with modes/hashes/base64 bytes. The original SQLite files and any sidecars are retained and copied only while closed; audit opens databases read-only. Unsupported links/special/hardlinked files are reported without following or inventing content. Partial native bytes remain on disk when admission fails. Export failures get separate retained diagnostics and do not replace the first acquisition failure.

`instruction-audit.json` compares full raw phase-1 and resumed initial instruction/tool/control fields and retains both complete objects. Differences are never silently normalized or approved: unknown instruction differences fail acquisition. Only native historical conversation content, prompt, observed UUID/startup bytes, generation and loopback endpoint are expected launch differences; no transcript edit, restoration, effect replay, synthetic compaction or host-written substitute file is allowed. Result checks bind original grant row, one allocation, unchanged original budget start/envelope/deadline, unchanged first request rows and known actual charges, exact checkpoint revision transitions, distinct observed native launches and unchanged protected sentinel. Process metadata binds the namespace-local child PID/observed namespace to each phase's host manifest/result and generation; local PID inequality is never an assertion. `result.json` records acquisition evidence ready for independent audit; `failure.json` preserves the exact first failure. Neither is parity/qualification acceptance.

## Preparation and launch gates

Pure checks will exercise acquired command-result envelopes and causal wrong-ID/failed-exit/history omissions, two-phase request ceiling/concurrency, and one-shot marker refusal. They use no native opt-in. Strict TypeScript and whitespace checks follow serially. Source, protocol/response bytes and this procedure are frozen in a small commit, then sent to root and the fresh reviewer. Root supplies the concrete clearance and serialized window only after review. Example **future** command, never run at this checkpoint:

```sh
env -i AEON_NATIVE_RECOVERY_ACQUIRE=codex AEON_NATIVE_RECOVERY_CLEARANCE=/absolute/root-owned/codex-acquisition-clearance.json /opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --experimental-test-module-mocks --test --test-concurrency=1 evaluations/baselines/native-recovery-physical.test.ts
```

Claude needs its own clearance/window and command with `claude`; Codex outcome cannot clear it. Unknown persistence/ordering/effective instructions are unresolved acquisition gates. The actual finite engineering goal stays ACTIVE for review and acquisition audit.

## Source preparation handoff

The runnable driver is now `evaluations/baselines/native-recovery-physical.test.ts`; all native opt-ins stayed absent. Latest serial targeted check: **6 passed, zero failed, 2 physical acquisitions skipped**, 3.729s, including real store/observer/module-mock controls for valid two-phase use of the lower cap, changed-cap continuation refusal, third-attempt refusal, and caller cap mutation after first dispatch. The cap is read into one primitive before awaits and the identical validated primitive binds manifest and enforcement. Earlier targeted worker 8/8 and runner 9/9 controls passed; no broad baseline rerun was performed. Latest strict TypeScript passes. Whitespace passes.

Exact verification commands:

```sh
env -i /opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --experimental-test-module-mocks --test --test-concurrency=1 evaluations/baselines/native-recovery-physical.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

Retained preparation directory: `/home/palimpsest/migration/aeon-1-20261011/native-recovery-author-evidence`. `acquisition-bound-cap-focused.log` and `acquisition-bound-cap-strict.log` are final checks; `acquisition-evidence-index.json` records exact source/log/plan hashes. Earlier first failures remain: omitted required parser constructor arguments in initial strict; widened provider union in cap test strict; cap test incorrectly expected the private diagnostic through the intentionally generic public error; then the test incorrectly expected cancellation on budget rather than original allocation. These were author fixture/compiler mistakes, repaired without changing the public error/cancellation contracts or discarding logs. Original reviewer failures remain unchanged elsewhere.

Frozen public bytes are also exported before launch as `acquisition-codex-declared-plan.json` and `acquisition-claude-declared-plan.json` in that directory. `publicPlan(kind)` deterministically reproduces them. `acquisitionFreeze(kind)` is the read-only manifest builder for the future clean joined checkout; its binary hashing is left to root outside competing physical work. Root clearance shape is `{freeze: acquisitionFreeze(kind), reviewRevision: "<full reviewed commit>", windowId: "<root allocated window>"}`. Preserve that JSON before enabling the selected physical test. The two fixed attempt directories remain unconsumed; no clearance/window is assigned by this document.

`acquisition-frame-provenance.log` reopens original databases read-only and rehashes complete request artifacts before comparing the unchanged embedded result frame byte serialization. Codex request SHA256 `d1f1847997a383b01f7f8f2f5d27f897adf7ac3f948e9bb26befd2d7ede68f95`, source `/home/palimpsest/migration/aeon-1-20261011/baseline-kernel-evidence/aeon-baseline-runner-dYnKPr/state/observer.sqlite`; result frame SHA256 `55b0a1e94cf0e6bc1071c43ff04eaeb9debda0655774ca957d0f30b1ff7af210`. Claude request SHA256 `0034890fef03f51fdb22f5ace84c039eee068adb84a7f86f50ad7391a2e63572`, source `/home/palimpsest/migration/aeon-1-20261011/claude-handback-physical-evidence/claude-handback-followup-1-8PosR0/state/observer.sqlite`; result frame SHA256 `a8bf3590124e5295a3706b6762fee4fe26928aa0bbed3a28e8495aa760745c39`. These are previous command/delegation result witnesses, not recovery evidence. The separate constructed history controls are explicitly synthetic and do not establish native resume serialization.

Fresh review must cover the new driver/procedure, fixture cap and observed native PID-namespace/close metadata. Actual native store format/auxiliary bytes/flush, exact resumed startup ordering, effective instruction/control differences and native historical tool/final serialization remain unacquired. The driver refuses unsupported acquired behavior and preserves its first failure; no alternative history schema, normalization or extra request is authorized to obtain a pass. No actual host interruption, context reduction, kernel resource qualification, live competence, parity, growth or H1 is established. Source is frozen for review; the finite goal remains ACTIVE.

## Acquisition assertion repair claim

Fresh reviewer `e0d005a0a9f6222475eb084380cf3dfd748eb204` withheld clearance at source `482d517`. Six causal controls prove that the matching-ID witness overlooked a foreign command or failed result in both products, and accepted a retained final before its original command/result. Original reviewer logs `acquisition-review-causal.log` and `acquisition-review-extended.log` remain immutable. Its frozen controls also require valid ordered write/final/read/result history for both products; no actual native acquisition was run.

Pre-code bounded repair: modify only this driver/procedure. Verify complete ordered allowed call/result sets on each request: empty initial write request; write call then successful attributed write result on request 2; write call/result/final on resumed request 1; that same history followed by read call/result on resumed request 2. Foreign/duplicate calls/results, unsupported operation types and wrong roles fail. Final must follow the successful original result and precede a later read. Existing acquired result envelopes and public response bytes remain unchanged. Reproduce exact reviewer failures, add author phase/ordering/duplicate/role/type controls, then serial targeted checks and strict only. Ordinary observer, transport, native schemas, ledger/caps/runtime/worker source stay unchanged. Freeze the source for renewed same-reviewer clearance; goal remains ACTIVE and root's physical window is still required.

### Safe initial freeze preparation

Importing this `.test.ts` registers tests: Node runs its pure checks even without `--test`. They create and remove temporary marker fixtures. The cap module-mock test skips without its experimental flag; both physical cases skip without an acquisition flag. This read-only freeze preparation uses `env -i`, passes no acquisition flag or module-mock flag, writes JSON to a dedicated file rather than mixed JSON/TAP stdout, and asserts that **both fixed acquisition directories remain absent**. Run only on the clean frozen/joined source, outside competing physical work because pinned binary hashing reads the complete closures. This is preparation, not a native launch or root window assignment. Root independently adds the accepted `reviewRevision` and allocated `windowId` to form clearance.

```sh
env -i /opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --input-type=module - codex /home/palimpsest/migration/aeon-1-20261011/native-recovery-physical-evidence/codex-preparation-freeze.json > /home/palimpsest/migration/aeon-1-20261011/native-recovery-author-evidence/codex-preparation.log 2>&1 <<'NODE'
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
const product = process.argv[2], destination = process.argv[3];
assert.ok(product === 'codex' || product === 'claude');
const paths = ['codex', 'claude'].map(kind => `/home/palimpsest/migration/aeon-1-20261011/native-recovery-physical-evidence/${kind}-acquisition-1`);
const untouched = () => { for (const path of paths) assert.equal(existsSync(path), false, `Acquisition directory already exists: ${path}`); };
untouched();
const { acquisitionFreeze } = await import('./evaluations/baselines/native-recovery-physical.test.ts');
const freeze = acquisitionFreeze(product);
mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
writeFileSync(destination, JSON.stringify({ freeze }, null, 2), { flag: 'wx', mode: 0o600 });
untouched();
process.on('exit', untouched);
NODE
```

The analogous initial Claude preparation substitutes `claude` and its own dedicated output/log path. After Codex's actual attempt, a separately authorized Claude preparation must preserve Codex's immutable marker and assert only Claude remains unconsumed; the initial both-absent command deliberately refuses reuse then. No freeze-preparation command has been run by this author; fresh reviewer will independently verify the safe import behavior before clearance.

## Root's first Codex acquisition — retained failure

Root joined the repaired author and fresh procedure review at clean `154df3df32938d10ab31cbe2e5642cddfd177612`; strict compilation passed. Fresh review `a16603425cc341c11b0f58b985484f96ce77852c` cleared one bounded Codex acquisition. Root's clean-environment preparation ran seven pure checks with three skips, left both fixed attempt directories absent and persisted `codex-clearance-154df3d.json` before selecting the physical flag. The actual command and exact environment are retained in `codex-root-execution-plan.json` under `/home/palimpsest/migration/aeon-1-20261011/native-recovery-physical-evidence`.

The single actual run started `2026-10-11T23:35:52.910761Z` and ended `23:36:11.729104Z`: eight pure checks passed, the Codex physical check failed, and the unselected Claude check skipped. Original exit was one, with no outer timeout; source remained clean and unchanged. Transcript SHA-256 is `9d9514710838d346f8d734d9c884e1c819d32721f30b92a1e373a1d9da78f657`. `codex-acquisition-1/` remains the consumed immutable attempt; no retry or replacement allowance was issued.

The first native launch wrote the declared file, completed two known requests and published readiness. A second launch resumed the observed same session `01a12d52-c5b4-7910-b45d-25b84c4cc33e`; its first actual payload passed the original-history check, then the full instruction/control comparison refused changed `client_metadata.root_turn_id`, `turn_id` and `x-codex-turn-metadata`. Root's initial read-only comparison found differences only in those three metadata fields. This is an acquired difference requiring classification, not permission to normalize it or reclassify the failed attempt. The read command and final completion were not reached.

The first two requests retain 220 known tokens and synthetic cost $0.0012. The third request `aeb87259-af67-4987-8c2d-97867768e51f` is uncertain, with its original 204,096-token, $0.88192 and 10,000-ms reservation held. The original allocation is cancelled; the first checkpoint remains consumed/running and no resumed-ready checkpoint exists. The lease table is empty. The failure snapshot additionally reports an unsupported workspace entry; original workspace/native bytes are retained without following that entry. A read-only process inspection found no surviving process for this attempt. Fresh review is auditing original artifacts, metadata attribution, native exit/cleanup and the unsupported entry. Actual resumed completion, distinct-host interruption, negative recovery, kernel qualification, context reduction, live competence and parity remain unqualified. Claude's separate attempt is still unconsumed.

### Ordered witness repair checkpoint

Pre-code claim `58069ac` and frozen reviewer controls `e0d005a0a9f6222475eb084380cf3dfd748eb204` bound this repair. The exact reviewer file (SHA256 `ebe445ba82f3fac6cfdcaf23c8e2acd7bd1b0584f60003fbf0ff4a76d930a30c`) was copied temporarily, run without modification, and removed from the author worktree. Original author reproduction is retained in `acquisition-review-reproduction.log`: 9 passed, all six causal mutation controls failed. The immutable original independent logs remain in the reviewer evidence.

The complete command/result witness now rejects extra, duplicate, foreign, wrongly typed or wrongly attributed operations. Resumed request 1 requires the ordered original write/result/final history and forbids a current read; request 2 requires the same history followed by the exact read/result. Successful result envelopes remain the acquired ones. New author controls first prove valid empty/write/resumed history for each product, then reject twelve individual phase, ordering, duplicate, foreign, role and type mutations. Public prompts/SSE bytes, ordinary runtime, observer, ledger, cap, workers and native schema remain unchanged.

Final serial focused check: **23 passed, zero failed, 2 physical acquisitions skipped**, 4.946s, covering the original seven reviewer runtime controls, all six new regression controls, both valid ordered read-history controls and eight author checks. Strict TypeScript passes. Commands:

```sh
env -i /opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --experimental-test-module-mocks --test --test-concurrency=1 evaluations/baselines/native-recovery-review.test.ts evaluations/baselines/native-recovery-physical.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

Retained final logs are `acquisition-ordered-repair-focused.log` and `acquisition-ordered-repair-strict.log` in the author evidence directory; the new `acquisition-ordered-repair-index.json` binds this source checkpoint without replacing earlier indexes. Safe initial freeze preparation is documented above but has not been run by this author. Both fixed attempt paths remain absent, no native/help process ran, and no physical clearance is claimed. The actual finite goal remains ACTIVE for renewed independent source/procedure review and root window assignment.
