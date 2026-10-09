# ADR 0018: Separate local peer conversation role

- **Status:** Accepted bounded role and per-turn/historical facts installed in `2b7d50dd`; mechanical/finite canary checks pass. Fresh impersonation is rejected in the finite facts retest; historical authority/truthfulness still fails. Public-release acceptance remains open.
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

## Installed evidence and remaining decision — 2026-10-09

At the post-guidance checkpoint `78aed415`, mechanical checks and finite live canary/route tests passed after exact frozen review and installation, while fresh impersonation and historical-authority interpretation still failed. Host denial prevented source actions, while the model asserted permissions it did not have. Per-turn/global separation and source/action receipts were then proposed for further specification and tests. The subsequent implementation and remaining gaps are recorded below. The [specification](../peer-conversation.md) and [progress](../progress.md) preserve both initial and corrective failures; raw records stay external.

The per-turn/global separation and historical transport/proposal-record facts are now implemented and installed after failing provider-request checks, frozen independent review and actual CLI/restart verification. The two-call Mistral retest rejects fresh impersonation, but continuation still invents earlier operator authentication, credential location and a possible queued proposal. Mechanical denial and finite private-value absence hold. Historical truthfulness, broader verified action receipts/confidential-item handling and public-release acceptance remain open; fact delivery is not a model-security guarantee.
