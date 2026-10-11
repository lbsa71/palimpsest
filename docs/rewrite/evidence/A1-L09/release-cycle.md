# Durable release cycle engineering evidence

Task: A1-L09-T03/T05 engineering slice, RW10/RW14/RW15. Owner: `/root/a1_release_cycle`; branch `codex/a1-release-cycle-20261011`, worktree `/home/palimpsest/migration/aeon-1-20261011/release-cycle`, base `b95ee1d`. Root reserves deployment/configuration/CLI integration. No deployment or live inference is authorized by this record.

Finite goal: implement and verify durable transfer, probation, offline rescue and separately staged control replacement; retain exact admission proof and current operational state; hand off reviewed source and limitations. Inputs: current C1 contracts, artifact freeze/admission, AuthorityStore and ProcessLease. Writable paths: `packages/release/**`, the coordinated `ProcessLease.assertHeld()` addition, this evidence. Inherited development model/effort; no model requests or external effects in tests. Fresh review is requested from `/root/a1_core_review`; final disposition is recorded in the follow-up handoff.

## Behavioral contract and implementation

Before this slice, immutable artifact/admission and authority primitives existed without a durable orchestration path. `ReleaseController` now persists release state, full signed proof, policy descriptors, evidence/recovery artifact bytes and event history in SQLite with synchronous FULL. Candidate freeze flushes files/directories before publication and the artifact-store directory after rename. Artifact stores, release/authority databases, evaluator keys and lease must remain host-private outside worker namespaces; read-only file modes alone are not confinement.

Initialization is explicitly evaluated: `bootstrap(proof, policy)` admits the **already current frozen artifact** and records whether the receipt is engineering or product. The proposal's recovery artifact must be the exact retained rescue `candidate.json`, rather than an unrelated asserted recovery byte string. Bootstrapping does not infer product qualification.

`transfer(proof, generation)` requires accepted status and exact authority, admits against the frozen incumbent policy, records intent, withdraws authority, waits for `stopAndDrain`, rehashes the frozen payload, activates a distinct generation, and invokes `start` with the actual payload path/grant. Successful startup enters probation. Failed startup immediately withdraws the new grant. A failed drain leaves authority withdrawn. Pending state never silently becomes accepted after a crash.

`acceptProbation(freshProof)` requires new independently authenticated evidence IDs, exact candidate and the **original admission authority and policy**. In particular, newly activated controls cannot judge their own probation. The currently running authority is independently checked against the ledger. Acceptance moves the retained rescue pin; prior immutable artifacts remain available.

`stageControlUpgrade(proof, nextPolicy)` is a separate durable operation judged by the old policy. The candidate's `inputs.controls.policy` must equal `policyDescriptor(nextPolicy)` (required cases, evaluator artifact identities, evaluator key digests, evidence kind), and its control hash must match the next policy control revision. `activateStagedControl(stageId, generation)` checks the unchanged prior authority and re-admits under the old policy before activation. Only subsequent candidates are judged by the accepted new policy.

`recover(generation)` reads the actual authority ledger, including when it is ahead of the release journal after a crash. It fences any grant, drains, verifies the accepted rescue and starts it under a newer epoch. It does not call `getPolicy`, `readArtifact`, an evaluator or a model. The original canonical operational-state directory is pinned and reopening with another directory is rejected. Code/control rollback never copies or restores memory/effect state.

## Host integration API and obligations

Construct with `{ statePath, artifactStore, operationalStatePath, authorityStore, exclusiveProcessLease, getPolicy, readArtifact, hooks }`. The exclusive ProcessLease is a real held object shared with the host; do not acquire another lease for the worker/application using the same instance lock. `assertHeld()` rejects a closed object. One trusted host owns the coordinator. Public methods are `bootstrap`, `transfer`, `stageControlUpgrade`, `activateStagedControl`, `acceptProbation`, `recover`, `status`, `history`, `proof`, `evidenceArtifact`, `close`.

`hooks.stopAndDrain(prior)` must idempotently stop all incumbent and partially started candidate children, await their exit, and drain or durably record unknown effect outcomes. It is called only after authority withdrawal. `hooks.start({ candidate, payloadPath, authority, operationalStatePath })` must execute the verified artifact with the supplied grant and current state. Host receivers must fence every effect through AuthorityStore. The controller does not manufacture process-proof from a hook return; deployed confinement, child cleanup and receiver integration require their own evidence.

`getPolicy(digest)` resolves exact local host-private policy/key material. Changing cases, evaluator identity, kind or keys changes the policy digest. Evidence proof/bytes persist without storing the signing secret. Existing HMAC authentication establishes provenance from the configured host key, not independent product competence; the author-created evaluator fixtures below remain engineering evidence.

## Observed disposable tests

Node: `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` (24.13.0). Dependencies were the base workspace's existing `node_modules` through an ignored local symlink; no dependency or lockfile changes.

Commands:

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test packages/release/*.test.ts packages/supervisor/authority.test.ts packages/supervisor/process-lease.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
```

Observed: 16 tests passed, 0 failed/skipped; TypeScript check passed. New cases execute frozen Node payloads as real children and fixed evaluator files as separate processes in disposable temporary directories:

- Incumbent child exits before successor starts; old grant fails after transfer. Successor enters probation with persisted signed proof and retained evidence bytes.
- Latest memory and uncertain-effect records written during probation survive offline recovery to the accepted rescue; the evidence/model provider is unavailable.
- Reusing admission evidence cannot accept probation; fresh signed evidence pins the successor as the next rescue.
- Payload mutation during drain fails the post-drain hash check, grants no successor authority and executes no modified payload.
- Failed startup after real child creation withdraws authority, then rescue starts after stopping that child.
- Evaluator/control replacement is staged under the previous evaluator. New evaluator self-judgment is rejected for both stage and probation. A later ordinary release uses the newly accepted evaluator; rescue after that release retains the accepted new controls.
- Failed drain prevents activation; changed operational-state path and closed lease are rejected.
- A distinct controller process acquires the OS lease, persists transfer and is actually SIGKILLed while draining or after activation/child startup. Its entire disposable process group is killed. A new controller reacquires the lease, reads persisted state and recovers the accepted rescue with current memory/unknown effects, while policy/evidence providers throw if called. Crash cleanup uses the test process group, not a production PID-reuse recovery algorithm.

All test artifacts, child processes and temporary state are disposed. These are engineering integration tests, not a live autonomous self-improvement cycle, independent product evaluation, H1 completion, production deployment or proof of production process-confinement cleanup. The root integration owner must connect the verified payload loader, external lease, receiver fences and stop/drain lifecycle to the actual application and record that evidence separately.
