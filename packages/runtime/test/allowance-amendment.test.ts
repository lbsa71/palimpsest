import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { identity, type ResourceEnvelope } from '../../contracts/common.ts';
import type { PhysicalRequest } from '../../contracts/control/index.ts';
import { OperationalStore } from '../../storage/index.ts';
import { BudgetExceeded, ResourceLedger, validateAllowanceAmendment, type AllowanceAmendment, type RequestCeiling } from '../resources/index.ts';

const envelope: ResourceEnvelope = { maxRequests: 20, maxTokens: 160, maxCostUsd: 5, maxElapsedMs: 1000, maxConcurrency: 8 };
const host = { authority: { generation: 'accepted', epoch: 1, controlRevision: 'incumbent-reviewed' }, assertAuthority: () => {} };
function request(id: string, runId = 'child', costUsd: number | null = null): PhysicalRequest {
  return { id, runId, purpose: 'reasoning', provider: 'fixture', model: 'fixture', promptManifestId: 'p', requestDigest: identity(id), reservationId: id, status: 'reserved', usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd, elapsedMs: 0 } };
}
function fixture(t: test.TestContext, root: Partial<ResourceEnvelope> = {}, child: Partial<ResourceEnvelope> = {}, ceiling: RequestCeiling = { tokens: 40, costUsd: 0.5, elapsedMs: 1 }) {
  const directory = mkdtempSync(join(tmpdir(), 'aeon-amendment-')), filename = join(directory, 'state.sqlite');
  let now = 0, store = new OperationalStore({ filename });
  let ledger = new ResourceLedger(store, ceiling, () => now);
  const rootEnvelope = { ...envelope, ...root };
  ledger.allocate('root', rootEnvelope);
  ledger.allocate('child', { ...envelope, maxCostUsd: 1.25, maxConcurrency: 4, ...child }, 'root');
  const amendment: AllowanceAmendment = { id: 'pilot-10', authorizationRef: 'user-keeps-five-total', rootId: 'root', expectedEnvelopeDigest: identity(rootEnvelope), cumulativeTokenLimit: null, scope: 'root-and-descendants', descendantCostLimit: 'root' };
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { get store() { return store; }, get ledger() { return ledger; }, amendment,
    setNow(value: number) { now = value; },
    reopen() { store.close(); store = new OperationalStore({ filename }); ledger = new ResourceLedger(store, ceiling, () => now); },
    settle(r: PhysicalRequest, status: 'succeeded' | 'uncertain' = 'succeeded') { ledger.reserve(r); ledger.dispatched({ ...r, status: 'dispatched' }); ledger.settle({ ...r, status }); },
  };
}

test('explicit amendment lifts root and descendant token limits while retaining unknown charges and original allocations', t => {
  const f = fixture(t, {}, { maxCostUsd: 5 });
  for (let i = 0; i < 4; i++) f.settle(request(`unknown-${i}`, 'root'), 'uncertain');
  assert.throws(() => f.ledger.reserve(request('coding')), BudgetExceeded);
  const before = ['allocations', 'budgets', 'requests'].map(namespace => f.store.list(namespace));
  let checked = 0;
  f.ledger.applyAllowanceAmendment(f.amendment, { ...host, assertAuthority() { checked++; } });
  assert.equal(checked, 1);
  assert.deepEqual(['allocations', 'budgets', 'requests'].map(namespace => f.store.list(namespace)), before);
  assert.equal(f.ledger.effectiveEnvelope('root').maxTokens, null);
  assert.equal(f.ledger.effectiveEnvelope('child').maxTokens, null);
  f.ledger.reserve(request('coding'));
  assert.equal(f.ledger.snapshot('child').tokens, 200);
  assert.equal(f.ledger.snapshot('root').costUsd, 2.5);
  assert.equal(f.store.list<{ request: PhysicalRequest }>('requests').filter(row => row.value.request.status === 'uncertain').length, 4);
});

test('a descendant token limit is independently lifted and future descendants inherit only the effective policy', t => {
  const f = fixture(t, { maxTokens: 1000 }, { maxTokens: 40 });
  f.settle(request('first'));
  assert.throws(() => f.ledger.reserve(request('second')), /bounded allocation exhausted/);
  f.ledger.applyAllowanceAmendment(f.amendment, host);
  f.settle(request('second'));
  f.ledger.allocate('grandchild', { ...envelope, maxTokens: 0, maxCostUsd: 0 }, 'child');
  assert.equal(f.ledger.effectiveEnvelope('grandchild').maxTokens, null);
  assert.equal(f.ledger.effectiveEnvelope('grandchild').maxCostUsd, 5);
  f.ledger.reserve(request('grandchild-work', 'grandchild'));
  f.ledger.allocate('other-root', { ...envelope, maxTokens: 0 });
  assert.throws(() => f.ledger.reserve(request('unamended', 'other-root')), BudgetExceeded);
});

test('conversation spending shares the original five-dollar cap without resetting accumulated cost', t => {
  const f = fixture(t);
  assert.throws(() => f.ledger.reserve(request('coding', 'child', 2)), /bounded allocation exhausted/);
  f.ledger.applyAllowanceAmendment(f.amendment, host);
  f.settle(request('coding', 'child', 2));
  f.ledger.allocate('sibling', { ...envelope, maxCostUsd: 1.25 }, 'root');
  f.settle(request('sibling-work', 'sibling', 3));
  assert.equal(f.ledger.snapshot('root').costUsd, 5);
  assert.throws(() => f.ledger.reserve(request('over-five', 'child', 0.01)), BudgetExceeded);
});

for (const level of ['root', 'child'] as const) {
  test(`${level} request and concurrency limits survive the amendment`, t => {
    const requestLimited = fixture(t, level === 'root' ? { maxRequests: 1 } : {}, level === 'child' ? { maxRequests: 1 } : {});
    requestLimited.ledger.applyAllowanceAmendment(requestLimited.amendment, host);
    requestLimited.settle(request('first'));
    assert.throws(() => requestLimited.ledger.reserve(request('second')), BudgetExceeded);
    const concurrent = fixture(t, level === 'root' ? { maxConcurrency: 1 } : {}, level === 'child' ? { maxConcurrency: 1 } : {});
    concurrent.ledger.applyAllowanceAmendment(concurrent.amendment, host);
    concurrent.ledger.reserve(request('first'));
    assert.throws(() => concurrent.ledger.reserve(request('second')), BudgetExceeded);
  });
  test(`${level} elapsed deadline survives amendment at reservation and dispatch`, t => {
    const f = fixture(t, level === 'root' ? { maxElapsedMs: 10 } : {}, level === 'child' ? { maxElapsedMs: 10 } : {});
    f.ledger.reserve(request('reserved'));
    f.ledger.applyAllowanceAmendment(f.amendment, host);
    f.setNow(11);
    assert.throws(() => f.ledger.dispatched({ ...request('reserved'), status: 'dispatched' }), BudgetExceeded);
    assert.throws(() => f.ledger.reserve(request('late')), BudgetExceeded);
  });
}

test('amendment history is immutable and idempotent; reopen requires an explicit trusted binding', t => {
  const f = fixture(t, {}, { maxTokens: 0 });
  f.ledger.applyAllowanceAmendment(f.amendment, host);
  const history = f.store.list('resource.allowance-amendments'), events = f.store.events('root');
  f.ledger.applyAllowanceAmendment(f.amendment, { ...host, authority: { ...host.authority, epoch: 2 } });
  assert.deepEqual(f.store.list('resource.allowance-amendments'), history);
  assert.deepEqual(f.store.events('root'), events);
  assert.throws(() => f.ledger.applyAllowanceAmendment({ ...f.amendment, authorizationRef: 'changed' }, host), /identity changed/);
  f.reopen();
  assert.equal(f.ledger.effectiveEnvelope('root').maxTokens, 160);
  assert.throws(() => f.ledger.reserve(request('unbound')), BudgetExceeded);
  assert.throws(() => f.ledger.applyAllowanceAmendment(f.amendment, { ...host, assertAuthority() { throw Error('authority withdrawn'); } }), /authority withdrawn/);
  assert.equal(f.ledger.effectiveEnvelope('root').maxTokens, 160);
  f.ledger.applyAllowanceAmendment(f.amendment, host);
  f.ledger.reserve(request('bound'));
  assert.deepEqual(f.store.list('resource.allowance-amendments'), history);
});

test('wrong envelope, invalid policy and withdrawn authority cannot create or bind an amendment', t => {
  const f = fixture(t);
  assert.throws(() => f.ledger.applyAllowanceAmendment({ ...f.amendment, expectedEnvelopeDigest: identity('wrong') }, host), /envelope changed/);
  assert.throws(() => f.ledger.applyAllowanceAmendment({ ...f.amendment, cumulativeTokenLimit: 0 } as unknown as AllowanceAmendment, host), /Invalid allowance amendment/);
  assert.throws(() => f.ledger.applyAllowanceAmendment(f.amendment, { ...host, assertAuthority() { throw Error('authority withdrawn'); } }), /authority withdrawn/);
  assert.equal(f.store.list('resource.allowance-amendments').length, 0);
  assert.equal(f.store.events('root').length, 0);
  assert.deepEqual(f.ledger.effectiveEnvelope('root'), envelope);
});

test('an enclosing transaction rollback cannot leave effective allowance without its durable audit', t => {
  const f = fixture(t);
  assert.throws(() => f.store.transaction(() => {
    f.ledger.applyAllowanceAmendment(f.amendment, host);
    throw Error('host operation rolled back');
  }), /host operation rolled back/);
  assert.equal(f.store.list('resource.allowance-amendments').length, 0);
  assert.equal(f.store.events('root').length, 0);
  assert.throws(() => f.ledger.effectiveEnvelope('root'), /history unavailable/);
  assert.throws(() => f.ledger.reserve(request('unrecorded')), /history unavailable/);
  f.ledger.applyAllowanceAmendment(f.amendment, host);
  f.ledger.reserve(request('recorded'));
});

test('cancellation and physical over-ceiling usage still stop work under an amendment', t => {
  const f = fixture(t);
  f.ledger.cancel('child');
  f.ledger.applyAllowanceAmendment(f.amendment, host);
  assert.equal(f.ledger.snapshot('child').cancelled, true);
  assert.throws(() => f.ledger.reserve(request('cancelled')), BudgetExceeded);
  const r = request('physical-overrun', 'root');
  f.ledger.reserve(r); f.ledger.dispatched({ ...r, status: 'dispatched' });
  f.ledger.settle({ ...r, status: 'succeeded', usage: { requests: 1, inputTokens: 41, outputTokens: 0, costUsd: 0.5, elapsedMs: 1 } });
  assert.equal(f.ledger.snapshot('root').tokens, 41);
  assert.equal(f.ledger.snapshot('root').cancelled, true);
  assert.throws(() => f.ledger.reserve(request('after-overrun', 'root')), BudgetExceeded);
});

test('explicit request sharing admits the retained conversation after 64 requests and still exhausts at 256 across descendants', t => {
  const f = fixture(t, { maxRequests: 256 }, { maxRequests: 64 });
  f.ledger.applyAllowanceAmendment(f.amendment, host);
  let providerCalls = 0;
  function perform(id: string, runId = 'child') {
    const r = { ...request(id, runId, 0), usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } };
    f.ledger.reserve(r);
    providerCalls++;
    f.ledger.dispatched({ ...r, status: 'dispatched' });
    f.ledger.settle({ ...r, status: 'succeeded' });
  }
  for (let i = 0; i < 64; i++) perform(`retained-${i}`);
  assert.throws(() => perform('coding-65'), /bounded allocation exhausted/);
  assert.equal(providerCalls, 64);
  const originalRows = ['allocations', 'budgets', 'requests'].map(namespace => f.store.list(namespace));
  const oldHistory = f.store.get('resource.allowance-amendments', f.amendment.id);
  const shared = { ...f.amendment, id: 'pilot-10-shared-requests', descendantRequestLimit: 'root' } as AllowanceAmendment;
  f.ledger.applyAllowanceAmendment(shared, host);
  assert.deepEqual(['allocations', 'budgets', 'requests'].map(namespace => f.store.list(namespace)), originalRows);
  assert.deepEqual(f.store.get('resource.allowance-amendments', f.amendment.id), oldHistory);
  assert.deepEqual(f.ledger.effectiveEnvelope('child'), { ...envelope, maxRequests: 256, maxTokens: null, maxConcurrency: 4 });
  perform('coding-65');
  for (let i = 0; i < 3; i++) f.ledger.allocate(`sibling-${i}`, { ...envelope, maxRequests: 64 }, 'root');
  f.ledger.allocate('grandchild', { ...envelope, maxRequests: 1 }, 'child');
  const descendants = ['sibling-0', 'sibling-1', 'sibling-2', 'grandchild'];
  for (let i = 65; i < 256; i++) perform(`shared-${i}`, descendants[i % descendants.length]);
  assert.equal(providerCalls, 256);
  assert.equal(f.ledger.snapshot('root').requests, 256);
  for (const runId of ['root', 'child', ...descendants]) assert.throws(() => perform(`over-root-${runId}`, runId), /shared physical request budget exhausted/);
  assert.equal(providerCalls, 256);
  assert.equal(f.ledger.snapshot('root').requests, 256);
  assert.deepEqual(f.store.get('resource.allowance-amendments', f.amendment.id), oldHistory);
});

test('optional request sharing requires valid explicit policy, a distinct immutable ID and trusted rebinding after reopen', t => {
  const f = fixture(t, {}, { maxRequests: 1 });
  validateAllowanceAmendment(f.amendment);
  for (const value of [undefined, null, 'unlimited']) {
    assert.throws(() => validateAllowanceAmendment({ ...f.amendment, descendantRequestLimit: value } as unknown as AllowanceAmendment), /Invalid allowance amendment/);
  }
  f.ledger.applyAllowanceAmendment(f.amendment, host);
  f.settle(request('original'));
  assert.throws(() => f.ledger.applyAllowanceAmendment({ ...f.amendment, descendantRequestLimit: 'root' } as AllowanceAmendment, host), /identity changed/);
  assert.equal(f.ledger.effectiveEnvelope('child').maxRequests, 1);
  const shared = { ...f.amendment, id: 'shared-requests', descendantRequestLimit: 'root' } as AllowanceAmendment;
  validateAllowanceAmendment(shared);
  f.ledger.applyAllowanceAmendment(shared, host);
  const history = f.store.list('resource.allowance-amendments'), events = f.store.events('root');
  f.ledger.applyAllowanceAmendment(shared, host);
  assert.deepEqual(f.store.list('resource.allowance-amendments'), history);
  assert.deepEqual(f.store.events('root'), events);
  f.reopen();
  assert.equal(f.ledger.effectiveEnvelope('child').maxRequests, 1);
  assert.throws(() => f.ledger.reserve(request('unbound')), BudgetExceeded);
  f.ledger.applyAllowanceAmendment(f.amendment, host);
  assert.equal(f.ledger.effectiveEnvelope('child').maxRequests, 1);
  assert.throws(() => f.ledger.reserve(request('old-policy')), BudgetExceeded);
  f.ledger.applyAllowanceAmendment(shared, host);
  f.ledger.reserve(request('bound'));
  assert.equal(f.ledger.snapshot('root').requests, 2);
  assert.deepEqual(f.store.list('resource.allowance-amendments'), history);
});

function uncapped(amendment: AllowanceAmendment): AllowanceAmendment {
  return { ...amendment, id: 'pilot-11', authorizationRef: 'user-disables-local-cumulative-caps', cumulativeCostLimit: null, cumulativeRequestLimit: null };
}

test('explicit null caps admit beyond retained root usage and future descendants without rewriting history', t => {
  const f = fixture(t, { maxRequests: 1, maxTokens: 40, maxCostUsd: 0.5 }, { maxRequests: 1, maxTokens: 40, maxCostUsd: 0.5 });
  f.settle(request('original-unknown'), 'uncertain');
  assert.throws(() => f.ledger.reserve(request('next')), BudgetExceeded);
  f.ledger.applyAllowanceAmendment(f.amendment, host);
  assert.throws(() => f.ledger.reserve(request('next')), BudgetExceeded);
  const original = ['allocations', 'budgets', 'requests'].map(namespace => f.store.list(namespace));
  const originalUnknown = f.store.get('requests', 'original-unknown');
  const oldHistory = f.store.get('resource.allowance-amendments', f.amendment.id), oldEvents = f.store.events('root');
  const policy = uncapped(f.amendment);
  f.ledger.applyAllowanceAmendment(policy, host);
  assert.deepEqual(['allocations', 'budgets', 'requests'].map(namespace => f.store.list(namespace)), original);
  assert.deepEqual(f.store.get('resource.allowance-amendments', f.amendment.id), oldHistory);
  assert.deepEqual(f.store.events('root').slice(0, oldEvents.length), oldEvents);
  for (const runId of ['root', 'child']) {
    const effective = f.ledger.effectiveEnvelope(runId);
    assert.equal(effective.maxRequests, null);
    assert.equal(effective.maxTokens, null);
    assert.equal(effective.maxCostUsd, null);
    effective.maxCostUsd = 0;
    assert.equal(f.ledger.effectiveEnvelope(runId).maxCostUsd, null);
  }
  f.settle(request('next'));
  f.ledger.allocate('grandchild', { ...envelope, maxRequests: 0, maxTokens: 0, maxCostUsd: 0 }, 'child');
  f.settle(request('future-work', 'grandchild'));
  f.settle(request('root-work', 'root'));
  assert.deepEqual(f.ledger.snapshot('root'), { requests: 4, tokens: 160, costUsd: 2, elapsedMs: 1, concurrent: 1, cancelled: false });
  assert.deepEqual(f.store.get('requests', 'original-unknown'), originalUnknown);
  assert.deepEqual(f.store.get('resource.allowance-amendments', f.amendment.id), oldHistory);
  f.ledger.allocate('unamended-root', { ...envelope, maxRequests: 0, maxTokens: 0, maxCostUsd: 0 });
  assert.throws(() => f.ledger.reserve(request('separate-work', 'unamended-root')), BudgetExceeded);
});

test('cost and request nulls are independent and omission retains the other cumulative cap', t => {
  const cost = fixture(t, { maxRequests: 2, maxCostUsd: 0.5 });
  cost.settle(request('first', 'root'));
  cost.ledger.applyAllowanceAmendment(cost.amendment, host);
  assert.throws(() => cost.ledger.reserve(request('second', 'root')), BudgetExceeded);
  cost.ledger.applyAllowanceAmendment({ ...cost.amendment, id: 'cost-only', cumulativeCostLimit: null }, host);
  assert.equal(cost.ledger.effectiveEnvelope('root').maxRequests, 2);
  cost.settle(request('second', 'root'));
  assert.throws(() => cost.ledger.reserve(request('third', 'root')), BudgetExceeded);

  const count = fixture(t, { maxRequests: 1, maxCostUsd: 1 });
  count.settle(request('first', 'root'));
  count.ledger.applyAllowanceAmendment(count.amendment, host);
  assert.throws(() => count.ledger.reserve(request('second', 'root')), BudgetExceeded);
  count.ledger.applyAllowanceAmendment({ ...count.amendment, id: 'requests-only', cumulativeRequestLimit: null }, host);
  assert.equal(count.ledger.effectiveEnvelope('root').maxCostUsd, 1);
  count.settle(request('second', 'root'));
  assert.throws(() => count.ledger.reserve(request('third', 'root')), BudgetExceeded);
});

test('explicit null request policy overrides descendant sharing and descendant caps', t => {
  const f = fixture(t, { maxRequests: 20 }, { maxRequests: 1 });
  f.ledger.applyAllowanceAmendment(f.amendment, host);
  f.settle(request('original'));
  assert.throws(() => f.ledger.reserve(request('next')), /bounded allocation exhausted/);
  f.ledger.applyAllowanceAmendment({ ...uncapped(f.amendment), descendantRequestLimit: 'root' }, host);
  f.settle(request('next'));
  assert.equal(f.ledger.effectiveEnvelope('child').maxRequests, null);
  assert.equal(f.ledger.snapshot('root').requests, 2);
});

test('uncapped history requires trusted rebinding and cannot change a prior amendment identity', t => {
  const f = fixture(t, { maxRequests: 1, maxCostUsd: 0.5 });
  f.settle(request('unknown', 'root'), 'uncertain');
  f.ledger.applyAllowanceAmendment(f.amendment, host);
  assert.throws(() => f.ledger.applyAllowanceAmendment({ ...uncapped(f.amendment), id: f.amendment.id }, host), /identity changed/);
  const policy = uncapped(f.amendment);
  let checked = 0;
  const acceptedHost = { ...host, assertAuthority() { checked++; } };
  f.ledger.applyAllowanceAmendment(policy, acceptedHost);
  const history = f.store.list('resource.allowance-amendments'), events = f.store.events('root');
  f.ledger.applyAllowanceAmendment(policy, acceptedHost);
  assert.equal(checked, 2);
  assert.deepEqual(f.store.list('resource.allowance-amendments'), history);
  assert.deepEqual(f.store.events('root'), events);
  f.reopen();
  assert.equal(f.ledger.effectiveEnvelope('root').maxCostUsd, 0.5);
  assert.equal(f.ledger.effectiveEnvelope('root').maxRequests, 1);
  assert.throws(() => f.ledger.reserve(request('unbound', 'root')), BudgetExceeded);
  assert.throws(() => f.ledger.applyAllowanceAmendment(policy, { ...host, assertAuthority() { throw Error('authority withdrawn'); } }), /authority withdrawn/);
  assert.throws(() => f.ledger.reserve(request('withdrawn', 'root')), BudgetExceeded);
  assert.throws(() => f.ledger.applyAllowanceAmendment(policy, { ...host, assertAuthority: (() => Promise.resolve()) as unknown as () => void }), /must be synchronous/);
  f.ledger.applyAllowanceAmendment(f.amendment, host);
  assert.throws(() => f.ledger.reserve(request('old-policy', 'root')), BudgetExceeded);
  f.ledger.applyAllowanceAmendment(policy, host);
  f.ledger.reserve(request('rebound', 'root'));
  assert.deepEqual(f.store.list('resource.allowance-amendments'), history);
  assert.deepEqual(f.store.events('root'), events);
  assert.equal(f.ledger.request('unknown')?.status, 'uncertain');
});

test('optional cumulative fields require explicit null and exact validated policy fields', t => {
  const f = fixture(t);
  for (const field of ['cumulativeCostLimit', 'cumulativeRequestLimit'] as const) {
    validateAllowanceAmendment({ ...f.amendment, [field]: null });
    for (const value of [undefined, 0, -1, 5, NaN, Infinity, 'null', false, {}]) {
      assert.throws(() => f.ledger.applyAllowanceAmendment({ ...f.amendment, [field]: value } as unknown as AllowanceAmendment, host), /Invalid allowance amendment/);
    }
  }
  assert.throws(() => validateAllowanceAmendment({ ...uncapped(f.amendment), unknownLimit: null } as unknown as AllowanceAmendment), /Invalid allowance amendment/);
  assert.throws(() => f.ledger.applyAllowanceAmendment({ ...uncapped(f.amendment), expectedEnvelopeDigest: identity('wrong') }, host), /envelope changed/);
  assert.equal(f.store.list('resource.allowance-amendments').length, 0);
  assert.equal(f.store.events('root').length, 0);
  assert.deepEqual(f.ledger.effectiveEnvelope('root'), envelope);
});

for (const level of ['root', 'child'] as const) {
  test(`${level} concurrency, deadlines and cancellation still refuse work with all cumulative caps disabled`, t => {
    const concurrent = fixture(t, level === 'root' ? { maxConcurrency: 1 } : {}, level === 'child' ? { maxConcurrency: 1 } : {});
    concurrent.ledger.applyAllowanceAmendment(uncapped(concurrent.amendment), host);
    concurrent.ledger.reserve(request('first'));
    assert.throws(() => concurrent.ledger.reserve(request('second')), BudgetExceeded);

    const timed = fixture(t, level === 'root' ? { maxElapsedMs: 10 } : {}, level === 'child' ? { maxElapsedMs: 10 } : {});
    timed.ledger.applyAllowanceAmendment(uncapped(timed.amendment), host);
    timed.ledger.reserve(request('reserved'));
    timed.setNow(11);
    assert.throws(() => timed.ledger.dispatched({ ...request('reserved'), status: 'dispatched' }), BudgetExceeded);
    assert.throws(() => timed.ledger.reserve(request('late')), BudgetExceeded);

    const cancelled = fixture(t);
    cancelled.ledger.cancel(level);
    cancelled.ledger.applyAllowanceAmendment(uncapped(cancelled.amendment), host);
    assert.throws(() => cancelled.ledger.reserve(request('cancelled')), BudgetExceeded);
    assert.throws(() => cancelled.ledger.allocate('future', envelope, 'child'), /parent cancelled/);
  });
}

for (const overrun of ['tokens', 'cost', 'elapsed'] as const) {
  test(`physical ${overrun} overrun preserves actual charges and cancels even with cumulative caps disabled`, t => {
    const f = fixture(t);
    f.ledger.applyAllowanceAmendment(uncapped(f.amendment), host);
    const r = request('overrun');
    f.ledger.reserve(r); f.ledger.dispatched({ ...r, status: 'dispatched' });
    f.ledger.settle({ ...r, status: 'succeeded', usage: { requests: 1, inputTokens: overrun === 'tokens' ? 41 : 40, outputTokens: 0, costUsd: overrun === 'cost' ? 0.6 : 0.5, elapsedMs: overrun === 'elapsed' ? 2 : 1 } });
    const usage = f.ledger.snapshot('root');
    assert.equal(usage.tokens, overrun === 'tokens' ? 41 : 40);
    assert.equal(usage.costUsd, overrun === 'cost' ? 0.6 : 0.5);
    assert.equal(usage.elapsedMs, overrun === 'elapsed' ? 2 : 1);
    assert.equal(usage.cancelled, true);
    assert.throws(() => f.ledger.reserve(request('after-overrun')), BudgetExceeded);
  });
}

interface StoredReservation { rootId: string; request: PhysicalRequest; ceiling: RequestCeiling; charged: RequestCeiling }
interface StoredBudget { envelope: ResourceEnvelope; startedAt: number; cancelled: boolean; elapsedFloorMs?: number }
function recoveryPolicy(f: ReturnType<typeof fixture>, requestId = 'timeout'): AllowanceAmendment {
  return { ...uncapped(f.amendment), id: 'pilot-11-elapsed-recovery', resumeAfterElapsedOverrun: {
    requestId, expectedRequestDigest: identity(f.store.get('requests', requestId)?.value),
  } };
}
function timedOut(t: test.TestContext, root: Partial<ResourceEnvelope> = {}) {
  const f = fixture(t, { maxElapsedMs: 1_000_000, ...root }, { maxElapsedMs: 1_000_000 }, { tokens: 40, costUsd: 0.5, elapsedMs: 180_000 });
  const r = request('timeout');
  f.ledger.reserve(r); f.ledger.dispatched({ ...r, status: 'dispatched' });
  f.setNow(180_008.124762);
  f.ledger.settle({ ...r, status: 'uncertain', usage: { ...r.usage, elapsedMs: 180_008.124762 } });
  return f;
}

test('exact accepted-host recovery clears only the cancelled budget and preserves uncertain timeout charges and audit', t => {
  const f = timedOut(t, { maxRequests: 1, maxTokens: 40, maxCostUsd: 0.5 });
  assert.equal(f.ledger.snapshot('root').cancelled, true);
  f.ledger.applyAllowanceAmendment(uncapped(f.amendment), host);
  assert.throws(() => f.ledger.reserve(request('blocked')), BudgetExceeded);
  const priorBudget = f.store.get<StoredBudget>('budgets', 'root')!, requests = f.store.list('requests'), allocations = f.store.list('allocations');
  const oldHistory = f.store.list('resource.allowance-amendments'), oldEvents = f.store.events('root');
  const policy = recoveryPolicy(f), cause = f.store.get<StoredReservation>('requests', 'timeout')!;
  let checked = 0;
  f.ledger.applyAllowanceAmendment(policy, { ...host, assertAuthority() { checked++; } });
  assert.equal(checked, 1);
  assert.deepEqual(f.store.get<StoredBudget>('budgets', 'root')!.value, { ...priorBudget.value, cancelled: false });
  assert.deepEqual(f.store.list('requests'), requests);
  assert.deepEqual(f.store.list('allocations'), allocations);
  assert.deepEqual(f.store.list('resource.allowance-amendments').filter(row => row.key !== policy.id), oldHistory);
  assert.deepEqual(f.store.events('root').slice(0, oldEvents.length), oldEvents);
  const audit = f.store.get<{ elapsedOverrunRecovery: { priorBudget: StoredBudget; cause: StoredReservation } }>('resource.allowance-amendments', policy.id)!;
  assert.deepEqual(audit.value.elapsedOverrunRecovery, { priorBudget: priorBudget.value, cause: cause.value });
  assert.deepEqual(f.store.events('root').at(-1)!.data, audit.value);
  assert.equal(f.ledger.snapshot('root').costUsd, 0.5);
  assert.equal(f.ledger.snapshot('root').tokens, 40);
  assert.equal(f.ledger.snapshot('root').cancelled, false);
  const history = f.store.list('resource.allowance-amendments'), events = f.store.events('root');
  f.reopen();
  assert.equal(f.ledger.effectiveEnvelope('root').maxRequests, 1);
  assert.throws(() => f.ledger.reserve(request('unbound')), BudgetExceeded);
  f.ledger.applyAllowanceAmendment(policy, host);
  f.settle(request('resumed'));
  assert.deepEqual(f.store.get('requests', 'timeout'), cause);
  assert.deepEqual(f.store.list('resource.allowance-amendments'), history);
  assert.deepEqual(f.store.events('root'), events);
  assert.equal(f.ledger.snapshot('root').requests, 2);
});

test('recovery rebinding never clears a subsequent physical overrun or explicit cancellation', t => {
  const f = timedOut(t), policy = recoveryPolicy(f);
  f.ledger.applyAllowanceAmendment(policy, host);
  const later = request('later');
  f.ledger.reserve(later); f.ledger.dispatched({ ...later, status: 'dispatched' });
  f.ledger.settle({ ...later, status: 'uncertain', usage: { ...later.usage, elapsedMs: 180_009 } });
  const cancelledBudget = f.store.get('budgets', 'root'), history = f.store.list('resource.allowance-amendments'), events = f.store.events('root');
  f.ledger.applyAllowanceAmendment(policy, host);
  assert.deepEqual(f.store.get('budgets', 'root'), cancelledBudget);
  assert.throws(() => f.ledger.reserve(request('still-blocked')), BudgetExceeded);
  assert.throws(() => f.ledger.applyAllowanceAmendment({ ...policy, id: 'new-id-same-old-cause' }, host), /another physical overrun/);
  f.reopen();
  f.ledger.applyAllowanceAmendment(policy, host);
  assert.equal(f.ledger.snapshot('root').cancelled, true);
  assert.deepEqual(f.store.list('resource.allowance-amendments'), history);
  assert.deepEqual(f.store.events('root'), events);

  const explicit = timedOut(t), explicitPolicy = recoveryPolicy(explicit);
  explicit.ledger.applyAllowanceAmendment(explicitPolicy, host);
  explicit.ledger.cancel('root');
  explicit.ledger.applyAllowanceAmendment(explicitPolicy, host);
  assert.throws(() => explicit.ledger.reserve(request('explicit-still-blocked')), BudgetExceeded);
});

test('repeated uncertain timeout settlement retains physical enforcement after a one-time recovery', t => {
  const f = timedOut(t), policy = recoveryPolicy(f), original = f.ledger.request('timeout')!;
  f.ledger.applyAllowanceAmendment(policy, host);
  assert.equal(f.ledger.snapshot('root').cancelled, false);
  f.ledger.settle(original);
  assert.equal(f.ledger.snapshot('root').cancelled, true);
  assert.deepEqual(f.ledger.request('timeout'), original);
  f.ledger.applyAllowanceAmendment(policy, host);
  assert.throws(() => f.ledger.reserve(request('replayed-overrun-still-blocked')), BudgetExceeded);
});

test('recovery requires exact nested fields, cause digest and synchronous host authority', t => {
  const f = timedOut(t), policy = recoveryPolicy(f);
  const invalid = [undefined, null, {}, { requestId: '' , expectedRequestDigest: identity('x') },
    { requestId: 'timeout', expectedRequestDigest: 'bad' }, { ...policy.resumeAfterElapsedOverrun, refund: true }];
  const before = ['budgets', 'allocations', 'requests', 'resource.allowance-amendments'].map(namespace => f.store.list(namespace));
  for (const value of invalid) assert.throws(() => f.ledger.applyAllowanceAmendment({ ...policy, resumeAfterElapsedOverrun: value } as unknown as AllowanceAmendment, host), /Invalid allowance amendment/);
  for (const resumeAfterElapsedOverrun of [{ ...policy.resumeAfterElapsedOverrun!, expectedRequestDigest: identity('wrong') }, { requestId: 'missing', expectedRequestDigest: identity('missing') }]) {
    assert.throws(() => f.ledger.applyAllowanceAmendment({ ...policy, resumeAfterElapsedOverrun }, host), /exact cancelled root cause/);
  }
  assert.throws(() => f.ledger.applyAllowanceAmendment(policy, { ...host, assertAuthority() { throw Error('authority withdrawn'); } }), /authority withdrawn/);
  assert.throws(() => f.ledger.applyAllowanceAmendment(policy, { ...host, assertAuthority: (() => Promise.resolve()) as unknown as () => void }), /must be synchronous/);
  assert.deepEqual(['budgets', 'allocations', 'requests', 'resource.allowance-amendments'].map(namespace => f.store.list(namespace)), before);
  assert.equal(f.store.events('root').length, 0);
  f.ledger.applyAllowanceAmendment(uncapped(f.amendment), host);
  assert.throws(() => f.ledger.applyAllowanceAmendment({ ...policy, id: 'pilot-11' }, host), /identity changed/);
  assert.equal(f.ledger.snapshot('root').cancelled, true);
});

for (const level of ['root', 'child'] as const) {
  test(`recovery rejects explicit ${level} allocation cancellation transactionally`, t => {
    const f = timedOut(t);
    f.ledger.cancel(level);
    const policy = recoveryPolicy(f), before = ['budgets', 'allocations', 'requests'].map(namespace => f.store.list(namespace));
    assert.throws(() => f.ledger.applyAllowanceAmendment(policy, host), /allocation cancellation/);
    assert.deepEqual(['budgets', 'allocations', 'requests'].map(namespace => f.store.list(namespace)), before);
    assert.equal(f.store.list('resource.allowance-amendments').length, 0);
    assert.equal(f.store.events('root').length, 0);
  });
}

for (const invalid of ['measured', 'settled', 'no-elapsed-overrun', 'token-overrun', 'cost-overrun', 'foreign-root', 'not-cancelled'] as const) {
  test(`recovery rejects ${invalid} cause without changing retained state`, t => {
    const f = timedOut(t), row = f.store.get<StoredReservation>('requests', 'timeout')!, value = structuredClone(row.value);
    if (invalid === 'measured') value.request.usage.costUsd = 0.5;
    if (invalid === 'settled') value.request.status = 'succeeded';
    if (invalid === 'no-elapsed-overrun') value.charged.elapsedMs = value.ceiling.elapsedMs;
    if (invalid === 'token-overrun') value.charged.tokens = value.ceiling.tokens + 1;
    if (invalid === 'cost-overrun') value.charged.costUsd = value.ceiling.costUsd + 1;
    if (invalid === 'foreign-root') {
      f.ledger.allocate('other-root', { ...envelope, maxElapsedMs: 1_000_000 });
      value.request.runId = 'other-root';
    }
    if (invalid === 'not-cancelled') {
      const budget = f.store.get<StoredBudget>('budgets', 'root')!;
      f.store.put('budgets', 'root', { ...budget.value, cancelled: false }, budget.revision);
    }
    f.store.put('requests', 'timeout', value, row.revision);
    const policy = recoveryPolicy(f), before = ['budgets', 'allocations', 'requests'].map(namespace => f.store.list(namespace));
    assert.throws(() => f.ledger.applyAllowanceAmendment(policy, host), /Elapsed overrun recovery/);
    assert.deepEqual(['budgets', 'allocations', 'requests'].map(namespace => f.store.list(namespace)), before);
    assert.equal(f.store.list('resource.allowance-amendments').length, 0);
    assert.equal(f.store.events('root').length, 0);
  });
}

for (const overrun of ['tokens', 'cost', 'elapsed'] as const) {
  test(`recovery refuses another root request with ${overrun} overrun`, t => {
    const f = fixture(t);
    const cause = request('timeout'), other = request('other', 'root');
    for (const r of [cause, other]) { f.ledger.reserve(r); f.ledger.dispatched({ ...r, status: 'dispatched' }); }
    f.ledger.settle({ ...cause, status: 'uncertain', usage: { ...cause.usage, elapsedMs: 2 } });
    f.ledger.settle({ ...other, status: 'succeeded', usage: { requests: 1, inputTokens: overrun === 'tokens' ? 41 : 40, outputTokens: 0, costUsd: overrun === 'cost' ? 0.6 : 0.5, elapsedMs: overrun === 'elapsed' ? 2 : 1 } });
    const policy = recoveryPolicy(f), before = ['budgets', 'requests'].map(namespace => f.store.list(namespace));
    assert.throws(() => f.ledger.applyAllowanceAmendment(policy, host), /another physical overrun/);
    assert.deepEqual(['budgets', 'requests'].map(namespace => f.store.list(namespace)), before);
    assert.equal(f.store.list('resource.allowance-amendments').length, 0);
  });
}

test('enclosing rollback restores the cancelled budget, charges and missing recovery audit', t => {
  const f = timedOut(t), policy = recoveryPolicy(f), before = ['budgets', 'allocations', 'requests'].map(namespace => f.store.list(namespace));
  assert.throws(() => f.store.transaction(() => { f.ledger.applyAllowanceAmendment(policy, host); throw Error('host rollback'); }), /host rollback/);
  assert.deepEqual(['budgets', 'allocations', 'requests'].map(namespace => f.store.list(namespace)), before);
  assert.equal(f.store.list('resource.allowance-amendments').length, 0);
  assert.equal(f.store.events('root').length, 0);
  assert.throws(() => f.ledger.reserve(request('unrecorded-recovery')), /history unavailable/);
  f.ledger.applyAllowanceAmendment(policy, host);
  f.ledger.reserve(request('recorded-recovery'));
});

test('explicit unlimited lifetime admits work after original root and descendant deadlines without resetting history', t => {
  const f = fixture(t, { maxElapsedMs: 1000 }, { maxElapsedMs: 10 });
  const r = request('reserved-before-expiry');
  f.ledger.reserve(r);
  const original = f.store.list<{ envelope: ResourceEnvelope; startedAt: number }>('allocations');
  f.setNow(1000000);
  assert.throws(() => f.ledger.dispatched({ ...r, status: 'dispatched' }), BudgetExceeded);
  const amendment = { ...uncapped(f.amendment), id: 'unlimited-lifetime', cumulativeElapsedLimit: null };
  f.ledger.applyAllowanceAmendment(amendment, host);
  assert.equal(f.ledger.effectiveEnvelope('root').maxElapsedMs, null);
  assert.equal(f.ledger.effectiveEnvelope('child').maxElapsedMs, null);
  f.ledger.dispatched({ ...r, status: 'dispatched' });
  f.ledger.settle({ ...r, status: 'succeeded', usage: { ...r.usage, elapsedMs: 1 } });
  f.settle(request('new-work'));
  for (const row of original) {
    const current = f.store.get<{ envelope: ResourceEnvelope; startedAt: number }>('allocations', row.key)!.value;
    assert.deepEqual(current.envelope, row.value.envelope);
    assert.equal(current.startedAt, row.value.startedAt);
  }
  const retained = f.store.list('requests');
  f.reopen();
  assert.throws(() => f.ledger.reserve(request('unbound')), BudgetExceeded);
  f.ledger.applyAllowanceAmendment(amendment, host);
  f.ledger.reserve(request('rebound'));
  for (const row of retained) assert.deepEqual(f.store.get('requests', row.key), { revision: row.revision, value: row.value });
});

for (const outcome of ['succeeded', 'uncertain'] as const) test(`fully unlimited allowance retains ${outcome} estimate overruns without cancelling future work`, t => {
  const f = fixture(t);
  f.ledger.applyAllowanceAmendment({ ...uncapped(f.amendment), cumulativeElapsedLimit: null }, host);
  const r = request('overrun');
  f.ledger.reserve(r); f.ledger.dispatched({ ...r, status: 'dispatched' });
  f.ledger.settle({ ...r, status: outcome, usage: { requests: 1, inputTokens: 100, outputTokens: 10, costUsd: 12, elapsedMs: 2000 } });
  const retained = f.store.get('requests', r.id);
  const usage = f.ledger.snapshot('root');
  assert.equal(usage.tokens, 110); assert.equal(usage.costUsd, 12); assert.equal(usage.elapsedMs, 2000); assert.equal(usage.cancelled, false);
  f.ledger.reserve(request('next'));
  assert.deepEqual(f.store.get('requests', r.id), retained);
  f.ledger.cancel('child');
  assert.throws(() => f.ledger.reserve(request('cancelled')), BudgetExceeded);
});

test('unlimited elapsed policy rejects non-null substitutes', () => {
  const base: AllowanceAmendment = { id: 'unlimited', authorizationRef: 'explicit-user', rootId: 'root', expectedEnvelopeDigest: identity(envelope), cumulativeTokenLimit: null, descendantCostLimit: 'root', scope: 'root-and-descendants', cumulativeElapsedLimit: null };
  validateAllowanceAmendment(base);
  for (const value of [0, 1, Infinity, 'unlimited', undefined]) assert.throws(() => validateAllowanceAmendment({ ...base, cumulativeElapsedLimit: value } as AllowanceAmendment), /Invalid allowance amendment/);
});
