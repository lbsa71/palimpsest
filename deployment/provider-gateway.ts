import { invariant } from '../packages/contracts/index.ts';
import type { ResourceLedger } from '../packages/runtime/resources/index.ts';
import type { OperationalStore } from '../packages/storage/index.ts';
import type { ShellProvider } from '../packages/agent-shell/index.ts';
import type { TransportReceipt } from './broker-shell.ts';

export function providerGateway(options: { provider?: ShellProvider; apiKey(): string; maxResponseBytes: number; fetch?: typeof fetch }) {
  const provider = options.provider ?? 'mistral';
  invariant(provider === 'mistral' || provider === 'openai', 'Unsupported gateway provider');
  const endpoint = provider === 'openai' ? 'https://api.openai.com/v1/responses' : 'https://api.mistral.ai/v1/chat/completions';
  invariant(Number.isSafeInteger(options.maxResponseBytes) && options.maxResponseBytes > 0, 'Response byte ceiling required');
  return async (payload: string, signal: AbortSignal): Promise<{ status: number; body: string }> => {
    const apiKey = options.apiKey();
    invariant(apiKey.length > 0, 'Selected provider credential unavailable');
    const response = await (options.fetch ?? fetch)(endpoint, {
      method: 'POST', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: payload,
    });
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Provider response has no body');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > options.maxResponseBytes) throw new Error('Provider response exceeded the configured byte ceiling');
        chunks.push(part.value);
      }
      return { status: response.status, body: Buffer.concat(chunks).toString('utf8') };
    } finally { await reader.cancel().catch(() => {}); }
  };
}

export function transportRecorder(store: OperationalStore): (receipt: TransportReceipt) => void {
  return receipt => {
    const row = store.get<TransportReceipt>('host-transport', receipt.requestId);
    store.put('host-transport', receipt.requestId, receipt, row?.revision ?? null);
  };
}

/** Startup-only: replay trusted local receipts, never a candidate's claimed usage or a new network call. */
export function reconcileProviderReceipts(store: OperationalStore, ledger: ResourceLedger): number {
  let reconciled = 0;
  for (const row of store.list<TransportReceipt>('host-transport')) {
    const request = ledger.request(row.key);
    if (!request || !['dispatched', 'uncertain'].includes(request.status)) continue;
    const receipt = row.value;
    if (receipt.status === 'reserved' || receipt.status === 'dispatched') continue;
    ledger.settle({ ...request, status: receipt.status, usage: receipt.usage });
    reconciled++;
  }
  return reconciled;
}

export function mistralGateway(options: { apiKey(): string; maxResponseBytes: number; fetch?: typeof fetch }) { return providerGateway({ ...options, provider: 'mistral' }); }
