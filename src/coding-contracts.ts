import type { Json } from './store.ts';
import type { CodingContract, CodingSession } from './coding-state.ts';
import type { CodingMessage, CodingProviderLimits, CodingToolDefinition, RawToolIntent, ToolOutcome, Usage } from './coding-provider.ts';
import type { WorkspaceBase } from './workspaces.ts';

/** Host-configured finite policy; none of these values creates a new allocation. */
export interface CodingSessionPolicy {
  lane: CodingContract['lane']; limits: CodingContract['limits']; expiresAt: number;
  providerProfile: Json; catalogVersion: string;
  providerLimits: CodingProviderLimits;
  maxTranscriptMessages: number; maxTranscriptBytes: number;
  commandTimeoutMs: number; maxCommandOutputBytes: number;
  reportBinding?: Json;
}
export interface CodingExecutionContext {
  sessionId: string; taskId: string; attemptId: string; contractDigest: string; epoch: number; expiresAt: number;
  workspaceId: string; sourceArtifactId: string; base: WorkspaceBase;
  commands: Array<{ callId: string; effectId: string }>;
}
export interface CodingPendingTool {
  intent: RawToolIntent; effectId: string; state: 'pending' | 'started' | 'completed';
  outcome?: ToolOutcome; receipt?: Json;
}
export interface CodingSessionData {
  version: 'coding-coordinator/1'; objective: string; epoch: number; workspaceId: string; sourceArtifactId: string;
  base: WorkspaceBase; policy: CodingSessionPolicy; messages: CodingMessage[]; seenCallIds: string[];
  step: number; pending: CodingPendingTool[]; commands: Array<{ callId: string; effectId: string }>;
  usage: Usage[]; inFlight: { requestId: string; ordinal: number; transcriptDigest: string } | null;
  submission: Json | null; outcome: string | null;
}
export function codingData(session: CodingSession): CodingSessionData {
  const data = session.data as unknown as CodingSessionData;
  if (!data || data.version !== 'coding-coordinator/1' || !Array.isArray(data.messages) || !Array.isArray(data.pending) || !Array.isArray(data.seenCallIds)) throw new Error('Invalid durable coding coordinator state');
  return structuredClone(data);
}
export interface CodingProviderGates {
  session: CodingSession; tools: readonly CodingToolDefinition[]; limits: CodingProviderLimits;
  preauthorize(signal: AbortSignal): void;
  reserve(request: { model: string; bodyBytes: number; bodySha256: string; signal: AbortSignal }): void;
}
