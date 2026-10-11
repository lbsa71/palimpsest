# Independent tool instruction retention review

2026-10-11. A1-L02/RW04 bounded consequential review by `/root/a1_tool_instruction_review`, in fresh context. The finite goal was created without a budget: independently review/fix exact tool-instruction artifact retention and return a source-bound disposition. Root assigned exclusive writes to this report and `deployment/tool-instruction-review.test.ts`; implementation repairs were permitted only for reproduced defects. No implementation repair was necessary.

Reviewed implementation: `fd9af7f9acbad2fe0afd97a77761a81a6497ac60`; author evidence/acquisition documentation: `2a4d0ab6095d28496b1ede327e16031454e832a7`. Review branch `review/a1-l02-tool-instruction-20261011`, isolated worktree `/home/palimpsest/migration/aeon-1-20261011/tool-instruction-review`, based on `2a4d0ab`. Independent regression source: `014467bc53e50be22b7045f11930977d840fbb4a`. C1, storage, resource, native-baseline and lifecycle implementations are unchanged. Root owns central coordination/integration.

## Disposition

Accept the bounded implementation against the [fixed specification](tool-instruction-retention-specification.md). No actionable production defect was reproduced. This is engineering instruction-retention evidence, not live competence, Q3, parity, developmental qualification, full L02 acceptance, H1 or deployment.

The source review confirms:

- `ShellOptions.toolInstructions` is required. Ordinary and compaction requests require matching retained artifact URI, digest and exact resolved bytes before capture or reservation. No old `shell:tools` fallback is introduced.
- Application retention uses its original operational store. The broker clones the worker configuration before the first asynchronous resolution, retains exact `JSON.stringify(tools)` and compaction `[]`, and resolves both before starting the worker. The shell repeats exact-byte checks before each request.
- Host capture compares the complete expected fragment descriptor, including artifact, scope and derivation, then checks owned base/compaction instructions and provider tool projection. Reservation purpose must match the captured instruction surface. Borrowed/forged artifacts cannot supply authority.
- Existing provider payload allowlists, owned prompt checks, Mistral served-model/tier restrictions, reservation ceilings, trusted settlement and replay refusal remain intact. Consumer adaptations supply retention fixtures; their existing behavioral assertions were not removed. Storage and contracts were not changed.
- Plain, resumed, delegated and compaction coverage has separate witnesses. The author’s changed-source/resume/child pure case passes independently. The physical source/first-log audit covers real application parent/child and resumed paths; it is not inferred from plain-request coverage. Acquisition prose still declares missing historical bytes unavailable and does not fabricate a new artifact alias.

## Independent checks and preserved failures

Node `24.13.0`, `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin` prepended to PATH. Existing `/home/palimpsest/src/palimpsest/node_modules` was symlinked; nothing was installed. The focused command was:

```sh
node --experimental-test-module-mocks --test \
  deployment/tool-instruction-review.test.ts \
  deployment/tool-instruction-retention.test.ts \
  packages/agent-shell/agent-shell.test.ts \
  packages/agent-shell/openai.test.ts \
  deployment/mistral-profile-binding.test.ts \
  deployment/mistral-profile-review.test.ts
```

Observed: **67/67 pass, zero failures/skips**, 1.375 s. This includes 14 new independent cases, eight author retention cases, 35 existing shell/Mistral boundary cases and ten OpenAI transport cases. `npm run check` and `git diff --check` passed. These runs mocked the worker entrypoint and synthetic transport; no confined-worker window was consumed.

The new cases exercise both providers while nested tool configuration and compaction instructions mutate during asynchronous resolution; the captured original sources and effective provider projections remain correct after reopen. They reject canonical reconstruction, unavailable retention, restricted base instructions in a public run, forged tool scope/derivation/URI, altered provider tool descriptions, compaction captured then reserved as reasoning, absent ordinary/compaction descriptors, and direct-shell legacy URI or altered-byte fallback attempts. Refusals assert zero reservation/dispatch/fetch; pre-worker refusals also assert zero worker entry/capture.

External review evidence directory: `/home/palimpsest/migration/aeon-1-20261011/tool-instruction-review-evidence/`.

- `review-first.log`: 8/10 pass, two fixture failures. The review’s mock called checkpoint persistence directly, bypassing broker receipt tracking; the broker correctly rejected the returned checkpoint. Corrected the mock to use the broker RPC. No product code or acceptance assertion was relaxed. The initial strict-check error was a test typing error accessing `properties` through `object`; corrected the fixture’s typed nested mutation.
- `review-final.log`: corrected initial ten cases pass. Four direct-shell no-fallback cases were then added.
- `regression-final.log`: final 67-case result above, SHA-256 `5f3725188745af0d140361df29fe022afaca70f5799f1ce6e12b983922b7299e`.
- `audit.mjs`, `artifact-audit.log` and original fixture `state.sqlite` files: retained public synthetic artifact audit, described below. Audit log SHA-256 `572e42efa49af3b18c6c6ca52cafb4e150ade8b67c471a726b6729209adaa096`.

## Original artifact audit and physical evidence limits

After the final test process exited, a separate process opened all 14 final review-fixture databases using SQLite `readOnly: true`. Five accepted captures were found: four public captures (ordinary and compaction for Mistral and OpenAI) and one restricted compaction capture whose subsequent wrong-purpose reservation was refused. Every original manifest URI and SHA-256 matched the stored bytes, and parsing those bytes yielded the exact provider tool projection. The ordinary source is 153 UTF-8 bytes, digest `ab46baedfedd76301863e16d82dd1185b54098d409354886ffd2583d127a05a2`; compaction is the two bytes `[]`, digest `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`. Public sources remain directly retrievable from the retained original stores named in `artifact-audit.log`. No later configuration or canonical reconstruction supplied these bytes.

Read-only audit of the author’s first outputs at `/home/palimpsest/migration/aeon-1-20261011/tool-instruction-retention-evidence/` found broker 9/9 (1.385 s), portability 3/3 (1.662 s), and selected application 3/3 (2.778 s), all zero skips/failures. The inspected implementation source is unchanged from the author’s frozen `fd9af7f9` for these runs. The logs are author-retained execution records; the reviewer did not launch those physical cases again.

The relevant physical source assertions read original store artifacts and verify reopen: four ordinary application manifests; seven actual delegation manifests with distinct parent and child source digests; two graceful-resume manifests retaining the same source; and real broker compaction `[]` followed by nonempty ordinary tools. Existing provider portability cases retain their original restart/compaction/accounting assertions. These physical fixtures delete their temporary stores in `finally`, so no surviving physical database was available for an independent post-run byte audit. The retained independent database audit above is a pure host/shell witness and does not erase that limitation. The other application cases were outside the author’s selected window.

No paid inference, provider/account/key inspection, external provider network, messages, services, dependency installs, deadline changes or grant changes occurred. Native-baseline and remaining lifecycle/product-screen qualification stay with their separate owners. Root may integrate the review commits and this bounded disposition; broader qualification remains open.
