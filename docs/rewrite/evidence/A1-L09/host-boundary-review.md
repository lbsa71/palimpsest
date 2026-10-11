# A1-L09 host-boundary review

Status: **fixture-verified bounded review; integration and H1 remain open**. Review owner: `/root/a1_host_boundary_review`, branch `codex/a1-host-boundary-review-20261011`, worktree `/home/palimpsest/migration/aeon-1-20261011/host-boundary-review`. Initial base `24408ec` includes the source/artifact and frozen-service work at `814c19a` and `451d5ca`. Root's application startup/grant fix `b52aac2` was cherry-picked here as `4660f3a`. Review implementation and regressions: **`7fb1c66`**. Do not cherry-pick `4660f3a` back into root.

Finite task: independently review source freeze, configuration materialization and service lifecycle; preserve consequential reproducible failures, repair owned boundaries, check the affected real paths and deliver a clean worktree. The lead assigned `deployment/{candidate,materialize,source-workspace,service-process}.ts`, their tests and this evidence. It subsequently extended ownership to `packages/release/artifacts.ts` and targeted tests to make source read bounds effective throughout freezing. Root retained application, service-child, broker, resource confinement, CLI and coordinator ownership. Requirements: RW10, RW14–16, RW19–21; lane tasks A1-L09-T02–T04. The reviewer used the inherited development model/effort; no substitute model or inference provider was invoked.

## Preserved failures

All cases use disposable directories and fixture strings. The assertions remain in `deployment/host-boundary-review.test.ts`, `deployment/source-workspace.test.ts` and `packages/release/artifact-bounds.test.ts`.

| Case | Observed before correction | Corrected boundary |
|---|---|---|
| Failed readiness diagnostic write | A regular file at `state/host-diagnostics` made `mkdirSync` throw before `stop`; `service.running` remained `true` | Cleanup runs in `finally`, including when diagnostic storage is unavailable |
| Redirected diagnostic directory | A symlink from `host-diagnostics` to an external directory received a JSON file containing fixture stderr | Descriptor-pinned directory opens reject links, require same-owner private directory permissions and create exclusive private files |
| Changed prompt payload | Replacing `candidate.inputs.prompts.mind` while retaining its old manifest caused no exception and materialized the replacement | Prompt and configuration identities are checked before materialization writes |
| Graceful leader exit | A leader that exited on `stop` left an active child in its detached service process group; assertion observed `true` instead of `false` | Stop kills the process group after graceful shutdown even if its leader has already exited |
| Deployment classification ancestor link | Linking `source/node_modules` to a directory outside source caused **652 pathname file reads** before generic freeze finally rejected the link | Classification uses the same descriptor-safe inventory as generic freeze, including the lockfile digest |
| Artifact read limits | A 10-byte file was accepted with a 9-byte per-file bound; the bounds suite failed with “Missing expected exception” | Host-selected limits apply to inventory, copy and verification |
| Growth after descriptor stat | A deterministic `fstatSync` interposition appended bytes after the first file stat; the old freeze admitted it with no exception | Fixed-size chunk reads, an EOF probe and descriptor metadata checks reject growth/change without allocating from the grown size |
| Nested checkout ancestor link | `experiments` linked to an unselected directory in `/app`; checkout returned exit **0** and copied its nested `agent-shell` content | Confined checkout pins each path component with `O_NOFOLLOW` |
| Prompt-parent traversal side effect | A redirected `prompt-materializations` parent caused creation of the digest directory outside state before the old realpath check threw | Descriptor-relative mkdir/open refuses the link before creating the external directory |

The initial three host tests failed 0/3 on the original implementations. The descendant, deployment ancestor, artifact bounds/growth and source checkout tests were then run with the corresponding original file restored from `4660f3a` (the relevant files were unchanged from base); each reproduced its stated failure. The prompt-parent side-effect test failed before its traversal correction. One initial source-checkout test setup omitted required `protectedPaths` and failed at confinement admission; adding a disposable protected state directory exposed the actual before-fix exit-0 traversal failure. That setup failure is not counted as product evidence.

## Implementation and checks

Generic artifact defaults are 128 MiB per file, 512 MiB aggregate source bytes, 20,000 files, 40,000 traversal entries and 64 path components. These are finite host-selected limits, with explicit optional host overrides; candidate metadata does not select them. Descriptor JSON has a separate 16 MiB ceiling, checked before publication and on bounded reread. Directory traversal streams entries instead of allocating an unbounded directory listing, counts implicit parent directories and repeated visits, and retains the existing no-symlink/single-link regular-file restrictions. Reads allocate only the admitted initial size and use at most 64 KiB per read call. No new runtime dependency was added.

Confined checkout uses bounded descriptor reads too, retains its host byte/file grants, and applies finite depth/entry bounds. Prompt materialization uses pinned directories and exclusive creation; existing files must be regular, singly linked and exactly equal to the frozen bytes. Diagnostic stderr is capped at 32,768 **bytes** before private persistence. Failure to persist diagnostics does not replace the startup error or skip cleanup.

Node executable: `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` (`v24.13.0`). The worktree lacked installed dependencies; only the accepted root toolchain directories were copied into its ignored `node_modules`: `typescript`, `@types/node`, `undici-types`, and `@typescript/typescript-linux-x64`. No symlinked toolchain was used for successful freeze fixtures. Compiler version and lockfile remained unchanged.

Commands from this worktree:

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node /home/palimpsest/src/palimpsest/node_modules/typescript/bin/tsc --project . --typeRoots /home/palimpsest/src/palimpsest/node_modules/@types --noEmit
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test deployment/host-boundary-review.test.ts deployment/candidate.test.ts deployment/service-process.test.ts deployment/source-workspace.test.ts packages/release/artifact-bounds.test.ts packages/release/release.test.ts packages/release/controller.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test packages/release/artifact-bounds.test.ts packages/release/release.test.ts packages/release/controller.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node /home/palimpsest/src/palimpsest/node_modules/typescript/bin/tsc --project . --typeRoots /home/palimpsest/src/palimpsest/node_modules/@types --noEmit false --rewriteRelativeImportExtensions --outDir dist
git diff --check
```

Observed results: typecheck passed; combined focused suite **26/26 passed, 0 skipped**, 25.0 seconds; after final traversal-count/descriptor-publication refinements, the affected release slice **16/16 passed, 0 skipped**, 5.8 seconds; emitted build and whitespace check passed. The earlier combined 24-case run also passed before the two additional traversal regressions were added. No failing acceptance case was removed or weakened.

The frozen ordinary application case starts the actual `AutarkApplication` with `bootstrapInitiative: false`, checks authenticated direct HTTP behavior, rejects missing product kernel limits, fences stale authority, kills/restarts the child, and preserves current lived/uncertain-effect records. It explicitly observes **zero physical provider requests**. The source-workspace case uses real confinement, obtains the accepted source, introduces and observes an actual dependency type error, repairs it and emits the edited dependency. Release/controller tests cover admission tampering, staged control replacement, failed startup/drain and offline recovery. The new synthetic service scripts exercise lifecycle edge cases; they do not substitute for the ordinary application fixture.

## Limits and handoff

This establishes targeted engineering and integration-fixture evidence only. It neither deploys a service nor accepts all of A1-L09/H1, a live model, autonomous evolution or product operation. No Slack message, provider call, systemd operation or production service change occurred. Root owns final integration and fresh inspection of these changes, plus the full-suite disposition.

Linux `/proc/self/fd` and previously accepted private host namespaces remain assumptions. Bounds prevent unbounded admitted source/descriptor reads; they are not a filesystem snapshot transaction or a replacement for kernel confinement. The artifact store must remain inaccessible to untrusted candidate processes. Existing host-only controls can still alter same-user private files and physical host bindings are trusted. Static path-based control classification is retained; this review does not prove a dynamic import graph or independently measure the declared `runtime.nodeVersion` string (the executable SHA-256 is verified). Same-group descendants are now killed; a descendant deliberately creating another session requires the separate kernel resource/process-confinement boundary. Partial failed prompt creation remains a diagnosed mismatch, not an automatic overwrite of supposedly frozen content.

Root was notified of the application start/close seam; its independent fix is the prerequisite `b52aac2`. Next action: integrate implementation `7fb1c66` plus this evidence-only handoff, inspect the owned diffs and run root's integrated checks. No additional permission or deployment authority is inferred from this handoff.
