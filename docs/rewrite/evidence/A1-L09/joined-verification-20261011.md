# Joined verification and installed recovery — 2026-10-11

Root integration evidence; deterministic engineering only. No paid generation, external message, production installation or H1 acceptance occurred.

The complete 67-file suite at `dbab4be4e05a6be358fae376b2ca19934b35e5d2` ran with Node 24.13.0 and test concurrency one: **572 tests, 565 passed, one failed, six explicit opt-in skips**, 640.999 seconds. Strict compilation had passed. The failure was `deployment/host-boundary-review.test.ts` starting a service without the now-required persisted serving-authority grant. Two rejection cases also failed before their intended diagnostic boundary and therefore needed stronger assertions. Production authority enforcement behaved correctly.

Repair `149dbc8` bootstraps the real candidate-bound authority in those fixtures and requires a child-written startup marker plus the intended readiness error before checking diagnostic cleanup. The exact corrected file passed **6/6, zero skips**, in 28.736 seconds; strict compilation passed. The failed aggregate remains a failed aggregate, not a retrospectively relabeled pass. A later joined run covers new batch/calibration/qualification source separately.

At integrated `cc72d1c864407c6c085145279260aebbf30c8048`, compiled build and the actual disposable installed-succession fixture passed **1/1, zero skips**, in 98.214 seconds. Actual authority epochs were 1→3→7→9→13→15. Accepted runtime/bootstrap/coordinator replacement was followed by a deliberately broken accepted bootstrap; exactly one systemd automatic restart selected the retained rescue. Latest revision-two lived state and the uncertain-effect marker survived. Provider environment entries, model requests and external messages were zero. Host data used 485,199,872 bytes of the fixed volume (48%). Exact disposable unit/mount cleanup was checked. Success coordinator diagnostics were archived before unmount, unlike the earlier author's first archival arrangement.

This installed source precedes ordinary batch delegation and qualification observer integration; it establishes the installed bootstrap/recovery composition at the stated revision. Those later components have their own exact-source author/fresh-review evidence and joined verification requirement.

Commands used the binary `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`. The aggregate enumerated all rewrite tests under `packages`, `deployment`, `evaluations` and `experiments/agent-shell`, excluding vendor/node_modules/dist, then used `--test --test-concurrency=1`. Corrected lifecycle used `--test deployment/host-boundary-review.test.ts`. Installed verification used:

```sh
sudo -n env AEON_INSTALLED_SUCCESSION=1 AEON_FIXTURE_UID=1006 AEON_FIXTURE_GID=1008 \
  AEON_FIXTURE_LOG_DIRECTORY=/home/palimpsest/migration/aeon-1-20261011/integration-evidence/installed-cc72d1c-traces \
  /opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test deployment/installation-rehearsal.test.ts
```

Private/local transcripts are outside the source checkout under `/home/palimpsest/migration/aeon-1-20261011/integration-evidence/`:

| Artifact | SHA-256 |
|---|---|
| `aggregate-dbab4be.log` | `73a7da8af012b70d0e4f99324f2371590021c26f8e75b44196b349380d7780ca` |
| `host-boundary-149dbc8.log` | `757db20665fffe12f8304bedc2d75d9155126d243d275f01be67c0fb09ecbead` |
| `installed-cc72d1c.log` | `64cd2f4fae98527476b2f7581ac14fc67dc48f78f92007d792a983252aa9691f` |
| `installed-cc72d1c-traces/aeon-fixture-809112-572c1d44.service.coordinator.log` | `1e67ec86a0067886271c2c847160f7dcdfb3d70444b6d42d7fbb82bcded41394` |
| `installed-cc72d1c-traces/aeon-fixture-809112-572c1d44.service.systemd.txt` | `2dc52171b68cb547a2ff0eaf380554c11edd58bf8010811e1115a727eb295cdf` |

The six aggregate opt-ins were actual systemd descendant/failure-latch behavior, installed succession, administrator-provisioned workspace and host-data mount checks, native Codex synthetic transport, and native Codex kernel limits. Their explicit separate evidence is not an assertion that the aggregate executed them.
