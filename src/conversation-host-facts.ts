import type { RuntimeConfig } from './config.ts';

type SchedulingConfig = Pick<RuntimeConfig, 'planCadence' | 'planProposalCallsPerDay' | 'planEvolutionCallsPerDay' | 'planProposalCallsPerHour' | 'planEvolutionCallsPerHour' | 'growthCallsPerDay'>;
export interface ConversationSchedulingState {
  serving: boolean; ready: boolean; stopping: boolean;
  planScheduled: boolean; growthTimerScheduled: boolean;
  userWork: boolean; backgroundQuiescing: boolean;
}
/** Configuration and the current timer are different facts: a task temporarily
 * defers inference, and release quiescence can stop its timer, without removing
 * the mission or resetting budgets. A scheduled timer can still be paused by
 * user priority; timer presence alone does not promise available inference. */
export function conversationSchedulingFacts(config: SchedulingConfig, state: ConversationSchedulingState) {
  const hourly = config.planCadence === 'hourly';
  const enabled = state.serving && config.growthCallsPerDay > 0;
  const paused = enabled && (state.userWork || state.backgroundQuiescing || state.stopping || !state.ready || !state.growthTimerScheduled);
  const pauseReason = !paused ? null : state.stopping ? 'shutdown' : !state.ready ? 'startup'
    : state.userWork ? 'user_work' : state.backgroundQuiescing ? 'background_quiescence' : null;
  return {
    activePlanAllocation: { cadence: config.planCadence, timeUnit: hourly ? 'UTC hour' : 'UTC day',
      proposalCalls: hourly ? config.planProposalCallsPerHour : config.planProposalCallsPerDay,
      releaseCalls: hourly ? config.planEvolutionCallsPerHour : config.planEvolutionCallsPerDay, scheduled: state.planScheduled },
    planAllocationSettings: {
      daily: { selected: !hourly, proposalCalls: config.planProposalCallsPerDay, releaseCalls: config.planEvolutionCallsPerDay },
      hourly: { selected: hourly, proposalCalls: config.planProposalCallsPerHour, releaseCalls: config.planEvolutionCallsPerHour },
    },
    legacyPlanAllocationFields: 'Compatibility configuration settings for alternate policies; only activePlanAllocation describes the selected policy.',
    standingGrowth: { configured: state.serving, enabled, callsPerUtcDay: config.growthCallsPerDay, timerScheduled: state.growthTimerScheduled, paused, pauseReason },
  };
}
