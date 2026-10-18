import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { identity, type ResourceEnvelope } from '../../contracts/common.ts';
import type { PhysicalRequest } from '../../contracts/control/index.ts';
import { OperationalStore } from '../../storage/index.ts';
import { BudgetExceeded, CapacityUnavailable, ResourceLedger, type AllowanceAmendment } from '../resources/index.ts';

const envelope: ResourceEnvelope = { maxRequests: 50, maxTokens: 10_000, maxCostUsd: 100, maxElapsedMs: 100_000, maxConcurrency: 8 };
const ceiling = { tokens: 10, costUsd: 1, elapsedMs: 1 };
const host = { authority: { generation: 'accepted', epoch: 1, controlRevision: 'reviewed' }, assertAuthority() {} };
const terminal = { kind: 'transport-terminal' as const, reason: 'Bounded transport returned and cleanup completed.' };
const recovery = { kind: 'host-recovery' as const, reason: 'Exclusive replacement-host ownership; previous process group has exited.' };
function request(id: string, runId = 'root'): PhysicalRequest {
  return { id, runId, purpose: 'reasoning', provider: 'fixture', model: 'fixture', promptManifestId: 'prompt',
    requestDigest: identity(id), reservationId: id, status: 'reserved',
    usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 } };
}
function fixture(t: test.TestContext, overrides: Partial<ResourceEnvelope> = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'aeon-capacity-')), filename = join(directory, 'state.sqlite');
  let now = 0, store = new OperationalStore({ filename }), ledger = new ResourceLedger(store, ceiling, () => now);
  const rootEnvelope = { ...envelope, ...overrides };
  ledger.allocate('root', rootEnvelope);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return {
    get store() { return store; }, get ledger() { return ledger; }, rootEnvelope,
    setNow(value: number) { now = value; },
    reopen() { store.close(); store = new OperationalStore({ filename }); ledger = new ResourceLedger(store, ceiling, () => now); },
    uncertain(id: string, runId = 'root') {
      const r = request(id, runId); ledger.reserve(r); ledger.dispatched({ ...r, status: 'dispatched' }); ledger.settle({ ...r, status: 'uncertain' }); return r;
    },
  };
}
function amendment(rootEnvelope: ResourceEnvelope): AllowanceAmendment {
  return { id: 'accepted-allowance', authorizationRef: 'retained-user-authorization', rootId: 'root', expectedEnvelopeDigest: identity(rootEnvelope),
    cumulativeTokenLimit: null, cumulativeCostLimit: null, scope: 'root-and-descendants', descendantCostLimit: 'root' };
}
const permanent = (error: unknown) => error instanceof BudgetExceeded && !(error instanceof CapacityUnavailable);

test('recovering seven dead executions preserves their complete uncertain charges and original accounting history', t => {
  const f = fixture(t);
  const policy = amendment(f.rootEnvelope);
  f.ledger.applyAllowanceAmendment(policy, host);
  for (let index = 0; index < 7; index += 1) f.uncertain(`old-${index}`);
  f.uncertain('still-executing');
  const namespaces = ['requests', 'allocations', 'budgets', 'resource.allowance-amendments'];
  const original = namespaces.map(namespace => f.store.list(namespace));
  const before = f.ledger.snapshot('root');
  assert.equal(before.concurrent, 8);
  assert.throws(() => f.ledger.reserve(request('waiting')), CapacityUnavailable);
  for (let index = 0; index < 7; index += 1) f.ledger.releaseConcurrency(`old-${index}`, recovery);
  const after = f.ledger.snapshot('root');
  assert.deepEqual(after, { ...before, concurrent: 1 });
  assert.deepEqual(namespaces.map(namespace => f.store.list(namespace)), original);
  assert.equal(f.store.list('resource.concurrency-releases').length, 7);
  for (let index = 0; index < 7; index += 1) {
    assert.equal(f.ledger.request(`old-${index}`)?.status, 'uncertain');
    assert.equal(f.ledger.holdsConcurrency(`old-${index}`), false);
  }
  assert.equal(f.ledger.holdsConcurrency('still-executing'), true);
  const evidence = f.store.list('resource.concurrency-releases');
  f.ledger.releaseConcurrency('old-0', { ...recovery, reason: 'Repeated startup scan.' });
  assert.deepEqual(f.store.list('resource.concurrency-releases'), evidence);
  f.reopen();
  assert.deepEqual(f.ledger.snapshot('root'), after);
  assert.deepEqual(namespaces.map(namespace => f.store.list(namespace)), original);
  f.ledger.reserve(request('waiting'));
  assert.equal(f.ledger.snapshot('root').concurrent, 2);
  assert.equal(f.ledger.snapshot('root').tokens, 90);
  assert.equal(f.ledger.snapshot('root').costUsd, 9);
});

test('uncertainty and elapsed time alone never release a still-running request', t => {
  const f = fixture(t, { maxConcurrency: 1 });
  const r = f.uncertain('unknown');
  f.setNow(50_000);
  assert.equal(f.ledger.snapshot('root').concurrent, 1);
  assert.throws(() => f.ledger.reserve(request('waiting')), CapacityUnavailable);
  f.ledger.releaseConcurrency(r.id, terminal);
  assert.equal(f.ledger.snapshot('root').concurrent, 0);
  assert.equal(f.ledger.request(r.id)?.status, 'uncertain');
  assert.throws(() => f.ledger.dispatched({ ...r, status: 'dispatched' }), /request not reserved/);
});

test('permanent child spending and root request exhaustion take precedence over temporary capacity', t => {
  const f = fixture(t, { maxConcurrency: 1 });
  f.ledger.allocate('child', { ...envelope, maxTokens: 0 }, 'root');
  f.ledger.reserve(request('occupying'));
  assert.throws(() => f.ledger.reserve(request('waiting')), error => error instanceof CapacityUnavailable && error instanceof BudgetExceeded);
  assert.throws(() => f.ledger.reserve(request('child-spending-exhausted', 'child')), permanent);
  const count = fixture(t, { maxConcurrency: 1, maxRequests: 1 });
  count.ledger.reserve(request('only-request'));
  assert.throws(() => count.ledger.reserve(request('count-exhausted')), permanent);
});

test('a released reserved request reacquires ancestor capacity atomically without a duplicate charge', t => {
  const f = fixture(t, { maxConcurrency: 2 });
  f.ledger.allocate('child', { ...envelope, maxConcurrency: 1 }, 'root');
  f.ledger.allocate('leaf-a', envelope, 'child');
  f.ledger.allocate('leaf-b', envelope, 'child');
  const waiting = request('waiting', 'leaf-a'), occupying = request('occupying', 'leaf-b');
  f.ledger.reserve(waiting);
  const original = f.store.get('requests', waiting.id)!;
  f.ledger.releaseConcurrency(waiting.id, recovery);
  assert.deepEqual(f.store.get('requests', waiting.id), original);
  f.ledger.reserve(occupying);
  assert.throws(() => f.ledger.dispatched({ ...waiting, status: 'dispatched' }), CapacityUnavailable);
  assert.equal(f.ledger.holdsConcurrency(waiting.id), false);
  assert.deepEqual(f.store.get('requests', waiting.id), original);
  f.ledger.settle({ ...occupying, status: 'failed' });
  const charged = f.ledger.snapshot('root');
  f.ledger.dispatched({ ...waiting, status: 'dispatched' });
  assert.deepEqual(f.ledger.snapshot('root'), { ...charged, concurrent: 1 });
  assert.equal(f.ledger.holdsConcurrency(waiting.id), true);
  assert.equal(f.ledger.request(waiting.id)?.status, 'dispatched');
  const firstRelease = f.store.list('resource.concurrency-releases');
  f.ledger.releaseConcurrency(waiting.id, terminal);
  assert.equal(f.ledger.snapshot('root').concurrent, 0);
  const secondRelease = f.store.list('resource.concurrency-releases');
  assert.equal(secondRelease.length, 2);
  assert.deepEqual(secondRelease.find(row => row.key === firstRelease[0]!.key), firstRelease[0]);
  assert.equal(f.ledger.snapshot('root').requests, 2);
  assert.equal(f.ledger.snapshot('root').tokens, 10);
  assert.equal(f.ledger.snapshot('root').costUsd, 1);
});

test('reserved capacity reacquisition retains spending enforcement when accepted allowance is not rebound after restart', t => {
  const f = fixture(t, { maxCostUsd: 0 });
  const policy = amendment(f.rootEnvelope);
  f.ledger.applyAllowanceAmendment(policy, host);
  const r = request('reserved-under-amendment');
  f.ledger.reserve(r);
  f.ledger.releaseConcurrency(r.id, recovery);
  const original = f.store.get('requests', r.id);
  f.reopen();
  assert.throws(() => f.ledger.dispatched({ ...r, status: 'dispatched' }), permanent);
  assert.equal(f.ledger.holdsConcurrency(r.id), false);
  assert.deepEqual(f.store.get('requests', r.id), original);
  f.ledger.applyAllowanceAmendment(policy, host);
  f.ledger.dispatched({ ...r, status: 'dispatched' });
  assert.equal(f.ledger.holdsConcurrency(r.id), true);
  assert.equal(f.ledger.snapshot('root').costUsd, 1);
});

test('released uncertainty remains reconcilable and a terminal settlement needs no capacity marker to free its slot', t => {
  const f = fixture(t, { maxConcurrency: 1 });
  const r = f.uncertain('unknown');
  f.ledger.releaseConcurrency(r.id, terminal);
  const releaseEvidence = f.store.list('resource.concurrency-releases');
  f.ledger.settle({ ...r, status: 'succeeded', usage: { requests: 1, inputTokens: 2, outputTokens: 1, costUsd: 0.2, elapsedMs: 1 } });
  assert.deepEqual(f.store.list('resource.concurrency-releases'), releaseEvidence);
  assert.equal(f.ledger.snapshot('root').tokens, 3);
  assert.equal(f.ledger.snapshot('root').concurrent, 0);
  const next = request('next');
  f.ledger.reserve(next); f.ledger.dispatched({ ...next, status: 'dispatched' }); f.ledger.settle({ ...next, status: 'failed' });
  assert.equal(f.ledger.snapshot('root').concurrent, 0);
  const completed = f.store.get('requests', next.id);
  f.ledger.releaseConcurrency(next.id, terminal);
  assert.deepEqual(f.store.get('requests', next.id), completed);
});

test('capacity subscriptions wake on settlement, terminal release and cancellation and can be removed', t => {
  const f = fixture(t, { maxConcurrency: 1 });
  let notices = 0;
  const unlistenBroken = f.ledger.subscribeCapacity(() => { throw new Error('listener cannot alter ledger outcome'); });
  const unlisten = f.ledger.subscribeCapacity(() => { notices += 1; });
  const first = request('first');
  f.ledger.reserve(first); f.ledger.dispatched({ ...first, status: 'dispatched' });
  assert.equal(notices, 0);
  f.ledger.settle({ ...first, status: 'uncertain' });
  assert.equal(notices, 1);
  assert.equal(f.ledger.holdsConcurrency(first.id), true);
  f.ledger.releaseConcurrency(first.id, terminal);
  assert.equal(notices, 2);
  f.ledger.cancel('root');
  assert.equal(notices, 3);
  assert.throws(() => f.ledger.reserve(request('cancelled')), permanent);
  unlisten(); unlistenBroken();
  f.ledger.releaseConcurrency(first.id, terminal);
  assert.equal(notices, 3);
});

test('invalid release evidence cannot change execution occupancy or retained records', t => {
  const f = fixture(t, { maxConcurrency: 1 });
  f.uncertain('unknown');
  const before = f.store.list('requests');
  assert.throws(() => f.ledger.releaseConcurrency('missing', terminal), /existing physical request/);
  assert.throws(() => f.ledger.releaseConcurrency('unknown', { kind: 'host-recovery', reason: ' ' }), /evidence/);
  assert.equal(f.ledger.snapshot('root').concurrent, 1);
  assert.deepEqual(f.store.list('requests'), before);
  assert.equal(f.store.list('resource.concurrency-releases').length, 0);
});

test('enclosing rollback preserves occupancy and atomic release/reacquisition evidence', t => {
  const f = fixture(t, { maxConcurrency: 1 });
  const r = request('reserved');
  f.ledger.reserve(r);
  const original = f.store.get('requests', r.id);
  assert.throws(() => f.store.transaction(() => {
    f.ledger.releaseConcurrency(r.id, recovery);
    assert.equal(f.ledger.holdsConcurrency(r.id), false);
    throw new Error('outer transaction rejected release');
  }), /outer transaction/);
  assert.equal(f.ledger.holdsConcurrency(r.id), true);
  assert.equal(f.store.list('resource.concurrency-releases').length, 0);
  assert.equal(f.store.list('resource.concurrency-released').length, 0);
  f.ledger.releaseConcurrency(r.id, recovery);
  const evidence = f.store.list('resource.concurrency-releases');
  assert.throws(() => f.store.transaction(() => {
    f.ledger.dispatched({ ...r, status: 'dispatched' });
    assert.equal(f.ledger.holdsConcurrency(r.id), true);
    throw new Error('outer transaction rejected reacquisition');
  }), /outer transaction/);
  assert.equal(f.ledger.holdsConcurrency(r.id), false);
  assert.deepEqual(f.store.get('requests', r.id), original);
  assert.deepEqual(f.store.list('resource.concurrency-releases'), evidence);
  f.ledger.dispatched({ ...r, status: 'dispatched' });
  assert.equal(f.ledger.holdsConcurrency(r.id), true);
});
