# ADR 0020: Isolated file tools and observable workspace recovery

- **Status:** Selected for the first P17.2 file-backend slice; independent fixture review passed, command/model/serving integration pending.
- **Recorded:** 2026-10-09.
- **Requirements:** R03, R06, R14, R17–R19, R22–R26.
- **Work:** P17.2/P17.3; [workspace contract](../workspace-primitives.md), [ADR 0019](0019-coding-autonomy-and-reusable-agent-plumbing.md).

## Context

Repository tools must read and mutate actual source without granting access to credentials, lived state or the installed admission controls. Unrestricted host path checks cannot defeat parent replacement. Real sandbox probes also showed that an outside inode pre-linked into a granted workspace remains readable/writable through that hardlink. SQLite effect receipts and filesystem mutations cannot share one transaction.

## Decision

Use a plain-copy workspace outside the repository with host-owned sibling control/staging records. Import independently verified source as explicit file bytes and normalized modes; preserve full-tree identity and reject links, nonregular entries, `.git` metadata, path escapes and filename/parent aliases. Source verification against the actual admitted artifact remains a required integration step, not an implication of a caller-supplied matching digest.

Run an installed trusted filesystem helper through the existing deny-default macOS sandbox. Grant only the selected tree and staging directory in addition to the backend's required runtime reads/disposable scratch. Keep network/process creation denied. Validate entry types, open regular files with `O_NOFOLLOW`/`O_NONBLOCK`, and check opened metadata including `nlink === 1`. Unsupported platforms fail closed. Parent races rely on actual OS confinement plus exclusive application writer ownership; no promise of protection against unrestricted hostile processes already running as the same user is made.

Hold a collection coordinator lock and a persistent per-workspace writer claim through actual helper termination and final journal handling. The claim records separate coordinator/helper identities. A dead helper does not prove a still-running coordinator released ownership. Epoch adoption/reconciliation requires current authorization and independently absent former coordinator/helper PIDs. Live/reused/unknown PIDs are held. The default no-fork helper makes direct-child absence meaningful; this procedure cannot be reused for general command descendants.

Clone accepted arguments before asynchronous execution. Reserve each operation with task/workspace/base/epoch/helper identity before launch. Flush staged contents and a versioned exact pre/post manifest, then apply same-filesystem renames or explicit directory operations. Independently verify postconditions and recheck authority before recording progress, including after secondary observation calls. Receipts can be lost without replaying mutations: exact postconditions resolve completed, exact preconditions resolve not-applied, and mixed states remain uncertain. Compare staged argument digests with the host journal. Directory existence alone cannot establish an empty-directory mutation completed.

This selects a mechanically restricted file backend, not a permanent limit on editable source. Future candidates can author replacements for the helper/receiver/admission source in their workspace and submit them under the appropriate older controls and retained rescue. They cannot modify the installed controls judging their current draft.

## Alternatives and consequences

- **Unrestricted host filesystem operations after `realpath`:** Smaller code, but exposes outside files to path races and cannot enforce candidate execution restrictions.
- **Directory-handle native backend:** A valid future alternative with proven race-resistant semantics. Node's public file API does not provide a complete `openat`/directory-handle protocol for this implementation, so adopting one adds a native boundary to evaluate.
- **Allow a reusable coding agent to execute its own tools:** May supply richer editing, but its filesystem, effects and session defaults do not establish Palimpsest's authority/recovery contracts. Protocol reuse remains behind the host receiver.
- **Treat a recorded effect as an atomic filesystem transaction:** Incorrect across SQLite and files. Staging and observed pre/postconditions make uncertainty explicit.

The first slice supports bounded discovery/literal search/byte reads and conditioned file/directory mutations. It adds no production dependency, provider call, public route or live release. General commands need separate output retrieval, descendant ownership/recovery and resource guarantees. Unknown-PID claim recovery, lifetime staging limits and actual admitted-source/serving integration remain open. Flush/rename fixtures establish tested interruption behavior, not hard power-loss durability.

## Evidence and acceptance

Real Seatbelt fixtures exercise supported file operations, Unicode/binary handling, links/path swaps, preconditions and stage/receipt failure points. Receiver tests exercise actual files plus the host journal, restart, epoch/owner transitions, cancellation and replay prevention. Independent final review matched exact source/test hashes and passed 14 helper and 18 receiver checks, with additional disposable helper probes; root passed 57 relevant checks and TypeScript, with one expected platform skip. Evidence and limitations are in the [workspace record](../workspace-primitives.md). The [workspace criteria](../workspace-primitives.md#acceptance-dependencies-and-material-risks) and A22 remain the full completion contract; passing a file-only subset does not complete P17.2/P17.
