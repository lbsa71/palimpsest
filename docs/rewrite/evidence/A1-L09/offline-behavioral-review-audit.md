# A1-L09-T03/T05 — fresh offline behavioral reviewer audit

Status: **bounded engineering review passed**. Independent reviewer:
`/root/a1_offline_review_audit`. This is not product qualification or H1.
Author checkpoint first inspected: `7bfef12154e80f8b7856c2910480892b1ab1bd73`.
Branch: `codex/a1-offline-review-audit-20261011`; isolated worktree:
`/home/palimpsest/migration/aeon-1-20261011/offline-review-audit`.

```text
/goal Audit the prior-owned offline Validator reviewer, add bounded independent regression coverage, review the author's final integration and coordinated repairs, and record exact proof and limits.
```

Scope is L09 T03/T05 with L08's accepted checker boundary. Initial exclusive writes
are this record and `deployment/offline-behavioral-review-audit.test.ts`. The author
owns the implementation until final checkpoint handoff; root owns physical test
windows and central lane/status integration. No C1, registry, supervisor or kernel
baseline changes belong to this review.

Read requirements, PLAN, AGENTS, planning workflow, L09, and
[changed-host readiness](changed-host-readiness.md). Source inspection confirms
the selected approach uses the actual frozen exported Validator in a sibling
namespace, private expected answers and signing key only in prior-owned controls,
an accepted reviewer descriptor containing the private plan digest, separately
charged command/reviewer operations, and exact receipt checks before existing
mailbox/controller consumers. The observer imports no candidate module into the
trusted host or signer.

Two defects at the first checkpoint were already under author repair: optional
`CommandReceipt.stoppedFor: undefined` could not enter canonical immutable JSON;
post-transfer subsequent physical reservations needed an exact completed
same-review predecessor. The first actual failed integration was retained by the
author; this review has not repeated its uncertain operation.

Independent regressions cover removal/replacement of the accepted checker,
mutation of private expected answers, and post-transfer reservations. These are
local temporary-store/preflight checks with no confined child or physical
dispatch.

## Recorded red/green verification

- At `7bfef12`, Node 24 `node --test deployment/offline-behavioral-review-audit.test.ts`
  ran four tests: two passed and two failed with `Missing expected rejection`.
  A failed probe could fund a post-transfer signer; a completed probe could be
  reused to fund another request. No real command was launched in this test.
- Author repair `71300d1ac76a5c98f2b732f1acc1cd133fdca4fd`, cherry-picked locally
  as `3979771`, makes the same four tests pass. The regressions additionally
  reject reserved, uncertain and unknown predecessors, changed policy/run or
  evaluator identities, and replay; the exact valid continuation preserves the
  original allocations with `maxConcurrency: 1`.
- Test-only author repair `9359203`, cherry-picked locally as `3654865`, uses the
  mailbox content-address resolver for signed observations.
- `PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH npm run check`
  passed without compiler-policy overrides. Existing workspace dependencies were
  linked into this isolated worktree; no dependency was installed or changed.
- With the same Node PATH,
  `node --test --test-name-pattern='offline|sibling|probe|prepared|audit' evaluations/offline-review/plan.test.ts deployment/evaluation-resources.test.ts deployment/offline-behavioral-review-audit.test.ts`
  passed 12/12, zero failures and zero skips. This selects relevant pure tests;
  it does not run confined integration or claim kernel isolation.
- Node binaries under `/opt/palimpsest/runtime/` and
  `/home/palimpsest/runtime/` have the same SHA-256:
  `53fb205ae78805130177e24bcb459a69a1518c8d98f8965f31d85aae7ea840fc`.

## Additional review findings and repairs

The author noticed that static candidate import preceded parsing
`/work/inputs.json`; candidate initialization could rewrite that visible file.
Capturing and freezing the invocation before a fixed dynamic import is a useful
bounded repair. Candidate stdout remains untrusted and must still be compared
outside the candidate against prior-owned expectations.

This reviewer found that the original engineering fixture copies its own test source
into `/app`, exposing the exact fixed `Buffer.alloc(32, 78)` fixture signing key
and private expected vector through public source. The existing attack checks
denial of original private paths, which alone does not prove those bytes are
unavailable. Requested fixture repair: generate the key at runtime; omit the
two fixture test sources containing the expected vector from the offline
candidate copy; extend the candidate read-denial probe to those mounted paths.
This is a proof-fixture confidentiality defect, not evidence that the production
dispatcher places its actual provisioned key in candidate source. Public string
semantics cannot be considered secret held-out competence.

Both findings are repaired in author commit
`070c69c7d22f8df20aa2bdcb00d1684c96a9e790`, cherry-picked locally as `00b5886`
after `bc89fff` (local `b30a55a`). The runner parses and freezes its lexical
inputs before dynamic candidate import. The disposable offline fixture omits
the two answer-bearing test files before freezing, asserts their absence from
the manifest, and probes their `/app` paths along with the original private
mounts. The reviewer key now comes from `randomBytes(32)` at fixture creation.
Production candidate snapshot policy is unchanged. Normal `npm run check`
passes on this source plus the independent regression file.

The first direct trial of that repair rejected the good candidate: the actual
Validator legitimately annotates schema objects with `__absolute_uri__`.
Independent source inspection confirmed this interaction and the author repaired
it in `ba933f403064d11ca9b649941fa914d66eaaf9ea` (local `270cbb2`). The runner
retains the frozen lexical snapshot but passes each call a fresh shallow schema
copy. All allowed schema fields are primitives. The author's final actual
good/initializer-rewrite pair passed 1/1, zero skips, in 26.125 seconds;
its original failure and corrected result are retained in the separate
[author evidence](offline-behavioral-review.md).

## Final independent physical verification

Root assigned this reviewer one corrected lifecycle execution after the author
released the physical window. Tested exact clean revision:
**`ea1813f05bb92fce2b0e69311f2d805f1ca03fe3`**. Runtime source equals author
`ba933f4`; independent regression/evidence commit `34edb46` and narrow test-only
diagnostics commit `ea1813f` add no executable host behavior. Normal Node 24
`npm run check` passed before the final freeze. Author ownership was explicitly
handed off for the diagnostic edit; no implementation repair was made by this
reviewer after that freeze.

```sh
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH AEON_OFFLINE_REVIEW_FIXTURE=1 node --test --test-name-pattern='offline behavioral reviewer' deployment/evaluation-dispatch.test.ts
```

Result: **5/5 passed, zero failures, zero skips; 80.154 seconds**. This was the
reviewer's only confined integration execution. The actual ordinary service
performed candidate evaluation, mailbox completion, staged control admission,
activation and fresh probation under the original judge. It retained exactly
nine physical records after restart: eight succeeded and one uncertain.

- Admission and probation each ran one candidate command and one sealed
  reviewer under the original author run, prior evaluator/policy and unchanged
  allocation lineage. Both envelopes had `maxConcurrency: 1`; probation retained
  activation time in its first pre-transfer reservation (7,137 ms observed).
- The actual `s.length` regression returned an authenticated negative verdict
  and failed admission. Replaying that review ID launched nothing further.
- A candidate initializer could not read the reviewer key, private plan,
  original host paths or the two omitted answer-bearing fixture source paths.
  Its actual good Validator behavior passed. No returned artifact contained the
  runtime-random signing-key bytes.
- Private plan tampering and the direct API's unaccounted behavioral path were
  refused. Independent preflight tests separately cover omission/replacement of
  the required accepted plan artifact.
- A candidate physically wrote its start marker and then hung. Cancelling its
  original allocation stopped that operation, retained an uncertain receipt
  charged 3,000 ms, and never reserved or launched a sealed reviewer. Reuse was
  refused. Restart did not repeat any of the nine operations.

The completed read-only transcript is
`/home/palimpsest/migration/aeon-1-20261011/offline-review-trials/reviewer-ea1813f-lifecycle.tap`.
Its SHA-256 is recorded below. The diagnostic retains exact authority, original
allocation clocks, all physical IDs/request digests/statuses/usage, distinct
admission/probation evidence IDs, and signature/artifact bindings without key or
expected-answer bytes. Selected identities:

| Binding | SHA-256 / identity |
|---|---|
| Completed transcript | `2796fcaa8efee6859a2f89ccd530ec680d0201dcbd91a39f568edcfbdab89d03` |
| Tested candidate | `273f18612476bcf778d563f6d08d8079aedceaba2ef89aa193968cd29dee3315` |
| Original policy | `93d8fb480a00d1ebc71955e96fbb63433c9c88e00f0bcd628017b7954f8241d1` |
| Accepted evaluator descriptor | `33f2b6d8d015fc26ed60230f6a884f55382103cb3dada424c5c56776daafab04` |
| Private plan digest | `e683f50b1ef6ba5b9e64385338617b60f4e5626b3ea18c16aff412336ff5d804` |
| Prior runner digest | `5562b19eacb70c7794d1226d566215dc0ba3d88d669dbef362696555539fa30a` |
| Signed probation array digest | `66b6cc140631af901bfd9206720cb1fcc0487ea6779466ee56508320c84e6b36` |
| Probation command-observation artifact | `dd28113b4179ad44a0a6244528c88940cef068ae81b2e2555fa5182fb2761686` |

## Disposition and limits

No unresolved finding blocks this bounded offline engineering slice. The
accepted prior-owned checker is required by its exact artifact identity; actual
candidate execution remains outside both trusted host imports and signer
namespace; exact immutable command/usage evidence reaches the existing old-judge
admission/probation path. The independent regression suite meaningfully failed
before the continuation repair and passed afterward. Earlier author failures
and the limited fixed-key lifecycle remain separate from this corrected pass.

This verifies the selected Validator behavior and mechanism boundaries, using
synthetic bootstrap judgment and captured author transport. It does not qualify
the private case set/evaluator, changed Node runtime, arbitrary host behavior,
adversarial JavaScript competence, replacement-reviewer governance, live model
authorship, development, comparator parity or H1. The fixture uses engineering
confinement; product-policy dispatch separately requires an accepted kernel
resource profile, which this review does not establish. Existing independent
succession/recovery evidence retains its own scope.

Disposable fixture storage was cleaned by the test; retained evidence is the
transcript and its bindings, not the private plan/key or complete signed artifact
bodies. No provider request, native comparator, auth probe, Slack message, push,
dependency installation or production deployment occurred. The physical window
was released immediately after completion. Root owns integration, the original
author evidence correction (removing an accidentally captured partial hash of
this then-running transcript), and downstream lane status. This final evidence
amendment changes no tested runtime or fixture code.
