import { identity, invariant, type Authority, type PhysicalRequest, type ResourceEnvelope, type Run } from '../packages/contracts/index.ts';
import { ResourceLedger } from '../packages/runtime/resources/index.ts';
import type { OperationalStore } from '../packages/storage/index.ts';
import type { EvaluationRequest } from './evolution-tools.ts';

const provider = 'external-offline-review';
interface ReviewAllocation { parentRunId?: string; cancelled: boolean; envelope: ResourceEnvelope; startedAt: number }
export function reviewPhysicalId(jobId: string): string { return `external-review:${jobId}`; }
/** These offline reviewers have no network or provider credentials. Each review still consumes
 * one physical request, shared concurrency and measured wall time under the requester's lineage.
 */
export async function accountedReview<T>(options: { store: OperationalStore; request: EvaluationRequest; evaluatorDigest: string; evaluatorId: string;
  maxElapsedMs: number; assertAuthority(authority: Authority): void; signal?: AbortSignal; now?: () => number },
operation: (gate: { signal: AbortSignal; beforeDispatch(): void }) => Promise<T>): Promise<T> {
  const { request, store } = options, now = options.now ?? Date.now;
  const ledger = new ResourceLedger(store, { tokens: 0, costUsd: 0, elapsedMs: options.maxElapsedMs }, now);
  const started = now(), controller = new AbortController(), signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const assertLive = () => {
    signal.throwIfAborted(); options.assertAuthority(request.proposal.authority);
    const run = store.get<Run>('runs', request.proposal.runId)?.value;
    invariant(run && run.status !== 'cancelled' && identity(run.authority) === identity(request.proposal.authority), 'External reviewer author run is cancelled, absent or fenced');
    invariant(!ledger.snapshot(run.id).cancelled, 'External reviewer allocation is cancelled');
    let id: string | undefined = run.id, depth = 0;
    while (id) {
      invariant(++depth <= 128, 'Bounded reviewer allocation lineage required');
      const allocation: ReviewAllocation | undefined = store.get<ReviewAllocation>('allocations', id)?.value;
      invariant(allocation && !allocation.cancelled && now() - allocation.startedAt <= allocation.envelope.maxElapsedMs, 'External reviewer allocation expired or cancelled');
      id = allocation.parentRunId;
    }
    invariant(now() - started < options.maxElapsedMs, 'External reviewer reservation deadline exceeded');
  };
  assertLive();
  const id = reviewPhysicalId(request.requestId);
  const physical: PhysicalRequest = { id, runId: request.proposal.runId, purpose: 'review', provider, model: options.evaluatorId,
    promptManifestId: `reviewer-closure:${options.evaluatorDigest}`, requestDigest: identity(request), reservationId: id, status: 'reserved',
    usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: options.maxElapsedMs } };
  // Do not borrow concurrency from the still-running candidate_evaluate effect receiver.
  ledger.reserve(physical);
  let dispatched = false;
  const monitor = setInterval(() => { try { assertLive(); } catch (error) { controller.abort(error); } }, 25);
  try {
    const result = await operation({ signal, beforeDispatch() {
      assertLive(); invariant(!dispatched, 'Physical external review already dispatched');
      ledger.dispatched({ ...physical, status: 'dispatched' }); dispatched = true;
    } });
    invariant(dispatched, 'External review completed without physical dispatch'); assertLive();
    ledger.settle({ ...physical, status: 'succeeded', usage: { ...physical.usage, elapsedMs: Math.max(0, now() - started) } });
    return result;
  } catch (error) {
    // Unknown review outcomes retain their ceiling and concurrency until explicit reconciliation.
    ledger.settle({ ...physical, status: dispatched ? 'uncertain' : 'failed', usage: { ...physical.usage,
      elapsedMs: dispatched ? Math.max(options.maxElapsedMs, now() - started) : 0 } });
    throw error;
  } finally { clearInterval(monitor); }
}
/** Recovery touches only this processor's physical records, never repeats a review, and never
 * turns an interrupted physical operation into free usage. Reserved means the launch gate never ran.
 */
export function recoverReviewReservations(store: OperationalStore): void {
  const ledger = new ResourceLedger(store, { tokens: 0, costUsd: 0, elapsedMs: 0 });
  for (const row of store.list<{ request: PhysicalRequest }>('requests')) {
    const request = row.value.request;
    if (request.provider !== provider || !request.id.startsWith('external-review:') || !['reserved', 'dispatched'].includes(request.status)) continue;
    ledger.settle({ ...request, status: request.status === 'reserved' ? 'failed' : 'uncertain',
      usage: { ...request.usage, elapsedMs: request.status === 'reserved' ? 0 : request.usage.elapsedMs } });
  }
}
