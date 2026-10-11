# A1-L02/L08 Mistral broker response-profile binding

2026-10-11. **Implemented and fixture-verified; fresh review and integration remain root-owned.** Owner `/root/a1_anthropic_accounting`; worktree `/home/palimpsest/migration/aeon-1-20261011/mistral-profile-binding`; branch `codex/a1-mistral-profile-binding-20261011`; base `04107e3`. No live qualification, Q3, full L02/L08 or H1 acceptance is claimed.

```text
/goal Reproduce and fix Mistral broker response-profile binding so mismatched model or unsupported served tier is refused before reaching workers, while preserving original unknown charges and no automatic replay; verify focused fixtures and strictcheck, then retain finite evidence.
```

Exclusive writes: `deployment/broker-shell.ts`, new `deployment/mistral-profile-binding.test.ts`, and this report. Existing broker tests, shell payloads, gateway, shared contracts, model grants/configuration, OpenAI handling, availability and central status remain unchanged. Read the active requirements/plan/workflow, L02 and live-profile-readiness report. No dependencies were installed; the worktree links the existing root toolchain. No provider request, credential inspection, messaging, deployment or push occurred.

## Behavioral specification and reproduced defect

Before runtime edits, freeze regressions that assert an exact host-pinned returned model and an explicit served tier of standard; absent tier is supported solely through the declared omitted-request default. Different/missing/nonstring model and explicit priority or malformed/unknown tier must fail before the raw result crosses the worker boundary or receives base-rate settlement. Preserve the returned model/raw digest and original uncertain usage/charge. Consumption before dispatch prevents reusing a reservation; durable reopen, unresolved reconciliation and cancellation cannot erase that charge. No automatic replay is introduced.

Prepatch test commit `e73baf9aa26117a6182c16e9453eb892e93ad86f` ran the actual broker host handler with Node's built-in worker-module mock, without a confined process. **Two valid cases passed; 11 unsupported cases failed** because the response reached the worker as a successful provider reply. Wrong model, priority and null tier each produced status succeeded with prompt 7/completion 2 at synthetic standard cost USD0.000011. These are observed implementation defects, not hypotheses. The raw injected bodies, original receipt/ledger SQLite databases and summaries remain outside the checkout.

External evidence root: `/home/palimpsest/migration/aeon-1-20261011/mistral-profile-binding-evidence/`. `reproduction-pure.log` and `reproduction-summary.json` record the red run. An earlier fixture-authoring diagnostic omitted the required store revision, failed before synthetic dispatch, and is retained in `fixture-diagnostic.log` and its zero-call summary; it is excluded from the defect reproduction.

## Runtime repair and checks

Frozen runtime/check commit **`683068b57f23b0eaf8afa60436fd4e8d6dfd1bf4`** adds the Mistral-only check before token pricing and successful provider reply. A rejected response throws; the existing trusted finally path durably settles status uncertain with null token/cost usage, retaining original reservation charges before the worker sees a generic refusal. It preserves raw response digest, HTTP status and returned model. An optional receipt field records only an explicitly observed service tier, including malformed values. Its absence never fabricates a served-tier observation.

The request allowlist already excludes service_tier; no new request knob, priority accounting, alias fallback, framework or dependency was introduced. OpenAI logic is unchanged.

Pinned Node24 commands:

```sh
node --experimental-test-module-mocks --test deployment/mistral-profile-binding.test.ts
npm run check
```

**13/13 focused pure fixtures pass, zero skips/failures; normal repository strictcheck passes.** Pure tests assert the worker mock was actually invoked. Cases cover observed standard and omitted-tier inference, wrong/missing/nonstring model, and tier values priority/auto/standard_only/empty/null/number/object/array. Assertions cover delivery refusal, raw receipt provenance, original full charge, durable reopen/reconciliation, duplicate reservation and second-fetch refusal, finite-grant exhaustion and cancellation retention. `focused-pure.log` and `check-frozen.log` are retained.

## Root-scheduled actual broker pipe

At unchanged `683068b`, root granted one serialized physical window. Five actual confined worker-pipe cases passed **5/5, zero skips/failures, 0.636 seconds**: observed standard, omitted tier, wrong model, priority and null tier. The window was promptly released. Command:

```sh
AEON_MISTRAL_BINDING_PHYSICAL=1 AEON_MISTRAL_BINDING_EVIDENCE=/home/palimpsest/migration/aeon-1-20261011/mistral-profile-binding-evidence node --test --test-name-pattern='observed standard|omitted tier|different model|unsupported tier "priority"|unsupported tier null' deployment/mistral-profile-binding.test.ts
```

Each case made exactly one injected synthetic transport call. Valid replies reached the worker and settled nine tokens/USD0.000011. Unsupported replies did not reach it as successful results, and retained the original **1,704-token/USD0.002216** reservation with uncertain/null usage. Repeated fetch refused; reopen and unresolved reconciliation preserved the same charges; explicit cancellation retained them. The fixture's original allocation is one request, 100,000 tokens, USD 1, ten seconds and one concurrent request; output cap 512 and provider timeout five seconds. Rates USD 1/2 per million are synthetic fixture rates, not current provider prices. The second-fetch and new-reservation checks exercise this original finite grant, not a universal exactly-once claim.

`physical-frozen.log`, generated worker source, raw response artifacts, original receipts and SQLite state are retained. `manifest-final.json` binds source/toolchain, command/result, five case summaries and evidence-file hashes. Manifest SHA-256: `d0da1c1f4ed7fb48dfc1097f4a18b3769173efadd8e0d63cecde441811c32058`.

## Public contract and limitations

[Mistral Priority Tier documentation](https://docs.mistral.ai/inference/priority-tier), reread through the web tool on 2026-10-11, documents omitted service_tier as standard_only, explicit served usage.service_tier values standard/priority, and a 1.75× priority price multiplier. The broker therefore accepts absent tier as request-default contract inference, not served-tier observation or invoice exactness. Explicit priority is refused rather than priced at standard rates.

Configured base prompt/completion accounting is retained; cache-hit charging may remain conservative and is not an exact cache invoice. This slice does not qualify live tokenizer/framing bounds, every priced provider feature, account entitlement, model competence, broad retry/recovery or autonomous readiness. No full source suite or live request ran. Ordinary test invocation skips this file unless the pure mock flag or explicit physical fixture option is selected; the listed commands are required to reproduce the evidence. Fresh independent review owns final acceptance and root owns central integration/status.
