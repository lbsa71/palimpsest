# A1-L09 installed successor and offline rescue rehearsal

Status: **fixture-verified engineering behavior**. Owner `/root/a1_installed_succession_run`; branch `codex/a1-installed-succession-20261011`; worktree `/home/palimpsest/migration/aeon-1-20261011/installed-succession`; base `f9061741695af5154c608e8f15fb5eb0d45141ae`. Verified code revision: `3ac7ac6b49a9a02da2d0758f9cc5d1a6c0866f64`. Lead integration, fresh review and product qualification remain separate gates.

## Finite goal and ownership

`/goal Implement and verify the opt-in installed successor/offline rescue engineering rehearsal and document its measured evidence in A1-L09, with a clean scoped commit and handoff.` An actual finite tool goal was created before inspection, with no token budget because none was supplied by the user.

Exclusive authored paths: `deployment/installation-rehearsal.test.ts` and this evidence file. The lead separately repaired provider-free startup in `c8a0abc582401e07afc361417debfec472ec9eba`; this worktree applies that repair as `409fe4e9d7d8e993e6f26fb006209bb7917cbab6`. Its only conflict resolution retains this older base's existing obligation reconciliation before the new provider-availability guard, without importing unrelated asynchronous-continuation changes. Strict check, build and focused application checks passed on the adaptation.

This closes the installed composition gap identified in [installation composition](installation-composition.md): the previous installed fixture demonstrated one candidate's ordinary boot/restart, while host succession and bootstrap recovery were separate mechanical fixtures.

## Behavioral specification and implementation

`AEON_INSTALLED_SUCCESSION=1` enables the joined case in the existing actual-installation fixture. The original `AEON_INSTALLATION_REHEARSAL=1` case remains available. Before writing the initial host configuration, the fixture freezes the incumbent, a successor with executable witnesses in three changed bootstrap/launcher/CLI paths, and a bootstrap that throws only during its direct `run` operation. It registers all three explicit host policies before initial admission. The initial and transition proofs are signed synthetic engineering judgments; their `independent` field exercises an admission contract and does not establish an independent product evaluator.

The real predecessor coordinator stages and activates each control upgrade and judges fresh probation. Reusing admission evidence is rejected. Launcher succession changes the running coordinator but does not execute the successor bootstrap; an ordinary actual-unit stop/start then executes that changed bootstrap. Assertions bind the installed MainPID's cwd, cmdline and executable, coordinator module/PID, service PID, three executable witnesses and boot-ready authority to the selected frozen candidate. The controller root remains empty and all three serving processes occupy its `host` leaf. Original rescue selection remains unchanged.

After succession, the fixture advances the retained current-experience/unresolved-effect marker to revision 2. It separately admits the broken bootstrap, stops the real unit, removes the bootstrap proof, all policy files, evaluator key and evidence directory, and removes every provider-key entry from the environment input. The required `EnvironmentFile` itself remains present with only the direct-surface authentication token. This is provider-free recovery, not a claim that a missing required environment file boots.

The fixture's fourth deliberate manual start would exceed the unchanged unit's `StartLimitBurst=3` within 300 seconds. It explicitly resets only this random disposable unit before fault injection. The failed bootstrap then reaches the real `ExecStopPost` latch; systemd drains its cgroup and performs its normal failure restart into the independently retained original snapshot. No earlier coordinator remains serving in memory. Recovery leaves the failure latch set and the broken active pointer unchanged, demonstrating that the retained rescue is selected independently. No rescue rotation or in-process fallback substitutes for this installed path.

All opened fixture `OperationalStore` handles close in `try/finally`, including assertion failures. Cleanup retains exact-unit-content guards, verifies mounts are absent before deleting the temporary root, and retries a just-stopped host-data unmount for at most two seconds. Optional failure traces are copied outside frozen source before cleanup.

## Before/after evidence

Four failed runs were preserved rather than replaced with passing claims:

| Run | Source at launch | Observed failure and disposition |
| --- | --- | --- |
| `installed-succession-before.log` | `c863376` | Successor actual restart reached epoch 9. A fixture state update used a creation-only revision; the existing cleanup assertion masked the primary failure. Exact unit was stopped; remaining host-data mount was manually unmounted after the runner exited, then only that fixture root was removed. |
| `installed-succession-before-2.log` | `62da7e1` | Added diagnostics exposed `RevisionConflict: expected null, found 1`. The open fixture database also kept its host volume mounted; the same bounded manual cleanup succeeded. Current-revision updates and unconditional store closure were then implemented. |
| `installed-succession-before-3.log` | `03cbe9c` | Full successor/broken-host acceptance reached epochs 1, 3, 7, 9, 13. The fourth manual start hit the real systemd burst limit before bootstrap execution. Cleanup completed. The fixture now resets its exact disposable unit before measuring automatic recovery. |
| `installed-succession-before-4.log` | `94d9b16` | The broken bootstrap emitted its intended failure, then original retained rescue twice failed with `Selected provider credential unavailable`. The bounded readiness check failed after 106.24 seconds; saved systemd state was failed/exit-code, `NRestarts=3`. Cleanup completed. This is the actual installed pre-fix provider-input regression. |

The final repaired run at `3ac7ac6` passed **1/1, zero failures, zero skips**, in **92.96 seconds**:

```sh
sudo -n env AEON_INSTALLED_SUCCESSION=1 AEON_FIXTURE_UID=1006 AEON_FIXTURE_GID=1008 AEON_FIXTURE_LOG_DIRECTORY=/home/palimpsest/migration/aeon-1-20261011/integration-evidence/installed-succession /opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test deployment/installation-rehearsal.test.ts
```

| Frozen candidate | Identity |
| --- | --- |
| Incumbent/original retained rescue | `d6cd8d18c192534d410249deeb5af19793cd7c1910b0f8d98398611ec2cc6fdd` |
| Changed installed bootstrap/launcher/CLI | `49445e2894dc5a24f61466adfbfb2f1187c2bbc500a0a880d1f1390509beb820` |
| Separately accepted run-only broken bootstrap | `23da712782cf2f623da243f5e9ea55248247e10116224d3bea034d56fcbfa9d6` |

Observed serving epochs were **1 → 3 → 7 → 9 → 13 → 15**. The final failed-bootstrap restart advanced `NRestarts` **0 → 1** and restored the original retained bootstrap/coordinator/service executable paths. Authenticated health remained alive with configured kernel limits, execution held for `provider-credential-unavailable`, and provider connectivity unprobed. MainPID had no Mistral/OpenAI key environment entries. Current revision-2 experience and unresolved-effect records were unchanged, and the actual ResourceLedger namespace `requests` contained **zero** records.

The 1 GiB host-data image and 128 MiB workspace image were sufficient without increasing capacity. Immediately before fault injection, ext4 reported **484,122,624 bytes used / 528,191,488 bytes available** (48% usage), including all three retained Node snapshots and source closures. After rescue it reported 483,381,248 used / 528,932,864 available. Ordinary uninstall preserved both backing images before the fixture's final removal. Post-run unit-file/unit, mount, loop association and temporary-root inspection found no rehearsal leftovers.

Additional verification: Node 24 filtered `authenticated health remains|offline recovery retains` application checks passed **2/2**, zero skips, in 1.21 seconds at `409fe4e`; strict `npm run check`, `npm run build`, `git diff --check` and clean Git status passed at final code `3ac7ac6`. The optional installation fixture was separately confirmed skipped when neither opt-in flag was set; that skip is not counted as execution evidence.

Pinned Node v24.13.0 SHA-256: `53fb205ae78805130177e24bcb459a69a1518c8d98f8965f31d85aae7ea840fc`. Lockfile SHA-256: `cc2956d305c7bbb1be7d58bde7b1d257ff8329ca73d55d1cfb8ee92d2712efc0`. Existing trusted development dependencies were resolved from the integration checkout and copied into ordinary fixture source before freeze; no lockfile/dependency edit occurred. Candidate prompts prohibit inference in this synthetic fixture; model `fixture-no-provider` and its host grant allow zero requests/tokens/cost.

## Retained logs and handoff

Logs are outside Git in `/home/palimpsest/migration/aeon-1-20261011/integration-evidence/`:

| File | SHA-256 |
| --- | --- |
| `installed-succession-before.log` | `c908faa660f91420930511278284eb59828f80ba47d2dbf6ead52d8373b51eee` |
| `installed-succession-before-2.log` | `af3f4748541a5f353f99de5e6f72a03fcff8978b0d3a97aa68ab08c637a76622` |
| `installed-succession-before-3.log` | `20eacba173157480c6537e1e6ac355081983a8d43ef8da419cf8aba8e09fc05d` |
| `installed-succession-before-4.log` | `1e35024ab6b538745ac820b48d06d1fce5448227ee81bd9774ede020def59f6f` |
| `installed-succession-after.log` | `2b4e32b76e359674aba9e6da2d49d66dab4748b1bca7c4ca114b87287d8597ac` |
| `installed-succession-offline-light.log` | `3c673e10c8fce7d1f3741ee7ca458856591647e3dbe599efbad5201ebab0cb9f` |

The `installed-succession/` subdirectory also retains each failed unit's coordinator log and systemd state before cleanup, including the original bootstrap failure and missing-provider diagnosis. The successful run's retained test output records assertions and observations; its coordinator file had been unmounted by ordinary uninstall before final failure-log archival, so no separate successful coordinator trace is claimed.

For the lead's existing repaired integration, integrate fixture commits `a601c18`, `c863376`, `62da7e1`, `03cbe9c`, `50ebfa9`, `94d9b16`, `3ac7ac6` and this evidence commit. Do not duplicate `409fe4e` where the lead's original `c8a0abc` repair is already present. The lead owns fresh review, joined verification and consistent lane/operations status.

This establishes installed engineering succession and provider/evaluator-input-independent rescue, with synthetic current-state retention. It does not establish live model competence, held-out continuity judgment, autonomous improvement, conversation/Slack delivery, arbitrary power-loss recovery or H1. No real API credential, provider generation, external message, production installation, old-service restart or push occurred. Administrator effects were limited to random disposable units and bounded volumes.
