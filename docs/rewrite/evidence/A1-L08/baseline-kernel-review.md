# Fresh review of native baseline kernel composition

2026-10-11. A1-L08-T02/T06, independent Codex `/root/a1_baseline_kernel_review`, reviewing integrated source **`e4fbc3b304e7f05b267f72c7ae4f312390838f00`**. Worktree `/home/palimpsest/migration/aeon-1-20261011/baseline-kernel-review`, branch `codex/a1-baseline-kernel-review-20261011`. Root delegated exclusive repair ownership of `evaluations/baselines/run-codex.ts`, its test, and this new review; shared enforcement and prior evidence remained read-only. An actual finite goal was created without a token budget.

```text
/goal Complete a bounded consequential review of the A1-L08 native baseline kernel composition at e4fbc3b, make minimal owned-file repairs if needed, record evidence and limits, and commit the review in an isolated worktree.
```

**Disposition: no material defect found in this change; no source repair required.** The [author evidence](baseline-kernel.md) supports the specific native CLI/helper/command composition with kernel limits and synthetic provider replies. This review accepts that bounded engineering evidence; it does not accept paid execution, calibrated comparator competence, parity, autonomous qualification, or H1.

## Source and authority review

The nine-line runner change admits an optional resource profile for fixture transport, uses the same `runWorker` → `spawnBounded` implementation already used by paid transport, and records explicit `providerTransport`, `qualification`, and `kernelLimits`. Paid transport still requires a nonempty explicit credential and resource profile. It has no ambient credential discovery, alternate endpoint, automatic retry, or fallback to the namespace-only path. Invalid or unavailable enforcement fails before provider dispatch.

The manifest's `kernel-profile` label describes enforced resources, independently of transport. Its `providerTransport: fixture` and synthetic context/price declarations preserve that distinction. Grant validation, before/after native request capture, service-tier controls, reservations, cancellation, replay refusal, and private-state link checks remain intact. The baseline run's `status: completed` means the invocation returned a recorded result; it does not mean CLI success or trustworthy provider usage. Both failed trials have completed invocation records, nonzero CLI outcomes, and unknown attempts. Consumers must inspect those outcomes rather than treat the status as an acceptance result.

The reviewed runner, test, observer, native worker, and entire shared supervisor tree are byte-identical to the final actually tested author revision `dff58aed4d195caae73872e809aa59a8638e939a`. Integrated commits `9f32d96`, `ed3de02`, `c7e6718`, and `e4fbc3b` retain the original implementation, two fixture corrections, and evidence. The unrelated baseline availability metadata differs from the author's worktree; it is not executable trial input. Fresh SHA-256 checks of Codex, helper, Node, lockfile, and worker all match the recorded identities.

## Evidence audit

Read-only SQLite inspection independently verified every artifact digest in all three private trial stores, each manifest against its persisted specification, and the final durable summary against the actual database. All five synthetic attempts preserve identical native input, instructions, and tool definitions before and after accounting controls; none contains the evaluator sentinel. Each original allocation remains cancelled with the unchanged two-request, 30-second envelope.

Trial 1 retains one unknown attempt. Trial 2 retains one completed and one unknown attempt. Trial 3 retains two completed attempts, each 100 input tokens, 10 output tokens, and 0.00023 synthetic USD. The final invocation result has exit code zero and no output-limit breach. Its second captured native tool-output item contains actual PID refusal (`EAGAIN`, 11), block and inode refusals (`ENOSPC`, 28), and both proof markers. This audit checks the tool-output items themselves, so it does not mistake markers in the scripted tool-call input for observed output.

Host observations place the worker and native CLI in the bounded command cgroup and, at the second request, the actual `/app/codex-code-mode-host` helper. Read-back assertions check 805,306,368 memory bytes, zero swap, group OOM handling, 96 tasks, and CPU quota/period 50,000/100,000. The second observation records memory peak 89,518,080 bytes, two PID-limit events, CPU usage 1,144,694 microseconds and throttling 1,594,161 microseconds. The genuine command also exercised the provisioned ext4 workspace's block and inode exhaustion. These support the stated composition claim, with no native OOM claim.

The preserved TAP files agree with the described failures and final pass: Node 24's `MainThread` name invalidated the first fixture assumption; exact worker command identity fixes that assumption. The next attempt produced a successful command result but yielded too early for the fixture's second reply. Waiting up to ten seconds leaves the original 30-second grant and all resource/request ceilings unchanged. Neither correction removes an outcome assertion.

The external trial harness stops the disposable unit and invokes the existing workspace remover on exit, including assertion failure. All three cleanup records report absent units/cgroups, mounts, loops, and volume directories; final observations have no remaining command group. Fresh read-only existence checks also find none of the three trial volume directories or service cgroup paths. This review did not repeat privileged mount/loop probes or create a new native trial; the original cleanup records and unchanged enforcement source supply that portion of the evidence.

## Fresh verification

Node for all checks: `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`, v24.13.0. The ignored `node_modules` link points to the existing root development closure; no dependency mutation occurred.

```sh
node --test evaluations/baselines/observer.test.ts evaluations/baselines/run-codex.test.ts
node node_modules/typescript/bin/tsc --noEmit
git diff --exit-code dff58aed4d195caae73872e809aa59a8638e939a e4fbc3b -- evaluations/baselines/run-codex.ts evaluations/baselines/run-codex.test.ts evaluations/baselines/observer.ts evaluations/baselines/codex-worker.mjs packages/supervisor
node /home/palimpsest/migration/aeon-1-20261011/baseline-kernel-review-audit.mjs
git diff --check
```

Results: **42 passed, zero failures/cancellations, two explicit native opt-in skips**, 3.145 seconds. Strict TypeScript, source equivalence, read-only audit, and whitespace checks passed. The fresh suite does not purport to rerun the native trial; the audited author trial remains 10 passed, one namespace-only skip, zero failures.

Review artifacts are external under `/home/palimpsest/migration/aeon-1-20261011/`:

| Artifact | SHA-256 |
|---|---|
| `baseline-kernel-review-audit.mjs` | `c6a53a66a5592d45d348d9e22f162b5e39a5c78a91d13e629daceaa657833aaf` |
| `baseline-kernel-review-audit.json` | `0b07bb841daebd9f46747039f1bfef0708ccb879507dc9ddcea4457764f3e64f` |
| `baseline-kernel-review-light.tap` | `b6e80511c12600a962db75635eb8fcd0ae11eef2e88f4d24d8aff169b0170b76` |

## Limits and handoff

Native OOM was not exercised. The read-only host `/usr` tool set remains unsealed; hashed Node is mounted from its stable host path. Hostile same-UID mutation remains outside this boundary. Native file/fd limits are installed through the existing shared implementation but this trial does not separately exhaust them. The synthetic grant's large reserved token allowance does not establish real pricing/context correctness. Private artifact hashes establish integrity of these local records, not independent provenance or held-out workload authority.

No provider call, credential read, spending, Slack action, production change, native rerun, mount/cgroup mutation, or push occurred during review. Root owns integration and central lane/status updates. The finite review is complete with this evidence-only handoff; paid-provider qualification, full host closure, native OOM composition, and wider evaluation/H1 gates remain unestablished by this review.
