# A1-L08-OD2-a source projection

2026-10-12. Owner `/root/a1_development_observer`, branch `codex/a1-development-observer-20261012`, base `5bc15dc5fc946bc78398617ebffdb3a79a7857e0`, root claim `462d6de`. Exclusive writes: this evidence and new `evaluations/development/development-observer.ts` / `.test.ts`. Actual finite tool goal created before source investigation. Requirements RW09, RW10, RW18–RW20; governing ordinary-driver specification and accepted JR1 v2. Recorder `53e8298` is a read-only source-shape reference. No sibling source imports, configuration changes or source-resolution overlays.

```text
/goal Deliver the smallest bounded source projector reproducing new ordinary scheduler and registered assignment provenance from retained v2 captures, preserve unavailable causal sources, run focused offline checks and strict compilation, and hand off exact source/interface with recorder integration and qualification gates open.
```

## Pre-code API and acceptance freeze

Reuse existing `DevelopmentSnapshot`, `JournalRef`, `StoredEvent`, contracts and scheduler/communications wire. No scheduler, signing service, workflow framework or authority layer is added. Public synchronous function:

```ts
projectDevelopmentSources(input: DevelopmentSourceInput): DevelopmentSourceProjection
```

Input contains `before`, `after`, `current` content-addressed capture refs; `assignmentPacket` ref; exact expected `roleId`, `configurationDigest`, `pathIdentity`, `journal` binding; bounds `maxCaptureBytes`, `maxArtifactBytes`, `maxRows`, `maxProofBytes`; and `readArtifact(ref, maxBytes): Uint8Array`. Capture bytes are exactly recorder shape `{roleId, source:{pathIdentity,journalDigest}, configurationDigest, clock, snapshot}`. Clock is `{kind:'host'|'synthetic',wallMs,monotonicMs,bootId,processStart}`. `current` is mandatory even when equal to `after`: it supplies the latest available payload dispositions known to the host. Assignment packet is exact v1 ordinary ingress entries `{id,roleId,message}` with source/externalId/revision/conversation/text/actor. Packet acceptance/signature and attempt-use withdrawal remain recorder-owned gates.

Output is version 1 **proposed mechanical facts**, never `DevelopmentObservation`, signed evidence or acceptance: capture refs/digests/cursors, clock interval and clock kind, cycles, assignments, and explicit unavailable reasons. Each fact carries exact global event `{id,sequence,stream,type}` positions and used `JournalRef` identities. Cycle facts contain selected scheduler sequence, selected goal revision/origin/provenance, execution/run links, newly reserved physical request IDs/statuses and retained result/error/uncertain observation links. Origin classification is `request` or `unknown`; self/maintenance/parent labels never become spontaneity. Assignment facts retain exact packet identity/entry digest and exact input, communication event, admitted/steering event, run and result links. A revision can reuse a run. Source fact existence cannot prove completion, semantic task success, growth, host independence or independence from steering.

Validate canonical bytes, artifact digest, fixed read/output bounds, exact role/configuration/path/journal binding, complete global prefix, unique events/rows/payloads, v2 anchor/mutation/withdrawal graph, payload commitments and current reconstructed inventory. Old schema, missing payload, orphan/ref mismatch, fabricated withdrawn disposition, revision gaps, changed prefix, clock regressions or changed host session are unavailable. All used versions must remain available in `current`; earlier/later rows cannot substitute for an intermediate withdrawn/missing version. Projection has no cache. Caller must rerun with the latest retained current capture immediately before recorder admission; a separately validated JR2 withdrawal gate still fences attempt use.

Only `scheduler:ordinary` selected goal events newly present between `before` and `after` can propose a cycle. Match selected goal to its journal version at selection; bind execution and actual initiative admission to a run; require a newly created physical request version after selection and before the next ordinary selection (and within `after`), with exact retained prompt/payload artifact integrity. Preserve request status and steering/admission ancestry. No timestamp is inferred for StoredEvent. Bounds describe the enclosing before/after interval, never an exact event time; guaranteed separation is `later.before.wallMs - earlier.after.wallMs`, only after recorder-owned host qualification. Synthetic clocks remain synthetic; raw `kind:host` is not qualification. New communication ingress must similarly occur in the interval, match packet text/identity/actor/audience/modification eligibility and actual admitted/steering event, and retain actual run/observation versions.

Causal offline checks frozen before implementation: real small journaled SQLite with ordinary FairScheduler/InitiativeRunner/runtime/ledger and CommunicationsCore; new selection/request and input/steering reuse succeed mechanically; repeated delayed capture of the same selection yields no new cycle; input mutation, unrelated run/request, missing/intermediate payload, withdrawal, prefix/current substitution, forged graph/disposition, digest/capture/proof bounds and clock/session changes refuse; self label preserves unknown origin; failed/uncertain source results remain visible. No paid provider work, native acquisition, host mounts, network, private state or production service. Strict compilation joins existing accepted source only.

## Narrow downstream integration proposal

OD2-b recorder owner receives the typed input/output above. It constructs expected values from its accepted plan and retained source inventory, pins packet ref and current capture, verifies JR2 attempt-use eligibility, invokes this projector itself, retains bounded canonical proof bytes, then admits only its specifically supported mechanical observation kinds. It must not accept caller-supplied projected completion/spontaneity/success/token facts or expose a generic arbitrary-observation signing callback. Unsupported witness observation kinds remain unavailable. Integration, fresh joined review, feedback/control/restart/context sensors, genuine elapsed acquisition and live/H1 gates remain open.

## Execution and handoff

Pre-code freeze only. Commands/results and exact source handoff will be appended after implementation.
