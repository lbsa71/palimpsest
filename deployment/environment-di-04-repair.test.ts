import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { OperationalStore } from '../packages/storage/index.ts';
import { DevelopmentalMemory } from '../packages/development/index.ts';
import { canonicalJson } from '../packages/contracts/index.ts';

for (const mode of ['throw', 'ambiguous'] as const) test(`a later ${mode} wall fault rolls back earlier legitimate cancellation and permits authentic retry`, t => {
  const directory = mkdtempSync(join(tmpdir(), 'memory-clock-repair-'));
  const store = new OperationalStore({ filename: join(directory, 'state.sqlite'), documentJournal: { stream: 'repair', hostId: 'host', maxAnchorDocuments: 64, maxAnchorBytes: 100000 } });
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const start = '2040-01-01T00:00:00.000Z', later = '2040-01-01T00:00:02.000Z', scope = { kind: 'public' as const };
  let phase: 'setup' | 'fault' | 'retry' = 'setup', reads = 0;
  const failure = Error('late wall supplier failed');
  const memory = new DevelopmentalMemory(store, () => {
    if (phase === 'setup') return start;
    if (phase === 'retry' || ++reads < 3) return later;
    if (mode === 'throw') throw failure;
    return '2040-01-01T00:00:02';
  }, { monotonicNow: () => 0, withdrawalId: () => 'withdrawal', compareIds: (a, b) => a < b ? -1 : a > b ? 1 : 0 });
  for (const [id, expires] of [['a', '2040-01-01T00:00:01.000Z'], ['b', '2040-01-01T00:00:03.000Z']]) {
    memory.ingest({ id, runId: 'run', sourceId: `source:${id}`, actorId: 'fixture', at: start, channel: 'speech', scope, content: id }, expires);
    memory.scheduleConsolidation(id, [id], scope, start);
  }
  const snapshot = () => canonicalJson(store.captureDevelopmentSnapshot({ maxRows: 512, maxBytes: 1000000 }));
  const before = snapshot(); phase = 'fault';
  let caught: unknown;
  try { memory.claimConsolidation('worker', 500); } catch (error) { caught = error; }
  if (mode === 'throw') assert.equal(caught, failure); else assert.match(String(caught), /ISO timestamp/);
  assert.equal(reads, 3); assert.equal(snapshot(), before);
  for (const id of ['a', 'b']) assert.equal(store.get<{ state: string }>('development.jobs', id)!.value.state, 'pending');
  phase = 'retry'; assert.equal(memory.claimConsolidation('worker', 500)!.job.id, 'b');
  assert.equal(store.get<{ state: string }>('development.jobs', 'a')!.value.state, 'cancelled');
  assert.equal(store.get<{ state: string }>('development.jobs', 'b')!.value.state, 'running');
});
