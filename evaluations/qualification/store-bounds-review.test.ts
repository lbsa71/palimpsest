import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ArtifactRef } from '../../packages/contracts/index.ts';
import type { BoundedArtifactReader } from '../development/witness.ts';
import { QualificationStore } from './store.ts';

function fixture(t: TestContext, capacity = 200_000) {
  const directory = fs.mkdtempSync(join(tmpdir(), 'aeon-raw-review-'));
  fs.chmodSync(directory, 0o700);
  const store = new QualificationStore(directory, capacity);
  let closed = false;
  const close = () => { if (!closed) { store.close(); closed = true; } };
  t.after(() => {
    t.mock.restoreAll(); syncBuiltinESMExports();
    close(); fs.rmSync(directory, { recursive: true, force: true });
  });
  return { store, directory, close, path: (ref: ArtifactRef) => join(directory, ref.sha256) };
}
function restore(t: TestContext): void { t.mock.restoreAll(); syncBuiltinESMExports(); }

test('review: a raw subarray retains every octet and excludes its backing-array prefix/suffix', t => {
  const f = fixture(t), backing = new Uint8Array(260).fill(42);
  for (let i = 0; i < 256; i++) backing[i + 2] = i;
  const view = backing.subarray(2, 258), expected = Buffer.from(view), ref = f.store.putBytes(view);
  assert.equal(ref.sha256, createHash('sha256').update(expected).digest('hex'));
  assert.equal(ref.uri, `sha256:${ref.sha256}`);
  backing.fill(0);
  assert.deepEqual(fs.readFileSync(f.path(ref)), expected);
  assert.deepEqual(f.store.readArtifact(ref, 256), expected);
  assert.equal(f.store.usage().usedBytes, 256);
});

test('review: JSON canonical ordering and rejected values remain independent of raw retention', t => {
  const f = fixture(t), value = { z: -0, a: ['\u0000', 'é', true, null] };
  const expected = Buffer.from('{"a":["\\u0000","é",true,null],"z":0}');
  const ref = f.store.put(value);
  assert.deepEqual(f.store.readArtifact(ref), expected);
  assert.deepEqual(f.store.putBytes(expected), ref);
  const prior = f.store.usage(), cycle: Record<string, unknown> = {}; cycle.self = cycle;
  for (const invalid of [undefined, NaN, Infinity, 1n, new Date(0), new Uint8Array([1]), { missing: undefined }, Array(2), cycle]) {
    assert.throws(() => f.store.put(invalid));
    assert.deepEqual(f.store.usage(), prior);
  }
});

test('review: the actual development reader type forwards a remaining allowance before allocation', t => {
  const f = fixture(t), ref = f.store.putBytes(Buffer.from('four'));
  const reader: BoundedArtifactReader = (artifact, maxBytes) => f.store.readArtifact(artifact, maxBytes);
  const stat = fs.fstatSync; let checked = false, allocations = 0, reads = 0;
  t.mock.method(fs, 'fstatSync', ((...args: Parameters<typeof fs.fstatSync>) => { checked = true; return stat(...args); }) as typeof fs.fstatSync);
  t.mock.method(Buffer, 'alloc', () => { allocations++; throw new Error('allocation preceded admission'); });
  t.mock.method(fs, 'readSync', () => { reads++; throw new Error('read preceded admission'); });
  syncBuiltinESMExports();
  assert.throws(() => reader(ref, 3), /exceeds read bound/);
  assert.equal(checked, true); assert.equal(allocations, 0); assert.equal(reads, 0);
  restore(t); assert.deepEqual(reader(ref, 4), Buffer.from('four'));
});

test('review: bounded reads touch only the named artifact, regardless of unrelated inventory', t => {
  const f = fixture(t), ref = f.store.putBytes(Buffer.from('small'));
  fs.writeFileSync(join(f.directory, 'unrelated-invalid-entry'), 'not evidence', { mode: 0o600 });
  t.mock.method(fs, 'readdirSync', () => { throw new Error('bounded read unexpectedly inventoried store'); });
  syncBuiltinESMExports();
  assert.deepEqual(f.store.readArtifact(ref, 5), Buffer.from('small'));
  restore(t); assert.throws(() => f.store.usage(), /Unknown evidence name/);
});

for (const failure of ['io-error', 'premature-eof'] as const) test(`review: ${failure} after a real partial read returns no bytes and closes its descriptor`, t => {
  const f = fixture(t), bytes = Buffer.alloc(65_537, 73), ref = f.store.putBytes(bytes);
  const read = fs.readSync, stat = fs.fstatSync; let calls = 0, opened = -1;
  t.mock.method(fs, 'readSync', ((fd: number, buffer: NodeJS.ArrayBufferView, offset: number, length: number, position: number) => {
    opened = fd; calls++;
    if (calls === 1) return read(fd, buffer, offset, Math.min(length, 31), position);
    if (failure === 'premature-eof') return 0;
    throw Object.assign(new Error('injected read failure'), { code: 'EIO' });
  }) as typeof fs.readSync);
  syncBuiltinESMExports();
  assert.throws(() => f.store.readArtifact(ref, bytes.length), failure === 'io-error' ? /injected read failure/ : /changed during read/);
  assert.equal(calls, 2); assert.throws(() => stat(opened), { code: 'EBADF' });
  restore(t); assert.deepEqual(f.store.readArtifact(ref, bytes.length), bytes);
});

test('review: real multi-chunk reads use bounded explicit offsets and still probe EOF', t => {
  const f = fixture(t), bytes = Buffer.alloc(131_073);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  const ref = f.store.putBytes(bytes), read = fs.readSync;
  const requests: { offset: number; length: number; position: number; count: number }[] = [];
  t.mock.method(fs, 'readSync', ((fd: number, buffer: NodeJS.ArrayBufferView, offset: number, length: number, position: number) => {
    const count = read(fd, buffer, offset, length, position);
    requests.push({ offset, length, position, count }); return count;
  }) as typeof fs.readSync);
  syncBuiltinESMExports();
  assert.deepEqual(f.store.readArtifact(ref, bytes.length), bytes);
  let consumed = 0;
  for (const request of requests.slice(0, -1)) {
    assert.equal(request.position, consumed); assert.equal(request.offset, consumed);
    assert.ok(request.length <= 65_536); assert.ok(request.count > 0); consumed += request.count;
  }
  assert.equal(consumed, bytes.length);
  assert.deepEqual(requests.at(-1), { offset: 0, length: 1, position: bytes.length, count: 0 });
});

test('review: post-read descriptor stat failure discards verified-looking bytes and closes descriptor', t => {
  const f = fixture(t), ref = f.store.putBytes(Buffer.from('complete-looking'));
  const stat = fs.fstatSync; let calls = 0, opened = -1;
  t.mock.method(fs, 'fstatSync', ((...args: Parameters<typeof fs.fstatSync>) => {
    opened = args[0]; calls++;
    if (calls === 2) throw Object.assign(new Error('injected final stat failure'), { code: 'EIO' });
    return stat(...args);
  }) as typeof fs.fstatSync);
  syncBuiltinESMExports();
  assert.throws(() => f.store.readArtifact(ref), /injected final stat failure/);
  assert.equal(calls, 2); assert.throws(() => stat(opened), { code: 'EBADF' });
  restore(t); assert.equal(f.store.readArtifact(ref).toString(), 'complete-looking');
});

test('review: same-size post-read content replacement with original mtime restored still fails', t => {
  const f = fixture(t), bytes = Buffer.from('original'), ref = f.store.putBytes(bytes), path = f.path(ref);
  fs.chmodSync(path, 0o600);
  const before = fs.statSync(path), read = fs.readSync; let changed = false;
  t.mock.method(fs, 'readSync', ((fd: number, buffer: NodeJS.ArrayBufferView, offset: number, length: number, position: number) => {
    const count = read(fd, buffer, offset, length, position);
    if (!changed) { changed = true; fs.writeFileSync(path, 'tampered'); fs.utimesSync(path, before.atime, before.mtime); }
    return count;
  }) as typeof fs.readSync);
  syncBuiltinESMExports();
  assert.throws(() => f.store.readArtifact(ref, bytes.length), /changed during read/);
  assert.equal(changed, true);
  restore(t); assert.throws(() => f.store.readArtifact(ref, bytes.length), /corrupted/);
});

test('review: unsafe real permissions and links reject before allocation or data access', t => {
  const f = fixture(t), bytes = Buffer.from('private'), ref = f.store.putBytes(bytes), path = f.path(ref);
  const linked = join(f.directory, 'second-link');
  t.mock.method(Buffer, 'alloc', () => { throw new Error('unsafe file allocated'); });
  t.mock.method(fs, 'readSync', () => { throw new Error('unsafe file read'); });
  syncBuiltinESMExports();
  fs.chmodSync(path, 0o440); assert.throws(() => f.store.readArtifact(ref), /file changed/);
  fs.chmodSync(path, 0o400); fs.linkSync(path, linked); assert.throws(() => f.store.readArtifact(ref), /file changed/);
  fs.unlinkSync(linked); restore(t); assert.deepEqual(f.store.readArtifact(ref), bytes);
});

test('review: persisted raw evidence survives lease close/reopen and full-capacity deduplication', t => {
  const f = fixture(t, 4), bytes = Buffer.from([0, 255, 128, 0]), ref = f.store.putBytes(bytes);
  f.close();
  const reopened = new QualificationStore(f.directory, 4);
  try {
    assert.deepEqual(reopened.readArtifact(ref, 4), bytes);
    const before = reopened.usage(); assert.deepEqual(reopened.putBytes(bytes), ref);
    assert.deepEqual(reopened.usage(), before);
    assert.throws(() => reopened.putBytes(Buffer.from([2])), /capacity exhausted/);
  } finally { reopened.close(); }
});

for (const scenario of ['existing', 'empty-existing', 'exclusive-create-race'] as const) test(`review: ${scenario} deduplication rejects a larger artifact before allocation/read`, t => {
  const f = fixture(t, 1024), original = scenario === 'empty-existing' ? Buffer.alloc(0) : Buffer.from([17]);
  const ref = f.store.putBytes(original), corrupt = Buffer.alloc(100, 17);
  if (scenario === 'exclusive-create-race') fs.unlinkSync(f.path(ref));
  else { fs.chmodSync(f.path(ref), 0o600); fs.writeFileSync(f.path(ref), corrupt); }
  const alloc = Buffer.alloc, read = fs.readSync, open = fs.openSync; let allocations = 0, reads = 0, injected = false;
  if (scenario === 'exclusive-create-race') t.mock.method(fs, 'openSync', ((path: fs.PathLike, flags: number, mode?: fs.Mode) => {
    if (flags & fs.constants.O_EXCL) {
      injected = true;
      const competing = open(path, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o400);
      try { fs.writeFileSync(competing, corrupt); } finally { fs.closeSync(competing); }
    }
    return open(path, flags, mode);
  }) as typeof fs.openSync);
  t.mock.method(Buffer, 'alloc', ((...args: Parameters<typeof Buffer.alloc>) => { allocations++; return alloc(...args); }) as typeof Buffer.alloc);
  t.mock.method(fs, 'readSync', ((...args: Parameters<typeof fs.readSync>) => { reads++; return read(...args); }) as typeof fs.readSync);
  syncBuiltinESMExports();
  assert.throws(() => f.store.putBytes(original));
  if (scenario === 'exclusive-create-race') assert.equal(injected, true);
  assert.deepEqual({ allocations, reads }, { allocations: 0, reads: 0 }, 'the existing artifact is larger than the entire known input');
});
