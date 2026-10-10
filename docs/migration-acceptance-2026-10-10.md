# Native migration and idle responsiveness acceptance

Status: native service and bounded responsiveness/restart gates accepted on
2026-10-10. The final controller enabled automatic startup once while preserving
the same running instance. Final Mac preservation/cleanup is recorded separately
when its operations finish. This is the explicitly
authorized operator migration to the dedicated `palimpsest` Linux account, not
autonomous P18 host evolution or full seed acceptance.

## Source and installed identity

Reviewed source `8d2e63eca99ee4d137f802524f3a94ee44c60499` is merged and pushed
to `main`. The guardian's isolated journal repair selects relevant event types
in SQL before payload decoding. Default full-audit history, ordering, debit,
publication uncertainty, origin policy and malformed selected-payload behavior
remain intact. Exact selectors reject malformed Unicode; growth selectors retain
all literal case-sensitive `growth.` types. No cache, schema migration, history
truncation, scheduler-cadence change or weakened check is introduced.

Author checks passed 133 affected cases and strict TypeScript. Fresh independent
review additionally compared selectors, legacy allocations, concurrent final
permits and Unicode negatives. Actual destination checks passed strict TypeScript,
all eleven scheduler cases and the four unchanged incumbent floors: typecheck,
trusted-agent-contract, cross-scope-memory and memory-provenance. These are exact
bounded checks, not a new full-source run. The unaccepted P06 memory-context-budget
check remains separate and its exhausted three-attempt history is preserved.

The supported operator installation admitted native baseline
`aa687d2f03689dc4fcdf67ff1c094b5079a62edc53abb2d5529209848d6bbf9b`.
Its cognition, configuration, model, schema, evaluator, compiler and required
checks remain identical to native predecessor
`bab265dcd8d119a59f7fa992be918a4492915aa943c8dc4a7902f038d2752fcc`.
The older native rescue bundle and checksum anchor remain retained. Historical
Darwin artifacts remain immutable lineage evidence and cannot be selected as
Linux fallback. The original ready migration marker remains unchanged.

The service runs a root-sealed projection under `/opt/palimpsest/hosts/<digest>`:
288 tracked files plus the separately prepared native launcher and receipt.
Root ownership, modes, sole dependency link, all 290 file contents and paths, and the 291-entry
checksum anchor including Node were independently checked. The unit's independent
checksum gate executes before application imports. Current lived state is outside
the repository at `/home/palimpsest/.local/share/palimpsest/instance`; credentials
remain private under `/home/palimpsest/.config/palimpsest`.

## Retained installation failure and recovery

The installation command exited 1 after committing and health-checking the new
known-good baseline because an old process group did not confirm drain. The
failure, committed installation evidence and held custody epoch 141 remain
recorded. Physical descendants were subsequently observed absent; no task,
memory, effect, budget or operational journal record changed.

A harmless actual-host fixture demonstrated that an outer test supervisor acting
as a child subreaper could retain adopted zombies until its CLI exited, making
group-presence observation remain true. This proves that mechanism, not the exact
original incident's final zombie state. The revised external supervisor reaps
only verified adopted direct children and preserves the CLI's exit status. No
product drain deadline or source admission rule changed.

One supported `custodian.retryRecovery()` operation under the existing exclusive
host queue restored normal custody at epoch 142 with the newly committed baseline.
It used a provider that throws on any call, preserved every operational row and
prior debit, and drained actual owned processes. No install replay, old-state
reimport, direct database rewrite, refund or automatic retry occurred. Supported
service projection and root sealing followed while the service stayed disabled.

## Actual live measurements

The original settled service consumed approximately 101% of one core; three
authenticated reads of an existing completed task took 4.775, 6.306 and 5.231
seconds. The engineering gate selected before the new live run was three quiet
15-second main-process CPU windows each below 20% of one core and at least ten
authenticated existing-task reads each below 500 ms. This is a bounded acceptance
criterion, not a user-promised latency SLO or whole-machine CPU measurement.

| Cycle | Three main CPU samples, one-core percent | Measured GETs | Maximum GET latency |
|---|---|---|---|
| Initial native start, epoch 143 | 15.066%, 15.533%, 15.333% | 12 | 11.746 ms |
| Cold restart, epoch 144 | 17.200%, 18.133%, 17.933% | 12 | 179.682 ms |

Startup collectors settled before measurement. Both cycles used fresh log offsets,
the exact root-owned Node and sealed CLI, Slack connected with zero reconnects,
hourly authoring allocation 1 and plan-review allocation 8. The 24 measured GETs
returned the previously completed peer task with its original one-call checkpoint;
they created no task or provider request. Startup polling, including an initial
connection-refused observation before readiness, is retained separately from the
measured quiet-window requests.

All database schemas and operational table contents stayed identical during each
quiet measurement. Across startup only one unspent hourly author-window event
was appended at sequence 1159; its corresponding journal sequence advanced.
Every pre-existing record and budget remained exact. Shutdown completed normally
in 10.168 seconds, with an empty service cgroup and all observed PID/start identities
absent. Cold recovery used a new process and later epoch; no automatic systemd
restart occurred. At final observation all 53 tasks succeeded, 53 effects remained
completed, 66 memories and 27 growth records survived, and no unresolved effect
or pending custody operation remained. All 22 recorded collector jobs had drained.

Actual inner workers had six namespaces distinct from the main host, seccomp mode
2, `no_new_privs=1`, zero capabilities and private scratch under the service TMPDIR.
The retained rescue checksum passed before and after each controller phase. The
root independently checked all seven live-summary pins, 26 bound evidence/snapshot
files, the immutable table comparisons, recorded CPU arithmetic and measured GET
results before approving enablement. Provider traffic was not independently
captured: zero new reservations and unchanged full state are the evidence for no
additional recorded inference. Neither observer nor controller issues inference.

## Evidence and remaining scope

Private receipts, scripts, snapshots and raw logs are retained outside Git under
`/home/palimpsest/migration/`. The following summary pins identify the exact run;
they do not publish conversations, credentials or lived SQLite contents.

| Receipt directory or file | SHA-256 |
|---|---|
| `native-idle-checks-8d2e63eca99e-20261010T095143Z/summary.json` | `5d1a044480d9ea0f89d0dd08cad01eef506ec0d15756f6a451b8a50a354c2c85` |
| `host-prepare-8d2e63eca99e-20261010T095718Z/summary.json` | `f85d5ab0d405588f49d26a342d8045aa5b0cc6a0c6774d1b08fe81a1eba7943e` |
| `operator-recovery-aa687d2f0368-20261010T101048Z/summary.json` | `b3dd872c98cb1466ecd8db96825a0df231561a2bd4f18e5b5404645957e769c0` |
| `root-seal-aa687d2f0368-20261010T102044Z/summary.json` | `27dfac922c0286ccd61d06cc1d3e0f16ed351e9a99a089d75910f6becf00802a` |
| `live-cycle-start-aa687d2f0368-20261010T103107Z/summary.json` | `6a368d4a5107fa06c4ba20051e30326a96f7a5e4b464139348017c9252771e72` |
| `live-idle-aa687d2f0368-20261010T103117Z/summary.json` | `0763c3bfb5341d48ddbdbe892ad4a0824672c9b24a37df69c85f9af1f72860f2` |
| `live-cycle-observe-aa687d2f0368-20261010T103254Z/summary.json` | `0e73f8c9eea2b57bd467477f222406b34471f8df1872ae92b182c803ac8a33c1` |
| `live-cycle-stop-aa687d2f0368-20261010T103316Z/summary.json` | `8f90e9fd447f604f95863576f8ebf61a1086472dd4ea03c45a6e62a692e3a7d0` |
| `live-cycle-restart-aa687d2f0368-20261010T103337Z/summary.json` | `4635efb80412925dc08c54ec530359208025de8869a098bac2fad9434f62efb7` |
| `live-idle-aa687d2f0368-20261010T103407Z/summary.json` | `2bd798fd86f2bf8d83da51452d1d1e8452cb0ed7bed07384624da2cab1e27246` |
| `live-cycle-observe-restart-aa687d2f0368-20261010T103835Z/summary.json` | `87b1ba2eb3f0fba338ab9793d20206fb906d5b9e6f9498833001bb909919b63a` |
| `live-cycle-enable-aa687d2f0368-20261010T104041Z/summary.json` | `ad6e7c074817361e9a600a66b9fb876ecfaedafb47edbb369fa1ec539022d76e` |
| `idle-responsiveness-evidence/palimpsest-lead-live-review.json` | `01ff744f0d82055cf99e0c4f7431d4f771fe096ba678f2a97fde63c25fe641f2` |

Idle CPU of 15–18% remains material. These finite observations do not establish
long-term availability, API latency during every active collector/model workload,
hard resource quotas, broad prompt-attack resistance, configured-model iterative
coding competence or autonomous host/governance replacement. P06 qualitative
calibration and P17/P18 production activation remain open. New inner-voice work
is isolated from this reviewed installation and needs its own admission.
