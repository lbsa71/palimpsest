# Fresh application boundary review

Owner: `/root/a1_app_review`; branch `codex/a1-app-review-20261011`; worktree `/home/palimpsest/migration/aeon-1-20261011/app-review`; frozen base `ccc0628`. A1-L04/L05/L06/L07/L09 review subtask delegated by the integration lead. This reviewer did not author the preceding application implementation.

/goal Review consequential ordinary application and development boundaries, reproduce actual regressions before repairs, run targeted checks, and hand off committed fixes and evidence without claiming H1 or live qualification.

Status: finite review complete. Source commits are `d69d83f` (configuration and owned bootstrap prompt) and `0dbe882` (runtime/component repairs and regression fixtures). Only ordinary application/config/development adapters, development/initiative components, focused tests, and this evidence directory were changed. Shared supervisor, resources, command/workspace confinement, source/release/CLI and evaluation paths remained with their owners.

## Findings and repairs

| Finding | Reproduced behavior | Repair and retained boundary |
|---|---|---|
| Wider goal mutation | A private-context tool could rewrite a visible public goal with private purpose/reason text. | Goal acceptance, revision and progress require a destination that contains the caller's full audience restriction. Selection of a wider inquiry opportunity is similarly disallowed. Public evidence remains readable, and a private plan can still reference a public goal without publishing its content. |
| Forgetting disclosure | Forgetting public evidence returned the identifier of a private descendant. | The cascade still forgets every descendant and dependent self/job record, but the tool receipt lists only identifiers visible to its authenticated audience. Operational evidence remains separately retained. |
| Foreign goal progress | An unrelated same-audience tool could complete a running goal by selecting its stored execution and observations. | `initiativeTools` now requires the host run ID, and progress requires that exact executing run. The ordinary application supplies it; model arguments cannot select it. Successful observation checks remain in place. |
| Lost scheduling callback | A committed follow-up to a waiting conversation was never resumed after the host callback was lost and the process restarted. | Ordinary scheduling discovers unconsumed durable steering events against the execution's message sequence. Consumed input does not create repeated work. |
| Partial report registration | Injected registration failure left an admitted report run without its durable delivery owner. | Runtime admission, destination grant, and report ownership commit in one transaction. Unknown/terminal report outcomes are still not automatically retried. |
| Partial child registration | Injected child-grant failure left a child runtime discoverable as ordinary work, without its restricted child action marker. | Child runtime admission, exclusive workspace grant, and child authority marker commit in one transaction. |
| Lost extension outcome | A completed extension write with a cyclic result was called failed; an extension write followed by an untyped exception was also called failed. | Await execution. Once it returns, receipt persistence/serialization failure is uncertain. Entered extensions conservatively treat untyped failures as uncertain; explicit `mayHaveApplied: false` is reserved for known non-application. Explicit `true` remains uncertain. Unknown effects block and reconcile to unresolved instead of being replayed. |
| Empty-state passivity | A fresh host with no human input had no evidence, goal or drive, hence no opportunity to initiate development. | Default-enabled `bootstrapInitiative` creates one transactional host-attributed initialization observation and accounted development run per state store. The additional owned prompt is an explicit effective-manifest fragment with artifact provenance. The model chooses its own bounded follow-on goal or a reasoned no-action decision. No identity, interest, achievement, or prior lived experience is seeded. |

The bootstrap allocation descends from `initiative:ordinary` and `operating-envelope:v1`. The ordinary confined model/tool path executes it. One fixture starts with zero communications, chooses and accepts an inquiry through model tool calls, obtains an actual workspace discovery result, and completes against that issued result: six fixture model requests plus four tool effects, 720 reported fixture tokens, all retained under the global operating ledger. Restart adds no run/request. A separate zero-request allowance case preserves one blocked run and its source observation across restart without provider dispatch or repeated admissions. Other application fixtures explicitly opt out to retain their isolated scenario inputs.

## Evidence

- `frozen-regressions.txt`: all three initial scope/forget/progress cases fail against `ccc0628`.
- `runtime-regressions.txt`: report orphan and serialized-extension outcome failures. Its first steering attempt stopped at an unsuitable setup (`maxRequestsPerSlice` yields blocked, not waiting); it is preserved, not counted as the steering counterexample.
- `steering-regression.txt`: corrected real abort/wait/restart case fails because the second request never occurs after committed steering loses its callback.
- `child-registration-regression.txt`: actual application delegation admission leaves an extra run after injected child grant failure.
- `extension-throw-regression.txt`: the untyped post-write error case fails against the exact frozen application source. The current file was restored in a `finally` block before build/handoff.
- `bootstrap-regression.txt`: before implementation, no new goal appears on an otherwise idle fresh application.
- `verification.txt`: **75/75 pass**, no skips. Includes 17 ordinary application fixtures, 3 new direct adapter boundary fixtures, and existing development/initiative/communications/delegation coverage.
- `typecheck.txt` and `build.txt`: empty outputs with successful exit status from strict checking and TypeScript transpile build.

Commands used Node `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`, with real local `node_modules` copied into this isolated source worktree for confined worker resolution:

```sh
node --test deployment/app-boundaries.test.ts deployment/application.test.ts packages/initiative/test/initiative.test.ts packages/development/test/development.test.ts packages/communications/test/communications.test.ts packages/delegation/delegation.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc --noEmit false --rewriteRelativeImportExtensions --outDir /tmp/aeon-app-review-build
```

## Handoff and limits

The integration lead was notified of each shared seam. Root owns `ResourceLimits` configuration/propagation and source/evolution extension injection. Root also owns adding `bootstrapInitiative: false` to controlled evaluation/service fixtures, and must include the new owned prompt in candidate closure and integrated effective-instruction qualification. The new `initiativeTools` host-run parameter is an intentional API change with all in-tree callers updated in this branch.

No external service calls, live models, messages, deployment or push occurred. Local loopback test traffic, fake Slack APIs, deterministic provider fixtures, real confined worker processes and local file tools were used. The scope covers concrete defects and bounded first-development wiring; it does not establish live curiosity, longitudinal growth, independent product competence, release admission, or whole-H1 acceptance. Application-level fresh review does not replace root's final integration and independent evaluation gates.
