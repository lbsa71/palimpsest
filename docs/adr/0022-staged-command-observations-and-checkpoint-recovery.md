# ADR 0022: Staged command observations and checkpoint recovery

- **Status:** Selected staged implementation; runner, checkpoint helper and receiver independently reviewed, serving acceptance pending.
- **Recorded:** 2026-10-09.
- **Requirements:** R06, R14, R18–R19, R25–R26; P17.2, A22.
- **Refines:** [ADR 0020](0020-isolated-workspace-files-and-reconciliation.md), [command specification](../workspace-commands.md), [coding autonomy](../coding-autonomy.md#staged-command-execution-and-recovery).

## Context

Real edit/test/repair needs executable feedback. Candidate programs can invalidate their source tree, and filesystem mutation, binary capture and SQLite receipts cannot commit together. A valid draft after interruption does not reveal an exit code. Returning only a truncated text buffer also loses binary coordinates and prevents reliable continuation.

## Decision

Initially execute only the trusted current Node and hash-bound installed native TypeScript compiler. Verify the independently selected frozen runtime profile and complete installed toolchain before reserving and revalidate it before launch and final acceptance; derive the extra read grant from that compiler's package root. Candidate input supplies argv and a relative cwd, never executable paths, grants, environment or credentials. Deny fork/network and retain the existing sandbox. Selected in-process Node tests can run; general builds, subprocesses, dependency/fork execution and full-suite compatibility remain future requirements.

Use the existing task/effect journal, collection coordinator exclusion and workspace writer claim. Bind exact cloned command, epoch, runtime, grants and limits before any command dispatch. Capture a latest verified quiescent checkpoint before launch. Persist null PID before every helper/command transition, then the actual PID synchronously. Hold ownership through process close, stream drain/sealing, trusted post-tree inspection and final current-policy lookup. Unknown/reused PIDs remain held. The trusted coordinator must call targeted `cancel` or collection `stop` on task cancellation/revocation; policy lookup alone rejects late results but does not signal the active process. Wiring those events is a serving gate.

Spool separate stdout/stderr raw bytes into private host files outside candidate grants. Initially limit combined capture to 1 MiB and command duration to thirty seconds. Final receipts bind exact stream identities, sizes/hashes and output completeness. Page retrieval checks current task/workspace authority and sealed bytes; expose base64 plus optional valid UTF-8 text, without arbitrary file paths or cross-stream ordering.

Separate process exit, workspace usability and engineering acceptance. Recovery independently validates any finalized receipt against the original reservation. Missing/tampered evidence remains unknown/unsuccessful/incomplete. Once old owners are proven stopped, a fresh valid tree can settle operational uncertainty without creating a passing check, replaying the command or refunding its allocation.

Retain unsupported post-command trees. Restore a new workspace identity only from the sealed pre-command checkpoint through the isolated helper. Preserve binary/executable/empty files, empty directories and modes, earlier valid edits and the original immutable base manifest. Record old/new lineage; the abandoned tree and spent effect remain.

Bound admitted retention to at most sixteen command intents and eight retained workspace controls per collection, with trusted lower limits allowed. Count failures, unknowns and abandoned/partial controls across reopen. No automatic evidence deletion or refunds. These admission limits do not bound command disk growth before validation, ordinary file-operation staging, CPU/RSS or all lifetime storage.

## Alternatives and consequences

- **Arbitrary shell/npm scripts immediately:** Useful wider capability, but require independently owned descendant/dependency/resource contracts. Native compiler and selected no-fork tests provide a smaller first executable lane.
- **Return only capped text:** Simpler, but loses arbitrary bytes and trustworthy continuation. Raw private spools add storage identities and sealed paging.
- **Treat tree validity or effect settlement as command success:** Invents an outcome after receipt loss. Distinct observations allow continued work while preserving unknown evidence.
- **Hold invalid drafts indefinitely or rebuild from the original base:** The former blocks progress; the latter discards earlier edits. A sealed latest checkpoint preserves continuity in a separate workspace.
- **Delete old controls or reset limits on restart:** Loses evidence and defeats admission bounds. Retain original effects/copies until a separately specified retention procedure exists.

The receiver remains host-only. Serving must select source/runtime profiles from trusted admission records and preserve peer isolation; a matching frozen byte list alone does not supply admission authority. Unknown PID recovery, durable model rounds, broader commands and live acceptance remain open. Relevant checks and material limits are recorded in the [command specification](../workspace-commands.md#verification-record).
