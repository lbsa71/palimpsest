# A1-L09 installed composition repair and assessment

Status: finite goal complete; **installed engineering fixture verified**, not production deployment or H1 acceptance. Owner `/root/a1_profile_review`; branch `codex/a1-installation-composition-20261011`; worktree `/home/palimpsest/migration/aeon-1-20261011/installation-composition`. Base `c3127d15252a5aa35b1893f28de9d07e39ea82ff` includes the lead's full installed rehearsal (`815bac8`) and bounded mount repair. Code handoff: `e9247eb65988dc66c041b05149c1f374b03e2c67`, then `14c52ddd609fd22c4db448fb11be418e0aa44f55`.

## Goal and ownership

`/goal Repair and verify A1-L09 disposable installed service composition from c3127d1: reproduce the cgroup root occupancy failure, preserve exclusive recovery authority, demonstrate actual installed startup/health/restart/state retention/uninstall cleanup, and commit exact evidence with remaining limits.` This new finite goal was created with the goal tool after the separate model-profile review completed.

This task supports A1-L09-T04/T05 and RW10/RW15/RW16/RW19. The lead assigned bootstrap/resource/installation implementation and tests here while retaining operations documentation and serialized integration. This fresh context reviewed the lead's mount repair; the two repairs authored here require the lead's subsequent fresh review. Routing requested by the lead: `gpt-6-astra` / high. No further parallel child work was justified for these coupled lifecycle repairs. Heavy checks were serialized after the lead's installed failures and the baseline observer, then released to the asynchronous-evaluation author.

## Observed failures and fixes

1. At the lead's initial full-fixture source (`815bac8`), ordinary installed startup failed preflight with `Persistent bounded loop ext4 workspace mount required` (0/1, 50.8 seconds). Under `ProtectSystem=strict`, the host-data mount root was read-only although selected children were writable. The lead changed `ReadWritePaths` to the complete bounded host-data mount and the workspace at `c3127d1`. This review inspected that change: runtime, secrets, private host configuration, backing-image parents and unrelated host paths remain outside those writable paths; byte/inode bounds and ownership checks remain enforced. The later full fixture independently verified actual startup through this repaired mount layout.

2. The lead's next full fixture at `c3127d1` failed with `EBUSY: resource busy or locked, write` and `Host coordinator unavailable; bounded rescue exhausted` (0/1, 46.5 seconds). Inspection found the retained bootstrap/launcher remained in the delegated root while the coordinator moved only itself into `host` and enabled subtree controllers. That violates cgroup v2's internal-process rule. `e9247eb` extracts `enterResourceHostLeaf`: validate delegation, move only the caller's PID to `host`, then enable the declared controllers. Bootstrap calls it **after** exact installed-service preflight and before launching descendants. Descendants inherit the host leaf. `initializeResourceDelegation` calls this helper and retains command-group kill/drain/removal in its existing exclusively leased supervisor path. The helper never moves arbitrary PIDs or kills stale commands before the lease.

3. The first run with that cgroup fix at `e9247eb` passed actual startup, authenticated health, empty controller-root, retained-main-PID host-leaf and controller-enabled assertions. It then failed the ordinary stop command (0/1, 23.2 seconds): `ownedUnitFile` passed generated mount-unit filenames containing literal systemd `\\x2d` escapes through the stricter operator filesystem-path validator. `14c52dd` validates the derived installed-unit path directly: it must remain under `/etc/systemd/system` with no symlink traversal, and must still be a singly linked, root-owned, non-writable-by-others regular file whose bytes exactly match this validated installation. Operator path validation is unchanged. The successful run uses hyphenated fixture paths, exercising this failure case through both stop and uninstall.

The full fixture now also checks that health distinguishes an alive service with configured kernel limits from its intentionally exhausted zero-request allowance. The request assertion retains the actual ResourceLedger namespace, `requests`.

## Verification

At exact source `14c52ddd609fd22c4db448fb11be418e0aa44f55`, the following command passed **1/1, zero skips**, in 26.8 seconds:

```sh
sudo -n env AEON_INSTALLATION_REHEARSAL=1 AEON_FIXTURE_UID=1006 AEON_FIXTURE_GID=1008 /opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test deployment/installation-rehearsal.test.ts
```

The frozen candidate was `9e81fc39c823ebfd9d7149a2b8b92d87a845339578fbaeefc48eb59cca0f897a`. It ran the ordinary retained bootstrap, launcher, supervisor and service child under actual temporary installed systemd units, a 1 GiB bounded host-data ext4 image and 128 MiB workspace image, UID 1006/GID 1008, configured outer and command resource ceilings, and synthetic admission evidence.

Observed assertions: the delegated controller root was empty; the retained main PID occupied `host`; cpu/memory/pids controllers were enabled; authenticated `/health` reported alive, configured kernel limits, provider connectivity unprobed and exactly the intentional `allowance-exhausted` hold. Ordinary stop/start advanced the serving epoch **1 → 3** and preserved the current experience and unresolved-effect fixture marker. The physical request ledger remained empty. Ordinary uninstall preserved both backing images. Final cleanup removed only this fixture's exact units and temporary tree after confirming neither image was mounted.

Additional checks at the final code revision:

| Command | Result |
| --- | --- |
| Node 24 `--test deployment/installation.test.ts packages/supervisor/resource-limits.test.ts` | 8 passed, 0 failed, 2 explicit optional-volume skips; 5.4 seconds |
| `PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH npm run check` | Passed |
| Same PATH, `npm run build` | Passed |
| `git diff --check` | Passed |
| Post-run unit, mount and temporary-directory inspection | No `aeon-fixture-*` units, installed fixture files, rehearsal mounts or rehearsal temporary roots remained |

The two skipped checks require separately configured small preprovisioned volume fixtures; they are not counted as executed capacity-exhaustion tests. The resource test's heavier opt-in command-limit suite was not enabled or claimed. Dependencies use the integration checkout's existing `node_modules` via a worktree symlink; no lockfile/dependency change occurred.

## Retained logs

All logs are outside frozen source at `/home/palimpsest/migration/aeon-1-20261011/integration-evidence/`:

| File | SHA-256 | Provenance |
| --- | --- | --- |
| `installed-composition-before.log` | `141e6b63dfc95aaa16d2d432f70513fae3ccdb325202ce2546c4cd4e559710f8` | Lead's original mount failure, inspected here |
| `installed-composition-mountfix.log` | `30110b8f52e4cc2e4935db2e4c37ba07be0fec78bd0e217834ca609928e22211` | Lead's root-occupancy failure, inspected here |
| `installed-composition-cgroupfix.log` | `485f874619ace45b7e8f7b74c2bd022fd8ebecfaa740d51fa62c4bc10c9e60a3` | This task's successful startup followed by stop-path failure |
| `installed-composition-stopfix.log` | `be6bd20acab9bba2aea9b2e506b1fddafcc15c12b34d3cc3790808f3db17f8c4` | This task's complete passing installed lifecycle |

## Handoff and remaining limits

Integrate `e9247eb`, `14c52dd` and this evidence commit. The lead owns fresh review of these repairs, joined verification and consistent operations/lane status. No operations documentation was edited here.

The successful fixture demonstrates installed bootstrap and ordinary restart of one accepted candidate. It does **not** establish full installed successor/bootstrap replacement, a failed successor's independently retained rescue path, live model competence, external evaluation quality, conversation/task quality, Slack delivery, or H1. Those remain distinct integration/qualification gates. No real API credentials, provider generation, external messages, production activation or push occurred. All administrator effects were restricted to disposable random fixture units and bounded images, which were cleaned up.
