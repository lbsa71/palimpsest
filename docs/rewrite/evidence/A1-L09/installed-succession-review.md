# A1-L09 installed succession and offline rescue fresh review

Status: **engineering review complete with one fixture cleanup repair**. Reviewer `/root/a1_succession_final_review`, independent of the installed rehearsal and provider-absence repair authors. Reviewed source `0789bb619c1b00a5912344acda5a6647f4359d4c`; branch `codex/a1-succession-final-review-20261011`, isolated worktree `/home/palimpsest/migration/aeon-1-20261011/succession-final-review`. Fixture repair `4e5cc5bbaf8cd4a4992c96dc33014b8a485b3b0b`. This does not accept H1 or qualify autonomous use.

## Goal and scope

The actual finite tool goal was to review installed succession and provider-free rescue at the frozen source, assess assertions and evidence, make only owned minimal repairs, and report findings and verification limits. No token budget was supplied or created. Read AGENTS.md, REQUIREMENTS.md, PLAN.md, the workflow, A1-L09, [installed succession](installed-succession.md), [offline credentials](offline-credentials.md), and [prior composition review](installed-composition-review.md). This supports A1-L09-T04/T05 and RW10/RW15/RW16/RW19.

The lead assigned exclusive writes to `deployment/installation-rehearsal.test.ts` and this new evidence file. Reviewed fixture integration `d88b039..0789bb6`, provider-absence repair `c8a0abc582401e07afc361417debfec472ec9eba`, and installation/bootstrap/launcher/CLI/application/supervisor recovery boundaries. No other product file changed. Further delegation would add no useful independent boundary to this already delegated fresh review.

## Findings and disposition

**Fixed: optional trace archival could bypass privileged cleanup.** In the old outer `finally`, an invalid destination, `mkdirSync`, copy or write failure threw before stop/uninstall/unmount. This could leave the disposable unit and volumes running and mask the original test failure. The repair catches and diagnoses archival failures before proceeding with cleanup. It also archives successful traces before normal uninstall unmounts the coordinator-log volume. Existing unit-content guards, store `finally` closure and refusal to remove mounted data remain intact. It does not suppress failures from the actual cleanup or alter succession assertions.

A lightweight isolated reproduction evaluated the actual before/after archival blocks with real temporary files and a regular file as the requested archive directory. Before: `EEXIST` prevented continuation to the cleanup sentinel. After: the same error produced a diagnostic and continuation reached the sentinel. A valid destination then copied both the coordinator log and synthetic systemd-state output correctly. Only the systemctl observation was stubbed; no systemd or mount operation ran. This verifies the archival seam, not privileged cleanup end to end. Retained report: `/home/palimpsest/migration/aeon-1-20261011/integration-evidence/installed-succession-review-archive.log`, SHA-256 `895508332d29b20c745fa8cc94dd4d90a93a5abd3fdcc94cb28fc57f088de48d`.

**Installed assertions substantiate the bounded claim.** The fixture changes executable bootstrap/launcher/CLI witnesses, then verifies the selected actual MainPID's cwd and command, all three executable paths and host-leaf cgroup membership, witness PID/module identities, selected manifest and complete boot-ready authority. Launcher handoff alone must not write the bootstrap witness; only the actual unit restart does. The predecessor judges probation and reused admission evidence is rejected. An unchanged original rescue pointer and a broken active pointer remaining selected after the failure distinguish retained rescue from republishing the incumbent. The failure latch, injected-error log entry and exactly one automatic systemd restart reject an ordinary in-process recovery false positive.

**Provider/evaluator independence is appropriately bounded.** The fixture stops the real unit before removing admission proof, all policy files, key and evidence directory. It preserves the required environment file containing direct authentication only. The rescue's MainPID environment lacks both supported provider-key entries, authenticated health reports provider credential unavailability, and the actual physical-request ledger stays empty. Unit configuration uses `KillMode=control-group`, `Restart=on-failure` and the independent `ExecStopPost` latch. Retained-host restore requires an earlier accepted release event and re-verifies source/runtime; ordinary application startup does not require a provider key. Application `resume` and scheduler admission hold before inference/slice admission when the selected key is absent; direct intake and local acknowledgment reconciliation remain available. An unrelated provider key does not satisfy selection. No additional concrete product defect was found within this review.

The installed memory/effect assertion compares a synthetic fixture namespace's complete revision-2 record, not real autobiographical memory or an actual uncertain external effect. That limitation is explicit in the author's claim and remains here. Zero-request and no-provider constraints preclude competence conclusions. The manually reset start-rate counter affects only the disposable unit before deliberate failure; it does not demonstrate unlimited recurring rescue.

## Verification and evidence attribution

Using Node `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`, existing integration `node_modules` via symlink, and no opt-in mounted/systemd flags:

```sh
node --test --test-name-pattern='offline recovery retains state|authenticated health|OpenAI' deployment/application.test.ts
# 6 passed, 0 failed, 0 skipped; 3.833 seconds
npm run check
# passed, with Node 24 first on PATH
node --test deployment/installation.test.ts deployment/installation-rehearsal.test.ts
# 7 passed, 0 failed, 3 explicit skips; 5.650 seconds
git diff --check
# passed
```

The three skips are the two provisioned-volume checks and the installed opt-in rehearsal. The executed installation checks include systemd rendering, environment constraints, source/runtime rehashing, hostile configuration rejection and append-log protection. They are not a second installed succession run.

Independently inspected retained author output: `installed-succession-after.log` records **1 passed, 0 failed, 0 skipped**, 92.964 seconds at author source `3ac7ac6b49a9a02da2d0758f9cc5d1a6c0866f64`, epochs **1 → 3 → 7 → 9 → 13 → 15**, restart count **0 → 1**, and 48% use of the bounded 1 GiB host-data filesystem. SHA-256 of all six `installed-succession*.log` files exactly matches the author's table. The fourth preserved failure contains the intended broken-bootstrap error followed by unavailable selected-provider errors. Earlier failures remain evidence, including the first failure whose cleanup masked its primary cause.

The fixture, installer, bootstrap and host-launcher source at author revision `3ac7ac6` and review base `0789bb6` compare identically. Application, supervisor and release-controller code have intervening changes; the author run must not be relabeled an installed run of the later integration revision. Fresh focused application checks above cover the offline constructor/intake/resume path at the review base. The lead was running another physical dispatcher test, so no concurrent heavy source-freeze/systemd/mounted suite was started. A joined installed rerun belongs to the lead's serialized final integration gate.

The original successful coordinator trace was unmounted before archival and is unavailable; this repair cannot reconstruct it. The author's successful test output and checked source assertions support its reported observations, while its independent post-run cleanup inspection remains attributed to the author. The new pre-uninstall archival path has the isolated seam check above and still awaits execution in a later full installed run.

## Handoff

Integrate `4e5cc5b` plus this evidence commit. No unresolved finding remains in the assigned review scope. The lead owns joined integration verification, lane/status updates, live model and external-evaluator qualification, actual developmental-state/uncertain-effect demonstrations, and H1. No paid provider call, external message, production service change, privileged installation, network generation or push occurred in this review.
