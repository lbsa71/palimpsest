# OD2-b1 R1/R2 finite source repair

2026-10-12. Owner `/root/a1_development_source_admission_repair`, authorized `gpt-6.1-sol` / high, isolated branch `codex/a1-development-source-admission-repair-20261012`, base `18ee6e9dd2a32d1b9797333f1d0c09c41ae11e6b`. Actual finite tool goal created before inspection. Governing inputs: adopted design `7d209fc`, exact author source `574302291afce9d1d85d67edf82e4f302ea4feb0`, unchanged independent review `0cab550`. Writable paths are the source helper, this new evidence and optional new repair test only; every prior test and recorder/plan/driver/DC2 source is read-only.

## Frozen precode behavioral specification

1. At every public boundary, plain data is validated and detached before property use or an accepted reader callback. Context, trust, checker metadata, receipt references, selectors, bindings, supporting receipt slots, interval identity lists and related source arrays reject accessors/proxies with zero getter/trap executions. Existing `inertSnapshot` remains the plain-data validator. Callback-bearing context/source records require only a narrow descriptor seam, with native proxy detection before reflection and ordinary enumerable own data properties. Only their existing named reader functions are accepted; function proxies are rejected without execution.
2. Context plan/policy/trust/key bytes, source identities/bounds, selector identity/brackets, receipt reference, related input membership and checker support slots are pinned before any callback can mutate caller aliases. Callback identities are copied once. Reader withdrawal/current-use checks remain active; detachment never freezes away the recorder's current authority state.
3. A derived opportunity's subject must equal its authenticated checker subject and detached accepted selector. Callback mutation of the caller selector may not redirect proof, observation or slot identity. Learning and direct checker verification must similarly retain the original accepted receipt/binding despite callback mutation.
4. Native Uint8Array/Buffer checker keys remain accepted and copied without invoking caller iterators or overridden accessors/methods. Malformed executable key properties refuse before callback use. No new key/signing/observation authority, proof fields, grant, capacity, semantic success or temporal eligibility is introduced.
5. Preserve existing `failed`/`unavailable` results, bounds, signature authentication, explicit semantic axes, final-use assertions and errors. The original independent four failures must pass unchanged alongside all 33 review and 44 author cases. Add behavioral variants for equivalent public boundaries and mutation timing, rather than tests of helper internals. Run the 31 existing paged-projector cases and strict TypeScript for a source-bound joined receipt.

Reuse/build decision: reuse the established inert snapshot validator and Node native proxy/typed-array introspection; implement only narrow descriptor detachment for accepted callbacks and checker key bytes. No generic framework or dependency is justified. Resources are small local synthetic SQLite/in-process fixtures, existing Node24 runtime and focused checks only. No physical/native/provider/network/private credentials/Slack/full benchmark/push/deploy. Finish this finite repair with a clean exact commit and handoff; fresh independent re-review and recorder integration remain root gates.

## Preserved baseline and validation

Independent review reports 33 cases: 29 pass / four fail (R1 selector mismatch; R2 trust getter once, receipt getter twice, source proxy ownKeys once). Its joined 108 cases report 104 pass / the same four fail, strict pass. These committed tests and evidence remain unchanged. Repair commands, observed results and limitations will be appended after implementation.

## Implemented repair and source identity

Frozen precode specification commit: `a25775c`. Exact source/test commit: `ccb640b977f6df05ce022276ef695503bd81b7b3`; source blob `dcad62b53d8711e394ce115cfc7935d220a254cd`, new test blob `cbdb8f1f9919b051cb3d1c8a3b1942cc85d76cfb`. Baseline source blob `fa24a48e615b3a2da363886169825b2ff6a029df` matches both `5743022` and `18ee6e9`. The independent review test blob remains `a8a661addd8a2d6dceecef5591beaed9723dce21`, byte-identical to `0cab550`.

The outer opportunity selector is detached before source/workload reads and checked against the authenticated subject before proof construction. Receipts, complete bindings, supporting slots, related inputs and interval identity lists are detached before callbacks. Narrow context/source/trust/checker descriptor validation rejects proxies before reflection and accessors before property use; ordinary plain data still uses `inertSnapshot`. Dense related arrays receive equivalent descriptor treatment because their elements contain the accepted callbacks. Native key copies use typed-array intrinsic length/set without caller iterators. Existing reader closures are pinned and invoked with copied artifact references; neither a callback argument nor its `this` receiver exposes the accepted detached record. Actual recorder current-use checks continue to run through those closures. Slot kinds are checked as registered primitive strings before property indexing, preventing executable coercion.

No export, public signature, proof schema, capacity, grant, semantic axis, qualification or signing authority changes. The source has no observer key or signing callback. New tests copy only the unchanged review fixture setup, with new hostile transitions and assertions; no test-registering module is imported.

## Observed validation

All commands run in the assigned worktree with `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`.

- Unchanged independent review: `node --test evaluations/development/development-source-admission-review.test.ts`, **33/33 pass**, zero skip/cancel/todo, **12.589 s** (`/tmp/od2-b1-repair-review.tap`). The original four causal assertions pass unchanged.
- First strict check reported `TS2551` for the typed array-descriptor map's `length.value`; an explicit descriptor record type corrected the source typing. Subsequent `node node_modules/typescript/bin/tsc --noEmit` checks pass, including the final exact source/test commit.
- First new-variant check: **28/31 pass, three fail**, zero skip/cancel/todo. Failures were new prototype-sensitive `deepStrictEqual` comparisons of identical inert null-prototype proof references against ordinary caller references. Only these new assertions changed to compare exact canonical reference identities; no prior test or source acceptance changed to resolve them. Output preserved at `/tmp/od2-b1-repair-variants.tap` and causal description here.
- Preliminary five-file focused join: **139/139 pass**, zero skip/cancel/todo, **53.301 s** (`/tmp/od2-b1-repair-joined.tap`). Two additional variants then passed with the final new suite: **33/33 pass**, zero skip/cancel/todo, **6.980 s** (`/tmp/od2-b1-repair-variants-final.tap`). They cover ordinary native Uint8Array key copying and executable slot-kind coercion refusal.
- Two setup patch attempts failed their expected-line checks without modifying files. They were corrected before implementation. No runtime predicate or old test was changed as a consequence.

Final source-bound command, run against `ccb640b977f6df05ce022276ef695503bd81b7b3`:

```text
node --test evaluations/development/development-source-admission-repair.test.ts evaluations/development/development-source-admission-review.test.ts evaluations/development/development-source-admission.test.ts evaluations/development/development-observer-pages.test.ts evaluations/development/development-observer-pages-review.test.ts
```

**141/141 pass**, zero fail/skip/cancel/todo, **146.794 s** (`/tmp/od2-b1-repair-joined-final.tap`). Breakdown: 44 unchanged author + 33 unchanged independent review + 31 unchanged paged-projector + 33 new repair variants. Final `node node_modules/typescript/bin/tsc --noEmit`: pass. `git diff --check`: pass. Runtime durations include concurrent local test load and do not establish performance qualification.

Ownership comparison against `18ee6e9` contains only the three assigned paths: helper source, new repair test and this new evidence. All prior source/test/evidence paths remain byte-identical; the final evidence-only handoff commit follows the exact tested source/test commit. No live/private/network/provider/physical process or publication/deployment was used. Temporary output files are convenience receipts; committed case-level predicates and this report preserve their results without depending on those paths.

## Limits and next owner

This is implemented, fixture-verified source admission repair. Synthetic certificates/keys are host seams and do not establish checker competence, real growth/transfer, matching quality, host clock qualification, capacity/performance qualification, H1 or deployment. Actual recorder retention/signing/replay, proof-slot occupation, owner/reopen fences, preclaim/index/wrapper accounting, DC2 composition and full workload remain separately owned gates. Fresh consequential re-review is still a root acceptance gate; this finite repair finishes without waiting for it. DC2 received the exact source checkpoint and private descriptor/callback approach directly; there are no API changes to integrate. Root owns the next import, fresh review and held b2 signing integration.
