import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { OperationalStore, RevisionConflict, type JournalPayload } from '../packages/storage/index.ts';
import { createNodeStorageEnvironment, type StorageEnvironment, type StorageDatabase, type StorageStatement } from '../packages/storage/environment.ts';
import { ResourceLedger } from '../packages/runtime/resources/index.ts';

const journal = { stream: 'review-journal', hostId: 'review-host', maxAnchorDocuments: 100, maxAnchorBytes: 100_000 };
const limits = { maxRows: 512, maxBytes: 1_048_576 };
const caught = (fn: () => unknown): unknown => { try { fn(); } catch (error) { return error; } assert.fail('expected failure'); };
function rig(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'di09-independent-')), filename = join(dir, 'state.sqlite');
  const natives: DatabaseSync[] = [], handles: StorageDatabase[] = [], log: string[] = [];
  const hooks: { before?: (sql: string) => void; after?: (sql: string) => void; statement?: (sql: string, statement: StorageStatement) => StorageStatement; handle?: (handle: StorageDatabase) => void; id?: () => string } = {};
  let id = 0;
  const environment: StorageEnvironment = {
    ...createNodeStorageEnvironment(),
    id: () => hooks.id ? hooks.id() : `review-id-${++id}`,
    openDatabase: filename => {
      const db = new DatabaseSync(filename); natives.push(db);
      const handle: StorageDatabase = {
        exec: function(this: unknown, sql) { assert.equal(this, undefined); log.push(sql); hooks.before?.(sql); db.exec(sql); hooks.after?.(sql); },
        close: function(this: unknown) { assert.equal(this, undefined); log.push('close'); db.close(); },
        prepare: function(this: unknown, sql) {
          assert.equal(this, undefined); log.push(sql); const statement = db.prepare(sql);
          const port: StorageStatement = {
            get: function(this: unknown, ...args) { assert.equal(this, undefined); return statement.get(...args); },
            all: function(this: unknown, ...args) { assert.equal(this, undefined); return statement.all(...args); },
            run: function(this: unknown, ...args) { assert.equal(this, undefined); return statement.run(...args); },
          };
          return hooks.statement ? hooks.statement(sql, port) : port;
        },
      };
      handles.push(handle); hooks.handle?.(handle); return handle;
    },
  };
  t.after(() => { for (const db of natives) if (db.isOpen) db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { filename, natives, handles, log, hooks, environment, open: (bound = true) => new OperationalStore({ filename, documentJournal: bound ? journal : undefined }, environment) };
}

for (const phase of ['exec', 'prepare'] as const) test(`DI09 review acquired ${phase} selector failure closes exactly once and keeps non-Error cause`, t => {
  const f = rig(t), fault = Symbol(phase);
  f.hooks.handle = handle => Object.defineProperty(handle, phase, { get() { throw fault; } });
  const error = caught(() => f.open()) as Error;
  assert.equal(error.cause, fault); assert.deepEqual(f.log, ['close']); assert.equal(f.natives[0]!.isOpen, false);
});

for (const phase of ['get', 'all', 'run'] as const) test(`DI09 review statement ${phase} selector failure unwinds journal write and preserves identity`, t => {
  const f = rig(t), store = f.open(), before = store.captureDevelopmentSnapshot(limits), fault = { selector: phase };
  f.hooks.statement = (sql, statement) => {
    if (sql.startsWith('INSERT INTO documents VALUES')) Object.defineProperty(statement, phase, { get() { throw fault; } });
    return statement;
  };
  assert.equal(caught(() => store.put('items', 'new', 1, null)), fault);
  f.hooks.statement = undefined;
  assert.deepEqual(store.captureDevelopmentSnapshot(limits), before); assert.equal(store.transactionActive, false);
  store.put('items', 'ok', 2, null); store.close(); const reopen = f.open(); assert.equal(reopen.get('items', 'ok')!.value, 2); reopen.close();
});

test('DI09 review filesystem callbacks remain captured when containment callback replaces later selectors', t => {
  const f = rig(t), calls: string[] = [], fault = { open: 'stop before actual acquisition' };
  const environment: StorageEnvironment = {
    id: () => assert.fail('unexpected ID'),
    exists: function(this: unknown, path) {
      assert.equal(this, undefined); calls.push(`exists:${path}`);
      environment.realpath = () => assert.fail('mutated realpath'); environment.mkdir = () => assert.fail('mutated mkdir'); environment.openDatabase = () => assert.fail('mutated open');
      return ['/checkout', '/outside'].includes(path);
    },
    realpath: function(this: unknown, path) { assert.equal(this, undefined); calls.push(`realpath:${path}`); return path; },
    mkdir: function(this: unknown, path, options) { assert.equal(this, undefined); assert.deepEqual(options, { recursive: true, mode: 0o700 }); calls.push(`mkdir:${path}`); },
    openDatabase: function(this: unknown, path) { assert.equal(this, undefined); calls.push(`open:${path}`); throw fault; },
  };
  assert.equal(caught(() => new OperationalStore({ filename: '/outside/new/state.sqlite', checkoutRoot: '/checkout' }, environment)), fault);
  assert.ok(calls.includes('realpath:/outside')); assert.deepEqual(calls.slice(-2), ['mkdir:/outside/new', 'open:/outside/new/state.sqlite']); assert.equal(f.natives.length, 0);
});

test('DI09 review error after actual BEGIN must recover or refuse subsequent artifact acknowledgement', t => {
  const f = rig(t), store = f.open(false), fault = { begin: 'receipt lost' };
  f.hooks.after = sql => { if (sql === 'BEGIN IMMEDIATE') { f.hooks.after = undefined; throw fault; } };
  assert.equal(caught(() => store.transaction(() => assert.fail('body must not execute'))), fault);
  assert.equal(store.transactionActive, false);
  // Either confirmed rollback or an explicit uncertainty refusal is valid. A successful
  // artifact acknowledgement must never be stranded inside an untracked transaction.
  let artifact: ReturnType<OperationalStore['putArtifact']> | undefined;
  try { artifact = store.putArtifact('acknowledged-after-lost-begin'); }
  catch (error) { assert.match(String(error), /outcome uncertain/); }
  t.diagnostic(JSON.stringify({ acknowledged: Boolean(artifact), nativeTransaction: f.natives[0]!.isTransaction, logicalTransaction: store.transactionActive }));
  store.close(); const reopened = f.open(false);
  if (artifact) assert.equal(Buffer.from(reopened.readArtifact(artifact)).toString(), 'acknowledged-after-lost-begin');
  reopened.close();
});

test('DI09 review error after actual SAVEPOINT preserves enclosing full rollback and later sibling use', t => {
  const f = rig(t), store = f.open(), fault = 'savepoint receipt lost';
  assert.equal(caught(() => store.transaction(() => {
    store.put('items', 'outer', 1, null);
    f.hooks.after = sql => { if (sql === 'SAVEPOINT nested_1') { f.hooks.after = undefined; throw fault; } };
    assert.equal(caught(() => store.transaction(() => assert.fail('inner body'))), fault);
    store.put('items', 'sibling', 2, null); throw fault;
  })), fault);
  assert.equal(store.transactionActive, false); assert.equal(f.natives[0]!.isTransaction, false); assert.deepEqual(store.list('items'), []);
  store.put('items', 'after', 3, null); store.close();
});

test('DI09 review error after actual RELEASE refuses caught-inner continuation and outer rollback restores retained bytes', t => {
  const f = rig(t), store = f.open(), before = store.captureDevelopmentSnapshot(limits), primary = Symbol('release-receipt');
  assert.match(String(caught(() => store.transaction(() => {
    f.hooks.after = sql => { if (sql === 'RELEASE nested_1') { f.hooks.after = undefined; throw primary; } };
    const error = caught(() => store.put('items', 'inner', 1, null)) as AggregateError;
    assert.equal(error.cause, primary); assert.equal(error.errors[0], primary); assert.match(String(error.errors[1]), /no such savepoint/);
    assert.match(String(caught(() => store.events())), /outcome uncertain/);
  }))), /outcome uncertain/);
  assert.deepEqual(store.captureDevelopmentSnapshot(limits), before); assert.equal(f.natives[0]!.isTransaction, false); store.close();
});

for (const phase of ['COMMIT', 'ROLLBACK'] as const) test(`DI09 review actual ${phase} followed by non-Error throw preserves uncertainty and reopen disposition`, t => {
  const f = rig(t), store = f.open(), primary = Symbol('body'), receipt = { phase };
  f.hooks.after = sql => { if (sql === phase) { f.hooks.after = undefined; throw receipt; } };
  const error = caught(() => store.transaction(() => { store.put('items', phase, 1, null); if (phase === 'ROLLBACK') throw primary; })) as AggregateError;
  assert.equal(error.cause, phase === 'COMMIT' ? receipt : primary);
  assert.equal(error.errors[0], phase === 'COMMIT' ? receipt : primary);
  if (phase === 'ROLLBACK') assert.equal(error.errors[1], receipt); else assert.match(String(error.errors[1]), /no transaction is active/);
  for (const operation of [() => store.get('items', phase), () => store.events(), () => store.hasArtifacts(), () => store.putArtifact('refused')]) assert.match(String(caught(operation)), /outcome uncertain/);
  assert.equal(store.transactionActive, false); store.close(); const reopened = f.open();
  assert.equal(reopened.get('items', phase)?.value, phase === 'COMMIT' ? 1 : undefined); reopened.captureDevelopmentSnapshot(limits); reopened.close();
});

for (const disposition of ['deleted', 'withdrawn'] as const) test(`DI09 review collision with ${disposition} historical version cannot overwrite retained identity`, t => {
  const f = rig(t), store = f.open(); store.put('items', 'k', 'original', null);
  const old = store.captureDevelopmentSnapshot(limits).journalPayloads.find(p => p.ref.namespace === 'items')!;
  if (disposition === 'withdrawn') store.withdrawDocumentJournalContent({ id: 'withdraw', reason: 'forget', targets: [{ namespace: 'items', key: 'k', expectedRevision: 1 }] });
  store.delete('items', 'k', 1); const before = store.captureDevelopmentSnapshot(limits);
  f.hooks.id = () => old.ref.versionId;
  assert.match(String(caught(() => store.put('items', 'k', 'replacement', null))), /duplicate document journal version identity/);
  f.hooks.id = undefined; assert.deepEqual(store.captureDevelopmentSnapshot(limits), before); store.close();
  const reopened = f.open(); assert.deepEqual(reopened.captureDevelopmentSnapshot(limits), before); assert.equal(reopened.get('items', 'k'), undefined); reopened.close();
});

test('DI09 review real WAL FULL stale second-handle CAS and native rollback preserve reopen state', t => {
  const f = rig(t), first = f.open(), second = f.open();
  assert.equal(f.natives[0]!.prepare('PRAGMA journal_mode').get()!.journal_mode, 'wal');
  assert.equal(f.natives[0]!.prepare('PRAGMA synchronous').get()!.synchronous, 2);
  first.put('items', 'k', 1, null); const stale = second.get('items', 'k')!; first.put('items', 'k', 2, 1);
  assert.throws(() => second.put('items', 'k', 3, stale.revision), RevisionConflict);
  const fault = new Error('rollback'); assert.equal(caught(() => second.transaction(() => { second.put('items', 'k', 4, 2); throw fault; })), fault);
  first.close(); second.close(); const reopened = f.open(); assert.deepEqual(reopened.get('items', 'k'), { revision: 2, value: 2 }); reopened.captureDevelopmentSnapshot(limits); reopened.close();
});

test('DI09 review controlled elapsed-floor causality adds 52 physical rows and retains first and current allocation revisions', t => {
  const fixtures = [rig(t), rig(t)], stores = fixtures.map(f => f.open());
  const envelope = { maxRequests: 100, maxTokens: 10_000, maxCostUsd: 10, maxElapsedMs: 100_000, maxConcurrency: 8 };
  for (let index = 0; index < stores.length; index++) {
    const store = stores[index]!; let clock = 100;
    const ledger = new ResourceLedger(store, { tokens: 100, costUsd: 1, elapsedMs: 1000 }, () => clock);
    ledger.allocate('root', envelope);
    for (let child = 0; child < 13; child++) { if (index === 1) clock++; ledger.allocate(`child-${child}`, envelope, 'root'); }
  }
  const rows = fixtures.map(f => Number(f.natives[0]!.prepare('SELECT (SELECT count(*) FROM documents)+(SELECT count(*) FROM events) AS total').get()!.total));
  assert.equal(rows[1]! - rows[0]!, 52);
  const store = stores[1]!, snapshot = store.captureDevelopmentSnapshot(limits);
  const versions = snapshot.journalPayloads.filter((payload): payload is Extract<JournalPayload, { state: 'available' }> => payload.state === 'available' && payload.ref.namespace === 'allocations' && payload.ref.key === 'root');
  assert.equal(versions.length, 14); const first = versions.find(p => p.ref.revision === 1)!, latest = versions.find(p => p.ref.revision === 14)!;
  assert.equal((first.document.value as { elapsedFloorMs: number }).elapsedFloorMs, 0);
  assert.equal((latest.document.value as { elapsedFloorMs: number }).elapsedFloorMs, 13);
  assert.notDeepEqual(first.document, store.get('allocations', 'root')); assert.deepEqual(latest.document, store.get('allocations', 'root'));
  for (const item of stores) item.close(); const reopened = fixtures[1]!.open(); assert.deepEqual(reopened.captureDevelopmentSnapshot(limits), snapshot); reopened.close();
});
