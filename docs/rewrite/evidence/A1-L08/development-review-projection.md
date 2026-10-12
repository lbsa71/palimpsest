# CP2-P1 bounded reviewer projection implementation

2026-10-12. Author `/root/a1_development_review_projection`, assigned sol/high routing, isolated branch `codex/a1-development-review-projection-20261012`, base `55871ac` with H/S source `8f4ea2e`. Finite actual goal created before implementation. Authored engineering evidence; fresh P3 review and P2 adapter integration remain pending.

## Frozen behavior before code

Implement the exact adopted [projection design](development-review-projection-design.md), including its final root adoption. Public helper signatures/types, collection order, mechanical case memberships, exact ID lookup, canonical 2048-byte receipt and continuation, complete-original <=1,000,000-byte authenticated reads, repeated I/O debit and pre-read refusal are fixed there. Helpers import envelope types only. Profile selection comes from B's manifest; old v1 input/execution/read schemas remain exact. New execution uses `inputMode:bounded-sections-v1` and selector/cursor/receipt entries. The verifier must rederive every receipt from authenticated B, bind the canonical actual ToolCall and exact settlement response, preserve complete succeeded-read inventory and ordering before final dispatch.

Causal fixtures will reconstruct collection records including negative findings, exercise late exact case/observation/request lookup, Unicode/binary/empty continuation, pre-read membership/singleton/budget/hash refusal, and tamper actual signed envelope payloads, input, receipt, cursor, membership, accounting and read inventory. Existing source/tests are read-only except the claimed envelope branch; no H retained-cache/scan repairs. Small in-process file/mock fixtures and pinned Node24 strict checks only. No physical/native/provider/network workload, new dependency, full benchmark or competence/capacity qualification.

## Results

Implemented `review-projection.ts` with the adopted public types/functions, twelve fixed collections, exact mechanically selected cases/IDs, canonical receipt packing/continuation, strict UTF-8 versus base64 choice, exact original URI/hash membership, pre-read singleton/read-budget refusal and full-source length/hash verification. No serialized whole-catalogue allocation, persistent index, new dependency or model loop. The initial packet contains B digest and exact counts, with no B self-artifact. Each original page calls the supplied bounded reader again and returns source bytes plus receipt bytes as its debit.

`review-envelope.ts` selects the new packet and execution schema only through the authenticated named attempt profile. It rederives receipts from full authenticated B, verifies exact canonical actual ToolCalls, exact settlement response references, complete succeeded-read inventory, local-to-original mapping, prior final-dispatch ordering and unchanged model/reason derivation. The existing full-wire `DevelopmentReviewExecution` type remains the default for existing typed fixtures; NEW `BoundedDevelopmentReviewExecution` and `AnyDevelopmentReviewExecution`, and an optional generic type parameter on binding/envelope, express the new wire without editing prior test assertions. New-profile clients use the bounded execution type explicitly.

The new tests contain 11 helper cases and 25 signed-envelope cases. They reconstruct every B field from paginated collections (including duplicate signed evidence, failed/unavailable findings and null final accounting), verify exact request/transition and case memberships, exercise a >2-MiB resident B with <2-KiB input, losslessly reassemble Unicode/BOM/escaped JSON/binary/empty originals, test maximal fitting continuation, and observe repeated reader calls/debits and exact 1,000,000-byte bounds. A 1,000,001-byte indexed original refuses before reader entry despite larger signed metadata capacity. Envelope probes use real in-process `OperationalStore`, `ResourceLedger`, `DevelopmentAccounting` and `QualificationStore`, with synthetic provider judgments; they independently forge selector/cursor, negative omission, EOF, encoding, input/mode, final payload, ToolCall identity, original membership, response alias, mapping, read ordering, charge inventory and omitted/duplicate succeeded reads. Genuine unavailable model judgments retain known accounting and remain unavailable.

Root separately supplied H-F1 repair `83e76b1`. Dependency import `b86e63d` contains its exact 17-line envelope patch, exact capacity fixture changes and classification evidence, plus the previously absent independent capacity review fixture from that revision. No central execution file was imported. This is root-authored allocation ordering, distinct from P1 source. Root reported a further H re-review question: a metadata-only B object may be loaded during reconstruction before classification of a T operational alias. Root owns that investigation/repair; P1 does not claim it resolved or H accepted.

Validation used `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` (pinned Node 24.13.0), with the existing `node_modules` symlink. Exact commands:

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test evaluations/development/review-projection.test.ts evaluations/development/review-projection-envelope.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 evaluations/development/witness.test.ts evaluations/development/witness-review.test.ts evaluations/development/review-envelope.test.ts evaluations/development/review-envelope-review.test.ts evaluations/development/retention.test.ts evaluations/development/retention-review.test.ts evaluations/development/capacity-profile.test.ts evaluations/development/capacity-profile-review.test.ts evaluations/development/review-projection.test.ts evaluations/development/review-projection-envelope.test.ts
git diff --check
```

Results: expanded owned **36/36 pass**, 14.283 seconds; joined focused **219/219 pass**, 63.498 seconds; final strict compilation passes, 2.398 seconds; diff check passes. No skipped/todo/cancelled tests. `/tmp/cp2-p1-expanded.log` and `/tmp/cp2-p1-joined.log` contain local run output; these transient logs are not durable release evidence.

Preserved author-development failures: the first union export caused seven strict errors in existing artifact-only typed fixtures; the default-old generic types resolved them without modifying those fixtures. The first helper run was 7/9: two assertions compared parsed ordinary objects with authenticated null-prototype objects. Exact canonical-byte comparisons corrected that fixture issue. The first envelope run was 28/29: the negative-omission probe's guard correctly failed because its selected findings collection was empty. It was changed to the actual signed failed `transfer-2` observation; the guard now requires the failed outcome before omission and the verifier rejects the forged receipt. Later runs passed all unchanged causal predicates. No failure was converted to a skip or hidden behind a weakened source cap.

The finite P1 engineering objective is complete and its handoff is clean. **Authored, not independently accepted.** P2 still must wire actual recorder current-use gates, exact receipt observations, session budgets, all preclaim copy/reservation arithmetic and new-profile operational admission. This P1 fixture does not exercise a real recorder, provider competence, source withdrawal across adapter awaits, complete full-profile workload fit, private checker/control validity, H1 or deployment. Fresh P3 after the P1/P2/H/R join remains mandatory. Old source/tests stayed unchanged except the exact explicitly authorized root H dependency imports. No physical/native/provider/network workload, private credential access, messaging, push or deployment occurred.

## CP2-P1-R1 pre-code repair specification

2026-10-12. NEW actual finite repair goal, isolated `development-review-projection-repair`, branch `codex/a1-development-review-projection-repair-20261012`, exact root claim/base `8f8d242`. Read the root execution claim and fresh prerequisite review `1fc42ed`. H-F2 is accepted within component scope. P1-F1 remains a reproduced callback-alias defect: supplied reader mutation can change the checked source hash/reference or cursor, and the helper then authenticates or emits a receipt against those changed aliases. The original two failing tests and every other test are read-only.

Freeze before code: after validating the exact request and bounds, retain a small owned request (version/B digest, selector and nested original URI/hash, cursor index/offset) plus scalar receipt/read/metadata limits. Before original callback entry, capture exact indexed length and authenticate returned bytes against the captured length and hash. Give the callback a separate ArtifactRef, so mutation of its argument cannot change the owned request. All post-callback receipt construction, pagination and final budget checks consume the owned checked request/scalars. Mutation of caller args/bounds or indexed entry length cannot change admitted output or authentication; the original B digest is not recomputed after callback. Unrelated B metadata may change while fixed original membership/content remains valid. No whole-B copy, new framework/dependency or altered wire, capacity or accounting predicate.

Acceptance is the unchanged two original reds passing, all new held-out H/P1 tests and authored projection/envelope regressions passing, strict compilation, diff/readonly-path checks and a clean exact two-path commit. Existing envelope/tests/recorder/plan source stay read-only. Small in-process checks on pinned Node24 only; no physical/native/live/provider/network/credential/Slack/push/deployment/full benchmark. This repair remains authored pending fresh independent re-review; P2 current-use and full-plan qualification stay separate.

## CP2-P1-R1 repair result

Pre-code specification commit: `fa48d57`. The helper now captures an owned exact checked request with a copied selector/original ArtifactRef and cursor, plus scalar receipt allowance, remaining read allowance and signed metadata allowance before callback entry. It captures indexed original length separately and passes the reader another small ArtifactRef. Returned length/hash authentication, receipt commitment/pagination and final debit check consume the owned values. Neither caller aliases nor reader argument mutation can replace these values. Unrelated B metadata mutation remains permitted for an original with fixed admitted membership/content. No full B snapshot or additional persistent materialization was introduced.

Before repair, the exact unchanged new held-out suite reproduced **19 cases, 17 pass/2 fail**, 7.071 seconds: both P1-F1 reference/cursor defects. After repair, new held-out plus authored projection/envelope regressions pass **55/55**, 28.785 seconds, zero failures/cancellations/skips/todos. Strict compilation passes, 1.858 seconds. Whitespace and all-readonly-path comparison pass. All original independent test files, authored test files, envelope, recorder and plan remain byte-identical to root base `8f8d242`. Commands:

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 evaluations/development/capacity-classification-final-review.test.ts evaluations/development/review-projection-review.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 evaluations/development/capacity-classification-final-review.test.ts evaluations/development/review-projection-review.test.ts evaluations/development/review-projection.test.ts evaluations/development/review-projection-envelope.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
git diff --check
git diff --exit-code 8f8d242 -- . ':!evaluations/development/review-projection.ts' ':!docs/rewrite/evidence/A1-L08/development-review-projection.md'
```

The first test command exited 1 before repair; the second exited 0 after repair. Temporary supporting logs `/tmp/cp2-p1-r1-before.log` and `/tmp/cp2-p1-r1-after.log` are not release evidence. An ignored `node_modules` symlink targets the existing root dependencies; no dependency file changed.

Six supplementary no-file in-process probes also pass (0.495 seconds): replace all caller request fields after entry; mutate both supplied budget fields; lower B's metadata limit; mutate indexed source length; mutate only the callback ArtifactRef; mutate indexed length and return a shortened forged source. The first five require exact equality with a stable-reader control's receipt/artifact/debit; the sixth requires original captured length/hash refusal. The reproducible inline command is:

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --input-type=module <<'CHECK'
import assert from 'node:assert/strict';
import { identity } from './packages/contracts/index.ts';
import { hashBytes } from './packages/release/artifacts.ts';
import { syntheticWitnessFixture } from './evaluations/development/witness-fixture.ts';
import { collectDevelopmentEvidence, developmentCapacityProfile } from './evaluations/development/witness.ts';
import { projectDevelopmentReviewRead } from './evaluations/development/review-projection.ts';
for (const fault of ['request-fields','budgets','metadata-limit','indexed-length','callback-ref','forged-length']) {
  const f=syntheticWitnessFixture(); Object.assign(f.m,{version:2,capacityProfile:developmentCapacityProfile}); f.m.limits={maxRecords:32768,maxArtifactBytes:4000000,maxEvidenceBytes:8000000}; f.trust.acceptedAttemptDigest=identity(f.m);f.observations.forEach(o=>o.attemptDigest=identity(f.m));
  const source=Buffer.from('negative outcome'),sha256=hashBytes(source),artifact={uri:`sha256:${sha256}`,sha256};
  const b={version:2,registrationDigest:identity('registration'),frozenAt:f.at(180),manifest:f.manifest(),observations:f.records(),requests:[],transitions:[],rootCancelled:false,evidence:collectDevelopmentEvidence(f.manifest(),f.records(),f.trust,f.reader,f.now),artifactIndex:[{artifact,bytes:source.length}]};
  const args={version:1,behaviorDigest:identity(b),selector:{kind:'original',artifact},cursor:{index:0,offset:0}},bounds={maxReceiptBytes:2048,remainingReadBytes:2048+source.length};
  const stable=projectDevelopmentReviewRead(b,args,()=>source,bounds);
  const mutating=(ref,bound)=>{assert.equal(bound,source.length);if(fault==='request-fields'){args.version=7;args.behaviorDigest=identity('foreign');args.selector={kind:'collection',name:'findings'};args.cursor={index:4,offset:9};}if(fault==='budgets'){bounds.maxReceiptBytes=1;bounds.remainingReadBytes=0;}if(fault==='metadata-limit')b.manifest.value.limits.maxArtifactBytes=0;if(fault==='indexed-length'||fault==='forged-length')b.artifactIndex[0].bytes=1;if(fault==='callback-ref'){ref.uri='foreign';ref.sha256=identity('foreign');}return fault==='forged-length'?Buffer.from('x'):source;};
  if(fault==='forged-length')assert.throws(()=>projectDevelopmentReviewRead(b,args,mutating,bounds),/length\/digest/);else assert.deepEqual(projectDevelopmentReviewRead(b,args,mutating,bounds),stable);
  console.log(`${fault}: passed`);
}
CHECK
```

The separate finite P1-R1 engineering goal is complete at its clean source/evidence handoff. **Authored repair, fresh independent re-review pending.** H-F2 component acceptance comes from prerequisite review `1fc42ed`, not this repair. Actual P2 recorder/current-use, signed full-plan capacity, provider competence, complete workload and H1 remain separate. No tests, envelope or other source were edited; no physical/native/live/provider/network/private credential/Slack/push/deployment/full benchmark occurred.
