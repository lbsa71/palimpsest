# ADR 0025: Retained verification and execution environments

- **Status:** Selected design for implementation; mechanisms, transition fixtures and autonomous activation remain unimplemented.
- **Recorded:** 2026-10-09.
- **Requirements:** R06, R09–R11, R14, R16–R19, R26; A17, A22, A23.
- **Work:** Production dependency integration in P17 and repeated evaluator/dependency evolution in P18; [testable contract](../retained-environments.md).
- **Refines:** [ADR 0019](0019-coding-autonomy-and-reusable-agent-plumbing.md), [candidate evidence](0004-candidate-bound-evidence.md) and the limits of [operator host installation](0016-operator-host-baseline.md).

## Context

Full-codebase autonomy and the ability to maintain local library forks are user requirements. At source checkpoint `ff855e1`, verification depends on the installed evaluator's hash, its runtime/dependencies and Git base objects. Retained service source links shared checkout dependencies. Changing these inputs can invalidate an older release's verification or rescue. Existing custody artifact membership includes unaccepted proposals, so it cannot authorize executing a historical verifier.

An operator baseline restores cognition under the current host. It neither supplies a general historical environment dispatcher nor proves that previously admitted controls autonomously approved their replacement. These are implementation limits to resolve, not permanent restrictions on the autark's source authority.

## Decision

Use one host-owned resolver for verification and execution environments. Separate an immutable environment object from its independently admitted release/evidence/custody binding. This avoids circular identity and distinguishes captured bytes from authority. Keep original manifests/evidence unchanged. Initial admission, exact historical interpretation and future evaluator authority are distinct operations; staged or rejected receipts cannot select recovery code.

Retain original verifier/check imports, Node/compiler/native and installed dependency inputs, required Git baseline materialization and resolution/launch metadata. Use fixed immutable installations initially. Select the retained verifier through trusted provenance, verify its inputs before execution, and run it in a bounded child under the retained runtime. It receives no production authority or writable custody. The currently accepted contract admits replacements; newly admitted rules govern subsequent transactions.

Derive verified execution projections with regular source copies and host-selected dependency access outside candidate-writable paths. Keep frozen source and publication link-free. Route checker, protected checks, normal/scoped workers, service, historical verification/publication and workspace runtime selection through the same descriptor contract. Preserve canonical paths required by historical identity until an explicitly evaluated relocation or retirement.

Publish usable bindings only after complete verified capture and durable admission. Preserve incumbent/fallback/rescue and in-flight references across interruption; deny deletion of referenced inputs or the last usable rescue. Demonstrate two successive evaluator/dependency transitions and recovery with original checkout, network and provider unavailable. Current state and unknown/spent effects survive. The resolver and retention controls can themselves evolve through a later transaction with older recovery retained.

## Alternatives and consequences

- **Current evaluator and shared dependencies for every release:** Small, but breaks historical compatibility as those inputs change. It does not meet repeated autonomous evolution.
- **An exception that imports a candidate-selected old evaluator:** Confuses artifact existence with authority and still inherits the current runtime. Reject in favor of independently admitted binding and bounded retained-runtime execution.
- **A generic compatibility interpreter:** Possible after separate admission and equivalence tests. Original retained verifier execution is the initial choice because it preserves semantics with less translation work.
- **Full per-environment bundles:** Valid and straightforward to inspect, with disk duplication. Exact-reference dependency reuse with per-release projections is also valid; neither requires a general package manager or automatically makes old absolute paths relocatable.

This adds durable environment ownership and consumer routing. It must retain real installed closure contents rather than trusting only a lockfile or symlink text. Storage capacity can delay new work, but cannot silently evict a required rescue. Historical verification establishes integrity under recorded rules; current custody still controls activation and current-state compatibility.

## Acceptance and evidence

The [contract](../retained-environments.md#acceptance-and-implementation-slices) covers provenance/bootstrap, capture and admission crash gaps, A→B→C upgrades, real package resolution in each consumer, offline checkout-independent recovery, tamper/downgrade refusal, source/draft fidelity and reference-aware retention.

This ADR selects a design from source review; it records no runtime test, installed dependency or live upgrade. Initial operator-assisted migration and deterministic transition fixtures are intermediate evidence. P18 completion still requires actual autonomous admission/activation under older controls, including independently usable rescue and current-state continuity.
