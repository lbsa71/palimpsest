# A1-L09 installation slice

Owner: `/root/a1_installation`; branch `codex/a1-installation-20261011`; worktree `/home/palimpsest/migration/aeon-1-20261011/installation`; baseline `6adba9d`. Exclusive implementation: new `deployment/installation.ts`, its tests and this evidence plus [operations](../../operations.md). Existing coordinator, CLI, policy, candidate and resource files were read, not edited.

```text
/goal Implement and validate a finite new Aeon systemd installation path with exact frozen coordinator/runtime bindings, private inputs, delegated aggregate service limits, persistent fixed-capacity workspace mounting, truthful readiness diagnosis and data-preserving stop/uninstall; commit the evidence without activating production.
```

## Behavior and boundaries

The new source entry point renders reviewable service/mount/metadata bytes, applies them only through an explicit administrator operation, probes service prerequisites, and provides exact-unit stop/uninstall. Safe canonical paths and a new `aeon-*` service name are required; root UID, extra fields, nonfinite ceilings, overlaps and interpolation/metacharacters are rejected. Root-owned 0600 environment inputs admit only known secret assignments. The host JSON remains private to the service account. The frozen coordinator closure and pinned Node bytes/version are reverified before installation and service startup. The installer does not create evaluator proofs or treat artifact integrity as admission.

The rendered service starts from the selected frozen payload, includes a required ordered loop/ext4 mount, delegated cpu/memory/pids, outer aggregate memory/process/CPU-rate ceilings, zero swap, cgroup-wide stop, explicit writable data roots and bounded host restart attempts. Administrator provisioning creates a new image or validates/remounts a preserved exact image; it never truncates an existing layout. Stop/uninstall retain every source/artifact/rescue, state/uncertain-effect record, credential/configuration file and workspace image. They refuse mismatched installed files. Interrupted administrative apply may leave partial unit files for explicit administrator inspection; created data is never rolled back/deleted.

## Observed validation

Pinned runtime: `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`, v24.13.0. Local systemd: 255. Generated service and mount pass `systemd-analyze verify`. Mount escaping is compared with the actual `systemd-escape`, including hyphens and a leading dot. Ordinary tests check injection refusal, no-overwrite review bundles, secret-variable restrictions, runtime/coordinator rehashing, frozen capacity mismatch and data retention on ordinary-filesystem refusal. Final focused suite: **6 passed, 1 opt-in real-workspace test skipped**. The skip in a default invocation makes no claim about real confinement.

Before adding the independent preflight case, the full then-current **6/6** suite was run with `AEON_INSTALLATION_WORKSPACE=/var/lib/aeon-installation-evidence-20261011`: all passed with no skips. This was a real administrator-provisioned **16 MiB / 128 inode** loop/ext4 filesystem. An administrative unmount followed by mounting the exact image with `loop,nodev,nosuid` and rerunning the same **6/6** suite preserved its marker. Mismatched image-size input failed without modifying that marker. This establishes remount retention, not an actual machine reboot.

A disposable transient unit `aeon-installation-probe-20261011.service` ran with the generated service's delegated controllers, `MemoryMax=1G`, `MemorySwapMax=0`, `TasksMax=128`, `CPUQuota=200%`, `KillMode=control-group`, `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ProtectHome=read-only`, `ProtectControlGroups=no` and explicit workspace writes. It actually initialized the delegation and ran a namespace-confined `/usr/bin/true` through setpriv/prlimit/bubblewrap and a resource leaf. It exited 0 in **204 ms**. Command receipt: exit 0, memory peak **1,118,208 bytes**, 0 OOM kills, 0 pids-limit hits, **7,275 µs** CPU, no throttling. This exercises restrictions plus delegation and confinement; it does not execute an installed coordinator or application, perform inference or certify live competence.

Commands used:

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-reporter=tap deployment/installation.test.ts
sudo -n /opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node packages/supervisor/provision-workspace.mjs create /var/lib/aeon-installation-evidence-20261011 1006 1008 16777216 128
AEON_INSTALLATION_WORKSPACE=/var/lib/aeon-installation-evidence-20261011 /opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-reporter=tap deployment/installation.test.ts
sudo -n umount /var/lib/aeon-installation-evidence-20261011/work
sudo -n mount -t ext4 -o loop,nodev,nosuid /var/lib/aeon-installation-evidence-20261011/workspace.ext4 /var/lib/aeon-installation-evidence-20261011/work
AEON_INSTALLATION_WORKSPACE=/var/lib/aeon-installation-evidence-20261011 /opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-reporter=tap deployment/installation.test.ts
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH /home/palimpsest/src/palimpsest/node_modules/.bin/tsc --noEmit --project /home/palimpsest/migration/aeon-1-20261011/installation/tsconfig.json --typeRoots /home/palimpsest/src/palimpsest/node_modules/@types
sudo -n /opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node packages/supervisor/provision-workspace.mjs remove /var/lib/aeon-installation-evidence-20261011
systemctl show aeon-installation-probe-20261011.service --property=LoadState --property=ActiveState
git diff --check
```

The generated-unit syntax check runs inside the first test. The bounded transient probe is reproducible by using `systemd-run --wait --pipe --collect` with the properties above, a 30-second outer deadline, the pinned Node and this worktree as `WorkingDirectory`; its script calls `initializeResourceDelegation` followed by `runConfined` against the provisioned workspace with a 64 MiB/16 process/50 ms per 100 ms leaf, 1 MiB file limit and 64 file descriptors. The probe makes zero provider requests and sends no external messages.

Cleanup was checked: provisioned directory absent, loop list empty, transient unit `LoadState=not-found` and `ActiveState=inactive`. No new production unit was installed, enabled or started, and no legacy/global service configuration was altered. Strict TypeScript and whitespace checks pass.

## Scope of completion

This finite installation implementation and bounded verification is complete. Full administrator apply/stop/uninstall was not exercised against an installed production service; production activation remains separate. First-conversation/tool/developmental-job qualification, fresh integrated review, whole-host self-replacement and H1 remain root-owned gates. `Type=exec` is liveness only; coordinator/application health and reason reporting are documented separately. The exact handoff is the Git commit containing this document, returned to `/root` for inspection.

The unit pins its coordinator executable independently of later application/control candidates. Application `activate-control` alone does not replace that running executable; restarting/replacing the coordinator must use the separately admitted host path and retained rescue. Finally, only the workspace's total persistent storage is kernel capacity bounded. Operational state, retained artifacts, external evidence and journald remain cumulatively unbounded on their host filesystem unless separately provisioned with volumes/quotas and retention. The operations document states this storage tradeoff explicitly; no global host-storage bound or autonomous privileged installation is claimed.

## Bounded host-data extension (supersedes the initial storage limitation)

The first finite slice above was committed as `5fe0f4f9b9d6c9bf4f5506298ea501d02f0cf4c4`. Root then required closing the runtime host-storage gap before product readiness. A second finite goal implements a distinct fixed ext4 host-data image containing disjoint private state/artifact/evidence/log directories, preserves both images on stop/uninstall, and adds exact image/mount/capacity/ownership checks. The old installation-input shape is superseded; full rewrite has no compatibility obligation. The source checkout, administrator runtime and private keys remain outside the service's writable paths.

`deployment/installation-entry.mjs create-host-data` is an explicit administrator bootstrap operation before freezing into the artifact store. It reuses the independently reviewed `provision-workspace.mjs` filesystem primitive, not a legacy deployment API. A mounted root becomes root-owned; only new private same-filesystem subdirectories are delegated to the service UID/GID. `mount-host-data` accepts only the exact preserved image, mount backing and capacity/layout, and never copies, resizes, reformats or truncates data. New installation fields bind its directory, bytes and inodes. State/artifact/evidence paths must match the derived layout. Startup requires both fixed mounts. Runtime stdout/stderr now append inside bounded host data; this prevents arbitrary application output growth on the global host journal. The journal retains ordinary systemd manager lifecycle events under host administration; this change does not alter global journald configuration or claim a bound on unrelated host allocation.

The service uses the coordinated frozen `cli.ts launch` / `host-successor.ts` seam. This permits the separately accepted coordinator path to replace itself; the original frozen installation verifier, systemd unit and Node binary remain the privileged bootstrap and require separately authorized administrative replacement. `OPENAI_API_KEY` joins the strict secret-variable allowlist; provider selection remains explicit with Mistral as the default. Operations now describe the root's authenticated `/health` route (`alive`, `execution.admission`, reasons); it neither probes provider connectivity nor treats local readiness as competence, and a budget-held/fenced state is not cured by restart.

Actual new host-data case: administrator creation of a 16 MiB / 128 inode image at `/var/lib/aeon-host-data-evidence-20261011`, private UID/GID 1006/1008 sibling directories. An 8 MiB allocation under state succeeded, and a second 8 MiB allocation under artifacts failed with observed **No space left on device**, proving the shared hard capacity rather than per-directory nominal limits. Existing markers in state, artifacts, evidence and logs remained readable. Test allocations were removed explicitly. Unmount followed by `mount-host-data` preserved all markers. Calling `create-host-data` on the existing layout failed with “Existing host data is never recreated, resized or truncated”; requesting a 32 MiB profile for the 16 MiB image failed with “Existing image/layout differs; refusing destructive provisioning”. Neither refusal changed existing data.

With both real workspace and host-data mounts present, the current focused suite reports **8 passed, 0 skipped**. Default invocation reports **6 passed, 2 deliberate real-filesystem skips**. Syntax validation covers the service and **both** persistent mount units; the service binds/requires/starts after both. Coordinator/runtime integrity, capacity mismatch, exact mount escaping, private environment restrictions and non-overwrite behavior remain checked.

A second disposable transient unit `aeon-host-data-log-probe-20261011.service` used the final generated hardening/delegation/outer limits and `StandardOutput=append` / `StandardError=append` under the bounded log directory, with a 30-second outer deadline. It actually initialized a delegated leaf and executed setpriv/prlimit/bubblewrap `/usr/bin/true`, with host-data roots declared protected. It exited 0 in **203 ms**; the bounded log contained its fixture marker and command receipt: **1,122,304 bytes** memory peak, 0 OOM/PID limit hits, **8,563 µs** CPU, no throttling. The unit was collected (`LoadState=not-found`, `ActiveState=inactive`). This is a real confinement plus append-log test, not an installed production launch or inference test.

Reproduction for the data case, in addition to the ordinary compiler/test commands above:

```sh
sudo -n /opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node deployment/installation-entry.mjs create-host-data /var/lib/aeon-host-data-evidence-20261011 1006 1008 16777216 128
AEON_INSTALLATION_HOST_DATA=/var/lib/aeon-host-data-evidence-20261011 AEON_INSTALLATION_WORKSPACE=/var/lib/aeon-installation-evidence-20261011 /opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-reporter=tap deployment/installation.test.ts
sudo -n umount /var/lib/aeon-host-data-evidence-20261011/work
sudo -n /opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node deployment/installation-entry.mjs mount-host-data /var/lib/aeon-host-data-evidence-20261011 1006 1008 16777216 128
AEON_INSTALLATION_HOST_DATA=/var/lib/aeon-host-data-evidence-20261011 AEON_INSTALLATION_WORKSPACE=/var/lib/aeon-installation-evidence-20261011 /opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-reporter=tap deployment/installation.test.ts
```

The root-owned image/layout checks assume trusted stable administrator inputs, as in the prior resource review; they do not certify hostile administrator or same-UID host mutation, or privileged nested same-device bind aliases. Existing ordinary host state/artifact directories are refused rather than imported. Moving already-lived data is a separate explicit preservation/migration procedure. The installed full apply/stop/uninstall and actual reboot remain unexercised because production activation was outside this finite task. The mounted-volume remount, real capacity refusal and disposable hardened service tests establish only their recorded slices.

Final integration verification used a detached, independent worktree at root revision `806dd52445c1e35396ff7e28c5d3d5a6a93788fa`, with only these five installation-owned files copied over and the pinned retained compiler closure copied locally. This avoided resolving or editing another owner's CLI/coordinator files. The complete `deployment/test.mjs` aggregate passed **380/380**, zero failures/skips, in **135.038 s**. Strict TypeScript, emitted build and new MJS syntax checks pass. The final read-only schema-interruption guard was added while that aggregate was running; final installation **8/8** and strict/build checks were repeated after that guard, and include the missing-schema boot-journal case plus selected-versus-rescue provider credentials. This is aggregate integration plus focused final-change verification, not a new production deployment.

Retained logs outside source control:

- `/var/tmp/aeon-installation-integration-20261011-tests.log`, SHA-256 `9229bd9a16c2c17fd9952ada881e8966867a322a2a114730dae6cf7d004cab7c`.
- `/var/tmp/aeon-installation-focused-final-20261011-tests.log`, SHA-256 `19029ffa1d57728b20eeea8036bdb32a062d326a10045d6edbbad756780104a6`.

Both disposable image/layout directories were removed with the explicit administrator helper **after** tests; both transient units are not-found/inactive, and the loop association list is empty. This cleanup deletes only the designated test fixtures; the installation stop/uninstall path does not delete lived data. No production unit was installed, enabled or started, no legacy/global service configuration was altered, and no inference or external messages were sent. The bounded-host-data finite goal is complete; root owns fresh installer review, final aggregate integration and production/H1 gates.
