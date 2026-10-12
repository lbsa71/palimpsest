# DI06 / DI06a schema interface release

2026-10-12. Root releases the mutually consumed schema API under DI01 and the adopted DI plan before either component source changes. This document is an interface decision, not behavioral acceptance.

```text
/goal Freeze the smallest schema base-URI composition boundary shared by shell DI06 and retained-schema DI06a, with exact consumer and validation obligations that allow independent implementation and a later reviewed join.
```

Retain `new Validator(schema, draft?, shortCircuit?)` as the Node production composition with the existing constant base `https://github.com/cfworker`. DI06a may add an optional fourth **string** base URI, captured and validated per instance. It may retain dereference's existing explicit third URL argument, detached before use, but its default must be a newly constructed URL from an immutable constant string. No exported mutable default URL or import-time browser `self.location`/`location` read remains. A supplied URI is schema resolution data, never a network capability; no fetch/resolver is added. `Validator.addSchema` must use that instance's base. Any private metadata used by dereferencing must belong to the instance, so two validators using the same caller schema and different bases cannot contaminate one another. Existing recursive resolution and genuine schema assertions remain unchanged.

DI06's actual retained consumer is `packages/agent-shell/vendor/pi/ai/utils/validation.ts`, which currently invokes three constructor arguments on a cloned schema. That call remains the explicitly chosen constant Node composition; DI06 needs no source edit in that file merely to consume DI06a. Its transport/loop clock/ID/timer changes are independent. Direct `validate` users can supply the existing explicit lookup produced by `dereference`; no new environmental lookup is hidden in recursive validation. No C1/runtime message schema changes.

DI06a owner writes only the three retained files named in its task, optional new `packages/narrow-schema/environment.ts`, its new tests/evidence. DI26 owns the later exact local.patch/source-manifest/source-closure update. Before final source acceptance, root imports exact DI06/DI06a revisions, updates truthful retained-source metadata under previously accepted controls, and obtains a fresh joined review. Source author checks must report metadata changes as pending; neither fixtures nor this interface release qualify that closure. Whole DI28 and H1 remain open.
