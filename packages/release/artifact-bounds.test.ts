import assert from 'node:assert/strict';
import fs, { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { freezeCandidate, verifyCandidate, type ArtifactLimits } from './artifacts.ts';

const inputs = { dependencies: {}, prompts: {}, model: {}, configuration: {}, controls: {}, createdBy: 'bounded-source-review' };
const limits: ArtifactLimits = { maxFiles: 10, maxEntries: 20, maxBytes: 100, maxFileBytes: 50, maxDepth: 4 };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aeon-artifact-bounds-')), source = join(root, 'source'), store = join(root, 'store');
  mkdirSync(source); writeFileSync(join(source, 'one'), '1234567890'); writeFileSync(join(source, 'two'), 'abcdefghij');
  return { source, store, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

test('host artifact bounds reject oversized files, aggregate bytes, file counts and directory depth', () => {
  const f = fixture();
  try {
    assert.throws(() => freezeCandidate(f.source, f.store, ['one'], inputs, { ...limits, maxFileBytes: 9 }), /byte limits/);
    assert.throws(() => freezeCandidate(f.source, f.store, ['one', 'two'], inputs, { ...limits, maxBytes: 19 }), /byte limits/);
    assert.throws(() => freezeCandidate(f.source, f.store, ['one', 'two'], inputs, { ...limits, maxFiles: 1 }), /file limit/);
    mkdirSync(join(f.source, 'deep', 'nested'), { recursive: true }); writeFileSync(join(f.source, 'deep', 'nested', 'leaf'), 'x');
    assert.throws(() => freezeCandidate(f.source, f.store, ['deep'], inputs, { ...limits, maxDepth: 2 }), /depth limits/);
    assert.throws(() => freezeCandidate(f.source, f.store, ['deep'], inputs, { ...limits, maxEntries: 2 }), /entry\/depth limits/);
    const candidate = freezeCandidate(f.source, f.store, ['one', 'two'], inputs, limits);
    assert.equal(verifyCandidate(f.store, candidate.manifest.id, limits).manifest.id, candidate.manifest.id);
    assert.throws(() => verifyCandidate(f.store, candidate.manifest.id, { ...limits, maxBytes: 19 }), /byte limits/);
  } finally { f.dispose(); }
});

test('file growth after descriptor stat cannot bypass the per-file read bound', () => {
  const f = fixture(); const original = fs.fstatSync; let changed = false;
  try {
    fs.fstatSync = ((...args: Parameters<typeof fs.fstatSync>) => {
      const result = original(...args);
      if (!changed && result.isFile()) { changed = true; appendFileSync(join(f.source, 'one'), 'grows beyond the host limit'); }
      return result;
    }) as typeof fs.fstatSync;
    syncBuiltinESMExports();
    assert.throws(() => freezeCandidate(f.source, f.store, ['one'], inputs, { ...limits, maxFileBytes: 10 }), /changed during bounded read|byte limits/);
    assert.equal(changed, true);
  } finally { fs.fstatSync = original; syncBuiltinESMExports(); f.dispose(); }
});
