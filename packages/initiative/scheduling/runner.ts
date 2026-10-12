import { identity, invariant } from '../../contracts/index.ts';
import type { Authority, Goal, InboundInput, JsonValue, Observation, PromptManifest } from '../../contracts/index.ts';
import { DevelopmentalMemory } from '../../development/index.ts';
import type { ClaimedJob, ContextRequest, DevelopmentContext } from '../../development/index.ts';
import { DurableRuntime } from '../../runtime/index.ts';
import { applyProgress } from '../planning/index.ts';
import type { ProgressDecision } from '../planning/index.ts';
import { FairScheduler } from './index.ts';
import type { SchedulingDecision } from './index.ts';
class StartDeferred extends Error {}
interface GoalExecution { runId: string; step: number; observationIds: string[]; stalls: number }
export interface InitiativeRunnerOptions {
  scheduler: FairScheduler; runtime: DurableRuntime; memory: DevelopmentalMemory; authority: Authority;
  context?: (request: ContextRequest) => DevelopmentContext;
  prompt(goal: Goal, context: DevelopmentContext): PromptManifest;
  /** Judgment is run under the executing mind, not an unaccounted second model request. */
  decide(goal: Goal, observations: Observation[], context: DevelopmentContext): ProgressDecision;
  deliver?: (obligationId: string, signal: AbortSignal) => Promise<void>;
}
/** Host wakeup entrypoint. It performs one bounded slice; host registers returned deadlines or waits for input. */
export class InitiativeRunner {
  readonly options: InitiativeRunnerOptions; readonly rootAllocation: string;
  private active = false;
  constructor(options: InitiativeRunnerOptions) {
    this.options = options; this.rootAllocation = `initiative:${options.scheduler.id}`;
    invariant(options.runtime.store === options.scheduler.store, 'runtime and scheduler must share operational store');
    const row = options.runtime.store.get('allocations', this.rootAllocation);
    if (!row) options.runtime.resources.allocate(this.rootAllocation, options.scheduler.policy.resources);
  }
  recover(): string[] {
    const { runtime, scheduler } = this.options; const recovered = runtime.recover();
    for (const goal of scheduler.goals.all().filter(g => g.status === 'running')) scheduler.goals.revise(goal.id, goal.revision, { status: 'waiting', wakeup: { at: new Date(runtime.now()).toISOString(), condition: 'host acquired authority and recovered runtime' } }, 'restart retains runtime checkpoint, observations and original resource allocation');
    return recovered;
  }
  steer(goalId: string, input: InboundInput): void {
    const execution = this.options.runtime.store.get<GoalExecution>('initiative.execution', goalId)?.value; invariant(execution, 'goal has no runtime'); this.options.runtime.steer(execution.runId, input);
  }
  cancel(goalId: string, reason: string): void {
    const { scheduler, runtime } = this.options; const goal = scheduler.goals.goal(goalId); invariant(goal, 'unknown goal');
    const execution = runtime.store.get<GoalExecution>('initiative.execution', goalId)?.value; if (execution) runtime.cancel(execution.runId, this.options.authority.generation, reason);
    if (!['completed', 'abandoned'].includes(goal.status)) scheduler.goals.revise(goalId, goal.revision, { status: 'abandoned' }, reason);
  }
  reconsider(goalId: string, reason: string): Goal { const goal = this.options.scheduler.goals.goal(goalId); invariant(goal && ['paused', 'blocked'].includes(goal.status), 'goal not paused or blocked'); return this.options.scheduler.goals.revise(goalId, goal.revision, { status: 'ready' }, reason); }
  /** Claim only: interpretation must use an accounted runtime, then complete via memory API. */
  claimConsolidation(owner: string, leaseMs: number): ClaimedJob | undefined { const at = new Date(this.options.runtime.now()).toISOString(); this.options.memory.expire(at); return this.options.memory.claimConsolidation(owner, leaseMs, at); }
  async tick(signal?: AbortSignal): Promise<SchedulingDecision> {
    invariant(!this.active, 'initiative slice already active'); this.active = true;
    const { scheduler, runtime, memory, authority } = this.options;
    const controller = new AbortController(); const abort = () => controller.abort(signal?.reason); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    let selectedGoalId: string | undefined;
    const timer = setTimeout(() => controller.abort(new Error('scheduler quantum elapsed')), scheduler.policy.quantumMs);
    try {
      const at = new Date(runtime.now()).toISOString(); memory.expire(at);
      const prepared = runtime.store.transaction(() => {
        const selected = scheduler.select(at, this.options.deliver !== undefined);
        if (selected.kind !== 'selected' || selected.selection.kind !== 'goal') return { selected };
        let goal = selected.selection.goal;
        if (goal.status === 'waiting') goal = scheduler.goals.revise(goal.id, goal.revision, { status: 'ready' }, 'declared wakeup reached');
        goal = scheduler.goals.revise(goal.id, goal.revision, { status: 'running' }, 'selected finite runtime slice');
        const context = (this.options.context ?? (request => memory.context(request)))({ audience: goal.scope, query: goal.purpose, maxRecords: 16, maxBytes: 32768 });
        let row = runtime.store.get<GoalExecution>('initiative.execution', goal.id), execution = row?.value;
        let run = execution ? runtime.getRun(execution.runId) : undefined;
        if (!run || ['completed', 'cancelled'].includes(run.status)) {
          const budgetId = `initiative-goal:${goal.id}`;
          if (!runtime.store.get('allocations', budgetId)) runtime.resources.allocate(budgetId, goal.resources, this.rootAllocation);
          const step = (execution?.step ?? 0) + 1;
          const frame: JsonValue = { goal: { id: goal.id, revision: goal.revision, purpose: goal.purpose, successCriteria: goal.successCriteria, nextAction: goal.nextAction, evidenceIds: goal.evidenceIds }, context: JSON.parse(JSON.stringify(context)) as JsonValue };
          run = runtime.admit({ id: `initiative:${goal.id}:${step}`, source: 'initiative', externalId: goal.id, externalRevision: String(step), actorId: authority.generation, authenticated: true, scope: goal.scope, value: frame }, authority, goal.resources, budgetId);
          execution = { runId: run.id, step, observationIds: execution?.observationIds ?? [], stalls: execution?.stalls ?? 0 };
          runtime.store.put('initiative.execution', goal.id, execution, row?.revision ?? null); row = runtime.store.get('initiative.execution', goal.id);
        }
        invariant(execution && run, 'missing execution');
        if (identity(run.authority) !== identity(authority)) runtime.adopt(run.id, authority);
        const claim = runtime.prepareResume(run.id);
        if (claim.deferred) throw new StartDeferred();
        return { selected, goal, execution, run: claim.run, claim, prompt: this.options.prompt(goal, context), context };
      });
      const { selected } = prepared;
      if (!prepared.claim) {
        if (selected.kind === 'selected' && selected.selection.kind === 'obligation') {
          const id = selected.selection.obligation.id;
          try { await this.options.deliver!(id, controller.signal); } finally {
            const old = runtime.store.get('initiative.delivery-backoff', id);
            runtime.store.put('initiative.delivery-backoff', id, { at: runtime.now() + scheduler.policy.idleRetryMs }, old?.revision ?? null);
          }
        }
        return selected;
      }
      const { goal, run, context } = prepared; let { execution } = prepared;
      selectedGoalId = goal.id;
      const result = await prepared.claim.execute(prepared.prompt, controller.signal);
      const fresh = runtime.observations(run.id).filter(o => !execution!.observationIds.includes(o.id));
      for (const observation of fresh) {
        const id = `initiative-observation:${observation.id}`;
        if (!runtime.store.get('initiative.ingested', id)) runtime.store.transaction(() => {
          if (!memory.get(id, goal.scope)) memory.ingest({ id, runId: run.id, sourceId: observation.id, channel: 'tool', actorId: observation.provenance.actorId, scope: goal.scope, at: observation.provenance.recordedAt, content: { kind: observation.kind, value: observation.value } });
          runtime.store.put('initiative.ingested', id, true, null);
        });
      }
      execution = { ...execution, observationIds: [...new Set([...execution.observationIds, ...fresh.map(o => o.id)])], stalls: fresh.some(o => o.kind === 'result') ? 0 : execution.stalls + 1 };
      const currentRow = runtime.store.get('initiative.execution', goal.id)!; runtime.store.put('initiative.execution', goal.id, execution, currentRow.revision);
      // A concurrent cancellation/revision owns the current agenda; never resurrect it with stale output.
      const current = scheduler.goals.goal(goal.id)!; if (current.revision !== goal.revision) return selected;
      if (result.status === 'cancelled') scheduler.goals.revise(goal.id, goal.revision, { status: 'abandoned' }, 'runtime cancellation retained spent usage');
      else if (result.status === 'blocked') scheduler.goals.revise(goal.id, goal.revision, { status: 'blocked' }, 'runtime resource or unresolved-effect gate; reconcile before reconsideration');
      else if (execution.stalls >= scheduler.policy.maxStalls) scheduler.goals.revise(goal.id, goal.revision, { status: 'blocked' }, 'no new successful observation; bounded stall limit requires a revised approach');
      else if (result.status !== 'completed' || fresh.length === 0) scheduler.goals.revise(goal.id, goal.revision, { status: 'waiting', wakeup: { at: new Date(runtime.now() + scheduler.policy.idleRetryMs * 2 ** Math.min(16, Math.max(0, execution.stalls - 1))).toISOString(), condition: 'resume checkpoint after declared backoff' } }, 'checkpoint or absent observation; no immediate critique loop');
      else applyProgress(scheduler.goals, goal, fresh, this.options.decide(goal, fresh, context));
      return selected;
    } catch (error) {
      if (error instanceof StartDeferred) return { kind: 'idle', reason: 'host execution hold retained; no scheduler slice consumed', nextWakeup: null };
      // Errors in selection/judgment must preserve truthful resumable state, not leave an agenda running forever.
      const goal = selectedGoalId ? scheduler.goals.goal(selectedGoalId) : undefined;
      if (goal?.status === 'running') scheduler.goals.revise(goal.id, goal.revision, { status: 'blocked' }, `initiative slice failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); this.active = false; }
  }
}
