import { canonicalJson, identity, invariant, type ArtifactRef, type Authority, type DataScope, type ResourceEnvelope, type Run } from '../packages/contracts/index.ts';
import type { FrozenCandidate } from '../packages/release/artifacts.ts';
import type { ReleaseProof, ReleaseState, StagedControl } from '../packages/release/controller.ts';
import type { ChangeRecord } from '../packages/release/proposals.ts';
import type { OperationalStore } from '../packages/storage/index.ts';
import { ResourceLedger } from '../packages/runtime/resources/index.ts';
import type { EvolutionMailbox } from './evolution-mailbox.ts';
import type { SubmissionRequest, SubmissionReceipt } from './evolution-tools.ts';

const namespace = 'host.control-continuations';
export interface ControlActivationRequest {
  id: string; submissionId: string; stageId: string; proposalId: string; runId: string; scope: DataScope; authority: Authority;
}
export interface ProbationAllocation {
  id: string; rootId: string; parentRunId?: string; startedAt: number; envelope: ResourceEnvelope;
}
/** Host-issued context. Judgment remains with the original policy; physical execution uses
 * the successor's live grant and the unchanged, pre-reserved author allocation lineage. */
export interface ProbationReviewRequest {
  id: string; activationId: string; proposal: ChangeRecord; candidate: FrozenCandidate;
  policyDigest: string; judgeAuthority: Authority; rescueCandidateId: string;
  admissionEvidenceIds: string[]; allocationLineage: ProbationAllocation[]; reservedAt: number;
}
export type RunningProbationReview = ProbationReviewRequest & { physicalAuthority: Authority };
/** Recheck under the host's authority/operational write locks at the acceptance boundary. */
export function assertProbationLineage(store: OperationalStore, review: ProbationReviewRequest): void {
  const run = store.get<Run>('runs', review.proposal.runId)?.value;
  invariant(run && run.status !== 'cancelled' && identity(run.scope) === identity(review.proposal.scope), 'Probation author cancelled or unavailable');
  invariant(!new ResourceLedger(store, { tokens: 0, costUsd: 0, elapsedMs: 0 }).snapshot(run.id).cancelled, 'Probation allowance cancelled');
  for (const expected of review.allocationLineage) {
    const allocation = store.get<Omit<ProbationAllocation, 'id'> & { cancelled: boolean }>('allocations', expected.id)?.value;
    invariant(allocation && !allocation.cancelled, 'Probation allocation cancelled or unavailable');
    const { cancelled: _, ...fields } = allocation;
    invariant(identity({ id: expected.id, ...fields }) === identity(expected) && Date.now() - allocation.startedAt < allocation.envelope.maxElapsedMs,
      'Probation lineage changed or expired');
  }
}
export interface ControlContinuationRecord {
  request: ControlActivationRequest;
  status: 'pending' | 'activating' | 'reviewing' | 'accepted' | 'rejected' | 'uncertain';
  review?: ProbationReviewRequest; physicalAuthority?: Authority; proofId?: string; probationProof?: ArtifactRef; diagnosis?: string;
}
function boundRun(store: OperationalStore, request: ControlActivationRequest): void {
  const run = store.get<Run>('runs', request.runId)?.value;
  invariant(run && run.status !== 'cancelled' && identity(run.authority) === identity(request.authority) &&
    identity(run.scope) === identity(request.scope), 'Control activation author is cancelled, absent, stale or outside its audience');
}
/** Ordinary tools may enqueue this exact binding after their own effect acknowledgement.
 * The trusted host independently resolves the staged submission before any activation. */
export function enqueueControlActivation(store: OperationalStore, request: ControlActivationRequest, signal?: AbortSignal): ControlContinuationRecord {
  signal?.throwIfAborted();
  invariant(request && Object.keys(request).sort().join(',') === 'authority,id,proposalId,runId,scope,stageId,submissionId' &&
    [request.id, request.submissionId, request.stageId, request.proposalId, request.runId].every(id => typeof id === 'string' && id.length > 0 && id.length <= 256), 'Exact bounded control activation binding required');
  return store.transaction(() => {
    boundRun(store, request);
    const row = store.get<ControlContinuationRecord>(namespace, request.id);
    if (row) { invariant(identity(row.value.request) === identity(request), 'Control activation identity reused with different contents'); return row.value; }
    invariant(store.list<ControlContinuationRecord>(namespace).filter(row => ['pending', 'activating', 'reviewing'].includes(row.value.status)).length < 32, 'Control activation queue is full');
    const record: ControlContinuationRecord = { request: structuredClone(request), status: 'pending' };
    store.put(namespace, request.id, record, null); return record;
  });
}
export function controlActivationStatus(store: OperationalStore, id: string, runId: string, scope: DataScope): ControlContinuationRecord | undefined {
  const record = store.get<ControlContinuationRecord>(namespace, id)?.value;
  invariant(!record || (record.request.runId === runId && identity(record.request.scope) === identity(scope)), 'Control activation unavailable for this run/audience');
  return record;
}
export interface ControlContinuationOptions {
  store: OperationalStore; mailbox: EvolutionMailbox;
  status(): ReleaseState; stagedControl(id: string): StagedControl | undefined;
  assertAuthority(authority: Authority): void;
  /** Check external reviewer availability and the activation tool's completed local ack. */
  readyToActivate?(request: ControlActivationRequest): boolean;
  /** Reserve once BEFORE withdrawal, under the existing author lineage. Never allocate a new budget. */
  reserveProbation(request: ProbationReviewRequest): void;
  /** Release only this exact logical reservation; preserve uncertain physical outcomes. */
  finishProbation?(request: ProbationReviewRequest): void;
  reviewProbation(request: RunningProbationReview, signal: AbortSignal): Promise<ReleaseProof>;
  activate(stageId: string): Promise<Authority>; acceptProbation(proof: ReleaseProof, review: RunningProbationReview): Promise<void>;
}
/** Finite host continuation. Caller withdrawal cannot cancel an accepted activation request.
 * Interrupted activation/review is retained uncertain and never repeated on restart. */
export class ControlContinuation {
  readonly options: ControlContinuationOptions;
  readonly #abort = new AbortController();
  #loop?: Promise<void>; #processing = false;
  constructor(options: ControlContinuationOptions) {
    this.options = options;
    for (const row of options.store.list<ControlContinuationRecord>(namespace))
      if (['activating', 'reviewing'].includes(row.value.status)) this.#update(row.value.request.id,
        { status: 'uncertain', diagnosis: 'Host continuation interrupted; inspect retained controller history and reconcile this ID before any retry' });
  }
  records(): ControlContinuationRecord[] { return this.options.store.list<ControlContinuationRecord>(namespace).map(row => row.value); }
  #update(id: string, patch: Partial<ControlContinuationRecord>): void {
    const row = this.options.store.get<ControlContinuationRecord>(namespace, id); invariant(row, 'Missing control activation request');
    this.options.store.put(namespace, id, { ...row.value, ...patch }, row.revision);
  }
  #resolve(request: ControlActivationRequest): { submission: SubmissionRequest; stage: StagedControl } {
    const { store, mailbox } = this.options;
    boundRun(store, request); this.options.assertAuthority(request.authority);
    const job = mailbox.status(request.submissionId);
    invariant(job?.kind === 'submission' && job.status === 'completed' && job.receipt, 'Control activation requires a completed staged submission');
    const receipt = store.readJsonArtifact<SubmissionReceipt>(job.receipt);
    invariant(receipt.status === 'staged' && receipt.requestId === request.submissionId &&
      (receipt.receipt as { stageId?: string }).stageId === request.stageId, 'Control activation differs from the staged host receipt');
    const submission = mailbox.request(request.submissionId) as SubmissionRequest, stage = this.options.stagedControl(request.stageId);
    invariant(stage && submission.proposal.id === request.proposalId && submission.proposal.runId === request.runId &&
      identity(submission.proposal.scope) === identity(request.scope) && identity(submission.proposal.authority) === identity(request.authority) &&
      identity(stage.proof.proposal.priorAuthority) === identity(request.authority) &&
      identity(stage.proof.proposal.candidate) === identity(submission.candidate.manifest) && receipt.candidateId === submission.candidate.manifest.id &&
      stage.nextPolicyDigest === (receipt.receipt as { policyDigest?: string }).policyDigest, 'Control activation exact proposal/stage binding mismatch');
    const evaluated = mailbox.status(submission.evaluation.requestId);
    invariant(evaluated?.proof && identity(store.readJsonArtifact(evaluated.proof)) === identity(stage.proof), 'Control stage differs from the original independent signed proof');
    const current = this.options.status();
    invariant(current.phase === 'accepted' && identity(current.authority) === identity(stage.priorAuthority) &&
      current.active.policyDigest === submission.policyDigest, 'Control activation has stale stage authority or judging policy');
    return { submission, stage };
  }
  async processPending(): Promise<void> {
    if (this.#processing || this.#abort.signal.aborted) return;
    const pending = this.records().find(record => record.status === 'pending'); if (!pending) return;
    this.#processing = true;
    let started = false, reservedReview: ProbationReviewRequest | undefined;
    try {
      const request = pending.request;
      const { submission, stage } = this.#resolve(request);
      if (this.options.readyToActivate && !this.options.readyToActivate(request)) return;
      const review = this.options.store.transaction(() => {
        this.#resolve(request); this.#abort.signal.throwIfAborted();
        const allocationLineage: ProbationAllocation[] = [];
        let id: string | undefined = request.runId;
        while (id) {
          invariant(allocationLineage.length < 128 && !allocationLineage.some(value => value.id === id), 'Bounded acyclic probation allocation lineage required');
          const allocation: (Omit<ProbationAllocation, 'id'> & { cancelled: boolean }) | undefined = this.options.store.get<Omit<ProbationAllocation, 'id'> & { cancelled: boolean }>('allocations', id)?.value;
          invariant(allocation && !allocation.cancelled && Date.now() - allocation.startedAt < allocation.envelope.maxElapsedMs, 'Probation allocation expired or cancelled');
          const { cancelled: _, ...fields } = allocation; allocationLineage.push({ id, ...fields }); id = allocation.parentRunId;
        }
        const state = this.options.status();
        const review: ProbationReviewRequest = { id: `probation:${identity(request)}`, activationId: request.id,
          proposal: structuredClone(submission.proposal), candidate: structuredClone(submission.candidate),
          policyDigest: submission.policyDigest, judgeAuthority: structuredClone(request.authority), rescueCandidateId: state.accepted.candidateId,
          admissionEvidenceIds: stage.proof.proposal.evidence.map(value => value.id), allocationLineage, reservedAt: Date.now() };
        return review;
      });
      // The reviewer obtains authority then operational write locks. Never invert that order
      // by calling it from our operational transaction. A crash in this gap leaves a used
      // reservation: recovery cannot replay it, and no authority transfer has occurred.
      reservedReview = review;
      this.options.reserveProbation(review);
      this.#update(request.id, { status: 'activating', review });
      started = true;
      const physicalAuthority = await this.options.activate(request.stageId);
      const state = this.options.status();
      invariant(state.phase === 'probation' && state.active.candidateId === review.candidate.manifest.id &&
        identity(state.probationJudge?.authority && { generation: state.probationJudge.authority.generation, epoch: state.probationJudge.authority.epoch, controlRevision: state.probationJudge.authority.controlRevision }) === identity(review.judgeAuthority) &&
        state.probationJudge?.policyDigest === review.policyDigest, 'Control probation differs from the original host review request');
      this.#update(request.id, { status: 'reviewing', physicalAuthority });
      const proof = await this.options.reviewProbation({ ...review, physicalAuthority }, this.#abort.signal);
      const bytes = Buffer.from(canonicalJson(proof)); invariant(bytes.length <= 8 * 1024 * 1024, 'Bounded probation proof required');
      this.#update(request.id, { probationProof: this.options.store.putArtifact(bytes), proofId: proof.proposal.id });
      invariant(proof.proposal.id === review.id && identity(proof.proposal.priorAuthority) === identity(review.judgeAuthority) &&
        identity(proof.proposal.candidate) === identity(review.candidate.manifest) &&
        proof.proposal.evidence.every(value => !review.admissionEvidenceIds.includes(value.id)), 'Probation review requires fresh original-policy signed evidence');
      this.options.assertAuthority(physicalAuthority);
      await this.options.acceptProbation(proof, { ...review, physicalAuthority });
      this.#update(request.id, { status: 'accepted' });
    } catch {
      this.#update(pending.request.id, { status: started ? 'uncertain' : 'rejected', diagnosis: started ?
        'Control activation or probation did not complete; inspect retained controller/review evidence and reconcile this ID' :
        'Control activation rejected before authority transfer; inspect the exact stage, author and remaining allowance' });
    } finally {
      try { if (reservedReview) this.options.finishProbation?.(reservedReview); }
      finally { this.#processing = false; }
    }
  }
  start(): void {
    invariant(!this.#loop, 'Control continuation already started');
    this.#loop = (async () => { while (!this.#abort.signal.aborted) {
      await this.processPending();
      if (!this.#abort.signal.aborted) await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); this.#abort.signal.removeEventListener('abort', done); resolve(); };
        const timer = setTimeout(done, 50); this.#abort.signal.addEventListener('abort', done, { once: true });
      });
    } })();
  }
  async close(): Promise<void> { this.#abort.abort(); await this.#loop; }
}
