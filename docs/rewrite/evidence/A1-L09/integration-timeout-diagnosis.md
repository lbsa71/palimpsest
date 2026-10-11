# Joined execution failure diagnosis

2026-10-11. A1-L09-T04/T05; root owns this bounded diagnostic work under the active whole-Aeon goal. Source and acquisition evidence are distinct from a repaired runtime or passing aggregate.

## Observed failure and next finite task

Clean, unchanged `78432f97e48d21104dca57b08dfc02ce8c8d8800` built successfully, then ran all 103 rewrite test files with Node 24, module mocks, concurrency two, the qualification/offline/governance fixture flags and read-only native artifact audit flags. Result: **1,085 tests: 1,057 passed, 11 failed, two cancelled, 15 skipped**, 722.980 seconds. The retained transcript is `/home/palimpsest/migration/aeon-1-20261011/integration-evidence/aggregate-78432f9.log`, SHA-256 `c74f762f674af2b6b48df3de79fe63feeba3caeada3c56a7b2bebb2c2f1a43b8`; adjacent plan/result JSON binds the exact source, runtime, commands, flags, start/end and clean ending revision. Earlier failed aggregates remain unchanged.

Three top-level evolution-dispatch cases failed: the multi-scenario external-dispatch parent exceeded its 120-second test deadline; ordinary control activation reached an explicitly **uncertain** outcome after 67.129 seconds; governance acceptance succeeded but its post-restart future-reviewer wait expired without a job after 105.567 seconds total. Eight later nested checks attempted to run after their timed-out parent had finished, and one active nested check was cancelled. These are not eight independent production defects. The uncertain control outcome must not be described as merely a polling failure.

A separate launcher-loss fixture failed during cleanup with `ENOTEMPTY`, masking its original outcome. After the aggregate drained, the leftover `/tmp/aeon-coordinator-p3Kqhv` held only `disconnected` and `coordinator-exited` markers, the latter recording exit code one. Read-only process inspection found no surviving process for that fixture. The fixture can enter cleanup before learning the coordinator PID, then delete the directory while the coordinator is still writing markers. Its primary failure and early-start cleanup require investigation; a blanket deletion retry would hide this evidence.

Concurrent author/reviewer source-copy and hashing checks were running during the aggregate. Host contention is a hypothesis, not an established explanation. Maximal useful parallelism must serialize physical experiments against substantial source-copy/hash test sweeps when deadlines are part of the behavior being measured. Code authoring and small causal checks remain parallel.

```text
/goal Diagnose the original-grant control uncertainty and launcher-loss cleanup failure from aggregate 78432f9: retain exact failed results, acquire a bounded isolated ordinary-control observation with unchanged executable source and deadlines, identify the failing phase from actual state, repair only a demonstrated defect, and persist focused verification plus fresh consequential review before another full aggregate.
```

Root exclusively owns `deployment/evaluation-dispatch.test.ts`, `deployment/host-successor.test.ts`, this evidence and central integration for this task. Production continuation/supervisor changes require a separately specified causal defect and fresh review. Reuse existing tests, SQLite and operating-system observations; no new recovery framework, dependency or softened admission/resource policy is justified by these failures.

## First acquisition, fixed before execution

Run the single ordinary-control test once in a clean isolated worktree at exact `78432f9`, with the pinned Node runtime, module mocks, `--test-concurrency=1` and the exact test-name filter. No native CLI, provider, network beyond the test's local receiver, accounts or external messages. Preserve its original 120-second test deadline, 90-second acceptance poll, 15-second reviewer limit, grants and acceptance assertions. No retry or full aggregate follows automatically.

An external read-only monitor may observe only the newly created `aeon-external-dispatch-*` fixture directory belonging to that sole physical run. It retains the latest consistent operational/authority SQLite backups and a bounded timestamped summary of document revisions/statuses. It does not mutate the source databases, candidate, authority or clock. Retain monitor errors and acknowledge that sampling can miss a final write before normal cleanup. Each latest database is capped at 64 MiB, summary output at 16 MiB, one fixture directory, and acquisition at 180 seconds. The monitor's exact bytes/hash and commands are retained with the result. After process completion, record the source's unchanged status, evidence hashes and process cleanup; a passing isolated run cannot erase or explain the failed competing-workload aggregate.

Next decisions follow the observed state. Do not enlarge runtime budgets, remove accepted assertions, add automatic replay of uncertainty, or repeat an acquisition without a new concrete question. The launcher fixture's early-start cleanup can be specified independently while this observation runs. Aeon 1/H1 remain unaccepted.
