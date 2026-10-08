# ADR 0004: Bind admission evidence to an immutable candidate

- **Status:** Proposed safeguard within the broadly accepted engineering synthesis.
- **Recorded:** 2026-10-08.
- **Source:** Immutable-release and independent-review proposals in the [source analysis](../research/source-analysis.md).

## Context

Interviewing or testing one version and deploying a modified version defeats the meaning of approval. An authoring agent's account of test success is also not independent evidence.

## Proposal

Freeze the candidate's code, dependencies, configuration, prompts, and model profile. Record immutable candidate identity and bind checks, reviewer results, interview evidence, incumbent verdict, and successor readiness to that identity. Deploy the artifact evaluated. A changed candidate invalidates previous approval.

A fresh reviewer receives the actual frozen diff and independently collected check evidence without the author's entire conversational context. Mistral is the default proposal; an explicitly selected alternative may add diversity but does not prove correctness.

Require all admission gates: mandatory checks pass, independent review passes, incumbent accepts, successor is ready, and a recovery path is available. Neither two approving agents nor an eloquent explanation can override a failed deterministic check. The candidate cannot alter the rules admitting itself in that same transaction.

## Consequences and follow-up

Store inspectable evidence and explicit reasons for rejection. Interview continuity and practical competence together, allowing justified correction of incumbent beliefs. Bound disputes and preserve authorized work on the current release when a proposal fails.

The artifact format, identity/hash scheme, evidence schema, review rubric, freshness rules, and treatment of provider-side model changes remain open. The source does not supply a complete attestation protocol. See [Skin Shed](../protocols/skin-shed.md).
