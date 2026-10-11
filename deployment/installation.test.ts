import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { freezeCandidate, hashBytes } from '../packages/release/artifacts.ts';
import { checkInstallation, checkWorkspace, mountUnitName, renderInstallation, stopInstallation, validateEnvironmentFile, validateInstallation, workspacePath, writeInstallationBundle, type Installation } from './installation.ts';

const specification = (): Installation => ({ unitName: 'aeon-installation-test.service', uid: process.getuid!(), gid: process.getgid!(), nodeBinary: process.execPath,
  artifactStore: '/var/lib/aeon/artifacts', stateDirectory: '/var/lib/aeon/state', coordinatorCandidateId: 'a'.repeat(64), hostConfigFile: '/etc/aeon/host.json', environmentFile: '/etc/aeon/secrets.env',
  workspaceProvisionDirectory: '/var/lib/aeon/workspace', workspaceBytes: 16777216, workspaceInodes: 128, outerMemoryBytes: 1073741824, outerTasks: 128, outerCpuPercent: 200 });

test('renders a complete systemd-verifiable new installation with a persistent ordered mount', () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-install-render-'));
  try {
    const input = specification(), output = join(root, 'review'); writeInstallationBundle(input, output);
    const units = renderInstallation(input), mount = mountUnitName(input);
    execFileSync('/usr/bin/systemd-analyze', ['verify', join(output, input.unitName), join(output, mount)], { stdio: 'pipe' });
    assert.equal(readFileSync(join(output, input.unitName), 'utf8'), units[input.unitName]);
    assert.match(units[input.unitName]!, /Delegate=cpu memory pids\nMemoryMax=1073741824\nMemorySwapMax=0\nTasksMax=128\nCPUQuota=200%/);
    assert.match(units[input.unitName]!, /KillMode=control-group/);
    assert.ok(units[input.unitName]!.includes(`Requires=${mount}\nAfter=${mount}`));
    assert.ok(units[input.unitName]!.includes(`/artifacts/${input.coordinatorCandidateId}/payload/deployment/cli.ts supervise`));
    assert.ok(units[input.unitName]!.includes(`ReadWritePaths=${input.stateDirectory} ${input.artifactStore} ${workspacePath(input)}`));
    assert.match(units[mount]!, /Type=ext4\nOptions=loop,nodev,nosuid/);
    assert.deepEqual(JSON.parse(readFileSync(join(output, 'installation.json'), 'utf8')), input);
    assert.throws(() => writeInstallationBundle({ ...input, outerTasks: 256 }, output), /EEXIST/);
    assert.equal(readFileSync(join(output, input.unitName), 'utf8'), units[input.unitName]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('mount names match systemd path escaping, including hyphens and leading dots', () => {
  for (const directory of ['/var/lib/aeon-new/workspace', '/.aeon/root-dir/.nested']) {
    const input = { ...specification(), workspaceProvisionDirectory: directory };
    assert.equal(mountUnitName(input), execFileSync('/usr/bin/systemd-escape', ['--path', '--suffix=mount', workspacePath(input)], { encoding: 'utf8' }).trim());
  }
});

test('refuses legacy names, extra fields, unbounded profiles, overlap and all unit/command injection inputs', () => {
  for (const unitName of ['palimpsest.service', 'aeon.service', 'aeon-good.service\nExecStart=/bin/evil', 'aeon-%i.service', '../aeon-good.service']) assert.throws(() => renderInstallation({ ...specification(), unitName }));
  for (const path of ['/tmp/with space', '/tmp/%h', '/tmp/$VARIABLE', '/tmp/$(id)', '/tmp/line\nnew', '/tmp/a\\b', '/tmp/a/../b', '/tmp//b', '/', 'relative']) {
    for (const key of ['nodeBinary', 'artifactStore', 'stateDirectory', 'hostConfigFile', 'environmentFile', 'workspaceProvisionDirectory'] as const) assert.throws(() => renderInstallation({ ...specification(), [key]: path }));
  }
  assert.throws(() => validateInstallation({ ...specification(), extra: true } as Installation));
  for (const key of ['uid', 'gid', 'workspaceBytes', 'workspaceInodes', 'outerMemoryBytes', 'outerTasks', 'outerCpuPercent'] as const) for (const value of [0, -1, Infinity, NaN, 1.5]) assert.throws(() => renderInstallation({ ...specification(), [key]: value }));
  assert.throws(() => renderInstallation({ ...specification(), hostConfigFile: '/var/lib/aeon/state/host.json' }), /disjoint/);
});

test('private environment accepts only explicit secret assignments and prevents runtime option injection', () => {
  const required = 'MISTRAL_API_KEY=private-fixture\nAUTARK_DIRECT_TOKEN=fixture-token\n';
  validateEnvironmentFile(Buffer.from(required + 'SLACK_BOT_TOKEN=xoxb-123\nSLACK_APP_TOKEN=xapp-123\n'));
  for (const extra of ['NODE_OPTIONS=--import=/tmp/code\n', 'PATH=/tmp\n', 'MISTRAL_API_KEY=duplicate\n', 'SLACK_BOT_TOKEN="quoted"\n', 'SLACK_BOT_TOKEN=$(id)\n', 'SLACK_BOT_TOKEN=value value\n']) assert.throws(() => validateEnvironmentFile(Buffer.from(required + extra)));
  assert.throws(() => validateEnvironmentFile(Buffer.from('MISTRAL_API_KEY=fixture\n')), /AUTARK_DIRECT_TOKEN/);
});

test('preflight rehashes coordinator/runtime and rejects a mismatched frozen capacity before delegation', () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-install-preflight-'));
  try {
    const source = join(root, 'source'); mkdirSync(join(source, 'deployment'), { recursive: true, mode: 0o700 });
    // Preflight-only payload. It is never executed or admitted as an application.
    for (const path of ['deployment/cli.ts', 'deployment/installation.ts', 'package-lock.json']) writeFileSync(join(source, path), 'fixture', { mode: 0o600 });
    const value = { ...specification(), artifactStore: join(root, 'artifacts'), stateDirectory: join(root, 'state'), hostConfigFile: join(root, 'host.json'), environmentFile: join(root, 'private.env'), workspaceProvisionDirectory: join(root, 'bounded-workspace') };
    for (const path of [value.artifactStore, value.stateDirectory, join(root, 'evidence')]) mkdirSync(path, { mode: 0o700 });
    const files = ['deployment/cli.ts', 'deployment/installation.ts', 'package-lock.json'].map(path => ({ path, sha256: hashBytes('fixture') }));
    const runtime = { nodeVersion: process.version, nodeSha256: hashBytes(readFileSync(process.execPath)), platform: process.platform, arch: process.arch };
    const inputs = { createdBy: 'preflight-fixture', prompts: {}, model: {}, configuration: { resourceLimits: { workspaceBytes: value.workspaceBytes * 2, workspaceInodes: value.workspaceInodes } },
      controls: { classifier: 'host-execution-closure-v1', files, runtime, policy: {} },
      dependencies: { installedRuntime: [], lockfile: hashBytes('fixture'), retainedForks: [], checkBuildToolchain: [], runtime } };
    const candidate = freezeCandidate(source, value.artifactStore, ['deployment', 'package-lock.json'], inputs);
    value.coordinatorCandidateId = candidate.manifest.id;
    writeFileSync(value.hostConfigFile, JSON.stringify({ host: { stateDirectory: value.stateDirectory, artifactStore: value.artifactStore, nodeBinary: value.nodeBinary, workspaceDirectory: workspacePath(value), cgroupRoot: `/sys/fs/cgroup/system.slice/${value.unitName}` }, mode: 'engineering', evidenceDirectory: join(root, 'evidence'), policyFiles: [] }), { mode: 0o600 });
    assert.throws(() => checkInstallation(value, 'service', false), /profile must match provisioned capacity/);
    const wrongRuntime = freezeCandidate(source, value.artifactStore, ['deployment', 'package-lock.json'], { ...inputs, controls: { ...inputs.controls, runtime: { ...runtime, nodeSha256: '0'.repeat(64) } } });
    assert.throws(() => checkInstallation({ ...value, coordinatorCandidateId: wrongRuntime.manifest.id }, 'service', false), /Pinned runtime changed/);
    const path = join(value.artifactStore, candidate.manifest.id, 'payload/deployment/cli.ts'); chmodSync(path, 0o600); writeFileSync(path, 'changed');
    assert.throws(() => checkInstallation(value, 'service', false), /payload changed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('read-only workspace preflight refuses an ordinary host filesystem without deleting lived data', () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-install-ordinary-'));
  try {
    mkdirSync(join(root, 'work')); writeFileSync(join(root, 'work', 'lived'), 'keep me');
    assert.throws(() => checkWorkspace({ ...specification(), workspaceProvisionDirectory: root }), /Root-owned/);
    assert.equal(readFileSync(join(root, 'work', 'lived'), 'utf8'), 'keep me');
    if (process.getuid!() !== 0) assert.throws(() => stopInstallation(specification(), true), /Administrator/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('administrator-provisioned real workspace retains its marker and matches its exact bounded backing image', { skip: !process.env.AEON_INSTALLATION_WORKSPACE }, () => {
  const directory = process.env.AEON_INSTALLATION_WORKSPACE!;
  const input = { ...specification(), workspaceProvisionDirectory: directory };
  checkWorkspace(input);
  const marker = join(workspacePath(input), 'installation-retention-marker');
  if (existsSync(marker)) assert.equal(readFileSync(marker, 'utf8'), 'retained through unmount/remount');
  else writeFileSync(marker, 'retained through unmount/remount', { flag: 'wx', mode: 0o600 });
  assert.throws(() => checkWorkspace({ ...input, workspaceBytes: input.workspaceBytes * 2 }), /never resize or truncate/);
  assert.equal(readFileSync(marker, 'utf8'), 'retained through unmount/remount');
});
