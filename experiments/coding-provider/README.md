# P17.1: pinned coding-provider compatibility experiment

Status: fixture assessment recorded, 2026-10-09. Nineteen observational checks pass (the original eighteen plus the lifecycle-hook negative control); the broader missing-usage acceptance probe remains red. This is a disposable dependency assessment; no production dependency or deployment is selected.

The problem is whether reusable model/tool protocol plumbing can expose a single model response before host-owned effects, without retrying an uncertain transport or automatically executing a tool. Evaluate AI SDK core with its direct Mistral adapter first, against the [strategy](../../docs/coding-autonomy.md) and [ADR 0019](../../docs/adr/0019-coding-autonomy-and-reusable-agent-plumbing.md). The application must retain authorization, reservations, durable model/tool records, recovery and workspace confinement.

Expected behavior and acceptance: a mocked Mistral tool-call response yields raw intents without tool effects; one model step sends one request; maxRetries=0 sends one request on transient errors; abort reaches transport; known usage is preserved and absent usage stays unknown; the next independently invoked step accepts a prior tool result. Negative controls test accidental execute callbacks, malformed tool arguments and unsupported recovery assumptions. Inspect request/response byte limits, sensitive error fields and interception seams rather than treating passing protocol tests as release readiness.

Non-goals: real Mistral calls, real credentials, live package installation, source editing tools, command execution, durable application state, automatic tool loops, library selection or Pi comparison without an observed material reason. Registry downloads occur only to populate this nested experiment with lifecycle scripts disabled. All provider fetches are deterministic fixtures.

Provisional exact pins queried from the registry on 2026-10-09: ai 7.0.136, @ai-sdk/mistral 4.0.62, and its required Zod peer 4.6.5. Installed versions, dependency footprint, licenses, measured results and limitations are recorded below and in the repeatable inventory.

Repeat from this directory:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run inventory
```

Only this directory's package.json and package-lock.json describe the spike. Nested node_modules is ignored. Root application dependency declarations, state, provider configuration and production source are unchanged.

Run `npm run probe:unknown-usage` separately. Its expected exit status is **1**, with a sanitized explanation. It preserves the original broader criterion as historical evidence rather than pretending the observational suite proves it. The initial seven-check run was red: six passed and the missing nonstream usage assertion failed with an invalid-response error. The suite now explicitly tests that rejection. After primary-contract classification, that malformed nonstream fixture is not a perpetual requirement that an adapter must accept invalid wire data.

## Recorded environment and footprint

Verification used Node v24.13.0 on macOS arm64. A fresh `npm ci --ignore-scripts --no-audit --no-fund` installed 12 packages successfully. `.npmrc` also disables lifecycle scripts; installation did not run them. The lock pins the entire graph and integrity values. [inventory.json](inventory.json) records measured logical file bytes, file counts, engines, lifecycle declarations and lock SHA-256; `npm run inventory` recalculates it. This is installed-file size, including source/maps/docs, not bundle size, runtime heap, peak memory, download size or comparative latency.

| Package | Exact version | Declared license | Installed bytes |
| --- | --- | --- | ---: |
| ai | 7.0.136 | Apache-2.0 | 8,143,517 |
| @ai-sdk/mistral | 4.0.62 | Apache-2.0 | 368,109 |
| @ai-sdk/provider | 4.0.26 | Apache-2.0 | 721,131 |
| @ai-sdk/provider-utils | 5.0.58 | Apache-2.0 | 1,402,875 |
| @ai-sdk/gateway | 4.0.110 | Apache-2.0 | 891,241 |
| @vercel/oidc | 3.2.0 | Apache-2.0 | 104,725 |
| @workflow/serde | 4.1.0 | Apache-2.0 | 3,735 |
| @standard-schema/spec | 1.1.0 | MIT | 22,634 |
| eventsource-parser | 3.1.1 | MIT | 123,553 |
| json-schema | 0.4.0 | AFL-2.1 OR BSD-3-Clause | 26,079 |
| undici | 7.30.0 | MIT | 1,658,921 |
| zod | 4.6.5 | MIT | 6,140,311 |

Total: **19,606,831 bytes, 2,373 files**. AI SDK and Mistral require Node >=22; the experiment deliberately uses the application's Node 24 baseline. Undici declares a `prepare` script; the install was lifecycle-disabled. Licenses above are package declarations, not a completed redistribution/legal assessment.

The flat lock's transitive direct-Mistral dependency/peer closure contains nine packages and **10,467,348 bytes**. It excludes `ai`, gateway and OIDC, saving 9,139,483 installed bytes. This is a calculation over this same pinned graph, not a separately installed or bundled measurement. Core imports gateway support even for a direct model object; the fixtures block global fetch before module import and confirm only the injected direct chat endpoint receives requests. That does not prove every unused SDK feature has no network path.

## Observed compatibility

| Contract | Evidence / limit |
| --- | --- |
| Intent before effects | Tools without `execute` yield calls and no results/effects in one request. A synthetic negative control proves attaching `execute` still causes an effect with a one-step stop condition. |
| One transport attempt | `maxRetries: 0` gives exactly one attempt for HTTP 503 and thrown transport failure. Direct `doGenerate` also sends one request on 503. |
| Cancellation | The pending injected fetch observes AbortSignal cancellation; the core rejects and does not retry. Real network disconnect/billing behavior is untested. |
| Known usage | Core preserves totals and raw extra provider fields; direct adapter preserves structured totals/raw usage. |
| Unknown usage | Streaming completion without usage retains undefined totals. Nonstream absence is rejected; no fabricated zero. See classification below. |
| Continuation | Independently invoked second calls accept serialized core transcript + host result, and direct-adapter normalized intent + host result. No SDK effect replay is involved. |
| Raw intent | Direct `doGenerate` exposes exact malformed argument strings; core can retain exact argument text in `include.responseBody`, while parsed tool input/transcripts normalize it. Raw capture is sensitive data. |
| Input validation | Core marks malformed JSON invalid. Plain `jsonSchema` without a validator accepts semantically wrong input; strict Zod schema rejects it. Host authorization and semantic validation remain required. |
| Byte bounds | Core accepts synthetic 2 MiB request and response. No tested application-sized bound exists in this configuration. |
| Diagnostics | A 503 error retains synthetic private prompt, message, response body and headers. Default success-body exclusion does not sanitize exceptions. The tested allowlist projection is illustrative only. |

Primary Mistral [chat response documentation](https://docs.mistral.ai/api/endpoint/chat) marks nonstream `usage` required, and its [official response type](https://github.com/mistralai/client-ts/blob/main/src/models/components/chatcompletionresponse.ts) agrees. Therefore the missing-usage fixture is malformed under that documented success contract. Adapter rejection is **not** proof of incompatibility with a valid documented Mistral nonstream success. The broader provider-neutral requirement to represent successful unknown usage remains unmet through this nonstream adapter path. Failure usage must separately remain unknown when the provider response is rejected or incomplete; the experiment does not implement durable failure accounting.

Mistral's [generated UsageInfo schema](https://github.com/mistralai/client-ts/blob/main/src/models/components/usageinfo.ts) defaults missing token fields to zero; its documentation includes an empty usage example. However, the primary [OpenAPI](https://docs.mistral.ai/openapi.yaml) SHA-256 `fa73befe1c61e1bf4847c532e6375612ae5c7a4a83f96db4a1087ee0115db8b7` requires all three integer counts. Empty/partial counts are client-tolerated with a primary-source strictness conflict, not unequivocally valid wire successes. The pinned adapter requires numeric fields and rejects empty/partial objects. This difference is not evidence of live server behavior and is not a reason to invent measured zero or relax malformed-response checks. Streaming absent-usage preservation is a useful tested seam, not a production streaming recommendation; interruption and partial-output accounting still require host design.

## Boundary assessment and recommendation for review

The narrower direct-adapter `doGenerate` boundary is worth evaluating next: it already exposes raw calls, request/response/usage and cancellation without core's tool execution, schema repair, loop, retry and gateway surfaces. Host code must then own conversion/validation of raw call arguments, transcript construction, finish/usage projections and provider-version compatibility. The direct continuation fixture makes one subtle contract explicit: raw argument **strings** must be validated/parsed before returning them as prompt `input`, otherwise serialization can encode the string again. That fixture proves serialization; it does not advertise tools in its continuation request. Core provides meaningful normalization/schema/transcript/version-adaptation work; durable authority, effect identity and recovery remain host duties with either choice. The separate [typed adapter experiment](../coding-provider-adapter/README.md) assesses the missing advertised-tool and wrapper behavior.

Core `generateText` adds useful transcript normalization, typed invalid-call handling, schema validation when supplied, lifecycle callbacks and stream aggregation. Using it requires a fixed direct model object, `maxRetries: 0`, one-step stop, no `execute`, no input callbacks, no repair callbacks or autonomous SDK loop, validated schemas and careful projection of returned data. The new negative control proves a throwing `onStepStart` **does not veto dispatch**: `ai/src/util/notify.ts` swallows notification callback errors. These notification callbacks must not be authorization or reservation gates. The injected transport must separately await trusted authorization/reservation before dispatch. Neither notification nor transport callback supplies durable recovery after restart.

Both boundaries need a custom **host-owned** transport wrapper: cap exact outgoing UTF-8 request bytes before dispatch; allow only configured endpoint/model/headers; cap response bytes incrementally while receiving, before whole-body parsing; cap partial JSON/tool arguments and total stream output; enforce deadlines/abort; sanitize all exceptions into allowlisted metadata; retain bounded sensitive raw evidence outside Git; reserve before network and never refund/replay an uncertain dispatch. The pinned `provider-utils/src/read-response-with-size-limit.ts` defaults whole JSON reads to **2 GiB**, and `response-handler.ts` uses it without a Mistral-specific limit. These library safeguards do not satisfy Palimpsest's smaller budgets. Streaming completeness, partial errors and interrupted usage need separate tests before selection.

Source inspection also identifies asset download behavior in core prompt conversion and provider-supported URL forwarding. A text-only coding host must restrict file/URL message parts and provider-managed tool types before invoking the SDK; the direct chat fixture does not authorize provider web search, remote assets or a Conversations API. No credential/environment discovery should be delegated: supply only the host's explicit key and fixed configuration.

Recommendation: keep AI SDK/Mistral **provisional**, carry the concrete bounds/sanitization/accounting tasks into P17.1 acceptance, and compare the narrower direct-adapter boundary against the benefits of core before adding production dependencies. No material necessity for a Pi experiment has yet been established: the one red probe concerns a malformed nonstream success contract, and host-owned bounds/recovery are mandatory with either option. No production library, API surface or release path is selected here.

## Evidence and verification gaps

Official documentation consulted on 2026-10-09: [Mistral adapter](https://ai-sdk.dev/providers/ai-sdk-providers/mistral), [generateText](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text), [tool calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling), plus the Mistral primary sources above. Exact implementation evidence is reproducible from the pinned packages: `@ai-sdk/mistral/src/mistral-chat-language-model.ts`, `mistral-provider.ts`, `convert-mistral-usage.ts`, `convert-to-mistral-chat-messages.ts`; `@ai-sdk/provider-utils/src/schema.ts`, `response-handler.ts`, `read-response-with-size-limit.ts`; `ai/src/generate-text/generate-text.ts` and prompt conversion. Main-branch upstream documentation is temporal; the lock/inventory preserve this experiment's exact local dependency identity.

The 19 passing tests are deterministic protocol fixtures, not actual Mistral compatibility, model quality, availability, billing, durable crash recovery, confinement, release acceptance or independent security review. The original 18-check review remains historical evidence; the nineteenth exposes notification-veto failure. The historical acceptance probe deliberately exits1. Missing the entire required nonstream usage object is distinct from client-tolerated empty/partial counts with the strictness conflict above. The pinned adapter rejects all those cases; the new facade records that limitation and rejects unsafe negative/fractional counts accepted by the adapter. No real model call, credential read, production installation, live state change, commit or push was performed. No root typecheck is claimed: the experiment is plain JavaScript and changes no application TypeScript.
