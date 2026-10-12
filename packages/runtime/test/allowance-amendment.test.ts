import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { identity, type ResourceEnvelope } from '../../contracts/common.ts';
import type { PhysicalRequest } from '../../contracts/control/index.ts';
import { OperationalStore } from '../../storage/index.ts';
import { BudgetExceeded, ResourceLedger, validateAllowanceAmendment, type AllowanceAmendment } from '../resources/index.ts';

const envelope: ResourceEnvelope = { maxRequests: 20, maxTokens: 160, maxCostUsd: 5, maxElapsedMs: 1000, maxConcurrency: 8 };
const host = { authority: { generation: 'accepted', epoch: 1, controlRevision: 'incumbent-reviewed' }, assertAuthority: () => {} };
function request(id: string, runId = 'child', costUsd: number | null = null): PhysicalRequest {
  return { id, runId, purpose: 'reasoning', provider: 'fixture', model: 'fixture', promptManifestId: 'p', requestDigest: identity(id), reservationId: id, status: 'reserved', usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd, elapsedMs: 0 } };
}
function fixture(t: test.TestContext, root: Partial<ResourceEnvelope> = {}, child: Partial<ResourceEnvelope> = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'aeon-amendment-')), filename = join(directory, 'state.sqlite');
  let now = 0, store = new OperationalStore({ filename });
  let ledger = new ResourceLedger(store, { tokens: 40, costUsd: 0.5, elapsedMs: 1 }, () => now);
  const rootEnvelope = { ...envelope, ...root };
  ledger.allocate('root', rootEnvelope);
  ledger.allocate('child', { ...envelope, maxCostUsd: 1.25, maxConcurrency: 4, ...child }, 'root');
  const amendment: AllowanceAmendment = { id: 'pilot-10', authorizationRef: 'user-keeps-five-total', rootId: 'root', expectedEnvelopeDigest: identity(rootEnvelope), cumulativeTokenLimit: null, scope: 'root-and-descendants', descendantCostLimit: 'root' };
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { get store() { return store; }, get ledger() { return ledger; }, amendment,
    setNow(value: number) { now = value; },
    reopen() { store.close(); store = new OperationalStore({ filename }); ledger = new ResourceLedger(store, { tokens: 40, costUsd: 0.5, elapsedMs: 1 }, () => now); },
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
