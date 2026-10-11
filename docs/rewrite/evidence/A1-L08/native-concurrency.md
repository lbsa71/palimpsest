# A1-L08 bounded native request concurrency

Owner `/root/a1_native_concurrency`; worktree `/home/palimpsest/migration/aeon-1-20261011/native-concurrency`, branch `codex/a1-native-concurrency-20261011`, frozen base `6085f1f`. Actual finite goal created before inspection or implementation. Root owns integration and fresh independent review. Shared worker/runtime/contracts/configuration remain read-only. The fixed [native affordance specification](native-affordance-specification.md) predates implementation.

```text
/goal Qualify bounded simultaneous native provider requests through the existing Codex and Claude bridges and original host ledger, preserving every request, cancellation and unknown charge; demonstrate actual native child continuation where the pinned tool surface supports it, without claiming best-system or live qualification.
```

## Source-first reproduction and repair

The retained `native-concurrency-evidence/first-failure.txt` outside the checkout records four failing regressions against the original source: grant concurrency two is rejected by `validateObserverGrant`, and both actual worker source files forward only one of two overlapping valid bodies. The worker checks execute their original source with injected process/HTTP/native boundaries; they are deterministic source policy checks, not native execution evidence.

Admission now accepts only the original positive integer host concurrency from one through eight, matching the existing worker RPC pending bound. The immutable worker start and retained invocation carry that exact count and request byte cap. Local body reading occupies a slot before accepting bytes, so retained body buffers are bounded by the original count times the per-body cap. The original host ledger independently controls physical admission, every full-context reservation, settlement, root clock and allowance.

An unknown outcome durably cancels the original allocation, then aborts every active sibling. Already trustworthy completed usage remains exact; outstanding untrustworthy usage remains unknown with its original reservation. Worker refusal terminates native dispatch; duplicate or unknown host replies stop the bridge. No estimator, new allocation, price, protocol, cognition setting or paid Claude permission is introduced.

Pure baseline validation passed 197 checks, zero failures, five explicitly unavailable/opted-out physical checks (`node --test --test-name-pattern='^(?!actual )' evaluations/baselines/*.test.ts`); strict TypeScript passed. A development regression initially assumed SQLite evidence enumeration preserved request order; the observed UUID sorting disproved that assumption. The check now compares outcome counts and exact retained charges, without changing runtime behavior.

## Frozen physical rehearsal plan

The opt-in `native-concurrency-physical.test.ts` supplies public synthetic Responses/Messages streams only. Each run starts an independent explicitly declared original fixture grant: eight requests; concurrency four; 60,000 ms original elapsed ceiling; 10,000 ms per-request ceiling; 1,000,000 bytes each for request, response and CLI output; synthetic cost ceiling 100 USD. Codex retains its declared 200,000 input plus 4,096 output token reservation and total 1,632,768 tokens. Claude retains its full 1,000,000 input plus 4,096 output reservation and total 8,032,768 tokens. These are new fixture experiments, not replacements or increases to any previous grant and not a paid resource grant. Each is frozen and retained before its first dispatch.

Codex uses pinned 0.162.1 CLI SHA-256 `628e35487d888a28f0427fc37501da529dd3d81fcbad7a2c3421c1e8670d92e1` and helper `ec71830690a7c0024916ee0c99fbdc635bc6e747ff665ea4f03a8389bbcb6b30`; Claude uses pinned 2.1.296 SHA-256 `24972e3bc859fab2b46ed4c1e51f7d6130f06d3bd550811a114640de3370d0de`. Claude selects Agent/Bash/Read/Write and pins all model roles to the same original Opus profile, high effort/adaptive thinking and the existing exact beta/version. Its synthetic-only paid guard remains unchanged.

The first parent request must expose the actual native spawn/Agent definition. A synthetic reply invokes two real native children. The two child first requests are held until both physically enter the original host observer. Each receives a native local command call, writes its own artifact, and completes only after the actual tool result appears in its continuation. The parent waits when needed and completes only after both child continuations and artifacts are observed. At most eight requests may enter transport; there is no automatic retry, fallback surface or grant replacement. An unsupported native protocol is retained as an unavailable boundary instead of weakened. The first rehearsal is one attempt per pinned native product, serialized with root, namespace fixture only; kernel native child and model competence claims remain unavailable.

Planned command, after root assigns the physical window:

```sh
AEON_NATIVE_CONCURRENCY_RUN=1 AEON_NATIVE_CONCURRENCY_EVIDENCE=/home/palimpsest/migration/aeon-1-20261011/native-concurrency-evidence /opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 evaluations/baselines/native-concurrency-physical.test.ts
```

Final physical observations, artifact hashes, capability matrix and exact handoff follow after the bounded rehearsal. Full L08, parity, actual development, live entitlement and H1 remain open.
