# Independent bounded native delegation review

2026-10-11, A1-L08-T02/T06. Reviewer `/root/a1_native_delegation_review` used a separate worktree and actual finite goal. Review base is frozen source `de3e3138d31a48cd2837dfebfdc97455b59833c5`; author evidence-only `0ab364c5b5225a46eeb689e9bbf03558a4e81ae2` was cherry-picked as `a483551`. Review source/repair is `e010472b1a42755e695c53fa265a8ffa5743781b`. Governing scope is [the pre-code specification](native-delegation-specification.md); [author evidence](native-delegation.md) retains the acquisition history. This review does not close L08, RW03, RW18, H1 or live compatibility.

The bounded engineering handoff is acceptable with the narrow repaired Codex witness and the explicit unresolved Claude completion gate. Codex attempt 2 establishes actual native children, successful commands/files, continuation, original-ledger overlap and directed parent receipt/completion under synthetic replies. Claude attempt 3 establishes actual child mechanics and arrival of both native framed results, but its fixture remains failed. Parent completion is unproven. Previous bridge-only checks remain separately labelled.

## Finding and disposition

**P2, repaired: substring command-result matching could count a failed command as an observed success.** At the frozen source, `codexObservedToolOutput` only checks an attributed `call_child_N` plus an expected substring anywhere in serialized output. A valid positive acquired-style result followed by the single mutation `exit_code: 1` still returned true. A failed-output message containing the marker could also pass. This weakens continuation evidence even though final file checks offer another barrier.

Root authorized the minimal repair in `native-delegation-fixture.ts` and the corresponding existing author test's positive fixture. The helper now requires the actual two-`input_text` completed code-mode envelope, parses its command observation, refuses unknown result fields/running sessions, requires exit zero and exact stdout including its newline. The new independent review test rejects nonzero/null exit, marker substrings, extra stdout, running output, malformed JSON, extra blocks and wrong call identity after first proving a valid positive. This checks completion separately from marker presence.

Both retained successful Codex command observations contain actual exit zero and exact stdout and pass the repaired helper in the read-only artifact audit. Therefore the original physical success is independently supported; it is not relabelled as a new run at the repair revision. No native rerun occurred. The first failed regression is retained externally with its hash below. Parent reviewed the narrow source diff before handoff.

**Open boundary, preserved: Claude native hand-back envelope is unsupported by the fixture.** The sixth original request contains successful Agent tool-result IDs, native provenance framing, indented child finals, real agent IDs and usage trailers. The fixture assumes the final is the first line and refuses. Neither `claudeParentReceipts` nor the final `claudeTaskBindings` assertion succeeds on this actual request. This is an acquired fixture boundary; no model-competence failure is inferred. Both helpers still reject the wrapper. No wrapper stripping, rewritten frame, synthetic pass, fourth Claude attempt or paid broadening was introduced. Future support needs a separately frozen bounded unit and adversarial framing/call/identity controls.

## Independent retained-artifact audit

Original root: `/home/palimpsest/migration/aeon-1-20261011/native-delegation-evidence`. Review used original SQLite databases opened read-only, their raw artifact blobs, native stdout, retained source manifests, plans, requests, responses, child files and overlap snapshots, rather than accepting summary counts alone. Every database artifact digest was recomputed. All 203 final index entries match, and all 159 pre-attempt-3 entries remain unchanged. Each of the five source manifests contains 90 non-test source files; every entry matches its exact acquisition commit via `git show` (450 comparisons). Physical fixture identity is additionally bound by each declared plan and source checkpoint, retained in the verified index.

| Actual attempt and source | Independent outcome | Charged evidence |
|---|---|---|
| Codex 1, `82174e0`, `codex-delegation-attempt-1-R6oSMF` | Failed original fixture; two children/commands and directed finals existed, then exhausted original request ceiling | Eight known receipts, 880 tokens, synthetic USD 0.0048 |
| Claude 1, `82174e0`, `claude-delegation-attempt-1-tjDyTN` | Additional native beta refused before transport; actual Agent surface acquired | Zero dispatched requests/charges |
| Codex 2, `149392c`, `codex-delegation-attempt-2-nJYEbF` | Native fixture passed, CLI exit zero, final completion text present | Eight known receipts, 880 tokens, synthetic USD 0.0048 |
| Claude 2, `149392c`, `claude-delegation-attempt-2-qdYbWY` | Parent admitted; both child beta/display forms refused before transport | One known receipt, 110 tokens, synthetic USD 0.0006 |
| Claude 3, `de3e313`, `claude-delegation-attempt-3-PaC0dY` | Two child continuations, native result arrival, final parent fixture rejection, CLI 143 | Five known receipts, 550 tokens, synthetic USD 0.003; sixth uncertain reservation holds 1,004,096 tokens/USD 8.08192 |

All five original allocations are cancelled after drain, and all five `lease.sqlite` owner tables are empty. Claude 3 total retained charge is 1,004,646 tokens and synthetic USD 8.08492; its empty response is not zero usage. This accounting survives cancellation. No original allowance was reopened or enlarged.

Codex 2 and Claude 3 each retain two distinct dispatched child request IDs in a simultaneous original-ledger snapshot, matching durable attempt IDs, full reservation charges and native child attribution. The inspected fixture holds both first child requests until that snapshot exists; it does not merely infer concurrency from two children eventually appearing. Both cases retain the two actual child files with exact contents. Codex command observations additionally contain actual exit zero/exact stdout. Claude child continuations bind the emitted Bash call IDs to successful native tool results. Actual Claude `task_started` IDs/session fields bind each HTTP child identity to the original Agent call and corresponding returned agent ID. These offline observations do not imply that the unexecuted final runtime assertion passed.

Audit identities:

- Final index SHA-256 `c151ef8b29c4390468b4a3bb378b39a6bec8aa88b28ef8f1dd9b247690e5be54`.
- Final author audit SHA-256 `2994c3fb363731f407c20e2f8ffdb0b47c80d5d0b4b3af851e724cae763b6c00`.
- Pre-attempt-3 index SHA-256 `7e4fbc6b0fc4280623d7a33792f9670681f14bd43dc8ccced3ef0635b18c029e`.
- Exact source manifest digests: attempt 1 `a59b439d2af5bb1fbf40259796a8e8001248317643d9d24e638de46cc5737de9`; attempt 2 `36d8f502f432993f63d08cfec61dce48a51a3b54d4ca00d8fdd7de137a88c8b7`; attempt 3 `d5f8b62d08ad3813654bac2119de53624a8eb8b7085c676400f4f34378909935`.
- Claude 3 uncertain parent before `4b0918e9667c31253f65af9db57466cc81816e7bbb6f6bbed3e03caf1b2e47c3`, after `e1e4551eb0eae807352f80b7eba827c0b2b091ab50f6e61fddf21a142fa880d8`, native HTTP `b694ec28ed44a656272bcd1a339f1df862bca02f636bef8a349ea206de88d5e9`, empty response `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

## Protocol, instruction and authority review

Codex acquisition requires exact CLI 0.162.1 and helper digests, `gpt-6-astra`, high effort, 200,000 input plus 4,096 output reservation. `agent_message` fields are limited to type/id/author/recipient/content, bounded native identities and acquired text/opaque blocks. Before bytes remain exact; after input/instruction/tool values remain unchanged. Encrypted task blocks are preserved without decoding or interpreting them as authority. Directed parent finals require their complete actual native envelope and public final. Both observer construction and paid transport block this synthetic-only feature. Ordinary coding semantics are not broadened.

Claude uses exact CLI 2.1.296 digest, Opus/adaptive/high, the acquired parent beta plus `display:updates`, and the exact child beta omitting the updates feature plus `display:omitted` and bounded child/session identities. Actual runs reserve 1,000,000 input plus 4,096 output per request. Unknown headers/betas/fields, wrong identity, model/effort and mismatched thinking/display are refused before dispatch. New delegation observer profiles require explicit fixture transport; the paid transport refuses their beta forms. Retained prices remain standard/global synthetic category rates; no paid compatibility is established.

The runner snapshots Claude invocation options before asynchronous launch, and the observer clones/freezes the grant. Pure checks exercise caller grant mutation while two acquired child requests are outstanding: a mutated concurrency ceiling cannot admit a third request, price/context mutations do not lower either full reservation, and cancellation keeps both unknown charges and prevents redispatch. Source inspection confirms explicit same-model child-role options and rejection of unknown options. Positive protocol baselines precede the new negative mutations, avoiding tests that fail only because their original fixture was invalid.

The isolated Claude invocation uses native safe mode, empty settings/source selection, strict empty MCP configuration, disabled slash commands, no session persistence and a blank workspace preflight. The worker constructs a fresh home/config in the namespace's private `/tmp`, supplies only its declared environment and dummy bridge key, and inherits no host home or credential environment. The existing namespace applies unshared networking, cleared environment and bounded mounted closure; permission bypass is inside that boundary. No custom `--agents`, replacement system prompt or appended personality was supplied. Tool selection alone is not treated as proof: actual request tools are Agent/Bash/Read/Write, while native init calls the delegation tool Task and reports native claude/Explore/general-purpose/Plan agents, empty skills/MCP/slash commands and two built-in plugins (`cc-plugin-agents-md`, `cc-plugin-plugin-authoring`). Built-ins remain effective instruction sources despite safe mode.

Effective comparison instructions were inspected and retained, including Codex developer personality/working/tool/skills/permission/collaboration text and additional tool schemas; Claude parent system, child general-purpose system, billing/identity blocks, Agent definition and input schema, tool descriptions, reminders and message history. Claude child instructions contain caller-versus-user-consent, file/search, reporting and no-redelegation rules. The final native `[Subagent hand-back]` wrapper itself instructs the parent about provenance, consent and indented report lines. It is part of the effective instruction path. The read-only audit verifies equality of every before/after input, system, message and tool value. Nothing was purged to make the comparators resemble the candidate. Native identities and text are retained client attribution, never authenticated host grants. Instruction retention is evidence about these pinned comparison shells, not proof they qualify as the sovereign primary mind.

## Checks and handoff

Node runtime `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`; existing author dependencies were reused through a local ignored symlink, with no installation. Executed after the repair:

```sh
AEON_NATIVE_DELEGATION_REVIEW_EVIDENCE=/home/palimpsest/migration/aeon-1-20261011/native-delegation-evidence /opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test evaluations/baselines/native-delegation-review.test.ts evaluations/baselines/native-delegation.test.ts
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH npm run check
AEON_NATIVE_DELEGATION_REVIEW_EVIDENCE=/home/palimpsest/migration/aeon-1-20261011/native-delegation-evidence /opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test evaluations/baselines/*.test.ts
```

Focused: **38 passed, zero failed/skipped**, including seven new independent review tests and the actual artifact audit. Normal strict TypeScript: **passed**. Full baseline: **242 passed, zero failed, ten intentionally gated physical skips**, 252 total. The external audit test skips only when its explicit evidence-root variable is absent; ordinary tests never launch native binaries. `git diff --check` passed. No native/physical check, paid/authenticated request, account/credential access, external messaging, publication or deployment occurred during review.

Review logs are separately retained at `/home/palimpsest/migration/aeon-1-20261011/native-delegation-review-evidence` without changing the original indexes:

| Log | SHA-256 |
|---|---|
| `native-delegation-review-first-failure.txt` | `cc25601cb351e25f11916922ec004b078a4e56b6407e8eeff93fa3242c8b6ea0` |
| `native-delegation-review-focused.txt` | `b00b59de8a0a01c281cb608748c556df9ad275cc457388cd1b4c10072b097b9a` |
| `native-delegation-review-baseline-suite.txt` | `a7f499b78babd90d2ec05427400df6b5a25fb35d1ba5885ac69536708bc6a111` |

Root owns integration, central status and any newly authorized Claude witness/completion unit. External research, persistent native recovery/context reduction, live generation/compatibility, comparator calibration, competence, elapsed development and H1 remain unavailable or separately gated. This finite review closes after its committed handoff; it grants none of those capabilities.
