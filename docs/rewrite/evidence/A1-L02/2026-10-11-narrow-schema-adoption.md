# A1-L02-T03-a: narrow schema dependency adoption

Status: implemented and fixture-verified; source decision recommended for integration. Owner `/root/a1_schema`, isolated branch `codex/a1-schema-20261011`, worktree `/home/palimpsest/migration/aeon-1-20261011/schema`, base `5306a8cbdebf3aedd793d62b10e99d9c7bfde20c`. Governing requirements RW04, RW05, RW19, RW21; ADR 0032 Q1 dependency boundary. Selected source/check/probe revision: **`15db56c78bf120d75ba7a3100ada27797fdff242`**. C1 contracts are those in that base. Root owns package/lockfile and final integration; fresh review and actual L09 successor acceptance remain open.

```text
/goal Evaluate and adopt a verified smaller source-owned JSON Schema dependency for selected Pi, or record concrete rejection evidence; retain source/license/provenance, actual-tool/schema regressions, strict argument policy, and an edit/check/build/fresh-load proof; commit only owned files and hand off exact integration instructions.
```

Exclusive scope was Pi vendor schema/types/validation, shell tests, new `packages/narrow-schema/**`, ADR 0033 and this evidence. No shell adapter, transport, root manifests, deployment, live model inference, messaging or publication changed. No further agents were spawned. Development uses inherited model/effort; no claim is made about live Autark schema-editing competence.

## Decision and observed closure

Adopt `@cfworker/json-schema` **4.1.1**, upstream tag `@cfworker/json-schema@4.1.1`, commit `5409fdc2bd144f68e8b28c61c71fcb16600000a6`, MIT. Primary inspection: [pinned README](https://github.com/cfworker/cfworker/blob/5409fdc2bd144f68e8b28c61c71fcb16600000a6/packages/json-schema/README.md), [package manifest](https://github.com/cfworker/cfworker/blob/5409fdc2bd144f68e8b28c61c71fcb16600000a6/packages/json-schema/package.json), [source](https://github.com/cfworker/cfworker/tree/5409fdc2bd144f68e8b28c61c71fcb16600000a6/packages/json-schema/src), and [unsupported cases](https://github.com/cfworker/cfworker/blob/5409fdc2bd144f68e8b28c61c71fcb16600000a6/packages/json-schema/test/unsupported.ts). Inspected current official sources via browsing, then pinned the exact tagged checkout. No runtime dependency is declared upstream; inspection and local import traversal confirm no external runtime import.

The retained runtime/type source is **8 files, 1,721 physical lines, 53,808 bytes**, measured after all local patches. This replaces TypeBox's observed 691-file / 47,785-line / 2,357,452-byte Compile/Convert closure. It removes 96.4% of that validator source line count; no claim is made about total application size or algorithm throughput. Retained fixture/API tests and provenance artifacts add maintained scope separately: fourteen unchanged official JSON fixture files (373 assertions), a 94-group conformance/API runner, six actual-tool regression cases, notices/manifests, upstream exceptions/API originals, audit/probe scripts and the complete local patch. The source commit contains 5,784 inserted lines in all, including fixtures and provenance, and removes 452 Pi/glue lines. It does not hide the test/audit surface behind the engine count.

Pi's model-schema builders were unconsumed runtime configuration: selected `ai/types.ts` imports only their types. Replace them with explicit protocol types rather than a custom schema-building/inference library. Tool schema generics accept ordinary schema objects. The host executes validated objects without reconstructing TypeBox static type inference.

The fork patch is narrowly bounded: native Node TypeScript extensions/type imports; an unused enum expressed as a constant object; constructor field declarations instead of parameter properties; and a JSON-correctness fix using own properties instead of JavaScript prototype membership. Without own-property checks, empty JSON objects could satisfy `required: ['constructor']`; regression cases include `constructor`, `toString`, and `__proto__`. `local.patch` preserves the full upstream delta, and `source-manifest.json` preserves both original and retained SHA256 hashes.

Formats are asserted by this upstream engine and some internationalized format and dynamic-reference cases remain unsupported. Current tool definitions use neither formats nor dynamic/remote references. Relevant official keyword tests ran with zero skips; this is not a claim of complete Draft 2020-12 conformance. New tool vocabulary outside the qualified surface requires explicit qualification. Referencing a schema never triggers a network fetch.

## Intentional argument-policy change

Strict Draft 2020-12 validation replaces coercion and optional-null normalization. The existing canonical JSON contract first rejects undefined, non-finite numbers, class instances and cycles. Validator dereferencing gets a private schema clone; argument output is a clone, and emitted tool definitions stay unchanged. All nested errors retain JSON pointer locations. No raw received-argument dump is appended to validation errors.

[Observed before/after policy results](2026-10-11-schema-policy-comparison.json) compare the base Pi glue with TypeBox 1.3.27 to the selected implementation:

| Argument | Prior outcome | Adopted outcome |
| --- | --- | --- |
| required integer `1` | accepted unchanged | accepted unchanged |
| optional non-nullable integer `null` | removed, accepted | rejected |
| required integer `"10"` | converted to `10`, accepted | rejected |
| required integer `null` | converted to `0`, accepted | rejected |
| required integer `true` | converted to `1`, accepted | rejected |
| explicitly nullable value `null` | accepted unchanged | accepted unchanged |
| undeclared extra field | rejected | rejected |

This is an authorized design change, not an accidental compatibility regression. The model receives a validation-error observation and can submit a corrected call; no tool effect dispatch occurs for rejected arguments. No bespoke validator or primitive-coercion engine replaces upstream validation.

The six host regression cases use all **twelve actual tool schemas** from `packages/tools/index.ts`: all ordinary complete arguments, nested delegation/resources/inputs/scope/provenance, required and unknown fields, const/enum unions, pattern and uniqueItems constraints, number bounds/integer types, optional-null rejection, explicit-null preservation, nested arrays/local references, useful error locations, clone stability and non-JSON rejection. Existing shell tests retain the effect-preflight behavior.

## Commands and outcomes

All commands used pinned Node `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` v24.13.0 with its directory prepended to PATH. Root package/lockfile was left unchanged; `npm ci --ignore-scripts --no-audit --no-fund` provisioned the already-pinned TypeScript 7.0.2 and Node definitions 24.19.1 (and interim TypeBox for other untouched callers/baseline comparison). Source adoption itself needs no npm runtime library.

| Command | Observed result |
| --- | --- |
| `npm run check` | pass under strict, erasable, verbatim-module checks |
| `node --test packages/agent-shell/*.test.ts packages/narrow-schema/schema.test.ts` | **122/122 pass**, zero skips: existing shell 22; host schema 6; conformance/API 94 groups with 373 official assertions |
| `node packages/narrow-schema/audit-source.mjs /tmp/a1-schema-cfworker-411` | pass: every upstream/retained source and fixture hash, closed internal imports; [audit result](2026-10-11-narrow-schema-source-audit.json) |
| `node packages/narrow-schema/qualify-source.mjs docs/rewrite/evidence/A1-L02/2026-10-11-narrow-schema-source-probe.json` | pass: baseline true, edited false, restored true loaded in three fresh compiled-code processes; [probe](2026-10-11-narrow-schema-source-probe.json) |
| `npm run verify` | check passed; full test run **246/247 pass**, one unrelated communications failure; build step not reached in that combined run |
| `node --test --test-name-pattern='Socket Mode rejects foreign' packages/communications/test/communications.test.ts` | same `assert(rejections > 0)` failure in candidate **and clean unchanged base `5306a8c`** |

The full-suite failure is at `packages/communications/test/communications.test.ts:157`, in `Socket Mode rejects foreign token identity and does not ACK malformed event intake`. Communication source is unchanged. This evidence does not classify the cause as only a flake: the isolated failure repeated and also reproduced in a fresh detached base worktree. L07/root owns its correction; schema-focused acceptance remains passing. Full-root verification is not represented as passed.

Probe timings: clean emitted tree build **721 ms**, warm **734 ms**, edited **718 ms**, restored **721 ms**; original check **826 ms**, edited check **683 ms**. Edited source regressions passed in **387 ms**. These are one host observation, not a statistically controlled speed benchmark. The probe changes `Validator.validate` for a unique marker, proves changed behavior in freshly loaded `dist/packages/narrow-schema/index.js`, restores the exact original SHA256 and rebuilds, then proves original behavior. No network catalogue refresh or model request occurs during check/build. It proves local dependency loading, **not** supervised production successor activation or canonical-state continuity.

## Root integration and next owner

Cherry-pick the source commit and this evidence commit. The lead must:

1. Convert the remaining TypeBox-based tests in `deployment/broker-shell.test.ts`, `packages/runtime/test/crash-worker.ts`, `packages/runtime/test/shell-joined.test.ts`, and `packages/initiative/test/initiative.test.ts` to plain data-only JSON schemas. Their owners were notified; these files were outside this child's write scope.
2. Remove `dependencies.typebox` from root `package.json` and regenerate the root lockfile; no replacement npm dependency or workspace package registration is needed. Existing `packages/**/*.ts` check/build coverage already includes the new source.
3. Update root-owned `experiments/agent-shell/audit/source-manifest.json`: `runtimeDependencies: {}`, add the local narrow-schema source-manifest reference, and record the Pi model-type-only/schema-generic/strict-validation patch rationale. Preserve historical TypeBox reassessment artifacts as unadopted history.
4. Update the root-owned original `experiments/agent-shell/qualify-source.ts` runtime-dependency report/limits, which currently hardcode TypeBox. The new package probe independently covers the adopted schema dependency.
5. Run `rg -n 'from ["\x27]typebox' packages deployment experiments -g '*.ts'`, root check/test/build, the new audit and probe, and fresh review. Track the unchanged-base communications failure until its owner resolves it; retain the first failure evidence.

[ADR 0033](../../../adr/0033-source-owned-json-schema-validation.md) is the requested ADR 0032 dependency addendum. Recommended disposition: **adopt the narrow source-owned validator and strict policy**, subject to lead integration/review. A1-L02 Q1's schema-source portion is evidenced; its complete toolchain/production successor and other Q2–Q5/product gates are not closed by this finite child task. No Rig fallback is justified by this dependency comparison.
