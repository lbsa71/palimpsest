# Reusable procedures (P07)

Status: registry and isolated execution implemented. This implements R08's distinction between publishing tested code and executing an identical approved version. It depends on the Node seed decision, P05 process isolation, and a caller-owned trusted publication authority. Full candidate-release policy remains P09–P14.

## Specification

A procedure is an immutable Node module with a versioned manifest, input/output JSON contracts, explicit permissions, examples, and executable fixture cases. The module reads one JSON value from stdin and writes one JSON value to stdout. It runs without inference, inherited credentials, or network access in a disposable scratch directory. The registry lives in the external state directory, separate from repository source and cognitive memory.

Acceptance criteria:

- Canonical source/manifest identity is stable across object-key ordering and changes when either source or contract changes.
- Scratch execution checks input before launch, bounds time/output, and checks output after exit. Unknown schema features and permissions fail closed.
- Publication runs declared fixture cases, then asks a trusted injected authorization callback for approval bound to that exact identity and independent evidence references. Model output is never an approval argument.
- Published versions survive registry reopening and can be reused without generation, inference, or repeated identical publication review. An existing name/version cannot be replaced with different bytes.
- Mutation, missing approval, revoked publication, wrong input, wrong output, permission mismatch, timeout, and unapproved execution fail explicitly.
- A generic CSV-summary example correctly handles quoted commas, doubled quotes, and quoted newlines; fixture outputs are independently asserted.

Non-goals: selecting a procedure with a model, production publication authority, network-capable procedures, arbitrary binaries, package installation, or making candidate-supplied tests authoritative. Manifest cases are regression evidence; the trusted callback must rely on independently gathered checks. Material risks: Node and the host sandbox remain part of the trusted substrate; schemas validate shape rather than semantics; procedure code can fail or consume its configured budget; publication access is a host authority.

## API contract

The `ProcedureRegistry` constructor accepts `{ storeDir, authorizePublication }`. The caller supplies the trusted callback; candidates cannot supply a different callback, approval file, or raw verdict through the procedure API. `publish({manifest,source})`, `execute(digest,input,{permissions,signal?})`, `executeScratch({manifest,source},input,{permissions,signal?})`, `list()`, and `revoke(digest,reason)` provide distinct publication, execution, discovery, and withdrawal operations. `procedureDigest(definition)` and `validateJson(schema,value)` are exported alongside `CSV_SUMMARY_PROCEDURE` and the types.

`authorizePublication(digest,manifest,source)` returns `{ approved, digest, evidence }`. Publication requires `approved: true`, the exact digest, and nonempty evidence references. The callback receives copies of the frozen contract/source and must assess them using independently gathered checks; evidence-reference presence alone is not evidence quality. Published records are stored under `storeDir/procedures`, with an exclusive version claim preventing replacement of an existing name/version. Source/manifest hash verification precedes every reuse. The external registry is trusted host state, not a candidate-writable directory or an import surface for arbitrary approval JSON.

The schema subset supports `type`, object `properties`, `required`, `additionalProperties`, and array `items`. Types are object, array, string, finite number, safe integer, boolean, and null. No `$ref`, coercion, defaults, pattern, union, or ignored keywords are supported. Object contracts must state `additionalProperties` explicitly. Unknown fields in a manifest or schema are rejected. Limits apply to nesting, serialized input, source size, execution time, and output.

Supported permissions are empty or `scratch-write`. The latter permits writes to the procedure working directory and must appear in both the published manifest and the trusted execution grant. The isolator also provides a private disposable runtime temporary directory. Neither permission grants network, host data, credentials, subprocesses, or external writes. Revocation prevents later reuse and retains the artifact/evidence for inspection; it does not cancel an already-running invocation. Registry files are not a safe place for live user input; only source, contracts, synthetic fixture examples, and publication metadata are persisted.

## Verification boundary

Tests use fresh external temporary stores and synthetic inputs. On 2026-10-08, `node --test test/procedures.test.ts` passed six checks, and `npm run check` passed. The suite exercised real isolated Node file execution, before/after publication behavior, reopening and repeated reuse, rejected/stale approvals, failing fixtures, version collision, tampering, revocation, input/output validation, scratch write permission, output overflow, cancellation, timeout, and independent quoted CSV examples. The initial missing-implementation run failed; integration then exposed a missing ancestor-metadata sandbox grant, which was repaired by the isolation work item before these checks passed.

Actual isolated execution depends on the host sandbox being available; an unavailable sandbox rejects execution rather than running unsandboxed. These checks do not establish A09's end-to-end procedure discovery or P09–P14 trusted release admission.
