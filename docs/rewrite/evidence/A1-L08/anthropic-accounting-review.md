# A1-L08 independent Anthropic accounting review

2026-10-11. **Three reproduced request/profile defects repaired; bounded offline accounting evidence accepted.** Owner Codex `/root/a1_anthropic_review`, A1-L08-T02/T06; branch `codex/a1-anthropic-review-20261011`, isolated worktree `/home/palimpsest/migration/aeon-1-20261011/anthropic-review`. Reviewed integrated base `d70b5c7` (author runtime `12b9468f60981eb73eb64d98b02ac5cdccdc2d1b`) and author evidence `5c16f7e031017fc299512117b882412c7841166c`. Frozen repair/check source **`e568b94a625ef794dc3053c8dda779b22917c2e4`**. The actual finite goal had no token budget; completion applies to this review, not full L08, live compatibility, parity or H1.

```text
/goal Independently review the separately declared first-party Anthropic profile, codec, observer and native wrapper against official API contracts; reproduce and fix consequential defects in assigned baseline runtime/tests, retain exact-source evidence, and finish the bounded review without native/provider/paid/auth calls.
```

Root assigned exclusive baseline runtime/test ownership except the separately owned `claude-kernel.test.ts`, plus this new evidence file. Shared contracts, kernel machinery, native configuration, central status and author evidence remain unchanged. Dependencies were the active requirements/PLAN/workflow/L08, [readiness specification](live-profile-readiness.md), [author accounting evidence](anthropic-accounting.md), and [prior Claude transport review](claude-transport-review.md). Root owns integration and the next native compatibility gate.

## Reproductions and repairs

1. **Cognition/profile misbinding.** The request validator checked effort and thinking only when present, then accepted omission as the selected profile's supposed model default. A profile saying `high` and `adaptive` provided no separate, model-specific default attestation. Both omission reproductions dispatched and settled instead of refusing. Official [effort documentation](https://platform.claude.com/docs/en/build-with-claude/effort) makes the distinction material: omitted effort uses the model default, currently medium on Opus 5.5 and high on many other models. The [thinking configuration reference](https://platform.claude.com/docs/en/build-with-claude/thinking) likewise makes omission model-dependent. Repair requires explicit native `output_config.effort` and `thinking` matching the immutable profile. It neither injects controls nor rewrites native cognition. Supporting omission later requires a separately verified default contract; a selected value alone is insufficient. Missing controls now cause zero physical dispatches.
2. **Invalid manual thinking grant.** A 10-token manual budget below a 20-token output cap passed admission. The [Messages reference](https://platform.claude.com/docs/en/api/messages/create) requires manual thinking budgets of at least 1,024. Repair enforces that minimum and the existing below-output-cap condition. A valid 1,024 budget/2,048 cap fixture preserves the native budget and settles output once. Model-specific support for manual versus adaptive thinking remains a qualification obligation.
3. **Operation-kind rewrite.** Native `max_tokens: 0` was accepted and rewritten to the positive host cap. [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) now defines zero as a distinct, nonstreaming cache-prewarm operation. The rewrite would turn a cache preparation request into generation. The same rewriting accepted negative, fractional, unsafe, null, string and omitted limits. Seven pre-fix cases failed. Repair requires a positive safe integer before applying the declared host cap; prewarming stays unsupported. The existing positive-generation cap policy and synthetic profile are unchanged.

External `pre-fix.log` preserves the first three failing assertions (58 passes/3 failures). `prewarm-pre-fix.log` preserves seven failures, with exit code 1, against the intermediate cognition/minimum repair. Exact codec/test snapshots for both states are retained. The first log was followed by a shell `tail`, so its enclosing shell returned zero; the retained test report explicitly contains three failures and is not described as a passing command. The review also tested mutation of the original caller-owned grant object: it cannot change the observer's frozen cognition, prices, limits or settlement.

## API facts and accounting disposition

Official pages were retrieved through the web tool on 2026-10-11; no retained HTML snapshot or provider call is claimed.

| Boundary | Independently checked disposition |
|---|---|
| U/W5/W1/R/O | Existing fixtures independently rerun; aggregate input includes uncached input, both write TTL categories and cache reads. Write total equals the TTL split; cumulative fields merge monotonically. Thinking detail is a subset of output. No duplicate write/thinking charge found. |
| Stream completion | [Streaming reference](https://platform.claude.com/docs/en/build-with-claude/streaming) permits multiple cumulative `message_delta` events followed by `message_stop`. Existing decreasing, incomplete, error and mismatch tests retain the conservative reservation. A complete `max_tokens` response settles measured usage and records truncation; it is not a task success claim. |
| Tier | [Service tiers](https://platform.claude.com/docs/en/api/service-tiers) distinguishes request `standard_only` from served `usage.service_tier: standard`; `auto` may use priority capacity. Existing request/response refusals correctly keep this profile on the explicitly priced standard boundary. |
| Geography | [Data residency](https://platform.claude.com/docs/en/manage-claude/data-residency) says omitted geography uses the workspace default; global is standard-priced and US-only applies a multiplier across token categories. Existing forwarding explicitly pins global and validates served geography, avoiding an implicit workspace-default assumption. |
| Speed | [Fast mode](https://platform.claude.com/docs/en/build-with-claude/fast-mode) uses explicit beta/speed controls and reports fast or standard in usage. Fast is refused. Absent response speed is accepted only as an inference from the narrow non-beta standard request contract; it is not independently observed speed evidence. |
| Unpriced features | Priority/US-only/fast, nonzero or unknown hosted-tool counters, unknown usage dimensions and unsupported native beta headers fail closed. Null/missing served tier or geography cannot establish exact settlement. A conservative unknown charge is not precise invoice reconciliation. |
| Lifecycle and grant | Unknown/cancelled responses retain the highest input-category reservation, cancel the original grant and refuse replay/replacement. One active request and settled-plus-reserved totals remain bounded. Both 200k and 1M input contracts fail the 144k grant before native state/dispatch; paid entry still requires explicit kernel limits. |
| Transport | Pinned first-party endpoint/version, no redirects/retries/ambient credentials. Fake-fetch checks retain credentials only in the host header. Signed/redacted thinking, local tool continuations and cache controls remain unchanged in forwarded artifacts. |

The numerical category/reservation algorithm required no repair. Synthetic Anthropic and OpenAI regression cases pass. Unknown usage never becomes free, and no test changes the original grant to make a refusal pass.

## Exact evidence and checks

Evidence directory: `/home/palimpsest/migration/aeon-1-20261011/anthropic-review-evidence/`. `manifest.json` binds source revision, Node, source/log/snapshot hashes, commands and results. `author-audit.json` verifies all seven author source hashes against both the author Git objects and integrated `d70b5c7`, plus the pinned Node binary. Existing root dependencies were symlinked; no install or dependency mutation occurred.

With `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin` first on PATH and native opt-in environment variables explicitly unset:

```sh
node --test evaluations/baselines/anthropic-codec.test.ts evaluations/baselines/claude-fixture-codec.test.ts evaluations/baselines/observer.test.ts evaluations/baselines/run-claude.test.ts evaluations/baselines/run-codex.test.ts
npm run check
git diff --check
```

Final result: **128 passes / 131 tests, zero failures, three explicit native/kernel opt-in skips**; repository strictcheck passes using its existing `strict: true` configuration. The 68 Anthropic tests include 12 new review cases. `codex-worker.test.ts`, the new Claude kernel test, broad suites, native binaries, provider/authenticated requests and paid calls were not executed in this review. No compiler-policy expansion was used.

A separately authorized **read-only retained-artifact audit** checked the kernel owner's fresh old-fixture run at `793ab4124a7d26a3f1eb7f00c2aac64f76873ff5`. `kernel-audit.json` and `audit-kernel.py` verify 22 indexed files, 11 SQLite artifacts, all 86 runtime source hashes against exact Git objects, the original grant/allocation, cancellation after completion, unchanged input/instructions/tools, and two settled synthetic 100-input/10-output/zero-USD requests. Manifest `9c1cd28fb43118dae9139edbd818a9a2606ac591fb8bbabc5fbc7b1a77b303af`; result `f7492c1958c0520e679e06f23a7eceae5092a3adc7a993b1c95e5c97d2178298`. The native fixture worker, configuration and codec are byte-identical at this review repair. This audit did not rerun native code or independently repeat physical kernel effects; it corroborates retained fixture evidence only.

## Remaining gates and handoff

Actual first-party native compatibility remains **unavailable**. The installed CLI's retained beta headers are refused; this repair does not strip or weaken them. Missing native cognition controls are now another explicit admission refusal instead of presumed defaults. Future support must bind actual request controls, beta/header/body pairs, billing dimensions and native framing to a pinned model/binary. Root separately owns that next compatibility investigation/implementation. Buffering the full provider stream, required native tools/delegation/recovery, concurrency, model selection and meaningful output limits still require qualification; the old fixture kernel proof does not qualify this real profile.

Account/authentication authority, entitlement, a reservation-compatible issued grant, independently sealed calibration/workloads, best-system configuration and empirical competence remain open. No model-specific live support, native best-system result, comparator parity or H1 is inferred from these checks. Cherry-pick the frozen repair and this review evidence; no central lane/availability change is included.
