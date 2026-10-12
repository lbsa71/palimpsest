import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { OperationalStore } from '../index.ts';

function fixture(t: import('node:test').TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'aeon-storage-bounds-')), filename = join(dir, 'state.sqlite');
  const store = new OperationalStore({ filename }); t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { store, filename };
}
function observe(t: import('node:test').TestContext, beforeBytes?: () => void) {
  const original = DatabaseSync.prototype.prepare; let byteReads = 0, lengthReads = 0;
  t.mock.method(DatabaseSync.prototype, 'prepare', function(this: DatabaseSync, sql: string) {
    if (sql === 'SELECT bytes FROM artifacts WHERE digest=?') { byteReads++; beforeBytes?.(); }
    if (sql.startsWith('SELECT length(bytes) AS size')) lengthReads++;
    return original.call(this, sql);
  });
  return { get byteReads() { return byteReads; }, get lengthReads() { return lengthReads; } };
}
test('oversized and nonempty zero-byte bounds reject before SQLite selects the BLOB', t => {
  const f = fixture(t), ref = f.store.putArtifact('12345'), seen = observe(t);
  assert.throws(() => f.store.readArtifact(ref, 4), /exceeds read bound/); assert.throws(() => f.store.readArtifact(ref, 0), /exceeds read bound/);
  assert.equal(seen.lengthReads, 2); assert.equal(seen.byteReads, 0);
});
test('exact and empty bounds retain hash validation and ordinary unbounded behavior', t => {
  const f = fixture(t), ref = f.store.putArtifact('12345'), empty = f.store.putArtifact(''), seen = observe(t);
  assert.equal(Buffer.from(f.store.readArtifact(ref, 5)).toString(), '12345'); assert.equal(f.store.readArtifact(empty, 0).byteLength, 0);
  assert.equal(Buffer.from(f.store.readArtifact(ref)).toString(), '12345'); assert.equal(seen.lengthReads, 2); assert.equal(seen.byteReads, 3);
});
test('invalid finite integer bounds fail without querying or allocating artifact bytes', t => {
  const f = fixture(t), ref = f.store.putArtifact('12345'), seen = observe(t);
  for (const bound of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => f.store.readArtifact(ref, bound), /invalid artifact read bound/);
  assert.equal(seen.lengthReads, 0); assert.equal(seen.byteReads, 0);
});
test('missing and invalid artifacts preserve failure without BLOB allocation', t => {
  const f = fixture(t), seen = observe(t), sha256 = '0'.repeat(64);
  assert.throws(() => f.store.readArtifact({ uri: `aeon:artifact:${sha256}`, sha256 }, 5), /missing artifact/);
  assert.throws(() => f.store.readArtifact({ uri: `sha256:${sha256}`, sha256 }, 5), /foreign artifact/);
  assert.equal(seen.byteReads, 0);
});
test('bounded actual BLOB read still rejects corrupted bytes', t => {
  const f = fixture(t), ref = f.store.putArtifact('12345'), other = new DatabaseSync(f.filename);
  try { other.prepare('UPDATE artifacts SET bytes=? WHERE digest=?').run(Buffer.from('xxxxx'), ref.sha256); } finally { other.close(); }
  const seen = observe(t); assert.throws(() => f.store.readArtifact(ref, 5), /artifact corruption/); assert.equal(seen.byteReads, 1);
});
test('Unicode TEXT corruption cannot underreport physical byte length before BLOB selection', t => {
  const f = fixture(t), ref = f.store.putArtifact('12345'), other = new DatabaseSync(f.filename);
  try { other.prepare('UPDATE artifacts SET bytes=? WHERE digest=?').run('😀'.repeat(10), ref.sha256); } finally { other.close(); }
  const seen = observe(t); assert.throws(() => f.store.readArtifact(ref, 10), /invalid storage representation/); assert.equal(seen.byteReads, 0);
});
test('bounded length and bytes reads hold one synchronous write lock against a competing update', t => {
  const f = fixture(t), ref = f.store.putArtifact('12345'), other = new DatabaseSync(f.filename); other.exec('PRAGMA busy_timeout=1');
  t.after(() => other.close()); let attempted = false;
  const seen = observe(t, () => {
    attempted = true; assert.throws(() => other.prepare('UPDATE artifacts SET bytes=? WHERE digest=?').run(Buffer.from('much larger replacement'), ref.sha256), /locked/);
  });
  assert.equal(Buffer.from(f.store.readArtifact(ref, 5)).toString(), '12345'); assert.equal(attempted, true); assert.equal(seen.lengthReads, 1); assert.equal(seen.byteReads, 1);
});
