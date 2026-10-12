# DI07 independent communications review

Reviewer `/root/a1_environment_communications_review`; branch `codex/a1-environment-di-07-review-20261012`; base `2e2004a`, joined implementation `8d43f54`, author production `31e4a61`, author handoff `87f2e56`, root fixture correction `2bb37d1`. Exclusive writes are this file and `deployment/environment-di-07-review.test.ts`. Source and every prior predicate remain read-only.

```text
/goal Independently decide accepted or changes-required for the bounded DI07 communications injection and root fixture correction, using held-out explicit adapter/controlled-real Store cases, exact allowed prior checks and strict compilation; preserve failures and hand off exactly two new files without source repair or repair waiting.
```

## Frozen independent criteria before new tests

The parent provided prior receipt totals; this review does not infer acceptance from them. Governing contracts are AGENTS/REQUIREMENTS/PLAN, workflow, A1-L07, adopted DI plan and DI01, and the final execution claim. Tests will challenge captured per-instance transport/time/listener callbacks; request timeout and abort cleanup across successful, failed, rejected and partially read responses; original plus cleanup failure preservation; socket listener registration/removal/close ordering under reentry and errors; durable admission before ACK using actual Store state; recovery retry and immutable page windows through clock failures/rollback, cancellation and Store reopen; authenticated direct handler provenance, body bounds and audience access. Explicit injected adapters must fail without an ambient fallback. Unknown dispatched speech must remain unresolved without automatic retransmission (also checked by the unchanged affected suite).

Acceptance requires all meaningful held-out predicates, exact prior 28 author + 1 provenance + positively enumerated 19 in-process cases and strict compilation, with exact old-fixture byte/assertion audit. Any causal failure is preserved and results in changes-required; no source or prior test repair. No real socket, listener, loopback, network, Slack/provider/native/physical process, credentials, full benchmark, installation or deployment is authorized. DI14, DI09, DI28 and live/H1 remain separate.

## Execution and disposition

**Changes required.** Independent precode is `290f25e`. Four held-out failures remain unchanged in the new test file: three reproductions of undisposed response bodies and one reproduction of lost original failure diagnostics. Ten other held-out cases and all 48 required prior cases pass. Strict compilation and diff checks pass. No implementation or previous test was changed, and the finite review ends without waiting for a repair.

### Findings

| ID | Severity / source at `31e4a61` | Observed failure and required disposition |
|---|---|---|
| DI07-R1 | P1; `packages/communications/slack/client.ts:24–26` | After receiving a response, post-dispatch cancellation, HTTP429 and other non-OK statuses throw before acquiring a reader. The outer finally only cancels the request timer. Three held-out cases supply actual controlled `Response`/`ReadableStream` objects; each observes zero stream cancellations when the request settles. The 429/503 bodies remain unread and uncancelled even though retry/backfill may continue, risking retained transport resources. The late-after-abort case also leaves the returned body open. Own and dispose every received response on all terminal paths, without introducing write retries or losing the original API/abort error if cleanup also fails. The tests explicitly cancel the bodies in fixture finally blocks after recording the failure, so this review itself leaves no stream open. |
| DI07-R2 | P2; `packages/communications/slack/client.ts:29` | The unconditional `reader.releaseLock()` in finally replaces any read failure or composed read/cancel failure if unlock throws. A supplied reader reports distinct read, cancel and unlock errors; all three operations occur once, but the caller receives only the unlock error. Preserve all original and cleanup failures through the injected boundary. This is deterministic adapter fault-injection evidence; no claim is made that a normally settled native reader routinely throws during release. |

R1 concerns production lifecycle behavior that the new environmental boundary is required to make observable and clean up; it is not an authorization or live-network result. R2 follows the frozen DI01 cleanup-failure preservation contract. Both remain ordinary failing assertions, not skips, expected failures or weakened predicates.

### Independent evidence and static review

The fourteen held-out cases use receiver-independent explicit callbacks/manual timers and in-process socket/listener objects, plus controlled temporary SQLite stores. Passing checks show:

- A second SQLite connection observes committed input/run state inside the ACK callback. A real SQLite trigger then rejects the next intake write; no ACK is sent, and prior run/input/thread state remains intact.
- Synchronous socket close while registering its first listener removes that listener and closes exactly once, prevents further registration and does not admit/ACK messages. NaN, infinity and negative connection clocks fail explicitly and drain sibling recovery work without constructing a socket or falling back to host time.
- A response byte-bound failure cancels/unlocks its reader once while preserving simultaneous timer cleanup failure. Delay cancellation retains a non-Error abort reason plus cleanup failure. Timeout cancellation uses the captured cancel method, removes the parent listener even when cancel throws, and stays idempotent.
- A page-gap clock failure leaves no gap/admission and preserves the current page for a later valid retry. Real Store close/reopen retains rate-limit deadline and exact cursor/window/page size across wall-clock rollback. Concurrent tick refusals do not accidentally release the active invocation's latch.
- Reentrant listener construction cannot replace the captured authenticator or health callback, and a second handler has its own authentication disposition. Existing prior tests independently cover privileged fields/body bounds/audience checks, detached transport/timer/clock identity, instance isolation, backoff caps/reset, unknown sends and authentic receipt reconciliation without resending.

Static inspection of all six owned production files confirms ambient fetch, wall/monotonic clock, Node timer, socket and listener construction references are confined to the named `createNodeCommunicationsEnvironment` factory. The fully supplied path does not invoke that factory; imported functions do not create sockets or listeners. Supplied transport/timer/clock/listener/callback identities are captured, with bound native/API receivers where needed. Signature verification retains explicit input hashing and replay-window checks. Core authority/provenance checks, page/byte limits and egress effect semantics remain present. This bounded source inspection does not claim whole-system environmental closure; outside-slice application wiring and core scheduling remain separate owned work.

### Exact root fixture audit

Compared the joined `packages/communications/test/communications.test.ts` with `d062388` using byte equality outside the single named foreign-token/malformed-event test. Inside that test, a script reconstructed the entire new string from exactly three replacements: add `identityRejected=false` to the existing counters; append the identical `onError:()=>{identityRejected=true;}` callback to constructor options; remove its later declaration/options mutation. Reconstruction equals the joined case byte-for-byte. Every assertion, polling limit, fake socket behavior and other byte is retained. The joined whole file also equals `2bb37d1` exactly; SHA256 is `8a78992f783574515bb9ca289d885f71e74444c9f6b0744a518b49ffae218d8a`.

All six production files independently compare byte-for-byte with `31e4a61`. The corrected case passes in the exact positive 19-case run below. The root fixture correction is accepted as a wiring-only adaptation; it does not resolve R1/R2 or imply DI07 acceptance.

### Commands and receipts

Worktree `/home/palimpsest/migration/aeon-1-20261011/environment-di-07-review`; Node `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` v24.13.0; ignored dependency symlink `node_modules -> /home/palimpsest/src/palimpsest/node_modules`, no installation. All test and strict commands ran serially. Exact receipts:

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 deployment/environment-di-07-review.test.ts
# exit1; 14 tests, 10 pass, 4 fail, 0 cancelled/skipped/todo.
# /tmp/di07-review-heldout.log
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 deployment/environment-di-07.test.ts deployment/slack-proposal.test.ts
# exit0; 29/29 pass, 0 cancelled/skipped/todo.
# /tmp/di07-review-author-provenance.log
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 --test-name-pattern='^(?:unbounded recovery or reconciliation configuration is rejected|distinct conversation runs share the trusted host parent resource envelope|same runtime admission is durable, authenticated, conflicting duplicates rejected and author eligibility separate|mention joins thread, ordinary follow-up steers same run and edited input reaches original run|reordered recovered revisions cannot steer newer input backwards; controls and target bound to dedup|control of an old completed run preserves the thread current run mapping|revised input interrupts its running run and persists correction for resumed execution|Slack live/history delivery race and restart deduplicate into same durable run|rate-limit preserves cursor and retry deadline; permission and retention gaps remain visible|atomic cursor/admission rollback retains current page after conflicting history|known joined threads are scanned even if channel history contains no parent, with explicit coverage gap|signature authentication rejects altered body and replay timestamp|Socket Mode authenticates tokens, commits before ACK, reconnects and invokes recovery automatically|Socket Mode rejects foreign token identity and does not ACK malformed event intake|explicit speech creates actual receipt; unregistered targets and forged authority/scope cannot send|lost send receipt reconciles durable effect using paginated client_msg_id without resending|missing receipt remains uncertain through bounded scans or missing permission; no automatic retry|matching client ID from another author never confirms delivery; matching bot survives Slack text sanitization|joined actual runtime speech and obligation registry hold unknown delivery until bot receipt reconciles)$' packages/communications/test/communications.test.ts
# exit0; exactly 19/19 pass, 0 cancelled/skipped/todo; four loopback tests absent.
# /tmp/di07-review-old-positive.log
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
# exit0; /tmp/di07-review-strict.log empty.
git diff --check
# exit0.
```

The four preserved held-out diagnostics are `rejected response remains unread and uncancelled` twice (0 !== 1), `late transport response leaked its body` (0 !== 1), and `original read failure lost`. No test or implementation correction followed that run. The only preliminary shell failure was `ls -l node_modules` reporting a missing ignored symlink; it was created at the provided existing dependency location before checks. SQLite emitted its normal experimental warning. There were no other review test/strict failures to omit.

Combined execution: **58 pass / 62 tests; 4 retained failures**. No loopback, actual listener/socket, external network/Slack/provider, native comparator, physical child process, private credential, deployment or benchmark was invoked. The author's earlier negative-pattern loopback incident remains disclosed in the author evidence and was not repeated here. No new global/module monkeypatch was used.

Next owner: root should stage a bounded SlackClient response-disposal/error-preservation repair against these unchanged independent predicates, then obtain fresh review. DI14 application propagation, DI09 Store internals, DI28 whole-system closure, live Slack/HTTP/recovery and H1 remain unaccepted/separate. The final scoped commit is the review handoff identity reported to root.
