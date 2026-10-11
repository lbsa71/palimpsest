# A1-L09 source-bound governance and reviewer proposals

Status: **implemented and fixture-verified at the proposal/registry boundary; joined host selection and physical review integration pending**. Owner `/root/a1_succession_final_review`; finite worktree `/home/palimpsest/migration/aeon-1-20261011/governance-proposals`, branch `codex/a1-governance-proposals-20261011`, base `a460db9`. Code handoff `e950ac26a90db98d5547c718093b59c44d21ee3c`. This supports A1-L09-T03/T05 and RW14/RW15/RW16/RW19/RW21; it is engineering evidence, not H1 or evaluator competence qualification.

## Scope and finite goal

An actual finite tool goal was created before work, without a token budget: implement source-bound ordinary evaluator/governance proposals under prior-policy admission/probation, immutable private reviewer bindings, targeted tests and evidence, then hand off exact integration interfaces. Governing requirements, planning workflow and A1-L09 were read during the immediately preceding fresh installed review and retained for this task. The lead assigned policy-registry/evolution-tools and their tests, new reviewer-registry/tests and this evidence; dispatcher, supervisor, CLI, application, materialization and runtime remain separately owned. The lead approved the public format and host-private directory before shared integration. This already delegated task did not need further delegation.

Previously, ordinary freezing always copied the accepted policy descriptor, derived policies required identical judging rules, and the dispatcher had one static reviewer. This change permits source-owned required-case and reviewer-closure proposals while retaining the original public signing identity, private key authority, qualification kind and resource bounds. Changing a descriptor only creates a future policy; it never authorizes activation or substitutes the judge of that same transaction.

## Public proposal and private binding

`governance_profile` exposes the accepted policy, reviewer executable/arguments, mount/hash inventory and existing bounds. It exposes no private file or signing-key path. `EvolutionOptions.reviewer?: ReviewerMetadata` carries public metadata; `validateReviewerMetadata(value)` returns a checked clone with exact fields, finite limits, inherited mounts only and descriptor-to-policy binding. The host integration must supply metadata for the accepted policy and tolerate missing evaluator inputs during offline recovery.

The source-owned `deployment/governance-proposal.json` format is:

```json
{
  "version": 1,
  "policy": {
    "kind": "engineering",
    "requiredCases": ["next-required-case"],
    "evaluatorArtifacts": [["existing-evaluator-id", "SHA256_OF_CANONICAL_RUNNABLE_DESCRIPTOR"]],
    "evaluatorKeyDigests": [["existing-evaluator-id", "UNCHANGED_PUBLIC_KEY_DIGEST"]]
  },
  "reviewer": {
    "evaluatorId": "existing-evaluator-id",
    "executable": "/reviewer/node",
    "args": ["/reviewer/review.mjs"],
    "files": [
      {"mount": "/reviewer/node", "sha256": "UNCHANGED_RUNTIME_HASH", "inherit": true},
      {"mount": "/reviewer/review.mjs", "sha256": "NEW_SOURCE_HASH", "source": "deployment/review.mjs"}
    ]
  }
}
```

The uppercase hash placeholders above are explanatory, not valid inputs. Required cases and evaluator pairs use the canonical order exposed by `policyDescriptor`. The runnable digest is SHA-256 of the existing `reviewerDescriptor` canonical JSON: version, executable, arguments and mount/hash pairs sorted by mount. Source locations are separately bound by the frozen proposal and control-file inventory. `reviewer` is optional for case-only changes. No new keys, qualification kind, resource allowances, private paths or undeclared executable mount can be supplied.

Reviewer sources must be non-test files beneath `deployment/`, explicitly included in both frozen files and control files with matching hashes. Dependencies can be additional declared source files or exact inherited prior-reviewer mounts/hashes. Executable and arguments are included in the independently judged descriptor; they are not constrained to an unchanged command line. The 64-file, argument, mount-root and source bounds remain enforced. The next runnable evaluator must retain the configured evaluator identity; other evaluator artifact identities cannot be changed through this one-reviewer route.

`ReviewerRegistry({store, host, directory, configuredReviewer})` supplies:

- `prepare(priorPolicy, nextPolicy, candidate)`: verifies the exact frozen candidate, proposal, next policy and prior reviewer; reads/hashes all declared runnable bytes offline; seals them into private content-addressed storage; persists an immutable binding.
- `get(policy)`: resolves the configured or sealed reviewer for that exact policy, verifies descriptor, key identity, private limits, storage paths and actual byte hashes, and returns a clone.
- `publicDescriptor(policy)`: emits only the public `ReviewerMetadata` surface.

The host chooses `directory` once as an owner-private sibling of its configured reviewer file, outside workspace/artifact/state roots. There is no per-revision external registry editing. Construction performs no file or key read, so unavailable evaluator inputs do not inherently block retained-code startup. Resolution is lazy and is allowed to fail when review is requested.

All runnable bytes, including inherited runtime/library bytes, are copied to the sealed private store. Exclusive temporary writes are fsynced before exclusive content-addressed publication; untrusted partial/interrupted files are never executed. Existing bytes are rehashed. Retained unique file bytes are capped by the existing `maxClosureBytes` grant, with at most 4,096 files and 64 reviewer-policy records. Hitting a limit or finding an interrupted temporary file fails closed and requires explicit host maintenance; this implementation does not silently collect retained evidence or expand storage grants.

`DerivedPolicyRegistry(store, configuredPolicy, prepareReviewer?)` invokes the callback with `(prior, next, candidate)` before registering a new derived policy. Descriptors may change cases and the source-bound reviewer artifact; key material still resolves directly from the original configured authority, never through an unbounded predecessor chain or a copied secret. Returning to the original policy reuses its configured authority. The registry still supports unchanged-rule revisions without a reviewer hook; changed governance requires that hook.

## Required host integration contract

The lead owns the remaining wiring and physical verification:

1. Lazily construct the private reviewer registry from the configured reviewer's original authority. Connect policy preparation to `reviewers.prepare` and lookup to `reviewers.get(policies.get(digest))`.
2. Select admission and fresh probation reviewers using their **original** judging policy digest. Preparing or staging the next policy must not switch either judge. Only later accepted-policy work uses its new reviewer.
3. Supply public metadata through validated service materialization and ordinary evolution-tool options. Missing reviewer files/keys should hold external review while preserving independent offline recovery.
4. Exercise an actual changed executable reviewer and changed cases through prior-policy admission, fresh prior-policy probation, then a subsequent physical review by the newly accepted reviewer. Use the existing bounded physical dispatcher fixture and retained independent rescue.

No physical review selection claim is made by the isolated registry tests. The static dispatcher at this task's base still needs the lead's separately owned integration.

## Observed verification

Node `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`; existing development dependencies symlinked from the integration checkout, no dependency/lockfile changes:

```sh
node --test deployment/reviewer-registry.test.ts deployment/policy-registry.test.ts
# 11 passed, 0 failed, 0 skipped; final run 1.183 seconds
node --test --test-name-pattern='ordinary governance source' deployment/evolution-tools.test.ts
# 1 passed, 0 failed, 0 skipped; 2.624 seconds
npm run check
npm run build
git diff --check
# all passed with Node 24 first on PATH
```

Behavioral coverage includes changed actual reviewer-file bytes and cases, durable reopen, unchanged-review inheritance, original-policy reversion, private-path-free metadata, foreign-key and path rejection, inherited runtime substitution, frozen-source and sealed-file tampering, immutable private key/resource bindings, missing-key constructor availability and canonical descriptor mismatch. A candidate's future reviewer evidence is rejected under the original policy for next-policy authentication, for an unqualified changed artifact even with an old-policy signature, and for substituting the next policy against old authority. Ordinary tool execution freezes a changed source descriptor while preserving the prior judging digest in the durable evaluation request.

Two earlier test failures are retained in this record: the first combined run was 8/10 because old tests expected the retired blanket "Changed governance" diagnosis rather than the new precise case/key/qualification errors; their behavior assertions were retained and diagnostics made specific. A subsequent 10/11 run failed only because the new self-grading test parsed the store's artifact URI as plain `sha256:` rather than its actual prefixed format. The test now uses the digest's final URI segment; no admission check was weakened. Neither failure was a product defect or a physical review failure.

No mounted/systemd/source-freeze heavy suite, paid inference, Slack/external message, production service change or push occurred. The ordinary-freeze check uses a small inert source/toolchain fixture and does not claim compiler/service execution. Full original evolution-tools integration, joined physical reviewer switching and fresh independent review remain lead-owned gates. The code and evidence handoff completes this bounded implementation task, not those separate integration/acceptance gates.
