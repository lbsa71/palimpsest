import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import { hashBytes } from '../packages/release/artifacts.ts';
import { freezeApplication, type DeploymentInputs } from './candidate.ts';
import { ServiceProcess } from './service-process.ts';

/** A real admitted child delays its ready packet until the host has changed state.
 * Tiny source/toolchain placeholders are sufficient for lifecycle-only artifact verification;
 * no compiler, application, provider, or product qualification is claimed. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aeon-runtime-review-'));
  const source = join(root, 'source');
  const host = { stateDirectory: join(root, 'state'), workspaceDirectory: join(root, 'workspace'), artifactStore: join(root, 'artifacts'), nodeBinary: process.execPath };
  for (const path of [source, host.stateDirectory, host.workspaceDirectory, host.artifactStore, join(source, 'deployment'), ...['typescript', '@types/node', 'undici-types', `@typescript/typescript-${process.platform}-${process.arch}`].map(name => join(source, 'node_modules', name))]) mkdirSync(path, { recursive: true });
  writeFileSync(join(source, 'package.json'), '{"type":"module"}');
  writeFileSync(join(source, 'package-lock.json'), '{}');
  writeFileSync(join(source, 'deployment/service-child.ts'), `
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
process.on('message', message => {
  if (message.kind === 'stop') { process.disconnect(); return; }
  writeFileSync(join(message.bindings.stateDirectory, 'started'), String(process.pid));
  const timer = setInterval(() => {
    if (!existsSync(join(message.bindings.stateDirectory, 'release'))) return;
    clearInterval(timer);
    process.send({ kind: 'ready', candidateId: message.candidateId, authority: message.authority, address: { address: '127.0.0.1', family: 'IPv4', port: 12345 } });
  }, 5);
  process.once('disconnect', () => clearInterval(timer));
});`);
  const envelope = { maxRequests: 1, maxTokens: 1, maxCostUsd: 0, maxElapsedMs: 10000, maxConcurrency: 1 };
  const inputs: DeploymentInputs = { createdBy: 'independent-readiness-review', prompts: { mind: '', compaction: '' }, policy: { kind: 'engineering' }, runtime: { nodeVersion: process.version, nodeSha256: hashBytes(readFileSync(process.execPath)), platform: process.platform, arch: process.arch }, configuration: { bootstrapInitiative: false, model: { id: 'lifecycle-only', reasoning: false, effort: 'none', contextWindow: 100, maxOutputTokens: 1, maxRequestsPerSlice: 1, timeoutMs: 1000, pricesPerMillion: { input: 0, output: 0 } }, resources: envelope, conversationResources: envelope, scheduler: { windowMs: 1000, maxSlicesPerWindow: 1, maxLifetimeSlices: 1, quantumMs: 1000, idleRetryMs: 1000, maxStalls: 1, resources: envelope }, maxConcurrentRuns: 1, pollMs: 100, commands: [], researchHosts: [], direct: { host: '127.0.0.1', port: 0, actorId: 'review', scope: { kind: 'public' }, modificationEligible: false } } };
  const candidate = freezeApplication(source, host.artifactStore, inputs);
  const store = new AuthorityStore(join(host.stateDirectory, 'authority.sqlite'));
  const authority = store.bootstrap('review-incumbent', candidate.manifest.controls, candidate.manifest.id);
  const service = new ServiceProcess(host, { directToken: 'unused-review-token' }, { mode: 'engineering' });
  return { root, host, candidate, store, authority, service };
}
async function started(state: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!existsSync(join(state, 'started'))) { assert.ok(Date.now() < deadline, 'real child startup deadline'); await new Promise(resolve => setTimeout(resolve, 5)); }
}

test('withdrawal during actual child startup cannot return a serving readiness receipt', { timeout: 15000 }, async () => {
  const f = fixture();
  try {
    const pending = f.service.start(f.candidate.manifest.id, f.authority);
    // Attach the rejection expectation before releasing the child.
    const rejected = assert.rejects(pending, /Stale or withdrawn serving authority/);
    await started(f.host.stateDirectory);
    f.store.withdraw(f.authority);
    writeFileSync(join(f.host.stateDirectory, 'release'), 'continue');
    await rejected;
    assert.equal(f.service.running, false, 'stale child must be drained before rejection returns');
  } finally { await f.service.stop(); f.store.close(); rmSync(f.root, { recursive: true, force: true }); }
});
