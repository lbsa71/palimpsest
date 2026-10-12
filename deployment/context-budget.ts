import type { ApplicationConfig } from './config.ts';

/** Bound rendered bytes conservatively below the advertised token window and broker payload ceiling. */
export function contextBudget(config: Pick<ApplicationConfig, 'model' | 'allowanceAmendment'>) {
  if (!config.allowanceAmendment) return { thresholdMessages: 60, thresholdBytes: 60000, retainMessages: 7 };
  return {
    thresholdMessages: 1000,
    thresholdBytes: Math.max(1, Math.min(1_500_000, Math.floor((config.model.contextWindow - config.model.maxOutputTokens) * 0.75))),
    retainMessages: 7,
  };
}
