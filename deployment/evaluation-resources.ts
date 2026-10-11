import { identity, invariant, type Authority, type PhysicalRequest, type ResourceEnvelope, type Run } from '../packages/contracts/index.ts';
import { ResourceLedger } from '../packages/runtime/resources/index.ts';
import type { OperationalStore } from '../packages/storage/index.ts';
import type { EvaluationRequest } from './evolution-tools.ts';

const provider = 'external-offline-review';
const preparationNamespace = 'host.external-review-reservations';
interface ReviewAllocation { parentRunId?: string; cancelled: boolean; envelope: ResourceEnvelope; startedAt: number }
interface PreparedReview { physical: PhysicalRequest; startedAt: number; maxElapsedMs: number; claimed?: boolean }
export interface ReviewResourceOptions {
  store: OperationalStore; request: EvaluationRequest; evaluatorDigest: string; evaluatorId: string;
  maxElapsedMs: number; assertAuthority(authority: Authority): void;
  dispatchAuthority(authority: Authority, operation: () => void): void; signal?: AbortSignal; now?: () => number;
  /** Synchronous host state committed atomically with the original reservation, under both locks. */
  commitReservation?: () => void;
  /** A separate physical candidate probe; absent identifies the sealed reviewer itself. */
  operation?: { id: string; digest: string };
  /** Host-checked probation continuation; judging authority in request remains unchanged. */
  physicalAuthority?: Authority;
}
export function reviewPhysicalId(jobId: string): string { return `external-review:${jobId}`; }
export function reviewOperationId(options: Pick<ReviewResourceOptions, 'request' | 'operation'>): string {
  if (!options.operation) return reviewPhysicalId(options.request.requestId);
  invariant(/^[a-zA-Z0-9_-]{1,64}$/.test(options.operation.id) && /^[a-f0-9]{64}$/.test(options.operation.digest), 'Bounded exact offline operation identity required');
  return `${reviewPhysicalId(options.request.requestId)}:probe:${options.operation.id}`;
}
function operationDigest(options: ReviewResourceOptions): string { return options.operation ? identity({ request: options.request, operation: options.operation }) : identity(options.request); }
/** Caller holds the operational transaction when accepting a result or launching a child. */
export function assertReviewLineage(store: OperationalStore, request: EvaluationRequest, now = Date.now, physicalAuthority = request.proposal.authority): void {
  const run = store.get<Run>('runs', request.proposal.runId)?.value;
  invariant(run && run.status !== 'cancelled' && identity(run.authority) === identity(physicalAuthority), 'External reviewer author run is cancelled, absent or fenced');
  invariant(!new ResourceLedger(store, { tokens: 0, costUsd: 0, elapsedMs: 0 }, now).snapshot(run.id).cancelled, 'External reviewer allocation is cancelled');
  let id: string | undefined = run.id, depth = 0;
  while (id) {
    invariant(++depth <= 128, 'Bounded reviewer allocation lineage required');
    const allocation: ReviewAllocation | undefined = store.get<ReviewAllocation>('allocations', id)?.value;
    invariant(allocation && !allocation.cancelled && now() - allocation.startedAt <= allocation.envelope.maxElapsedMs, 'External reviewer allocation expired or cancelled');
    id = allocation.parentRunId;
  }
}
/** Reserve before an expected authority transfer. The immutable request keeps the original
 * judge; the same run allocation, elapsed clock and reservation fund later probation.
 * Only host continuation code may use a prepared reservation; it does not authorize launch.
 */
export function prepareReview(options: ReviewResourceOptions): void {
  const { store, request } = options, now = options.now ?? Date.now;
  invariant(Number.isSafeInteger(options.maxElapsedMs) && options.maxElapsedMs > 0, 'Finite review reservation required');
  const id = reviewOperationId(options), authority = options.physicalAuthority ?? request.proposal.authority;
  const physical: PhysicalRequest = { id, runId: request.proposal.runId, purpose: 'review', provider, model: options.evaluatorId,
    promptManifestId: `reviewer-closure:${options.evaluatorDigest}`, requestDigest: operationDigest(options), reservationId: id, status: 'reserved',
    usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: options.maxElapsedMs } };
  options.dispatchAuthority(authority, () => store.transaction(() => {
    options.signal?.throwIfAborted(); options.assertAuthority(authority); assertReviewLineage(store, request, now, authority);
    options.commitReservation?.();
    new ResourceLedger(store, { tokens: 0, costUsd: 0, elapsedMs: options.maxElapsedMs }, now).reserve(physical);
    store.put(preparationNamespace, id, { physical, startedAt: now(), maxElapsedMs: options.maxElapsedMs }, null);
  }));
}
/** These offline reviewers have no network or provider credentials. Each review still consumes
 * one physical request, shared concurrency and measured wall time under the requester's lineage.
 */
export async function accountedReview<T>(options: ReviewResourceOptions & { prepared?: boolean; physicalAuthority?: Authority },
operation: (gate: { signal: AbortSignal; dispatch(launch: () => void): void }) => Promise<T>): Promise<T> {
  const { request, store } = options, now = options.now ?? Date.now;
  const ledger = new ResourceLedger(store, { tokens: 0, costUsd: 0, elapsedMs: options.maxElapsedMs }, now);
  if (!options.prepared) prepareReview(options);
  // Claim before asynchronous preparation. A duplicate must never enter the operation or
  // settle the owner's physical request after losing a race at the launch gate.
  const prepared = store.transaction(() => {
    const row = store.get<PreparedReview>(preparationNamespace, reviewOperationId(options)), prepared = row?.value;
    invariant(row && prepared && !prepared.claimed && prepared.maxElapsedMs === options.maxElapsedMs && prepared.physical.requestDigest === operationDigest(options) &&
      prepared.physical.model === options.evaluatorId && prepared.physical.promptManifestId === `reviewer-closure:${options.evaluatorDigest}` &&
      identity(ledger.request(prepared.physical.id)) === identity(prepared.physical), 'Exact unused prepared review reservation required');
    store.put(preparationNamespace, prepared.physical.id, { ...prepared, claimed: true }, row.revision);
    return prepared;
  });
  const physical = prepared.physical, started = prepared.startedAt, authority = options.physicalAuthority ?? request.proposal.authority;
  const controller = new AbortController(), signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const assertLive = () => {
    signal.throwIfAborted(); options.assertAuthority(authority);
    assertReviewLineage(store, request, now, authority);
    invariant(now() - started < options.maxElapsedMs, 'External reviewer reservation deadline exceeded');
  };
  let dispatched = false;
  const monitor = setInterval(() => { try { assertLive(); } catch (error) { controller.abort(error); } }, 25);
  try {
    assertLive();
    const result = await operation({ signal, dispatch(launch) {
      // Both databases hold their write locks through the synchronous physical launch gate.
      // Cross-process withdrawal/cancellation must serialize before or after this boundary.
      assertLive(); invariant(!dispatched, 'Physical external review already dispatched');
      // Commit the uncertain-effect marker BEFORE launching. If the host dies during the
      // locked launch, rolling back that transaction must not make the child free or replayable.
      ledger.dispatched({ ...physical, status: 'dispatched' });
      options.dispatchAuthority(authority, () => store.transaction(() => {
        assertLive(); dispatched = true;
        launch();
      }));
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
