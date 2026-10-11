import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, linkSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { hashBytes } from '../packages/release/artifacts.ts';
import { maxRuntimeBytes, runtimeBundlePath, stageRuntimeBundle, verifyRuntimeFile, type RuntimeIdentity } from './runtime-bundle.ts';

test('runtime staging is bounded, hash-bound and descriptor-pinned without executing candidate bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-runtime-stage-'));
  const workspace = join(root, 'workspace'); mkdirSync(workspace);
  // Deliberately invalid ELF cannot execute; staging must perform byte checks only.
  const bytes = Buffer.from([127, 69, 76, 70, 1, 2, 3, 4]);
  const runtime: RuntimeIdentity = { nodeVersion: process.version, nodeSha256: hashBytes(bytes), platform: process.platform, arch: process.arch };
  const staging = (name: string) => { const path = join(root, name); mkdirSync(path); return path; };
  try {
    writeFileSync(join(workspace, 'node'), bytes, { mode: 0o700 });
    const retained = stageRuntimeBundle(workspace, 'node', staging('valid'), runtime, bytes.length);
    assert.deepEqual(retained.bundle, { path: runtimeBundlePath, bytes: bytes.length });
    verifyRuntimeFile(join(root, 'valid'), runtimeBundlePath, retained);
    assert.throws(() => stageRuntimeBundle(workspace, 'node', staging('no-grant'), runtime, 0), /staging grant/);
    assert.throws(() => stageRuntimeBundle(workspace, 'node', staging('oversize'), runtime, bytes.length - 1), /byte bounds/);
    assert.throws(() => stageRuntimeBundle(workspace, 'node', staging('wrong-hash'), { ...runtime, nodeSha256: 'a'.repeat(64) }, 64), /hash/);
    assert.throws(() => stageRuntimeBundle(workspace, '../workspace/node', staging('traversal'), runtime, 64), /Normalized/);
    assert.throws(() => stageRuntimeBundle(workspace, 'node', staging('platform'), { ...runtime, arch: 'other' }, 64), /physical platform/);
    assert.throws(() => stageRuntimeBundle(workspace, 'node', staging('version'), { ...runtime, nodeVersion: 'v25.0.0' }, 64), /Node 24/);
    assert.throws(() => verifyRuntimeFile(join(root, 'valid'), runtimeBundlePath, { ...retained, bundle: { path: runtimeBundlePath, bytes: bytes.length + 1 } }), /size differs/);
    symlinkSync(join(workspace, 'node'), join(workspace, 'link'));
    assert.throws(() => stageRuntimeBundle(workspace, 'link', staging('symlink'), runtime, 64));
    symlinkSync(workspace, join(root, 'ancestor'));
    assert.throws(() => stageRuntimeBundle(join(root, 'ancestor'), 'node', staging('ancestor-link'), runtime, 64));
    linkSync(join(workspace, 'node'), join(workspace, 'hardlink'));
    assert.throws(() => stageRuntimeBundle(workspace, 'hardlink', staging('hardlink-stage'), runtime, 64), /singly linked/);
    writeFileSync(join(workspace, 'huge'), bytes, { mode: 0o700 }); truncateSync(join(workspace, 'huge'), maxRuntimeBytes + 1);
    assert.throws(() => stageRuntimeBundle(workspace, 'huge', staging('per-file'), runtime, maxRuntimeBytes), /byte bounds/);
    writeFileSync(join(root, 'valid', runtimeBundlePath), Buffer.from([127, 69, 76, 70, 4, 3, 2, 1]));
    assert.throws(() => verifyRuntimeFile(join(root, 'valid'), runtimeBundlePath, retained), /runtime changed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
