# A1-L08-T02 native baseline kernel rehearsal

2026-10-11. Finite engineering qualification by `/root/a1_atomic_start_review`, worktree `/home/palimpsest/migration/aeon-1-20261011/baseline-kernel`, branch `codex/a1-baseline-kernel-20261011`, base `3a06cdc`. Scope: `evaluations/baselines/run-codex.ts`, its test, and this evidence. Shared resource enforcement, observer, native worker, application code, dependency closure, grants and policies were not changed. Root approved the contract and serialized the disposable mount/cgroup window. A finite tool goal was created without a token budget.

**Result: the actual kernel-profile path passed with the installed native Codex CLI, code-mode helper, real command execution and synthetic provider transport.** This closes the specific kernel composition gap in [baseline observer review](baseline-observer-review.md), subject to the limits below. It is not a paid run, calibration result, model-competence result, comparator parity, H1 acceptance or production deployment.

## Change and frozen identities

The fixture provider now accepts optional `resourceLimits`. Both fixture and paid transport pass that profile through exactly the same existing `runWorker`/`spawnBounded` path. Paid transport still requires an explicit profile and credential; no credential discovery was added. The immutable manifest records `providerTransport: fixture|openai`, the profile, and either `namespace-fixture` or `kernel-profile`. Synthetic transport with kernel enforcement therefore remains explicitly identifiable as synthetic.

Implementation `1dad643900b29b3dad51d5f4342c43fd4a54de9f`; fixture corrections `ca8ab1e` and **`dff58aed4d195caae73872e809aa59a8638e939a`**, the exact final tested source. The latter changes only the native tool's wait for its result, inside the unchanged total allowance. This evidence commit follows without source changes.

| Component | Identity |
|---|---|
| Native CLI | Codex 0.162.1; SHA-256 `628e35487d888a28f0427fc37501da529dd3d81fcbad7a2c3421c1e8670d92e1` |
| Code-mode helper | SHA-256 `ec71830690a7c0024916ee0c99fbdc635bc6e747ff665ea4f03a8389bbcb6b30` |
| Node | v24.13.0, `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`; SHA-256 `53fb205ae78805130177e24bcb459a69a1518c8d98f8965f31d85aae7ea840fc` |
| Dependency lock | SHA-256 `cc2956d305c7bbb1be7d58bde7b1d257ff8329ca73d55d1cfb8ee92d2712efc0`; TypeScript 7.0.2, trusted ignored link to the root development closure |
| Final durable manifest | `1f5d9f43edb4c9c3fa51bed00ff38d7c9cccf80024ff620d1a90d9d3f86701cd` |
| Final durable invocation result | `5f9078983cae19923bf5f4efb0daa063328e0cb6b568b6829f7e42121f5a078c` |

## Actual boundary exercised

The disposable service used UID 1006/GID 1008, delegated cpu/memory/pids, `MemoryMax=2G`, `MemorySwapMax=0`, `TasksMax=256`, `CPUQuota=200%`, `RuntimeMaxSec=75`, `KillMode=control-group` and a five-second stop timeout. The trusted observer stays in the host leaf; native worker, CLI, code-mode helper and command descendants share a separate bounded command cgroup. The test checks actual process command paths from the host, not a worker assertion about its own confinement.

The command profile was **768 MiB memory, zero swap, OOM group kill, 96 tasks and 50,000/100,000 microseconds CPU quota/period**. The host read back the exact limits while each native request was active. The namespace cannot access cgroup controls. File/fd ceilings were 2 MiB/256; the existing provisioner supplied fixed ext4 capacity of **16 MiB and 128 inodes**. No workspace backing image, loop device, host state, evaluator sentinel or provider credential was visible to the native tool.

The first synthetic Responses reply instructed the genuine native command tool to:

- Fork bounded detached sleeps until the shared cgroup refused further processes with `EAGAIN`, then kill and wait for every child.
- Touch a 16 MiB allocation and perform a CPU workload; host observations confirmed the configured memory cap and actual CPU throttling.
- Fill the fixed workspace until block allocation returned `ENOSPC`, remove those files, then exhaust inodes and observe `ENOSPC` again, followed by cleanup.
- Verify absence of the external evaluator sentinel and provider API keys, write `proof.txt` and print the success markers.

The second captured request had to include the actual terminal command output, including every refusal marker. Only then did the fixture return a final reply. The host independently checked `proof.txt`, the unchanged private evaluator sentinel, exact pre-/post-accounting native input/instructions and both durable usage records. The completed invocation's unchanged grant was refused on replay; no extra fixture transport request occurred.

Final host observation: memory peak **89,518,080 bytes**, **2 pids-limit events**, **1,144,694 CPU microseconds**, **1,594,161 throttled microseconds**. These are observations during the second request, not a claim about an inaccessible final lifetime counter. This native case did not deliberately cause an OOM; aggregate OOM behavior is separately covered by the existing [resource review](../A1-L09/resource-review.md).

The original host-private synthetic grant remained **2 requests, 400,040 reserved tokens, 1 synthetic USD, 30,000 ms total, concurrency one**, with 15,000 ms per request. Its large token reservation derives from the pre-existing fixture's 200,000-token input-context ceiling, not actual token use or paid authorization. Each completed synthetic attempt reported 100 input/10 output tokens and 0.00023 **synthetic** USD; actual paid requests and spending were zero. The grant's original start time and allocation remain persisted and cancelled at close; retries cannot reset or reuse it. All three separately recorded engineering trials together made five synthetic transport attempts.

## Preserved failures

Trial 1 at `1dad643`: nine ordinary checks passed and the kernel case failed before tool execution. The fixture expected `/proc/PID/comm` to report `node`, but Node 24 reports `MainThread`. The correction checks the exact `/runtime/node /app/codex-worker.mjs` command instead, a stronger process identity check. Its single synthetic attempt remains uncertain in that trial's private ledger.

Trial 2 at `ca8ab1e`: the native resource command actually exited zero and produced PID/block/inode refusal markers, but its configured one-second tool wait yielded a running session before the second synthetic response. The two-reply fixture correctly refused to invent terminal output. The first usage settled and the second attempt remains uncertain. The correction waits up to ten seconds for this slower throttled command, without increasing the 30-second total, request count, memory, CPU, PID, token or money ceilings. This is test orchestration, not a relaxed outcome check or an automatic model retry.

All failed trials retained their TAP, immutable source revision, private ledger and cleanup record. No failed outcome was replaced or counted as a successful comparator result.

## Reproduction and checks

The external exact harness is `/home/palimpsest/migration/aeon-1-20261011/baseline-kernel-evidence/run-kernel-trial.sh`. It traps exit, stops the disposable unit, invokes the existing workspace remover, and checks absence of the unit, cgroup, mount, loop association and volume directory, including on assertion failure. Its substantive commands, from the frozen review worktree, are:

```sh
sudo -n /opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node packages/supervisor/provision-workspace.mjs create /var/tmp/aeon-baseline-kernel-trial-3 1006 1008 16777216 128
sudo -n systemd-run --unit=aeon-baseline-kernel-trial-3.service --wait --pipe --collect --property=User=palimpsest --property=Group=palimpsest --property='Delegate=cpu memory pids' --property=MemoryMax=2G --property=MemorySwapMax=0 --property=TasksMax=256 --property=CPUQuota=200% --property=RuntimeMaxSec=75 --property=KillMode=control-group --property=TimeoutStopSec=5 --property=WorkingDirectory=/home/palimpsest/migration/aeon-1-20261011/baseline-kernel --setenv=AEON_CODEX_KERNEL_WORKSPACE=/var/tmp/aeon-baseline-kernel-trial-3/work --setenv=AEON_CODEX_KERNEL_EVIDENCE=/home/palimpsest/migration/aeon-1-20261011/baseline-kernel-evidence --setenv=AEON_CODEX_FIXTURE_BINARY=/home/palimpsest/.codex/packages/standalone/releases/0.162.1-x86_64-unknown-linux-musl/bin/codex /opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test-reporter=tap evaluations/baselines/run-codex.test.ts
sudo -n /opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node packages/supervisor/provision-workspace.mjs remove /var/tmp/aeon-baseline-kernel-trial-3
```

Trial 3: **10 passed, zero failures/cancellations, one explicit namespace-only opt-in skip**; kernel case 12.776 seconds, suite 12.830 seconds, transient service 13.063 seconds, exit zero. The skipped separate namespace fixture is not part of the passing kernel claim. Final light command `node --test evaluations/baselines/observer.test.ts evaluations/baselines/run-codex.test.ts`: **42 passed, zero failures, two explicit native opt-in skips**, 2.031 seconds. `node node_modules/typescript/bin/tsc --noEmit` and `git diff --check` passed. Here `node` is the absolute Node 24 binary above.

Evidence directory `/home/palimpsest/migration/aeon-1-20261011/baseline-kernel-evidence/` contains `trial-{1,2,3}.tap`, source/volume/cleanup records, final light output and each private fixture directory. Final private state is `aeon-baseline-runner-dYnKPr/state/observer.sqlite`, with exact captured manifests/requests/responses/results; adjacent `kernel-observations.json` and `durable-summary.json` summarize the host observations and settled records. Every trial's cleanup reported unit `LoadState=not-found`, `ActiveState=inactive`, and no residual cgroup, mount, loop or volume.

## Remaining limits and handoff

The host still supplies a read-only `/usr` tool set that is not individually sealed, and mounts its hashed Node path. This rehearsal does not require or claim a rebuilt host OS or complete immutable host-image closure. Paths assume a trusted stable host; hostile same-UID mutation is outside the existing boundary. The native `/tmp` helper-alias warning remains; the code-mode helper and command path were actually exercised, but other helper-dependent behavior remains unqualified.

No provider credential was read, no external provider was contacted, and no production unit or service was changed. Live entitlement, trustworthy real-provider pricing/context contracts, held-out workload independence, calibrated comparisons, Claude Code access and H1 remain open under protocol v2. Root owns final integration/fresh review and any broader qualification. The finite kernel composition goal is complete at the evidence handoff, without claiming those broader gates.
