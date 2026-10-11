# Rewrite decisions and owners

Status: 2026-10-11. Product direction is set; the choices below are bounded engineering work. A proposal is not an implemented capability or a request to block all work pending another user conversation.

| Decision | Current position | Owner / closing evidence |
|---|---|---|
| D-R01 — Language, package and storage design | TypeScript/Node and local transactional storage are useful candidates, not inherited obligations; choose for the new contracts and selected shell | A1-L01 proposes; L02 integration evidence and L03 recovery needs; adopted ADR at C1 |
| D-R02 — Agent shell | Reuse-first shortlist and finite experiment; no winner selected | A1-L02 [decision procedure](rewrite/agent-shell-decision.md), hard prompt/effect/continuity gates and measured burden |
| D-R03 — Models and reasoning profiles | Mistral carried default to qualify; alternatives explicit; no competence inferred from names or effort labels | A1-L02/L08 controlled and end-to-end evidence; A2-L05 later revises routing |
| D-R04 — Self/memory representation and retrieval | Canonical revisable self, scoped episodes and derived beliefs/procedures; exact storage/index/selection policies open | A1-L04 retrieval/learning/privacy/continuity evidence, A1-L08 later-transfer cases |
| D-R05 — Resource and initiative policy | Enough resources for useful loops; explicit caps, reservations and protected opportunity for four growth dimensions | A1-L03/L05 measured task envelopes and fairness; A2-L05 experiments |
| D-R06 — Parity thresholds and longitudinal horizon | Predeclare from baseline variance and target workloads; no fabricated superiority or post-failure threshold lowering | A1-L08 publishes protocol before candidate scores; H1 requires passing |
| D-R07 — Slack recovery envelope | Joined-thread recovery required; offline first mentions and unreachable/deleted history explicitly classified | A1-L07 capability/coverage decision and real adapter evidence; invisible gaps cannot pass |
| D-R08 — Release/control evolution | Independent admission, exact artifact identity, current-state recovery, every component eventually evolvable | A1-L09 real ordinary and control-upgrade/recovery demonstrations, informed by C1 |
| D-R09 — Aeon 2 first operating envelope | Proposed 14-day finite pilot; explicit allocations and qualified capability categories at H1 | A1-L09 handoff plus A2-L05 cycle manifest; no implied new spending authority |
| D-R10 — Historical code/data | Preserve archives; no required migration; components only retained with independent justification | Named owners in [reuse ledger](rewrite/reuse-ledger.md); a future importer is separately scoped |

[ADR 0031](adr/0031-aeon-rewrite-and-prompt-sovereignty.md) records the reset and prompt ownership. The earlier [decision list](history/pre-aeon-2026-10-11/docs/open-decisions.md) remains historical; it cannot silently select rewrite dependencies.
