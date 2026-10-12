import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { canonicalJson, type ArtifactRef } from '../packages/contracts/common.ts';
import { OperationalStore, RevisionConflict, DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE, type HistoricalSourceUse, type JournalPayload, type SourcePage } from '../packages/storage/index.ts';
import { createNodeStorageEnvironment, type StorageDatabase, type StorageEnvironment } from '../packages/storage/environment.ts';

const journal = { stream: 'synthetic-journal', hostId: 'synthetic-host', maxAnchorDocuments: 100, maxAnchorBytes: 100_000 };
const bounds = { maxPageRows: 4, maxPageBytes: 25_000, maxPages: 80, maxPhysicalRows: 320, maxConservativeBytes: 1_500_000, maxSerializedBytes: 1_500_000, maxOperationalArtifacts: 10, maxOperationalArtifactBytes: 2_000, maxOperationalArtifactTotalBytes: 4_000 };
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const failure = (fn: () => unknown): unknown => { try { fn(); } catch (error) { return error; } assert.fail('expected failure'); };
function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'aeon-di09-')), filename = join(root, 'state.sqlite');
  const calls: string[] = [], databases: DatabaseSync[] = [];
  let next = 0;
  const faults: { exec?: (sql: string) => void; afterExec?: (sql: string) => void; prepare?: (sql: string) => void; statement?: (sql: string, operation: string) => void; close?: () => void; id?: () => string } = {};
  const handles: StorageDatabase[] = [];
  const env: StorageEnvironment = {
    ...createNodeStorageEnvironment(),
    id: function(this: unknown) { assert.equal(this, undefined); return faults.id ? faults.id() : `synthetic-id:${++next}`; },
    openDatabase: function(this: unknown, path: string) {
      assert.equal(this, undefined); calls.push(`open:${path}`);
      const db = new DatabaseSync(path); databases.push(db);
      const handle: StorageDatabase = {
        exec: function(this: unknown, sql) { assert.equal(this, undefined); calls.push(sql); faults.exec?.(sql); db.exec(sql); faults.afterExec?.(sql); },
        close: function(this: unknown) { assert.equal(this, undefined); calls.push('close'); faults.close?.(); db.close(); },
        prepare: function(this: unknown, sql) {
          assert.equal(this, undefined); calls.push(`prepare:${sql}`); faults.prepare?.(sql);
          const statement = db.prepare(sql);
          return {
            get: function(this: unknown, ...values) { assert.equal(this, undefined); faults.statement?.(sql, 'get'); return statement.get(...values); },
            all: function(this: unknown, ...values) { assert.equal(this, undefined); faults.statement?.(sql, 'all'); return statement.all(...values); },
            run: function(this: unknown, ...values) { assert.equal(this, undefined); faults.statement?.(sql, 'run'); return statement.run(...values); },
          };
        },
      };
      handles.push(handle); return handle;
    },
  };
  // Independent test cleanup closes actual SQLite even when the deliberately failing close port refused.
  t.after(() => { for (const db of databases) if (db.isOpen) db.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, filename, calls, databases, handles, faults, env, open: (withJournal = false) => new OperationalStore({ filename, documentJournal: withJournal ? journal : undefined }, env) };
}
function oneExec(f: ReturnType<typeof fixture>, sql: string, error: unknown): void {
  let fired = false;
  f.faults.exec = value => { if (!fired && value === sql) { fired = true; throw error; } };
}
function retained() {
  const pages = new Map<string, Buffer>();
  const retain = (bytes: Uint8Array): ArtifactRef => { const sha256 = hash(bytes); pages.set(sha256, Buffer.from(bytes)); return { uri: `sha256:${sha256}`, sha256 }; };
  return { pages, retain };
}

test('DI09 independent instances capture receiver-free environment and database selectors before callbacks', t => {
  const a = fixture(t), b = fixture(t), options = { filename: a.filename, documentJournal: { ...journal } };
  const mkdir = a.env.mkdir;
  a.env.mkdir = function(this: unknown, path, mode) {
    assert.equal(this, undefined); assert.deepEqual(mode, { recursive: true, mode: 0o700 });
    a.env.id = () => assert.fail('late ID selector'); a.env.openDatabase = () => assert.fail('late opener selector');
    options.documentJournal.hostId = 'mutated'; mkdir(path, mode);
  };
  const store = new OperationalStore(options, a.env), other = b.open(true);
  for (const h of a.handles) { h.exec = () => assert.fail('late exec selector'); h.prepare = () => assert.fail('late prepare selector'); h.close = () => assert.fail('late close selector'); }
  store.put('items', 'a', 1, null); other.put('items', 'b', 2, null);
  assert.equal(store.documentJournalBinding()!.hostId, journal.hostId);
  assert.equal(store.get('items', 'b'), undefined); assert.equal(other.get('items', 'a'), undefined);
  assert.deepEqual(store.events().map(e => e.id), ['synthetic-id:1', 'synthetic-id:3']);
  assert.deepEqual(other.events().map(e => e.id), ['synthetic-id:1', 'synthetic-id:3']); store.close(); other.close();
});

test('DI09 statement callbacks are captured together before invoking get', t => {
  const f = fixture(t), original = f.env.openDatabase;
  f.env.openDatabase = filename => {
    const db = original(filename), prepare = db.prepare;
    db.prepare = sql => {
      const s = prepare(sql);
      if (sql.startsWith('SELECT revision,value')) {
        const all = s.all;
        Object.defineProperty(s, 'all', { get() { s.get = () => assert.fail('replaced selector'); return all; }, configurable: true });
      }
      return s;
    }; return db;
  };
  const store = f.open(); store.put('items', 'a', 1, null); assert.equal(store.get('items', 'a')!.value, 1); store.close();
});

test('DI09 supplied physical paths enforce missing descendant and alias checkout containment before opening', () => {
  const calls: string[] = [];
  const env: StorageEnvironment = {
    id: () => assert.fail('ID'),
    exists: function(this: unknown, p) { assert.equal(this, undefined); calls.push(`exists:${p}`); return ['/checkout', '/alias', '/outside', '/'].includes(p); },
    realpath: function(this: unknown, p) { assert.equal(this, undefined); calls.push(`realpath:${p}`); return p === '/alias' ? '/checkout' : p; },
    mkdir: () => assert.fail('mkdir inside checkout'), openDatabase: () => assert.fail('open inside checkout'),
  };
  for (const filename of ['/alias/new/state.sqlite', '/checkout/..state/db.sqlite']) assert.throws(() => new OperationalStore({ filename, checkoutRoot: '/checkout' }, env), /outside checkout/);
  assert.ok(calls.includes('realpath:/alias')); assert.ok(calls.includes('exists:/checkout/..state'));
});

for (const operation of ['exists', 'realpath', 'mkdir', 'openDatabase'] as const) test(`DI09 ${operation} failure propagates without taking database ownership`, t => {
  const f = fixture(t), error = { operation };
  if (operation === 'exists') f.env.exists = () => { throw error; };
  if (operation === 'realpath') f.env.realpath = () => { throw error; };
  if (operation === 'mkdir') f.env.mkdir = () => { throw error; };
  if (operation === 'openDatabase') f.env.openDatabase = () => { throw error; };
  assert.equal(failure(() => new OperationalStore({ filename: f.filename, checkoutRoot: '/checkout' }, f.env)), error);
  assert.equal(f.calls.length, 0);
});

test('DI09 unavailable filesystem root refuses finitely without mkdir/open', () => {
  const env = createNodeStorageEnvironment(); env.exists = () => false; env.realpath = () => assert.fail('realpath'); env.mkdir = () => assert.fail('mkdir'); env.openDatabase = () => assert.fail('open');
  assert.throws(() => new OperationalStore({ filename: '/outside/state.sqlite', checkoutRoot: '/checkout' }, env), /filesystem root unavailable/);
});

for (const phase of ['pragma', 'begin', 'commit', 'prepare', 'get', 'all', 'journal-id'] as const) test(`DI09 constructor ${phase} failure closes acquired handle exactly once and preserves diagnosis`, t => {
  const f = fixture(t), error = new Error(phase);
  if (phase === 'pragma') f.faults.exec = sql => { if (sql.startsWith('PRAGMA busy_timeout')) throw error; };
  if (phase === 'begin') oneExec(f, 'BEGIN IMMEDIATE', error);
  if (phase === 'commit') oneExec(f, 'COMMIT', error);
  if (phase === 'prepare') f.faults.prepare = () => { throw error; };
  if (phase === 'get' || phase === 'all') f.faults.statement = (_sql, operation) => { if (operation === phase) throw error; };
  if (phase === 'journal-id') f.faults.id = () => { throw error; };
  const thrown = failure(() => f.open(phase === 'journal-id'));
  assert.ok(thrown instanceof Error); assert.match(thrown.message, /cannot open operational state/); assert.equal(thrown.cause, error);
  assert.equal(f.calls.filter(c => c === 'close').length, 1);
  f.faults.exec = undefined; f.faults.prepare = undefined; f.faults.statement = undefined; f.faults.id = undefined;
  const reopened = f.open(); assert.equal(reopened.documentJournalBinding(), null); reopened.put('items', 'ok', 1, null); reopened.close();
});

test('DI09 constructor preserves primary, rollback and close failures including non-Error values', t => {
  const f = fixture(t), primary = 'schema refused', rollback = { cleanup: 'rollback' }, close = 17;
  f.faults.statement = (_sql, operation) => { if (operation === 'get') throw primary; };
  f.faults.exec = sql => { if (sql === 'ROLLBACK') throw rollback; };
  f.faults.close = () => { throw close; };
  const error = failure(() => f.open()) as Error, cleanup = error.cause as AggregateError, transaction = cleanup.cause as AggregateError;
  assert.match(error.message, /cannot open operational state/); assert.deepEqual(cleanup.errors, [transaction, close]);
  assert.equal(transaction.cause, primary); assert.deepEqual(transaction.errors, [primary, rollback]); assert.equal(f.calls.filter(c => c === 'close').length, 1);
});

test('DI09 close failure is observable and retry uses captured handle', t => {
  const f = fixture(t), store = f.open(), error = { close: 'failed' }; f.faults.close = () => { throw error; };
  assert.equal(failure(() => store.close()), error); assert.equal(store.get('items', 'absent'), undefined);
  f.faults.close = undefined; store.close(); assert.equal(f.calls.filter(c => c === 'close').length, 2);
});

for (const sql of ['BEGIN IMMEDIATE', 'COMMIT'] as const) test(`DI09 ${sql} failure restores transaction depth and committed bytes after successful cleanup`, t => {
  const f = fixture(t), store = f.open(), error = new Error(sql); oneExec(f, sql, error);
  assert.equal(failure(() => store.transaction(() => store.put('items', 'lost', 1, null))), error);
  assert.equal(store.transactionActive, false); assert.equal(store.get('items', 'lost'), undefined);
  store.put('items', 'kept', 2, null); store.close(); const reopened = f.open(); assert.equal(reopened.get('items', 'kept')!.value, 2); reopened.close();
});

test('DI09 failed rollback preserves both errors, blocks uncertain reads and writes, and close discards bytes', t => {
  const f = fixture(t), store = f.open(), primary = { body: 'failed' }, cleanup = false; oneExec(f, 'ROLLBACK', cleanup);
  const error = failure(() => store.transaction(() => { store.put('items', 'lost', 1, null); throw primary; })) as AggregateError;
  assert.equal(error.cause, primary); assert.deepEqual(error.errors, [primary, cleanup]); assert.equal(store.transactionActive, false);
  const before = f.calls.length; assert.throws(() => store.get('items', 'lost'), /outcome uncertain/); assert.throws(() => store.putArtifact('blocked'), /outcome uncertain/); assert.equal(f.calls.length, before);
  store.close(); const reopened = f.open(); assert.equal(reopened.get('items', 'lost'), undefined); reopened.put('items', 'kept', 2, null); reopened.close();
});

for (const phase of ['savepoint', 'release'] as const) test(`DI09 nested ${phase} failure restores sibling use and outer commit`, t => {
  const f = fixture(t), store = f.open(), error = new Error(phase);
  store.transaction(() => {
    store.put('items', 'before', 1, null); oneExec(f, phase === 'savepoint' ? 'SAVEPOINT nested_1' : 'RELEASE nested_1', error);
    assert.equal(failure(() => store.transaction(() => store.put('items', 'lost', 2, null))), error);
    assert.equal(store.transactionActive, true); assert.equal(store.get('items', 'lost'), undefined); store.put('items', 'after', 3, null);
  });
  assert.equal(store.transactionActive, false); assert.deepEqual(store.list('items').map(r => r.key), ['after', 'before']); store.close();
});

test('DI09 failed nested rollback still permits full outer rollback to recover the handle', t => {
  const f = fixture(t), store = f.open(), primary = new Error('nested body'), cleanup = new Error('savepoint cleanup');
  store.put('items', 'committed', 1, null); oneExec(f, 'ROLLBACK TO nested_1; RELEASE nested_1', cleanup);
  const error = failure(() => store.transaction(() => { store.put('items', 'outer', 2, null); store.transaction(() => { store.put('items', 'inner', 3, null); throw primary; }); })) as AggregateError;
  assert.equal(error.cause, primary); assert.deepEqual(error.errors, [primary, cleanup]); assert.equal(store.transactionActive, false);
  assert.deepEqual(store.list('items').map(r => r.key), ['committed']); store.put('items', 'recovered', 4, null); store.close();
});

for (const when of ['version', 'mutation', 'empty', 'duplicate-version', 'duplicate-event'] as const) test(`DI09 journal ${when} ID failure rolls back actual state and preserves retained history`, t => {
  const f = fixture(t), store = f.open(true); store.put('items', 'k', 'old', null);
  const before = store.captureDevelopmentSnapshot({ maxRows: 100, maxBytes: 100_000 }), error = new Error(when); let n = 0;
  f.faults.id = () => {
    n++;
    if (when === 'version' || when === 'mutation' && n === 2) throw error;
    if (when === 'empty') return ' ';
    if (when === 'duplicate-version') return before.journalPayloads[0]!.ref.versionId;
    if (when === 'duplicate-event' && n === 2) return before.events[0]!.id;
    return `replacement:${n}`;
  };
  const thrown = failure(() => store.put('items', 'k', 'new', 1));
  if (when === 'version' || when === 'mutation') assert.equal(thrown, error);
  else assert.match(String(thrown), /nonempty|duplicate document journal version identity|conflicting event identity/);
  assert.deepEqual(store.captureDevelopmentSnapshot({ maxRows: 100, maxBytes: 100_000 }), before); f.faults.id = undefined;
  store.put('items', 'k', 'recovered', 1); store.close(); const reopened = f.open(); assert.equal(reopened.get('items', 'k')!.value, 'recovered'); reopened.close();
});

test('DI09 journal statement run failure rolls back document and generated payload before recovering', t => {
  const f = fixture(t), store = f.open(true), error = { insert: 'failed' }; const before = store.events();
  f.faults.statement = (sql, operation) => { if (operation === 'run' && sql.startsWith('INSERT INTO events')) throw error; };
  assert.equal(failure(() => store.put('items', 'lost', 1, null)), error); assert.equal(store.get('items', 'lost'), undefined); assert.deepEqual(store.events(), before);
  f.faults.statement = undefined; store.put('items', 'kept', 2, null); store.close();
});

test('DI09 named Node factory preserves real physical aliases WAL FULL CAS reopen and synchronous lock ownership', t => {
  const f = fixture(t), checkout = join(f.root, 'checkout'), alias = join(f.root, 'alias'); mkdirSync(checkout); symlinkSync(checkout, alias);
  const env = createNodeStorageEnvironment(); assert.throws(() => new OperationalStore({ filename: join(alias, 'missing', 'state.sqlite'), checkoutRoot: checkout }, env), /outside checkout/);
  const store = new OperationalStore({ filename: f.filename, checkoutRoot: checkout }, env);
  const raw = new DatabaseSync(f.filename); t.after(() => raw.close()); raw.exec('PRAGMA busy_timeout=1');
  assert.equal(raw.prepare('PRAGMA journal_mode').get()!.journal_mode, 'wal');
  const wrapped = fixture(t), full = wrapped.open(); assert.equal(wrapped.databases[0]!.prepare('PRAGMA synchronous').get()!.synchronous, 2); full.close();
  store.transaction(() => { store.put('items', 'k', 'one', null); assert.throws(() => raw.exec("INSERT INTO artifacts VALUES('rival',x'01')"), /locked/); });
  assert.throws(() => store.put('items', 'k', 'wrong', null), RevisionConflict); assert.throws(() => store.transaction(() => Promise.resolve()), /synchronous/);
  store.close(); const reopened = new OperationalStore({ filename: f.filename }, env); assert.equal(reopened.get('items', 'k')!.value, 'one'); reopened.close();
});

test('DI09 real retained cut bounds owner fences and withdrawal remain exact after injected ID failure', t => {
  const f = fixture(t), store = f.open(true), { pages, retain } = retained();
  store.put('items', 'k', 'old', null); const cut = store.captureDevelopmentPages(bounds, retain, (_ref, bytes) => retain(bytes));
  const refs = cut.pages.flatMap(descriptor => { const page = JSON.parse(pages.get(descriptor.artifact.sha256)!.toString()) as SourcePage; return page.table === 'documents' ? page.rows.filter(row => row.namespace === DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE).map(row => (row.value as unknown as JournalPayload).ref) : []; }).sort((a, b) => a.versionId < b.versionId ? -1 : 1);
  const input: HistoricalSourceUse = { journalDigest: hash(canonicalJson(cut.journalBinding)), prefix: { lastSequence: cut.lastSequence, eventsDigest: cut.eventsDigest }, requiredVersions: refs, maxPageRows: bounds.maxPageRows, maxPageBytes: bounds.maxPageBytes, maxPrefixBytes: bounds.maxConservativeBytes, maxVersions: 100, maxVersionBytes: 100_000, maxWithdrawalMarkerBytes: bounds.maxPageBytes };
  const ref = store.putArtifact('bounded'); assert.throws(() => store.readArtifact(ref, 6), /bound/); assert.equal(store.readArtifact(ref, 7).byteLength, 7);
  assert.throws(() => store.captureDevelopmentPages({ ...bounds, maxPhysicalRows: 0 }, retain, (_ref, bytes) => retain(bytes)), /aggregate bound/);
  const error = new Error('supplier'); f.faults.id = () => { throw error; }; assert.equal(failure(() => store.delete('items', 'k', 1)), error); f.faults.id = undefined;
  const observation = store.withDevelopmentVersionsAvailable(input, value => { store.transaction(() => assert.equal(store.get('items', 'k')!.value, 'old')); assert.throws(() => store.close(), /source writes forbidden/); assert.throws(() => store.put('items', 'k', 'forbidden', 1), /source writes forbidden/); return value; });
  assert.equal(observation.checkedVersions, refs.length);
  store.withdrawDocumentJournalContent({ id: 'withdraw', reason: 'forget', targets: [{ namespace: 'items', key: 'k', expectedRevision: 1 }] });
  assert.throws(() => store.withDevelopmentVersionsAvailable(input, () => assert.fail('withdrawn')), /document-history-withdrawn/);
  assert.throws(() => store.withDevelopmentSourceCut({ journalDigest: input.journalDigest, lastSequence: cut.lastSequence }, () => assert.fail('stale cut')), /source cut changed/);
  assert.equal(store.captureDevelopmentPages(bounds, retain, (_ref, bytes) => retain(bytes)).journalBinding.hostId, journal.hostId); store.close();
});


test('DI09 activation ID failure retains preexisting ordinary rows and closes only the rejected opener', t => {
  const f = fixture(t), original = f.open(); original.put('items', 'before', 'retained', null);
  original.append({ id: 'prior-event', stream: 'ordinary', type: 'input', data: 1 });
  const error = new Error('activation version ID'); f.faults.id = () => { throw error; };
  const failureValue = failure(() => f.open(true)) as Error; assert.equal(failureValue.cause, error);
  assert.equal(f.calls.filter(c => c === 'close').length, 1); assert.equal(original.documentJournalBinding(), null);
  assert.deepEqual(original.get('items', 'before'), { revision: 1, value: 'retained' }); assert.deepEqual(original.events().map(e => e.id), ['prior-event']);
  assert.equal(original.list(DOCUMENT_JOURNAL_PAYLOAD_NAMESPACE).length, 0);
  f.faults.id = undefined; const journalStore = f.open(true); assert.equal(journalStore.documentJournalBinding()!.anchorSequence, 2);
  assert.equal(journalStore.captureDevelopmentSnapshot({ maxRows: 100, maxBytes: 100_000 }).journalPayloads.length, 1); original.close(); journalStore.close();
});

test('DI09 ordinary unbound writes never consume the injected journal ID supplier', t => {
  const f = fixture(t); f.faults.id = () => assert.fail('unbound journal ID'); const store = f.open();
  store.put('items', 'k', 1, null); store.append({ id: 'explicit', stream: 'ordinary', type: 'input', data: 1 }); store.delete('items', 'k', 1);
  assert.equal(store.putArtifact('owned').sha256, hash('owned')); store.close();
});

test('DI09 failure reported after actual commit retains uncertain outcome instead of claiming rollback', t => {
  const f = fixture(t), store = f.open(), primary = new Error('lost commit receipt'); let reported = false;
  f.faults.afterExec = sql => { if (sql === 'COMMIT' && !reported) { reported = true; throw primary; } };
  const error = failure(() => store.put('items', 'committed', 1, null)) as AggregateError;
  assert.equal(error.cause, primary); assert.equal(error.errors[0], primary); assert.match(String(error.errors[1]), /no transaction is active/);
  assert.equal(store.transactionActive, false); assert.throws(() => store.get('items', 'committed'), /outcome uncertain/);
  store.close(); f.faults.afterExec = undefined; const reopened = f.open(); assert.deepEqual(reopened.get('items', 'committed'), { revision: 1, value: 1 }); reopened.close();
});

test('DI09 caught nested rollback failure blocks sibling effects until enclosing rollback restores actual state', t => {
  const f = fixture(t), store = f.open(), body = new Error('nested body'), cleanup = new Error('nested rollback');
  oneExec(f, 'ROLLBACK TO nested_1; RELEASE nested_1', cleanup);
  assert.throws(() => store.transaction(() => {
    store.put('items', 'outer', 1, null);
    const rejected = failure(() => store.transaction(() => { store.put('items', 'inner', 2, null); throw body; })) as AggregateError;
    assert.deepEqual(rejected.errors, [body, cleanup]); assert.equal(store.transactionActive, true);
    assert.throws(() => store.get('items', 'inner'), /outcome uncertain/); assert.throws(() => store.put('items', 'sibling', 3, null), /outcome uncertain/);
  }), /outcome uncertain/);
  assert.equal(store.transactionActive, false); assert.deepEqual(store.list('items'), []); store.put('items', 'after', 4, null); store.close();
});
