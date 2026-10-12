import { join } from 'node:path';
import { canonicalJson, identity, invariant, type ArtifactRef } from '../../packages/contracts/index.ts';
import { AutarkApplication, type ApplicationOptions } from '../../deployment/application.ts';
import { DevelopmentAccounting } from '../../deployment/development-accounting.ts';
import { validateConfiguration } from '../../deployment/config.ts';
import { ResourceLedger, type RequestCeiling } from '../../packages/runtime/index.ts';
import { OperationalStore } from '../../packages/storage/index.ts';
import type { QualificationStore } from '../qualification/store.ts';
import type { Signed } from '../qualification/manifest.ts';
import { AcquisitionUnavailable, DevelopmentAcquisitionRecorder, type AcquisitionRecorderOptions } from './acquire.ts';
import { verifyAcquisitionPlan, type AcquisitionPlanTrust, type DevelopmentAcquisitionPlan } from './acquisition-plan.ts';
import type { DevelopmentBehavior } from './review-envelope.ts';
import { developmentCapacityProfile } from './witness.ts';

export interface DevelopmentDriverRole {
  roleId: string;
  application: Omit<ApplicationOptions, 'developmentAccounting' | 'documentJournal'>;
  localDefaultCeiling: RequestCeiling;
  transport: { id: string; key: Uint8Array };
}
export interface DevelopmentDriverOptions {
  document: Signed<DevelopmentAcquisitionPlan>;
  trust: AcquisitionPlanTrust;
  state: OperationalStore;
  raw: QualificationStore;
  custodian?: AcquisitionRecorderOptions['custodian'];
  originalDefaultCeiling: RequestCeiling;
  syntheticClock?: AcquisitionRecorderOptions['syntheticClock'];
  roles: readonly DevelopmentDriverRole[];
}
export interface DevelopmentDriverApplication { readonly application: AutarkApplication; readonly accounting: DevelopmentAccounting }
export interface DevelopmentOrdinaryStep { roleId: string; before: ArtifactRef; after: ArtifactRef; phase: ReturnType<DevelopmentAcquisitionRecorder['status']>['phase'] }
export interface DevelopmentDriverCloseResult { errors: { roleId: string; detail: string }[] }
interface DriverState { planDigest: string; phase: 'preparing' | 'ready' | 'closing' | 'closed' | 'failed'; failure: string | null; closeErrors: DevelopmentDriverCloseResult['errors'] }
/** Combined construction/shutdown failure retains the original cause and actual
 * still-owned handles. Host resolution is explicit; preparation never retries. */
export class DevelopmentDriverPreparationFailure extends Error {
  readonly closeErrors: DevelopmentDriverCloseResult['errors'];
  private readonly applications: ReadonlyMap<string, DevelopmentDriverApplication>;
  constructor(cause: unknown, errors: DevelopmentDriverCloseResult['errors'], applications: ReadonlyMap<string, DevelopmentDriverApplication>) {
    super('Driver preparation failed and application shutdown remains unresolved', { cause });
    this.name = 'DevelopmentDriverPreparationFailure'; this.closeErrors = structuredClone(errors); this.applications = applications;
  }
  application(roleId: string): DevelopmentDriverApplication {
    const source = this.applications.get(roleId); invariant(source, 'Unregistered constructed application'); return source;
  }
}
const namespace = 'development.driver';
const detail = (error: unknown) => String(error).slice(0, 512);

/** Finite host composition. Ordinary application scheduling remains the sole work loop. */
export class DevelopmentAcquisitionDriver {
  readonly recorder: DevelopmentAcquisitionRecorder;
  private readonly applications: ReadonlyMap<string, DevelopmentDriverApplication>;
  private readonly owner: OperationalStore;
  private closing = false;
  private closeTask?: Promise<DevelopmentDriverCloseResult>;
  private step?: Promise<DevelopmentOrdinaryStep>;
  private constructor(recorder: DevelopmentAcquisitionRecorder, applications: Map<string, DevelopmentDriverApplication>, owner: OperationalStore, stopEntry: () => void) {
    this.recorder = recorder; this.applications = applications; this.owner = owner; this.stopEntry = stopEntry;
  }
  private readonly stopEntry: () => void;

  static async prepare(input: DevelopmentDriverOptions): Promise<DevelopmentAcquisitionDriver> {
    // Snapshot trusted callback/service identities once. Only plain authority/configuration
    // and signed descriptors are copied; secrets retain the application's rotation semantics.
    const document = structuredClone(input.document), trust = structuredClone(input.trust), state = input.state, raw = input.raw;
    const suppliedCustodian = input.custodian, custodian = suppliedCustodian ? { store: suppliedCustodian.store, key: suppliedCustodian.key } : undefined;
    const originalDefaultCeiling = structuredClone(input.originalDefaultCeiling), syntheticClock = input.syntheticClock;
    const roles = input.roles.map(descriptor => {
      const source = descriptor.application as ApplicationOptions;
      const options = { config: structuredClone(source.config), secrets: source.secrets, authority: structuredClone(source.authority), authorityStore: source.authorityStore,
        performRequest: source.performRequest, slackBotApi: source.slackBotApi, slackAppApi: source.slackAppApi, lease: source.lease,
        additionalTools: source.additionalTools, developmentAccounting: source.developmentAccounting, documentJournal: source.documentJournal };
      const transport = descriptor.transport;
      return { roleId: descriptor.roleId, options, localDefaultCeiling: structuredClone(descriptor.localDefaultCeiling), transport: { id: transport.id, key: Uint8Array.from(transport.key) } };
    });
    const now = syntheticClock ? () => syntheticClock().wallMs : Date.now;
    const { plan } = verifyAcquisitionPlan(document, trust, (ref, bound) => raw.readArtifact(ref, bound), now());
    invariant(plan.version === 2 && plan.captureLayout && plan.protocol && raw.profile === developmentCapacityProfile, 'Ordinary driver requires the accepted complete-page profile');
    invariant(identity(raw.identity()) === identity(plan.rawStore) && !plan.roles.some(role => role.stateFile === state.filename), 'Exact private raw store and separate recorder owner required');
    const registration = plan.registration.value, behavioral = registration.roles.filter(role => role.kind !== 'reviewer');
    const candidate = behavioral.find(role => role.kind === 'candidate')!;
    invariant(roles.length === behavioral.length && new Set(roles.map(role => role.roleId)).size === roles.length && behavioral.every(role => roles.some(d => d.roleId === role.id)), 'Exact actual behavioral role descriptors required');
    let workloadDigest: string | undefined;
    for (const descriptor of roles) {
      const role = behavioral.find(role => role.id === descriptor.roleId)!, rp = plan.roles.find(role => role.roleId === descriptor.roleId)!;
      invariant(!descriptor.options.developmentAccounting && descriptor.options.documentJournal === undefined && !descriptor.options.additionalTools, 'Driver owns accounting/journal hooks; additional extensions are unqualified');
      const config = validateConfiguration(descriptor.options.config);
      invariant(identity(config) === role.configurationDigest && config.stateDirectory && join(config.stateDirectory, 'operational.sqlite') === rp.stateFile && config.workspaceDirectory === rp.workspace, 'Exact signed application configuration/state/workspace required');
      invariant(rp.journal, 'Actual signed document journal required');
      const mode = config.developmentControl, control = plan.manifest.value.controls.find(control => control.id === role.assignmentId);
      invariant(mode && mode.version === 1 && mode.assignmentId === role.assignmentId && mode.kind === (role.kind === 'candidate' ? 'ordinary' : control?.kind), 'Actual signed control kind/version/assignment required');
      workloadDigest ??= mode.workloadDigest;
      invariant(mode.workloadDigest === workloadDigest, 'Matched public workload identity required');
      invariant(identity(config.model) === identity(role.profile) && identity(role.profile) === identity(candidate.profile), 'Actual matched signed model profile required');
      const acceptedKey = trust.envelope.transports.get(descriptor.transport.id);
      invariant(acceptedKey && Buffer.from(acceptedKey).equals(Buffer.from(descriptor.transport.key)), 'Accepted actual transport signer required');
      descriptor.options.config = config;
    }
    invariant(!state.get(namespace, plan.id) && !state.get('development.acquisition', plan.id), 'Driver preparation/recorder already consumed');
    const put = (phase: DriverState['phase'], failure: string | null = null, closeErrors: DevelopmentDriverCloseResult['errors'] = []) => {
      const row = state.get<DriverState>(namespace, plan.id);
      state.put(namespace, plan.id, { planDigest: identity(plan), phase, failure, closeErrors } satisfies DriverState, row?.revision ?? null);
    };
    put('preparing');
    let recorder: DevelopmentAcquisitionRecorder | undefined, original: ResourceLedger | undefined, ready = false, entryStopped = false;
    const applications = new Map<string, DevelopmentDriverApplication>();
    const bound = () => { if (!ready || !recorder) throw new AcquisitionUnavailable('Driver recorder and complete initial captures are not ready'); return recorder; };
    const work = () => { const r = bound(); if (entryStopped) throw new AcquisitionUnavailable('Driver applications are closing'); return r; };
    try {
      // No await may expose partially prepared callbacks. Candidate's real Store is
      // the original ledger, not another handle with a matching pathname.
      for (const role of [candidate, ...behavioral.filter(role => role.id !== candidate.id)]) {
        const descriptor = roles.find(d => d.roleId === role.id)!, rp = plan.roles.find(r => r.roleId === role.id)!;
        let accounting: DevelopmentAccounting | undefined;
        const application = new AutarkApplication({ ...descriptor.options, documentJournal: rp.journal,
          developmentAccounting: ({ store, config }) => {
            if (role.kind === 'candidate') original = new ResourceLedger(store, originalDefaultCeiling, now);
            invariant(original, 'Candidate must establish actual original ledger first');
            accounting = new DevelopmentAccounting({ localStore: store, original, localDefaultCeiling: descriptor.localDefaultCeiling,
              registration, acceptedRegistrationDigest: identity(registration), roleId: role.id, acceptedRoleDigest: identity(role),
              originalGrant: plan.manifest.value.grant, behaviorWindow: { notBefore: plan.manifest.value.notBefore, deadlineAt: plan.manifest.value.deadlineAt },
              actualConfigurationDigest: identity(config), actualClosureDigest: role.closureDigest, actualProfile: config.model, transport: descriptor.transport,
              rawStore: { putBytes: bytes => work().rawStoreForRole(role.id).putBytes(bytes), readArtifact: (ref, bound) => work().readArtifact(ref, bound ?? plan.manifest.value.limits.maxArtifactBytes) },
              reserveEvidence: request => work().reserveEvidence(role.id, request), retainResponse: (id, bytes) => bound().retainResponse(id, bytes),
              assertCurrentUse: () => work().assertCurrentUse(), readRetainedResponse: (id, ref, bytes) => bound().readRetainedResponse(id, ref, bytes), maxResponseBytes: rp.maxResponseBytes });
            return accounting;
          } });
        invariant(accounting, 'Actual application accounting required');
        applications.set(role.id, Object.freeze({ application, accounting }));
        invariant(application.resources === accounting.resources && application.runtime.store === application.store && application.runtime.resources === accounting.resources && application.communications.options.store === application.store && application.communications.options.runtime === application.runtime, 'Actual application/runtime/communications/accounting association required');
      }
      invariant(original, 'Actual candidate original ledger required');
      recorder = DevelopmentAcquisitionRecorder.claim({ document, trust, raw, state, original, custodian, syntheticClock });
      for (const [roleId, source] of applications) recorder.captureApplication(roleId, source.application, source.accounting);
      ready = true; put('ready');
      return new DevelopmentAcquisitionDriver(recorder, applications, state, () => { entryStopped = true; });
    } catch (error) {
      entryStopped = true;
      // Reserved response callbacks remain available after readiness, including a
      // failure occurring just after the initial captures. They drain via app.close.
      try { recorder?.fail('driver-preparation', error); } catch { /* Preserve original failure. */ }
      const errors = await DevelopmentAcquisitionDriver.closeOwned(applications, candidate.id);
      try { put('failed', detail(error), errors); } catch { /* Never replace the original failure. */ }
      if (errors.length) throw new DevelopmentDriverPreparationFailure(error, errors, applications);
      throw error;
    }
  }

  application(roleId: string): DevelopmentDriverApplication {
    const source = this.applications.get(roleId); invariant(source, 'Unregistered behavioral application'); return source;
  }
  private assertOpen(): void { if (this.closing) throw new AcquisitionUnavailable('Driver applications are closing'); }
  ingestRegisteredAssignment(roleId: string, assignmentId: string): string {
    this.assertOpen(); const source = this.application(roleId);
    return this.recorder.deliverAssignment(roleId, assignmentId, source.application, source.accounting);
  }
  observeOrdinaryStep(roleId: string): Promise<DevelopmentOrdinaryStep> {
    this.assertOpen(); invariant(!this.step, 'Ordinary source sampling already active');
    const source = this.application(roleId), plan = this.recorder.plan, state = this.recorder.status();
    const roles = plan.registration.value.roles.filter(role => role.kind !== 'reviewer').length;
    const remainingDeliveries = plan.protocol!.schedule.filter(assignment => !state.deliveries.some(d => d.roleId === assignment.roleId && d.id === assignment.assignmentId)).length;
    const extraCaptures = state.snapshots.length - roles - state.deliveries.length - state.finalCaptures.length;
    if (!['claimed', 'acquiring'].includes(state.phase) || extraCaptures + 2 > plan.protocol!.cycleCaptures || state.snapshots.length + 2 + remainingDeliveries + roles + plan.protocol!.boundaryCaptures > plan.capacity.maxSnapshots)
      throw new AcquisitionUnavailable('Protected ordinary capture pair budget exhausted or behavioral phase stopped');
    const task = (async (): Promise<DevelopmentOrdinaryStep> => {
      try {
        const before = this.recorder.captureApplication(roleId, source.application, source.accounting);
        await source.application.tick();
        const after = this.recorder.captureApplication(roleId, source.application, source.accounting);
        return { roleId, before, after, phase: this.recorder.status().phase };
      } catch (error) { try { this.recorder.fail('driver-ordinary-step', error); } catch { /* Preserve original failure. */ } throw error; }
    })();
    this.step = task;
    return task.finally(() => { this.step = undefined; });
  }
  freezeBehavior(): Signed<DevelopmentBehavior> {
    this.assertOpen(); invariant(!this.step, 'Ordinary source sampling still active');
    const role = this.recorder.plan.registration.value.roles.find(role => role.kind === 'candidate')!;
    return this.recorder.freezeBehavior(this.application(role.id).accounting, this.applications);
  }
  private static async closeOwned(applications: ReadonlyMap<string, DevelopmentDriverApplication>, candidateId: string): Promise<DevelopmentDriverCloseResult['errors']> {
    const errors: DevelopmentDriverCloseResult['errors'] = [];
    const ordered = [...applications].filter(([id]) => id !== candidateId).concat([...applications].filter(([id]) => id === candidateId));
    for (const [roleId, source] of ordered) {
      if (roleId === candidateId && errors.length) {
        errors.push({ roleId, detail: 'candidate-close-deferred: a control shutdown failed before quiescence could be established; actual handles remain owned for explicit host resolution' });
        continue;
      }
      try { await source.application.close(); } catch (error) { errors.push({ roleId, detail: detail(error) }); }
    }
    return errors;
  }
  closeApplications(): Promise<DevelopmentDriverCloseResult> {
    if (this.closeTask) return this.closeTask;
    this.closing = true; this.stopEntry();
    this.closeTask = (async () => {
      const plan = this.recorder.plan, errors: DevelopmentDriverCloseResult['errors'] = [];
      try {
        const row = this.owner.get<DriverState>(namespace, plan.id)!;
        this.owner.put(namespace, plan.id, { ...row.value, phase: 'closing' }, row.revision);
      } catch (error) { errors.push({ roleId: 'owner', detail: detail(error) }); }
      await this.step?.catch(() => undefined);
      const candidate = plan.registration.value.roles.find(role => role.kind === 'candidate')!;
      errors.push(...await DevelopmentAcquisitionDriver.closeOwned(this.applications, candidate.id));
      if (errors.length) { try { this.recorder.fail('driver-shutdown', canonicalJson(errors)); } catch (error) { errors.push({ roleId: 'recorder', detail: detail(error) }); } }
      try {
        const current = this.owner.get<DriverState>(namespace, plan.id)!;
        this.owner.put(namespace, plan.id, { ...current.value, phase: errors.length || this.recorder.status().phase === 'failed' ? 'failed' : 'closed', closeErrors: errors }, current.revision);
      } catch (error) { errors.push({ roleId: 'owner', detail: detail(error) }); }
      return { errors };
    })();
    return this.closeTask;
  }
}
