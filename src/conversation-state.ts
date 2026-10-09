import type { Json, MemorySourceRef, SlackAuthor } from './store.ts';

export interface ConversationOutcome {
  question: string; stance: string; rationale: string; unresolved: string[];
  status: 'pending' | 'settled';
}
/** Topic communication is independent of optional thought. Only confirmed final
 * delivery (or an explicit host waiver) clears the revision it reports. */
export interface ConversationTopic {
  id: string; scope: string; source: string; originalTaskId: string; replyTo: string | null;
  sourceTaskIds: string[]; sourceRefs: MemorySourceRef[];
  participants: { taskId: string; source: string; slackAuthor: SlackAuthor | null }[];
  state: 'prepared' | 'active' | 'invalidated'; revision: number; outcome: ConversationOutcome;
  memoryId: string | null; reflectionId: string | null; nextReviewAt: number; expiresAt: number;
  report: { owedRevision: number | null; lastReportedRevision: number; taskId: string | null;
    waived: boolean;
    revision: number | null; kind: 'holding' | 'final' | null; effectId: string | null;
    delivery: 'pending' | 'delivered' | 'rejected' | 'unknown'; receipt: Json };
  createdAt: string; updatedAt: string;
}
/** The selected inquiry and its source/limit metadata are immutable. Attempt
 * recovery changes only lifecycle/checkpoint, never reconstructs the question. */
export interface ConversationReflection {
  id: string; topicId: string; scope: string; question: string; sourceRefs: MemorySourceRef[];
  sourceTaskIds: string[]; maxAttempts: number; attempts: number;
  state: 'waiting' | 'running' | 'paused' | 'completed' | 'cancelled' | 'rejected';
  checkpoint: Json; updatedAt: string;
}
export interface ConversationTopicInput {
  topicId?: string; expectedRevision?: number; outcome: ConversationOutcome; reflectionQuestion?: string;
}
