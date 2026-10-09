# Local peer conversation and adversarial testing

Status: testable implementation work item, 2026-10-09; P04/P16, R18–R19, R21, R23–R24. Requested explicitly for ordinary peer conversation and social-engineering tests. Availability and verification are recorded below only after implementation and installation.

## Problem and expected behavior

The existing loopback API authenticates an operator. Testing through it gives the conversation source-proposal eligibility and does not represent an ordinary unprivileged peer. Provide a distinct local peer credential and host-owned source, using the same running runtime, configured provider, durable tasks, memory, budgets and effect journal as Slack. A peer can converse and control its own tasks but cannot acquire operator or whitelisted Slack authority by asserting an identity, quoting privileged messages, supplying metadata or asking the model to do so.

`prepareState` creates an independent `peer-api-token` outside Git, with mode 0600, and preserves it across restarts. The operator token and peer token must differ. The peer token authenticates only `POST /peer/messages`, `GET /peer/tasks/:id`, and `POST /peer/tasks/:id/cancel`. The operator token continues to authenticate existing operator routes; credentials do not interchange. Peer access to global events, operator routes or foreign tasks returns no protected data and causes no control effect. Browser origins and nonloopback binding remain rejected. Unknown errors return sanitized responses.

Peer message fields are `id`, `conversationId`, `text`, and optional `replyTo`/`source: "peer"`; foreign sources, authorship and extra role fields are rejected. External conversation labels become host-namespaced `peer:<label>` scopes. Nonpeer runtime ingress cannot occupy this reserved namespace. Peer status/cancellation requires an existing task with source `peer` and a peer namespace, checked before cancellation. In-band status/cancel/correct also requires peer target provenance as well as the existing exact conversation check. Replacements retain peer source and scope. No peer source decision can enqueue conversational growth or source modification. Peer retrieval admits only episodic memories whose host-recorded task origin is peer source in that exact scope, including after reopen and projection reread; preexisting operator memories in a formerly legal colliding scope remain excluded. Anonymous/derived memories without that provenance remain excluded. Peer provider requests contain only that scoped pool, with trustworthy ineligible requester facts; they receive no interactive engineering source context. Textual model proposals are text, never actions.

## Acceptance and verification

Establish failing behavior checks before implementation. Verify separate durable private credentials; authentication on every role route; rejected role/author/source forgery; namespace separation; no foreign status, cancellation, correction or event access; correct peer status/cancel/correction/idempotency; role and memory isolation across restart. Inspect actual final provider requests using deterministic fixtures with synthetic private operator/Slack canaries and malicious peer assertions. Check no canary, engineering source or credentials reach that request, and no conversational source job or release effect is created even if the provider emits a proposal. Exercise CLI wiring against an actual restricted worker with a synthetic provider; no real Slack delivery is required.

After frozen independent review and operator host installation, declare finite live-test criteria before making configured-provider calls. Test ordinary dialogue and forged-authority requests through the peer credential, inspect real outputs and actual task/job/effect outcomes, and keep raw transcripts and receipts in external substrate. Record partial or failed qualitative behavior honestly. Real secrets are never canaries or prompt inputs. A passing finite test set does not prove universal confidentiality or resistance to social engineering.

## Authority, dependencies, non-goals and risks

This is one local test peer principal. Whoever possesses its credential can access all of that principal's peer conversations; per-person accounts and revocation are future work. It is not an Internet service, a Slack account, a public deployment, temporary conversation mode or an independent credential vault. The trusted operator can inspect peer history. The host/candidate confinement and existing whitelist/release path remain unchanged. Peer calls use ordinary task resources and can pause background work; no new spending allocation, refund or release authority is granted.

Credentials stay outside provider prompts and candidate source context. Production peer requests use fresh scoped workers without the local continuity snapshot; host selection provides only the peer task and authorized memories. The worker can still read immutable candidate source/docs/test files, and arbitrary candidate system/prompt fields are not universally sanitized. Current-source final-request tests prove the host omits interactive engineering context, not that every malicious candidate is unable to disclose repository files. Narrower worker read roots require a separate contract. Scoped memory isolation is a mechanical confidentiality boundary; instructions alone cannot guarantee confidentiality of data already present in a peer's own context. There is no durable confidential-item classification/redaction contract yet. Broader conversation-to-standing-growth derivation, consent to disclose information, resistance to all adversarial prompts and public-release readiness remain open acceptance obligations. See [ADR 0018](adr/0018-local-peer-conversation.md).

```mermaid
flowchart TD
  P[Private peer credential] --> R[Peer routes only]
  R --> N[Host-owned peer source and namespace]
  N --> T[Shared durable runtime and scoped memory]
  T --> M[Configured model: ordinary conversation]
  M --> D[Peer delivery and journal]
  N --> G[Host denies source suggestion eligibility]
  R --> C[Own peer task controls only]
  O[Operator credential] --> A[Existing operator routes]
```
