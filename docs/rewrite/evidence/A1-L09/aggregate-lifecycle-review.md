# A1-L09 aggregate lifecycle and fixture review

Status: **fixture-verified bounded review complete**. Owner `/root/a1_aggregate_lifecycle_review`, branch `codex/a1-aggregate-lifecycle-review-20261011`, isolated worktree `/home/palimpsest/src/aggregate-lifecycle-review`, base `bfab2f073308668a360bd637af87985e0eac7f84`. Task: A1-L09-T02/T04/T05, requirements RW10, RW15, RW16, RW19. The actual finite tool goal was to diagnose the aggregate launcher-loss failure, independently review two root fixture corrections, preserve failures, prove the lifecycle, and commit the bounded result. Inherited model/effort was used; no provider was invoked.

Exclusive writes were `deployment/host-successor.test.ts` and this record. Root also allowed necessary minimal CLI/supervisor repair and review repair of the two fixtures; neither was needed. Source correction: **`81bfd41ae5e96ca471c4f2313a3b0964573a8f2e`**. Root retains lane/central status integration and fresh inspection of this test correction.

## Failure disposition

The original full aggregate at `176b184cc57016988d4bdf19c79b62dbdef197e4` remains **failed**: 620 tests, 610 passed, three failed, seven explicit opt-in skips, 411.158 seconds. The launcher-loss case took 31,404.016 ms and failed when `ProcessLease` encountered `ERR_SQLITE_ERROR`, code 5, `database is locked`. The test killed the launcher after a marker before `ServiceSupervisor.open`, slept a fixed six seconds, then assumed all asynchronous initialization and cleanup had completed. It did not observe coordinator exit. Its finalizer added another one-second sleep before deleting state. The original transcript is retained unchanged; this review does not retrospectively turn it into a pass.

Source inspection found the production CLI already registers `disconnect` before awaiting `ServiceSupervisor.open`, sets `stopping`, omits control publication when stopping, and closes the returned supervisor in `finally`. `open` finishes the admitted initialization before returning; `close` withdraws the authority, stops the service, and releases journals and its lease. Startup includes artifact verification and real child readiness. A held lease six seconds after the earlier marker does not by itself establish a permanent orphan or a missed disconnect. No production lifecycle defect was demonstrated by this bounded inquiry; the supported correction is to synchronize the fixture with lifecycle events. The old run did not retain phase timestamps, so its exact internal phase at the failed assertion cannot be recovered.

The new fixture retains the existing 60-second case timeout and 15-second event-wait bound. It replaces the fixed startup/shutdown sleeps with a gate inside real initialization, after the real service is ready but before `open` returns. It verifies that both supervisor and service leases are held and the expected authority is active before killing the launcher. A side-effect-only observer records actual IPC disconnect without calling `stop`; the test then releases the gate. It requires a normal coordinator exit, no attempted control publication, both leases acquirable, an existing authority journal with generation withdrawn, the service PID absent, and zero physical provider requests. The fixture's gate has a ten-second fail deadline. Source-injection anchors must match exactly once. The finalizer releases the gate and waits for the coordinator exit marker before removing its directory.

Only the temporary candidate contains phase markers and the startup gate. The production CLI, supervisor, resource accounting, authority enforcement and service lifecycle are unchanged. The new checkpoint moves launcher loss into an established initialization with a live child; it tests missed-disconnect handling while `open` is pending without relying on machine throughput.

## Negative control and observed results

A disposable candidate mutation removed only `if (launched) process.once('disconnect', stop);`, retaining the observing listener. The corrected test **failed 0/1** in 15.639 seconds with `orphan coordinator must never publish controls after startup`, actual `true`, expected `false`. This establishes that the observer does not accidentally repair the behavior it tests. The normal SIGTERM handler cleaned the negative-control coordinator and service; the mutation was removed before the final run and is not committed.

The first positive run passed 1/1 in 20.371 seconds; it preceded the extra pre-kill authority assertion. The final exact test source passed **1/1, zero skips**, 14.642 seconds. Its retained diagnostic records coordinator PID 821212, service PID 821243, startup timestamp 1791750666468, disconnect 1791750666496, and normal exit code 0 at 1791750666580: **84 ms after observed disconnect**, with empty stderr. This is a local fixture observation, not a universal shutdown latency bound. No remaining matching fixture coordinator/service process was observed after the selected runs.

## Independent review of the root repairs

- **`f6ba4b2221677c8dbd5a3bccc2df37da0229b885` accepted.** The real host schema inventory now includes `delegation_start_batch: { tasks: [child] }`. Cardinality and actual-schema validation remain enforced; no tool or assertion was removed. This corrects an incomplete fixture inventory after a real tool was added.
- **`1fe6ff815e5e558948336be5bd7e11624c3f6820` accepted as a synthetic fixture configuration correction.** The unchanged 30,000-token grant legitimately refused the sixth request after schema expansion: the retained root diagnostic totals 27,514 payload bytes + 1,024 framing + 1,024 output reservation + 600 spent = 30,162. Emitting an actual concise stderr message and nonzero exit preserves the seeded command failure while avoiding incidental stack-trace text. Reducing the synthetic output reservation to 256 remains above the fixture's declared 20 output tokens. It changes the fixture profile rather than increasing the operating grant or changing production accounting. The seven replies, actual observed command failure, compare-and-swap repair, private arithmetic checks, explicit speech and rejection of silent private completion remain exercised. Synthetic declared usage does not establish actual tokenizer counts or live capability. Root's failed concise-diagnostic-only intermediate run remains preserved in the joined-verification record.

Independent execution of both files at the review base passed **10/10, zero skips**, 3.303 seconds. Neither file required additional edits. The L03 engineering gate and fresh mechanical evidence remain separate from live cognition; this review does not introduce a live cognition acceptance criterion.

## Commands and retained artifacts

From this worktree, with Node 24.13.0 at the exact absolute path shown:

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-name-pattern='coordinator observes launcher loss' deployment/host-successor.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test packages/agent-shell/schema-regression.test.ts evaluations/product/adapter.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

The selected lifecycle command ran first positive, then negative control, then final restored positive as described above. Final strict TypeScript and whitespace checks passed. No full aggregate or unrelated test suite was repeated. The compiler closure was consumed through a worktree symlink to the existing root `node_modules`; fixture source copies resolve it into real files before freezing. No dependencies were installed or changed. Node binary SHA-256 is `53fb205ae78805130177e24bcb459a69a1518c8d98f8965f31d85aae7ea840fc`; lockfile SHA-256 is `cc2956d305c7bbb1be7d58bde7b1d257ff8329ca73d55d1cfb8ee92d2712efc0`.

Logs remain outside source at `/home/palimpsest/migration/aeon-1-20261011/integration-evidence/`:

| Artifact | SHA-256 |
|---|---|
| `aggregate-176b184.log` | `e6603be8933262251db52de7329ee51f8c519fed8ba1ab586d66b192e4ecfb49` |
| `lifecycle-barrier-first.log` | `a84c5ba7d9b7f96a53a0292928495188183533a33b974760bb0a4cc5c02b2492` |
| `lifecycle-without-disconnect.log` | `d1ad8693bdbfb1ace12464b394697ee0da0083ee3cf54bda8374ca70c6f77309` |
| `lifecycle-negative-mutation.txt` | `0867b03b5a85c8ea6072355b3c6619c14c9d071841e47263a53cdf613b53e38d` |
| `lifecycle-barrier-final.log` | `a607c23c61e7dba2b3230b557af652d512cfd52d9bebdfffddc289624c26f79d` |
| `aggregate-fixture-fresh-review.log` | `01efc127b361703491614218c8182b170499f799eff149eb3f60786fc01fe805` |
| `aggregate-lifecycle-typecheck.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

## Handoff limits

Root can integrate the source correction and this evidence, independently inspect the lifecycle assertions, and decide the next joined verification gate. The original aggregate remains failed until a new aggregate is run against its own identified source. This focused proof does not establish all concurrent load schedules, arbitrary process failure points, live model competence, installed systemd behavior, deployment or H1. No paid calls, external messages, production/systemd changes, push or installation occurred. The physical fixture slot was released to root after the final selected check.
