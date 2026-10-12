# H-F1 known operational references before metadata reads

Root repair, 2026-10-12, A1-L08/L09. Frozen contract `68add90`; explicit earlier-refusal fixture supplement `ce5617f`. Independent review `f7e3a51` retains six original failures over source8f4ea2e. Root owns this narrow source change; fresh review is pending.

The behavior collector now scans manifest, observations, original/current requests and transitions using the1,000,000-byte operational ceiling even after the witness has recorded a failed artifact. Only the separate explicit retained metadata inventory receives the signed metadata allowance. The tail collector classifies known behavioral and new operational refs first, then bounded nested prompt refs, then generic B and retained inventories. The final envelope's review/tail/closure refs are likewise bounded before its generic inventory scan. Generic metadata-only objects remain accepted within the unchanged signed32MiB/aggregate/record limits. No schema, grant, capacity, cache credit or projection input changed.

The first focused check was22/23pass: all six reproduced resource defects closed, but an existing independent positive nested-prompt alias case expected the later cached-error message. The actual source refused earlier at its1M read bound. After the explicit fixture supplement, that one positive assertion and the H-authored three-way tail fixture verify earlier refusal and exact1M reader bounds. All six original red independent predicates remain unchanged. No production diagnostic was modified to disguise the changed refusal point. Original tests/failures remain preserved in Git. No redundant new root test file was added; fresh independent review adds held-out coverage.

## Verification

Pinned `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`, v24.13.0:

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 evaluations/development/capacity-profile.test.ts evaluations/development/capacity-profile-review.test.ts evaluations/development/witness.test.ts evaluations/development/witness-review.test.ts evaluations/development/review-envelope.test.ts evaluations/development/review-envelope-review.test.ts evaluations/development/retention.test.ts evaluations/development/retention-review.test.ts
git diff --check
```

Strict and diff pass. Eight-file suite **183/183pass**, zero failures/cancellations/skips,44.333923seconds. Complete log SHA-256 `24f096cc6ee37caad8ad3fc1e192fff3d256ffca62937a13d793a67d8006733b`; temporary log `/tmp/aeon-h-f1-root-tests.log` is not a durable artifact dependency. These commands ran against the final source/test diff committed with this receipt. No recorder/projection/full-trace/native/provider/physical test ran. New fresh classification review, later exact joined recorder/P1/P2 acceptance and whole-workload performance remain open.
