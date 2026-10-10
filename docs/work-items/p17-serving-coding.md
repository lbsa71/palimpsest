# P17: serving entrypoints and owed coding outcomes

Status: bounded source implementation with deterministic integration evidence,
2026-10-10; independent integrated review and full regression results recorded
below. This is a bounded integration of
[the durable-session specification](p17-durable-coding-session.md), not proof of
configured-model competence, production dependency integration or deployment.

The foreground conversation must acknowledge a coding session only after durable
admission. Coding execution uses a separate runnable classification so its own
task cannot block every background tick. Direct operators, whitelisted Slack
authors and independently admitted growth use the same coordinator; peers and
other authors cannot obtain its schema, source or receivers. Host policy and
provider availability are explicit, finite configuration, with no fallback.

Acceptance requires actual admitted-worker request construction followed by the
selected native adapter with synthetic transport, actual workspace file/process
receipts, failed-check feedback and repair, and an exact immutable submission.
Conversation conversion links its already spent first call once. A growth
decision consumes its existing scheduler reservation and cannot launder human
conversation provenance. Pause/adoption drains commands and renews the epoch
without replacing the historical source or allocation contract.

A terminal coding execution retains a separate report obligation. Reports use
the ordinary durable communications receiver and originating scope, including
conversation topics when present; uncertainty is not delivery. A lossless
cognitive submission enters the existing proposal/review queue with its admitted
source binding. Broader drafts remain intact with explicit pending admission.
No code is installed, published or reported as tested from a model's assertion.

Risks include stale author/epoch after asynchronous admission, initial reply
checkpoint overwriting a debit, scheduler deadlock, stale topic reports and a
lossy bridge to the old cognitive proposal path. Relevant recovery and negative
checks must accompany the positive serving witness. Existing admission rules,
release budgets, authoritative checks and live installation remain separate.

## Implemented interfaces and decisions

[ADR 0027](../adr/0027-durable-coding-sessions-and-exact-submissions.md) records
the journal, shared accounting, importer and exact submission decisions. Runtime
and GenerationHost accept an optional trusted coding hook. The coordinator
accepts a trusted finite policy and SDK-independent provider factory. These are
host interfaces; the CLI has no configured production coding factory yet.
Unavailable source/policy/provider admission retains an honest outcome and no
invented session. Independently initiated growth has its own admitted origin;
conversation provenance cannot enter that route.

The retained agenda decision resumes mechanically after cold Store reopen even
when it spent the final window permit. It does not need another inference. Both
the initial conversation call and the actual scheduler agenda call count once
in session/work/attempt ceilings without a second shared-window debit. An
unavailable independent-growth admission ends with a retained disposition;
interrupted or revoked authority remains held rather than acknowledged as work.

Reports bind the original prepared topics, source exchange and revision. A later
topic cannot be overwritten by an older coding outcome. The ordinary receiver
tracks delivery separately. Status exposes ID/state/phase only because a model
completion reason may contain private source or command observations. The
coordinator separates execution authorization from terminal outcome permission.

## Verification and limits

The actual native serving witness lives in
`experiments/coding-provider-adapter/session-provider/serving/serving.test.ts`, outside the normal
test set because the selected SDK closure is a separate experiment. Run it
explicitly after preparing that pinned fixture closure; root TypeScript checks
the SDK-independent serving test interfaces. No production dependency was added.

Executed bounded results at this checkpoint:

- Five native serving cases pass with actual admitted workers, trusted collector,
  filesystem/process receivers and the selected SDK with synthetic transport.
  Direct and eligible Slack sessions observe a failing command, perform edits,
  observe a passing command and submit the exact tree. A real worker crash renews
  the epoch and resumes the retained response without another inference.
- Independent scheduler growth reaches the same loop and shared allocation.
  Peer and non-whitelisted requests receive no coding schema or native session.
  A lossless cognitive submission reaches the actual existing proposal queue
  and freezes with exact files; broader drafts retain all bytes/modes pending
  supported admission. These tests do not activate a new release.
- The selected native facade has 54 passing synthetic protocol cases and its
  separate strict source/interface typecheck. Core coordinator/tools have 35
  passing cases, and actual source/submission receivers have 13 passing cases.
- A stable 113-case affected mechanical run includes 26 accounting and eight
  serving-outcome regressions. Findings about unavailable admission, stale topic
  revisions, lost reporting, private terminal status and initial growth debit
  were reproduced and corrected. The [review record](p17-serving-review.md)
  preserves original failed checks and fixture limitations.
- Two trusted-layout cases preserve empty directories/root modes and reject
  malformed metadata before creating a workspace. Three growth recovery cases
  verify exhausted-window cold reopen and honest failed-source disposition;
  the latter retains a corrected baseline reproduction outside Git. The initial
  cleanup error was a fixture defect, not causal feature evidence.
- A fresh review reproduced and resolved five admission, fairness, activation,
  cold-adoption and report-revocation findings. Its independent 51-case run and
  external probes passed. Seventeen report-binding regressions plus 95 affected
  checks passed; five activation checks include actual aborted-cutover recovery.
  Late authority withdrawal holds source-bearing reports; automatic redaction
  or report regeneration remains unimplemented, with the owed outcome retained.
- The final stable normal regression run passed 680 cases with zero failures
  and one platform skip (681 total). All 266 source/test/document pins remained
  unchanged across that run; strict TypeScript passed. An earlier mixed-source
  run failed three CLI checks against a transient compilation defect; its logs
  remain retained, and the corrected CLI checks passed before the stable rerun.

Raw RED/GREEN results and source pins remain outside Git. Root integration
receipts are archived under
`/Users/stefan/.codex/source-evidence/palimpsest/p17-20261010/`; this is development
evidence, not lived experience or a release approval. The stable full regression
and independent repaired review agree with the recorded source pins.

P17 and P18 remain incomplete. This establishes deterministic injected-host
mechanics, not a production CLI capability, configured-model coding quality,
retained SDK installation, broad application/fork/governance activation, full
outer-host restart acceptance or public peer security. The denied ingress cases
exercise worker request filtering; complete adversarial filesystem and social
secrecy acceptance remains a separate gate. Existing command restrictions,
unknown-owner holds and the need for maintenance ticks while a provider slot is
withheld remain explicit limits.
