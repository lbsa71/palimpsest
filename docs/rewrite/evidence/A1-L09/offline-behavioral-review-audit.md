# A1-L09-T03/T05 — fresh offline behavioral reviewer audit

Status: reviewing. Independent reviewer: `/root/a1_offline_review_audit`.
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

Root assigned this reviewer the single final corrected lifecycle execution,
after the author's direct good/initializer pair releases the physical window.
No reviewer-confined execution has occurred yet. Earlier author lifecycle
results remain separate and retain their fixed-key/source-vector limitation.
