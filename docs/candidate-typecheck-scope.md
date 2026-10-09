# Candidate typecheck input boundary

Status: separate host-correction specification, 2026-10-09. This supports P17's [coding contract](coding-autonomy.md) and the current [candidate contract](candidates.md). It changes no historical candidate, spent reservation or review outcome. Implementation/fresh admission are pending.

## Problem and expected behavior

The installed evaluator passes every frozen `.ts` file to the compiler with `--ignoreConfig`. A separately pinned experimental package is therefore compiled using the production dependency grant, even though the root project includes only `src`, `test` and `scripts` and the experiment's nested dependencies are intentionally absent from the frozen snapshot. The final P06 attempt exposed eighteen unrelated missing-import errors in experimental code alongside four real candidate type errors and a real Unicode failure.

Define the input boundary in the installed trusted evaluator. Check all production source/test/script roots and their compiler-resolved import/declaration closure. Classify the existing standalone experiment packages explicitly; their source/locks remain in full artifact identity and their separately pinned checks remain experimental evidence. An unknown new TypeScript location fails until its evaluation contract is admitted. A production import of experimental code must enter the checked closure or fail on missing/incompatible dependencies, rather than become an unchecked runtime dependency.

Candidate-controlled `tsconfig` exclusions, labels or manifest fields cannot weaken this transaction's installed policy. Do not install unused experimental SDKs into production just to silence diagnostics. Keep the existing typecheck, trusted-agent and required item checks; an application type error or missing import remains a failure.

## Version and evidence binding

New frozen candidates bind a versioned typecheck policy and its trusted implementation identity in their manifest/evidence. The selected inputs and policy must not silently change after approval. A replaced policy requires new frozen evidence under the previously accepted outer procedure. Retain a compatible legacy interpretation for historical manifests lacking the new binding: those retain their original all-manifest `.ts` input semantics, including their original failures. Do not reclassify the recorded P06 candidate as passed.

Initially classify production TypeScript under `src/`, `test/`, `scripts/` and applicable `trusted/` declarations, plus the exact declared standalone packages `experiments/coding-provider` and `experiments/coding-provider-adapter`. Verify the actual package boundary rather than treating any future `experiments/` path as an automatic exclusion. Recognize supported TypeScript module/declaration extensions explicitly. Source import resolution remains enabled. Full-codebase authoring remains the product requirement; new source locations and policy upgrades use their corresponding evaluation contract, not a permanent human-only restriction.

## Acceptance, non-goals and risks

Establish red behavior with an actual frozen fixture containing an unused standalone experiment with an absent dependency: the existing all-file checker fails; the new explicitly bound production policy passes while retaining experiment hashes. Then demonstrate:

1. Type errors and missing dependencies in every production root fail, including a root test/script and imported declaration/module.
2. Production imports entering experimental code are checked; a broken/missing dependency fails rather than being omitted.
3. Unclassified TypeScript paths and malformed/altered policy bindings fail closed. Candidate configuration cannot exclude a known production failure.
4. Copied immutable host/checking paths retain identical policy/toolchain behavior. Policy changes invalidate newly bound evidence.
5. Legacy manifests remain interpretable under original semantics. Full snapshot/package/lock identity and independent behavior checks remain bound.

This is not a waiver for the candidate's own compile/Unicode defects, a replacement of its author-written source, a new model call, a root dependency install, a budget refill or broader source admission. Risks are skipped executable source, accidental policy reinterpretation, missing import-closure checks, unbound evaluator changes and treating experimental compatibility as production packaging. Fresh independent source and frozen-artifact review precede any consequential host activation.
