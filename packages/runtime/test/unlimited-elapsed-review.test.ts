import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { identity, type PhysicalRequest, type ResourceEnvelope } from '../../contracts/index.ts';
import { OperationalStore } from '../../storage/index.ts';
import { BudgetExceeded, CapacityUnavailable, ResourceLedger, type AllowanceAmendment } from '../resources/index.ts';

const host = { authority: { generation: 'review', epoch: 1, controlRevision: 'prior-controls' }, assertAuthority() {} };
const original: ResourceEnvelope = { maxTokens: 1, maxCostUsd: 1, maxRequests: 1, maxElapsedMs: 10, maxConcurrency: 1 };
const policy: AllowanceAmendment = { id: 'review-unlimited', authorizationRef: 'explicit-user-removal', rootId: 'root', expectedEnvelopeDigest: identity(original),
  cumulativeTokenLimit: null, cumulativeCostLimit: null, cumulativeRequestLimit: null, cumulativeElapsedLimit: null,
  scope: 'root-and-descendants', descendantCostLimit: 'root' };
function physical(id: string): PhysicalRequest {
  return { id, runId: 'child', purpose: 'reasoning', provider: 'offline-review-fixture', model: 'fixture', promptManifestId: 'fixture', requestDigest: identity(id), reservationId: id,
    status: 'reserved', usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 } };
}
function fixture(t: test.TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'unlimited-heldout-')), filename = join(directory, 'state.sqlite');
  let now = 0, store = new OperationalStore({ filename }), ledger = new ResourceLedger(store, { tokens: 5, costUsd: 5, elapsedMs: 5 }, () => now);
  ledger.allocate('root', original); ledger.allocate('child', { ...original, maxElapsedMs: 2 }, 'root');
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { get store() { return store; }, get ledger() { return ledger; }, time(value: number) { now = value; },
    reopen() { store.close(); store = new OperationalStore({ filename }); ledger = new ResourceLedger(store, { tokens: 5, costUsd: 5, elapsedMs: 5 }, () => now); } };
}

test('expired original root and child can reserve and dispatch only after a fresh accepted unlimited binding', t => {
  const f = fixture(t); f.time(1_000_000);
  assert.throws(() => f.ledger.reserve(physical('before-policy')), BudgetExceeded);
  const allocations = f.store.list('allocations'), budgets = f.store.list('budgets');
  f.ledger.applyAllowanceAmendment(policy, host);
  assert.deepEqual(f.store.list('allocations'), allocations); assert.deepEqual(f.store.list('budgets'), budgets);
  assert.equal(f.ledger.effectiveEnvelope('root').maxElapsedMs, null); assert.equal(f.ledger.effectiveEnvelope('child').maxElapsedMs, null);
  f.ledger.reserve(physical('reserved'));
  const request = f.store.get('requests', 'reserved'), history = f.store.list('resource.allowance-amendments');
  f.time(2_000_000); f.reopen();
  assert.throws(() => f.ledger.dispatched({ ...physical('reserved'), status: 'dispatched' }), BudgetExceeded);
  assert.deepEqual(f.store.get('requests', 'reserved'), request);
  f.ledger.applyAllowanceAmendment(policy, host);
  f.ledger.dispatched({ ...physical('reserved'), status: 'dispatched' });
  assert.deepEqual(f.store.list('resource.allowance-amendments'), history);
  assert.ok(f.ledger.snapshot('root').elapsedMs >= 2_000_000);
  assert.equal(f.store.get<{ startedAt: number }>('allocations', 'root')!.value.startedAt, 0);
});

test('unlimited estimate overrun preserves uncertainty and capacity until trusted cleanup without cancelling the root', t => {
  const f = fixture(t); f.ledger.applyAllowanceAmendment(policy, host);
  const request = physical('unknown'); f.ledger.reserve(request); f.ledger.dispatched({ ...request, status: 'dispatched' });
  f.ledger.settle({ ...request, status: 'uncertain', usage: { ...request.usage, elapsedMs: 5.125 } });
  assert.equal(f.ledger.snapshot('root').cancelled, false); assert.equal(f.ledger.snapshot('root').elapsedMs, 5.125);
  assert.equal(f.ledger.snapshot('root').tokens, 5); assert.equal(f.ledger.snapshot('root').costUsd, 5);
  assert.throws(() => f.ledger.reserve(physical('while-unknown')), CapacityUnavailable);
  const retained = f.store.get('requests', 'unknown');
  f.ledger.releaseConcurrency('unknown', { kind: 'host-recovery', reason: 'Exclusive fixture host confirmed no old transport exists' });
  assert.deepEqual(f.store.get('requests', 'unknown'), retained);
  f.ledger.reserve(physical('after-cleanup'));
});

for (const dimension of ['tokens', 'costUsd', 'elapsedMs'] as const) test(`full unlimited policy retains measured ${dimension} estimate overrun and admits later work`, t => {
  const f = fixture(t); f.ledger.applyAllowanceAmendment(policy, host);
  const request = physical('measured'); f.ledger.reserve(request); f.ledger.dispatched({ ...request, status: 'dispatched' });
  f.ledger.settle({ ...request, status: 'succeeded', usage: { requests: 1, inputTokens: dimension === 'tokens' ? 8 : 1, outputTokens: 0,
    costUsd: dimension === 'costUsd' ? 8 : 1, elapsedMs: dimension === 'elapsedMs' ? 8 : 1 } });
  assert.equal(f.ledger.snapshot('root')[dimension], 8); assert.equal(f.ledger.snapshot('root').cancelled, false);
  f.ledger.reserve(physical('later'));
});

test('explicit descendant and root cancellation remain authoritative after unlimited binding and rebinding', t => {
  for (const target of ['child', 'root']) {
    const f = fixture(t); f.ledger.applyAllowanceAmendment(policy, host); f.ledger.cancel(target); f.reopen();
    f.ledger.applyAllowanceAmendment(policy, host);
    assert.equal(f.ledger.snapshot('child').cancelled, true);
    assert.throws(() => f.ledger.reserve(physical('cancelled')), BudgetExceeded);
  }
});

test('legacy null cost/token/request policy still enforces elapsed and physical estimate overruns', t => {
  const f = fixture(t), { cumulativeElapsedLimit: _, ...legacy } = policy;
  f.ledger.applyAllowanceAmendment({ ...legacy, id: 'legacy' }, host);
  assert.throws(() => f.ledger.reserve(physical('too-long')), BudgetExceeded);
  const ledger = new ResourceLedger(f.store, { tokens: 1, costUsd: 1, elapsedMs: 1 }, () => 0);
  ledger.applyAllowanceAmendment({ ...legacy, id: 'legacy' }, host);
  const request = physical('legacy-overrun'); ledger.reserve(request); ledger.dispatched({ ...request, status: 'dispatched' });
  ledger.settle({ ...request, status: 'succeeded', usage: { requests: 1, inputTokens: 2, outputTokens: 0, costUsd: 1, elapsedMs: 1 } });
  assert.equal(ledger.snapshot('root').cancelled, true); assert.equal(ledger.snapshot('root').tokens, 2);
  assert.throws(() => ledger.reserve(physical('legacy-after-overrun')), BudgetExceeded);
});
