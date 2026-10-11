# Authenticated objective observer: fresh review

Review owner: `/root/a1_qualification_review`, Aeon 1 / A1-L08-T06. Isolated branch `codex/a1-qualification-review-20261011`, worktree `/home/palimpsest/migration/aeon-1-20261011/qualification-review`. The author froze qualification source at `fda4b029688db19f78bfb4d15fa13f3ac555ec1f`; this review owns only `evaluations/qualification/**` and this record. Contracts, deployment, configuration and dependencies remained read-only.

Finite goal: independently inspect the authenticated objective observer, reproduce and repair consequential defects within that scope, verify the final source with bounded checks, and hand off exact revisions and remaining qualification limits. The review read `AGENTS.md`, `REQUIREMENTS.md`, `PLAN.md`, the planning workflow, L08 and protocol v2 before implementation. Root coordinated physical tests to avoid contention with installation and parallel-runtime checks.

## Finding and repair

**Aggregate physical elapsed time was omitted during conversion.** The operating `ResourceLedger` accounts elapsed time as the larger of original wall time and the sum of physical-request elapsed time. The converter used only `endedAt - issuedAt`. An isolated reconstruction with test signing keys and retained passing artifacts accepted two physical requests of 40,000 ms under a 60,000 ms envelope when wall time remained under that ceiling. No worker or provider was invoked by the reproduction; it demonstrated a consumer validation gap, not a live overrun.

Repair `08daf5a8a6c9f0f78948371536b4ba79b4f6424a` uses `max(original wall time, summed physical elapsed)` both for the evidence's usage and the envelope check. The new reconstruction tests verify both branches of that maximum, reject the 80,000 ms total, reject unknown usage/outcomes even with passing artifacts, and reject failed or expired observations. Test-key authored records exercise the authenticated consumer only; they are not independent product observations.

The author's earlier canonical configuration correction and synthetic-only omission of `liveSeal` were present before this repair. The reviewed manifest already used an inert snapshot before HMAC verification: getters, proxies, hidden/sparse properties and cycles cannot change the authenticated experiment during later reads. No duplicate authentication repair was needed.

**The synthetic privacy assertion matched an unrelated timing decimal.** After incorporating author diagnostic fixture `fa30a3d` as `af39cf8`, the actual composition failed before its first synthetic reply: `payload.includes('9999')` flagged ordinary retrieval metadata. A second diagnostic run captured `elapsedMs:1.189140999999836` as the exact match. Repair `7e1765317ee5ed04882145e866f133953f26034b` checks an integer token boundary, retaining the private check ID and private path assertions. Neither private check inputs nor expected outputs were changed to obtain a pass. The diagnostic failures and passing run are preserved below.

## Boundary review

- Experiment signatures use an explicit domain and an externally supplied issuer map. Exact candidate identity, prior policy/control revision, evaluator artifact, protocol, calibration plan and private packet are checked before execution. These host allowlists are prerequisites; the code and this review do not establish their external independence by themselves.
- The descriptor-pinned private store makes both experiment and grant IDs one-use. Reopening the store does not reset either claim. The operating allocation starts at signed `issuedAt`; dispatch and observation retain the original expiry. A crash may conservatively spend a grant without a final bundle; this is unavailable evidence, never permission to retry the same grant.
- The observer inventories its source closure and Node binary; the invoked candidate is verified and its packages/deployment closure must match the observer's imported host tree. The candidate runtime must match the actual observer runtime. The host is assumed to remain trusted and immutable during invocation; this is not a measurement of hostile host compromise or already-loaded code after host-side file replacement.
- Private packet bytes are read from an owner-only root outside worker application/workspace/state/system mounts. Only the public task enters model context. After the application is stopped, each verifier command receives its explicit test input arguments in a fresh confined worker; expected outputs and the packet remain host-private. This does not mean a tested program cannot see the inputs used to invoke it.
- Objective commands reserve and settle actual physical requests under the shared operating allocation. They run through `runConfined`, use the pinned Node runtime, bounded output/time and the configured resource profile, and protect evaluator/state/application paths. Live observation requires a kernel resource profile. Artifact reads reject symlinks, hardlinks, nonregular files, invalid UTF-8, oversized files and changes during the read.
- Retained content is content-addressed and read back for conversion. Conversion rechecks experiment/report/configuration/model identities, exact physical request inventories, private outcomes and original timing. Unknown usage or unsettled outcomes cannot qualify. Synthetic entrypoints and author adapter reports alone cannot become live release evidence.
- This observer is restricted to externally allowlisted objective artifacts under the accepted host/control revision. A changed-host or changed-control candidate needs a separate frozen-service observer. Subjective judgment, comparator parity, developmental competence and H1 remain unavailable; authenticated developmental witnesses remain explicitly unqualified.

## Validation and acceptance

Node: `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` (v24.13.0). The worktree uses the root's existing `node_modules` through a read-only-use symlink; no dependency installation or edits occurred.

On repair revision `08daf5a8a6c9f0f78948371536b4ba79b4f6424a`:

- `node --experimental-strip-types --test evaluations/qualification/qualification.test.ts evaluations/qualification/reconstruction.test.ts`: **18 passed, 0 failed, 0 skipped**.
- `node node_modules/typescript/bin/tsc --noEmit`: **passed**.
- `git diff --check`: **passed**.

Final executable revision `7e1765317ee5ed04882145e866f133953f26034b` includes the accounting repair, the author's callback diagnostics and the integer-token fixture correction:

- `AEON_QUALIFICATION_FIXTURE=1 node --experimental-strip-types --test evaluations/qualification/composition.test.ts`: **1 passed, 0 failed, 0 skipped**, 9.105 seconds. Seven synthetic provider replies drove an actual workspace write, seeded failing command, observed repair and successful verification. Both private command checks passed. The fixture checked the original allocation start/envelope, two verifier requests, cancelled final allocation, rejection of same-grant replay and rejection of synthetic release promotion.
- `node node_modules/typescript/bin/tsc --noEmit` on that final executable revision: **passed**.

All three review transcripts are retained as owner-only, read-only files under `/home/palimpsest/migration/aeon-1-20261011/qualification-review-trials/`:

| Transcript | Result | SHA-256 |
|---|---|---|
| `a1-qualification-review-composition-1.tap` | Failed at `af39cf8`; private integer substring assertion before first fixture reply | `5b431673a1a12ec5619a4498efa5772c6c3082a8a9acece79641013ce6d6dcc1` |
| `a1-qualification-review-composition-2.tap` | Failed at `af39cf8` plus temporary diagnostic-only match-context text; identifies the timing decimal | `b079c20261710b3cca2da30bcb299bd33a5e32254301a5c87e97f516f4a37fe7` |
| `a1-qualification-review-composition-3.tap` | Passed at `7e17653` | `f8d2b81864ee3ebf39259382be169573b55680aeb58a92e367305ed6ba3a45db` |

Fresh review disposition: **accepted for integration as bounded observer engineering, with the two findings repaired**. The scoped review goal is complete upon handoff. The actual trial remains synthetic: it did not exercise a live provider or the live kernel-resource configuration, and it does not qualify an evaluator, objective workload, product, parity result or H1. External trust establishment and authorized live/held-out runs remain separate entry gates. No paid provider call, external message, push or production change was made.

Integration owner: `/root`. Pick `08daf5a` for the accounting repair and reconstruction regressions, `7e17653` for the fixture correction, and this evidence record. The diagnostic fixture is author commit `fa30a3d` (equivalent review cherry-pick `af39cf8`); integrate one copy only. Author evidence commits remain separate. Recompute the observer artifact from the final integrated source before any externally issued experiment; this review's exact-source trial is not transferable merely by copying its signature or result.
