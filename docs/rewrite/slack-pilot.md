# First live Slack pilot

Status: live Slack pilot and requested ingestion indicator deployed, 2026-10-12; live visual indicator confirmation is pending the next user message. Handoff: `/root`, branch `codex/aeon-slack-pilot-20261012`, base `debadd9`. User instruction: get the reworked Autark running and usable through Slack; repair only actual launch/conversation blockers, plus the subsequent explicit request for an ingestion reaction. All delegated work uses `gpt-6.1-sol` / high. The broader Aeon 1 repair, DI and qualification backlog remains paused.

## Finite outcome and ownership

Aeon 1 → A1-L09 integration, with A1-L02 model and A1-L07 communications tasks.

```text
/goal Launch one fresh engineering instance of the reworked Autark with the selected Mistral model and existing authorized Slack installation; verify model/tool execution, Slack connectivity and durable restart, record the actual result and limits, and leave the service available for the user's conversation.
```

Root owns this record, PLAN/RESUME/execution/lane status updates, new private host configuration, provisioning and activation. No production source change is pre-authorized by this claim: claim exact files and the observed blocker here before editing. Historical services/data/grants remain unchanged. A new pilot has its own finite allowance and fresh state; it does not reset earlier attempts.

| Task | Owner and scope | Acceptance |
|---|---|---|
| PILOT-01 startup | Sol startup investigator, read-only code; root prepares host artifacts | Existing admission and installer paths produce a running engineering instance |
| PILOT-02 model | Sol model investigator, read-only account/model metadata; root performs bounded inference | Exact selected model, high reasoning, actual response and tool observation |
| PILOT-03 Slack | Sol communications investigator, read-only auth/config; root activates service | Correct bot/team/channel, live Socket Mode intake, speech capability and conversation evidence |
| PILOT-04 continuity | Root, isolated pilot state and service | Restart retains state/usage and service reconnects; truthful evidence and user entry point |

Only fix defects reproduced on this path or demonstrated to compromise its result, and implement the explicitly requested ingestion indicator below. Do not expand into hypothetical adapter faults, full DI closure, comparator benchmarks, developmental recorder qualification or autonomous succession. The bounded repairs and requested feature still use ordinary admission and release. Existing open findings remain open. Engineering startup is not H1 or product qualification. Record actual checks rather than synthesizing passing evidence.

## Evidence

The fresh engineering instance is installed as `aeon-pilot.service`, enabled at boot. It uses the existing authorized Slack installation and a separate pilot state at `/var/lib/aeon-pilot/host-data/work/state`; historical services, grants and state remain preserved. Private configuration and credentials are under `/etc/aeon-pilot`; preparation, authentic independent reviews, admission receipts and smoke results are retained at `/home/palimpsest/migration/aeon-slack-pilot-20261012` with restricted permissions.

The provider account advertised `mistral-large-4-0` with reasoning and function calling. The pilot selects that exact model at high effort, a bounded 32,768-token context, 8,192 maximum output tokens and at most 12 model requests per slice. Its new root allowance is USD 5 total, 256 requests, 1,000,000 tokens and seven days from allocation. Conversation caps are USD 1.25, 64 requests and 250,000 tokens within that root allowance. Budget exhaustion does not authorize replenishment. Startup initiative is disabled; the paused repair backlog is not seeded into this instance.

The existing Slack bot is `@palimpsest`. Mention it in the configured channel, then continue in the same thread. Intake and speech are restricted to that channel. Bot authentication, Socket Mode connection opening and channel history access passed actual read-only checks; live recovery advances with no transport errors observed. Direct messages are not qualified. Slack's possible omission of deleted/expired history remains an explicit retention gap.

The service runs within the installer's bounded volumes, process resources and confinement. A pilot-specific systemd drop-in selects the direct supervisor entrypoint as explained below. This disables the automatic bootstrap/coordinator evolution route for this pilot; later installer changes must account for `/etc/systemd/system/aeon-pilot.service.d/pilot-entrypoint.conf`. The external autonomous evaluator remains unavailable. Engineering startup and this bounded repair do not establish H1, full self-improvement or broad backlog acceptance.

### Observed launch blocker: installed runtime path

The first direct smoke task reached the ordinary runtime but stopped before any model request: `Runtime mount overlaps protected storage`. The installed bootstrap copies Node into `state/boot/targets/.../node` and forwards that path to the worker, whose existing confinement correctly refuses a runtime mount inside protected state. This is a concrete pilot blocker; no hypothetical-fault repairs are in scope.

Root claims the private systemd drop-in for this pilot: select the existing frozen `deployment/cli.ts supervise` entrypoint using `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`, retaining the same admission, current state, bounded volumes, delegated resources, and unit restrictions. Clear the bootstrap-specific stop hook. No production source or sandbox rule changes. This engineering pilot does not enable automatic coordinator self-evolution; later installation work owns that integration defect. Preserve the original bootstrap failure and review the direct-entry configuration before activation.

### Observed conversation blocker: normal Mistral completion

After the entrypoint correction, actual Large4/high inference executed `/runtime/node -e "console.log(6 * 7)"`, observed exit 0/stdout 42 and delivered explicit direct speech. The subsequent HTTP 200 model completion was rejected as `Invalid Mistral tool calls`, leaving the run blocked. The parser rejects `tool_calls: null` even though its following iteration already treats absent/null calls as an empty list.

Root delegates PILOT-02 repair to `/root/model_iteration_readiness`, Sol/high, exclusive writes `packages/agent-shell/mistral.ts` and new `packages/agent-shell/mistral-null-tools.test.ts`. Establish the narrow behavior with nullable no-call completion, existing valid calls and genuinely invalid non-array payloads; change only the demonstrated completion parser boundary. Use focused transport checks and strict compilation. No other review/DI repairs. Root owns integration, fresh candidate/review and ordinary staged activation preserving the current state and allowance.

Author result: nullable completion reproduced with 2 passing/1 failing focused case before the fix; after the one-line change, 22/22 new and existing shell cases and strict TypeScript pass. Malformed non-null nonarrays still fail. No broad backlog repair was made. The configured direct supervisor restart preserved all 12 retained memory/effect/request/outbox rows byte-for-byte (SHA-256 `27afc454698955b45c98541203e8b5f30408353a3bb0fa5b929fc1512b42e94a`), including the original 3 model/2 tool requests and USD 0.04284746 charged usage. Slack recovery resumed, with no transport-error event observed. The normal retention-coverage limitation remains explicit.

The independent Sol reviewer inspected the exact frozen successor and separately passed the same 22 focused checks plus strict compilation. It verified unchanged model/configuration, grants, prompts and dependencies. Root staged and activated the control change under the incumbent engineering policy. The same direct conversation then reused its retained command observation, explicitly delivered a second reply and reached `completed` without executing the command again. Actual accumulated usage at that point was five model requests and three tool requests, 55,366 charged tokens and USD 0.0785182, with no unresolved request reservations. This is a real model/tool/direct-conversation result; a user-originated Slack exchange is a separate check.

Fresh independent Sol review verified the completed run and exact preservation of the original 12 evidence rows and grants. Root submitted that authentic evidence through the incumbent-policy probation route; the parser successor was accepted. The user then confirmed a successful live Slack reply: “it answered, and with a good answer.” This completes the ordinary live conversation check.

### User-requested deterministic Slack receipt

The user additionally requested an `eyes` reaction immediately on ingestion, removed after a delivered AI reply. This is a specific new communications feature, not a resumption of the repair backlog. Aeon 1 / A1-L07, PILOT-05; root owns `config/slack-app-manifest.json`, pilot/status evidence and host activation. `/root/model_iteration_readiness`, Sol/high, owns new `packages/communications/slack/activity.ts`, new `deployment/slack-activity.test.ts`, and the narrow composition hooks in `deployment/application.ts`; communicate before expanding these paths.

Finite outcome: automatically add `eyes` to each newly ingested authorized Slack message and remove it after successful speech delivery for its current run, without model decisions or extra inference. Failed speech leaves the indicator; unrelated/direct/bot/duplicate events do not generate reactions. Retain small durable per-message state so restarts and duplicate delivery are idempotent. Serialize add/remove per message; pending or failed reaction calls must not block conversation or change a successful speech receipt. Fence API mutations with the current host authority, use injected Slack API and storage, and bound retries. Record missing scope as a visible operational limitation. Verify the lifecycle with a fake Slack API, focused existing communication/application checks and strict compilation, followed by independent Sol review and ordinary staged release. No further fault-search or general DI work is authorized.

Initially, the installed bot's actual OAuth scopes lacked `reactions:write`, which [Slack requires for reactions](https://docs.slack.dev/reference/scopes/reactions.write/). Root added it to the repository manifest; the app owner needed to reinstall/reauthorize because existing bot/app tokens cannot grant themselves additional scopes. User conversation remained available during this preparation.

The user added the scope and reinstalled the app. A fresh actual `auth.test` confirmed the same bot/team and granted `reactions:write`; source and installed credentials still match, so no token replacement was needed.

Feature source is `79c5a14`: 102-line durable activity manager, narrow application composition, five focused tests and the manifest scope. The handler uses each incoming message's actual timestamp, persists a per-effect message batch before speech dispatch, and removes only after successful dispatch or later reconciliation. Add/remove calls for one message are serialized; reactions cannot change a speech result or block inference. Transient attempts are capped at three, and missing scope stops repeated polling until process restart. It is enabled only when Slack speech is enabled. No model prompt, model profile, allowance or dependency changed.

Author validation: new five plus existing 23 communications cases passed 28/28; final direct-success assertion passed in a fresh 5/5 run; five precisely selected existing application intake, report-reconciliation, health and shutdown checks passed; strict TypeScript and diff checks passed. Independent Sol review of frozen candidate `4db012639fd1136731ab1347d377dec3c656114d3fc021f7c0ef5939596f4726` separately passed artifact verification, the 28 focused cases (zero skips) and strict compilation. Root staged and activated it under the previously accepted parser policy.

The policy-registry restart occurred while a user Slack turn was in flight. Its original uncertain request remains charged and retained; ordinary recovery made a subsequent request, which reached the configured 8,192-output-token limit and left that turn blocked. No allowance was reset or uncertain request replayed as a known success. The user was told the interruption and invited to continue the retained thread. This does not invalidate the earlier successful live conversation, but is not a claim that every open turn completed.

Fresh independent activation review verified the exact running candidate and original grants, and reproduced the original 12-row retained-evidence hash. Root accepted probation through the incumbent parser-policy path with that authentic engineering evidence. Current accepted policy is `1fe7dddc405906ec21080e22c120e4016a22637e9c024fd15b1874349f195bf9`. The service is enabled and running with authenticated admission available and activity health `missingScope:false, pending:0, failed:0`. No new Slack message arrived after activation during this handoff, so no live emoji lifecycle is claimed; the user has been invited to check it. The scoped feature is implemented and deployed, and that visual confirmation remains distinct from the passing automated lifecycle checks.

## Operational handoff

- Mention `@palimpsest` in the existing configured Slack channel and continue in its thread. DMs are unqualified.
- Service: `aeon-pilot.service`; use `sudo systemctl status aeon-pilot.service` for liveness. Avoid restarting during a running turn. The fixed service retains pilot state and allowance rather than creating another fresh instance.
- Accepted candidate: `4db012639fd1136731ab1347d377dec3c656114d3fc021f7c0ef5939596f4726`; feature source `79c5a14`, parser source `3e9f28d`, original scope `5efba59`.
- Host configuration: `/etc/aeon-pilot/host.json`; durable state and artifacts: `/var/lib/aeon-pilot/host-data/work/`; private review/proof receipts: `/home/palimpsest/migration/aeon-slack-pilot-20261012/`. The systemd direct-entry drop-in is still required; do not silently replace it with the known failing bootstrap path.
- Startup development remains disabled. Automated external evaluation and full autonomous evolution are not qualified. Do not restart the broader repair backlog from historical claims or replenish exhausted/uncertain grants without new authorization.
