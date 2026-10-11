import type { DataScope } from '../../contracts/index.ts';
import type { Derivation } from '../experience/types.ts';
export interface ConsolidationJob {
  id: string; revision: number; sourceIds: string[]; sourceRevisions: number[]; scope: DataScope;
  dueAt: string; state: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  attempts: number; lease: { owner: string; until: string } | null; outputIds: string[]; error: string | null;
}
export interface ClaimedJob { job: ConsolidationJob }
export type ConsolidationOutput = Derivation[];
