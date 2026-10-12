# Live profile readiness: Mistral candidate and native Claude accounting

**Selection update, 2026-10-12:** the user selected reasoning Mistral Large4. [ADR0034](../../../adr/0034-select-mistral-large-4-reasoning.md) adopts `mistral-large-4-0` / high as the primary profile to qualify. The Medium3.5 proposal below is preserved historical evidence and is superseded as the target. No earlier account, grant, price, tokenizer or context qualification transfers automatically.

2026-10-11. **Finite source inquiry complete; proposals are not live qualification.** A1-L08-T02/T06, RW03/RW17. Owner `/root/a1_live_profile_readiness`; branch `codex/a1-live-profile-readiness-20261011`; worktree `/home/palimpsest/migration/aeon-1-20261011/live-profile-readiness`; examined source **`ea5e4453a810dd6ed66bf5017bdeb17b532cb01a`**. Exclusive write scope: this new report. Root owns integration after the frozen aggregate check. No shared availability, protocol, lane, configuration or runtime source changed.

```text
/goal Prepare a source-backed readiness report for live Mistral shell qualification and native Claude comparator accounting, using official public documentation and existing source evidence without authenticated or paid requests; identify concrete offline engineering work, proposed profiles, enforceable ceiling prerequisites and remaining external gates.
```

## Decisions

1. **Offline Claude engineering can proceed now.** The installed native Messages/Bash boundary and public API contract support implementing a bounded first-party Messages transport, cache/thinking accounting and synthetic failure cases. No account-specific fact blocks that implementation. The current runner has no paid Anthropic transport and cannot be described as ready pending credentials alone.
2. **Native comparator admission has a separate reservation problem.** The existing observer reserves the entire profile input context plus output cap per physical request. The protocol's proposed 144,000-token execution ceiling cannot admit a 200k or 1M profile. A grant compatible with that reservation, or independently qualified tighter admission engineering, is required; installing a key does not resolve it.
3. **Mistral remains the candidate provider to qualify.** Propose one version-pinned, documented reasoning profile below. Application transport already preserves its native thinking chunks. Public prices can replace fixture quotes in a proposal, but cannot become an installed host grant through this report.
4. **Best-system Claude cannot reuse the low-effort, disabled-thinking, Bash-only fixture as its best configuration.** Preserve native cognition and required coding/research/recovery/delegation affordances when qualifying the real comparator. Narrow transport engineering is useful without claiming it implements that full comparison.

The [v2 protocol](../../evaluation/protocol.md) requires separate controlled same-model and native best-system tables, comparator-only calibration before candidate scoring, and both named products for full RW03/H1. Public model listings establish neither identical Mistral access through Claude/Codex nor this account's entitlement. Account location, budget selection and actual grants remain unanswered external gates. This inquiry did not repeat those questions or inspect credentials.

## Examined local evidence

Read `AGENTS.md`, `REQUIREMENTS.md` RW03/RW17, `PLAN.md`, workflow, L08, protocol and [comparator feasibility](../../evaluation/comparator-feasibility-v2.md). Source inspection covered `evaluations/baselines/{observer,claude-fixture-codec,run-claude,run-native}.ts`, `claude-worker.mjs`, `deployment/{model-grants,config,application,broker-shell}.ts`, `packages/agent-shell/mistral.ts`, runtime reservations and existing evidence. No native or broad tests were rerun.

The [Claude fixture](claude-transport-fixture.md) identifies native **2.1.296**, SHA256 `24972e3bc859fab2b46ed4c1e51f7d6130f06d3bd550811a114640de3370d0de`, signed/hash-verified outside Git under `/home/palimpsest/migration/aeon-1-20261011/claude-native-feasibility`. Actual native Bash plus two synthetic Messages requests passed. [Fresh review](claude-transport-review.md) audited runtime source `8877b84114d9bbe102d6435f11211b369102c80f` and repaired decreasing cumulative output acceptance; parent-integrated review checkpoint `a83fccc` is supplied by the parent. Those retained observations are prior evidence, not a fresh binary run in this inquiry.

| Boundary at examined revision | Readiness and remaining code |
|---|---|
| Native Claude runner | `run-claude.ts` and shared validation admit fixture transport only. Native worker sets disabled adaptive thinking / zero thinking tokens, low effort, Bash only, and maps all native model roles to one fixture ID. Remove those synthetic restrictions only in a separately declared real profile; do not quietly broaden the fixture. |
| Messages codec | Allows text/local tool/cache-control request blocks, but settles only zero cache, no server-tool usage, disabled thinking and synthetic zero cost. Rejects enabled/adaptive/thinking continuations, top-level cache control/tier/geography and other request forms. Accepts one final `message_delta`; public streaming allows more than one. |
| Baseline prices/types | Provider union is `openai` or `anthropic-fixture`; effort lacks `max`; prices have only ordinary input, cached input and output. `cachedInput <= input` cannot represent cache writes costing more than input. Real Anthropic requires new explicit price categories and a conservative maximum reservation. |
| Native isolation/observer | Immutable grants, durable physical reservations, cancellation, unknown-usage retention and no automatic replay exist. Claude-specific kernel qualification and full native tool/child/recovery observation remain outstanding. A private single-flight bridge currently rejects concurrent local Messages traffic; it cannot establish native parallel delegation coverage. |
| Candidate ModelProfile | Grants exact provider/ID/reasoning/effort/prices, allows bound reductions only, supports Mistral/OpenAI and effort `none`/`high`. Fixture IDs/prices demonstrate mechanics. They do not qualify current public models. |
| Candidate Mistral bridge | Sends nonstreaming Chat Completions, ordinary local function tools and explicit high effort; retains complete native thinking chunk signatures across continuation. Host reserves payload bytes + 1,024 framing tokens + output cap, and prices observed prompt/completion totals at configured base rates. Cache/tier breakdown is not recorded. |
| Application health | Reports local authority/allowance/capacity/credential presence and `providerConnectivity: not-probed`. It neither verifies an account nor performs a provider request. |

Codex live OpenAI transport is already engineered in the native observer path, as documented by [observer review](baseline-observer-review.md); entitlement remains unverified. No new OpenAI model/pricing assertion was needed here.

## Public source findings and proposed profiles

All linked official pages were retrieved **2026-10-11 UTC**. These are proposals for later host review; no live access, price agreement or configuration change is inferred.

**Mistral candidate proposal:** `mistral-medium-3-5`, provider `mistral`, documented v26.04 GA, 256k context, `reasoning: true`, effort `high`, synchronous Chat Completions with existing local tools. The [model page](https://docs.mistral.ai/models/mistral-medium-3-5-26-04) documents this identifier and context. [Lifecycle policy](https://docs.mistral.ai/inference/model-lifecycle) says GA has no silent updates and major.minor names fix the version; use neither `mistral-medium-3` nor `mistral-medium-latest`. The page path's `26-04` is not an invented API suffix. [Reasoning documentation](https://docs.mistral.ai/studio/conversations/reasoning) recommends high for agentic/code use, describes thinking/text chunks and requires complete assistant replay. Existing source implements that replay. Begin qualification with this bounded known transport rather than adding hosted features merely because the API lists them.

The [Mistral price table](https://docs.mistral.ai/inference/pricing) lists USD/MTok **1.50 input / 0.15 cached input / 7.50 output** for Medium 3.5. The [Chat reference](https://docs.mistral.ai/api/endpoint/chat) defines `max_tokens`, `reasoning_effort`, optional `prompt_cache_key`, and prompt-plus-output context fit. Keep the application’s currently omitted cache key as a declared profile fact. Base-rate charging is conservative for cache hits but is not an exact cache invoice. No separate thinking-token price is claimed: the existing bridge observes completion totals and the docs show extra thinking uses tokens. A separate cached/thinking breakdown must be sourced and implemented before claiming that precision.

[Priority Tier](https://docs.mistral.ai/inference/priority-tier) documents omitted tier as `standard_only`, served `usage.service_tier` values `standard`/`priority`, and a **1.75×** input/output/cached-token multiplier. Eligibility requires account setup; standard qualification needs no invented priority entitlement. Record/validate served standard tier before exact cost claims. Requesting automatic priority would require a different explicit price/grant profile.

**Claude transport preparation proposal:** native 2.1.296 with first-party `POST /v1/messages`, canonical **`claude-opus-5-5`**, ordinary global standard-speed inference, `service_tier: standard_only`, native adaptive thinking and native cache controls preserved. This model is a concrete coding comparator candidate, not the final best-available selection. [Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/overview) documents 1M context, 128K maximum output, always-on adaptive thinking, USD/MTok **4 input / 20 output / 5 five-minute cache write / 8 one-hour write / 0.20 cache read**. [Versioning](https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions) guarantees dateless IDs from 4.6 onward are pinned snapshots, while serving infrastructure may change.

The current public [Fable 5.1 page](https://platform.claude.com/docs/en/models/fable-5-1/overview) lists `claude-fable-5-1`, 1M/128K limits and always-on adaptive thinking for demanding reasoning/agent work, USD/MTok **10 input / 50 output / 12.50 five-minute cache write / 20 one-hour write / 0.25 cache read**. It is a potential stronger comparator if actually authorized and usable through the pinned native CLI. Best-system selection must record why Opus/Fable/another entitled native configuration was selected; public model rank alone does not establish CLI compatibility or this account's access. Do not call lower-effort Opus the best available without that decision evidence.

[Effort](https://platform.claude.com/docs/en/build-with-claude/effort) documents API `output_config.effort`, including `low`, `medium`, `high`, `xhigh`, `max` where supported; Opus 5.5 defaults to medium and Fable 5.1 to high. A particular highest label is not automatically best under the finite task envelope. Preserve and manifest the actual selected native effort, qualify it, and account thinking within output. The installed help only establishes the fixture's observed CLI interface; future API `max` support does not prove this binary accepts a `--effort max` invocation.

## Messages accounting that can be engineered offline

[Create a Message](https://platform.claude.com/docs/en/api/messages/create) publishes the relevant request and usage dimensions: uncached `input_tokens`, cache creation/read counts, creation TTL split, output including optional `output_tokens_details.thinking_tokens`, served tier/geography and server-tool counters. [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) supplies the TTL breakdown and explains that total prompt input is uncached input + cache creation + cache read. Cache creation total and the five-minute/one-hour split describe the same tokens; adding both double-counts. Thinking detail is a subset of output, never an additional output charge.

[Streaming](https://platform.claude.com/docs/en/build-with-claude/streaming) permits one or more cumulative `message_delta` updates, then `message_stop`, with thinking/signature deltas and possible stream errors. The codec must retain monotonic cumulative totals and one final billable value per dimension, not sum cumulative deltas. Missing/truncated/contradictory usage, model mismatch or unsupported billable dimensions must retain conservative charges and end the original grant. Normal bounded `max_tokens` exhaustion must settle measured completed usage while marking task truncation; it must not become a competence pass.

For a response with uncached input U, five-minute writes W5, one-hour writes W1, reads R and total output O:

```text
inputTokens = U + W5 + W1 + R
cache_creation_input_tokens = W5 + W1
costUSD = (U*pU + W5*pW5 + W1*pW1 + R*pR + O*pO)/1,000,000
```

Keep the category receipt alongside aggregate `ResourceUsage`. Validate nonnegative safe integers, TTL consistency, context/output ceilings, served model/tier/geography/speed, and optional thinking detail ≤ output. A missing TTL split with nonzero creation cannot be priced as a known cheap write; hold the maximum permitted write charge or refuse exact settlement. Cache-hit tokens still consume the token envelope. Conservatively reserve all possible input at the highest admitted input-category price, including writes, plus capped output. Preserve signed thinking/redacted blocks and native tool continuations opaquely; never rewrite cognition to fit a text-only codec.

[Pricing](https://platform.claude.com/docs/en/about-claude/pricing) identifies independent modifiers: US-only geography **1.1×**, Opus 5.5 fast mode **8/40** input/output before cache modifiers, Batch **50%**, and hosted-tool charges. [Service tiers](https://platform.claude.com/docs/en/api/service-tiers) makes priority account-contract dependent; no universal priority quote is assumed here. Narrow first-party synchronous global standard-speed transport can be fully specified without those dimensions. Preserve/refuse unsupported priced features explicitly; a refused required native feature means the best-system cell remains unavailable, not that the feature may be removed unnoticed. Subscription/OAuth, Bedrock, Foundry, private discounts and unknown priority terms need separate transport/price contracts and are outside the proposed first implementation.

## Cost quotes and admission mismatch

Protocol ceilings remain **64 physical requests, 120,000 input + 24,000 output tokens, 15 minutes per execution**, including children/retries/review. They are proposals, not an issued grant. For N executions and no separately billed tools:

```text
uncached quote = N*(120000*pInput + 24000*pOutput)/1,000,000
cache-aware upper quote = N*(120000*max(pU,pW5,pW1,pR) + 24000*pOutput)/1,000,000
```

| Proposed ordinary USD prices | Uncached quote/execution | Upper quote/execution with admitted 1h writes | 75-execution upper quote |
|---|---:|---:|---:|
| Mistral Medium 3.5 standard | $0.36 | $0.36; no extra cache-write premium asserted | $27.00 |
| Claude Opus 5.5 standard/global | $0.96 | $1.44 | $108.00 |
| Claude Fable 5.1 standard/global | $2.40 | $3.60 | $270.00 |

These are arithmetic list-price bounds conditional on enforcing all token categories inside the stated totals. They exclude separately billed features, tax or unknown account terms and establish no purchase permission. Cache hits may lower actual charges; use observed category receipts. A 75-execution comparator-only pilot is calibration, never parity. Candidate qualification has its own finite case count. The pending $25/$100 decision is not resolved by these quotes.

**The native observer cannot currently execute these quotes under 144k.** `observer.ts:152–154` reserves `C + Ocap` tokens and `C*pInput + Ocap*pOutput` money per attempt. `C` is the host-attested maximum billable input, not measured current prompt size. Existing Claude fixture C=200,000 and Ocap=20 means **200,020** per request; the two-request fixture grants **400,040**. Even one such attempt exceeds 144,000. For honest 1M input and a 24k output cap, the initial reservation is **1,024,000**; with public 128K maximum output it is **1,128,000**. Prior settled usage and outstanding concurrent reservations must also fit the grant. Cache-write-aware money reservation would further increase the current ordinary-input reservation.

Public model context is not an entitlement to call a smaller input ceiling a provider contract. This report does not change the protocol, enlarge a grant, invent a 120k provider input maximum, or discard native context/reasoning. Two truthful future paths are: (a) separately preregister and authorize an execution envelope large enough for the current full-contract reservations, with recomputed costs and fairness evidence; or (b) implement and independently qualify a tighter pre-dispatch input bound that includes native framing, provider-added tools/context and all charged input, while retaining the real model context. No universal safe byte/token estimate for that native boundary was established here. Authenticated token-count preflight would itself need an explicit authorization/accounting contract and cannot silently be added as a free request. Until one path is qualified, native dispatch remains unavailable even with credentials.

The candidate's `broker-shell.ts` instead reserves **UTF-8 payload bytes + 1,024 + output cap** per request. A 256k configured context does not itself cause a 256k reservation. Its actual captured prompt and remaining grant determine admission. That heuristic is existing engineering evidence, not a newly proven provider tokenizer guarantee; live prompt/tool framing and observed usage still require qualification. Configured request count/output caps and aggregate resources must fit as a complete profile. A 24k per-request cap does not independently enforce a 24k whole-execution output total; aggregate host reservations do that. A lower cap can truncate thinking/tool work and must be recorded as a resource confounder, not presented as unrestricted native capability.

## Next finite engineering goal and entry gates

**Ready offline now, after root assigns ownership:**

```text
/goal Implement a separately declared first-party Anthropic Messages baseline transport and host accounting profile for the installed native Claude boundary, preserving adaptive/signed thinking and native cache controls; add exact cache TTL/input/output category receipts, conservative category-aware reservations and monotonic multi-delta streaming settlement, retain cancellation/unknown-usage/no-replay invariants, and fixture-verify all paths without native execution or authenticated/provider requests. Keep the existing synthetic profile unchanged. Persist source/evidence and an explicit readiness refusal for a 144k grant with a 200k/1M input reservation. Do not claim best-system or live qualification.
```

Concrete writable code would be the baseline observer/profile, a separate Messages codec/transport, native-wrapper declaration and focused fixture tests; root must reserve those paths and route any shared contract change to its owner. Acceptance: uncached/5m/1h/read mixed receipts, thinking output subsets, multiple cumulative deltas, legitimate truncation, malformed/truncated usage, model/tier/geography mismatch, unsupported hosted costs, cancellation/unknown outcomes, oversubscribed/concurrent reservation refusal, and durable no replay. Tests must assert host accounting and refusal effects, not merely serialization. Exporting a callable transport does not dispatch it: execution still needs a separately issued grant, selected authentication route and pinned profile. Account choice determines which route can eventually be activated, not whether this first-party implementation can be built.

Then separately qualify required native tool/subagent/concurrency/recovery behavior and Claude kernel limits under synthetic evidence. Do not infer that the current Bash-only/single-flight bridge proves those affordances. Mistral qualification preparation can likewise freeze the proposed high-effort profile and finite case manifest offline. Actual Mistral prompt control, tools, compaction, usage/cost, latency and competence remain empirical checks.

**External entry gates, unchanged:** authorized account/authentication route and model entitlement; explicit money/request/token/time grant compatible with reservations; pinned native/candidate configuration and manifests; kernel/resource and observer qualification; sealed independently reviewed calibration/tasks. Paid calls, credentials, installed configuration, native reruns, broad tests, production deployment and push were excluded from this inquiry. H1 remains unaccepted.

## Validation and handoff

Read-only source inspection and official public browsing completed. Public Mistral HTML snapshots and SHA256/retrieval metadata are outside Git at `/home/palimpsest/migration/aeon-1-20261011/live-profile-readiness-sourcecache/manifest.json`; successful snapshots include model, pricing, reasoning and tier pages. Raw direct Anthropic fetches returned 403; the official pages above were successfully read through the web tool. No failed direct fetch is called a retained snapshot. URL-only errors for guessed page paths were superseded by the exact resolved official URLs above.

Document validation checks local references, arithmetic, source-bound assertions and the one-file diff. No runtime tests are warranted for this documentation-only inquiry and none were run. Parent must review/integrate this report after aggregate completion; finite report completion leaves all listed implementation/access/qualification gates open. Exact commit is supplied in the task handoff.
