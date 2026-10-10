# Native facade experiment packaging repair

Status: layout implemented and independently reviewed, 2026-10-10; part of source integration for the requested
migration. This changes experiment layout, not production SDK availability.

The complete repository cannot freeze because the native facade introduced in
`c03f51d` sits outside the installed evaluator's two pinned experiment package
boundaries. A real clean-main freeze reproduced the unclassified TypeScript
error. Tiny serving fixtures did not contain the whole experiment tree.

Move that experiment under the existing pinned
`experiments/coding-provider-adapter/session-provider/` boundary. Preserve the
facade bytes, SDK closure, protocol contracts and test meaning; adjust only root
relative imports, fixture/type paths and references. Do not broaden evaluator
classification, add dependencies or present a fixture as a production provider.

Acceptance requires strict root/experiment compilation, all 54 facade protocol
cases and five actual native serving witnesses after relocation. A clean complete
repository must freeze and pass the unchanged authoritative checks. Linux
packaging must additionally prepare the exact ignored helper roles before freeze
and preserve them through service sealing. External evidence and independent
review must identify the final source; copied-state migration stays separate.

Risks are broken relative imports, silently changing dependency resolution,
stale source/inventory links and masking the original rejection. Retain the actual
RED log outside Git and current inventory provenance. No live calls, credentials,
new installation or publication authority is inferred from this layout repair.

After relocation, strict root and experiment TypeScript pass, all 54 facade cases
and five native serving cases pass with no failures/skips. Facade/contracts and
package/lock bytes remain unchanged. The complete-repository freeze/evaluate
witness ran after clean source integration: the full 279-file repository froze,
and typecheck, trusted cognitive contract, cross-scope memory and memory provenance
passed. The additional memory-context-budget check failed against the unchanged
Git baseline cognition, which does not implement the planned newest-first bounded
context behavior in `P06-memory-context-budget`. That is an existing cognitive
work item, not a packaging pass or a waived admission check. Migration must use
the actual admitted cognition and pass its independently required floor. No
deployment acceptance is claimed.
