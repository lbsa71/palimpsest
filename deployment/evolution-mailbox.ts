import { canonicalJson, identity, invariant, validateArtifact, validateEvaluation, type ArtifactRef, type Authority, type JsonValue } from '../packages/contracts/index.ts';
import type { ReleaseProof } from '../packages/release/controller.ts';
import { hashBytes } from '../packages/release/artifacts.ts';
import type { OperationalStore } from '../packages/storage/index.ts';
import { evolutionTools, type EvolutionContext, type EvaluationRequest, type EvaluationReceipt, type EvaluationState, type SubmissionRequest, type SubmissionReceipt } from './evolution-tools.ts';
import type { ApplicationConfig } from './config.ts';
import type { ApplicationTool } from './application.ts';
import { proposalProvenance } from './proposal-origin.ts';
import { sourceWorkspaceTools } from './source-workspace.ts';
import type { EvolutionMetadata } from './service-process.ts';
import { maxRuntimeBytes } from './runtime-bundle.ts';
import { controlTools } from './control-tools.ts';
import { rescueRotationTools } from './rescue-rotation.ts';

const namespace = 'host.evolution-jobs';
type Request = EvaluationRequest | SubmissionRequest;
type Receipt = EvaluationReceipt | SubmissionReceipt;
export interface EvolutionJob {
  id: string; kind: 'evaluation' | 'submission'; request: ArtifactRef; requestDigest: string;
  candidateId: string; policyDigest: string; authority: Authority;
  status: 'pending' | 'dispatched' | 'uncertain' | 'completed';
  receipt?: ArtifactRef; proof?: ArtifactRef;
  diagnosis?: string;
}
export interface ExternalEvaluation { receipt: EvaluationReceipt; proof: ReleaseProof }
export interface EvolutionMailboxOptions {
  store: OperationalStore;
  assertAuthority(authority: Authority): void;
  /** Host-owned content-addressed evidence resolver, e.g. contentAddressedEvidence; never a model path resolver. */
  readArtifact?(uri: string): Uint8Array;
  /** Public wait bounds are installed by the host, never selected in tool arguments. */
  waitMs?: number; pollMs?: number; maxJobBytes?: number; maxPending?: number;
}
function uncertain(message: string): Error { return Object.assign(new Error(message), { mayHaveApplied: true }); }

/** Durable author/host rendezvous. This class neither invents reviews nor signs evidence.
 * An interrupted external dispatch must be reconciled by job ID; processing never retries it.
 */
export class EvolutionMailbox {
  readonly options: EvolutionMailboxOptions;
  readonly store: OperationalStore;
  constructor(options: EvolutionMailboxOptions) {
    this.options = { waitMs: 30000, pollMs: 50, maxJobBytes: 8 * 1024 * 1024, maxPending: 32, ...options };
    this.store = options.store;
    for (const [key, maximum] of [['waitMs', 60000], ['pollMs', 1000], ['maxJobBytes', 8 * 1024 * 1024], ['maxPending', 128]] as const)
      invariant(Number.isSafeInteger(this.options[key]) && this.options[key]! > 0 && this.options[key]! <= maximum, 'Finite evolution mailbox bounds required');
  }
  status(id: string): EvolutionJob | undefined { return this.store.get<EvolutionJob>(namespace, id)?.value; }
  jobs(): EvolutionJob[] { return this.store.list<EvolutionJob>(namespace).map(row => row.value); }
  request(id: string): Request { const job = this.status(id); invariant(job, 'Unknown evolution job'); return this.store.readJsonArtifact<Request>(job.request); }
  /** Retained evidence bytes with their original signed content address, usable by the host controller. */
  readArtifact = (uri: string): Uint8Array => {
    invariant(/^(?:sha256:|aeon:artifact:)[a-f0-9]{64}$/.test(uri), 'Content-addressed mailbox evidence required');
    const sha256 = uri.split(':').at(-1)!;
    return this.store.readArtifact({ uri: `aeon:artifact:${sha256}`, sha256 });
  };
  private bounded(value: unknown): void { invariant(Buffer.byteLength(canonicalJson(value)) <= this.options.maxJobBytes!, 'Evolution payload exceeds host bounds'); }
  private enqueue(kind: EvolutionJob['kind'], request: Request): EvolutionJob {
    this.options.assertAuthority(request.proposal.authority); this.bounded(request);
    invariant(request.requestId.length > 0 && request.requestId.length <= 256 && request.policyDigest.length > 0 && request.policyDigest.length <= 256, 'Bounded evolution job identity required');
    invariant(identity(request.proposal.candidate) === identity(request.candidate.manifest), 'Evolution proposal/candidate mismatch');
    return this.store.transaction(() => {
      const existing = this.status(request.requestId), requestDigest = identity(request);
      if (existing) { invariant(existing.kind === kind && existing.requestDigest === requestDigest, 'Evolution job identity reused with different contents'); return existing; }
      invariant(this.jobs().filter(job => job.status !== 'completed').length < this.options.maxPending!, 'Evolution queue is full');
      const job: EvolutionJob = { id: request.requestId, kind, request: this.store.putJsonArtifact(request as unknown as JsonValue), requestDigest,
        candidateId: request.candidate.manifest.id, policyDigest: request.policyDigest, authority: structuredClone(request.proposal.authority), status: 'pending' };
      this.store.put(namespace, job.id, job, null); return job;
    });
  }
  private async wait<T extends Receipt>(job: EvolutionJob, signal?: AbortSignal): Promise<T> {
    const deadline = Date.now() + this.options.waitMs!;
    while (true) {
      signal?.throwIfAborted();
      const current = this.status(job.id)!;
      // A trusted controller transfer can withdraw its author before returning the durable decision.
      if (current.status === 'completed' && job.kind === 'submission') return this.store.readJsonArtifact<T>(current.receipt!);
      this.options.assertAuthority(job.authority);
      if (current.status === 'completed') return this.store.readJsonArtifact<T>(current.receipt!);
      if (Date.now() >= deadline) {
        const processor = this.store.get<{ available: boolean; diagnosis?: string }>('host.evaluation-dispatch', 'current')?.value;
        const diagnosis = job.kind === 'evaluation' && processor?.available === false ? processor.diagnosis ?? 'External evaluation unavailable: host processor is stopped' : 'A configured external evaluator/host decision is required';
        throw uncertain(`Evolution job ${job.id} remains ${current.status}; ${diagnosis}. Reconcile this stable job ID before retry.`);
      }
      await new Promise<void>((resolve, reject) => {
        const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(); };
        const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason ?? new Error('Evolution wait aborted')); };
        const timer = setTimeout(done, Math.min(this.options.pollMs!, Math.max(1, deadline - Date.now())));
        signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
      });
    }
  }
  /** Production author tools acknowledge only the committed job, never wait for a physical reviewer. */
  enqueueEvaluation = (request: EvaluationRequest, signal?: AbortSignal): EvaluationState => {
    signal?.throwIfAborted(); this.enqueue('evaluation', request); return this.readEvaluation(request);
  };
  readEvaluation = (request: EvaluationRequest): EvaluationState => {
    this.options.assertAuthority(request.proposal.authority);
    const job = this.status(request.requestId);
    invariant(job?.kind === 'evaluation' && job.requestDigest === identity(request) && identity(this.request(job.id)) === identity(request), 'Evaluation job unavailable for this exact run/candidate/policy');
    const binding = { requestId: job.id, candidateId: job.candidateId, policyDigest: job.policyDigest };
    if (job.status === 'completed') return { ...binding, status: 'completed', evaluation: this.store.readJsonArtifact<EvaluationReceipt>(job.receipt!) };
    const processor = this.store.get<{ available: boolean; diagnosis?: string }>('host.evaluation-dispatch', 'current')?.value;
    const diagnosis = job.diagnosis ?? (processor?.available === false ? processor.diagnosis ?? 'External evaluation unavailable: no qualified reviewer is configured' : undefined);
    return { ...binding, status: job.status, ...(diagnosis ? { diagnosis } : {}) };
  };
  requestEvaluation = async (request: EvaluationRequest, signal?: AbortSignal): Promise<EvaluationReceipt> => this.wait<EvaluationReceipt>(this.enqueue('evaluation', request), signal);
  submitRelease = async (request: SubmissionRequest, signal?: AbortSignal): Promise<SubmissionReceipt> => {
    const evaluated = this.status(request.evaluation.requestId);
    invariant(evaluated?.kind === 'evaluation' && evaluated.status === 'completed' && evaluated.proof &&
      identity(this.store.readJsonArtifact(evaluated.receipt!)) === identity(request.evaluation) &&
      evaluated.candidateId === request.candidate.manifest.id && evaluated.policyDigest === request.policyDigest &&
      identity(evaluated.authority) === identity(request.proposal.authority), 'Submission requires the exact externally completed evaluation job');
    const evaluatedRequest = this.request(evaluated.id) as EvaluationRequest;
    invariant(identity(evaluatedRequest.proposal) === identity(request.proposal) && identity(evaluatedRequest.candidate) === identity(request.candidate), 'Submission differs from the externally evaluated proposal');
    return this.wait<SubmissionReceipt>(this.enqueue('submission', request), signal);
  };
  private update(id: string, patch: Partial<EvolutionJob>): EvolutionJob {
    const row = this.store.get<EvolutionJob>(namespace, id); invariant(row, 'Unknown evolution job');
    const job = { ...row.value, ...patch }; this.store.put(namespace, id, job, row.revision); return job;
  }
  private claim(id: string, kind: EvolutionJob['kind']): Request {
    return this.store.transaction(() => {
      const job = this.status(id); invariant(job?.kind === kind, 'Wrong evolution job kind'); this.options.assertAuthority(job.authority);
      invariant(job.status === 'pending', 'Evolution dispatch already attempted; reconcile its stable job ID');
      this.update(id, { status: 'dispatched' }); return this.request(id);
    });
  }
  /** Mark restart-discovered dispatches uncertain; no external operation is automatically repeated. */
  recover(): string[] { return this.store.transaction(() => this.jobs().filter(job => job.status === 'dispatched').map(job => { this.update(job.id, { status: 'uncertain' }); return job.id; })); }
  /** A revoked author cannot leave a pending job monopolizing the hosted processor. No physical dispatch occurred. */
  fencePending(id: string): boolean {
    return this.store.transaction(() => {
      const job = this.status(id); invariant(job?.status === 'pending', 'Pending evolution job required');
      try { this.options.assertAuthority(job.authority); return false; }
      catch { this.update(id, { status: 'uncertain', diagnosis: 'Author authority withdrawn before dispatch; external operation was not invoked. Reconcile this job explicitly.' }); return true; }
    });
  }
  private failed(id: string): void { this.store.transaction(() => { if (this.status(id)?.status === 'dispatched') this.update(id, { status: 'uncertain' }); }); }
  async processEvaluation(id: string, evaluate: (request: EvaluationRequest, signal?: AbortSignal) => Promise<ExternalEvaluation>, signal?: AbortSignal,
    complete?: (request: EvaluationRequest, result: ExternalEvaluation) => void): Promise<void> {
    signal?.throwIfAborted(); const request = this.claim(id, 'evaluation') as EvaluationRequest;
    try { const result = await evaluate(request, signal); if (complete) complete(request, result); else this.completeEvaluation(id, result); } catch (error) { this.failed(id); throw error; }
  }
  /** Only a trusted external evaluator/operator may call this host API with an independently produced result. */
  completeEvaluation(id: string, result: ExternalEvaluation): void {
    this.bounded(result);
    this.store.transaction(() => {
      const job = this.status(id); invariant(job?.kind === 'evaluation', 'Unknown evaluation job'); this.options.assertAuthority(job.authority);
      const request = this.request(id) as EvaluationRequest, { receipt, proof } = result;
      invariant(receipt.requestId === id && receipt.candidateId === job.candidateId && receipt.policyDigest === job.policyDigest && receipt.evidence.length > 0 && receipt.evidence.length <= 32, 'External evaluation receipt binding mismatch');
      invariant(identity(proof.proposal.candidate) === identity(request.candidate.manifest) && identity(proof.proposal.priorAuthority) === identity(job.authority) &&
        proof.proposal.id === id && identity(proof.proposal.evidence) === identity(receipt.evidence), 'External release proof binding mismatch');
      invariant(proof.signed.length === receipt.evidence.length && proof.signed.every(signed => receipt.evidence.some(evidence => identity(evidence) === identity(signed.evidence)) && typeof signed.authentication === 'string' && /^[a-f0-9]{64}$/.test(signed.authentication)), 'Complete externally signed proof required');
      const artifacts: ArtifactRef[] = [proof.proposal.recoveryArtifact];
      for (const evidence of receipt.evidence) {
        validateEvaluation(evidence); invariant(evidence.candidateId === job.candidateId && evidence.controlRevision === job.authority.controlRevision && evidence.independent && evidence.evaluatorId !== job.authority.generation && evidence.evaluatorId !== request.candidate.manifest.createdBy, 'External evidence candidate/independence mismatch');
        artifacts.push(evidence.artifact, evidence.evaluatorArtifact, ...evidence.caseResults.map(value => value.observations));
      }
      let artifactBytes = 0;
      for (const artifact of new Map(artifacts.map(ref => [ref.uri, ref])).values()) {
        validateArtifact(artifact); invariant(/^(?:sha256:|aeon:artifact:)[a-f0-9]{64}$/.test(artifact.uri) && artifact.uri.split(':').at(-1) === artifact.sha256, 'Content-addressed external artifact required');
        const bytes = this.options.readArtifact ? this.options.readArtifact(artifact.uri) : this.readArtifact(artifact.uri);
        artifactBytes += bytes.byteLength; invariant(artifactBytes <= this.options.maxJobBytes! && hashBytes(bytes) === artifact.sha256, 'External artifact exceeds bounds or changed');
        this.store.putArtifact(bytes);
      }
      const receiptRef = this.store.putJsonArtifact(receipt as unknown as JsonValue), proofRef = this.store.putJsonArtifact(proof as unknown as JsonValue);
      if (job.status === 'completed') { invariant(identity(job.receipt) === identity(receiptRef) && identity(job.proof) === identity(proofRef), 'External result changed after completion'); return; }
      this.update(id, { status: 'completed', receipt: receiptRef, proof: proofRef });
    });
  }
  async processSubmission(id: string, release: (request: SubmissionRequest, proof: ReleaseProof, signal?: AbortSignal) => Promise<SubmissionReceipt>, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted(); const request = this.claim(id, 'submission') as SubmissionRequest;
    const evaluated = this.status(request.evaluation.requestId)!;
    try { this.completeSubmission(id, await release(request, this.store.readJsonArtifact<ReleaseProof>(evaluated.proof!), signal)); }
    catch (error) { this.failed(id); throw error; }
  }
  /** Reconcile a controller decision after a lost response. Transfer may already have fenced the author. */
  completeSubmission(id: string, receipt: SubmissionReceipt): void {
    this.bounded(receipt);
    this.store.transaction(() => {
      const job = this.status(id); invariant(job?.kind === 'submission' && ['dispatched', 'uncertain', 'completed'].includes(job.status), 'Submission was not dispatched');
      invariant(receipt.requestId === id && receipt.candidateId === job.candidateId && ['admitted', 'staged', 'rejected'].includes(receipt.status), 'Host submission receipt binding mismatch');
      const ref = this.store.putJsonArtifact(receipt as unknown as JsonValue);
      if (job.status === 'completed') { invariant(identity(job.receipt) === identity(ref), 'Host decision changed after completion'); return; }
      this.update(id, { status: 'completed', receipt: ref });
    });
  }
}

/** Shared by the frozen ordinary service child and deterministic host integration fixtures. */
export function ordinaryServiceTools(context: EvolutionContext, host: { config: ApplicationConfig; artifactStore: string; evolution?: EvolutionMetadata; assertAuthority(authority: Authority): void }): ApplicationTool[] {
  const { config } = host;
  const source = sourceWorkspaceTools({ applicationRoot: config.applicationRoot, workspace: context.workspace, protectedPaths: [config.stateDirectory], nodeBinary: config.nodeBinary, maxFiles: 10000, maxBytes: 50_000_000, timeoutMs: 30000, resourceLimits: config.resourceLimits });
  if (!host.evolution) return [...source, ...['model_profiles', 'governance_profile', 'change_propose', 'candidate_freeze', 'candidate_evaluate', 'release_submit', 'change_status', 'control_activate', 'control_status', 'rescue_rotate', 'rescue_status'].map(name => ({ name, description: 'Evolution is unavailable because this engineering startup has no accepted judging policy metadata.', inputSchema: { type: 'object' }, execute() { throw new Error('Evolution unavailable: host startup omitted accepted judging policy metadata'); } }))];
  const mailbox = new EvolutionMailbox({ store: context.store, assertAuthority: host.assertAuthority });
  return [...source, ...evolutionTools(context, { artifactStore: host.artifactStore, acceptedCandidateId: config.artifactId, nodeBinary: config.nodeBinary, policyDigest: host.evolution.policyDigest,
    maxFiles: 20000, maxBytes: 128 * 1024 * 1024, runtimeMaxBytes: maxRuntimeBytes, eligibleHumanAuthors: new Set([...(config.direct.modificationEligible ? [config.direct.actorId] : []), ...(config.slack?.eligibleHumanIds.map(id => `slack:${config.slack!.teamId}:${id}`) ?? [])]),
    allowedModelProfiles: host.evolution.allowedModelProfiles, reviewer: host.evolution.reviewer, assertAuthority: host.assertAuthority, provenanceForRun: proposalProvenance,
    enqueueEvaluation: mailbox.enqueueEvaluation, readEvaluation: mailbox.readEvaluation, submitRelease: mailbox.submitRelease }), ...controlTools(context, host.assertAuthority),
    ...rescueRotationTools(context, { candidateId: config.artifactId, policyDigest: host.evolution.policyDigest, assertAuthority: host.assertAuthority })];
}
