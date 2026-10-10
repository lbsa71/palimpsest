# Dedicated Linux installation

This template and operator launcher prepare a continuous systemd service from an **already admitted native Linux baseline**. They do not migrate state, approve a candidate, start a provider probe, or establish public/production acceptance. See the [work item](../../docs/work-items/linux-systemd-service.md) and the separate platform migration gate.

The authorized destination layout is:

- Repository: `/home/palimpsest/src/palimpsest`
- Root-owned Node: `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`
- State: `/home/palimpsest/.local/share/palimpsest/instance`
- Private configuration: `/home/palimpsest/.config/palimpsest/credentials.env`

The operator first stops and verifies the former host, transfers consistent state and all source/drafts, installs native dependencies/isolation, imports the independently evaluated native baseline, and performs the two provider-free recovery gates. `platform-migration.json` must be ready before service preparation. Old Darwin releases remain evidence; do not launch them as Linux recovery candidates. Startup fails closed on source, runtime, dependency or governance mismatch.

## Prepare without starting

Run this reviewed command as the dedicated account from the repository **after** the separate migration gate passes:

```sh
/usr/bin/env -i HOME=/home/palimpsest \
  PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:/usr/bin:/bin \
  PALIMPSEST_DATA_DIR=/home/palimpsest/.local/share/palimpsest/instance \
  PALIMPSEST_CREDENTIALS_FILE=/home/palimpsest/.config/palimpsest/credentials.env \
  /opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node \
  scripts/systemd-service.ts prepare
```

Preparation refuses a held coordinator lock, copies the exact known-good manifest into `instance/host-installations/<digest>`, preserves file bytes/executable modes, and links the independently verified installed dependencies. It requires `manifest.runtime.linuxIsolation` with admitted source, ELF and receipt hashes. Frozen C must match that source hash; only the two explicit prepared binary/receipt extras are copied, and all three enter the bootstrap checksum inventory. A matching current binary/receipt alone is refused as admission evidence. It creates `service/systemd-installation.json`, a complete `service/host-<digest>.sha256` list, private stdout/stderr logs and scratch, and the rendered `service/palimpsest.service`. The descriptor and unit point to the final root-owned `/opt/palimpsest/hosts/<digest>`; preparation itself creates only the private staging copy. No model or service starts. There is no force/rebase/budget-refill mode. A failed preparation may retain a private `.preparing-*` directory for operator inspection.

Root independently reviews the admitted identity and rendered files, then installs the source and checksum anchor. The Node directory must also be root-owned through every `/opt` ancestor, with no group/other write permission. Use the reviewed digest as `release_id` below; do not derive approval from an unchecked mutable descriptor. Refuse overwriting an existing sealed host. With the service stopped, run as root:

```sh
set -eu
release_id='<independently verified 64-character digest>'
state_dir=/home/palimpsest/.local/share/palimpsest/instance
sealed_host=/opt/palimpsest/hosts/$release_id
install -d -o root -g root -m 0755 /opt/palimpsest /opt/palimpsest/hosts /etc/palimpsest
test ! -e "$sealed_host"
test ! -L "$sealed_host"
cp -a "$state_dir/host-installations/$release_id" "$sealed_host"
chown -hR root:palimpsest "$sealed_host"
find "$sealed_host" -type d -exec chmod 0550 {} +
find "$sealed_host" -type f -perm /0100 -exec chmod 0550 {} +
find "$sealed_host" -type f ! -perm /0100 -exec chmod 0440 {} +
install -o root -g root -m 0644 "$state_dir/service/host-$release_id.sha256" "/etc/palimpsest/host-$release_id.sha256"
/usr/bin/sha256sum --quiet --strict --check "/etc/palimpsest/host-$release_id.sha256"
systemd-analyze verify "$state_dir/service/palimpsest.service"
install -o root -g root -m 0644 "$state_dir/service/palimpsest.service" /etc/systemd/system/palimpsest.service
systemctl daemon-reload
```

Inspect the sealed modes/owners and dependency link, and independently confirm the checksum list covers every admitted file plus the admitted prepared native ELF/receipt and root-owned Node binary before installing the unit. The checksum anchor is trusted because root reviewed and installed it; the private staging list alone grants no authority. Enable/start only after the authorized migration gates. These are operator steps; this package does not perform them. Record actual `systemctl show` PID/state, private log evidence and authenticated responsiveness separately; `Type=exec` reports process execution, not application readiness.

The unit clears inherited environment before starting the exact digest's launcher. Secrets stay in the application's private file, not unit arguments or `EnvironmentFile`. Keep `PALIMPSEST_PLAN_CADENCE=hourly`, proposal calls per hour `1` and evolution calls per hour `8` in that configuration. The internal scheduler preserves historical debits; the service serves Slack continuously. Do not add an hourly systemd timer to stop/start it.

## Shutdown and recovery

`systemctl stop palimpsest` sends SIGTERM to the main process. The launcher uses process replacement, so that signal reaches the existing CLI's cancellation/drain handler. `KillMode=mixed` leaves children available for orderly draining, then kills only the service cgroup after 120 seconds. Forced termination leaves uncertain effects for journal reconciliation, not success. The unit restarts unexpected exits after ten seconds, bounded to three starts per five minutes; a stopped/failed unit may require an operator inspection and `systemctl reset-failed`.

The root-owned unit binds the host digest and runs distribution coreutils against the root-owned checksum anchor before Node imports any startup code. Root seals the complete source outside the service account's writable home. The selected runtime is also root-owned outside that home. The sealed launcher then verifies frozen source/runtime/toolchain before reading current custody; the migration guard and current known-good governance must also match. A compatible cognitive successor does not require rewriting the unit. A changed host/governance requires separate admission, stopped-service preparation and a newly reviewed sealed host, checksum anchor and unit. This operator route is not full autonomous P18 host upgrade capability. The destination coordinator lock prevents duplicate owners of this one store; it does not replace the source-host shutdown gate across machines.

The service mounts its selected host bundle read-only, permits the repository and external state to be written, and retains network/user-namespace support for the host and reviewed Linux sandbox. `NoNewPrivileges` is enabled; namespace denial and V8-incompatible executable-memory restrictions are deliberately absent. Private `service/scratch` is the derived `TMPDIR` both at initial launch and after process replacement; ambient `/tmp` is not assumed writable under `ProtectSystem=strict`. Run a real worker/check scratch smoke inside the destination unit. This unit is not the candidate/tool sandbox. Private append logs require operational rotation/retention; no log quota is claimed.

## Evidence and limitations

The explicitly prepared native package is `trusted/linux-isolation-launcher.c` (tracked frozen C), `trusted/linux-isolation-launcher` (ELF) and `trusted/linux-isolation-launcher.json` (version 1, x64, source/binary hashes). There is no runtime compilation or environment/external fallback. The candidate runtime producer must freeze the source, binary and receipt SHA256 values; missing binding refuses Linux preparation. Source and prepared byte identities survive relocation from the repository into the sealed host.

Local Node/macOS fixtures test real source projection, descriptor/projection tampering, private credentials/logs, compatible cognitive succession, incompatible custody, non-ready migration, coordinator exclusion, entrypoint identity, private scratch and an independent coreutils checksum gate rejecting an altered imported module before its sentinel executes. The migration guard, layout/owner and normalized native admission are explicit trusted fixtures in these local tests. The fake ELF is never executed or treated as a native isolation pass. They do not claim native Linux isolation, real systemd parsing/start/stop, actual `execve` replacement, destination permissions, Mistral/Slack availability, or completed migration. Those checks must run on the destination and be recorded by the lead before local cleanup.
