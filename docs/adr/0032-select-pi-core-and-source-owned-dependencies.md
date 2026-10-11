# ADR 0032: Select Pi's small agent core with locally editable dependencies

- **Status:** selected architecture under the user's delegated decision authority, 2026-10-11. Source-audited; build, integration, configured-model competence and deployment qualification remain open. This is a decision to implement and qualify Pi, not a claim that it already passes those gates.
- **Scope:** A1-L02 shell selection, dependency ownership and initial shell implementation language. A1-L01 still owns application contracts; A1-L09 owns builds, release and recovery.
- **Supersedes:** the open-ended winner selection and mandatory five-candidate bakeoff in the initial [shell decision procedure](../rewrite/agent-shell-decision.md). Retains ADR 0031's prompt, effect and continuity requirements and L08/L09's independent product qualification.
- **Evidence:** [dated source audit](../rewrite/evidence/A1-L02/2026-10-11-source-audit.md), with pinned commits, inspected boundaries and explicit limitations.

## Decision

**Use Pi's lower-level `@earendil-works/pi-agent-core` as the first reasoning/action loop, in a pinned, locally editable source workspace. Use TypeScript/Node for this shell integration.** Keep a deliberately narrow provider/protocol dependency surface. Do not adopt the complete Pi coding application, terminal UI, extension discovery, catalog updater or durable harness as the Autark's architecture.

Our application owns effective instructions, model routing, context policy, durable identity, memory, goals, effect/accounting records, tools and release decisions. The selected loop supplies real model/tool iteration, streaming, queues, cancellation and extension points. Model responses encounter observations and can continue; this choice does not recreate the retired one-shot dispatcher.

The final three contenders are **Pi agent core, Rig's Rust agent/run components, and AI SDK's ToolLoopAgent**. Rig enters the shortlist specifically because the new requirements deserve a modular Rust alternative. Comparing TypeScript libraries only with the entire Codex product would unfairly conflate Rust with a large application.

**Rig is the first fallback** if qualifying Pi reveals a fundamental recovery/interception problem or an excessive fork/build burden. AI SDK is the third option, especially if provider interoperability becomes the dominant cost. Reconsider only on stated evidence; do not repeat a full framework shopping exercise before each implementation step.

## Decision drivers from the user

1. Optimize for code the **Autark** can understand, change and verify. The human does not expect to write the implementation; personal language aesthetics carry no weight.
2. Rust's native output, ownership and compile-time checks are material benefits. They do not prove correct task completion, semantic state transitions or crash-safe external effects. TypeScript's integration reach and smaller edit/build cycle are useful hypotheses, not measured speed claims. Python is not excluded by taste, but no Python dependency is needed by the shortlisted solutions.
3. Dependencies must be ordinary editable source, with a predictable build/test/activation path. No routine upstream acceptance, package-registry publication, manual editing of installed packages, or multi-repository configuration ritual should stand between a useful change and its evaluated successor.
4. Prefer the smallest **sufficient maintained surface**, including our integration code. A small wrapper over a large engine is not necessarily small; deleting useful upstream machinery only to rebuild it poorly is not progress. Unused capabilities have no positive score merely because they exist.
5. Prompt sovereignty, provider choice, physical-request accounting, interruption/recovery and genuine multi-step competence remain hard requirements. Minimalism cannot weaken them.

## SWOT: the three contenders

### 1. Pi agent core — selected

**Strengths.** The inspected core is six TypeScript source files and 2,519 physical lines, before its provider closure. It implements tool-result iteration, validation, streaming, steering/follow-up queues, cancellation and host hooks. A supplied stream function provides a clear model boundary; the ordinary core introduces no default persona when the host supplies none. This is a tractable place to change execution behavior without adopting a coding application's identity. Source is MIT-licensed. [Core source](https://github.com/earendil-works/pi/blob/89e5c2c075535e2f427c30fc74720d65b2944ff9/packages/agent/src/agent-loop.ts), [agent construction](https://github.com/earendil-works/pi/blob/89e5c2c075535e2f427c30fc74720d65b2944ff9/packages/agent/src/agent.ts).

**Weaknesses.** Six files do not describe the entire dependency burden: `pi-ai` declares multiple provider SDK dependencies, even though imports are separated. Core supplies no durable effect ledger, automatic compaction or built-in delegation. Those capabilities must be integrated and tested in our existing lanes. TypeScript needs strict checking and runtime validation; it does not supply Rust's ownership guarantees. The upstream default source build refreshes model data, and its pack helper builds more packages than we need. [Package/build manifests](https://github.com/earendil-works/pi/blob/89e5c2c075535e2f427c30fc74720d65b2944ff9/packages/ai/package.json).

**Opportunities.** Keep the loop and useful provider mappings while making its selected dependency source as editable as application code. Reuse individual tools and recovery lessons from the larger Pi project when they beat an equivalent custom implementation. The separate `pi-durable` package is a possible donor or future alternative, not a hidden required dependency. A narrow owned boundary makes later replacement or a measured Rust implementation possible without replacing lived state. [Durable package](https://github.com/earendil-works/pi/blob/89e5c2c075535e2f427c30fc74720d65b2944ff9/packages/durable/README.md).

**Threats.** Optional provider adapters can inject instructions: the inspected Anthropic OAuth path adds a Claude Code identity, and the Codex Responses adapter has a fallback assistant instruction. Transport retries/fallbacks can exceed logical call accounting. Incomplete crash recovery around a pending tool could duplicate an effect. Aggressive extraction can turn a small fork into a maintenance project. Mitigate through selected API-key transports, final-request capture, transport-level reservations, retained conformance tests and a bounded extraction gate. [Anthropic adapter](https://github.com/earendil-works/pi/blob/89e5c2c075535e2f427c30fc74720d65b2944ff9/packages/ai/src/api/anthropic-messages.ts#L1167), [Codex adapter](https://github.com/earendil-works/pi/blob/89e5c2c075535e2f427c30fc74720d65b2944ff9/packages/ai/src/api/openai-codex-responses.ts#L552).

### 2. Rig agent/run components — strongest alternative

**Strengths.** Rust offers strong structural correctness checks and native deployment. More specifically, Rig exposes a serializable, explicitly stepped `AgentRun`: request a model call, request tools, or finish. The host performs I/O, making resource/effect boundaries natural. `rig-agent`, `rig-core` and transport crates are separate; default features can be disabled. Mistral has a source adapter. This is a credible compact Rust strategy, not a proposal to build an agent framework from scratch. [Run state](https://github.com/0xPlaygrounds/rig/blob/9e7cb6000355b7ae1a89c913bf98b8a6f17661ee/crates/rig-agent/src/run/mod.rs), [minimal stepper](https://github.com/0xPlaygrounds/rig/blob/9e7cb6000355b7ae1a89c913bf98b8a6f17661ee/tests/fixtures/agent_run_stepper/Cargo.toml).

**Weaknesses.** The run primitive lives in a broader agent crate, and core contains provider mappings beyond our initial needs. Per-provider pruning is not simply a feature flag. Cross-version serialized-run compatibility is not guaranteed, so its checkpoint is not a substitute for a canonical durable record. Native dependency changes require rebuilding the relevant binary; warm/cold build costs and the configured model's Rust-editing competence are unmeasured. Rig is MIT-licensed and editable; these are costs to investigate, not reasons to call Rust unusable. [Agent contract](https://github.com/0xPlaygrounds/rig/blob/9e7cb6000355b7ae1a89c913bf98b8a6f17661ee/crates/rig-agent/README.md), [provider modules](https://github.com/0xPlaygrounds/rig/blob/9e7cb6000355b7ae1a89c913bf98b8a6f17661ee/crates/rig-core/src/providers/mod.rs).

**Opportunities.** A minimal Rig workspace with local Cargo path dependencies could combine native correctness gates with an owned host driver and request/effect journal. It becomes attractive if that state-machine boundary saves more recovery code than Pi's hooks, or if measured Rust self-edits converge more reliably. We can borrow its stepping and recovery test design without committing to its entire high-level runtime.

**Threats.** An unanswered step can be reissued; serialization does not make an external tool exactly-once. Rig's default run budget resolves to one model call, and structured-output modes may augment instructions—both need explicit configuration. Major internal API churn or a broad local fork can erode modularity. Compiler success is not a replacement for behavioral and crash tests. [Run defaults](https://github.com/0xPlaygrounds/rig/blob/9e7cb6000355b7ae1a89c913bf98b8a6f17661ee/crates/rig-agent/src/run/spec.rs), [request preparation](https://github.com/0xPlaygrounds/rig/blob/9e7cb6000355b7ae1a89c913bf98b8a6f17661ee/crates/rig-agent/src/run/prepare.rs).

### 3. AI SDK ToolLoopAgent — provider-oriented alternative

**Strengths.** Strong provider abstraction, streaming, typed tool definitions and explicit loop/step controls. The ordinary loop accepts application-owned instructions; the Mistral provider is separate. The code is Apache-2.0 and can be locally forked. Its ecosystem can reduce provider integration work. [Loop reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent), [pinned loop source](https://github.com/vercel/ai/blob/ba05943b69ad070558bb5bc912da99ec66d7d263/packages/ai/src/agent/tool-loop-agent.ts).

**Weaknesses.** The 323-line ToolLoopAgent delegates to substantial `generateText`/`streamText` machinery and is not a separately packaged agent core. Source modification crosses shared build configuration and package boundaries. Durable continuation, developmental state and much execution coordination remain ours. Import tree-shaking does not make dependency source equally easy to evolve. [AI package](https://github.com/vercel/ai/blob/ba05943b69ad070558bb5bc912da99ec66d7d263/packages/ai/package.json), [generation engine](https://github.com/vercel/ai/blob/ba05943b69ad070558bb5bc912da99ec66d7d263/packages/ai/src/generate-text/stream-text.ts).

**Opportunities.** Use the direct Mistral provider or another justified adapter through the owned transport contract if it substantially beats maintaining Pi's mappings. It is a viable replacement loop if its broader ecosystem lowers the total custom code and upgrade effort. Do not stack two full agent loops to obtain one provider adapter.

**Threats.** Default retries, extra generation paths and version changes can evade logical-call counters. Mistral JSON-object mode adds formatting instructions; optional provider prompt settings need an explicit decision. Editing source without rebuilding `dist` does not change the consumed package. Mitigate with pinned local workspace dependencies, transport-level capture/accounting and a demonstrated build/restart path. [Mistral request assembly](https://github.com/vercel/ai/blob/ba05943b69ad070558bb5bc912da99ec66d7d263/packages/mistral/src/mistral-chat-language-model.ts), [retry preparation](https://github.com/vercel/ai/blob/ba05943b69ad070558bb5bc912da99ec66d7d263/packages/ai/src/util/prepare-retries.ts).

## Why Pi wins this decision

The distinguishing question is where the Autark will repeatedly edit its own reasoning machinery. Pi offers the smallest directly inspectable loop of these three while already handling useful interaction mechanics. We already require product-owned durable memory, goals, effect recovery and evaluation; adopting a second broad state architecture has no automatic advantage. Pi therefore offers the best **current engineering fit**, with a modest local-fork boundary to qualify.

Rig has the strongest structural state-machine/correctness argument. It loses this initial choice on the expected total modification and integration surface, not on the user's unfamiliarity or an assumption that Rust cannot support agents. That expectation is an inference from inspected boundaries. We have not measured compile latency, autonomous edit success, task performance or defect rates; evidence reversing that inference triggers the Rig fallback.

AI SDK is attractive for provider integration, but its loop wrapper does not yield as clean a small execution core for repeated source evolution. No benchmark score or invented numerical ranking is used to disguise these judgments.

## Locally editable dependency and build policy

The chosen dependency is **source we own operationally**, while preserving its upstream provenance and license:

- A1-L02 places the selected source closure under its owned `packages/agent-shell/vendor/` subtree (proposed path), with upstream commit, file map, MIT notices, retained tests and local patch rationale. L09 wires ordinary workspace dependencies and the root lockfile. No submodule checkout or separate release registry is required for routine development.
- Retain the agent loop and the required `pi-ai` protocol/utilities/provider path. Initially qualify the carried Mistral model through an explicit API-key transport. Additional provider packages require their own need, prompt audit and accounting evidence. Do not silently install or activate every optional provider, OAuth path, UI, catalog updater or extension loader.
- Remove unused dependency declarations only after validating the actual import/build closure. A1-L02 must demonstrate the reduced closure; the source audit has **not** built it. If this needs extensive redesign, stop the extraction experiment and compare Rig rather than constructing an unbounded private distribution.
- Pin all build inputs. Catalog data must be frozen as an artifact or eliminated from the selected build; a normal dependency edit cannot require a live catalogue-refresh network request. Keep exact dependency selection in one project lockfile and reject unrecorded ambient package discovery.
- Supply one documented project command to build and check the affected closure, and one supervised activation operation. Their internals must be inspectable and finite; hiding a complicated manual procedure behind a wrapper does not meet the requirement. Record cold/warm build time, changed-package rebuild work and required tools before acceptance.
- Autark dependency edits use the same isolated workspace, checks, immutable candidate and successor mechanism as its own code. Build/test before activation; reconstruct a new worker from current canonical state and reconcile pending effects. No in-process import-cache tricks, manual `node_modules` edits or unsafe live patching. No routine new human approval when the necessary authority is already granted.

Rust remains available for a narrowly justified component or a future shell replacement. Do not introduce a second language simply as a compromise; its measurable correctness, deployment or performance benefit must exceed the extra boundary and build cost.

## Qualification gates and fallback

A1-L02 owns the implementation; these are bounded deliverables, not a request for more user preferences:

| Gate | Required result |
|---|---|
| Q1 — extraction/build | Pin the selected closure and build it from a clean workspace; after dependencies/artifacts are provisioned, rebuild without network/catalog refresh. Change one vendored dependency function, run relevant checks, rebuild and verify the new behavior is actually loaded. Measure the workflow, retain original conformance cases and confirm excluded modules/dependencies stay excluded. |
| Q2 — instructions/transport | Capture final requests on ordinary, retry, resume, compaction and delegated paths; replace all unwanted application instructions. Reserve every physical attempt before dispatch. Initial transports avoid unobserved WebSocket retry/fallback paths. Tool wrappers enforce the effect journal; hooks alone are not the enforcement boundary. |
| Q3 — useful execution | Run the frozen twelve-case screen from the shell qualification plan, with real observations and explicit resources. Demonstrate failure → repair → completion, steering, context reduction and bounded delegation. One-call successful chat is insufficient. |
| Q4 — restart/upgrade | Crash around pending model/tool steps, recover uncertain outcomes, and resume without duplicate accepted effects. Replace a dependency in a successor and retain current goals, memories and obligations; rollback retains current history. |
| Q5 — independent decision check | Fresh review examines fork size, build complexity, missing custom machinery and actual outcomes. Accept the Pi integration or record concrete failure and activate the Rig comparison. Full product parity remains L08/L09 work. |

Freeze a finite resource envelope before execution. Attempt one targeted Pi extraction/bridge with at most two bounded implementation sessions under the earlier lane convention; if a hard gate remains unsatisfied, produce the failure evidence and compare the Rig stepper under the same contract. This cap triggers reassessment, not a false claim of completion. AI SDK follows only if the evidence points to provider/engine integration as the better tradeoff. Paid calls use already configured grants; this ADR creates no spending entitlement.

## Other considered systems and evidence limits

Local Codex has a public Rust core API as well as App Server, so it is not disqualified for lack of embeddability or source access. Its inspected core still pulls a broad application dependency graph, and its Responses wire contract does not prove direct Mistral compatibility. Keep it as a product baseline and potential donor of independently useful components. DeepAgentsJS adds orchestration/middleware/state machinery that we do not currently need to adopt wholesale. Claude Agent SDK remains a useful baseline or separately assessed specialist; SDK customization alone does not establish ownership of its entire execution core. None is rejected merely for being capable.

Read-only audits inspected current source and official documentation; no framework was installed, source-built or run against a paid model in this decision task. Native Rust build cost, reduced Pi package buildability, recovery correctness and model competence remain unverified. The old service stays decommissioned. This ADR selects the work to implement next; it does not complete A1-L02 or claim Codex/Claude parity.
