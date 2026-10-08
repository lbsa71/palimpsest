# Implementation progress and evidence

Updated 2026-10-08. The integrated local checkpoint passed **194 tests, with one platform-specific test skipped**, and `npm run check` passed on macOS arm64 / Node 24.13.0. The skipped check exercises unsupported-platform isolation; the actual macOS sandbox checks ran. Markdown local links, the Slack manifest JSON and Git whitespace checks also passed. The [acceptance map](seed-validation.md) distinguishes component evidence, live observations and remaining limits; [PLAN.md](../PLAN.md) retains the completion criteria.

This is not a claim that every full seed criterion has passed. Live Slack and the model-authored source release remain pending at this checkpoint, and the qualitative memory probe found a real quality gap.

## Verified implementation

| Area / plan | Executed evidence | Remaining scope or limitation |
|---|---|---|
| Configuration / P01–P02 | External paths, repository discovery, symlink/dangling-path rejection, private credentials and safe inspection; typed task/effect/memory/growth/procedure/release contracts | Selected host is local macOS; production hosting and hard resource quotas remain open |
| Tasks and providers / P03 | Durable reopen, cancellation, finite calls, immutable outcomes, atomic episode publication, uncertain-effect handling; live Mistral structured output and direct task | Native optional Codex CLI smoke remains unverified; unknown effects need reconciliation |
| Communications / P04 | Direct calls, authenticated loopback API, signed Slack HTTP and Socket Mode; durable acknowledgements, scope, status/cancel/correction, reconnect backoff/cooldown | Live Slack awaits the user's app credentials and a user-initiated mention; no Slack messages have been sent |
| Isolation and custody / P05 | Actual Seatbelt workers deny private reads, protected writes, symlink escape, network and shell execution; real identity, opaque authority, bounded startup/RPCs, coordinator lock | No hard RAM/disk/CPU quota; health recovery during release cognition waits for bounded work to yield |
| Memory / P06 | Four scoped categories, revisions, logical forgetting, bounded consolidation, source-version invalidation, consistent snapshots, current-history rollback and a 1,000-episode benchmark | Live mechanics passed; qualitative single-episode generalization failed the declared rubric |
| Procedures / P07 | Isolated numeric CSV aggregation, independent held-out totals/errors, exact content/schema/permission identity, fresh publication review, policy-bound approvals, unchanged reuse and revocation | Direct callable API; automatic procedure discovery is not implemented |
| Growth / P08 | Four dimensions, timer initiation, persistent finite UTC windows, fairness, user priority, interruption and concurrent debit; serving proposal queue connected to governed evolution | Default inquiry allocation 4/day plus separate release allocation 8/day; successful proposals are not guaranteed |
| Candidates / P09 | Clean-base frozen snapshots, runtime/toolchain/governance bindings, actual isolated compilation, protected behavior/held-out checks; compiling incorrect and tampered candidates rejected | Actual live source-change admission is the next gated run |
| Review/interview / P10–P11 | Fresh contexts, strict exact identifiers/digests, bounded disputes, explicit readiness, invalid/unavailable evidence denial and live procedure review | Live source review and continuity interview remain to be observed |
| Cutover/recovery / P12–P14 | Real generation handoff and catch-up; all four stale effect receivers reject; startup failure, crash and hang with observer stopped/provider absent; current tasks/memories/cancellations survive; bounded fallback, SIGKILL journal recovery, retirement/restart | Fault scenarios use deterministic cognitive fixtures; full custodian replacement stays disabled |
| Operations / P15 | Supervised CLI bootstrap/service, direct API, recovery documentation and bounded standalone self-improvement command | Full seed acceptance remains open where the evidence column above names a gap |

## Live observations

Mistral model enumeration confirmed `mistral-large-2512`. A strict structured-output arithmetic check and a real direct-runtime task passed after the user saved the private key. The model is configured in the external credentials file. Credentials were never printed or copied into Git.

The first richer consolidation request failed because Mistral rejected `uniqueItems`. A controlled two-request diagnostic changed only that remote grammar keyword and succeeded; local duplicate-source rejection stays strict. A subsequent one-call consolidation passed all seven mechanical checks but **failed the predefined qualitative rubric** by generalizing one episode into a pattern, despite an explicit instruction. Outputs remained labeled unverified and confidence-bounded; source correction invalidated them. P06 retains this evidence-calibration follow-up. Successful JSON and publication do not prove grounded developmental judgment.

The first live numeric CSV publication attempt passed its held-out execution cases but returned incomplete review coverage, so publication was rejected. The response schema now enumerates the exact required check IDs, with strict local coverage still enforced. A separately allocated one-call Mistral review then passed; two new inputs, registry reopen and identical republish required zero additional inference. Both the failure and later success remain in external integration records.

## Review findings resolved

- Stale mutations could alter terminal tasks or completed experiments; outcomes are now immutable and allocations cannot be refilled by ordinary updates.
- Dangling SQLite symlinks and ordinary credential inspection could bypass placement/secrecy expectations; external ancestry and safe serialization are enforced.
- Interrupted growth publication could resurrect forgotten lessons; stable publication identities preserve the forget decision.
- Late results from dead workers and persistent module globals could cross authority/scope boundaries; receiver checks reject closed workers and nonlocal contexts use fresh restricted processes.
- Failed activation/stop could lose a process identity, and quiescence could omit pending command effects; durable intent and complete settling preserve recovery ownership.
- Cold startup shared a short RPC deadline; startup now has a separate bounded allowance while hung requests retain strict deadlines.
- Standalone self-improvement could drain unbudgeted user tasks; all unfinished work now defers the run before custody or inference, and total reserved calls include growth.
- Procedure approvals could be reused under a stricter host policy; registry namespaces now bind the contract, checking runtime, reviewer profile and allocation identity.
- Background release inside a growth callback could deadlock cutover; a separate durable queue decouples the callback, serializes custody and preserves pre-fence cancellation.

The first implementation checkpoint, `5ef69d0`, previously passed 67 tests with one platform skip. That historical result is superseded by the integrated result above. All actual lived prompts, completions, memories, candidate snapshots and release evidence remain under the external state directory; this repository contains source, synthetic fixtures and sanitized reports only.
