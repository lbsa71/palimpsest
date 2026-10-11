# Independent derived-policy review

Date: 2026-10-11. Scope: A1-L09-T03/T05; RW10, RW14, RW15, RW16. Fresh reviewer `/root/a1_policy_registry_review`, isolated branch `codex/a1-policy-registry-review-20261011`, base `3c1f1e9`; reviewed implementation introduced by `64bbc44`. Exclusive writes: `deployment/policy-registry.ts`, its test, and this evidence. The lead owns integration and lane coordination. Actual finite session goal: independently review and repair derived unchanged-policy registration, preserving original judging authority through repeated source upgrades and restart.

## Findings and repairs

1. **Persistent configured-policy collision.** Starting with configured policy A, deriving B and C, then preparing a candidate restoring A's controls wrote a derived row at A's digest with `basePolicyDigest === policyDigest`. Lookup immediately rejected that self-reference, and the retained row shadowed A on later lookup/restart. This could make the original rescue policy unavailable. The registry now reuses the original configured policy without writing a row when the next digest equals the lineage's configured base. Returning to an earlier derived revision still reuses the existing row.
2. **Registration accepted inconsistent candidate identities.** The registry checked only the shape of manifest/control digests. A forged candidate ID or controls inputs inconsistent with the manifest could therefore be recorded before later release admission rejected the candidate. Registration now validates the immutable manifest identity and hashes `inputs.controls` before any write. This is a registration-boundary correction; the deployed review/admission path already independently verifies frozen artifacts, so this finding does not establish an admission bypass.

The initial regression run against unchanged registry code reported 2 passes and 2 failures: the origin-return case raised `Invalid derived host policy`; the malformed-candidate case failed with `Missing expected exception`. Both pass after the narrow repair.

## Authority and persistence review

- Successive derived records point directly to the original configured policy. Restart reloads that authority and rechecks its complete policy identity; no recursive ancestor chain or copied signing secret is needed.
- Candidate descriptors must exactly match prior kind, required cases, evaluator artifact identities, and evaluator key digests. Extra descriptor fields, changed cases, kind, evaluator, or keys are rejected. The derived control revision changes the policy identity without changing these judging rules.
- Returned case arrays, artifact maps, key maps, and key bytes are copied. Focused tests mutate each returned structure for both configured and derived policies and verify subsequent reads are unchanged.
- Same controls with different source candidates can share a policy identity. Duplicate registration leaves the existing record unchanged. Conflicting records and tampered controls/descriptors fail closed; failed registration does not overwrite conflict evidence. Unknown and malformed policy digests do not acquire a fallback authority.
- Registry records live in the host operational store. Model command confinement does not mount host state or control paths (`packages/supervisor/confinement.ts`); registration is not a model-exposed API. The accepted service and supervisor are trusted host code, so this is not isolation against arbitrary already-accepted host code.
- `ServiceSupervisor.#startDispatcher` wraps preparation in `AuthorityStore.dispatch` using the request's authority. Dispatcher submission also checks prior policy/control binding and current authority. `ReleaseController.stageControlUpgrade` separately admits the proof under the active old policy and validates the frozen candidate descriptor. Activation repeats old-policy admission and rejects stale stages. Probation remains judged under the original policy. Registering metadata alone neither stages nor activates a release.
- The external review path verifies the exact frozen application, prior evaluator artifact, and key identity before execution. Full artifact payload verification remains in that path and the release controller; the registry does not claim to perform a filesystem audit.

No additional supervisor/dispatcher source fix was established by this review.

## Validation and handoff

Node: `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` (v24.13.0). Commands from the isolated worktree:

```text
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test deployment/policy-registry.test.ts packages/release/controller.test.ts
# 13 passed, 0 failed, 0 skipped, 0 cancelled; 4.537 seconds

/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node /home/palimpsest/src/palimpsest/node_modules/typescript/bin/tsc --noEmit --typeRoots /home/palimpsest/src/palimpsest/node_modules/@types
# exit 0; existing compiler/types used read-only, no installation

git diff --check
# exit 0
```

The 13 tests comprise five registry cases and eight existing real release-controller cases. Controller cases include old-policy staging, rejection of successor self-judgment, stale stages, original probation judging, accepted successor evaluator use, offline recovery, and SIGKILL recovery. They use tiny disposable artifacts and local evaluator processes, with no model/provider calls.

The lead's previously observed actual dispatcher/supervisor plus registry run at `64bbc44` was 17/17 with zero skips (79 seconds). That result is prior evidence supplied by the lead, not a rerun or new integration claim for this patch. The expensive joined fixture was intentionally not repeated: wiring is unchanged and these repairs have deterministic focused reproductions. Full repository tests, live qualification, deployment, and H1 remain outside this review's acceptance. Existing corrupted registry records are not silently repaired; this patch prevents creating the identified self-reference and retains fail-closed behavior for malformed state.

Disposition: **fixture-verified repair and independent wiring review**, ready for lead cherry-pick/review. The exact handoff revision is the commit containing this evidence and both source/test changes. No paid calls, credential reads, service deployment, or outbound messages were performed.
