# Fresh review of the native Codex baseline observer

2026-10-11. A1-L08-T02/T06 bounded engineering review, Codex `/root/a1_baseline_review`, separate context from the author. Base `08da49b` incorporates author source `6c834e1`; the later author evidence `31ed77e` was read without changing its file. Worktree `/home/palimpsest/migration/aeon-1-20261011/baseline-review`, branch `review/a1-baseline`. Exclusive writes: `evaluations/baselines/{observer,observer.test,run-codex,run-codex.test}.ts` and this evidence file. No worker, shared contracts, dependencies or application source changed.

```text
/goal Review the A1-L08 native Codex baseline observer and runner, repair evidenced resource/privacy/protocol defects in owned files, and produce review evidence with tests and commits.
```

An actual finite goal was created for this review. It evaluates the callable engineering composition under protocol v2, not live model competence, calibration, parity, production admission or H1.

## Findings and repairs

1. **Private state could follow links into the candidate workspace.** The runner checked the external state directory but opened SQLite paths without checking existing database files or sidecars. At the reviewed base, an `observer.sqlite` symlink to an empty workspace file caused **36,864 bytes** of observer state to be written there before the deliberately invalid native digest stopped execution. The equivalent lease link wrote **8,192 bytes**. The final behavior rejects symbolic links, hardlinks, special files and foreign-owned files for both databases and their journal/WAL/SHM paths before opening either database. Six symbolic-link cases and a hardlink case verify no external bytes are written and no lease is created. The ordinary external-state/reopen behavior remains exercised by the native test.
2. **Default prices were applied to a reported unpriced service tier.** The original request validator refused an explicitly unpriced tier, but an omitted tier was forwarded unchanged and final SSE usage ignored `service_tier`. A synthetic completed response reporting `priority` therefore settled as successful at default prices. The observer now explicitly forwards `service_tier: "default"`; a final response naming another tier is unknown, retains the full reservation, and cancels the grant. The original and forwarded bytes remain separately captured, including this explicit accounting mutation. No actual provider prices or current pricing assumptions were introduced.

Both defects were reproduced before implementation. An initial seven-case regression run failed; the state tests were then tightened to demonstrate actual writes rather than merely an unexpected error string. The two refined database cases failed with the byte counts above. The unpriced-tier case failed with “Missing expected rejection.” The repair is source commit **`31f0d13`**.

## Other reviewed boundaries

The immutable persisted grant and original elapsed start survive reopening; changed IDs/profiles cannot reset a dedicated store. Per-attempt reservations cover the complete host-attested input-context ceiling plus maximum output, at explicit input/cache/output prices. This relies on a genuine provider contract; request byte size is only a memory/protocol bound. Every allowed transport call occurs after durable reservation and dispatch. Repeated identical requests remain separate physical attempts. Process-death, cancellation, timeout, bad/truncated SSE, missing/inconsistent usage and context-ceiling violations retain conservative charges and prevent automatic retry.

The text-only request validator rejects hosted tools, media, unknown context/item references, model/effort changes and alternate routes before transport entry. Exact before/forwarded payload artifacts cover effective instructions, input, tool definitions and reasoning settings. Host credentials stay in the pinned HTTPS transport closure; the native worker receives only its dummy bridge token. External private evaluator paths remain outside candidate mounts, while namespace and kernel enforcement are reused from the existing supervisor. Paid execution requires the explicit kernel profile and fails before launch if it cannot be enforced. Fixture transport retains its separate namespace-fixture label.

CLI/helper/worker copies are checked against recorded digests after staging, and native configuration disables ambient user/rule configuration, native retries and hosted search. The existing worker performs genuine native tool execution; its output limit, host timeout, protocol bound and cancellation constrain the invocation. Reviewed run records distinguish a completed invocation from a model-competence pass.

## Validation

Node: `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` (24.13.0). Source under test: `31f0d13`.

```sh
node --test evaluations/baselines/observer.test.ts evaluations/baselines/run-codex.test.ts
node node_modules/typescript/bin/tsc --noEmit
AEON_CODEX_RUNNER_FIXTURE=1 node --test evaluations/baselines/run-codex.test.ts
```

The first command passed **42 tests with one explicit opt-in native skip**, in approximately 2.1 seconds. Strict TypeScript passed. The opt-in native command passed **10/10, zero skips**, in approximately **11.3 seconds**, at the same frozen source. Actual installed Codex 0.162.1 and its helper completed two synthetic Responses requests, executed the native command tool and wrote the workspace proof, preserved the external evaluator sentinel and absence of ambient API keys, settled both usage records, and refused grant replay. No source changed after this native run.

## Disposition and limits

The two reproduced defects are repaired. The review supports further engineering use of the bounded runner; it does not qualify a paid execution or establish a complete host-image attestation. The namespace fixture checks actual Codex/tool/observer composition using synthetic Responses only. It does not prove current API entitlement, model compatibility, live usage/pricing accuracy, kernel resource enforcement on this fixture host, or held-out evaluation independence.

The runner assumes a trusted host owns stable paths while it opens private state and stages/mounts tools. Pre-open link checks do not defend against a malicious same-UID host process concurrently replacing files. Node is hashed and mounted from its host path; the system `/usr` tool set is mounted read-only but is not individually sealed in this manifest. This remains a limitation for a stronger exact host/dependency-closure qualification, rather than an unreported claim that this engineering manifest already supplies it.

No paid API call, authentication probe, Slack message, service change, production write or push occurred. Price/context fixtures remain synthetic, unknown usage remains unknown, and no baseline outcome was converted into parity evidence. Parent L09 owns integration, any broader host-closure qualification, and the existing live-evaluation gates.

Handoff: integrate source repair `31f0d13` and this evidence follow-up. The finite fresh-review task is complete; the broader A1-L08 live-comparison and H1 gates remain open.
