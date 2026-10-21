import { identity, invariant } from '../packages/contracts/index.ts';
import { ResourceLedger, type RequestCeiling } from '../packages/runtime/resources/index.ts';
import type { OperationalStore } from '../packages/storage/index.ts';

/** Trusted composition binds accepted policy; stored amendment history alone grants nothing. */
export type HostResourceLedgerFactory = (store: OperationalStore, ceiling: RequestCeiling, now?: () => number) => ResourceLedger;
export interface ReviewMonitor { every(ms: number, callback: () => void): () => void }
/** Production timer adapter; deterministic callers supply their own monitor. */
export function createProductionReviewMonitor(): ReviewMonitor {
  return { every(ms, callback) { const handle = setInterval(callback, ms); return () => clearInterval(handle); } };
}
export interface HostResourceOptions { resourceLedger?: HostResourceLedgerFactory; now?: () => number; monitor?: ReviewMonitor }

export function hostResourceLedger(store: OperationalStore, ceiling: RequestCeiling, options: HostResourceOptions = {}): ResourceLedger {
  const ledger = options.resourceLedger?.(store, { ...ceiling }, options.now) ?? new ResourceLedger(store, { ...ceiling }, options.now);
  invariant(ledger instanceof ResourceLedger && ledger.store === store && identity(ledger.defaultCeiling) === identity(ceiling),
    'Host resource factory must retain the exact store and physical request ceiling');
  return ledger;
}
