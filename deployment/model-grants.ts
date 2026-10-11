import { identity, invariant } from '../packages/contracts/index.ts';
import type { ShellProvider } from '../packages/agent-shell/index.ts';

export interface ModelProfile {
  provider?: ShellProvider; id: string; contextWindow: number; reasoning: boolean; effort: 'none' | 'high';
  maxOutputTokens: number; maxRequestsPerSlice: number; timeoutMs: number;
  pricesPerMillion: { input: number; output: number };
}
const bounds = ['contextWindow', 'maxOutputTokens', 'maxRequestsPerSlice', 'timeoutMs'] as const;
/** A profile grants a particular priced transport, not a claim of measured competence. */
export function validateModelProfile(value: unknown): asserts value is ModelProfile {
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'Model profile required');
  const model = value as ModelProfile;
  const fields = ['id', 'reasoning', 'effort', 'pricesPerMillion', ...bounds, ...(model.provider !== undefined ? ['provider'] : [])];
  invariant(Object.keys(model).sort().join(',') === fields.sort().join(','), 'Exact model profile fields required');
  invariant(model.provider === undefined || ['mistral', 'openai'].includes(model.provider), 'Unsupported configured provider');
  invariant(typeof model.id === 'string' && model.id.trim() === model.id && model.id.length > 0 && model.id.length <= 256 && !model.id.toLowerCase().includes('latest'), 'Pinned model required');
  for (const key of bounds) invariant(Number.isSafeInteger(model[key]) && model[key] > 0, `Invalid model ${key}`);
  invariant(typeof model.reasoning === 'boolean' && (model.effort === 'none' || model.effort === 'high' && model.reasoning), 'Unsupported reasoning profile');
  invariant(model.maxOutputTokens <= model.contextWindow, 'Output allowance exceeds configured context window');
  invariant(model.pricesPerMillion && Object.keys(model.pricesPerMillion).sort().join(',') === 'input,output', 'Explicit input and output model prices required');
  for (const value of Object.values(model.pricesPerMillion)) invariant(Number.isFinite(value) && value >= 0, 'Finite model price required');
}
function normalized(model: ModelProfile): ModelProfile { return { ...structuredClone(model), provider: model.provider ?? 'mistral' }; }
export function validateModelGrants(grants: readonly ModelProfile[]): void {
  invariant(Array.isArray(grants) && grants.length <= 32, 'Bounded model profile grants required');
  grants.forEach(validateModelProfile);
  invariant(new Set(grants.map(model => identity(normalized(model)))).size === grants.length, 'Duplicate model profile grant');
}
export function availableModelProfiles(current: ModelProfile, grants: readonly ModelProfile[] = []): ModelProfile[] {
  validateModelProfile(current); validateModelGrants(grants);
  return [...new Map([current, ...grants].map(model => [identity(normalized(model)), structuredClone(model)])).values()];
}
/** Selection can reduce request bounds; changing provider, model, effort or prices requires its own host grant. */
export function selectModelProfile(proposed: unknown, current: ModelProfile, grants: readonly ModelProfile[] = []): ModelProfile {
  validateModelProfile(proposed);
  const transport = (model: ModelProfile): object => { const { contextWindow, maxOutputTokens, maxRequestsPerSlice, timeoutMs, ...transport } = normalized(model); return transport; };
  const accepted = availableModelProfiles(current, grants).some(grant => identity(transport(proposed)) === identity(transport(grant)) && bounds.every(key => proposed[key] <= grant[key]));
  invariant(accepted, 'Proposed model lacks an exact host profile and request-bound grant');
  return structuredClone(proposed);
}
