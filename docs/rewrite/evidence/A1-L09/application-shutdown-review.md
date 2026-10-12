# Independent application shutdown review

2026-10-12. A1-L09 bounded consequential review, owner `/root/a1_application_shutdown_review`, routing `gpt-6-astra` / high. Isolated branch `codex/a1-application-shutdown-review-20261012`, base `6f8307c`. Actual finite goal created before inspection. Only this evidence and NEW `deployment/application-shutdown-review.test.ts` are writable. All source, existing tests and author evidence are read-only.

## Frozen criteria before test code

Review source `74cb6a3`, corrected author fixture `7a26e0d`, precode `b062a92`, corrected original-source failures `8aa14e3`, and the preserved two original fixture mistakes. Original Store admission correctly refuses monkeypatched `put`; use actual SQLite trigger faults instead of bypassing that guard.

1. The first close synchronously fences new execution and stops an installed timer, then returns the same pending promise to concurrent calls and calls reentered from abort or ingress shutdown. No callback can acquire a separate successful completion. Later calls retain the exact outcome without replay.
2. With two ordinary running requests, a real SQLite pending-write fault for one run cannot skip the other write. The other pending record must exist when abort is observed. Actual provider transport promises remain a drain barrier after abort, with the Store and lease live until settlement.
3. An actual initiative request and an ordinary request are separately held: close cannot finish after only one settles, in either settlement order. Initiative work is managed by its own durable execution record, not incorrectly reclassified as ordinary pending work.
4. Slack rejection plus direct-server callback error must both survive in the final aggregate, without suppressing abort/drain or replaying ingress stops. Synchronous direct-stop throw must also retain ownership. These use host-operation fault injection without opening a network listener.
5. Preparatory errors retain the same actual Store and lease, original reservations/uncertainty, and failed completion. Clearing an injected fault does not silently retry closure. Store-close failure retains an owned lease; a supplied lease is never closed by the application.

Use actual application/runtime/SQLite/Pi with module-mocked in-process worker/provider transport. No physical child, external request, live provider, private credentials, Slack message, full benchmark, publication or deployment. The unchanged named startup/close case may use its temporary loopback listener. Run focused new/author checks and strict compilation. Complete this finite review with acceptance or preserved reproducible defects; repairs belong to the root's next goal.

## Inspection and preserved first trial

The repaired application blob is `1268284a0675fa029b60f101a46e63e62696a892`, identical to `74cb6a3:deployment/application.ts` at review base `6f8307c685e6d4c5890dd5d38530aacd3a636d2f`. The corrected original-source fixture at `8aa14e3` is byte-identical to `7a26e0d`'s six author tests. The earlier Slack empty-channel construction error and forbidden Store monkeypatch are correctly disclosed in the author evidence; neither is treated as a causal shutdown failure. The corrected author's 0/6 original-source replay and 110/110 joined receipt remain author evidence, not reruns claimed by this review.

Source inspection confirms that `closing` and `clearInterval` execute synchronously; the promise is installed before any deferred persistence/abort/ingress callback. Each ordinary running row has its own catch, followed by abort and both ingress-stop attempts. The active and initiative promises are awaited before the ticking barrier and Store close. Rejected work promises count as settled work rather than a successful runtime outcome; their runtime/request state remains durable. Preparatory failures aggregate the original causes and bypass Store/lease close; Store close precedes owned-lease close, and the supplied lease is untouched. No retry or timeout is introduced. The ticking body is currently synchronous between its guard and `finally`; the explicit barrier remains present.

First new-test trial: **6/7 passed, one fixture setup failure, zero skips/cancellations**, 2.699777509 seconds. The two-ordinary-request test failed at `begin('second')` before installing the SQLite fault or calling close: the fixture has no interval and its empty initiative slot needed a subsequent ordinary host tick. The fixture now pumps `app.tick()` while awaiting request entry, using the normal scheduler without altering runtime/source or shutdown assertions. Preserved log `/tmp/aeon-application-shutdown-review-first.log`, SHA-256 `9026a7315ae2d3af6e977e7cc72eb6ae5866562cd6272afee2ae549c48c84f7d`. Root was notified immediately. The corrected standalone trial passed **7/7**, 2.716209343 seconds (`/tmp/aeon-application-shutdown-review-second.log`, SHA-256 `a5e2fb8640dc06c01e01a97685fbb80c6189f8a0cd3255dc5ae99b613141aeb6`). Final assertions additionally require the persisted goal to exist and both request records to remain uncertain.

## Final results and disposition

**Accepted within the application shutdown contract; no source defect reproduced.** Seven independent cases plus the six unchanged author cases pass **13/13**, zero failures/skips/cancellations, 6.034449409 seconds. The unchanged startup/close regression passes separately **1/1**, zero skips, 1.296703973 seconds. Strict compilation and diff whitespace checks pass. Only the two claimed new paths are changed.

The independent cases establish callback reentry and synchronous execution admission fencing, continued per-run persistence after the first sorted write fails, successful second pending persistence before both abort notifications, retained actual Store/lease/grants and uncertain requests, no retry after the fault is removed, actual initiative/ordinary drain in both completion orders, preservation of two original ingress errors for callback and synchronous-throw variants, and caller-owned-lease preservation on reentrant Store-close failure. The six unchanged author tests retain owned Store/lease-close failure and successful supplied-lease coverage.

Commands, from the review worktree:

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --experimental-test-module-mocks --test --test-concurrency=1 deployment/application-shutdown-review.test.ts deployment/application-shutdown.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-name-pattern='^close during application startup cannot leave a listener or background work alive$' deployment/application.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

Final test SHA-256: `c641209e7785c3d1dcd8b01fe1ca072327e141c2ce73c2ccbc53b1f23858e52a`. Receipts:

| Receipt | SHA-256 |
|---|---|
| `/tmp/aeon-application-shutdown-review-joined.log` | `d7723307c78a1597345407ad0e4556f93af27e586d06e6255c3244e1d56f1249` |
| `/tmp/aeon-application-shutdown-review-startup.log` | `e7ea9619700f6baeb1ae3eaef83101cf5362d07d4869528485da2f0d5f1e4348` |
| `/tmp/aeon-application-shutdown-review-strict.log` (empty, exit 0) | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

This is in-process application/SQLite/Pi engineering acceptance. It does not establish physical descendant drain, live Slack or direct socket failure behavior, provider completion, full driver/acquisition qualification, autonomous use, or H1. New direct-stop faults use a synthetic listening state and host close callback; only the unchanged startup regression opens a temporary loopback listener. Failure intentionally retains Store/lease and a stable rejected close result for explicit host resolution; a rejected close is not quiescence or permission to transfer ownership. Next owner: root, to integrate this exact two-path review handoff and preserve the bounded disposition in central planning. No repair or sibling wait is required.
