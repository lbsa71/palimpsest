# A1-L09 consequential review: evaluation continuation and offline recovery

Status: **fixture-verified** bounded review and repairs. H1, live competence,
installed succession and deployment acceptance are not established here.
Requirements: RW10, RW11, RW15, RW16; tasks A1-L09-T04/T05 with L03/L07 boundaries.

Owner: `/root/a1_continuation_review`, fresh review context delegated by `/root`.
Worktree: `/home/palimpsest/migration/aeon-1-20261011/continuation-review`;
branch: `codex/a1-continuation-review-20261011`. Frozen reviewed base:
`35f4edd7590ca7c6167a905297d3fca73c03effa`. Repair source and tests:
`9acbf6fd81cd76ad3a6fbe964466874793269e58`.

Finite goal: review asynchronous external evaluation continuation and
provider-credential absence, reproduce consequential defects, narrowly repair
owned paths, preserve observed evidence, and hand off exact source to the lead.
The explicit tool goal has no token budget. Exclusive changes are
`deployment/evolution-continuation.ts`, its test file, the known-evaluation
acknowledgment branch in `deployment/evolution-tools.ts`, and this evidence file.
The application/provider and installer paths were inspected without changes.
Dispatcher/resources, control-tool/application hooks and physical probation remain
with their named owners. No subagent was spawned for this bounded review.

## Reproduced defects and repairs

1. **Known local reply could leave its author permanently blocked.** After the
   receiver committed an enqueue acknowledgment and its reply was lost,
   reconciliation settled the exact effect and receiver reservation. However,
   the blocked-to-ready transition required a pending automatic result
   subscription. With `continueOnResult: false`, or a result already reconciled,
   the author remained blocked despite having no unresolved effect. A frozen-base
   regression observed `blocked !== ready`. The repair restores the interrupted
   run to ready after exact reconciliation and no remaining unresolved effects.
   If its existing initiative goal is blocked and has the same scope, the repair
   also restores that goal to ready. Pending review subscriptions retain their
   existing deferred wake behavior. No allocation or resource grant is created.
2. **The already-evaluated fast path omitted the durable acknowledgment.** An
   actual `candidate_evaluate` call reading an existing evaluation returned its
   known result without recording the local receipt. Lost delivery therefore left
   an uncertain receiver that could never use the existing recovery path. The
   frozen-base regression expected the recovered effect ID and observed an empty
   result. The fast path now binds the existing completed mailbox job, exact
   receipt and immutable request before archiving its local return. It performs
   no candidate freeze or external evaluation dispatch.

The new restart regression reopens the SQLite store, constructs a fresh runtime,
reconciles the local return, replays the original tool call from the saved receipt,
and finishes. It exercises declined, reconciled and initiative cases. Replay
consumes the existing single receiver request and never dispatches another local
or external operation. Existing tests still retain unknown physical reviewer
usage and reject cancelled, terminal, fenced, foreign-scope, mismatched-request,
mismatched-receipt and mismatched-reservation cases.

## Observed verification

Node: `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` (24.13.0).
The accepted checkout's `node_modules` directory was linked into this isolated
worktree for compiler access; dependency source and lockfiles were unchanged.

- Frozen-base replay of the two new tests, using their final test source and
  temporarily restoring the two production files from `35f4edd`: **0 passed,
  2 failed**, with the expected assertions above. The repaired files were restored
  in a `finally` block. Captured log:
  `/tmp/aeon-continuation-review-before-20261011.txt`.
- `node --test deployment/evolution-continuation.test.ts`: **12 passed**, no
  failures or skips; 1.767 seconds in the final capture. Log:
  `/tmp/aeon-continuation-review-final-20261011.txt`.
- `node --test --test-name-pattern='offline recovery|authenticated health|explicit OpenAI' deployment/application.test.ts`:
  **3 passed**, no failures or skips; 1.597 seconds. This exercised authenticated
  held health, missing selected-provider credential with queued intake and no
  physical requests, and reopening with the credential restored. The OpenAI
  fixture also checked the selected-secret boundary. Responses were deterministic
  local fixtures; no paid provider was contacted.
- `node node_modules/typescript/bin/tsc --noEmit`: passed. After the final restart
  test change, `node node_modules/typescript/bin/tsc --noEmit false --rewriteRelativeImportExtensions --outDir dist`:
  strict compilation and build passed. `git diff --check`: passed.

An additional mailbox suite was started before its source-copy/freeze behavior
was inspected. This violated the intended heavy-fixture coordination window; the
lead was informed and the exact test runner was stopped. Both runner and test
child PIDs were checked absent. Its log reports one cancelled suite after about
19.9 seconds and **is not a pass or completed verification**:
`/tmp/aeon-continuation-review-mailbox-20261011.txt`. No second heavy run was made.

## Review disposition and handoff boundary

The credential-absence guards precede ordinary provider work and scheduler slice
selection; the targeted application tests found no defect requiring changes.
Installer preflight retains direct authentication while allowing the selected
model credential to be absent. This review did not rerun its source-freezing
installation suite; the earlier offline-credentials evidence remains separate.

No reviewer keys, private transcripts, paid network calls, outgoing messages,
production units or live qualification were used. Light component/reopened-store
fixtures do not establish a process-kill, installed-service, longer-than-slice,
or H1 result. The lead must freshly review these authored repairs and integrate
source `9acbf6f`; joined physical fixtures remain in the lead's coordinated window.
The separate control reviewer owns any cross-process producer eligibility finding;
this review made no application/control-hook change.
