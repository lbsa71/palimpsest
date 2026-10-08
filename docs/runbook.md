# Local seed runbook

Status: first implementation slice, 2026-10-08. This is not yet a production or Skin Shed recovery runbook. See [progress](progress.md) for verified behavior.

## Bootstrap and configuration

Use Node 24 on macOS for the currently tested sandbox. Run `npm ci`, `npm run verify`, then `npm start -- doctor` from the checkout. Tests use synthetic fixtures in temporary directories outside the repository. SQLite currently emits Node's experimental-feature warning.

Create `~/.config/palimpsest/credentials.env` outside the repository, mode `0600`, with `MISTRAL_API_KEY` and a verified `MISTRAL_MODEL`. Never paste the key into a task, commit it, or include it in logs. The local implementation session verified `mistral-large-2512` against the available-model list and two bounded live calls. Environment variables override the external file.

| Setting | Meaning |
|---|---|
| `PALIMPSEST_PROVIDER` | `mistral` by default; `codex` is an explicit alternative |
| `MISTRAL_API_KEY`, `MISTRAL_MODEL` | Required for live Mistral calls |
| `CODEX_MODEL` | Explicit model when Codex is selected; existing Codex authentication is separate |
| `PALIMPSEST_DATA_DIR` | External local state directory; default `~/.local/share/palimpsest/<repository-id>/` |
| `PALIMPSEST_CREDENTIALS_FILE` | Private external credentials path |
| `PALIMPSEST_MAX_CALLS_PER_TASK` | Positive finite call allocation per task; default 4 |
| `PALIMPSEST_TIMEOUT_MS` | Positive provider timeout in milliseconds; default 120000 |

`doctor` reports resolved paths, model/provider selection and credential presence without exposing values or contacting a provider. Missing credentials or a missing model produce an honest unavailable task; no automatic provider substitution occurs.

## Current commands

```sh
npm start -- doctor
npm start -- ask "Hello"
npm start -- tasks
npm start -- memory local
npm start -- growth
npm start -- growth tick
npm start -- serve
```

`ask` durably records a direct task and prints its final/waiting state. `tasks` and `memory` inspect current external records. `growth` initializes the four standing agenda entries; `growth tick` runs at most one eligible experiment. Follow-up entries begin with zero allocation. Continuous scheduling is not yet integrated into `serve` at this checkpoint.

`serve` binds loopback and prints the actual URL and token-file path. Clients send the token as `Authorization: Bearer <token>`; the token is never printed at startup. Endpoints are `POST /messages`, `GET /tasks/:id`, `POST /tasks/:id/cancel`, and `GET /events?after=<sequence>`. Requests containing an Origin header are rejected. This is a trusted local operator API, not a multi-tenant access model. See [communications](communications.md) for payloads and Slack adapter behavior.

## State and interrupted work

The external directory contains `state.sqlite`, `coordinator.sqlite` and `api-token`. The database includes tasks, events, effects, memory and growth. It may contain private conversation text. A source checkout or Git clone is not a backup of lived experience.

Only one CLI coordinator may own the directory at a time. Stop a serving coordinator before another command takes ownership. On startup, the exclusive lock establishes that the old coordinator no longer owns execution before interrupted work is recovered. Do not manually delete a lock to bypass a live owner.

Tasks with uncertain outgoing effects stay in `waiting_for_provider` with `effect_reconciliation_required`; the name does not mean a provider retry is safe. Inspect the actual destination before resolving uncertainty. No automatic replay is permitted. Growth calls consumed before interruption remain consumed.

Logical memory forgetting removes stored memory versions from retrieval, but task records, SQLite WAL/backups, derived contexts and external providers may retain related content. Full erasure is not implemented. For a consistent development backup, stop the coordinator and copy the complete external state directory to a private external backup location; backup/restore compatibility across releases still requires the P15 demonstration.

## Current limitations

Live Mistral smoke passed; native Codex and Slack checks are tracked independently. The Slack adapter has no configured running ingress service yet. The existing runtime does not yet make a complete self-modifying deployment. Candidate freezing, review, custody, cutover and recovery must be integrated and tested before promotion is enabled. Candidate confinement is macOS-specific; unsupported platforms fail closed. See [isolation](isolation.md) for resource-limit boundaries.
