# A1-L02 implementation session 1

Owner: Codex `/root/a1_shell`; branch `codex/a1-shell-20261011`; base `14c7420`; C1 `f11a25b`. This bounded session used local Node 24.13.0, TypeScript 7.0.2, Node definitions 24.19.1 and TypeBox 1.3.27. No credentials were read, no paid models called, no messages published and no production service started.

## Implemented behavior

The replaceable C1 `ShellPort` uses the actual pinned Pi loop with a narrow selected local source closure and an owned Mistral HTTP transport. Final exact JSON payloads and manifests are captured before resource reservation. Each physical attempt requires awaited reserve and durable dispatch callbacks before `fetch`; retries are bounded explicit 429 retries only. Unknown outcomes remain uncertain, cost remains unknown and host ceilings must retain the reservation. Credential headers/error bodies are excluded from captured payloads.

All model-visible application system layers are replaced with the current explicit fragment manifest. Fragment byte digests and audience scopes are checked. Tool declarations are host-supplied, and the only executor is the durable receiver. Completed assistant messages are checkpointed before their tools; unknown tools remain pending. Host call identities survive restart and context compaction. Context reduction uses its own supplied instruction artifact and the same physical accounting boundary. Steering is retained through Pi's loop hooks. Delegation can only occur through registered host tools and requires that receiver's child request accounting; no hidden child engine is present.

## Executed evidence

`node --test packages/agent-shell/*.test.ts` passes **19 cases**: 10 bridge/transport behaviors plus 9 unchanged upstream EventStream cases adapted only for imports and the Node test/assertion runner. The original upstream test is retained with its source SHA256. Bridge fixtures cover failure → observed repair → completion; final persona replacement on resumed state; independent reservations for retries; unknown network outcome with no retry; reservation/dispatch denial; finite request limits; fetch cancellation; accepted-effect crash/reconciliation; uncertain-effect halt; accounted compaction; steering; corrupt/foreign checkpoint rejection; schema validation and truncated-tool protection. These are mechanical author tests, not independent live competence evaluation.

`node experiments/agent-shell/qualify-source.ts` passes. The saved report is `experiments/agent-shell/results/q1-source.json`: provisioned clean build 1.342 s, warm build 1.385 s, local vendored dependency rebuild 1.385 s and fresh edited-output process load 0.039 s. Baseline and edited builds both run the regression cases. These observations describe this host and sample only, not a performance comparison. The command copies only the selected shell/C1 closure, uses the pinned preprovisioned toolchain, performs no network/catalog refresh and removes its candidate afterward. It changes `contentText`'s separator in candidate source, compiles it and verifies changed output in a new Node process. This is subprocess dependency-load evidence, not production authority transfer.

Strict checks pass with `tsc --ignoreConfig --noEmit --target es2024 --module nodenext --moduleResolution nodenext --strict --types node --allowImportingTsExtensions --erasableSyntaxOnly --skipLibCheck packages/agent-shell/index.ts packages/agent-shell/agent-shell.test.ts`; the qualification operation additionally compiles with `--rewriteRelativeImportExtensions`.

## Qualification disposition and bounded reassessment

| Gate | Current evidence | Remaining acceptance |
|---|---|---|
| Q1 | Pi source selected/pinned/licensed; compiled reduced closure; network-free provisioned build; real local dependency edit/rebuild/fresh load | TypeBox is still a registry dependency: installed closure 6.2 MiB and 1,385 files including source/build/declarations. Complete editable dependency/build-input policy and L09 production successor operation remain open. |
| Q2 | Exact payload capture, prompt replacement, ordinary/retry/resume/compaction accounting, bridge-only tools, cancellation exercised | Integrated durable runtime and real delegated/reviewer request paths. |
| Q3 | Mechanical iterative failure/repair/tool/steering/context behaviors | Frozen twelve-case model competence screen with real L06 tools/resources; no live model grades. |
| Q4 | Checkpoint digest/run fences; pending accepted/unknown effect reconciliation fixtures; fresh changed dependency process | Real process termination + SQLite recovery and full stateful successor/rollback preserving current goals/memory/obligations. |
| Q5 | No independent acceptance yet | Fresh review of exact candidate and extraction/integration burden. |

No fundamental Pi interception/recovery defect was observed. The narrowed core required import redirection and type-only pruning, not a rewritten loop. The outstanding whole-dependency source policy is a concrete scope gap reported to L09; it must not be hidden behind the reduced Pi API. The one-session result supports continued integrated qualification, not complete lane acceptance or a Rig fallback without comparative failure evidence. At most one further bounded implementation session remains before ADR0032's mandatory hard-gap reassessment.

## Downstream integration

Root owns TypeBox/toolchain installation and root build configuration. L03 implements the durable bridge and conservative per-request token/cost/time ceilings: unknown actual usage retains those ceilings. `reservationEstimate(attempt)` permits explicit request-specific ceilings without pretending estimates are actual measured usage. L06 registers real tools, with effect/reconciliation/delegation accounting behind `execute`; L08 owns the frozen screen and independence; L09 owns supervised candidate activation. `packages/agent-shell/README.md` documents API/operations. The adapter's checkpoint schema is `pi-89e5c2c/aeon-bridge-v1`; a future schema change needs an explicit reader/compatibility decision rather than blind deserialization.
