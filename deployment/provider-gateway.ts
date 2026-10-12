import { invariant, identity, validateScope, type DataScope } from '../packages/contracts/index.ts';
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

/** Keep received provider evidence private, including responses rejected by the shell. */
export function providerResponseRecorder(options: { store: OperationalStore; ledger: Pick<ResourceLedger, 'request'>; runId: string; scope: DataScope; maxBytes: number }) {
  const { store, ledger, runId, maxBytes } = options, scope = structuredClone(options.scope);
  validateScope(scope); invariant(Number.isSafeInteger(maxBytes) && maxBytes > 0, 'Finite response retention bound required');
  return (requestId: string, response: { status: number; body: string }): void => {
    invariant(Number.isSafeInteger(response.status) && response.status >= 100 && response.status <= 599 && typeof response.body === 'string' && Buffer.byteLength(response.body) <= maxBytes, 'Invalid bounded provider response');
    store.transaction(() => {
      const request = ledger.request(requestId);
      invariant(request?.runId === runId && ['dispatched', 'uncertain'].includes(request.status) && ['mistral', 'openai'].includes(request.provider), 'Response lacks dispatched model request');
      const artifact = store.putArtifact(response.body), value = { requestId, runId, scope, httpStatus: response.status, response: artifact };
      const prior = store.get('host.model-responses', requestId);
      invariant(!prior || identity(prior.value) === identity(value), 'Provider response identity changed');
      if (!prior) store.put('host.model-responses', requestId, value, null);
    });
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
    const settled = { ...request, status: receipt.status, usage: receipt.usage };
    if (identity(request) === identity(settled)) continue;
    ledger.settle(settled);
    reconciled++;
  }
  return reconciled;
}

export function mistralGateway(options: { apiKey(): string; maxResponseBytes: number; fetch?: typeof fetch }) { return providerGateway({ ...options, provider: 'mistral' }); }
