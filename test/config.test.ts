import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, statSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { loadConfig, prepareState, resolveExternalPath } from '../src/config.ts';

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'palimpsest-config-'));
  const repo = join(base, 'repo');
  mkdirSync(repo);
  return { base, repo, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test('state rejects checkout paths, including aliases and nonexistent descendants', () => {
  const f = fixture();
  try {
    assert.throws(() => resolveExternalPath(f.repo, join(f.repo, 'new', 'state')), /outside/);
    const alias = join(f.base, 'alias');
    symlinkSync(f.repo, alias);
    assert.throws(() => resolveExternalPath(f.repo, join(alias, 'new')), /outside/);
    assert.equal(resolveExternalPath(f.repo, join(f.base, 'data')), join(realpathSync(f.base), 'data'));
  } finally { f.cleanup(); }
});

test('private credentials load without mutating environment or entering state reports', () => {
  const f = fixture();
  try {
    const credentials = join(f.base, 'credentials.env');
    const originalKey = process.env.MISTRAL_API_KEY;
    writeFileSync(credentials, 'MISTRAL_API_KEY=synthetic-secret\nMISTRAL_MODEL=test-model\n', { mode: 0o600 });
    const config = loadConfig({ repositoryRoot: f.repo, env: {
      PALIMPSEST_CREDENTIALS_FILE: credentials, PALIMPSEST_DATA_DIR: join(f.base, 'data'),
    } });
    assert.equal(config.provider, 'mistral');
    assert.equal(config.model, 'test-model');
    assert.equal(config.mistralApiKey, 'synthetic-secret');
    assert.equal(process.env.MISTRAL_API_KEY, originalKey);
    assert.ok(!JSON.stringify(config.describe()).includes('synthetic-secret'));
    assert.ok(!JSON.stringify(config).includes('synthetic-secret'));
    assert.ok(!inspect(config).includes('synthetic-secret'));
    const prepared = prepareState(config);
    assert.equal(statSync(prepared.tokenPath).mode & 0o777, 0o600);
    assert.equal(prepareState(config).apiToken, prepared.apiToken);
  } finally { f.cleanup(); }
});

test('provider changes are explicit and absent configuration does not silently fall back', () => {
  const f = fixture();
  try {
    const env = { PALIMPSEST_CREDENTIALS_FILE: join(f.base, 'missing'), PALIMPSEST_DATA_DIR: join(f.base, 'state') };
    const config = loadConfig({ repositoryRoot: f.repo, env });
    assert.equal(config.provider, 'mistral');
    assert.equal(config.mistralApiKey, undefined);
    assert.equal(config.model, undefined);
    assert.equal(config.evolutionCallsPerDay, 8);
    assert.equal(loadConfig({ repositoryRoot: f.repo, env: { ...env, PALIMPSEST_EVOLUTION_CALLS_PER_DAY: '0' } }).evolutionCallsPerDay, 0);
    assert.equal(loadConfig({ repositoryRoot: f.repo, env: { ...env, PALIMPSEST_EVOLUTION_CALLS_PER_DAY: '12' } }).describe().evolutionCallsPerDay, 12);
    assert.throws(() => loadConfig({ repositoryRoot: f.repo, env: { ...env, PALIMPSEST_EVOLUTION_CALLS_PER_DAY: '-1' } }), /evolution/i);
    assert.equal(loadConfig({ repositoryRoot: f.repo, env: { ...env, PALIMPSEST_PROVIDER: 'codex', CODEX_MODEL: 'chosen' } }).model, 'chosen');
    assert.throws(() => loadConfig({ repositoryRoot: f.repo, env: { ...env, PALIMPSEST_PROVIDER: 'unknown' } }), /provider/);
  } finally { f.cleanup(); }
});

test('a credentials file cannot be inside the repository', () => {
  const f = fixture();
  try {
    assert.throws(() => loadConfig({ repositoryRoot: f.repo, env: { PALIMPSEST_CREDENTIALS_FILE: join(f.repo, '.env') } }), /outside/);
  } finally { f.cleanup(); }
});

test('starting from a checkout subdirectory cannot put state elsewhere in the checkout', () => {
  const f = fixture();
  try {
    mkdirSync(join(f.repo, '.git'));
    const sub = join(f.repo, 'src');
    mkdirSync(sub);
    assert.throws(() => loadConfig({ repositoryRoot: sub, env: {
      PALIMPSEST_CREDENTIALS_FILE: join(f.base, 'missing'),
      PALIMPSEST_DATA_DIR: join(f.repo, 'state'),
    } }), /outside/);
  } finally { f.cleanup(); }
});

test('dangling database aliases cannot redirect newly created lived state into the checkout', () => {
  const f = fixture();
  try {
    const dataDir = join(f.base, 'data'); mkdirSync(dataDir, { mode: 0o700 });
    symlinkSync(join(f.repo, 'leaked.sqlite'), join(dataDir, 'state.sqlite'));
    const config = loadConfig({ repositoryRoot: f.repo, env: {
      PALIMPSEST_DATA_DIR: dataDir, PALIMPSEST_CREDENTIALS_FILE: join(f.base, 'missing'),
    } });
    assert.throws(() => prepareState(config), /symlink|outside/);
  } finally { f.cleanup(); }
});
