# Aeon installation and operations

This procedure installs the rewrite under an explicitly chosen **new** `aeon-*.service` name. The historical installation remains decommissioned. Installation is separate from product qualification and H1. The [host CLI](../../deployment/README.md) specifies candidate freeze, external policy/proof preparation and application release. The [installation evidence](evidence/A1-L09/installation.md) records what was actually exercised.

## Prepare operator inputs

Use the pinned Node 24 executable, a Linux cgroup v2 host with `cpu memory pids`, systemd, bubblewrap, setpriv, prlimit, findmnt, fallocate, ext4 tools, mount and loop-device support. `bwrap --version`, `setpriv --version` and `prlimit --version` must succeed. The service preflight also executes a minimal bubblewrap namespace command. Node must match the frozen coordinator's exact version, SHA-256, platform and architecture; a `node` resolved from an ambient PATH is insufficient.

Choose a service UID/GID and distinct source, state, artifact, evidence, workspace and configuration locations. Here is a concrete directory preparation for an operator-selected UID/GID; substitute the actual account numbers. The provisioning parent stays root-owned and unwritable by the service account:

```sh
sudo -n install -d -m 0755 -o 0 -g 0 /var/lib/aeon-new /etc/aeon-new
sudo -n install -d -m 0700 -o 1006 -g 1008 /var/lib/aeon-new/state /var/lib/aeon-new/artifacts /var/lib/aeon-new/evidence
```

The source checkout is separately writable for ordinary engineering. Install its pinned check/build dependencies with the pinned Node/npm environment and the retained lockfile before freezing; run `npm ci --ignore-scripts` and `npm run verify`. Freeze through `deployment/cli.ts freeze`, then `inspect` the result. Select `coordinatorCandidateId` from that exact inspected manifest. The selected frozen payload must contain the new `deployment/installation.ts` and the complete CLI/control closure. No mutable checkout or globally installed package is the service's executable source.

Create the `SupervisorFile` described in the host CLI documentation as an owner-only, singly linked file owned by the service UID. Set `host.cgroupRoot` to `/sys/fs/cgroup/system.slice/aeon-new.service`, `host.workspaceDirectory` to `/var/lib/aeon-new/workspace/work`, and the other bindings to the prepared paths. The frozen coordinator's logical `resourceLimits.workspaceBytes` and `workspaceInodes` must match the installation values. A first application start separately requires an authentic external bootstrap proof, evidence and explicit configured admission policy. The installer rehashes the coordinator and runtime; it does not manufacture evaluation or assert product acceptance.

Place policy/key/proof files outside artifact and workspace roots, owner-only under the service UID, using the host CLI's exact schemas. Create a **root-owned 0600**, singly linked environment file with only these literal unquoted assignments:

```text
MISTRAL_API_KEY=OPERATOR_PROVIDED_VALUE
AUTARK_DIRECT_TOKEN=OPERATOR_PROVIDED_VALUE
```

Add `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` only when configured. Values may contain ASCII letters, digits and `._:/+=-`; quotes, spaces, substitutions and unrelated variables such as `NODE_OPTIONS` are rejected. Keep all actual credentials outside source control. Copy prepared files with explicit ownership, without displaying their contents:

```sh
sudo -n install -m 0600 -o 1006 -g 1008 /private/prepared-host.json /etc/aeon-new/host.json
sudo -n install -m 0600 -o 0 -g 0 /private/prepared-secrets.env /etc/aeon-new/secrets.env
```

Write an `Installation` JSON file with **exactly** these fields. Replace the candidate placeholder with its 64-character lowercase digest:

```json
{
  "unitName": "aeon-new.service",
  "uid": 1006,
  "gid": 1008,
  "nodeBinary": "/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node",
  "artifactStore": "/var/lib/aeon-new/artifacts",
  "stateDirectory": "/var/lib/aeon-new/state",
  "coordinatorCandidateId": "INSPECTED_FROZEN_CANDIDATE_ID",
  "hostConfigFile": "/etc/aeon-new/host.json",
  "environmentFile": "/etc/aeon-new/secrets.env",
  "workspaceProvisionDirectory": "/var/lib/aeon-new/workspace",
  "workspaceBytes": 134217728,
  "workspaceInodes": 4096,
  "outerMemoryBytes": 1073741824,
  "outerTasks": 128,
  "outerCpuPercent": 200
}
```

Paths must be canonical absolute ordinary paths containing only letters, digits, `_`, `.`, `/` and `-`. Symlink traversal, overlap and unit/command interpolation are refused. Select outer memory/process/CPU ceilings for the coordinator plus every simultaneous application, worker and command. These ceilings may cause a fail-closed unavailable result if the profile is undersized.

## Render, review and install

Run the new entry point from the selected inspected frozen coordinator. Set `AEON_INSTALL_PAYLOAD` explicitly to its absolute `.../CANDIDATE_ID/payload` path, and `AEON_INSTALL_NODE` to the pinned Node binary. Render into a **new** ordinary directory whose parent already exists:

```sh
"$AEON_INSTALL_NODE" "$AEON_INSTALL_PAYLOAD/deployment/installation.ts" render /private/installation.json /private/new-review-bundle
systemd-analyze verify /private/new-review-bundle/aeon-new.service '/private/new-review-bundle/var-lib-aeon\x2dnew-workspace-work.mount'
```

The mount filename uses systemd path escaping; use the exact filename the renderer wrote. Quote a filename containing a literal backslash, or select it through `systemd-escape --path --suffix=mount /var/lib/aeon-new/workspace/work`. Review the service, mount and `installation.json` bytes. Rendering performs no privileged operation.

```sh
sudo -n "$AEON_INSTALL_NODE" "$AEON_INSTALL_PAYLOAD/deployment/installation.ts" apply /private/installation.json /private/new-review-bundle
```

`apply` checks the exact review bytes, private configuration and secrets, frozen coordinator/runtime, resource/profile bindings, root-owned provisioning parent and systemd syntax before changing host files. It invokes the existing one-time administrator provisioning helper for a new fixed ext4 image, or validates and remounts the exact preserved existing layout. It never reformats, resizes or truncates an existing image. It installs only the explicit new service, its derived mount and root-owned installation metadata, then reloads systemd. It does not enable or start the service. A failed administrative apply retains created workspace data; partial unit-file creation must be inspected and repaired by the administrator before retry because existing files are never overwritten.

When activation is authorized, this single separate administrative command enables boot startup and starts the service:

```sh
sudo -n systemctl enable --now aeon-new.service
```

The service requires and follows its persistent `.mount` unit, so the fixed image is remounted before execution after reboot. It requires the state/artifact filesystem mounts too. It receives `Delegate=cpu memory pids`, outer `MemoryMax`, zero outer swap, `TasksMax`, `CPUQuota` and `KillMode=control-group`. Filesystem restrictions allow host writes only to explicit state, artifact and bounded workspace roots. The runtime never invokes sudo or edits privileged units. This bootstrap does not grant autonomous privileged host installation authority.

## Diagnose and recover

`systemctl is-active aeon-new.service` reports process liveness. `Type=exec` establishes execution of the coordinator, **not application readiness**. Query the frozen CLI as the service owner:

```sh
"$AEON_INSTALL_NODE" "$AEON_INSTALL_PAYLOAD/deployment/cli.ts" status /var/lib/aeon-new/state
sudo -n systemctl show aeon-new.service --property=ActiveState --property=SubState --property=Result --property=ExecMainStatus
sudo -n journalctl -u aeon-new.service -n 100 --no-pager
```

Host `status.running`, `ready`, `failure` and retained release phase distinguish a living coordinator, a serving application, failed recovery and probation. `ready` identifies the actual candidate, authority and direct address. The current baseline does not expose an authenticated application `/health` route or a separate `executionReady` field. The installation preflight verifies runtime, namespace, delegation and filesystem prerequisites; supervisor startup separately probes kernel leaves after taking its lease. A ready listening child is still insufficient evidence of provider availability, live tool competence or H1. Failed preflight/start reasons appear in the unit journal; private child failure details remain under `state/host-diagnostics`. A stopped coordinator has no responding control socket, so consult systemd result/journal and the preserved release history.

Unexpected host failure triggers at most three systemd starts within five minutes, with ten seconds between retries. The coordinator's own failed child recovery stops with a visible unavailable state rather than an infinite local retry loop. Fix the concrete prerequisite, use the documented `recover` command when the host is still alive, or `systemctl reset-failed` and explicit restart after inspecting a stopped host. Accepted recovery uses current lived state and retained artifacts; unavailable bootstrap proof, evaluator keys and evidence do not prevent that recovery. The installation preflight permits absent evidence on recovery; the first-start admission path still requires it.

`stage-control` / `activate-control` replaces the accepted application/control candidate under incumbent admission controls. The already-running **coordinator executable** remains the frozen `coordinatorCandidateId` in this unit. A coordinator implementation upgrade also needs separately staged host replacement, retained rescue and administrative unit replacement/restart under previously accepted controls. This installer supplies the bootstrap installation path; it does not establish autonomous whole-host replacement. Register policies in host configuration before launch; configuration edits require coordinator restart to be loaded.

## Stop and uninstall without data deletion

Use the retained root-owned metadata, which binds the exact installed unit bytes:

```sh
sudo -n "$AEON_INSTALL_NODE" "$AEON_INSTALL_PAYLOAD/deployment/installation.ts" stop /etc/systemd/system/aeon-new.service.installation.json
sudo -n "$AEON_INSTALL_NODE" "$AEON_INSTALL_PAYLOAD/deployment/installation.ts" uninstall /etc/systemd/system/aeon-new.service.installation.json
```

Stop withdraws serving authority through normal shutdown and systemd kills the entire cgroup if shutdown exceeds 45 seconds. It retains the workspace mount. Uninstall stops/disables the explicit service, stops its mount and removes only the matching new unit files and installation metadata. Both preserve source, every candidate/rescue, operational/developmental state, uncertain effects, evidence, environment/configuration files and the complete ext4 image. Reinstallation validates the image and remounts its latest bytes. Workspace/data deletion is a distinct administrator operation and is never invoked by either command. Altered unit bytes are refused; inspect changes before administrative removal.

The workspace has a kernel-enforced fixed block/inode capacity. The outer cgroup bounds aggregate memory, process count and CPU **rate**, not lifetime cumulative CPU. State, artifacts, externally produced evidence and the host system journal have **no aggregate disk quota established by this installer**. Per-candidate freeze limits and request/rate limits do not bound their lifetime total growth. Provision dedicated bounded filesystems or enforced project quotas for these roots, plus an explicit journal/retention policy, if host-storage exhaustion must be kernel bounded. Keep retained rescues, lived state and uncertain effects when designing retention; silent deletion is not a recovery policy. Free-space monitoring alone is operational mitigation, not a filesystem ceiling.
