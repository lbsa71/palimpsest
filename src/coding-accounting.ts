import { digestJson } from './candidates.ts';
import { Store, type Json } from './store.ts';
import { codingInteger, codingJson, codingText, validateCodingContract } from './coding-state.ts';
import type { CodingContract, CodingInitialCall, CodingReservation, CodingReservationResult, CodingSession, CodingSessionPatch } from './coding-state.ts';
export type { CodingContract, CodingInitialCall, CodingLane, CodingReservation, CodingReservationResult, CodingSession, CodingSessionPatch } from './coding-state.ts';

const DAY = 86_400_000; const HOUR = 3_600_000;
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const json = (value: unknown): Json => { codingJson(value); return structuredClone(value); };
function synchronous(check?: () => void): void {
  if (!check) return;
  if (check.constructor.name === 'AsyncFunction') throw new Error('Coding authority check must be synchronous');
  const result: unknown = check();
  if (result && (typeof result === 'object' || typeof result === 'function') && 'then' in result && typeof result.then === 'function') {
    void Promise.resolve(result).catch(() => {}); throw new Error('Coding authority check must be synchronous');
  }
}

/** Both legacy single-call starts and coding mirrored starts are one physical
 * debit. Actual timestamps survive cadence/catalog changes; ambiguous historic
 * timestamps conservatively consume every overlapping allocation. */
export function developmentAllocation(store: Store, policy: { cadence: 'daily' | 'hourly'; maxCalls: number }, now: number): {
  cadence: 'daily' | 'hourly'; startsAt: number; endsAt: number; used: number; remaining: number;
} {
  codingInteger(now, 'Development allocation time'); codingInteger(policy.maxCalls, 'Development capacity');
  return store.transaction(() => {
    const duration = policy.cadence === 'hourly' ? HOUR : DAY;
    const startsAt = Math.floor(now / duration) * duration; const endsAt = startsAt + duration; codingInteger(endsAt, 'Window end');
    const eventType = policy.cadence === 'hourly' ? 'development.hourly.window' : 'development.window';
    const events = store.listEvents(); const window = events.find(event => event.type === eventType && object(event.payload).startsAt === startsAt);
    if (window && object(window.payload).maxCalls !== policy.maxCalls) throw new Error(`Development UTC-${policy.cadence === 'hourly' ? 'hour' : 'day'} proposal allocation is immutable`);
    if (!window) store.appendEvent(eventType, { startsAt, endsAt, maxCalls: policy.maxCalls });
    const charged = new Set<string>();
    for (const event of events) {
      if (event.type !== 'development.attempt.started') continue;
      const payload = object(event.payload); const attempt = object(payload.attempt);
      const timestamp = payload.reservedAt ?? attempt.startedAt;
      let inWindow: boolean;
      if (typeof timestamp === 'number' && Number.isSafeInteger(timestamp) && timestamp >= 0) inWindow = timestamp >= startsAt && timestamp < endsAt;
      else {
        const start = payload.startsAt;
        inWindow = typeof start !== 'number' || !Number.isSafeInteger(start) || start < 0
          || start < endsAt && start + (payload.cadence === 'hourly' ? HOUR : DAY) > startsAt;
      }
      if (inWindow) charged.add(typeof payload.codingReservationId === 'string' ? `coding:${payload.codingReservationId}` : typeof attempt.id === 'string' ? `legacy:${attempt.id}` : `event:${event.seq}`);
    }
    return { cadence: policy.cadence, startsAt, endsAt, used: charged.size, remaining: Math.max(0, policy.maxCalls - charged.size) };
  });
}

/** Durable, SDK-independent accounting. This is a trusted host port, not a grant
 * derived from model text. Call reserve only after obtaining the dispatch slot. */
export class CodingAccounting {
  readonly #store: Store; readonly #now: () => number;
  constructor(store: Store, options: { now?: () => number } = {}) { this.#store = store; this.#now = options.now ?? Date.now; }
  #time(): number { const now = this.#now(); codingInteger(now, 'Coding time'); return now; }
  list(): CodingSession[] {
    const records = new Map<string, CodingSession>();
    for (const event of this.#store.listEvents()) if (['coding.session.admitted', 'coding.session.updated'].includes(event.type)) {
      const session = object(event.payload).session as CodingSession;
      if (!session || session.version !== 'coding-state/1') throw new Error('Unsupported coding state version');
      validateCodingContract(session.contract); codingInteger(session.revision, 'Session revision', 1);
      codingJson(session); codingInteger(session.createdAt, 'Session creation time'); codingInteger(session.updatedAt, 'Session update time');
      if (!['ready', 'running', 'paused', 'terminal'].includes(session.state)) throw new Error('Invalid durable coding state');
      codingText(session.phase, 'Coding phase');
      if (session.nextEligibleAt !== null) codingInteger(session.nextEligibleAt, 'Coding wakeup');
      if (session.id !== session.contract.sessionId || session.contractDigest !== digestJson(session.contract)) throw new Error('Coding contract binding mismatch');
      records.set(session.id, structuredClone(session));
    }
    return [...records.values()];
  }
  get(id: string): CodingSession | undefined { return this.list().find(session => session.id === id); }
  listRunnable(): CodingSession[] {
    const now = this.#time(); return this.list().filter(session => session.contract.expiresAt > now
      && (session.state === 'ready' || session.state === 'paused' && session.nextEligibleAt !== null && session.nextEligibleAt <= now));
  }
  reservations(sessionId?: string): CodingReservation[] {
    const records = new Map<string, CodingReservation>();
    for (const event of this.#store.listEvents()) if (['coding.request.reserved', 'coding.request.updated'].includes(event.type)) {
      const reservation = object(event.payload).reservation as CodingReservation;
      if (!reservation || reservation.version !== 'coding-request/1') throw new Error('Unsupported coding reservation version');
      codingJson(reservation); codingInteger(reservation.ordinal, 'Request ordinal', 1); codingInteger(reservation.reservedAt, 'Reservation time');
      if (!['reserved', 'dispatched', 'observed', 'unknown', 'not_dispatched'].includes(reservation.status)) throw new Error('Invalid durable request disposition');
      records.set(reservation.id, structuredClone(reservation));
    }
    return [...records.values()].filter(record => sessionId === undefined || record.sessionId === sessionId);
  }
  admit(contract: CodingContract, options: { data?: Json; initialCall?: CodingInitialCall; validateCurrent?: () => void } = {}): CodingSession {
    validateCodingContract(contract); contract = structuredClone(contract); json(options.data ?? null);
    return this.#store.transaction(() => {
      const old = this.get(contract.sessionId);
      if (old) { if (old.contractDigest !== digestJson(contract)) throw new Error('Coding session contract is immutable'); return old; }
      synchronous(options.validateCurrent);
      const all = this.list(); const root = all.find(session => session.contract.workRootId === contract.workRootId);
      const allocation = (value: CodingContract) => ({ originTaskId: value.originTaskId, lane: value.lane, limits: value.limits, expiresAt: value.expiresAt });
      if (root && digestJson(allocation(root.contract)) !== digestJson(allocation(contract))) throw new Error('Coding work allocation is immutable');
      if (all.some(session => session.contract.attemptId === contract.attemptId)) throw new Error('Coding attempt already owns another draft lineage');
      const attempts = all.filter(session => session.contract.workRootId === contract.workRootId).length;
      const now = this.#time(); const reason = now >= contract.expiresAt ? 'expired' : attempts >= contract.limits.maxAttempts ? 'attempt_limit' : null;
      const session: CodingSession = { version: 'coding-state/1', id: contract.sessionId, contract, contractDigest: digestJson(contract), revision: 1,
        state: reason ? 'terminal' : 'ready', phase: reason ?? 'ready', reason, nextEligibleAt: null, data: options.data ?? null, createdAt: now, updatedAt: now };
      if (options.initialCall) this.#linkInitialCall(session, options.initialCall);
      this.#store.appendEvent('coding.session.admitted', json({ session }), contract.taskId); return structuredClone(session);
    });
  }
  #linkInitialCall(session: CodingSession, initial: CodingInitialCall): void {
    json(initial); const { contract } = session;
    let id: string, source: Record<string, Json>;
    if ('taskId' in initial) {
      if (Object.keys(initial).some(key => !['taskId', 'ordinal'].includes(key))) throw new Error('Initial coding call has unexpected fields');
      const { taskId, ordinal } = initial; codingInteger(ordinal, 'Initial call ordinal', 1);
      const task = this.#store.task(taskId), calls = object(task?.checkpoint).calls;
      if (contract.lane.kind !== 'conversation' || taskId !== contract.originTaskId || typeof calls !== 'number' || calls < ordinal
        || !this.#store.listEvents({ taskId }).some(event => event.type === 'inference.started' && object(event.payload).attempt === ordinal)) throw new Error('Initial coding call must be an actually charged origin call');
      id = `${taskId}:inference:${ordinal}`; source = { taskId, ordinal };
    } else {
      if (Object.keys(initial).some(key => !['growthId', 'eventSeq'].includes(key))) throw new Error('Initial coding growth call has unexpected fields');
      const { growthId, eventSeq } = initial; codingText(growthId, 'Initial growth identity'); codingInteger(eventSeq, 'Initial growth reservation sequence', 1);
      const growth = this.#store.growth(growthId), origin = this.#store.task(contract.originTaskId);
      const event = this.#store.listEvents().find(event => event.seq === eventSeq), payload = object(event?.payload);
      const window = typeof payload.windowId === 'string' ? this.#store.growthWindow(payload.windowId) : undefined;
      const grant = this.#store.listEvents({ taskId: contract.originTaskId }).find(event => event.type === 'coding.growth.origin.admitted');
      if (contract.lane.kind !== 'growth' || !growth || growth.sourceTaskId || growth.origin.startsWith('conversation:')
        || origin?.source !== 'coding-origin' || origin.conversationId.startsWith('peer:') || !this.#store.taskSourceCurrent(origin.id)
        || object(grant?.payload).growthId !== growthId || object(grant?.payload).objective !== origin.input
        || event?.type !== 'growth.window.call_reserved' || payload.growthId !== growthId || !window
        || payload.schedulerId !== contract.lane.schedulerId || window.schedulerId !== contract.lane.schedulerId
        || window.endsAt - window.startsAt !== contract.lane.windowMs || window.maxCalls !== contract.lane.maxCalls
        || typeof payload.usedCalls !== 'number' || !Number.isSafeInteger(payload.usedCalls) || payload.usedCalls < 1 || payload.usedCalls > window.usedCalls) {
        throw new Error('Initial coding growth call requires its charged independent reservation and admitted origin');
      }
      id = `growth:${growthId}:reservation:${eventSeq}`; source = { growthId, eventSeq, windowId: window.id, schedulerId: window.schedulerId };
    }
    if (this.#store.listEvents().some(event => event.type === 'coding.initial_call.linked' && object(event.payload).id === id)) throw new Error('Initial coding call is already linked');
    // Its actual owner already consumed the window. Only cumulative coding
    // lineage accounting changes here, atomically with session admission.
    this.#store.appendEvent('coding.initial_call.linked', { id, sessionId: session.id, workRootId: contract.workRootId, attemptId: contract.attemptId, ...source });
  }
  update(id: string, patch: CodingSessionPatch, options: { expectedRevision: number; validateCurrent?: () => void }): CodingSession {
    json(patch); codingInteger(options.expectedRevision, 'Expected revision', 1);
    return this.#store.transaction(() => {
      const old = this.get(id); if (!old) throw new Error('Coding session not found');
      if (old.revision !== options.expectedRevision) throw new Error('Coding session revision changed');
      synchronous(options.validateCurrent);
      if (Object.keys(patch).some(key => !['state', 'phase', 'reason', 'nextEligibleAt', 'data'].includes(key))) throw new Error('Cannot change coding contract through state update');
      const state = patch.state ?? old.state;
      if (!['ready', 'running', 'paused', 'terminal'].includes(state)) throw new Error('Invalid coding state');
      if (old.state === 'terminal') {
        if (Object.entries(patch).some(([key, value]) => digestJson(value) !== digestJson(old[key as keyof CodingSession]))) throw new Error('Cannot revive terminal coding session');
        return old;
      }
      if (patch.phase !== undefined) codingText(patch.phase, 'Coding phase');
      if (patch.nextEligibleAt !== undefined && patch.nextEligibleAt !== null) codingInteger(patch.nextEligibleAt, 'Coding wakeup');
      if (patch.reason !== undefined && patch.reason !== null) codingText(patch.reason, 'Coding reason');
      const session: CodingSession = { ...old, ...structuredClone(patch), state, revision: old.revision + 1, updatedAt: this.#time() };
      this.#store.appendEvent('coding.session.updated', json({ session }), old.contract.taskId); return session;
    });
  }
  #initialCalls(field: 'sessionId' | 'workRootId' | 'attemptId', id: string): number {
    return this.#store.listEvents().filter(event => event.type === 'coding.initial_call.linked' && object(event.payload)[field] === id).length;
  }
  reserve(sessionId: string, input: { requestId: string; ordinal: number; intent: Json; validateCurrent: () => void }): CodingReservationResult {
    codingText(input.requestId, 'Request identity'); codingInteger(input.ordinal, 'Request ordinal', 1); json(input.intent);
    return this.#store.transaction(() => {
      const all = this.reservations(); const old = all.find(record => record.id === input.requestId);
      if (old) {
        if (old.sessionId !== sessionId || old.ordinal !== input.ordinal || digestJson(old.intent) !== digestJson(input.intent)) throw new Error('Coding request identity conflicts with consumed intent');
        return { disposition: 'duplicate', reservation: old };
      }
      const session = this.get(sessionId); if (!session) throw new Error('Coding session not found');
      const { contract } = session;
      const blocked = (reason: string, nextEligibleAt?: number): CodingReservationResult => {
        this.#store.appendEvent('coding.request.blocked', json({ sessionId, requestId: input.requestId, reason, ...(nextEligibleAt === undefined ? {} : { nextEligibleAt }) }), contract.taskId);
        return { disposition: 'blocked', reason, ...(nextEligibleAt === undefined ? {} : { nextEligibleAt }) };
      };
      if (session.state === 'terminal') return blocked('terminal');
      if (session.state === 'paused') return blocked('paused');
      synchronous(input.validateCurrent);
      if (this.get(sessionId)?.revision !== session.revision || this.get(sessionId)?.state === 'terminal') throw new Error('Coding session changed during authority validation');
      const now = this.#time();
      if (now >= contract.expiresAt) return blocked('expired');
      if (input.ordinal !== all.filter(record => record.sessionId === sessionId).length + 1) throw new Error('Coding request ordinal must continue durable history');
      for (const [field, id, max] of [['sessionId', sessionId, contract.limits.maxSessionCalls], ['workRootId', contract.workRootId, contract.limits.maxWorkCalls], ['attemptId', contract.attemptId, contract.limits.maxAttemptCalls]] as const) {
        if (all.filter(record => record[field] === id).length + this.#initialCalls(field, id) >= max) return blocked(`${field}_call_limit`);
      }
      let window: Json = null;
      if (contract.lane.kind === 'plan') {
        const allocation = developmentAllocation(this.#store, { cadence: contract.lane.cadence, maxCalls: contract.lane.maxCalls }, now);
        if (allocation.remaining < 1) return blocked('window_capacity', allocation.endsAt);
        window = json(allocation);
        this.#store.appendEvent('development.attempt.started', { codingReservationId: input.requestId, reservedAt: now, startsAt: allocation.startsAt, cadence: allocation.cadence });
      } else if (contract.lane.kind === 'growth') {
        const startsAt = Math.floor(now / contract.lane.windowMs) * contract.lane.windowMs;
        const allocated = this.#store.openGrowthWindow({ id: `${contract.lane.schedulerId}:${startsAt}`, schedulerId: contract.lane.schedulerId, startsAt, endsAt: startsAt + contract.lane.windowMs, maxCalls: contract.lane.maxCalls });
        if (!this.#store.reserveCodingInGrowthWindow(input.requestId, allocated.id, now)) return blocked(allocated.usedCalls >= allocated.maxCalls ? 'window_capacity' : 'fairness_wait', allocated.usedCalls >= allocated.maxCalls ? allocated.endsAt : now);
        window = json({ id: allocated.id, startsAt, endsAt: allocated.endsAt });
      } else {
        const task = this.#store.task(contract.lane.taskId); const checkpoint = object(task?.checkpoint); const checkpointCalls = checkpoint.calls;
        if (!task || typeof checkpointCalls !== 'number' || !Number.isSafeInteger(checkpointCalls) || checkpointCalls < 0) throw new Error('Conversation accounting checkpoint unavailable');
        const calls = Math.max(checkpointCalls, this.#store.listEvents({ taskId: task.id }).filter(event => event.type === 'inference.started').length);
        if (calls >= contract.lane.maxCalls) return blocked('conversation_call_limit');
        // A completed origin still owns accounting; do not revive its execution.
        if (!['succeeded', 'failed', 'cancelled'].includes(task.state)) this.#store.updateTask(task.id, { checkpoint: json({ ...checkpoint, calls: calls + 1 }) });
        this.#store.appendEvent('inference.started', { provider: 'coding-session', attempt: calls + 1, codingReservationId: input.requestId }, task.id);
      }
      const reservation: CodingReservation = { version: 'coding-request/1', id: input.requestId, sessionId, workRootId: contract.workRootId, attemptId: contract.attemptId,
        ordinal: input.ordinal, intent: structuredClone(input.intent), reservedAt: now, window, status: 'reserved', usage: null, reason: null };
      this.#store.appendEvent('coding.request.reserved', json({ reservation }), contract.taskId);
      return { disposition: 'reserved', reservation };
    });
  }
  /** Command permits have separate finite work-root accounting. They do not
   * consume provider calls and cannot be reset by a replacement draft/session. */
  reserveCommand(sessionId: string, input: { operationId: string; intent: Json; validateCurrent: () => void }): { disposition: 'reserved' | 'duplicate' | 'blocked'; reason?: string } {
    codingText(input.operationId, 'Command operation identity'); json(input.intent);
    return this.#store.transaction(() => {
      const records = this.#store.listEvents().filter(event => event.type === 'coding.command.reserved').map(event => object(event.payload));
      const previous = records.find(record => record.operationId === input.operationId);
      if (previous) {
        if (previous.sessionId !== sessionId || digestJson(previous.intent) !== digestJson(input.intent)) throw new Error('Command identity conflicts with consumed intent');
        return { disposition: 'duplicate' };
      }
      const session = this.get(sessionId); if (!session) throw new Error('Coding session not found');
      synchronous(input.validateCurrent);
      const now = this.#time();
      if (['terminal', 'paused'].includes(session.state) || this.get(sessionId)?.revision !== session.revision) return { disposition: 'blocked', reason: 'terminal_paused_or_changed' };
      if (now >= session.contract.expiresAt) return { disposition: 'blocked', reason: 'expired' };
      if (records.filter(record => record.workRootId === session.contract.workRootId).length >= session.contract.limits.maxCommands) return { disposition: 'blocked', reason: 'command_limit' };
      this.#store.appendEvent('coding.command.reserved', json({ operationId: input.operationId, sessionId, workRootId: session.contract.workRootId,
        attemptId: session.contract.attemptId, reservedAt: now, intent: input.intent }), session.contract.taskId);
      return { disposition: 'reserved' };
    });
  }
  setReservationOutcome(sessionId: string, requestId: string, patch: Partial<Pick<CodingReservation, 'status' | 'usage' | 'reason'>>): CodingReservation {
    json(patch);
    return this.#store.transaction(() => {
      const old = this.reservations(sessionId).find(record => record.id === requestId); if (!old) throw new Error('Coding reservation not found');
      if (Object.keys(patch).some(key => !['status', 'usage', 'reason'].includes(key))) throw new Error('Cannot mutate reservation identity');
      const status = patch.status ?? old.status;
      const next: Record<CodingReservation['status'], CodingReservation['status'][]> = { reserved: ['dispatched', 'observed', 'unknown', 'not_dispatched'], dispatched: ['observed', 'unknown'], unknown: ['observed'], observed: [], not_dispatched: [] };
      if (status !== old.status && !next[old.status].includes(status)) throw new Error('Invalid coding reservation transition');
      if (['observed', 'not_dispatched'].includes(old.status) && Object.entries(patch).some(([key, value]) => digestJson(value) !== digestJson(old[key as keyof CodingReservation]))) throw new Error('Cannot rewrite terminal coding reservation');
      const reservation = { ...old, ...structuredClone(patch), status };
      this.#store.appendEvent('coding.request.updated', json({ reservation })); return reservation;
    });
  }
}
