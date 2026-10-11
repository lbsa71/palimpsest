import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { invariant } from '../packages/contracts/index.ts';
import { verifyApplication, type DeploymentInputs } from './candidate.ts';
import { beneath, environmentSecrets, selectedProviderKey } from './config.ts';
import type { SupervisorFile } from './cli.ts';

/** Operator input, outside all candidate workspaces. No credentials are placed here. */
export interface Installation {
  unitName: string;
  uid: number;
  gid: number;
  nodeBinary: string;
  artifactStore: string;
  stateDirectory: string;
  hostDataProvisionDirectory: string;
  hostDataBytes: number;
  hostDataInodes: number;
  coordinatorCandidateId: string;
  hostConfigFile: string;
  environmentFile: string;
  workspaceProvisionDirectory: string;
  workspaceBytes: number;
  workspaceInodes: number;
  outerMemoryBytes: number;
  outerTasks: number;
  outerCpuPercent: number;
}
const fields = 'artifactStore,coordinatorCandidateId,environmentFile,gid,hostConfigFile,hostDataBytes,hostDataInodes,hostDataProvisionDirectory,nodeBinary,outerCpuPercent,outerMemoryBytes,outerTasks,stateDirectory,uid,unitName,workspaceBytes,workspaceInodes,workspaceProvisionDirectory';
const run = (command: string, args: string[]) => execFileSync(command, args, { encoding: 'utf8', env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
function safePath(path: string): void {
  // Reject unit specifiers, environment expansion, whitespace, escapes and shell metacharacters.
  invariant(typeof path === 'string' && /^\/[A-Za-z0-9_./-]+$/.test(path) && path !== '/' && resolve(path) === path && !path.split('/').some(part => part === '.' || part === '..'), 'Ordinary canonical absolute installation path required');
}
export function validateInstallation(value: Installation): Installation {
  invariant(value && Object.keys(value).sort().join(',') === fields, 'Exact installation fields required');
  invariant(/^aeon-[a-z0-9]+(?:-[a-z0-9]+)*\.service$/.test(value.unitName) && value.unitName.length <= 120, 'Explicit new aeon-* service name required');
  invariant(/^[a-f0-9]{64}$/.test(value.coordinatorCandidateId), 'Exact frozen coordinator candidate required');
  for (const key of ['nodeBinary', 'artifactStore', 'stateDirectory', 'hostDataProvisionDirectory', 'hostConfigFile', 'environmentFile', 'workspaceProvisionDirectory'] as const) safePath(value[key]);
  for (const key of ['uid', 'gid', 'hostDataBytes', 'hostDataInodes', 'workspaceBytes', 'workspaceInodes', 'outerMemoryBytes', 'outerTasks', 'outerCpuPercent'] as const) invariant(Number.isSafeInteger(value[key]) && value[key] > 0, 'Finite positive installation ceilings and UID/GID required');
  invariant(value.uid <= 2147483647 && value.gid <= 2147483647 && value.workspaceBytes >= 16 * 1024 * 1024 && value.workspaceBytes <= 16 * 1024 * 1024 * 1024 && value.workspaceBytes % 4096 === 0 && value.workspaceInodes >= 128 && value.workspaceInodes <= 1000000, 'Explicit supported fixed workspace capacity required');
  invariant(value.hostDataBytes >= 16 * 1024 * 1024 && value.hostDataBytes <= 16 * 1024 * 1024 * 1024 && value.hostDataBytes % 4096 === 0 && value.hostDataInodes >= 128 && value.hostDataInodes <= 1000000, 'Explicit supported fixed host-data capacity required');
  invariant(value.stateDirectory === join(hostDataPath(value), 'state') && value.artifactStore === join(hostDataPath(value), 'artifacts'), 'State and artifacts must occupy the exact bounded host-data layout');
  invariant(value.outerMemoryBytes >= 64 * 1024 * 1024 && value.outerTasks >= 16 && value.outerCpuPercent <= 100000, 'Outer service ceilings cannot launch the host');
  invariant(mountUnitName(value).length <= 255 && hostDataMountUnitName(value).length <= 255, 'Workspace mount unit name exceeds systemd limit');
  const paths = [value.nodeBinary, value.artifactStore, value.stateDirectory, value.hostConfigFile, value.environmentFile, value.workspaceProvisionDirectory];
  for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) invariant(!beneath(paths[i]!, paths[j]!) && !beneath(paths[j]!, paths[i]!), 'Installation bindings must be disjoint');
  for (const path of [value.nodeBinary, value.hostConfigFile, value.environmentFile, value.workspaceProvisionDirectory]) invariant(!beneath(value.hostDataProvisionDirectory, path) && !beneath(path, value.hostDataProvisionDirectory), 'Host data must remain disjoint from runtime, secrets, configuration and workspace');
  return structuredClone(value);
}
export function workspacePath(value: Installation): string { return join(value.workspaceProvisionDirectory, 'work'); }
export function hostDataPath(value: Installation): string { return join(value.hostDataProvisionDirectory, 'work'); }
function escapeMountPath(path: string): string {
  // systemd path escaping for the deliberately limited safePath alphabet.
  return path.slice(1).replace(/-/g, '\\x2d').replace(/^\./, '\\x2e').replace(/\//g, '-') + '.mount';
}
export function mountUnitName(value: Installation): string { return escapeMountPath(workspacePath(value)); }
export function hostDataMountUnitName(value: Installation): string { return escapeMountPath(hostDataPath(value)); }
const installedManifest = (value: Installation) => `/etc/systemd/system/${value.unitName}.installation.json`;
const payloadPath = (value: Installation) => join(value.artifactStore, value.coordinatorCandidateId, 'payload');
export function renderInstallation(input: Installation): Record<string, string> {
  const value = validateInstallation(input), mount = mountUnitName(value), dataMount = hostDataMountUnitName(value), payload = payloadPath(value);
  return {
    [value.unitName]: `[Unit]\nDescription=Aeon frozen coordinator ${value.coordinatorCandidateId}\nRequires=${mount} ${dataMount}\nAfter=${mount} ${dataMount} network-online.target\nWants=network-online.target\nBindsTo=${mount} ${dataMount}\nRequiresMountsFor=${value.stateDirectory} ${value.artifactStore}\nStartLimitIntervalSec=300\nStartLimitBurst=3\n\n[Service]\nType=exec\nUser=${value.uid}\nGroup=${value.gid}\nSlice=system.slice\nWorkingDirectory=${payload}\nEnvironmentFile=${value.environmentFile}\nEnvironment=PATH=/usr/bin:/bin\nUMask=0077\nExecStartPre=${value.nodeBinary} ${payload}/deployment/installation.ts check-service ${installedManifest(value)}\nExecStart=${value.nodeBinary} ${payload}/deployment/cli.ts launch ${value.hostConfigFile}\nDelegate=cpu memory pids\nMemoryMax=${value.outerMemoryBytes}\nMemorySwapMax=0\nTasksMax=${value.outerTasks}\nCPUQuota=${value.outerCpuPercent}%\nKillMode=control-group\nLimitCORE=0\nTimeoutStopSec=45\nSendSIGKILL=yes\nRestart=on-failure\nRestartSec=10\nNoNewPrivileges=yes\nProtectSystem=strict\nProtectHome=read-only\nReadWritePaths=${value.stateDirectory} ${value.artifactStore} ${join(hostDataPath(value), 'logs')} ${workspacePath(value)}\nProtectControlGroups=no\nStandardOutput=append:${join(hostDataPath(value), 'logs/coordinator.log')}\nStandardError=append:${join(hostDataPath(value), 'logs/coordinator.log')}\n\n[Install]\nWantedBy=multi-user.target\n`,
    [mount]: `[Unit]\nDescription=Aeon fixed persistent workspace\nBefore=${value.unitName}\nRequiresMountsFor=${value.workspaceProvisionDirectory}\n\n[Mount]\nWhat=${join(value.workspaceProvisionDirectory, 'workspace.ext4')}\nWhere=${workspacePath(value)}\nType=ext4\nOptions=loop,nodev,nosuid\nTimeoutSec=30\n`,
    [dataMount]: `[Unit]\nDescription=Aeon fixed persistent host data\nBefore=${value.unitName}\nRequiresMountsFor=${value.hostDataProvisionDirectory}\n\n[Mount]\nWhat=${join(value.hostDataProvisionDirectory, 'workspace.ext4')}\nWhere=${hostDataPath(value)}\nType=ext4\nOptions=loop,nodev,nosuid\nTimeoutSec=30\n`,
    'installation.json': JSON.stringify(value, null, 2) + '\n',
  };
}
function canonical(path: string): void { safePath(path); invariant(realpathSync(path) === path, 'Installation paths must not traverse symlinks'); }
function privateFile(path: string, uid: number): Buffer {
  canonical(path); const stat = lstatSync(path);
  invariant(stat.isFile() && stat.nlink === 1 && stat.uid === uid && (stat.mode & 0o077) === 0, 'Private singly linked owner file required');
  return readFileSync(path);
}
function privateDirectory(path: string, uid: number): void {
  canonical(path); const stat = lstatSync(path);
  invariant(stat.isDirectory() && stat.uid === uid && (stat.mode & 0o077) === 0, 'Private service-owned directory required');
}
/** Match the launcher's durable boot selection without creating a journal or granting authority. */
function selectedProviderCandidate(value: Installation): string {
  const read = (name: string, table: 'selection' | 'release_state'): Record<string, unknown> | undefined => {
    const path = join(value.stateDirectory, name); if (!existsSync(path)) return;
    canonical(path); const stat = lstatSync(path);
    invariant(stat.isFile() && stat.uid === value.uid && stat.nlink === 1 && (stat.mode & 0o077) === 0, 'Private boot-selection journal required');
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      // A crash before first schema creation is recoverable by the actual launcher/controller.
      if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) return;
      const row = db.prepare(`SELECT value FROM ${table} WHERE singleton=1`).get(); return row ? JSON.parse(String(row.value)) : undefined;
    }
    finally { db.close(); }
  };
  const selection = read('host-successor.sqlite', 'selection');
  if (!selection) return value.coordinatorCandidateId;
  invariant(['ready', 'requested', 'booting', 'rescue'].includes(String(selection.phase)), 'Known boot selection phase required');
  let target = (selection.phase === 'booting' ? selection.rescue : selection.selected) as { candidateId?: unknown };
  if (selection.phase === 'ready') {
    const release = read('release.sqlite', 'release_state');
    if (release?.phase === 'accepted') target = release.accepted as { candidateId?: unknown };
  }
  invariant(target && typeof target.candidateId === 'string' && /^[a-f0-9]{64}$/.test(target.candidateId), 'Exact selected boot candidate required');
  return target.candidateId;
}
export function validateEnvironmentFile(bytes: Buffer): NodeJS.ProcessEnv {
  const text = bytes.toString('utf8'), secrets: NodeJS.ProcessEnv = {};
  const allowed = new Set(['MISTRAL_API_KEY', 'OPENAI_API_KEY', 'AUTARK_DIRECT_TOKEN', 'SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN']);
  invariant(Buffer.from(text).equals(bytes), 'UTF-8 environment file required');
  for (const line of text.split('\n')) {
    if (!line) continue;
    const match = /^([A-Z_]+)=([A-Za-z0-9._:/+=-]+)$/.exec(line);
    invariant(match && allowed.has(match[1]!) && secrets[match[1]!] === undefined, 'Only explicit unquoted secret assignments are accepted');
    secrets[match[1]!] = match[2]!;
  }
  invariant(secrets.AUTARK_DIRECT_TOKEN && (secrets.MISTRAL_API_KEY || secrets.OPENAI_API_KEY), 'AUTARK_DIRECT_TOKEN and one explicit provider key required');
  return secrets;
}
/** Read-only preflight. The supervisor separately probes actual delegated leaf limits after its lease. */
export function checkInstallation(input: Installation, context: 'admin' | 'service', mounted = true): SupervisorFile {
  const value = validateInstallation(input);
  invariant(process.platform === 'linux', 'Linux installation required');
  if (context === 'admin') invariant(process.getuid?.() === 0, 'Administrator operation required');
  for (const executable of [value.nodeBinary, '/usr/bin/bwrap', '/usr/bin/setpriv', '/usr/bin/prlimit', '/usr/bin/findmnt', '/usr/bin/systemctl']) { canonical(executable); accessSync(executable, constants.X_OK); }
  invariant(/^v24\.\d+\.\d+$/.test(run(value.nodeBinary, ['--version']).trim()), 'Pinned Node 24 executable required');
  for (const executable of ['/usr/bin/bwrap', '/usr/bin/setpriv', '/usr/bin/prlimit']) run(executable, ['--version']);
  if (mounted) checkHostData(value);
  const candidate = verifyApplication(value.artifactStore, value.coordinatorCandidateId, value.nodeBinary);
  const runtime = (candidate.inputs.controls as unknown as { runtime: DeploymentInputs['runtime'] }).runtime;
  invariant(run(value.nodeBinary, ['--version']).trim() === runtime.nodeVersion, 'Pinned Node version differs from frozen coordinator');
  invariant(candidate.files.some(file => file.path === 'deployment/installation.ts') && candidate.files.some(file => file.path === 'deployment/cli.ts') && candidate.files.some(file => file.path === 'deployment/host-successor.ts'), 'Frozen coordinator must include installation, CLI and host-launcher entrypoints');
  const config = JSON.parse(privateFile(value.hostConfigFile, value.uid).toString('utf8')) as SupervisorFile;
  invariant(Object.keys(config).sort().join(',') === (config.bootstrap ? 'bootstrap,evidenceDirectory,host,mode,policyFiles' : 'evidenceDirectory,host,mode,policyFiles') && ['product', 'engineering'].includes(config.mode), 'Exact supervisor configuration required');
  invariant(config.host.stateDirectory === value.stateDirectory && config.host.artifactStore === value.artifactStore && config.host.nodeBinary === value.nodeBinary && config.host.workspaceDirectory === workspacePath(value) && config.host.cgroupRoot === `/sys/fs/cgroup/system.slice/${value.unitName}`, 'Host bindings must match installed resources and delegated unit');
  invariant(Object.keys(config.host).sort().join(',') === 'artifactStore,cgroupRoot,nodeBinary,stateDirectory,workspaceDirectory', 'Exact installed host bindings required');
  privateDirectory(config.host.stateDirectory, value.uid); privateDirectory(value.artifactStore, value.uid); safePath(config.evidenceDirectory);
  invariant(config.evidenceDirectory === join(hostDataPath(value), 'evidence'), 'Evidence must occupy the exact bounded host-data layout');
  if (existsSync(config.evidenceDirectory)) privateDirectory(config.evidenceDirectory, value.uid);
  for (const a of [config.host.stateDirectory, config.evidenceDirectory, value.artifactStore, value.workspaceProvisionDirectory]) for (const b of [config.host.stateDirectory, config.evidenceDirectory, value.artifactStore, value.workspaceProvisionDirectory]) if (a !== b) invariant(!beneath(a, b), 'State, evidence, artifacts and workspace must be disjoint');
  invariant(new Set([config.host.stateDirectory, config.evidenceDirectory, value.artifactStore, value.workspaceProvisionDirectory]).size === 4, 'Distinct state, evidence, artifacts and workspace required');
  for (const path of [value.hostConfigFile, value.environmentFile]) for (const root of [value.hostDataProvisionDirectory, value.workspaceProvisionDirectory]) invariant(!beneath(root, path), 'Configuration and secrets must be outside writable data roots');
  const profile = (candidate.inputs.configuration as unknown as DeploymentInputs['configuration']).resourceLimits;
  invariant(profile && profile.workspaceBytes === value.workspaceBytes && profile.workspaceInodes === value.workspaceInodes, 'Frozen resource profile must match provisioned capacity');
  invariant(Array.isArray(config.policyFiles) && config.policyFiles.every(pair => Array.isArray(pair) && pair.length === 2 && pair.every(part => typeof part === 'string')), 'Exact policy registry required');
  // Missing bootstrap/evaluator inputs are allowed on accepted recovery; admission itself verifies them when needed.
  for (const [, path] of config.policyFiles) { safePath(path); for (const root of [value.hostDataProvisionDirectory, value.workspaceProvisionDirectory]) invariant(!beneath(root, path), 'Policies must remain outside model roots'); }
  const controllers = readFileSync('/sys/fs/cgroup/cgroup.controllers', 'utf8').split(/\s+/);
  invariant(['cpu', 'memory', 'pids'].every(controller => controllers.includes(controller)), 'Linux cgroup v2 cpu/memory/pids controllers required');
  const secrets = environmentSecrets(context === 'admin' ? validateEnvironmentFile(privateFile(value.environmentFile, 0)) : process.env);
  const selected = selectedProviderCandidate(value);
  const selectedCandidate = selected === value.coordinatorCandidateId ? candidate : verifyApplication(value.artifactStore, selected, value.nodeBinary);
  selectedProviderKey((selectedCandidate.inputs.configuration as unknown as DeploymentInputs['configuration']).model, secrets);
  if (context === 'admin') invariant(process.getuid?.() === 0, 'Administrator operation required');
  else {
    invariant(process.getuid?.() === value.uid && process.getgid?.() === value.gid, 'Configured service UID/GID required');
    canonical(config.host.cgroupRoot!); const stat = lstatSync(config.host.cgroupRoot!);
    invariant(stat.uid === value.uid && readFileSync('/proc/self/cgroup', 'utf8').trim() === '0::' + config.host.cgroupRoot!.slice('/sys/fs/cgroup'.length), 'Service must begin inside its owned delegation');
    const available = readFileSync(join(config.host.cgroupRoot!, 'cgroup.controllers'), 'utf8').split(/\s+/);
    invariant(['cpu', 'memory', 'pids'].every(controller => available.includes(controller)), 'Service controllers unavailable');
    accessSync(join(config.host.cgroupRoot!, 'cgroup.procs'), constants.W_OK); accessSync(join(config.host.cgroupRoot!, 'cgroup.subtree_control'), constants.W_OK);
    run('/usr/bin/bwrap', ['--unshare-all', '--die-with-parent', '--new-session', '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64', '--proc', '/proc', '--dev', '/dev', '--', '/usr/bin/true']);
  }
  if (mounted) checkWorkspace(value);
  return config;
}
function checkVolumeImage(directory: string, bytes: number): string {
  canonical(directory); const layout = lstatSync(directory);
  invariant(layout.isDirectory() && layout.uid === 0 && (layout.mode & 0o022) === 0, 'Root-owned fixed workspace layout required');
  const image = join(directory, 'workspace.ext4'); canonical(image); const stat = lstatSync(image);
  invariant(stat.isFile() && stat.nlink === 1 && stat.uid === 0 && (stat.mode & 0o077) === 0 && stat.size === bytes, 'Existing workspace image differs; never resize or truncate it');
  canonical(join(directory, 'work')); invariant(lstatSync(join(directory, 'work')).isDirectory(), 'Ordinary workspace mountpoint required');
  return image;
}
function checkVolumeMount(directory: string, bytes: number, inodes: number, uid: number): void {
  const image = checkVolumeImage(directory, bytes), workspace = join(directory, 'work');
  canonical(workspace); const rootStat = lstatSync(workspace); invariant(rootStat.uid === uid && (rootStat.mode & (uid === 0 ? 0o022 : 0o077)) === 0, 'Bounded volume mount root ownership differs');
  const result = JSON.parse(run('/usr/bin/findmnt', ['--json', '--mountpoint', workspace, '--output', 'SOURCE,FSTYPE,OPTIONS']));
  const mount = result.filesystems?.[0];
  invariant(mount && /^\/dev\/loop\d+$/.test(mount.source) && mount.fstype === 'ext4' && ['nodev', 'nosuid', 'rw'].every(option => mount.options.split(',').includes(option)), 'Persistent bounded loop ext4 workspace mount required');
  invariant(readFileSync(`/sys/class/block/${basename(mount.source)}/loop/backing_file`, 'utf8').trim() === image, 'Workspace must mount its exact root-owned backing image');
  const fs = statfsSync(workspace, { bigint: true });
  invariant(fs.type === 0xef53n && fs.blocks * fs.bsize <= BigInt(bytes) && fs.files <= BigInt(inodes), 'Mounted workspace capacity exceeds frozen profile');
}
export function checkWorkspace(value: Installation): void { validateInstallation(value); checkVolumeMount(value.workspaceProvisionDirectory, value.workspaceBytes, value.workspaceInodes, value.uid); }
export function checkHostData(value: Installation): void {
  validateInstallation(value); checkVolumeMount(value.hostDataProvisionDirectory, value.hostDataBytes, value.hostDataInodes, 0);
  const device = lstatSync(hostDataPath(value)).dev;
  for (const name of ['state', 'artifacts', 'evidence', 'logs']) {
    const path = join(hostDataPath(value), name);
    if (name === 'evidence' && !existsSync(path)) continue; // Accepted recovery does not need the external evidence store.
    privateDirectory(path, value.uid); invariant(lstatSync(path).gid === value.gid && lstatSync(path).dev === device, 'Host-data directories must share the bounded filesystem and service GID');
  }
}
export function writeInstallationBundle(input: Installation, directory: string): void {
  safePath(directory); canonical(dirname(directory)); mkdirSync(directory, { mode: 0o700 });
  for (const [name, content] of Object.entries(renderInstallation(input))) writeFileSync(join(directory, name), content, { flag: 'wx', mode: 0o600 });
}
function ownedUnitFile(path: string, content: string): void {
  canonical(path); const stat = lstatSync(path);
  invariant(stat.isFile() && stat.nlink === 1 && stat.uid === 0 && (stat.mode & 0o022) === 0 && readFileSync(path, 'utf8') === content, 'Installed unit does not match this installation; refusing mutation');
}
/** Explicit administrator command. It installs files only; enable/start remains a separate operation. */
export function applyInstallation(input: Installation, bundle: string): void {
  const value = validateInstallation(input); checkHostData(value); checkInstallation(value, 'admin', false); const units = renderInstallation(value);
  canonical(bundle);
  for (const [name, content] of Object.entries(units)) invariant(readFileSync(join(bundle, name), 'utf8') === content, 'Review bundle changed or differs from installation');
  for (const name of [value.unitName, mountUnitName(value), hostDataMountUnitName(value), basename(installedManifest(value))]) invariant(!existsSync(join('/etc/systemd/system', name)), 'Installation already exists; refusing overwrite');
  canonical('/etc/systemd/system'); const parent = dirname(value.workspaceProvisionDirectory); canonical(parent);
  const unitDirectory = lstatSync('/etc/systemd/system'); invariant(unitDirectory.uid === 0 && (unitDirectory.mode & 0o022) === 0, 'Root-owned unit directory required');
  const parentStat = lstatSync(parent); invariant(parentStat.uid === 0 && (parentStat.mode & 0o022) === 0, 'Stable root-owned provisioning parent required');
  run('/usr/bin/systemd-analyze', ['verify', join(bundle, value.unitName), join(bundle, mountUnitName(value)), join(bundle, hostDataMountUnitName(value))]);
  if (!existsSync(value.workspaceProvisionDirectory)) run(value.nodeBinary, [join(payloadPath(value), 'packages/supervisor/provision-workspace.mjs'), 'create', value.workspaceProvisionDirectory, String(value.uid), String(value.gid), String(value.workspaceBytes), String(value.workspaceInodes)]);
  else {
    // A reboot may leave the preserved existing image unmounted. Mount it without recreating its layout.
    const image = checkVolumeImage(value.workspaceProvisionDirectory, value.workspaceBytes);
    const mounted = readFileSync('/proc/self/mountinfo', 'utf8').split('\n').some(line => line.split(' ')[4] === workspacePath(value));
    if (!mounted) {
      const placeholder = lstatSync(workspacePath(value)); invariant(placeholder.uid === 0 && (placeholder.mode & 0o022) === 0, 'Root-owned stable mountpoint required');
      run('/usr/bin/mount', ['-t', 'ext4', '-o', 'loop,nodev,nosuid', image, workspacePath(value)]);
    }
  }
  checkWorkspace(value);
  writeFileSync(join('/etc/systemd/system', value.unitName), units[value.unitName]!, { flag: 'wx', mode: 0o644 });
  writeFileSync(join('/etc/systemd/system', mountUnitName(value)), units[mountUnitName(value)]!, { flag: 'wx', mode: 0o644 });
  writeFileSync(join('/etc/systemd/system', hostDataMountUnitName(value)), units[hostDataMountUnitName(value)]!, { flag: 'wx', mode: 0o644 });
  writeFileSync(installedManifest(value), units['installation.json']!, { flag: 'wx', mode: 0o644 });
  run('/usr/bin/systemctl', ['daemon-reload']);
}
export function stopInstallation(input: Installation, uninstall = false): void {
  const value = validateInstallation(input); invariant(process.getuid?.() === 0, 'Administrator operation required');
  const units = renderInstallation(value);
  ownedUnitFile(installedManifest(value), units['installation.json']!);
  for (const name of [value.unitName, mountUnitName(value), hostDataMountUnitName(value)]) ownedUnitFile(join('/etc/systemd/system', name), units[name]!);
  run('/usr/bin/systemctl', ['stop', value.unitName]);
  if (!uninstall) return;
  process.chdir('/');
  run('/usr/bin/systemctl', ['disable', value.unitName]); run('/usr/bin/systemctl', ['stop', mountUnitName(value)]); run('/usr/bin/systemctl', ['stop', hostDataMountUnitName(value)]);
  for (const path of [join('/etc/systemd/system', value.unitName), join('/etc/systemd/system', mountUnitName(value)), join('/etc/systemd/system', hostDataMountUnitName(value)), installedManifest(value)]) rmSync(path);
  run('/usr/bin/systemctl', ['daemon-reload']);
}
export async function runInstallation(args: string[]): Promise<void> {
  const [command, path, bundle] = args;
  invariant(path && ['render', 'apply', 'check-service', 'stop', 'uninstall'].includes(command!) && args.length === (command === 'render' || command === 'apply' ? 3 : 2), 'Usage: installation.ts render|apply INSTALLATION_JSON BUNDLE | check-service|stop|uninstall INSTALLATION_JSON');
  canonical(path); const value = validateInstallation(JSON.parse(readFileSync(path, 'utf8')) as Installation);
  if (command === 'render') {
    writeInstallationBundle(value, bundle!);
  } else if (command === 'apply') applyInstallation(value, bundle!);
  else if (command === 'check-service') { checkInstallation(value, 'service'); process.stdout.write(JSON.stringify({ preflight: 'ready', executionReadiness: 'await supervisor status' }) + '\n'); }
  else stopInstallation(value, command === 'uninstall');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void runInstallation(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : 'Installation failed'); process.exitCode = 1; });
