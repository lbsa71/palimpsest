import { randomUUID } from 'node:crypto';

/** Host functions have no receiver. A failed schedule owns its own cleanup. */
export type ScheduleTimeout = (delayMs: number, callback: () => void) => () => void;
export interface SchedulerEnvironment { newId(): string; compareIds(left: string, right: string): number }
export function nodeInitiativeId(): () => string { return randomUUID; }
export function nodeInitiativeCollation(): (left: string, right: string) => number { return new Intl.Collator().compare; }
export function nodeInitiativeWallClock(): () => string {
  const DateConstructor = Date, now = Date.now;
  return () => new DateConstructor(now()).toISOString();
}
export function nodeInitiativeTimer(): ScheduleTimeout {
  const schedule = setTimeout, clear = clearTimeout;
  return (delayMs, callback) => {
    const timer = schedule(callback, delayMs); let cancelled = false;
    return () => { if (!cancelled) { cancelled = true; clear(timer); } };
  };
}
