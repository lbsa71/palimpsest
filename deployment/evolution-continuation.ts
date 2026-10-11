import { identity, invariant, transitionRun, type ArtifactRef, type Effect, type PhysicalRequest, type JsonValue, type Run, type Authority, type DataScope, type Goal, type ShellResult } from '../packages/contracts/index.ts';
import { InitiativeRegistry } from '../packages/initiative/goals/index.ts';
import type { DurableRuntime } from '../packages/runtime/index.ts';
import type { OperationalStore } from '../packages/storage/index.ts';
import type { AuthorityStore } from '../packages/supervisor/authority.ts';
import type { ChangeRecord } from '../packages/release/proposals.ts';
import { assertReviewLineage } from './evaluation-resources.ts';
import type { EvolutionJob } from './evolution-mailbox.ts';
import type { EvaluationReceipt, EvaluationRequest } from './evolution-tools.ts';

const namespace = 'host.evolution-continuations';
interface Continuation { requestId: string; requestDigest: string; runId: string; changeId: string; scope: DataScope; authority: Authority; status: 'waiting' | 'notified' | 'declined' | 'reconciled' }
interface Acknowledgment { effectId: string; runId: string; scope: DataScope; authority: Authority; payload: JsonValue; requestId: string; requestDigest: string; receipt: ArtifactRef }
/** The enqueue receiver must release its slot and the bounded author turn must
 * finish before review can claim their shared lineage. A lost reply stays pending. */
export function evaluationAcknowledgmentPending(store: OperationalStore, requestId: string): boolean {
  return store.list<Acknowledgment>('host.evolution-acknowledgments').some(row => {
    const acknowledgment = row.value;
    if (acknowledgment.requestId !== requestId) return false;
    const effect = store.get<Effect>('effects', acknowledgment.effectId)?.value;
    const reservation = effect?.reservationId ? store.get<{ request: PhysicalRequest }>('requests', effect.reservationId)?.value : undefined;
    return !effect || effect.status !== 'succeeded' || !reservation || reservation.request.status !== 'succeeded' ||
      store.get<Run>('runs', acknowledgment.runId)?.value.status === 'running';
  });
}
/** Persist the exact local tool return with its host-supplied effect identity before returning it. */
export function recordEvaluationAcknowledgment(store: OperationalStore, effectId: string, request: EvaluationRequest, payload: JsonValue, value: unknown): void {
  const acknowledgment: Acknowledgment = { effectId, runId: request.proposal.runId, scope: structuredClone(request.proposal.scope), authority: structuredClone(request.proposal.authority),
    payload: structuredClone(payload), requestId: request.requestId, requestDigest: identity(request), receipt: store.putJsonArtifact(JSON.parse(JSON.stringify(value)) as JsonValue) };
  const row = store.get<Acknowledgment>('host.evolution-acknowledgments', effectId);
  invariant(!row || identity(row.value) === identity(acknowledgment), 'Local evaluation acknowledgment changed');
  if (!row) store.put('host.evolution-acknowledgments', effectId, acknowledgment, null);
}
/** Subscription changes never cancel an external review or invent its outcome. */
export function watchEvaluation(store: OperationalStore, request: EvaluationRequest, enabled: boolean): void {
  store.transaction(() => {
    const row = store.get<Continuation>(namespace, request.requestId);
    const value: Continuation = { requestId: request.requestId, requestDigest: identity(request), runId: request.proposal.runId,
      changeId: request.proposal.id, scope: structuredClone(request.proposal.scope), authority: structuredClone(request.proposal.authority), status: enabled ? 'waiting' : 'declined' };
    if (row) {
      const { status: _old, ...old } = row.value, { status: _next, ...next } = value;
      invariant(identity(old) === identity(next), 'Evolution continuation identity changed');
      if (enabled && ['notified', 'reconciled'].includes(row.value.status)) return;
    }
    store.put(namespace, request.requestId, value, row?.revision ?? null);
  });
}
export function reconcileEvaluationWatch(store: OperationalStore, requestId: string): void {
  const row = store.get<Continuation>(namespace, requestId);
  if (row && row.value.status !== 'reconciled') store.put(namespace, requestId, { ...row.value, status: 'reconciled' }, row.revision);
}
/** Local host events resume eligible waiting authors; no provider request or reviewer redispatch. */
export class EvolutionContinuations {
  readonly store: OperationalStore; readonly runtime: DurableRuntime; readonly authorityStore: AuthorityStore; readonly goals: InitiativeRegistry;
  constructor(options: { store: OperationalStore; runtime: DurableRuntime; authorityStore: AuthorityStore }) {
    this.store = options.store; this.runtime = options.runtime; this.authorityStore = options.authorityStore; this.goals = new InitiativeRegistry(options.store);
  }
  private subscriptions(runId?: string): Continuation[] {
    return this.store.list<Continuation>(namespace).map(row => row.value).filter(value => value.status === 'waiting' && (!runId || value.runId === runId));
  }
  holds(runId: string): boolean { return this.subscriptions(runId).length > 0; }
  eligibleGoal(goal: Goal): boolean {
    const runId = this.store.get<{ runId: string }>('initiative.execution', goal.id)?.value.runId;
    if (!runId || !this.holds(runId)) return true;
    const consumed = this.store.get<{ messageSequence?: number }>('execution', runId)?.value.messageSequence ?? 0;
    return this.store.events(runId, consumed).some(event => event.type === 'steering');
  }
  preserveWaiting(runId: string, result: ShellResult): ShellResult {
    return result.status === 'completed' && this.holds(runId) ? { ...result, status: 'checkpointed' } : result;
  }
  /** Only a committed local enqueue proves this receiver's known outcome. Physical reviews
   * and every other uncertain effect keep their independent reservations and recovery rules. */
  reconcileAcknowledgments(): string[] {
    const recovered: string[] = [];
    for (const row of this.store.list<Acknowledgment>('host.evolution-acknowledgments')) {
      const acknowledgment = row.value;
      try { this.authorityStore.dispatch(acknowledgment.authority, () => this.store.transaction(() => {
        const effect = this.runtime.effects.get(acknowledgment.effectId);
        if (!effect || !['uncertain', 'succeeded'].includes(effect.status)) return;
        invariant(effect.id.startsWith('tool:') && effect.kind === 'candidate_evaluate' && effect.runId === acknowledgment.runId && identity(effect.payload) === identity(acknowledgment.payload) &&
          identity(effect.scope) === identity(acknowledgment.scope) && identity(effect.authority) === identity(acknowledgment.authority), 'Local evaluation effect binding mismatch');
        const run = this.runtime.getRun(effect.runId);
        if (!run || ['cancelled', 'running'].includes(run.status) || run.status === 'completed' && effect.status !== 'succeeded') return;
        invariant(identity(run.scope) === identity(acknowledgment.scope), 'Local evaluation effect audience mismatch');
        const job = this.store.get<EvolutionJob>('host.evolution-jobs', acknowledgment.requestId)?.value;
        invariant(job?.kind === 'evaluation' && job.requestDigest === acknowledgment.requestDigest, 'Committed local evaluation job required');
        const request = this.store.readJsonArtifact<EvaluationRequest>(job.request);
        invariant(identity(request) === acknowledgment.requestDigest && request.proposal.runId === effect.runId &&
          identity(request.proposal.scope) === identity(effect.scope) && identity(request.proposal.authority) === identity(effect.authority), 'Local evaluation request binding mismatch');
        invariant(effect.payload && typeof effect.payload === 'object' && !Array.isArray(effect.payload) && effect.payload.changeId === request.proposal.id, 'Local evaluation proposal/payload mismatch');
        assertReviewLineage(this.store, request);
        const receipt = this.store.readJsonArtifact<{ proposal: ChangeRecord; evaluation: { requestId: string; candidateId: string; policyDigest: string } }>(acknowledgment.receipt);
        if (effect.status === 'succeeded') invariant(effect.receipt && identity(this.store.readJsonArtifact(effect.receipt)) === identity(receipt), 'Successful local enqueue effect receipt changed');
        invariant(receipt.proposal.id === request.proposal.id && receipt.proposal.runId === effect.runId && identity(receipt.proposal.candidate) === identity(request.candidate.manifest) &&
          receipt.proposal.judgingPolicyDigest === request.policyDigest && identity(receipt.proposal.scope) === identity(effect.scope) &&
          identity(receipt.proposal.authority) === identity(effect.authority) && receipt.evaluation.requestId === job.id && receipt.evaluation.candidateId === job.candidateId &&
          receipt.evaluation.policyDigest === job.policyDigest, 'Local evaluation acknowledgment binding mismatch');
        const reservation = this.store.get<{ request: PhysicalRequest; ceiling: { elapsedMs: number }; charged: { elapsedMs: number } }>('requests', effect.reservationId!)?.value;
        if (effect.status === 'succeeded' && reservation?.request.status === 'succeeded') return;
        invariant(reservation && reservation.request.id === effect.id && reservation.request.reservationId === effect.reservationId && reservation.request.purpose === 'reasoning' &&
          reservation.request.promptManifestId === effect.id && reservation.request.runId === effect.runId && reservation.request.provider === 'effect-receiver' &&
          reservation.request.model === 'candidate_evaluate' && reservation.request.requestDigest === identity({ id: effect.id.slice(5), runId: effect.runId, stepId: effect.stepId, name: effect.kind, arguments: effect.payload }) &&
          ['dispatched', 'uncertain'].includes(reservation.request.status), 'Local enqueue receiver reservation required');
        // Keep the persisted upper charge when elapsed observation was lost; never invent zero.
        const elapsedMs = Math.max(reservation.request.usage.elapsedMs, reservation.ceiling.elapsedMs, reservation.charged.elapsedMs);
        if (effect.status === 'uncertain') this.runtime.effects.recordReconciliation(effect.id, acknowledgment.authority, 'succeeded', acknowledgment.receipt);
        this.runtime.resources.settle({ ...reservation.request, status: 'succeeded', usage: { ...reservation.request.usage, elapsedMs } });
        this.store.append({ id: `local-enqueue-reconciled:${effect.id}`, stream: effect.runId, type: 'local-enqueue-reconciled',
          data: { effectId: effect.id, requestId: job.id, elapsedMs, elapsedBasis: 'retained reservation ceiling; original elapsed observation unavailable', reviewerRedispatched: false } });
        if (run.status === 'blocked' && this.runtime.effects.unresolved(run.id).length === 0) {
          const runRow = this.store.get<Run>('runs', run.id)!; const ready = transitionRun(runRow.value, 'ready');
          this.store.put('runs', run.id, ready, runRow.revision);
          if (this.holds(run.id)) {
            this.store.put('host.evolution-recovered-waits', run.id, { requestId: job.id }, this.store.get('host.evolution-recovered-waits', run.id)?.revision ?? null);
          } else {
            // Declining a future result wake does not abandon the interrupted tool turn.
            // Restore its initiative readiness too; no new slice or grant is issued here.
            const execution = this.store.list<{ runId: string }>('initiative.execution').find(entry => entry.value.runId === run.id);
            const goal = execution ? this.goals.goal(execution.key) : undefined;
            if (goal?.status === 'blocked' && identity(goal.scope) === identity(acknowledgment.scope))
              this.goals.revise(goal.id, goal.revision, { status: 'ready' }, 'Known local evaluation acknowledgment recovered for the interrupted author');
          }
          this.store.append({ id: `local-enqueue-ready:${effect.id}`, stream: run.id, type: 'status', data: ready });
        }
        recovered.push(effect.id);
      })); } catch { /* A mismatched, cancelled or withdrawn acknowledgment never releases a gate. */ }
    }
    return recovered;
  }
  wake(): string[] {
    const resumed: string[] = [];
    for (const subscription of this.subscriptions()) {
      // Cancellation, terminal status and authority withdrawal are ordinary ineligible outcomes.
      try { this.authorityStore.dispatch(subscription.authority, () => this.store.transaction(() => {
        const row = this.store.get<Continuation>(namespace, subscription.requestId)!;
        if (row.value.status !== 'waiting') return;
        const job = this.store.get<EvolutionJob>('host.evolution-jobs', subscription.requestId)?.value;
        if (job?.status !== 'completed' || job.kind !== 'evaluation' || !job.receipt) return;
        const request = this.store.readJsonArtifact<EvaluationRequest>(job.request);
        invariant(identity(request) === subscription.requestDigest && job.requestDigest === subscription.requestDigest && request.proposal.runId === subscription.runId &&
          request.proposal.id === subscription.changeId && identity(request.proposal.scope) === identity(subscription.scope) &&
          identity(request.proposal.authority) === identity(subscription.authority) && identity(job.authority) === identity(subscription.authority), 'Evolution continuation binding mismatch');
        const run = this.runtime.getRun(subscription.runId);
        const recoveredWait = this.store.get<{ requestId: string }>('host.evolution-recovered-waits', subscription.runId)?.value.requestId === subscription.requestId;
        if (run?.status !== 'waiting' && !(run?.status === 'ready' && recoveredWait && this.runtime.effects.unresolved(run.id).length === 0)) return;
        invariant(identity(run.scope) === identity(subscription.scope), 'Evolution continuation audience mismatch');
        assertReviewLineage(this.store, request);
        const proposal = this.store.get<ChangeRecord>('release.changes', identity({ runId: subscription.runId, id: subscription.changeId }))?.value;
        invariant(proposal?.state === 'evaluation-dispatched' && identity(proposal.candidate) === identity(request.candidate.manifest) &&
          proposal.judgingPolicyDigest === request.policyDigest && identity(proposal.scope) === identity(subscription.scope) &&
          identity(proposal.authority) === identity(subscription.authority), 'Evolution continuation proposal mismatch');
        const receipt = this.store.readJsonArtifact<EvaluationReceipt>(job.receipt);
        invariant(receipt.requestId === subscription.requestId && receipt.candidateId === request.candidate.manifest.id && job.candidateId === receipt.candidateId &&
          receipt.policyDigest === request.policyDigest && job.policyDigest === receipt.policyDigest, 'Evolution continuation receipt mismatch');
        const execution = this.store.list<{ runId: string }>('initiative.execution').find(entry => entry.value.runId === subscription.runId);
        if (execution) {
          const goal = this.goals.goal(execution.key);
          if (!goal || !(goal.status === 'waiting' || goal.status === 'blocked' && recoveredWait) || identity(goal.scope) !== identity(subscription.scope)) return;
          this.goals.revise(goal.id, goal.revision, { status: 'ready' }, 'Bound external evaluation result is available for the original waiting author');
        } else {
          // Delegation/obligation lifecycles own their continuation and are never borrowed here.
          if (this.store.get('host.child-runs', subscription.runId) || this.store.list<{ runId: string }>('host.delivery-runs').some(entry => entry.value.runId === subscription.runId)) return;
          const pending = this.store.get('host.pending-runs', subscription.runId);
          this.store.put('host.pending-runs', subscription.runId, { requestedAt: Date.now() }, pending?.revision ?? null);
        }
        this.runtime.steer(subscription.runId, { id: `evolution-result:${subscription.requestId}`, source: 'host.evolution', externalId: subscription.requestId, externalRevision: '1',
          actorId: subscription.authority.generation, authenticated: true, scope: subscription.scope,
          value: { event: 'external-evaluation-completed', changeId: subscription.changeId, requestId: subscription.requestId,
            candidateId: receipt.candidateId, policyDigest: receipt.policyDigest, instruction: 'Read change_status for the bound independent result and choose whether to continue. This event grants no new release authority.' } });
        this.store.put(namespace, subscription.requestId, { ...row.value, status: 'notified' }, row.revision); resumed.push(subscription.runId);
      })); } catch { /* Retain ineligible subscriptions and known evidence for explicit inspection. */ }
    }
    return resumed;
  }
}
