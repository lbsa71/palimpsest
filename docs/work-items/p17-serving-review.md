# P17 serving outcome regression review

Status: bounded source review and mechanical regressions complete, 2026-10-10;
fresh frozen-artifact acceptance and configured-model/live admission remain
separate.

This work item verifies the serving bridge described in
[P17 serving entrypoints](p17-serving-coding.md) and the
[durable coding session contract](p17-durable-coding-session.md). The initial
independent review owned this document and `test/coding-serving-outcomes.test.ts`.
Follow-on authored accounting and prepared-report repairs are identified below;
the parent owns Runtime and release integration. Those authored repairs are not
independent acceptance of the reviewer's own source.

## Problem and expected behavior

A durable coding result must reach its original conversation without treating
admission failure as a silent generic runtime failure, exposing private session
data through status, closing a pending coding question as an idle reflection,
or replacing a newer confirmed topic with an older coding result. A failed
source import grants no session or workspace authority. Its honest unavailable
acknowledgment and retained disposition must survive restart, including the cut
between the coordinator's unavailable journal entry and the bridge callback.

The existing topic revision, current source and explicit notification waiver
remain authoritative. If a topic has progressed, the older coding disposition
may use a separate report without modifying the new question or acknowledging
its report obligation. A completed independent growth experiment remains
immutable; a later exact coding proposal uses a separate linked record.

These are accepted integration requirements and regression findings, not new
provider, execution or release authority. There are no new resource defaults.

## Acceptance criteria

- A real Runtime/Continuity/Coordinator fixture whose admitted-source import
  fails delivers an honest unavailable acknowledgment and retains an owed
  disposition without inventing an admitted session or physical request.
- Replaying an unavailable admission after reopening SQLite repairs the bridge
  obligation once without retrying the failed import.
- Current-source invalidation and an explicit topic waiver prevent stale coding
  reports, including a prepared continuation.
- An old coding result preserves a newer topic's exact revision, interpretation,
  unresolved questions and report obligation.
- Ready, running and budget-paused coding work prevents ordinary no-reflection
  closure of its current bound topic.
- A different Slack author may receive the existing safe status projection but
  cannot read coding transcripts, source or command-output canaries.
- A cognitive submission from independent growth preserves the original
  completed record and creates a separate exact linked proposal once.

## Non-goals, dependencies and risks

These mechanical tests use actual file-backed SQLite, Store, Runtime,
ConversationContinuity and accounting. Failed admission also uses the real
coordinator. Provider completions, successful coding admission and submission
receipt boundaries are deterministic fixtures; they do not establish native
adapter correctness, actual sandbox execution, model competence or deployment
admission. Actual worker/native serving witnesses belong to the parent work
item. No live service, provider, key, network, installation or publication is
used here.

The review depends on the host-bound topic refs created by request preparation;
manually seeded continuation fixtures must preserve that precondition. Source
was moving during defect discovery, so executed RED and later GREEN receipts
must retain their own source hashes. Static findings fixed before a probe loaded
must not be relabeled executed RED. Frozen artifact review remains separate.

## Findings and evidence

Private raw receipts and source pins are retained outside Git under
`/tmp/palimpsest-p17-serving-review/` with directory mode 0700 and file mode 0600.
Executed findings so far:

- `admission-result.json`: one deterministic foreground inference and one failed
  source import produced `runtime_failure`, no acknowledgment, no admitted
  session, a tentative pending topic and no bridge report obligation.
- `revision-result.json`: an old session's result replaced revision 3's newer
  pending stance and unresolved question with a settled revision 4. The reused
  fixture's `waiverBypassed` field is irrelevant because no waiver was set in
  that scenario; the before/after topic snapshots are the causal observation.
- `outcomes-status-red1.tap` and `outcomes-status-red1-receipt.json`: the terminal
  status case returned a source canary in `session.reason` to another Slack
  author. The actual coordinator can store free-form native stop text there;
  omitting the transcript alone did not make the shared status projection safe.
  Source was stable during this run: serving `5f257a9b8951a9b0ed6b1b35670c54d476ed00b3d318004eb2ebfeaab2898da4`,
  runtime `b1a2c32bf94b124f0c2e323a5abb7f4869171850f2620932acb07dc45a185a3d`,
  coordinator `3dd83d64ba37eadecc5e8e05993ccdd47c26a66805641f576b4cff5caae72026`.

Earlier status disclosure, prepared-topic omission, independent-growth mutation
and missing lifecycle resume were static findings. The parent fixed them before
the independent probes loaded. `probe-result.json` and `review2-result.json`
record their actual later GREEN observations. `pending-result.json` records a
fixture precondition failure: a manually prepared continuation omitted its
host-bound topic-ref checkpoint. It is not a source RED or a passing check.

Read-only artifact/consumer inspection also identified a representation limit
mismatch: `CodingArtifacts.bridgeInputs` can produce 32 cognitive files with
up to 524,288 bytes per file, while both the serving bridge and existing growth
scheduler parse proposals with a maximum of 10 files and 100,000 characters per
file. Such exact drafts remain preserved, but the initial implementation could
label them cognitive-compatible and subsequently report an authority hold.
This was a static compatibility finding, not an executed real artifact RED.
The source owner now classifies those unchanged exact trees as awaiting
supported admission with
`legacy_cognitive_format_limits_require_supported_admission`, preserving the
existing proposal parser and full immutable artifact. This resolution has been
checked by source inspection; actual receiver execution belongs to the parent.

The initial owned suite passed 8/8 before the stronger terminal-status case.
`outcomes-final1-receipt.json` binds that run to stable source pins. With the
terminal source canary added, `outcomes-status-red1.tap` records 7/8 passing;
the source owner then removed free-form reasons from public status. The final
run passed **all eight owned outcome cases**, including that terminal canary,
as part of **113 checks** across seven affected mechanical files at concurrency
two, with no failures or skips (1213.373417 ms). Strict `tsc --noEmit` also passed.
The earlier compile failures and behavioral RED receipts remain retained as
failed evidence.

The final run at 07:56:23–07:56:24 UTC is bound by
`/tmp/palimpsest-p17-accounting-evidence/growth-initial-final-receipt.json`.
All fourteen recorded source/test hashes remained stable before and after the
tests and compiler. Relevant exact pins are:

| File | SHA-256 |
| --- | --- |
| `src/coding-serving.ts` | `65d692e1579a4f8b84b5da44766b30ffe4c1648a558b9d63c9e62e34c553eb14` |
| `src/runtime.ts` | `b1a2c32bf94b124f0c2e323a5abb7f4869171850f2620932acb07dc45a185a3d` |
| `src/generations.ts` | `9fba2736e54606b5374852c4cdd0bcb3a9efb9771680f5b6456dc4e234d20b08` |
| `src/conversation-continuity.ts` | `937bbb4b3ac19baf2114194774ea716a6ff61c30de4dba994b4d5aee98e8e29f` |
| `test/coding-serving-outcomes.test.ts` | `447ee0c49f5053e01c3f368e35d8ed2bb13323683baf9f621f2435c1fc859f0b` |

No remaining observed blocker from these findings is left open. Native source,
effect recovery and actual artifact receiver execution still require their own
evidence and fresh final review. The normal `test/` suite no longer imports the
experimental native facade or ignored `fixture-sdk` symlink; actual native
serving fixtures reside under `experiments/coding-session-provider/test/` and
must be run separately in their configured experiment environment. This
preserves a dependency-independent normal/protected suite without presenting
unavailable native evidence as a pass.

The parent subsequently assigned this reviewer a narrow accounting repair:
link the actual already charged independent-growth decision once into coding
cumulative caps. Its specification, RED/GREEN and limits are recorded in
[P17 accounting](p17-coding-accounting.md). That authored accounting work is not
independent source acceptance of the reviewer's own changes.

## Prepared coding report revocation repair

Status: narrow source repair and mechanical regressions verified; fresh frozen
review and deployment acceptance remain separate. A fresh reviewer
executed `/tmp/p17-readonly-prepared-report.mts`: a generic fallback was prepared,
its original exchange was explicitly corrected, and actual Runtime delivery still
sent the old source-bearing text. This is an executed delivery-boundary defect;
the earlier preparation-time source checks did not cover the queued interval.

This repair owns only CodingServing reporting methods, a new
`test/coding-report-revocation.test.ts` and this review record. The parent owns
Runtime's combined delivery guard and generated-report classification. The
existing source/revision/waiver contract requires a trusted durable report
binding, committed with preparation, that is revalidated immediately before
communication and after message authorization. Bind the origin and report
routes, authenticated authors, relevant topic revisions and scoped source
versions. A free-form summary or model value cannot waive these checks.

Acceptance requires actual file-backed Store/Runtime delivery to suppress old
prepared text after correction, forgetting, a relevant notification waiver,
topic progression or current source-policy revocation, including after reopen
and during message authorization. An unchanged report must deliver once in its
sealed scope with its real receipt and must not become a new human episode.
Unknown or rejected communication must remain unreplayed across reopen.
Execution authority and terminal reporting permission remain separate: when
execution permission is already revoked at preparation, use a fixed generic
host disposition under the original sealed route and optional trusted report
policy. Do not leak a retained model summary or artifact description. A later
revocation of a source-bearing prepared report holds that report; this narrow
repair does not introduce automatic redaction/resend reconciliation.

The tests use actual SQLite, Store, Runtime and continuity with deterministic
session/artifact/provider boundaries. They do not run native workers, live
providers, network, installation or publication, and do not constitute frozen
deployment acceptance. Retain separate RED/GREEN pins outside Git; no new
release authority, resource defaults or communication retries are added.

CodingServing now writes a versioned per-report `coding.report.prepared` journal
binding in the same Store transaction as report preparation. It seals origin
and report routes/authors, text digest, relevant current topic revisions and
recursive scoped memory versions/task origins. `isReport` recognizes those
host records and old aggregate coding report IDs; an older unbound coding
report is held. The pure `reportMaySend` hook rechecks current host records,
explicit correction, current source policy and notification waiver. The parent
Runtime invokes it before reserving the effect and after message authorization;
coding reports complete without recording a new human exchange episode.

The optional trusted `authorizeReport(origin, report)` policy is separate from
self-modification eligibility and cannot change the sealed destination. When
execution authority is already unavailable, preparation discards the free-form
summary and artifact description and binds only a fixed host disposition.
That source-free permission also requires the exact fixed text digest. When a
source-bearing report loses authority after preparation, it is cancelled/held
with its durable outcome retained. Automatic redaction, regenerated reports or
delivery after later policy restoration are **not implemented** by this repair;
the owed result is not falsely acknowledged, and uncertain effects are not
resent. Host deployment wiring must supply CodingServing to Runtime for these
coding guards; an unrelated standalone Runtime without that receiver cannot
infer a coding report's policy.

`/tmp/palimpsest-p17-report-revocation/owned-red2-receipt.json` pins the valid RED:
15 cases, three passing and twelve failing, including actual delivery after
source correction/reopen and waiver. `owned-red1-receipt.json` is retained too;
one case there expected an unresolved effect retry to be admitted, but Store
correctly rejected it. That fixture expectation was corrected before RED2 and
is not a product failure. The original fresh reviewer script/log remain intact
at `/tmp/p17-readonly-prepared-report.mts` and `.log`.

The final owned suite has **17 cases**, all passing. The affected seven-file run
passed **95 checks**, zero failed/skipped, at concurrency two (1068.372458 ms),
and strict `tsc --noEmit` passed. Seven source/test hashes were stable across
that run. Private evidence is bound by
`/tmp/palimpsest-p17-report-revocation/final-receipt1.json`, SHA-256
`ab38113bd1648ed5299116dd88dedbf8ca96013d6c403b33e4d094e1493cf13d`.
Exact repaired source/test pins are:

| File | SHA-256 |
| --- | --- |
| `src/coding-serving.ts` | `fa5557449060c8cf09358eb91e5b9a863124f11eaa158ed00f45b0919c3bdd57` |
| `test/coding-report-revocation.test.ts` | `5f0c28df399f1b1a6293d42546c9287f386a2a9550383751582d94bc88371fa2` |

This work contains authored source and candidate regressions, not independent
release acceptance of the author's own repair. Native worker/tool execution,
production transport/model configuration, full frozen integration and live
admission remain outside this bounded evidence.
