import { canonicalJson, integer, invariant } from '../../contracts/index.ts';
import type { DataScope, MemoryRecord } from '../../contracts/index.ts';
import type { AdoptedSelf } from '../self/types.ts';

export interface ContextRequest { audience: DataScope; query: string; expand?: string[]; maxRecords: number; maxBytes: number; includeSelf?: boolean }
export interface DevelopmentContext {
  memories: MemoryRecord[]; self: AdoptedSelf[];
  selection: { policy: 'adopted-self-then-lexical-relevance-recency-whole-records-v1'; omittedForBudget: number; bytes: number; elapsedMs: number };
}
export function terms(query: string): Set<string> { return new Set(query.toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]+/gu) ?? []); }
export function relevance(record: MemoryRecord, queryTerms: Set<string>): number {
  const words = terms(canonicalJson(record.content)); let score = 0;
  for (const word of queryTerms) if (words.has(word)) score++;
  return score;
}
export function validateBudget(request: ContextRequest): void {
  integer(request.maxRecords, 'maxRecords'); integer(request.maxBytes, 'maxBytes');
  invariant(request.maxBytes >= 64, 'context budget too small');
}
