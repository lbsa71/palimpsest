# A1-L09 fresh governance/reviewer source review

Status: **fresh source review and focused fixture verification complete**, with one reproduced publication defect repaired. This is engineering evidence for A1-L09-T03/T05 and RW14/RW15/RW16/RW19/RW21, not H1, live evaluator qualification, or a production deployment claim.

Owner: `/root/a1_governance_review`. Isolated branch `codex/a1-governance-review-20261011`, worktree `/home/palimpsest/migration/aeon-1-20261011/governance-review`, frozen review base `2bb7227825f891bac2ea66ea8157f67c1d550a07`. Source/test repair: `71cbc3747871f91753b0a36ad4cb772681b849c9`. The review inspected proposal/registry commit `3a06cdc39b10aad9e12d68b445e033ac9e624cbf`, joined wiring `60d33494a1b9db6c9c653463a04f521e5772a7c6`, and author evidence `9d518adfbac7bd200c603238498c8fa414b426c9` (original author handoff `e950ac26a90db98d5547c718093b59c44d21ee3c`).

A finite tool goal was created first, without a token budget: review the governance/reviewer source and joined wiring, reproduce and fix consequential defects within assigned ownership, verify, and record evidence. AGENTS, REQUIREMENTS, PLAN, workflow and the L09 lane were read. The lead reserved reviewer-registry, policy-registry, evolution-tools, metadata and dispatcher/supervisor source for review; this work changed only reviewer-registry and its own tests. The separate `/root/a1_succession_final_review` owns physical composition and `deployment/evaluation-dispatch.test.ts`; root owns root configuration and integration. No further delegation was needed for this bounded fresh review.

## Reproduced finding and repair

Before repair, `ReviewerRegistry.prepare` checked the snapshot directory's privacy, then performed inventory and publication through its absolute pathname. A deterministic filesystem race replaced that directory with a symlink immediately before the first temporary snapshot write. Preparation eventually rejected the redirected path, but one content-addressed reviewer blob had already been written into the substituted directory. The failing assertion was `No reviewer bytes may be published through the substituted path`: expected no entries, observed one hash-named file. No reviewer/policy authorization was successfully obtained; the demonstrated defect was unintended publication before fail-closed validation.

The repair walks all directory components using pinned file descriptors with `O_DIRECTORY | O_NOFOLLOW`, validates ownership/mode on the final inode, and retains that descriptor for inventory, temporary write, exclusive hard-link publication, cleanup and directory fsync. Existing full-path private reads still verify the published binding before registry insertion. Replacing the pathname now writes only into the originally checked inode and rejects the changed logical path without writing into its substituted target or registering either policy record. The test models a concurrent actor able to replace a host-private path; it does not claim that the confined candidate already has such filesystem authority.

The regression was added before changing source and retained unchanged after the fix. Additional behavioral checks establish that repeated inherited bytes reuse existing sealed objects, the cumulative unique-byte limit rejects before publishing new files, interrupted temporary entries and symlink entries acquire no bindings, and a reviewer source present in the frozen payload is rejected unless also present in the immutable control inventory.

## Review disposition

- Frozen proposal and reviewer source identities are checked against the candidate and its control inventory. Inherited mounts must match the prior reviewer's mount/hash pair. Source selectors are bounded deployment paths; private host paths, new signing identities, qualification kind changes and resource grant changes are rejected.
- Policy descriptors retain the configured signing-key digests and evaluator identity set. Derived policy lookup recomputes the exact policy identity and resolves secrets from the configured origin. Returning to the original control/policy identity avoids creating a self-referential derived row; the existing policy tests exercise restart and origin reversion.
- Preparing a new reviewer does not select it for the current transaction. Dispatcher admission uses the queued request's policy digest; fresh probation uses its retained original policy and judge authority. The controller requires fresh evidence and does not accept next-policy self-judgment. Later work uses the newly accepted policy after host handoff.
- Public metadata projects mount/hash identities and limits, excluding file-source paths and key-file fields. Metadata validation binds executable/arguments/mount hashes to the public policy artifact. Ordinary governance freezing preserves the original judging digest.
- Supervisor caching retains a cloned reviewer configuration by exact policy identity. `runExternalReview` independently validates the policy descriptor, reads and hashes the signing key, and snapshots/hashes each executable file before physical dispatch. Status polling does not repeatedly read the executable closure.
- Missing reviewer configuration or key does not become a dependency of retained-code recovery: construction/configuration failure is diagnosed, optional public metadata resolution is caught, and unavailable review resolution does not grant review authority. Existing missing-key constructor tests passed; no new full offline boot claim is made here.
- Retained snapshots remain capped by the existing unique-byte grant, 4,096 entries and 64 reviewer-policy bindings, and use owner-private singly linked content-addressed files. The host supervisor lease remains the serialization boundary for separate host writers; this review did not introduce a second publication owner or garbage collection.

## Verification

Node: `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`. Development dependencies were symlinked from the integration checkout; no dependency or root configuration changed.

```sh
node --test deployment/reviewer-registry.test.ts deployment/policy-registry.test.ts
# Baseline: 11 passed, 0 failed; 1.267 seconds.
node --test --test-name-pattern='snapshot publication never' deployment/reviewer-registry.test.ts
# Before fix: 0 passed, 1 failed; unintended redirected snapshot reproduced.
node --test deployment/reviewer-registry.test.ts deployment/policy-registry.test.ts
# Final: 15 passed, 0 failed, 0 skipped; 1.682 seconds.
node --test --test-name-pattern='ordinary governance source' deployment/evolution-tools.test.ts
# 1 passed, 0 failed, 0 skipped; 3.691 seconds.
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH npm run check
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH npm run build
git diff --check
# Passed; check/build repeated successfully after the final test addition.
```

## Remaining gates and handoff

The standalone `ServiceSupervisor` retains the metadata with which the probation service started until an explicit close/open. Consequently, a changed governance profile is not available to that service for a subsequent ordinary cycle before restart. Root confirmed this is an explicit standalone limitation: the installed CLI supplies `onHostAccepted`, requests the accepted host successor, and the newly started host publishes the accepted policy metadata. Refreshing only metadata would conceal the separate host-code handoff, so this review did not add such a shortcut. Product qualification remains on the installed path.

The physical composition owner was notified of `71cbc37` before its next candidate freeze. That agent's changed executable/cases, old-policy admission, fresh old-policy probation, accepted-host restart and future-review selection evidence is a separate joined gate; this document does not relabel unit/source inspection as that physical result. Root must integrate the repair, review the changed publication code and combine the physical evidence with this source review. No heavy mounted/systemd/source-freeze suite, paid provider request, Slack message, production change or push occurred in this task. The ordinary-freeze test uses its existing small inert fixture.
