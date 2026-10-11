# A1-L08 — independent competence, development and parity evaluation

Status: **implementing — actual application fixture-verified; v2 protocol corrected before live scoring; empirical acceptance outstanding**. Session owner: **Codex /root/a1_evaluation_integration**. Accountable actor: Codex. Governing method: [workflow](../workflow.md).

Requirements: [RW02, RW03, RW04, RW11, RW17, RW18, RW19, RW20](../../../REQUIREMENTS.md).

```text
/goal Complete A1-L08 by delivering an independent, reproducible evaluation suite and evidence report that measures the rewrite's reasoning, action, recovery, initiative and developmental transfer, compares it fairly with available Claude Code and Codex baselines, and blocks unsupported parity or growth claims with explicit unresolved gates.
```

## Ownership and dependencies

Own `evaluations/`, `docs/rewrite/evaluation/`, this lane file and `docs/rewrite/evidence/A1-L08/`. Own authoritative workload definitions, held-out cases, rubrics, evaluation runners and comparison reports. Component lanes retain their own engineering tests. L09 consumes this lane's frozen acceptance evidence and enforces admission; a candidate cannot modify its own authoritative evaluation in the same release.

Specification dependency: none to start task design and baseline availability checks; C1 for final evidence envelopes. Implementation dependencies: comparator installations/accounts where authorized; L02–L07 for actual candidate runs. Do not wait for the rewrite to exist before designing its falsifiable acceptance.

## Delegable tasks

| Task | Deliverable and exclusive child scope | Model / effort | Dependencies | Acceptance |
|---|---|---|---|---|
| A1-L08-T01 | Workload families, scored rubric, confounders and predeclared gate protocol in `docs/rewrite/evaluation/protocol.md` | `gpt-6-astra` / xhigh | Diagnosis; user ambitions; no runtime prerequisite | Includes novel coding/debugging, source-based research, multi-step operations, interruption/compaction, delegation, self-chosen inquiry and delayed transfer; defines verified outcome quality, interventions, cost, latency and failures; separates required gates from exploratory metrics |
| A1-L08-T02 | Comparator feasibility and frozen baseline harnesses in `evaluations/baselines/` | `gpt-6.1-sol` / high | T01 draft; configured access | Records actual versions, models, prompts/configuration, tools, context and resource envelopes; isolates same-model shell effects where possible and reports separate best-system comparisons; missing access/results are unavailable, not inferred parity |
| A1-L08-T03 | Mechanical and reasoning/action fixtures under `evaluations/execution/` | `gpt-6.1-sol` / high | T01; C1 evidence draft | Expected outcomes can be checked independently of the actor's explanation; seeded failures require repair from observations; held-out tasks resist answer leakage; tool correctness, autonomy and recovery are separately attributable |
| A1-L08-T04 | Longitudinal personality, judgment and growth protocols under `evaluations/development/` | `gpt-6-astra` / high | T01; L04/L05 contracts | Protocol rewards specific supported judgments, justified disagreement, changing interests and later transfer; does not reward agreeableness, verbosity, fixed naming or endless activity; includes controls for scripted identity and repeated private self-praise |
| A1-L08-T05 | Independent runs, ablations and report under `docs/rewrite/evaluation/results/` | `gpt-6-astra` / high lead; bounded `gpt-6-luna` / medium evidence indexing | T02–T04; frozen L02–L07 candidate | Reports individual failures and uncertainty as well as aggregate scores; tests model versus harness versus memory/goal contributions with bounded ablations; uses real external feedback where applicable; no withheld or unavailable result becomes a pass |
| A1-L08-T06 | Fresh evaluator integrity review and acceptance envelope | `gpt-6-astra` / xhigh with fresh context | T05; L09 release contract | Frozen candidate, prompts, checks and evidence identities match; thresholds were set before candidate scoring; material disagreement receives a recorded disposition; authoritative checks are inaccessible to candidate mutation during evaluation |

T02–T04 run in parallel once T01 provides a draft protocol. Evaluation task authors should not also author the candidate implementation they grade. Use bounded sample expansion only when uncertainty affects a decision, with the extension recorded before examining its new outcomes.

## Completion evidence and exclusions

Record reproducible commands, workload versions, configured access limitations, task-level observations, scores, intervention counts, costs/unknowns and reviewer dispositions. Before candidate evaluation, fix the required score margins, non-regression gates and evidence horizon from baseline variance and product needs. The initial plan does not invent a numeric threshold without those measurements. Publish the protocol revision before accepting runs under it.

Both named product baselines are part of the ambition; lack of authorized access blocks the corresponding full parity claim, not every engineering lane. A same-model test explains a harness difference; a best-configuration test measures the delivered system. Neither alone answers both questions. Longitudinal development must include real elapsed operation and later behavior; accelerated fixtures establish mechanics only.

Non-goals: proving subjective experience, benchmarking on private reasoning verbosity, treating self-critique as inherently beneficial, claiming universal superiority from a small test set, or silently reducing “on par or grander” to “uses tools.”

## Coordination

Owned by the lead who claims this lane; update here before concurrent implementation.

| Field | Current value |
|---|---|
| Owner session | Codex /root/a1_evaluation_integration; finite adapter/protocol engineering goal complete; full lane partial |
| Branch / worktree | codex/a1-evaluation-integration-20261011; /home/palimpsest/migration/aeon-1-20261011/evaluation-integration |
| Base source / contract revision | Integration base e35b1f8eb18a06e397e039251af06626b2224595; C1 f11a25b consumer-checked |
| Additional path reservations | Root owns availability/central status. First-party Anthropic accounting and its fresh review are integrated through `0b323e8`; actual native Claude kernel composition is integrated through `5e4bc97`. Native compatibility and fresh review are integrated through `833e88b`. Mistral returned model/tier binding and fresh review are integrated through `151f2be`; the author and reviewer finite goals are complete. The repair and three independent cancellation/worker-loss cases preserve original unknown charges. Root owns integration checks; existing request profile and OpenAI paths remain unchanged. `/root/a1_real_screen` owns the eight-case S01–S07/S10 real-screen unit under the L02 coordination claim and completion-audit specification, with new screen/driver/tests/evidence files and only a narrow read-only helper extraction from `product/adapter.ts` permitted. `/root/a1_real_screen_review` owns new independent screen regression/evidence files and audits retained physical results. L09 governance is independently reviewed and integrated through `5083298`. All active sessions have finite goals; no paid calls. Shared kernel machinery remains read-only. Qualification fixture correction is verified and integrated `8cef300`. |
| Last handoff / evidence | V2 protocol/adapter a94a9c0; [integration handoff](../evaluation/results/2026-10-11-application-integration-v2.md), 19 evaluation tests and actual application fixture passed; foundation history preserved |
| Blockers / next eligible task | Mistral broker profile binding and fresh review are complete at the bounded engineering scope; the substantive governance case is integrated and joined source has two fixture polling failures under root investigation. The selected native Claude synthetic protocol slice is accepted, with broader native qualification still open. Required native affordance qualification, compatible full-context reservation grant, isolated private workloads, authorized account/model access, comparator calibration/runs, actual development and independent qualification remain. No live result or full lane acceptance is claimed. |

## Finite integration handoff (2026-10-11)

```text
/goal Deliver the pre-live-scoring v2 correction, actual AutarkApplication evaluation adapter, bounded real-tool integration checks and comparator feasibility handoff; finish engineering without claiming full RW03, RW18 or H1.
```

This session owns the same L08 paths and changes no application or deployment code. Parent L09 delegates independent implementation/review work separately. The v1 archive and original results remain immutable. [Protocol v2](../evaluation/protocol.md) selects operational boundaries from actual scheduler configuration instead of inventing a calendar horizon, and requires comparator variance/product needs before freezing parity samples and margins. The [adapter](../../../evaluations/product/adapter.ts) exercises actual confined Pi, runtime, tools and direct output. External private workloads and evaluator modules are supported, but their independence and host seals are not self-authenticating. All author-run reports remain ineligible for admission. [Comparator feasibility](../evaluation/comparator-feasibility-v2.md) records both unavailable claims explicitly.

### Development evidence preparation claim — 2026-10-11

Root assigned `/root/a1_development_witness` an actual finite goal at `80b107a`, isolated worktree `/home/palimpsest/migration/aeon-1-20261011/development-witness`, `gpt-6.1-sol` / high. The [fixed behavioral specification](../evidence/A1-L08/development-witness-specification.md) precedes implementation and is the task's slash goal/acceptance. Own new `evaluations/development/` packager/driver/tests and `evidence/A1-L08/development-witness.md`, with a separate acquisition-procedure document only if needed. A minimal validation integration in existing `assess.ts` may preserve its thresholds and shape-only meaning. Shared qualification/contracts/runtime/build paths remain read-only. Pure offline fixtures and strict checks only; fresh independent review follows. This packages evidence; real observation, reviewer qualification, resources and elapsed development remain required.

Author `4a42c8d` completed the six-file development preparation handoff with normal strict compilation and 26 focused checks. Fresh reviewer `/root/a1_development_witness_review`, `gpt-6-astra` / high, owns new `witness-review.test.ts` and `development-witness-review.md` in an isolated worktree from that exact commit, plus narrowly reproduced repairs to the six new author files. Shared runtime/contracts/config remain read-only. Its actual finite goal requires adversarial authenticity, completeness, time/resource and reviewer-binding checks; no physical dispatch or automatic acceptance.

### Next preparation units — 2026-10-11

The eight-case screen and fresh review are integrated through `6077cef`; development preparation/review through `d45e215`. Their finite goals are complete. `/root/a1_real_screen` owns a new isolated lifecycle-screen unit for S08/S09/S11/S12 under the fixed completion-audit mapping, with new lifecycle driver/tests and necessary integration into its existing screen files; production runtime remains read-only unless coordinated. `/root/a1_native_concurrency` owns only concrete baseline observer/workers/runner, focused baseline tests and evidence under the [native affordance specification](../evidence/A1-L08/native-affordance-specification.md). `/root/a1_tool_instruction_retention` owns the separate L02 instruction-retention repair; it may update only the relevant acquisition-procedure paragraph after actual new behavior exists. Each implementation uses `gpt-6.1-sol` / high and creates its own finite goal; fresh independent review follows. Root serializes physical checks and owns integration. No paid calls or automatic qualification.
