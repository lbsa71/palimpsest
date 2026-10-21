import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { identity, type ResourceEnvelope, type Run } from '../packages/contracts/index.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { ResourceLedger } from '../packages/runtime/resources/index.ts';
import { accountedReview, prepareReview, assertReviewLineage, reviewPhysicalId, type ReviewResourceOptions } from './evaluation-resources.ts';
import { assertProbationLineage, type ProbationReviewRequest } from './control-continuation.ts';
import { hostResourceLedger, type HostResourceLedgerFactory } from './host-resources.ts';

const authority = { generation: 'accepted', epoch: 1, controlRevision: 'prior-controls' };
const envelope: ResourceEnvelope = { maxRequests: 50, maxTokens: 100, maxCostUsd: 10, maxElapsedMs: 10, maxConcurrency: 2 };
function fixture(t: test.TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'evolution-allowance-')), store = new OperationalStore({ filename: join(directory, 'state.sqlite') });
  let now = 0, checks = 0;
  const clock = () => now, ledger = new ResourceLedger(store, { tokens: 0, costUsd: 0, elapsedMs: 0 }, clock);
  ledger.allocate('root', envelope); ledger.allocate('author', envelope, 'root');
  store.put('runs', 'author', { id: 'author', status: 'waiting', authority, scope: { kind: 'restricted', principals: ['author'] } } as Run, null);
  const amendment = { id: 'explicit-unlimited', authorizationRef: 'user-grant', rootId: 'root', expectedEnvelopeDigest: identity(envelope), cumulativeTokenLimit: null,
    cumulativeCostLimit: null, cumulativeRequestLimit: null, cumulativeElapsedLimit: null, scope: 'root-and-descendants', descendantCostLimit: 'root' } as const;
  const resourceLedger: HostResourceLedgerFactory = (target, ceiling, suppliedClock) => {
    const resources = new ResourceLedger(target, ceiling, suppliedClock ?? clock);
    resources.applyAllowanceAmendment(amendment, { authority, assertAuthority() { checks++; } }); return resources;
  };
  // Authority-backed audit is present before the contrast; a fresh unbound ledger must still refuse.
  resourceLedger(store, { tokens: 0, costUsd: 0, elapsedMs: 0 }, clock);
  const request = { requestId: 'review', proposal: { runId: 'author', authority, scope: { kind: 'restricted', principals: ['author'] } } } as ReviewResourceOptions['request'];
  const options: ReviewResourceOptions = { store, request, evaluatorId: 'offline', evaluatorDigest: identity('offline'), maxElapsedMs: 5, now: clock,
    assertAuthority() {}, dispatchAuthority(_authority, operation) { operation(); } };
  const review = (): ProbationReviewRequest => ({ proposal: request.proposal, allocationLineage: ['author', 'root'].map(id => {
    const row = store.get<{ rootId: string; parentRunId?: string; startedAt: number; envelope: ResourceEnvelope }>('allocations', id)!.value;
    return { id, ...row };
  }) } as ProbationReviewRequest);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { store, ledger, options, resourceLedger, clock, review, get checks() { return checks; }, time(value: number) { now = value; } };
}

test('expired original root remains refused without trusted binding but prepares and completes review with it', async t => {
  const f = fixture(t); f.time(100);
  assert.throws(() => prepareReview(f.options), /expired/);
  const original = f.store.list<{ envelope: ResourceEnvelope; startedAt: number }>('allocations').map(row => ({ key: row.key, envelope: row.value.envelope, startedAt: row.value.startedAt }));
  const history = f.store.list('resource.allowance-amendments'); let launched = 0;
  assert.equal(await accountedReview({ ...f.options, resourceLedger: f.resourceLedger }, async gate => { gate.dispatch(() => { launched++; }); f.time(102); return 'original signed observation'; }), 'original signed observation');
  assert.equal(launched, 1); assert.equal(f.ledger.request(reviewPhysicalId('review'))!.status, 'succeeded');
  assert.equal(f.ledger.request(reviewPhysicalId('review'))!.usage.elapsedMs, 2);
  assert.deepEqual(f.store.list('resource.allowance-amendments'), history);
  for (const row of original) { const value = f.store.get<{ envelope: ResourceEnvelope; startedAt: number }>('allocations', row.key)!.value; assert.equal(value.startedAt, row.startedAt); assert.deepEqual(value.envelope, row.envelope); }
  assert.ok(f.checks > 1);
});

test('unlimited original lifetime never extends a finite review deadline or clears cancellation and uncertainty', async t => {
  const f = fixture(t); f.time(100);
  await assert.rejects(accountedReview({ ...f.options, resourceLedger: f.resourceLedger }, async gate => { gate.dispatch(() => {}); f.time(106); }), /deadline/);
  const unknown = f.store.get('requests', reviewPhysicalId('review')); assert.equal(f.ledger.request(reviewPhysicalId('review'))!.status, 'uncertain');
  assert.equal(f.ledger.snapshot('root').concurrent, 1);
  f.ledger.cancel('root');
  assert.throws(() => prepareReview({ ...f.options, request: { ...f.options.request, requestId: 'cancelled' }, resourceLedger: f.resourceLedger }), /cancelled/);
  assert.deepEqual(f.store.get('requests', reviewPhysicalId('review')), unknown);
});

test('probation keeps immutable lineage while normal reservation elapsed floors advance under explicit host policy', t => {
  const f = fixture(t); f.time(100); const review = f.review();
  assert.throws(() => assertProbationLineage(f.store, review, { now: f.clock }), /expired/);
  prepareReview({ ...f.options, resourceLedger: f.resourceLedger });
  assert.doesNotThrow(() => assertProbationLineage(f.store, review, { now: f.clock, resourceLedger: f.resourceLedger }));
  const row = f.store.get<{ startedAt: number }>('allocations', 'root')!;
  f.store.put('allocations', 'root', { ...row.value, startedAt: row.value.startedAt + 1 }, row.revision);
  assert.throws(() => assertProbationLineage(f.store, review, { now: f.clock, resourceLedger: f.resourceLedger }), /changed/);
});

test('review result lineage gate uses trusted effective policy and preserves unbound finite refusal', t => {
  const f = fixture(t); f.time(100);
  assert.throws(() => assertReviewLineage(f.store, f.options.request, f.clock), /expired/);
  assert.doesNotThrow(() => assertReviewLineage(f.store, f.options.request, f.clock, authority, f.resourceLedger));
  f.ledger.cancel('author');
  assert.throws(() => assertReviewLineage(f.store, f.options.request, f.clock, authority, f.resourceLedger), /cancelled/);
});

test('trusted factory cannot silently switch accounting stores or physical request ceilings', t => {
  const f = fixture(t), other = fixture(t);
  assert.throws(() => hostResourceLedger(f.store, { tokens: 0, costUsd: 0, elapsedMs: 1 }, { resourceLedger: () => new ResourceLedger(other.store, { tokens: 0, costUsd: 0, elapsedMs: 1 }, f.clock) }), /exact store/);
  assert.throws(() => hostResourceLedger(f.store, { tokens: 0, costUsd: 0, elapsedMs: 1 }, { resourceLedger: () => new ResourceLedger(f.store, { tokens: 0, costUsd: 0, elapsedMs: 2 }, f.clock) }), /exact store/);
});
