import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

// Existing constructor/cleanup scaffold only; independent adversarial predicates follow.
test('review: each profile entry boundary admits limit minus one and refuses the next write before creation', t => {
  const f = fixture(t), empty = f.store.putBytes(Buffer.alloc(0));
  for (const [selected, limit] of [['default', 4096], [profile, 32768]] as const) {
    const directory = fs.mkdtempSync(join(tmpdir(), 'cp2-review-boundary-')); fs.chmodSync(directory, 0o700);
    const store = new QualificationStore(directory, 10000, selected); let iterated = 0, closed = 0;
    const actualOpen = fs.openSync;
    t.mock.method(fs, 'opendirSync', (() => ({ readSync: () => ++iterated < limit ? { name: empty.sha256 } : null, closeSync: () => { closed++; } })) as unknown as typeof fs.opendirSync);
    t.mock.method(fs, 'openSync', ((path: fs.PathLike, flags: number, mode?: number) => String(path).endsWith(`/${empty.sha256}`) ? actualOpen(join(f.directory, empty.sha256), flags, mode) : actualOpen(path, flags, mode)) as typeof fs.openSync);
    syncBuiltinESMExports();
    try {
      assert.deepEqual(store.usage(), { usedBytes: 0, entryCount: limit - 1 });
      iterated = 0; assert.throws(() => store.putBytes(Buffer.from('new-boundary')), /entry limit/); assert.equal(closed, 2);
      restore(t); assert.equal(fs.readdirSync(directory).filter(n => /^[a-f0-9]{64}$/.test(n)).length, 0);
    } finally { restore(t); store.close(); fs.rmSync(directory, { recursive: true, force: true }); }
  }
});

test('review: opened inode metadata wins over a benign directory entry and descriptor closes on rejection', t => {
  const f = fixture(t), ref = f.store.putBytes(Buffer.from('abc')), stat = fs.fstatSync, open = fs.openSync, close = fs.closeSync;
  let evidenceFd = -1, evidenceCloses = 0, dirCloses = 0; const opendir = fs.opendirSync;
  t.mock.method(fs, 'opendirSync', ((...args: Parameters<typeof fs.opendirSync>) => { const dir = opendir(...args), end = dir.closeSync.bind(dir); dir.closeSync = () => { dirCloses++; end(); }; return dir; }) as typeof fs.opendirSync);
  t.mock.method(fs, 'openSync', ((path: fs.PathLike, flags: number, mode?: number) => { const fd = open(path, flags, mode); if (String(path).endsWith(`/${ref.sha256}`)) { assert(flags & fs.constants.O_NOFOLLOW); assert(flags & fs.constants.O_NONBLOCK); evidenceFd = fd; } return fd; }) as typeof fs.openSync);
  t.mock.method(fs, 'fstatSync', ((fd: number, options?: { bigint?: boolean }) => { const s = stat(fd, options as { bigint: true }); return fd === evidenceFd ? { ...s, isFile: () => true, nlink: 2n } : s; }) as typeof fs.fstatSync);
  t.mock.method(fs, 'closeSync', (fd: number) => { if (fd === evidenceFd) evidenceCloses++; close(fd); }); syncBuiltinESMExports();
  assert.throws(() => f.store.usage(), /file changed/); assert.equal(evidenceCloses, 1); assert.equal(dirCloses, 1);
});

for (const size of [-1n, 100001n]) test(`review: scalar inventory refuses impossible evidence size ${size} without body access`, t => {
  const f = fixture(t), ref = f.store.putBytes(Buffer.from('abc')), stat = fs.fstatSync, open = fs.openSync; let selected = -1, bodyReads = 0;
  t.mock.method(fs, 'openSync', ((path: fs.PathLike, flags: number, mode?: number) => { const fd = open(path, flags, mode); if (String(path).endsWith(`/${ref.sha256}`)) selected = fd; return fd; }) as typeof fs.openSync);
  t.mock.method(fs, 'fstatSync', ((fd: number, options?: { bigint?: boolean }) => { const s = stat(fd, options as { bigint: true }); return fd === selected ? { ...s, isFile: () => true, size } : s; }) as typeof fs.fstatSync);
  t.mock.method(fs, 'readSync', () => { bodyReads++; throw Error('body'); }); syncBuiltinESMExports();
  assert.throws(() => f.store.usage(), /exceeds store capacity/); assert.equal(bodyReads, 0);
});

test('review: path replacement cannot redirect an already pinned scalar inventory or immutable read', t => {
  const f = fixture(t), ref = f.store.putBytes(Buffer.from('original')); const moved = `${f.directory}-moved`;
  fs.renameSync(f.directory, moved); fs.mkdirSync(f.directory, { mode: 0o700 }); fs.writeFileSync(join(f.directory, 'foreign'), 'replacement', { mode: 0o600 });
  t.after(() => fs.rmSync(moved, { recursive: true, force: true }));
  assert.equal(f.store.usedBytes, 8); assert.deepEqual(f.store.readArtifact(ref), Buffer.from('original'));
  f.store.putBytes(Buffer.from('still pinned')); assert.deepEqual(fs.readdirSync(f.directory), ['foreign']);
});

test('review: fresh scalar scans charge changed lengths and close prohibits inventory/dedup', t => {
  const f = fixture(t, 12), ref = f.store.putBytes(Buffer.from('same'));
  assert.equal(f.store.usedBytes, 4); fs.chmodSync(join(f.directory, ref.sha256), 0o600); fs.writeFileSync(join(f.directory, ref.sha256), 'changed');
  assert.equal(f.store.usedBytes, 7); assert.throws(() => f.store.putBytes(Buffer.from('same')), /read bound|immutable artifact changed/);
  f.close(); assert.throws(() => f.store.usage(), /closed|lease/i); assert.throws(() => f.store.putBytes(Buffer.from('same')), /closed|lease/i);
});
