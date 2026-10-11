# A1-L07 bounded component handoff

Evidence labels: **implemented**, **fixture-verified**, **integrated with actual
shared storage/runtime/effects and L05 obligations**. Full lane acceptance,
authenticated live communication and deployment are pending.

Component source revision: `d4f66a1`, following implementation `7003905`.
Worktree: `/home/palimpsest/migration/aeon-1-20261011/communications`.
Branch: `codex/a1-communications-20261011`.
Owner: `/root/a1_communications`, finite component/integration/handoff goal.
Contract: `aeon1.c1.v1`, initial worktree base `4e55167`.
Dependency picks for testing: runtime fix `3829fab` (local `216cc2d`), initiative
`fe834bd` (local `9105a3a`) and `3069602` (local `f74eaf7`). Root must integrate
those originals; the communications handoff commits own only communications/lane
and evidence paths. No root configuration, lockfile or shared-runtime edit was made.

## Observable behavior

| Tasks / requirements | Implemented and observed evidence |
|---|---|
| T01 / RW09, RW11, RW12 | Actual HTTP admission/status/cancel over real DurableRuntime; credential-derived actor/audience/eligibility, forbidden privileged body fields, output authorization before host outbox callback; status/control remain responsive while shell waits |
| T01 / RW16 | Trusted `parentRunId` binds separate conversation runs to one ResourceLedger envelope; the second run blocks before another effect when aggregate requests are exhausted |
| T02 / RW09, RW11, RW12 | Authenticated configured Slack team/channel intake; mention joins durable thread; normal replies preserve each author; modification eligibility separate; foreign author/origin and conflicting duplicate rejected |
| T03 / RW10, RW11 | Actual local mock Slack HTTP history/replies cursor pagination; restart adapter resumes saved cursor; first offline mention in an unjoined retained parent joins before ordinary missed reply; live/history delivery deduplicate in shared SQLite |
| T03 / RW10, RW11 | Rate-limit retry deadline remains durable; permission/retention/lookback/protocol gaps exposed; conflicting page rolls back admissions and cursor; already joined threads scan even when channel history has no parent |
| T02–T03 / RW11, RW12 | Authenticated Socket Mode bot identity/app link; bounded reconnect; automatic recovery loop; durable intake before ACK; foreign token and malformed event produce no successful admission/ACK |
| T04 / RW10, RW11, RW12 | Source revision interrupts correct active run and survives resumption; stale revision cannot overwrite current input; explicit target controls require conversation/origin registration or trusted host whitelist |
| T04 / RW09, RW10, RW12 | Explicit fenced speech receiver, exact configured channel/thread/audience, forbidden model-supplied authority/scope/client ID; lost receipt stays unknown without retry; paginated bot/client-ID/destination reconciliation confirms actual receipt |
| T04 / RW10, RW11 | Joined real Runtime + EffectJournal + L05 ObligationRegistry: lost speech response blocks run and keeps owed report delivering; one external mock post; confirmed bot receipt then closes current obligation |
| T05 / RW19 | Twenty-three deterministic/local integration tests, strict typecheck and compiled build; no live Slack or paid model execution |

All communication source is fresh design. Retired source was not copied or retained.
The failure lessons come from the active lane/requirements: don't equate connection
with intake recovery, generated text with delivered speech, or scope visibility with
cross-conversation control. No third-party package was added; Node supplies the
transport primitives and the existing shared SQLite engine supplies operational
state. Root's tool router can inject the speech receiver under `speech.send`.

## Commands and observed results

Node: `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` (24.13.0).
Worktree dependencies use an ignored symlink to root `node_modules`.

Final component revision checks (before the documentation-only evidence commit):

```sh
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH npm run check
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH node --test packages/communications/test/*.test.ts
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH npm run build
```

All exited 0. Component tests: **23 passed, 0 failed/skipped/cancelled**.
The real HTTP workload's status/cancel assertion remained below 1,000 ms; the
entire final HTTP concurrent-workload test took 53.54 ms. This is local fixture
latency, not production/network latency. Entire communication suite took 985 ms.
The production SlackClient regression uses actual fetch against a local HTTP
server for `apps.connections.open`, `chat.postMessage`, redirect rejection and
streamed response-byte bounds.

Earlier aggregate `npm run verify` passed strict typecheck, **129 tests** and
compiled build with then-current communications/initiative source. Later changes
added constructor/network/output/aggregate-budget regressions and passed the
final 23-case suite/typecheck/build; the earlier aggregate total is not presented
as the final exact-source total.

Observed defects preserved: first test run found an expired rate-limit retry
deadline still persisted and cleared it; queued no-op scheduling callbacks used
a closed test database and were removed unless configured. Joined L05 integration
exposed a receipt validator requiring model-supplied client ID; L05 `3069602`
resolved it. Parent review found an over-restrictive Slack method regex that would
reject actual Socket Mode and camel-case speech methods; the actual SlackClient
network regression now covers both. Parent also required the shared parent
resource envelope, now exercised across distinct conversation runs. These are
resolved engineering findings; full fresh review acceptance has not occurred.

## Next owner and honest limits

Root L09 integrates `7003905`, `d4f66a1` and this evidence commit, then assembles
host scheduling, registered speech targets, direct outbox, transports and process
authority. `CommunicationsCore.onReady` is a nonblocking wake-up hint: host must
recover durable work and resume active runs after steering is acknowledged. The
package README is the exact configuration/export guide.

Recovery first-mention coverage includes configured channel parents inside the
declared root-history lookback and their retained replies, plus already joined
threads' messages inside the declared window. A first mention in an older,
previously unjoined parent outside that window is not guaranteed. Edits to messages
whose original timestamps are outside backfill coverage require live delivery.
Missing scopes or retention may prevent recovery; gaps are durable scoped
observations. Unverified retention is explicitly recorded. Traversal completion
does not certify gap-free recovery. Slack may require separately scoped read
credentials for channel replies; root must qualify the actual configured token.

No universal exactly-once claim: history may lack retained client IDs, bot
provenance, permissions or old messages. Those unknown outcomes remain on hold.
Root must reconcile physical resource receipts and current obligations before
deciding a new effect is safe. Current report revisions and independently
confirmed receipts remain L05-owned.

Authenticated live Slack/API smoke, complete host/tool scheduler assembly,
communication-specific process crash drills, fresh independent review and H1
remain **unperformed/pending**. No credential values were read, no private
transcript was collected, no external Slack message was sent and no paid call was
made. Available private credentials belong to root's later authorized live task.
