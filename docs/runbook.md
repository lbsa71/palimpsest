# Local seed runbook

Status: local supervised seed, 2026-10-08. The commands below use external durable state and restricted worker processes. See [progress](progress.md) for the separate live-provider, succession, recovery and self-improvement evidence.

## CLI integration contract (P03/P04/P08/P12)

`ask` and `serve` use the supervised generation host. First startup freezes and evaluates a clean baseline using the protected type and agent contract checks. Later startups recover the retained release even when the checkout has unrelated changes. `doctor` and `help` perform no inference, bootstrap or state writes.

While `serve` runs, growth starts automatically within the same persisted daily allocation used by `growth tick`. Completed source proposals enter a durable queue for governed evaluation, review, interview and local promotion. User tasks take priority, provider calls do not overlap, and signals stop in-flight work before releasing the coordinator lock. The authenticated local API remains responsive while inference runs. Configured Slack ingress submits through the same host.

The CLI acceptance tests use disposable clean repositories, real restricted workers, unavailable-provider fixtures and subprocess shutdown. They cover a recorded proposal reaching protected checks and an honest unavailable-review decline through the serving queue. They do not establish live Slack delivery or model quality. The background queue invokes the same governed evolution operation as an explicit release attempt; it grants no shortcut around checks or approval. Memory consolidation is not automatically scheduled by this CLI.

## Bootstrap and configuration

Use Node 24.13 or later in the Node 24 series on macOS for the currently tested sandbox. Run `npm ci`, `npm run verify`, then `npm start -- doctor` from the checkout. First bootstrap requires a clean Git checkout; resolve intended source changes through the normal review/commit process first. Tests use synthetic fixtures outside the repository. SQLite currently emits Node's experimental-feature warning.

Create `~/.config/palimpsest/credentials.env` outside the repository, mode `0600`, with `MISTRAL_API_KEY` and a verified `MISTRAL_MODEL`. Never paste keys into a task, commit them or include them in logs. The implementation session verified `mistral-large-2512` against the available-model list and bounded live calls. Environment variables override the external file.

| Setting | Meaning |
|---|---|
| `PALIMPSEST_PROVIDER` | `mistral` by default; `codex` is an explicit alternative |
| `MISTRAL_API_KEY`, `MISTRAL_MODEL` | Required for live Mistral calls |
| `CODEX_MODEL` | Explicit model when Codex is selected; existing CLI authentication is separate |
| `PALIMPSEST_DATA_DIR` | External local state directory; default `~/.local/share/palimpsest/<repository-id>/` |
| `PALIMPSEST_CREDENTIALS_FILE` | Private external credentials path |
| `PALIMPSEST_MAX_CALLS_PER_TASK` | Positive finite task allocation; default 4 provider calls |
| `PALIMPSEST_GROWTH_CALLS_PER_DAY` | Standing growth allocation per UTC day; default 4; 0 disables inference |
| `PALIMPSEST_EVOLUTION_CALLS_PER_DAY` | Separate review/interview allocation per UTC day; default 8; 0 disables new background release attempts |
| `PALIMPSEST_TIMEOUT_MS` | Positive provider timeout in milliseconds; default 120000 |
| `SLACK_BOT_TOKEN` | Private bot token for replies |
| `SLACK_APP_TOKEN` | Private app token with `connections:write` for Socket Mode |
| `SLACK_SIGNING_SECRET` | Optional signed HTTP ingress alternative when no app token is configured |
| `SLACK_ALLOWED_TEAM_IDS`, `SLACK_ALLOWED_USER_IDS` | Required comma-separated team and user allowlists for Slack |
| `SLACK_ALLOWED_CHANNEL_IDS` | Optional comma-separated channel restriction; recommended for an initial test channel |

`doctor` reports resolved paths, selected model/provider and credential presence without exposing values or contacting a provider. Its Slack configuration flags report token presence, not valid scopes, allowlists or live readiness; `liveIntegrationChecked` stays false. Missing model credentials produce an unavailable task; no provider substitution occurs. Slack is optional, but if any Slack credential is configured, `init`, `ask` and `serve` require the complete token pair and explicit team/user allowlists. `doctor` remains available with partial Slack configuration, provided the external file and other configuration are valid.

```sh
npm start -- doctor
npm start -- init
npm start -- ask "Hello"
npm start -- tasks
npm start -- memory local
npm start -- growth
npm start -- growth tick
npm start -- serve
```

`init` evaluates and retains the current clean baseline without inference or opening Slack ingress. It is optional: `ask` and `serve` bootstrap an empty installation themselves. After initialization, these commands recover the retained release rather than silently adopting edited checkout files. Startup verifies the frozen source, governance and runtime identities; an incompatible or altered artifact fails closed. Configure the intended provider/model before initialization: the frozen profile must match subsequent startup configuration. Changing it, including adding a model after bootstrapping with no model, does not silently migrate the retained release and can block recovery.

`ask` records a direct task in the `local` conversation, drains the eligible task queue, and prints that task's final or waiting state; it can also resume earlier queued work. It exits unsuccessfully unless the submitted task succeeds. `tasks` and `memory` inspect external records after taking the coordinator lock and performing interrupted-record recovery; they are not concurrent read-only clients for a running service. `growth` initializes and lists four standing dimensions. `growth tick` runs at most one eligible experiment using the persisted daily window. `serve` checks the agenda automatically without a fresh prompt. An interrupted or failed provider attempt still consumes its reservation. Restarting or manually ticking cannot refill the window. Changing a window's configured allowance after it has opened is rejected; the next UTC day opens a new allocation. See [growth runtime](growth-runtime.md) for fairness and proposal handling.

`serve` additionally schedules exact completed proposals through `EvolutionCoordinator`. Its separate default allows eight cognitive release calls per UTC day, on top of four growth inquiry calls; ordinary task calls keep their own allocation. Each release has at most one review plus seven interview calls, subject to the remaining daily allowance. A partially funded attempt can decline when its allocation runs out; it cannot raise its own budget. The queue and per-call debits are external journal records, and restart does not refund them. With evolution allowance zero, proposals remain queued; already-started probation/recovery can still finish mechanically. Manual `growth tick` records proposals but does not run this serving queue. See [source evolution](evolution.md) for cancellation and interrupted-claim rules.

## Direct API and Slack

`serve [port]` binds `127.0.0.1` and prints its actual URL, generation digest and token-file path. Omitting the port, or specifying `0`, selects an available port. Clients use `Authorization: Bearer <token>`; the token is never printed. Endpoints are `POST /messages`, `GET /tasks/:id`, `POST /tasks/:id/cancel` and `GET /events?after=<sequence>`. A submit body requires `id`, `conversationId` and `text`; optional fields are `replyTo` and `source: "direct"`. Reuse the same ID only when retrying the same input. HTTP 202 means durable acceptance, not completion; poll the task URL for its result. Requests with an Origin header are rejected. This is a trusted local operator API, not a multi-tenant access model. The `local` context has its own continuing restricted worker; other conversation requests use fresh restricted workers.

For Slack, create an app from [the app manifest](../config/slack-app-manifest.json), install it in the intended workspace, and configure its bot token and app-level Socket Mode token in the private credentials file. The app needs `app_mentions:read` and `chat:write`; the app-level token needs `connections:write`. Record the workspace, user and initial channel IDs in the allowlists, then invite the bot to that channel. Mention the bot in each request. The shared runtime preserves the Slack thread as the conversation scope and replies in that thread.

With both bot and app tokens, `serve` opens an outbound Socket Mode connection and reports its state at startup; a public HTTP endpoint is unnecessary. Initial connection failure exits `serve` and closes its listeners. After startup, ordinary refreshes and failures use bounded retry windows with a five-minute cooldown and automatic later retry; a continuously healthy connection replenishes the retry count. A disabled link stops Slack reconnection. The startup record is not a continuously updated health feed, and the local API has no Socket Mode status endpoint. See [Socket Mode](slack-socket.md) for exact bounds.

If a signing secret is supplied instead of an app token, `serve` starts signed loopback HTTP ingress and reports `slackUrl`. That listener uses a separate ephemeral port, unaffected by `serve [port]`. Configure the Slack app for HTTP event delivery instead of Socket Mode, and supply an operator-controlled HTTPS forwarding URL as its Events API Request URL. The initial manifest enables Socket Mode, so it requires that configuration change for HTTP delivery. This CLI does not publish an endpoint.

Neither transport sends a startup test message, although `serve` can resume previously queued work and deliver its results. To validate a new installation, explicitly mention the bot in the dedicated channel and check the response in that thread. Send `@Palimpsest status <task-id>`, `cancel <task-id>` or `correct <task-id> <replacement text>` in the same originating thread, mentioning the bot each time. Task IDs are available through the local task/event records; ordinary result text does not automatically include them. See [communications](communications.md) for delivery and acknowledgement semantics. Local fixture checks do not prove live workspace connectivity.

## State, shutdown and interrupted work

The external directory contains `state.sqlite`, `coordinator.sqlite`, `api-token`, frozen releases and custodian state. It can contain private conversation text and cognitive evidence. A checkout or Git clone is not a backup of lived experience.

Only one CLI coordinator may own the directory. Stop `serve` before using another state-owning command. `SIGINT` and `SIGTERM` close ingress, cancel provider work, stop growth and workers, then release state ownership. Handlers are installed before startup work drains. On restart, the exclusive lock establishes that the earlier coordinator no longer owns execution before interrupted records are recovered. Do not delete a lock to bypass a live owner.

Custodian health ticks do not overlap. Before a queued release starts, it waits for the existing health tick and stops the growth scheduler. Ordinary health polling stays suspended while that bounded release runs; the evolution coordinator owns its probation observations. Recovery can therefore wait for bounded evaluation/provider work to yield, and dead or expired workers fail the receiving authority checks. User ingress remains responsive and aborts pre-fence release cognition. The last cancellation check runs after artifact verification and before the authority fence; after fencing, mechanical transfer/recovery finishes. Cutover quiesces background growth without waiting on its own proposal callback. Normal or probation service can resume a fresh growth scheduler against the same durable allowance. Provider calls are serialized across user tasks, growth and all release roles. Candidate-authored proposals cannot raise budgets, edit the live checkout or publish Git changes through the scheduler.

Tasks with uncertain outgoing effects stay in `waiting_for_provider` with `effect_reconciliation_required`; that state does not authorize another provider or delivery attempt. Inspect the destination independently before resolving uncertainty. No automatic replay is permitted.

Logical forgetting removes memory versions from retrieval, but task records, SQLite WAL/backups, earlier snapshots and external providers can retain related content. Full erasure is not implemented. For a consistent development backup, stop the coordinator and copy its complete external directory to a private external backup location. Backup/restore compatibility across releases still requires the separate P15 demonstration.

## Operating limits

Restricted candidate execution is currently tested on macOS; unsupported isolation platforms fail closed. Resource and process boundaries are documented in [isolation](isolation.md). Cognitive review, interview acceptance, live Slack connectivity and a particular self-modification require their own recorded evidence; the availability of these CLI commands does not establish them. Review [progress](progress.md) before relying on a release demonstration.
