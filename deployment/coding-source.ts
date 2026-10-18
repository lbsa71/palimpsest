import { identity, invariant, type JsonValue } from '../packages/contracts/index.ts';
import type { OperationalStore } from '../packages/storage/index.ts';
import type { CodingSource } from './coding-limb.ts';

interface SourceRecord { state: 'preparing' | 'ready' | 'uncertain'; source?: CodingSource; receipt?: CodingSource['receipt'] }
interface CodingSourcesOptions { store: OperationalStore; snapshot(workspace: string, path: string, signal?: AbortSignal, timeoutMs?: number): Promise<JsonValue> }
/** Preparation is trusted host work; the mind never receives a filesystem capability. */
export class CodingSources {
  private readonly options: CodingSourcesOptions;
  private readonly active = new Map<string, Promise<CodingSource>>();
  constructor(options: CodingSourcesOptions) { this.options = options; }
  prepared(workspace: string, candidateId: string): CodingSource | undefined {
    const record = this.options.store.get<SourceRecord>('host.coding-sources', identity({ workspace, candidateId }))?.value;
    invariant(!record || record.state === 'ready', 'Partial coding source preparation requires host inspection; no overwrite or automatic retry');
    return record?.source ? structuredClone(record.source) : undefined;
  }
  async prepare(workspace: string, candidateId: string, signal?: AbortSignal, timeoutMs?: number): Promise<CodingSource> {
    invariant(/^[a-f0-9]{64}$/.test(candidateId), 'Accepted source candidate identity required');
    const key = identity({ workspace, candidateId });
    const active = this.active.get(key); if (active) return active;
    invariant(timeoutMs === undefined || Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 30000, 'Finite source preparation timeout required');
    const task = this.prepareOnce(workspace, candidateId, signal, timeoutMs); this.active.set(key, task);
    try { return await task; } finally { this.active.delete(key); }
  }
  private async prepareOnce(workspace: string, candidateId: string, signal?: AbortSignal, timeoutMs?: number): Promise<CodingSource> {
    const key = identity({ workspace, candidateId }), path = `repositories/${candidateId}`;
    const existing = this.options.store.get<SourceRecord>('host.coding-sources', key)?.value;
    if (existing?.state === 'ready') return structuredClone(existing.source!);
    invariant(!existing, 'Partial coding source preparation requires host inspection; no overwrite or automatic retry');
    signal?.throwIfAborted();
    this.options.store.put('host.coding-sources', key, { state: 'preparing' }, null);
    try {
      const receipt = await this.options.snapshot(workspace, path, signal, timeoutMs);
      const artifact = this.options.store.putJsonArtifact(receipt);
      const preparing = this.options.store.get<SourceRecord>('host.coding-sources', key)!;
      this.options.store.put('host.coding-sources', key, { ...preparing.value, receipt: artifact }, preparing.revision);
      invariant(receipt && typeof receipt === 'object' && !Array.isArray(receipt) && receipt.exitCode === 0,
        'Coding source preparation failed; inspect its retained receipt before another attempt');
      const source = { candidateId, path, receipt: artifact };
      const row = this.options.store.get<SourceRecord>('host.coding-sources', key)!;
      this.options.store.put('host.coding-sources', key, { state: 'ready', source }, row.revision);
      return source;
    } catch (error) {
      const row = this.options.store.get<SourceRecord>('host.coding-sources', key)!;
      this.options.store.put('host.coding-sources', key, { ...row.value, state: 'uncertain' }, row.revision);
      throw error;
    }
  }
}
