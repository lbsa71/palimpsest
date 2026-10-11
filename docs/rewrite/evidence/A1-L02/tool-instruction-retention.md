# Exact tool instruction retention

2026-10-11. Finite A1-L02/RW04 instruction provenance task under the [fixed specification](tool-instruction-retention-specification.md). Owner `/root/a1_tool_instruction_retention`; base `6085f1f`; branch `aeon-1-tool-instruction-retention-20261011`; worktree `/home/palimpsest/migration/aeon-1-20261011/tool-instruction-retention`. Actual finite goal created without a token budget. Scope: shell internal option, trusted broker/application tool instruction wiring, focused consumer fixtures, this evidence, and the relevant acquisition paragraph. C1/storage/resource/lifecycle implementations remain read-only. Root explicitly approved four runtime/initiative fixture adaptations.

## Behavioral specification and reproduction

Before editing, exact JSON serialization of a deterministic tool source produced `shell:tools:de7a51a2c5079633ac1cc75c3d357993f1bdd4e7fc5141c0f0c8778f115e623d`. Calling `OperationalStore.readArtifact` with that original reference returned `foreign artifact URI`. The source was not retained by shell manifests. Historical references/bytes are not migrated or reconstructed.

Trusted application retention now uses `store.putArtifact(source)`. Broker snapshots the host tool configuration and retains/reads exact `JSON.stringify(tools)` bytes before worker start. It supplies mandatory internal tool artifacts to the worker; a compaction request instead uses retained `[]`, matching its actual provider payload. Shell verifies exact bytes/digest before capture; broker verifies descriptor, scope, effective system/compaction instructions, provider tool projection and request purpose before reservation/dispatch. Different definitions retain different identities. No alias registry, new store, dependency or legacy fallback is introduced.

## Frozen validation plan

Node 24.13.0 at `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`; dependency access is the existing root `node_modules` symlink, with no install. Pure checks already observed: strict `npm run check`; 35/35 existing shell/Mistral boundary regressions; 8/8 new deterministic retention checks, including noncanonical source serialization, versioned plain/resumed/child/compaction/reopen and host/worker refusals before fetch. The new child fixture exercises broker/shell input; actual application delegation is a separate physical check below.

Root reserved a serialized confined-worker window. Freeze implementation and this plan before execution. Execute these existing suites sequentially, without deadline/grant changes or paid inference:

1. `node --test deployment/broker-shell.test.ts`: two real isolated Pi paths (plain and compaction), hostile worker and provenance mutations; assert original source artifacts resolve in a reopened store.
2. `node --test deployment/provider-portability.test.ts`: original Mistral/OpenAI restart/compaction provider fixtures using synthetic host transport.
3. `node --test --test-name-pattern='^(ordinary authenticated conversation|ordinary delegation runs|graceful close persists)' deployment/application.test.ts`: original authenticated conversation, actual bounded child and graceful resumed application paths, with exact retained source/provider projection and reopen assertions. Other application cases are deliberately outside this focused window.

Retain first outputs including failures outside the checkout at `/home/palimpsest/migration/aeon-1-20261011/tool-instruction-retention-evidence/`. No provider/account/auth/key inspection, external messages, service installation, paid inference or external provider network is authorized. Application fixtures use existing local direct HTTP and synthetic provider transport.

## Observed execution and limits

Implementation/fixture plan frozen at `fd9af7f9acbad2fe0afd97a77761a81a6497ac60` before physical execution. First runs passed without adjustment:

| Command / original plan item | Observed result | Retained first output |
|---|---|---|
| Broker suite | 9/9 pass, 0 skip/fail; 1.385 s | `broker-first.log` |
| Provider portability suite | 3/3 pass, 0 skip/fail; 1.662 s | `portability-first.log` |
| Filtered actual application paths | 3/3 pass, 0 skip/fail; 2.778 s | `application-first.log` |
| Adapted direct shell runtime/initiative fixtures | 19/19 pass, 0 skip/fail; 1.463 s | `direct-consumer-first.log` |

Logs remain in the external evidence directory above. Node's name filter reports only the three selected application cases; the other application cases were not executed, rather than passed. Final strict compilation and `git diff --check` passed. Physical namespace window was released to root immediately afterward.

The actual application child used a different tool source identity from its parent: five parent model requests and two child model requests retained seven original manifests. Every tool source resolved after application/store reopen and projected exactly to its stored provider payload. Ordinary conversation retained four request manifests across application reopen; graceful interruption/resume retained both request manifests with one unchanged source identity. Real broker compaction retained `[]`, with no tools in that provider payload; following reasoning requests retained the ordinary nonempty source. Mistral/OpenAI physical portability fixtures preserved their existing restart/compaction and usage checks.

Evidence is implemented, fixture-verified and integrated engineering behavior. Synthetic provider outputs establish instruction wiring and persistence, not live model competence, Q3, parity, developmental qualification, H1 or deployment. No historical migration, provider call, credential/account inspection, external message, dependency installation or service installation occurred. Historical missing bytes remain unavailable. Fresh independent review and exact final handoff pending.
