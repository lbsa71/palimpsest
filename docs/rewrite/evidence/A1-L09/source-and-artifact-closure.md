# Source editing and concrete deployment closure

Root integration work, 2026-10-11, A1-L09-T04 / RW13 / RW14 / RW21. This is implemented engineering evidence; neither autonomous live editing nor release acceptance is inferred.

`source_checkout` copies the explicitly enumerated rewrite source into an empty exclusive workspace inside the same namespace boundary used for commands. Retired source/history, Git metadata, private state and installed packages are not copied. Every copied file receives a source digest. A model cannot choose a host source path. `source_check` invokes the accepted pinned compiler, available read-only, against the mutable candidate under `/work`; optional emission produces a candidate `dist` tree. Network access and routine package publication are unnecessary.

The real confined test checked out the rewrite, changed the retained schema-validator source to introduce a type error, observed the actual compiler reject it, repaired the declaration, and built changed JavaScript. Repeating checkout into an occupied workspace was rejected. This establishes a usable dependency-edit/check/build path; it does not establish live model competence or accepted successor loading. Candidate tests that need nested host namespaces belong in the separately controlled integration evaluator, since ordinary worker namespaces prohibit nested user namespaces.

`freezeApplication` binds the actual source inventory, retained Pi/schema forks, root lockfile, exact installed compiler/type-declaration/native-compiler closure, configured model/prompts, and Node executable digest. The host control classifier includes host-executed mutation/permission APIs, runtime/effects/storage, release/supervisor code, deployment code and the compiler closure. Changing these requires staged controls. Classification is enforced again against frozen file bytes by `verifyApplication`; a candidate's assertion that it changed no controls is insufficient. The Pi cognition loop remains eligible for ordinary candidate review, still bound by the complete source manifest.

Observed commands with Node 24.13.0:

- Strict typecheck passed.
- `node --test deployment/source-workspace.test.ts` passed, including actual failed check and repaired emitted dependency.
- `node --test deployment/candidate.test.ts` passed. A real full source/toolchain snapshot verified; a newly frozen candidate with a forged empty control declaration was rejected; a different runtime executable was rejected.
- Updated Pi edit/build/fresh-process probe passed with zero installed runtime dependencies. [Exact report](../../../../experiments/agent-shell/results/q1-source-owned-schema.json) preserves measured clean/warm/edited builds and loading. Prior TypeBox-era reports remain unchanged historical evidence.

The runtime and compiler remain substantial external toolchains, with concrete pinned executable/source identities recorded. This is not a claim that their entire source-build closure has been qualified for autonomous modification. OS/libc/kernel identity and production cgroup/storage provisioning still require installation evidence. Source hash checks, read-only mounts and private artifact storage work together; mode bits alone are not the isolation boundary.
