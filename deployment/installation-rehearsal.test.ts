import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, chownSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { ArtifactRef, Authority, EvaluationEvidence } from '../packages/contracts/index.ts';
import { admissionPolicyIdentity, signEvaluation } from '../packages/release/admission.ts';
import { hashBytes } from '../packages/release/artifacts.ts';
import { policyDescriptor, type ReleaseProof } from '../packages/release/controller.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { freezeApplication, type DeploymentInputs } from './candidate.ts';
import { requestControl, type SupervisorFile } from './cli.ts';
import { applyInstallation, hostDataMountUnitName, mountUnitName, renderInstallation, stopInstallation, workspacePath, writeInstallationBundle, type Installation } from './installation.ts';
import { rewriteSourceEntries } from './source-workspace.ts';

/** Opt-in only: actual temporary installed units, bounded loop volumes and service UID.
 * Never uses real provider credentials, Slack, existing service state or product evidence.
 */
test('complete disposable installation boots the ordinary application and retains current state across restart', {
  skip: process.env.AEON_INSTALLATION_REHEARSAL !== '1', timeout: 180000,
}, async t => {
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
    const authority: Authority = { generation: 'installation-author', epoch: 1, controlRevision: candidate.manifest.controls };
    const observed = blob('Synthetic bootstrap admission for mechanical installation checks only.');
    const evidence: EvaluationEvidence = { id: 'installation-fixture', candidateId: candidate.manifest.id, controlRevision: authority.controlRevision, evaluatorId: 'installation-fixture', evaluatorArtifact: evaluator, independent: true,
      verdict: 'pass', artifact: observed, caseResults: [{ id: 'installed-lifecycle', status: 'pass', observations: observed, usage: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 }, interventions: ['Synthetic bootstrap proof; not live evaluation.'] }] };
    const proof: ReleaseProof = { proposal: { id: 'installation-bootstrap', candidate: candidate.manifest, priorAuthority: authority, evidence: [evidence], recoveryArtifact: blob(readFileSync(join(artifacts, candidate.manifest.id, 'candidate.json'))) }, signed: [signEvaluation(evidence, key, policy.policyDigest)] };
    const keyFile = join(privateRoot, 'key'), policyFile = join(privateRoot, 'policy.json'), proofFile = join(privateRoot, 'proof.json'), hostConfigFile = join(privateRoot, 'host.json'), environmentFile = join(root, 'environment');
    privateWrite(keyFile, key); privateWrite(policyFile, JSON.stringify({ controlRevision: policy.controlRevision, policyDigest: policy.policyDigest, descriptor: policyDescriptor(policy), keyFiles: [['installation-fixture', keyFile]] }));
    privateWrite(proofFile, JSON.stringify(proof));
    installation = { unitName, uid, gid, nodeBinary: process.execPath, artifactStore: artifacts, stateDirectory: state, hostDataProvisionDirectory: data, hostDataBytes: 1024 * 1024 * 1024, hostDataInodes: 32768,
      coordinatorCandidateId: candidate.manifest.id, hostConfigFile, environmentFile, workspaceProvisionDirectory: join(root, 'workspace'), workspaceBytes, workspaceInodes, outerMemoryBytes: 2 * 1024 * 1024 * 1024, outerTasks: 256, outerCpuPercent: 200 };
    const config: SupervisorFile = { host: { stateDirectory: state, workspaceDirectory: workspacePath(installation), artifactStore: artifacts, nodeBinary: process.execPath, cgroupRoot }, mode: 'engineering', evidenceDirectory,
      policyFiles: [[policy.policyDigest, policyFile]], bootstrap: { proofFile, policyDigest: policy.policyDigest }, allowedModelProfiles: [inputs.configuration.model] };
    privateWrite(hostConfigFile, JSON.stringify(config));
    writeFileSync(environmentFile, 'MISTRAL_API_KEY=fixture-no-provider\nAUTARK_DIRECT_TOKEN=fixture-direct-token\n', { mode: 0o600 });
    const bundle = join(root, 'bundle'); writeInstallationBundle(installation, bundle); applyInstallation(installation, bundle); installed = true;
    execute('/usr/bin/systemctl', ['start', unitName]);
    const ready = async (): Promise<any> => {
      const deadline = Date.now() + 35000;
      while (Date.now() < deadline) {
        try { const value = await requestControl(state, { kind: 'status' }) as any; if (value.running && value.ready) return value; } catch {}
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error(`Installed fixture not ready: ${readFileSync(join(data, 'work/logs/coordinator.log'), 'utf8').slice(-16000)}`);
    };
    const first = await ready();
    const response = await fetch(`http://127.0.0.1:${first.ready.address.port}/health`, { headers: { authorization: 'Bearer fixture-direct-token' } });
    assert.equal(response.status, 200); assert.equal((await response.json() as { alive: boolean }).alive, true);
    const store = new OperationalStore({ filename: join(state, 'operational.sqlite') });
    store.put('fixture.current-state', 'latest', { experience: 'retained', uncertainEffect: 'unresolved fixture marker' }, null); store.close();
    stopInstallation(installation);
    execute('/usr/bin/systemctl', ['start', unitName]);
    const second = await ready(); assert.ok(second.ready.authority.epoch > first.ready.authority.epoch);
    const reopened = new OperationalStore({ filename: join(state, 'operational.sqlite') });
    assert.deepEqual(reopened.get('fixture.current-state', 'latest')!.value, { experience: 'retained', uncertainEffect: 'unresolved fixture marker' });
    assert.equal(reopened.list('requests').length, 0, 'No physical model/tool request is authorized in this lifecycle fixture'); reopened.close();
    t.diagnostic(JSON.stringify({ kind: 'installed-engineering-fixture', candidateId: candidate.manifest.id, firstEpoch: first.ready.authority.epoch, secondEpoch: second.ready.authority.epoch, liveProviderRequests: 0, externalMessages: 0 }));
    stopInstallation(installation, true); installed = false;
    assert.ok(existsSync(join(data, 'workspace.ext4')), 'Uninstall preserves the complete bounded data image');
    assert.ok(existsSync(join(installation.workspaceProvisionDirectory, 'workspace.ext4')), 'Uninstall preserves the complete workspace image');
  } finally {
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
    soft('/usr/bin/umount', [join(data, 'work')]);
    const mounted = readFileSync('/proc/self/mountinfo', 'utf8').split('\n').some(line => line.split(' ')[4]?.startsWith(root + '/'));
    assert.equal(mounted, false, 'Never remove a still-mounted fixture');
    rmSync(root, { recursive: true, force: true });
  }
});
