import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { PassThrough, Writable } from 'node:stream';
import { OperationalStore } from '../packages/storage/index.ts';
import { ResourceLedger } from '../packages/runtime/resources/index.ts';
import type { PhysicalRequest } from '../packages/contracts/index.ts';
import { mistralGateway, providerGateway, reconcileProviderReceipts, transportRecorder } from './provider-gateway.ts';

test('gateway pins destination, supplies credentials only to fetch and bounds response streaming', async () => {
  const gateway = mistralGateway({ apiKey: () => 'private-fixture-key', maxResponseBytes: 10,
    fetch: async (url, init) => {
      assert.equal(url, 'https://api.mistral.ai/v1/chat/completions');
      assert.equal(init?.redirect, 'error');
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer private-fixture-key');
      return new Response('01234567890');
    } });
  await assert.rejects(gateway('{}', new AbortController().signal), /byte ceiling/);
});

test('production gateway uses injected HTTPS with pinned endpoints and bounded byte cleanup', async () => {
  for (const provider of ['mistral', 'openai'] as const) {
    for (const ceiling of [3, 4]) {
      const stream = new PassThrough(), incoming = stream as unknown as IncomingMessage;
      incoming.statusCode = 429;
      let dispatched = 0;
      const controller = new AbortController();
      const gateway = providerGateway({ provider, apiKey: () => 'private-fixture-key', maxResponseBytes: ceiling,
        request: (url, options, receive) => {
          dispatched++;
          assert.equal(url.href, provider === 'openai' ? 'https://api.openai.com/v1/responses' : 'https://api.mistral.ai/v1/chat/completions');
          assert.equal(options.headers && (options.headers as Record<string, string>).Authorization, 'Bearer private-fixture-key');
          assert.equal(options.agent, false); assert.equal(options.timeout, undefined);
          assert.equal(options.rejectUnauthorized, true);
          const outgoing = new Writable({ write(chunk, _encoding, done) { assert.equal(chunk.toString(), '{}'); done(); } });
          outgoing.once('finish', () => { receive(incoming); stream.end('éé'); });
          return outgoing as unknown as ClientRequest;
        } });
      if (ceiling === 3) await assert.rejects(gateway('{}', controller.signal), /byte ceiling/);
      else assert.deepEqual(await gateway('{}', controller.signal), { status: 429, body: 'éé' });
      assert.equal(dispatched, 1); assert.equal(incoming.destroyed, true);
    }
  }
});

test('a provider receipt settles after restart without repeating the physical request', () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-provider-receipt-'));
  let store = new OperationalStore({ filename: join(root, 'state.sqlite') });
  try {
    let ledger = new ResourceLedger(store, { tokens: 100, costUsd: 1, elapsedMs: 1000 });
    ledger.allocate('run', { maxRequests: 4, maxTokens: 400, maxCostUsd: 4, maxElapsedMs: 10000, maxConcurrency: 2 });
    const request: PhysicalRequest = { id: 'physical-request', runId: 'run', purpose: 'reasoning', provider: 'mistral', model: 'fixture',
      promptManifestId: 'prompt', requestDigest: '1'.repeat(64), reservationId: 'reservation', status: 'reserved',
      usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 } };
    ledger.reserve(request); ledger.dispatched({ ...request, status: 'dispatched' });
    transportRecorder(store)({ requestId: request.id, dispatched: true, status: 'succeeded', httpStatus: 200,
      responseModel: 'fixture', responseDigest: '2'.repeat(64), usage: { requests: 1, inputTokens: 10, outputTokens: 4, costUsd: 0.05, elapsedMs: 10 } });
    store.close(); store = new OperationalStore({ filename: join(root, 'state.sqlite') });
    ledger = new ResourceLedger(store, { tokens: 100, costUsd: 1, elapsedMs: 1000 });
    ledger.recoverDispatched();
    assert.equal(reconcileProviderReceipts(store, ledger), 1);
    assert.equal(ledger.snapshot('run').tokens, 14);
    assert.equal(ledger.snapshot('run').costUsd, 0.05);
    assert.equal(reconcileProviderReceipts(store, ledger), 0);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('an identical uncertain timeout receipt is idempotent while a changed receipt still settles', () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-provider-uncertain-'));
  const store = new OperationalStore({ filename: join(root, 'state.sqlite') });
  try {
    const ledger = new ResourceLedger(store, { tokens: 100, costUsd: 1, elapsedMs: 1000 });
    ledger.allocate('run', { maxRequests: 4, maxTokens: 400, maxCostUsd: 4, maxElapsedMs: 10000, maxConcurrency: 2 });
    const request: PhysicalRequest = { id: 'timeout', runId: 'run', purpose: 'reasoning', provider: 'mistral', model: 'fixture', promptManifestId: 'prompt', requestDigest: '1'.repeat(64), reservationId: 'timeout', status: 'reserved', usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 } };
    ledger.reserve(request); ledger.dispatched({ ...request, status: 'dispatched' });
    const receipt = { requestId: request.id, dispatched: true, status: 'uncertain' as const, httpStatus: null, responseModel: null, responseDigest: null, usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 1008 } };
    transportRecorder(store)(receipt);
    assert.equal(reconcileProviderReceipts(store, ledger), 1);
    const before = ['requests','budgets'].map(namespace => store.list(namespace));
    assert.equal(reconcileProviderReceipts(store, ledger), 0);
    assert.deepEqual(['requests','budgets'].map(namespace => store.list(namespace)), before);
    transportRecorder(store)({ ...receipt, usage: { ...receipt.usage, elapsedMs: 1009 } });
    assert.equal(reconcileProviderReceipts(store, ledger), 1);
    assert.equal(ledger.request(request.id)!.usage.elapsedMs, 1009);
    assert.equal(ledger.snapshot('run').cancelled, true);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
