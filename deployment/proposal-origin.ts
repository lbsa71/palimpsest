import { identity, invariant, type Goal, type InboundInput } from '../packages/contracts/index.ts';
import type { InquiryOpportunity } from '../packages/initiative/drives/index.ts';
import type { InitiativeTool } from '../packages/initiative/tools.ts';
import type { ChangeProvenance } from '../packages/release/proposals.ts';
import { goalDefinitionIdentity, type EvolutionContext, type IndependentSelfOrigin } from './evolution-tools.ts';
import { isHumanInput } from './input-origin.ts';

const originTable = 'host.release-self-origins';
function inputs(context: EvolutionContext): InboundInput[] {
  return context.store.events<InboundInput>(context.runId).filter(event => ['admitted', 'steering'].includes(event.type)).map(event => event.data);
}
function trustedOrigin(context: EvolutionContext, origin: Pick<IndependentSelfOrigin, 'basis' | 'originRunId'>, visited = new Set<string>()): boolean {
  if (!origin.originRunId || visited.has(origin.originRunId)) return false;
  visited = new Set(visited).add(origin.originRunId);
  const originalInputs = inputs({ ...context, runId: origin.originRunId });
  if (originalInputs.some(input => !input.authenticated || isHumanInput(input))) return false;
  if (origin.basis === 'accepted-bootstrap') return context.store.get<{ runId: string }>('host.bootstrap', 'development:v1')?.value.runId === origin.originRunId && originalInputs.some(input => input.source === 'host.bootstrap');
  const initiative = originalInputs.find(input => input.source === 'initiative');
  return origin.basis === 'independent-initiative' && !!initiative && !!validOrigin(context, initiative.externalId, visited);
}
function validOrigin(context: EvolutionContext, goalId: string, visited = new Set<string>()): IndependentSelfOrigin | undefined {
  const goal = context.store.get<Goal>('initiative.goals', goalId)?.value;
  const origin = context.store.get<IndependentSelfOrigin>(originTable, goalId)?.value;
  return goal && origin?.goalId === goalId && origin.goalDefinition === goalDefinitionIdentity(goal) && trustedOrigin(context, origin, visited) ? origin : undefined;
}
function independent(context: EvolutionContext): Pick<IndependentSelfOrigin, 'basis' | 'originRunId'> | undefined {
  const events = inputs(context);
  if (events.some(input => !input.authenticated || isHumanInput(input))) return;
  const bootstrap = context.store.get<{ runId: string }>('host.bootstrap', 'development:v1')?.value;
  if (bootstrap?.runId === context.runId && events.some(input => input.source === 'host.bootstrap')) return { basis: 'accepted-bootstrap', originRunId: context.runId };
  const input = events.find(input => input.source === 'initiative');
  if (input && context.store.get<{ runId: string }>('initiative.execution', input.externalId)?.value.runId === context.runId && validOrigin(context, input.externalId)) return { basis: 'independent-initiative', originRunId: context.runId };
}
function inquiryIdentity(opportunity: InquiryOpportunity): string { const { status, goalId, ...definition } = opportunity; return identity(definition); }

/** Record host-observed origin atomically with goal mutations. A body field cannot establish independent origin. */
export function bindGoalOrigins(context: EvolutionContext, tools: InitiativeTool[]): InitiativeTool[] {
  const mutations = new Set(['initiative_goal_propose', 'initiative_goal_select', 'initiative_goal_accept', 'initiative_goal_revise', 'initiative_goal_progress', 'initiative_inquiry_offer']);
  return tools.map(tool => !mutations.has(tool.name) ? tool : { ...tool, execute(args) {
    return context.store.transaction(() => {
      const source = independent(context);
      const selection = tool.name === 'initiative_goal_select' && args && typeof args === 'object' && !Array.isArray(args) && typeof args.opportunityId === 'string' ? args.opportunityId : undefined;
      const opportunity = selection ? context.store.get<InquiryOpportunity>('initiative.opportunities', selection)?.value : undefined;
      const inquiryOrigin = selection ? context.store.get<{ definition: string } & Pick<IndependentSelfOrigin, 'basis' | 'originRunId'>>('host.release-inquiry-origins', selection)?.value : undefined;
      const goalId = args && typeof args === 'object' && !Array.isArray(args) && typeof args.id === 'string' ? args.id : undefined;
      const priorOrigin = goalId ? validOrigin(context, goalId) : undefined;
      const result = tool.execute(args);
      if (tool.name === 'initiative_inquiry_offer') {
        const inquiry = result as InquiryOpportunity;
        if (source) context.store.put('host.release-inquiry-origins', inquiry.id, { definition: inquiryIdentity(inquiry), ...source }, null);
        return result;
      }
      const goal = result as Goal;
      invariant(goal?.id && context.store.get<Goal>('initiative.goals', goal.id), 'Goal mutation must return its persisted goal');
      const existing = context.store.get<IndependentSelfOrigin>(originTable, goal.id);
      const creation = tool.name === 'initiative_goal_propose' || tool.name === 'initiative_goal_select' && opportunity && inquiryOrigin?.definition === inquiryIdentity(opportunity) && trustedOrigin(context, inquiryOrigin);
      if (source && (creation || priorOrigin)) {
        // Preserve the founding lineage on independent mutation; pointing at the
        // executing goal's own run would create a self-validating ancestry cycle.
        const marker: IndependentSelfOrigin = { ...(creation ? source : priorOrigin!), goalId: goal.id, goalDefinition: goalDefinitionIdentity(goal) };
        context.store.put(originTable, goal.id, marker, existing?.revision ?? null);
      } else if (existing) context.store.delete(originTable, goal.id, existing.revision);
      return result;
    });
  } });
}

/** Used by host-installed evolution tools. Their independent checks still validate eligibility and exact execution. */
export function proposalProvenance(context: EvolutionContext): ChangeProvenance {
  const events = inputs(context);
  const human = events.findLast(isHumanInput);
  if (human) { invariant(human.authenticated, 'Unauthenticated modification origin'); return { kind: 'human', inputId: human.id, actorId: human.actorId }; }
  const input = events.find(input => input.authenticated && input.source === 'initiative');
  invariant(input && independent(context), 'Self change requires an independently originated finite initiative goal');
  return { kind: 'self', inputId: input.id, goalId: input.externalId, actorId: input.actorId };
}
