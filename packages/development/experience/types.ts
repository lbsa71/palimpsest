import type { DataScope, JsonValue, MemoryKind, MemoryRecord } from '../../contracts/index.ts';

/** Ingestion records what an actor said/saw; it never grants the actor execution authority. */
export interface AttributedEpisode {
  id: string; runId: string; sourceId: string; actorId: string; at: string; scope: DataScope;
  channel: 'speech' | 'tool' | 'action'; content: JsonValue;
}
export interface Derivation {
  id: string; kind: Exclude<MemoryKind, 'observation' | 'episode'>; sourceIds: string[];
  actorId: string; at: string; scope: DataScope; content: JsonValue; confidence: number | null;
  derivation?: 'interpreted' | 'summarized';
  supersedes?: string[]; contradictions?: string[];
}
export interface MemoryEntry { record: MemoryRecord; expiresAt: string | null }
