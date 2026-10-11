# Fresh host succession review

A1-L09-T03/T05, 2026-10-11. Reviewer `/root/a1_host_review`, branch `codex/a1-host-review-20261011`, isolated worktree `/home/palimpsest/migration/aeon-1-20261011/host-review`. Frozen review base `4aa0b72`; independent implementation review with targeted fixes, engineering evidence only. Installer handoff `35c842d` is separately reviewed. No production installation, model requests or paid calls.

Two failures were reproduced on the frozen review base and retained here. Killing the launcher while coordinator initialization was paused caused the coordinator to exit without withdrawing its authority grant. The original test did not observe a surviving serving endpoint, so it establishes an unfenced grant rather than a duplicate serving process. The coordinator now registers IPC/signal lifetime observers before asynchronous initialization, handles failed ready notifications, and always closes controls and withdraws service authority in cleanup. The new frozen-process regression verifies unavailable serving endpoint, released coordinator lease and withdrawn authority.

The selection reader followed a symlink and modified the unrelated SQLite target, and returned malformed selection values. It now requires a private canonical state directory, private singly linked bounded SQLite main/sidecar files, bounded JSON values and exact digest/phase fields. A host binding check runs before opening launcher journals or executing candidate host code; bootstrap also checks first-epoch and exact rescue-manifest binding before execution. A focused check rejects overlapping state/workspace roots before any launcher journal is created. The pending-handoff latch is set before the callback so a failed selection write cannot admit another release.

Validation with Node 24.13.0 and the locally retained compiler closure:

- `node --test deployment/host-successor.test.ts deployment/supervisor.test.ts packages/release/controller.test.ts`: 16/16 passed, 132.5 seconds (retained output).
- `node --test deployment/host-selection.test.ts`: 3/3 passed.
- `npm run check` and `npm run build`: passed.
- `git diff --check`: passed.

The whole-host tests retain fresh prior-policy probation, actual changed launcher/coordinator/evaluator code, failed coordinator startup, failed launcher restart, unavailable keys/proof/evidence/provider, monotonic authority, latest operational state and uncertain-effect continuity. Selection journals live within the separate bounded host-data filesystem supplied by the installer. Its 1 MiB per-file and 8 KiB value limits supplement that volume ceiling. Same-UID accepted host code remains trusted; these pathname checks do not claim isolation from concurrent malicious code with that same host authority.

Initial root bootstrap and physical Node replacement remain open RW14 scope at this review revision. These checks are not H1, autonomous qualification, independent model competence, or production deployment. Installation review follows separately.

## Installer review and corrected append boundary

Installer base `35c842d` was integrated for review. A real disposable systemd unit reproduced an escape from the storage/privilege boundary: the service-owned log directory allowed `coordinator.log` to be replaced with a symlink, and systemd's append open wrote fixture output to a root-owned mode0600 file outside the host-data root. This was an actual observed privileged file write, not only a pathname concern. The fixture used no production file or service.

Fresh host-data provisioning now creates a root-owned log directory and private root-owned regular singly linked log file. Both retain the same filesystem identity as bounded host data. The service writes through its inherited append descriptor; it cannot replace the pathname on restart. Existing mismatched layouts are refused without rewriting/truncating retained data. Selected boot-record reads are bounded to 8 KiB and pre-existing sidecars must remain private/ordinary/service-owned. The separately authored evaluation dispatcher optional config path is accepted only outside both writable provisioning roots; absent reviewer config remains permitted for offline recovery.

Observed validation:

- Actual disposable 16 MiB/128 inode host-data and workspace mounts: installation suite 9/9 passed with no skips, including shared-volume ENOSPC and retained markers.
- Actual transient systemd append under service UID: two writes retained in the root-owned bounded log; service attempt to create a replacement log pathname received EACCES. Administrative unmount/remount retained both writes. No existing log was truncated.
- Final ordinary installer suite: 7 passed, 2 explicit real-mount cases skipped. The optional dispatcher path acceptance/rejection and bounded selection-reader checks are included.
- `npm run check`, `npm run build`, `git diff --check`: passed.
- Both disposable mounts/images removed and transient units collected. No runtime sudo path was introduced. The evidence transcript is retained alongside the failure reproduction.

A second hypothesis—that administrator read-only SQLite preflight leaves root-owned WAL/SHM files—was tested against the unchanged installer and rejected: SQLite created sidecars owned by the main database's service UID, and service write reopening succeeded. A speculative effective-UID switch was removed. Preflight does not mutate authority/main journal records, but SQLite may create same-owner reader bookkeeping files.

Stop/uninstall ownership checks remain byte-exact/root-owned and preserve both data images. Review does not establish production installation or whole-system autonomous readiness. The root-owned initial bootstrap remains an explicit RW14 gap; separately staged runtime-bundle work is delegated to its owner after this host handoff.
