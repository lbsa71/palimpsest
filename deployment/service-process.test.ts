import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { freezeApplication, type DeploymentInputs } from './candidate.ts';
import { materializeConfiguration, type HostBindings } from './materialize.ts';
import { ServiceProcess } from './service-process.ts';
import { rewriteSourceEntries } from './source-workspace.ts';

test('frozen ordinary application boots, fences stale authority, restarts after SIGKILL and preserves current state', { timeout: 90000 }, async () => {
  const root = dirname(dirname(fileURLToPath(import.meta.url))), temporary = mkdtempSync(join(tmpdir(), 'aeon-service-'));
  const host: HostBindings = { stateDirectory: join(temporary, 'state'), workspaceDirectory: join(temporary, 'workspace'), artifactStore: join(temporary, 'artifacts'), nodeBinary: process.execPath };
  for (const directory of [host.stateDirectory, host.workspaceDirectory, host.artifactStore]) mkdirSync(directory, { mode: 0o700 });
  const envelope = { maxRequests: 12, maxTokens: 100000, maxCostUsd: 0, maxElapsedMs: 600000, maxConcurrency: 2 };
  const inputs: DeploymentInputs = { createdBy: 'service-fixture', prompts: { mind: 'Engineering fixture. No inference should occur.', compaction: 'Preserve evidence.' }, policy: { kind: 'engineering' },
    runtime: { nodeVersion: process.version, nodeSha256: createHash('sha256').update(readFileSync(process.execPath)).digest('hex'), platform: process.platform, arch: process.arch },
    configuration: { model: { id: 'fixture-no-provider', reasoning: false, effort: 'none', contextWindow: 128000, maxOutputTokens: 256, maxRequestsPerSlice: 2, timeoutMs: 1000, pricesPerMillion: { input: 1, output: 2 } }, resources: envelope, conversationResources: envelope,
      scheduler: { windowMs: 1000, maxSlicesPerWindow: 1, maxLifetimeSlices: 1, quantumMs: 2000, idleRetryMs: 1000, maxStalls: 2, resources: envelope }, maxConcurrentRuns: 1, pollMs: 100, commands: ['/runtime/node'], researchHosts: [], direct: { host: '127.0.0.1', port: 0, actorId: 'fixture', scope: { kind: 'public' }, modificationEligible: false } } };
  Object.assign(inputs.configuration, { bootstrapInitiative: false });
  // Pin the trusted fixture source and materialize its accepted compiler closure; worktree node_modules may be a symlink.
  const source = join(temporary, 'accepted-source'); mkdirSync(source);
  for (const entry of rewriteSourceEntries) if (existsSync(join(root, entry))) { mkdirSync(dirname(join(source, entry)), { recursive: true }); cpSync(join(root, entry), join(source, entry), { recursive: true }); }
  cpSync(realpathSync(join(root, 'node_modules')), join(source, 'node_modules'), { recursive: true });
  const candidate = freezeApplication(source, host.artifactStore, inputs);
  const authority = new AuthorityStore(join(host.stateDirectory, 'authority.sqlite'));
  const grant = authority.bootstrap('fixture-generation-1', candidate.manifest.controls, candidate.manifest.id);
  const secrets = { mistralApiKey: 'not-a-key', directToken: 'private-fixture-token' };
  let unexpectedExit = 0;
  const service = new ServiceProcess(host, secrets, { mode: 'engineering', onUnexpectedExit: () => unexpectedExit++ });
  try {
    const config = materializeConfiguration(candidate, host);
    assert.equal(readFileSync(config.promptFile, 'utf8'), inputs.prompts.mind);
    const injected = structuredClone(candidate); (injected.inputs.prompts as Record<string, unknown>)['../../outside'] = 'no';
    assert.throws(() => materializeConfiguration(injected, host), /Exact frozen prompt/);
    const linkTarget = join(temporary, 'unrelated'); writeFileSync(linkTarget, inputs.prompts.mind);
    rmSync(config.promptFile); symlinkSync(linkTarget, config.promptFile);
    assert.throws(() => materializeConfiguration(candidate, host), /materialization changed/);
    rmSync(config.promptFile); materializeConfiguration(candidate, host);
    await assert.rejects(new ServiceProcess(host, secrets).start(candidate.manifest.id, grant), /kernel resource/);
    await assert.rejects(service.start(candidate.manifest.id, grant, { policyDigest: 'not-an-accepted-digest' }), /Public frozen/);
    const ready = await service.start(candidate.manifest.id, grant, { policyDigest: 'a'.repeat(64), allowedModelIds: ['fixture-no-provider'] });
    assert.equal((await fetch(`http://127.0.0.1:${ready.address.port}/`)).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${ready.address.port}/`, { headers: { authorization: `Bearer ${secrets.directToken}` } })).status, 404);
    const store = new OperationalStore({ filename: join(host.stateDirectory, 'operational.sqlite') });
    store.put('fixture.lived-state', 'current', { memory: 'current experience', uncertainEffect: 'await actual receipt', at: new Date().toISOString() }, null);
    const preserved = store.get('fixture.lived-state', 'current'); store.close();
    process.kill(service.processId!, 'SIGKILL');
    const deadline = Date.now() + 5000; while (service.running && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(service.running, false); assert.equal(unexpectedExit, 1); await service.stop();
    const withdrawn = authority.withdraw(grant);
    const successor = authority.activate(withdrawn, 'fixture-generation-2', candidate.manifest.controls, candidate.manifest.id);
    await assert.rejects(service.start(candidate.manifest.id, grant), /unavailable/);
    await service.start(candidate.manifest.id, successor);
    const resumed = new OperationalStore({ filename: join(host.stateDirectory, 'operational.sqlite') });
    assert.deepEqual(resumed.get('fixture.lived-state', 'current'), preserved);
    assert.equal(resumed.list('physical-requests').length, 0, 'service lifecycle test must not call a provider'); resumed.close();
    await service.stop(); assert.equal(service.running, false); assert.equal(unexpectedExit, 1);
  } finally { await service.stop(); authority.close(); rmSync(temporary, { recursive: true, force: true }); }
});
