# Retired system decommission receipt

Executed 2026-10-11; final check **16:13:07 UTC / 18:13:07 Europe/Stockholm**. Authorized by the user's full-rewrite direction: the current systemd process may be stopped and uninstalled. This is an actual operational change; rewrite implementation is still only planned.

## Before

- Source baseline: `b5fb789066f639b5c8979ad309b3c081d20c7d7b`.
- Installed unit: `/etc/systemd/system/palimpsest.service`, enabled and active.
- Main PID: `374800`.
- Sealed host: `ec8d7b39089623e485b238195ae177b40c1d8fd0a71e09d64fd461b8e6e6182a`.
- Loopback API: port `59940`.

## Action and observed result

1. Archived the exact unit and pre-stop status under `/home/palimpsest/migration/aeon-rewrite-decommission-20261011/` (private local evidence).
2. Ran `sudo systemctl disable --now palimpsest.service`; stop completed successfully and the multi-user enablement link was removed.
3. Verified `MainPID=0`, `ActiveState=inactive`, `SubState=dead`.
4. Removed the installed unit file and ran `sudo systemctl daemon-reload`.
5. Verified `LoadState=not-found`, `MainPID=0`, `ActiveState=inactive`, `SubState=dead`, and no unit-file enablement state. No listener remained on TCP port 59940. The system unit-file listing contained no `palimpsest.service`.
6. A process search found no matching sealed-host service or worker process. A user-systemd query could not connect to a user bus; no claim is made about a separate user manager from that query. The inspected retired installation was a system unit.

The similarly named `home-palimpsest.mount` is the user's filesystem mount, not the Autark service, and was left intact. No unrelated service was stopped.

## Preserved

Historical source/worktrees, `/home/palimpsest/.local/share/palimpsest/instance`, private configuration, prior deployment receipts, sealed host bundles and recovery anchors remain on disk. Their retention is archival; the rewrite has no dependency on their schema, interfaces or deployment layout. This task did not delete lived experience, expose credential contents, revoke Slack credentials, or start a replacement service.

The old service will not answer Slack messages while uninstalled. The new communication lane must declare recovery coverage, including any gaps accumulated during this rewrite; preserving old data is not a promise to import it automatically.
