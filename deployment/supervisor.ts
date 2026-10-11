import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { identity, invariant, type Authority } from '../packages/contracts/index.ts';
import { admitCandidate, type AdmissionPolicy } from '../packages/release/admission.ts';
import { hashBytes } from '../packages/release/artifacts.ts';
import { policyDescriptor, ReleaseController, type ReleaseProof, type ReleaseState, type ReleaseTarget } from '../packages/release/controller.ts';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import { ProcessLease } from '../packages/supervisor/process-lease.ts';
import { assertResourceConfinement, initializeResourceDelegation } from '../packages/supervisor/resource-limits.ts';
import { verifyApplication } from './candidate.ts';
import { beneath, type ApplicationSecrets } from './config.ts';
import { assertPrivateHostDirectory, readHostFile } from './host-policy.ts';
import { materializeConfiguration, type HostBindings } from './materialize.ts';
import { ServiceProcess, type ServiceReady } from './service-process.ts';

export interface SupervisorOptions {
  host: HostBindings;
  secrets: ApplicationSecrets;
  mode: 'engineering' | 'product';
  getPolicy(digest: string): AdmissionPolicy;
  readArtifact(uri: string): Uint8Array;
  hostRescue?: ReleaseTarget;
  onHostAccepted?(target: ReleaseTarget, previous: ReleaseTarget): void;
  bootstrap?: { proof: ReleaseProof; policyDigest: string } | (() => { proof: ReleaseProof; policyDigest: string });
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
  for (const path of Object.values(host)) invariant(path === resolve(path) && realpathSync(path) === path, 'Canonical existing host bindings required');
  for (const path of [host.stateDirectory, host.artifactStore]) assertPrivateHostDirectory(path);
  const roots = [host.stateDirectory, host.workspaceDirectory, host.artifactStore];
  invariant(new Set(roots).size === roots.length && roots.every(a => roots.every(b => a === b || !beneath(a, b))), 'Host state, source artifacts and workspaces must be disjoint');
}

/** One host coordinator owns release mutations; applications hold a separate execution lease. */
export class ServiceSupervisor {
  readonly #options: SupervisorOptions;
  readonly #lease: ProcessLease;
  readonly #authority: AuthorityStore;
  readonly #controller: ReleaseController;
  readonly #service: ServiceProcess;
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
    this.#options = options;
    this.#lease = new ProcessLease(join(options.host.stateDirectory, 'supervisor-lease.sqlite'));
    let authority: AuthorityStore | undefined;
    try {
      this.#authority = authority = new AuthorityStore(join(options.host.stateDirectory, 'authority.sqlite'));
      this.#service = new ServiceProcess(options.host, options.secrets, { mode: options.mode, onUnexpectedExit: () => {
        this.#ready = undefined;
        this.#unexpectedExitPending = true;
        this.#handleUnexpectedExit();
      } });
      this.#controller = new ReleaseController({ statePath: join(options.host.stateDirectory, 'release.sqlite'),
        artifactStore: options.host.artifactStore, operationalStatePath: options.host.stateDirectory,
        authorityStore: this.#authority, exclusiveProcessLease: this.#lease, getPolicy: options.getPolicy,
        readArtifact: options.readArtifact, hooks: {
          stopAndDrain: async () => { this.#ready = undefined; await this.#service.stop(); await this.#drainExecutionLease(); },
          start: async target => {
            invariant(target.operationalStatePath === options.host.stateDirectory, 'Recovery must retain current operational state');
            await this.#prepare(target.candidate.manifest.id);
            const status = this.#controller.status()!;
            this.#ready = await this.#service.start(target.candidate.manifest.id, target.authority, { policyDigest: status.probationJudge?.policyDigest ?? status.active.policyDigest });
          },
        } });
    } catch (error) { authority?.close(); this.#lease.close(); throw error; }
  }
  static async open(options: SupervisorOptions): Promise<ServiceSupervisor> {
    const supervisor = new ServiceSupervisor(options);
    try {
      if (supervisor.#controller.status()) {
        if (options.hostRescue) supervisor.#controller.restoreAccepted(options.hostRescue);
        await supervisor.recover();
      }
      else await supervisor.#exclusive(() => supervisor.#initialize());
      return supervisor;
    } catch (error) { await supervisor.close(); throw error; }
  }
  status(): SupervisorStatus {
    return { coordinator: { processId: process.pid, module: import.meta.url }, mode: this.#options.mode, qualification: this.#options.mode === 'engineering' ? 'engineering-only' : 'product-policy',
      running: this.#service.running, processId: this.#service.processId, ready: this.#ready,
      release: this.#controller.status(), failure: this.#failure };
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
  release(proof: ReleaseProof): Promise<Authority> { return this.#exclusive(() => this.#controller.transfer(proof, randomUUID())); }
  recover(): Promise<Authority> {
    return this.#exclusive(async () => {
      const authority = await this.#controller.recover(randomUUID());
      this.#automaticRecoveryAvailable = true;
      return authority;
    });
  }
  acceptProbation(proof: ReleaseProof): Promise<void> { return this.#exclusive(async () => {
    const prior = this.#controller.status()!;
    this.#controller.acceptProbation(proof);
    if (prior.probationJudge?.change === 'control-upgrade' && this.#options.onHostAccepted) {
      this.#hostHandoffPending = true;
      this.#options.onHostAccepted(this.#controller.status()!.accepted, prior.accepted);
    }
  }); }
  stageControl(proof: ReleaseProof, policyDigest: string): Promise<string> {
    return this.#exclusive(async () => {
      const policy = this.#options.getPolicy(policyDigest);
      invariant(this.#options.mode === 'engineering' || policy.kind === 'product', 'Product control upgrade requires a product policy');
      return this.#controller.stageControlUpgrade(proof, policy);
    });
  }
  activateControl(stageId: string): Promise<Authority> { return this.#exclusive(() => this.#controller.activateStagedControl(stageId, randomUUID())); }
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
    const policy = this.#options.getPolicy(bootstrap.policyDigest);
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
    this.#ready = await this.#service.start(candidateId, prior, { policyDigest: policy.policyDigest });
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
    await this.#operation?.catch(() => {});
    try {
      // A preaccepted bootstrap interruption retains its matching grant for explicit proof retry; no process ran.
      const current = this.#authority.current();
      if (this.#controller.status() && current?.generation) this.#authority.withdraw(current as Authority);
      this.#ready = undefined; await this.#service.stop();
    } finally {
      this.#controller.close(); this.#authority.close(); this.#lease.close(); this.#closed = true;
    }
  }
}
