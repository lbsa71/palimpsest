# Fresh review of native Claude synthetic transport and shared lifecycle

2026-10-11. A1-L08-T02/T06, independent Codex `/root/a1_claude_transport_review`, reviewing author commits `4df76623850305b7859e89468f9b630ded0ed58b` and `8877b84114d9bbe102d6435f11211b369102c80f` on base `c3398ce8ebb39b79fe39e1d95519ee78aacdb520`. Isolated worktree `/home/palimpsest/migration/aeon-1-20261011/claude-transport-review`, branch `codex/a1-claude-transport-review-20261011`. Root delegated baseline-only material repairs and this new evidence file; package/lockfile/kernel machinery and original author evidence remained read-only. An actual finite goal was created without a token budget.

```text
/goal Freshly review native Claude synthetic baseline and shared Codex lifecycle refactor at 8877b84, repair material reproduced baseline regressions, persist exact-source evidence, and commit owned review changes while preserving the fixture-only/live-unavailable boundary.
```

**Disposition: one reproduced accounting defect repaired; bounded engineering evidence accepted.** This is not live Claude qualification, comparator calibration, parity, full L08 acceptance or H1. The [author record](claude-transport-fixture.md) and earlier [observer](baseline-observer-review.md) and [kernel](baseline-kernel-review.md) reviews retain their narrower claims and limitations.

## Finding and repair

The Messages usage parser checked that `message_start.usage.output_tokens` was a valid count but discarded it. A final cumulative output count lower than the initial count could therefore settle successfully and release the conservative reservation. Two fresh reproductions failed with “Missing expected rejection”: start **6**, final **5**; and start **21**, final **5**, despite the declared output ceiling of **20**. This is inconsistent accounting even under a synthetic profile; it does not indicate paid usage occurred.

Repair **`de897fdeb3656fbd05157f30af655e35e9814933`** retains the initial output count and requires the final cumulative count to be at least that value. The existing final ceiling then also covers the initial count. Both regressions now preserve the original 120-token reservation, mark usage unknown, cancel the original grant, and prohibit another dispatch. The accepted response shape and original grant are unchanged. Only the codec and its focused tests changed.

## Source, authority and protocol review

The concrete Claude wrapper permits only fixture transport, and shared runtime validation independently rejects a live transport or mismatched provider profile. `anthropic-fixture` requires low effort and explicit zero synthetic prices. There is no Anthropic paid transport. Native Messages POSTs cross a bounded local bridge within the existing network/PID/mount namespace. The fresh child environment contains a dummy gateway token and no inherited provider credentials. Native permission bypass operates inside this confinement. Only Bash is enabled; bare mode, empty setting sources, strict empty MCP configuration, disabled slash commands and session persistence constrain the declared comparator profile.

Requests preserve native system/messages/tool definitions; only output and stream controls change for Claude. Unsupported request shapes are refused before reservation/transport and retained as bounded refusal artifacts. Cache usage, opaque/enabled thinking, hosted tools and media remain unqualified. Every admitted request reserves and records its own dispatch under the immutable grant; no identical-payload deduplication, grant reset or automatic replay was introduced. Unknown replies keep the conservative charge. Worker failure, cancellation, elapsed grant, CLI output and RPC limits still terminate through the shared lifecycle.

The Codex wrapper now delegates its prior lifecycle to `run-native.ts`. The private-state link checks, lease, immutable grant, pending-operation cancellation, staged-copy digest verification, kernel-profile requirement for paid transport, protected paths and refusal to replay remain present. `codex-worker.mjs` and the complete shared supervisor tree are byte-identical between `c3398ce` and `8877b84`. The changed manifest explicitly identifies native kind/files and adds source, Node and host-launcher identities. A completed invocation record still requires examination of its CLI result and attempt outcomes; it is not itself a competence pass.

## Independent evidence audit

A read-only SQLite/hash audit verified all **23 files** in the author's external index and every artifact in all three trial stores (**2**, **11** and **9** artifacts respectively). The original failed Claude trial is stopped, has zero physical attempts and a cancelled original grant. Its missing request diagnostic remains missing; the review does not infer a precise original refusal cause.

Both successful manifests match their persisted specifications. Every one of their **83 runtime source files** matches the exact `8877b84` Git object, and their shared source inventory hash is `93be9d13db97c198200b0a87e41ef87405a330d614a2d95a88edc53eb05dedc1`. Native Claude/Codex/helper, worker, Node and recorded host-launcher digests match available files. Original grants equal the persisted grants and allocation envelopes, retain the two-request/30-second ceilings, and remain cancelled after completion. All four successful request records have matching forwarded-payload digests and settled usage. Before/after native instructions, input and tools are equal, and no private sentinel entered the requests.

The retained Claude result matches manifest `356edf388a03aed592eb642518325522be82b9acce281c05625372ed5f8bff92` and result `9198cac4d164ae7b7115527da8fcaafb28f137474cb219fde08367479bbf9bc0`. Its two attempts each retain 100 synthetic input tokens, 10 output tokens and zero USD; actual native HTTP metadata has only the dummy API token. CLI exit is zero, output is within the ceiling, and there are no refused routes or durable payload refusals. The captured tool-result content, workspace proof and intact private sentinel agree with the Bash isolation rehearsal. Both retained Claude response streams also produce identical usage when read through the **repaired** codec.

The retained Codex result matches manifest `7c75156cb8f2d52b027c0e648fec4766e8b386a0284b630a453a1c3145cb37d4` and result `45fb0dc30feee891796b53594be495fa73af4f4a17d123dce7e7381251a266e9`. Both attempts retain 100 synthetic input tokens, 10 output tokens and 0.00023 synthetic USD. CLI exit, actual command-output continuation, workspace proof and private sentinel agree. These independently audited author runs remain actual Claude 2.1.296 **1/1 in 6.34 seconds** and Codex 0.162.1 **1/1 in 13.29 seconds**, using synthetic responses. No fresh native run is claimed.

## Fresh checks and exact handoff

Node `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`, v24.13.0. An ignored `node_modules` link references the existing root closure without modifying it. Commands from the review worktree:

```sh
node --test --test-name-pattern='decreasingOutput|excessiveInitialOutput' evaluations/baselines/claude-fixture-codec.test.ts
node --test evaluations/baselines/claude-fixture-codec.test.ts evaluations/baselines/observer.test.ts evaluations/baselines/run-codex.test.ts evaluations/baselines/run-claude.test.ts evaluations/baselines/plan.test.ts
node node_modules/typescript/bin/tsc --noEmit
node /home/palimpsest/migration/aeon-1-20261011/claude-transport-review-audit.mjs
git diff --check
```

The first command, before repair, failed **2/2** as described above. On repaired source, the focused baseline suite passed **62**, failed **0**, and explicitly skipped **3** native opt-in cases in **1.325 seconds**. Strict TypeScript, final audit and whitespace checks passed. No broad/kernel/systemd suite or native rerun was needed for this pure codec repair, as coordinated with root.

External review artifacts under `/home/palimpsest/migration/aeon-1-20261011/`:

| Artifact | SHA-256 |
|---|---|
| `claude-transport-review-repro.tap` | `7929bc889a5f72a29e1597ff5ae6289e3a2336ffb46ee038ccee6353c48ca9fc` |
| `claude-transport-review-light.tap` | `d189ae1d12224ad502889bdd175d765cfeec7caf1bf347b3057ed1d834a8e940` |
| `claude-transport-review-audit.mjs` | `e5db6a983e913b8b3e302c5783d02c5adc1623086564d4dde8301ad896a88674` |
| `claude-transport-review-audit.json` | `1e5fd141c85570eb17ac7847447d784ab711d26a250d5996c63e47fb9e965585` |

Repaired codec SHA-256: `a5b38fd0cac7b365333caa3b8453b81b9afe0db9b9297d4e542583e2348ada67`; regression test SHA-256: `e4c459222daf9ecd18a878e08d61060185e5ce0b1d56d18b50608bde1a10c4ac`. The original native manifests bind the pre-repair source; replaying their retained responses through the repaired codec is a deterministic compatibility check, not a new physical trial.

The whole read-only `/usr` tool closure remains unsealed, and trusted stable host paths are assumed rather than protection against concurrent hostile same-UID mutation. Claude kernel enforcement, full native tool/delegation/recovery configurations, live account entitlement, pricing/cache/tier/media/thinking accounting, held-out workload provenance and calibrated live comparisons remain unestablished. Synthetic token figures do not measure model competence. No paid/account call, credential read, external message, deployment, installation, dependency change or push occurred. Root owns integration and central lane/status updates. Integrate the repair commit and this evidence follow-up; the finite review is complete, while those broader gates remain open.
