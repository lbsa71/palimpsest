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

## H-F2 preserved first repair

Fresh review `e3098a5164ff8bb965578bfd2277ec316a186996` adds14 held-out cases:12pass/2fail on83e76b1,1.809seconds final run; prior183pass. Exact1M controls pass; larger operational aliases are read at32MiB during final B reconstruction and copied twice before later refusal. Root's pre-code supplement2533dc0 freezes a shared bounded prompt/ref helper and earlier final admission.

The first root H-F2 implementation fixes all14 held-out cases but moves review/T checks before B reconstruction for *both* attempt versions. The nine-file check records197total,189pass/8fail,zero skips,48.190821seconds (logSHA `1e520562c1b5635bdceead80f68b8eb7dea1be233e7f28ec346f6f6a5d0f5d4d`). Eight old version1 causal tests still reject invalid envelopes, but now report review/B-binding instead of their original inventory/history/overhead reason. This is an unnecessary validation-order change for the old1M profile. Root preserves this failed source checkpoint, then restricts early whole-envelope preflight to the explicit larger version2 profile while leaving original version1 sequencing unchanged. No assertion is edited. The standalone tail helper remains shared and bounded.
