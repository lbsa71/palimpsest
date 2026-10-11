# A1-L09 — candidate-bound Node runtime evolution

Status: **implemented and fixture-verified**. Owner `/root/a1_runtime_bundle`, branch `codex/a1-runtime-bundle-20261011`, worktree `/home/palimpsest/migration/aeon-1-20261011/runtime-bundle`. Base `655d157`; host review `be1c87e` was first incorporated (local equivalent `1e14101`). Implementation and verified source revision: **`9d89c31`**. Root integrated the implementation as `1440e40`. Requirements: RW14, RW15, RW16, RW19, RW21. Fresh review, final bootstrap integration, production resource qualification and deployment remain downstream gates.

```text
/goal Implement a bounded source-authored Node runtime proposal whose exact executable binds a separately staged application candidate; demonstrate actual launcher/coordinator/service execution of that runtime and offline restoration of the incumbent runtime with current state, then record exact evidence and hand off the bootstrap integration seam.
```

The root assigned exclusive ownership of new `deployment/runtime-bundle.ts` and tests, `candidate.ts`, `materialize.ts`, `service-process.ts`, and runtime staging/frozen-input seams in `evolution-tools.ts` and `evolution-mailbox.ts`. The host owner released `host-successor.ts` after `be1c87e`; runtime selection and corresponding host fixture assertions were then integrated there. Root owns lane coordination, root configuration, final integration and independent review. No root configuration or lockfile changed.

| Task | Inputs and deliverable | Observable acceptance |
|---|---|---|
| RB01 | Existing candidate/release inventory and old-policy staging; exact bounded runtime descriptor and descriptor-pinned copy | Hash, size, executable, platform, Node-major and ordinary-file boundaries fail closed without executing proposal bytes |
| RB02 | Source settings and accepted source/compiler snapshot; runtime proposal and retained-blob inheritance | Source/compiler quota stays fixed; `.runtime/node` remains outside ordinary checkout roots; manifest/source/dependency/control identities bind the exact runtime |
| RB03 | Host successor and service authority ledgers; actual selected executable on activation and recovery | All three live processes execute the bound successor ELF, then the retained incumbent ELF after failure, preserving current state without provider calls |
| RB04 | Strict check, emitted build and targeted behavioral suite; exact handoff evidence | Checks pass; failures and physical/profile limits remain explicit; downstream bootstrap owner receives the released host seam |

## Behavior and artifact contract

Previously, `host.nodeBinary` selected one external executable regardless of accepted source succession. The runtime declaration hashed that same fixed file, so a new binary could neither verify nor launch.

The default external Node remains the fallback for candidates without an explicit runtime bundle. A source author can instead put an executable in its own workspace and write `deployment/candidate-settings.json`:

```json
{
  "runtime": {
    "nodeVersion": "v24.13.0",
    "nodeSha256": "<64 lowercase hexadecimal characters>",
    "platform": "linux",
    "arch": "x64",
    "workspacePath": "runtime-input/node"
  }
}
```

This uses the existing workspace-file and confined-command grant; for example the accepted `/runtime/node` can be copied or processed in `/work` when the physical file/workspace grants permit its size. No permanently human-only file installation, new SDK, download tool or arbitrary URL permission is introduced. This implementation makes no network request. Any separately authorized physical acquisition remains an ordinary accounted tool effect under host network bounds.

Previously accepted tools copy that file into host-private staging at `.runtime/node`. The runtime descriptor gains `bundle: { path: ".runtime/node", bytes: N }`. Runtime metadata appears in both frozen dependencies and controls; the binary itself participates in the source inventory and executable control closure. Existing candidate identities, independent signed evidence and separate control-upgrade admission therefore bind the exact binary. A proposed binary is checked as bytes and is never run by staging or candidate verification. Service startup checks the current authority's artifact and controls before spawning it. A running selected Node also checks its actual version against its frozen declaration.

The separate runtime staging ceiling is **128 MiB**. Source plus accepted compiler snapshot stays at **128 MiB**, and existing artifact ceilings stay at **128 MiB per file / 512 MiB overall**. Runtime proposal staging also respects the frozen `maxFileBytes` and `workspaceBytes` ceilings; insufficient grants reject the proposal. The earlier 16 MiB per-file resource fixture cannot create the 121 MB Node file. No resource policy is silently increased. Model-added `node_modules` remains excluded; the accepted real compiler closure is copied separately.

Only Node 24 for the current Linux platform and architecture is in this initial grant. Version is a candidate claim until admitted execution validates it; ELF magic and a hash are not vendor/version qualification. The runtime blob is outside `rewriteSourceEntries`, so ordinary checkouts omit it. Future freezes retain the accepted blob even when its previous source proposal remains in settings but its workspace acquisition path is absent. A different runtime identity requires an explicit new proposal and staging grant.

After `verifyApplication`, `candidateNodeBinary(candidate, artifactStore, fallbackNodeBinary)` selects the bound blob or verified fallback. Materialized worker configuration, ordinary service spawn, coordinator spawn and launcher `execve` use this selection. Rescue verification uses the rescue candidate's own runtime identity rather than incorrectly requiring its bytes to match the successor's hash.

Reuse/build assessment: retain the existing Node 24 runtime and candidate inventory/freezing/signature/admission mechanisms. Add a small local bounded copy/selection boundary rather than a package manager or runtime framework. The artifact is replaceable from locally produced workspace bytes. This does not claim that Node's upstream source/build closure has been qualified or that every Node/platform upgrade is admitted by the initial grant.

## Verification

All commands used `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`, **v24.13.0**, Linux x64. The existing real `node_modules` closure was copied from `/home/palimpsest/src/palimpsest/node_modules`; no installed package was modified. Private output and emitted build are outside Git at `/home/palimpsest/migration/aeon-1-20261011/private-runtime-evidence/`.

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit false --rewriteRelativeImportExtensions --outDir /home/palimpsest/migration/aeon-1-20261011/private-runtime-evidence/build
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test deployment/runtime-bundle.test.ts deployment/candidate.test.ts deployment/service-process.test.ts deployment/host-successor.test.ts deployment/evolution-tools.test.ts deployment/evolution-mailbox.test.ts
git diff --check
```

Strict check, actual emitted build and whitespace check passed. The final stable targeted suite passed **26/26**, **0 skipped**, exit **0**, duration **148,820.402477 ms**. Output: `private-runtime-evidence/runtime-tests.txt` at the absolute private location above.

The actual host fixture appends harmless trailing bytes to the existing ELF to create a hash-distinct executable. Initial bytes: **121,158,216**, SHA-256 **`53fb205ae78805130177e24bcb459a69a1518c8d98f8965f31d85aae7ea840fc`**. Successor bytes: **121,158,239**, SHA-256 **`66d97eeb637a42bbd52a0d7ed09bdd5701ba6eeb33c63ec4882b60c29f1df0c0`**. Both report v24.13.0. This proves artifact-selected execution, not a new vendor Node version. Its explicit fixture file grant is 128 MiB and artifact grant 512 MiB; the ordinary temporary directory does not qualify a production kernel resource profile.

Old controls perform staging, activation and fresh probation evidence judgment. Then `/proc/<pid>/exe` proves that launcher, coordinator and ordinary service all execute the frozen successor `.runtime/node`. The fixture writes current lived state and an uncertain-effect marker, removes provider/bootstrap/evidence/policy inputs, kills the new coordinator, and observes all three process executable paths return to the incumbent Node. Latest state remains exact and the physical provider request inventory remains empty. That case passed in **52,559.212496 ms**. Existing unbootable coordinator, broken launcher/restart, interrupted asynchronous startup, stale-authority and service SIGKILL/restart cases also pass.

Additional cases reject missing or insufficient runtime grants, wrong hash/size, unsupported version/platform, traversal, symlink file/ancestor, hardlink, oversize file, payload tampering and an unqualified candidate before execution. Source-owned runtime settings bind changed dependency/control identities. A subsequent small source checkout and freeze preserve the accepted runtime despite the absence of `.runtime` and the acquisition path. Existing external-proof, exact-receipt, stale-policy, uncertain-dispatch and ordinary controller staging regressions pass.

Preserved failures: the first lifecycle group passed 6/7; its only failure expected the earlier hash-error wording when a non-executable package file now fails the stricter executable boundary. The assertion was updated to the actual rejection. The initial runtime tamper case attempted to overwrite the retained read-only blob; the fixture now explicitly changes host-side permissions before simulating tampering. A later compiler run caught a test cast from `JsonValue` that required an explicit `unknown` intermediate; this was corrected before the stable suite. No product check or independent admission criterion was weakened.

## Handoff and limits

Root received code commit `9d89c31` and actual three-process execution/recovery evidence. `/root/a1_bootstrap_evolution` received the exact helper and bundle contract; `host-successor.ts` was released to that owner after the code commit for atomic boot-slot publication. Root's fresh review follows integration.

No production installation, provider request, Slack message, sudo, root unit mutation or runtime download occurred. Installation bootstrap/systemd `ExecStartPre` still references the fixed initial Node at this revision; the separate bootstrap task owns closing that gap. Therefore this slice does not establish full RW14 closure or deployment. A real product profile must separately qualify workspace/file capacity for acquisition, aggregate host artifact retention, binary compatibility, new-version behavior and resource enforcement before autonomous activation. Node 25, other physical platforms, upstream Node rebuild qualification and administrator-level OS/unit evolution remain outside this initial grant.
