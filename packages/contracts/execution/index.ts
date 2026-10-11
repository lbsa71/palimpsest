import { assertAuthority, identity, integer, invariant, nonempty, validateArtifact, validateAuthority, validateProvenance, validateScope } from '../common.ts';
import type { ArtifactRef, Authority, DataScope, JsonValue, Provenance, ResourceEnvelope } from '../common.ts';
import type { PhysicalRequest, PromptManifest } from '../control/index.ts';

export type RunStatus = 'ready' | 'running' | 'waiting' | 'blocked' | 'completed' | 'cancelled';
export interface Run { id: string; goalId?: string; status: RunStatus; revision: number; authority: Authority; scope: DataScope }
export interface Step { id: string; runId: string; ordinal: number; status: 'planned' | 'running' | 'observed'; observationIds: string[] }
export interface ToolCall { id: string; runId: string; stepId: string; name: string; arguments: JsonValue }
export interface Observation { id: string; runId: string; stepId: string; sourceId: string; kind: 'result' | 'error' | 'uncertain'; value: JsonValue; provenance: Provenance }
export interface ShellCheckpoint { runId: string; revision: number; shell: string; artifact: ArtifactRef; observationIds: string[] }
export interface Cancellation { id: string; runId: string; requestedBy: string; reason: string; requestedAt: string }
export interface InboundInput { id: string; source: string; externalId: string; externalRevision: string; actorId: string; authenticated: boolean; scope: DataScope; value: JsonValue }
/** Covers revisions without conflating delivery duplication and a message edit. */
export function inputIdentity(input: Pick<InboundInput, 'source' | 'externalId' | 'externalRevision'>): string {
  nonempty(input.source, 'source'); nonempty(input.externalId, 'externalId'); nonempty(input.externalRevision, 'externalRevision'); return identity({ source: input.source, externalId: input.externalId, externalRevision: input.externalRevision });
}
export type EffectStatus = 'pending' | 'authorized' | 'dispatched' | 'succeeded' | 'failed' | 'uncertain';
export interface Effect { id: string; runId: string; stepId: string; kind: string; payload: JsonValue; scope: DataScope; authority: Authority; status: EffectStatus; revision: number; reservationId?: string; idempotencyKey?: string; receipt?: ArtifactRef }
export type EffectTransition =
  | { kind: 'authorize'; reservationId: string }
  | { kind: 'dispatch' }
  | { kind: 'settle'; outcome: 'succeeded' | 'failed' | 'uncertain'; receipt?: ArtifactRef }
  | { kind: 'reconcile'; outcome: 'succeeded' | 'not-applied' | 'unresolved'; receipt: ArtifactRef };
export function validateRun(run: Run): void {
  nonempty(run.id, 'run.id'); integer(run.revision, 'run.revision'); validateAuthority(run.authority); validateScope(run.scope);
  invariant(['ready', 'running', 'waiting', 'blocked', 'completed', 'cancelled'].includes(run.status), 'invalid run status');
}
/** Durable state mutation requires the store to compare run.revision atomically. */
export function transitionRun(run: Run, status: RunStatus): Run {
  validateRun(run);
  const allowed: Record<RunStatus, readonly RunStatus[]> = {
    ready: ['running', 'cancelled'], running: ['waiting', 'blocked', 'completed', 'cancelled'],
    waiting: ['ready', 'blocked', 'cancelled'], blocked: ['ready', 'cancelled'], completed: [], cancelled: [],
  };
  invariant(allowed[run.status].includes(status), `invalid run transition ${run.status} -> ${status}`);
  return { ...run, status, revision: run.revision + 1 };
}
export function validateObservation(observation: Observation): void {
  for (const key of ['id', 'runId', 'stepId', 'sourceId'] as const) nonempty(observation[key], key);
  invariant(['result', 'error', 'uncertain'].includes(observation.kind), 'invalid observation kind'); identity(observation.value); validateProvenance(observation.provenance);
}
export function validateCheckpoint(checkpoint: ShellCheckpoint, run: Run): void {
  validateRun(run); invariant(checkpoint.runId === run.id && checkpoint.revision === run.revision, 'checkpoint belongs to another run or revision'); nonempty(checkpoint.shell, 'shell'); validateArtifact(checkpoint.artifact); invariant(new Set(checkpoint.observationIds).size === checkpoint.observationIds.length, 'duplicate checkpoint observation'); checkpoint.observationIds.forEach(id => nonempty(id, 'observationId'));
}
export function validateEffect(effect: Effect): void {
  for (const key of ['id', 'runId', 'stepId', 'kind'] as const) nonempty(effect[key], key);
  validateAuthority(effect.authority); validateScope(effect.scope); integer(effect.revision, 'effect.revision'); identity(effect.payload);
  invariant(['pending', 'authorized', 'dispatched', 'succeeded', 'failed', 'uncertain'].includes(effect.status), 'invalid effect status');
  if (effect.status !== 'pending') nonempty(effect.reservationId, 'reservationId');
  if (effect.idempotencyKey !== undefined) nonempty(effect.idempotencyKey, 'idempotencyKey');
  if (effect.receipt) validateArtifact(effect.receipt);
}
/** Pure contract reducer. Caller persists with compare-and-swap and fences at the effect receiver. */
export function transitionEffect(effect: Effect, event: EffectTransition, currentAuthority: Authority): Effect {
  validateEffect(effect); validateAuthority(currentAuthority);
  // Reconciliation observes an old outcome; takeover must not strand prior uncertain effects.
  // Dispatch/authorization still require the exact generation at the receiver.
  if (event.kind !== 'reconcile') assertAuthority(effect.authority, currentAuthority);
  const next: Effect = { ...effect, revision: effect.revision + 1 };
  switch (event.kind) {
    case 'authorize': invariant(effect.status === 'pending', 'authorize only pending effect'); nonempty(event.reservationId, 'reservationId'); next.status = 'authorized'; next.reservationId = event.reservationId; break;
    case 'dispatch': invariant(effect.status === 'authorized', 'dispatch requires authorization; uncertain effects must reconcile'); next.status = 'dispatched'; break;
    case 'settle': invariant(effect.status === 'dispatched', 'settle only dispatched effect'); invariant(['succeeded', 'failed', 'uncertain'].includes(event.outcome), 'invalid settlement'); next.status = event.outcome; if (event.receipt) next.receipt = event.receipt; break;
    case 'reconcile': invariant(effect.status === 'uncertain', 'reconcile only uncertain effect'); validateArtifact(event.receipt); invariant(['succeeded', 'not-applied', 'unresolved'].includes(event.outcome), 'invalid reconciliation'); next.status = event.outcome === 'succeeded' ? 'succeeded' : event.outcome === 'not-applied' ? 'failed' : 'uncertain'; next.receipt = event.receipt; break;
    default: throw new Error('unknown effect transition');
  }
  validateEffect(next); return next;
}
/** Admission is broad; originating a human modification suggestion is separately gated. */
export function mayOriginateModification(input: InboundInput, eligibleHumanIds: readonly string[]): boolean { return input.authenticated && eligibleHumanIds.includes(input.actorId); }
export interface ShellInput { run: Run; messages: JsonValue[]; prompt: PromptManifest; checkpoint?: ShellCheckpoint }
export interface ShellResult { status: 'completed' | 'checkpointed' | 'cancelled' | 'blocked'; checkpoint?: ShellCheckpoint; observations: Observation[] }
export interface ShellBridge {
  execute(call: ToolCall, signal?: AbortSignal): Promise<Observation>;
  persistCheckpoint(runId: string, revision: number, shell: string, content: JsonValue): Promise<ShellCheckpoint>;
  readCheckpoint(checkpoint: ShellCheckpoint): Promise<JsonValue>;
  capturePrompt(manifest: PromptManifest, serializedPayload: string): Promise<void>;
  reserve(request: PhysicalRequest): Promise<void>;
  dispatched(request: PhysicalRequest): Promise<void>;
  settle(receipt: PhysicalRequest): Promise<void>;
}
export interface ShellPort { run(input: ShellInput, bridge: ShellBridge, signal?: AbortSignal): Promise<ShellResult> }
/** A child receives only artifacts and authority within this bounded parent allocation. */
export interface DelegationTask {
  id: string;
  parentRunId: string;
  parentGoalId: string;
  objective: string;
  inputs: ArtifactRef[];
  provenance: Provenance;
  scope: DataScope;
  acceptanceCriteria: string[];
  writablePaths: string[];
  allowedEffects: string[];
  resources: ResourceEnvelope;
  modelPolicy: { provider: string; model: string; effort: string | null };
  outputLocation: string;
  cancellationConditions: string[];
  maxDepth: number;
}
export interface EffectReceiver { dispatch(effect: Effect, signal?: AbortSignal): Promise<{ outcome: 'succeeded' | 'failed' | 'uncertain'; receipt?: ArtifactRef }>; reconcile(effect: Effect): Promise<{ outcome: 'succeeded' | 'not-applied' | 'unresolved'; receipt: ArtifactRef }> }
