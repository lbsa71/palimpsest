import { identity, integer, invariant, nonempty, scopeAllows, validateArtifact, validateProvenance, validateScope } from '../common.ts';
import type { ArtifactRef, DataScope, JsonValue, Provenance, ResourceEnvelope } from '../common.ts';

export interface Experience { id: string; runId: string; observationIds: string[]; scope: DataScope; provenance: Provenance; content: ArtifactRef }
export type MemoryKind = 'observation' | 'episode' | 'interpretation' | 'belief' | 'procedure' | 'relationship' | 'self-description';
export interface MemoryRecord { id: string; kind: MemoryKind; revision: number; scope: DataScope; provenance: Provenance; content: JsonValue; confidence: number | null; supersedes: string[]; contradictions: string[]; status: 'active' | 'forgotten' }
export interface SelfState { id: string; revision: number; memoryIds: string[]; preferences: JsonValue; provenance: Provenance }
export type GoalStatus = 'proposed' | 'ready' | 'running' | 'waiting' | 'blocked' | 'paused' | 'completed' | 'abandoned';
export type GoalOrigin = { kind: 'self' } | { kind: 'request'; inputId: string } | { kind: 'maintenance'; reason: string } | { kind: 'parent'; goalId: string };
export interface Goal { id: string; revision: number; origin: GoalOrigin; purpose: string; scope: DataScope; status: GoalStatus; successCriteria: string[]; evidenceIds: string[]; dependencyIds: string[]; resources: ResourceEnvelope; priority: number; nextAction: string | null; reviewAt: string; reason?: string; wakeup?: { condition: string; at: string } }
export interface Drive { id: string; revision: number; dimension: 'judgment' | 'curiosity' | 'code-quality' | 'capability' | 'other'; purpose: string; active: boolean; provenance: Provenance }
/** Independent lifecycle: never cascade-delete or complete when a goal/memory changes. */
export interface Obligation { id: string; revision: number; goalId?: string; inputId: string; audience: DataScope; promisedOutcome: string; status: 'owed' | 'delivering' | 'delivered' | 'cancelled'; dueAt: string | null; effectId?: string; resolution?: string }
export interface Disclosure { id: string; sourceIds: string[]; from: DataScope; to: DataScope; transformedArtifact: ArtifactRef; authorizationId: string }
export function validateMemory(record: MemoryRecord): void {
  identity(record.content); nonempty(record.id, 'memory.id'); integer(record.revision, 'memory.revision'); validateScope(record.scope); validateProvenance(record.provenance);
  invariant(['observation', 'episode', 'interpretation', 'belief', 'procedure', 'relationship', 'self-description'].includes(record.kind), 'invalid memory kind');
  invariant(record.confidence === null || (Number.isFinite(record.confidence) && record.confidence >= 0 && record.confidence <= 1), 'invalid confidence');
  invariant(record.status === 'active' || record.status === 'forgotten', 'invalid memory status');
  if (record.kind === 'observation') invariant(record.provenance.derivation === 'observed', 'derived text cannot become an observation');
  record.supersedes.forEach(id => nonempty(id, 'supersedes')); record.contradictions.forEach(id => nonempty(id, 'contradictions'));
}
/** Mechanical containment only; broadened disclosure requires a separately authorized transform. */
export function assertDerivationScope(sources: readonly MemoryRecord[], output: MemoryRecord): void {
  invariant(sources.length > 0, 'derivation requires sources'); validateMemory(output); invariant(output.provenance.derivation !== 'observed', 'derived record is not an observation');
  for (const source of sources) { validateMemory(source); invariant(source.status === 'active', 'cannot derive from forgotten memory'); invariant(output.provenance.sourceIds.includes(source.id), 'lost source provenance'); invariant(scopeAllows(source.scope, output.scope), 'derivation widens private scope'); }
}
export function validateGoal(goal: Goal): void {
  nonempty(goal.id, 'goal.id'); integer(goal.revision, 'goal.revision'); nonempty(goal.purpose, 'goal.purpose'); validateScope(goal.scope);
  invariant(['proposed', 'ready', 'running', 'waiting', 'blocked', 'paused', 'completed', 'abandoned'].includes(goal.status), 'invalid goal status');
  invariant(goal.successCriteria.length > 0, 'goal needs success criteria'); goal.successCriteria.forEach(s => nonempty(s, 'success criterion')); invariant(Number.isFinite(goal.priority), 'invalid priority'); invariant(Number.isFinite(Date.parse(goal.reviewAt)), 'goal needs review time');
  if (goal.status === 'waiting') { invariant(goal.wakeup !== undefined, 'waiting needs wakeup'); nonempty(goal.wakeup.condition, 'wakeup condition'); invariant(Number.isFinite(Date.parse(goal.wakeup.at)), 'invalid wakeup time'); }
  if (['blocked', 'paused', 'abandoned'].includes(goal.status)) nonempty(goal.reason, 'goal reason');
  if (goal.status === 'completed') invariant(goal.evidenceIds.length > 0, 'completion requires evidence');
  for (const [key, value] of Object.entries(goal.resources)) invariant(Number.isFinite(value) && value >= 0, `invalid resource ${key}`);
  integer(goal.resources.maxConcurrency, 'maxConcurrency'); integer(goal.resources.maxRequests, 'maxRequests'); integer(goal.resources.maxTokens, 'maxTokens');
}
export function validateObligation(value: Obligation): void {
  nonempty(value.id, 'obligation.id'); integer(value.revision, 'obligation.revision'); nonempty(value.inputId, 'inputId'); nonempty(value.promisedOutcome, 'promisedOutcome'); validateScope(value.audience);
  invariant(['owed', 'delivering', 'delivered', 'cancelled'].includes(value.status), 'invalid obligation status');
  if (value.status === 'delivering' || value.status === 'delivered') nonempty(value.effectId, 'delivery effectId');
  if (value.status === 'cancelled') nonempty(value.resolution, 'cancellation resolution');
  if (value.dueAt !== null) invariant(Number.isFinite(Date.parse(value.dueAt)), 'invalid dueAt');
}
export function validateDisclosure(value: Disclosure): void { nonempty(value.id, 'disclosure.id'); nonempty(value.authorizationId, 'disclosure authorization'); invariant(value.sourceIds.length > 0, 'disclosure needs sources'); validateScope(value.from); validateScope(value.to); validateArtifact(value.transformedArtifact); }
export interface RevisionedStore<T extends { id: string; revision: number }> { get(id: string): Promise<T | undefined>; put(value: T, expectedRevision: number | null): Promise<void> }
export interface MemoryPort { retrieve(scope: DataScope, query: string, limit: number): Promise<MemoryRecord[]>; append(record: MemoryRecord, expectedRevision: number | null): Promise<void> }
export interface GoalPort extends RevisionedStore<Goal> { ready(at: string): Promise<Goal[]> }
export interface ObligationPort extends RevisionedStore<Obligation> { owed(audience: DataScope): Promise<Obligation[]> }
