import { identity, invariant, type Authority, type DataScope, type Goal, type ShellResult } from '../packages/contracts/index.ts';
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
    return this.store.events<{ source?: string }>(runId, consumed).some(event => event.type === 'steering' && event.data.source !== 'host.evolution');
  }
  preserveWaiting(runId: string, result: ShellResult): ShellResult {
    return result.status === 'completed' && this.holds(runId) ? { ...result, status: 'checkpointed' } : result;
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
        if (run?.status !== 'waiting') return;
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
          if (!goal || goal.status !== 'waiting' || identity(goal.scope) !== identity(subscription.scope)) return;
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
