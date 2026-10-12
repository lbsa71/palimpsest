import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { identity } from '../../packages/contracts/index.ts';
import { QualificationStore, type QualificationStoreProfile } from './store.ts';

const profile: QualificationStoreProfile = 'complete-pages-bounded-20261012';
function fixture(t: TestContext, capacity = 100_000, selected: QualificationStoreProfile = profile) {
  const directory = fs.mkdtempSync(join(tmpdir(), 'aeon-cp2-store-')); fs.chmodSync(directory, 0o700);
  const store = new QualificationStore(directory, capacity, selected);
  let closed = false; const close = () => { if (!closed) { store.close(); closed = true; } };
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { store, directory, close };
}
function restore(t: TestContext): void { t.mock.restoreAll(); syncBuiltinESMExports(); }

test('capacity requires the exact explicit private-store profile and retains identity shape', t => {
  const f = fixture(t, 1024 * 1024 * 1024);
  assert.equal(f.store.profile, profile); assert.equal(f.store.capacityBytes, 1073741824);
  assert.deepEqual(Object.keys(f.store.identity()).sort(), ['capacityBytes', 'device', 'directory', 'inode', 'uid']);
  for (const selected of [undefined, 'default'] as const) assert.throws(() => new QualificationStore(f.directory, 268435457, selected), /Bounded/);
  assert.throws(() => new QualificationStore(f.directory, 1073741825, profile), /Bounded/);
  assert.throws(() => new QualificationStore(f.directory, 4, 'future-profile' as QualificationStoreProfile), /Unknown.*profile/);
});

test('scalar usage and a new write never read or allocate unrelated bodies; direct dedup still verifies content', t => {
  const f = fixture(t), ref = f.store.putBytes(Buffer.from('retained'));
  const read = fs.readSync, alloc = Buffer.alloc; let reads = 0, allocations = 0;
  t.mock.method(fs, 'readSync', ((...args: Parameters<typeof fs.readSync>) => { reads++; return read(...args); }) as typeof fs.readSync);
  t.mock.method(fs, 'readdirSync', () => { throw new Error('unbounded inventory'); });
  t.mock.method(Buffer, 'alloc', ((...args: Parameters<typeof Buffer.alloc>) => { allocations++; return alloc(...args); }) as typeof Buffer.alloc);
  syncBuiltinESMExports();
  assert.equal(f.store.usage().usedBytes, 8);
  const other = f.store.putBytes(Buffer.from('new')); assert.deepEqual({ reads, allocations }, { reads: 0, allocations: 0 });
  assert.deepEqual(f.store.readArtifact(ref, 8), Buffer.from('retained')); assert.ok(reads > 0); assert.ok(allocations > 0);
  restore(t);
  fs.chmodSync(join(f.directory, ref.sha256), 0o600); fs.writeFileSync(join(f.directory, ref.sha256), 'tampered');
  assert.equal(f.store.usage().usedBytes, 11, 'inventory measures lengths and does not claim hashes');
  assert.throws(() => f.store.readArtifact(ref, 8), /corrupted/);
  assert.throws(() => f.store.putBytes(Buffer.from('retained')), /immutable artifact changed/);
  assert.deepEqual(f.store.readArtifact(other, 3), Buffer.from('new'));
});

test('the new profile admits the complete 13568-object count while default reopening refuses it', t => {
  const f = fixture(t);
  for (let i = 0; i < 13568; i++) fs.writeFileSync(join(f.directory, identity(['cp2-count', i])), '', { mode: 0o400 });
  const usage = f.store.usage(); assert.ok(usage.entryCount >= 13569 && usage.entryCount < 32768);
  f.store.putBytes(Buffer.from('charged'));
  const binding = f.store.identity(); f.close();
  const old = new QualificationStore(f.directory, f.store.capacityBytes);
  try { assert.deepEqual(old.identity(), binding); assert.throws(() => old.usage(), /entry limit/); }
  finally { old.close(); }
  const reopened = new QualificationStore(f.directory, f.store.capacityBytes, profile);
  try { assert.deepEqual(reopened.identity(), binding); assert.equal(reopened.usedBytes, 7); }
  finally { reopened.close(); }
});

test('directory iteration stops at the finite new entry ceiling and closes on refusal', t => {
  const f = fixture(t), ref = f.store.putBytes(Buffer.alloc(0)); let iterations = 0, closes = 0, inspected = 0;
  const stat = fs.fstatSync;
  t.mock.method(fs, 'fstatSync', ((...args: Parameters<typeof fs.fstatSync>) => { inspected++; return stat(...args); }) as typeof fs.fstatSync);
  t.mock.method(fs, 'opendirSync', ((path: fs.PathLike, options?: { bufferSize?: number }) => {
    assert.match(String(path), /^\/proc\/self\/fd\/\d+\/\.$/); assert.equal(options?.bufferSize, 1);
    return { readSync() { iterations++; return { name: ref.sha256 }; }, closeSync() { closes++; } };
  }) as typeof fs.opendirSync);
  syncBuiltinESMExports();
  assert.throws(() => f.store.usage(), /entry limit/);
  assert.equal(iterations, 32768); assert.equal(inspected, 32767); assert.equal(closes, 1);
});

test('scalar lengths debit actual capacity and oversize singleton reads refuse before allocation', t => {
  const f = fixture(t, 11), a = f.store.putBytes(Buffer.from('five!')), b = f.store.putBytes(Buffer.from('six!!!'));
  assert.equal(f.store.usedBytes, 11); assert.throws(() => f.store.putBytes(Buffer.from('x')), /capacity exhausted/);
  fs.chmodSync(join(f.directory, a.sha256), 0o600); fs.truncateSync(join(f.directory, a.sha256), 6);
  assert.throws(() => f.store.usage(), /capacity exhausted/);
  let allocations = 0, reads = 0;
  t.mock.method(Buffer, 'alloc', () => { allocations++; throw new Error('allocated'); });
  t.mock.method(fs, 'readSync', () => { reads++; throw new Error('read'); }); syncBuiltinESMExports();
  assert.throws(() => f.store.readArtifact(b, 5), /read bound/); assert.deepEqual({ allocations, reads }, { allocations: 0, reads: 0 });
});

for (const unsafe of ['unknown', 'symlink', 'hardlink', 'directory', 'mode', 'owner', 'writer'] as const) test(`scalar inventory refuses ${unsafe} and closes the directory without body access`, t => {
  const f = fixture(t), ref = f.store.putBytes(Buffer.from('safe')), path = join(f.directory, ref.sha256);
  if (unsafe === 'unknown') fs.writeFileSync(join(f.directory, 'unknown'), '', { mode: 0o400 });
  else if (unsafe === 'symlink') { fs.unlinkSync(path); fs.symlinkSync('/dev/null', path); }
  else if (unsafe === 'hardlink') fs.linkSync(path, join(f.directory, identity('hardlink')));
  else if (unsafe === 'directory') { fs.unlinkSync(path); fs.mkdirSync(path, { mode: 0o700 }); }
  else if (unsafe === 'mode') fs.chmodSync(path, 0o444);
  else if (unsafe === 'writer') fs.chmodSync(join(f.directory, 'writer.sqlite'), 0o644);
  else {
    const stat = fs.fstatSync;
    t.mock.method(fs, 'fstatSync', ((fd: number, options: { bigint: true }) => {
      const value = stat(fd, options); Object.defineProperty(value, 'uid', { value: value.uid + 1n }); return value;
    }) as typeof fs.fstatSync);
  }
  const open = fs.opendirSync; let closes = 0;
  t.mock.method(fs, 'opendirSync', ((...args: Parameters<typeof fs.opendirSync>) => {
    const directory = open(...args), close = directory.closeSync.bind(directory);
    directory.closeSync = () => { closes++; return close(); }; return directory;
  }) as typeof fs.opendirSync);
  t.mock.method(fs, 'readSync', () => { throw new Error('inventory read a body'); }); syncBuiltinESMExports();
  assert.throws(() => f.store.usage(), unsafe === 'unknown' ? /Unknown evidence name/ : unsafe === 'symlink' ? /ELOOP/ : /file changed/);
  assert.equal(closes, 1);
});
