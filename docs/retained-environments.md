# Retained verification and execution environments

Status: selected design and testable specification, 2026-10-09; retention, dispatch and upgrade mechanisms described here are unimplemented. This is the next environment-continuity work item supporting production dependency integration in [P17](../PLAN.md#p17--implement-the-seeds-iterative-coding-capability) and autonomous upgrades in [P18](../PLAN.md#p18--enable-autonomous-evolution-of-the-whole-codebase). [ADR 0025](adr/0025-retained-verification-and-execution-environments.md) records the decision. It refines [coding autonomy](coding-autonomy.md#evaluator-and-dependency-continuity-across-upgrades), not the user's authority or allocation.

## Problem and expected behavior

The user requires full-codebase autonomy, including evaluator changes and local dependency forks (R06/R16/R18/R26). The current retained source is insufficient for those upgrades: changing the installed evaluator or its shared dependency installation can make an older release unverifiable or unrunnable. Recovery must remain available while these components evolve.

Source review at `ff855e1` established the following implementation facts:

- [Candidate verification](../src/candidates.ts) binds the installed evaluator's complete module hash, recomputes schema-2 policy under that module, compares the current runtime/dependency identity, and reads Git HEAD and the original base commit's tree/blob objects. The exact historical exception covers schema 1 only.
- [Custody](../src/custodian.ts) records proposed and prepared artifacts before final acceptance. Membership in its artifact list does not prove admission. Initial bootstrap requests recovery verification before custody registration.
- [Generation launch](../src/generations.ts) selects the current worker harness, runtime and policy implementation. [Service installation](../scripts/service.ts) links a shared checkout dependency tree. Read grants and compiler `typeRoots` alone do not provide package resolution from link-free candidate source.

Introduce one host-owned environment resolver, used across verification and execution. It selects independently admitted historical inputs for exact retained releases and current admission rules for new candidates. Retain runnable original verifier, check, Git and runtime inputs; stage new dependencies separately; derive controlled execution layouts from unchanged frozen source. This foundation must support repeated upgrades. Operator-assisted capture or fixture transitions remain intermediate evidence, not autonomous P18 completion.

## Objects and authority

These are conceptual records, not implemented interfaces. Exact storage/schema belongs to the implementation slice; reuse existing custody and effect journals where practical.

| Record | Bound contents and meaning |
|---|---|
| Environment object | Versioned content identity of verifier/check source and required imports, Node/compiler/native inputs, installed dependency closure, Git baseline materialization and resolution/launch layout. Its identity is independent of a particular release binding. Possession proves no authority. |
| Release/environment binding | Original manifest and evidence identities, environment identities for each role, the independently accepted admission/installation transaction, and permitted operational roles. Host-owned custody establishes its provenance. A prepared or rejected proposal cannot mint historical authority. |
| Execution descriptor | A verified, purpose-specific result of the resolver: original source identity, selected runtime/harness/checks, projection identity and canonical read/write/exclusion grants. Callers cannot replace its paths from model input. |

Keep the environment object separate from its release binding to avoid a circular manifest/receipt hash. Preserve existing manifests and evidence byte-for-byte; a versioned sidecar can bind historical inputs without relabeling schema 2 or rewriting old results. Capture missing historical bindings only through an explicit trusted migration from independently retained accepted evidence and verified inputs. Missing receipt does not imply permission to manufacture admission.

Three authorities can differ: the verifier that admitted a release, its serving environment, and the evaluator authorized for subsequent admissions. The freezer's installed module is not automatically the verifier copied into candidate source. The old accepted contract evaluates an evaluator replacement as candidate code, binds the proposed environment and evidence, and commits its authority only through the separate upgrade transaction. Tests run by the proposed verifier are observations under that old authority; they cannot approve its own installation.

Initial admission uses the current trusted bootstrap contract and records its successful binding explicitly. Historical verification requires exact admitted custody provenance. Future admission uses the evaluator currently authorized for that operation. An `artifacts` array entry, candidate-supplied version/hash/path or a historical verifier's reply cannot switch these roles. Integrity verification of an old release does not automatically authorize its activation against current state and policy.

## Retained inputs and verification

Use fixed immutable per-environment installations initially. A dependency directory may be shared by exact verified reference; content-addressed package management and generalized deduplication are unnecessary. Bind actual installed files and relevant modes, package/lock inputs, internal symlink targets and target contents. Reject escaping links, mutable aliases and unbound dependency fallback. A symlink's text alone is insufficient. Preserve Node and native compiler identity, required native runtime inputs and the platform/system prerequisites that remain external to the retained installation.

Retain a valid local Git view with HEAD and reachable base commit/tree/blob closure required by the original verifier. A source copy without those inputs cannot satisfy its historical checks. Preserve canonical paths participating in old runtime identity until that release's references end, or use a separately admitted relocation/compatibility interpretation with explicit equivalence evidence. Retaining identical bytes at a new compiler path is not sufficient under today's contract.

Migration of the current checkout-bound installation must explain how those old paths remain usable or are compatibly relocated. Transition fixtures created entirely at new fixed paths do not establish that legacy migration or its checkout-independent recovery.

Independently check receipt provenance and retained bytes before executing selected code. Prefer a bounded child verification protocol using the retained Node and original verifier/check environment. Importing an old module into the current coordinator would still use the current runtime. Bind requests/results to exact artifact, environment and purpose; bound output, duration, cancellation and child ownership. The helper receives only the inputs and effect destinations needed for its task, with no credentials, production handles or writable custody. The current custodian remains the sole issuer of production authority. The broker itself can evolve through a subsequent evaluated upgrade retaining an older rescue.

## Execution projections and consumer routing

Frozen source stays link-free. Create regular source copies for execution, verify them against the original manifest, and supply only host-selected dependency junctions or parent locations outside candidate-writable paths. Source-file symlinks can change package resolution and are not an equivalent default. Grant canonical dependency targets explicitly and translate manifest-bound exclusions to the projection's actual paths. Probe real bare-package imports; read permission alone does not prove resolution.

Writable workspaces keep their ordinary-file contract. Never insert an ordinary dependency symlink into a tree whose whole root the candidate may write. A protected parent dependency location is a small initial option. A separate execution copy requires explicit writer/checkpoint ownership and reconciliation of generated files or command edits before observations are attributed to the draft. Do not silently test one tree and freeze another. Package shadowing or fallback outside the selected source/environment must be detected or explicitly represented in the tested identity.

| Consumer | Required selection |
|---|---|
| Freezing, new checks and transition probes | Current admission authority; explicitly selected candidate execution environment; exact source/evidence bindings. |
| Historical verification, incumbent challenges and recovery | Independently retained binding, original semantics and current activation/state constraints. |
| Protected checks, normal and scoped workers | Selected Node, harness, packages and projection exclusions; no implicit current-installation substitutions. |
| Service install, restart and restoration | Exact serving environment and launch metadata; no link to whichever checkout dependencies happen to exist. |
| Publication and workspace import | Verified original manifest bytes and provenance; generated projection links/dependency installations never become authored source. |
| Workspace commands | Explicit environment descriptor; no inference of dependency authority from compiler-directory ancestry. |

All existing consumers must use the same selection contract before production integration is called coherent. Broader publication of dependency/fork source remains P18 work; environment packaging does not expand the current cognitive-only publication scope by itself.

## Capture, transition and retention

Prepare the retained files and verify their full identity before publishing a usable binding. An incomplete capture remains untrusted staging. Durably bind admission and required environment references before activation; recover interrupted preparation/admission without guessing whether a candidate became accepted. Existing accepted inputs remain untouched while the new environment is staged and tested. The implementation must specify the crash boundaries across filesystem installation and custody records; they are not one transaction.

Retain references for incumbent, probation fallback, rescue and in-flight verification/execution/transition work. Selection and deletion must be serialized or pinned so a verified environment cannot disappear before launch. Garbage collection refuses referenced inputs and the last usable rescue; interrupted deletion cannot leave an apparently valid partially deleted environment. Bounded storage/admission policy must report insufficient capacity instead of evicting recovery inputs. Obsolete unreferenced environments may retire; no permanent ancestor process or unlimited archive is required.

Recovery uses retained local inputs without package installation, network or model calls. Preserve one production authority, current memory/tasks, spent reservations and unknown effects. Current data/schema and access-policy compatibility remain required; executable rollback cannot restore an older database or broader historical access. Unsupported or damaged environments produce an honest unavailable/recovery-required result, never substitution with current dependencies or candidate-selected weaker rules.

## Acceptance and implementation slices

Establish failing observable checks before implementation. The following gates refine A17/A22/A23; results must identify actual executed paths, skips and remaining gaps.

1. **Provenance and bootstrap:** initial admission records its binding; exact accepted historical evidence permits capture. Proposed, prepared, rejected, forged or relabeled artifacts cannot select a historical verifier. A probe proves refusal happens before selected code executes.
2. **Capture interruption:** terminate between materialization, sealing, receipt preparation, admission commit and activation. Reopening preserves valid old inputs; incomplete staging supplies no authority, committed bindings remain recoverable and uncertain effects stay recorded.
3. **Two successive transitions:** schema-2 evaluator/dependency A→B→C runs through the separate upgrade contract. Old controls admit each change; subsequent admissions use the new evaluator; retained fallback still uses its bound environment. A one-off version exception is insufficient.
4. **Resolution:** a pinned package with observably different old/new behavior imports through frozen typechecking, protected behavior checks, normal/scoped workers, service restart and workspace commands. Source, exclusions and native/compiler identities match the selected descriptor. No checkout-package fallback occurs.
5. **Independent recovery:** make the original checkout and its dependency tree unavailable and disable network/provider access. With retained Git/runtime/check inputs, prove verification and recovery after failures before and after activation. Preserve current state, one authority and spent/unknown operations.
6. **Tamper and downgrade:** altered verifier/check/package bytes, modes, escaping dependency links, replaced junctions, missing Git objects, mismatched canonical paths and candidate-selected old policies fail without rewriting manifests/evidence or silently fetching replacements.
7. **Source and draft fidelity:** publication/import contain only original authored files. A real command edit or generated file in a separate execution copy is reconciled under workspace ownership before testing/freezing claims. Existing link rejection and peer authority negatives remain effective.
8. **Retention:** deletion is refused while any operational/in-flight reference or last-rescue role exists. Exercise selection/deletion races, crash during deletion and capacity exhaustion; unreferenced retirement preserves another verified usable rescue.

Implement in reviewable slices: environment capture/provenance/resolver; unified projections and consumer routing; then repeated transitions and failure evidence. Keep ordinary work and the separate serving reliability fix independent where their inputs permit. Deterministic packages and fake providers can establish these mechanics without purchased inference. Actual SDK integration, broader release dispatch and autonomous activation require their own acceptance; operator/bootstrap fixtures do not complete those milestones.

## Dependencies, non-goals and risks

Depends on existing immutable artifacts/evidence, custody and fenced process ownership, isolation, workspace checkpoints, retained Git inputs, and current storage compatibility. The implementation must choose a versioned durable receipt schema, bounded verifier protocol, precise projection layout, storage limits and migration of the current accepted installation before enabling the route.

This work introduces no generic package manager, remote registry, container platform, new model, package installation, live activation, spending or publication authority. It does not make any source component permanently human-only. Material risks are circular trust during capture, conflating preparation with admission, mixed old/new runtime inputs, package-resolution drift, mutable junctions, missing Git history, stale grants, crash gaps and premature deletion of the only usable rescue.

## Evidence status

This specification follows source review of `ff855e1` and the independently reviewed continuity contract in ADR 0019. Two independent reviewers checked source/design consistency, authority, recovery and execution routing and found no blocker. Lead and reviewers verified all 13 local references, including four heading anchors, across these two new documents; direct whitespace inspection passed. Tables express the authority and consumer mappings; no diagrams changed. The listed mechanisms and acceptance cases have not been implemented or run by this documentation work. No runtime or autonomous-upgrade pass is inferred from the document.
