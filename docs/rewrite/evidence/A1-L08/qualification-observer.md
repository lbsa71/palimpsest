# A1-L08 authenticated objective observation boundary

Finite owner: Codex `/root/a1_remaining_gates`, worktree `qualification-observer`, branch `codex/a1-qualification-observer-20261011`, base `dbab4be`. Requirements RW02/RW03/RW11/RW17–RW20; [lane](../../lanes/A1-L08-evaluation.md), [protocol](../../evaluation/protocol.md). This is engineering infrastructure for externally qualified objective cases. It does not accept A1-L08, comparison, subjective development, or H1.

```text
/goal Implement and verify a bounded externally authenticated qualification manifest, immutable trusted observation/result boundary and release-evidence conversion under evaluations/qualification, preserving synthetic/author/unavailable provenance and documenting exact limits and handoff.
```

Exclusive writes: new `evaluations/qualification/**` and this evidence file. Existing product adapter, release admission, host enforcement and calibration source remain unchanged. Root supplies fresh review and integration. Routing: inherited workhorse/high implementation with fresh independent review; no child spawned from this task.

## What the implementation establishes

`manifest.ts` authenticates a complete inert JSON snapshot using a domain-separated HMAC and an externally configured issuer key. Getters, proxies, hidden properties, sparse arrays and non-JSON values fail before verification or dispatch. The manifest binds the exact candidate (including source, dependencies, prompts, model, configuration and controls), materialized configuration, protocol, private packet, calibration plan, evaluator implementation and accepted judging policy. Its grant has explicit original issue/expiry times, resources and evidence byte ceilings. A signature alone does not select a trusted evaluator, authorize a new policy or make synthetic evidence live.

`observer.ts` inventories actual observer/product-adapter/application source and the executing Node bytes, compares them with an externally qualified artifact, verifies the frozen candidate, and compares the actual imported host/application closure with that candidate. It starts the existing actual application and direct-input path, then retains the original author adapter report without altering its `independent:false` or `admissionEligible:false` fields. Only the public task projection enters model context. The private packet and immutable store must remain outside application, workspace and state mounts.

The resource grant is allocated in the actual application's `ResourceLedger`, using `operating-envelope:v1` and the signed original start time. Private checker processes reserve and settle requests under that same root ledger; observed invocation requests, usage, failures and checker receipts are retained. Completion cancels that original allocation. The private store claims both grant ID and experiment ID once; fresh operational state is required, and a restart cannot reset the same grant. A crash between immutable claim writes conservatively strands the grant.

The deterministic evaluator supports exact text/JSON artifacts and bounded Node command outcomes only. It uses descriptor-pinned reads that reject symlinks, hardlinks, special files, changing files and oversized/non-UTF-8 content. Each command uses the existing confinement with candidate workspace and protected host paths; private expected outcomes remain in the observer. At most eight commands run, each at most two seconds; stdout is bounded. Checker source must remain unchanged during its invocation. It does not infer judgment, personality, research quality or developmental transfer from prose or regular expressions.

`store.ts` pins an owner-private directory through no-follow descriptors, excludes simultaneous writers with the existing process lease, writes content-addressed files with exclusive creation and fsync, and verifies hashes on read. The normal store capacity is 32 MiB (hard maximum 256 MiB), with at most 4096 entries; an experiment admits at most 8 MiB evidence and 1 MiB artifact data. No overwrite/delete operation is exposed. This is immutable against confined candidate activity, not against the trusted host owner or administrator.

`toReleaseEvidence` verifies the receipt and original experiment, accepted external trust profile, retained physical requests, original ledger, private artifacts/checks, implementation identity, original adapter provenance and configuration. Only successful live objective evidence can become an existing signed `EvaluationEvidence`, bound to the old policy/evaluator. Synthetic, author-supplied, failed, expired/out-of-envelope and unknown-usage results fail closed. Separately authenticated development-boundary records retain actual event/state references and timestamps with `externally-witnessed-unqualified` status; they never manufacture elapsed-development proof.

## External provisioning and integration contract

1. A trusted operator independently qualifies and freezes the actual observer artifact, objective case packet digests, protocol, accepted calibration plan digest and old `AdmissionPolicy`. Provision issuer/evaluator keys and this `QualificationTrust` outside candidate source/state/mounts. This code does not self-issue that qualification or a live grant.
2. Provision a canonical owner-private packet directory and a separate `QualificationStore`. Serialize the packet with `canonicalJson`; only the explicit public task is passed to the application. Provision existing host confinement and finite kernel resources for live mode.
3. Freeze and verify the candidate. Sign one `Experiment` whose resources equal the actual materialized application envelope, whose `configurationDigest` is `identity(JSON.parse(JSON.stringify(config)))`, and whose original time window is still valid. The original adapter's insertion-order configuration serialization is also retained and checked, so canonical manifest rereading cannot silently change its report identity.
4. Call `observeLive` from the externally trusted host. It has no injected transport/evaluator callback. The separate `observeSynthetic` entry uses the same frozen source, ledger, host observer and checker path, but requires integration provenance and cannot create live admission evidence. The original adapter's `liveSeal` remains only a prerequisite; it is omitted entirely for integration.
5. Retain the signed immutable receipt/store. Pass it through `toReleaseEvidence`, then the existing independent reviewer/admission path. It covers the explicitly qualified objective case only; other required cases still need their own qualified evidence.

Calibration coordination: use the calibration module's exported `planDigest(plan)` dynamically as `calibrationPlanDigest`. The external trust profile must admit that exact frozen plan only after authenticating its ordering and calibration record. No hardcoded method-domain version appears here, so the calibration v2 immutable-input repair is compatible. Calibration/analysis reports remain `admissionEligible:false`; this objective converter does not turn a statistical report into measured parity or substitute objective case checks for the protocol's comparison gates.

## Deliberate scope and remaining path

The adapter imports `AutarkApplication` from the observer checkout. The implementation therefore fails closed unless the actual imported host/application bytes match the frozen candidate, and candidate controls equal the previously accepted policy controls. This provides an initial accepted-host objective observer; it does **not** qualify arbitrary changed host/runtime/governance/evaluator candidates. That path requires observing an actual separately launched frozen service under the prior independently accepted judge; removing the equality check would invalidate the claim.

Runtime source dependencies are retained forks within `packages` and included in that closure. The existing deployment verifier checks the frozen check/build toolchain and runtime descriptors. Kernel enforcement and the existing accepted host remain dependencies; this task does not seal ambient `/usr`, establish hostile same-UID isolation, independently qualify the evaluator/workload, or change enforcement. Mutable trusted-host source/key configuration must not be exposed to the candidate.

Private command inputs are supplied only during the stopped application's confined evaluator execution; their expected outcomes and packet stay host-private. Filesystem checks cannot prove memory/judgment/personality quality. External subjective witnesses, actual development windows and transfer, both live comparators, approved provider access/spending and real H1 behavior remain separate outstanding requirements. No live qualification result is claimed by this work.

## Verification and preserved failures

Node: `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` (v24.13.0). Ignored `node_modules` points at the existing root development closure. No package changes, spending, provider generation, Slack sends, push or production changes.

- Strict TypeScript check passed at `fda4b02`.
- Fourteen focused tests passed: signature/tamper/expiry and executable-input rejection; predispatch rejection; durable grant replay refusal; private store isolation/corruption/capacity; private packet bounds; actual outcome checks; exact host-source binding; candidate artifact path/link/size refusal; signed synthetic refusal; accepted policy/calibration gates; unqualified developmental witnesses.
- Opt-in actual composition uses seven bounded synthetic responses to write, fail, inspect, repair, verify and speak through the real application; two private arithmetic checks run as real confined Node processes. The test checks actual ledger counts/start/envelope/cancellation, hidden-input exclusion from model payloads, original author provenance and replay refusal. Its result remains engineering-only, regardless of cryptographic signatures.

Durable local trial transcripts are outside candidate source at `/home/palimpsest/migration/aeon-1-20261011/qualification-observer-trials/`:

| Trial/source | Result and correction | Transcript SHA-256 |
|---|---|---|
| 1 / `cac4229` | Failed before dispatch (5.870s): comparing insertion-order configuration JSON against canonical frozen reread. `91b4c9a` signs canonical configuration and preserves the actual adapter serialization separately. | `236b8e8389e1f6591bbca8d0219e0bdc98fbb80886dfa56fac8dd02ba327daa7` |
| 2 / `91b4c9a` | Failed before application invocation (15.530s): hashing absent synthetic kernel limits while constructing `liveSeal` threw `not a JSON value`. `fda4b02` omits that live-only prerequisite for integration. No physical application progress is inferred from this failure. | `fa5c81e36993f5a6a0b285d3998212540841e1915e524e5752aac5fe36dc8ed1` |

Reproduction (physical composition is serialized with other host tests):

```sh
node node_modules/typescript/bin/tsc --noEmit
node --test evaluations/qualification/qualification.test.ts
AEON_QUALIFICATION_FIXTURE=1 node --test evaluations/qualification/composition.test.ts
git diff --check
```

The source and final actual-composition result are pending fresh review/handoff; no lane acceptance is recorded here.
