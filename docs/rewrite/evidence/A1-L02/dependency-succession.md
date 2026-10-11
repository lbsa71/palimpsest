# Retained dependency invocation in an admitted successor

Status: **implemented and fixture-verified** at author source `b8ade3a8849de990a4a3bffd8ef385f876f2f800`; fresh final review/rerun remains downstream. Owner `/root/a1_dependency_succession`, branch `codex/a1-dependency-succession-20261011`, worktree `/home/palimpsest/migration/aeon-1-20261011/dependency-succession`, base `e542f49`. This finite A1-L02-T06 / RW21 engineering subtask addresses the exact witness requested by [remaining gate E3](../A1-L09/remaining-gates.md). Full L02, live screening, independent Q1–Q5 disposition and H1 remain open.

## Missing binding and behavioral specification

[ADR 0033](../../../adr/0033-source-owned-json-schema-validation.md) and [source closure](../A1-L09/source-and-artifact-closure.md) explicitly limit their edit/build/load evidence to a fresh process. [Runtime bundle](../A1-L09/runtime-bundle.md) changes a Node executable; [installed succession](../A1-L09/installed-succession.md) changes bootstrap/launcher/CLI functions. None records changed retained Pi/schema bytes invoked by the admitted successor. Joining those unrelated observations would overstate their binding.

The new `deployment/dependency-succession.test.ts` requires one continuous physical engineering demonstration:

1. Freeze and admit disposable source with an explicitly synthetic provider transport. Execute an ordinary authenticated direct input through the actual service, confined broker, retained Pi loop, schema preflight and workspace receiver. A numeric `workspace_read.path` fails validation; a subsequent synthetic response writes the actual diagnostic into its run workspace. The original diagnostic contains no successor marker.
2. Use real `source_checkout` to copy that accepted source into an exclusive mutable workspace. Use confined `WorkspaceTools.write`, with expected source hashes, to edit the existing retained `Validator.validate` implementation. Introduce an actual type error, observe pinned `source_check` reject it, repair the type and pass strict check plus emitted build. The successful edit adds a diagnostic suffix to errors returned by that invoked function; it changes neither validation success nor dispatch authority.
3. Freeze the candidate. Assert its only source-file delta is `packages/narrow-schema/vendor/cfworker/validator.ts`, that exact bytes occur in the frozen payload, and that dependency and control identities change. Both candidates retain the identical synthetic transport, prompts, model, configuration, compiler and Node executable.
4. After freeze, ingest a real late memory through `DevelopmentalMemory`, accept and pause a real goal through `InitiativeRegistry`, and create a linked owed obligation through `ObligationRegistry`. These records live in the operational SQLite store; the candidate's frozen source cannot supply them. The paused goal prevents automatic delivery while the promise stays owed.
5. Reject ordinary release of the control-classified validator edit. Stage and activate it through the existing old `ServiceSupervisor`/`ReleaseController`; assert the probation judge is the old policy and reused admission evidence cannot accept probation. The successor's actual service/broker invokes the edited validator and writes the changed diagnostic through real `workspace_write`. Its actual captured host context must contain the latest memory, goal action and owed obligation. Fresh synthetic old-policy evidence then accepts it.
6. Assert predecessor death, successor command line/candidate/authority binding and exact preservation of the three state records. Recover the accepted service through the existing controller and invoke that same validator again with current state retained.

No permanent transport, vendor or service feature was added. The disposable `service-child.ts` injection is installed before the incumbent is frozen and checked as ordinary source. Synthetic model responses and signed admission judgments exercise engineering mechanisms; their `independent:true` contract field is not independent product evaluation. Actual executions, compiler errors, source hashes, diagnostics, workspace files, process identities and state reads are asserted separately.

## Verification and execution ownership

Node `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` v24.13.0. Development `node_modules` is a read-only-use symlink to the existing root closure; actual freeze copies that closure into ordinary disposable source. No package, lockfile or build configuration changes.

Strict root typecheck and `git diff --check` passed at each fixture correction. Root serialized the joined heavy execution after the aggregate and Claude native fixture windows. The final exact-source case passed **1/1, zero failures, zero skips**, exit **0**, in **24,309.441586 ms** (runner total **24,624.240688 ms**). Its actual confined failed check took **1,279.971576 ms**, repaired strict check **1,129.597634 ms**, and emitted build **1,236.089141 ms**. The failed check's original TS2322 diagnostics and all actual command receipts are in the private report.

First physical run at `ff29d85` failed **0/1, one failure, zero skips**, in **19,652.144594 ms** at the successor host-context obligation assertion. The fixture incorrectly assigned a literal `dependency` destination to the promise while direct ingress generates its actual authenticated destination. The host correctly filtered this mismatched target. The fixture now copies the actual incumbent host-context target for the same direct conversation; no visibility rule or assertion changed. Original output is retained outside Git at `/home/palimpsest/migration/aeon-1-20261011/dependency-succession-evidence/ff29d85-trial.log`. Its temporary service/source/state root was removed by normal fixture cleanup.

Second physical run at `4513310` failed **0/1, one failure, zero skips**, in **32,718.481007 ms** at the additional accepted-restart witness. The dependency invocation, actual late state visibility/preservation, predecessor termination and fresh old-policy acceptance assertions had passed. The synthetic responder searched nested tool content for the error string, so a real `workspace_write` diff receipt containing the copied diagnostic prompted another write to an existing file with `expectedSha256:null`. The real hash guard rejected the invalid duplicate. The responder now requires the preceding tool name to be `workspace_read` as well as its validation failure. Each witness additionally asserts exactly one successful effect dispatch, `workspace_write`; invalid schema calls never reach the receiver. Original output is retained as `4513310-trial.log` in the same private directory. No runtime rule, resource bound or positive state/schema assertion was weakened.

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
AEON_DEPENDENCY_SOURCE_REVISION=b8ade3a8849de990a4a3bffd8ef385f876f2f800 AEON_DEPENDENCY_EVIDENCE_DIRECTORY=/home/palimpsest/migration/aeon-1-20261011/dependency-succession-evidence /opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test deployment/dependency-succession.test.ts
git diff --check
```

The successful private JSON report contains complete frozen file/input manifests, actual failed/repaired edit receipts and check/build output, emitted validator hash, old/new policy and proof identities, serving PIDs/epochs, actual workspace diagnostics/captured context and operational request records. The service executes checked, frozen TypeScript through Node's source loader, as in ordinary deployment. The emitted JavaScript is check/build evidence and is not falsely described as the serving artifact.

| Author-run identity | Exact value |
| --- | --- |
| Incumbent candidate | `5cd2b7318773dd190d29d3080533f6d939fdf73a709a91fdea4e407de17c488f` |
| Successor candidate | `1011871efc89ebad8c0c664706445357aa821694ac7a333e73e371db334192ad` |
| Changed retained validator source | `73abadd4b30bde8b465b2c1c1c149814a8b39fc08180bfd3b754f449fef46af0` |
| Emitted validator JavaScript | `fcfd8450bbbfbd6240785a40cd61e30990cd31b9b45bce2a1a849a0f63151c18` |
| Old judging policy | `c931a810cb2aa009d0d17036cad8c3c6899fb201a3df1a5862620aed18207b53` |
| Successor policy | `f8bbb159011e2d61f068744be3c06132c8cc3545fcd8067259b84fdd5e835145` |
| Unchanged Node executable | `53fb205ae78805130177e24bcb459a69a1518c8d98f8965f31d85aae7ea840fc` |

Both frozen candidates contain **1,087 files**; their only changed file is the invoked validator. Their prompts, model, configuration and runtime are equal. The exact source/dependency/control identities and full toolchain file hashes are in `frozenCandidates` in the private report. Author epochs were **1 → 3 → 5**; predecessor PID **819535** was stopped and the epoch-3 successor PID **819745** had its candidate ID in the actual command line. The schema diagnostic was unmarked in the incumbent, marked in the successor and marked after the accepted restart. The actual successor host context contained `dependency-latest-memory`, the revision-3 paused goal's latest action, and the revision-1 owed obligation. All three original SQLite record snapshots remained equal after activation, fresh old-policy acceptance and restart.

The operational ledger recorded **9 succeeded synthetic Mistral transport requests** and **3 succeeded `workspace_write` receiver requests**, with exactly one actual effect per witness. Numeric invalid schema calls never reached the effect receiver. All transport responses came from the frozen in-process fixture function, so these are accounted synthetic requests, not external provider generations. Memory is not reset and the owed promise is not falsely marked delivered.

Private evidence directory: `/home/palimpsest/migration/aeon-1-20261011/dependency-succession-evidence/`. Final report size **1,106,374 bytes**. Both failed trials and the passing trial remain available; all three disposable roots were cleaned by the fixture's `finally` path.

| Retained file | SHA-256 |
| --- | --- |
| `ff29d85-trial.log` | `a5109879d8bd264365460284e311c33a15c0a3856ac61031ffea0dc489bfe1a2` |
| `4513310-trial.log` | `f987a707b0430595a20eff552ce1141128d527fad5485b1510f8b21e88cf3102` |
| `b8ade3a-trial.log` | `6a2fd962c59bf8aa382fa2a1c79e6a458ef3f2511693237d7600253b963e2ac1` |
| `dependency-succession.json` | `484b130654eb4a079af4650a8dc5a8499c3391477eaa12516c416553b08b8d24` |

## Review and limits

Fresh reviewer `/root/a1_engineering_proof_review` inspected the prepared fixture read-only. Its first observation confirmed the retained function invocation and frozen dependency delta; it identified an arbitrary uncertain-effect sentinel as insufficient for pending-effect evidence. The author removed that sentinel entirely. This fixture proves only dependency invocation and latest real memory/goals/obligations; pending-effect preservation/reconciliation still relies on the separately reviewed runtime/succession evidence and final gate matrix.

Fresh final review must inspect the actual run at its recorded author revision, the report's exact source delta and injected transport, pinned compiler/build receipts, old-policy staging/probation, actual confined schema/witness path, operational state snapshots and predecessor fencing. Reviewer `/root/a1_engineering_proof_review` found both fixture corrections appropriate and unchanged audience/CAS checks; root released the next physical slot for its independent targeted rerun. Use a separate private output directory and the exact review source label so author evidence is preserved. Random engineering signing keys change policy/candidate IDs between runs; compare each run's exact manifest binding and only-validator delta rather than expecting identical generated IDs. Failures/skips must remain visible. Do not infer independent competence or full Q1–Q5 acceptance from the synthetic signatures or fixture assertions.

Root can integrate author commits `ff29d85`, `4513310`, `b8ade3a` plus the final evidence handoff. Root alone owns aggregate/installed reruns and the final L02 Q1–Q5 acceptance matrix. No passing result at this author source is relabeled as execution of root's later integrated source.

The fixture makes no external provider dispatch, paid call, external message, production installation, unit mutation or push. Engineering mode does not qualify production cgroup/storage capacity, installed bootstrap rescue, a new Node version, live-model authorship, continuity judgment, novel coding competence or full L02. Existing accepted source/dependency/build/runtime mechanisms are reused; no second release engine is introduced.
