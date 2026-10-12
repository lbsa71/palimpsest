# First live Slack pilot

Status: implementing, 2026-10-12. Owner: `/root`, branch `codex/aeon-slack-pilot-20261012`, base `debadd9`. User instruction: get the reworked Autark running and usable through Slack; repair only actual launch/conversation blockers. All delegated work uses `gpt-6.1-sol` / high. The broader Aeon 1 repair, DI and qualification backlog remains paused.

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

Only fix defects reproduced on this path or demonstrated to compromise its result. Do not expand into hypothetical adapter faults, full DI closure, comparator benchmarks, developmental recorder qualification or successor activation. Existing open findings remain open. Engineering startup is not H1 or product qualification. Record actual checks rather than synthesizing passing evidence.

## Evidence

Preparation in progress. No live inference, service activation or Slack conversation has yet been claimed.

### Observed launch blocker: installed runtime path

The first direct smoke task reached the ordinary runtime but stopped before any model request: `Runtime mount overlaps protected storage`. The installed bootstrap copies Node into `state/boot/targets/.../node` and forwards that path to the worker, whose existing confinement correctly refuses a runtime mount inside protected state. This is a concrete pilot blocker; no hypothetical-fault repairs are in scope.

Root claims the private systemd drop-in for this pilot: select the existing frozen `deployment/cli.ts supervise` entrypoint using `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`, retaining the same admission, current state, bounded volumes, delegated resources, and unit restrictions. Clear the bootstrap-specific stop hook. No production source or sandbox rule changes. This engineering pilot does not enable automatic coordinator self-evolution; later installation work owns that integration defect. Preserve the original bootstrap failure and review the direct-entry configuration before activation.

### Observed conversation blocker: normal Mistral completion

After the entrypoint correction, actual Large4/high inference executed `/runtime/node -e "console.log(6 * 7)"`, observed exit 0/stdout 42 and delivered explicit direct speech. The subsequent HTTP 200 model completion was rejected as `Invalid Mistral tool calls`, leaving the run blocked. The parser rejects `tool_calls: null` even though its following iteration already treats absent/null calls as an empty list.

Root delegates PILOT-02 repair to `/root/model_iteration_readiness`, Sol/high, exclusive writes `packages/agent-shell/mistral.ts` and new `packages/agent-shell/mistral-null-tools.test.ts`. Establish the narrow behavior with nullable no-call completion, existing valid calls and genuinely invalid non-array payloads; change only the demonstrated completion parser boundary. Use focused transport checks and strict compilation. No other review/DI repairs. Root owns integration, fresh candidate/review and ordinary staged activation preserving the current state and allowance.

Author result: nullable completion reproduced with 2 passing/1 failing focused case before the fix; after the one-line change, 22/22 new and existing shell cases and strict TypeScript pass. Malformed non-null nonarrays still fail. No broad backlog repair was made. The configured direct supervisor restart preserved all 12 retained memory/effect/request/outbox rows byte-for-byte (SHA-256 `27afc454698955b45c98541203e8b5f30408353a3bb0fa5b929fc1512b42e94a`), including the original 3 model/2 tool requests and USD 0.04284746 charged usage. Slack recovery resumed, with no transport-error event observed. The normal retention-coverage limitation remains explicit.
