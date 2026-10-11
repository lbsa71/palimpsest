# A1-L08 bounded raw-store independent review

Status: **independently reviewed and fixture-verified; R1 resolved; component approved for downstream integration**. Fresh reviewer `/root/a1_development_raw_store_review`, branch `codex/a1-development-raw-store-review-20261011`, worktree `/home/palimpsest/migration/aeon-1-20261011/development-raw-store-review`. Root reservation `8e1ea65`. Inspected exact clean author handoff `6c6da87`, implementation `fd7ab1141d5a391ddb8334fcddafb2d9fbc80b74`, pre-code contract `b694edb`. Exclusive reviewer writes: [new review tests](../../../../evaluations/qualification/store-bounds-review.test.ts) and this record. Production repairs were authored by root and integrated unchanged for verification; the reviewer did not edit production, prior tests or historical evidence. The reviewer created an actual finite goal before inspection; no further agent was spawned.

```text
/goal Independently review the bounded raw QualificationStore extension in the reserved worktree; add narrowly scoped review tests and evidence, reproduce any actionable failures, coordinate their disposition, run focused Node 24 verification, and return a clean review commit.
```

Governing inputs: root requirements/plan/AGENTS, [workflow](../../workflow.md), [L08](../../lanes/A1-L08-evaluation.md), [adopted acquisition design](development-acquisition-design.md) and [frozen store behavior/evidence](development-raw-store.md). Inspected the source diff, existing author tests, actual qualification observer consumers, development `BoundedArtifactReader` and canonical JSON/lease implementations. This is component engineering review, not acquisition or acceptance qualification.

## R1 — known-size duplicate verification exceeds its necessary read bound

Root supplied the hypothesis during review; the reviewer independently reproduced it against unchanged source. `putBytes` owns the exact proposed bytes and therefore knows the largest valid duplicate length. Both its initial duplicate read and its `EEXIST` recovery read omit that limit, defaulting to `capacityBytes`. A corrupted existing artifact larger than the input is allocated and read before equality rejects it. Corruption is **not accepted**, but a tiny or empty raw write can cause an unnecessary store-cap-sized read. This direct known-size verification is separate from the existing inventory scan in `usage()`; the latter is explicitly unchanged by this task.

Three frozen causal cases use a 1024-byte store and a real 100-byte temporary file, never a large materialization:

1. Retain one byte, replace its content with 100 bytes, then repeat the original `putBytes`.
2. Retain empty bytes, replace the empty artifact with 100 bytes, then repeat the empty `putBytes`.
3. Delete the original one-byte artifact and inject a real competing 100-byte file immediately before the store's exclusive-create open, causing actual `EEXIST` and exercising its recovery read.

All three reject corrupt bytes but report **two `Buffer.alloc` calls and two `readSync` calls**, where the tests require zero: the payload and the EOF probe. The third case injects the race timing with an `openSync` wrapper; it is not evidence of independent concurrent writers defeating the lease. Allocation/read wrappers call the real builtins and record counts. The proposed narrow repair supplies `bytes.byteLength` to both existing duplicate reads, including zero for an empty input. Root coordinates production ownership; the reviewer does not edit it.

Frozen reproduction command (Node 24.13.0):

```sh
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH \
  node --test --test-concurrency=1 evaluations/qualification/store-bounds-review.test.ts
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH npm run check
```

Observed before repair: **14 review tests, 11 passed, 3 failed, zero skips/cancellations**; each failure is the exact R1 allocation/read counter mismatch. Normal strict compilation passed. The three failing expectations are frozen for repaired-source verification.

## Independent coverage and evidence limits

The other eleven review cases establish all-octet retention from a nonzero-offset `Uint8Array` view, input ownership, unchanged canonical JSON ordering/rejections without extra persisted entries, a concrete `BoundedArtifactReader` forwarding a smaller remaining allowance, named reads independent of unrelated inventory, multi-chunk explicit-offset reads plus EOF, no returned bytes and closed descriptors after injected partial-read I/O/EOF or final-stat errors, real same-size mutation with original mtime restored, real unsafe permissions/hardlinks rejecting before allocation/read, and persisted raw evidence with full-capacity deduplication after closing/reopening the lease.

Fault wrappers deliberately inject I/O failures and timing; file bytes, metadata mutations, descriptor closure and ordinary reads are real temporary-file observations. Existing author cases cover exact-bound/empty reads, growth/shrink/hash failures, pathname/directory replacement, entry ceiling, one-use claims and lease exclusion. Their FIFO and foreign-UID cases use injected metadata; this review does not turn them into real FIFO/foreign-owner experiments. The reviewer does not change UID or launch a FIFO subprocess.

The default omitted read limit remains the store cap for existing JSON consumers. The future development adapter must forward its per-artifact or smaller remaining allowance; merely providing this method does not wire acquisition. No assertion here establishes the attempt-wide 512-record/8-MiB accounting, tail reservation, raw observation completeness, process/clock qualification, review competence, physical accounting, deployment or H1. No native baseline, model/provider/account/network/Slack/push/deployment operation occurred, and no broad materialization/hash sweep was run.

## Final disposition

**R1 resolved.** Frozen review reproduction `39d1193afc4c6df84b85769c3358d1baadfe6569` remained byte-for-byte unchanged. After the original author's finite goal completed, root assumed exclusive ownership of the narrow repair: pre-code record `4c34be1`, source `b8559957de6d9b88fb3450da44da6ac6db8723a9`, repair evidence `e2dd9b5`. Root changed exactly the two `putBytes` duplicate reads to pass `bytes.byteLength`; no inventory, capacity, JSON, lease or framework change was introduced. The reviewer cherry-picked those three commits as `6ec1360`, `826f51a`, `6f16000` for independent verification, at root's instruction.

At exact joined reviewer checkpoint **`6f160000cda79daffa8bd73facf7ef63bd734db4`**, rerunning the two commands above independently produced **14/14 review tests passing, zero failures/skips/cancellations**, about 0.536 seconds, and successful normal strict compilation. Each R1 case now records zero allocation/data-read calls. `git diff 39d1193 HEAD -- evaluations/qualification/store-bounds-review.test.ts` was empty; `git diff --check` passed. The test payload/read bound, empty case and `EEXIST` injection were not weakened to obtain a pass.

Root separately ran strict compilation and the combined 27 author + 14 reviewer cases on its joined `4e04332` checkpoint:

```sh
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH \
  node --test --test-concurrency=1 \
  evaluations/qualification/store-bounds.test.ts \
  evaluations/qualification/store-bounds-review.test.ts
```

The reviewer inspected root's transcript at `/tmp/aeon-raw-store-b855995-focused.log`: **41 passed, zero failures/skips/cancellations**, about 1.233 seconds; SHA-256 `84769f80cfa9383c64e4f224dcbb57d9d5f096f92e1943bc125bf3c1f7f2e6ea`. This is root-run evidence, distinct from the reviewer's independent 14-case rerun. The original author handoff's 76-case affected-consumer run is preserved in its evidence; it was not rerun after this two-call repair. Root explicitly limited final repetition to the original review controls plus source-scope inspection unless an unresolved concern justified more. None remains, so no broader suite or materialization sweep was started.

No further actionable source finding remains from this bounded review. Approve the component's exact-byte retention and bounded descriptor-read prerequisite for downstream acquisition integration. Root owns integration and lane status. The next owner must actually supply remaining read bounds, budget distinct bytes/envelope overhead and enforce the unchanged attempt-wide limits; component review provides no autonomous acquisition, competence, admission or H1 disposition. The finite review goal completes with the clean final evidence handoff.
