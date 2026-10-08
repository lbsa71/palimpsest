# First model-authored source release

On 2026-10-08, the local Palimpsest process admitted and ran a Mistral-authored source change through protected checks, fresh review, the succession protocol, cutover and probation. The exact admitted bytes were published in Git commit **`5044b57`**, authored as `Palimpsest <palimpsest@localhost>`, and pushed to `codex/seed-implementation`.

The operator selected the investigation, supplied repository context, clarified the contract after failures, and published the admitted artifact. Mistral authored the replacement source. This was an operator-initiated demonstration of the local evolution machinery, not a claim that the model independently discovered the issue or controlled Git publication.

## Behavior and evidence

`conversationRequest` previously selected the last twelve supplied memories before considering conversation identity. Normal runtime retrieval already scoped its inputs, but the cognitive entrypoint itself failed an independent mixed-conversation challenge. The admitted code first selects memories whose `scope` matches the task's `conversationId`, then selects the latest twelve eligible memories. Other conversations' later records can no longer enter the prompt or crowd out eligible experience.

The request, all four eligible memory categories, provenance, confidence, 4,000-character content bound, system instructions and 2,048-token output bound remain intact. This is an executable behavior change, not a version-string or prompt-only swap.

| Attempt | Reserved calls | Actual result |
|---|---:|---|
| `local-seed-2026-10-08` | 1 | Compiled and passed the normal contract; rejected by the scope challenge after confusing foreign scope with growth-record kinds. |
| `local-seed-2026-10-08-r2` | 1 | Received actual imported types and failed-check feedback, but repeated the wrong assumption with additional source-category filters. Rejected before cognitive review. |
| `local-seed-2026-10-08-r3` | 6 | Clarified conversation semantics; model source passed all three checks, fresh review, four succession messages, cutover and probation. Became known-good. |

Eight calls were reserved across the three attempts. The successful attempt used one growth call, one fresh review call and four interview-stage calls; its explicit ceiling was nine. All used the configured `mistral-large-2512` through Mistral. No provider substitution occurred. Unknown monetary cost is not reported as zero.

- Frozen Git base: `97c205dc79aea92167dcf32734f5d65f1a9f48a8`.
- Admitted candidate manifest: `2dd97cf3438a0e9e3197a9bd373882b553ed211019005584ed0dde8d7f651f91`.
- Independent evidence: `28e269742349ac2e4c87c19bb6f0618b5c868fc70a36c6173eb2b1a55efd25de`.
- Protected gates: `typecheck`, `trusted-agent-contract`, `cross-scope-memory`, all passed; the incumbent failed the added scope challenge.
- Authorship: recorded completed-growth proposal digest and bytes matched the frozen artifact; protected files matched the Git base. Publication copied the source unchanged.
- Independent inspection: four additional isolated cases confirmed scope separation, last-twelve ordering, all memory categories/provenance, empty/foreign/missing-scope handling and unchanged input data. They did not alter admission evidence.
- Final repository verification: **194 tests passed**, with **one unsupported-platform branch skipped**; TypeScript validation passed. The real macOS isolation tests ran.
- Restarted admitted release: a real direct task succeeded with one Mistral call, 281 input / 8 output tokens. It returned the requested acknowledgement and recorded its episode externally.

Raw prompts, completions, rejected proposals, interview transcript, release snapshots and journals remain in external local state. The successful record is `integration/local-seed-2026-10-08-r3.json` beneath the configured data directory. This report contains sanitized metadata only.

## Limits of the demonstration

The live protocol obtained exact candidate/evidence/snapshot bindings, incumbent acceptance and separate successor readiness. Its cognitive quality remains limited: the incumbent's question field was largely an assessment, and the successor raised no new challenge. This run proves the live protocol and targeted source improvement; it does not close the full meaningful-interview/disagreement criteria in A12. Stage-specific questioning and evidence-calibrated judgment remain P11 follow-ups.

The combined startup-failure/crash/hang recovery scenarios have actual process tests with deterministic cognitive fixtures. This successful live model run did not inject a simultaneous successor/observer/provider failure. Qualitative memory consolidation retains its separately recorded overgeneralization failure. Live Slack connectivity still awaits credentials. These gaps remain visible in [PLAN.md](../PLAN.md) and the [acceptance map](seed-validation.md); no full seed acceptance is claimed.
