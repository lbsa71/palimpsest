# C1 scope and ownership

Status: implemented draft `aeon1.c1.v1`, not an accepted integration or deployment. Requirements are authoritative; the interfaces below are the initial design. TypeScript ESM is adopted under ADR 0032; executable validators are pure and do not provide authentication, storage transactions or transport authority.

| Requirements | Contract owner / consumer acceptance |
|---|---|
| RW01, RW19, RW21 | L01 scope, owned package and change procedure; L09 dependency/build closure |
| RW02, RW05, RW13, RW17 | `ShellPort`, `ShellBridge`, `ToolCall`, checkpoints; L02/L03/L06 |
| RW03, RW18, RW20 | `MeasurementEnvelope`, case outcomes and exact-candidate evidence; L08/L09 |
| RW04 | `PromptManifest`, fragment replacement and exact emitted payload digest; L02/L08 |
| RW06, RW08, RW09 | `Experience`, `MemoryRecord`, `SelfState`, scope/provenance, disclosure; L04 |
| RW07 | `Goal`, `Drive`, resources, reasons and wakeups; L05 |
| RW10 | Stable run/input/effect IDs, effect reducer, checkpoints and revisioned stores; L03 |
| RW11, RW12 | Revisioned inbound identities, separate human-modification eligibility, speech effects and independent obligations; L07/L05 |
| RW14, RW15 | Authority, immutable candidate identities, previous-control evaluation, release/recovery descriptors; L09 |
| RW16 | Physical-request records, unknown usage, capabilities and dispatch fencing; L02/L03/L06/L09 |

## Fresh-design reuse ledger

| Material | Decision and independent reason | Exact source / maintained cost / validation |
|---|---|---|
| Historical code, store layouts and service APIs | Discard as implementation dependencies. No historical source is imported or copied. | Baseline `14c742041270bb2acb15b4903a970394a140493c`; zero old runtime dependencies. |
| Historical uncertainty, scoping and recovery lessons | Adapt behavioral invariants: interrupted networks and scoped users require them in any fresh design. | Requirements RW09/RW10/RW15; new conformance cases, not old test inheritance. |
| Node SHA256 and test runner | Retain platform primitives instead of implementing crypto or adding a test framework. | Node 24.13.0; `node:crypto`, `node:test`, `node:assert`; runtime license/dependency closure owned L09. |
| Schema framework | Build minimal typed contracts and invariant validators. A second runtime dependency is unjustified for this boundary. | No external runtime packages; strict erasable TypeScript check. These are typed boundary validators, not a general untrusted JSON decoder. |
| Pi shell | External decision adopted from ADR 0032, not bundled by L01. | L02 owns qualification and retained code/license evidence. `ShellPort` keeps its session identities out of authoritative run IDs. |
| SQLite / storage | Deferred implementation choice to L03/L09. | Contracts require atomic compare-and-swap and durable receipts; no database dependency here. |

No language-neutral network schema is promised: values are JSON-compatible and version-tagged by `CONTRACT_REVISION`; foreign-language adapters need their own validation. No data import, runtime implementation, live inference, message sending or deployment occurred in this lane.
