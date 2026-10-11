# A1-L09 coordinator consequential review

Status: **review completed; fixes implemented and fixture-verified**. This is a finite A1-L09-T02/T04/T05 review, not H1 acceptance, deployment, live-model qualification or autonomous-use qualification.

Owner: `/root/a1_coordinator_review`, delegated by `/root`. Branch: `codex/a1-coordinator-review-20261011`; worktree: `/home/palimpsest/migration/aeon-1-20261011/coordinator-review`. Reviewed coordinator revision `fe164ce` (author handoff `afc32ed`) through worktree base `6adba9d`. Reviewed requirements: RW10, RW15, RW16 and RW19. Exclusive writes: `deployment/{supervisor.ts,cli.ts,host-policy.ts,supervisor.test.ts,coordinator-boundaries.test.ts}` and this evidence file. The evolution-host owner retains service-child/process/mailbox code and the additional `ServiceProcess.start` metadata argument; this patch leaves those call sites intact.

Finite goal: review host authority bootstrap, recovery, shutdown, policy/CAS privacy and resource lifecycle; reproduce consequential defects with bounded local fixtures; fix the owned boundaries; run focused checks; hand off exact source and evidence revisions. No provider calls, external messages, paid effects or retired-service changes were used.

## Findings and corrections

1. **Repeated rescue crashes restarted indefinitely.** The original coordinator called recovery after every post-readiness child exit with no budget. The regression kills a real frozen child, waits for its automatic rescue, then kills rescue. Original code started another generation and never reached fenced unavailability. The coordinator now allows one unattended rescue attempt between explicit successful recoveries. A further crash withdraws authority, stops/drains descendants and records an unavailable status requiring explicit recovery. Pending exits still queue behind release operations; initialization now uses that same serialization boundary.
2. **Control clients could hold shutdown open.** Accepted JSON requests disabled their socket idle timer; `server.close()` only stopped admission and awaited all clients. The CLI now explicitly stops control admission and destroys all tracked idle, incomplete, in-flight and backpressured sockets before waiting for coordinator closure. Already admitted host work remains awaited through the supervisor's operation promise. Accepted requests retain a 60-second socket deadline.
3. **Host file reads were unbounded and reopened checked pathnames.** Host policy, key, proof and configuration reads now traverse every path component through no-follow descriptors, read a fixed bounded size from the verified descriptor and check for modification during the read. The host-selected default is 8 MiB; evaluator keys are capped at 64 KiB. Files must remain singly linked, regular, owner-owned and owner-only. The existing bootstrap intent is read through this bounded path as well.
4. **CAS privacy and mounted secrets were insufficiently checked.** Evidence now requires owner-only directory and file modes, while retaining exact content-addressed URI/hash checks. Host private paths under `/usr` are rejected because the worker mounts that tree read-only with the same UID: `0600` alone does not hide such files. The CLI rejects evidence stores inside workspace/artifact roots. The coordinator rejects public state/artifact roots or overlapping state/workspace/artifact roots before creating lease/authority journals.
5. **Worktree compiler links broke fixtures after stricter source freezing.** Coordinator fixtures now copy explicit rewrite roots and resolve/copy the trusted compiler closure into private temporary source. Frozen successors use the incumbent payload. This does not relax candidate no-symlink admission.

## Preserved negative evidence

The new repeated-rescue assertion was first run against the unmodified three coordinator implementation files from `6adba9d`:

```text
node --test --test-name-pattern='real frozen service transfers' deployment/supervisor.test.ts
FAIL: real frozen service transfers ...
Error: Lifecycle condition not reached
at eventually (.../deployment/supervisor.test.ts:58:55)
at TestContext.<anonymous> (.../deployment/supervisor.test.ts:91:5)
duration: 44,273.545 ms; 0 pass, 1 fail
```

A separate bounded disposable reproduction loaded the original `6adba9d` host-policy/CLI files. It observed:

```text
Original readHostFile accepted bytes: 8388609
Original CAS accepted public directory/blob: true
Original server closed with in-flight client: false
```

The socket observation used a pending admitted command, waited 250 ms after `server.close()`, then explicitly destroyed the client and resolved the command to leave no hanging process. Temporary source and logs were outside the checkout. These failures were retained here rather than reclassified as passing tests.

## Validation and artifact identities

Behavioral source commit: **`9d2de888ac0a149d8ce214f8290ca2850ab9c58d`**. Node: `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`, v24.13.0; SHA-256 `53fb205ae78805130177e24bcb459a69a1518c8d98f8965f31d85aae7ea840fc`. Lockfile SHA-256: `cc2956d305c7bbb1be7d58bde7b1d257ff8329ca73d55d1cfb8ee92d2712efc0`. The compiler closure was copied from the trusted root installation, not fetched or altered. Tests construct disposable engineering policy/evaluator identities; no product evaluator or live provider evidence is implied.

Commands ran with the pinned Node directory first on `PATH`:

| Check | Result |
|---|---|
| `npm run check` | Pass: strict TypeScript check |
| `npm run build` | Pass: emitted build |
| `node --test deployment/coordinator-boundaries.test.ts deployment/supervisor.test.ts` | 6/6 passed, no skips, 70,263.034 ms; two original boundary cases plus all four lifecycle cases |
| `node --test deployment/coordinator-boundaries.test.ts` after adding the early host-root admission case | 3/3 passed, no skips, 242.770 ms |
| `node --test --test-name-pattern='first authority' deployment/supervisor.test.ts` with worktree `node_modules` temporarily linked to the trusted root compiler closure | 1/1 selected case passed, 13,477.725 ms; original real compiler directory restored afterward |
| `git diff --check` | Pass |

The real lifecycle cases cover authenticated bootstrap and exact interrupted-proof retry; singleton coordinator ownership; transfer and fresh probation evidence; startup failure fencing; bounded repeated crashes and explicit recovery; preserved latest lived/uncertain-effect state; CLI SIGKILL/restart and orderly stop. Restart succeeds after deleting bootstrap proof, evaluator key/policy and evidence storage, with zero recorded physical provider requests. The bounded socket test includes incomplete input, an unresolved admitted request and a paused client receiving a 4 MiB response.

## Limits and handoff

Provider-independent recovery means no successful provider/model interaction is needed. The CLI still requires configured `MISTRAL_API_KEY` and `AUTARK_DIRECT_TOKEN`; tests use unavailable provider credentials, not absent environment variables. Credential-free startup was neither added nor claimed.

The path checks defend ordinary symlink/hardlink redirection and the known worker `/usr` exposure. They do not claim protection against an administrator remounting or bind-mounting private host storage into a worker-visible tree. Existing confinement owns worker namespace/mount enforcement. Host SQLite directories are private and disjoint; a hostile host administrator is outside this coordinator boundary.

Bootstrap durability retains the existing signed-proof-first, fsynced intent and SQLite FULL-sync journal ordering. The exact interrupted authority/proof retry is exercised, but arbitrary instruction-level power-loss injection was not performed. The explicit second-crash fence is conservative: even if an accepted rescue has run for a long time, its next crash requires a host recovery command after the one unattended recovery was consumed.

Next owner: `/root`. Cherry-pick this source and evidence handoff, inspect the fixes independently, merge the evolution-host metadata call-site patch, and rerun the integrated lifecycle/control-upgrade checks against the resulting source. These checks establish only the reviewed local boundary behavior; H1 and product qualification remain open.
