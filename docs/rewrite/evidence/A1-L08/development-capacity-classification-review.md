# H-F1 independent capacity classification re-review

2026-10-12. A1-L08/L09, independent `/root/a1_development_capacity_rereview`, routed astra/high. Exact subject `83e76b19d5b5d19fa4640eeefe27995042cb48b3`; root pre-code contract `68add90` and fixture supplement `ce5617f`. Isolated branch `codex/a1-development-capacity-rereview-20261012`. An actual finite tool goal preceded this work. Exclusive writes are this new evidence and `evaluations/development/capacity-classification-review.test.ts`; source and all preexisting tests remain read-only.

## Frozen independent criteria

Before authoring or executing new tests:

1. All six original F1 reader-bound predicates remain unchanged and pass on the repair. Both adapted positive refusals must retain the same oversized object/use/alias and strengthen the assertion to the exact first 1,000,000-byte reader bound. No production error fabrication, capacity change or accepted invalid object is permitted.
2. Known B operational references and captured prompt fragments in B requests/transitions and current T transitions are bounded before generic B or extra inventory reads. Equivalent content-addressed aliases cannot acquire larger bounds. A lying reader must be refused before an oversized owned byte copy.
3. Final envelope construction must also classify its known operational references before any generic inventory read, including a T operational object that was legitimate metadata in B. Later cache refusal does not excuse an initial larger read. Nested prompt fragments obey the same rule.
4. Metadata-only objects larger than 1 MB remain accepted under the exact signed larger ceiling, counted once by digest without alias credit, and retain canonical inventory through B/T/final consumption. Operational usage remains at min(1 MB, signed singleton ceiling, remaining aggregate).
5. Actual serialized metadata, unique retained bytes and record counts continue to consume the original signed limits. Equality and one-unit excess checks must distinguish accounting from incidental malformed fixtures.

Use small deterministic in-process fixtures and the pinned Node 24.13.0 runtime. Collector-only malformed/minimal records may probe preallocation, but cannot establish valid signed history or final-envelope qualification; final-envelope ordering probes should authenticate B and T and reach their intended read. Positive controls and reader-bound observations establish causality. No general framework, source edits, existing assertion edits, child-process recovery tests, broad/full benchmark, physical/native/provider/network/private data/Slack/push/deployment. P1 projection, recorder, complete workload, model competence, live development and H1 are explicitly excluded. The finite result is accepted or changes-required without waiting for repair.

## Disposition: changes required — final-envelope F1 remains

**F1-final:** `prepareDevelopmentReviewEnvelope` reconstructs B at `review-envelope.ts:419`, passing all B inventory to `collectDevelopmentBehavior`. Its generic retained scan loads metadata before T is authenticated/replayed at lines 429–432. The new operational scan at line 435 precedes the final generic envelope scan, but is too late for the earlier B reconstruction. A legitimate B metadata object that is a known T operational payload or captured prompt fragment is therefore initially read with **33,554,432** instead of **1,000,000**. Both held-out cases return 1,000,001 bytes, observe **two owned oversized copies**, then fail with `Cached artifact exceeds caller bound`. Later refusal correctly prevents successful final qualification, but cannot undo the read/allocation; this is the same resource-classification defect at a distinct public boundary.

The two fixtures use real authenticated unchanged B with its accepted signed v2 attempt, accepted registration, authenticated T bound to that B, and an otherwise valid newly reserved reviewer request. One uses the oversized digest as an effect payload; the other uses it as a captured model prompt fragment. Both use an `aeon:artifact:` alias of a canonical B index entry. Their 1,000,000-byte counterparts reach the missing-closure finding with **no envelope failure**, demonstrating valid history/structure up to and through T verification. They do not assert complete reviewer judgments, a completed physical request or final grant closure. Signing the submitted T directly is intentional: the final verifier must independently bound submitted envelopes, including a T the standalone collector would reject. No production signature/trust check is stubbed.

Root received the repro and owns the repair. Classify all known operational references, including bounded captured-prompt preimages, before B's generic inventory read; keep those bounds through caches and nested collectors. Preserve the metadata-only positive and both new failing predicates. Root reports its intended repair separately; this finite review does not wait for or accept that repair.

## Accepted portions and fixture audit

- The six original red predicates from `f7e3a51` remain unchanged. The four B rereads and two standalone T ordering cases now pass.
- `git diff f7e3a51..83e76b1 -- evaluations/development/capacity-profile-review.test.ts` changes only the positive nested-prompt refusal: the same 1,000,001-byte aliased object and current-T use remain, with an exact `[1000000]` reader-bound assertion. The author test likewise preserves all three payload/prompt/response cases and adds exact bounds while expecting the genuine earlier reader refusal. No capacity increase, invalid acceptance, weakened rejection, contrived production error, skipped case or changed original six predicates was found.
- Six new standalone T checks pass: known B configuration, after-state and request payload; captured fragments in B requests, B transitions and current T transitions. These deliberately exercise the collector boundary with changed B records; they do not claim a newly valid signed B history.
- Larger metadata-only objects in B and T pass final consumption and are canonicalized/debited once across aliases. The tail refuses reader over-return before an owned copy, honors a smaller signed 900,000-byte ceiling, and accepts exact aggregate equality while refusing one byte less. Existing record, serialization-copy and remaining-aggregate regressions remain in the selected suite.
- The two final 1 MB positive controls pass. The two final one-byte-over preallocation predicates fail as recorded above. These 14 predicates remain frozen for the next repair.

## Verification receipt

Criteria were committed first at `3def7d1`. Source under review remains exactly `83e76b19d5b5d19fa4640eeefe27995042cb48b3`; all existing source/tests are byte-identical to it. Only the two claimed new files are changed. Commands use `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` v24.13.0 and the preexisting dependency symlink:

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 evaluations/development/capacity-classification-review.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 evaluations/development/capacity-profile.test.ts evaluations/development/capacity-profile-review.test.ts evaluations/development/witness.test.ts evaluations/development/witness-review.test.ts evaluations/development/review-envelope.test.ts evaluations/development/review-envelope-review.test.ts evaluations/development/retention.test.ts evaluations/development/retention-review.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
git diff --check
git diff --exit-code 83e76b1 -- evaluations/development/review-envelope.ts evaluations/development/capacity-profile.test.ts evaluations/development/capacity-profile-review.test.ts
```

| Check | Result |
|---|---|
| New held-out cases | **14: 12 pass, 2 fail**, zero cancellations/skips/todos, **1808.761204 ms**, exit 1. Both failures are F1-final. |
| Eight existing focused files | **183/183 pass**, zero failures/cancellations/skips/todos, **53343.742249 ms**, exit 0. Includes the six preserved original failures and both adapted positive refusals. |
| Strict TypeScript, whitespace and unchanged reviewed source/test checks | Pass, exit 0. |

The first held-out run was also **12/14**, **1685.684039 ms** with the same two failures; the final run adds copy-count diagnostics without changing any predicate. No fixture correction was needed. Temporary logs `/tmp/cp2-classification-review-first.log`, `/tmp/cp2-classification-review-heldout.log` and `/tmp/cp2-classification-review-regression.log` are supporting receipts; the committed tests and exact source are the durable repro.

No child-process regression file, process-recovery experiment, full benchmark/materialization, physical/native/provider/network request, credential/private data, Slack, push or deployment occurred. Node's ordinary per-file test-runner isolation does not qualify process recovery. P1 projections, recorder integration, complete signed workload, responsiveness/resource performance, competence, live development and H1 remain excluded. Finite review completes changes-required; root owns repair and another fresh review.
