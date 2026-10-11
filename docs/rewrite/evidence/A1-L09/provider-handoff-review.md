# A1-L02 / A1-L09 provider, origin and H1 review

Date: 2026-10-11. Reviewer: `/root/a1_provider_review`, fresh consequential review context under the lane lead's exclusive path assignment. Base: `401a70cfc0095731fbb1283d550efa1b0de4ff15`. Implementation: `4acf034` on `codex/a1-provider-review-20261011`, worktree `/home/palimpsest/migration/aeon-1-20261011/provider-review`. Requirements RW04, RW10, RW12, RW16, RW17, RW20. Status: **fixture-verified**, with ordinary application regression checks. This report does not accept H1 or establish provider competence.

## Findings and corrections

1. **H1 lacked accepted-release binding.** A correctly signed product-shaped proof could mint a witness for an uninitialized controller, another candidate, a probation candidate, withdrawn authority, or another operational state directory. The witness entrypoint now requires actual host release/authority stores, accepted phase, equal active/accepted candidate and policy identities, current serving authority, and the accepted operational state directory. Admission and persistence run under the authority store's synchronous dispatch transaction. Tests use genuine candidate freezing, signature verification and release-controller transitions. The positive fixture and its synthetic product-shaped case results are explicitly test mechanics, not observations of E1–E5 or parity.
2. **Bootstrap origin escaped human-steering revocation.** The existing Slack namespace correction correctly recognizes `slack:T1` and `slack:T1:U1`, but bootstrap attestations were unconditionally trusted. A bootstrap goal remained an eligible self-change origin after direct or Slack steering. Origin validation now checks bootstrap identity and authenticated originating inputs. It recursively checks the founding initiative lineage, so a descendant created before ancestor steering cannot escape later revocation. Independent mutation preserves the original lineage; it does not create a self-referential attestation. Cycles and missing attestations fail closed.
3. **Pending OpenAI effects replayed before native projection validation.** A hash-valid checkpoint with an inconsistent native function call and projected argument executed the projected effect, then failed only when constructing the next provider request. Recovery now verifies retained native output, projected content and stop reason before pending effects or completion. The reproduction observes the actual bridge dispatch count: one on the base, zero after correction.
4. **Malformed host model profiles passed startup validation.** Missing input/output prices reached arithmetic as `undefined`, producing unusable reservations; nonboolean reasoning and output allowances exceeding the declared context also passed. Configuration now requires both finite prices, a boolean reasoning capability, and a coherent output/context bound. The broker independently requires both prices when constructed outside the configuration loader.

## Provider and prompt review

The [official OpenAI reasoning documentation](https://developers.openai.com/api/docs/guides/reasoning) was fetched on the review date using the OpenAI Docs skill. It documents stateless encrypted reasoning replay, preservation of assistant phase, and billed reasoning even when an output limit yields an incomplete response. The existing adapter retains native encrypted reasoning, message phases, native item IDs and function call IDs; it accounts aggregate output tokens without adding reasoning tokens a second time. Existing fixtures verify incomplete output does not execute complete-looking tools, invalid protocol output fails, missing usage stays unknown, 429 retry reserves separately, and network/5xx failures do not retry.

The actual confined-worker portability fixture runs both explicit providers through repair, uncertain-effect reconciliation, disk restart and compaction. It verifies retained native OpenAI items and tool outputs after compaction, owned system instructions, physical request records and host-derived usage. Provider credentials remain at the host gateway; destinations are pinned and redirects rejected. Mistral remains the default. No model catalog, capability profile, pricing, or account access was inferred from a model name.

OpenAI compaction preserves native assistant/tool history while reducing user history. This is conservative replay continuity, not proof of indefinitely bounded context or a provider-native compaction implementation. Protocol fixtures do not qualify model competence or substitute for paid/live comparative evaluation.

## Reproducible checks

Runtime: `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` (24.13.0). Build closure: real copied `/home/palimpsest/src/palimpsest/node_modules`, no symlink substituted into candidate source. Root source-manifest integration remains with the lead; this change does not edit the vendored AI types.

Frozen reproduction is retained at `/home/palimpsest/migration/aeon-1-20261011/provider-review-before`, detached at the base with only the four updated/new test files. Run:

```sh
node --test deployment/handoff.test.ts deployment/proposal-origin.test.ts deployment/provider-review.test.ts packages/agent-shell/agent-shell.test.ts
```

Observed on the frozen base: **33 tests, 20 pass, 13 fail, zero skipped**. Failures: five H1 cases, two direct/Slack origin cases, five profile cases, one native replay case. Evidence directory: `/home/palimpsest/migration/aeon-1-20261011/integration-evidence/`.

- `provider-review-frozen-base.log`, SHA-256 `89c2d9e9d7c40e573dac72df5d02a0791572929715a27b28e44c302286cd9b2a`.
- `provider-review-reproductions.patch`, SHA-256 `d9c0d4fd458270e95b4a931fb00e4b797118c8c120359f2079b55dafb596f7e7`, applies tests to the base.
- `provider-review-ancestry-before.log` separately preserves the descendant failure after only the initial bootstrap revocation correction; it is an intermediate-state experiment, not the frozen-base run.

Passing implementation checks:

```sh
node --test packages/agent-shell/*.test.ts deployment/provider-review.test.ts deployment/handoff.test.ts deployment/proposal-origin.test.ts deployment/slack-proposal.test.ts deployment/provider-portability.test.ts deployment/provider-gateway.test.ts deployment/broker-shell.test.ts
node --test deployment/evolution-tools.test.ts deployment/evolution-mailbox.test.ts deployment/ordinary-evolution.test.ts deployment/application.test.ts deployment/proposal-origin.test.ts
npm run check
npm run build
```

The first command passes **73 tests**, zero failures/skips (`provider-review-targeted.log`). The second passes **44 tests**, zero failures/skips (`provider-review-integration.log`); the two origin cases overlap the first command. TypeScript check and build exit zero. `git diff --check` is clean. The final origin-test extension was rerun in the 73-case command after the integration run.

No paid provider calls, Slack network calls, production installation, production H1 writes or service authority transfer occurred. The isolated release-controller tests use temporary state and inert launch hooks. Host replacement, installer and full joined-suite review belong to their other owners. Next owner: `/root`, integrate these commits, review the gate/API change, refresh the separately owned source manifest, then run the joined checks. Live qualification, comparator access and the real independently witnessed H1 demonstration remain open.
