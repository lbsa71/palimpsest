# A1-L08 bounded raw-store independent review

Status: **review finding reproduced; repair and final verification pending**. Fresh reviewer `/root/a1_development_raw_store_review`, branch `codex/a1-development-raw-store-review-20261011`, worktree `/home/palimpsest/migration/aeon-1-20261011/development-raw-store-review`. Root reservation `8e1ea65`. Inspected exact clean author handoff `6c6da87`, implementation `fd7ab1141d5a391ddb8334fcddafb2d9fbc80b74`, pre-code contract `b694edb`. Exclusive reviewer writes: [new review tests](../../../../evaluations/qualification/store-bounds-review.test.ts) and this record. All production/source, prior tests and historical evidence remain read-only. The reviewer created an actual finite goal before inspection; no further agent was spawned.

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

Pending root-owned narrow R1 repair followed by unchanged review cases, author/affected existing focused suites, normal strict compilation and clean handoff. No other actionable source finding was reproduced during this inspection.
