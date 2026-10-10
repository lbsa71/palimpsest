import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { ReleasePublication } from '../src/release-publication.ts';
import { Store } from '../src/store.ts';
import { EvolutionScheduler } from '../src/evolution-scheduler.ts';

test('queue selectors ignore unrelated large payload decoding and observe chronological later updates', () => {
  const dir = mkdtempSync(join(tmpdir(), 'journal-selectors-')); const store = new Store(join(dir, 'state.sqlite'));
  try {
    store.appendEvent('evolution.queue.enqueued', { id: 'one', growthId: 'g', proposalDigest: 'p' });
    for (let i = 0; i < 100; i++) store.appendEvent('evolution.provider_request', { unrelatedLargeHistory: 'x'.repeat(120_000) });
    store.appendEvent('evolution.queue.claimed', { id: 'one' });
    const queue = new EvolutionScheduler({ store, hasUserWork: () => false, phase: () => 'normal', run: async () => { throw new Error('No execution'); } });
    const parse = JSON.parse; let unrelatedDecoded = 0;
    JSON.parse = ((text: string, ...args: unknown[]) => { if (text.includes('unrelatedLargeHistory')) unrelatedDecoded++; return Reflect.apply(parse, JSON, [text, ...args]); }) as typeof JSON.parse;
    try {
      assert.equal(queue.items()[0]?.state, 'running');
      store.appendEvent('evolution.queue.observed', { id: 'one', result: { status: 'declined', reason: 'recorded', calls: 2 } });
      store.appendEvent('evolution.queue.claimed', { id: 'one' });
      assert.equal(queue.items()[0]?.state, 'finished');
      assert.equal(queue.items()[0]?.result?.calls, 2);
      assert.equal(unrelatedDecoded, 0, 'Recurring queue selection must not decode unrelated provider history');
    } finally { JSON.parse = parse; }
    assert.equal(store.listEvents().length, 104);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('type and literal-prefix selection intersects task/cursor scope and sees fresh writes after reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'journal-filter-')); const path = join(dir, 'state.sqlite'); let store = new Store(path);
  try {
    const first = store.appendEvent('growth.future_%', { version: 1 }, 'one');
    store.appendEvent('Growth.future_%', { uppercase: true }, 'one');
    const second = store.appendEvent('growth.future_%', { version: 2 }, 'two');
    const third = store.appendEvent('growth.future_%', { version: 3 }, 'one');
    store.appendEvent('growth.future_AX', null, 'one');
    assert.deepEqual(store.listEvents({ typePrefix: 'growth.future_%' }), store.listEvents().filter(e => e.type.startsWith('growth.future_%')));
    assert.deepEqual(store.listEvents({ types: ['growth.future_%', 'growth.future_%'], taskId: 'one', after: first.seq }), [third]);
    assert.deepEqual(store.listEvents({ types: ['growth.future_%'], typePrefix: 'Growth.' }), []);
    assert.deepEqual(store.listEvents({ types: [] }), []);
    assert.deepEqual(store.listEvents({ typePrefix: '' }), store.listEvents());
    const unicode = store.appendEvent('growth.éfuture', { unicode: true });
    assert.deepEqual(store.listEvents({ typePrefix: 'growth.é' }), [unicode]);
    assert.throws(() => store.listEvents({ typePrefix: 'growth.é\0different' }), /prefix/);
    assert.deepEqual(store.listEvents({ types: ['growth.future_%'], taskId: 'two' }), [second]);
    const other = new Store(path);
    try { const added = other.appendEvent('growth.future_%', { fresh: true }, 'one'); assert.deepEqual(store.listEvents({ types: ['growth.future_%'], after: third.seq }), [added]); }
    finally { other.close(); }
    const expected = store.listEvents({ types: ['growth.future_%'] }); store.close(); store = new Store(path);
    assert.deepEqual(store.listEvents({ types: ['growth.future_%'] }), expected);
    assert.throws(() => store.listEvents({ types: [null] as unknown as string[] }), /types/);
    assert.throws(() => store.listEvents({ typePrefix: null as unknown as string }), /prefix/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});


test('selective reads reject malformed relevant payloads without decoding unrelated corruption; full audit still rejects', () => {
  const dir = mkdtempSync(join(tmpdir(), 'journal-malformed-')); const path = join(dir, 'state.sqlite'); const store = new Store(path);
  try {
    const selected = store.appendEvent('selected', { retained: true });
    const raw = new DatabaseSync(path);
    try { raw.prepare('INSERT INTO journal(type,payload,created_at) VALUES (?,?,?)').run('unrelated', '{broken', '2026-10-10T00:00:00Z'); }
    finally { raw.close(); }
    assert.deepEqual(store.listEvents({ types: ['selected'] }), [selected]);
    assert.throws(() => store.listEvents({ types: ['unrelated'] }), SyntaxError);
    assert.throws(() => store.listEvents(), SyntaxError);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('selectors reject ill-formed Unicode rather than normalizing exact types or splitting astral prefixes', () => {
  const store = new Store(':memory:');
  try {
    const replacement = store.appendEvent('replacement.\uFFFD', { retained: true });
    const astral = store.appendEvent('growth.😀future', { retained: true });
    assert.throws(() => store.listEvents({ types: ['replacement.\uD800'] }), /well-formed/);
    assert.throws(() => store.listEvents({ types: ['replacement.\uDC00'] }), /well-formed/);
    assert.throws(() => store.listEvents({ typePrefix: 'growth.\uD83D' }), /well-formed/);
    assert.throws(() => store.listEvents({ typePrefix: 'growth.\uDE00' }), /well-formed/);
    assert.deepEqual(store.listEvents({ types: ['replacement.\uFFFD'] }), [replacement]);
    assert.deepEqual(store.listEvents({ typePrefix: 'growth.😀' }), [astral]);
    assert.deepEqual(store.listEvents(), [replacement, astral]);
  } finally { store.close(); }
});

test('publication pending follows the latest exact result without parsing unrelated provider history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'journal-publication-')); const store = new Store(join(dir, 'state.sqlite'));
  try {
    const publication = new ReleasePublication({ store, authorize: () => false, publisher: { publish: async () => { throw new Error('No external publication'); } } });
    const item = { id: 'run', growthId: 'g', proposalDigest: 'p', state: 'finished' as const, result: { status: 'promoted' as const, reason: 'recorded', calls: 4 } };
    store.appendEvent('release.publication.result', { runId: 'run', result: { status: 'published' } });
    store.appendEvent('evolution.provider_request', { unrelatedLargeHistory: 'x'.repeat(12_000_000) });
    const parse = JSON.parse; let unrelatedDecoded = 0;
    JSON.parse = ((text: string, ...args: unknown[]) => { if (text.includes('unrelatedLargeHistory')) unrelatedDecoded++; return Reflect.apply(parse, JSON, [text, ...args]); }) as typeof JSON.parse;
    try {
      assert.equal(publication.pending([item]), false);
      store.appendEvent('release.publication.result', { runId: 'other', result: { status: 'uncertain' } });
      assert.equal(publication.pending([item]), false);
      store.appendEvent('release.publication.result', { runId: 'run', result: { status: 'uncertain' } });
      assert.equal(publication.pending([item]), true);
      assert.equal(unrelatedDecoded, 0);
    } finally { JSON.parse = parse; }
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('published and backed-off reconciliation avoids unused heavy reports without replaying publication', async () => {
  const store = new Store(':memory:'); let publications = 0;
  try {
    const publication = new ReleasePublication({ store, now: () => 100, authorize: () => false,
      publisher: { publish: async () => { publications++; throw new Error('No replay'); } } });
    const item = { id: 'run', growthId: 'g', proposalDigest: 'p', state: 'finished' as const, result: { status: 'promoted' as const, reason: 'recorded', calls: 4 } };
    store.appendEvent('evolution.finished', { runId: 'run', unusedHeavyReport: 'x'.repeat(12_000_000) });
    store.appendEvent('release.publication.result', { runId: 'run', result: { status: 'published' } });
    const parse = JSON.parse; let reportsDecoded = 0;
    JSON.parse = ((text: string, ...args: unknown[]) => { if (text.includes('unusedHeavyReport')) reportsDecoded++; return Reflect.apply(parse, JSON, [text, ...args]); }) as typeof JSON.parse;
    try {
      await publication.reconcile([item]);
      store.appendEvent('release.publication.result', { runId: 'run', result: { status: 'uncertain' }, nextObservationAt: 101 });
      await publication.reconcile([item]);
      assert.equal(publications, 0); assert.equal(reportsDecoded, 0);
      assert.equal(publication.result('run')?.status, 'uncertain');
    } finally { JSON.parse = parse; }
  } finally { store.close(); }
});
