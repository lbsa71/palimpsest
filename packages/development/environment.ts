import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

/** Receiver-free host functions; supplied independently of memory content. */
export interface MemoryEnvironment {
  monotonicNow(): number;
  withdrawalId(): string;
  compareIds(left: string, right: string): number;
}

/** Concrete host composition. Preserve the existing host-default collation. */
export function nodeMemoryEnvironment(): MemoryEnvironment {
  const collator = new Intl.Collator();
  return { monotonicNow: performance.now.bind(performance), withdrawalId: randomUUID, compareIds: collator.compare };
}
export function nodeMemoryWallClock(): () => string {
  const DateConstructor = Date, now = Date.now.bind(Date);
  return () => new DateConstructor(now()).toISOString();
}
