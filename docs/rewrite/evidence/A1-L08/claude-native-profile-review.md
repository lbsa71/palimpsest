# A1-L08 independent native Claude profile review

Owner: `/root/a1_native_profile_review`. Review worktree: `/home/palimpsest/migration/aeon-1-20261011/native-profile-review`; branch `codex/a1-native-profile-review-20261011`. Initial source: `08f93d3d4805822e7a6baaf901407dff2d0e801b`. Dependency: author-owned native compatibility and first-party accounting, with shared kernel/contracts/governance read-only. Writable paths are this record and `evaluations/baselines/claude-native-profile-review.test.ts`; runtime repairs remain author-owned. Model/effort inherited from the delegated review session. No additional agent was needed for this bounded independent task.

```text
/goal Independently review the pinned Aeon1 L08 native Claude protocol compatibility slice, add bounded independent regressions and evidence in an isolated worktree, coordinate final source handoff, and audit retained native evidence without provider or physical native calls.
```

Task sequence: inspect source and primary protocol contracts; independently reproduce profile/semantic defects; ask the runtime owner for bounded repairs; verify final source and independently audit retained native artifacts. Acceptance is exact profile binding, retained cognition/context controls, honest usage/reservation behavior, synthetic-only paid refusal, and a review handoff with limitations. This finite review does not complete L08, RW03, or H1.

## Findings and repairs

1. Initial `08f93d3` selected the old fixture beta string while permitting newer native mid-conversation controls. Source review identified the missing header/body qualification relationship. Two retained native trials separately demonstrate the resulting header refusal before dispatch. Author `45599fbd9a40848be78ddc1eea04ee3de0faede7` rejects that historical beta as a native-profile qualification and introduces the separately named `opus-adaptive-coding` profile with the exact captured header, binary/version, Opus model, and adaptive thinking.
2. Independent `weakenedCognition` regression failed at `45599fb`: `validateObserverGrant` admitted `effort: low` under the label qualified only for high effort. Initial independent run: **15 passed, 1 failed**, with `Missing expected exception`. Author `6277cc4` requires high effort and exact `display: updates`. Independent rerun: **16 passed**. The repair narrows admission and does not mutate native cognition.
3. Official mid-conversation documentation forbids `output_config` on a system message with `clear_at: next_user_message`. The reviewer initially used this invalid pair in a successful synthetic fixture, corrected the success fixture to `clear_at: never`, and added a refusal regression. At `6277cc4` the new regression reproduced acceptance: **16 passed, 1 failed**, with `Missing expected rejection`. Further source inspection found that every explicit `clear_at` requires the separate `mid-conversation-system-clear-at-2026-08-21` beta, absent from the captured native header. The final success fixture therefore omits `clear_at`, matching the actual native requests; independent negative cases cover `never`, `next_user_message` without output configuration, and the forbidden combination. Author `335ff73fe5947191d84f3ede5c407c5eeb8855ec` refuses every explicit `clear_at` without stripping it; all three independent refusal cases now pass.
4. The first strict compile of the independent test rejected its intentionally incomplete prelaunch `ResourceLimits` stub (TS2740). The stub is now explicitly cast at the negative test boundary, which exits at the synthetic-only guard before resource-limit inspection. Normal `npm run check` then passed. No compiler options or dependencies changed.

## Primary contracts checked

Accessed 2026-10-11; these document protocol behavior, not account entitlement or a paid qualification:

- [Claude Code gateway protocol](https://code.claude.com/docs/en/llm-gateway-protocol): preserve native version/beta values, request feature pairs, and system-block order. This implementation is a deliberately finite rejecting qualification boundary, not a general gateway: it refuses unqualified changes rather than forwarding arbitrary new capabilities or stripping flags.
- [Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking): `display: updates` requires its beta header and preserves opaque reasoning blocks; progress updates can contain text. The captured native header remains authoritative for this pinned synthetic compatibility exercise.
- [Thinking steering and cost](https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost): inclusive `output_tokens` is the billed total; `thinking_tokens` is a breakdown, not another charge. Progress estimates cannot replace final usage.
- [Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing): explicit `clear_thinking_20251015` with `keep: all`, and context edit receipt categories.
- [Mid-conversation system messages](https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages) and [beta Messages reference](https://platform.claude.com/docs/en/api/beta/messages/create): system-role messages and per-turn effort remain native content; explicit `clear_at` requires a separate beta missing from this pin; a turn-scoped reminder additionally cannot contain per-turn output configuration.

No claim is made that every captured internal beta's semantics, pricing, entitlement, or complete native affordances are publicly qualified.

## Independent retained-native audit

Evidence root: `/home/palimpsest/migration/aeon-1-20261011/claude-native-compatibility-evidence`. SQLite was opened using Python `sqlite3.connect('file:.../state/observer.sqlite?mode=ro', uri=True)`. Artifacts were SHA-256 checked; each of the **87** source files in each manifest was compared to `git show <exact-revision>:<path>`. No mismatches occurred. The successful trial's actual binary digest was checked without execution.

| Retained trial | Bound revision | Provider attempts | Refusals | Native exit |
|---|---|---:|---:|---:|
| `native-compatibility-qp0ybY` | `7911a2e9a7c63dd8663d7c33790c98c04e1d1d20` | 0 | 1 | 143 |
| `native-compatibility-py26tF` | `08f93d3d4805822e7a6baaf901407dff2d0e801b` | 0 | 1 | 143 |
| `native-compatibility-honO4S` | `45599fbd9a40848be78ddc1eea04ee3de0faede7` | 2 synthetic | 0 | 0 |

The first failure lacks refused HTTP metadata; its body and reason remain retained. The second retains the exact version/beta diagnostic, artifact `9cd20c09d128b7b4ee39733820efe12f4aa46d34a3a7e883930dda4c3149b068`. Both failures retain the original full-context grant. They are not successful native evidence.

The successful trial binds source identity `e23d726c0c6fca5d7ea6990047c7bb6453b72b4f7a90c12503e54437c62c18d5` and Claude Code `2.1.296 (Claude Code)`, binary SHA-256 `24972e3bc859fab2b46ed4c1e51f7d6130f06d3bd550811a114640de3370d0de`. Its two requests keep adaptive `display: updates`, high effort, `keep: all`, system/messages/tool schemas, cache markers, and the exact beta/version. Its actual advertised tools are Bash, Edit, and Read despite the broader requested local tool selection. Only the declared accounting controls differ between before/after: `max_tokens` 128000 → 4096, `service_tier: standard_only`, and `inference_geo: global`.

The second request contains the native Bash tool result `observed-sum=15`, the signed thinking block and opaque redacted block from the synthetic response. Workspace `proof.json` contains `{"sum":15}` and the protected sentinel is unchanged. Each completed synthetic receipt records 19 input tokens, 30 inclusive output tokens, 12 thinking tokens, and synthetic category cost about $0.0006748; visible or estimated thinking is not separately billed. These are fixture receipts, not actual provider usage.

All trials retain original ceilings: two requests, 2,008,192 tokens, $20, 60 seconds, concurrency one. The successful manifest records fixture transport and `namespace-fixture`, without kernel resource limits. Its evidence must not be relabelled as high-profile kernel or paid/live proof. The older native fixture kernel result is separate evidence.

Machine-readable independent audit: `/home/palimpsest/migration/aeon-1-20261011/native-profile-review-evidence/retained-native-audit.json`, SHA-256 `5786f0f6582ddaae8fd96bcc34e446995221455256ab28064cf3aa173921b129`.

## Verification and final disposition

Final runtime checkpoint: `335ff73fe5947191d84f3ede5c407c5eeb8855ec`. The independent suite now contains **19 passing cases**. Focused command:

```sh
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH AEON_CLAUDE_COMPATIBILITY_RUN=0 node --test evaluations/baselines/anthropic-codec.test.ts evaluations/baselines/claude-fixture-codec.test.ts evaluations/baselines/claude-native-compatibility.test.ts evaluations/baselines/claude-native-profile-review.test.ts evaluations/baselines/observer.test.ts
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH npm run check
```

Observed focused result: **168 tests, 167 passed, 0 failed, 1 deliberately skipped native execution**. Log: `/home/palimpsest/migration/aeon-1-20261011/native-profile-review-evidence/focused-final.log`. Strict check passed. `git diff --check` passed. Earlier reproductions used `node --test evaluations/baselines/claude-native-profile-review.test.ts` with the same Node PATH; their failures and resolutions remain above.

A final pure admission audit reopened `honO4S` read-only and checked its original grant and both captured requests through final `validateObserverGrant`, `validateAnthropicPayload`, and `nativeProtocolHeaders`. Both still pass, and recomputed outgoing objects exactly equal retained after-artifacts. Only `evaluations/baselines/anthropic-codec.ts` differs among the 87 non-test sources between successful native revision `45599fb` and final runtime `335ff73`; the diff adds high-effort, explicit updates, and unsupported-clear-at rejection guards. Final codec SHA-256 is `6a3c21491d30e1eb34882d38cc693b0feac0d6daa46e87aec995cd67eca0302b`; final complete source identity is `ed38e7b47f39a52d942ae10d2d5a4cad69494a12131d82566ae6bf42e27066c3`. Audit: `/home/palimpsest/migration/aeon-1-20261011/native-profile-review-evidence/final-admission-audit.json`. This is source compatibility verification, not another native run.

Disposition: **accepted for this bounded synthetic protocol slice**, with reproduced defects repaired and no unresolved blocking finding in the reviewed scope. All commands use Node 24.13.0 at `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin` first in PATH, root dependency symlink only, and normal `npm run check`. No dependency installation, extra compiler flags, physical native runs, provider/auth calls, credentials, messages, deployment, or push were performed by this review.

Independent regressions cover original-grant mutation after observer construction; exact request/header/control preservation; historical/binary/version/model/effort profile rejection; no stripped/injected cognition; unsupported request fields before dispatch; inclusive actual versus estimated token usage; incomplete/unpriced responses retaining the full 1,004,096-token/$8.08192 reservation; cancellation across observer restart; immutable grant enlargement refusal; and paid/swapped-binary entry refusal before private state preparation.

The author-owned successful native trial remains bound to `45599fb`; later pure admission guards do not retroactively change that evidence. Bounded source compatibility and synthetic continuation do not establish model competence, best-configuration parity, autonomous qualification, account access, live provider accounting, or full H1. Future paid work needs explicit authorization and complete beta/pricing qualification.
