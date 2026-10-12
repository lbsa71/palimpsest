import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { OperationalStore, RevisionConflict, DOCUMENT_JOURNAL_NAMESPACE, type DocumentJournalOptions, type EventInput } from '../index.ts';
import { AutarkApplication } from '../../../deployment/application.ts';
import type { ApplicationConfig } from '../../../deployment/config.ts';
import { AuthorityStore } from '../../supervisor/authority.ts';

const journal: DocumentJournalOptions = { stream: 'review:host', hostId: 'independent-review', maxAnchorDocuments: 50, maxAnchorBytes: 100_000 };
const bounds = { maxRows: 512, maxBytes: 1_048_576 };
function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'aeon-journal-review-')), filename = join(root, 'state.sqlite');
  const stores: OperationalStore[] = [];
  t.after(() => { for (const store of stores.reverse()) store.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, filename, open(option?: DocumentJournalOptions | null, path = filename) { const store = new OperationalStore({ filename: path, documentJournal: option }); stores.push(store); return store; }, sql(fn: (db: DatabaseSync) => void) { const db = new DatabaseSync(filename); try { fn(db); } finally { db.close(); } } };
}

for (const reserved of ['document-mutation', 'document-journal-anchor']) for (const fault of ['data-getter', 'type-getter'] as const) test(`generic append cannot forge ${reserved} through ${fault} side effects`, t => {
  const store = fixture(t).open(journal);
  store.append({ id: 'ordinary', stream: 'review', type: 'observation', data: { retained: true } });
  const before = store.captureDevelopmentSnapshot(bounds);
  let reads = 0;
  const event: EventInput = fault === 'data-getter'
    ? { id: 'forged', stream: journal.stream, type: 'observation', get data() { this.type = reserved; return { hostId: journal.hostId, schema: 'aeon.document-journal.v1' }; } }
    : { id: 'forged', stream: journal.stream, get type() { return ++reads <= 2 ? 'observation' : reserved; }, data: { hostId: journal.hostId, schema: 'aeon.document-journal.v1' } };
  try { store.append(event); } catch (error) { assert.match(String(error), /reserved/); }
  const after = store.captureDevelopmentSnapshot(bounds);
  assert.equal(after.events.filter(e => e.type === reserved).length, before.events.filter(e => e.type === reserved).length, 'generic caller minted a reserved host event');
  assert.deepEqual(after.documents, before.documents);
});

test('committed transitions remain reconstructable through delete/recreate, stale CAS and caught event failure', t => {
  const f = fixture(t), early = f.open(); early.put('memory', 'x', 'anchor', null);
  const store = f.open(journal), binding = store.documentJournalBinding()!;
  early.put('memory', 'x', 'intermediate', 1);
  const before = store.captureDevelopmentSnapshot(bounds);
  f.sql(db => db.exec("CREATE TRIGGER fail_event BEFORE INSERT ON events WHEN NEW.type='document-mutation' BEGIN SELECT RAISE(ABORT,'retained review fault'); END"));
  store.transaction(() => {
    assert.throws(() => store.delete('memory', 'x', 2), /retained review fault/);
    assert.throws(() => store.put('memory', 'x', 'lost', 2), /retained review fault/);
    assert.throws(() => store.put('memory', 'x', 'stale', 1), RevisionConflict);
  });
  assert.deepEqual(store.captureDevelopmentSnapshot(bounds), before);
  f.sql(db => db.exec('DROP TRIGGER fail_event'));
  early.delete('memory', 'x', 2); store.put('memory', 'x', 'recreated', null);
  const snapshot = f.open().captureDevelopmentSnapshot(bounds);
  assert.equal(snapshot.journalBinding?.anchorId, binding.anchorId);
  const transitions = snapshot.events.filter(e => e.type === 'document-mutation').map(e => e.data as { before: unknown; after: unknown });
  assert.deepEqual(transitions.map(e => [e.before, e.after]), [[{ revision: 1, value: 'anchor' }, { revision: 2, value: 'intermediate' }], [{ revision: 2, value: 'intermediate' }, null], [null, { revision: 1, value: 'recreated' }]]);
  assert.deepEqual(snapshot.documents.find(d => d.namespace === 'memory'), { namespace: 'memory', key: 'x', revision: 1, value: 'recreated' });
});

test('capture retains actual open connection when its directory symlink is replaced', t => {
  const f = fixture(t), original = join(f.root, 'original'), replacement = join(f.root, 'replacement'), link = join(f.root, 'current');
  mkdirSync(original); mkdirSync(replacement); symlinkSync(original, link);
  const store = f.open(journal, join(link, 'state.sqlite'));
  store.put('memory', 'x', 'original WAL state', null);
  const expected = store.captureDevelopmentSnapshot(bounds);
  const alternate = f.open(journal, join(replacement, 'state.sqlite')); alternate.put('memory', 'x', 'replacement', null);
  unlinkSync(link); symlinkSync(replacement, link);
  assert.deepEqual(store.captureDevelopmentSnapshot(bounds), expected);
  assert.equal(f.open(undefined, join(link, 'state.sqlite')).get('memory', 'x')?.value, 'replacement');
});

test('preflight rejects UTF8, escaped event metadata, BLOB and row excess before value reads', t => {
  for (const fault of ['utf8', 'escaped', 'blob', 'rows'] as const) {
    const f = fixture(t), store = f.open();
    if (fault === 'utf8') store.put('memory', 'x', '😀'.repeat(500), null);
    if (fault === 'escaped') store.append({ id: '\u0001'.repeat(600), stream: 'review', type: 'observation', data: null });
    if (fault === 'blob') f.sql(db => db.prepare('INSERT INTO documents VALUES(?,?,1,?)').run('memory', 'x', Buffer.alloc(4_000, 49)));
    if (fault === 'rows') for (let i = 0; i < 4; i++) store.put('memory', String(i), null, null);
    const original = DatabaseSync.prototype.prepare; let payloadReads = 0;
    const mock = t.mock.method(DatabaseSync.prototype, 'prepare', function(this: DatabaseSync, sql: string) {
      if (/^SELECT (?:\*|namespace,key,revision,value|key,revision,value|sequence,stream,type,data) FROM (?:documents|events)/.test(sql)) payloadReads++;
      return original.call(this, sql);
    });
    try {
      assert.throws(() => store.captureDevelopmentSnapshot({ maxRows: fault === 'rows' ? 3 : 512, maxBytes: 4_000 }), /exceeds bound/);
      assert.equal(payloadReads, 0, fault);
    } finally { mock.mock.restore(); }
  }
});

test('gaps, erased tail and high-water corruption refuse instead of certifying shortened history', t => {
  for (const fault of ['first', 'middle', 'tail', 'all', 'high-water-missing', 'high-water-ahead'] as const) {
    const f = fixture(t), store = f.open();
    for (let i = 1; i <= 3; i++) store.append({ id: String(i), stream: 'review', type: 'observation', data: i });
    assert.equal(store.captureDevelopmentSnapshot(bounds).events.length, 3);
    f.sql(db => {
      if (fault === 'first') db.exec('DELETE FROM events WHERE sequence=1');
      if (fault === 'middle') db.exec('DELETE FROM events WHERE sequence=2');
      if (fault === 'tail') db.exec('DELETE FROM events WHERE sequence=3');
      if (fault === 'all') db.exec('DELETE FROM events');
      if (fault === 'high-water-missing') db.exec("DELETE FROM sqlite_sequence WHERE name='events'");
      if (fault === 'high-water-ahead') db.exec("UPDATE sqlite_sequence SET seq=4 WHERE name='events'");
    });
    assert.throws(() => store.captureDevelopmentSnapshot(bounds), /prefix incomplete/, fault);
  }
});

test('fresh and existing handles refuse missing or corrupt journal metadata without changing documents', t => {
  for (const fault of ['binding-json', 'anchor-json', 'binding-missing', 'anchor-stream', 'anchor-host'] as const) {
    const f = fixture(t), store = f.open(journal); store.put('memory', 'x', 'retained', null);
    const binding = store.documentJournalBinding()!;
    f.sql(db => {
      if (fault === 'binding-json') db.prepare('UPDATE documents SET value=? WHERE namespace=?').run('{broken', DOCUMENT_JOURNAL_NAMESPACE);
      if (fault === 'anchor-json') db.prepare('UPDATE events SET data=? WHERE id=?').run('{broken', binding.anchorId);
      if (fault === 'binding-missing') db.prepare('DELETE FROM documents WHERE namespace=?').run(DOCUMENT_JOURNAL_NAMESPACE);
      if (fault === 'anchor-stream') db.prepare('UPDATE events SET stream=? WHERE id=?').run('foreign', binding.anchorId);
      if (fault === 'anchor-host') db.prepare("UPDATE events SET data=json_set(data,'$.hostId','foreign') WHERE id=?").run(binding.anchorId);
    });
    assert.throws(() => store.put('memory', 'x', 'lost', 1)); assert.throws(() => store.delete('memory', 'x', 1));
    assert.throws(() => f.open()); assert.throws(() => store.captureDevelopmentSnapshot(bounds));
    assert.deepEqual(store.get('memory', 'x'), { revision: 1, value: 'retained' });
  }
});

test('actual application binds before initial allocation and omitted-option reopen retains its anchor', async t => {
  const f = fixture(t), stateDirectory = join(f.root, 'application-state'), workspaceDirectory = join(f.root, 'workspace'); mkdirSync(stateDirectory); mkdirSync(workspaceDirectory);
  const promptFile = join(f.root, 'mind.txt'), compactionPromptFile = join(f.root, 'compact.txt'); writeFileSync(promptFile, 'Review fixture'); writeFileSync(compactionPromptFile, 'Review fixture');
  const resources = { maxRequests: 20, maxTokens: 10000, maxCostUsd: 1, maxElapsedMs: 10000, maxConcurrency: 2 };
  const config: ApplicationConfig = { stateDirectory, workspaceDirectory, applicationRoot: dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))), nodeBinary: process.execPath, workerEntrypoint: 'deployment/shell-worker.ts', artifactId: 'review-fixture', controlRevision: 'review-controls', promptFile, compactionPromptFile,
    model: { id: 'mistral-fixture', contextWindow: 128000, reasoning: false, effort: 'none', maxOutputTokens: 100, maxRequestsPerSlice: 2, timeoutMs: 10000, pricesPerMillion: { input: 1, output: 2 } }, resources, conversationResources: resources,
    bootstrapInitiative: false, scheduler: { windowMs: 60000, maxSlicesPerWindow: 2, maxLifetimeSlices: 2, quantumMs: 1000, idleRetryMs: 1000, maxStalls: 2, resources }, maxConcurrentRuns: 2, pollMs: 100, commands: [], researchHosts: [], direct: { host: '127.0.0.1', port: 0, actorId: 'review', scope: { kind: 'public' }, modificationEligible: false } };
  const authorityStore = new AuthorityStore(join(stateDirectory, 'authority.sqlite')), authority = authorityStore.bootstrap('review', config.controlRevision, config.artifactId);
  let app: AutarkApplication | undefined, requests = 0;
  const options = { config, authorityStore, authority, secrets: { directToken: 'nonsecret-review-fixture' }, performRequest: async () => { requests++; throw Error('unexpected request'); } };
  try {
    app = new AutarkApplication({ ...options, documentJournal: journal });
    const first = app.store.captureDevelopmentSnapshot(bounds), binding = first.journalBinding!;
    assert.equal(binding.anchorSequence, 1);
    assert.deepEqual((first.events[0]!.data as { documents: unknown[] }).documents, []);
    const allocation = first.events.filter(e => e.type === 'document-mutation').map(e => e.data as { namespace: string; key: string; before: unknown; after: unknown }).find(e => e.namespace === 'allocations' && e.key === 'operating-envelope:v1');
    assert.ok(allocation); assert.equal(allocation.before, null); assert.deepEqual(allocation.after, app.store.get('allocations', 'operating-envelope:v1'));
    await app.close(); app = undefined;
    app = new AutarkApplication(options); assert.deepEqual(app.store.documentJournalBinding(), binding);
    assert.deepEqual(app.store.captureDevelopmentSnapshot(bounds), first); assert.equal(requests, 0); assert.equal(app.directApi.listening, false);
  } finally { await app?.close(); authorityStore.close(); }
});
