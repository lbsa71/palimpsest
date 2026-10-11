import type { DataScope, JsonValue, SelfState } from '../../contracts/index.ts';
/** Self claims are choices/interpretations; no facet is seeded or inferred as demonstrated ability. */
export interface AdoptedSelf extends SelfState {
  scope: DataScope; status: 'active' | 'forgotten';
  preferences: { category: 'interest' | 'value' | 'ability' | 'uncertainty' | 'preference' | 'description'; value: JsonValue; reason: string };
}
export interface AdoptSelf {
  id: string; actorId: string; at: string; scope: DataScope; memoryIds: string[];
  category: AdoptedSelf['preferences']['category']; value: JsonValue; reason: string;
}
