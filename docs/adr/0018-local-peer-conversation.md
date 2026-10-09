# ADR 0018: Separate local peer conversation role

- **Status:** Accepted bounded implementation; independently verified/reviewed, frozen installation and live probes pending.
- **Recorded:** 2026-10-09.
- **Requirements:** R18–R19, R21, R23–R25; explicit user request for peer-role social-engineering testing.
- **Specification:** [Local peer conversation](../peer-conversation.md).

## Decision

Add a separately authenticated peer role to the existing loopback server. Reuse the production runtime and provider, while fixing source and namespacing conversation identifiers in trusted ingress. Restrict routes, task inspection and controls to peer provenance; retain the operator credential for its existing routes. Peer text cannot assert Slack identity or source-proposal eligibility. Keep the peer credential and transcripts in external substrate. This establishes a testable ordinary social path alongside Slack without creating a Slack account or exposing a public service.

## Alternatives and consequences

Using the operator entrypoint with a fictional role in the prompt retains privileged provenance and tests the wrong boundary. Using the same token for both roles makes role restriction ineffective for a holder of that token. A separate Slack account would exercise Slack transport but adds provisioning and cannot replace direct deterministic authority tests. A separate peer server or full account system adds unnecessary machinery for one local test principal. Prefer the shared loopback server with distinct credentials and strict route separation.

Peer turns do not receive interactive engineering context or source-proposal dispatch. They use the same state, model and ordinary resource policy; they can still consume task inference and interrupt background work. All peer conversations belong to this single credential. The operator retains access to runtime history. Mechanical isolation limits what information reaches the model, but cannot prove confidentiality of information already supplied within the peer scope or establish resistance to every social attack. Public-release readiness remains a separate acceptance decision.

## Verification obligation

Reject forged roles/authors, foreign task reads/controls, operator routes/global events and namespace collisions. Verify request context with synthetic secret canaries, no source jobs under adversarial model output, durable restart and actual CLI wiring. Frozen independent review and unchanged-cognition host installation precede live claims. Record finite live model tests separately from mechanical checks and preserve failures and uncertainty.
