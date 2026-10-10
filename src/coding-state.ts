import type { Json } from './store.ts';

export type CodingLane =
  | { kind: 'conversation'; taskId: string; maxCalls: number }
  | { kind: 'plan'; cadence: 'daily' | 'hourly'; maxCalls: number }
  | { kind: 'growth'; schedulerId: string; windowMs: number; maxCalls: number };
/** Host-admitted immutable historical binding. Epoch renewals belong in state,
 * never in a replacement contract that silently resets allocation or lineage. */
export interface CodingContract {
  version: 'coding-session/1'; sessionId: string; workRootId: string; attemptId: string;
  originTaskId: string; taskId: string; lane: CodingLane;
  limits: { maxWorkCalls: number; maxSessionCalls: number; maxAttemptCalls: number; maxAttempts: number; maxCommands: number };
  expiresAt: number; binding: Json;
}
/** Link an already charged admission decision; this never grants another call. */
export type CodingInitialCall = { taskId: string; ordinal: number } | { growthId: string; eventSeq: number };
export interface CodingSession {
  version: 'coding-state/1'; id: string; contract: CodingContract; contractDigest: string; revision: number;
  state: 'ready' | 'running' | 'paused' | 'terminal'; phase: string; reason: string | null;
  nextEligibleAt: number | null; data: Json; createdAt: number; updatedAt: number;
}
export interface CodingReservation {
  version: 'coding-request/1'; id: string; sessionId: string; workRootId: string; attemptId: string;
  ordinal: number; intent: Json; reservedAt: number; window: Json;
  status: 'reserved' | 'dispatched' | 'observed' | 'unknown' | 'not_dispatched'; usage: Json; reason: string | null;
}
export type CodingSessionPatch = Partial<Pick<CodingSession, 'state' | 'phase' | 'reason' | 'nextEligibleAt' | 'data'>>;
export interface CodingReservationResult {
  disposition: 'reserved' | 'duplicate' | 'blocked'; reservation?: CodingReservation; reason?: string; nextEligibleAt?: number;
}

export function codingInteger(value: unknown, label: string, minimum = 0): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new Error(`${label} must be a finite safe integer`);
}
export function codingText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be nonempty`);
}
/** SDK instances, implicit JSON coercions and nonfinite values are not records. */
export function codingJson(value: unknown, depth = 0): asserts value is Json {
  if (depth > 64) throw new Error('Coding JSON nesting is too deep');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) { for (const child of value) codingJson(child, depth + 1); return; }
  if (typeof value === 'object' && value && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    for (const child of Object.values(value)) codingJson(child, depth + 1); return;
  }
  throw new Error('Coding state must contain SDK-independent JSON values');
}
export function validateCodingContract(value: CodingContract): void {
  codingJson(value);
  if (value.version !== 'coding-session/1') throw new Error('Unsupported coding contract version');
  for (const key of ['sessionId', 'workRootId', 'attemptId', 'originTaskId', 'taskId'] as const) codingText(value[key], key);
  codingInteger(value.expiresAt, 'Coding expiry');
  if (!value.limits || !value.lane) throw new Error('Finite coding allocation and lane are required');
  for (const key of ['maxWorkCalls', 'maxSessionCalls', 'maxAttemptCalls', 'maxAttempts', 'maxCommands'] as const) codingInteger(value.limits[key], key);
  if (value.limits.maxSessionCalls > value.limits.maxWorkCalls || value.limits.maxAttemptCalls > value.limits.maxWorkCalls) throw new Error('Coding child allocation exceeds work allocation');
  codingInteger(value.lane.maxCalls, 'Lane capacity');
  if (value.lane.kind === 'conversation') { codingText(value.lane.taskId, 'Conversation accounting task'); if (value.lane.taskId !== value.originTaskId) throw new Error('Conversation lane must retain its origin task'); }
  else if (value.lane.kind === 'plan') { if (!['daily', 'hourly'].includes(value.lane.cadence)) throw new Error('Invalid plan cadence'); }
  else if (value.lane.kind === 'growth') { codingText(value.lane.schedulerId, 'Growth scheduler'); codingInteger(value.lane.windowMs, 'Growth window duration', 1); }
  else throw new Error('Unavailable coding accounting lane');
}
