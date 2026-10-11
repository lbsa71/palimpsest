# A1-L09-T02 fresh resource-confinement review

Review owner: `/root/a1_resource_review`, fresh context, worktree `/home/palimpsest/migration/aeon-1-20261011/resource-review`, branch `codex/a1-resource-review-20261011`. Reviewed baseline: `1171ae12da208719c672562a7f245476236ac36d`. Scope: RW10/RW15/RW16, `packages/supervisor/resource-limits*`, `confinement*`, and `provision-workspace.mjs`. Root retains deployment, readiness integration, service configuration and lane-status ownership.

```text
/goal Complete a finite fresh adversarial review of Aeon1 L09 resource confinement at 1171ae1, reproduce consequential bugs, fix owned supervisor confinement/resource/workspace paths, and commit review evidence.
```

## Finding and correction

**P1, fixed: death during trusted launch could execute an orphaned command.** The original gate read a buffered `start` record and then executed `prlimit` and bubblewrap. If the host died after writing that record but before bubblewrap established `--die-with-parent`, bubblewrap adopted its new parent and ran untrusted code. Gate EOF did not invalidate an already buffered record. The original death test waited until the command had started, so it did not cover this window.

A deterministic real-host regression pauses the trusted shell with `SIGSTOP` before its original first instruction, lets the host queue the gate record, kills that host, then resumes the shell. At the reviewed baseline the command created `/work/gate-escaped` after the host had died. The bounded run reported **8 passed, 1 failed**, specifically `Untrusted command ran after its host died`; all original resource cases passed. The pause is a scheduling fault injection, not a replacement for cgroups, namespaces, filesystem limits or signals.

`spawnBounded` now starts `/usr/bin/setpriv --pdeathsig SIGKILL --no-new-privs` before the trusted shell. The shell checks its parent against the original host PID before accepting the gate. The kernel signal covers death after signal installation; the parent check covers death before installation. The ordinary helper exec chain retains the signal, and bubblewrap continues handling death after namespace setup. The same early protection surrounds fixture launches without a resource profile. `setpriv` is therefore an explicit required trusted Linux executable, alongside the existing shell, `prlimit` and bubblewrap; unavailable execution still fails closed.

A second regression pauses before `setpriv` starts, kills the host and resumes the helper. Together the two cases exercise both sides of installing the death signal. Neither may execute the untrusted marker command. The full corrected real suite reports **10 passed, 0 failed/skipped**.

## Other reviewed boundaries

- Cgroup limits are installed and read back before the host releases the shell gate. The gate cannot run untrusted arguments before placement. `cgroup.kill`, populated-state draining and unique nonreused group directories cover detached descendants and restart cleanup. The existing real OOM, PID refusal, CPU throttling, cancellation and established-workload host-death cases were independently rerun.
- Fixed ext4 block/inode capacity is the persistent workspace bound; neither the image device nor cgroup controls is mounted in the worker. RLIMIT file/fd limits and charged tmpfs memory complement that bound. Real ENOSPC and inode refusal were independently rerun. This is an aggregate CPU rate bound, not an aggregate lifetime CPU counter.
- The namespace mount builder resolves trusted roots, refuses overlap with declared protected paths, rejects non-symlink special files/hardlinks, and rejects cross-device nested content with a resource profile. Symbolic links are interpreted within the constructed namespace. Existing real namespace and hardlink/refusal tests passed.
- Provisioning creates a new root-owned layout and does not accept an existing directory; removal verifies its loop backing before unmount/removal. The disposable create/remove path was exercised. These administrator operations assume trusted stable mount inputs and parent directories. The helper is not a worker capability. This review does not certify hostile same-UID host mutation or privileged same-device bind-mount aliases; the original trust-boundary exclusion remains.
- Missing profiles are rejected by `diagnoseResourceConfinement`. Low-level execution APIs still permit omitted profiles for fixtures. Requiring/propagating profiles through every production path remains the root owner's integration task, not established by this component review.

## Commands and observed evidence

Runtime: `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` (v24.13.0). Disposable workspace: 16 MiB / 128 inodes. Each test service had `User=palimpsest`, `Group=palimpsest`, `Delegate=cpu memory pids`, `MemoryMax=256M`, `TasksMax=64`, `RuntimeMaxSec=45`; no installed service was changed.

```sh
sudo -n /opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node packages/supervisor/provision-workspace.mjs create /var/tmp/aeon-resource-review-20261011 1006 1008 16777216 128
sudo -n systemd-run --unit=aeon-resource-review-after-20261011 --wait --pipe --collect --property=User=palimpsest --property=Group=palimpsest --property='Delegate=cpu memory pids' --property=MemoryMax=256M --property=TasksMax=64 --property=RuntimeMaxSec=45 --property=WorkingDirectory=/home/palimpsest/migration/aeon-1-20261011/resource-review --setenv=AEON_RESOURCE_WORKSPACE=/var/tmp/aeon-resource-review-20261011/work /opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test-reporter=tap packages/supervisor/resource-limits.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-reporter=tap packages/supervisor/*.test.ts packages/tools/test/tools.test.ts
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH /home/palimpsest/src/palimpsest/node_modules/.bin/tsc --noEmit --project /home/palimpsest/migration/aeon-1-20261011/resource-review/tsconfig.json --typeRoots /home/palimpsest/src/palimpsest/node_modules/@types
git diff --check
sudo -n /opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node packages/supervisor/provision-workspace.mjs remove /var/tmp/aeon-resource-review-20261011
```

The failing before run used the same service configuration and `aeon-resource-review-before-20261011`. Corrected real results: **10/10**, service exit 0, 8.330 s service runtime; memory peak 67,108,864 bytes and 8 OOM kills in the confined allocation case; 2 pids-limit events; aggregate CPU usage 172,791 microseconds over 1,714.01 elapsed milliseconds with 3,717,873 throttled microseconds. Component results: **20/20**, 0 skipped. Strict TypeScript and whitespace checks passed. An initial TypeScript command without `--typeRoots` failed because the isolated worktree has no local `@types/node`; the corrected command above checks this worktree using the root's installed types, without adding a dependency or modifying root configuration.

Cleanup was verified: workspace/image directory absent, `findmnt --mountpoint` returned no mount, `losetup -l -n -O NAME,BACK-FILE` returned no association, and both transient units were `LoadState=not-found`, `ActiveState=inactive`. No installed service changes, provider calls, external messages or deployment occurred.

## Handoff and limitations

Finite review result: one consequential defect reproduced and fixed, with independent real resource checks and component checks passing. The exact fix/evidence revision is the Git commit containing this document and is returned to `/root` for inspection and integration. The root owns fresh review of this reviewer's correction and integrated readiness. This is **component and bounded real-host verification**, not production qualification, deployment, full L09 completion or H1 acceptance.
