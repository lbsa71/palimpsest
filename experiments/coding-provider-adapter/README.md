# P17.1 direct-adapter typed boundary experiment

Status: specification followed by a typed fixture implementation, 2026-10-09. Forty-one fixtures and the strict source TypeScript check pass. This experiment compares the wrapper burden of a direct Mistral protocol adapter with the existing core spike. It does not select a production dependency or implement durable coding/release operations.

Problem: AI SDK notification callbacks such as `onStepStart` do not reliably veto dispatch. A host must veto each request before dispatch, bound bytes while receiving, preserve honest usage and intercept raw tool intents before any effect. Determine whether the direct adapter plus a small typed facade provides a useful maintained boundary.

Expected behavior: one fixed chat model, text-only messages and one fixed data-only function definition. Host preauthorization and transport reservation must succeed before network. Exact UTF-8 outgoing bytes are capped before transport; incoming chunks are capped/cancelled before whole-body JSON parsing. A host deadline/abort settles the call and reaches transport/reader even if a fixture ignores cancellation. No retry, execute callback, asset fetch, model discovery, provider-managed tool or automatic loop exists in the facade.

Acceptance: establish red fixtures first; verify both authorization vetoes, byte boundaries with multibyte text/multiple chunks, reader cancellation, early input/schema rejection, unknown/invalid tool rejection, exact raw argument strings, ordered unique IDs across supplied history and response, typed validated continuation including host-owned failure results, known valid usage, malformed/partial/error usage unknown, sanitized errors and no replay after timeout/transport error. Advertise a trusted output-token ceiling; require a complete nonempty stop or consistent tool-call finish. Inconsistent total/cache metadata leaves spent usage unknown; coherent reported counts remain known if later intent/finish validation fails. Frozen mocked fetch only; no actual credentials or provider calls. Pin @ai-sdk/mistral 4.0.62, @ai-sdk/provider 4.0.26 and Zod 4.6.5; disable lifecycle scripts. Record footprint and actual local TypeScript check.

Non-goals: live provider validation, durable journals, coding effects, tool authorization implementation, confinement, publication, streaming recommendation, fork/adoption decision or root package changes. Runtime hook functions are trusted fixture dependencies; no model input can supply them. Dependencies: current direct SDK protocol, Node24 runtime and root's pinned development TypeScript7/@typesNode24 toolchain. Material risks: promise cancellation does not undo an uncertain request; malformed provider replies do not justify fabricated zero usage; SDK parse errors embed private fields; SDK updates alter protocol types; data validation does not authorize an effect.

Repeat inside this directory:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run check
npm run inventory
```

The check uses `../../node_modules/typescript/bin/tsc` and `../../node_modules/@types` from the root development toolchain; it does not install another compiler. Node's built-in TypeScript stripping runs the synthetic tests. If the root toolchain is absent, prepare the pinned root development dependencies separately; this experiment does not install them for you.

## Measured results

Fresh `npm ci --ignore-scripts --no-audit --no-fund` installed nine packages. `npm test` passed 41 checks on Node24.13.0/macOS arm64. `npm run check` passed using TypeScript7.0.2 and @types/node24.19.1, with strict, exact optional properties and unchecked-index checks. Dependency declaration checking uses `skipLibCheck`; this is source/interface compatibility evidence rather than validation of every upstream declaration. No root application check or real-provider compatibility pass is claimed.

The first two veto fixtures failed against the placeholder before implementation; the complete initial 22-check behavioral suite also failed against it. A later fixture reproduced a late-response resource leak (cancel count0 instead of1) before the cleanup fix. Both that regression and delayed-authorization prevention now pass. Eleven additional completion/token-ceiling/usage consistency cases were red before the corresponding repair. The clarified unknown-usage contract then reproduced five inconsistent-count failures before accounting was moved after validation. Reviewer-found timer-range and historical-ID collision defects each received a red reproduction before repair. The [original core spike](../coding-provider/README.md) preserves its original eighteen observations and adds a nineteenth: throwing `onStepStart` still sends the request. Published `ai/src/util/notify.ts` deliberately catches those notification callback errors; the facade awaits its own gates instead.

The facade tests exercise the following outcomes:

- Either host authorization gate throws: no transport call, no raw error in the result. Reservation sees the serialized request byte count and SHA-256, with a signal; it receives no raw prompt or credential.
- Known good provider result: exact raw argument string, fixed advertised function schema, multiple IDs/order and measured usage. Unknown/duplicate functions, IDs colliding with supplied completed history, malformed JSON and invalid semantic arguments fail without executing anything; already measured coherent usage remains known.
- Continuation: explicitly validated assistant intents and ordered host-owned success/failure results form the next independent request, which also advertises the same function. Orphan, incomplete and mismatched results are rejected by the facade's prompt builder; durable effect-result provenance is not established by this fixture.
- Outgoing multibyte text exceeds the UTF-8 byte cap: fail before reservation/network. Response chunks exceed the cap: stop after crossing it and cancel the reader before JSON parsing. Oversized declared content length is cancelled without reading. Defaults are trusted fixture settings of32KiB request/64KiB response/2000ms deadline, not proposed production configuration.
- HTTP/transport/partial-body failure: one attempt, no replay, private synthetic message/body/header/cause fields absent from the returned diagnostic. After dispatch, the result conservatively says `uncertain`; this is not a claim every503 had an externally successful effect.
- Abort/deadline: the transport signal is aborted, the pending reader is cancelled, and promise settlement does not depend on a transport honoring abort. A late response is cancelled; delayed authorization completion cannot dispatch. Trusted deadlines exceeding Node's supported2^31-1ms timer range are rejected instead of silently becoming1ms. A deadline requests cancellation, not proof that the remote request or billing was undone.
- Usage: known means **validated coherent reported counts**, not independently confirmed billing. Safe nonnegative integer counts explicitly present in provider raw usage remain known only after total/cache consistency succeeds, including actual zero. Missing entire usage, empty/partial usage, negative/fractional/unsafe integers, invalid JSON, interrupted bodies, inconsistent total versus input+output, invalid cache counts or disagreement between supplied raw cache fields fail with unknown spent usage. No missing count is fabricated as zero; inconsistent raw numbers are not exported as known. Coherent reported usage survives later intent/finish rejection. Optional absent/null cache statistics remain unknown; the facade neither derives no-cache totals nor exports cache/reasoning/audio/request-count aggregates.
- Completion: the trusted default512 output-token ceiling (and fixture override96) reaches `max_tokens`. Success exposes only supported stop/tool-calls finish reasons, with nonempty stop text or at least one validated tool call. Length, unknown reasons and contradictory finish/content fail while retaining measured usage; truncation is not treated as complete output.

## Dependency identity and footprint

[package-lock.json](package-lock.json) pins all inputs/integrities. [inventory.json](inventory.json) records installed logical bytes/files, package licenses/engines/lifecycle declarations, source hashes/line counts and development toolchain versions. `npm run inventory` recalculates the record. All nine versions match the shared closure measured in the original spike:

| Package | Version | Declared license |
| --- | --- | --- |
| @ai-sdk/mistral | 4.0.62 | Apache-2.0 |
| @ai-sdk/provider | 4.0.26 | Apache-2.0 |
| @ai-sdk/provider-utils | 5.0.58 | Apache-2.0 |
| @standard-schema/spec | 1.1.0 | MIT |
| @workflow/serde | 4.1.0 | Apache-2.0 |
| eventsource-parser | 3.1.1 | MIT |
| json-schema | 0.4.0 | AFL-2.1 OR BSD-3-Clause |
| undici | 7.30.0 | MIT |
| zod | 4.6.5 | MIT |

Actual adapter-only installation: **10,467,348 logical bytes /1,573 files**. The original core+adapter installation is19,606,831 bytes /2,373 files. Thus omitting `ai`, gateway and OIDC saves9,139,483 bytes /800 files with these pins. This is now a separately installed measurement, not only a graph calculation. It measures neither bundle size nor runtime memory/performance. Undici declares a prepare script; lifecycle scripts were disabled. License declarations are evidence to retain, not completed redistribution review.

## Typed wrapper burden and provisional comparison

[facade.ts](facade.ts) is219 physical lines /13,353 bytes at this receipt; it contains the typed fixture input/result contracts, strict Zod schemas, fixed tool definition, transcript builder, usage/finish projections, two authorization gates, bounded transport/read, cancellation and sanitized failures. Its41-test fixture file is299 lines. These counts indicate the implemented surface, not a maintenance-cost or security score.

| Concern | Direct adapter facade | Core spike |
| --- | --- | --- |
| Provider wire protocol | Reused pinned adapter; direct `LanguageModelV4` types | Same adapter, with core adaptation |
| Raw tool arguments | Direct string preserved, then separately validated; no effect API | Parsed call/input; raw capture must be enabled/retained separately |
| Tool schema validation | Explicit strict Zod validation and typed fixed tool schema owned here | Core validates if provided a validator; plain JSON schema alone did not |
| Prompt/transcript adaptation | Typed host builder owns pairing/order/normalization | Core supplies transcript normalization and response messages |
| Retry/loop/execute surfaces | No core retries/loops/callback execution API present | Must fix maxRetries0, one step, data-only tools, no execute/input/repair hooks |
| Veto, bytes, sanitized errors | Implemented trusted host transport gates | Same host wrapper duties remain; `onStepStart` cannot veto |
| Durable budgets/recovery/authority | Not implemented by this facade | Not supplied by core notifications/transcripts either |

The direct adapter has a material installed-footprint and exposed-control-surface advantage for the narrow one-step protocol. Core provides real normalization/schema/transcript/version-adaptation work that this219-line facade partially replaces; it may be more valuable with richer provider/prompt needs. The comparison has **not** implemented an equivalent fully typed core facade or measured maintenance latency. Treat source counts and passing narrow fixtures as measured evidence, not proof that the direct approach is always smaller or safer.

Recommendation to the lead/reviewer: the direct adapter is a credible provisional one-step boundary for the fixed text/function lane, provided the production host implements the same veto/bounds/projection contracts and actual durable budget/effect recovery. Retain core as an alternative where its adaptation savings justify its extra surface. The experiment itself does not decide adoption, justify a fork, or require Pi comparison.

## Usage contract provenance and remaining limits

Current primary [Mistral OpenAPI](https://docs.mistral.ai/openapi.yaml) SHA-256 `fa73befe1c61e1bf4847c532e6375612ae5c7a4a83f96db4a1087ee0115db8b7` explicitly requires prompt/completion/total integer counts in `components.schemas.UsageInfo`; default0 does not remove those required fields. The [official generated client](https://github.com/mistralai/client-ts/blob/main/src/models/components/usageinfo.ts) instead tolerates omitted counts and supplies defaults, while [API documentation](https://docs.mistral.ai/api/endpoint/chat) includes a usage{} example. Those primary artifacts conflict in strictness. Empty/partial counts are therefore **client-tolerated, with provenance conflict**, not established valid wire successes under an unambiguous contract. The pinned adapter rejects them; this facade preserves unknown spent usage and documents that compatibility limitation. It does not relax the adapter or transform omitted counts into measurements. Missing the entire nonstream usage object remains distinct and is rejected under the documented required-object contract.

Exact pinned sources remain available after repeat installation: Mistral `src/mistral-chat-language-model.ts`, `mistral-provider.ts`, `convert-mistral-usage.ts`, `convert-to-mistral-chat-messages.ts`; provider `LanguageModelV4` types; provider-utils `response-handler.ts` and `read-response-with-size-limit.ts`. The upstream [Mistral adapter documentation](https://ai-sdk.dev/providers/ai-sdk-providers/mistral) describes explicit fetch interception. The facade pre-buffers only the bounded nonstream body before the SDK parses it; this bounds its own retained body, not all memory the trusted transport may allocate for a single chunk. No streaming adaptation is added here.

Remaining production work includes durable reservations and uncertain outcome recovery, exact effect provenance, scope/peer/credential routing, actual provider conformance, context/tool counts and raw-evidence retention policy, richer finish/provider-usage statistics, component admission/rescue, static/dependency/license review and wider tool/provider types. The path schema only validates a string; it grants no filesystem read or path confinement. Existing outcome messages must come from the trusted host; accepting their shape is not proof of origin. Late/hung trusted hook or transport work can continue internally after cancellation even though no facade replay occurs; production cleanup cannot be inferred from a remote AbortSignal. No actual model call, credential read, live installation, commit, push or production-source/package edit occurred.
