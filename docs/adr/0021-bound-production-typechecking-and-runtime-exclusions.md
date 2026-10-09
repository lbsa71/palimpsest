# ADR 0021: Bound production typechecking and standalone runtime exclusions

Status: implemented, independently source/frozen reviewed and installed, 2026-10-09.

## Context

The all-manifest TypeScript check compiled separately pinned experimental packages without their nested dependencies. This added eighteen unrelated diagnostics to a real failed P06 candidate. A compiler exclusion alone proved insufficient: fresh review demonstrated a computed runtime import executing type-defective excluded source while static checks passed. Historical candidate identities and failures must remain unchanged.

## Decision

New manifests use schema 2 with required policy version 1, installed evaluator SHA-256, exact production TypeScript entrypoints and exact standalone runtime-excluded paths. Installed classification covers production roots and explicitly declared pinned experiments; unknown paths/packages fail closed. The compiler resolves static import/declaration closure. Candidate configuration cannot remove inputs. Full artifact identity retains every experiment file and lock.

Protected behavior checks and both normal/scoped serving workers deny reads of excluded packages through the existing sandbox. This covers computed import, CommonJS loading and direct reads without pretending the compiler resolves arbitrary runtime strings. The compiler itself retains read access to diagnose static imports. Exclusions are path-based over immutable read-only snapshots.

`readManifest` retains historical schema-1 parsing. Default new verification/evaluation rejects schema 1; an independently supplied exact historical digest from custody, installation metadata or recorded promotion permits original semantics. New bootstrap/proposals receive no candidate-selected exception. New freezing never falls back to schema 1. Policy changes require new evidence; replaced evaluator bytes invalidate newly bound policy.

## Alternatives

Installing unused SDKs into the root would hide the packaging mistake and enlarge production dependencies. Candidate-controlled compiler exclusions would weaken admission. Static import parsing or banning one dynamic-import spelling misses `require`, computed paths and direct reads. Rejecting every historical artifact would break recovery. Treating a recomputed manifest as historical proof would create a downgrade route.

## Consequences and verification

This keeps experiments separate and closes their current cognitive runtime reachability while retaining exact provenance. Later admitted runtime/dependency integration can revise classification; the rule is not a permanent source-authoring restriction. Legacy rescue retains original behavior. Declaration use-site checking with `skipLibCheck` does not establish exhaustive declaration validation, and this path rule does not protect writable content against relocation.

Real frozen compiler, behavior and normal/scoped worker fixtures reproduce and close the computed-import bypass; legacy custody fixtures reproduce recovery/service rejection then pass while new/forged legacy admission remains denied. Fresh review and exact frozen admission are separate required gates. No candidate failure, reservation, model or live service is changed by this decision document. The [specification](../candidate-typecheck-scope.md) records scope, risks and evidence limits.

The installed record is host `a27b6e7d` from commit `27d5ebb`; [progress](../progress.md) records exact frozen and live observations. Subsequent schema-2 policy/implementation replacement must preserve a runnable original verifier and runtime; compatibility across that future transition is not established by this installation.
