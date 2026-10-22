import { validateModelGrants, type ModelProfile } from './model-grants.ts';
import { DerivedPolicyRegistry } from './policy-registry.ts';
import { ReviewerRegistry } from './reviewer-registry.ts';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { identity, invariant, type Authority, type Run, type PhysicalRequest } from '../packages/contracts/index.ts';
import { admitCandidate, type AdmissionPolicy } from '../packages/release/admission.ts';
import { hashBytes } from '../packages/release/artifacts.ts';
import { policyDescriptor, ReleaseController, type ReleaseProof, type ReleaseState, type ReleaseTarget } from '../packages/release/controller.ts';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import { ProcessLease } from '../packages/supervisor/process-lease.ts';
import { assertResourceConfinement, initializeResourceDelegation } from '../packages/supervisor/resource-limits.ts';
import { verifyApplication } from './candidate.ts';
import { beneath, selectedProviderKey, type ApplicationSecrets } from './config.ts';
import { assertPrivateHostDirectory, readHostFile } from './host-policy.ts';
import { materializeConfiguration, type HostBindings } from './materialize.ts';
import { ServiceProcess, type EvolutionMetadata, type ServiceReady } from './service-process.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { EvolutionMailbox, ordinaryEvolutionBackend } from './evolution-mailbox.ts';
import { EvaluationDispatcher, loadReviewerFile, type DispatchStatus, type ReviewerFile } from './evaluation-dispatch.ts';
import { assertControlActivationClaim, assertProbationLineage, resolveControlActivation, ControlContinuation, enqueueControlActivation, type ControlActivationRequest, type ControlContinuationOptions, type ControlContinuationRecord, type ProbationReviewRequest, type RunningProbationReview } from './control-continuation.ts';
import { controlActivationAcknowledgmentPending } from './control-tools.ts';
import { RescueRotationHost, type RescueRotationOptions, type RescueRotationRecord } from './rescue-rotation.ts';
import { ResourceLedger, type AllowanceAmendment } from '../packages/runtime/resources/index.ts';
import type { HostResourceLedgerFactory } from './host-resources.ts';
import { engineeringPlanMount, runEngineeringReview, type EngineeringReviewOptions } from './engineering-review.ts';
import { providerGateway } from './provider-gateway.ts';
import { SuccessionHost, nodeSuccessionHostEnvironment, type SuccessionHostOptions } from './succession-host.ts';
import { codingWritesPending } from './coding-limb.ts';
import { ChangeProposals } from '../packages/release/proposals.ts';
import type { SuccessionBinding } from './succession-dialogue.ts';

export interface SupervisorOptions {
  host: HostBindings;
  secrets: ApplicationSecrets;
  mode: 'engineering' | 'product';
  getPolicy(digest: string): AdmissionPolicy;
  readArtifact(uri: string): Uint8Array;
  hostRescue?: ReleaseTarget;
  onHostAccepted?(target: ReleaseTarget, previous: ReleaseTarget): void;
  bootstrap?: { proof: ReleaseProof; policyDigest: string } | (() => { proof: ReleaseProof; policyDigest: string });
  allowedModelProfiles?: ModelProfile[];
  evaluationDispatcher?: { reviewerFile: string; policyDigests: readonly string[] };
  /** Trusted transport/clock/filesystem ports for the source-bound engineering reviewer. */
  engineeringReview?: Pick<EngineeringReviewOptions, 'performRequest' | 'timeoutSignal' | 'runCommand' | 'environment'>;
  /** Host-owned reviewer seam. Ordinary callers may only enqueue exact staged bindings. */
  controlReview?: Pick<ControlContinuationOptions, 'reserveProbation' | 'reviewProbation' | 'readyToActivate' | 'finishProbation'>;
  /** Explicit request only; the installed bootstrap checks current acceptance and boot readiness. */
  rotateRescue?: RescueRotationOptions['rotate'];
  /** Trusted composition seams; never supplied through model tools or candidate JSON. */
  succession?: Pick<SuccessionHostOptions, 'environment' | 'performRequest' | 'now'>;
}
export interface SupervisorStatus {
  coordinator: { processId: number; module: string };
  mode: SupervisorOptions['mode'];
  qualification: 'engineering-only' | 'product-policy';
  running: boolean;
  processId?: number;
  ready?: ServiceReady;
  release?: ReleaseState;
  failure?: string;
  evaluation?: DispatchStatus;
  controls?: { total: number; recent: { id: string; status: ControlContinuationRecord['status']; candidateId?: string; diagnosis?: string }[] };
  rescueRotations?: { total: number; recent: { id: string; status: RescueRotationRecord['status']; candidateId: string; diagnosis?: string }[] };
}
export type SupervisorCommand =
  | { kind: 'status' }
  | { kind: 'release'; proof: ReleaseProof }
  | { kind: 'recover' }
  | { kind: 'probation'; proof: ReleaseProof }
  | { kind: 'stage-control'; proof: ReleaseProof; policyDigest: string }
  | { kind: 'activate-control'; stageId: string };

/** Validate before opening journals or executing any candidate-owned host code. */
export function validateHostBindings(host: HostBindings): void {
  for (const path of Object.values(host).filter((value): value is string => value !== undefined)) invariant(path === resolve(path) && realpathSync(path) === path, 'Canonical existing host bindings required');
  for (const path of [host.stateDirectory, host.artifactStore]) assertPrivateHostDirectory(path);
  invariant(!!host.codexBinary === !!host.codexHome, 'Codex binary and home must be configured together');
  if (host.codexHome) assertPrivateHostDirectory(host.codexHome);
  const roots = [host.stateDirectory, host.workspaceDirectory, host.artifactStore, ...(host.codexHome ? [host.codexHome] : [])];
  invariant(new Set(roots).size === roots.length && roots.every(a => roots.every(b => a === b || !beneath(a, b))), 'Host state, source artifacts and workspaces must be disjoint');
}

/** One host coordinator owns release mutations; applications hold a separate execution lease. */
export class ServiceSupervisor {
  readonly #options: SupervisorOptions;
  readonly #engineeringReview: NonNullable<SupervisorOptions['engineeringReview']>;
  readonly #lease: ProcessLease;
  readonly #authority: AuthorityStore;
  readonly #controller: ReleaseController;
  readonly #service: ServiceProcess;
  readonly #policies: DerivedPolicyRegistry;
  #reviewers?: ReviewerRegistry;
  #configuredReviewer?: ReviewerFile;
  #reviewerDiagnosis?: string;
  readonly #resolvedReviewers = new Map<string, ReviewerFile>();
  readonly #allowances = new Map<string, AllowanceAmendment | undefined>();
  readonly #resourceLedger: HostResourceLedgerFactory = (store, ceiling, now) => {
    const candidateId = this.#controller.status()!.accepted.candidateId;
    if (!this.#allowances.has(candidateId)) this.#allowances.set(candidateId,
      (verifyApplication(this.#options.host.artifactStore, candidateId, this.#options.host.nodeBinary).inputs.configuration as unknown as import('./config.ts').ApplicationConfig).allowanceAmendment);
    const ledger = new ResourceLedger(store, ceiling, now), amendment = this.#allowances.get(candidateId), current = this.#authority.current();
    invariant(current?.generation, 'Serving host authority required for accepted allowance binding');
    const authority: Authority = { generation: current.generation, epoch: current.epoch, controlRevision: current.controlRevision };
    if (amendment) ledger.applyAllowanceAmendment(amendment, { authority, assertAuthority: () => this.#authority.assert(authority) });
    return ledger;
  };
  #evolutionStore?: OperationalStore;
  #dispatcher?: EvaluationDispatcher;
  #controls?: ControlContinuation;
  #succession?: SuccessionHost;
  #rescueRotations?: RescueRotationHost;
  #mailbox?: EvolutionMailbox;
  #ready?: ServiceReady;
  #failure?: string;
  #operation?: Promise<unknown>;
  #closing = false;
  #closed = false;
  #hostHandoffPending = false;
  #delegationInitialized = false;
  #unexpectedExitPending = false;
  #automaticRecoveryAvailable = true;
  #closePromise?: Promise<void>;
  private constructor(options: SupervisorOptions) {
    invariant(['engineering', 'product'].includes(options.mode), 'Explicit supervisor mode required');
    validateHostBindings(options.host);
    if (options.allowedModelProfiles !== undefined) validateModelGrants(options.allowedModelProfiles);
    this.#options = options;
    this.#engineeringReview = { ...options.engineeringReview,
      performRequest: options.engineeringReview?.performRequest ?? providerGateway({ provider: 'mistral', apiKey: () => options.secrets.mistralApiKey ?? '', maxResponseBytes: 262144 }),
      timeoutSignal: options.engineeringReview?.timeoutSignal ?? (timeoutMs => AbortSignal.timeout(timeoutMs)) };
    this.#lease = new ProcessLease(join(options.host.stateDirectory, 'supervisor-lease.sqlite'));
    let authority: AuthorityStore | undefined;
    try {
      this.#authority = authority = new AuthorityStore(join(options.host.stateDirectory, 'authority.sqlite'));
      this.#evolutionStore = new OperationalStore({ filename: join(options.host.stateDirectory, 'operational.sqlite') });
      if (options.evaluationDispatcher) {
        try {
          this.#configuredReviewer = loadReviewerFile(options.evaluationDispatcher.reviewerFile, options.host);
          this.#reviewers = new ReviewerRegistry({ store: this.#evolutionStore, host: options.host,
            directory: join(dirname(options.evaluationDispatcher.reviewerFile), `revisions-${identity(options.host.stateDirectory).slice(0, 16)}`),
            configuredReviewer: this.#configuredReviewer });
        } catch { this.#reviewerDiagnosis = 'External evaluation unavailable: configured reviewer file is missing or invalid'; }
      }
      this.#policies = new DerivedPolicyRegistry(this.#evolutionStore, options.getPolicy, (prior, next, candidate) => {
        if (this.#reviewers) this.#reviewers.prepare(prior, next, candidate);
        else invariant(identity(policyDescriptor(prior)) === identity(policyDescriptor(next)), 'Changed governance requires an available source-bound reviewer registry');
      });
      this.#mailbox = new EvolutionMailbox({ store: this.#evolutionStore, assertAuthority: grant => this.#authority.assert(grant) });
      this.#service = new ServiceProcess(options.host, options.secrets, { mode: options.mode, onUnexpectedExit: () => {
        this.#ready = undefined;
        this.#unexpectedExitPending = true;
        this.#handleUnexpectedExit();
      } });
      this.#controller = new ReleaseController({ statePath: join(options.host.stateDirectory, 'release.sqlite'),
        artifactStore: options.host.artifactStore, operationalStatePath: options.host.stateDirectory,
        authorityStore: this.#authority, exclusiveProcessLease: this.#lease, getPolicy: this.#policies.get,
        readArtifact: uri => { try { return this.#mailbox!.readArtifact(uri); } catch { return options.readArtifact(uri); } }, hooks: {
          stopAndDrain: async () => { this.#ready = undefined; await this.#service.stop(); await this.#drainExecutionLease(); },
          start: async target => {
            invariant(target.operationalStatePath === options.host.stateDirectory, 'Recovery must retain current operational state');
            await this.#prepare(target.candidate.manifest.id);
            const status = this.#controller.status()!;
            this.#ready = await this.#service.start(target.candidate.manifest.id, target.authority, this.#evolutionMetadata(status.probationJudge?.policyDigest ?? status.active.policyDigest));
          },
        } });
    } catch (error) { this.#evolutionStore?.close(); authority?.close(); this.#lease.close(); throw error; }
  }
  static async open(options: SupervisorOptions): Promise<ServiceSupervisor> {
    const supervisor = new ServiceSupervisor(options);
    try {
      if (supervisor.#controller.status()) {
        if (options.hostRescue) supervisor.#controller.restoreAccepted(options.hostRescue);
        await supervisor.recover();
      }
      else await supervisor.#exclusive(() => supervisor.#initialize());
      supervisor.#startDispatcher();
      supervisor.#startSuccession();
      supervisor.#startControlContinuation();
      supervisor.#startRescueRotations();
      return supervisor;
    } catch (error) { await supervisor.close(); throw error; }
  }
  status(): SupervisorStatus {
    const controls = this.#controls?.records();
    const rescueRotations = this.#rescueRotations?.records();
    return { coordinator: { processId: process.pid, module: import.meta.url }, mode: this.#options.mode, qualification: this.#options.mode === 'engineering' ? 'engineering-only' : 'product-policy',
      running: this.#service.running, processId: this.#service.processId, ready: this.#ready,
      release: this.#controller.status(), failure: this.#failure, evaluation: this.#dispatcher?.status(),
      ...(controls ? { controls: { total: controls.length, recent: controls.slice(-32).map(record => ({ id: record.request.id, status: record.status,
        ...(record.review ? { candidateId: record.review.candidate.manifest.id } : {}), ...(record.diagnosis ? { diagnosis: record.diagnosis } : {}) })) } } : {}),
      ...(rescueRotations ? { rescueRotations: { total: rescueRotations.length, recent: rescueRotations.slice(-32).map(record => ({ id: record.request.id, status: record.status,
        candidateId: record.request.selected.candidateId, ...(record.diagnosis ? { diagnosis: record.diagnosis } : {}) })) } } : {}) };
  }
  #startRescueRotations(): void {
    this.#rescueRotations = new RescueRotationHost({ store: this.#evolutionStore!, authority: this.#authority, status: () => this.#controller.status()!,
      ready: () => !this.#operation && !this.#closing && !this.#hostHandoffPending && this.#service.running,
      rotate: this.#options.rotateRescue });
    this.#rescueRotations.start();
  }
  #startSuccession(): void {
    const host = this.#options.host, store = this.#evolutionStore!, now = this.#options.succession?.now ?? Date.now;
    const environment = this.#options.succession?.environment ?? nodeSuccessionHostEnvironment(host, now);
    const configuration = (id: string) => materializeConfiguration(verifyApplication(host.artifactStore, id, host.nodeBinary), host);
    const incumbent = configuration(this.#controller.status()!.active.candidateId);
    this.#succession = new SuccessionHost({ store, host, environment, now, resourceLedger: this.#resourceLedger, resourceLimits: incumbent.resourceLimits,
      current: () => { const state = this.#controller.status()!, grant = this.#authority.current(); invariant(grant?.generation, 'Current succession host authority required');
        return { candidateId: state.active.candidateId, phase: state.phase, authority: { generation: grant.generation, epoch: grant.epoch, controlRevision: grant.controlRevision } }; },
      assertAuthority: authority => this.#authority.assert(authority), dispatchAuthority: (authority, operation) => this.#authority.dispatch(authority, operation),
      performRequest: this.#options.succession?.performRequest ?? ((payload, signal, call) => {
        invariant(call, 'Exact frozen cognitive generation required'); const config = configuration(call.candidateId);
        return providerGateway({ provider: config.model.provider, apiKey: () => selectedProviderKey(config.model, this.#options.secrets), maxResponseBytes: 2_000_000 })(payload, signal);
      }) });
  }
  #configuration(id: string) { const host = this.#options.host; return materializeConfiguration(verifyApplication(host.artifactStore, id, host.nodeBinary), host); }
  #activationAcknowledgmentPending(request: ControlActivationRequest): boolean {
    return controlActivationAcknowledgmentPending(this.#evolutionStore!, request);
  }
  #ownedCandidate(candidateId: string): boolean {
    const store = this.#evolutionStore!;
    return this.#controls?.records().some(({ request }) => request.skinShed &&
      new ChangeProposals(store, request.runId, request.scope).get(request.proposalId).candidate?.id === candidateId) ?? false;
  }
  #binding(control: ControlActivationRequest | ProbationReviewRequest): SuccessionBinding | undefined {
    const store = this.#evolutionStore!, id = 'activationId' in control ? control.activationId : control.id;
    const record = store.get<ControlContinuationRecord>('host.control-continuations', id)?.value;
    if (!record?.request.skinShed) return undefined;
    const request = record.request, intent = request.skinShed!, proposal = new ChangeProposals(store, request.runId, request.scope).get(request.proposalId);
    const dialogue = this.#succession!.dialogue.status(id), activation = resolveControlActivation(store, request);
    invariant(dialogue && proposal.candidate && dialogue.binding.id === id && dialogue.binding.runId === request.runId &&
      dialogue.binding.candidateId === proposal.candidate.id && dialogue.binding.incumbentId === intent.incumbentCandidateId &&
      dialogue.binding.stageId === activation.stageId && dialogue.binding.policyDigest === intent.policyDigest &&
      identity(dialogue.binding.authority) === identity(request.authority) && identity(dialogue.binding.scope) === identity(request.scope) &&
      dialogue.binding.objective === proposal.goal.objective && identity(dialogue.binding.criteria) === identity(proposal.goal.successCriteria), 'Exact supervised generation binding required');
    if ('activationId' in control) invariant(control.candidate.manifest.id === proposal.candidate.id && control.policyDigest === intent.policyDigest &&
      identity(control.proposal.goal) === identity(proposal.goal) && identity(control.judgeAuthority) === identity(request.authority), 'Probation differs from incumbent approval');
    else invariant(identity(control) === identity(request), 'Control intent changed');
    return dialogue.binding;
  }
  #activationReady(request: ControlActivationRequest): boolean {
    if (!request.skinShed) return true;
    const store = this.#evolutionStore!, id = `external-review:probation:${identity(request)}`;
    if (store.list<Run>('runs').some(row => row.value.status === 'running') || codingWritesPending(store, false)) return false;
    return !store.list<{ request: PhysicalRequest }>('requests').some(({ key, value: { request: physical } }) => {
      if (!['reserved', 'dispatched'].includes(physical.status)) return false;
      const prepared = store.get<{ physical: PhysicalRequest; claimed?: boolean }>('host.external-review-reservations', id)?.value;
      return !(key === id && physical.status === 'reserved' && physical.id === id && physical.runId === request.runId &&
        physical.reservationId === id && physical.purpose === 'review' && physical.provider === 'external-offline-review' && prepared && !prepared.claimed && identity(prepared.physical) === identity(physical));
    });
  }
  #startControlContinuation(): void {
    const reviewer = this.#options.controlReview ?? {
      reserveProbation: (review: ProbationReviewRequest, commitReservation: () => void) => this.#dispatcher!.reserveProbation(review, commitReservation),
      reviewProbation: (review: RunningProbationReview, signal: AbortSignal) => this.#dispatcher!.reviewProbation(review, signal),
      finishProbation: (review: import('./control-continuation.ts').ProbationReviewRequest) => this.#dispatcher!.finishProbation(review),
      readyToActivate: (request: ControlActivationRequest) => this.#dispatcher!.probationAvailable() && !this.#activationAcknowledgmentPending(request),
    };
    this.#controls = new ControlContinuation({ store: this.#evolutionStore!, mailbox: this.#mailbox!, resourceLedger: this.#resourceLedger,
      status: () => this.#controller.status()!, stagedControl: id => this.#controller.stagedControl(id),
      assertAuthority: authority => this.#authority.assert(authority), ...reviewer,
      readyToActivate: request => !this.#operation && !this.#closing && !this.#hostHandoffPending && !this.#activationAcknowledgmentPending(request) && this.#activationReady(request) && (reviewer.readyToActivate?.(request) ?? true),
      canProcess: () => !this.#operation && !this.#closing && !this.#hostHandoffPending,
      handoffPending: () => this.#hostHandoffPending,
      accepted: record => {
        const state = this.#controller.status()!, review = record.review;
        if (!review || !record.probationProof || !record.proofId || !record.physicalAuthority || state.phase !== 'accepted' ||
          state.accepted.candidateId !== review.candidate.manifest.id || state.active.candidateId !== review.candidate.manifest.id ||
          !state.authority.generation || state.authority.artifactId !== review.candidate.manifest.id || state.authority.controlRevision !== review.candidate.manifest.controls) return false;
        const proof = this.#evolutionStore!.readJsonArtifact<ReleaseProof>(record.probationProof), accepted = this.#controller.proof(record.proofId) as { proof?: ReleaseProof } | undefined;
        if (!accepted || identity(accepted.proof) !== identity(proof) || proof.proposal.id !== record.proofId || proof.proposal.id !== review.id ||
          identity(proof.proposal.candidate) !== identity(review.candidate.manifest) || identity(proof.proposal.priorAuthority) !== identity(review.judgeAuthority) ||
          identity([...state.admissionEvidenceIds].sort()) !== identity(proof.proposal.evidence.map(evidence => evidence.id).sort())) return false;
        const committed = this.#controller.history().some(event => {
          const previous = event.value as ReleaseState;
          return event.kind === 'probation-accepted' && previous.accepted.candidateId === review.candidate.manifest.id &&
            identity({ generation: previous.authority.generation, epoch: previous.authority.epoch, controlRevision: previous.authority.controlRevision }) === identity(record.physicalAuthority) &&
            identity([...previous.admissionEvidenceIds].sort()) === identity([...state.admissionEvidenceIds].sort());
        });
        if (!committed) return false;
        if (!record.request.skinShed) return true;
        const binding = this.#binding(review);
        return !!binding && this.#succession!.dialogue.status(binding.id)?.phase === 'retired';
      },
      readyToPrepare: request => !this.#operation && !this.#closing && !this.#hostHandoffPending && !this.#activationAcknowledgmentPending(request) && !codingWritesPending(this.#evolutionStore!),
      evolution: request => ordinaryEvolutionBackend({ store: this.#evolutionStore!, runId: request.runId, scope: request.scope, authority: request.authority, workspace: request.skinShed!.workspace },
        { config: this.#configuration(request.skinShed!.incumbentCandidateId), artifactStore: this.#options.host.artifactStore, evolution: this.#evolutionMetadata(request.skinShed!.policyDigest), assertAuthority: grant => this.#authority.assert(grant) }),
      interviewApproved: request => request.skinShed !== undefined && this.#succession!.dialogue.status(request.id)?.phase === 'approved',
      interview: async (request, candidate, stageId, signal) => {
        const proposal = new ChangeProposals(this.#evolutionStore!, request.runId, request.scope).get(request.proposalId), intent = request.skinShed!;
        const binding = this.#succession!.capture({ id: request.id, runId: request.runId, stageId, incumbentId: intent.incumbentCandidateId,
          candidateId: candidate.manifest.id, policyDigest: intent.policyDigest, authority: request.authority, scope: request.scope,
          objective: proposal.goal.objective, criteria: proposal.goal.successCriteria });
        try { await this.#succession!.dialogue.interview(binding, signal); }
        catch (error) { if (this.#succession!.dialogue.status(request.id)?.phase === 'rejected') return false; throw error; }
        this.#succession!.dialogue.assertApproved(binding); return true;
      },
      beforeActivate: request => { const binding = this.#binding(request); if (binding) this.#succession!.dialogue.assertApproved(binding); },
      observeProbation: (review, _proof, signal) => { const binding = this.#binding(review); return binding ? this.#succession!.dialogue.observe(binding, signal) : Promise.resolve(undefined); },
      recoverRegression: async () => { await this.recover(); },
      activate: (id, review) => this.activateControl(id, review), acceptProbation: (proof, review) => this.acceptProbation(proof, review) });
    this.#controls.start();
  }
  requestControlActivation(request: ControlActivationRequest): ControlContinuationRecord {
    invariant(!this.#closing && !this.#closed && this.#controls, 'Host control continuation unavailable');
    this.#authority.assert(request.authority);
    return enqueueControlActivation(this.#evolutionStore!, request);
  }
  #getReviewer(policyDigest: string): ReviewerFile | undefined {
    const retained = this.#resolvedReviewers.get(policyDigest);
    if (retained) return structuredClone(retained);
    if (!this.#reviewers) return undefined;
    const reviewer = this.#reviewers.get(this.#policies.get(policyDigest));
    // Resolve sealed identities once. Physical dispatch rechecks every byte and key;
    // status polling must not repeatedly read the entire executable closure.
    this.#resolvedReviewers.set(policyDigest, reviewer);
    return structuredClone(reviewer);
  }
  #evolutionMetadata(policyDigest: string): EvolutionMetadata {
    const metadata: EvolutionMetadata = { policyDigest, ...(this.#options.allowedModelProfiles ? { allowedModelProfiles: this.#options.allowedModelProfiles } : {}) };
    // Retained recovery must not depend on an evaluator, its key or its private files.
    try { if (this.#reviewers) metadata.reviewer = this.#reviewers.publicDescriptor(this.#policies.get(policyDigest)); } catch { /* Dispatcher reports the unavailable reviewer separately. */ }
    return metadata;
  }
  #startDispatcher(): void {
    const configured = this.#options.evaluationDispatcher;
    this.#dispatcher = new EvaluationDispatcher({ mailbox: this.#mailbox!, host: this.#options.host, reviewer: this.#configuredReviewer, unavailableDiagnosis: this.#reviewerDiagnosis,
      resourceLedger: this.#resourceLedger,
      runReview: (reviewer, host, request, policy, acceptedId, resource) => reviewer.files.some(file => file.mount === engineeringPlanMount)
        ? runEngineeringReview(reviewer, host, request, policy, acceptedId, { ...resource, ...this.#engineeringReview })
        : import('./evaluation-dispatch.ts').then(module => module.runAccountedExternalReview(reviewer, host, request, policy, acceptedId, resource)),
      getPolicy: this.#policies.get, policyDigests: configured?.policyDigests ?? [], assertAuthority: grant => this.#authority.assert(grant),
      getReviewer: digest => this.#getReviewer(digest), currentPolicyDigest: () => {
        const state = this.#controller.status()!; return state.probationJudge?.policyDigest ?? state.active.policyDigest;
      },
      dispatchAuthority: (grant, operation) => this.#authority.dispatch(grant, operation),
      acceptedCandidateId: () => this.#controller.status()!.accepted.candidateId,
      prepareControlPolicy: request => this.#authority.dispatch(request.proposal.authority, () => this.#policies.prepare(request.policyDigest, request.candidate)),
      release: proof => this.release(proof), stageControl: (proof, digest) => this.stageControl(proof, digest) });
    this.#dispatcher.start();
  }
  async command(command: SupervisorCommand): Promise<unknown> {
    switch (command.kind) {
      case 'status': return this.status();
      case 'recover': return this.recover();
      case 'release': return this.release(command.proof);
      case 'probation': return this.acceptProbation(command.proof);
      case 'stage-control': return this.stageControl(command.proof, command.policyDigest);
      case 'activate-control': return this.activateControl(command.stageId);
      default: throw new Error('Unknown host control command');
    }
  }
  release(proof: ReleaseProof): Promise<Authority> { return this.#exclusive(() => {
    invariant(!this.#ownedCandidate(proof.proposal.candidate.id), 'Skin shed candidate requires its supervised continuation');
    return this.#controller.transfer(proof, randomUUID());
  }); }
  recover(): Promise<Authority> {
    return this.#exclusive(async () => {
      const authority = await this.#controller.recover(randomUUID());
      this.#automaticRecoveryAvailable = true;
      return authority;
    });
  }
  acceptProbation(proof: ReleaseProof, review?: RunningProbationReview): Promise<void> { return this.#exclusive(async () => {
    const prior = this.#controller.status()!;
    if (this.#ownedCandidate(prior.active.candidateId)) {
      const binding = review && this.#binding(review);
      invariant(binding && binding.candidateId === prior.active.candidateId, 'Skin shed acceptance requires its exact supervised observer continuation');
    }
    if (review) this.#authority.dispatch(review.physicalAuthority, () => this.#evolutionStore!.transaction(() => {
      assertProbationLineage(this.#evolutionStore!, review, { resourceLedger: this.#resourceLedger });
      const binding = this.#binding(review); if (binding) this.#succession!.dialogue.assertObserved(binding);
      this.#controller.acceptProbation(proof);
    }));
    else this.#controller.acceptProbation(proof);
    if (review) { const binding = this.#binding(review); if (binding) this.#succession!.dialogue.retire(binding); }
    if (this.#controller.status()!.accepted.candidateId !== prior.accepted.candidateId && this.#options.onHostAccepted) {
      this.#hostHandoffPending = true;
      this.#options.onHostAccepted(this.#controller.status()!.accepted, prior.accepted);
    }
  }); }
  stageControl(proof: ReleaseProof, policyDigest: string): Promise<string> {
    return this.#exclusive(async () => {
      const policy = this.#policies.get(policyDigest);
      invariant(this.#options.mode === 'engineering' || policy.kind === 'product', 'Product control upgrade requires a product policy');
      return this.#controller.stageControlUpgrade(proof, policy);
    });
  }
  activateControl(stageId: string, review?: ProbationReviewRequest): Promise<Authority> {
    return this.#exclusive(() => {
      const candidateId = this.#controller.stagedControl(stageId)?.proof.proposal.candidate.id;
      if (candidateId && this.#ownedCandidate(candidateId)) {
        const binding = review && this.#binding(review);
        invariant(binding && binding.candidateId === candidateId && binding.stageId === stageId, 'Skin shed activation requires its exact supervised continuation');
      }
      return this.#controller.activateStagedControl(stageId, randomUUID(), review ? commit => this.#evolutionStore!.transaction(() => {
      // AuthorityStore holds its write lock before this callback; retain the operational
      // lock through withdrawal so cancellation and producer starts serialize with it.
      assertControlActivationClaim(this.#evolutionStore!, stageId, review, { resourceLedger: this.#resourceLedger });
      const record = this.#evolutionStore!.get<ControlContinuationRecord>('host.control-continuations', review.activationId)!.value;
      const binding = this.#binding(review); if (binding) this.#succession!.dialogue.assertApproved(binding);
      invariant(this.#activationReady(record.request), 'Active production work must drain before skin shed withdrawal');
      invariant(!this.#activationAcknowledgmentPending(record.request), 'Control activation producer acknowledgment is incomplete');
      commit();
    }) : undefined);
    });
  }
  async #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    invariant(!this.#closing && !this.#closed && !this.#operation && !this.#hostHandoffPending, 'Supervisor unavailable or release operation in progress');
    this.#lease.assertHeld();
    const promise = Promise.resolve().then(operation); this.#operation = promise;
    try { const result = await promise; this.#failure = undefined; return result; }
    catch (error) { this.#failure = 'Host operation failed; inspect retained release history and private diagnostics'; throw error; }
    finally {
      this.#operation = undefined;
      this.#handleUnexpectedExit();
    }
  }
  #handleUnexpectedExit(): void {
    if (!this.#unexpectedExitPending || this.#closing || this.#operation || this.#hostHandoffPending) return;
    this.#unexpectedExitPending = false;
    if (this.#automaticRecoveryAvailable) {
      this.#automaticRecoveryAvailable = false;
      void this.#exclusive(() => this.#controller.recover(randomUUID())).catch(() => {});
    } else {
      // One unattended rescue attempt per explicit recovery. Repeated crashes leave a fenced,
      // inspectable unavailable host instead of consuming unbounded resources and authority epochs.
      void this.#exclusive(async () => {
        const current = this.#authority.current();
        if (current?.generation) this.#authority.withdraw(current as Authority);
        await this.#service.stop(); await this.#drainExecutionLease();
        throw new Error('Automatic recovery exhausted; explicit host recovery required');
      }).catch(() => { this.#failure = 'Automatic recovery exhausted; inspect diagnostics and use explicit host recovery'; });
    }
  }
  async #initialize(): Promise<void> {
    const bootstrap = typeof this.#options.bootstrap === 'function' ? this.#options.bootstrap() : this.#options.bootstrap;
    invariant(bootstrap, 'First startup requires an external signed proof and explicit host policy');
    const proof = bootstrap.proof, candidateId = proof.proposal.candidate.id;
    const candidate = verifyApplication(this.#options.host.artifactStore, candidateId, this.#options.host.nodeBinary);
    const policy = this.#policies.get(bootstrap.policyDigest);
    invariant(identity((candidate.inputs.controls as { policy?: unknown }).policy) === identity(policyDescriptor(policy)), 'Bootstrap must bind the exact public host policy descriptor');
    invariant(this.#options.mode === 'engineering' || policy.kind === 'product', 'Product startup requires a product admission policy');
    const prior = proof.proposal.priorAuthority;
    const current = this.#authority.current();
    if (current) invariant(current.artifactId === candidateId && identity({ generation: current.generation, epoch: current.epoch, controlRevision: current.controlRevision }) === identity(prior), 'Interrupted bootstrap requires the exact original authority and signed proof');
    else invariant(prior.epoch === 1 && prior.controlRevision === candidate.manifest.controls && prior.generation.trim().length > 0, 'Initial proof must bind the first authority epoch and candidate controls');
    // Authenticate before writing authority. A crash between the two journals can resume only this exact grant.
    admitCandidate(this.#options.host.artifactStore, proof.proposal, prior, policy, proof.signed, this.#options.readArtifact);
    invariant(proof.proposal.recoveryArtifact.sha256 === hashBytes(readFileSync(join(this.#options.host.artifactStore, candidateId, 'candidate.json'))), 'Initial rescue must bind the current candidate manifest');
    const intentPath = join(this.#options.host.stateDirectory, 'bootstrap-intent.json');
    const intent = JSON.stringify({ identity: identity({ proof, policyDigest: policy.policyDigest }) });
    try {
      writeFileSync(intentPath, intent, { flag: 'wx', mode: 0o600 });
      for (const path of [intentPath, this.#options.host.stateDirectory]) {
        const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const stat = lstatSync(intentPath);
      invariant(realpathSync(intentPath) === intentPath && stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid?.() && (stat.mode & 0o077) === 0 && readHostFile(intentPath, 1024).toString('utf8') === intent, 'Interrupted bootstrap requires the exact original signed proof and policy');
    }
    if (!current) this.#authority.bootstrap(prior.generation, prior.controlRevision, candidateId);
    this.#controller.bootstrap(proof, policy);
    await this.#prepare(candidateId);
    this.#ready = await this.#service.start(candidateId, prior, this.#evolutionMetadata(policy.policyDigest));
  }
  async #prepare(candidateId: string): Promise<void> {
    const host = this.#options.host, candidate = verifyApplication(host.artifactStore, candidateId, host.nodeBinary);
    invariant(this.#options.mode === 'engineering' || (candidate.inputs.controls as { policy?: { kind?: string } }).policy?.kind === 'product', 'Product recovery requires a retained product policy descriptor');
    const config = materializeConfiguration(candidate, host);
    invariant(this.#options.mode === 'engineering' || config.resourceLimits, 'Product startup requires enforced kernel resource ceilings');
    if (config.resourceLimits) {
      if (!this.#delegationInitialized) { await initializeResourceDelegation(config.resourceLimits.cgroupRoot); this.#delegationInitialized = true; }
      assertResourceConfinement(config.workspaceDirectory, config.resourceLimits);
    }
  }
  async #drainExecutionLease(): Promise<void> {
    const deadline = Date.now() + 10000;
    while (true) {
      try { const lease = new ProcessLease(join(this.#options.host.stateDirectory, 'process-lease.sqlite')); lease.close(); return; }
      catch (error) { if (Date.now() >= deadline) throw new Error('Previous application did not release its execution lease; successor unavailable', { cause: error }); }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  close(): Promise<void> { return this.#closePromise ??= this.#close(); }
  async #close(): Promise<void> {
    if (this.#closed) return;
    this.#closing = true;
    this.#succession?.close();
    await this.#rescueRotations?.close();
    await this.#controls?.close();
    await this.#dispatcher?.close();
    await this.#operation?.catch(() => {});
    try {
      // A preaccepted bootstrap interruption retains its matching grant for explicit proof retry; no process ran.
      const current = this.#authority.current();
      if (this.#controller.status() && current?.generation) this.#authority.withdraw(current as Authority);
      this.#ready = undefined; await this.#service.stop();
    } finally {
      this.#evolutionStore?.close(); this.#controller.close(); this.#authority.close(); this.#lease.close(); this.#closed = true;
    }
  }
}
