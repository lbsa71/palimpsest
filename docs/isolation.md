# Local candidate isolation

Status: P05 implementation contract with a bounded Linux migration refinement,
2026-10-10. This work addresses the local process boundary; it does not by itself
complete Skin Shed or release admission. See the
[Linux work item](work-items/linux-candidate-isolation.md) for exact verification.

The problem is that a candidate running as an ordinary child process inherits the operator's filesystem and network access. Candidate tests must execute with mechanical restrictions that protect external lived experience and credentials even when candidate code ignores its instructions.

The initial macOS implementation uses `/usr/bin/sandbox-exec` with a deny-by-default Seatbelt profile. Only the configured Node executable, necessary OS libraries, explicit read paths, and disposable scratch paths are accessible. The root directory itself is readable because this host's dynamic loader requires it; this does not grant recursive root access. Metadata-only access to the exact ancestors of allowed paths lets Node resolve file entrypoints. `/var`, `/tmp`, and `/etc` receive metadata access for their standard macOS symlinks. Network and arbitrary executable launches are denied. Unsupported platforms or a missing sandbox executable fail closed.

Acceptance criteria are actual subprocess checks: allowed computation and explicitly permitted reads/writes succeed; private fixture reads, repository/state writes, networking, and shell execution fail; inherited credentials are absent; time and output limits stop execution. Every check uses disposable fixtures outside the checkout. A bounded direct probe on this macOS host established that a narrow profile can boot Node without a general home-directory, host-filesystem, or Mach-service grant.

The public API is `runIsolated({ program, args, cwd, readPaths, writePaths, env, stdin, timeoutMs, maxOutputBytes, signal, allowNodeChildren, trustedExecutables })`. By default the program must resolve to the current trusted Node executable. A trusted coordinator can additionally grant an installed toolchain executable with its expected SHA-256 digest; the digest is checked before launch. This narrow exception supports the installed native TypeScript 7 compiler. Candidate content never chooses these executable grants. The caller supplies a readable working directory, explicit additional reads, and explicit scratch writes. Environment comes from a small allowlist, not the parent process. The return value reports process exit/signal, bounded stdout/stderr, timeout, cancellation, output-limit termination, and elapsed time. A nonzero exit never counts as passed verification.

For a finite job using a private pipe, the trusted supervisor can provide `onSpawn(child)`, `onStdout(Buffer)`, `onStderr(Buffer)`, and `keepStdinOpen: true`. These hooks permit JSON-lines RPC and PID binding without widening filesystem or network authority. The same aggregate output and lifetime limits remain active; observers receive only bytes within the capture limit. Hook exceptions terminate the child and reject the call. These finite-job hooks are not the default persistent worker lifecycle. `AgentWorker` now uses the separately typed `runIsolatedSession` below; explicit trusted finite `lifetimeMs` still selects the finite branch.

Observer failure now requests termination immediately but waits for actual child `close` before rejecting and cleaning scratch. The original observer error is retained; timeout/cancellation remain active through draining, and later observer callbacks are suppressed. Three repeated real-process checks first reproduced premature rejection and then passed after the fix. This supports the [file workspace](workspace-primitives.md)'s ownership lifetime; it proves direct-child draining, not cleanup of deliberately detached descendants under the explicit child exception.

`runIsolatedSession` requires an owner AbortSignal and synchronous PID/stdout observers. It admits only current trusted Node and host-selected read-only paths; no write/child/executable/finite-timer override can be supplied. Disposable HOME/TMPDIR are not writable. Stdout is delivered only to the bounded/correlated worker protocol parser without retained lifetime capture; stderr retains its cumulative diagnostic ceiling. Owner cancellation, protocol/observer failure or stderr overflow kills and drains the actual child. Finite jobs retain their wall-time and combined output capture behavior. The [worker reliability work item](supervised-workers.md) distinguishes accelerated-clock evidence from the pending live observation, and [ADR 0023](adr/0023-supervised-read-only-worker-sessions.md) records the lifecycle choice.

`AgentWorker` separates cold process/module startup from ordinary RPC deadlines. The initial handshake allows 3000 ms by default (`startupTimeoutMs`); requests, checkpoint delivery and health probes use `rpcTimeoutMs`, also 3000 ms by default. A short probe deadline therefore does not reject a healthy cold start, and a slow startup cannot extend later request deadlines. Both limits must be positive finite integers within the timer range; expiry terminates the restricted worker.

Trusted `denyReadPaths` names canonical existing regular files/directories and overrides broad cwd/read/write-derived read grants, including metadata and enumeration. Exclusions grant no paths and cannot overlap required runtime libraries or executables. The candidate evaluator and workers use this for manifest-bound standalone packages in immutable frozen trees. It does not revoke writes or provide an inode boundary when a hostile host relocates content; never infer equivalent protection for writable excluded packages. Actual computed import/read/alias/parent-swap regressions cover the documented read boundary.

Authority to choose filesystem grants belongs to trusted orchestration. Candidate output must never supply these options directly. Only disposable scratch directories should be granted writes; neither a checkout nor the external operational store belongs in `writePaths`. Reading a candidate source tree does not authorize writing it. Credentials must not appear in explicit readable fixtures or arguments.

Process creation is denied by default. `allowNodeChildren: true` is an explicit exception for trusted test harnesses that need to spawn the same Node executable; shell and other executables remain denied. Prefer `node --test --test-isolation=none` for candidate checks that do not require children. On timeout or cancellation the runner kills the launch process group. A child deliberately creating a separate process group can outlive that group kill when the child exception is enabled; use this exception only for trusted harnesses. It does not provide comprehensive hostile-descendant cleanup.

This is an OS filesystem/network restriction, not a virtual machine or a CPU/memory quota. Finite job deadlines bound wall time and retained stdout/stderr. Supervised workers use finite startup/RPC deadlines, bounded protocol buffering and stderr diagnostics; trusted custody supplies periodic behavioral health checks. Default fork denial limits process creation. Neither mode supplies an independent parent-death watchdog. Scratch disk usage, total memory, and instantaneous CPU use do not have hard quotas in this slice. The caller must bound workload and concurrency. Seatbelt is a platform-specific facility and must be retested when macOS or Node changes. No Docker or unconfined subprocess fallback is used.

Dependencies are Node 24 and the trusted orchestrator's grant selection, with
macOS Seatbelt or the prepared Linux backend below. Non-goals are Windows support,
host administration, arbitrary runtimes, full resource quotas and replacing the
custodian's independent release checks. Candidate code remains untrusted after a
successful sandbox launch.

## Prepared Linux backend

On the tested Ubuntu 24.04 x86-64 host, Bubblewrap creates private user, mount,
PID, network, IPC and UTS namespaces with a synthetic read-only root. Trusted
setup establishes mount restrictions and drops all capabilities. The launcher
then installs Landlock execute/write restrictions, `no_new_privs` and x86-64
seccomp before candidate code.
Recursive noexec source/scratch mounts prevent candidate ELF execution through
the required dynamic interpreter. Necessary fixed read-only runtime libraries
remain visible and executable through that interpreter; this is not a promise
that every installed library entrypoint is excluded. Candidate-written ELF is
denied. The installed kernel, libraries, Bubblewrap and prepared helper are
trusted platform inputs.

Missing prepared inputs, inconsistent source/binary/receipt hashes or unavailable
kernel features fail closed. New Linux candidate runtime manifests bind those
three hashes independently of installation paths. Packaging prepares the helper
before freezing; only its C source is tracked in Git. The exact binary and build
receipt are ignored native extras, independently copied and checked when sealing
the service host. Runtime never compiles or downloads them.

Linux read exclusions use an omitted read-only projection; exclusions overlapping
writable grants are rejected. V8 threads remain usable. Default process forks,
networking and namespace escape are denied. The trusted child exception cannot
create a different session or process group. Cancellation and stop require
positive whole-group absence; an absent launcher alone is not drain evidence.
Retained worker reconciliation checks the exact Bubblewrap descriptor, same-user
identity, private scratch and detached process group against retained custody.
Unknown ownership or drain remains held, and `AgentWorker.stop()` propagates it.
Linux parent-death and PID-namespace teardown supplement that observation; the
macOS limitations above still apply to its separate backend.

Verification on macOS 26.6.2 / Node 24.13.0: `node --test test/isolation.test.ts` exercises six real sandbox scenarios; the unsupported-platform branch is skipped on this supported host. The fixture attempts also cover symlinks from allowed paths to protected files and JSON-lines worker communication. The procedure suite separately exercises real file entrypoints and JSON execution through this boundary; the candidate suite exercises the hash-bound native TypeScript compiler. These results establish the tested local restrictions, not portability to untested OS versions or unimplemented resource quotas.
