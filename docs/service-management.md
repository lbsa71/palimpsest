# Durable local service

Work item: P15 operational continuity. This page describes the historical macOS LaunchAgent and its verified contract. Current deployment is the independently accepted [root-sealed Linux systemd service](work-items/linux-systemd-service.md), with [actual native acceptance](migration-acceptance-2026-10-10.md) recorded on 2026-10-10; the Mac LaunchAgent, project configuration, stopped instance and source have since been removed after independently verified preservation.

## Problem and intended behavior

A serving process owned by a development terminal can disappear when that terminal or coding turn is interrupted. The macOS user service must continue independently, using an exact verified retained host installation and the existing external memory/custody journals.

The operator installer reads the existing custodian database in read-only mode, selects its exact known-good artifact, and verifies that artifact's immutable bytes, runtime and installed toolchain using the current trusted verifier. It copies source to `dataDir/host-installations/<release-id>`, keeps the original frozen artifact untouched, and links the configured trusted dependency installation only into the new host bundle. Older bundles remain as rescue material. A repository-specific user LaunchAgent runs the copied `src/cli.ts serve 59940` with the current Node executable and original repository working directory. Its environment names external data and credentials paths only; credentials stay in their private file.

## Acceptance criteria and authority

- Install, start, status and stop are explicit macOS operator commands, absent from cognitive tools. Installation never starts the service implicitly and refuses replacement while its launchd job is loaded.
- The selected known-good identity matches the verified manifest. A copy or existing bundle is checked against every frozen source file before a private plist is installed. Source-copy symlinks and unexpected files are rejected, except for the one explicit dependency link.
- The private plist uses fixed `/usr/bin/env -i` argv, fixed loopback port 59940, escaped XML, a repository-specific label, original working directory and external paths. Before Node starts, the inherited environment is cleared; only HOME, PATH and the two external configuration paths are supplied. No secret values enter the plist or command output.
- Start does not kill a running job. Stop uses bounded launchctl bootout and observation; uncertainty is reported, never converted into a successful stop. Existing coordinator locks continue to prevent simultaneous ownership.
- Tests use fixture state and injected command execution. They inspect source identity, escaping, permissions, destination safety, stable identities and idempotence without launching a real agent.

## Non-goals and material risks

This installs already admitted code; it does not admit checkout changes, self-modify host governance, reset journals or replace custody. A new operator host-baseline installation requires a separate stopped-service redeployment of this host bundle. Linked dependencies and the Node executable are shared with the trusted developer installation: changing them can invalidate older rescue artifacts. Full toolchain retention and rollback of the outer host remain open. The service is a user LaunchAgent and depends on a logged-in GUI session; it is not a system daemon or an always-on remote production host. The fixed port permits one configured local service; another repository or process already using it will prevent readiness. launchd process status alone does not prove Slack connectivity, inference availability or useful shedding; verify those separately.

The plist follows Apple's [LaunchAgent guidance](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html). Command contracts are checked against the installed `launchctl` help; no arbitrary shell commands or model-supplied arguments are accepted.

## Operator interface

From the original repository, with configuration in its existing private credentials file:

```sh
node scripts/service.ts install
node scripts/service.ts start
node scripts/service.ts status
node scripts/service.ts stop
```

`install` reads the existing known-good custody record without acquiring release authority or opening the operational Store. It verifies the retained artifact against current trusted checks/runtime/toolchain, creates or rechecks a separate owner-only read-only host bundle, and atomically writes private installation metadata and the user plist. It refuses a loaded launchd job or unresolved prior stop. It never changes the original artifact or launches the service. Original repository identity, external lived state and Git destination remain unchanged.

`start` verifies the installed bundle and exact plist, runtime/dependency link and current custody governance. A newer protected host baseline requires a stopped `install` before startup; ordinary cognitive promotions with unchanged governance remain compatible. An unloaded job uses `launchctl bootstrap gui/<uid> <plist>`; a loaded idle job uses `kickstart` without forced termination. A running job is left running. Printed status contains only the fixed label, loaded/running/unloaded observation and PID. That observation is not a health claim.

`stop` records intent before `launchctl bootout --wait gui/<uid>/<label>`, including a null PID when launchd has not exposed one. The plist allows 45 seconds for graceful exit. The entire stop operation shares a 55-second monotonic deadline: initial status and every subsequent status command have at most five seconds, bootout has at most 50 seconds, and every command's timeout is reduced to the remaining overall allowance. Post-command observation is additionally bounded to five seconds and at most 20 calls; it cannot multiply the command timeout. A timed-out control helper is terminated without inferring that the product process stopped.

Both job removal and absence of a recorded PID must be observed before reporting a completed stop. For an unknown PID, successful completion of `bootout --wait` plus job absence provides the completion evidence. An uncertain command or a still-live PID retains the private stop intent and blocks installation/restart. A known PID can later settle after both job and process are absent. An unknown-PID intent without successful command completion cannot settle from an unloaded job alone: all four commands preserve that uncertainty, and an operator must independently establish absence of the configured host process and release of coordinator ownership before recording an explicit safe disposition. This slice supplies no automatic reconciliation command for that case. No blind product-process kill or forced kickstart is exposed. A reused PID can conservatively delay restart and requires operator inspection rather than permission to kill another process.

Logs live at `dataDir/service/stdout.log` and `stderr.log`, private mode 600. The plist sets an owner-only umask. Its `/usr/bin/env -i` launcher clears inherited values, including NODE_OPTIONS and provider/config overrides, before executing verified Node; it then supplies only the actual user HOME, a fixed executable search path and external data/credentials paths. Configure application settings in the private file: transient environment overrides from a developer terminal are not copied. KeepAlive restarts unexpected process exit with a ten-second throttle. `stop` unloads the job for the current login session; the retained RunAtLoad plist starts again at a later GUI login. Removing or disabling login startup is outside these four commands.

## Verification and limitations

Nine fixture tests inspect exact copied source, shared dependency link, private modes, XML escaping, fixed argv, credential absence, start/stop idempotence, modified-copy rejection, current known-good identity, source installation outside the checkout, durable uncertain-stop recovery with known and unknown PID, shared stop deadlines and redeployment after a newer protected host baseline while retaining the older bundle. Every launchctl lifecycle call and process-liveness observation is injected; these tests never launch a real agent. A harmless real `/usr/bin/env -i` Node probe separately verifies that inherited NODE_OPTIONS cannot run its injected preload and inherited provider/data overrides are cleared. An actual operator installation must separately confirm the process, authenticated loopback API at port 59940, Slack connectivity, current external state, and operation after the coding terminal ends.

The installer reads full immutable artifact files and keeps older bundles; it does not garbage-collect or provision an independent Node/dependency rescue copy. The service does not run while the user is logged out or the machine is off. Port conflicts, unavailable providers and system background-item policy can prevent readiness even while launchd has a loaded job. Existing application locks protect concurrent state ownership, but do not prove that a loaded service has completed recovery or useful work.

Live observation, 2026-10-09: the exact retained known-good host was installed and started through these commands. Startup initially waited for macOS Documents permission for Node; after that hold cleared, the authenticated API returned the retained successful task, Slack Socket Mode reported connected with zero initial reconnects, and a new direct capability probe completed. launchd owns the outer process independently of the coding tool. This is readiness of the previous admitted host; it does not deploy uncommitted plan-executor code or establish long-term availability.
