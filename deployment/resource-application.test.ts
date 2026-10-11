import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { fixtureConfiguration, boundedCodingFixture } from '../evaluations/product/fixture.ts';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import { ProcessLease } from '../packages/supervisor/process-lease.ts';
import { initializeResourceDelegation, type ResourceLimits } from '../packages/supervisor/resource-limits.ts';
import { AutarkApplication } from './application.ts';
import { sourceWorkspaceTools } from './source-workspace.ts';

// Opt in only from a disposable, administrator-bounded delegated service. Absence is not a passing resource case.
if (process.env.AEON_APPLICATION_RESOURCE_WORKSPACE) {
  test('ordinary Pi, physical workspace/command tools and source checkout share actual kernel ceilings', { timeout: 70000 }, async context => {
    const root = mkdtempSync(join(tmpdir(), 'aeon-resource-application-'));
    const sourceRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    const config = fixtureConfiguration(root, sourceRoot);
    config.workspaceDirectory = process.env.AEON_APPLICATION_RESOURCE_WORKSPACE!;
    const cgroupRoot = '/sys/fs/cgroup' + readFileSync('/proc/self/cgroup', 'utf8').trim().slice(3);
    const limits: ResourceLimits = { cgroupRoot, memoryBytes: 384 * 1024 * 1024, pids: 48, cpuQuotaMicros: 100000, cpuPeriodMicros: 100000,
      maxFileBytes: 16 * 1024 * 1024, maxOpenFiles: 128, workspaceBytes: 128 * 1024 * 1024, workspaceInodes: 4096 };
    config.resourceLimits = limits; config.resources.maxTokens = 250000; config.resources.maxElapsedMs = 120000;
    const lease = new ProcessLease(join(config.stateDirectory, 'process-lease.sqlite'));
    const authorityStore = new AuthorityStore(join(config.stateDirectory, 'authority.sqlite'));
    const authority = authorityStore.bootstrap('resource-fixture', config.controlRevision, config.artifactId);
    let app: AutarkApplication | undefined;
    try {
      await initializeResourceDelegation(cgroupRoot);
      const fixture = boundedCodingFixture(); let calls = 0;
      app = new AutarkApplication({ config, lease, authorityStore, authority, secrets: { mistralApiKey: 'not-a-key', directToken: 'resource-fixture' }, performRequest: async payload => {
        assert.ok(readdirSync(cgroupRoot).some(name => name.startsWith('command-')), 'Pi provider bridge must execute inside a bounded group'); calls++; return fixture(payload);
      } });
      await app.start();
      const run = app.communications.receive({ source: 'direct', externalId: 'bounded-coding', revision: '1', conversation: 'bounded-coding', text: 'Implement, run, repair and verify sum.mjs.', actor: { id: config.direct.actorId, scope: config.direct.scope, modificationEligible: false } }).run;
      const deadline = Date.now() + 30000;
      while (!['completed', 'blocked', 'waiting', 'cancelled'].includes(app.runtime.getRun(run.id)!.status) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(app.runtime.getRun(run.id)?.status, 'completed', JSON.stringify(app.store.get('execution', run.id)));
      assert.equal(calls, 7); assert.equal(app.resources.snapshot(run.id).requests, 13); assert.equal(app.output(run.id).length, 1);
      const observations = JSON.stringify(app.runtime.observations(run.id));
      assert.match(observations, /memoryPeakBytes/); assert.match(observations, /Observed seeded defect/);
      await app.close(); app = undefined;
      const workspace = join(config.workspaceDirectory, 'source-checkout'); mkdirSync(workspace);
      const checkout = sourceWorkspaceTools({ applicationRoot: sourceRoot, workspace, protectedPaths: [config.stateDirectory], nodeBinary: process.execPath, maxFiles: 10000, maxBytes: 50_000_000, timeoutMs: 30000, resourceLimits: limits }).find(tool => tool.name === 'source_checkout')!;
      const receipt = await checkout.execute({}) as { exitCode: number; stdout: string; stderr: string; resources?: { memoryPeakBytes: number } };
      assert.equal(receipt.exitCode, 0, receipt.stderr); assert.ok(receipt.resources?.memoryPeakBytes); assert.match(receipt.stdout, /packages\/agent-shell/);
      assert.deepEqual(readdirSync(cgroupRoot).filter(name => name.startsWith('command-')), []);
      context.diagnostic(JSON.stringify({ modelRequests: calls, totalRequests: 13, sourceMemoryPeakBytes: receipt.resources.memoryPeakBytes, configured: limits, evidenceKind: 'engineering-fixture' }));
    } finally { await app?.close(); authorityStore.close(); lease.close(); rmSync(root, { recursive: true, force: true }); }
  });
}
