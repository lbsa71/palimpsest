# Source-owned JSON Schema validation

A1-L02 uses the eight-module runtime/type closure of `@cfworker/json-schema` 4.1.1, MIT, upstream commit `5409fdc2bd144f68e8b28c61c71fcb16600000a6`. The source manifest records upstream and retained hashes; `vendor/cfworker/local.patch` records every local change. No npm runtime dependency, eval/code generation, remote reference fetching, or upstream build system is required. The barrel exports only the validator and protocol types.

Pi's host supplies immutable data-only JSON Schema definitions. The bridge validates Draft 2020-12 and reports every nested error. It clones schema definitions before upstream dereferencing can annotate them and clones arguments after the existing JSON contract rejects non-JSON values. Arguments are never coerced, filled with defaults, or stripped of optional nulls. A tool accepting null declares that explicitly. Wrong arguments become tool error observations and may be repaired by the model before any external dispatch.

The retained engine has upstream limitations: format is asserted rather than solely annotated; internationalized formats and parts of `$dynamicRef` are unsupported. The exact upstream exceptions are retained as `upstream-unsupported.ts.txt`. Current host schemas use no format, dynamic references or remote references. Do not claim universal Draft 2020-12 compliance from the selected tests; additions using unsupported vocabulary require qualification or a dependency change.

Local semantic patch: JSON property presence uses `Object.hasOwn`, and instance-property loops use `Object.keys`. JavaScript prototype members cannot satisfy `required`/dependencies or invent properties. Regression tests cover `constructor`, `toString`, and `__proto__`. Other changes only adapt imports and non-erasable syntax to pinned native Node TypeScript: type-only imports, `.ts` extensions, explicit constructor fields, and an unused enum represented as constants.

## Edit and check

Use Node 24.13.0 and the root lockfile's pinned compiler and definitions. From the repository root:

```sh
npm ci --ignore-scripts
npm run verify
node packages/narrow-schema/audit-source.mjs
node packages/narrow-schema/qualify-source.mjs /tmp/schema-source-probe.json
```

The audit verifies retained-source hashes, fixture hashes and the complete internal import closure. An optional absolute upstream checkout path also verifies original hashes. The qualification command changes `Validator.validate`, checks and builds it, loads the changed compiled validator in a fresh Node process, then restores source and rebuilds. It records cold/warm/edited timings and verifies restored loading. This is mechanical load evidence; the supervised release/successor workflow is owned by L09.

Ordinary dependency changes edit these source files directly, add behavioral cases, run `npm run verify`, update the source manifest and patch, then follow the same immutable-candidate/successor workflow as host changes. No registry publication or installed-package editing is part of that path.

## Audit and update provenance

An upstream checkout is needed only when comparing or updating the fork, not during normal builds:

```sh
git clone --depth 1 --branch '@cfworker/json-schema@4.1.1' https://github.com/cfworker/cfworker.git /tmp/cfworker-source
node packages/narrow-schema/audit-source.mjs /tmp/cfworker-source
```

For an upgrade, select and record an exact upstream commit, compare its eight files against the manifest, retain the MIT notice and upstream exceptions/API tests, and review each algorithm change. Copy only those retained modules, reapply or deliberately retire the local patch, record upstream/retained SHA256 hashes and the full patch, and run the conformance/actual-tool regressions plus the edit/build/fresh-load probe. Compiler/build/catalogue tools from the upstream monorepo do not enter the selected closure.

The fourteen retained JSON-Schema-Test-Suite files are unchanged MIT fixtures from commit `76b529ff69fa6f284d3e8916cb82cb2e93f82557`, pinned by the selected upstream release. Their manifest records hashes and source paths. They provide 373 assertions for actual host keywords without importing upstream Mocha, Chai, Worker, or bundler tooling. Original cfworker Validator API cases run with Node's test runner; their original text remains available for comparison.
