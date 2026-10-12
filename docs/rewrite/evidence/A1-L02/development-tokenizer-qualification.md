# Development tokenizer prerequisite dossier

2026-10-12. A1-L02 DB2-Q public inquiry, owner `/root`, claim `58c0554`, under the active Aeon 1 goal. **Finite public-source inquiry complete; exact hosted token counting remains unqualified.** No tokenizer, package, model asset or new runtime was installed. This document does not adopt the older DB0 capacity figures or authorize inference. The candidate profile in [live-profile readiness](../A1-L08/live-profile-readiness.md) is still a proposal.

```text
/goal Identify the exact public tokenizer, request framing and prompt-control prerequisites for the proposed Mistral development profile, assess reuse versus a local implementation, and return an actionable qualification dossier with every unsupported relationship explicit.
```

## Established facts and inspected identities

The official API model page identifies `mistral-medium-3-5`, v26.04, with a marketed 256k context. The published weights are `mistralai/Mistral-Medium-3.5-128B`; its current configuration declares `max_position_embeddings: 262144`. This latter field describes the published model configuration, and does not alone establish the hosted API's exact accepted context limit or serving preprocessing. [API model](https://docs.mistral.ai/models/mistral-medium-3-5-26-04), [published configuration](https://huggingface.co/mistralai/Mistral-Medium-3.5-128B/blob/main/config.json).

| Artifact / source | Observed public identity | Qualification limit |
|---|---|---|
| Native tokenizer asset | `tekken.json`, advertised 16.3 MB; publisher-listed SHA256 `b1272b956bd6edd2d2c674c76896c7661308c9e723997b0afb55ecb429cb5dc7`; file change `32f566da413d9fde169ee1276a7551f4a2d660fb` | The listing was read; asset bytes were not downloaded or independently hashed. [Asset listing](https://huggingface.co/mistralai/Mistral-Medium-3.5-128B/blob/main/tekken.json). |
| Alternative tokenizer representation | `tokenizer.json`, advertised 17.1 MB, publisher-listed SHA256 `2ba5b3330fd84d5376fcca797cfb3b42eee6241ce23e3271e6fb2a115a8751bd` at `32f566d` | A different representation requires its own backend/template equivalence checks. [Pinned listing](https://huggingface.co/mistralai/Mistral-Medium-3.5-128B/blob/32f566da413d9fde169ee1276a7551f4a2d660fb/tokenizer.json). |
| Published chat template | Current file lists change `22b2b868a15677cfa6061277ed2f653d1349a9ab` | Inspectable normalization/framing, not a certificate of hosted service equivalence. [Template change](https://huggingface.co/mistralai/Mistral-Medium-3.5-128B/commit/22b2b868a15677cfa6061277ed2f653d1349a9ab). |
| Official reference library | Inspected `mistral-common` main declares version `1.12.0`, Apache-2.0, Python `>=3.10,<3.15` | Main is mutable; no accepted source/dependency/build closure has been pinned. Core dependencies include Pydantic, JSON Schema, tiktoken, Pillow, requests and NumPy; omitting optional extras does not eliminate that base closure. [Package definition](https://raw.githubusercontent.com/mistralai/mistral-common/main/pyproject.toml). |

The official library's `encode_chat_completion` validates, normalizes and tokenizes a structured request. Its `from_model` is now a deprecated lookup for older models; new models use explicit files or a revisioned model repository. Counting the HTTP JSON string with a generic text encoder would not implement this path. The truncation feature must remain disabled when measuring the full pre-reduction input. [Tokenizer implementation](https://raw.githubusercontent.com/mistralai/mistral-common/main/src/mistral_common/tokens/tokenizers/mistral.py).

The request interface represents messages, tools, tool choice and reasoning effort. The documented model settings support reasoning effort with tokenizer version 15 or later. The exact asset's version still needs byte inspection; the interface documentation is not evidence that an arbitrary asset is suitable. [Request interface](https://mistralai.github.io/mistral-common/code_reference/mistral_common/protocol/instruct/request/).

## Prompt ownership finding

The published Jinja template supplies a default Mistral/Le Chat assistant identity if the first message is not a system message. It also normalizes consecutive messages and renders tool and reasoning settings. This is an application-visible instruction source that must be audited if that template is reused. [Current template](https://huggingface.co/mistralai/Mistral-Medium-3.5-128B/blob/main/chat_template.jinja).

Local inspection at `58c0554` shows `packages/agent-shell/mistral.ts` serializes owned Pi context directly to Chat Completions JSON; it does not load this template or its default prompt. That observation does not prove the hosted provider inserts no additional instructions. Counter integration must measure the actual accepted instruction path, preserve an explicit owned system message, and reject an unsupported empty/missing-system profile. If a locally used template adds unwanted fallback instructions, retain a source-owned version with an explicit audited replacement; do not silently count a different prompt from the one sent. Provider-side behavior needs a separate documented serving relationship. Model training remains a different boundary.

## Reuse decision for the next finite task

**Prefer the official tokenizer as the initial reference, behind a small host-only adapter.** This is a proposed counter dependency, not a replacement agent shell or an installed dependency.

| Approach | Benefit | Cost / risk | Disposition |
|---|---|---|---|
| Pinned official Python reference with bounded local invocation | Reuses maintained model-specific validation, normalization and tokenization; useful independent oracle | Adds Python and native/transitive dependencies, asset management and cancellation/CPU limits; base package exceeds a text-only tokenizer | First qualification candidate; measure and pin the actual closure before adoption. Human language preference has no weight. |
| Source-owned TypeScript or Rust implementation of only the supported text/tool path | Potentially smaller maintained runtime; editable alongside the Autark | Porting framing, thinking replay, tool normalization and special tokens creates correctness debt; a vocabulary alone is insufficient | Consider only after the official oracle and corpus exist, with independently measured parity and footprint advantage. |
| General inference/server framework around token counting | Reuses broader model-serving machinery | Introduces unneeded server/model/multimodal machinery and more instruction defaults | No demonstrated need at this boundary; retain Pi and the current broker. |

The official repository exposes tokenizer and normalization source and separates several optional features. This makes selective reuse worth investigating, but it does not establish that arbitrary file cherry-picking preserves the complete dependency closure. [Official repository](https://github.com/mistralai/mistral-common).

## Next tasks and non-substitutable evidence

| Task | Ownable result / gate | Routing |
|---|---|---|
| DB2-Q1 source closure | Fetch only accepted public source/assets under a separately claimed bounded task; verify all bytes/hashes/licenses, interpreter/native dependencies and no automatic runtime downloads. Pin exact supported model, normalization, validation mode, reasoning settings and context bound. | L02 author sol/high; build/dependency changes serialized by L09. |
| DB2-Q2 local adapter | Host-only, no-network, finite-input counter with abort/CPU/wall/RSS bounds and exact request digest. No truncation, hidden prompt addition, generic byte-to-token approximation or token count used as provider billing. | L02 author sol/high; source paths claimed before code. |
| DB2-Q3 independent corpus | Unicode/escaping, system framing, empty and missing-system refusal, tool schemas/results/IDs, multi-turn assistant thinking, malformed input, and exact C-1/C/C+1 cases. Test counter timeout/cancellation and changed asset/config/source refusal. | Fresh astra/high reviewer; separate tests. |
| DB2-Q4 serving qualification | Establish the hosted model-to-asset/preprocessing relationship and compare exact unchanged requests with independently retained provider input-usage receipts under an authorized original grant. Any mismatch or unsupported form remains unavailable. | L08 owns protocol and receipts; account/grant permission remains required. |

Local agreement with an oracle and a finite set of hosted usage matches do not prove all serving inputs equivalent. State the accepted formats and exclusions explicitly. DB2 must still prove the full preimage came from actual host inputs, provider responses and tool observations; a perfect tokenizer cannot authenticate a worker-invented transcript. The overflow gate remains input tokens strictly greater than the accepted C, followed by a fitting summary and reduced continuation. A 1,000,000-byte operational singleton and the new plan's whole-attempt capacity still apply; published context size does not demonstrate that an authentic overflow trace fits those budgets.

## Inquiry receipt

Read official Mistral documentation, its GitHub source and publisher-owned Hugging Face pages on 2026-10-12 UTC, plus the local serializer/readiness/boundary design. Exact-commit Hugging Face blob URLs and the GitHub API/tag lookup returned tool access errors; no missing content or immutable library pin was inferred from them. Available template commit and asset listings supply the identities above. No account, private data, inference, package execution, download/install, source change or test was performed for this inquiry. Markdown references and diff formatting are checked as documentation, not runtime evidence. The finite dossier is complete; DB2-Q1–Q4, fresh consequential acceptance, real context-boundary proof and H1 remain open.
