# Durable asynchronous review continuation

Date: 2026-10-11. Author `/root/a1_evaluation_dispatch`, isolated `evaluation-continuation` worktree. Finite goal completed at `005c2cc`; lead integration commits are `0e11017`, `03fc1f3`, `35615eb`, `21acf3b`, `9ecfca5`, `7d9cdca`. This receipt persists the author's handoff and the lead's log inspection. Fresh review is assigned separately to `/root/a1_continuation_review`.

Ordinary `candidate_evaluate` commits its job, proposal transition, optional continuation subscription and exact local effect acknowledgment together, then returns a known pending receipt. The confined author can end its current slice; waiting does not repeatedly spend initiative slices. `change_status` reconciles the exact independently completed job. An authenticated, scoped host event wakes an eligible waiting direct/initiative author once after restart. Cancelled or completed runs are not resurrected; delegated child and obligation continuations retain their own lifecycle owners.

The hosted dispatcher waits until both the local effect and its receiver accounting have settled, and until the author is no longer running. It therefore cannot steal the sole shared concurrency slot from the author's finishing turn. Lost local acknowledgment recovery proves the exact effect, payload, scope, original request, candidate, policy, archived return and physical receiver identity before settling only that receiver. The recovered elapsed charge retains the persisted ceiling. This includes the gap where the effect already succeeded but its ledger settlement was interrupted. External reviews with unknown results remain uncertain and are never automatically repeated or made free.

Validation used Node 24.13.0 and the retained compiler:

| Frozen author revision | Observed result | Interpretation |
|---|---|---|
| `de0fe99` | Joined 59/60 | Restart fixture had not started the ordinary application polling/listener lifecycle; corrected to use `application.start()` |
| `6e4ed26` | Joined 68/69, 111.3 seconds | Review exceeding the 30-second author slice passed; lost-ack assertion raced actual same-host reconciliation |
| `005c2cc` | 10/10 continuation checks and compiler passed | Exact negative bindings, no cancelled/terminal revival, and producer concurrency gate |
| `005c2cc` | Actual source lost-ack/restart/controller fixture 6/6, zero skips, 21.434 seconds | Simulated the dying instance's crash window, then restored real recovery in the restarted application; concurrency tightened to one |

The final source fixture retains one local enqueue, one bound result wake and the real original-policy controller stage, plus physical lost-reply/restart/fencing checks. The earlier failing assertion expected one unresolved effect after a normal tick had already reconciled it. Holding reconciliation only in the dying fixture instance makes the intended crash window explicit; the restarted instance uses production behavior. The final narrower rerun is not represented as a new all-tests aggregate. The author reported a successful external build at `005c2cc`; its captured output is empty. The lead separately observed strict check/build and 33 joined lightweight continuation/resource/policy checks passing at `b50c1f8`.

Retained logs and SHA-256:

| Path | Digest |
|---|---|
| `/tmp/aeon-evolution-continuation-de0fe99-20261011.txt` | `03d1a64d9462dca150304729e42b8b9da2b88049c09cc45bd40ac1cd87e1551e` |
| `/tmp/aeon-evolution-continuation-6e4ed26-20261011.txt` | `b57df2938c58cd99421aa87657f23338546bade985723c052c2a33aa9c5450da` |
| `/tmp/aeon-continuation-producer-gate-20261011.txt` | `328782b504b9a4b3c4360d986a536a7245eef98ea40d031ea4d22392addbdc69` |
| `/tmp/aeon-continuation-lost-ack-005c2cc-20261011.txt` | `6ba198408566dafaf400bbc7829796f98a16a6b7facfbedf4bed5669b11a66ec` |

These are synthetic engineering results. No live qualified evaluator, paid inference, external message, product parity or H1 acceptance is established. This author's scope ends at staging; activation/probation tools, independently installed succession, rescue rotation and proposals changing evaluator/governance descriptors have separate owners and evidence. `release_submit` still waits for a bounded host decision. Unknown physical operations still require explicit reconciliation.
