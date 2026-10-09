import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { freezeBaseline, freezeCandidate } from '../src/candidates.ts';
import { assertSourceBindingCurrent, observeSourceIdentity, parseSourceBinding } from '../src/source-identity.ts';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'palimpsest-source-identity-'));
  const repositoryRoot = join(root, 'repo');
  mkdirSync(join(repositoryRoot, 'src', 'agent'), { recursive: true });
  mkdirSync(join(repositoryRoot, 'docs'));
  writeFileSync(join(repositoryRoot, 'src', 'agent', 'brain.ts'), 'export const cognition = 1;\n');
  writeFileSync(join(repositoryRoot, 'docs', 'seed-contract.md'), 'Synthetic protected contract.');
  const git = (...args: string[]) => execFileSync('/usr/bin/git', args, { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q'); git('config', 'user.name', 'Source Identity Fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('add', '.'); git('commit', '-qm', 'initial');
  const options = { repositoryRoot, dataDir: join(root, 'state'), configuration: {}, modelProfile: { provider: 'fixture', model: null } };
  const baseline = freezeBaseline(options);
  const release = { digest: baseline.id, artifactPath: baseline.releaseDir };
  return { root, repositoryRoot, git, options, baseline, release, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('observation binds actual checkout HEAD and exact admitted cognitive source', () => {
  const f = fixture();
  try {
    const binding = observeSourceIdentity(f);
    assert.deepEqual(binding, { version: 1, releaseDigest: f.baseline.id, sourceDigest: f.baseline.sourceDigest, baseCommit: f.git('rev-parse', 'HEAD').trim() });
    assert.ok(Object.isFrozen(binding));
    const successor = freezeCandidate({ ...f.options, changes: [{ path: 'src/agent/brain.ts', content: 'export const cognition = 2;\n' }] });
    assert.throws(() => observeSourceIdentity({ ...f, release: { digest: successor.id, artifactPath: successor.releaseDir } }), /admitted|source|checkout/i);
    writeFileSync(join(f.repositoryRoot, 'src', 'agent', 'brain.ts'), 'export const cognition = 2;\n');
    assert.throws(() => observeSourceIdentity(f), /clean/i);
    f.git('add', '.'); f.git('commit', '-qm', 'publish admitted cognition');
    const current = observeSourceIdentity({ ...f, release: { digest: successor.id, artifactPath: successor.releaseDir } });
    assert.notEqual(current.baseCommit, successor.baseCommit);
    assert.throws(() => assertSourceBindingCurrent(binding, current), /stale/i);
    assert.doesNotThrow(() => assertSourceBindingCurrent(current, current));
  } finally { f.cleanup(); }
});

test('observation rejects dirty or aliased checkout, mismatched release and mutated admitted bytes', () => {
  const f = fixture();
  try {
    assert.throws(() => observeSourceIdentity({ ...f, repositoryRoot: join(f.repositoryRoot, 'src') }), /checkout root/i);
    assert.throws(() => observeSourceIdentity({ ...f, release: { ...f.release, digest: 'a'.repeat(64) } }), /release/i);
    writeFileSync(join(f.repositoryRoot, 'untracked.ts'), 'unreviewed');
    assert.throws(() => observeSourceIdentity(f), /clean/i);
    rmSync(join(f.repositoryRoot, 'untracked.ts'));
    const checkoutBrain = join(f.repositoryRoot, 'src', 'agent', 'brain.ts');
    f.git('update-index', '--assume-unchanged', 'src/agent/brain.ts');
    writeFileSync(checkoutBrain, 'export const cognition = 9;\n');
    assert.equal(f.git('status', '--porcelain'), '');
    assert.throws(() => observeSourceIdentity(f), /checkout|digest/i);
    writeFileSync(checkoutBrain, 'export const cognition = 1;\n');
    f.git('update-index', '--no-assume-unchanged', 'src/agent/brain.ts');
    const path = join(f.baseline.candidateRoot, 'src', 'agent', 'brain.ts');
    chmodSync(path, 0o600); writeFileSync(path, 'export const cognition = 999;\n');
    assert.throws(() => observeSourceIdentity(f), /frozen|admitted|digest/i);
  } finally { f.cleanup(); }
});

test('binding comparison fails closed for missing, malformed, extra and individually stale identities', () => {
  const binding = { version: 1 as const, releaseDigest: 'a'.repeat(64), sourceDigest: 'b'.repeat(64), baseCommit: 'c'.repeat(40) };
  for (const invalid of [null, {}, { ...binding, version: 2 }, { ...binding, sourceDigest: 'bad' }, { ...binding, authority: true }]) {
    assert.throws(() => parseSourceBinding(invalid), /binding/i);
    assert.throws(() => assertSourceBindingCurrent(invalid, binding), /binding/i);
  }
  for (const key of ['releaseDigest', 'sourceDigest', 'baseCommit'] as const) {
    assert.throws(() => assertSourceBindingCurrent({ ...binding, [key]: 'd'.repeat(key === 'baseCommit' ? 40 : 64) }, binding), /stale/i);
  }
});
