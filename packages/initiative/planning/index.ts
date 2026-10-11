import { invariant, nonempty, scopeAllows, validateScope } from '../../contracts/index.ts';
import type { DataScope, Goal, Observation } from '../../contracts/index.ts';
import { OperationalStore } from '../../storage/index.ts';
import { InitiativeRegistry } from '../goals/index.ts';
export interface PlanTask { id: string; objective: string; dependencyIds: string[]; writablePaths: string[]; inputs: string[]; acceptance: string[]; model: string; effort: string | null; status: 'ready' | 'running' | 'waiting' | 'blocked' | 'completed' | 'abandoned'; evidenceIds: string[]; reason: string | null }
export interface DurablePlan { id: string; revision: number; goalId: string; scope: DataScope; aeon: string; lane: string; owner: string; slashGoal: string; dependencyIds: string[]; tasks: PlanTask[]; status: 'ready' | 'running' | 'waiting' | 'blocked' | 'completed' | 'abandoned'; reason: string | null; handoff: string | null }
export class PlanRegistry {
  readonly store: OperationalStore;
  constructor(store: OperationalStore) { this.store = store; }
  get(id: string, audience: DataScope): DurablePlan | undefined { const plan = this.store.get<DurablePlan>('initiative.plans', id)?.value; return plan && scopeAllows(plan.scope, audience) ? plan : undefined; }
  put(input: Omit<DurablePlan, 'revision'>, expected: number | null): DurablePlan {
    for (const field of ['id', 'goalId', 'aeon', 'lane', 'owner', 'slashGoal'] as const) nonempty(input[field], `plan ${field}`); validateScope(input.scope);
    invariant(input.slashGoal.startsWith('/goal '), 'plan needs finite copyable slash goal'); invariant(input.tasks.length > 0 && new Set(input.tasks.map(t => t.id)).size === input.tasks.length, 'plan needs unique tasks');
    for (const task of input.tasks) { nonempty(task.objective, 'task objective'); nonempty(task.model, 'task model'); invariant(task.acceptance.length > 0, 'task requires acceptance'); task.acceptance.forEach(s => nonempty(s, 'task acceptance')); invariant(task.dependencyIds.every(id => input.tasks.some(t => t.id === id) && id !== task.id), 'unknown task dependency'); if (task.status === 'completed') invariant(task.evidenceIds.length > 0, 'task completion needs evidence'); if (['blocked', 'abandoned'].includes(task.status)) nonempty(task.reason, 'task reason'); }
    for (const task of input.tasks) { const walk = (id: string, visited: Set<string>): void => { invariant(!visited.has(id), 'task dependency cycle'); const next = new Set(visited).add(id); input.tasks.find(t => t.id === id)!.dependencyIds.forEach(dep => walk(dep, next)); }; walk(task.id, new Set()); }
    if (input.status === 'completed') invariant(input.tasks.every(task => ['completed', 'abandoned'].includes(task.status)) && input.handoff, 'plan completion requires finished tasks and handoff');
    const old = this.store.get<DurablePlan>('initiative.plans', input.id)?.value;
    if (old) invariant(old.goalId === input.goalId && old.aeon === input.aeon && old.lane === input.lane && scopeAllows(old.scope, input.scope) && scopeAllows(input.scope, old.scope), 'plan identity immutable');
    const plan = { ...input, revision: (expected ?? 0) + 1 }; this.store.put('initiative.plans', plan.id, plan, expected); return plan;
  }
}
export type ProgressDecision = { kind: 'complete'; evidenceIds: string[]; reason: string } | { kind: 'continue'; nextAction: string; reason: string; evidenceIds: string[] } | { kind: 'wait'; at: string; condition: string; reason: string } | { kind: 'block' | 'pause' | 'abandon'; reason: string };
/** Decisions are supplied by the mind from actual observations; never ask for ritual self-critique. */
export function applyProgress(registry: InitiativeRegistry, goal: Goal, observations: Observation[], decision: ProgressDecision): Goal {
  if (decision.kind === 'complete') {
    invariant(decision.evidenceIds.length > 0 && decision.evidenceIds.every(id => observations.some(o => o.id === id && o.kind === 'result')), 'completion requires current successful observations');
    return registry.revise(goal.id, goal.revision, { status: 'completed', evidenceIds: [...new Set([...goal.evidenceIds, ...decision.evidenceIds])] }, decision.reason);
  }
  if (decision.kind === 'continue') {
    nonempty(decision.nextAction, 'next observation action'); invariant(decision.evidenceIds.every(id => observations.some(o => o.id === id)), 'replanning cites unknown observation');
    if (observations.some(o => o.kind !== 'result')) invariant(decision.nextAction !== goal.nextAction && decision.evidenceIds.some(id => observations.some(o => o.id === id && o.kind !== 'result')), 'failed observation requires targeted replanning');
    return registry.revise(goal.id, goal.revision, { status: 'ready', nextAction: decision.nextAction, evidenceIds: [...new Set([...goal.evidenceIds, ...decision.evidenceIds])] }, decision.reason);
  }
  if (decision.kind === 'wait') return registry.revise(goal.id, goal.revision, { status: 'waiting', wakeup: { at: decision.at, condition: decision.condition } }, decision.reason);
  return registry.revise(goal.id, goal.revision, { status: decision.kind === 'block' ? 'blocked' : decision.kind === 'pause' ? 'paused' : 'abandoned' }, decision.reason);
}
