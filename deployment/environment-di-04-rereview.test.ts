import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { canonicalJson, type DataScope } from '../packages/contracts/index.ts';
import { DevelopmentalMemory, type MemoryEntry, type Derivation } from '../packages/development/index.ts';
import type { MemoryEnvironment } from '../packages/development/environment.ts';
import { OperationalStore } from '../packages/storage/index.ts';

const start = '2040-01-02T03:04:05.000Z', expiry = '2040-01-02T03:04:06.000Z';
const publicScope = { kind: 'public' as const };
const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'di04-rereview-'));
  const store = new OperationalStore({ filename: join(directory, 'state.sqlite'), documentJournal: { stream: 'rereview', hostId: 'synthetic', maxAnchorDocuments: 64, maxAnchorBytes: 100000 } });
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  let wall = start, id = 0;
  const environment: MemoryEnvironment = { monotonicNow: () => 0, compareIds: lexical, withdrawalId: () => `rereview:${++id}` };
  const memory = new DevelopmentalMemory(store, () => wall, environment);
  return { store, memory, environment, setWall(value: string) { wall = value; }, snapshot: () => canonicalJson(store.captureDevelopmentSnapshot({ maxRows: 512, maxBytes: 1000000 })) };
}
function ingest(memory: DevelopmentalMemory, id: string, expiresAt: string | null = expiry, scope: DataScope = publicScope) {
  memory.ingest({ id, runId: 'run', sourceId: `input:${id}`, actorId: 'reviewer', at: start, channel: 'speech', scope, content: `retained:${id}` }, expiresAt);
}
function output(id: string): Derivation {
  return { id, kind: 'belief', sourceIds: ['source'], actorId: 'reviewer', at: start, scope: publicScope, content: id, confidence: 0.5 };
}
function caught(fn: () => unknown): unknown {
  try { fn(); } catch (error) { return error; }
  assert.fail('operation unexpectedly succeeded');
}
// An explicitly supplied forwarding Store adapter, never a mutation of the Store or its prototype.
function forwardingStore(store: OperationalStore, before: (method: PropertyKey, args: unknown[]) => void, after: (method: PropertyKey, args: unknown[]) => void = () => {}) {
  return new Proxy(store, { get(target, method) {
    const value: unknown = Reflect.get(target, method, target);
    if (typeof value !== 'function') return value;
    return (...args: unknown[]) => { before(method, args); const result: unknown = Reflect.apply(value, target, args); after(method, args); return result; };
  } });
}

test('rereview: explicit offsets and all repaired fractional precisions preserve the same expiry instant', t => {
  const f = fixture(t); ingest(f.memory, 'source'); const before = f.snapshot();
  for (const value of ['2040-01-02T03:04:05Z', '2040-01-02T03:04:05.0Z', '2040-01-02T03:04:05.00Z', '2040-01-02T08:49:05.000+05:45', '2040-01-01T23:34:05-03:30', '+002040-01-02T03:04:05.000Z']) {
    f.setWall(value); assert.ok(f.memory.get('source', publicScope), value);
  }
  for (const value of ['2040-01-02T08:49:06+05:45', '2040-01-01T23:34:06.000-03:30', '+002040-01-02T03:04:06.0Z']) {
    f.setWall(value); assert.equal(f.memory.get('source', publicScope), undefined, value);
  }
  assert.equal(f.snapshot(), before);
});

test('rereview: a negative extended year is a valid explicit-zone wall reading', t => {
  const f = fixture(t); f.setWall('-000001-01-01T00:00:00Z');
  f.memory.ingest({ id: 'ancient', runId: 'run', sourceId: 'input', actorId: 'reviewer', at: '-000001-01-01T00:00:00Z', channel: 'speech', scope: publicScope, content: 'ancient' }, '-000001-01-01T00:00:01Z');
  assert.ok(f.memory.get('ancient', publicScope)); f.setWall('-000001-01-01T00:00:01Z');
  assert.deepEqual(f.memory.expire(), ['ancient']);
});

test('rereview: malformed or non-string wall values cannot expire retained state or claim queued work', t => {
  const f = fixture(t); ingest(f.memory, 'source'); f.memory.scheduleConsolidation('job', ['source'], publicScope, start);
  const before = f.snapshot();
  for (const value of [null, 0, {}, '2040-01-02T03:04:05+01', '2040-01-02T03:04:05+0100', '2040-01-02T03:04:05+24:00', '2040-01-02T03:04:05+00:60', '2040-01-02T25:04:05Z', '2040-01-02T03:04:05.0000Z', '2040-01-02T03:04:05Z\n']) {
    const memory = new DevelopmentalMemory(f.store, () => value as string, f.environment);
    assert.match(String(caught(() => memory.expire())), /timestamp/i);
    assert.match(String(caught(() => memory.claimConsolidation('worker', 100))), /timestamp/i);
    assert.equal(f.snapshot(), before);
  }
});

for (const site of ['source-read', 'job-list', 'after-cancel-write', 'after-lease-write'] as const) test(`rereview: Store ${site} failure preserves identity and the complete multi-job transaction`, t => {
  const f = fixture(t); ingest(f.memory, 'missing'); ingest(f.memory, 'valid');
  f.memory.scheduleConsolidation('a-missing', ['missing'], publicScope, start);
  f.memory.scheduleConsolidation('b-valid', ['valid'], publicScope, start);
  f.store.delete('development.memories', 'missing', 1);
  const before = f.snapshot(), failure = Object.freeze({ site, reason: 'synthetic Store outage' }); let armed = true, observed = 0;
  const supplied = forwardingStore(f.store, (method, args) => {
    if (armed && ((site === 'source-read' && method === 'get' && args[0] === 'development.memories' && args[1] === 'valid') || (site === 'job-list' && method === 'list' && args[0] === 'development.jobs'))) { observed++; throw failure; }
  }, (method, args) => {
    if (armed && method === 'put' && args[0] === 'development.jobs' && ((site === 'after-cancel-write' && args[1] === 'a-missing') || (site === 'after-lease-write' && args[1] === 'b-valid'))) {
      // The real SQLite write and its journal mutation have actually occurred before the fault.
      assert.notEqual(f.snapshot(), before); observed++; throw failure;
    }
  });
  const memory = new DevelopmentalMemory(supplied, () => start, f.environment);
  assert.equal(caught(() => memory.claimConsolidation('worker', 100)), failure);
  assert.equal(observed, 1); assert.equal(f.snapshot(), before);
  armed = false; assert.equal(memory.claimConsolidation('worker', 100)?.job.id, 'b-valid');
  assert.deepEqual(memory.jobs(publicScope).map(job => [job.id, job.state, job.attempts]), [['a-missing', 'cancelled', 0], ['b-valid', 'running', 1]]);
});

for (const reason of ['missing', 'forgotten', 'expired', 'scope', 'revised'] as const) test(`rereview: authentic ${reason} source cancels its job and permits the next eligible claim`, t => {
  const f = fixture(t); ingest(f.memory, 'stale'); ingest(f.memory, 'valid', '2040-01-02T03:04:07Z');
  f.memory.scheduleConsolidation('a-stale', ['stale'], publicScope, start);
  f.memory.scheduleConsolidation('b-valid', ['valid'], publicScope, start);
  const entry = f.store.get<MemoryEntry>('development.memories', 'stale')!;
  if (reason === 'missing') f.store.delete('development.memories', 'stale', entry.revision);
  else if (reason === 'expired') f.setWall(expiry);
  else {
    const record = { ...entry.value.record, revision: reason === 'revised' ? 2 : entry.value.record.revision };
    if (reason === 'forgotten') { record.status = 'forgotten'; record.content = null; record.confidence = null; }
    if (reason === 'scope') record.scope = { kind: 'restricted', principals: ['private-owner'] };
    f.store.put('development.memories', 'stale', { ...entry.value, record }, entry.revision);
  }
  assert.equal(f.memory.claimConsolidation('worker', 100)?.job.id, 'b-valid');
  const stale = f.memory.jobs(publicScope).find(job => job.id === 'a-stale')!;
  assert.equal(stale.state, 'cancelled'); assert.equal(stale.error, 'source unavailable or revised'); assert.equal(stale.attempts, 0);
});

for (const mode of ['throw', 'ambiguous'] as const) test(`rereview: a ${mode} wall failure after one output rolls back consolidation and supports retry`, t => {
  const f = fixture(t); ingest(f.memory, 'source'); f.memory.scheduleConsolidation('job', ['source'], publicScope, start);
  const claim = f.memory.claimConsolidation('worker', 500)!; const before = f.snapshot();
  const failure = Symbol('later output wall failure'); let armed = true, firstOutputSeen = false;
  const memory = new DevelopmentalMemory(f.store, () => {
    if (armed && f.store.get('development.memories', 'output-one')) {
      firstOutputSeen = true;
      if (mode === 'throw') throw failure;
      return '2040-01-02T03:04:05';
    }
    return start;
  }, f.environment);
  const error = caught(() => memory.completeConsolidation(claim, [output('output-one'), output('output-two')]));
  assert.equal(firstOutputSeen, true); if (mode === 'throw') assert.equal(error, failure); else assert.match(String(error), /timestamp/);
  assert.equal(f.snapshot(), before); armed = false;
  assert.equal(memory.completeConsolidation(claim, [output('output-one'), output('output-two')]).state, 'completed');
  assert.ok(memory.get('output-one', publicScope)); assert.ok(memory.get('output-two', publicScope));
});

test('rereview: current-use checks propagate a Store outage and subsequently reject a removed leased source', t => {
  const f = fixture(t); ingest(f.memory, 'source'); f.memory.scheduleConsolidation('job', ['source'], publicScope, start);
  const claim = f.memory.claimConsolidation('worker', 500)!, before = f.snapshot(), failure = new Error('current-use Store unavailable');
  let armed = true;
  const supplied = forwardingStore(f.store, (method, args) => { if (armed && method === 'get' && args[0] === 'development.memories') throw failure; });
  const memory = new DevelopmentalMemory(supplied, () => start, f.environment);
  assert.equal(caught(() => memory.consolidationSources(claim)), failure); assert.equal(f.snapshot(), before);
  armed = false; assert.equal(memory.consolidationSources(claim)[0]!.id, 'source');
  f.store.delete('development.memories', 'source', 1); const removed = f.snapshot();
  assert.throws(() => memory.consolidationSources(claim), /source unavailable/);
  assert.throws(() => memory.completeConsolidation(claim, [output('forbidden')]), /source unavailable/);
  assert.equal(f.snapshot(), removed);
});

test('rereview: captured receiver-free collation chooses due ties and a primitive withdrawal fault remains atomic', t => {
  const f = fixture(t); let failId = true, ticks = 0;
  const failure = Symbol('withdrawal unavailable');
  const ports: MemoryEnvironment = {
    monotonicNow: function (this: unknown) { assert.equal(this, undefined); return ticks++; },
    compareIds: function (this: unknown, a, b) { assert.equal(this, undefined); return lexical(b, a); },
    withdrawalId: function (this: unknown) { assert.equal(this, undefined); if (failId) throw failure; return 'captured-success'; },
  };
  const memory = new DevelopmentalMemory(f.store, function (this: unknown) { assert.equal(this, undefined); return start; }, ports);
  ports.monotonicNow = ports.withdrawalId = ports.compareIds = () => { throw Error('replaced callback'); };
  for (const id of ['a', 'z']) { ingest(memory, id); memory.scheduleConsolidation(id, [id], publicScope, start); }
  assert.equal(memory.claimConsolidation('worker', 100)?.job.id, 'z');
  const before = f.snapshot(); assert.equal(caught(() => memory.forget(['z'])), failure); assert.equal(f.snapshot(), before);
  failId = false; assert.deepEqual(memory.forget(['z']), ['z']);
  assert.ok(f.store.events().some(event => event.id === 'captured-success'));
  const context = memory.context({ audience: publicScope, query: '', maxRecords: 8, maxBytes: 8192 });
  assert.equal(context.selection.elapsedMs, 1); assert.deepEqual(context.memories.map(record => record.id), ['a']);
});
