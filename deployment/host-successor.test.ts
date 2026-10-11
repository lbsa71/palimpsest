import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
import { candidateNodeBinary, freezeApplication, type DeploymentInputs } from './candidate.ts';
import { hostSelection, requestHostSuccessor } from './host-successor.ts';
import { controlSocket, requestControl, serveControls } from './cli.ts';
import { contentAddressedEvidence, loadHostPolicy, type HostPolicyFile } from './host-policy.ts';
import type { HostBindings } from './materialize.ts';
import { rewriteSourceEntries } from './source-workspace.ts';
import { ServiceSupervisor, type SupervisorOptions } from './supervisor.ts';
import { maxRuntimeBytes, stageRuntimeBundle } from './runtime-bundle.ts';

function fixture() {
  const repository = process.env.AEON_TEST_SOURCE_ROOT ?? dirname(dirname(fileURLToPath(import.meta.url)));
  const root = mkdtempSync(join(tmpdir(), 'aeon-coordinator-'));
  const source = join(root, 'source'); mkdirSync(source);
  for (const entry of rewriteSourceEntries) if (existsSync(join(repository, entry))) cpSync(join(repository, entry), join(source, entry), { recursive: true });
  // Development worktrees may link the trusted compiler closure; admitted candidate payloads must not.
  cpSync(realpathSync(join(repository, 'node_modules')), join(source, 'node_modules'), { recursive: true });
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
  return { root, writableSource: source, source: join(host.artifactStore, incumbent.manifest.id, 'payload'), host, inputs, incumbent, policy, key, initial, initialProof, evidenceDirectory, options, proof };
}
async function eventually(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 15000;
  while (!check()) { if (Date.now() > deadline) throw new Error('Lifecycle condition not reached'); await new Promise(resolve => setTimeout(resolve, 20)); }
}

test('accepted host and evaluator code actually replace the coordinator; failed host restores old code offline with latest state', { timeout: 180000 }, async () => {
  const f = fixture(); let child: ChildProcess | undefined; let stderr = '';
  const cli = fileURLToPath(new URL('./cli.ts', import.meta.url));
  const policyPath = join(f.root, 'policy.json'), proofPath = join(f.root, 'initial-proof.json'), keyPath = join(f.root, 'reviewer.key'), configPath = join(f.root, 'host.json');
  writeFileSync(keyPath, f.key, { mode: 0o600 });
  const policies: [string, string][] = [];
  function register(policy: AdmissionPolicy, path: string) {
    writeFileSync(path, JSON.stringify({ controlRevision: policy.controlRevision, policyDigest: policy.policyDigest, descriptor: policyDescriptor(policy), keyFiles: [['fixture-reviewer', keyPath]] }), { mode: 0o600 });
    policies.push([policy.policyDigest, path]);
  }
  register(f.policy, policyPath);
  writeFileSync(proofPath, JSON.stringify(f.initialProof), { mode: 0o600 });
  const admission = join(f.writableSource, 'packages/release/admission.ts');
  writeFileSync(admission, readFileSync(admission, 'utf8').replace("  if (policy.controlRevision !== current.controlRevision)", "  if (proposal.id === 'new-evaluator-witness') throw new Error('accepted-evaluator-v2-executed');\n  if (policy.controlRevision !== current.controlRevision)"));
  // Explicit offline executable grant: 128 MiB per file; 512 MiB artifact, no kernel-profile claim.
  const runtimeBytes = Buffer.concat([readFileSync(process.execPath), Buffer.from('aeon-runtime-fixture-v2')]);
  writeFileSync(join(f.root, 'proposed-node'), runtimeBytes, { mode: 0o700 });
  const runtime = stageRuntimeBundle(f.root, 'proposed-node', f.writableSource, { ...f.inputs.runtime, nodeSha256: hashBytes(runtimeBytes) }, maxRuntimeBytes);
  const successor = freezeApplication(f.writableSource, f.host.artifactStore, { ...f.inputs, runtime });
  const successorBinary = candidateNodeBinary(successor, f.host.artifactStore, f.host.nodeBinary);
  const fields = { ...f.policy, controlRevision: successor.manifest.controls };
  const policy2 = { ...fields, policyDigest: admissionPolicyIdentity(fields) };
  register(policy2, join(f.root, 'policy2.json'));
  writeFileSync(configPath, JSON.stringify({ host: f.host, mode: 'engineering', evidenceDirectory: f.evidenceDirectory, policyFiles: policies, bootstrap: { proofFile: proofPath, policyDigest: f.policy.policyDigest } }), { mode: 0o600 });
  async function status(): Promise<any> { return await requestControl(f.host.stateDirectory, { kind: 'status' }); }
  async function waitStatus(predicate: (value: any) => boolean): Promise<any> {
    const deadline = Date.now() + 50000;
    while (Date.now() < deadline) { try { const value = await status(); if (predicate(value)) return value; } catch {} await new Promise(resolve => setTimeout(resolve, 30)); }
    throw new Error(`Host condition failed: ${stderr}`);
  }
  async function stop() {
    if (child && child.exitCode === null && child.signalCode === null) { const exited = new Promise(resolve => child!.once('exit', resolve)); child.kill('SIGTERM'); await exited; }
  }
  try {
    child = spawn(process.execPath, [cli, 'launch', configPath], { env: { PATH: '/usr/bin:/bin', NODE_NO_WARNINGS: '1', MISTRAL_API_KEY: 'unavailable-provider', AUTARK_DIRECT_TOKEN: 'private-token' }, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr!.on('data', data => { stderr += data.toString(); });
    const first = await waitStatus(s => s.running);
    assert.ok(first.coordinator.module.includes(f.incumbent.manifest.id));
    const initialProof = f.proof(successor, f.initial);
    const stage = await requestControl(f.host.stateDirectory, { kind: 'stage-control', proof: initialProof, policyDigest: policy2.policyDigest }) as string;
    await requestControl(f.host.stateDirectory, { kind: 'activate-control', stageId: stage });
    assert.equal((await status()).coordinator.processId, first.coordinator.processId, 'old coordinator judges probation');
    await assert.rejects(requestControl(f.host.stateDirectory, { kind: 'probation', proof: initialProof }), /fresh evidence/);
    await requestControl(f.host.stateDirectory, { kind: 'probation', proof: f.proof(successor, f.initial) });
    const second = await waitStatus(s => s.running && s.coordinator.module.includes(successor.manifest.id));
    assert.notEqual(second.coordinator.processId, first.coordinator.processId);
    for (const pid of [child.pid, second.coordinator.processId, second.processId]) {
      assert.equal(readlinkSync(`/proc/${pid}/exe`), successorBinary, 'launcher, coordinator and service execute the selected bound ELF');
    }
    assert.notEqual(hashBytes(readFileSync(successorBinary)), f.inputs.runtime.nodeSha256);
    assert.ok(readFileSync(`/proc/${child.pid}/cmdline`, 'utf8').includes(successor.manifest.id), 'launcher itself executes the accepted source');
    assert.throws(() => process.kill(first.coordinator.processId, 0), /ESRCH/);
    const witness = f.proof(successor, second.ready.authority, successor); witness.proposal.id = 'new-evaluator-witness';
    await assert.rejects(requestControl(f.host.stateDirectory, { kind: 'release', proof: witness }), /accepted-evaluator-v2-executed/);
    const store = new OperationalStore({ filename: join(f.host.stateDirectory, 'operational.sqlite') });
    store.put('fixture.lived-state', 'current', { memory: 'latest experience after host succession', uncertainEffects: ['do-not-retry'] }, null); const latest = store.get('fixture.lived-state', 'current'); store.close();
    // Crash the accepted new coordinator with provider, evidence, bootstrap proof and all policy keys absent.
    for (const path of [proofPath, ...policies.map(pair => pair[1]), keyPath, f.evidenceDirectory]) rmSync(path, { recursive: true, force: true });
    process.kill(second.coordinator.processId, 'SIGKILL');
    const recovered = await waitStatus(s => s.running && s.coordinator.module.includes(f.incumbent.manifest.id));
    assert.equal(recovered.release.active.candidateId, f.incumbent.manifest.id);
    for (const pid of [child.pid, recovered.coordinator.processId, recovered.processId]) assert.equal(readlinkSync(`/proc/${pid}/exe`), f.host.nodeBinary, 'offline rescue executes the retained incumbent runtime');
    assert.ok(recovered.ready.authority.epoch > second.ready.authority.epoch);
    assert.throws(() => new ProcessLease(join(f.host.stateDirectory, 'supervisor-lease.sqlite')), /holds the instance lease/);
    const resumed = new OperationalStore({ filename: join(f.host.stateDirectory, 'operational.sqlite') }); assert.deepEqual(resumed.get('fixture.lived-state', 'current'), latest); assert.equal(resumed.list('physical-requests').length, 0); resumed.close();
    await stop();
  } finally { await stop(); rmSync(f.root, { recursive: true, force: true }); }
});

test('accepted but unbootable coordinator restores the retained host without evaluating itself or reading provider inputs', { timeout: 120000 }, async () => {
  const f = fixture(); let child: ChildProcess | undefined; let errors = '';
  const policyPath = join(f.root, 'policy.json'), nextPolicyPath = join(f.root, 'next-policy.json'), proofPath = join(f.root, 'proof.json'), keyPath = join(f.root, 'key'), configPath = join(f.root, 'host.json');
  const cliSource = join(f.writableSource, 'deployment/cli.ts');
  writeFileSync(cliSource, readFileSync(cliSource, 'utf8').replace("  if (command === 'supervise' && values.length === 1) {", "  if (command === 'supervise' && values.length === 1) { throw new Error('deliberately unbootable accepted host');"));
  const candidate = freezeApplication(f.writableSource, f.host.artifactStore, f.inputs);
  const fields = { ...f.policy, controlRevision: candidate.manifest.controls }, nextPolicy = { ...fields, policyDigest: admissionPolicyIdentity(fields) };
  writeFileSync(keyPath, f.key, { mode: 0o600 });
  for (const [path, policy] of [[policyPath, f.policy], [nextPolicyPath, nextPolicy]] as const) writeFileSync(path, JSON.stringify({ controlRevision: policy.controlRevision, policyDigest: policy.policyDigest, descriptor: policyDescriptor(policy), keyFiles: [['fixture-reviewer', keyPath]] }), { mode: 0o600 });
  writeFileSync(proofPath, JSON.stringify(f.initialProof), { mode: 0o600 });
  writeFileSync(configPath, JSON.stringify({ host: f.host, mode: 'engineering', evidenceDirectory: f.evidenceDirectory, policyFiles: [[f.policy.policyDigest, policyPath], [nextPolicy.policyDigest, nextPolicyPath]], bootstrap: { proofFile: proofPath, policyDigest: f.policy.policyDigest } }), { mode: 0o600 });
  const status = () => requestControl(f.host.stateDirectory, { kind: 'status' }) as Promise<any>;
  async function waitStatus(predicate: (s: any) => boolean) {
    const deadline = Date.now() + 50000;
    while (Date.now() < deadline) { try { const s = await status(); if (predicate(s)) return s; } catch {} await new Promise(resolve => setTimeout(resolve, 30)); }
    throw new Error(errors);
  }
  try {
    child = spawn(process.execPath, [fileURLToPath(new URL('./cli.ts', import.meta.url)), 'launch', configPath], { env: { PATH: '/usr/bin:/bin', NODE_NO_WARNINGS: '1', MISTRAL_API_KEY: 'unavailable-provider', AUTARK_DIRECT_TOKEN: 'token' }, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr!.on('data', data => { errors += data.toString(); });
    const first = await waitStatus(s => s.running);
    const stageId = await requestControl(f.host.stateDirectory, { kind: 'stage-control', proof: f.proof(candidate, f.initial), policyDigest: nextPolicy.policyDigest }) as string;
    await requestControl(f.host.stateDirectory, { kind: 'activate-control', stageId });
    await requestControl(f.host.stateDirectory, { kind: 'probation', proof: f.proof(candidate, f.initial) });
    for (const path of [policyPath, nextPolicyPath, proofPath, keyPath, f.evidenceDirectory]) rmSync(path, { recursive: true, force: true });
    const recovered = await waitStatus(s => s.running && s.coordinator.processId !== first.coordinator.processId && s.release.active.candidateId === f.incumbent.manifest.id);
    assert.ok(recovered.coordinator.module.includes(f.incumbent.manifest.id));
    assert.ok(errors.includes('deliberately unbootable accepted host'));
    assert.ok(recovered.ready.authority.epoch > first.ready.authority.epoch);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { const exited = new Promise(resolve => child!.once('exit', resolve)); child.kill('SIGTERM'); await exited; }
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('a broken accepted launcher falls back through the retained bootstrap on restart without a surviving old coordinator', { timeout: 120000 }, async () => {
  const f = fixture(); let supervisor: ServiceSupervisor | undefined, child: ChildProcess | undefined;
  const launcher = join(f.writableSource, 'deployment/host-successor.ts');
  writeFileSync(launcher, "throw new Error('accepted launcher failed before startup');\n" + readFileSync(launcher, 'utf8'));
  const candidate = freezeApplication(f.writableSource, f.host.artifactStore, f.inputs);
  const fields = { ...f.policy, controlRevision: candidate.manifest.controls }, nextPolicy = { ...fields, policyDigest: admissionPolicyIdentity(fields) };
  const config = { host: f.host, mode: 'engineering' as const, evidenceDirectory: f.evidenceDirectory, policyFiles: [] as [string, string][] };
  const configPath = join(f.root, 'host.json'); writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
  function start() {
    child = spawn(process.execPath, [fileURLToPath(new URL('./cli.ts', import.meta.url)), 'launch', configPath], { env: { PATH: '/usr/bin:/bin', NODE_NO_WARNINGS: '1', MISTRAL_API_KEY: 'unavailable-provider', AUTARK_DIRECT_TOKEN: 'token' }, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr!.resume(); return child;
  }
  try {
    supervisor = await ServiceSupervisor.open({ ...f.options, getPolicy: digest => digest === nextPolicy.policyDigest ? nextPolicy : f.options.getPolicy(digest) });
    const stage = await supervisor.stageControl(f.proof(candidate, f.initial), nextPolicy.policyDigest);
    await supervisor.activateControl(stage); await supervisor.acceptProbation(f.proof(candidate, f.initial));
    requestHostSuccessor(config, supervisor.status().release!.accepted, { candidateId: f.incumbent.manifest.id, policyDigest: f.policy.policyDigest });
    await supervisor.close(); supervisor = undefined;
    rmSync(f.evidenceDirectory, { recursive: true, force: true });
    const failed = start(); const code = await new Promise(resolve => failed.once('exit', resolve));
    assert.equal(code, 1); assert.equal(hostSelection(config)?.phase, 'booting');
    start();
    const deadline = Date.now() + 45000; let recovered: any;
    while (Date.now() < deadline) { try { const s = await requestControl(f.host.stateDirectory, { kind: 'status' }) as any; if (s.running) { recovered = s; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 30)); }
    assert.ok(recovered, 'retained bootstrap must recover failed launcher');
    assert.ok(recovered.coordinator.module.includes(f.incumbent.manifest.id));
    assert.equal(recovered.release.accepted.candidateId, f.incumbent.manifest.id);
  } finally {
    await supervisor?.close();
    if (child && child.exitCode === null && child.signalCode === null) { const exited = new Promise(resolve => child!.once('exit', resolve)); child.kill('SIGTERM'); await exited; }
    rmSync(f.root, { recursive: true, force: true });
  }
});


test('coordinator observes launcher loss during asynchronous startup and releases authority', { timeout: 60000 }, async () => {
  const f = fixture(); let child: ChildProcess | undefined; let coordinator: number | undefined;
  const cli = join(f.writableSource, 'deployment/cli.ts'), marker = join(f.root, 'starting');
  // Pause inside startup before the service returns, after the coordinator has entered supervise.
  writeFileSync(cli, readFileSync(cli, 'utf8').replace('      supervisor = await ServiceSupervisor.open(',
    `    await import('node:fs').then(fs => fs.writeFileSync(${JSON.stringify(marker)}, String(process.pid)));
    await new Promise(resolve => setTimeout(resolve, 1500));
      supervisor = await ServiceSupervisor.open(`));
  const candidate = freezeApplication(f.writableSource, f.host.artifactStore, f.inputs);
  const fields = { ...f.policy, controlRevision: candidate.manifest.controls }, policy = { ...fields, policyDigest: admissionPolicyIdentity(fields) };
  const authority = { ...f.initial, controlRevision: candidate.manifest.controls };
  const proof = f.proof(candidate, authority, candidate);
  proof.signed = proof.proposal.evidence.map(evidence => signEvaluation(evidence, f.key, policy.policyDigest));
  const keyPath = join(f.root, 'key'), policyPath = join(f.root, 'policy'), proofPath = join(f.root, 'proof'), configPath = join(f.root, 'config');
  writeFileSync(keyPath, f.key, { mode: 0o600 });
  writeFileSync(policyPath, JSON.stringify({ controlRevision: policy.controlRevision, policyDigest: policy.policyDigest, descriptor: policyDescriptor(policy), keyFiles: [['fixture-reviewer', keyPath]] }), { mode: 0o600 });
  writeFileSync(proofPath, JSON.stringify(proof), { mode: 0o600 });
  writeFileSync(configPath, JSON.stringify({ host: f.host, mode: 'engineering', evidenceDirectory: f.evidenceDirectory, policyFiles: [[policy.policyDigest, policyPath]], bootstrap: { proofFile: proofPath, policyDigest: policy.policyDigest } }), { mode: 0o600 });
  try {
    child = spawn(process.execPath, [fileURLToPath(new URL('./cli.ts', import.meta.url)), 'launch', configPath], { env: { PATH: '/usr/bin:/bin', NODE_NO_WARNINGS: '1', MISTRAL_API_KEY: 'unavailable', AUTARK_DIRECT_TOKEN: 'token' }, stdio: 'ignore' });
    await eventually(() => existsSync(marker)); coordinator = Number(readFileSync(marker, 'utf8'));
    const exited = new Promise(resolve => child!.once('exit', resolve)); child.kill('SIGKILL'); await exited;
    await new Promise(resolve => setTimeout(resolve, 6000));
    let serving = false;
    try { serving = Boolean((await requestControl(f.host.stateDirectory, { kind: 'status' }) as any).running); } catch {}
    assert.equal(serving, false, 'orphan coordinator must not remain serving after launcher disappears during startup');
    const lease = new ProcessLease(join(f.host.stateDirectory, 'supervisor-lease.sqlite')); lease.close();
    if (existsSync(join(f.host.stateDirectory, 'authority.sqlite'))) {
      const ledger = new AuthorityStore(join(f.host.stateDirectory, 'authority.sqlite'));
      try { assert.ok(!ledger.current()?.generation); } finally { ledger.close(); }
    }
  } finally {
    if (coordinator) { try { process.kill(coordinator, 'SIGTERM'); } catch {} }
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await new Promise(resolve => setTimeout(resolve, 1000));
    rmSync(f.root, { recursive: true, force: true });
  }
});
