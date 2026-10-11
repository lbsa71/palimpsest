import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { validateConfiguration, type ApplicationConfig } from './config.ts';
import { createBrokerShell, type BrokerShellOptions } from './broker-shell.ts';

function configuration(root: string): ApplicationConfig {
  for (const directory of ['source', 'state', 'work']) mkdirSync(join(root, directory));
  const prompt = join(root, 'prompt'); writeFileSync(prompt, 'Fixture');
  const resources = { maxRequests: 10, maxTokens: 100000, maxCostUsd: 1, maxElapsedMs: 10000, maxConcurrency: 1 };
  return { stateDirectory: join(root, 'state'), workspaceDirectory: join(root, 'work'), applicationRoot: join(root, 'source'), nodeBinary: process.execPath, workerEntrypoint: 'worker.js', artifactId: 'fixture', controlRevision: 'fixture', promptFile: prompt, compactionPromptFile: prompt,
    model: { provider: 'openai', id: 'fixture-v1', contextWindow: 10000, reasoning: false, effort: 'none', maxOutputTokens: 1000, maxRequestsPerSlice: 2, timeoutMs: 1000, pricesPerMillion: { input: 1, output: 2 } }, resources, conversationResources: resources,
    scheduler: { windowMs: 10000, maxSlicesPerWindow: 1, maxLifetimeSlices: 1, quantumMs: 1000, idleRetryMs: 100, maxStalls: 1, resources }, maxConcurrentRuns: 1, pollMs: 100, commands: [], researchHosts: [], direct: { host: '127.0.0.1', port: 0, actorId: 'fixture', scope: { kind: 'public' }, modificationEligible: false } };
}
for (const invalid of ['missing-input-price', 'missing-output-price', 'nonboolean-reasoning', 'output-over-context'] as const) test(`host rejects unusable model profile before reservation: ${invalid}`, () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-profile-review-'));
  try {
    const config = configuration(root); assert.doesNotThrow(() => validateConfiguration(config));
    if (invalid === 'missing-input-price') delete (config.model.pricesPerMillion as any).input;
    if (invalid === 'missing-output-price') delete (config.model.pricesPerMillion as any).output;
    if (invalid === 'nonboolean-reasoning') (config.model as any).reasoning = 'false';
    if (invalid === 'output-over-context') config.model.maxOutputTokens = config.model.contextWindow + 1;
    assert.throws(() => validateConfiguration(config), /price|profile|context/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('host broker requires both prices even when instantiated outside configuration loader', () => {
  assert.throws(() => createBrokerShell({ worker: { model: 'fixture-v1' }, entrypoint: 'worker.js', pricesPerMillion: {} } as BrokerShellOptions), /price/i);
});
