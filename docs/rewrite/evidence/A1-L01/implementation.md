# A1-L01 implementation evidence

Owner: Codex `/root/a1_contracts`. Branch `codex/a1-contracts-20261011`; base `14c742041270bb2acb15b4903a970394a140493c`. Finite tool goal: implement and commit minimal contracts, conformance fixtures, scope ledger and C1 draft; record consumer acceptance status. User implementation authorization supersedes the prior planning-only sentence. No historical code retained, no runtime dependencies added, root build files untouched.

T01 scope and fresh-design ledger implemented in `docs/rewrite/contracts/scope.md`. T02 execution/recovery schemas and reducers implemented. T03 development/scoping/obligation contracts implemented. T04 control/prompt/accounting/evaluation/release contracts implemented. T05 executable fixtures and draft C1 implemented; full consumer agreement and independent review remain open. Available slots were occupied by parallel shell/evaluation/integration owners; this lane authored its own bounded modules and coordinated interfaces with those owners rather than spawning conflicting writers.

Observed on 2026-10-11:

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test packages/contracts/conformance/*.test.ts
```

17 passed; 0 failed, skipped, cancelled or todo. Cases cover lossy JSON, duplicate/revised inputs, uncertain effect reconciliation across authority transfer, stale dispatch, cancellation, checkpoint identity, privacy/provenance, obligations, goal evidence, human-modification eligibility, prompt replacement/payload drift, physical request accounting, candidate mutation and independent prior-control evidence. No provider/network fixtures were dispatched.

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node /home/palimpsest/src/palimpsest/node_modules/typescript/bin/tsc --ignoreConfig --noEmit --target ES2024 --module NodeNext --moduleResolution NodeNext --strict --erasableSyntaxOnly --allowImportingTsExtensions --verbatimModuleSyntax --skipLibCheck --types node --typeRoots /home/palimpsest/src/palimpsest/node_modules/@types packages/contracts/index.ts packages/contracts/conformance/contracts.test.ts
```

Exit 0, no diagnostics. Uses already installed development tooling for validation only. Node 24 native stripping executes source directly; no emitted artifacts or linked node_modules added to this lane.

Limitations: typed validators are not general untrusted decoders; authenticated admission, required evaluation workload, durable compare-and-swap, scope authentication, cancellation propagation, receipts and receiver fencing belong to consumers. No full C1, integration, live competence, autonomous use, H1 or deployment claim. L09 should integrate this exact revision, route L03–L07 acknowledgement, and obtain fresh review; L01 remains owner of requested contract adaptations.

L02 acknowledged its strict adapter compilation against the final C1 ShellBridge shape. Checkpoint content hashing is canonical `identity(content)`; observation ID projections must agree. First handoff: `f11a25bfc6583d9e20af629e2a0a46f776ebb15e`. The follow-up also adds a data-only bounded `DelegationTask` descriptor for L06.
