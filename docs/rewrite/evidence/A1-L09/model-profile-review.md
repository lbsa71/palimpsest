# A1-L09 model profile grant review

Status: finite review complete; **fixture-verified**, not provider competence qualification or deployment acceptance. Owner `/root/a1_profile_review`; branch `codex/a1-profile-review-20261011`; worktree `/home/palimpsest/migration/aeon-1-20261011/profile-review`. Review base `5cb6a55`, author change `ee8b86ff18f4463b5b51bbb354512ce4feb192bf`. Code/test handoff: `70f53471206b7bda41534d91334888483a66d3fc`.

## Goal, ownership and contract

`/goal Review A1-L09 host-authorized model profiles at 5cb6a55, reproduce and fix concrete defects within the assigned module/config/service scope, and commit bounded verification evidence with an exact handoff.` This goal was created through the goal tool. It is a fresh-context review supporting A1-L09-T04/T05 and RW14/RW16/RW17/RW19, not the complete lane goal.

The lead reserved `deployment/model-grants.ts`, its test, configuration validation and service-process validation for this review. CLI/installation/supervisor fixes remain with `/root`; evolution mailbox/tools/application fixes remain with `/root/a1_evaluation_dispatch`. Those paths were inspected but not edited. Model/effort routing requested by the lead: `gpt-6-astra` / high. This is the independent review task in the lead's parallel decomposition; no additional subtask warranted further delegation.

The reviewed contract permits the current profile by default plus up to 32 complete host grants. Provider/model/reasoning/effort/prices must match one complete grant; context, output, request-count and timeout bounds may narrow. Host permission is distinct from measured competence. No model-authored ID list or invented prices confer permission, and no legacy ID compatibility is required.

## Finding and repair

The metadata validator coerced its policy digest through `RegExp.test`. A parsed JSON value `{ "policyDigest": ["<64 lowercase hex characters>"], "allowedModelProfiles": [] }` passed despite lacking a string policy identity. The reproduction printed `accepted policyDigest type: object array: true` at the base. This was a schema defect that could carry an unusable identity into later policy binding; the review did not establish an authority escalation.

The validator now requires a non-array object and a string digest before matching its hexadecimal shape. The new regression initially failed with `Missing expected exception` (4 passed, 1 failed); after repair it passes. No price/provider selection defect was reproduced, so that implementation was retained.

## Independent checks and inspected wiring

New checks establish that independent grants cannot be combined to synthesize larger bounds, all four ceilings reject widening, a provider change cannot inherit the previous provider's prices, omitted provider means Mistral rather than the granted OpenAI transport, reasoning changes require their own grant, returned selections cannot mutate host prices, and the current profile remains selectable alongside 32 additional profiles. Metadata tests reject old ID-only fields, ID-only entries, duplicate grants, incomplete prices and the coerced policy identity.

The read-only wiring review traced supervisor-file and installer validation through supervisor bootstrap/recovery, service-process IPC, service-child validation, ordinary evolution tool construction, `model_profiles`, and candidate-settings selection. Candidate configuration retains other host/resource grants. The manifest binds the selected model and configuration, materialization checks that binding, and application construction sends provider/model/request settings and configured prices to the broker. The broker binds reservations to that provider/model and calculates reservation and observed costs from host-configured prices. No further concrete defect was found in this bounded inspection.

Fresh commands ran in the review worktree with Node `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` (24.13.0):

| Command | Observed result |
| --- | --- |
| `node --test deployment/model-grants.test.ts` before the validator repair | 4 passed, 1 failed; retained reproduction above |
| `node --test deployment/model-grants.test.ts deployment/provider-review.test.ts` after repair | 10 passed, 0 failed/skipped; approximately 0.33 seconds |
| `PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH npm run check` | Passed |
| `PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH npm run build` | Passed |
| `git diff --check` | Passed before code commit |

The worktree uses a symlink to the integration checkout's existing `node_modules`; no dependency or lockfile changed. Generated build output is ignored.

Separate, prior evidence: the lead reported 16/16 targeted tests at the author integration, including a real frozen candidate switch of provider/prices, plus strict check/build (approximately 55 seconds). This review did **not** rerun or independently observe that copy-heavy fixture. The lead explicitly retained the heavy-test window for its temporary installed-system composition test and will run joined verification after integration.

## Handoff and limits

Integrate code/test commit `70f53471206b7bda41534d91334888483a66d3fc` and this evidence commit. The lead owns the joined aggregate and any fresh installed-path review as a separate finite goal. No changes are needed from the evolution-tools owner on the evidence found here.

No paid provider calls, external Slack messages, production changes, push, installation or service activation occurred in this review. Fake model identifiers/prices exercise the permission and accounting contract; they establish neither real model availability/pricing nor reasoning competence. Installed metadata transport and full evolution remain covered only by prior lead fixture evidence and read-only inspection in this review, not a new live or installed qualification claim. H1 and full lane acceptance remain open.
