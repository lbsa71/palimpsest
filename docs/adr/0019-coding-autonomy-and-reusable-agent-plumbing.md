# ADR 0019: Iterative coding and autonomy over the whole codebase

- **Status:** Full-codebase autonomy and basic seed coding are explicit user requirements. The direct Mistral adapter boundary is selected for P17 implementation from reviewed fixture evidence; production integration and autonomous coding/release acceptance remain pending.
- **Recorded:** 2026-10-09.
- **Requirements:** R03, R05–R06, R09–R19, R22–R26.
- **Work:** P17, P18; [coding specification](../coding-autonomy.md).
- **Refines:** ADR 0008's framework-free choice, ADR 0010/0015's narrow cognitive admission scope, ADR 0016's operator-only host bootstrap and ADR 0017's two-item executable plan.

## Context

The user found the current seed too limited: a single completion proposes full files under `src/agent/`, without search, ranged reads, partial updates, deletion or an iterative test/repair loop. The user explicitly makes full autonomy over the autark's own codebase the main priority and permits a local fork of a library. The user assigns Astra to strategy and Sol to implementation/testing.

Earlier narrow implementation slices remain valid evidence of what ran. They do not define a permanent limit on the product. Keeping the live evaluator independent of a candidate is compatible with authoring a future evaluator in a separate workspace and admitting it under an older mechanism.

## Decision

Make basic coding a P0 seed capability. Provide a durable mutable workspace and typed tools for search/list/read/create/edit/delete/move/diff and command execution. Run an iterative model/tool conversation with actual test feedback, bounded allocation and recoverable checkpoints. Freeze the final workspace for evaluation instead of requiring the model to serialize every modification as a complete replacement file.

Iteration does not redefine one provider call as an entire coding session. Reserve each model request under the active lane/window policy and an admitted finite session/attempt contract; checkpoint at exhaustion without borrowing other allocations. The current version 1 plan catalog's single-call proposal attempts retain their meaning. P17.3 must explicitly evolve that contract and accounting before multi-round use, without granting additional funding through this ADR.

Authoring can cover the full codebase, including tools, orchestration, memory, providers, dependency sources and local forks. Release admission uses the actual component changes and existing authority. Broaden ordinary application admission; implement autonomous outer-host/dependency release and a distinct autonomous governance/custodian upgrade path. The currently active admission rules cannot authorize their own replacement using newly authored rules. Keep an independently usable older rescue throughout each relevant transaction. Protected components can evolve across transactions; none are permanently human-authored by policy.

Select `@ai-sdk/mistral` **4.0.62**, `@ai-sdk/provider` **4.0.26** and `zod` **4.6.5** for the next P17 implementation slice. Use the adapter's exported `LanguageModelV4.doGenerate` protocol behind a small Palimpsest-owned single-step facade. These are exact initial pins, with transitive inputs recorded in the experiment lockfile. This selects an implementation dependency boundary; it does not install production packages, select a different model, or approve a release.

Keep SDK types behind that facade and retain Palimpsest-owned durable records. The host owns text/function transcript conversion, strict tool-name/argument/result correlation, current authorization and per-request reservations, bounded transport, deadline/late-result handling, usage/finish validation and sanitized failures. It accepts raw tool intents before any effect; durable operation identity and trusted result provenance must survive transcript truncation. Credentials, model, tool definitions and limits come from trusted application configuration, not the experiment's fixed fixture values. Production transport must reject implicit redirects as well as retries: validating only the initial URL or counting mocked fetch invocations does not establish the physical request route.

This deliberately consumes a versioned provider integration protocol, not the consumer-facing AI SDK core API. Palimpsest therefore owns conversion and upgrade compatibility checks. Core `generateText` supplies useful validation, normalization and version adaptation, but its retry/loop/callback surfaces would need restricting and its transport still needs the same host controls. The reviewed narrow facade makes direct use a reasonable initial tradeoff. Keep core, Pi, a local fork or a smaller custom replacement available if future requirements or measured maintenance justify a change; none is required by the current comparison.

Forked dependencies are part of the autark's evolvable source/build inputs. Record upstream identity, license, local changes, reproducible build and evaluation; upstream acceptance is not a prerequisite to using a locally admitted fork. Pin exact inputs and keep a recovery artifact independent of network availability.

## Alternatives and consequences

- **Keep whole-file proposals and cognitive-only admission:** Small and already demonstrated, but cannot meet the explicit seed tooling and full-codebase autonomy requirements. Retain as historical compatibility while replacing the authoring path.
- **Build all provider/tool protocol support custom:** Feasible for a narrow provider contract; increases recurring compatibility/streaming work. Retain only where a library would introduce more complexity than it removes.
- **Use AI SDK core for each step:** Its transcript/schema/version adaptation reduces custom work. The direct adapter is selected for the current text/function scope because the demonstrated facade is bounded and avoids core execution machinery the host does not need. Neither option supplies durable authority or recovery. Installed size supports the choice but does not establish lower lifetime maintenance cost.
- **Adopt a full coding agent unchanged:** Provides more ready-made workflow, but its sessions, discovery, retry behavior and permission model may conflict with durable budgets, scoped context and custody. A fork is valid if its benefits justify owning that larger surface.
- **Replace the live installation directly:** Fails the existing exact-artifact, continuity and recoverable succession requirements. Isolated authoring followed by appropriate admission delivers autonomy without abandoning those contracts.
- **Reserve host/custodian code for humans indefinitely:** Conflicts with the clarified main priority. Operator bootstrap remains a current implementation fact; P18 must replace that limitation with an independently evaluated autonomous route.

This adds real workspace and tool-operation state and broadens release coverage. It should reuse existing task/effect journals, snapshots and custody rather than introduce another competing operational store. A library's defaults are not proof of enforced limits. New coding authority belongs to authorized engineering tasks; peer conversations retain their existing scope and no source-dispatch privilege.

## Acceptance and current evidence

The [specification](../coding-autonomy.md) defines observable tool, retry, interruption, dependency and release contracts. [A22](../acceptance.md#a22--iterative-coding-with-real-workspace-tools), [A23](../acceptance.md#a23--full-codebase-and-fork-evolution) and the full [A17](../acceptance.md#a17--separate-admission-and-custodian-evolution) are completion gates. Rejecting an ordinary governance edit and documenting a disabled upgrade path does not establish autonomous governance evolution.

The [core experiment](../../experiments/coding-provider/README.md) records 19 deterministic observations, including the negative control that an `onStepStart` exception does not veto dispatch. The [typed direct-adapter experiment](../../experiments/coding-provider-adapter/README.md) has 41 passing fixtures; the strategy lead independently reran them and its strict source typecheck and verified the facade, test and lock hashes against the [inventory](../../experiments/coding-provider-adapter/inventory.json). Sol froze these experiment files in commit `a93bd858823b5614b93194094e896f560ceea2f7`. The typecheck uses `skipLibCheck`, so it does not validate every upstream declaration. Independent source/decision review found no selection blocker.

The direct experiment installs nine packages totaling 10,467,348 logical bytes, versus 12 packages and 19,606,831 bytes with core. Its fixture facade is 219 lines/13,353 bytes. These are installed-file and source measurements, not runtime-memory, latency, security or lifetime-maintenance measurements. An equivalent fully typed core facade was not built. Exact licenses and dependency identities remain in the inventories.

The usage-source conflict remains explicit: Mistral's OpenAPI requires individual counts while its generated client tolerates omissions. The selected initial path rejects sparse/invalid usage with unknown spent accounting; it never fabricates measured zero or silently retries. Coherent reported counts remain available when subsequent intent/finish validation fails. This limitation does not currently justify a fork or streaming scope.

P17 must still integrate trusted configuration and the full coding tool set, durable reservations/effects and receiver authority, root dependency/build and isolated-artifact packaging, and actual configured-provider conformance. P18 must demonstrate broader release and fork/governance evolution. Mocked protocol checks and library selection establish none of those runtime or release outcomes.
