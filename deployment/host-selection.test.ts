import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { hostSelection, launchHost } from './host-successor.ts';
import type { SupervisorFile } from './cli.ts';

test('selection refuses a redirected journal without changing its target', () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-selection-'));
  try {
    const state = join(root, 'state'); mkdirSync(state, { mode: 0o700 });
    const target = join(root, 'outside.sqlite'); const db = new DatabaseSync(target);
    db.exec('CREATE TABLE sentinel(value TEXT)'); db.close(); chmodSync(target, 0o600);
    symlinkSync(target, join(state, 'host-successor.sqlite'));
    const before = readFileSync(target);
    assert.throws(() => hostSelection({ host: { stateDirectory: state } } as SupervisorFile), /journal|host/i);
    assert.deepEqual(readFileSync(target), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('selection rejects malformed or excessive values before returning executable targets', () => {
  for (const value of ['{}', JSON.stringify({ selected: { candidateId: '../outside', policyDigest: 'a'.repeat(64) }, rescue: {}, phase: 'ready' }), ' '.repeat(8193)]) {
    const root = mkdtempSync(join(tmpdir(), 'aeon-selection-'));
    try {
      const path = join(root, 'host-successor.sqlite'); const db = new DatabaseSync(path);
      db.exec('CREATE TABLE selection(singleton INTEGER PRIMARY KEY, value TEXT NOT NULL)');
      db.prepare('INSERT INTO selection VALUES(1,?)').run(value); db.close(); chmodSync(path, 0o600);
      assert.throws(() => hostSelection({ host: { stateDirectory: root } } as SupervisorFile), /selection|journal/i);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});


test('launcher rejects overlapping host roots before creating execution journals', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-selection-'));
  try {
    const state = join(root, 'state'), artifacts = join(root, 'artifacts');
    mkdirSync(state, { mode: 0o700 }); mkdirSync(artifacts, { mode: 0o700 });
    const path = join(root, 'config');
    writeFileSync(path, JSON.stringify({ host: { stateDirectory: state, workspaceDirectory: state, artifactStore: artifacts, nodeBinary: process.execPath } }), { mode: 0o600 });
    await assert.rejects(launchHost(path), /disjoint/);
    assert.equal(existsSync(join(state, 'host-launcher-lease.sqlite')), false);
    assert.equal(existsSync(join(state, 'host-successor.sqlite')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
