import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { identity, type PhysicalRequest } from '../packages/contracts/index.ts';
import { ResourceLedger } from '../packages/runtime/resources/index.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { accountedReview, recoverReviewReservations, reviewPhysicalId } from './evaluation-resources.ts';
import type { EvaluationRequest } from './evolution-tools.ts';

function fixture(maxConcurrency = 3) {
  const directory = mkdtempSync(join(tmpdir(), 'aeon-review-resources-')), filename = join(directory, 'state.sqlite');
  const store = new OperationalStore({ filename }); let now = 0;
  const ledger = new ResourceLedger(store, { tokens: 0, costUsd: 0, elapsedMs: 1000 }, () => now);
  const envelope = { maxRequests: 100, maxTokens: 100, maxCostUsd: 0, maxElapsedMs: 10000, maxConcurrency };
  ledger.allocate('parent', envelope); ledger.allocate('child', envelope, 'parent');
  const authority = { generation: 'author', epoch: 1, controlRevision: 'prior' };
  store.put('runs', 'child', { id: 'child', status: 'running', revision: 0, scope: { kind: 'public' }, authority }, null);
  const request = { requestId: 'stable-job', proposal: { runId: 'child', authority } } as EvaluationRequest;
  const options = { store, request, evaluatorDigest: identity('closure'), evaluatorId: 'qualified-offline-fixture', maxElapsedMs: 1000, assertAuthority: () => {}, now: () => now };
  return { directory, filename, store, ledger, options, setTime: (value: number) => { now = value; }, close: () => { store.close(); rmSync(directory, { recursive: true, force: true }); } };
}
test('canceled/expired reviewer lineage dispatches zero physical operations', async () => {
  for (const cancellation of ['allocation', 'run', 'expiry']) {
    const f = fixture(); let spawns = 0;
    try {
      if (cancellation === 'allocation') f.ledger.cancel('parent');
      if (cancellation === 'run') { const row = f.store.get<any>('runs', 'child')!; f.store.put('runs', 'child', { ...row.value, status: 'cancelled' }, row.revision); }
      if (cancellation === 'expiry') f.setTime(10001);
      await assert.rejects(accountedReview(f.options, async gate => { gate.beforeDispatch(); spawns++; }), /cancelled|expired/);
      assert.equal(spawns, 0); assert.equal(f.ledger.request(reviewPhysicalId('stable-job')), undefined);
    } finally { f.close(); }
  }
});
test('active tool receiver concurrency is retained; reviewer cannot silently borrow a slot', async () => {
  const f = fixture(1); let spawns = 0;
  try {
    const effect: PhysicalRequest = { id: 'tool:wait', runId: 'child', purpose: 'reasoning', provider: 'effect-receiver', model: 'candidate_evaluate', promptManifestId: 'tool:wait', requestDigest: identity('wait'), reservationId: 'tool:wait', status: 'reserved', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } };
    f.ledger.reserve(effect); f.ledger.dispatched({ ...effect, status: 'dispatched' });
    await assert.rejects(accountedReview(f.options, async gate => { gate.beforeDispatch(); spawns++; }), /budget exhausted|allocation exhausted/);
    assert.equal(spawns, 0); assert.equal(f.ledger.request(effect.id)!.status, 'dispatched');
  } finally { f.close(); }
});
test('last-moment cancellation before launch is known undispatched; successful physical usage is measured', async () => {
  const f = fixture(); let spawns = 0;
  try {
    await assert.rejects(accountedReview(f.options, async gate => { f.ledger.cancel('child'); gate.beforeDispatch(); spawns++; }), /cancelled/);
    assert.equal(spawns, 0); assert.equal(f.ledger.request(reviewPhysicalId('stable-job'))!.status, 'failed');
    assert.equal(f.ledger.snapshot('parent').elapsedMs, 0);
  } finally { f.close(); }
  const success = fixture();
  try {
    assert.equal(await accountedReview(success.options, async gate => { gate.beforeDispatch(); success.setTime(17); return 'signed result'; }), 'signed result');
    const physical = success.ledger.request(reviewPhysicalId('stable-job'))!;
    assert.equal(physical.purpose, 'review'); assert.equal(physical.status, 'succeeded'); assert.equal(physical.usage.elapsedMs, 17);
    assert.equal(success.ledger.snapshot('parent').requests, 1); assert.equal(success.ledger.snapshot('parent').concurrent, 0);
  } finally { success.close(); }
});
test('cancel during asynchronous physical review aborts it and retains unknown charged concurrency', async () => {
  const f = fixture(); let spawns = 0;
  try {
    const reviewing = accountedReview(f.options, async gate => {
      gate.beforeDispatch(); spawns++;
      return await new Promise<void>((_accept, reject) => { gate.signal.addEventListener('abort', () => reject(gate.signal.reason), { once: true }); });
    });
    setTimeout(() => f.ledger.cancel('parent'), 5);
    await assert.rejects(reviewing, /cancelled/);
    assert.equal(spawns, 1); const physical = f.ledger.request(reviewPhysicalId('stable-job'))!;
    assert.equal(physical.status, 'uncertain'); assert.equal(physical.usage.elapsedMs, 1000);
    assert.equal(f.ledger.snapshot('parent').concurrent, 1);
    recoverReviewReservations(f.store); assert.equal(f.ledger.request(physical.id)!.status, 'uncertain');
  } finally { f.close(); }
});
test('reopened reserved/dispatched review records become failed/uncertain without replay or free usage', () => {
  const f = fixture();
  try {
    const base: PhysicalRequest = { id: reviewPhysicalId('reserved'), runId: 'child', purpose: 'review', provider: 'external-offline-review', model: 'fixture', promptManifestId: 'closure', requestDigest: identity('review'), reservationId: reviewPhysicalId('reserved'), status: 'reserved', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 1000 } };
    f.ledger.reserve(base); const dispatched = { ...base, id: reviewPhysicalId('dispatched'), reservationId: reviewPhysicalId('dispatched') };
    f.ledger.reserve(dispatched); f.ledger.dispatched({ ...dispatched, status: 'dispatched' });
    const reopened = new OperationalStore({ filename: f.filename });
    try {
      recoverReviewReservations(reopened); const ledger = new ResourceLedger(reopened, { tokens: 0, costUsd: 0, elapsedMs: 1000 }, () => 0);
      assert.equal(ledger.request(base.id)!.status, 'failed'); assert.equal(ledger.request(dispatched.id)!.status, 'uncertain');
      assert.equal(ledger.snapshot('parent').elapsedMs, 1000); assert.equal(ledger.snapshot('parent').concurrent, 1);
      assert.throws(() => ledger.reserve(dispatched), /already used/);
    } finally { reopened.close(); }
  } finally { f.close(); }
});
