# Finite decision: the old full-B compaction fixture

2026-10-12; A1-L08, RW02/RW04/RW10/RW16/RW19. Design input, not adopted implementation or a passing fixture.

Owner `/root/a1_development_compact_fixture_design`; base `55fd083f7d9f80834037c4e7259aaef0b578c8d3`; branch `codex/a1-development-compact-fixture-design-20261012`; isolated worktree `/home/palimpsest/migration/aeon-1-20261011/development-compact-fixture-design`. Exclusive write ownership is this document. Source, tests, prior evidence and central coordination are read-only. The actual finite goal is to decide whether the complete unchanged 16-request fixture can fit, or supply bounded impossibility evidence and a separately adoptable alternative. No subdelegation was needed for this tightly coupled arithmetic inquiry.

## Decision

**There is no feasible redistribution of the current fixture's pools under its unchanged v1 caps and unchanged synthetic identities.** The completed original Store graph alone has a conservative lower bound of **1,006,084 bytes**, above the v1 **1,000,000-byte** singleton ceiling. This is stronger than the earlier 870,282-byte observation at 14 requests: it composes all sixteen successful request bundles, rather than treating a refused prefix as a complete trace.

This conclusion is narrowly about the exact current synthetic identities, grants, accounting representation and requested trace. It is not proof that every v1 fixture is infeasible, or that the production accounting/source guard is defective. No source guard was changed or bypassed; no new allocation was run. The current case remains red. The earlier failures in [the complete capacity inquiry](development-model-fixture-capacity.md) remain evidence.

The smallest next change is **a separately signed compact synthetic fixture vocabulary**, confined to this one opt-in setup: shorten opaque role/root/allocation/model/prompt and opportunity identifiers and unnecessarily verbose synthetic judgment strings before constructing any signed manifest or claim. Preserve the real full-B input, Pi compaction, all sixteen requests, three exact reads per reviewer, accounting, refusal and replay assertions. This is a fixture structural change, not another promise that pool adjustment alone can work. It needs a complete new wire-size composition before one fixed allocation is implemented; this document does not claim that an unmeasured replacement tuple passes.

## Exact predicates and source boundaries

The unchanged case is `evaluations/development/model-review-audit.test.ts:243–264`: two reviewers, each three tool-producing ordinary model turns, three exact artifact reads, one actual compaction request and one final ordinary model request. Thus there are ten provider payloads, six receiver requests, two successful compactions and sixteen accounted requests. Both roles must be unavailable specifically because the final request lacks **exact frozen B**. Compaction must retain the application-owned instruction and the literal empty tools fragment `[]`; replay must leave provider payload count at ten. Keep every existing assertion unchanged, including the separate original 250,000-byte allocation refusal.

Relevant accepted source at the base:

- `packages/storage/index.ts:189–214`: whole-source snapshot guard is `sum(6*UTF8(namespace,key,value)+256)` over documents, plus the analogous event sum, plus 512 and six times journal-binding bytes. It also enforces the actual serialized snapshot and complete event/journal history. Storage's primitive permits at most 1,048,576 bytes, but **the v1 witness's tighter 1,000,000-byte cap applies** (`evaluations/development/witness.ts:136–139`). Plan snapshot bounds cannot exceed that witness artifact bound (`acquisition-plan.ts:159`).
- `deployment/development-accounting.ts:194–241,309–322`: each physical request persists the request, tracked capture, latest state and trusted outcome; model transport also persists its mapped response. A successful request has reserved, dispatched and succeeded transition events. Reviewer role allocations and identity bindings are also in the original Store.
- `evaluations/development/acquire.ts:158–184`: every current-use check rechecks complete attached behavioral sources, including the candidate's original ledger Store after reviewer requests accrue. The absence of a final retained large snapshot does not make the large **current** cut optional.
- `acquisition-plan.ts:68–89,174–220,240–246` and `acquire.ts:232–285,312–341`: declaration arithmetic, seven mandatory full snapshots, future slots, all draft writes and four metadata copies are independently enforced.
- `model-review.ts:213–235,287–309` and `packages/agent-shell/index.ts:151–158,200–225`: input, request payloads, prompt manifests, fragments and every distinct checkpoint are retained. Full-B membership is checked before decoded judgments are signed.

## Unchanged-refusal evidence and complete source lower bound

Three focused diagnostic executions all left the original case **0/1**, with no skip, cancellation or expected failure. The temporary wrapper delegated `writeRaw` and `checkMetadataPromise` unchanged and rethrew their actual refusal. Later executions added read-only capture of the already-permitted prefix to finish static accounting; none advanced past the refused operation. The final execution is preserved in `/tmp/aeon-compact-finite-probe.log`, with synthetic prefix `/tmp/aeon-compact-prefix-source.json` and arithmetic `/tmp/aeon-compact-source-algebra.mjs`. These temporary artifacts are reproducibility aids, not durable acceptance artifacts.

The command was:

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node \
  --experimental-test-module-mocks \
  --import /tmp/aeon-compact-finite-probe.mjs \
  --test --test-name-pattern='actual compaction preserves purpose' \
  evaluations/development/model-review-audit.test.ts
```

The test's mandatory module mock executes actual Pi, broker, ledger and recorder in-process; it does not launch a worker, use a provider, contact a network or inspect private state. On refusal the wrapper copies `original.store.captureDevelopmentSnapshot({maxRows:512,maxBytes:995000})`; that method itself still runs the original guard. This prefix has four completed requests. Reviewer B's initialization, reached during original failure handling, supplies the second reviewer's allocation/binding base that the complete sixteen-request trace also requires.

Partition original rows by request ID. Each request bundle contains all documents whose **key equals that physical request ID**, and all physical-transition events whose `data.state.request.id` equals it. Everything else is the fixed base. Hash/UUID content changes cannot reduce these fixed-width ASCII fields. Both reviewer names have equal lengths. No request bundle deduplicates: its physical key and event IDs are distinct.

For the lower bound, recursively replace every numeric `costUsd` and `elapsedMs` in each bundle with zero; replace numeric `tokens > 1000` with 2024 and numeric `inputTokens > 1000` with 1024. These substitutions deliberately reduce even fixed 5,000-ms ceilings. They are **arithmetic on copied JSON only**, never returned as evidence or written to an operational Store. A model request reserves payload bytes plus 1,024 input tokens and 1,000 output tokens, so the four-digit minima are valid even for the short final request. Successful model usage is still the fixture's 23 input / 17 output tokens. Tool usage remains zero. Serializing with production `canonicalJson` avoids Python/JSON floating-point-format differences.

| Required contribution | Count | Conservative bytes after minimization | Total |
|---|---:|---:|---:|
| Fixed base, including 512-byte header | 1 | 56,336 | 56,336 |
| Successful model bundle | 10 | at least 62,630 | 626,300 |
| Successful tool-read bundle | 6 | at least 53,908 | 323,448 |
| **Complete lower bound** | | | **1,006,084** |

The fixed base is 24 documents: eleven allocations (root, eight roles, two reviewer runs), one budget, two mapped allocations, eight accounting bindings, one frozen-B anchor and one local binding. Each model bundle has five documents (`requests`, `development.accounting.requests`, `.latest`, `.outcomes`, `.responses`) and three events; each tool bundle has four documents (no `.responses`) and three events. Therefore the completed cut has **98 documents + 48 events = 146 rows**, below 512. The byte guard is decisive.

Compaction cannot invalidate the model lower bound: its purpose string is four characters longer, and its captured fragment list has the base instruction, the added compaction instruction and empty-tools artifact rather than only base and ordinary tools. The extra artifact-reference object outweighs the smaller fragment byte-count numerals. All relevant digest/reference widths remain fixed. No optional failure, diagnostic or journal rows were added to the lower bound. The scalar identities/grants and source schema are unchanged by redistributing recorder pools. This rules out every such redistribution, even if draft/metadata retention were free.

A reproducer needs only the copied prefix and these operations:

```js
const size = v => Buffer.byteLength(canonicalJson(v));
const documentCost = d => 6 * (Buffer.byteLength(d.namespace)
  + Buffer.byteLength(d.key) + size(d.value)) + 256;
const eventCost = e => 6 * (Buffer.byteLength(e.id)
  + Buffer.byteLength(e.stream) + Buffer.byteLength(e.type) + size(e.data)) + 256;
// Partition by physical request key/state.request.id, minimize numeric fields
// as specified above, then sum base + 10 * minimumModel + 6 * minimumTool.
```

The copied graph has null journal binding and no journal payloads. For a journaled graph those extra costs cannot be silently omitted. This result must not be generalized to different input identities, profile values, source layouts or a paged acquisition mode.

## Complete recorder composition, including downstream failures

The unchanged plan's verified scalar capacity is:

| Pool / finite bound | Bytes / count |
|---|---:|
| Drafts: six non-reviewers × 12,000 plus two reviewers × 393,216 | 858,432 |
| Responses: six × 1,000 plus sixteen × 4,096 | 71,536 |
| Metadata: 120,000 + 22 × 5 × 2,500 + 112 × 512 | 452,344 |
| Captures | 6,993,000 |
| Failure | 4,096 |
| **Declared total** | **8,379,408** |
| Aggregate headroom under 8,388,608 | 9,200 |
| Declared records: 40 + 22 × 6 + 112 + 2 | 286 |

There are eighteen required source artifacts totaling 3,955 bytes, eight mandatory observations at 2,500 bytes and seven mandatory snapshot slots. Thus the minimum current capture declaration is `3,955 + 8*2,500 + 7*995,000 = 6,988,955`, leaving only **4,045** discretionary capture bytes in the actual pool. Six captures are mandatory final role captures; the seventh is reserved diagnostic capacity even when unused. Current-use cuts are additionally checked and cannot consume a “free” overflow path.

The complete successful Pi trace retains, per reviewer, one exact full-B input, one owned base instruction, five model payloads, five prompt manifests, three tool-call payloads and nine distinct checkpoints (six assistant/tool-result checkpoints, one post-compaction, one final assistant and one terminal-status checkpoint). Across reviewers add one shared compaction instruction, one shared ordinary tools fragment and one shared empty-tools fragment. Content deduplication may save bytes; it must not be assumed for distinct checkpoints or role inputs. No decoded output/reason/binding is retained after the intentional exact-B refusal. Response reservations still cover all twenty-two planned request slots, including unused non-reviewer capacity.

This yields an upper count of **51 new distinct draft entries** beyond mandatory slots. Mandatory source/snapshot/observation/response/metadata/failure slots total `18+7+8+22+2+1=58`; the full projected count is at most **109**, so 112 inventory entries cover this trace. This is an explicit future-slot count, not just the observed prefix's 43 entries.

At refusal, the implementation projects 72 records: B 63,457, final 242,869, owner-without-inline-B 83,460. The four-copy total is `2*B + final + owner = 453,243`, greater than 452,344. Base terms measured from the verifier are B 26,593, final 113,880 and owner 44,876. Ordinary model reservation metadata is final 15,433 / owner 430; tool reservation metadata is final 17,333 / owner 430. The compaction model's longer purpose and extra fragment add `6*4+512=536` final bytes; its worst transition is 2,473 rather than 2,469, still below 2,500.

For all sixteen requests and a conservative 112 projected entries, the complete four-copy promise is:

```text
B       = 26,593 + 112*512                                = 83,937
final   = B + 113,880 + 8*15,433 + 2*15,969 + 6*17,333   = 457,217
owner   = 44,876 + 112*512 + 16*430                      = 109,100
total   = 2*B + final + owner                            = 734,191
```

Thus the full trace would need **281,847** more metadata bytes at those declarations. Reserving merely the observed 899-byte prefix deficit is inadequate. A smaller inventory-entry declaration is a legitimate new-fixture possibility, but 256 is **not** valid for the current vocabulary: the verifier's longest-role entry template is 261 bytes. The observed largest actual prefix entry of 255 bytes is not the admission bound.

There is a further independent downstream failure: the actual ordinary prompt manifest is 969 bytes. Canonically adding the compaction fragment and updating fragment order exactly as `agent-shell/index.ts:209–218` does makes it **1,275 bytes**, exceeding the current **1,024-byte** role prompt bound. The compaction's raw fragments total `112+39+2=153`, so that aggregate is not the failing bound. These are static canonical wire calculations; no compaction run under altered guards is claimed.

The prior 272,572 + 32,321 draft failure was also real. Payload-only sizing omitted the initial input and repeated whole-transcript checkpoints; fixing this one next write does not prove the remaining compaction payload, prompt and final checkpoints fit. Given the decisive source lower bound, this inquiry does not invent exact unobserved full-trace draft sizes to sell another allocation.

## Smallest separately adoptable alternative

Prefer a **fixture-only compact vocabulary** over changing source accounting or adding another acquisition mode. Opaque identifier length and verbose synthetic reason strings are not causal inputs to the assertion that real compaction removed exact B. A new opt-in can use:

| Fixture field | Proposed compact form |
|---|---|
| Original root | `r` |
| Candidate role/allocation | `c` |
| Five control roles/allocations | `k0` through `k4`, retaining their original assignment IDs/kinds |
| Reviewer roles/allocations | `a`, `b`, retaining independent signer/context/provenance identities |
| Synthetic configured reviewer models | `ma`, `mb` |
| Reviewer prompt IDs / base-fragment IDs | `pa`, `pb` / `fa`, `fb` |
| Opportunity IDs | `o0` through `o11`, preserving all families, counts, control coverage and interference relationships |
| Non-semantic synthetic judgment reason text | short nonempty text; retain all judgment IDs/outcomes and the role-dependent fail/unavailable distinction |

Construct these values in the **new compaction setup before** manifest signing, accepted attempt/registration/role/session digests, closure/configuration construction or recorder claim. Do not search-and-replace signed JSON, truncate production-generated physical IDs or share identities between reviewers. Update setup lookups by the explicit alias map, rather than changing existing assertion bodies. Ordinary fixtures and the original-allocation refusal continue using their original vocabulary/allocation.

A static exploratory application of only the root/role/allocation/model/prompt aliases to copied source templates (not a run) reduces the fixed base from 56,336 to 50,576 bytes. Conservatively allowing 24-character variable numeric elapsed/cost fields and five-digit token estimates gives 989,344 before the two compaction fragment/purpose increments. This establishes that identifier changes address the actual source obstruction; it is **not a complete replacement allocation or empirical pass**. Opportunity/reason shortening targets repeatedly retained full-B and final-response bytes, rather than changing source limits. The smaller vocabulary also permits the verifier to reconsider a 256-byte index-entry declaration; recompute its exact longest-entry template first.

Root's finite implementation/adoption gate should be:

1. Adopt this explicit fixture-input change separately from production controls. Preserve the original unchanged failures and all assertion bodies.
2. Build a pure canonical-size worksheet for the complete new fixture, using production serializers and request/checkpoint/fragment shapes. Enumerate all sixteen source bundles, all 51 draft slots, response maxima, seven captures, eight observations, terminal/disposition and all four metadata copies. Bound variable timestamps, elapsed/cost number widths and source/owner wrapper fields; do not substitute a prefix measurement or provider payload length for all retained copies.
3. Freeze one newly signed allocation only after that worksheet proves every sublimit and aggregate. In particular include the three-fragment compaction prompt and all nine checkpoints per reviewer. Use the existing claim validator without exceptions. This document deliberately does not authorize a guessed tuple.
4. Run the unchanged actual case once with mandatory module mocks. Require its exact sixteen/ten/two/three counts, exact-B unavailability, empty tools fragment, owned compaction instruction and unchanged replay count. Then run the original refusal and whole independent file; the already-passing authored 53/53 file is a regression dependency, not a source repair target. Obtain fresh independent review of the new fixture vocabulary and arithmetic.

If a completely composed compact-vocabulary fixture still cannot fit, stop with that proof. The smallest source-level alternative would be separately signed **per-purpose retained full-snapshot slot reservations** (six final role slots plus one diagnostic), each bounded on write, rather than charging every small final control snapshot the largest current original-ledger cut. Keep the complete current-use source guard, seven-slot count, 1M singleton, 8MiB aggregate, raw retention and four-copy metadata accounting. This would require a separately adopted capacity/schema/control change with causal denial tests; it is not authorized or implemented here, and it does not by itself fix the original long-identifier source-cut impossibility.

A naive v2 migration is not equivalent. `review-envelope.ts:309–313` chooses a bounded B pointer/sections input for v2, and `model-review.ts:124–125,240–259` changes evidence reads to bounded selectors/receipts. Losing a pointer after compaction does not test losing the original complete frozen B bytes; the six exact artifact-read predicates also change. If root instead chooses v2, retain a separate explicitly scoped full-B negative membership test and an actual v2 compaction/accounting/replay test, and record that decomposition as an acceptance change. Do not silently relabel the original full-B test as preserved.

## Handoff and limits

Reuse decision: retain actual Pi, production canonical serialization, Store guard, original ledger mapping, recorder, source retention and verifier. No new framework or library is justified. The preferred alternative is confined to synthetic fixture inputs; source-level reservations are a fallback design requiring separate ownership and adoption.

This finite inquiry is complete: a source-derived impossibility bound for the unchanged fixture, complete count/copy accounting, two additional downstream sublimit defects, and a concrete smallest next fixture change are recorded. It neither implements the alternative nor supplies a passing full trace. No physical/native/provider execution, network, private credentials, Slack, full benchmark, publication, push or deployment occurred. Root owns adoption, the separately claimed fixture implementation, central-plan status and fresh review. All pre-existing source and test paths remain unchanged.
