# A1-L08 developmental raw-store prerequisite

## Root-owned deduplication read-bound repair claim

After the author's finite handoff `6c6da87`, fresh reviewer `/root/a1_development_raw_store_review` reproduced three known-size duplicate verification failures: an existing one-byte artifact, an existing empty artifact, and an `EEXIST` create-race fixture each read a corrupt 100-byte file before rejection. The reviewer observed two buffer allocations and two data/EOF reads in each case. Corruption is rejected, but the duplicate path uses the larger store capacity instead of the already known expected byte length. This finding is separate from the unchanged `usage()` inventory scans. The initial fourteen-case review has eleven passes and three failures; strict compilation passes.

Root takes exclusive ownership of the narrow follow-up in this now-idle author worktree; the completed author remains read-only and the fresh reviewer retains its independent tests/evidence. Before code: change only the two duplicate verification reads to pass `bytes.byteLength`, including zero bytes, so a larger existing file is rejected at `fstat` before allocation/data read. Preserve all content/hash checks, exclusive-create behavior and other limits. Run the frozen reviewer reproductions, existing author focused checks and strict compilation, then hand the clean repair to the same fresh reviewer. No native/acquisition/provider operation, larger capacity, inventory rewrite or new dependency is part of this repair.

Status: **implemented and fixture-verified; fresh independent review pending before actual use**. Finite component owner `/root/a1_development_raw_store`, branch `codex/a1-development-raw-store-20261011`, worktree `/home/palimpsest/migration/aeon-1-20261011/development-raw-store`, base `7ed8943`; root reservation `aa594fb`. Exclusive writes: `evaluations/qualification/store.ts`, new `evaluations/qualification/store-bounds.test.ts`, and this record. Governing inputs: [workflow](../../workflow.md), [lane](../../lanes/A1-L08-evaluation.md), and adopted [acquisition design](development-acquisition-design.md).

```text
/goal Freeze, implement and validate exact raw-byte retention and descriptor-pinned per-read bounded evidence reading in QualificationStore, preserving canonical JSON and store invariants; return clean commits and case-level offline evidence for fresh independent review before actual use.
```

## Pre-code behavior freeze

Reuse the existing `QualificationStore`, its pinned directory descriptor, SQLite writer lease, immutable content addressing and store capacity. A second store, base64/JSON wrapper or general storage framework would add maintained scope and cannot substitute for the actual bytes. The release artifact/qualification observer bounded readers provide the established local pattern to adapt. This is a narrow extension to a rewrite component, not a compatibility obligation to historical code.

1. `put(value)` continues storing exactly `Buffer.from(canonicalJson(value))`. New `putBytes(bytes: Uint8Array)` stores an owned snapshot of exactly those bytes, including empty input, zero bytes and invalid UTF-8; the returned URI and SHA-256 describe those bytes. Identical JSON/raw byte streams share the same artifact. Input larger than the store capacity rejects before a copy/write. Caller mutation after return cannot alter stored data.
2. `readArtifact(ref, maxBytes = capacityBytes)` requires a safe integer bound in `[0, capacityBytes]`, a valid exact `sha256:` reference and a held lease. Read only the named artifact through the already pinned directory. `O_NOFOLLOW | O_NONBLOCK` and pre-read `fstat` require an owner-only, owner-owned, regular, single-link file whose size is at most the requested bound. Reject oversized input before buffer allocation or any data read; the development caller supplies `1_000_000` or its smaller remaining allowance.
3. Allocate exactly the pre-read size, read at explicit offsets until complete (short positive reads are supported), then probe EOF and compare descriptor metadata before/after (size, modification/change time, mode, device/inode/owner and link count). Empty files still receive EOF/post-read verification. Finally hash the exact bytes against the reference. Shrink, growth, replacement content or metadata changes observed during the read fail; no truncated or partially verified bytes escape. The descriptor pins an opened file even if its pathname is replaced; content identity, rather than a second path lookup, determines acceptance.
4. A duplicate `put`/`putBytes` first verifies the existing exact bytes and succeeds without adding usage, even at byte or entry capacity. Missing artifacts use existing exclusive-create/fsync writes and aggregate capacity enforcement; existing wrong bytes or unsafe files fail. The demonstrated old defect is capacity rejection before `EEXIST`; repair only this deduplication path. Claims/grants remain one-use and crash-conservative.
5. Preserve directory identity, owner-only directory checks, lease semantics, maximum 256 MiB capacity and the existing strict `names.length < 4096` usability rule (including writer files). A new write must not cross that rule and strand an otherwise valid store. Invalid names, refs, bounds, links, directories/FIFOs, ownership/permissions and closed leases reject. No API relaxes lease or file checks.

## Frozen causal cases and scope

Focused temporary-file fixtures prove binary identity and JSON identity; snapshot ownership; empty bytes/zero bound; hash/ref/path failure; preallocation rejection via allocation/read spies; exact-bound success and short reads; growth, shrink and metadata mutation during a read; content corruption; symlink/hardlink/nonregular/permission rejection; pathname replacement preserves opened-descriptor identity; deduplication at full byte/entry capacity; new-write capacity rejection; one-use claims; directory identity after directory rename/replacement; exclusive and closed leases. Module/builtin mocks are limited to observing or injecting read-time faults, restored after every case. No provider, network, native baseline, account, Slack or deployment action is involved.

Run Node 24.13.0 strict compilation and the new tests plus directly affected existing qualification/development suites; avoid broad materialization checks. Record observed failures before repair, commands/results and limits here. These fixtures establish byte retention/read enforcement, not the developmental attempt's 512-record/8-MiB aggregate budget, observation completeness, independent reviewer competence or autonomous/product acceptance. Those remain acquisition/integration responsibilities. Fresh independent review of the frozen component is required before actual use; root owns that gate and lane status.

## Implementation and causal evidence

Pre-code freeze: `b694edb`. Source/tests checkpoint: **`fd7ab1141d5a391ddb8334fcddafb2d9fbc80b74`**. The existing store now exposes only the two narrow changes above: exact `putBytes` and optional bounded `readArtifact`. The JSON API delegates its unchanged canonical byte stream to the raw retention path. Read admission precedes allocation/data access; EOF is probed before the final `fstat`, so mutations at the EOF probe also fail. No dependencies or shared contracts changed.

Two old defects were reproduced using the exact `7ed8943` store source copied to a temporary `.ts` module, with only its relative package import prefixes rewritten to absolute paths so the same dependencies loaded. With a three-byte store, `put('a')` retains `"a"`, then a second identical `put('a')` throws `Private evidence capacity exhausted`. In a second fixture with 4095 valid entries including writer files, a new `put('new')` succeeds and creates entry 4096, after which `usage()` throws `Private evidence entry limit`. The repair verifies duplicates before the new-write capacity path and checks the strict entry ceiling before exclusive creation. These reproductions used temporary empty files and no native comparator or provider.

The 27 new causal cases in [store-bounds.test.ts](../../../../evaluations/qualification/store-bounds.test.ts) passed:

| Cases | Observed behavior |
|---|---|
| Binary stream, owned snapshot, canonical JSON, empty stream | Disk and returned bytes match the actual input SHA-256; input/output mutation cannot change storage; raw/JSON aliases deduplicate; empty bytes pass at bound zero. |
| Oversized read, invalid bounds/reference, oversized raw input | Oversized reads and invalid bounds/refs perform zero allocations and zero data reads; oversized raw input performs zero snapshot copies. Exact-bound success remains available. |
| Short reads; grow/shrink/overwrite/chmod/hardlink/EOF mutation; empty EOF growth | Short positive reads complete the original stream. Every injected mutation fails before an artifact is returned, including changes after the EOF read itself. |
| Path replacement; corruption; unsafe links/directory/permissions; unknown entries | Replaced paths cannot substitute bytes for the descriptor. Same-size corruption fails hash and duplicate verification; unsafe files and unknown store names reject. |
| Ownership/FIFO metadata and open flags | Injected foreign-owner and nonregular FIFO metadata reject before data reads; observed open flags include `O_NOFOLLOW` and `O_NONBLOCK`. This is a metadata fault fixture, not a real FIFO/foreign-UID host experiment. |
| Byte/entry capacity, one-use claim/grant, pinned directory, leases | Verified duplicates work at full byte and usable entry capacity; new writes fail before crossing either ceiling. Failed second claim writes strand the original grant. Directory replacement leaves reads, writes and identity on the original descriptor. Concurrent acquisition and all storage calls after close reject. |

Node runtime prefix for all checks: `PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH`.

```sh
npm run check
node --test --test-concurrency=1 \
  evaluations/qualification/store-bounds.test.ts \
  evaluations/qualification/qualification.test.ts \
  evaluations/qualification/reconstruction.test.ts \
  evaluations/development/assess.test.ts \
  evaluations/development/witness.test.ts \
  evaluations/development/witness-review.test.ts
git diff --check
```

Final observed result: normal strict compilation passed; **76 tests passed, zero failures/skips/cancellations** (27 new plus 49 directly affected prior cases), approximately 5.44 seconds. Initial consumer regression found the oversized JSON error message changed from `capacity exhausted`; the original message was restored and the entire focused set rerun successfully. The first strict attempt also identified a test-helper overload type error, repaired using the native `TestContext` type. No tests were weakened, skipped or edited outside the exclusive paths. Source changes are limited to the store and its new tests.

## Handoff and limits

Root receives the pre-code, implementation and evidence commits for integration and fresh independent review. Author implementation/fixture goal is complete; review approval and actual use remain outstanding. The acquisition owner must pass the remaining per-artifact allowance to `readArtifact`, account distinct retained bytes and envelope overhead across the original attempt, reserve tail space and enforce the separate 512-record/8-MiB limits. Omitted `maxBytes` intentionally keeps the existing store-cap default for current JSON consumers.

The existing `usage()` inventory still verifies and reads each existing entry using its store-cap bound; this change does not build a new metadata index or optimize whole-store scans. The new bounded artifact read accesses only its named descriptor and does not invoke inventory. Owner-only permissions and a lease are integrity assumptions for a host-private directory, not confinement against a privileged hostile host. Metadata/EOF/hash checks detect observed read-time changes, not every host action or a mutation after verified bytes are returned. Real FIFO/foreign-owner behavior, live acquisition, physical/model accounting, review competence, aggregate development limits, autonomous qualification, deployment and H1 are outside these fixtures. No provider/account/network/Slack/native baseline operation occurred.
