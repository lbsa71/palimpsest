import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { identity, type ArtifactRef, type Authority, type EvaluationEvidence } from '../packages/contracts/index.ts';
import { admissionPolicyIdentity, signEvaluation, type AdmissionPolicy } from '../packages/release/admission.ts';
import { hashBytes, type FrozenCandidate } from '../packages/release/artifacts.ts';
import { policyDescriptor, type ReleaseProof } from '../packages/release/controller.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import { ProcessLease } from '../packages/supervisor/process-lease.ts';
import { freezeApplication, type DeploymentInputs } from './candidate.ts';
import { controlSocket, requestControl, serveControls } from './cli.ts';
import { contentAddressedEvidence, loadHostPolicy, type HostPolicyFile } from './host-policy.ts';
import type { HostBindings } from './materialize.ts';
import { ServiceSupervisor, type SupervisorOptions } from './supervisor.ts';

function fixture() {
  const source = process.env.AEON_TEST_SOURCE_ROOT ?? dirname(dirname(fileURLToPath(import.meta.url)));
  const root = mkdtempSync(join(tmpdir(), 'aeon-coordinator-'));
  const host: HostBindings = { stateDirectory: join(root, 'state'), workspaceDirectory: join(root, 'workspace'), artifactStore: join(root, 'artifacts'), nodeBinary: process.execPath };
  const evidenceDirectory = join(root, 'evidence');
  for (const path of [...Object.values(host).filter(path => path !== process.execPath), evidenceDirectory]) mkdirSync(path, { mode: 0o700 });
  const blob = (bytes: string | Uint8Array): ArtifactRef => {
    const digest = hashBytes(Buffer.from(bytes)); writeFileSync(join(evidenceDirectory, digest), bytes, { mode: 0o600 }); return { uri: `sha256:${digest}`, sha256: digest };
  };
  const key = randomBytes(32), evaluator = blob('Host fixture evaluator. Engineering only; no product independence qualification.');
  const policyFields = { kind: 'engineering' as const, requiredCases: ['lifecycle'], evaluatorKeys: new Map([['fixture-reviewer', key]]), evaluatorArtifacts: new Map([['fixture-reviewer', evaluator.sha256]]) };
  const envelope = { maxRequests: 12, maxTokens: 100000, maxCostUsd: 0, maxElapsedMs: 600000, maxConcurrency: 2 };
  const inputs: DeploymentInputs = { createdBy: 'fixture-author', policy: policyDescriptor(policyFields), prompts: { mind: 'No inference. Engineering lifecycle fixture.', compaction: 'Preserve evidence.' },
    runtime: { nodeVersion: process.version, nodeSha256: createHash('sha256').update(readFileSync(process.execPath)).digest('hex'), platform: process.platform, arch: process.arch },
    configuration: { bootstrapInitiative: false, model: { id: 'fixture-no-provider', reasoning: false, effort: 'none', contextWindow: 128000, maxOutputTokens: 256, maxRequestsPerSlice: 2, timeoutMs: 1000, pricesPerMillion: { input: 1, output: 2 } }, resources: envelope, conversationResources: envelope,
      scheduler: { windowMs: 1000, maxSlicesPerWindow: 1, maxLifetimeSlices: 1, quantumMs: 2000, idleRetryMs: 1000, maxStalls: 2, resources: envelope }, maxConcurrentRuns: 1, pollMs: 100, commands: ['/runtime/node'], researchHosts: [], direct: { host: '127.0.0.1', port: 0, actorId: 'fixture', scope: { kind: 'public' }, modificationEligible: false } } };
  const incumbent = freezeApplication(source, host.artifactStore, inputs);
  const fields = { ...policyFields, controlRevision: incumbent.manifest.controls };
  const policy: AdmissionPolicy = { ...fields, policyDigest: admissionPolicyIdentity(fields) };
  const initial: Authority = { generation: 'initial-fixture', epoch: 1, controlRevision: incumbent.manifest.controls };
  let counter = 0;
  function proof(candidate: FrozenCandidate, priorAuthority: Authority, rescue = incumbent): ReleaseProof {
    const id = `fixture-proof-${++counter}`, observation = blob(`Engineering lifecycle observation ${id}`);
    const evidence: EvaluationEvidence = { id: `${id}:evidence`, candidateId: candidate.manifest.id, controlRevision: priorAuthority.controlRevision,
      evaluatorId: 'fixture-reviewer', evaluatorArtifact: evaluator, independent: true, verdict: 'pass', artifact: observation,
      caseResults: [{ id: 'lifecycle', status: 'pass', observations: observation, usage: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 1 }, interventions: [] }] };
    return { proposal: { id, candidate: candidate.manifest, priorAuthority, evidence: [evidence], recoveryArtifact: blob(readFileSync(join(host.artifactStore, rescue.manifest.id, 'candidate.json'))) }, signed: [signEvaluation(evidence, key, policy.policyDigest)] };
  }
  const initialProof = proof(incumbent, initial);
  const options: SupervisorOptions = { host, mode: 'engineering', secrets: { mistralApiKey: 'provider-unavailable-fixture', directToken: 'private-fixture-token' },
    getPolicy: digest => { assert.equal(digest, policy.policyDigest); return policy; }, readArtifact: contentAddressedEvidence(evidenceDirectory),
    bootstrap: { proof: initialProof, policyDigest: policy.policyDigest } };
  return { root, source: join(host.artifactStore, incumbent.manifest.id, 'payload'), host, inputs, incumbent, policy, key, initial, initialProof, evidenceDirectory, options, proof };
}
async function eventually(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 15000;
  while (!check()) { if (Date.now() > deadline) throw new Error('Lifecycle condition not reached'); await new Promise(resolve => setTimeout(resolve, 20)); }
}

test('real frozen service transfers, uses fresh probation, recovers on child crash and restarts without evidence, keys or provider', { timeout: 90000 }, async () => {
  const f = fixture(); let supervisor: ServiceSupervisor | undefined;
  try {
    supervisor = await ServiceSupervisor.open(f.options);
    assert.equal(supervisor.status().qualification, 'engineering-only'); assert.equal(supervisor.status().running, true);
    assert.throws(() => new ProcessLease(join(f.host.stateDirectory, 'supervisor-lease.sqlite')), /holds the instance lease/);
    await assert.rejects(ServiceSupervisor.open(f.options), /holds the instance lease/);
    const successor = freezeApplication(f.source, f.host.artifactStore, { ...f.inputs, prompts: { ...f.inputs.prompts, mind: 'No inference. Successor fixture.' } });
    assert.equal(successor.manifest.controls, f.incumbent.manifest.controls);
    const initialProof = f.proof(successor, f.initial);
    await supervisor.release(initialProof);
    assert.equal(supervisor.status().release?.phase, 'probation');
    await assert.rejects(supervisor.acceptProbation(initialProof), /fresh evidence/);
    await supervisor.acceptProbation(f.proof(successor, f.initial));
    assert.equal(supervisor.status().release?.accepted.candidateId, successor.manifest.id);
    const store = new OperationalStore({ filename: join(f.host.stateDirectory, 'operational.sqlite') });
    store.put('fixture.lived-state', 'current', { memory: 'latest accepted experience', uncertainEffect: 'await actual receipt' }, null);
    const latest = store.get('fixture.lived-state', 'current'); store.close();
    const failing = freezeApplication(f.source, f.host.artifactStore, { ...f.inputs, configuration: { ...f.inputs.configuration, maxConcurrentRuns: 0 } });
    const runningAuthority = supervisor.status().ready!.authority;
    await assert.rejects(supervisor.release(f.proof(failing, runningAuthority, successor)), /run concurrency/);
    assert.equal(supervisor.status().running, false);
    const authority = new AuthorityStore(join(f.host.stateDirectory, 'authority.sqlite')); assert.equal(authority.current()?.generation, null); authority.close();
    await supervisor.recover();
    const pid = supervisor.status().processId!, epoch = supervisor.status().ready!.authority.epoch;
    process.kill(pid, 'SIGKILL');
    await eventually(() => supervisor!.status().running && (supervisor!.status().ready?.authority.epoch ?? 0) > epoch);
    assert.equal(supervisor.status().release?.active.candidateId, successor.manifest.id);
    await supervisor.close(); supervisor = undefined;
    rmSync(f.evidenceDirectory, { recursive: true, force: true });
    supervisor = await ServiceSupervisor.open({ ...f.options, bootstrap: () => { throw new Error('No bootstrap signer'); },
      getPolicy() { throw new Error('No evaluator key provider'); }, readArtifact() { throw new Error('Evidence unavailable'); } });
    assert.equal(supervisor.status().release?.active.candidateId, successor.manifest.id);
    const resumed = new OperationalStore({ filename: join(f.host.stateDirectory, 'operational.sqlite') });
    assert.deepEqual(resumed.get('fixture.lived-state', 'current'), latest);
    assert.equal(resumed.list('physical-requests').length, 0); resumed.close();
  } finally { await supervisor?.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('first authority is never served without authenticated proof, and interrupted bootstrap resumes its exact signed grant', { timeout: 60000 }, async () => {
  const f = fixture(); let supervisor: ServiceSupervisor | undefined;
  try {
    const bad = structuredClone(f.initialProof); bad.signed[0]!.authentication = '0'.repeat(64);
    await assert.rejects(ServiceSupervisor.open({ ...f.options, bootstrap: { proof: bad, policyDigest: f.policy.policyDigest } }), /authentication/);
    const authority = new AuthorityStore(join(f.host.stateDirectory, 'authority.sqlite'));
    assert.equal(authority.current(), undefined);
    writeFileSync(join(f.host.stateDirectory, 'bootstrap-intent.json'), JSON.stringify({ identity: identity({ proof: f.initialProof, policyDigest: f.policy.policyDigest }) }), { mode: 0o600 });
    authority.bootstrap(f.initial.generation, f.initial.controlRevision, f.incumbent.manifest.id); authority.close();
    const changed = structuredClone(f.initialProof); changed.proposal.priorAuthority.generation = 'unproven-new-grant';
    await assert.rejects(ServiceSupervisor.open({ ...f.options, bootstrap: { proof: changed, policyDigest: f.policy.policyDigest } }), /exact original authority/);
    await assert.rejects(ServiceSupervisor.open({ ...f.options, bootstrap: { proof: f.proof(f.incumbent, f.initial), policyDigest: f.policy.policyDigest } }), /exact original signed proof/);
    supervisor = await ServiceSupervisor.open(f.options);
    assert.equal(supervisor.status().ready?.authority.generation, f.initial.generation);
    await supervisor.close(); supervisor = undefined;
    await assert.rejects(ServiceSupervisor.open({ ...f.options, mode: 'product' }), /retained product policy/);
    supervisor = await ServiceSupervisor.open({ ...f.options, getPolicy() { throw new Error('Offline'); }, readArtifact() { throw new Error('Offline'); } });
    assert.equal(supervisor.status().running, true);
  } finally { await supervisor?.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('host keys bind public policy; evidence rejects paths; owner-only controls reject filepath requests and serialize actual recovery', { timeout: 60000 }, async () => {
  const f = fixture(); let supervisor: ServiceSupervisor | undefined;
  try {
    const keyPath = join(f.root, 'reviewer.key'); writeFileSync(keyPath, f.key, { mode: 0o600 });
    const policyPath = join(f.root, 'policy.json');
    const policyFile: HostPolicyFile = { controlRevision: f.policy.controlRevision, policyDigest: f.policy.policyDigest,
      descriptor: policyDescriptor(f.policy) as HostPolicyFile['descriptor'], keyFiles: [['fixture-reviewer', keyPath]] };
    writeFileSync(policyPath, JSON.stringify(policyFile), { mode: 0o600 });
    assert.equal(loadHostPolicy(policyPath).policyDigest, f.policy.policyDigest);
    writeFileSync(keyPath, randomBytes(32), { mode: 0o600 }); assert.throws(() => loadHostPolicy(policyPath), /key differs/);
    const read = contentAddressedEvidence(f.evidenceDirectory); assert.throws(() => read(keyPath), /content-addressed/); assert.throws(() => read('sha256:../../reviewer.key'), /content-addressed/);
    supervisor = await ServiceSupervisor.open(f.options);
    const server = await serveControls(supervisor, f.host.stateDirectory);
    try {
      assert.equal(lstatSync(controlSocket(f.host.stateDirectory)).mode & 0o777, 0o600);
      assert.equal((await requestControl(f.host.stateDirectory, { kind: 'status' }) as { running: boolean }).running, true);
      await assert.rejects(requestControl(f.host.stateDirectory, { kind: 'recover', proofFile: keyPath } as any), /Exact host control/);
      const prior = supervisor.status().ready!.authority;
      await requestControl(f.host.stateDirectory, { kind: 'recover' });
      assert.ok(supervisor.status().ready!.authority.epoch > prior.epoch);
      assert.equal(JSON.stringify(supervisor.status()).includes(keyPath), false);
    } finally { await new Promise<void>(accept => server.close(() => accept())); }
  } finally { await supervisor?.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('CLI supervisor SIGKILL releases host ownership and recovers actual application with latest state and absent bootstrap/evaluator inputs', { timeout: 90000 }, async () => {
  const f = fixture(); let child: ChildProcess | undefined;
  const cli = fileURLToPath(new URL('./cli.ts', import.meta.url));
  const policyPath = join(f.root, 'policy.json'), proofPath = join(f.root, 'initial-proof.json'), keyPath = join(f.root, 'reviewer.key'), configPath = join(f.root, 'host.json');
  writeFileSync(keyPath, f.key, { mode: 0o600 });
  writeFileSync(policyPath, JSON.stringify({ controlRevision: f.policy.controlRevision, policyDigest: f.policy.policyDigest, descriptor: policyDescriptor(f.policy), keyFiles: [['fixture-reviewer', keyPath]] }), { mode: 0o600 });
  writeFileSync(proofPath, JSON.stringify(f.initialProof), { mode: 0o600 });
  writeFileSync(configPath, JSON.stringify({ host: f.host, mode: 'engineering', evidenceDirectory: f.evidenceDirectory, policyFiles: [[f.policy.policyDigest, policyPath]], bootstrap: { proofFile: proofPath, policyDigest: f.policy.policyDigest } }), { mode: 0o600 });
  async function start(): Promise<any> {
    child = spawn(process.execPath, [cli, 'supervise', configPath], { env: { PATH: '/usr/bin:/bin', NODE_NO_WARNINGS: '1', MISTRAL_API_KEY: 'unavailable-provider', AUTARK_DIRECT_TOKEN: 'private-token' }, stdio: ['ignore', 'pipe', 'pipe'] });
    return await new Promise((accept, reject) => {
      let output = '', error = '';
      const timer = setTimeout(() => reject(new Error(`CLI startup timeout: ${error}`)), 35000);
      child!.stderr!.on('data', data => { error += data.toString(); });
      child!.once('error', reject); child!.once('exit', () => { clearTimeout(timer); reject(new Error(`CLI exited before startup: ${error}`)); });
      child!.stdout!.on('data', data => { output += data.toString(); if (output.includes('\n')) { clearTimeout(timer); try { accept(JSON.parse(output.trim())); } catch (error) { reject(error); } } });
    });
  }
  async function stop(signal: NodeJS.Signals): Promise<void> {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>(accept => child!.once('exit', () => accept())); child.kill(signal); await exited;
  }
  try {
    const first = await start(); assert.equal(first.running, true);
    const store = new OperationalStore({ filename: join(f.host.stateDirectory, 'operational.sqlite') });
    store.put('fixture.lived-state', 'current', { memory: 'written before supervisor crash', uncertainEffects: ['unknown-never-retry-blindly'] }, null); const latest = store.get('fixture.lived-state', 'current'); store.close();
    await stop('SIGKILL');
    for (const path of [proofPath, policyPath, keyPath, f.evidenceDirectory]) rmSync(path, { recursive: true, force: true });
    const recovered = await start(); assert.ok(recovered.ready.authority.epoch > first.ready.authority.epoch); assert.equal(recovered.release.active.candidateId, f.incumbent.manifest.id);
    assert.equal((await requestControl(f.host.stateDirectory, { kind: 'status' }) as any).running, true);
    const resumed = new OperationalStore({ filename: join(f.host.stateDirectory, 'operational.sqlite') }); assert.deepEqual(resumed.get('fixture.lived-state', 'current'), latest); assert.equal(resumed.list('physical-requests').length, 0); resumed.close();
    await stop('SIGTERM');
    const lease = new ProcessLease(join(f.host.stateDirectory, 'supervisor-lease.sqlite')); lease.close();
  } finally { await stop('SIGKILL'); rmSync(f.root, { recursive: true, force: true }); }
});
