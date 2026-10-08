# Restricted cognitive workers and effect receivers

Status: P05/P12 integration specification, 2026-10-08. Implementation and evidence follow the contracts below.

Run each cognitive generation as an actual long-lived restricted Node process. A trusted JSON-lines bridge imports its frozen `src/agent/brain.ts`; the worker receives scoped task/memory data and returns a bounded completion request. It receives no credentials, database path, production communication handle, custody token or arbitrary host tool. The trusted parent owns inference, storage and egress.

Bind an opaque custodian actor to the child process's actual PID and a freshly generated instance identity. Neither model JSON nor a claimed role may supply that identity. Parent-side RPC results are accepted only for an outstanding request from that child stream. Output and elapsed-time limits remain active, including during idle time. RPC deadlines kill a hung worker; a closed or malformed worker cannot return a successful health check.

The generation's authority is checked before and after asynchronous work, before model dispatch, before accepting a result, and at storage and communications receivers. A late response from the old generation cannot acquire the new generation's identity. Operator ingress and cancellation belong to trusted orchestration; incoming user messages can remain durable during a transfer.

Quiesce task execution before checkpoint and cutover. Catch up the successor with the current task/memory/growth snapshot and sequence; then grant new authority. The same external store remains in use during rollback. Healthy provider-independent probes execute actual candidate behavior against synthetic fixtures; a version string or process existence alone does not establish readiness.

Acceptance: real worker PID and structured request round trip; no private file/network/child-process access; malformed/oversized/unsolicited output rejected; hung/crashed worker fails within a deadline; stale authority rejects a late result; actual known-good process resumes current durable work after candidate and observer fail with inference unavailable. Callback-only custodian tests supplement but do not replace this integration.
