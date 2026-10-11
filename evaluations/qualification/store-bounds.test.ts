import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson, identity, type ArtifactRef } from '../../packages/contracts/index.ts';
import { hashBytes } from '../../packages/release/artifacts.ts';
import { QualificationStore } from './store.ts';

function fixture(capacity = 100_000) {
  const root = fs.mkdtempSync(join(tmpdir(), 'aeon-store-bounds-')), directory = join(root, 'private');
  fs.mkdirSync(directory, { mode: 0o700 });
  const store = new QualificationStore(directory, capacity);
  return { root, directory, store, path(ref: ArtifactRef) { return join(directory, ref.sha256); }, dispose() { store.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}
function refFor(bytes: Uint8Array): ArtifactRef { const sha256 = hashBytes(bytes); return { uri: `sha256:${sha256}`, sha256 }; }
function mockRead(t: TestContext, replacement: typeof fs.readSync): void {
  t.mock.method(fs, 'readSync', replacement); syncBuiltinESMExports();
}
function restore(t: TestContext): void { t.mock.restoreAll(); syncBuiltinESMExports(); }

test('raw bytes retain binary identity, owned snapshot and immutable content addressing', () => {
  const f = fixture();
  try {
    const input = Uint8Array.from([0, 255, 254, 192, 128, 10, 0]), original = Buffer.from(input), ref = f.store.putBytes(input);
    assert.deepEqual(ref, refFor(original)); assert.deepEqual(fs.readFileSync(f.path(ref)), original);
    input.fill(7); assert.deepEqual(f.store.readArtifact(ref, original.length), original);
    const returned = f.store.readArtifact(ref); returned.fill(8);
    assert.deepEqual(f.store.readArtifact(ref), original);
    const usage = f.store.usage(); assert.deepEqual(f.store.putBytes(original), ref); assert.deepEqual(f.store.usage(), usage);
  } finally { f.dispose(); }
});

test('existing JSON API keeps canonical bytes and deduplicates the identical raw stream', () => {
  const f = fixture();
  try {
    const value = { z: [2, 'é'], a: true }, bytes = Buffer.from(canonicalJson(value)), ref = f.store.put(value);
    assert.deepEqual(ref, refFor(bytes)); assert.deepEqual(f.store.readArtifact(ref), bytes);
    const usage = f.store.usage(); assert.deepEqual(f.store.putBytes(bytes), ref); assert.deepEqual(f.store.usage(), usage);
  } finally { f.dispose(); }
});

test('empty bytes require EOF verification and permit a zero-byte bound', () => {
  const f = fixture();
  try {
    const ref = f.store.putBytes(new Uint8Array()); assert.deepEqual(ref, refFor(Buffer.alloc(0)));
    assert.equal(f.store.readArtifact(ref, 0).length, 0);
    assert.throws(() => f.store.readArtifact(f.store.putBytes(Buffer.from([1])), 0), /read bound/);
  } finally { f.dispose(); }
});

test('oversized artifact rejects before any buffer allocation or data read', t => {
  const f = fixture(), originalAlloc = Buffer.alloc, originalRead = fs.readSync;
  try {
    const bytes = Buffer.alloc(10_001, 5), ref = f.store.putBytes(bytes); let allocations = 0, reads = 0;
    t.mock.method(Buffer, 'alloc', ((...args: Parameters<typeof Buffer.alloc>) => { allocations++; return originalAlloc(...args); }) as typeof Buffer.alloc);
    mockRead(t, ((...args: Parameters<typeof fs.readSync>) => { reads++; return originalRead(...args); }) as typeof fs.readSync);
    assert.throws(() => f.store.readArtifact(ref, 10_000), /read bound/);
    assert.equal(allocations, 0); assert.equal(reads, 0);
    restore(t); assert.deepEqual(f.store.readArtifact(ref, 10_001), bytes);
  } finally { restore(t); f.dispose(); }
});

test('invalid bounds and refs fail without reading or allocating', t => {
  const f = fixture(), originalRead = fs.readSync, originalAlloc = Buffer.alloc;
  try {
    const ref = f.store.putBytes(Buffer.from([1])); let allocations = 0, reads = 0;
    t.mock.method(Buffer, 'alloc', ((...args: Parameters<typeof Buffer.alloc>) => { allocations++; return originalAlloc(...args); }) as typeof Buffer.alloc);
    mockRead(t, ((...args: Parameters<typeof fs.readSync>) => { reads++; return originalRead(...args); }) as typeof fs.readSync);
    for (const limit of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, f.store.capacityBytes + 1]) assert.throws(() => f.store.readArtifact(ref, limit), /Bounded/);
    for (const changed of [{ ...ref, uri: 'file:/etc/passwd' }, { ...ref, sha256: '../writer.sqlite' }, { ...ref, sha256: ref.sha256.toUpperCase() }]) assert.throws(() => f.store.readArtifact(changed), /Content-addressed/);
    assert.equal(allocations, 0); assert.equal(reads, 0);
  } finally { restore(t); f.dispose(); }
});

test('short positive reads preserve all exact bytes', t => {
  const f = fixture(), original = fs.readSync;
  try {
    const bytes = Buffer.from('short-read-binary\0\xff'), ref = f.store.putBytes(bytes); let calls = 0;
    mockRead(t, ((fd: number, buffer: NodeJS.ArrayBufferView, offset: number, length: number, position: number) => {
      calls++; return original(fd, buffer, offset, Math.min(length, 2), position);
    }) as typeof fs.readSync);
    assert.deepEqual(f.store.readArtifact(ref, bytes.length), bytes); assert.ok(calls > 2);
  } finally { restore(t); f.dispose(); }
});

for (const change of ['grow', 'shrink', 'overwrite', 'chmod', 'hardlink', 'after-eof'] as const) test(`read-time ${change} fails instead of returning an artifact`, t => {
  const f = fixture(), original = fs.readSync;
  try {
    const bytes = Buffer.from('original-bytes'), ref = f.store.putBytes(bytes), path = f.path(ref); let changed = false;
    mockRead(t, ((fd: number, buffer: NodeJS.ArrayBufferView, offset: number, length: number, position: number) => {
      const count = original(fd, buffer, offset, length, position);
      if (!changed && (change !== 'after-eof' || count === 0)) {
        changed = true;
        if (change === 'chmod') fs.chmodSync(path, 0o600);
        else if (change === 'hardlink') fs.linkSync(path, join(f.root, 'extra-link'));
        else { fs.chmodSync(path, 0o600); fs.writeFileSync(path, change === 'grow' ? Buffer.concat([bytes, Buffer.from([1])]) : change === 'shrink' ? bytes.subarray(0, 2) : Buffer.alloc(bytes.length, 1)); }
      }
      return count;
    }) as typeof fs.readSync);
    assert.throws(() => f.store.readArtifact(ref, bytes.length), /changed during read/); assert.equal(changed, true);
  } finally { restore(t); f.dispose(); }
});

test('empty artifact growth at the EOF probe fails', t => {
  const f = fixture(), original = fs.readSync;
  try {
    const ref = f.store.putBytes(Buffer.alloc(0));
    mockRead(t, ((fd: number, buffer: NodeJS.ArrayBufferView, offset: number, length: number, position: number) => {
      const count = original(fd, buffer, offset, length, position); fs.chmodSync(f.path(ref), 0o600); fs.writeFileSync(f.path(ref), 'x'); return count;
    }) as typeof fs.readSync);
    assert.throws(() => f.store.readArtifact(ref, 0), /changed during read/);
  } finally { restore(t); f.dispose(); }
});

test('path replacement cannot substitute bytes for the opened descriptor', t => {
  const f = fixture(), original = fs.readSync;
  try {
    const bytes = Buffer.from('pinned-file'), ref = f.store.putBytes(bytes), path = f.path(ref); let changed = false;
    mockRead(t, ((fd: number, buffer: NodeJS.ArrayBufferView, offset: number, length: number, position: number) => {
      const count = original(fd, buffer, offset, length, position);
      if (!changed) { changed = true; fs.renameSync(path, join(f.root, 'original')); fs.writeFileSync(path, Buffer.alloc(bytes.length, 1), { mode: 0o400 }); }
      return count;
    }) as typeof fs.readSync);
    // Renaming changes ctime on this Linux host, so rejection is valid. It must never return the replacement.
    try { assert.deepEqual(f.store.readArtifact(ref), bytes); } catch (error) { assert.match(String(error), /changed during read/); }
    restore(t); assert.throws(() => f.store.readArtifact(ref), /corrupted/);
  } finally { restore(t); f.dispose(); }
});

test('same-size corruption and altered immutable artifact fail read and deduplication', () => {
  const f = fixture();
  try {
    const bytes = Buffer.from('artifact'), ref = f.store.putBytes(bytes); fs.chmodSync(f.path(ref), 0o600); fs.writeFileSync(f.path(ref), Buffer.alloc(bytes.length, 9));
    assert.throws(() => f.store.readArtifact(ref), /corrupted/); assert.throws(() => f.store.putBytes(bytes), /immutable artifact changed/);
  } finally { f.dispose(); }
});

test('pre-read ownership and FIFO metadata fail before allocation/data read; opening is nonblocking and refuses symlinks', t => {
  const f = fixture(), originalStat = fs.fstatSync, originalOpen = fs.openSync, originalRead = fs.readSync;
  try {
    const ref = f.store.putBytes(Buffer.from('private')), path = f.path(ref); let kind = 'owner', flags = 0, reads = 0;
    t.mock.method(fs, 'openSync', ((name: fs.PathLike, selected: number, mode?: fs.Mode) => {
      flags = selected; return originalOpen(name, selected, mode);
    }) as typeof fs.openSync);
    t.mock.method(fs, 'fstatSync', ((fd: number, options: { bigint: true }) => {
      const stat = originalStat(fd, options);
      if (kind === 'owner') Object.defineProperty(stat, 'uid', { value: stat.uid + 1n });
      else stat.isFile = () => false;
      return stat;
    }) as typeof fs.fstatSync);
    mockRead(t, ((...args: Parameters<typeof fs.readSync>) => { reads++; return originalRead(...args); }) as typeof fs.readSync);
    assert.throws(() => f.store.readArtifact(ref), /file changed/); kind = 'fifo';
    assert.throws(() => f.store.readArtifact(ref), /file changed/);
    assert.ok(flags & fs.constants.O_NONBLOCK); assert.ok(flags & fs.constants.O_NOFOLLOW); assert.equal(reads, 0);
    assert.equal(fs.existsSync(path), true);
  } finally { restore(t); f.dispose(); }
});

test('unknown evidence directory entries fail usage and prevent new writes', () => {
  const f = fixture();
  try {
    fs.writeFileSync(join(f.directory, 'unknown'), '', { mode: 0o400 });
    assert.throws(() => f.store.usage(), /Unknown evidence name/); assert.throws(() => f.store.putBytes(Buffer.from('new')), /Unknown evidence name/);
  } finally { f.dispose(); }
});

for (const kind of ['symlink', 'hardlink', 'directory', 'permissions'] as const) test(`unsafe ${kind} rejects reads and duplicate writes`, () => {
  const f = fixture();
  try {
    const bytes = Buffer.from('unsafe'), ref = refFor(bytes), path = f.path(ref), outside = join(f.root, 'outside');
    fs.writeFileSync(outside, bytes, { mode: 0o400 });
    if (kind === 'symlink') fs.symlinkSync(outside, path);
    else if (kind === 'hardlink') fs.linkSync(outside, path);
    else if (kind === 'directory') fs.mkdirSync(path, { mode: 0o700 });
    else fs.writeFileSync(path, bytes, { mode: 0o444 });
    assert.throws(() => f.store.readArtifact(ref)); assert.throws(() => f.store.putBytes(bytes));
  } finally { f.dispose(); }
});

test('byte capacity permits verified JSON/raw duplicates but rejects new bytes before creation', () => {
  const f = fixture(3);
  try {
    const ref = f.store.put('a'), usage = f.store.usage(); assert.equal(usage.usedBytes, 3);
    assert.deepEqual(f.store.put('a'), ref); assert.deepEqual(f.store.putBytes(Buffer.from('"a"')), ref);
    const extra = Buffer.from([1]); assert.throws(() => f.store.putBytes(extra), /capacity exhausted/);
    assert.equal(fs.existsSync(f.path(refFor(extra))), false); assert.deepEqual(f.store.usage(), usage);
    assert.throws(() => f.store.putBytes(Buffer.alloc(4)), /capacity exhausted/);
  } finally { f.dispose(); }
});

test('raw input exceeding store capacity rejects before snapshot allocation', t => {
  const f = fixture(3), original = Buffer.from;
  try {
    const bytes = new Uint8Array(4); let copies = 0;
    t.mock.method(Buffer, 'from', ((...args: Parameters<typeof Buffer.from>) => { copies++; return original(...args); }) as typeof Buffer.from);
    assert.throws(() => f.store.putBytes(bytes), /capacity exhausted/); assert.equal(copies, 0);
  } finally { restore(t); f.dispose(); }
});

test('entry capacity permits existing duplicates and prevents crossing the existing strict ceiling', () => {
  const f = fixture();
  try {
    const bytes = Buffer.from([1]), ref = f.store.putBytes(bytes), count = fs.readdirSync(f.directory).length;
    for (let i = count; i < 4095; i++) fs.writeFileSync(join(f.directory, identity(`entry-${i}`)), Buffer.alloc(0), { mode: 0o400 });
    assert.equal(f.store.usage().entryCount, 4095); assert.deepEqual(f.store.putBytes(bytes), ref);
    assert.throws(() => f.store.putBytes(Buffer.from([2])), /entry limit/); assert.equal(f.store.usage().entryCount, 4095);
  } finally { f.dispose(); }
});

test('claimed IDs and grants stay one-use and share total capacity with artifacts', () => {
  const f = fixture();
  try {
    f.store.claim('attempt-1', 'grant-1', { exact: true }); const usage = f.store.usage();
    assert.ok(usage.usedBytes > 0); assert.throws(() => f.store.claim('attempt-1', 'grant-1', {}), { code: 'EEXIST' });
    assert.deepEqual(f.store.usage(), usage);
    assert.throws(() => f.store.claim('attempt-1', 'grant-2', {}), { code: 'EEXIST' });
    assert.ok(fs.existsSync(join(f.directory, `grant-${identity('grant-2')}`)), 'grant remains stranded when second claim write fails');
    assert.throws(() => f.store.claim('attempt-3', 'grant-2', {}), { code: 'EEXIST' });
  } finally { f.dispose(); }
});

test('store identity and reads remain bound to the original directory after rename/replacement', () => {
  const f = fixture();
  try {
    const bytes = Buffer.from('directory-pinned'), ref = f.store.putBytes(bytes), original = f.store.identity();
    fs.renameSync(f.directory, join(f.root, 'moved')); fs.mkdirSync(f.directory, { mode: 0o700 });
    fs.writeFileSync(f.path(ref), Buffer.alloc(bytes.length, 1), { mode: 0o400 });
    assert.deepEqual(f.store.identity(), original); assert.deepEqual(f.store.readArtifact(ref), bytes);
    f.store.putBytes(Buffer.from('new')); assert.equal(fs.readdirSync(f.directory).length, 1);
  } finally { f.dispose(); }
});

test('exclusive and closed writer leases guard every storage API', () => {
  const f = fixture();
  try {
    const ref = f.store.putBytes(Buffer.from([1])); assert.throws(() => new QualificationStore(f.directory), /lease/);
    f.store.close();
    for (const action of [() => f.store.putBytes(Buffer.from([1])), () => f.store.put(1), () => f.store.readArtifact(ref), () => f.store.usage(), () => f.store.identity(), () => f.store.claim('attempt', 'grant', {})]) assert.throws(action, /lease is closed/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});
