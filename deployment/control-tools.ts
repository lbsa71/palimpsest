import { identity, invariant, type ArtifactRef, type Authority, type DataScope, type Effect, type Goal, type JsonValue, type PhysicalRequest, type Run, type ShellResult } from '../packages/contracts/index.ts';
import { InitiativeRegistry } from '../packages/initiative/goals/index.ts';
import { ChangeProposals } from '../packages/release/proposals.ts';
import type { DurableRuntime } from '../packages/runtime/index.ts';
import type { OperationalStore } from '../packages/storage/index.ts';
import type { AuthorityStore } from '../packages/supervisor/authority.ts';
import type { ApplicationTool } from './application.ts';
import { controlActivationStatus, enqueueControlActivation, type ControlActivationRequest, type ControlContinuationRecord } from './control-continuation.ts';
import { assertReviewLineage } from './evaluation-resources.ts';
import type { EvolutionJob } from './evolution-mailbox.ts';
import type { EvolutionContext, SubmissionReceipt, SubmissionRequest } from './evolution-tools.ts';

const watches = 'host.control-author-watches', acknowledgments = 'host.control-acknowledgments';
interface ControlWatch { request: ControlActivationRequest; status: 'waiting' | 'notified' | 'reconciled' }
interface ControlAcknowledgment { effectId: string; request: ControlActivationRequest; authority: Authority; payload: JsonValue; receipt: ArtifactRef }
export function controlActivationId(runId: string, changeId: string): string { return `control:${identity({ runId, changeId })}`; }
function resolveSubmission(store: OperationalStore, request: ControlActivationRequest): SubmissionRequest {
  const proposal = new ChangeProposals(store, request.runId, request.scope).get(request.proposalId);
  invariant(proposal.state === 'submitted' && proposal.submission && proposal.candidate && identity(proposal.scope) === identity(request.scope) &&
    identity(proposal.authority) === identity(request.authority), 'Control activation requires this exact submitted proposal');
  const receipt = store.readJsonArtifact<SubmissionReceipt>(proposal.submission);
  const job = store.get<EvolutionJob>('host.evolution-jobs', request.submissionId)?.value;
  invariant(receipt.requestId === request.submissionId && receipt.status === 'staged' && receipt.candidateId === proposal.candidate.id &&
    (receipt.receipt as { stageId?: string }).stageId === request.stageId && job?.kind === 'submission' && job.status === 'completed' && job.receipt &&
    identity(store.readJsonArtifact(job.receipt)) === identity(receipt), 'Control activation requires the exact completed staged host receipt');
  const submission = store.readJsonArtifact<SubmissionRequest>(job.request);
  invariant(identity(submission) === job.requestDigest && submission.proposal.id === request.proposalId && submission.proposal.runId === request.runId &&
    identity(submission.proposal.scope) === identity(request.scope) && identity(submission.proposal.authority) === identity(request.authority) &&
    identity(submission.candidate.manifest) === identity(proposal.candidate) && job.candidateId === proposal.candidate.id &&
    job.policyDigest === proposal.judgingPolicyDigest && submission.policyDigest === proposal.judgingPolicyDigest, 'Control activation proposal/submission binding mismatch');
  return submission;
}
function publicStatus(record: ControlContinuationRecord): JsonValue {
  return { id: record.request.id, submissionId: record.request.submissionId, stageId: record.request.stageId, status: record.status,
    ...(record.review ? { candidateId: record.review.candidate.manifest.id } : {}), ...(record.proofId ? { proofId: record.proofId } : {}),
    ...(record.probationProof ? { probationProof: { uri: record.probationProof.uri, sha256: record.probationProof.sha256 } } : {}), ...(record.diagnosis ? { diagnosis: record.diagnosis } : {}) };
}
/** Host-only requestControlActivation has no tool acknowledgment. An ordinary producer must
 * finish both its exact effect and receiver accounting before physical authority withdrawal. */
export function controlActivationAcknowledgmentPending(store: OperationalStore, request: ControlActivationRequest): boolean {
  return store.list<ControlAcknowledgment>(acknowledgments).some(row => {
    const ack = row.value;
    if (ack.request.id !== request.id) return false;
    if (identity(ack.request) !== identity(request)) return true;
    // A settled tool can precede the producer's final checkpoint. Let the current slice
    // finish before reserving its remaining single slot or withdrawing its grant.
    if (store.get<Run>('runs', request.runId)?.value.status === 'running') return true;
    const effect = store.get<Effect>('effects', ack.effectId)?.value;
    const physical = effect?.reservationId ? store.get<{ request: PhysicalRequest }>('requests', effect.reservationId)?.value.request : undefined;
    try {
      return !effect || effect.status !== 'succeeded' || !effect.receipt || effect.kind !== 'control_activate' || effect.runId !== request.runId ||
        identity(effect.payload) !== identity(ack.payload) || identity(effect.scope) !== identity(request.scope) || identity(effect.authority) !== identity(ack.authority) ||
        identity(store.readJsonArtifact(effect.receipt)) !== identity(store.readJsonArtifact(ack.receipt)) || !physical || physical.status !== 'succeeded' ||
        physical.id !== effect.id || physical.reservationId !== effect.reservationId || physical.runId !== effect.runId || physical.provider !== 'effect-receiver' ||
        physical.purpose !== 'reasoning' || physical.model !== effect.kind || physical.promptManifestId !== effect.id ||
        physical.requestDigest !== identity({ id: effect.id.slice(5), runId: effect.runId, stepId: effect.stepId, name: effect.kind, arguments: effect.payload });
    } catch { return true; }
  });
}
export function controlTools(context: EvolutionContext, assertAuthority: (authority: Authority) => void): ApplicationTool[] {
  const bound = { ...context, scope: structuredClone(context.scope), authority: structuredClone(context.authority) };
  const proposals = new ChangeProposals(bound.store, bound.runId, bound.scope);
  const argsId = (args: JsonValue) => {
    invariant(args && typeof args === 'object' && !Array.isArray(args) && Object.keys(args).join(',') === 'changeId' && typeof args.changeId === 'string' && args.changeId.length > 0 && args.changeId.length <= 256, 'Exact bounded changeId required'); return args.changeId;
  };
  const allowed = (signal?: AbortSignal) => { signal?.throwIfAborted(); assertAuthority(bound.authority); const run = bound.store.get<Run>('runs', bound.runId)?.value;
    invariant(run && !['completed', 'cancelled'].includes(run.status) && identity(run.scope) === identity(bound.scope) && identity(run.authority) === identity(bound.authority), 'Control author cancelled, terminal or fenced'); };
  const schema = { type: 'object', properties: { changeId: { type: 'string' } }, required: ['changeId'], additionalProperties: false };
  return [{ name: 'control_activate', description: 'Durably request activation of this run’s exact staged control proposal and immediately acknowledge its pending host continuation. Activation and fresh probation remain independently judged by the original accepted policy. Inspect control_status for the result.', inputSchema: schema,
    execute(args, signal) {
      try { allowed(signal); const changeId = argsId(args); invariant(bound.effectId, 'Ordinary activation requires its host tool effect identity');
        return bound.store.transaction(() => {
          allowed(signal); const proposal = proposals.get(changeId); invariant(identity(proposal.scope) === identity(bound.scope) && proposal.submission, 'Own scoped staged submission required');
          const receipt = bound.store.readJsonArtifact<SubmissionReceipt>(proposal.submission), stageId = (receipt.receipt as { stageId?: string })?.stageId;
          invariant(receipt.status === 'staged' && typeof stageId === 'string', 'Control activation requires a staged host receipt');
          const request: ControlActivationRequest = { id: controlActivationId(bound.runId, changeId), submissionId: receipt.requestId, stageId,
            proposalId: changeId, runId: bound.runId, scope: structuredClone(bound.scope), authority: structuredClone(proposal.authority) };
          resolveSubmission(bound.store, request);
          const previous = controlActivationStatus(bound.store, request.id, bound.runId, bound.scope);
          invariant(!previous || identity(previous.request) === identity(request), 'Changed control activation identity');
          if (!previous) invariant(identity(request.authority) === identity(bound.authority), 'Original staged authority required before activation');
          const record = previous ?? enqueueControlActivation(bound.store, request, signal);
          const value = { changeId, activation: publicStatus(record) }, row = bound.store.get<ControlWatch>(watches, request.id);
          invariant(!row || identity(row.value.request) === identity(request), 'Control author watch identity changed');
          if (!row) bound.store.put(watches, request.id, { request, status: 'waiting' }, null);
          const ack: ControlAcknowledgment = { effectId: bound.effectId!, request, authority: bound.authority, payload: structuredClone(args), receipt: bound.store.putJsonArtifact(value) };
          const old = bound.store.get<ControlAcknowledgment>(acknowledgments, bound.effectId!);
          invariant(!old || identity(old.value) === identity(ack), 'Local control acknowledgment changed');
          if (!old) bound.store.put(acknowledgments, bound.effectId!, ack, null);
          return value;
        });
      } catch (cause) { throw Object.assign(Error(`Control activation enqueue rejected: ${cause instanceof Error ? cause.message : 'invalid binding'}`, { cause }), { mayHaveApplied: false }); }
    },
  }, { name: 'control_status', description: 'Inspect this run’s exact control activation and original-policy probation outcome. Uncertain work requires explicit reconciliation and is never retried by this read.', inputSchema: schema,
    execute(args, signal) {
      allowed(signal); const changeId = argsId(args), proposal = proposals.get(changeId);
      invariant(identity(proposal.scope) === identity(bound.scope), 'Own exact audience required');
      const id = controlActivationId(bound.runId, changeId), record = controlActivationStatus(bound.store, id, bound.runId, bound.scope);
      if (!record) return { changeId, activation: null };
      resolveSubmission(bound.store, record.request);
      if (['accepted', 'rejected', 'uncertain'].includes(record.status)) {
        const watch = bound.store.get<ControlWatch>(watches, id);
        if (watch && watch.value.status !== 'reconciled') bound.store.put(watches, id, { ...watch.value, status: 'reconciled' }, watch.revision);
      }
      return { changeId, activation: publicStatus(record) };
    },
  }];
}

/** A scoped continuation of the existing author. It allocates no new run or resources. */
export class ControlAuthorContinuations {
  readonly store: OperationalStore; readonly runtime: DurableRuntime; readonly authorityStore: AuthorityStore; readonly goals: InitiativeRegistry;
  constructor(options: { store: OperationalStore; runtime: DurableRuntime; authorityStore: AuthorityStore }) {
    this.store = options.store; this.runtime = options.runtime; this.authorityStore = options.authorityStore; this.goals = new InitiativeRegistry(this.store);
  }
  #waiting(runId?: string): ControlWatch[] { return this.store.list<ControlWatch>(watches).map(row => row.value).filter(value => value.status === 'waiting' && (!runId || value.request.runId === runId)); }
  holds(runId: string): boolean { return this.#waiting(runId).length > 0; }
  eligibleRun(runId: string, hasSteering: boolean): boolean {
    const watched = this.#waiting(runId); if (!watched.length) return true;
    if (watched.some(watch => ['activating', 'reviewing'].includes(controlActivationStatus(this.store, watch.request.id, runId, watch.request.scope)?.status ?? 'pending'))) return false;
    return hasSteering;
  }
  eligibleGoal(goal: Goal): boolean {
    const runId = this.store.get<{ runId: string }>('initiative.execution', goal.id)?.value.runId;
    if (!runId) return true;
    const consumed = this.store.get<{ messageSequence?: number }>('execution', runId)?.value.messageSequence ?? 0;
    return this.eligibleRun(runId, this.store.events(runId, consumed).some(event => event.type === 'steering'));
  }
  preserveWaiting(runId: string, result: ShellResult): ShellResult { return result.status === 'completed' && this.holds(runId) ? { ...result, status: 'checkpointed' } : result; }
  /** Recover only an exact committed local return, including success-before-ledger interruption.
   * External review reservations are untouched; cancellation never revives author execution. */
  reconcileAcknowledgments(): string[] {
    const recovered: string[] = [];
    for (const { value: ack } of this.store.list<ControlAcknowledgment>(acknowledgments)) {
      const run = this.runtime.getRun(ack.request.runId); if (!run) continue;
      const serving = this.authorityStore.current(); if (!serving?.generation) continue;
      const authority: Authority = { generation: serving.generation, epoch: serving.epoch, controlRevision: serving.controlRevision };
      try { this.authorityStore.dispatch(authority, () => this.store.transaction(() => {
        const effect = this.runtime.effects.get(ack.effectId);
        if (!effect || !['uncertain', 'succeeded'].includes(effect.status)) return;
        invariant(effect.id.startsWith('tool:') && effect.kind === 'control_activate' && effect.runId === ack.request.runId &&
          identity(effect.payload) === identity(ack.payload) && identity(effect.scope) === identity(ack.request.scope) && identity(effect.authority) === identity(ack.authority) &&
          ack.payload && typeof ack.payload === 'object' && !Array.isArray(ack.payload) && ack.payload.changeId === ack.request.proposalId, 'Local control effect binding mismatch');
        const record = controlActivationStatus(this.store, ack.request.id, ack.request.runId, ack.request.scope);
        invariant(record && identity(record.request) === identity(ack.request), 'Committed exact local control request required');
        resolveSubmission(this.store, ack.request);
        const receipt = this.store.readJsonArtifact<{ changeId: string; activation: { id: string; status: string; submissionId: string; stageId: string } }>(ack.receipt);
        invariant(receipt.changeId === ack.request.proposalId && receipt.activation.id === ack.request.id && receipt.activation.submissionId === ack.request.submissionId && receipt.activation.stageId === ack.request.stageId &&
          ['pending', 'activating', 'reviewing', 'accepted', 'rejected', 'uncertain'].includes(receipt.activation.status), 'Exact local control acknowledgment required');
        if (effect.status === 'succeeded') invariant(effect.receipt && identity(this.store.readJsonArtifact(effect.receipt)) === identity(receipt), 'Succeeded control effect receipt changed');
        const reservation = this.store.get<{ request: PhysicalRequest; ceiling: { elapsedMs: number }; charged: { elapsedMs: number } }>('requests', effect.reservationId!)?.value;
        if (effect.status === 'succeeded' && reservation?.request.status === 'succeeded') return;
        invariant(reservation && reservation.request.id === effect.id && reservation.request.reservationId === effect.reservationId && reservation.request.purpose === 'reasoning' &&
          reservation.request.promptManifestId === effect.id && reservation.request.runId === effect.runId && reservation.request.provider === 'effect-receiver' && reservation.request.model === effect.kind &&
          reservation.request.requestDigest === identity({ id: effect.id.slice(5), runId: effect.runId, stepId: effect.stepId, name: effect.kind, arguments: effect.payload }) &&
          ['dispatched', 'uncertain'].includes(reservation.request.status) && identity(run.scope) === identity(ack.request.scope), 'Exact local control receiver reservation required');
        const elapsedMs = Math.max(reservation.request.usage.elapsedMs, reservation.ceiling.elapsedMs, reservation.charged.elapsedMs);
        if (effect.status === 'uncertain') this.runtime.effects.recordReconciliation(effect.id, authority, 'succeeded', ack.receipt);
        this.runtime.resources.settle({ ...reservation.request, status: 'succeeded', usage: { ...reservation.request.usage, elapsedMs } });
        this.store.append({ id: `local-control-reconciled:${effect.id}`, stream: effect.runId, type: 'local-control-reconciled', data: {
          effectId: effect.id, activationId: ack.request.id, elapsedMs, elapsedBasis: 'retained receiver charge and reservation ceiling', externalReviewRetried: false } });
        recovered.push(effect.id);
      })); } catch { /* Unbound acknowledgments never release an activation or revive a run. */ }
    }
    return recovered;
  }
  wake(): string[] {
    const resumed: string[] = [];
    for (const watch of this.#waiting()) {
      const run = this.runtime.getRun(watch.request.runId);
      if (!run || !['waiting', 'ready', 'blocked'].includes(run.status)) continue;
      try { this.authorityStore.dispatch(run.authority, () => this.store.transaction(() => {
        const row = this.store.get<ControlWatch>(watches, watch.request.id)!;
        if (row.value.status !== 'waiting') return;
        const current = this.runtime.getRun(run.id)!;
        invariant(!['completed', 'cancelled', 'running'].includes(current.status) && identity(current.scope) === identity(watch.request.scope) && identity(current.authority) === identity(run.authority), 'Original current author required');
        const record = controlActivationStatus(this.store, watch.request.id, run.id, watch.request.scope);
        if (!record || !['accepted', 'rejected'].includes(record.status) || this.runtime.effects.unresolved(run.id).length) return;
        invariant(identity(record.request) === identity(watch.request), 'Control author watch binding changed');
        const submission = resolveSubmission(this.store, watch.request);
        assertReviewLineage(this.store, submission, Date.now, current.authority);
        const execution = this.store.list<{ runId: string }>('initiative.execution').find(row => row.value.runId === run.id);
        if (execution) {
          const goal = this.goals.goal(execution.key);
          if (!goal || !['waiting', 'blocked', 'ready'].includes(goal.status) || identity(goal.scope) !== identity(watch.request.scope)) return;
          if (goal.status !== 'ready') this.goals.revise(goal.id, goal.revision, { status: 'ready' }, 'Known exact host control outcome awaits original author inspection');
        } else {
          if (this.store.get('host.child-runs', run.id) || this.store.list<{ runId: string }>('host.delivery-runs').some(row => row.value.runId === run.id)) return;
          const pending = this.store.get('host.pending-runs', run.id); this.store.put('host.pending-runs', run.id, { requestedAt: Date.now() }, pending?.revision ?? null);
        }
        this.runtime.steer(run.id, { id: `control-result:${watch.request.id}`, source: 'host.control', externalId: watch.request.id, externalRevision: '1',
          actorId: current.authority.generation, authenticated: true, scope: watch.request.scope,
          value: { event: 'control-outcome', changeId: watch.request.proposalId, activationId: watch.request.id, status: record.status,
            instruction: 'Inspect control_status for this exact host outcome and decide the next step under the current grant and original remaining allowance.' } });
        this.store.put(watches, watch.request.id, { ...row.value, status: 'notified' }, row.revision); resumed.push(run.id);
      })); } catch { /* Cancelled, expired and unbound authors remain inspectable without automatic work. */ }
    }
    return resumed;
  }
}
