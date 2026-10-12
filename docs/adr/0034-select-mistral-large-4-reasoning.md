# ADR 0034 — Select Mistral Large 4 with high reasoning

Date: 2026-10-12. Status: **accepted model selection; runtime/account/context qualification pending**. Requirements: RW02, RW16, RW17, RW20, RW21. Owners: A1-L02 transport/context, A1-L08 qualification, A1-L09 profile/grant integration. User direction: “Is there a reasoning mistral 4 large? Of so we should use it.”

## Decision

Use first-party Mistral **`mistral-large-4-0`**, `reasoning: true`, `effort: high`, for the Autark's new primary model profile. This supersedes the earlier Medium3.5 selection proposal. The [machine-readable selection](../rewrite/model-selection.json) records the exact choice and unresolved qualification inputs. Do not silently fall back to Medium, another provider, non-reasoning mode or a `latest` alias.

Mistral's reasoning documentation explicitly names `mistral-large-4-0` and supports `reasoning_effort: high`. Its model card uses the family name `mistral-large-4`, advertises1M context and dates public preview to October6,2026. Use the explicit major/minor spelling from the reasoning documentation; actual account model metadata and response identity still need verification before a real run. [Reasoning](https://docs.mistral.ai/studio/conversations/reasoning), [model card](https://docs.mistral.ai/models/mistral-large).

The implementation already forwards configured high effort to Chat Completions and preserves native thinking chunks across ordinary continuations. Keep that existing source-owned transport and Pi core. Selecting Large4 requires an exact new host profile/configuration and evidence, not another agent framework or an SDK dependency. Hosted provider behavior and model training are still outside local prompt ownership.

## Tradeoffs and qualification

Large4 fits the user's quality priority and supports the required reasoning/tool interface. However, it is a public preview: Mistral permits silent updates in that stage even when a major/minor identifier is used. Record the served identity, run date and any available revision; qualify the observed service and repeat relevant checks after a detected change. Do not label the public name an immutable weight hash. [Lifecycle](https://docs.mistral.ai/inference/model-lifecycle).

The advertised1M context is not yet an exact integer/model-to-tokenizer certificate. The publisher's weight repository is currently an upcoming release with an October31 ETA. No Large4 tokenizer asset has been verified in this task. Medium3.5's downloaded v15 asset remains evidence for Medium only and must not be relabelled. A missing exact counter blocks the measured-overflow claim, while ordinary bounded reasoning/tool integration can proceed independently. [Publisher repository](https://huggingface.co/mistralai/Mistral-Large-4-1T-A52B).

On October12 the official price table lists promotional USD/MTok0.68 input,0.07 cached input,2.09 output, with ordinary listed rates1.36/0.14/4.18. These are dated public prices, not an account invoice or spending grant. Reserve against the applicable full rate unless a separately accepted grant binds the promotion and its expiry; retain served tier and unknown usage. Do not copy Medium prices or infer free inference from selecting the model. [Pricing](https://docs.mistral.ai/inference/pricing).

The much larger context also changes boundary evidence requirements. Check whether an authentic pre-reduction input can exceed the accepted C within operational singleton/source/proof limits. If it cannot, specify a new unclaimed bounded profile or report infeasible. Do not quietly shrink C for a claimed1M overflow result, enlarge a consumed plan, or send an oversized provider request just to provoke an error. The [boundary entry inquiry](../rewrite/evidence/A1-L08/development-boundary-composition.md) remains applicable and must use this selected model.

## Implementation and acceptance tasks

1. L02/L09 construct the exact Large4 profile from the selection record, verified account metadata and original grant: context/output/time/request limits, applicable prices and high reasoning. Existing configuration requires these fields explicitly; this ADR is not a runnable grant.
2. L02 preserve the owned system/compaction/delegation instructions and complete native thinking replay. Existing synthetic transport tests stay frozen; separately qualify Large4 responses, tools, errors, compaction and model/tier identity under the new profile.
3. DB2-Q targets Large4's actual assets, framing and hosted relationship. Stop further Medium-specific installation/qualification unless separately justified as a reference experiment. No substitution based on shared tokenizer family names.
4. L08 performs the predeclared competence, recovery, developmental and comparator checks with the selected profile, recording preview variability and full costs. Model selection itself supplies no parity or autonomy evidence.

Earlier Medium evidence and consumed attempts remain preserved with their original identities. Existing synthetic checks are engineering fixtures rather than a deployed model choice. The old service remains decommissioned; the new system is not yet deployed.
