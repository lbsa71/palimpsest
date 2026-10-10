import { codingOrientation } from './autark.ts';
import { createHash } from 'node:crypto';
import { CodingAccounting } from './coding-accounting.ts';
import { codingJson, validateCodingContract } from './coding-state.ts';
import type { CodingSession, CodingSessionPatch, CodingReservationResult, CodingInitialCall } from './coding-state.ts';
import { codingData } from './coding-contracts.ts';
import type { CodingExecutionContext, CodingProviderGates, CodingSessionData, CodingSessionPolicy } from './coding-contracts.ts';
import type { CodingMessage, CodingProviderPort } from './coding-provider.ts';
import type { CodingArtifacts, CodingArtifactImportAuthority } from './coding-artifacts.ts';
import { CodingTools } from './coding-tools.ts';
import { CodingWorkspaces } from './workspaces.ts';
import type { WorkspaceAuthority } from './workspaces.ts';
import { Store } from './store.ts';
import type { Json, Task } from './store.ts';
export type { CodingSessionPolicy } from './coding-contracts.ts';

export interface CodingSessionCoordinatorOptions {
  store: Store; accounting: CodingAccounting; workspaces: CodingWorkspaces; artifacts: CodingArtifacts;
  epoch(): number; authorizeOrigin(task: Task): boolean; authorizeGrowth?(task: Task): boolean; authorizeSession(session: CodingSession): boolean;
  policy(task: Task, objective: string): CodingSessionPolicy | undefined;
  providerFactory?: (gates: CodingProviderGates) => CodingProviderPort | undefined;
  acquireProviderSlot(signal: AbortSignal): Promise<() => void>;
  now?: () => number;
  /** Reporting permission is separate from execution/source-bearing authority. */
  authorizeOutcome?(session: CodingSession, originTask: Task): boolean;
  onOutcome?(input: { session: CodingSession; originTask: Task; summary: string }): void | Promise<void>;
}
export class CodingUnavailableError extends Error {
  readonly code: string;
  constructor(code: string) { super(`Coding session unavailable: ${code}`); this.code = code; }
}
const replyTo = (task: Task): string | null => {
  const value = task.checkpoint && typeof task.checkpoint === 'object' && !Array.isArray(task.checkpoint) ? task.checkpoint.replyTo : null;
  return typeof value === 'string' ? value : null;
};
const json = (value: unknown): Json => JSON.parse(JSON.stringify(value));
function granted(value: unknown): boolean {
  if (value === true) return true;
  if (value && ['object', 'function'].includes(typeof value)) void Promise.resolve(value).catch(() => {});
  return false;
}
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
function abortAware<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void pending.catch(() => {}); return Promise.reject(new CodingUnavailableError('interrupted')); }
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new CodingUnavailableError('interrupted')); };
    signal.addEventListener('abort', abort, { once: true });
    pending.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
interface Admission { task: Task; executionTaskId: string; attemptId: string; policy: CodingSessionPolicy; epoch: number; controller: AbortController }
/** Durable sequential host coordinator. Native factory owns one bounded step; receivers own effects. */
export class CodingSessionCoordinator {
  #options: CodingSessionCoordinatorOptions;
  #admissions = new Map<string, Admission>();
  #admissionResults = new Map<string, { objective: string; pending: Promise<CodingSession> }>();
  #active = new Map<string, { controller: AbortController; drained: Promise<void> }>();
  #renewing = new Set<string>();
  #expiring = new Set<string>();
  #paused = false;
  #stopped = false;
  #last = '';
  constructor(options: CodingSessionCoordinatorOptions) { this.#options = options; }
  #now(): number { return this.#options.now?.() ?? Date.now(); }
  #admissionCancelled(taskId: string): boolean { return this.#options.store.listEvents({ taskId }).some(event => event.type === 'coding.admission.cancelled'); }
  #originAllowed(task: Task): boolean {
    if (task.state === 'cancelled') return false;
    try {
      if (task.source === 'coding-origin') return granted(this.#options.authorizeGrowth?.(task));
      return ['direct', 'slack'].includes(task.source) && !task.conversationId.startsWith('peer:') && granted(this.#options.authorizeOrigin(task));
    } catch { return false; }
  }
  #currentOrigin(task: Task): boolean {
    const current = this.#options.store.task(task.id);
    return !!current && current.source === task.source && current.conversationId === task.conversationId && JSON.stringify(current.slackAuthor ?? null) === JSON.stringify(task.slackAuthor ?? null) && replyTo(current) === replyTo(task) && this.#originAllowed(current);
  }
  #assert(session: CodingSession, epoch = codingData(session).epoch): void {
    const origin = this.#options.store.task(session.contract.originTaskId);
    const data = codingData(session);
    const binding = session.contract.binding as { policy?: Json; workspaceId?: string; sourceArtifactId?: string; objective?: string; base?: Json; origin?: Json } | null;
    if (!binding?.policy || JSON.stringify(binding.policy) !== JSON.stringify(data.policy) || binding.workspaceId !== data.workspaceId || binding.sourceArtifactId !== data.sourceArtifactId || binding.objective !== data.objective || JSON.stringify(binding.base) !== JSON.stringify(data.base)) throw new CodingUnavailableError('contract-data-conflict');
    if (this.#stopped || !origin || !this.#originAllowed(origin) || JSON.stringify(binding.origin) !== JSON.stringify({ taskId: origin.id, source: origin.source, conversationId: origin.conversationId, slackAuthor: origin.slackAuthor ?? null, replyTo: replyTo(origin) }) || !granted(this.#options.authorizeSession(session)) || this.#options.epoch() !== epoch || session.contract.expiresAt <= this.#now()) throw new CodingUnavailableError('authority-or-expiry');
  }
  authorizeWorkspace(authority: WorkspaceAuthority): boolean {
    if (this.#stopped || this.#options.epoch() !== authority.epoch) return false;
    for (const admission of this.#admissions.values()) if (admission.executionTaskId === authority.taskId) return !admission.controller.signal.aborted && admission.epoch === authority.epoch && admission.policy.expiresAt > this.#now() && this.#currentOrigin(admission.task);
    const session = this.#options.accounting.list().find(session => session.contract.taskId === authority.taskId);
    if (!session) return false;
    try {
      const data = codingData(session); this.#assert(session, authority.epoch);
      return data.workspaceId === authority.workspaceId && (data.epoch === authority.epoch || this.#renewing.has(session.id)) && (session.state === 'running' || this.#renewing.has(session.id));
    } catch { return false; }
  }
  authorizeArtifact(authority: CodingArtifactImportAuthority): boolean {
    if (this.#stopped || this.#options.epoch() !== authority.epoch) return false;
    const admission = this.#admissions.get(authority.sessionId);
    if (admission) return admission.executionTaskId === authority.taskId && admission.attemptId === authority.attemptId && admission.policy.expiresAt === authority.expiresAt && !admission.controller.signal.aborted && this.#currentOrigin(admission.task);
    const session = this.#options.accounting.get(authority.sessionId);
    if (!session) return false;
    try { this.#assert(session, authority.epoch); return session.state === 'running' && session.contract.taskId === authority.taskId && session.contract.attemptId === authority.attemptId && session.contractDigest === authority.contractDigest; } catch { return false; }
  }
  status(id: string): CodingSession | undefined { return this.#options.accounting.get(id) ?? this.#options.accounting.get(`coding:${id}`); }
  async admitGrowth(task: Task, objective: string): Promise<CodingSession> {
    if (task.source !== 'coding-origin' || !this.#originAllowed(task)) throw new CodingUnavailableError('ineligible-growth-origin');
    return this.#idempotentAdmit(task, objective);
  }
  async admitTask(task: Task, objective: string): Promise<CodingSession> {
    if (!['direct', 'slack'].includes(task.source)) throw new CodingUnavailableError('ineligible-origin');
    return this.#idempotentAdmit(task, objective);
  }
  #idempotentAdmit(task: Task, objective: string): Promise<CodingSession> {
    const existing = this.#admissionResults.get(task.id);
    if (existing) return existing.objective === objective ? existing.pending : Promise.reject(new CodingUnavailableError('objective-conflict'));
    const pending = this.#admit(task, objective);
    this.#admissionResults.set(task.id, { objective, pending });
    void pending.finally(() => { if (this.#admissionResults.get(task.id)?.pending === pending) this.#admissionResults.delete(task.id); }).catch(() => {});
    return pending;
  }
  async #admit(task: Task, objective: string): Promise<CodingSession> {
    if (this.#stopped || this.#paused || !this.#currentOrigin(task) || typeof objective !== 'string' || !objective.trim() || Buffer.byteLength(objective) > 16384) throw new CodingUnavailableError('ineligible-origin');
    if (this.#admissionCancelled(task.id)) throw new CodingUnavailableError('cancelled-origin');
    const id = `coding:${task.id}`, prior = this.#options.accounting.get(id);
    if (prior) { if (codingData(prior).objective !== objective) throw new CodingUnavailableError('objective-conflict'); return prior; }
    let policy: CodingSessionPolicy | undefined;
    try { policy = this.#options.policy(task, objective); } catch { throw new CodingUnavailableError('invalid-policy'); }
    const taskId = `${id}:execution`, attemptId = `${id}:attempt:1`;
    if (!policy || !this.#options.providerFactory || policy.expiresAt <= this.#now()) {
      this.#options.store.appendEvent('coding.admission.unavailable', { originTaskId: task.id, objective, reason: !policy ? 'missing-contract' : !this.#options.providerFactory ? 'missing-provider' : 'expired' }, task.id);
      throw new CodingUnavailableError(!policy ? 'missing-contract' : !this.#options.providerFactory ? 'missing-provider' : 'expired');
    }
    try {
      codingJson(policy);
      validateCodingContract({ version: 'coding-session/1', sessionId: id, workRootId: task.id, attemptId, originTaskId: task.id, taskId, lane: policy.lane, limits: policy.limits, expiresAt: policy.expiresAt, binding: null });
      if (typeof policy.catalogVersion !== 'string' || !policy.catalogVersion.trim()) throw new Error('Missing catalog binding');
      for (const value of Object.values(policy.providerLimits)) if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) throw new Error('Invalid provider limit');
    } catch { granted(policy); throw new CodingUnavailableError('invalid-policy'); }
    for (const value of [policy.maxTranscriptMessages, policy.maxTranscriptBytes, policy.commandTimeoutMs, policy.maxCommandOutputBytes]) if (!Number.isSafeInteger(value) || value <= 0) throw new CodingUnavailableError('invalid-policy');
    const epoch = this.#options.epoch(), controller = new AbortController();
    const admission: Admission = { task: structuredClone(task), executionTaskId: taskId, attemptId, policy: structuredClone(policy), epoch, controller };
    if (this.#admissions.has(id)) throw new CodingUnavailableError('admission-in-progress');
    this.#admissions.set(id, admission);
    try {
      let owner = this.#options.store.task(taskId);
      if (!owner) owner = this.#options.store.enqueue({ id: taskId, source: 'coding-session', conversationId: task.conversationId, input: objective, eventId: id });
      if (owner.state === 'queued') this.#options.store.updateTask(taskId, { state: 'running', checkpoint: { sessionId: id, originTaskId: task.id, epoch } });
      this.#options.store.appendEvent('coding.admission.intended', { sessionId: id, taskId, originTaskId: task.id, attemptId, epoch }, taskId);
      const authority = { taskId, sessionId: id, attemptId, epoch, expiresAt: policy.expiresAt };
      const imported = await abortAware(this.#options.artifacts.importSource({ authority, signal: controller.signal }), controller.signal);
      if (!this.authorizeArtifact(authority)) throw new CodingUnavailableError('authority-or-expiry');
      const existing = this.#options.store.listEvents({ taskId }).filter(event => event.type === 'workspace.created').at(-1)?.payload as { id?: string } | undefined;
      const workspace = existing?.id ? this.#options.workspaces.workspace(existing.id) : this.#options.workspaces.create({ taskId, epoch, base: imported.base, files: imported.files, directories: imported.directories, rootMode: imported.rootMode });
      if (JSON.stringify(workspace.base) !== JSON.stringify(imported.base)) throw new CodingUnavailableError('source-base-conflict');
      const data: CodingSessionData = { version: 'coding-coordinator/1', objective, epoch, workspaceId: workspace.id, sourceArtifactId: imported.sourceArtifactId, base: imported.base, policy: structuredClone(policy), messages: [{ role: 'system', text: codingOrientation }, { role: 'user', text: objective }], seenCallIds: [], step: 0, pending: [], commands: [], usage: [], inFlight: null, submission: null, outcome: null };
      const initialCall = this.#initialCall(task, policy);
      return this.#options.accounting.admit({ version: 'coding-session/1', sessionId: id, workRootId: task.id, attemptId, originTaskId: task.id, taskId, lane: policy.lane, limits: policy.limits, expiresAt: policy.expiresAt, binding: json({ objective, base: imported.base, sourceArtifactId: imported.sourceArtifactId, workspaceId: workspace.id, initialManifest: workspace.files, initialDirectories: imported.directories, initialRootMode: imported.rootMode, initialCall: initialCall ?? null, providerProfile: policy.providerProfile, catalogVersion: policy.catalogVersion, policy: structuredClone(policy), origin: { taskId: task.id, source: task.source, conversationId: task.conversationId, slackAuthor: task.slackAuthor ?? null, replyTo: replyTo(task) }, report: policy.reportBinding ?? null }) }, { data: json(data), ...(initialCall ? { initialCall } : {}), validateCurrent: () => { if (!this.authorizeArtifact(authority)) throw new CodingUnavailableError('authority-or-expiry'); } });
    } catch (error) {
      const owner = this.#options.store.task(taskId);
      if (owner?.state === 'running' && !this.#options.store.listEffects(taskId).some(effect => effect.state !== 'completed')) {
        const cancelled = this.#admissionCancelled(task.id);
        this.#options.store.updateTask(taskId, { state: cancelled ? 'cancelled' : 'queued', error: cancelled ? 'coding_admission_cancelled' : 'coding_admission_unavailable' });
      }
      this.#options.store.appendEvent('coding.admission.unavailable', { originTaskId: task.id, sessionId: id, reason: 'source-or-authority-unavailable' }, task.id);
      throw error instanceof CodingUnavailableError ? error : new CodingUnavailableError('source-or-authority-unavailable');
    } finally { this.#admissions.delete(id); }
  }
  #initialCall(task: Task, policy: CodingSessionPolicy): CodingInitialCall | undefined {
    const checkpoint = this.#options.store.task(task.id)?.checkpoint as { calls?: number } | null;
    if (policy.lane.kind === 'conversation' && typeof checkpoint?.calls === 'number' && checkpoint.calls > 0) return { taskId: task.id, ordinal: checkpoint.calls };
    if (policy.lane.kind !== 'growth' || task.source !== 'coding-origin') return;
    const admitted = this.#options.store.listEvents({ taskId: task.id }).find(event => event.type === 'coding.growth.origin.admitted')?.payload as { growthId?: string } | undefined;
    const growth = admitted?.growthId ? this.#options.store.growth(admitted.growthId) : undefined;
    const retained = growth?.checkpoint as { phase?: string; decisionText?: string } | null;
    if (retained?.phase !== 'coding_decision' || typeof retained.decisionText !== 'string') return;
    const schedulerId = policy.lane.schedulerId;
    const reservation = this.#options.store.listEvents().filter(event => { const payload = event.payload as { growthId?: string; schedulerId?: string }; return event.type === 'growth.window.call_reserved' && payload.growthId === growth!.id && payload.schedulerId === schedulerId; }).at(-1);
    if (!reservation) throw new CodingUnavailableError('uncharged-growth-decision');
    return { growthId: growth!.id, eventSeq: reservation.seq };
  }
  #owner(session: CodingSession): void {
    const task = this.#options.store.task(session.contract.taskId);
    if (!task || task.source !== 'coding-session' || ['succeeded', 'failed', 'cancelled'].includes(task.state)) throw new CodingUnavailableError('execution-owner-unavailable');
    if (task.state !== 'running' && !this.#options.store.listEffects(task.id).some(effect => effect.state !== 'completed')) this.#options.store.updateTask(task.id, { state: 'running', error: null });
  }
  #save(session: CodingSession, data: CodingSessionData, patch: CodingSessionPatch = {}): CodingSession { return this.#options.accounting.update(session.id, { ...patch, data: json(data) }, { expectedRevision: session.revision }); }
  #context(session: CodingSession, data: CodingSessionData): CodingExecutionContext { return { sessionId: session.id, taskId: session.contract.taskId, attemptId: session.contract.attemptId, contractDigest: session.contractDigest, epoch: data.epoch, expiresAt: session.contract.expiresAt, workspaceId: data.workspaceId, sourceArtifactId: data.sourceArtifactId, base: data.base, commands: data.commands }; }
  #tools(session: CodingSession, data: CodingSessionData): CodingTools { return new CodingTools({ store: this.#options.store, workspaces: this.#options.workspaces, artifacts: this.#options.artifacts, commandTimeoutMs: data.policy.commandTimeoutMs, maxCommandOutputBytes: data.policy.maxCommandOutputBytes, current: context => { const current = this.#options.accounting.get(session.id)!; this.#assert(current, context.epoch); if (current.state !== 'running') throw new CodingUnavailableError('paused-or-terminal'); } }); }
  #transcript(data: CodingSessionData): CodingMessage[] {
    const groups: CodingMessage[][] = [];
    for (const message of data.messages.slice(2)) {
      if (message.role !== 'tool') groups.push([message]); else groups.at(-1)?.push(message);
    }
    const result = (): CodingMessage[] => [{ role: 'system', text: codingOrientation }, ...data.messages.slice(1, 2), ...groups.flat()];
    while (groups.length > 1 && (result().length > data.policy.maxTranscriptMessages || Buffer.byteLength(JSON.stringify(result())) > data.policy.maxTranscriptBytes)) groups.shift();
    const messages = result();
    if (messages.length > data.policy.maxTranscriptMessages || Buffer.byteLength(JSON.stringify(messages)) > data.policy.maxTranscriptBytes) throw new CodingUnavailableError('transcript-limit');
    return messages;
  }
  async #expire(): Promise<void> {
    for (const session of this.#options.accounting.list().filter(session => session.state !== 'terminal' && session.contract.expiresAt <= this.#now())) {
      if (this.#expiring.has(session.id)) continue;
      await this.#retire(session, 'expired');
    }
  }
  async #retire(session: CodingSession, reason: string): Promise<void> {
    this.#expiring.add(session.id);
    try {
      const active = this.#active.get(session.id); active?.controller.abort();
      await this.#options.workspaces.cancel(codingData(session).workspaceId);
      if (active) await active.drained;
      const current = this.#options.accounting.get(session.id)!;
      if (current.state === 'terminal') return;
      for (const request of this.#options.accounting.reservations(session.id)) if (['reserved', 'dispatched'].includes(request.status)) this.#options.accounting.setReservationOutcome(session.id, request.id, { status: 'unknown', reason: reason === 'expired' ? 'expired-response-unavailable' : 'authority-response-unavailable' });
      // Ending inference does not settle an unknown receiver effect or clear its writer claim.
      this.#finish(current, codingData(current), reason);
    } finally { this.#expiring.delete(session.id); }
  }
  async tick(): Promise<boolean> {
    if (this.#stopped) return false;
    await this.#expire();
    if (this.#paused) { await this.#reportOutcomes(); return false; }
    const runnable = this.#options.accounting.list().filter(session => !this.#active.has(session.id) && !this.#expiring.has(session.id) && (session.state === 'running' || session.state === 'ready' || session.state === 'paused' && session.nextEligibleAt !== null && session.nextEligibleAt <= this.#now()));
    const ordered = [...runnable.filter(session => session.id > this.#last), ...runnable.filter(session => session.id <= this.#last)];
    const selected = ordered[0];
    if (!selected) { await this.#reportOutcomes(); return false; }
    this.#last = selected.id;
    const controller = new AbortController();
    const drained = Promise.resolve().then(() => this.#run(selected.id, controller));
    this.#active.set(selected.id, { controller, drained });
    try { await drained; } finally { this.#active.delete(selected.id); }
    await this.#reportOutcomes(); return true;
  }
  async runReady(maxTicks: number): Promise<number> { if (!Number.isSafeInteger(maxTicks) || maxTicks < 1) throw new Error('Finite tick limit required'); let done = 0; while (done < maxTicks && await this.tick()) done++; return done; }
  async #run(id: string, controller: AbortController): Promise<void> {
    let session = this.#options.accounting.get(id)!, data = codingData(session);
    let blocked: CodingReservationResult | undefined;
    try {
      this.#assert(session); this.#owner(session);
      if (session.state !== 'running') session = this.#save(session, data, { state: 'running', phase: data.pending.length ? 'tools-pending' : 'model-intended', reason: null, nextEligibleAt: null });
      const tools = this.#tools(session, data), pending = data.pending.find(tool => tool.state !== 'completed');
      if (pending) {
        pending.state = 'started'; session = this.#save(session, data, { phase: 'tool-intended' });
        if (pending.intent.name === 'workspace_command') {
          const commandGate = this.#options.accounting.reserveCommand(id, { operationId: pending.effectId, intent: json({ workspaceId: data.workspaceId, callId: pending.intent.callId, arguments: pending.intent.arguments }), validateCurrent: () => this.#assert(this.#options.accounting.get(id)!) });
          if (commandGate.disposition === 'blocked') { this.#finish(session, data, commandGate.reason ?? 'command-limit'); return; }
        }
        const receipt = await abortAware(tools.execute(this.#context(session, data), pending.intent, pending.effectId, controller.signal), controller.signal);
        if (controller.signal.aborted) return;
        const current = this.#options.accounting.get(id)!; this.#assert(current, data.epoch); if (current.state !== 'running') return;
        this.#owner(current);
        pending.state = 'completed'; pending.outcome = receipt.outcome; pending.receipt = receipt.receipt;
        if (receipt.command && !data.commands.some(command => command.callId === receipt.command!.callId)) data.commands.push(receipt.command);
        data.messages.push({ role: 'tool', callId: pending.intent.callId, name: pending.intent.name, outcome: receipt.outcome });
        if (receipt.submission) { data.submission = receipt.submission; this.#finish(current, data, 'submitted', true); return; }
        if (data.pending.every(tool => tool.state === 'completed')) data.pending = [];
        this.#save(current, data, { state: 'ready', phase: data.pending.length ? 'tools-pending' : 'model-intended' }); return;
      }
      const reservations = this.#options.accounting.reservations(id);
      if (data.inFlight && reservations.some(request => request.id === data.inFlight!.requestId)) {
        const prior = reservations.find(request => request.id === data.inFlight!.requestId)!;
        if (prior.status === 'reserved' || prior.status === 'dispatched') this.#options.accounting.setReservationOutcome(id, prior.id, { status: 'unknown', reason: 'interrupted-response' });
        data.messages.push({ role: 'user', text: 'A prior physical request was consumed but its response is unavailable. The durable request disposition and reported usage remain as recorded; inspect existing draft state and continue with a fresh bounded request.' });
        data.inFlight = null; data.step++; this.#save(session, data, { state: 'ready', phase: 'model-intended', reason: 'interrupted-response' }); return;
      }
      const messages = this.#transcript(data), ordinal = reservations.length + 1, requestId = `${id}:request:${ordinal}`;
      data.inFlight = { requestId, ordinal, transcriptDigest: sha(JSON.stringify(messages)) };
      session = this.#save(session, data, { phase: 'provider-wait' });
      let release: (() => void) | undefined, reserved = false;
      try {
        const slot = this.#options.acquireProviderSlot(controller.signal).then(value => { if (controller.signal.aborted) value(); return value; });
        release = await abortAware(slot, controller.signal);
        this.#assert(this.#options.accounting.get(id)!, data.epoch);
        const gates: CodingProviderGates = { session, tools: tools.catalog, limits: data.policy.providerLimits, preauthorize: signal => { if (signal.aborted || controller.signal.aborted) throw new CodingUnavailableError('interrupted'); this.#assert(this.#options.accounting.get(id)!, data.epoch); }, reserve: request => {
          if (request.signal.aborted || controller.signal.aborted || reserved) throw new CodingUnavailableError('duplicate-dispatch');
          this.#assert(this.#options.accounting.get(id)!, data.epoch);
          const result = this.#options.accounting.reserve(id, { requestId, ordinal, intent: json({ ...data.inFlight, model: request.model, bodyBytes: request.bodyBytes, bodySha256: request.bodySha256 }), validateCurrent: () => this.#assert(this.#options.accounting.get(id)!, data.epoch) });
          if (result.disposition !== 'reserved') { blocked = result; throw new CodingUnavailableError(result.reason ?? 'consumed-request'); }
          reserved = true;
        } };
        const provider = this.#options.providerFactory?.(gates);
        if (!provider) throw new CodingUnavailableError('missing-provider');
        const response = await abortAware(provider.step({ messages, signal: controller.signal }), controller.signal);
        if (reserved) this.#options.accounting.setReservationOutcome(id, requestId, { status: response.status === 'ok' ? 'observed' : response.dispatch === 'not-sent' ? 'not_dispatched' : 'unknown', usage: json(response.usage), reason: response.status === 'failed' ? response.error.kind : null });
        if (controller.signal.aborted) return;
        session = this.#options.accounting.get(id)!; this.#assert(session, data.epoch); if (session.state !== 'running') return;
        data.inFlight = null;
        if (blocked) { this.#wait(session, data, blocked.reason ?? 'consumed-request', blocked.nextEligibleAt ?? null); return; }
        if (!reserved) { this.#finish(session, data, 'unreserved-provider-response'); return; }
        data.step++; data.usage.push(response.usage);
        if (response.status === 'failed') { this.#wait(session, data, response.error.kind, response.error.kind === 'provider' || response.error.kind === 'deadline' ? this.#now() + 1000 : null); return; }
        try {
          if (typeof response.text !== 'string' || Buffer.from(response.text).toString() !== response.text || !Array.isArray(response.intents) || response.intents.length > (data.policy.providerLimits.maxIntentsPerStep ?? 8) || response.finishReason === 'stop' && response.intents.length !== 0 || response.finishReason === 'tool-calls' && response.intents.length === 0 || !['stop', 'tool-calls'].includes(response.finishReason)) throw new Error('Invalid coding finish');
          tools.validateBatch(response.intents, data.seenCallIds, session.contract.limits.maxCommands - data.commands.length); }
        catch { this.#finish(session, data, 'invalid-intent'); return; }
        data.messages.push({ role: 'assistant', text: response.text, intents: response.intents });
        data.seenCallIds.push(...response.intents.map(intent => intent.callId));
        data.pending = response.intents.map(intent => ({ intent, effectId: `${id}:step:${data.step}:call:${intent.callId}`, state: 'pending' }));
        if (response.finishReason === 'stop') { this.#finish(session, data, response.text || 'finished-without-submission', true); return; }
        this.#save(session, data, { state: 'ready', phase: 'response-persisted' });
      } finally {
        if (reserved) {
          const recorded = this.#options.accounting.reservations(id).find(request => request.id === requestId);
          if (recorded && ['reserved', 'dispatched'].includes(recorded.status)) this.#options.accounting.setReservationOutcome(id, requestId, { status: 'unknown', reason: controller.signal.aborted ? 'interrupted-response' : 'response-unavailable' });
        }
        release?.();
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      session = this.#options.accounting.get(id)!;
      if (session.state === 'terminal' || session.state === 'paused') return;
      if (blocked) { data.inFlight = null; this.#wait(session, data, blocked.reason ?? 'consumed-request', blocked.nextEligibleAt ?? null); return; }
      const code = error instanceof CodingUnavailableError ? error.code : 'receiver-reconciliation';
      if (data.pending.some(tool => tool.state === 'started')) this.#save(session, data, { state: 'paused', phase: 'reconciliation', reason: code, nextEligibleAt: null });
      else if (code === 'authority-or-expiry' || code === 'missing-provider' || code === 'transcript-limit' || code === 'execution-owner-unavailable' || code === 'contract-data-conflict') this.#finish(session, data, code);
      else this.#save(session, data, { state: 'paused', phase: 'provider-wait', reason: code, nextEligibleAt: null });
    }
  }
  #wait(session: CodingSession, data: CodingSessionData, reason: string, wake: number | null): void {
    if (['expired', 'sessionId_call_limit', 'workRootId_call_limit', 'attemptId_call_limit', 'conversation_call_limit', 'terminal'].includes(reason)) this.#finish(session, data, reason);
    else this.#save(session, data, { state: 'paused', phase: 'budget-or-provider-wait', reason, nextEligibleAt: wake });
  }
  #finish(session: CodingSession, data: CodingSessionData, summary: string, successful = false): void {
    data.outcome = summary;
    this.#options.store.transaction(() => {
      this.#save(session, data, { state: 'terminal', phase: data.submission ? 'submitted' : 'terminated', reason: summary, nextEligibleAt: null });
      this.#options.store.appendEvent('coding.outcome.ready', { sessionId: session.id, originTaskId: session.contract.originTaskId, summary, submission: data.submission }, session.contract.taskId);
      const task = this.#options.store.task(session.contract.taskId);
      if (task && !['succeeded', 'failed', 'cancelled'].includes(task.state) && !this.#options.store.listEffects(task.id).some(effect => effect.state !== 'completed')) {
        if (task.state === 'queued') this.#options.store.updateTask(task.id, { state: 'running' });
        this.#options.store.updateTask(task.id, { state: summary === 'cancelled' ? 'cancelled' : successful ? 'succeeded' : 'failed', output: { sessionId: session.id, summary, submission: data.submission } });
      }
    });
  }
  #canReport(session: CodingSession, originTask: Task): boolean {
    const binding = (session.contract.binding as { origin?: Json } | null)?.origin;
    if (!['direct', 'slack', 'coding-origin'].includes(originTask.source) || originTask.conversationId.startsWith('peer:') || JSON.stringify(binding) !== JSON.stringify({ taskId: originTask.id, source: originTask.source, conversationId: originTask.conversationId, slackAuthor: originTask.slackAuthor ?? null, replyTo: replyTo(originTask) })) return false;
    try { return !this.#options.authorizeOutcome || granted(this.#options.authorizeOutcome(session, originTask)); } catch { return false; }
  }
  async #reportOutcomes(): Promise<void> {
    if (!this.#options.onOutcome) return;
    for (const session of this.#options.accounting.list().filter(session => session.state === 'terminal')) {
      if (this.#options.store.listEvents().some(event => event.type === 'coding.outcome.registered' && (event.payload as { sessionId?: string }).sessionId === session.id)) continue;
      const originTask = this.#options.store.task(session.contract.originTaskId);
      if (!originTask || !this.#canReport(session, originTask)) continue;
      const epoch = this.#options.epoch();
      const summary = this.#originAllowed(originTask) ? codingData(session).outcome ?? session.reason ?? 'Coding execution ended' : 'Coding execution ended; its draft is retained. Execution authority is unavailable. No release acceptance is claimed.';
      await this.#options.onOutcome({ session, originTask, summary });
      const currentOrigin = this.#options.store.task(originTask.id);
      if (this.#options.epoch() !== epoch || !currentOrigin || !this.#canReport(session, currentOrigin)) continue;
      this.#options.store.appendEvent('coding.outcome.registered', { sessionId: session.id, originTaskId: originTask.id }, session.contract.taskId);
    }
  }
  async pause(reason = 'paused'): Promise<void> {
    this.#paused = true;
    for (const admission of this.#admissions.values()) admission.controller.abort();
    for (const active of this.#active.values()) active.controller.abort();
    for (const session of this.#options.accounting.list().filter(session => ['ready', 'running'].includes(session.state))) this.#save(session, codingData(session), { state: 'paused', phase: 'interrupted', reason, nextEligibleAt: null });
    await Promise.allSettled(this.#options.accounting.list().filter(session => session.state !== 'terminal').map(session => this.#options.workspaces.cancel(codingData(session).workspaceId)));
    await Promise.allSettled([...this.#active.values()].map(active => active.drained));
  }
  resume(): void {
    if (this.#stopped) throw new CodingUnavailableError('stopped');
    this.#paused = false;
    for (const session of this.#options.accounting.list().filter(session => session.state === 'paused' && ['interrupted', 'reconciliation'].includes(session.phase))) this.#save(session, codingData(session), { state: 'ready', phase: codingData(session).pending.length ? 'tools-pending' : 'model-intended', reason: null, nextEligibleAt: null });
  }
  async cancel(id: string): Promise<void> {
    const admitting = [...this.#admissions].find(([sessionId, admission]) => [sessionId, admission.task.id, admission.executionTaskId].includes(id));
    if (admitting) {
      const [sessionId, admission] = admitting;
      if (!this.#admissionCancelled(admission.task.id)) this.#options.store.appendEvent('coding.admission.cancelled', { sessionId, originTaskId: admission.task.id, taskId: admission.executionTaskId }, admission.task.id);
      admission.controller.abort();
      // Also handles a synchronous collector calling cancellation before the admission promise is registered.
      await Promise.resolve();
      const pending = this.#admissionResults.get(admission.task.id)?.pending;
      if (pending) await Promise.allSettled([pending]);
      id = sessionId;
    }
    const session = this.status(id); if (!session || session.state === 'terminal') return;
    this.#active.get(session.id)?.controller.abort();
    await this.#options.workspaces.cancel(codingData(session).workspaceId);
    await Promise.allSettled(this.#active.has(session.id) ? [this.#active.get(session.id)!.drained] : []);
    const current = this.#options.accounting.get(session.id)!; if (current.state !== 'terminal') this.#finish(current, codingData(current), 'cancelled');
    await this.#reportOutcomes();
  }
  async adoptEpoch(): Promise<void> {
    await this.#expire();
    for (const session of this.#options.accounting.list().filter(session => session.state !== 'terminal')) {
      const data = codingData(session), epoch = this.#options.epoch();
      this.#renewing.add(session.id);
      try {
        try { this.#assert(session, epoch); }
        catch (error) {
          if (!(error instanceof CodingUnavailableError)) throw error;
          await this.#retire(session, error.code); continue;
        }
        this.#options.workspaces.adopt(data.workspaceId, epoch); data.epoch = epoch;
        const preservedWait = session.state === 'paused' && session.phase === 'budget-or-provider-wait';
        this.#save(session, data, preservedWait ? {} : { state: 'ready', phase: data.pending.length ? 'tools-pending' : 'model-intended', reason: null, nextEligibleAt: null });
      }
      finally { this.#renewing.delete(session.id); }
    }
    this.#paused = false;
  }
  async stop(): Promise<void> { await this.pause('process-stop'); this.#stopped = true; await this.#options.workspaces.stop(); }
}
