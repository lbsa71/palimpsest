import { canonicalJson, identity, invariant, type ArtifactRef, type Authority, type DataScope, type ResourceEnvelope, type Run } from '../packages/contracts/index.ts';
import type { FrozenCandidate } from '../packages/release/artifacts.ts';
import type { ReleaseProof, ReleaseState, StagedControl } from '../packages/release/controller.ts';
import { ChangeProposals, type ChangeRecord } from '../packages/release/proposals.ts';
import type { OperationalStore } from '../packages/storage/index.ts';
import { hostResourceLedger, type HostResourceOptions } from './host-resources.ts';
import type { EvolutionMailbox } from './evolution-mailbox.ts';
import type { SubmissionRequest, SubmissionReceipt, EvaluationReceipt, evolutionBackend } from './evolution-tools.ts';

const namespace = 'host.control-continuations';
class ActivationDeferred extends Error {}
export interface ControlActivationRequest {
  id: string; submissionId?: string; stageId?: string; proposalId: string; runId: string; scope: DataScope; authority: Authority;
  skinShed?: { effectId: string; workspace: string; incumbentCandidateId: string; policyDigest: string };
}
export interface StagedControlActivationRequest extends ControlActivationRequest { submissionId: string; stageId: string }
/** The proposal/submission journal owns preparation progress; the control intent stays immutable. */
export function resolveControlActivation(store: OperationalStore, request: ControlActivationRequest): StagedControlActivationRequest {
  if (!request.skinShed) {
    invariant(request.submissionId && request.stageId, 'Staged control request required');
    return request as StagedControlActivationRequest;
  }
  const proposal = new ChangeProposals(store, request.runId, request.scope).get(request.proposalId);
  invariant(proposal.state === 'submitted' && proposal.submission, 'Skin shed proposal is not staged');
  const receipt = store.readJsonArtifact<SubmissionReceipt>(proposal.submission), stageId = (receipt.receipt as { stageId?: string }).stageId;
  invariant(receipt.status === 'staged' && stageId, 'Skin shed requires its real staged receipt');
  return { ...request, submissionId: receipt.requestId, stageId };
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
function immutableAllocation(allocation: Omit<ProbationAllocation, 'id'>): Omit<ProbationAllocation, 'id'> {
  return { rootId: allocation.rootId, ...(allocation.parentRunId ? { parentRunId: allocation.parentRunId } : {}), startedAt: allocation.startedAt, envelope: allocation.envelope };
}
/** Recheck under the host's authority/operational write locks at the acceptance boundary. */
export function assertProbationLineage(store: OperationalStore, review: ProbationReviewRequest, options: HostResourceOptions = {}): void {
  const ledger = hostResourceLedger(store, { tokens: 0, costUsd: 0, elapsedMs: 0 }, options), now = options.now ?? ledger.now;
  const run = store.get<Run>('runs', review.proposal.runId)?.value;
  invariant(run && run.status !== 'cancelled' && identity(run.scope) === identity(review.proposal.scope), 'Probation author cancelled or unavailable');
  invariant(!ledger.snapshot(run.id).cancelled, 'Probation allowance cancelled');
  for (const expected of review.allocationLineage) {
    const allocation = store.get<Omit<ProbationAllocation, 'id'> & { cancelled: boolean; elapsedFloorMs?: number }>('allocations', expected.id)?.value;
    invariant(allocation && !allocation.cancelled, 'Probation allocation cancelled or unavailable');
    const limit = ledger.effectiveEnvelope(expected.id).maxElapsedMs;
    invariant(identity(immutableAllocation(allocation)) === identity(immutableAllocation(expected)) &&
      (limit === null || Math.max(0, now() - allocation.startedAt, allocation.elapsedFloorMs ?? 0) < limit),
      'Probation lineage changed or expired');
  }
}
export interface ControlContinuationRecord {
  request: ControlActivationRequest;
  status: 'pending' | 'freezing' | 'interviewing' | 'activating' | 'reviewing' | 'accepted' | 'rejected' | 'uncertain';
  review?: ProbationReviewRequest; physicalAuthority?: Authority; proofId?: string; probationProof?: ArtifactRef; diagnosis?: string;
}
function boundRun(store: OperationalStore, request: ControlActivationRequest): void {
  const run = store.get<Run>('runs', request.runId)?.value;
  invariant(run && run.status !== 'cancelled' && identity(run.authority) === identity(request.authority) &&
    identity(run.scope) === identity(request.scope), 'Control activation author is cancelled, absent, stale or outside its audience');
}
/** Under authority then operational write locks, immediately around actual withdrawal. */
export function assertControlActivationClaim(store: OperationalStore, stageId: string, review: ProbationReviewRequest, options: HostResourceOptions = {}): void {
  const record = store.get<ControlContinuationRecord>(namespace, review.activationId)?.value;
  invariant(record?.status === 'activating' && identity(record.review) === identity(review) && resolveControlActivation(store, record.request).stageId === stageId &&
    record.request.id === review.activationId && review.id === `probation:${identity(record.request)}` &&
    record.request.runId === review.proposal.runId && record.request.proposalId === review.proposal.id &&
    identity(record.request.scope) === identity(review.proposal.scope) && identity(record.request.authority) === identity(review.judgeAuthority),
  'Exact activating control reservation required');
  boundRun(store, record.request); assertProbationLineage(store, review, options);
  invariant(store.get<Run>('runs', record.request.runId)?.value.status !== 'running', 'Control producer is still running');
}
/** Ordinary tools may enqueue this exact binding after their own effect acknowledgement.
 * The trusted host independently resolves the staged submission before any activation. */
export function enqueueControlActivation(store: OperationalStore, request: ControlActivationRequest, signal?: AbortSignal): ControlContinuationRecord {
  signal?.throwIfAborted();
  const expected = request.skinShed ? 'authority,id,proposalId,runId,scope,skinShed' : 'authority,id,proposalId,runId,scope,stageId,submissionId';
  invariant(request && Object.keys(request).sort().join(',') === expected &&
    [request.id, request.proposalId, request.runId].every(id => typeof id === 'string' && id.length > 0 && id.length <= 256), 'Exact bounded control intent required');
  if (request.skinShed) invariant(Object.keys(request.skinShed).sort().join(',') === 'effectId,incumbentCandidateId,policyDigest,workspace' &&
    Object.values(request.skinShed).every(value => typeof value === 'string' && value.length > 0), 'Exact skin shed host binding required');
  else resolveControlActivation(store, request);
  return store.transaction(() => {
    boundRun(store, request);
    const row = store.get<ControlContinuationRecord>(namespace, request.id);
    if (row) { invariant(identity(row.value.request) === identity(request), 'Control activation identity reused with different contents'); return row.value; }
    invariant(store.list<ControlContinuationRecord>(namespace).filter(row => ['pending', 'freezing', 'interviewing', 'activating', 'reviewing'].includes(row.value.status)).length < 32, 'Control activation queue is full');
    const record: ControlContinuationRecord = { request: structuredClone(request), status: 'pending' };
    store.put(namespace, request.id, record, null); return record;
  });
}
export function controlActivationStatus(store: OperationalStore, id: string, runId: string, scope: DataScope): ControlContinuationRecord | undefined {
  const record = store.get<ControlContinuationRecord>(namespace, id)?.value;
  invariant(!record || (record.request.runId === runId && identity(record.request.scope) === identity(scope)), 'Control activation unavailable for this run/audience');
  return record;
}
export interface ControlContinuationOptions extends HostResourceOptions {
  store: OperationalStore; mailbox: EvolutionMailbox;
  status(): ReleaseState; stagedControl(id: string): StagedControl | undefined;
  assertAuthority(authority: Authority): void;
  /** Check external reviewer availability and the activation tool's completed local ack. */
  readyToActivate?(request: ControlActivationRequest): boolean;
  /** Reserve once BEFORE withdrawal, under the existing author lineage. Never allocate a new budget. */
  reserveProbation(request: ProbationReviewRequest, commitReservation: () => void): void;
  /** Release only this exact logical reservation; preserve uncertain physical outcomes. */
  finishProbation?(request: ProbationReviewRequest): void;
  reviewProbation(request: RunningProbationReview, signal: AbortSignal): Promise<ReleaseProof>;
  /** Optional preparation of ordinary skin_shed intents inside this SAME host continuation. */
  canProcess?(): boolean;
  handoffPending?(): boolean;
  accepted?(record: ControlContinuationRecord): boolean;
  readyToPrepare?(request: ControlActivationRequest): boolean;
  evolution?(request: ControlActivationRequest): ReturnType<typeof evolutionBackend>;
  interview?(request: ControlActivationRequest, candidate: FrozenCandidate, stageId: string, signal: AbortSignal): Promise<boolean>;
  interviewApproved?(request: ControlActivationRequest): boolean;
  /** Actual cognitive approval is additional to the independent signed source review. */
  beforeActivate?(request: ControlActivationRequest): void;
  observeProbation?(request: RunningProbationReview, proof: ReleaseProof, signal: AbortSignal): Promise<'accept' | 'regression' | 'inconclusive' | undefined>;
  recoverRegression?(request: RunningProbationReview): Promise<void>;
  activate(stageId: string, review: ProbationReviewRequest): Promise<Authority>; acceptProbation(proof: ReleaseProof, review: RunningProbationReview): Promise<void>;
}
/** Finite host continuation. Caller withdrawal cannot cancel an accepted activation request.
 * Interrupted activation/review is retained uncertain and never repeated on restart. */
export class ControlContinuation {
  readonly options: ControlContinuationOptions;
  readonly #abort = new AbortController();
  #loop?: Promise<void>; #processing = false;
  constructor(options: ControlContinuationOptions) {
    this.options = options;
    for (const row of options.store.list<ControlContinuationRecord>(namespace)) {
      if (row.value.status === 'reviewing' && options.accepted?.(row.value)) this.#update(row.value.request.id, { status: 'accepted' });
      else if (['freezing', 'interviewing', 'activating', 'reviewing'].includes(row.value.status)) this.#update(row.value.request.id,
        { status: 'uncertain', diagnosis: 'Host continuation interrupted; inspect retained controller history and reconcile this ID before any retry' });
    }
  }
  records(): ControlContinuationRecord[] { return this.options.store.list<ControlContinuationRecord>(namespace).map(row => row.value); }
  #update(id: string, patch: Partial<ControlContinuationRecord>): void {
    const row = this.options.store.get<ControlContinuationRecord>(namespace, id); invariant(row, 'Missing control activation request');
    this.options.store.put(namespace, id, { ...row.value, ...patch }, row.revision);
  }
  #resolve(request: ControlActivationRequest): { submission: SubmissionRequest; stage: StagedControl; activation: StagedControlActivationRequest } {
    const { store, mailbox } = this.options;
    boundRun(store, request); this.options.assertAuthority(request.authority);
    const activation = resolveControlActivation(store, request);
    const job = mailbox.status(activation.submissionId);
    invariant(job?.kind === 'submission' && job.status === 'completed' && job.receipt, 'Control activation requires a completed staged submission');
    const receipt = store.readJsonArtifact<SubmissionReceipt>(job.receipt);
    invariant(receipt.status === 'staged' && receipt.requestId === activation.submissionId &&
      (receipt.receipt as { stageId?: string }).stageId === activation.stageId, 'Control activation differs from the staged host receipt');
    const submission = mailbox.request(activation.submissionId) as SubmissionRequest, stage = this.options.stagedControl(activation.stageId);
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
    return { submission, stage, activation };
  }
  async #prepare(request: ControlActivationRequest): Promise<boolean> {
    if (!request.skinShed || this.options.interviewApproved?.(request)) return true;
    if (this.options.readyToPrepare && !this.options.readyToPrepare(request)) return false;
    invariant(this.options.evolution && this.options.interview, 'Skin shed is unavailable');
    const backend = this.options.evolution(request), proposals = new ChangeProposals(this.options.store, request.runId, request.scope);
    let proposal = proposals.get(request.proposalId);
    if (proposal.state === 'proposed') {
      const claimed = this.options.store.transaction(() => {
        this.options.assertAuthority(request.authority);
        if (this.options.readyToPrepare && !this.options.readyToPrepare(request)) return false;
        this.#update(request.id, { status: 'freezing' }); return true;
      });
      if (!claimed) return false;
      await backend.freeze(request.proposalId);
      this.#update(request.id, { status: 'pending' }); proposal = proposals.get(request.proposalId);
    }
    if (['frozen', 'evaluation-dispatched'].includes(proposal.state)) {
      const evaluation = this.options.store.transaction(() => this.options.mailbox.enqueueEvaluation(backend.evaluation(request.proposalId)));
      if (evaluation.status === 'uncertain') { this.#update(request.id, { status: 'uncertain', diagnosis: 'Independent review outcome is unresolved; inspect the original job' }); return false; }
      if (evaluation.status !== 'completed') return false;
      const receipt = evaluation.evaluation;
      backend.evaluated(request.proposalId, receipt);
      if (!receipt.evidence.every(evidence => evidence.verdict === 'pass')) { this.#update(request.id, { status: 'rejected', diagnosis: 'Independent review did not pass; inspect change_status' }); return false; }
      proposal = proposals.get(request.proposalId);
    }
    if (['evaluated', 'submission-dispatched'].includes(proposal.state)) {
      const submission = this.options.store.transaction(() => this.options.mailbox.enqueueSubmission(backend.submission(request.proposalId)));
      if (submission.status === 'uncertain') { this.#update(request.id, { status: 'uncertain', diagnosis: 'Staged submission outcome is unresolved; inspect the original job' }); return false; }
      if (submission.status !== 'completed') return false;
      invariant(submission.receipt, 'Completed submission has no receipt');
      const receipt = this.options.store.readJsonArtifact<SubmissionReceipt>(submission.receipt);
      backend.submitted(request.proposalId, receipt);
      if (receipt.status !== 'staged') { this.#update(request.id, { status: 'rejected', diagnosis: 'The supervisor did not stage this proposal' }); return false; }
    }
    const { submission, stage, activation } = this.#resolve(request);
    this.#update(request.id, { status: 'interviewing' });
    if (!await this.options.interview(request, submission.candidate, activation.stageId, this.#abort.signal)) {
      this.#update(request.id, { status: 'rejected', diagnosis: 'The incumbent or successor declined succession; inspect the retained dialogue' }); return false;
    }
    this.#update(request.id, { status: 'pending' }); return true;
  }
  async processPending(): Promise<void> {
    if (this.#processing || this.#abort.signal.aborted || this.options.canProcess?.() === false) return;
    const pending = this.records().find(record => record.status === 'pending'); if (!pending) return;
    this.#processing = true;
    let started = false, reservedReview: ProbationReviewRequest | undefined;
    try {
      const request = pending.request;
      if (!await this.#prepare(request)) return;
      const { submission, stage, activation } = this.#resolve(request);
      if (this.options.readyToActivate && !this.options.readyToActivate(request)) return;
      this.options.beforeActivate?.(request);
      const review = this.options.store.transaction(() => {
        this.#resolve(request); this.#abort.signal.throwIfAborted();
        const ledger = hostResourceLedger(this.options.store, { tokens: 0, costUsd: 0, elapsedMs: 0 }, this.options), now = this.options.now ?? ledger.now;
        invariant(!ledger.snapshot(request.runId).cancelled, 'Probation allowance cancelled');
        const allocationLineage: ProbationAllocation[] = [];
        let id: string | undefined = request.runId;
        while (id) {
          invariant(allocationLineage.length < 128 && !allocationLineage.some(value => value.id === id), 'Bounded acyclic probation allocation lineage required');
          const allocation: (Omit<ProbationAllocation, 'id'> & { cancelled: boolean; elapsedFloorMs?: number }) | undefined = this.options.store.get<Omit<ProbationAllocation, 'id'> & { cancelled: boolean; elapsedFloorMs?: number }>('allocations', id)?.value;
          invariant(allocation && !allocation.cancelled, 'Probation allocation expired or cancelled');
          const limit = ledger.effectiveEnvelope(id).maxElapsedMs;
          invariant(limit === null || Math.max(0, now() - allocation.startedAt, allocation.elapsedFloorMs ?? 0) < limit, 'Probation allocation expired or cancelled');
          allocationLineage.push({ id, ...immutableAllocation(allocation) }); id = allocation.parentRunId;
        }
        const state = this.options.status();
        const review: ProbationReviewRequest = { id: `probation:${identity(request)}`, activationId: request.id,
          proposal: structuredClone(submission.proposal), candidate: structuredClone(submission.candidate),
          policyDigest: submission.policyDigest, judgeAuthority: structuredClone(request.authority), rescueCandidateId: state.accepted.candidateId,
          admissionEvidenceIds: stage.proof.proposal.evidence.map(value => value.id), allocationLineage, reservedAt: now() };
        return review;
      });
      // The reviewer obtains authority then operational write locks. Never invert that order
      // by calling it from our operational transaction. Its callback and reservation commit
      // together, excluding a concurrent producer start without holding locks across awaits.
      reservedReview = review;
      this.options.reserveProbation(review, () => {
        // The reservation owner holds authority then operational write locks here. The
        // runtime checks its host gate under this same operational lock before running.
        this.#resolve(request); this.#abort.signal.throwIfAborted(); assertProbationLineage(this.options.store, review, this.options);
        if (this.options.store.get<Run>('runs', request.runId)?.value.status === 'running' ||
          this.options.readyToActivate && !this.options.readyToActivate(request)) throw new ActivationDeferred();
        const current = controlActivationStatus(this.options.store, request.id, request.runId, request.scope);
        invariant(current?.status === 'pending' && identity(current.request) === identity(request), 'Exact pending activation required');
        this.#update(request.id, { status: 'activating', review });
      });
      const claimed = controlActivationStatus(this.options.store, request.id, request.runId, request.scope);
      invariant(claimed?.status === 'activating' && identity(claimed.review) === identity(review), 'Atomic activation reservation claim required');
      started = true;
      const physicalAuthority = await this.options.activate(activation.stageId, review);
      const state = this.options.status();
      invariant(state.phase === 'probation' && state.active.candidateId === review.candidate.manifest.id &&
        identity(state.probationJudge?.authority && { generation: state.probationJudge.authority.generation, epoch: state.probationJudge.authority.epoch, controlRevision: state.probationJudge.authority.controlRevision }) === identity(review.judgeAuthority) &&
        state.probationJudge?.policyDigest === review.policyDigest &&
        state.probationJudge.change === (review.candidate.manifest.controls === review.judgeAuthority.controlRevision ? 'ordinary' : 'control-upgrade'),
      'Staged probation differs from the original host review request');
      this.#update(request.id, { status: 'reviewing', physicalAuthority });
      const proof = await this.options.reviewProbation({ ...review, physicalAuthority }, this.#abort.signal);
      const bytes = Buffer.from(canonicalJson(proof)); invariant(bytes.length <= 8 * 1024 * 1024, 'Bounded probation proof required');
      this.#update(request.id, { probationProof: this.options.store.putArtifact(bytes), proofId: proof.proposal.id });
      invariant(proof.proposal.id === review.id && identity(proof.proposal.priorAuthority) === identity(review.judgeAuthority) &&
        identity(proof.proposal.candidate) === identity(review.candidate.manifest) &&
        proof.proposal.evidence.every(value => !review.admissionEvidenceIds.includes(value.id)), 'Probation review requires fresh original-policy signed evidence');
      this.options.assertAuthority(physicalAuthority);
      const running = { ...review, physicalAuthority };
      const observation = await this.options.observeProbation?.(running, proof, this.#abort.signal);
      if (observation === 'inconclusive') {
        this.#update(request.id, { status: 'uncertain', diagnosis: 'Incumbent observation is inconclusive; retain probation and reconcile evidence without automatic acceptance or rollback' }); return;
      }
      if (observation === 'regression') {
        invariant(this.options.recoverRegression, 'Substantiated regression requires supervised current-history recovery');
        await this.options.recoverRegression(running);
        this.#update(request.id, { status: 'rejected', diagnosis: 'Incumbent reported substantiated successor regression; supervisor recovered using current operational history' }); return;
      }
      this.options.assertAuthority(physicalAuthority);
      await this.options.acceptProbation(proof, running);
      if (!this.options.handoffPending?.()) this.#update(request.id, { status: 'accepted' });
    } catch (error) {
      if (error instanceof ActivationDeferred) return;
      const unresolved = started || ['freezing', 'interviewing'].includes(this.records().find(record => record.request.id === pending.request.id)!.status);
      this.#update(pending.request.id, { status: unresolved ? 'uncertain' : 'rejected', diagnosis: unresolved ?
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
