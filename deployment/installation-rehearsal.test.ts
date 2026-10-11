import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, chownSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { ArtifactRef, Authority, EvaluationEvidence } from '../packages/contracts/index.ts';
import { admissionPolicyIdentity, signEvaluation, type AdmissionPolicy } from '../packages/release/admission.ts';
import { hashBytes, type FrozenCandidate } from '../packages/release/artifacts.ts';
import { policyDescriptor, type ReleaseProof } from '../packages/release/controller.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { freezeApplication, type DeploymentInputs } from './candidate.ts';
import { requestControl, type SupervisorFile } from './cli.ts';
import { applyInstallation, hostDataMountUnitName, mountUnitName, renderInstallation, stopInstallation, workspacePath, writeInstallationBundle, type Installation } from './installation.ts';
import { rewriteSourceEntries } from './source-workspace.ts';

/** Opt-in only: actual temporary installed units, bounded loop volumes and service UID.
 * Never uses real provider credentials, Slack, existing service state or product evidence.
 */
test('complete disposable installation retains current state, with optional installed succession and offline rescue', {
  skip: process.env.AEON_INSTALLATION_REHEARSAL !== '1' && process.env.AEON_INSTALLED_SUCCESSION !== '1', timeout: 300000,
}, async t => {
  const succession = process.env.AEON_INSTALLED_SUCCESSION === '1';
  assert.equal(process.getuid?.(), 0, 'Explicit disposable administrator fixture required');
  const uid = Number(process.env.AEON_FIXTURE_UID), gid = Number(process.env.AEON_FIXTURE_GID);
  assert.ok(Number.isSafeInteger(uid) && uid > 0 && Number.isSafeInteger(gid) && gid > 0);
  const repository = dirname(dirname(fileURLToPath(import.meta.url)));
  const root = mkdtempSync('/var/tmp/aeon-installed-rehearsal-'); chmodSync(root, 0o755);
  const execute = (file: string, args: string[]) => execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin' } });
  const soft = (file: string, args: string[]) => { try { return execute(file, args); } catch { return ''; } };
  const unitName = `aeon-fixture-${process.pid}-${randomBytes(4).toString('hex')}.service`;
  const data = join(root, 'data'), state = join(data, 'work/state'), artifacts = join(data, 'work/artifacts'), evidenceDirectory = join(data, 'work/evidence');
  const privateRoot = join(root, 'private'); mkdirSync(privateRoot, { mode: 0o700 }); chownSync(privateRoot, uid, gid);
  const privateWrite = (path: string, value: string | Uint8Array) => { writeFileSync(path, value, { mode: 0o600 }); chownSync(path, uid, gid); };
  let installation: Installation | undefined, installed = false;
  try {
    execute(process.execPath, [join(repository, 'deployment/installation-entry.mjs'), 'create-host-data', data, String(uid), String(gid), String(1024 * 1024 * 1024), '32768']);
    const source = join(root, 'source'); mkdirSync(source);
    for (const entry of rewriteSourceEntries) if (existsSync(join(repository, entry))) { mkdirSync(dirname(join(source, entry)), { recursive: true }); cpSync(join(repository, entry), join(source, entry), { recursive: true }); }
    cpSync(realpathSync(join(repository, 'node_modules')), join(source, 'node_modules'), { recursive: true });
    const blob = (bytes: string | Uint8Array): ArtifactRef => { const sha256 = hashBytes(Buffer.from(bytes)); privateWrite(join(evidenceDirectory, sha256), bytes); return { uri: `sha256:${sha256}`, sha256 }; };
    const key = randomBytes(32), evaluator = blob('Synthetic installation fixture evaluator. No competence or product qualification.');
    const policyFields = { kind: 'engineering' as const, requiredCases: ['installed-lifecycle'], evaluatorKeys: new Map([['installation-fixture', key]]), evaluatorArtifacts: new Map([['installation-fixture', evaluator.sha256]]) };
    const resources = { maxRequests: 0, maxTokens: 0, maxCostUsd: 0, maxElapsedMs: 600000, maxConcurrency: 2 };
    const workspaceBytes = 128 * 1024 * 1024, workspaceInodes = 8192, cgroupRoot = `/sys/fs/cgroup/system.slice/${unitName}`;
    const inputs: DeploymentInputs = { createdBy: 'installation-author', policy: policyDescriptor(policyFields), prompts: { mind: 'No inference; synthetic installation lifecycle fixture.', compaction: 'Preserve actual observations.' },
      runtime: { nodeVersion: process.version, nodeSha256: hashBytes(readFileSync(process.execPath)), platform: process.platform, arch: process.arch },
      configuration: { bootstrapInitiative: false, model: { id: 'fixture-no-provider', reasoning: false, effort: 'none', contextWindow: 8192, maxOutputTokens: 256, maxRequestsPerSlice: 1, timeoutMs: 1000, pricesPerMillion: { input: 1, output: 2 } },
        resources, conversationResources: resources, scheduler: { windowMs: 1000, maxSlicesPerWindow: 1, maxLifetimeSlices: 1, quantumMs: 2000, idleRetryMs: 1000, maxStalls: 2, resources },
        resourceLimits: { memoryBytes: 512 * 1024 * 1024, pids: 64, cpuQuotaMicros: 100000, cpuPeriodMicros: 100000, maxFileBytes: 16 * 1024 * 1024, maxOpenFiles: 128, workspaceBytes, workspaceInodes },
        maxConcurrentRuns: 1, pollMs: 100, commands: ['/runtime/node'], researchHosts: [], direct: { host: '127.0.0.1', port: 0, actorId: 'installation-fixture', scope: { kind: 'public' }, modificationEligible: false } } };
    const candidate = freezeApplication(source, artifacts, inputs);
    execute('/usr/bin/chown', ['-R', `${uid}:${gid}`, join(artifacts, candidate.manifest.id)]);
    const fields = { ...policyFields, controlRevision: candidate.manifest.controls }, policy = { ...fields, policyDigest: admissionPolicyIdentity(fields) };
    const candidatePolicy = (value: FrozenCandidate): AdmissionPolicy => {
      const fields = { ...policyFields, controlRevision: value.manifest.controls }; return { ...fields, policyDigest: admissionPolicyIdentity(fields) };
    };
    let successor: FrozenCandidate | undefined, broken: FrozenCandidate | undefined;
    if (succession) {
      // These are executable witnesses in three separately frozen control files, not comments.
      const bootstrap = join(source, 'deployment/bootstrap-evolution.ts'), launcher = join(source, 'deployment/host-successor.ts'), cli = join(source, 'deployment/cli.ts');
      const inject = (path: string, before: string, after: string) => {
        const value = readFileSync(path, 'utf8'); assert.ok(value.includes(before), `Missing witness seam in ${path}`); writeFileSync(path, value.replace(before, after));
      };
      inject(bootstrap, '  const cwd = realpathSync(process.cwd()),', "  writeFileSync(join(manifest.stateDirectory, 'fixture-successor-bootstrap.json'), JSON.stringify({ pid: process.pid, module: fileURLToPath(import.meta.url), cwd: process.cwd(), executable: process.execPath }));\n  const cwd = realpathSync(process.cwd()),");
      inject(launcher, "import { closeSync,", "import { writeFileSync, closeSync,");
      inject(launcher, '  validateHostBindings(config.host);', "  writeFileSync(join(config.host.stateDirectory, 'fixture-successor-launcher.json'), JSON.stringify({ pid: process.pid, module: fileURLToPath(import.meta.url) }));\n  validateHostBindings(config.host);");
      inject(cli, "import {", "import { writeFileSync as writeFixtureWitness } from 'node:fs';\nimport {");
      inject(cli, "  if (command === 'supervise' && values.length === 1) {", "  if (command === 'supervise' && values.length === 1) {\n    writeFixtureWitness(join(JSON.parse(readHostFile(values[0]!).toString('utf8')).host.stateDirectory, 'fixture-successor-cli.json'), JSON.stringify({ pid: process.pid, module: fileURLToPath(import.meta.url) }));");
      successor = freezeApplication(source, artifacts, inputs);
      // Imports and application probation must work; only the installed entry's run operation fails.
      inject(bootstrap, 'async function run(args: string[]): Promise<void> {', "async function run(args: string[]): Promise<void> {\n  if (args[0] === 'run') throw new Error('fixture-installed-bootstrap-failure');");
      broken = freezeApplication(source, artifacts, inputs);
      for (const value of [successor, broken]) execute('/usr/bin/chown', ['-R', `${uid}:${gid}`, join(artifacts, value.manifest.id)]);
      assert.notEqual(candidate.manifest.controls, successor.manifest.controls); assert.notEqual(successor.manifest.controls, broken.manifest.controls);
    }
    const authority: Authority = { generation: 'installation-author', epoch: 1, controlRevision: candidate.manifest.controls };
    const observed = blob('Synthetic bootstrap admission for mechanical installation checks only.');
    const evidence: EvaluationEvidence = { id: 'installation-fixture', candidateId: candidate.manifest.id, controlRevision: authority.controlRevision, evaluatorId: 'installation-fixture', evaluatorArtifact: evaluator, independent: true,
      verdict: 'pass', artifact: observed, caseResults: [{ id: 'installed-lifecycle', status: 'pass', observations: observed, usage: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 }, interventions: ['Synthetic bootstrap proof; not live evaluation.'] }] };
    const proof: ReleaseProof = { proposal: { id: 'installation-bootstrap', candidate: candidate.manifest, priorAuthority: authority, evidence: [evidence], recoveryArtifact: blob(readFileSync(join(artifacts, candidate.manifest.id, 'candidate.json'))) }, signed: [signEvaluation(evidence, key, policy.policyDigest)] };
    const keyFile = join(privateRoot, 'key'), policyFile = join(privateRoot, 'policy.json'), proofFile = join(privateRoot, 'proof.json'), hostConfigFile = join(privateRoot, 'host.json'), environmentFile = join(root, 'environment');
    privateWrite(keyFile, key); privateWrite(policyFile, JSON.stringify({ controlRevision: policy.controlRevision, policyDigest: policy.policyDigest, descriptor: policyDescriptor(policy), keyFiles: [['installation-fixture', keyFile]] }));
    privateWrite(proofFile, JSON.stringify(proof));
    const policies: [string, string][] = [[policy.policyDigest, policyFile]];
    for (const [name, value] of [['successor', successor], ['broken', broken]] as const) if (value) {
      const next = candidatePolicy(value), path = join(privateRoot, `${name}-policy.json`);
      privateWrite(path, JSON.stringify({ controlRevision: next.controlRevision, policyDigest: next.policyDigest, descriptor: policyDescriptor(next), keyFiles: [['installation-fixture', keyFile]] })); policies.push([next.policyDigest, path]);
    }
    installation = { unitName, uid, gid, nodeBinary: process.execPath, artifactStore: artifacts, stateDirectory: state, hostDataProvisionDirectory: data, hostDataBytes: 1024 * 1024 * 1024, hostDataInodes: 32768,
      coordinatorCandidateId: candidate.manifest.id, hostConfigFile, environmentFile, workspaceProvisionDirectory: join(root, 'workspace'), workspaceBytes, workspaceInodes, outerMemoryBytes: 2 * 1024 * 1024 * 1024, outerTasks: 256, outerCpuPercent: 200 };
    const config: SupervisorFile = { host: { stateDirectory: state, workspaceDirectory: workspacePath(installation), artifactStore: artifacts, nodeBinary: process.execPath, cgroupRoot }, mode: 'engineering', evidenceDirectory,
      policyFiles: policies, bootstrap: { proofFile, policyDigest: policy.policyDigest }, allowedModelProfiles: [inputs.configuration.model] };
    privateWrite(hostConfigFile, JSON.stringify(config));
    writeFileSync(environmentFile, 'MISTRAL_API_KEY=fixture-no-provider\nAUTARK_DIRECT_TOKEN=fixture-direct-token\n', { mode: 0o600 });
    const bundle = join(root, 'bundle'); writeInstallationBundle(installation, bundle); applyInstallation(installation, bundle); installed = true;
    execute('/usr/bin/systemctl', ['start', unitName]);
    const ready = async (predicate: (value: any) => boolean = () => true): Promise<any> => {
      const deadline = Date.now() + 35000;
      while (Date.now() < deadline) {
        try { const value = await requestControl(state, { kind: 'status' }) as any; if (value.running && value.ready && predicate(value)) return value; } catch {}
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error(`Installed fixture not ready: ${readFileSync(join(data, 'work/logs/coordinator.log'), 'utf8').slice(-16000)}`);
    };
    const first = await ready();
    assert.equal(readFileSync(join(cgroupRoot, 'cgroup.procs'), 'utf8').trim(), '', 'Retained bootstrap must not occupy the internal controller root');
    const mainPid = execute('/usr/bin/systemctl', ['show', '--property=MainPID', '--value', unitName]).trim();
    assert.ok(readFileSync(join(cgroupRoot, 'host/cgroup.procs'), 'utf8').trim().split('\n').includes(mainPid), 'Retained bootstrap and its descendants occupy the host leaf');
    const controllers = readFileSync(join(cgroupRoot, 'cgroup.subtree_control'), 'utf8').trim().split(/\s+/);
    assert.ok(['cpu', 'memory', 'pids'].every(controller => controllers.includes(controller)));
    const response = await fetch(`http://127.0.0.1:${first.ready.address.port}/health`, { headers: { authorization: 'Bearer fixture-direct-token' } });
    assert.equal(response.status, 200);
    const health = await response.json() as { alive: boolean; kernelLimitsConfigured: boolean; execution: { admission: string; reasons: string[]; providerConnectivity: string } };
    assert.equal(health.alive, true); assert.equal(health.kernelLimitsConfigured, true);
    assert.equal(health.execution.admission, 'held'); assert.deepEqual(health.execution.reasons, ['allowance-exhausted']);
    assert.equal(health.execution.providerConnectivity, 'not-probed');
    const withStore = <T>(operation: (store: OperationalStore) => T): T => {
      const store = new OperationalStore({ filename: join(state, 'operational.sqlite') });
      try { return operation(store); } finally { store.close(); }
    };
    withStore(store => store.put('fixture.current-state', 'latest', { experience: 'retained', uncertainEffect: 'unresolved fixture marker' }, null));
    stopInstallation(installation);
    execute('/usr/bin/systemctl', ['start', unitName]);
    const second = await ready(); assert.ok(second.ready.authority.epoch > first.ready.authority.epoch);
    withStore(reopened => {
      assert.deepEqual(reopened.get('fixture.current-state', 'latest')!.value, { experience: 'retained', uncertainEffect: 'unresolved fixture marker' });
      assert.equal(reopened.list('requests').length, 0, 'No physical model/tool request is authorized in this lifecycle fixture');
    });
    if (successor && broken) {
      const boot = join(state, 'boot'), incumbentBoot = realpathSync(join(boot, 'rescue'));
      assert.equal(incumbentBoot, join(boot, 'targets', candidate.manifest.id));
      let sequence = 0;
      const transitionProof = (value: FrozenCandidate, priorAuthority: Authority, judge: AdmissionPolicy, rescue: FrozenCandidate): ReleaseProof => {
        const id = `installed-transition-${++sequence}`, observed = blob(`Synthetic installed transition ${id}; engineering only.`);
        const evidence: EvaluationEvidence = { id, candidateId: value.manifest.id, controlRevision: priorAuthority.controlRevision,
          evaluatorId: 'installation-fixture', evaluatorArtifact: evaluator, independent: true, verdict: 'pass', artifact: observed,
          caseResults: [{ id: 'installed-lifecycle', status: 'pass', observations: observed, usage: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 }, interventions: ['Synthetic engineering judgment; no competence qualification.'] }] };
        return { proposal: { id, candidate: value.manifest, priorAuthority, evidence: [evidence], recoveryArtifact: blob(readFileSync(join(artifacts, rescue.manifest.id, 'candidate.json'))) }, signed: [signEvaluation(evidence, key, judge.policyDigest)] };
      };
      const promote = async (value: FrozenCandidate, previous: any, judge: AdmissionPolicy, rescue: FrozenCandidate) => {
        const proof = transitionProof(value, previous.ready.authority, judge, rescue);
        const stageId = await requestControl(state, { kind: 'stage-control', proof, policyDigest: candidatePolicy(value).policyDigest }) as string;
        await requestControl(state, { kind: 'activate-control', stageId });
        const probation = await requestControl(state, { kind: 'status' }) as any;
        assert.equal(probation.coordinator.processId, previous.coordinator.processId, 'Actual predecessor coordinator judges probation');
        assert.equal(probation.release.phase, 'probation');
        await assert.rejects(requestControl(state, { kind: 'probation', proof }), /fresh evidence/);
        await requestControl(state, { kind: 'probation', proof: transitionProof(value, previous.ready.authority, judge, rescue) });
        return await ready(valueStatus => valueStatus.coordinator.module.includes(value.manifest.id));
      };
      const successorRunning = await promote(successor, second, policy, candidate);
      assert.ok(successorRunning.ready.authority.epoch > second.ready.authority.epoch);
      assert.notEqual(successorRunning.coordinator.processId, second.coordinator.processId);
      assert.equal(existsSync(join(state, 'fixture-successor-bootstrap.json')), false, 'Launcher handoff alone does not execute the changed bootstrap');
      assert.equal(realpathSync(join(boot, 'active')), join(boot, 'targets', successor.manifest.id));
      assert.equal(realpathSync(join(boot, 'rescue')), incumbentBoot, 'Automatic promotion leaves original rescue intact');
      stopInstallation(installation); execute('/usr/bin/systemctl', ['start', unitName]);
      const successorBooted = await ready(value => value.coordinator.module.includes(successor!.manifest.id));
      const selectedBoot = join(boot, 'targets', successor.manifest.id);
      const selectedPid = Number(execute('/usr/bin/systemctl', ['show', '--property=MainPID', '--value', unitName]).trim());
      assert.equal(readlinkSync(`/proc/${selectedPid}/cwd`), selectedBoot);
      assert.ok(readFileSync(`/proc/${selectedPid}/cmdline`, 'utf8').split('\0').includes('payload/deployment/bootstrap-evolution.ts'));
      for (const pid of [selectedPid, successorBooted.coordinator.processId, successorBooted.processId]) assert.equal(readlinkSync(`/proc/${pid}/exe`), join(selectedBoot, 'node'));
      assert.equal(readFileSync(join(cgroupRoot, 'cgroup.procs'), 'utf8').trim(), '');
      const hostPids = readFileSync(join(cgroupRoot, 'host/cgroup.procs'), 'utf8').trim().split('\n');
      for (const pid of [selectedPid, successorBooted.coordinator.processId, successorBooted.processId]) assert.ok(hostPids.includes(String(pid)));
      for (const [file, pid, module] of [['bootstrap', selectedPid, 'bootstrap-evolution.ts'], ['launcher', selectedPid, 'host-successor.ts'], ['cli', successorBooted.coordinator.processId, 'cli.ts']] as const) {
        const witness = JSON.parse(readFileSync(join(state, `fixture-successor-${file}.json`), 'utf8'));
        assert.equal(witness.pid, pid); assert.equal(witness.module, join(artifacts, successor.manifest.id, 'payload/deployment', module));
      }
      const bootReady = JSON.parse(readFileSync(join(selectedBoot, 'boot-ready.json'), 'utf8'));
      assert.deepEqual(bootReady.authority, successorBooted.release.authority); assert.equal(bootReady.target.candidateId, successor.manifest.id);
      assert.ok(successorBooted.ready.authority.epoch > successorRunning.ready.authority.epoch);
      const latest = withStore(current => {
        current.put('fixture.current-state', 'latest', { experience: 'latest after installed succession', uncertainEffect: 'unresolved; do not retry' }, current.get('fixture.current-state', 'latest')!.revision);
        return current.get('fixture.current-state', 'latest');
      });
      const brokenRunning = await promote(broken, successorBooted, candidatePolicy(successor), successor);
      assert.ok(brokenRunning.ready.authority.epoch > successorBooted.ready.authority.epoch);
      assert.equal(realpathSync(join(boot, 'active')), join(boot, 'targets', broken.manifest.id));
      assert.equal(realpathSync(join(boot, 'rescue')), incumbentBoot);
      assert.equal(existsSync(join(boot, 'failed')), false);
      t.diagnostic(JSON.stringify({ kind: 'installed-succession-before-offline-restart', incumbent: candidate.manifest.id, successor: successor.manifest.id, brokenBootstrap: broken.manifest.id,
        epochs: [first, second, successorRunning, successorBooted, brokenRunning].map(value => value.ready.authority.epoch),
        hostDataUsage: execute('/usr/bin/df', ['-B1', join(data, 'work')]).trim() }));
      stopInstallation(installation);
      // systemd requires the file itself. Retain only the direct-surface credential; no provider key.
      writeFileSync(environmentFile, 'AUTARK_DIRECT_TOKEN=fixture-direct-token\n', { mode: 0o600 });
      for (const path of [proofFile, keyFile, ...policies.map(([, path]) => path), evidenceDirectory]) rmSync(path, { recursive: true, force: true });
      const restartsBefore = Number(execute('/usr/bin/systemctl', ['show', '--property=NRestarts', '--value', unitName]).trim());
      execute('/usr/bin/systemctl', ['start', unitName]);
      const recovered = await ready(value => value.coordinator.module.includes(candidate.manifest.id));
      assert.equal(recovered.release.active.candidateId, candidate.manifest.id); assert.equal(recovered.release.accepted.candidateId, candidate.manifest.id);
      assert.ok(recovered.ready.authority.epoch > brokenRunning.ready.authority.epoch);
      assert.equal(existsSync(join(boot, 'failed')), true, 'Independent ExecStopPost failure latch survives rescue startup');
      const restartsAfter = Number(execute('/usr/bin/systemctl', ['show', '--property=NRestarts', '--value', unitName]).trim());
      assert.equal(restartsAfter, restartsBefore + 1, 'Exactly one systemd restart into independently retained rescue');
      assert.ok(readFileSync(join(data, 'work/logs/coordinator.log'), 'utf8').includes('fixture-installed-bootstrap-failure'));
      const rescuePid = Number(execute('/usr/bin/systemctl', ['show', '--property=MainPID', '--value', unitName]).trim());
      assert.equal(readlinkSync(`/proc/${rescuePid}/cwd`), incumbentBoot);
      assert.ok(readFileSync(`/proc/${rescuePid}/cmdline`, 'utf8').split('\0').includes('payload/deployment/bootstrap-evolution.ts'));
      assert.ok(readFileSync(`/proc/${rescuePid}/cmdline`, 'utf8').endsWith('rescue\0'));
      for (const pid of [rescuePid, recovered.coordinator.processId, recovered.processId]) assert.equal(readlinkSync(`/proc/${pid}/exe`), join(incumbentBoot, 'node'));
      assert.equal(readFileSync(join(cgroupRoot, 'cgroup.procs'), 'utf8').trim(), '');
      assert.ok(readFileSync(join(cgroupRoot, 'host/cgroup.procs'), 'utf8').trim().split('\n').includes(String(rescuePid)));
      withStore(restored => { assert.deepEqual(restored.get('fixture.current-state', 'latest'), latest); assert.equal(restored.list('requests').length, 0); });
      t.diagnostic(JSON.stringify({ kind: 'installed-succession-offline-rescue-engineering', incumbent: candidate.manifest.id, successor: successor.manifest.id, brokenBootstrap: broken.manifest.id,
        epochs: [first, second, successorRunning, successorBooted, brokenRunning, recovered].map(value => value.ready.authority.epoch), restartsBefore, restartsAfter,
        hostDataUsage: execute('/usr/bin/df', ['-B1', join(data, 'work')]).trim(), providerEnvironmentEntries: 0, liveProviderRequests: 0, externalMessages: 0 }));
    }
    t.diagnostic(JSON.stringify({ kind: 'installed-engineering-fixture', candidateId: candidate.manifest.id, firstEpoch: first.ready.authority.epoch, secondEpoch: second.ready.authority.epoch, liveProviderRequests: 0, externalMessages: 0 }));
    stopInstallation(installation, true); installed = false;
    assert.ok(existsSync(join(data, 'workspace.ext4')), 'Uninstall preserves the complete bounded data image');
    assert.ok(existsSync(join(installation.workspaceProvisionDirectory, 'workspace.ext4')), 'Uninstall preserves the complete workspace image');
  } catch (error) {
    t.diagnostic(`Installed rehearsal primary failure: ${error instanceof Error ? error.stack : String(error)}`);
    throw error;
  } finally {
    // Explicit out-of-source traces survive even when a failed rehearsal is cleaned up.
    const logDirectory = process.env.AEON_FIXTURE_LOG_DIRECTORY;
    if (logDirectory && existsSync(join(data, 'work/logs/coordinator.log'))) {
      assert.ok(logDirectory.startsWith('/') && !logDirectory.startsWith(repository + '/') && !logDirectory.startsWith(root + '/'), 'Fixture logs must remain outside frozen source and temporary cleanup');
      mkdirSync(logDirectory, { recursive: true });
      cpSync(join(data, 'work/logs/coordinator.log'), join(logDirectory, `${unitName}.coordinator.log`));
      writeFileSync(join(logDirectory, `${unitName}.systemd.txt`), soft('/usr/bin/systemctl', ['show', unitName, '--property=MainPID,ActiveState,SubState,Result,NRestarts']));
    }
    if (installation) {
      if (installed) { try { stopInstallation(installation, true); installed = false; } catch {} }
      // Failure cleanup is restricted to this random fixture's exact rendered unit bytes.
      const rendered = renderInstallation(installation);
      for (const name of [unitName, mountUnitName(installation), hostDataMountUnitName(installation)]) soft('/usr/bin/systemctl', ['stop', name]);
      for (const [name, content] of Object.entries(rendered)) {
        const path = join('/etc/systemd/system', name === 'installation.json' ? `${unitName}.installation.json` : name);
        if (existsSync(path) && readFileSync(path, 'utf8') === content) rmSync(path);
      }
      soft('/usr/bin/systemctl', ['daemon-reload']); soft('/usr/bin/systemctl', ['reset-failed', unitName]);
      soft('/usr/bin/umount', [workspacePath(installation)]);
    }
    // A just-stopped process may still release its final executable/cwd reference.
    for (let attempt = 0; attempt < 20; attempt++) {
      soft('/usr/bin/umount', [join(data, 'work')]);
      if (!readFileSync('/proc/self/mountinfo', 'utf8').split('\n').some(line => line.split(' ')[4]?.startsWith(root + '/'))) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const mounted = readFileSync('/proc/self/mountinfo', 'utf8').split('\n').some(line => line.split(' ')[4]?.startsWith(root + '/'));
    assert.equal(mounted, false, 'Never remove a still-mounted fixture');
    rmSync(root, { recursive: true, force: true });
  }
});
