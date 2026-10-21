import { identity, invariant, type Authority, type PhysicalRequest, type ResourceEnvelope, type Run } from '../packages/contracts/index.ts';
import type { OperationalStore } from '../packages/storage/index.ts';
import type { EvaluationRequest } from './evolution-tools.ts';
import { createProductionReviewMonitor, hostResourceLedger, type HostResourceLedgerFactory, type HostResourceOptions } from './host-resources.ts';

const provider = 'external-offline-review';
const preparationNamespace = 'host.external-review-reservations';
interface ReviewAllocation { parentRunId?: string; cancelled: boolean; envelope: ResourceEnvelope; startedAt: number; elapsedFloorMs?: number }
interface PreparedReview { physical: PhysicalRequest; startedAt: number; maxElapsedMs: number; reviewDigest: string; claimed?: boolean }
export interface ReviewResourceOptions extends HostResourceOptions {
  store: OperationalStore; request: EvaluationRequest; evaluatorDigest: string; evaluatorId: string;
  maxElapsedMs: number; assertAuthority(authority: Authority): void;
  dispatchAuthority(authority: Authority, operation: () => void): void; signal?: AbortSignal;
  /** Synchronous host state committed atomically with the original reservation, under both locks. */
  commitReservation?: () => void;
  /** A separate physical candidate probe; absent identifies the sealed reviewer itself. */
  operation?: { id: string; digest: string };
  /** Host-checked probation continuation; judging authority in request remains unchanged. */
  physicalAuthority?: Authority;
  /** For sequential post-transfer work, prove a completed operation of this same review. */
  continuedFrom?: string;
}
export function reviewPhysicalId(jobId: string): string { return `external-review:${jobId}`; }
export function reviewOperationId(options: Pick<ReviewResourceOptions, 'request' | 'operation'>): string {
  if (!options.operation) return reviewPhysicalId(options.request.requestId);
  invariant(/^[a-zA-Z0-9_-]{1,64}$/.test(options.operation.id) && /^[a-f0-9]{64}$/.test(options.operation.digest), 'Bounded exact offline operation identity required');
  return `${reviewPhysicalId(options.request.requestId)}:probe:${options.operation.id}`;
}
function operationDigest(options: ReviewResourceOptions): string { return options.operation ? identity({ request: options.request, operation: options.operation }) : identity(options.request); }
/** Caller holds the operational transaction when accepting a result or launching a child. */
export function assertReviewLineage(store: OperationalStore, request: EvaluationRequest, now?: () => number, physicalAuthority = request.proposal.authority, resourceLedger?: HostResourceLedgerFactory): void {
  const ledger = hostResourceLedger(store, { tokens: 0, costUsd: 0, elapsedMs: 0 }, { now, resourceLedger }), clock = now ?? ledger.now;
  const run = store.get<Run>('runs', request.proposal.runId)?.value;
  invariant(run && run.status !== 'cancelled' && identity(run.authority) === identity(physicalAuthority), 'External reviewer author run is cancelled, absent or fenced');
  invariant(!ledger.snapshot(run.id).cancelled, 'External reviewer allocation is cancelled');
  let id: string | undefined = run.id, depth = 0;
  while (id) {
    invariant(++depth <= 128, 'Bounded reviewer allocation lineage required');
    const allocation: ReviewAllocation | undefined = store.get<ReviewAllocation>('allocations', id)?.value;
    invariant(allocation && !allocation.cancelled, 'External reviewer allocation expired or cancelled');
    const limit = ledger.effectiveEnvelope(id).maxElapsedMs;
    invariant(limit === null || Math.max(0, clock() - allocation.startedAt, allocation.elapsedFloorMs ?? 0) <= limit, 'External reviewer allocation expired or cancelled');
    id = allocation.parentRunId;
  }
}
/** Reserve before an expected authority transfer. The immutable request keeps the original
 * judge; the same run allocation, elapsed clock and reservation fund later probation.
 * Only host continuation code may use a prepared reservation; it does not authorize launch.
 */
export function prepareReview(options: ReviewResourceOptions): void {
  const { store, request } = options;
  invariant(Number.isSafeInteger(options.maxElapsedMs) && options.maxElapsedMs > 0, 'Finite review reservation required');
  const ledger = hostResourceLedger(store, { tokens: 0, costUsd: 0, elapsedMs: options.maxElapsedMs }, options), now = options.now ?? ledger.now;
  const id = reviewOperationId(options), authority = options.physicalAuthority ?? request.proposal.authority;
  const physical: PhysicalRequest = { id, runId: request.proposal.runId, purpose: 'review', provider, model: options.evaluatorId,
    promptManifestId: `reviewer-closure:${options.evaluatorDigest}`, requestDigest: operationDigest(options), reservationId: id, status: 'reserved',
    usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: options.maxElapsedMs } };
  options.dispatchAuthority(authority, () => store.transaction(() => {
    options.signal?.throwIfAborted(); options.assertAuthority(authority); assertReviewLineage(store, request, now, authority, options.resourceLedger);
    options.commitReservation?.();
    ledger.reserve(physical);
    store.put(preparationNamespace, id, { physical, startedAt: now(), maxElapsedMs: options.maxElapsedMs, reviewDigest: identity(request) }, null);
  }));
}
/** These offline reviewers have no network or provider credentials. Each review still consumes
 * one physical request, shared concurrency and measured wall time under the requester's lineage.
 */
export async function accountedReview<T>(options: ReviewResourceOptions & { prepared?: boolean; physicalAuthority?: Authority },
operation: (gate: { signal: AbortSignal; dispatch(launch: () => void): void }) => Promise<T>): Promise<T> {
  const { request, store } = options;
  const ledger = hostResourceLedger(store, { tokens: 0, costUsd: 0, elapsedMs: options.maxElapsedMs }, options), now = options.now ?? ledger.now;
  if (options.physicalAuthority && !options.prepared) {
    const predecessor = options.continuedFrom && store.get<PreparedReview>(preparationNamespace, options.continuedFrom)?.value;
    const physical = options.continuedFrom ? ledger.request(options.continuedFrom) : undefined;
    invariant(predecessor && predecessor.claimed && predecessor.reviewDigest === identity(request) && physical?.status === 'succeeded' &&
      physical.runId === request.proposal.runId && physical.model === options.evaluatorId && physical.promptManifestId === `reviewer-closure:${options.evaluatorDigest}`,
    'Transferred review requires its original prepared reservation or completed same-review predecessor');
  }
  if (!options.prepared) prepareReview(options);
  // Claim before asynchronous preparation. A duplicate must never enter the operation or
  // settle the owner's physical request after losing a race at the launch gate.
  const prepared = store.transaction(() => {
    const row = store.get<PreparedReview>(preparationNamespace, reviewOperationId(options)), prepared = row?.value;
    invariant(row && prepared && !prepared.claimed && prepared.reviewDigest === identity(request) && prepared.maxElapsedMs === options.maxElapsedMs && prepared.physical.requestDigest === operationDigest(options) &&
      prepared.physical.model === options.evaluatorId && prepared.physical.promptManifestId === `reviewer-closure:${options.evaluatorDigest}` &&
      identity(ledger.request(prepared.physical.id)) === identity(prepared.physical), 'Exact unused prepared review reservation required');
    store.put(preparationNamespace, prepared.physical.id, { ...prepared, claimed: true }, row.revision);
    return prepared;
  });
  const physical = prepared.physical, started = prepared.startedAt, authority = options.physicalAuthority ?? request.proposal.authority;
  const controller = new AbortController(), signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const assertLive = () => {
    signal.throwIfAborted(); options.assertAuthority(authority);
    assertReviewLineage(store, request, now, authority, options.resourceLedger);
    invariant(now() - started < options.maxElapsedMs, 'External reviewer reservation deadline exceeded');
  };
  let dispatched = false, stopMonitor: (() => void) | undefined;
  try {
    stopMonitor = (options.monitor ?? createProductionReviewMonitor()).every(25, () => { try { assertLive(); } catch (error) { controller.abort(error); } });
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
  } finally { stopMonitor?.(); }
}
/** Recovery touches only this processor's physical records, never repeats a review, and never
 * turns an interrupted physical operation into free usage. Reserved means the launch gate never ran.
 */
export function recoverReviewReservations(store: OperationalStore, options: HostResourceOptions = {}): void {
  const ledger = hostResourceLedger(store, { tokens: 0, costUsd: 0, elapsedMs: 0 }, options);
  for (const row of store.list<{ request: PhysicalRequest }>('requests')) {
    const request = row.value.request;
    if (request.provider !== provider || !request.id.startsWith('external-review:') || !['reserved', 'dispatched'].includes(request.status)) continue;
    ledger.settle({ ...request, status: request.status === 'reserved' ? 'failed' : 'uncertain',
      usage: { ...request.usage, elapsedMs: request.status === 'reserved' ? 0 : request.usage.elapsedMs } });
  }
}
