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
