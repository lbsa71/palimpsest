import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OperationalStore } from '../../storage/index.ts';
import { DevelopmentalMemory } from '../index.ts';
import { canonicalJson } from '../../contracts/index.ts';

const at = '2026-10-12T00:00:00.000Z';
const scope = { kind: 'public' as const };
const journal = { stream: 'synthetic:journal', hostId: 'synthetic-host', maxAnchorDocuments: 64, maxAnchorBytes: 100_000 };
for (const mode of ['ordinary', 'journal-before', 'journal-anchor', 'journal-expiry'] as const) {
  test(`logical forgetting removes synthetic content from journal reads and snapshots: ${mode}`, t => {
    const directory = mkdtempSync(join(tmpdir(), 'aeon-journal-forget-'));
    const filename = join(directory, 'state.sqlite');
    let store = new OperationalStore({ filename, ...(mode === 'journal-before' || mode === 'journal-expiry' ? { documentJournal: journal } : {}) });
    t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
    let memory = new DevelopmentalMemory(store, () => at);
    const content = `synthetic-memory-content-${mode}`;
    memory.ingest({ id: 'source', runId: 'run', sourceId: 'input', actorId: 'actor', at, channel: 'speech', scope, content }, mode === 'journal-expiry' ? '2026-10-12T00:01:00.000Z' : null);
    memory.derive({ id: 'derived', sourceIds: ['source'], actorId: 'actor', at, kind: 'belief', scope, content, confidence: 0.5 });
    memory.adoptSelf({ id: 'self', memoryIds: ['derived'], actorId: 'actor', at, scope, category: 'preference', value: content, reason: content }, null);
    if (mode === 'journal-anchor') { store.close(); store = new OperationalStore({ filename, documentJournal: journal }); memory = new DevelopmentalMemory(store, () => at); }
    const forgotten = mode === 'journal-expiry' ? memory.expire('2026-10-12T00:02:00.000Z') : memory.forget(['source']);
    assert.deepEqual(new Set(forgotten), new Set(['source', 'derived']));
    assert.equal(memory.get('source', scope), undefined);
    assert.equal(memory.get('derived', scope), undefined);
    assert.deepEqual(memory.selfHistory('self', scope), []);
    assert.equal(canonicalJson(store.list('development.memories')).includes(content), false);
    store.close(); store = new OperationalStore({ filename });
    const eventLeak = canonicalJson(store.events()).includes(content);
    const snapshotLeak = canonicalJson(store.captureDevelopmentSnapshot({ maxRows: 512, maxBytes: 1_048_576 })).includes(content);
    assert.deepEqual({ eventLeak, snapshotLeak }, { eventLeak: false, snapshotLeak: false });
  });
}
