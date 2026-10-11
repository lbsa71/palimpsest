import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { canonicalJson, identity } from '../packages/contracts/index.ts';
import { admissionPolicyIdentity } from '../packages/release/admission.ts';
import { hashBytes } from '../packages/release/artifacts.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { ResourceLedger } from '../packages/runtime/resources/index.ts';
import { loadOfflinePlan, offlinePlanMount } from '../evaluations/offline-review/index.ts';
import { reviewerDescriptor, runAccountedExternalReview, type ReviewerFile } from './evaluation-dispatch.ts';
import type { EvaluationRequest } from './evolution-tools.ts';
import { accountedReview, prepareReview, reviewOperationId } from './evaluation-resources.ts';

test('audit: removing or replacing an accepted private checker cannot turn it into an optional review', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-offline-audit-'));
  const store = new OperationalStore({ filename: join(root, 'audit.sqlite') });
  try {
    const host = { stateDirectory: join(root, 'state'), workspaceDirectory: join(root, 'work'), artifactStore: join(root, 'artifacts'), nodeBinary: process.execPath };
    const config: ReviewerFile = { evaluatorId: 'original-checker',
      files: [{ path: join(root, 'node'), mount: '/reviewer/node', sha256: '1'.repeat(64) },
        { path: join(root, 'plan'), mount: offlinePlanMount, sha256: '2'.repeat(64) }],
      executable: '/reviewer/node', args: [], keyFile: join(root, 'key'), pollMs: 1, maxElapsedMs: 100,
      maxOutputBytes: 65536, maxClosureBytes: 65536, memoryBytes: 1024 * 1024 };
    const acceptedDigest = hashBytes(reviewerDescriptor(config));
    const fields = { kind: 'engineering' as const, controlRevision: 'old-controls', requiredCases: ['validator-string-length'],
      evaluatorKeys: new Map([[config.evaluatorId, Buffer.alloc(32)]]), evaluatorArtifacts: new Map([[config.evaluatorId, acceptedDigest]]) };
    const policy = { ...fields, policyDigest: admissionPolicyIdentity(fields) };
    const request = { requestId: 'original-request', policyDigest: policy.policyDigest,
      proposal: { runId: 'original-author', authority: { generation: 'old', epoch: 1, controlRevision: fields.controlRevision } } } as EvaluationRequest;
    let launches = 0;
    const variants = [
      { ...config, files: config.files.filter(f => f.mount !== offlinePlanMount) },
      { ...config, files: config.files.map(f => f.mount === offlinePlanMount ? { ...f, sha256: '3'.repeat(64) } : f) },
    ];
    assert.equal(loadOfflinePlan(variants[0]!), undefined, 'Optional loader result alone is never authority to skip the accepted checker');
    for (const changed of variants) {
      const resource = { store, request, evaluatorDigest: hashBytes(reviewerDescriptor(changed)), evaluatorId: changed.evaluatorId,
        maxElapsedMs: changed.maxElapsedMs, assertAuthority: () => {}, dispatchAuthority: () => { launches++; } };
      await assert.rejects(runAccountedExternalReview(changed, host, request, policy, 'unused-rescue', resource), /exact original judging policy/);
    }
    assert.equal(launches, 0);
    assert.deepEqual(store.list('requests'), []);
    assert.deepEqual(store.list('host.external-review-reservations'), []);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('audit: retained private expected answers cannot change under their accepted descriptor digest', () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-offline-plan-audit-'));
  try {
    const path = join(root, 'plan.json');
    const original = canonicalJson({ version: 1, kind: 'validator-string-length', runnerDigest: 'a'.repeat(64), cases: [{
      id: 'unicode-boundary', inputs: [{ schema: { type: 'string', maxLength: 1 }, value: '🚀' }],
      expected: [true], timeoutMs: 100, maxOutputBytes: 1024 }] });
    writeFileSync(path, original.replace('"expected":[true]', '"expected":[false]'), { mode: 0o600 });
    const config = { files: [{ path, mount: offlinePlanMount, sha256: hashBytes(original) }] } as ReviewerFile;
    assert.throws(() => loadOfflinePlan(config), /differs from accepted reviewer closure/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function continuationFixture() {
  const root = mkdtempSync(join(tmpdir(), 'aeon-offline-continuation-audit-'));
  const store = new OperationalStore({ filename: join(root, 'audit.sqlite') });
  const ledger = new ResourceLedger(store, { tokens: 0, costUsd: 0, elapsedMs: 100 }, () => 0);
  const envelope = { maxRequests: 10, maxTokens: 0, maxCostUsd: 0, maxElapsedMs: 10000, maxConcurrency: 1 };
  ledger.allocate('original-parent', envelope); ledger.allocate('original-author', envelope, 'original-parent');
  const authority = { generation: 'old', epoch: 1, controlRevision: 'old-controls' };
  const successor = { generation: 'new', epoch: 3, controlRevision: 'new-controls' };
  store.put('runs', 'original-author', { id: 'original-author', status: 'checkpointed', authority }, null);
  const request = { requestId: 'review', policyDigest: 'old-policy', proposal: { runId: 'original-author', authority } } as EvaluationRequest;
  const options = { store, request, evaluatorId: 'old-checker', evaluatorDigest: identity('old-closure'), maxElapsedMs: 100,
    now: () => 0, assertAuthority: () => {}, dispatchAuthority: (_authority: unknown, operation: () => void) => operation() };
  const first = { ...options, operation: { id: 'first-case', digest: identity('old-private-inputs-and-answers') } };
  const transfer = () => {
    const run = store.get<{ id: string; status: string; authority: typeof authority }>('runs', 'original-author')!;
    store.put('runs', 'original-author', { ...run.value, authority: successor }, run.revision);
    return { ...options, physicalAuthority: successor, continuedFrom: reviewOperationId(first) };
  };
  return { root, store, ledger, options, first, transfer, close: () => { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('audit: failed, reserved and uncertain probes cannot fund a post-transfer signer', async () => {
  for (const status of ['failed', 'reserved', 'uncertain'] as const) {
    const f = continuationFixture(); let launches = 0;
    try {
      if (status === 'reserved') prepareReview(f.first);
      else await assert.rejects(accountedReview(f.first, async gate => {
        if (status === 'uncertain') gate.dispatch(() => {});
        throw Error('retained original failure');
      }), /retained original failure/);
      assert.equal(f.ledger.request(reviewOperationId(f.first))!.status, status);
      const before = f.store.list('requests');
      await assert.rejects(accountedReview(f.transfer(), async gate => { gate.dispatch(() => { launches++; }); }), /original prepared reservation|completed same-review predecessor/);
      assert.equal(launches, 0); assert.deepEqual(f.store.list('requests'), before);
    } finally { f.close(); }
  }
});

test('audit: a succeeded probe cannot authorize another request, policy, run or evaluator after transfer', async () => {
  const f = continuationFixture(); let launches = 0;
  try {
    await accountedReview(f.first, async gate => { gate.dispatch(() => {}); });
    const originalAllocations = f.store.list('allocations');
    const continuation = f.transfer();
    const variants = [
      { ...continuation, request: { ...continuation.request, requestId: 'replayed-as-other-request' } },
      { ...continuation, request: { ...continuation.request, policyDigest: 'replacement-policy' } },
      { ...continuation, request: { ...continuation.request, proposal: { ...continuation.request.proposal, runId: 'another-run' } } },
      { ...continuation, evaluatorId: 'replacement-evaluator' },
      { ...continuation, evaluatorDigest: identity('replacement-closure') },
      { ...continuation, continuedFrom: 'unknown-physical-request' },
    ];
    for (const changed of variants) {
      await assert.rejects(accountedReview(changed, async gate => { gate.dispatch(() => { launches++; }); }), /original prepared reservation|completed same-review predecessor/);
      assert.equal(f.ledger.snapshot('original-parent').requests, 1);
    }
    assert.equal(launches, 0);
    await accountedReview(continuation, async gate => { gate.dispatch(() => { launches++; }); });
    assert.equal(launches, 1); assert.equal(f.ledger.snapshot('original-parent').requests, 2);
    assert.equal(f.ledger.snapshot('original-parent').concurrent, 0);
    assert.deepEqual(f.store.list('allocations'), originalAllocations);
    await assert.rejects(accountedReview(continuation, async gate => { gate.dispatch(() => { launches++; }); }), /already used/);
    assert.equal(launches, 1);
  } finally { f.close(); }
});
