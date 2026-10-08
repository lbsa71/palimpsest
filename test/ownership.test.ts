import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { CoordinatorLock } from '../src/ownership.ts';

test('OS-backed SQLite lock excludes another coordinator and releases after process exit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'palimpsest-lock-'));
  const path = join(dir, 'coordinator.sqlite');
  let first: CoordinatorLock | undefined;
  try {
    first = new CoordinatorLock(path);
    assert.throws(() => new CoordinatorLock(path), /already active/);
    first.close();
    const script = `import { CoordinatorLock } from ${JSON.stringify(new URL('../src/ownership.ts', import.meta.url).href)};
      new CoordinatorLock(${JSON.stringify(path)}); process.exit(0);`;
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const next = new CoordinatorLock(path); next.close();
  } finally { first?.close(); rmSync(dir, { recursive: true, force: true }); }
});
