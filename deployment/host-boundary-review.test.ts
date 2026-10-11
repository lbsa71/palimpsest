import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs, { cpSync, renameSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { freezeApplication, type DeploymentInputs } from './candidate.ts';
import { materializeConfiguration, type HostBindings } from './materialize.ts';
import { ServiceProcess } from './service-process.ts';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
function fixture(script = '') {
  const temporary = mkdtempSync(join(tmpdir(), 'aeon-host-review-'));
  const source = join(temporary, 'source');
  const host: HostBindings = { stateDirectory: join(temporary, 'state'), workspaceDirectory: join(temporary, 'work'), artifactStore: join(temporary, 'artifacts'), nodeBinary: process.execPath };
  for (const directory of [source, host.stateDirectory, host.workspaceDirectory, host.artifactStore, join(source, 'deployment')]) mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(join(source, 'package.json'), '{"type":"module"}'); writeFileSync(join(source, 'package-lock.json'), '{}');
  writeFileSync(join(source, 'deployment/service-child.ts'), script); writeFileSync(join(source, 'deployment/shell-worker.ts'), '');
  for (const entry of ['typescript', '@types/node', 'undici-types', `@typescript/typescript-${process.platform}-${process.arch}`]) cpSync(join(root, 'node_modules', entry), join(source, 'node_modules', entry), { recursive: true });
  const envelope = { maxRequests: 1, maxTokens: 1, maxCostUsd: 0, maxElapsedMs: 1000, maxConcurrency: 1 };
  const inputs: DeploymentInputs = { createdBy: 'host-review', prompts: { mind: 'Frozen mind', compaction: 'Frozen compaction' }, policy: { kind: 'engineering' },
    runtime: { nodeVersion: process.version, nodeSha256: createHash('sha256').update(readFileSync(process.execPath)).digest('hex'), platform: process.platform, arch: process.arch },
    configuration: { model: { id: 'fixture-no-provider', reasoning: false, effort: 'none', contextWindow: 128000, maxOutputTokens: 256, maxRequestsPerSlice: 1, timeoutMs: 1000, pricesPerMillion: { input: 1, output: 2 } }, resources: envelope, conversationResources: envelope,
      scheduler: { windowMs: 1000, maxSlicesPerWindow: 1, maxLifetimeSlices: 1, quantumMs: 1000, idleRetryMs: 1000, maxStalls: 1, resources: envelope }, bootstrapInitiative: false, maxConcurrentRuns: 1, pollMs: 100, commands: ['/runtime/node'], researchHosts: [], direct: { host: '127.0.0.1', port: 0, actorId: 'fixture', scope: { kind: 'public' }, modificationEligible: false } } };
  return { temporary, source, host, inputs, dispose: () => rmSync(temporary, { recursive: true, force: true }) };
}
const secrets = { mistralApiKey: 'fixture-not-a-key', directToken: 'fixture-private-token' };

test('a failed diagnostic write still stops a failed startup child', { timeout: 15000 }, async () => {
  const f = fixture(`process.on('message', message => { if(message.kind==='start') process.send({kind:'unavailable'}); if(message.kind==='stop') process.exit(0); }); setInterval(()=>{},1000);`);
  const candidate = freezeApplication(f.source, f.host.artifactStore, f.inputs);
  const service = new ServiceProcess(f.host, secrets, { mode: 'engineering' });
  writeFileSync(join(f.host.stateDirectory, 'host-diagnostics'), 'not a directory');
  try {
    await assert.rejects(service.start(candidate.manifest.id, { generation: 'fixture', epoch: 1, controlRevision: candidate.manifest.controls }));
    assert.equal(service.running, false, 'diagnostic I/O failure must not leave the application running');
  } finally { await service.stop(); f.dispose(); }
});

test('diagnostics cannot traverse a symlink out of private host state', { timeout: 15000 }, async () => {
  const f = fixture(`process.on('message', message => { if(message.kind==='start') { console.error('private startup evidence'); process.send({kind:'unavailable'}); } if(message.kind==='stop') process.exit(0); }); setInterval(()=>{},1000);`);
  const outside = join(f.temporary, 'outside'); mkdirSync(outside); symlinkSync(outside, join(f.host.stateDirectory, 'host-diagnostics'));
  const candidate = freezeApplication(f.source, f.host.artifactStore, f.inputs);
  const service = new ServiceProcess(f.host, secrets, { mode: 'engineering' });
  try {
    await assert.rejects(service.start(candidate.manifest.id, { generation: 'fixture', epoch: 1, controlRevision: candidate.manifest.controls }));
    const { readdirSync } = await import('node:fs'); assert.deepEqual(readdirSync(outside), []);
    assert.equal(service.running, false);
  } finally { await service.stop(); f.dispose(); }
});

test('materialization rejects changed prompt payload before creating files', () => {
  const f = fixture();
  try {
    const candidate = freezeApplication(f.source, f.host.artifactStore, f.inputs);
    (candidate.inputs.prompts as { mind: string }).mind = 'unbound instruction replacement';
    assert.throws(() => materializeConfiguration(candidate, f.host), /prompt.*identity|prompt.*mismatch/i);
    assert.equal(existsSync(join(f.host.stateDirectory, 'prompt-materializations')), false);
  } finally { f.dispose(); }
});

test('stopping a leader also kills descendants left in its service process group', { timeout: 15000 }, async () => {
  const f = fixture(`import { spawn } from 'node:child_process'; import { writeFileSync } from 'node:fs'; process.on('message', message => { if(message.kind==='start') { const child=spawn(process.execPath, ['-e','setInterval(()=>{},1000)'], {stdio:'ignore'}); writeFileSync(message.bindings.stateDirectory+'/descendant.pid', String(child.pid)); process.send({kind:'ready',candidateId:message.candidateId,authority:message.authority,address:{address:'127.0.0.1',family:'IPv4',port:12345}}); } if(message.kind==='stop') process.exit(0); });`);
  const candidate = freezeApplication(f.source, f.host.artifactStore, f.inputs);
  const service = new ServiceProcess(f.host, secrets, { mode: 'engineering' }); let descendant: number | undefined;
  const active = (pid: number) => { try { return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]?.[0] !== 'Z'; } catch { return false; } };
  try {
    await service.start(candidate.manifest.id, { generation: 'fixture', epoch: 1, controlRevision: candidate.manifest.controls });
    descendant = Number(readFileSync(join(f.host.stateDirectory, 'descendant.pid'), 'utf8')); assert.equal(active(descendant), true);
    await service.stop();
    const deadline = Date.now() + 2000; while (active(descendant) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(active(descendant), false, 'graceful leader exit must not orphan an active descendant');
  } finally { if (descendant) { try { process.kill(descendant, 'SIGKILL'); } catch {} } await service.stop(); f.dispose(); }
});


test('deployment classification rejects symlinked ancestors before reading external bytes', () => {
  const f = fixture(); const original = fs.readFileSync; let externalReads = 0;
  try {
    const modules = join(f.source, 'node_modules'); renameSync(modules, join(f.temporary, 'private-modules')); symlinkSync(join(f.temporary, 'private-modules'), modules);
    fs.readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
      if (typeof args[0] === 'string' && args[0].startsWith(`${modules}/`)) externalReads++;
      return original(...args);
    }) as typeof fs.readFileSync;
    syncBuiltinESMExports();
    assert.throws(() => freezeApplication(f.source, f.host.artifactStore, f.inputs), /symlink|directory/i);
    assert.equal(externalReads, 0, 'classification must not read through an untrusted ancestor before freeze rejection');
  } finally { fs.readFileSync = original; syncBuiltinESMExports(); f.dispose(); }
});

test('prompt materialization cannot create directories through a redirected parent', () => {
  const f = fixture();
  try {
    const candidate = freezeApplication(f.source, f.host.artifactStore, f.inputs);
    const outside = join(f.temporary, 'outside'); mkdirSync(outside);
    symlinkSync(outside, join(f.host.stateDirectory, 'prompt-materializations'));
    assert.throws(() => materializeConfiguration(candidate, f.host));
    assert.equal(existsSync(join(outside, candidate.manifest.prompts)), false, 'rejection must precede filesystem changes outside host state');
  } finally { f.dispose(); }
});
