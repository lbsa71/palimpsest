import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertPrivateRoot, hash, runApplicationCase } from './adapter.ts';
import { runFixture } from './run.ts';
import { fixtureConfiguration } from './fixture.ts';
import { AuthorityStore } from '../../packages/supervisor/authority.ts';
import { fileURLToPath } from 'node:url';

test('actual application repairs a real failing command and external evaluator checks artifacts and explicit output', async () => {
  const report = await runFixture();
  assert.equal(report.verdict, 'case-pass', JSON.stringify(report, null, 2));
  assert.equal(report.evidenceKind, 'integration');
  assert.equal(report.independent, false); assert.equal(report.admissionEligible, false);
  assert.equal(report.transportFixtures?.length, 7);
  assert.equal(report.assessment?.checks.length, 5);
  assert.equal(report.claims.H1, 'unaccepted');
});
test('evaluator-private files cannot be mounted with candidate source, workspaces or state', () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-path-check-')); const nested = join(root, 'nested'); mkdirSync(nested);
  try { assert.throws(() => assertPrivateRoot(nested, [root]), /disjoint/); assert.throws(() => assertPrivateRoot(root, [nested]), /disjoint/); }
  finally { rmSync(root, { recursive: true, force: true }); }
});
test('live scoring fails before dispatch without calibration, isolation and host grant seals', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-no-live-')); const privateRoot = mkdtempSync(join(tmpdir(), 'aeon-no-live-private-'));
  const config = fixtureConfiguration(root, fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, ''));
  const authorityStore = new AuthorityStore(join(config.stateDirectory, 'authority.sqlite'));
  const authority = authorityStore.bootstrap('fixture', config.controlRevision, config.artifactId);
  try {
    await assert.rejects(runApplicationCase({ application: { config, secrets: { mistralApiKey: 'unused', directToken: 'unused' }, authorityStore, authority }, task: { id: 'closed', prompt: 'Must not dispatch' }, mode: 'live-product', observer: { id: 'author', privateRoot, evaluatorDigest: hash('evaluator'), taskDigest: hash('task') }, manifest: { source: hash('s'), dependencies: hash('d'), protocol: hash('p') }, timeoutMs: 1000, evaluate: async () => { throw new Error('Must not evaluate'); } }), /Live scoring is closed/);
  } finally { authorityStore.close(); rmSync(root, { recursive: true, force: true }); rmSync(privateRoot, { recursive: true, force: true }); }
});

test('a completed private model statement without output or artifact remains criterion-unmet', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-silent-')); const privateRoot = mkdtempSync(join(tmpdir(), 'aeon-silent-private-'));
  const config = fixtureConfiguration(root, fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, ''));
  const authorityStore = new AuthorityStore(join(config.stateDirectory, 'authority.sqlite'));
  const authority = authorityStore.bootstrap('silent-fixture', config.controlRevision, config.artifactId);
  try {
    const report = await runApplicationCase({ application: { config, secrets: { mistralApiKey: 'unused', directToken: 'unused' }, authorityStore, authority, performRequest: async () => ({ status: 200, body: JSON.stringify({ model: config.model.id, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'I finished and verified it.' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) }) }, task: { id: 'silent', prompt: 'Create sum.mjs and report a verified result.' }, mode: 'integration', observer: { id: 'author', privateRoot, evaluatorDigest: hash('external-artifact-check'), taskDigest: hash('silent') }, manifest: { source: hash('s'), dependencies: hash('d'), protocol: hash('p') }, timeoutMs: 5000,
      evaluate: async observation => { assert.deepEqual(observation.outputs, []); observation.readArtifact('sum.mjs'); throw new Error('Missing artifact must have thrown'); } });
    assert.equal(report.observation?.status, 'completed');
    assert.equal(report.verdict, 'criterion-unmet');
    assert.match(report.failure!, /ENOENT/);
    assert.equal(report.assessment, null);
  } finally { authorityStore.close(); rmSync(root, { recursive: true, force: true }); rmSync(privateRoot, { recursive: true, force: true }); }
});
