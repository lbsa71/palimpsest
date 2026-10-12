import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { OperationalStore } from '../index.ts';

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'bounded-read-review-')), filename = join(dir, 'db.sqlite');
  const store = new OperationalStore({ filename }), competing = new DatabaseSync(filename);
  competing.exec('PRAGMA busy_timeout=1');
  t.after(() => { competing.close(); store.close(); rmSync(dir, { recursive: true, force: true }); });
  let blobsSelected = 0;
  const prepare = DatabaseSync.prototype.prepare;
  t.mock.method(DatabaseSync.prototype, 'prepare', function(this: DatabaseSync, sql: string) {
    if (/SELECT\s+bytes\s+FROM\s+artifacts/i.test(sql)) blobsSelected++;
    return prepare.call(this, sql);
  });
  return { store, competing, get blobsSelected() { return blobsSelected; } };
}
test('bound uses UTF-8 BLOB byte count, permits exact zero and rejects foreign references before allocation', t => {
  const f = fixture(t), unicode = f.store.putArtifact('😀'), empty = f.store.putArtifact('');
  assert.throws(() => f.store.readArtifact(unicode, 3), /bound/); assert.equal(f.blobsSelected, 0);
  assert.throws(() => f.store.readArtifact({ ...unicode, uri: `foreign:${unicode.sha256}` }, 4), /foreign/); assert.equal(f.blobsSelected, 0);
  assert.equal(Buffer.from(f.store.readArtifact(unicode, 4)).toString(), '😀');
  assert.equal(f.store.readArtifact(empty, 0).byteLength, 0); assert.equal(f.blobsSelected, 2);
});
test('actual TEXT and integer storage classes are rejected before selecting even apparently small values', t => {
  const f = fixture(t), ref = f.store.putArtifact('original');
  for (const value of ['😀'.repeat(20), 1]) {
    f.competing.prepare('UPDATE artifacts SET bytes=? WHERE digest=?').run(value, ref.sha256);
    assert.throws(() => f.store.readArtifact(ref, 1000), /storage representation/);
  }
  assert.equal(f.blobsSelected, 0);
});
test('same-size corrupted BLOB still fails hash authentication after bounded selection', t => {
  const f = fixture(t), ref = f.store.putArtifact('valid');
  f.competing.prepare('UPDATE artifacts SET bytes=? WHERE digest=?').run(Buffer.from('wrong'), ref.sha256);
  assert.throws(() => f.store.readArtifact(ref, 5), /corruption/); assert.equal(f.blobsSelected, 1);
});
test('nested caller transaction preserves lock through size check and BLOB access', t => {
  const f = fixture(t), ref = f.store.putArtifact('small'), prepare = DatabaseSync.prototype.prepare;
  let raceAttempts = 0;
  t.mock.method(DatabaseSync.prototype, 'prepare', function(this: DatabaseSync, sql: string) {
    if (/SELECT\s+bytes\s+FROM\s+artifacts/i.test(sql)) {
      raceAttempts++;
      assert.throws(() => f.competing.prepare('UPDATE artifacts SET bytes=? WHERE digest=?').run(Buffer.alloc(10_000), ref.sha256), /locked/);
    }
    return prepare.call(this, sql);
  });
  f.store.transaction(() => assert.equal(Buffer.from(f.store.readArtifact(ref, 5)).toString(), 'small'));
  assert.equal(raceAttempts, 1); assert.equal(f.blobsSelected, 1);
});
