import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { identity } from '../packages/contracts/index.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { ResourceLedger } from '../packages/runtime/resources/index.ts';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import { AutarkApplication } from './application.ts';
import type { ApplicationConfig } from './config.ts';

const nativeId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

for (const unlimited of [false, true]) test(`expired operating grant ${unlimited ? 'continues through the retained bounded coding session with explicit unlimited policy' : 'refuses model dispatch without accepted policy'}`, { timeout: 20000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'unlimited-app-review-')), stateDirectory = join(root, 'state'), workspaceDirectory = join(root, 'work');
  mkdirSync(stateDirectory); mkdirSync(workspaceDirectory);
  const promptFile = join(root, 'mind'), compactionPromptFile = join(root, 'compact');
  writeFileSync(promptFile, 'Offline fixture mind'); writeFileSync(compactionPromptFile, 'Retain fixture context');
  const resources = { maxRequests: 100, maxTokens: 1_000_000, maxCostUsd: 100, maxElapsedMs: 60000, maxConcurrency: 4 };
  const conversationResources = { maxRequests: 50, maxTokens: 1_000_000, maxCostUsd: 100, maxElapsedMs: 30000, maxConcurrency: 4 };
  const config: ApplicationConfig = { stateDirectory, workspaceDirectory, applicationRoot: dirname(dirname(fileURLToPath(import.meta.url))), nodeBinary: process.execPath,
    workerEntrypoint: 'deployment/shell-worker.ts', artifactId: 'unlimited-review', controlRevision: 'review-controls', promptFile, compactionPromptFile,
    model: { id: 'mistral-fixture-v1', contextWindow: 128000, reasoning: false, effort: 'none', maxOutputTokens: 1024, maxRequestsPerSlice: 5, timeoutMs: 1000, pricesPerMillion: { input: 1, output: 2 } },
    resources, conversationResources, bootstrapInitiative: false,
    scheduler: { windowMs: 60000, maxSlicesPerWindow: 2, maxLifetimeSlices: 4, quantumMs: 10000, idleRetryMs: 1000, maxStalls: 2, resources: conversationResources },
    coding: { provider: 'codex', timeoutMs: 6000, maxOutputBytes: 100000 },
    maxConcurrentRuns: 2, pollMs: 60000, commands: ['/runtime/node'], researchHosts: [],
    direct: { host: '127.0.0.1', port: 0, actorId: 'operator', scope: { kind: 'restricted', principals: ['operator'] }, modificationEligible: true },
    ...(unlimited ? { allowanceAmendment: { id: 'review-all-unlimited', authorizationRef: 'explicit-removal', rootId: 'operating-envelope:v1', expectedEnvelopeDigest: identity(resources),
      cumulativeTokenLimit: null, cumulativeCostLimit: null, cumulativeRequestLimit: null, cumulativeElapsedLimit: null, scope: 'root-and-descendants', descendantCostLimit: 'root' } as const } : {}) };
  const seed = new OperationalStore({ filename: join(stateDirectory, 'operational.sqlite') });
  new ResourceLedger(seed, { tokens: 0, costUsd: 0, elapsedMs: 0 }, () => 0).allocate('operating-envelope:v1', resources);
  const originalAllocation = seed.get('allocations', 'operating-envelope:v1')!.value; seed.close();
  const authorityStore = new AuthorityStore(join(stateDirectory, 'authority.sqlite')), authority = authorityStore.bootstrap('review', config.controlRevision, config.artifactId);
  let mindCalls = 0;
  const invocations: { timeoutMs: number; args: string[] }[] = [];
  const app = new AutarkApplication({ config, authority, authorityStore, secrets: { mistralApiKey: 'offline-fixture', directToken: 'offline-fixture' },
    codingExecutor: async invocation => {
      invocations.push({ timeoutMs: invocation.timeoutMs, args: invocation.args });
      return { exitCode: 0, signal: null, elapsedMs: 2, stderr: '', stdout: [
        { type: 'thread.started', thread_id: nativeId },
        { type: 'item.completed', item: { type: 'agent_message', text: 'Observed offline result' } },
        { type: 'turn.completed', usage: { input_tokens: 20 * invocations.length, cached_input_tokens: 0, output_tokens: 10 * invocations.length } },
      ].map(value => JSON.stringify(value)).join('\n') };
    },
    performRequest: async () => {
      mindCalls++; const code = mindCalls % 2 === 1;
      return { status: 200, body: JSON.stringify({ model: config.model.id, choices: [{ finish_reason: code ? 'tool_calls' : 'stop', message: { role: 'assistant', content: code ? null : 'Observed result.',
        ...(code ? { tool_calls: [{ id: '000000001', type: 'function', function: { name: 'code', arguments: JSON.stringify({ message: 'Inspect the bounded offline fixture.', target: 'workspace' }) } }] } : {}) } }],
        usage: { prompt_tokens: 20, completion_tokens: 10 } }) };
    } });
  try {
    await app.start();
    const diagnosis = app.health() as { execution: { admission: string; reasons: string[] } };
    assert.equal(diagnosis.execution.admission, unlimited ? 'available' : 'held');
    if (!unlimited) assert.ok(diagnosis.execution.reasons.includes('allowance-exhausted'));
    for (let turn = 0; turn < (unlimited ? 2 : 1); turn++) {
      const run = app.communications.receive({ source: 'direct', externalId: `review-${turn}`, revision: '1', conversation: `review-${turn}`, text: 'Inspect the fixture',
        actor: { id: 'operator', scope: config.direct.scope, modificationEligible: true } }).run;
      await app.resume(run.id);
      if (!unlimited) break;
      const deadline = Date.now() + 12000;
      while (app.runtime.getRun(run.id)?.status !== 'completed') {
        assert.ok(Date.now() < deadline, JSON.stringify({ execution: app.store.list('execution'), turns: app.store.list('host.coding-turns') }));
        await app.tick(); await new Promise<void>(resolve => setTimeout(resolve, 10));
      }
    }
    assert.equal(mindCalls, unlimited ? 4 : 0); assert.equal(invocations.length, unlimited ? 2 : 0);
    if (unlimited) {
      assert.deepEqual(invocations.map(value => value.timeoutMs), [6000, 6000]);
      assert.ok(invocations[1]!.args.includes('resume')); assert.ok(invocations[1]!.args.includes(nativeId));
      assert.equal(app.resources.snapshot('operating-envelope:v1').cancelled, false);
      assert.equal(app.resources.effectiveEnvelope('operating-envelope:v1').maxElapsedMs, null);
      const retained = app.store.get<typeof originalAllocation>('allocations', 'operating-envelope:v1')!.value;
      assert.equal(identity({ ...(retained as object), elapsedFloorMs: 0 }), identity(originalAllocation));
      assert.ok(app.resources.snapshot('operating-envelope:v1').elapsedMs > resources.maxElapsedMs);
    }
  } finally { await app.close(); authorityStore.close(); rmSync(root, { recursive: true, force: true }); }
});
