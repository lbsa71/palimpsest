import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { freezeCandidate } from '../packages/release/artifacts.ts';
import { deploymentEntries, freezeApplication, verifyApplication, type DeploymentInputs } from './candidate.ts';

test('deployment admission binds actual host controls, fork/build closure and runtime executable', () => {
  const root = dirname(dirname(fileURLToPath(import.meta.url))), store = mkdtempSync(join(tmpdir(), 'aeon-deployment-candidates-'));
  const envelope = { maxRequests: 12, maxTokens: 100000, maxCostUsd: 1, maxElapsedMs: 60000, maxConcurrency: 2 };
  const input: DeploymentInputs = { createdBy: 'fixture-author', prompts: { mind: 'Fixture instructions.', compaction: 'Retain evidence.' }, policy: { kind: 'engineering', requiredCases: ['closure'] },
    runtime: { nodeVersion: process.version, nodeSha256: createHash('sha256').update(readFileSync(process.execPath)).digest('hex'), platform: process.platform, arch: process.arch },
    configuration: { model: { id: 'fixture-v1', reasoning: false, effort: 'none', contextWindow: 128000, maxRequestsPerSlice: 3, maxOutputTokens: 256, timeoutMs: 5000, pricesPerMillion: { input: 1, output: 2 } }, resources: envelope, conversationResources: envelope,
      scheduler: { windowMs: 1000, maxSlicesPerWindow: 3, maxLifetimeSlices: 5, quantumMs: 5000, idleRetryMs: 1000, maxStalls: 2, resources: envelope }, maxConcurrentRuns: 1, pollMs: 100, commands: ['/runtime/node'], researchHosts: [], direct: { host: '127.0.0.1', port: 0, actorId: 'fixture', scope: { kind: 'public' }, modificationEligible: false } } };
  try {
    const candidate = freezeApplication(root, store, input);
    assert.equal(verifyApplication(store, candidate.manifest.id, process.execPath).manifest.id, candidate.manifest.id);
    const controls = candidate.inputs.controls as { files: { path: string }[] };
    assert.ok(controls.files.some(file => file.path === 'packages/release/controller.ts'));
    assert.ok(controls.files.some(file => file.path === 'packages/development/index.ts'));
    assert.ok(controls.files.some(file => file.path === 'deployment/application.ts'));
    assert.ok(controls.files.some(file => file.path === 'evaluations/offline-review/index.ts'));
    assert.ok(controls.files.some(file => file.path === 'evaluations/offline-review/runner.mjs'));
    assert.ok(controls.files.some(file => file.path === 'evaluations/offline-review/reviewer.mjs'));
    assert.ok(!controls.files.some(file => file.path.startsWith('evaluations/offline-review/') && file.path.endsWith('.test.ts')));
    const forged = freezeCandidate(root, store, deploymentEntries(root), { ...candidate.inputs, controls: { ...(candidate.inputs.controls as object), files: [] } });
    assert.throws(() => verifyApplication(store, forged.manifest.id, process.execPath), /Control declaration/);
    assert.throws(() => verifyApplication(store, candidate.manifest.id, join(root, 'package.json')), /Runtime requires a regular|Pinned runtime changed/);
  } finally { rmSync(store, { recursive: true, force: true }); }
});
