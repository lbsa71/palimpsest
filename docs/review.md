# Fresh review and continuity interview (P10 / P11)

## Work item and trust contract

Problem: a plausible model response, inherited authoring conversation, or changed
candidate must not become release approval. This module supplies cognitive
evidence to the mechanical custodian; it grants no production authority.

Expected behavior: independently collected candidate checks, a bounded frozen
source/diff/task context, and exact candidate/evidence identities are validated
before starting a fresh review. Review returns `pass`, `fail`, or `inconclusive`.
A failed required check stops the process regardless of model opinion. Missing,
invalid, mismatched, cancelled, or unavailable inference never becomes a pass.

The incumbent and successor interview against an explicitly scoped snapshot.
Every question, response, challenge, verdict, and readiness acknowledgment binds
the candidate, evidence, snapshot, and policy identities. Challenges may correct
an incumbent assumption; acceptance requires an explicit resolution or a named
unmet criterion. Rounds and provider calls have fixed limits. Exhaustion records
follow-up work and leaves the incumbent active.

Dependencies: the stateless [provider boundary](providers.md), frozen candidate
manifests/evidence, and a trusted caller that persists evidence and authenticates
custodian roles. The module does not accept a model-provided actor capability.
Its call-reservation hook must persist any global budget charge before inference;
its mailbox hook must persist each transcript message before another model sees
it. A hook failure aborts the interview without positive admission evidence.

Non-goals: candidate execution, credential access, publishing, release cutover,
snapshot authorization, final catch-up, operational rollback, or proving a model
review infallible. No review model can waive a deterministic gate. Independent
contexts reduce shared history but do not establish statistical independence.

Material risks: candidate text may attempt prompt injection, source context can
be incomplete, and qualitative judgments can be wrong. Context bounds reject
oversize input rather than silently truncating review evidence. The caller must
obtain source/diff from the frozen artifact, restrict snapshot disclosure, rerun
identity/freshness checks before admission, and keep candidate execution away
from credentialed reviewers.

## Acceptance criteria

- Recompute the canonical evidence digest and check candidate identity, unique
  required checks, and all check results before invoking a reviewer.
- Bind a strict structured review to the exact context and cover every required
  check; reject unknown fields and contradictory positive results.
- Pass only fresh bounded context and explicit trusted evidence, with candidate
  material identified as untrusted data. No author conversation is accepted.
- Use separate incumbent and successor calls, record role-tagged mailbox
  messages, preserve challenges, and enforce explicit verdict/readiness gates.
- Enforce round/call limits, cancellation, provider failures, and durable-hook
  failures without implicit retries or a fabricated pass.
- Distinguish structural fixture checks from real-provider calibration and
  practical successor behavior. A conversational pass alone proves neither.

### Identifier grammar correction

A live procedure review on 2026-10-08 produced descriptive coverage text where
the host requires exact check identifiers. The generic string-array schema did
not express that protocol. The correction must encode reviewer coverage as an
exact-size array of the supplied check IDs, interview verdict coverage as an
exact-size array of the fixed rubric IDs, and answer citations as a nonempty,
bounded array of the supplied reference IDs. Instructions must distinguish those
identifiers from explanations in `reason` or `answer`.

Acceptance requires a schema-driven fixture to construct valid review/interview
responses without guessing IDs, while missing, duplicate and foreign identifiers
remain rejected by host validation. The grammar omits `uniqueItems`, which the
configured Mistral endpoint does not support; duplicate rejection stays in code.
This change makes the response contract explicit. It does not relax review
coverage, repeat a declined call, or turn an inconclusive response into approval.

## Public interfaces

`src/review.ts` exports `reviewCandidate(options)`, `interviewCandidate(options)`,
their typed input/result envelopes, and the fixed `INTERVIEW_CRITERIA` rubric.

`ReviewInput` supplies `candidateId`, `candidateDigest` (the manifest digest),
the complete `CandidateEvidence`, trusted `requiredCheckNames`, `task`, `source`,
and `diff`. Evidence is accepted only when its canonical digest matches every
field, any supplied log bytes match their individual SHA-256 digest, the
candidate identities match, and every required check is present and passed.
The expected seed checks are `typecheck` and `trusted-agent-contract`; the host
selects the admission contract, never the candidate or reviewer.

The review result binds `candidateDigest`, `evidenceDigest`, and `contextDigest`.
It retains the validated model assessment and per-call provider/model, prompt
digest, actual known token usage, and outcome. Missing usage remains unknown.
An invalid model envelope remains `inconclusive`; a trusted failed check yields
`fail` without spending a reviewer call.

Structured response grammars enumerate exact coverage/reference identifiers.
Reviewer coverage and interview verdict coverage have the exact required array
size; answer references require at least one supplied identifier and at most 20.
The host additionally rejects duplicate, missing or foreign IDs even when an
adapter ignores the grammar. Explanations belong in `reason` or `answer`, not in
identifier arrays. The grammar deliberately uses no `uniqueItems` keyword.

An interview additionally receives incumbent/successor providers and
`InterviewSnapshot {sequence, snapshot, policyVersion, snapshotDigest}`. The
snapshot is an authorized object with a nonempty `scope`. Its digest is the
canonical hash of `{sequence, snapshot, policyVersion}`. The coordinator copies
inputs on entry, so caller mutations cannot silently replace context mid-call.
Changing current policy still requires the custodian to invalidate approval and
rebuild the snapshot before transfer.

Each round calls the incumbent to ask, successor to answer/challenge, and
incumbent to accept/reject/request evidence. Acceptance adds a separate successor
readiness call acknowledging the transfer contract. All envelopes bind snapshot
and policy identities as well as candidate/evidence/context. Citations must name
the supplied snapshot, evidence, or required check. Incumbent verdicts must cover
memory, commitments, judgment, competence, intended improvement, and justified
disagreement. An accepting verdict must explicitly resolve a successor challenge.

Default limits are two rounds, seven calls, a 256,000-byte serialized context,
and 4,096 requested output tokens per call. Configuration can lower them. Hard
ceilings are ten rounds, 31 calls, a 1,000,000-byte context, and 32,768 requested
output tokens. Provider deadlines and output limits apply independently; the
Codex token limit caveat in [providers](providers.md) still applies. No adapter is
silently substituted when a call fails.

`beforeCall({role, round, contextDigest})` lets the trusted host atomically reserve
its durable budget before inference. Returning false denies the call. The local
call count is a per-invocation bound; it is not durable across process restarts.
Restart policy and any fresh allocation belong to the host. `onMessage(message)`
receives a caller-owned `role`, `stage`, `round`, and validated `payload`; the host
maps these to authenticated custodian methods and durable mailbox records.
Hook exceptions stop progression with an inconclusive result.

Neither API reads live files, executes candidate code, reconstructs an author's
conversation, or transfers authority. A returned `pass` is one required cognitive
gate. The mechanical custodian must separately verify independent checks,
readiness, exact bindings, current policy, recovery availability, and cutover.

## Verification and remaining evidence

`node --test test/review.test.ts`: 12 deterministic checks pass. Tests were
observed failing before implementation and before fixes for mismatched log
digests, mutable snapshot context, identifier grammar and duplicate citations.
A schema-driven roundtrip builds review/interview replies using the supplied
identifier enums and passes the unchanged exact-coverage validation. Coverage includes required-check failures,
forged hashes, malformed model envelopes, missing coverage, contradictory passes,
unavailable providers, cancelled calls, budget denial, context overflow, separate
role calls, challenge resolution, finite disputes, readiness, and mailbox failure.

These checks establish the coordinator's structural behavior. They do not prove
the quality of a real model review or the successor's practical competence.
Configured real-provider smoke/calibration, integrated custodian authentication,
practical exercises, and end-to-end succession evidence remain required before
claiming full A10–A12 completion.

After the identifier correction, a separately allocated live Mistral CSV
publication probe on 2026-10-08 passed. Independent isolated cases checked
quoted/multiline totals, another selected numeric column, absent columns,
nonfinite values and malformed row width. Exactly one durably reserved fresh
review call approved the exact procedure/evidence. Two further-input executions,
registry reopening and identical republishing used no additional inference.
The earlier incomplete-coverage rejection remains recorded; this was a new
explicit allocation under a changed checking-policy identity, not a silent retry.
Full prompts, completions and results remain in external integration state.
This validates the configured protocol and direct procedure boundary; it does
not establish general reviewer quality or replace a live succession interview.
