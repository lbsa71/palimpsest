import { invariant, nonempty, scopeAllows, validateGoal } from '../contracts/index.ts';
import type { DataScope, Goal, JsonValue, Observation, ResourceEnvelope } from '../contracts/index.ts';
import { InitiativeRegistry } from './goals/index.ts';
import { DriveRegistry } from './drives/index.ts';
import type { GrowthDimension } from './drives/index.ts';
import { PlanRegistry, applyProgress } from './planning/index.ts';
import type { ProgressDecision } from './planning/index.ts';
import type { DurablePlan } from './planning/index.ts';
import { nodeInitiativeWallClock } from './environment.ts';
export interface InitiativeTool { name: string; description: string; inputSchema: object; execute(args: JsonValue): unknown }
function argsObject(args: JsonValue, allowed: string[]): { [key: string]: JsonValue } { invariant(args !== null && typeof args === 'object' && !Array.isArray(args), 'expected object'); invariant(Object.keys(args).every(key => allowed.includes(key)), 'unknown initiative argument'); return args; }
function stringArray(value: JsonValue | undefined): string[] { invariant(Array.isArray(value) && value.every(v => typeof v === 'string'), 'expected string array'); return value as string[]; }
function text(value: JsonValue | undefined): string { nonempty(value, 'argument'); return value; }
function count(value: JsonValue | undefined): number { invariant(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, 'invalid revision'); return value; }
const string = { type: 'string', minLength: 1 }, strings = { type: 'array', items: string }, revision = { type: 'integer', minimum: 0 };
function schema(properties: object, required: string[]): object { return { type: 'object', properties, required, additionalProperties: false }; }
/** Auditable shell descriptors. Audience, actor and maximum grant are authenticated host inputs. */
export function initiativeTools(goals: InitiativeRegistry, drives: DriveRegistry, plans: PlanRegistry, audience: DataScope, actorId: string, maximum: ResourceEnvelope, runId: string, wallClock?: () => string): InitiativeTool[] {
  const supplier = wallClock ?? nodeInitiativeWallClock();
  const clock = () => {
    const value = supplier();
    invariant(typeof value === 'string' && /^(?:\d{4}|[+-]\d{6})-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)), 'invalid initiative wall timestamp: explicit ISO timezone required');
    return value;
  };
  const boundAudience = structuredClone(audience);
  const sources = (value: JsonValue | undefined): string[] => { const ids = stringArray(value); invariant(ids.length > 0, 'experience sources required'); ids.forEach(id => invariant(drives.memory.get(id, boundAudience), 'source unavailable')); return ids; };
  const visibleGoal = (id: string): Goal => { const goal = goals.all(boundAudience).find(g => g.id === id); invariant(goal, 'goal unavailable'); return goal; };
  const mutableGoal = (id: string): Goal => { const goal = visibleGoal(id); invariant(scopeAllows(boundAudience, goal.scope), 'goal mutation would widen caller audience'); return goal; };
  const resources = (value: JsonValue | undefined): ResourceEnvelope => {
    invariant(value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value), 'resources required'); const result = value as unknown as ResourceEnvelope;
    invariant(Object.keys(result).length === Object.keys(maximum).length && Object.keys(result).every(key => key in maximum), 'invalid resource fields');
    for (const key of Object.keys(maximum) as (keyof ResourceEnvelope)[]) invariant(typeof result[key] === 'number' && Number.isFinite(result[key]) && result[key] >= 0 && result[key] <= maximum[key], 'resource exceeds host grant'); return result;
  };
  return [{
    name: 'initiative_agenda', description: 'Read visible goals, adopted growth dimensions and experience-derived inquiry opportunities. Missing adoption is an open decision, not evidence of growth.', inputSchema: schema({}, []),
    execute(args) { argsObject(args, []); return { goals: goals.all(boundAudience), drives: drives.adopted(boundAudience), dimensions: drives.coverage(boundAudience), opportunities: drives.opportunities(boundAudience) }; },
  }, {
    name: 'initiative_goal_propose', description: 'Propose a finite self-chosen goal with experience evidence and a bounded host grant. Acceptance and execution are separate.',
    inputSchema: schema({ id: string, purpose: string, successCriteria: strings, sourceIds: strings, dependencyIds: strings, resources: { type: 'object' }, priority: { type: 'number' }, nextAction: string, reviewAt: { type: 'string', format: 'date-time' } }, ['id', 'purpose', 'successCriteria', 'sourceIds', 'resources', 'priority', 'nextAction', 'reviewAt']),
    execute(args) { const a = argsObject(args, ['id', 'purpose', 'successCriteria', 'sourceIds', 'dependencyIds', 'resources', 'priority', 'nextAction', 'reviewAt']); const ids = sources(a.sourceIds); invariant(typeof a.priority === 'number', 'priority required'); const candidate = { id: text(a.id), origin: { kind: 'self' as const }, purpose: text(a.purpose), scope: boundAudience, successCriteria: stringArray(a.successCriteria), evidenceIds: ids, dependencyIds: a.dependencyIds ? stringArray(a.dependencyIds) : [], resources: resources(a.resources), priority: a.priority, nextAction: text(a.nextAction), reviewAt: text(a.reviewAt) }; validateGoal({ ...candidate, revision: 1, status: 'proposed' }); return goals.propose(candidate, { sourceIds: ids, actorId, recordedAt: clock(), derivation: 'interpreted' }); },
  }, {
    name: 'initiative_goal_accept', description: 'Adopt a proposed goal with an explicit reason. This decision does not grant effect permissions.', inputSchema: schema({ id: string, expectedRevision: revision, reason: string }, ['id', 'expectedRevision', 'reason']),
    execute(args) { const a = argsObject(args, ['id', 'expectedRevision', 'reason']); const goal = mutableGoal(text(a.id)); invariant(goal.status === 'proposed', 'goal already adopted'); return goals.accept(goal.id, count(a.expectedRevision), text(a.reason)); },
  }, {
    name: 'initiative_goal_revise', description: 'Reconsider a goal, choose a new observation, pause, block, wait or retire with reasons. Completion is evaluated against actual runtime observations.', inputSchema: schema({ id: string, expectedRevision: revision, purpose: string, nextAction: string, priority: { type: 'number' }, status: { enum: ['ready', 'waiting', 'blocked', 'paused', 'abandoned'] }, wakeup: { type: 'object', properties: { at: string, condition: string }, required: ['at', 'condition'], additionalProperties: false }, reason: string }, ['id', 'expectedRevision', 'reason']),
    execute(args) { const a = argsObject(args, ['id', 'expectedRevision', 'purpose', 'nextAction', 'priority', 'status', 'wakeup', 'reason']); const goal = mutableGoal(text(a.id)); const patch: Partial<Goal> = {}; if (a.purpose !== undefined) patch.purpose = text(a.purpose); if (a.nextAction !== undefined) patch.nextAction = text(a.nextAction); if (a.priority !== undefined) { invariant(typeof a.priority === 'number' && Number.isFinite(a.priority), 'invalid priority'); patch.priority = a.priority; } if (a.status !== undefined) { invariant(['ready', 'waiting', 'blocked', 'paused', 'abandoned'].includes(text(a.status)), 'invalid status'); patch.status = a.status as Goal['status']; } if (a.wakeup !== undefined) { const wakeup = argsObject(a.wakeup, ['at', 'condition']); patch.wakeup = { at: text(wakeup.at), condition: text(wakeup.condition) }; } return goals.revise(goal.id, count(a.expectedRevision), patch, text(a.reason)); },
  }, {
    name: 'initiative_goal_progress', description: 'Judge the current runtime observations against the goal criteria, preserving uncertainty. Complete only with persisted successful evidence; continue after failure by choosing a changed observation. This is a mind decision, not independent competence validation.',
    inputSchema: schema({ id: string, expectedRevision: revision, decision: { type: 'object' } }, ['id', 'expectedRevision', 'decision']),
    execute(args) {
      const a = argsObject(args, ['id', 'expectedRevision', 'decision']); const goal = mutableGoal(text(a.id));
      invariant(goal.status === 'running' && goal.revision === count(a.expectedRevision), 'progress requires current running goal');
      const execution = goals.store.get<{ runId: string }>('initiative.execution', goal.id)?.value; invariant(execution && execution.runId === runId, 'progress requires this run to own the actual runtime execution');
      const observations = goals.store.list<Observation>('observations').map(row => row.value).filter(o => o.runId === execution.runId && !goal.evidenceIds.includes(o.id));
      const d = argsObject(a.decision!, ['kind', 'reason', 'evidenceIds', 'nextAction', 'at', 'condition']); const kind = text(d.kind); const reason = text(d.reason); let decision: ProgressDecision;
      if (kind === 'complete') decision = { kind, reason, evidenceIds: stringArray(d.evidenceIds) };
      else if (kind === 'continue') decision = { kind, reason, evidenceIds: stringArray(d.evidenceIds), nextAction: text(d.nextAction) };
      else if (kind === 'wait') decision = { kind, reason, at: text(d.at), condition: text(d.condition) };
      else { invariant(['block', 'pause', 'abandon'].includes(kind), 'invalid progress decision'); decision = { kind: kind as 'block' | 'pause' | 'abandon', reason }; }
      return applyProgress(goals, goal, observations, decision);
    },
  }, {
    name: 'initiative_drive_adopt', description: 'Adopt or revise a standing growth dimension, its relative weight and purpose using attributed experience. No identity or interest is seeded.', inputSchema: schema({ id: string, dimension: { enum: ['judgment', 'curiosity', 'code-quality', 'capability'] }, purpose: string, sourceIds: strings, reason: string, weight: { type: 'number', exclusiveMinimum: 0, maximum: 100 }, active: { type: 'boolean' }, expectedRevision: { anyOf: [revision, { type: 'null' }] } }, ['id', 'dimension', 'purpose', 'sourceIds', 'reason', 'weight', 'active', 'expectedRevision']),
    execute(args) { const a = argsObject(args, ['id', 'dimension', 'purpose', 'sourceIds', 'reason', 'weight', 'active', 'expectedRevision']); const ids = sources(a.sourceIds); invariant(typeof a.weight === 'number' && typeof a.active === 'boolean', 'weight/active required'); return drives.adopt({ id: text(a.id), dimension: text(a.dimension) as GrowthDimension, purpose: text(a.purpose), scope: boundAudience, reason: text(a.reason), weight: a.weight, active: a.active, provenance: { sourceIds: ids, actorId, recordedAt: clock(), derivation: 'interpreted' } }, a.expectedRevision === null ? null : count(a.expectedRevision)); },
  }, {
    name: 'initiative_inquiry_offer', description: 'Form a concrete inquiry from available experience and an adopted drive, specifying a new observation and finite success criteria.', inputSchema: schema({ id: string, driveId: string, sourceIds: strings, question: string, observationAction: string, successCriteria: strings, reason: string, priority: { type: 'number' } }, ['id', 'driveId', 'sourceIds', 'question', 'observationAction', 'successCriteria', 'reason', 'priority']),
    execute(args) { const a = argsObject(args, ['id', 'driveId', 'sourceIds', 'question', 'observationAction', 'successCriteria', 'reason', 'priority']); invariant(typeof a.priority === 'number', 'priority required'); return drives.offer({ id: text(a.id), driveId: text(a.driveId), scope: boundAudience, sourceIds: sources(a.sourceIds), question: text(a.question), observationAction: text(a.observationAction), successCriteria: stringArray(a.successCriteria), reason: text(a.reason), priority: a.priority }); },
  }, {
    name: 'initiative_goal_select', description: 'Select an available inquiry opportunity as a proposed finite goal; acceptance remains an explicit decision.', inputSchema: schema({ opportunityId: string, goalId: string, resources: { type: 'object' }, dependencyIds: strings, priority: { type: 'number' }, reviewAt: string }, ['opportunityId', 'goalId', 'resources', 'priority', 'reviewAt']),
    execute(args) { const a = argsObject(args, ['opportunityId', 'goalId', 'resources', 'dependencyIds', 'priority', 'reviewAt']); invariant(typeof a.priority === 'number', 'priority required'); invariant(drives.opportunities(boundAudience).some(o => o.id === a.opportunityId && scopeAllows(boundAudience, o.scope)), 'opportunity unavailable for caller audience'); return drives.select(text(a.opportunityId), goals, { id: text(a.goalId), resources: resources(a.resources), priority: a.priority, reviewAt: text(a.reviewAt), dependencyIds: a.dependencyIds ? stringArray(a.dependencyIds) : [] }, actorId, clock()); },
  }, {
    name: 'initiative_plan_put', description: 'Persist a machine-readable Aeon, Lane and bounded Tasks plan with dependencies, ownership, validation evidence and handoff.', inputSchema: schema({ plan: { type: 'object' }, expectedRevision: { anyOf: [revision, { type: 'null' }] } }, ['plan', 'expectedRevision']),
    execute(args) { const a = argsObject(args, ['plan', 'expectedRevision']); invariant(a.plan !== null && typeof a.plan === 'object' && !Array.isArray(a.plan), 'plan required'); const plan = a.plan as unknown as Omit<DurablePlan, 'revision'>; visibleGoal(plan.goalId); return plans.put({ ...plan, scope: boundAudience }, a.expectedRevision === null ? null : count(a.expectedRevision)); },
  }];
}
