# A1-L08 first-party Anthropic accounting preparation

2026-10-11. **Implemented and fixture-verified offline; fresh independent review and integration pending.** Finite A1-L08-T02 task owner Codex `/root/a1_anthropic_accounting`; branch `codex/a1-anthropic-accounting-20261011`; worktree `/home/palimpsest/migration/aeon-1-20261011/anthropic-accounting`; base `19090535a0ac144513c617897e0a0d858fc566d0`; frozen runtime/check commit **`12b9468f60981eb73eb64d98b02ac5cdccdc2d1b`**. Root owns central lane/plan/availability updates and fresh review. This finishes an accounting implementation slice, not full L08, RW03 or H1 acceptance.

```text
/goal Implement and fixture-verify a separately declared first-party Anthropic Messages baseline transport and accounting profile, preserving native thinking/cache continuations, exact category receipts, conservative reservations and cancellation/no-replay invariants without credentials, paid requests or native execution; retain evidence and explicit native-readiness limitations.
```

The behavioral specification is the [live profile readiness report](live-profile-readiness.md), particularly its next finite engineering goal. Writes are confined to baseline runtime/tests and this new evidence file. Shared `ResourceUsage`, `PhysicalRequest`, storage/ledger/kernel code, dependencies, application configuration and availability are unchanged. The existing observer, ledger, run-native lifecycle and worker bridge are reused because they already provide immutable grants, predispatch durable reservation, cancellation and uncertain-outcome retention. A separate small codec handles Messages categories; no SDK or second lifecycle was added.

## Implemented boundary

The existing `anthropic-fixture` profile retains low effort, zero synthetic prices, disabled thinking and Bash-only invocation. Its original codec remains unchanged. A separately explicit `anthropic` profile admits first-party synchronous global, standard-tier, standard-speed Messages with declared model identity, thinking/defaults, effort, input contract, output cap and five category prices. No current model, account entitlement or list-price default is installed. Tests use a synthetic model ID and explicitly synthetic rates while exercising this real transport contract through injected responses.

`anthropicTransport` pins `https://api.anthropic.com/v1/messages`, API version `2023-06-01`, POST, redirects refused, and a host-provided key. It has no retries, ambient authentication or worker-controlled endpoint/headers. `runClaudeBaseline` accepts this provider only with explicit kernel limits, just as the existing paid OpenAI path does. A real-profile synthetic transport can exercise the same codec without a key. Exporting a callable path grants no dispatch authority or qualification.

The real native invocation requires a declared tool selection and preserves supplied effort and model-role choices in the manifest. It omits the fixture's adaptive-thinking-disable and zero-thinking-token environment overrides. It does not silently remap unspecified roles. A declared different role model is refused because this finite observer has one immutable priced model; unconfigured native routing to another model is likewise refused at the request boundary. The pure invocation builder is shared by the manifest and staged worker and its copied bytes are checked against the source manifest. Bare mode, empty setting sources/MCP configuration, disabled slash commands and ephemeral session behavior remain explicit engineering profile facts, not best-system affordance evidence. CLI support for any selected effort/model must still be qualified against the pinned binary.

Local tool requests/results, top-level and block cache controls, signed thinking and redacted thinking continuations remain intact in before/after artifacts. Host changes are output cap, streaming and explicit global/standard-only accounting controls. Omitted thinking/effort controls retain the defaults attested by the profile; they are not an independent verification of model defaults. Enabled thinking requires a declared budget below the output cap. Unsupported hosted tools, media, deferred/server tool search, opaque server context, Batch, unknown request/usage fields and nonstandard priced dimensions are refused rather than normalized into this contract.

The [Messages API reference](https://platform.claude.com/docs/en/api/messages/create) documents signed/redacted blocks and usage dimensions; [prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) documents creation TTL categories; [streaming](https://platform.claude.com/docs/en/build-with-claude/streaming) documents cumulative deltas, terminal events and thinking signatures. Those official pages were read on 2026-10-11; no HTML snapshot is claimed. The readiness report supplies the wider model/pricing inquiry; this implementation does not make new price or entitlement assertions.

## Accounting and refusal semantics

For uncached U, five-minute writes W5, one-hour writes W1, reads R and output O:

```text
aggregate input = U + W5 + W1 + R
creation total = W5 + W1
measured cost = (U*pU + W5*pW5 + W1*pW1 + R*pR + O*pO) / 1e6
reservation tokens = full host-attested input contract C + output cap Ocap
reservation cost = (C*max(pU,pW5,pW1,pR) + Ocap*pO) / 1e6
```

Each successful attempt stores an `anthropicReceipt` with every category, optional thinking subset, served tier/geography/speed and stop/truncation status beside aggregate `ResourceUsage`. Cache reads consume the token grant; creation totals and TTL splits describe the same tokens and are never added twice. Thinking detail is a validated subset of output, never a second output charge. Nonzero creation without a complete exact TTL split cannot settle at a guessed cheap rate: the attempt becomes unknown and retains the full maximum-category reservation.

Multiple `message_delta` events update cumulative totals monotonically rather than summing them. Negative/fractional/unsafe counts, inconsistent TTL totals, decreases, thinking greater than output, model mismatch, ceiling overflow, malformed or incomplete streaming, stream errors and unsupported priced usage retain conservative charges and cancel the original grant. Missing served standard tier or global geography also refuses exact settlement. Served speed, if reported, must be standard; absent speed is the narrow non-beta standard transport contract, not independently observed provider speed. Known server-tool counters may be present only at zero; unknown counters are refused even at zero. Legitimate `max_tokens` stops with a complete receipt settle measured usage and record `truncated: true`; they confer no competence pass. Unsupported stop semantics remain unavailable.

The ledger keeps settled usage plus every outstanding reservation within the original grant. It enforces one active attempt. Cancellation, timeout and interrupted durable attempts retain unknown charges; reopening cannot reset or change the grant or automatically replay. Request-shape refusals are recorded separately and consume no physical provider attempt. Kernel guard coverage here is entry validation only; physical Claude enforcement needs its own qualification.

A real profile whose full input contract plus output cap exceeds its token grant now fails explicit readiness validation before state creation/native staging/dispatch. The 144k grant is fixture-tested against both 200k and 1M input contracts. For the former plus the fixture 20 output cap, one request requires 200,020 reserved tokens; for the latter plus a 24k cap it requires 1,024,000. Neither can fit 144,000. This implementation does not shrink the contract, enlarge the grant or invent a tighter tokenizer bound.

## Fixture acceptance and retained evidence

External evidence is `/home/palimpsest/migration/aeon-1-20261011/anthropic-accounting-evidence/`. `manifest.json` binds the runtime/check revision, source hashes, pinned Node 24.13.0 identity, commands and results. `focused.log`, `strictcheck.log`, `worker-syntax.log` and `retained-native-headers.json` preserve observations outside the frozen source tree. Worktree `node_modules` links to the existing repository closure; no install or dependency mutation occurred.

| Behavioral cases | Observed result |
|---|---|
| Mixed uncached/5m/1h/read receipt; category-only cases; signed/redacted/cache/tool continuation | Exact receipt and aggregate cost/tokens; preserved payloads |
| Multiple cumulative deltas and thinking subsets; legitimate max_tokens | One final bill; truncation recorded and measured usage settled |
| Highest admitted price reservation, including a read rate above base; settled plus subsequent reservation overcommit | Host refuses entry when money/token envelope cannot contain the reservation |
| 144k admission against 200k/1M contracts | Explicit readiness refusal before state or transport |
| Malformed/truncated/missing/decreasing/contradictory usage; model/tier/geo/speed and hosted-charge mismatches | Original maximum-category charge held, grant cancelled, durable replay refused |
| Unsupported request dimensions and native beta headers | Zero physical dispatches; bounded refusal evidence |
| Concurrent/cancelled work and immutable grant/price identities | One outstanding reservation; original charges and cancellation survive reopening |
| Host credential boundary and paid native entry without kernel limits | Pinned transport via fake fetch; key absent from payload/evidence; entry guard refuses without state creation |
| Real/fixture invocation construction | Real options retained without thinking-disable overrides; original fixture restrictions retained |

Reproduction from the worktree, with `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin` first on PATH:

```sh
npm run check
node --check evaluations/baselines/claude-worker.mjs
node --test evaluations/baselines/anthropic-codec.test.ts evaluations/baselines/claude-fixture-codec.test.ts evaluations/baselines/observer.test.ts evaluations/baselines/run-claude.test.ts evaluations/baselines/run-codex.test.ts
```

Required repository strictcheck passed (`tsconfig.json` has `strict: true`); worker syntax passed. The final focused command passed **116/119**, with **zero failures and three explicit native/kernel opt-in skips**. Its 56 new Anthropic cases passed. There were no Claude native, kernel, paid-provider, broad-suite or production runs in this task.

**Scope deviation:** an earlier regression command accidentally included `codex-worker.test.ts`, whose existing unconditional isolated actual Codex synthetic fixture executed and passed. That command reported 117 passes/120 tests and three skips. It was immediately reported to root and excluded from final verification. It used no provider key or paid call; it is not evidence of Claude native or paid readiness. The initial session tool output exists, but no separate retained log is claimed for that accidental run. A stronger optional compiler-policy experiment (`--noUncheckedIndexedAccess --exactOptionalPropertyTypes --noUnusedLocals --noUnusedParameters`) failed across existing packages/deployment/tests and this command's output is retained in `exploratory-stricter-compiler.log`. Those extra flags are not the repository's required strictcheck and do not expand this task's write ownership.

## Native incompatibility and next finite gate

The real profile deliberately refuses all `anthropic-beta`, workspace and user-profile routing headers because their feature/account/pricing contracts were not qualified here. Read-only inspection of the **previous** successful native fixture's retained HTTP artifacts proves both requests carried `/v1/messages?beta=true` and beta headers:

```text
interleaved-thinking-2025-05-14
thinking-token-count-2026-05-13
context-management-2025-06-27
prompt-caching-scope-2026-01-05
claude-code-20250219
```

Artifact hashes are `9073fc3e7ea8849dfa6414bc7fa60ab1196c6fe673993fb381d469e78589faf0` and `eb895e9816e0e1b804fc22d2af4efdd135ab61d2e9eaf6eba94ab3d0744c2b1b`; the source database is `/home/palimpsest/migration/aeon-1-20261011/claude-native-feasibility/aeon-claude-fixture-bCeBjC/state/observer.sqlite`, opened with SQLite `mode=ro`. The extracted evidence keeps only relevant public protocol headers. This is historical observation, not a new native run. **That observed installed-native request shape is predispatch-incompatible with the new real profile.** The wrapper is mechanically callable and synthetic codec tests pass, but actual native paid readiness is unavailable.

Next finite engineering work must source and independently qualify the necessary native beta contract, preserve required cognition/cache/context behavior, then capture a pinned real-profile synthetic native invocation and qualify tools, child/concurrency observation, cancellation/recovery and physical Claude kernel limits. Single-flight, one-model observation does not prove native delegation. The root's separate original-fixture kernel work is independent of this new contract. Account/authentication choice, model entitlement, a separately issued reservation-compatible grant, sealed comparator calibration and full best-system selection remain external gates. Subscription/OAuth, priority/US-only/fast/Batch/server-tool pricing and multimodel routing require separate contracts. No unsupported native requirement may be removed silently to obtain a best-system label. H1 remains unaccepted.
