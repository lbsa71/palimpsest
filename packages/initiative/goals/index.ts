import { randomUUID } from 'node:crypto';
import { invariant, nonempty, scopeAllows, validateGoal, validateProvenance } from '../../contracts/index.ts';
import type { DataScope, Goal, GoalPort, GoalStatus, Provenance } from '../../contracts/index.ts';
import { OperationalStore } from '../../storage/index.ts';

const NS = 'initiative.goals';
const transitions: Record<GoalStatus, GoalStatus[]> = {
  proposed: ['ready', 'abandoned'], ready: ['running', 'waiting', 'blocked', 'paused', 'abandoned'],
  running: ['ready', 'waiting', 'blocked', 'paused', 'completed', 'abandoned'],
  waiting: ['ready', 'blocked', 'paused', 'abandoned'], blocked: ['ready', 'paused', 'abandoned'],
  paused: ['ready', 'abandoned'], completed: [], abandoned: [],
};
export class InitiativeRegistry implements GoalPort {
  readonly store: OperationalStore;
  constructor(store: OperationalStore) { this.store = store; }
  goal(id: string): Goal | undefined { return this.store.get<Goal>(NS, id)?.value; }
  async get(id: string): Promise<Goal | undefined> { return this.goal(id); }
  all(audience?: DataScope): Goal[] { return this.store.list<Goal>(NS).map(row => row.value).filter(goal => !audience || scopeAllows(goal.scope, audience)); }
  async put(goal: Goal, expectedRevision: number | null): Promise<void> { this.save(goal, expectedRevision); }
  private save(goal: Goal, expectedRevision: number | null): Goal {
    validateGoal(goal);
    return this.store.transaction(() => {
      const old = this.goal(goal.id); invariant(goal.revision === (expectedRevision ?? 0) + 1, 'goal revision must advance once');
      if (old) {
        invariant(!['completed', 'abandoned'].includes(old.status), 'terminal goal immutable; propose a successor');
        invariant(old.status === goal.status || transitions[old.status].includes(goal.status), 'invalid goal transition');
        invariant(scopeAllows(old.scope, goal.scope) && scopeAllows(goal.scope, old.scope), 'goal audience immutable');
        invariant(JSON.stringify(old.origin) === JSON.stringify(goal.origin), 'goal origin immutable');
        for (const key of Object.keys(old.resources) as (keyof Goal['resources'])[]) invariant(goal.resources[key] <= old.resources[key], 'goal cannot grant additional resources');
        invariant(old.evidenceIds.every(id => goal.evidenceIds.includes(id)), 'goal evidence cannot disappear');
      } else invariant(goal.status === 'proposed', 'new goal must be proposed');
      invariant(!goal.dependencyIds.includes(goal.id), 'goal cannot depend on itself');
      for (const id of goal.dependencyIds) {
        const dependency = this.goal(id); invariant(dependency, 'unknown goal dependency'); invariant(scopeAllows(dependency.scope, goal.scope), 'dependency widens private goal scope');
        const visits = new Set<string>(); const walk = (current: string): void => { invariant(current !== goal.id, 'goal dependency cycle'); if (visits.has(current)) return; visits.add(current); this.goal(current)?.dependencyIds.forEach(walk); }; walk(id);
      }
      this.store.put(NS, goal.id, goal, expectedRevision);
      this.store.put('initiative.goal-history', `${goal.id}:${goal.revision}`, goal, null);
      this.store.append({ id: randomUUID(), stream: `goal:${goal.id}`, type: 'goal-revised', data: { revision: goal.revision, status: goal.status, evidenceIds: goal.evidenceIds, reason: goal.reason ?? null } });
      return goal;
    });
  }
  propose(goal: Omit<Goal, 'revision' | 'status'>, provenance: Provenance): Goal {
    validateProvenance(provenance);
    return this.store.transaction(() => { const saved = this.save({ ...goal, revision: 1, status: 'proposed' }, null); this.store.put('initiative.goal-provenance', goal.id, provenance, null); return saved; });
  }
  revise(id: string, expectedRevision: number, patch: Partial<Omit<Goal, 'id' | 'revision' | 'origin' | 'scope'>>, reason: string): Goal {
    nonempty(reason, 'revision reason'); const old = this.goal(id); invariant(old, 'unknown goal');
    return this.save({ ...old, ...patch, id, revision: expectedRevision + 1, reason }, expectedRevision);
  }
  accept(id: string, expectedRevision: number, reason: string): Goal { invariant(this.goal(id)?.status === 'proposed', 'accept only proposed goal'); return this.revise(id, expectedRevision, { status: 'ready' }, reason); }
  history(id: string, audience: DataScope): Goal[] { return this.store.list<Goal>('initiative.goal-history').map(row => row.value).filter(goal => goal.id === id && scopeAllows(goal.scope, audience)).sort((a, b) => a.revision - b.revision); }
  readyNow(at: string): Goal[] {
    invariant(Number.isFinite(Date.parse(at)), 'invalid scheduler time');
    return this.all().filter(goal => (goal.status === 'ready' || (goal.status === 'waiting' && Date.parse(goal.wakeup!.at) <= Date.parse(at))) && goal.dependencyIds.every(id => this.goal(id)?.status === 'completed'));
  }
  async ready(at: string): Promise<Goal[]> { return this.readyNow(at); }
}
