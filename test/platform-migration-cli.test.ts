import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('CLI diagnoses an unverified migration but refuses state-opening commands before creating storage', () => {
  const directory = mkdtempSync(join(tmpdir(), 'palimpsest-migration-cli-'));
  const state = join(directory, 'state'); mkdirSync(state, { mode: 0o700 });
  writeFileSync(join(state, 'platform-migration.json'), '{"version":1,"status":"held"}', { mode: 0o600 });
  const env = { PATH: process.env.PATH, PALIMPSEST_DATA_DIR: state,
    PALIMPSEST_CREDENTIALS_FILE: join(directory, 'absent.env'), PALIMPSEST_PROVIDER: 'mistral' };
  const run = (...args: string[]) => spawnSync(process.execPath,
    [fileURLToPath(new URL('../src/cli.ts', import.meta.url)), ...args], { env, encoding: 'utf8' });
  try {
    const doctor = run('doctor'); assert.equal(doctor.status, 0, doctor.stderr);
    assert.equal(JSON.parse(doctor.stdout).liveIntegrationChecked, false);
    for (const args of [['tasks'], ['memory'], ['growth'], ['init'], ['ask', 'fixture'], ['serve', '0'], ['host-baseline', 'prepare']]) {
      const result = run(...args);
      assert.notEqual(result.status, 0, args.join(' '));
      assert.match(result.stderr, /Platform migration is not verified/, args.join(' '));
      assert.deepEqual(readdirSync(state), ['platform-migration.json'], 'no state, token, lock or custody is opened');
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
