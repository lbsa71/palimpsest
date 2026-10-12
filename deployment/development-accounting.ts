import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson, identity, invariant, validateCapturedPrompt, validatePhysicalRequest, type ArtifactRef, type EffectReceiver, type PhysicalRequest, type PromptManifest, type ResourceEnvelope, type ShellPort, type ToolCall } from '../packages/contracts/index.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { ResourceLedger, type RequestCeiling } from '../packages/runtime/resources/index.ts';
import { developmentRequestIdentity, reviewEnvelopeDomains, type DevelopmentAccountingTransition, type DevelopmentRegistration, type DevelopmentRequestState, type DevelopmentRoleBinding, type DevelopmentSettlement } from '../evaluations/development/review-envelope.ts';
import { signDocument, inertSnapshot } from '../evaluations/qualification/manifest.ts';
import type { QualificationStore } from '../evaluations/qualification/store.ts';
import type { ApplicationConfig } from './config.ts';
import type { Accounting } from '../evaluations/development/witness.ts';
import type { ModelProfile } from './model-grants.ts';
import type { TransportReceipt } from './broker-shell.ts';

interface Allocation { rootId: string; parentRunId?: string; cancelled: boolean; envelope: ResourceEnvelope; startedAt: number }
interface Reservation { rootId: string; request: PhysicalRequest; ceiling: RequestCeiling; charged: RequestCeiling }
interface Captured { payload: ArtifactRef; prompt: ArtifactRef | null; fragments: { artifact: ArtifactRef; bytes: number }[] }
interface Tracked extends Captured { registrationDigest: string; roleId: string; localId: string; localRunId: string; immutable: string }
interface TrustedOutcome { status: 'succeeded' | 'failed' | 'uncertain'; usage: PhysicalRequest['usage']; response: ArtifactRef | null; dispatched: boolean }
export interface DevelopmentCapacityRequest {
  request: PhysicalRequest; payloadBytes: number; promptBytes: number; maxResponseBytes: number;
  payload: ArtifactRef; prompt: ArtifactRef | null; fragments: { artifact: ArtifactRef; bytes: number }[];
  /** The recorder must include transitions, signatures, failure and settlement overhead. */
  maxTransitions: number;
}
export interface DevelopmentAccountingOptions {
  localStore: OperationalStore; original: ResourceLedger; localRootId?: string;
  localDefaultCeiling: RequestCeiling;
  registration: DevelopmentRegistration; acceptedRegistrationDigest: string; roleId: string; acceptedRoleDigest: string;
  originalGrant: { resources: ResourceEnvelope; issuedAt: string; expiresAt: string };
  behaviorWindow: { notBefore: string; deadlineAt: string };
  actualConfigurationDigest: string; actualClosureDigest: string; actualProfile: ModelProfile | null;
  rawStore: Pick<QualificationStore, 'putBytes' | 'readArtifact'>;
  transport: { id: string; key: Uint8Array };
  /** Trusted finite recorder; must durably reserve before returning. Throws on exhaustion. */
  reserveEvidence(request: DevelopmentCapacityRequest): void;
  /** Trusted recorder routes physical replies to their already reserved evidence capacity. */
  retainResponse?(requestId: string, bytes: Uint8Array): ArtifactRef;
  /** Current recorder/custodian use at new work boundaries; never gates late settlement. */
  assertCurrentUse?(): void;
  /** Request-scoped reserved response verification after ordinary evidence use is withdrawn. */
  readRetainedResponse?(requestId: string, ref: ArtifactRef, maxBytes: number): Uint8Array;
  maxResponseBytes: number;
}
export class DevelopmentAccountingUnavailable extends Error { override name = 'DevelopmentAccountingUnavailable'; }
const requests = 'development.accounting.requests', outcomes = 'development.accounting.outcomes';
const pending = (q: PhysicalRequest) => ['reserved', 'dispatched', 'uncertain'].includes(q.status);

/** Host-only bridge. An isolated local ledger is never independent physical authority. */
export class DevelopmentAccounting {
  readonly resources: ResourceLedger;
  get originalResources(): ResourceLedger { return this.options.original; }
  /** Exact private grant/window binding for host control seals; detached on every read. */
  get controlBinding(): Readonly<Pick<DevelopmentAccountingOptions, 'originalGrant' | 'behaviorWindow'> & { localRootId: string }> {
    const binding = inertSnapshot({ originalGrant: this.options.originalGrant, behaviorWindow: this.options.behaviorWindow, localRootId: this.localRoot });
    Object.freeze(binding.originalGrant.resources); Object.freeze(binding.originalGrant); Object.freeze(binding.behaviorWindow);
    return Object.freeze(binding);
  }
  readonly registration: DevelopmentRegistration;
  readonly role: DevelopmentRoleBinding;
  readonly registrationDigest: string;
  private readonly options: DevelopmentAccountingOptions;
  private readonly shared: boolean;
  private readonly localRoot: string;
  private readonly stream: string;
  private captured = new Map<string, Captured>();
  private responses = new Map<string, ArtifactRef>();
  constructor(options: DevelopmentAccountingOptions) {
    this.options = { ...options, originalGrant: inertSnapshot(options.originalGrant), behaviorWindow: inertSnapshot(options.behaviorWindow), transport: { id: options.transport.id, key: Uint8Array.from(options.transport.key) }, actualProfile: inertSnapshot(options.actualProfile) };
    this.registration = inertSnapshot(options.registration); this.registrationDigest = identity(this.registration);
    invariant(this.registrationDigest === options.acceptedRegistrationDigest && this.registration.version === 2, 'Unaccepted accounting registration');
    const role = this.registration.roles.find(r => r.id === options.roleId);
    invariant(role && identity(role) === options.acceptedRoleDigest, 'Unaccepted accounting role'); this.role = inertSnapshot(role);
    invariant(role.configurationDigest === options.actualConfigurationDigest && role.closureDigest === options.actualClosureDigest && identity(role.profile) === identity(options.actualProfile), 'Actual role/configuration/closure/profile differs');
    invariant(options.transport.key.byteLength >= 32 && options.transport.id.length > 0, 'Host transport signing identity required');
    invariant(Number.isSafeInteger(options.maxResponseBytes) && options.maxResponseBytes > 0 && options.maxResponseBytes <= 1_000_000, 'Bounded retained response required');
    this.shared = options.original.store === options.localStore;
    invariant(this.shared || options.original.store.filename !== options.localStore.filename, 'Same SQLite boundary needs one store object');
    invariant(!this.shared || role.kind === 'candidate', 'Only candidate shares original operational state');
    this.localRoot = options.localRootId ?? 'operating-envelope:v1'; this.stream = `development-accounting:${this.registrationDigest}`;
    invariant(!this.shared || this.localRoot === this.registration.rootId, 'Candidate uses the existing original operating root');
    this.preflight();
    const original = options.original.store, bindingKey = `${this.registration.rootId}:${role.id}`;
    original.transaction(() => {
      const binding = { registrationDigest: this.registrationDigest, roleDigest: identity(role), localRoot: this.localRoot, shared: this.shared, defaultCeiling: options.localDefaultCeiling, originalDefaultCeiling: options.original.defaultCeiling, behaviorWindow: options.behaviorWindow };
      const old = original.get('development.accounting.bindings', bindingKey);
      if (old) invariant(identity(old.value) === identity(binding), 'Accounting binding cannot reset on reopen');
      else original.put('development.accounting.bindings', bindingKey, binding, null);
    });
    options.localStore.transaction(() => {
      const value = { registrationDigest: this.registrationDigest, roleId: role.id, localRoot: this.localRoot, shared: this.shared };
      const old = options.localStore.get('development.accounting.local', 'binding');
      if (old) invariant(identity(old.value) === identity(value), 'Operational state belongs to another development role');
      else options.localStore.put('development.accounting.local', 'binding', value, null);
    });
    this.resources = new AccountingLedger(this, options.localStore, options.localDefaultCeiling, options.original.now);
  }
  assertApplication(config: ApplicationConfig): void {
    invariant(identity(config) === this.role.configurationDigest && identity(config.model) === identity(this.role.profile), 'Actual application configuration/profile differs from accepted role');
    invariant(identity(config.resources) === identity(this.shared ? this.options.originalGrant.resources : this.role.resources), 'Application operating sublimit differs');
  }
  private unavailable(condition: unknown, reason: string): asserts condition { if (!condition) throw new DevelopmentAccountingUnavailable(reason); }
  private preflight(): void {
    const o = this.options, r = this.registration, store = o.original.store;
    const root = store.get<Allocation>('allocations', r.rootId)?.value, budget = store.get<Allocation>('budgets', r.rootId)?.value;
    this.unavailable(root && budget && root.rootId === r.rootId && !root.parentRunId, 'Existing original operating root required');
    this.unavailable(identity(root.envelope) === identity(o.originalGrant.resources) && identity(budget.envelope) === identity(o.originalGrant.resources) && root.startedAt === Date.parse(o.originalGrant.issuedAt) && budget.startedAt === root.startedAt, 'Original allowance or issued-at changed');
    this.unavailable(Date.parse(o.originalGrant.expiresAt) <= root.startedAt + root.envelope.maxElapsedMs && Date.parse(r.reviewDeadlineAt) <= Date.parse(o.originalGrant.expiresAt) && Date.parse(r.registeredAt) >= root.startedAt, 'Original deadline changed');
    this.unavailable(Date.parse(o.behaviorWindow.notBefore) >= Date.parse(r.registeredAt) && Date.parse(o.behaviorWindow.deadlineAt) >= Date.parse(o.behaviorWindow.notBefore) && Date.parse(o.behaviorWindow.deadlineAt) <= Date.parse(r.reviewDeadlineAt), 'Original behavioral window changed');
    if ('rootCancelled' in r) this.unavailable(r.rootCancelled === o.original.snapshot(r.rootId).cancelled || r.rootCancelled === false && store.get<{ registrationDigest: string }>('development.accounting.bindings', `${r.rootId}:${this.role.id}`)?.value.registrationDigest === this.registrationDigest, 'Original registration cancellation anchor changed');
    for (const role of r.roles) {
      const a = store.get<Allocation>('allocations', role.allocationId)?.value;
      this.unavailable(a && a.rootId === r.rootId && a.parentRunId === r.rootId && identity(a.envelope) === identity(role.resources) && a.startedAt >= root.startedAt && a.startedAt <= Date.parse(r.registeredAt), 'Existing accepted role allocation required');
      for (const field of Object.keys(role.resources) as (keyof ResourceEnvelope)[]) this.unavailable(role.resources[field] <= root.envelope[field], 'Role exceeds original allowance');
    }
    this.unavailable(new Set(r.originalRequests.map(s => s.request.id)).size === r.originalRequests.length, 'Duplicate original anchor');
    for (const anchor of r.originalRequests) {
      const row = store.get<Reservation>('requests', anchor.request.id)?.value;
      this.unavailable(row && !pending(row.request) && anchor.rootId === r.rootId && identity({ request: row.request, ceiling: row.ceiling, charged: row.charged }) === identity({ request: anchor.request, ceiling: anchor.ceiling, charged: anchor.charged }), 'Original anchors must be immutable and quiescent');
    }
    this.checkInventory();
  }
  private checkInventory(): void {
    const store = this.options.original.store;
    for (const row of store.list<Reservation>('requests').filter(row => row.value.rootId === this.registration.rootId)) {
      const anchor = this.registration.originalRequests.find(s => s.request.id === row.key);
      if (anchor) this.unavailable(identity({ request: row.value.request, ceiling: row.value.ceiling, charged: row.value.charged }) === identity({ request: anchor.request, ceiling: anchor.ceiling, charged: anchor.charged }), 'Immutable original anchor changed');
      else {
        const tracked = store.get<Tracked>(requests, row.key)?.value;
        this.unavailable(tracked?.registrationDigest === this.registrationDigest && tracked.immutable === developmentRequestIdentity(row.value.request), 'Unobserved or changed original physical request');
      }
    }
  }
  private live(): void {
    this.preflight(); const o = this.options, now = o.original.now();
    this.unavailable(!o.original.snapshot(this.role.allocationId).cancelled && now >= Date.parse(this.registration.registeredAt) && now < Date.parse(o.originalGrant.expiresAt) && now <= Date.parse(this.registration.reviewDeadlineAt), 'Original grant cancelled or expired');
  }
  private dispatchPhase(): void {
    const frozen = this.options.original.store.get('development.accounting.freeze', this.registrationDigest);
    const now = this.options.original.now();
    if (this.role.kind === 'reviewer') this.unavailable(frozen, 'Reviewer dispatch requires frozen behavior');
    else if (this.role.kind !== 'observer') this.unavailable(!frozen && now >= Date.parse(this.options.behaviorWindow.notBefore) && now <= Date.parse(this.options.behaviorWindow.deadlineAt), 'Behavioral role cannot dispatch outside its original window');
  }
  /** Recorder calls once at the actual host stopping point; never rewrites B. */
  freezeBehavior(): { frozenAt: string; stateDigest: string; rootCancelled: boolean } {
    const store = this.options.original.store, now = this.options.original.now(); this.checkInventory();
    invariant(now <= Date.parse(this.options.behaviorWindow.deadlineAt), 'Behavior cannot freeze after deadline');
    const value = { frozenAt: new Date(now).toISOString(), stateDigest: identity([...this.registration.originalRequests, ...this.states()].sort((a, b) => a.request.id.localeCompare(b.request.id))), rootCancelled: this.rootCancelled };
    const old = store.get<typeof value>('development.accounting.freeze', this.registrationDigest);
    invariant(!old, 'Behavior already frozen'); store.put('development.accounting.freeze', this.registrationDigest, value, null); return value;
  }
  runId(localId: string): string {
    if (this.shared) return localId;
    return localId === this.localRoot ? this.role.allocationId : `development-run:${identity([this.registrationDigest, this.role.id, localId])}`;
  }
  requestId(localId: string): string { return this.shared ? localId : `development-request:${identity([this.registrationDigest, this.role.id, localId])}`; }
  private map(q: PhysicalRequest): PhysicalRequest {
    return { ...q, id: this.requestId(q.id), runId: this.runId(q.runId), reservationId: this.requestId(q.reservationId), ...(q.parentRequestId ? { parentRequestId: this.requestId(q.parentRequestId) } : {}) };
  }
  allocate(localId: string, envelope: ResourceEnvelope, parentRunId?: string): void {
    this.live(); const store = this.options.original.store, mapped = this.runId(localId);
    if (localId === this.localRoot) {
      invariant(!parentRunId && identity(envelope) === identity(this.shared ? this.options.originalGrant.resources : this.role.resources), 'Changed local operating allowance'); return;
    }
    invariant(parentRunId, 'Every development allocation descends from its role');
    const parent = this.shared && parentRunId === this.localRoot ? this.role.allocationId : this.runId(parentRunId);
    store.transaction(() => {
      const p = store.get<Allocation>('allocations', parent)?.value; invariant(p && this.path(parent).includes(this.role.allocationId), 'Foreign role allocation');
      for (const key of Object.keys(envelope) as (keyof ResourceEnvelope)[]) invariant(envelope[key] <= p.envelope[key], 'Local sublimit exceeds parent');
      const value = { localId, parentRunId, envelope, roleId: this.role.id, registrationDigest: this.registrationDigest };
      const binding = store.get('development.accounting.allocations', mapped), existing = store.get<Allocation>('allocations', mapped);
      if (binding) invariant(identity(binding.value) === identity(value) && existing?.value.parentRunId === parent && identity(existing.value.envelope) === identity(envelope), 'Allocation mapping changed');
      else { invariant(!existing, 'Unbound original allocation'); this.options.original.allocate(mapped, envelope, parent); store.put('development.accounting.allocations', mapped, value, null); }
    });
  }
  private path(runId: string): string[] {
    const path: string[] = []; let id: string | undefined = runId;
    while (id) { invariant(!path.includes(id) && path.length < 32, 'Invalid original allocation lineage'); path.unshift(id); const row: Allocation | undefined = this.options.original.store.get<Allocation>('allocations', id)?.value; invariant(row, 'Missing original allocation lineage'); id = row.parentRunId; }
    invariant(path[0] === this.registration.rootId, 'Foreign original root'); return path;
  }
  private assertCurrentUse(): void { invariant(this.options.assertCurrentUse?.() === undefined, 'Current-use hook must be synchronous and return void'); }
  capturePrompt(manifest: PromptManifest, payload: string): void {
    this.assertCurrentUse(); validateCapturedPrompt(manifest, payload); this.live();
    const raw = this.options.rawStore;
    const artifact = raw.putBytes(Buffer.from(payload));
    const fragments = manifest.fragments.map(fragment => { const bytes = this.options.localStore.readArtifact(fragment.artifact, 1_000_000), artifact = raw.putBytes(bytes); invariant(artifact.sha256 === fragment.artifact.sha256, 'Prompt fragment changed'); return { artifact, bytes: bytes.byteLength }; });
    const prompt = raw.putBytes(Buffer.from(canonicalJson({ manifest, artifact })));
    const old = this.captured.get(manifest.id); invariant(!old || identity(old) === identity({ payload: artifact, prompt, fragments }), 'Captured prompt identity reused');
    this.captured.set(manifest.id, { payload: artifact, prompt, fragments });
  }
  captureTool(call: ToolCall): void {
    this.assertCurrentUse(); this.live(); const payload = this.options.rawStore.putBytes(Buffer.from(canonicalJson(call)));
    const key = `tool:${call.id}`, old = this.captured.get(key);
    invariant(!old || identity(old) === identity({ payload, prompt: null, fragments: [] }), 'Captured effect identity reused'); this.captured.set(key, { payload, prompt: null, fragments: [] });
  }
  reserve(local: PhysicalRequest): void {
    this.assertCurrentUse(); this.live(); this.dispatchPhase(); validatePhysicalRequest(local); const q = this.map(local), capture = this.captured.get(local.promptManifestId);
    invariant(capture && capture.payload.sha256 === local.requestDigest, 'Exact retained request required before original reservation');
    invariant(this.path(q.runId).includes(this.role.allocationId), 'Request lacks accepted role lineage');
    if (local.provider === 'effect-receiver') invariant(capture.prompt === null && this.role.allowedEffects.includes(local.model), 'Unregistered effect receiver');
    else {
      const profile = this.role.profile;
      invariant(profile && local.provider === (profile.provider ?? 'mistral') && local.model === profile.id && capture.prompt, 'Unregistered model profile');
      invariant(['reasoning', 'compaction', 'review'].includes(local.purpose), 'Unregistered model request purpose');
      const payload = this.options.rawStore.readArtifact(capture.payload, 1_000_000);
      const tokens = payload.byteLength + 1024;
      invariant(local.usage.inputTokens === tokens && local.usage.outputTokens === profile.maxOutputTokens && local.usage.costUsd === (tokens * profile.pricesPerMillion.input + profile.maxOutputTokens * profile.pricesPerMillion.output) / 1_000_000 && local.usage.elapsedMs === profile.timeoutMs, 'Request differs from host profile ceiling');
    }
    const store = this.options.original.store;
    // An orphan's physical ID remains consumed. A restart may not skip it and continue.
    for (const row of store.list<Tracked>(requests).filter(row => row.value.registrationDigest === this.registrationDigest && row.value.roleId === this.role.id)) {
      const old = this.options.original.request(row.key)!;
      if (pending(old) && !this.options.localStore.get('requests', row.value.localId)) throw new DevelopmentAccountingUnavailable('Orphan original reservation blocks role continuation');
    }
    invariant(!store.get(requests, q.id) && !this.options.original.request(q.id), 'Physical identity already consumed');
    this.options.reserveEvidence({ request: q, ...capture, payloadBytes: this.options.rawStore.readArtifact(capture.payload, 1_000_000).byteLength, promptBytes: capture.prompt ? this.options.rawStore.readArtifact(capture.prompt, 1_000_000).byteLength + capture.fragments.reduce((n, f) => n + f.bytes, 0) : 0, maxResponseBytes: this.options.maxResponseBytes, maxTransitions: 5 });
    store.transaction(() => {
      this.options.original.reserve(q);
      store.put(requests, q.id, { ...capture, registrationDigest: this.registrationDigest, roleId: this.role.id, localId: local.id, localRunId: local.runId, immutable: developmentRequestIdentity(q) } satisfies Tracked, null);
      this.transition(q.id, null, null);
    });
  }
  private state(id: string): DevelopmentRequestState {
    const row = this.options.original.store.get<Reservation>('requests', id)?.value, record = this.options.original.store.get<Tracked>(requests, id)?.value;
    invariant(row && record && record.registrationDigest === this.registrationDigest && record.roleId === this.role.id, 'Foreign physical accounting row');
    return { rootId: this.registration.rootId, roleId: this.role.id, configurationDigest: this.role.configurationDigest, closureDigest: this.role.closureDigest, allocationPath: this.path(row.request.runId), observedAt: new Date(this.options.original.now()).toISOString(), request: row.request, ceiling: row.ceiling, charged: row.charged, payload: record.payload, prompt: record.prompt };
  }
  private latest(id: string): DevelopmentRequestState {
    const row = this.options.original.store.get<DevelopmentRequestState>('development.accounting.latest', id); invariant(row, 'Missing prior accounting state'); return row.value;
  }
  private transition(id: string, prior: DevelopmentRequestState | null, outcome: TrustedOutcome | null): void {
    const store = this.options.original.store, state = this.state(id);
    const history = store.events<DevelopmentAccountingTransition>(this.stream);
    invariant(!history.length || Date.parse(state.observedAt) >= Date.parse(history.at(-1)!.data.state.observedAt), 'Host observation clock moved backward');
    invariant(history.filter(e => e.data.state.request.id === id).length < 5, 'Reserved transition capacity exhausted');
    const settlement = outcome ? signDocument(reviewEnvelopeDomains.settlement, { version: 2, registrationDigest: this.registrationDigest, requestIdentityDigest: developmentRequestIdentity(state.request), observedAt: state.observedAt, ...outcome } satisfies DevelopmentSettlement, this.options.transport.id, this.options.transport.key) : null;
    const transition: DevelopmentAccountingTransition = { beforeDigest: prior ? identity(prior) : null, state, settlement };
    store.append({ id: randomUUID(), stream: this.stream, type: 'physical-transition', data: transition });
    const old = store.get('development.accounting.latest', id); store.put('development.accounting.latest', id, state, old?.revision ?? null);
  }
  dispatched(local: PhysicalRequest): void {
    this.assertCurrentUse(); this.live(); this.dispatchPhase(); const q = this.map(local), store = this.options.original.store;
    store.transaction(() => { const prior = this.latest(q.id); invariant(developmentRequestIdentity(q) === developmentRequestIdentity(prior.request), 'Physical dispatch changed'); this.options.original.dispatched(q); this.transition(q.id, prior, null); });
  }
  private entered(localId: string): PhysicalRequest {
    const original = this.options.original, store = original.store;
    return store.transaction(() => {
      this.live(); const q = original.request(this.requestId(localId)); invariant(q?.status === 'dispatched', 'Receiver lacks original durable dispatch');
      const tracked = store.get<Tracked>(requests, q.id)?.value, path = this.path(q.runId);
      invariant(tracked?.registrationDigest === this.registrationDigest && tracked.roleId === this.role.id && path.includes(this.role.allocationId), 'Receiver changed registered allocation lineage');
      this.unavailable(!original.snapshot(q.runId).cancelled, 'Original request allocation cancelled');
      const rows = store.list<Reservation>('requests'), now = original.now();
      for (const id of path) {
        const allocation = store.get<Allocation>('allocations', id)!.value, descendants = new Set([id, ...original.descendants(id)]);
        const charged = rows.filter(row => descendants.has(row.value.request.runId)).reduce((n, row) => n + row.value.charged.elapsedMs, 0);
        this.unavailable(!allocation.cancelled && Math.max(now - allocation.startedAt, charged) <= allocation.envelope.maxElapsedMs, 'Original request ancestor cancelled or expired');
      }
      return q;
    });
  }
  assertEntry(localId: string): void { this.assertCurrentUse(); this.dispatchPhase(); this.entered(localId); }
  private verifyRetainedResponse(id: string, ref: ArtifactRef): void {
    const q = this.options.original.request(id), tracked = this.options.original.store.get<Tracked>(requests, id)?.value;
    invariant(q && ['dispatched', 'uncertain'].includes(q.status) && tracked?.roleId === this.role.id && tracked.registrationDigest === this.registrationDigest, 'Response verification lacks original dispatched role binding');
    invariant(/^[a-f0-9]{64}$/.test(ref.sha256) && ref.uri === `sha256:${ref.sha256}`, 'Response verification requires exact retained artifact');
    const bytes = this.options.readRetainedResponse
      ? this.options.readRetainedResponse(id, { uri: ref.uri, sha256: ref.sha256 }, this.options.maxResponseBytes)
      : this.options.rawStore.readArtifact(ref, this.options.maxResponseBytes);
    invariant(bytes instanceof Uint8Array && bytes.byteLength <= this.options.maxResponseBytes && createHash('sha256').update(bytes).digest('hex') === ref.sha256, 'Response retention substituted, exceeded its bound or lost original bytes');
  }
  private retainResponse(localId: string, bytes: Uint8Array): ArtifactRef {
    invariant(bytes.byteLength <= this.options.maxResponseBytes, 'Response exceeds reserved evidence capacity');
    const id = this.requestId(localId), q = this.options.original.request(id);
    const tracked = this.options.original.store.get<Tracked>(requests, id)?.value;
    invariant(q && ['dispatched', 'uncertain'].includes(q.status) && tracked?.roleId === this.role.id && tracked.registrationDigest === this.registrationDigest, 'Response lacks original dispatched role binding');
    const expected = createHash('sha256').update(bytes).digest('hex');
    const ref = inertSnapshot(this.options.retainResponse ? this.options.retainResponse(id, Uint8Array.from(bytes)) : this.options.rawStore.putBytes(bytes));
    invariant(ref.sha256 === expected, 'Response retention substituted or lost original bytes'); this.verifyRetainedResponse(id, ref);
    return ref;
  }
  recordResponse(localId: string, response: { status: number; body: string }): void {
    const id = this.requestId(localId), store = this.options.original.store, q = this.options.original.request(id);
    const tracked = store.get<Tracked>(requests, id)?.value;
    invariant(q && ['dispatched', 'uncertain'].includes(q.status) && tracked?.roleId === this.role.id && tracked.registrationDigest === this.registrationDigest, 'Response lacks original dispatched role binding');
    invariant(Buffer.byteLength(response.body) <= this.options.maxResponseBytes, 'Response exceeds reserved evidence capacity');
    const ref = this.retainResponse(localId, Buffer.from(response.body)); this.responses.set(localId, ref);
    const old = store.get('development.accounting.responses', id);
    invariant(!old || identity(old.value) === identity({ status: response.status, response: ref }), 'Changed physical response');
    if (!old) store.put('development.accounting.responses', id, { status: response.status, response: ref }, null);
  }
  recordTransport(receipt: TransportReceipt): void {
    const id = this.requestId(receipt.requestId), store = this.options.original.store;
    const q = this.options.original.request(id); invariant(q && q.provider !== 'effect-receiver', 'Foreign model transport');
    const record = store.get<Tracked>(requests, id)?.value; invariant(record?.roleId === this.role.id, 'Foreign role transport');
    invariant(receipt.dispatched && ['dispatched', 'uncertain'].includes(q.status), 'Transport lacks original dispatched state');
    if (receipt.status === 'succeeded') invariant(receipt.responseDigest && receipt.responseModel === this.role.profile?.id && receipt.httpStatus !== null && receipt.httpStatus >= 200 && receipt.httpStatus < 300, 'Successful transport lacks exact raw/model response');
    if (!receipt.responseDigest) invariant(receipt.status === 'uncertain' && receipt.usage.inputTokens === null && receipt.usage.outputTokens === null && receipt.usage.costUsd === null, 'Known transport usage requires raw response');
    const response = this.responses.get(receipt.requestId) ?? store.get<{ response: ArtifactRef }>('development.accounting.responses', id)?.value.response ?? null;
    if (receipt.responseDigest) {
      invariant(response?.sha256 === receipt.responseDigest, 'Raw response unavailable for trusted settlement');
      this.verifyRetainedResponse(id, response);
    }
    const value: TrustedOutcome = { status: ['succeeded', 'failed'].includes(receipt.status) ? receipt.status as 'succeeded' | 'failed' : 'uncertain', dispatched: receipt.dispatched, usage: inertSnapshot(receipt.usage), response };
    const old = store.get(outcomes, id); store.put(outcomes, id, value, old?.revision ?? null);
  }
  private trustedEffect(localId: string, status: TrustedOutcome['status'], elapsedMs: number, response: ArtifactRef | null): void {
    const id = this.requestId(localId), store = this.options.original.store;
    const value: TrustedOutcome = { status, dispatched: true, usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs }, response };
    const old = store.get(outcomes, id); store.put(outcomes, id, value, old?.revision ?? null);
  }
  settle(local: PhysicalRequest): PhysicalRequest {
    this.checkInventory();
    const q = this.map(local), store = this.options.original.store;
    return store.transaction(() => {
      const original = this.options.original.request(q.id); invariant(original, 'Missing original physical reservation');
      invariant(developmentRequestIdentity(original) === developmentRequestIdentity(q), 'Physical settlement identity changed');
      const prior = this.latest(q.id);
      const trusted = store.get<TrustedOutcome>(outcomes, q.id)?.value;
      // A worker's advisory status or usage cannot prove non-dispatch or release a charge.
      const outcome: TrustedOutcome = trusted ?? { status: 'uncertain', dispatched: original.status !== 'reserved', usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: prior.ceiling.elapsedMs }, response: null };
      if (original.status === 'reserved') throw new DevelopmentAccountingUnavailable('Consumed original reservation lacks trusted non-dispatch proof');
      if (!pending(original)) { invariant(identity({ status: original.status, usage: original.usage }) === identity({ status: outcome.status, usage: outcome.usage }), 'Terminal original settlement cannot be rewritten'); return { ...local, status: original.status, usage: original.usage }; }
      this.options.original.settle({ ...original, status: outcome.status, usage: outcome.usage }); this.transition(q.id, prior, outcome);
      return { ...local, status: outcome.status, usage: outcome.usage };
    });
  }
  recover(): void {
    this.checkInventory();
    const store = this.options.original.store;
    store.transaction(() => {
      for (const row of store.list<Tracked>(requests).filter(row => row.value.registrationDigest === this.registrationDigest && row.value.roleId === this.role.id)) {
        const q = this.options.original.request(row.key)!; if (q.status !== 'dispatched') continue;
        const prior = this.latest(row.key), outcome: TrustedOutcome = { status: 'uncertain', dispatched: true, usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: prior.ceiling.elapsedMs }, response: null };
        this.options.original.settle({ ...q, status: 'uncertain', usage: outcome.usage }); this.transition(row.key, prior, outcome);
      }
    });
  }
  cancel(localId: string): void { const id = this.shared && localId === this.localRoot ? this.role.allocationId : this.runId(localId); invariant(this.path(id).includes(this.role.allocationId), 'Cannot cancel another role'); this.options.original.cancel(id); }
  wrapShell(shell: ShellPort): ShellPort {
    return { run: (input, bridge, signal) => shell.run(input, { ...bridge,
      capturePrompt: async (manifest, payload) => { this.capturePrompt(manifest, payload); await bridge.capturePrompt(manifest, payload); },
      execute: async (call, toolSignal) => { this.captureTool(call); return bridge.execute(call, toolSignal); },
    }, signal) };
  }
  wrapReceiver(receiver: EffectReceiver): EffectReceiver {
    const retain = (id: string, ref?: ArtifactRef): ArtifactRef | null => ref ? this.retainResponse(id, this.options.localStore.readArtifact(ref, this.options.maxResponseBytes)) : null;
    return {
      dispatch: async (effect, signal) => {
        this.assertEntry(effect.id); const start = this.options.original.now();
        try { const result = await receiver.dispatch(effect, signal); this.trustedEffect(effect.id, result.outcome, Math.max(0, this.options.original.now() - start), retain(effect.id, result.receipt)); return result; }
        catch (error) { this.trustedEffect(effect.id, 'uncertain', Math.max(0, this.options.original.now() - start), null); throw error; }
      },
      reconcile: async effect => {
        this.assertCurrentUse();
        const q = this.options.original.request(this.requestId(effect.id)); invariant(q?.status === 'uncertain', 'Only original uncertainty can reconcile');
        invariant(this.transitions().filter(e => e.state.request.id === q.id).length < 5, 'Reserved reconciliation transition capacity exhausted');
        // Reconciliation may itself contact a physical receiver; it is a new accounted request.
        const id = `development-reconcile:${randomUUID()}`, payload = this.options.rawStore.putBytes(Buffer.from(canonicalJson({ kind: 'reconciliation', effect })));
        this.captured.set(id, { payload, prompt: null, fragments: [] });
        const request: PhysicalRequest = { id, runId: effect.runId, parentRequestId: effect.id, purpose: 'reasoning', provider: 'effect-receiver', model: effect.kind, promptManifestId: id, requestDigest: payload.sha256, reservationId: id, status: 'reserved', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } };
        this.resources.reserve(request); this.resources.dispatched({ ...request, status: 'dispatched' }); this.assertEntry(id);
        const start = this.options.original.now();
        try {
          const result = await receiver.reconcile(effect), response = retain(id, result.receipt);
          const status = result.outcome === 'succeeded' ? 'succeeded' : result.outcome === 'not-applied' ? 'failed' : 'uncertain';
          this.trustedEffect(id, status, Math.max(0, this.options.original.now() - start), response);
          this.resources.settle({ ...request, status, usage: request.usage });
          this.trustedEffect(effect.id, status, q.usage.elapsedMs, response);
          const local = this.resources.request(effect.id); invariant(local, 'Missing local uncertain request'); this.resources.settle(local);
          return result;
        } catch (error) {
          if (pending(this.options.original.request(this.requestId(id))!)) {
            this.trustedEffect(id, 'uncertain', Math.max(0, this.options.original.now() - start), null);
            this.resources.settle({ ...request, status: 'uncertain' });
          }
          throw error;
        }
      },
    };
  }
  transitions(): DevelopmentAccountingTransition[] { return this.options.original.store.events<DevelopmentAccountingTransition>(this.stream).filter(e => e.type === 'physical-transition').map(e => e.data); }
  states(): DevelopmentRequestState[] { const store = this.options.original.store; return store.list<DevelopmentRequestState>('development.accounting.latest').filter(row => store.get<Tracked>(requests, row.key)?.value.registrationDigest === this.registrationDigest).map(row => row.value); }
  originalRequest(localId: string): PhysicalRequest | undefined { return this.options.original.request(this.requestId(localId)); }
  /** Actual persistent root cancellation, including irreversible physical ceiling overrun. */
  get rootCancelled(): boolean { return this.options.original.snapshot(this.registration.rootId).cancelled; }
  get maxResponseBytes(): number { return this.options.maxResponseBytes; }
  accounting(grantId: string): Accounting {
    this.checkInventory(); const states = [...this.registration.originalRequests, ...this.states()];
    const sum = (field: 'inputTokens' | 'outputTokens' | 'costUsd'): number | null => states.reduce<number | null>((n, s) => n === null || s.request.usage[field] === null ? null : n + s.request.usage[field], 0);
    const actual = this.options.original.snapshot(this.registration.rootId);
    return { grantId, usage: { requests: actual.requests, inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), costUsd: sum('costUsd'), elapsedMs: actual.elapsedMs }, chargedTokens: actual.tokens, chargedCostUsd: actual.costUsd, chargedElapsedMs: states.reduce((n, s) => n + s.charged.elapsedMs, 0), requestIds: states.map(s => s.request.id), unknownRequestIds: states.filter(s => pending(s.request) || s.request.usage.inputTokens === null || s.request.usage.outputTokens === null || s.request.usage.costUsd === null).map(s => s.request.id) };
  }
  get isShared(): boolean { return this.shared; }
}

class AccountingLedger extends ResourceLedger {
  private adapter: DevelopmentAccounting;
  constructor(adapter: DevelopmentAccounting, store: OperationalStore, ceiling: RequestCeiling, now: () => number) { super(store, ceiling, now); this.adapter = adapter; }
  override allocate(id: string, envelope: ResourceEnvelope, parent?: string): void { this.adapter.allocate(id, envelope, parent); if (!this.adapter.isShared) super.allocate(id, envelope, parent); }
  override reserve(q: PhysicalRequest): void { this.adapter.reserve(q); if (!this.adapter.isShared) super.reserve(q); }
  override dispatched(q: PhysicalRequest): void { this.adapter.dispatched(q); if (!this.adapter.isShared) super.dispatched(q); }
  override settle(q: PhysicalRequest): void { const trusted = this.adapter.settle(q); if (!this.adapter.isShared) super.settle(trusted); }
  override recoverDispatched(): void { this.adapter.recover(); if (!this.adapter.isShared) super.recoverDispatched(); }
  override recoverUndispatchedEffects(): void { /* Outer consumption cannot be restored from an isolated effect journal. */ }
  override cancel(id: string): void { this.adapter.cancel(id); if (!this.adapter.isShared) super.cancel(id); }
}
