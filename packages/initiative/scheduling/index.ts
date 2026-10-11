import { randomUUID } from 'node:crypto';
import { canonicalJson, invariant } from '../../contracts/index.ts';
import type { Goal, Obligation, ResourceEnvelope } from '../../contracts/index.ts';
import { OperationalStore } from '../../storage/index.ts';
import { InitiativeRegistry } from '../goals/index.ts';
import { ObligationRegistry } from '../obligations/index.ts';
export type ServiceClass = 'commitment' | 'conversation' | 'inquiry';
export interface SchedulerPolicy { windowMs: number; maxSlicesPerWindow: number; maxLifetimeSlices: number; quantumMs: number; idleRetryMs: number; maxStalls: number; resources: ResourceEnvelope }
interface SchedulerState { policy: SchedulerPolicy; startedAt: number; windowStartedAt: number; windowSlices: number; lifetimeSlices: number; cursor: number; queue: Record<ServiceClass, string[]> }
export type Selection = { kind: 'goal'; service: ServiceClass; goal: Goal } | { kind: 'obligation'; service: 'commitment'; obligation: Obligation };
export type SchedulingDecision = { kind: 'selected'; selection: Selection; sequence: number } | { kind: 'idle' | 'window-exhausted' | 'lifetime-exhausted'; reason: string; nextWakeup: string | null };
const classes: ServiceClass[] = ['commitment', 'conversation', 'inquiry'];
/** Durable cyclic service, including an inquiry turn even under continuous conversation admission. */
export class FairScheduler {
  readonly store: OperationalStore; readonly goals: InitiativeRegistry; readonly obligations: ObligationRegistry; readonly id: string; readonly policy: SchedulerPolicy;
  constructor(store: OperationalStore, goals: InitiativeRegistry, obligations: ObligationRegistry, id: string, policy: SchedulerPolicy, at: number) {
    this.store = store; this.goals = goals; this.obligations = obligations; this.id = id; this.policy = structuredClone(policy);
    for (const key of ['windowMs', 'maxSlicesPerWindow', 'maxLifetimeSlices', 'quantumMs', 'idleRetryMs', 'maxStalls'] as const) invariant(Number.isSafeInteger(policy[key]) && policy[key] > 0, `invalid scheduler ${key}`);
    invariant(Number.isFinite(at), 'invalid scheduler clock');
    const existing = store.get<SchedulerState>('initiative.schedulers', id);
    if (existing) invariant(canonicalJson(existing.value.policy) === canonicalJson(policy), 'scheduler allowance cannot reset or change on restart');
    else store.put('initiative.schedulers', id, { policy, startedAt: at, windowStartedAt: at, windowSlices: 0, lifetimeSlices: 0, cursor: 0, queue: { commitment: [], conversation: [], inquiry: [] } }, null);
  }
  snapshot(): SchedulerState { return this.store.get<SchedulerState>('initiative.schedulers', this.id)!.value; }
  private candidates(at: string, deliveries: boolean): Map<string, Selection> {
    const ready = this.goals.readyNow(at), candidates = new Map<string, Selection>();
    const due = this.obligations.all().filter(o => o.status === 'owed' && (o.dueAt === null || Date.parse(o.dueAt) <= Date.parse(at)));
    const dueGoals = new Set(due.flatMap(o => o.goalId ? [o.goalId] : []));
    for (const goal of ready.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))) {
      const service: ServiceClass = dueGoals.has(goal.id) ? 'commitment' : goal.origin.kind === 'request' ? 'conversation' : 'inquiry'; candidates.set(`goal:${goal.id}`, { kind: 'goal', service, goal });
    }
    if (deliveries) for (const obligation of due.sort((a, b) => Date.parse(a.dueAt ?? at) - Date.parse(b.dueAt ?? at) || a.id.localeCompare(b.id))) {
      const retryAt = this.store.get<{ at: number }>('initiative.delivery-backoff', obligation.id)?.value.at ?? 0;
      if (retryAt <= Date.parse(at) && (!obligation.goalId || ['completed', 'abandoned'].includes(this.goals.goal(obligation.goalId)?.status ?? ''))) candidates.set(`obligation:${obligation.id}`, { kind: 'obligation', service: 'commitment', obligation });
    }
    return candidates;
  }
  select(at: string, deliveries = false): SchedulingDecision {
    const now = Date.parse(at); invariant(Number.isFinite(now), 'invalid scheduler time');
    return this.store.transaction(() => {
      const row = this.store.get<SchedulerState>('initiative.schedulers', this.id)!, state = row.value;
      invariant(now >= state.startedAt && now >= state.windowStartedAt, 'scheduler clock went backwards');
      let decision: SchedulingDecision;
      if (state.lifetimeSlices >= this.policy.maxLifetimeSlices) decision = { kind: 'lifetime-exhausted', reason: 'finite lifetime slices exhausted; explicit new operating grant required', nextWakeup: null };
      else {
        if (now >= state.windowStartedAt + this.policy.windowMs) { state.windowStartedAt += Math.floor((now - state.windowStartedAt) / this.policy.windowMs) * this.policy.windowMs; state.windowSlices = 0; }
        if (state.windowSlices >= this.policy.maxSlicesPerWindow) decision = { kind: 'window-exhausted', reason: 'window service exhausted; lifetime usage retained', nextWakeup: new Date(state.windowStartedAt + this.policy.windowMs).toISOString() };
        else {
          const candidates = this.candidates(at, deliveries);
          for (const service of classes) {
            state.queue[service] = state.queue[service].filter(id => candidates.get(id)?.service === service);
            for (const [id, candidate] of candidates) if (candidate.service === service && !state.queue[service].includes(id)) state.queue[service].push(id);
          }
          let selection: Selection | undefined;
          for (let offset = 0; offset < classes.length; offset++) {
            const cursor = (state.cursor + offset) % classes.length, service = classes[cursor];
            if (state.queue[service].length) { const id = state.queue[service].shift()!; state.queue[service].push(id); selection = candidates.get(id)!; state.cursor = (cursor + 1) % classes.length; break; }
          }
          if (selection) { state.windowSlices++; state.lifetimeSlices++; decision = { kind: 'selected', selection, sequence: state.lifetimeSlices }; }
          else {
            const wakeups = this.goals.all().flatMap(g => g.status === 'waiting' ? [Date.parse(g.wakeup!.at)] : []).filter(t => t > now);
            const obligations = deliveries ? this.obligations.all().flatMap(o => o.status === 'owed' ? [Math.max(o.dueAt ? Date.parse(o.dueAt) : 0, this.store.get<{ at: number }>('initiative.delivery-backoff', o.id)?.value.at ?? 0)] : []).filter(t => t > now) : [];
            const next = [...wakeups, ...obligations].sort((a, b) => a - b)[0];
            decision = { kind: 'idle', reason: 'no eligible observation or delivery; await input, evidence, dependency or wakeup', nextWakeup: next === undefined ? null : new Date(next).toISOString() };
          }
        }
      }
      this.store.put('initiative.schedulers', this.id, state, row.revision);
      this.store.append({ id: randomUUID(), stream: `scheduler:${this.id}`, type: 'selection', data: decision }); return decision;
    });
  }
}
