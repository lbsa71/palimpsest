import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { DevelopmentalMemory } from '../packages/development/index.ts';
import type { MemoryEnvironment } from '../packages/development/environment.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { canonicalJson } from '../packages/contracts/index.ts';

const at = '2026-10-12T00:00:00.000Z', scope = { kind: 'public' as const };
const request = { audience: scope, query: 'shared', maxRecords: 10, maxBytes: 10000 };
const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function fixture(t: TestContext, changes: Partial<MemoryEnvironment> = {}, wallClock = () => at) {
  const directory = mkdtempSync(join(tmpdir(), 'aeon-memory-di-'));
  const store = new OperationalStore({ filename: join(directory, 'state.sqlite'), documentJournal: { stream: 'fixture-journal', hostId: 'fixture-host', maxAnchorDocuments: 64, maxAnchorBytes: 100000 } });
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const environment: MemoryEnvironment = { monotonicNow: () => 0, withdrawalId: () => 'injected-withdrawal', compareIds: lexical, ...changes };
  const memory = new DevelopmentalMemory(store, wallClock, environment);
  const ingest = (id: string, expiresAt: string | null = null) => memory.ingest({ id, at, actorId: 'fixture', runId: 'run', sourceId: `source:${id}`, channel: 'speech', scope, content: 'shared fact' }, expiresAt);
  const snapshot = () => canonicalJson(store.captureDevelopmentSnapshot({ maxRows: 512, maxBytes: 1000000 }));
  return { store, memory, environment, ingest, snapshot };
}

test('memory uses captured receiver-free timing and collation without changing whole-record budget', t => {
  let tick = 10;
  const f = fixture(t, { monotonicNow: function (this: unknown) { assert.equal(this, undefined); const old = tick; tick += 7; return old; }, compareIds: (a, b) => lexical(b, a) });
  f.ingest('a'); f.ingest('b');
  const original = f.snapshot();
  f.environment.monotonicNow = () => { throw Error('late clock'); }; f.environment.compareIds = () => { throw Error('late collation'); };
  const result = f.memory.context({ ...request, maxRecords: 1 });
  assert.deepEqual(result.memories.map(x => x.id), ['b']); assert.equal(result.selection.elapsedMs, 7);
  assert.equal(result.selection.omittedForBudget, 1);
  assert.equal(result.selection.bytes, Buffer.byteLength(canonicalJson({ memories: result.memories, self: result.self })));
  assert.equal(f.snapshot(), original);
});

test('independent memory instances have independent injected durations and collation', t => {
  let a = 0, b = 100;
  const first = fixture(t, { monotonicNow: () => a++ }), second = fixture(t, { monotonicNow: () => { const v = b; b += 12; return v; } });
  first.ingest('item'); second.ingest('item');
  const x = first.memory.context(request), y = second.memory.context(request);
  assert.equal(x.selection.elapsedMs, 1); assert.equal(y.selection.elapsedMs, 12); assert.deepEqual(x.memories, y.memories);
  assert.equal(first.memory.context(request).selection.elapsedMs, 1);
});

for (const mode of ['initial-throw', 'initial-negative', 'initial-infinite', 'end-throw', 'end-nan', 'end-regresses'] as const) {
  test(`memory ${mode} is observable and leaves all retained state unchanged`, t => {
    let reads = 0;
    const f = fixture(t, { monotonicNow: () => {
      reads++;
      if (mode === 'initial-throw' || mode === 'end-throw' && reads === 2) throw Error('injected clock error');
      if (mode === 'initial-negative') return -1; if (mode === 'initial-infinite') return Infinity;
      if (reads === 1) return 10; return mode === 'end-nan' ? NaN : 9;
    } });
    f.ingest('item'); const before = f.snapshot();
    assert.throws(() => f.memory.context(request), /clock error|Invalid memory monotonic|regressed/);
    assert.equal(f.snapshot(), before); assert.equal(reads, mode.startsWith('initial') ? 1 : 2);
  });
}

test('injected wall time drives actual expiry and chosen withdrawal identity', t => {
  let now = at;
  const f = fixture(t, {}, () => now);
  f.ingest('source', '2026-10-12T00:01:00.000Z');
  f.memory.derive({ id: 'derived', sourceIds: ['source'], at, actorId: 'fixture', kind: 'belief', scope, content: 'derived', confidence: 0.5 });
  now = '2026-10-12T00:01:00.000Z'; assert.equal(f.memory.get('source', scope), undefined);
  assert.deepEqual(new Set(f.memory.expire()), new Set(['source', 'derived']));
  const event = f.store.events().find(e => e.id === 'injected-withdrawal')!;
  assert.equal(event.type, 'document-journal-withdrawal'); assert.equal((event.data as { reason: string }).reason, 'expiry');
  assert.equal(f.snapshot().includes('shared fact'), false);
});

for (const mode of ['throws', 'empty', 'collision'] as const) test(`withdrawal ID ${mode} rolls back memories, self, jobs and journal`, t => {
  const f = fixture(t, { withdrawalId: () => { if (mode === 'throws') throw Error('injected ID error'); return mode === 'empty' ? '' : 'collision'; } });
  f.ingest('source');
  f.memory.adoptSelf({ id: 'self', memoryIds: ['source'], actorId: 'fixture', at, scope, category: 'preference', value: 'chosen', reason: 'source' }, null);
  f.memory.scheduleConsolidation('job', ['source'], scope, at);
  if (mode === 'collision') f.store.append({ id: 'collision', stream: 'fixture-journal', type: 'unrelated', data: null });
  const before = f.snapshot();
  assert.throws(() => f.memory.forget(['source']), /ID error|withdrawal id|conflicting withdrawal identity/);
  assert.equal(f.snapshot(), before); assert.ok(f.memory.get('source', scope)); assert.equal(f.memory.selfHistory('self', scope).length, 1);
});

test('captured withdrawal ID and comparator control actual forgetting and tied consolidation selection', t => {
  const f = fixture(t, { compareIds: (a, b) => lexical(b, a) }); f.ingest('source');
  f.memory.scheduleConsolidation('a', ['source'], scope, at); f.memory.scheduleConsolidation('b', ['source'], scope, at);
  assert.equal(f.memory.claimConsolidation('worker', 1000)?.job.id, 'b');
  f.environment.withdrawalId = () => { throw Error('late ID'); };
  assert.deepEqual(f.memory.forget(['source']), ['source']);
  assert.ok(f.store.events().some(e => e.id === 'injected-withdrawal'));
});

test('invalid injected wall time and comparator fail without writing state', t => {
  let now = at;
  const f = fixture(t, { compareIds: () => NaN }, () => now); f.ingest('a', '2026-10-12T00:01:00.000Z'); f.ingest('b');
  const before = f.snapshot(); assert.throws(() => f.memory.context(request), /Invalid memory collation result/);
  now = 'invalid timestamp'; assert.throws(() => f.memory.get('a', scope), /invalid timestamp/);
  assert.throws(() => f.memory.expire(), /invalid timestamp/); assert.equal(f.snapshot(), before);
});
