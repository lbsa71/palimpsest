import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { identity, type PhysicalRequest, type ResourceEnvelope } from '../../contracts/index.ts';
import { EffectJournal } from '../../effects/index.ts';
import { OperationalStore } from '../../storage/index.ts';
import { ResourceLedger } from '../resources/index.ts';
import { DurableRuntime, type CapacityWait } from './index.ts';

const authority = { generation: 'capacity-fixture', epoch: 1, controlRevision: 'fixture' };
const envelope: ResourceEnvelope = { maxRequests: 10, maxTokens: 10000, maxCostUsd: 10, maxElapsedMs: 60000, maxConcurrency: 1 };
const prompt = { id: 'base', requestDigest: identity('base'), fragments: [] };
function gate<T = void>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

function fixture(t: TestContext, uncertain = false) {
  const directory = mkdtempSync(join(tmpdir(), 'aeon-effect-capacity-'));
  const store = new OperationalStore({ filename: join(directory, 'state.sqlite') });
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const resources = new ResourceLedger(store, { tokens: 100, costUsd: 1, elapsedMs: 1000 }, () => 0);
  resources.allocate('root', envelope);
  const entered = gate(), release = gate(), queued = gate<CapacityWait>();
  const calls: string[] = []; let sequence = 0;
  const effects = new EffectJournal(store, { assert() {} }, {
    async dispatch(effect) {
      calls.push(effect.id);
      if (calls.length === 1) { entered.resolve(); await release.promise; }
      return { outcome: uncertain && calls.length === 1 ? 'uncertain' : 'succeeded' };
    }, async reconcile() { throw Error('unexpected reconciliation'); },
  }, () => `effect-${++sequence}`);
  const runtime = new DurableRuntime({ store, resources, effects, now: () => 0, elapsedNow: () => 0, newId: () => `runtime-${++sequence}`,
    shell: { async run({ run }, bridge) {
      // Deliberately omit an explicit signal: runtime cancellation must still
      // reach capacity waiting and the effect receiver through the active run.
      const pending = bridge.execute({ id: run.id, runId: run.id, stepId: 'step', name: 'inspect', arguments: null });
      const wait = store.get<CapacityWait>('execution.capacity-waits', `tool:${run.id}`)?.value;
      if (wait) queued.resolve(wait);
      return { status: 'completed', observations: [await pending] };
    } },
  });
  const admit = (name: string) => runtime.admit({ id: name, source: 'fixture', externalId: name, externalRevision: '1', actorId: 'fixture', authenticated: true, scope: { kind: 'public' }, value: name }, authority, envelope, 'root');
  return { store, resources, effects, runtime, first: admit('first'), second: admit('second'), entered, release, queued, calls };
}

for (const uncertain of [false, true]) test(`effect reservation queues and resumes after receiver returns ${uncertain ? 'uncertain' : 'success'}`, async t => {
  const f = fixture(t, uncertain), first = f.runtime.resume(f.first.id, prompt); await f.entered.promise;
  const second = f.runtime.resume(f.second.id, prompt), waiting = await f.queued.promise;
  assert.equal(waiting.phase, 'reserve'); assert.equal(f.effects.get(waiting.requestId)?.status, 'pending');
  assert.equal(f.resources.request(waiting.requestId), undefined); assert.equal(f.calls.length, 1);
  f.release.resolve(); assert.equal((await first).status, uncertain ? 'blocked' : 'completed'); assert.equal((await second).status, 'completed');
  assert.equal(f.calls.length, 2); assert.equal(new Set(f.calls).size, 2);
  assert.equal(f.resources.snapshot('root').requests, 2); assert.equal(f.resources.snapshot('root').concurrent, 0);
  assert.equal(f.store.list('execution.capacity-waits').length, 0);
  if (uncertain) assert.equal(f.effects.get(`tool:${f.first.id}`)?.status, 'uncertain');
});

test('cancelling a queued command leaves its effect undispatched and clears its wait', async t => {
  const f = fixture(t), first = f.runtime.resume(f.first.id, prompt); await f.entered.promise;
  const second = f.runtime.resume(f.second.id, prompt), waiting = await f.queued.promise;
  f.runtime.cancel(f.second.id, 'fixture', 'stop'); assert.equal((await second).status, 'cancelled');
  assert.equal(f.effects.get(waiting.requestId)?.status, 'pending'); assert.equal(f.resources.request(waiting.requestId), undefined);
  assert.equal(f.store.list('execution.capacity-waits').length, 0);
  f.release.resolve(); await first; assert.equal(f.calls.length, 1);
});

test('host recovery clears stale queue observations without reserving or replaying work', t => {
  const f = fixture(t); const prepared = f.runtime.prepareResume(f.first.id);
  const wait: CapacityWait = { requestId: 'never-reserved', runId: f.first.id, phase: 'reserve', startedAt: 0 };
  f.store.put('execution.capacity-waits', wait.requestId, wait, null);
  assert.deepEqual(f.runtime.recover(), [f.first.id]); assert.equal(f.store.list('execution.capacity-waits').length, 0);
  assert.equal(f.runtime.getRun(f.first.id)?.status, 'waiting'); assert.equal(f.calls.length, 0); assert.equal(f.resources.snapshot('root').requests, 0);
  assert.equal(prepared.run.status, 'running');
});

test('a recovered authorized command waits to reacquire capacity before its first receiver entry', async t => {
  const f = fixture(t), run = f.second;
  const call = { id: run.id, runId: run.id, stepId: 'step', name: 'inspect', arguments: null };
  const id = `tool:${run.id}`;
  const request: PhysicalRequest = { id, runId: run.id, purpose: 'reasoning', provider: 'effect-receiver', model: 'inspect', promptManifestId: id,
    requestDigest: identity(call), reservationId: id, status: 'reserved', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } };
  f.effects.create({ id, runId: run.id, stepId: 'step', kind: 'inspect', payload: null, scope: run.scope, authority, status: 'pending', revision: 0 });
  f.resources.reserve(request); f.effects.authorize(id, id, authority);
  f.resources.releaseConcurrency(id, { kind: 'host-recovery', reason: 'Previous host ended before receiver dispatch' });
  const held: PhysicalRequest = { ...request, id: 'held', reservationId: 'held', runId: f.first.id };
  f.resources.reserve(held); f.resources.dispatched({ ...held, status: 'dispatched' });
  const second = f.runtime.resume(run.id, prompt);
  // Dispatch is async: allow its rejected pre-receiver promise to reach the
  // capacity helper before observing the durable waiting record.
  await Promise.resolve(); await Promise.resolve();
  const waiting = f.store.get<CapacityWait>('execution.capacity-waits', id)?.value;
  assert.equal(waiting?.phase, 'dispatch'); assert.equal(f.effects.get(id)?.status, 'authorized'); assert.equal(f.calls.length, 0);
  f.resources.settle({ ...held, status: 'succeeded' }); await f.entered.promise;
  assert.deepEqual(f.calls, [id]); f.release.resolve(); assert.equal((await second).status, 'completed');
  assert.equal(f.resources.snapshot('root').requests, 2); assert.equal(f.resources.request(id)?.status, 'succeeded');
  assert.equal(f.store.list('execution.capacity-waits').length, 0);
});
