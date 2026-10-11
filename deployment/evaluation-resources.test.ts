import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { identity, type PhysicalRequest } from '../packages/contracts/index.ts';
import { ResourceLedger } from '../packages/runtime/resources/index.ts';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { accountedReview, assertReviewLineage, prepareReview, recoverReviewReservations, reviewPhysicalId } from './evaluation-resources.ts';
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
  const options = { store, request, evaluatorDigest: identity('closure'), evaluatorId: 'qualified-offline-fixture', maxElapsedMs: 1000, assertAuthority: () => {}, dispatchAuthority: (_grant: unknown, operation: () => void) => operation(), now: () => now };
  return { directory, filename, store, ledger, options, setTime: (value: number) => { now = value; }, close: () => { store.close(); rmSync(directory, { recursive: true, force: true }); } };
}
test('canceled/expired reviewer lineage dispatches zero physical operations', async () => {
  for (const cancellation of ['allocation', 'run', 'expiry']) {
    const f = fixture(); let spawns = 0;
    try {
      if (cancellation === 'allocation') f.ledger.cancel('parent');
      if (cancellation === 'run') { const row = f.store.get<any>('runs', 'child')!; f.store.put('runs', 'child', { ...row.value, status: 'cancelled' }, row.revision); }
      if (cancellation === 'expiry') f.setTime(10001);
      await assert.rejects(accountedReview(f.options, async gate => { gate.dispatch(() => { spawns++; }); }), /cancelled|expired/);
      assert.equal(spawns, 0); assert.equal(f.ledger.request(reviewPhysicalId('stable-job')), undefined);
    } finally { f.close(); }
  }
});
test('active tool receiver concurrency is retained; reviewer cannot silently borrow a slot', async () => {
  const f = fixture(1); let spawns = 0;
  try {
    const effect: PhysicalRequest = { id: 'tool:wait', runId: 'child', purpose: 'reasoning', provider: 'effect-receiver', model: 'candidate_evaluate', promptManifestId: 'tool:wait', requestDigest: identity('wait'), reservationId: 'tool:wait', status: 'reserved', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } };
    f.ledger.reserve(effect); f.ledger.dispatched({ ...effect, status: 'dispatched' });
    await assert.rejects(accountedReview(f.options, async gate => { gate.dispatch(() => { spawns++; }); }), /budget exhausted|allocation exhausted/);
    assert.equal(spawns, 0); assert.equal(f.ledger.request(effect.id)!.status, 'dispatched');
  } finally { f.close(); }
});
test('last-moment cancellation before launch is known undispatched; successful physical usage is measured', async () => {
  const f = fixture(); let spawns = 0;
  try {
    await assert.rejects(accountedReview(f.options, async gate => { f.ledger.cancel('child'); gate.dispatch(() => { spawns++; }); }), /cancelled/);
    assert.equal(spawns, 0); assert.equal(f.ledger.request(reviewPhysicalId('stable-job'))!.status, 'failed');
    assert.equal(f.ledger.snapshot('parent').elapsedMs, 0);
  } finally { f.close(); }
  const success = fixture();
  try {
    assert.equal(await accountedReview(success.options, async gate => { gate.dispatch(() => {}); success.setTime(17); return 'signed result'; }), 'signed result');
    const physical = success.ledger.request(reviewPhysicalId('stable-job'))!;
    assert.equal(physical.purpose, 'review'); assert.equal(physical.status, 'succeeded'); assert.equal(physical.usage.elapsedMs, 17);
    assert.equal(success.ledger.snapshot('parent').requests, 1); assert.equal(success.ledger.snapshot('parent').concurrent, 0);
  } finally { success.close(); }
});
test('cancel during asynchronous physical review aborts it and retains unknown charged concurrency', async () => {
  const f = fixture(); let spawns = 0;
  try {
    const reviewing = accountedReview(f.options, async gate => {
      gate.dispatch(() => { spawns++; });
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

test('physical launch holds both authority and cancellation write locks across another process', async () => {
  const f = fixture(), authorityPath = join(f.directory, 'authority.sqlite'), authorities = new AuthorityStore(authorityPath);
  const grant = authorities.bootstrap('author', 'prior', 'artifact');
  try {
    const options = { ...f.options, assertAuthority: (authority: typeof grant) => authorities.assert(authority),
      dispatchAuthority: (authority: typeof grant, operation: () => void) => authorities.dispatch(authority, operation) };
    let launches = 0;
    await accountedReview(options, async gate => {
      gate.dispatch(() => {
        launches++;
        const observer = spawnSync(process.execPath, ['--input-type=module', '--eval', `
          import { DatabaseSync } from 'node:sqlite';
          const observerDb = new DatabaseSync(process.argv[2]);
          const row = observerDb.prepare('SELECT value FROM documents WHERE namespace=? AND key=?').get('requests', process.argv[3]);
          const status = JSON.parse(row.value).request.status; observerDb.close();
          const locks = process.argv.slice(1, 3).map(path => {
            const db = new DatabaseSync(path); db.exec('PRAGMA busy_timeout=1');
            try { db.exec('BEGIN IMMEDIATE'); db.exec('ROLLBACK'); return false; }
            catch (error) { if (!/locked/.test(error.message)) throw error; return true; }
            finally { db.close(); }
          });
          process.stdout.write(JSON.stringify({ status, locks }));
        `, authorityPath, f.filename, reviewPhysicalId('stable-job')], { encoding: 'utf8', env: {} });
        assert.equal(observer.status, 0, observer.stderr);
        assert.deepEqual(JSON.parse(observer.stdout), { status: 'dispatched', locks: [true, true] });
      });
    });
    assert.equal(launches, 1);
    authorities.withdraw(grant);
    const request = { ...f.options.request, requestId: 'revoked-job' };
    await assert.rejects(accountedReview({ ...options, request }, async gate => { gate.dispatch(() => { launches++; }); }), /withdrawn/);
    assert.equal(launches, 1);
  } finally { authorities.close(); f.close(); }
});
test('canceled late result cannot advance a receipt, while known physical usage remains retained', async () => {
  const f = fixture();
  try {
    await accountedReview(f.options, async gate => { gate.dispatch(() => {}); f.setTime(17); });
    f.ledger.cancel('parent'); let accepted = false;
    assert.throws(() => f.store.transaction(() => { assertReviewLineage(f.store, f.options.request, () => 17); accepted = true; }), /cancelled/);
    assert.equal(accepted, false);
    assert.equal(f.ledger.request(reviewPhysicalId('stable-job'))!.status, 'succeeded');
    assert.equal(f.ledger.snapshot('parent').elapsedMs, 17);
  } finally { f.close(); }
});

test('prepared probation retains the original judge and allocation clock after serving authority changes', async () => {
  const f = fixture();
  const successor = { generation: 'successor', epoch: 3, controlRevision: 'next' };
  try {
    const allocation = f.store.get('allocations', 'child');
    prepareReview(f.options); f.setTime(70);
    const row = f.store.get<any>('runs', 'child')!;
    f.store.put('runs', 'child', { ...row.value, authority: successor, status: 'checkpointed' }, row.revision);
    const seen: unknown[] = [];
    await accountedReview({ ...f.options, prepared: true, physicalAuthority: successor,
      assertAuthority: value => { assert.deepEqual(value, successor); seen.push(value); },
      dispatchAuthority: (value, operation) => { assert.deepEqual(value, successor); operation(); },
    }, async gate => { gate.dispatch(() => {}); f.setTime(90); });
    assert.ok(seen.length > 0); assert.equal(f.options.request.proposal.authority.generation, 'author');
    const physical = f.ledger.request(reviewPhysicalId('stable-job'))!;
    assert.equal(physical.usage.elapsedMs, 90, 'Activation time is charged without resetting the review clock');
    assert.equal(physical.requestDigest, identity(f.options.request));
    assert.deepEqual(f.store.get('allocations', 'child'), allocation);
    assert.equal(f.ledger.snapshot('parent').requests, 1);
    await assert.rejects(accountedReview({ ...f.options, prepared: true, physicalAuthority: successor }, async () => {}), /unused prepared/);
  } finally { f.close(); }
});

test('prepared review cannot change its bound request, reviewer or elapsed allowance', async () => {
  for (const change of ['request', 'reviewer', 'elapsed'] as const) {
    const f = fixture(); let launches = 0;
    try {
      prepareReview(f.options);
      const options = { ...f.options, prepared: true,
        ...(change === 'request' ? { request: { ...f.options.request, policyDigest: 'other-policy' } } : {}),
        ...(change === 'reviewer' ? { evaluatorDigest: identity('other-reviewer') } : {}),
        ...(change === 'elapsed' ? { maxElapsedMs: 2000 } : {}),
      };
      await assert.rejects(accountedReview(options, async gate => { gate.dispatch(() => { launches++; }); }), /unused prepared/);
      assert.equal(launches, 0); assert.equal(f.ledger.request(reviewPhysicalId('stable-job'))!.status, 'reserved');
    } finally { f.close(); }
  }
});

test('a concurrent claimant cannot settle another prepared review or release its live physical slot', async () => {
  const f = fixture(1); let launches = 0, entered = 0;
  let releaseSetup!: () => void, releaseReview!: () => void;
  const setup = new Promise<void>(resolve => { releaseSetup = resolve; });
  const completion = new Promise<void>(resolve => { releaseReview = resolve; });
  try {
    prepareReview(f.options);
    const first = accountedReview({ ...f.options, prepared: true }, async gate => {
      entered++; await setup; gate.dispatch(() => { launches++; }); await completion;
    });
    const duplicate = accountedReview({ ...f.options, prepared: true }, async gate => {
      entered++; await setup; gate.dispatch(() => { launches++; });
    });
    const rejected = assert.rejects(duplicate, /claimed|unused prepared/);
    releaseSetup();
    try {
      await rejected;
      assert.equal(entered, 1, 'Only the durable owner may prepare a physical operation');
      assert.equal(launches, 1);
      assert.equal(f.ledger.request(reviewPhysicalId('stable-job'))!.status, 'dispatched');
      assert.equal(f.ledger.snapshot('child').concurrent, 1);
    } finally { releaseReview(); await first; }
    assert.equal(f.ledger.request(reviewPhysicalId('stable-job'))!.status, 'succeeded');
  } finally { f.close(); }
});

test('prepared review cancellation, expiry and process recovery never grant a fresh attempt', async () => {
  for (const cause of ['cancel', 'expire', 'recover'] as const) {
    const f = fixture(); let launches = 0;
    try {
      prepareReview(f.options);
      if (cause === 'cancel') f.ledger.cancel('parent');
      if (cause === 'expire') f.setTime(1001);
      if (cause === 'recover') recoverReviewReservations(f.store);
      await assert.rejects(accountedReview({ ...f.options, prepared: true }, async gate => { gate.dispatch(() => { launches++; }); }), /cancelled|deadline|unused prepared/);
      assert.equal(launches, 0); assert.equal(f.ledger.request(reviewPhysicalId('stable-job'))!.status, 'failed');
      assert.equal(f.ledger.snapshot('parent').requests, 1);
      assert.throws(() => prepareReview(f.options), /cancelled|expired|already used/);
    } finally { f.close(); }
  }
});
