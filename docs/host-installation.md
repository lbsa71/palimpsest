# Operator host-baseline installation

**Status:** Bounded procedure implemented, local custodian/real-worker integration and live installation verified; subsequent evidence through 2026-10-09 is recorded in [progress](progress.md). This is a local operator deployment procedure, separate from conversational self-modification and full autonomous custodian evolution. See [ADR 0016](adr/0016-operator-host-baseline.md).

## Why a separate procedure is needed

The frozen release includes a governance identity for trusted host source, contracts and checks. Ordinary cognitive succession requires that identity to match its incumbent. A developer can install reviewed new host code while the external journal still retains a worker release frozen before that code changed. Subsequent otherwise-valid cognitive proposals then fail `governance_change_disabled`. Restart intentionally recovers the retained known-good release; it does not silently adopt the checkout or erase the mismatch.

Updating the retained baseline must therefore be an explicit operator installation. Disabling governance equality, editing release/journal records, bootstrapping a replacement empty store or admitting the pending human proposal as a baseline would bypass the release contract.

## Scope and preparation

The trusted `GenerationHost.installHostBaseline(manifest, expectedIncumbent)` operation re-evaluates mandatory checks and installs a reviewed host baseline with **the same complete cognitive source digest as its incumbent**. It is absent from worker handles, conversation decisions and Slack tools. The custodian has a distinct trusted host-installation operation; no candidate can invoke it through a model-selected tool.

Prepare a frozen artifact from a clean, reviewed checkout and current configured model/profile. Preserve the entire currently admitted `src/agent/*.ts` source, including helpers, rather than using a pending proposal or the checkout's potentially different cognitive source. The CLI freezes the clean checkout and requires exact `sourceDigest` equality; it does not automatically copy, overwrite or rebase cognitive source to make the comparison pass. Unexplained drift blocks installation and requires separate reviewed operator work before preparation.

Run **all three** baseline protected checks: `typecheck`, `trusted-agent-contract`, `cross-scope-memory`, plus every previously admitted check. The freezer's two-check bootstrap default is insufficient for this procedure. The CLI carries the incumbent's check floor forward; installation rejects dropping it. Verify the exact frozen manifest and independently collected passing evidence; preserve reviewed host commit, old/new identities and evidence digest. Require the expected incumbent to still be current, equal schema and frozen configuration, the currently configured provider/model profile, and a verifiable retained recovery artifact. Ordinary proposal governance equality remains enabled.

## State and recovery contract

1. Start only from a normally serving incumbent with no unresolved installation, launch or external-effect ambiguity. Take the existing exclusive coordinator/custodian ownership; retain all external task, memory, agenda, effect and release journals.
2. Persist an operator installation intent binding the expected incumbent, frozen new baseline and exact evidence. Keep the old known-good release and its rescue bytes intact. Stage and probe the new restricted worker without production authority.
3. Quiesce and take a fresh checkpoint. Current memories, commitments, corrections/cancellations and effect outcomes govern activation. Unknown effects block transfer; an operator install cannot clear them to obtain a pass.
4. Fence the old generation under a fresh monotonically increasing epoch. Catch up and activate the exact new worker, then require the configured bounded runtime health probes (three by default in the CLI). This procedure performs no model inference; provider availability alone must not decide installation health.
5. Only after successful activation/health commit the new known-good baseline and retain the prior rescue release. Retire the old worker through recorded stop intent. The installed outer host remains operator-managed; this operation does not grant autonomous host/custodian replacement.

Staging processes and stop intents are durable. Failure or restart before successful commit restores the old known-good release with current external state under a later epoch. Failure after successful commit recovers the new known-good release normally. Interrupted installation intent cannot be discarded, and an uncertain launch/stop must be reconciled. Failed fallback follows the existing bounded recovery/quarantine/recovery-required contract; no reset or history rewind is permitted.

## Bound operator restoration

Retain an explicit operator restore route using the same checked/fenced installation contract. It may restore the previous baseline only while the current release is the exact baseline installed by that recorded operation. A later cognitive promotion invalidates that simple restoration route: restoring older cognitive source must not silently undo subsequent evaluated changes. Verify retained bytes, supported schema/configuration and current memory continuity before restoration.

This rescue route restores the retained cognitive baseline under the currently installed trusted host. Reverting the outer host executable is a separate operator deployment, requiring the retained reviewed source, compatible current storage and the older recovery path. Full autonomous custodian replacement remains disabled.

## Operator interface and evidence

The CLI exposes the following operator commands. Their implementation still requires the acceptance evidence below before deployment is claimed successful:

```sh
npm start -- host-baseline prepare
npm start -- host-baseline install <candidate-id> <incumbent-id>
npm start -- host-baseline restore <installed-id>
```

`prepare` freezes the clean checkout with the exact protected check selection, checks unchanged cognition, runs mandatory checks and prints `candidateId`, `incumbentId`, `evidenceDigest` and observed status. `install` takes the expected IDs, recovers the current incumbent, verifies the frozen artifact and re-runs mandatory checks before invoking the separate trusted installation. `restore` is bound to the current recorded installed baseline; it rejects after a later cognitive promotion. None opens Slack/API ingress or invokes a model/provider. Candidate IDs must be full 64-character hexadecimal identities, not arbitrary paths.

Stop the ordinary serving coordinator before another state-owning deployment command; never delete a lock to bypass ownership. Resume `serve` against the same external data directory after a verified installation. The short-lived install command may recover current workers to perform the transition, then closes those workers on exit; it does not restart the outer serving process itself.

Record old/new manifest and governance identities, unchanged source digest, protected check/evidence identities, installation intent and result, authority epochs, process reconciliation and retained rescue identity. A failed human-origin proposal remains failed; installation must not replay its uncertain inference or reuse its approval. A new conversation can request a fresh evaluated proposal after the baseline is installed.

## Acceptance and limitations

Required checks cover exact incumbent/evidence binding, unchanged complete cognitive source, schema/configuration incompatibility, unresolved effects, candidate inability to invoke installation, ordinary governance rejection remaining enabled, successful normal operation after installation, failure after fencing and interrupted installation recovery to the old release with current history, and bound restoration refusing a later promotion. Test real restricted workers separately from synthetic custodian hooks. Live deployment evidence is recorded separately from fixtures.

Custodian fixtures passed for retained governance rejection, bound rescue, later epochs/current history, unresolved effects, failed activation and abrupt process death during installation and restoration transfer. Both old/staged worker identities remain durable before the fence, allowing recovery to stop/reconcile them. Restoration intent retains the original installed descriptor across process death, allowing a later bound retry.

The real-worker integration passed operator installation before a subsequent conversational release: all three protected checks ran, unchanged cognitive source/configuration were enforced, current memory survived and the new governance allowed ordinary evaluated succession. Negative cases rejected a proposal masquerading as a baseline, missing protected checks and changed frozen configuration. The operator CLI fixture exercises `prepare`, wrong-incumbent rejection, `install`, memory preservation and `restore` with a later epoch. Live installations separately aligned the host before the Mistral conversational shed and installed the reviewed plan-executor baseline; exact identities and observed results are recorded in progress.

This procedure solves explicit local host-baseline alignment; it does not close meaningful cognitive interview quality, memory calibration, general P16 tooling, whole-service self-restart or autonomous custodian evolution.
