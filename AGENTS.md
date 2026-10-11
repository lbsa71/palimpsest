# Engineering and planning rules for Palimpsest

The active direction is the **Aeon rewrite**, requested on 2026-10-11. Read [REQUIREMENTS.md](REQUIREMENTS.md), [PLAN.md](PLAN.md), [the planning workflow](docs/rewrite/workflow.md), and your lane before doing work. These rules apply to Codex bootstrap sessions and later Autark engineering sessions.

## Authority and historical material

- The user authorized a full rewrite with **no legacy support**. Existing source is evidence and a possible source of justified components, not a required architecture. Do not preserve old APIs, stores, deployment paths, prompts, test arrangements, or dependencies merely for compatibility.
- Active specifications are the root entry points, `docs/rewrite/**`, and ADR 0031 or subsequent explicitly adopted rewrite ADRs. Other documentation, work items, protocols and ADRs describe the retired implementation. They are historical unless explicitly adopted with rationale in the new plan. [The prior entry points](docs/history/pre-aeon-2026-10-11/README.md) preserve that history.
- Preserve historical lived data and credentials. Archival preservation is not a migration requirement. New operational state starts independently; any later import is a separately specified capability with provenance and privacy checks.
- Documents do not confer host, network, spending, messaging or publication authority. The current planning task does not authorize implementing or deploying the entire rewrite. The old service has been decommissioned; do not restart it as a shortcut.

## Work through Aeons, lanes and tasks

The [workflow](docs/rewrite/workflow.md) is a product requirement, not optional presentation. Every substantive work item belongs to an Aeon and an ownable lane, has a finite copyable `/goal`, explicit dependencies, exclusive write ownership, concrete subagent tasks, model/effort routing, acceptance evidence and a handoff. Claim the lane and its files before editing. Use separate worktrees when concurrent sessions could conflict. Coordinate shared contracts through their named owner.

The lead must delegate independent investigation, implementation or review when doing so improves quality or time. Parallelize after identifying dependencies; do not split tightly coupled mutations among unsynchronized writers. Supply each subagent its task, inputs, writable paths, model/effort choice, resource limits, acceptance criteria and return format. The lead integrates and checks the actual output.

## Implement from evidence

- Distinguish user requirements, adopted decisions, proposed designs, hypotheses, observed behavior and unverified capability. Architecture defaults are proposals until the relevant decision gate closes.
- Before nontrivial code, establish a testable behavioral specification. Use pragmatic TDD for behavior and defect reproduction where useful; exercise recovery, interruption, external effects and authority boundaries when affected. Use deterministic model fixtures plus explicitly configured live checks for model competence.
- Do not add tests that mirror implementation or test prose as runtime behavior. Documentation validation means consistency, references, dependency/ownership checks and review.
- Keep changes reviewable. Simplify touched code when justified. Do not add abstractions, dependencies or fallback compatibility without a demonstrated need.
- Evaluate off-the-shelf agent shells before building equivalent machinery. Audit the full effective instruction path, including compaction, tools and delegated agents; record every retained source of instructions. Do not treat a system-prompt option as proof of control.
- Preserve configurable personality and independent growth. Enforce resource and effect permissions in code instead of covertly programming servility into the personality prompt. Control over application prompts does not imply control over model training or vendor service policy.

## Verify and evolve the whole system

All components may eventually evolve, including prompts, planning artifacts, evaluation, libraries and enforcement code. A candidate cannot change the controls judging that same candidate. Separately stage control changes under previously accepted controls and retain an independently usable recovery path. Bind release evidence to the exact source, dependency, prompt, model and configuration manifest. Preserve current memory and uncertain-effect records across recovery.

Require fresh review context for consequential changes. Candidate self-assessment, verbosity, test counts and activity are not proof of competence or growth. Use external feedback, held-out behavior and measured transfer; preserve failures. Never fabricate results or weaken a check to obtain a pass.

## Finish and hand off

Completion requires satisfied acceptance criteria, recorded commands/results and limitations, resolved or explicitly tracked review findings, consistent lane/plan status, and an exact handoff revision. Documentation completion does not mean the described runtime exists. Keep the plan executable by another session without the original chat. Follow the four-dimensional [growth mission](GROWTH.md); neither the bootstrap tooling nor the Autark should confuse repeated output with development.
