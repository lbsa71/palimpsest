# Linux candidate isolation prerequisite

Status: implemented with disposable Linux acceptance and macOS regression evidence, 2026-10-10; frozen source review and production migration acceptance are separate gates. This is an explicitly authorized prerequisite for the dedicated Ubuntu 24.04 x86-64 account, not approval to install a service or admit a release. Requirements R17–R19, P05; existing contracts: [isolation](../isolation.md), [worker sessions](../supervised-workers.md), [ADR 0009](../adr/0009-local-enforcement-and-recovery.md), [ADR 0023](../adr/0023-supervised-read-only-worker-sessions.md), [ADR 0024](../adr/0024-serving-responsive-candidate-collection.md). The consequential Linux choice and packaging are recorded in [ADR 0028](../adr/0028-prepared-linux-isolation.md).

## Problem and selected behavior

The original launcher hard-requires macOS Seatbelt. Linux refuses even a valid scoped computation. Merely replacing the launcher with Bubblewrap would leave executable files in readable/writable trees executable and would not preserve default process-creation denial. Those are mechanical candidate restrictions, not prompt policy.

Keep the public finite-job/session interfaces and ownership, capture and deadline contracts. Linux x86-64 now requires Bubblewrap user, mount, PID, IPC, network and UTS namespaces, a fresh environment, explicit read-only source/tool/library mounts, writable scratch grants and a read-only synthetic root. The selected program becomes namespace PID1; the public ChildProcess PID is the outer Bubblewrap monitor. Required setup capabilities exist only inside the new user/mount namespace and are removed from the effective, permitted, inheritable, ambient and bounding sets before candidate execution.

The separately prepared native launcher marks source/read/scratch mounts recursively noexec, clearing noexec only on final exact executable file binds. Landlock ABI >=3 restricts executable inodes plus writes/truncation and cross-directory rename: finite scratch gets the write and REFER rights, a session gets no writable scratch, and `/dev/null` retains its existing write allowance. The ELF interpreter must have an exact EXECUTE rule for dynamically linked Node to start. Its fixed read-only system-library visibility remains an explicit runtime allowance; this does not claim that every executable ELF already installed under that library root is unreachable through the interpreter. Candidate-written source/scratch ELF is denied both directly and through the interpreter, including executable mmap from those noexec mounts.

Architecture-checked seccomp rejects alternate syscall ABIs, network creation/use, namespace/mount manipulation, process inspection escape APIs, anonymous executable-file and related bypass APIs, process-group/session changes and removal of Bubblewrap's parent-death watchdog. Default clone admits threads only; clone3 returns ENOSYS for libc's inspectable clone fallback. The explicitly trusted child exception retains the namespace/executable restrictions. This is not a general syscall allowlist. Missing prepared inputs or required kernel confinement fails before candidate execution; there is no unconfined fallback.

Read exclusions hide original bytes, imports, metadata and enumeration even inside broad readable grants. A bounded synthetic read-only projection omits excluded subtrees from every overlapping grant. An exclusion overlapping a writable grant is rejected before launch because this slice does not claim read denial of a mutable excluded inode. Grants and installed executable hashes remain trusted host input.

## Acceptance criteria

1. Establish an actual Linux failing positive computation on original source, then pass it with the backend; retain external logs and exact source/tool/kernel pins.
2. Exercise real granted computation, reads, writes, stdin, fresh environment, V8 threads and hash-bound trusted execution. Private reads, protected/source writes, aliases, excluded computed imports/metadata/enumeration, network, default fork and candidate-owned ELF must fail without changing protected fixtures.
3. Trusted children retain executable fencing. Timeout, cancellation, output and observer failure hold positive ownership until actual drain. Ignored descendants cannot keep writing after return. Persistent sessions cannot write source/HOME/TMPDIR or gain network/fork authority; actual worker descriptors, checkpoints, requests and stop remain usable.
4. Missing/tampered prepared identity, invalid tool digest and unavailable confinement refuse without fallback. Existing macOS isolation/worker checks and TypeScript remain green. No check, parser, grant, budget, Custodian or original deadline is weakened.
5. Fixed helper identity includes Bubblewrap, launcher C/ELF/receipt and the Linux module. Actual collector/compiler checks retain negative outcomes. Retained monitor recovery and uncertain worker drain need explicit proof before custody can treat a process as stopped.

## Public interfaces and recovery

`linuxIsolationIdentity()` validates the fixed prepared inputs and returns exact paths for Bubblewrap, ELF, C, receipt and Linux module. `linuxIsolationRuntimeIdentity()` returns source/binary/receipt SHA-256 roles without absolute paths. New Linux candidate runtime manifests bind these bytes; historical Darwin manifests remain distinct. CandidateJobs includes all these prepared inputs in its original installed collector identity.

`matchesLinuxIsolationMonitor(pid, descriptor)` reconstructs the entire exact Bubblewrap argv from the trusted Node, harness/release arguments, current scope/read denials and validated owner-only scratch. `session` defaults to true; false reconstructs the existing finite worker's writable scratch. Wrong argv or a missing/changed prepared identity cannot match. It does not infer Node identity from the outer monitor. `stopLinuxIsolationMonitor(pid, descriptor)` revalidates that identity and detached PGID, then signals its captured group and awaits bounded group ESRCH proof. An uncertain observation or remaining group rejects stop. Signal success and monitor disappearance are insufficient.

Root integration shares `workerLaunchDescriptor` with retained recovery, preserves isolation-completion rejection in AgentWorker.stop, and holds retained custody when group absence cannot be confirmed. The original exclusive Custodian, epoch fencing and mechanical recovery are unchanged. No arbitrary persisted PID or marker alone authorizes signalling. Bubblewrap's parent-death watchdog eventually tears down namespace PID1 and its descendants, but teardown is asynchronous; the separate group proof must still complete.

## Prepared build contract and dependencies

The reviewed tracked source is `trusted/linux-isolation-launcher.c`. A trusted producer builds outside candidate execution:

```sh
umask 077
cc -std=c11 -O2 -Wall -Wextra -Werror -fPIE -pie \
  -Wl,-z,relro,-z,now trusted/linux-isolation-launcher.c \
  -o trusted/linux-isolation-launcher
```

A sibling `trusted/linux-isolation-launcher.json` binds `{version:1,arch:"x64",sourceSha256,binarySha256}` to the exact bytes. Runtime never compiles, installs, searches an environment-selected path or accepts an alternate launcher. Missing, symlinked, nonregular, writable-by-other-users or inconsistent prepared inputs make confinement unavailable. A receipt is a byte binding, not independent proof of compiler correctness.

For the root-sealed projection `/opt/palimpsest/hosts/<releaseDigest>`, the producer explicitly copies the matching prepared ELF/receipt beside the tracked C after Git projection, seals C/receipt 0444 and ELF 0555 with root-owned non-writable parents, and includes all three in the host checksum. The runtime account must read the source/receipt. The binary and receipt are generated native inputs, not tracked Git products. The trusted producer owns build provenance, packaging and installation. Runtime starts with the existing explicit PATH/HOME/TMPDIR/LANG/NO_COLOR plus the unchanged allowed environment keys; there is no retained host environment or loader injection.

Actual tests use direct `palimpsest@ssh.lbsa71.net`, existing Node `/home/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`, Bubblewrap 0.9.0 and installed GCC13.3.0. All target writes are under `/home/palimpsest/isolation-test-20261010-linux-backend`; source is in `host/`, private fixtures in sibling `runtime-tmp/`, receipts in `evidence/`. This separation preserves Custodian's unchanged outside-checkout storage guard. Existing Linux dependencies were copied as trusted inputs into this disposable directory and mounted read-only for candidate execution; no installation occurred. Root/Astra own production packaging, state migration and cutover.

## Verification record

External local evidence root: `/tmp/palimpsest-linux-isolation-evidence`; the copied private JSON receipts are under `receipts/`, with exact source/native/tool/kernel bytes in `receipts/linux-fixture-pins.json` and evidence hashes in `evidence-pins.json`. Original source for RED is Git `1748fbb`.

| Check | Actual result | External receipt SHA-256 |
| --- | --- | --- |
| Original Linux positive computation | RED 0 pass / 1 fail; Seatbelt-only unavailable | `red-linux-positive-actual.tap`: `82b21abf09657336cf262b914328f3dcce6a5321ae37a86754fc62cf95e248df` |
| Original retained-worker matching with new backend | RED 0 pass / 1 fail; mechanical reconciliation required | `linux-generation-recovery-intended-red.tap`: `9f13aef86d3225f1accf3556e958377402716f118f12a485cfe4a6472153a669` |
| Original swallowed drain failure | RED 0 pass / 1 fail; expected stop rejection missing | `worker-drain-failure-red.tap`: `d18d6e7934470a1e199e74a27211bb0879e6b671b65faa363f98b70932dce3f3` |
| Final actual Linux backend, collector and recovery closure | GREEN 15 pass / 0 fail / 0 skip; 28399.438ms | `linux-final-integration.tap`: `a46e1388fd8324cd816905f22d4ad12fa47a207f51339981b8f8aed36fce1eb8` |
| macOS isolation/ownership/executor/session/group/worker/relocated-host closure | GREEN 75 pass / 0 fail / 16 platform skips; 6210.15ms | `macos-final-regression.tap`: `12ef99675284f7f59a73d512e1b61562103addff267b620467aa81df2cc7a716` |

Linux positives include scoped stdin/read/write and cross-directory scratch rename, V8 threads, exact trusted executable hash, actual worker request/checkpoint/probe and five actual fixed collector jobs. The accepted candidate passes unchanged compiler/cognitive checks; a wrong typed candidate fails TS2322. Every recorded outer/nested collector process is drained, and installed-file pins cover all prepared Linux inputs.

Negatives cover private/protected/source/device/proc writes, aliases, projected exclusions, fresh environment, network/default fork, candidate-owned ELF via direct exec and loader, unavailable prepared identity, nested namespace creation, x32, removed capabilities, parent-death-watchdog removal, setsid/setpgid and namespace clone even in trusted-child mode. Directly observed host descendant PIDs disappear and writer bytes remain stable after normal return and monitor-only death. Finite/session monitor descriptor matching is real, and retained recovery starts a new fenced epoch without inference or task creation. A separate EPERM observation fixture proves actual termination cannot conceal uncertain drain.

Early failed fixtures remain in the external logs: initial inherited cwd caused pre-harness EACCES; Node24's experimental execve refusal terminates with a native diagnostic instead of throwing a catchable JS error; libuv ignores setsid refusal for detached children, so the actual group is asserted; a missing `--` caused the marker to be parsed as a Node option. Recovery initially put state inside staged source and then used a prompt that failed the unchanged health contract. These are recorded failures, not counted RED or passes. After corrections the intended RED and final GREEN above ran. TypeScript and diff whitespace checks passed separately.

Actual pinned Linux platform: x64, kernel `6.8.0-146-generic`, Node24.13.0 SHA `53fb205ae78805130177e24bcb459a69a1518c8d98f8965f31d85aae7ea840fc`; Bubblewrap SHA `e318903862396f96de3df57264e0158682b952fd3fb53ac23d876413e7b30f71`; GCC binary SHA `1b99826121ae6682a634e5efe09bd3e3df58ce58e0b28f849114ab5b89139c26`. Prepared C SHA `bcd69afd561b261fe51c3fdc309dd5c396723aa70e9ca22e7b82cba4402e3ad7`, ELF SHA `8b6df4616119352c0a877e43439d7e8cffd1198d830c382879c939d1b630f819`, receipt SHA `4c690848ea0e65c921685526970d526facee5323eb54339bdc167bfb6dd1c875`.

## Non-goals, limits and remaining gates

Fresh source review resolved three stop/reconciliation findings and found no
remaining blocker in this bounded prerequisite. A separate reviewer reran the
exact frozen three-file suite on the disposable destination: 15 passed, zero
failures/skips (19259.818 ms). All source/native/tool pins were unchanged before
and after. Independent evidence is retained outside Git under
`/tmp/linux-isolation-independent-review/`; the original result hash is
`229400b8507f60961f36c31bd8aabb64557675d6b604f1df5851502ef82eafe0`.

No dependency installation, service management, remote provider calls, operational-state migration, publication or release approval occurred. No evaluator/Custodian/parser/check weakening or budget/deadline change. This does not claim general commands, full source release admission or full autonomy.

The supported and actually exercised target is Ubuntu24.04 Linux x86-64 with the stated kernel, required mount_setattr, unprivileged namespaces, Landlock ABI>=3 and seccomp. Alternate architectures and kernels are not acceptance passes; they must meet the explicit feature checks or refuse. No kernel-feature removal or non-x86-64 machine was configured here. This is a filesystem/network/process boundary, not a VM, complete syscall allowlist or hard CPU/RSS/disk quota. Existing finite wall-time/output bounds and persistent protocol bounds remain.

The fixed read-only loader/library roots are wider than an exact selected-entrypoint list. Trusted host mutation, hostile same-user administrators, kernel exploits, trusted build/compiler supply chain, read-projection races and inherited kernel assumptions remain outside this slice. Production root sealing, changed absolute runtime/storage roots, final manifest/native receipt pins, continuity migration, independent frozen review and service acceptance require their own evidence. These disposable witnesses do not authorize or prove production cutover.
