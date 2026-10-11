# A1-L08 — independent competence, development and parity evaluation

Status: **implementing — foundation fixture-verified, empirical acceptance outstanding**. Session owner: **Codex /root/a1_evaluation**. Accountable actor: Codex. Governing method: [workflow](../workflow.md).

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
| Owner session | Codex /root/a1_evaluation; finite foundation goal complete; full lane partial |
| Branch / worktree | codex/a1-evaluation-20261011; /home/palimpsest/migration/aeon-1-20261011/evaluation |
| Base source / contract revision | Base 14c742041270bb2acb15b4903a970394a140493c; C1 f11a25b consumer-checked |
| Additional path reservations | None; use the exclusive scope above |
| Last handoff / evidence | Protocol 20a4159; implementation 3e9d55a; [foundation report](../evaluation/results/2026-10-11-foundation.md), 13 tests and 12 mechanical cases passed |
| Blockers / next eligible task | L09 integrates foundation; T05/T06 and full qualification await frozen integration, live comparator calibration/runs, elapsed development and fresh independent review |
