# ADR 0007: Use a versioned custodian API with an optional thin MCP adapter

- **Status:** Proposed response to the user's question about a dedicated custodian handoff tool.
- **Recorded:** 2026-10-08.
- **Source:** The succession-tool exchange in the [source analysis](../research/source-analysis.md).

## Context

A model-controlled `handoff()` or general restart command gives too little structure for authenticated negotiation, candidate-bound approval, and recovery. MCP can expose tools but should not become the owner of durable succession state or a dependency of emergency recovery.

## Proposal

Define a versioned custodian API first, then expose a thin MCP adapter. The seed may call the same typed local API through its tool dispatcher. Keep durable state in the custodian and pass an explicit `succession_id`. Authenticate the calling process and its release identity, scope, role, and current state rather than trusting role claims in arguments.

Preserve the proposed eight-tool surface: `succession.propose`, `succession.status`, `succession.ask`, `succession.answer`, `succession.verdict`, `succession.ready`, `succession.request_cutover`, and `succession.report_regression`. Their exact caller roles and purposes are recorded in [Skin Shed](../protocols/skin-shed.md). Deployment, fencing, probation, retirement, and recovery remain internal custodian operations.

Use succession as the normal running-self replacement path; retain a separate custodian/operator emergency restoration capability. Recovery must remain possible without MCP connectivity or model inference.

## Consequences and follow-up

An authenticated host-local channel, possibly a Unix-domain socket, is a proposal rather than a committed transport. Verify current MCP transport/security requirements if implementing an adapter; time-specific claims in the old discussion are not implementation evidence.

The recovered text lacks a wire schema and exact state enum. Resolve caller-role/state enforcement, retries, idempotency, cancellation, and successor questions before freezing the API. Later memory, personality, model, and custodian succession may reuse the governance pattern, but each needs distinct authority scopes and acceptance tests. Custodian upgrades must preserve an older independent rescue mechanism.
