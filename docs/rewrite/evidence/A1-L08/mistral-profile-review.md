# Independent Mistral profile-binding review

2026-10-11. **Accept the bounded repair as independently fixture-verified.** No additional runtime defect found in this scope; integration and full L02/L08/H1 acceptance remain root-owned. Reviewer `/root/a1_mistral_profile_review` did not author the broker repair. Review worktree `/home/palimpsest/migration/aeon-1-20261011/mistral-profile-review`, branch `codex/mistral-profile-review-20261011`, base author handoff `e8f2f801d4b26c80f189b0410193b17fdb236e7d`. Actual finite goal created without a token budget.

```text
/goal Independently verify the Mistral broker profile-binding repair, preserve unknown receipts and charges across cancellation/reopen/reconciliation without automatic replay, audit retained physical evidence, and hand off focused checks and a bounded acceptance disposition.
```

This is an A1-L02/L08 review task for RW10, RW15, RW16 and RW17. Inputs: active AGENTS, requirements, plan/workflow, architecture, L02/L08 lane specifications and [author evidence](mistral-profile-binding.md). Root reserved `deployment/broker-shell.ts`, its profile-binding test if repair proved necessary, and the new review test/report. Only the two new review files were changed. Root retains central status/coordination. No shared contract, other runtime, OpenAI handling, request profile or governance path was edited.

## Source and public-contract disposition

Reviewed runtime `683068b57f23b0eaf8afa60436fd4e8d6dfd1bf4` against original root `04107e3` and prepatch test revision `e73baf9aa26117a6182c16e9453eb892e93ad86f`. The repair is Mistral-only and occurs before assigning token prices, marking success or returning the provider response to the worker. It requires exact host-pinned model equality and rejects every explicitly returned tier except `standard`. The existing request allowlist denies `service_tier`, so workers cannot silently select another pricing profile. The response does not supply the configured rates.

Independently reopened [Mistral's primary Priority Tier documentation](https://docs.mistral.ai/inference/priority-tier) on 2026-10-11. It specifies omitted request tier defaults to `standard_only`, served usage reports `standard` or `priority`, and priority carries a 1.75× multiplier. Accepting absent response tier is therefore a bounded inference from the omitted-request contract. The receipt does not fabricate an observed tier. This is not invoice precision or proof of provider compliance.

On profile rejection, the original receipt remains uncertain with null token/cost usage, observed model/tier and raw-body digest. The host's finally path records and settles it before replying or draining worker loss. The existing ledger preserves the reservation ceiling for unknown charges. Worker settlement is advisory and cannot replace this host evidence. Reservation consumption precedes dispatch; the host does not retry automatically. Reconciliation or a fresh request under separate authority is not a universal exactly-once guarantee.

## Independent behavior and red/green evidence

Review test revision **`2ade976`** adds three host-handler cases in `deployment/mistral-profile-review.test.ts` using Node's built-in worker-module mock:

1. Wrong model returned after in-flight cancellation, followed by forged zero-cost worker settlement.
2. Priority tier returned after in-flight cancellation, followed by the same forgery.
3. Wrong model returned while the mocked worker exits and the actual host finally path drains its pending request.

Each case also refuses an attempted request-tier override before any transport call, denies early worker settlement while in flight, preserves the final receipt and original unknown charge after durable reopen and unresolved reconciliation, and prevents the same request identity from dispatching through a reopened broker. The grant permits eight requests, so duplicate identity rejection is not an artifact of a one-request budget. Cancellation retains the uncertain concurrent slot and charge. The worker-loss case has no initial cancellation, separately checking replay refusal under an available grant. Each case makes exactly one injected synthetic call.

Replacing only the broker file temporarily with prepatch bytes makes **all three tests fail** for missing expected response refusal. Restoring the unchanged reviewed broker makes **3/3 pass**, zero skips/failures, 334.292328 ms. The original source bytes were restored and verified before commit. No runtime repair was needed.

Pinned Node `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` (24.13.0); existing root `node_modules` linked without installing dependencies. Commands/results:

```sh
node --experimental-test-module-mocks --test deployment/mistral-profile-review.test.ts
# reviewed broker: 3 passed; prepatch broker: 0 passed, 3 failed
node --experimental-test-module-mocks --test deployment/mistral-profile-binding.test.ts
# independent rerun of author's cases: 13 passed, zero skips/failures
npm run check
# ordinary repository strictcheck passed after final test changes
git diff --check
# passed
```

The new tests are host protocol/lifecycle fixtures; mocked worker loss is not a new kernel process-kill demonstration. They skip under ordinary invocation without the module-mock flag. No full suite, build or confined replay ran in this review.

## Retained physical evidence audit

Read-only audit of `/home/palimpsest/migration/aeon-1-20261011/mistral-profile-binding-evidence/manifest-final.json` reproduced SHA-256 **`d0da1c1f4ed7fb48dfc1097f4a18b3769173efadd8e0d63cecde441811c32058`**. All **64/64** retained file byte lengths/hashes match. Both broker/test source hashes, package-lock hash and pinned Node binary hash match the current reviewed inputs.

Audited all five retained actual confined-pipe cases through their original SQLite databases opened read-only, summaries, raw-body artifact hashes, final transport receipts, requests/ceilings and cancelled allocations. Standard and omitted-tier cases retain succeeded 9-token/USD0.000011 settlement. Different-model, priority and null-tier cases retain uncertain null usage and the original 1,704-token/USD0.002216 reservation, including 5,000 ms ceiling. Stored receipts exactly match manifest/summary receipts; observed model/tier match retained bodies; omitted tier stays absent. Each summary records one call and refusal of replay. The original physical log records 5/5 pass, zero skips/failures, 636.134374 ms at unchanged runtime `683068b`.

This is an independent audit of the author's scheduled physical execution, not an additional physical execution. Original files were not rewritten. No unresolved finding required another confined window.

Reviewer logs and reproducible audit script/result are retained separately at `/home/palimpsest/migration/aeon-1-20261011/mistral-profile-review-evidence/`: `reviewer-prepatch.log`, `reviewer-tests.log`, `author-focused.log`, `strict-check.log`, `audit.py`, `audit.json`. The prepatch failures remain evidence.

## Handoff and limits

Recommend root integrate the author's bounded repair plus independent test commit `2ade976` and this report's commit (the exact tip returned in the handoff). Reviewer owns no further runtime edits. Root owns lane/status updates and any later aggregate verification.

No authenticated/live provider call, key inspection, external message, dependency installation, deploy or push occurred. No new charge profile or provider-tier knob was added. The review does not establish exact cache invoices, live token/framing bounds, account entitlement, model competence, native comparator qualification, broader retry/recovery coverage, full L08 parity, H1 or autonomous readiness. Missing live and full-lane gates remain open.
