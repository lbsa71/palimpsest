# Supervisor and release boundary — implementation record

Owner `/root`, A1-L09-T01–T04, starting revision `14c7420`. This is current implementation evidence, not final L09 acceptance.

The host owns an external SQLite authority ledger, artifact/evaluation stores and recovery inputs. Workers receive an epoch/generation/control grant and narrow receivers; these state paths are absent from their mount namespace. A serving grant is withdrawn before successor activation. Epochs always increase, including recovery to earlier code. Current lived state is separate from release code and is never rewound by selecting a retained artifact.

The Linux command receiver uses Bubblewrap user/PID/mount/network namespaces, a writable assigned workspace, read-only system executables and optional pinned Node, isolated `/proc`, bounded temporary storage, cleared environment and disabled nested user namespaces. It kills the namespace on deadline, cancellation or excessive output, including descendants that start another process group. Host research/model/communication transports must use separate authenticated receivers with effect accounting; the command worker receives no host network or credentials. Runtime quotas beyond timeout/output are remaining integration work.

| Failure boundary | Required behavior | Current evidence / remaining work |
|---|---|---|
| Duplicate/stale process grant | Receiver refuses before dispatch | Two independent SQLite handles, persisted withdrawal/reopen and stale activation checks pass |
| Candidate process tries to read protected state | State/control/rescue are absent; overlapping mount request is refused | Real namespace process cannot see synthetic private state; overlap test passes |
| Command forks, outlives deadline or floods output | Entire namespace terminates and receipt records the reason | Real detached descendant, timeout, cancellation and output-limit tests pass |
| Isolation unavailable | Diagnose unavailable; do not execute unrestricted fallback | Bubblewrap error is returned; broader installation readiness check remains |
| Failure after external dispatch | Preserve uncertain outcome; reconcile before retry | L03/L07 integration pending; withdrawal cannot undo an already sent request |
| Successor fails or model unavailable | Host withdraws grant, restores retained executable with a newer epoch using latest external state | Authority-only recovery fixture passes; actual assembled successor/recovery remains pending |
| Candidate alters its own checks | Frozen prior controls and independently authenticated evidence remain authoritative | Exact-artifact release admission implementation underway |
| Control/evaluator replacement | Prior admission accepts a separately staged control change, then later candidates use it | Real staged replacement rehearsal remains pending |

Observed initial verification: Node 24.13.0, TypeScript 7.0.2; strict check and six supervisor tests passed. The first build exposed TS7's explicit `rootDir` requirement and was corrected; the subsequent build passed. The first confinement run exposed Bubblewrap's requirement for explicit `--unshare-user` alongside `--disable-userns`; this was corrected and the actual process tests rerun. No claims rely on the failed initial runs.

No legacy code was copied. SQLite for atomic authority changes and Linux namespaces for workspace/process confinement are adopted because the fresh design needs those mechanisms. The current implementation is not yet a complete deployment, full resource controller, authenticated broker or independent acceptance of the release architecture.
