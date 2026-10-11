import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { identity, invariant } from '../packages/contracts/index.ts';
import { hashBytes } from '../packages/release/artifacts.ts';
import type { ReleaseState, ReleaseTarget } from '../packages/release/controller.ts';
import { ProcessLease } from '../packages/supervisor/process-lease.ts';
import { candidateNodeBinary, verifyApplication } from './candidate.ts';
import type { SupervisorFile } from './cli.ts';
import { assertPrivateHostDirectory, readHostFile } from './host-policy.ts';
import { checkInstallation, type Installation } from './installation.ts';
import { readVerifiedRuntimeFile, type RuntimeIdentity } from './runtime-bundle.ts';

const sync = (path: string) => { const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } };
export const bootstrapDirectory = (state: string) => join(state, 'boot');
function directory(path: string): void { if (!existsSync(path)) mkdirSync(path, { mode: 0o700 }); assertPrivateHostDirectory(path); }
function target(value: ReleaseTarget): void {
  invariant(value && Object.keys(value).sort().join(',') === 'candidateId,policyDigest' && /^[a-f0-9]{64}$/.test(value.candidateId) && /^[a-f0-9]{64}$/.test(value.policyDigest), 'Exact bootstrap target required');
}
function accepted(config: SupervisorFile, selected: ReleaseTarget): ReleaseState {
  const path = join(config.host.stateDirectory, 'release.sqlite'); readHostFile(path, 64 * 1024 * 1024);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const row = db.prepare('SELECT value FROM release_state WHERE singleton=1').get();
    const state = JSON.parse(String(row?.value)) as ReleaseState;
    invariant(state.phase === 'accepted' && identity(state.accepted) === identity(selected), 'Bootstrap publication requires completed incumbent-policy probation');
    return state;
  } finally { db.close(); }
}
/** A copied runtime also makes a first, externally pinned runtime independently recoverable.
 * It does not turn that runtime into an application candidate bundle. */
function prepare(config: SupervisorFile, selected: ReleaseTarget): string {
  target(selected); assertPrivateHostDirectory(config.host.stateDirectory);
  const candidate = verifyApplication(config.host.artifactStore, selected.candidateId, config.host.nodeBinary);
  invariant(candidate.files.some(file => file.path === 'deployment/bootstrap-evolution.ts'), 'Candidate lacks evolvable bootstrap entry');
  const boot = bootstrapDirectory(config.host.stateDirectory); directory(boot); directory(join(boot, 'targets'));
  const path = join(boot, 'targets', selected.candidateId);
  const executable = candidateNodeBinary(candidate, config.host.artifactStore, config.host.nodeBinary);
  const runtime = (candidate.inputs.controls as unknown as { runtime: RuntimeIdentity }).runtime;
  const bytes = readVerifiedRuntimeFile(dirname(executable), basename(executable), runtime), runtimeHash = runtime.nodeSha256;
  const descriptor = JSON.stringify({ ...selected, runtimeHash });
  if (!existsSync(path)) {
    const staging = join(boot, 'targets', `.pending-${selected.candidateId}`);
    // An interrupted copy is never executed; do not remove anything through a redirected parent.
    if (existsSync(staging)) { assertPrivateHostDirectory(staging); rmSync(staging, { recursive: true }); }
    mkdirSync(staging, { mode: 0o700 });
    writeFileSync(join(staging, 'node'), bytes, { flag: 'wx', mode: 0o500 }); sync(join(staging, 'node'));
    writeFileSync(join(staging, 'target.json'), descriptor, { flag: 'wx', mode: 0o400 }); sync(join(staging, 'target.json'));
    symlinkSync(join(config.host.artifactStore, selected.candidateId, 'payload'), join(staging, 'payload'));
    sync(staging); renameSync(staging, path); sync(join(boot, 'targets'));
  }
  assertPrivateHostDirectory(path);
  invariant(readHostFile(join(path, 'target.json')).toString() === descriptor && hashBytes(readHostFile(join(path, 'node'), 128 * 1024 * 1024)) === runtimeHash && realpathSync(join(path, 'payload')) === join(config.host.artifactStore, selected.candidateId, 'payload'), 'Retained bootstrap target changed');
  return path;
}
function point(boot: string, name: 'active' | 'rescue', path: string): void {
  const temporary = join(boot, `.${name}-pending`);
  if (existsSync(temporary) || (() => { try { lstatSync(temporary); return true; } catch { return false; } })()) rmSync(temporary);
  symlinkSync(path, temporary); renameSync(temporary, join(boot, name)); sync(boot);
}
/** Initial grant provisioning only; first admission still occurs in the retained launcher. */
export function initializeBootstrap(config: SupervisorFile, selected: ReleaseTarget): void {
  const path = prepare(config, selected), boot = bootstrapDirectory(config.host.stateDirectory);
  // Reinstallation preserves accepted boot selection; interrupted initial provisioning completes
  // only its missing active pointer, and cannot replace an existing rescue with fresh input.
  if (existsSync(join(boot, 'active'))) {
    invariant(existsSync(join(boot, 'rescue')), 'Existing bootstrap lacks independent rescue');
    for (const name of ['active', 'rescue']) {
      const destination = realpathSync(join(boot, name));
      invariant(/^[a-f0-9]{64}$/.test(destination.slice(join(boot, 'targets').length + 1)) && destination.startsWith(join(boot, 'targets') + '/'), 'Existing boot selection escaped retained snapshots');
      assertPrivateHostDirectory(destination);
    }
    return;
  }
  if (existsSync(join(boot, 'rescue'))) invariant(realpathSync(join(boot, 'rescue')) === path, 'Interrupted initial rescue differs');
  else point(boot, 'rescue', path);
  point(boot, 'active', path);
}
/** Called by the still-running incumbent after its old-policy verdict, never by a worker. */
export function publishBootstrapSelection(config: SupervisorFile, selected: ReleaseTarget): void {
  const boot = bootstrapDirectory(config.host.stateDirectory);
  if (!existsSync(boot)) return; // Explicitly uninstalled engineering hosts have no process-manager slot.
  assertPrivateHostDirectory(boot);
  const lease = new ProcessLease(join(boot, 'publication.sqlite'));
  try {
    accepted(config, selected); const path = prepare(config, selected);
    invariant(existsSync(join(boot, 'rescue')), 'Independent rescue must exist before promotion');
    point(boot, 'active', path);
    // Crash before clearing the latch leaves the retained rescue selected, never partial new code.
    rmSync(join(boot, 'failed'), { force: true }); sync(boot);
  } finally { lease.close(); }
}
/** Separate post-accept operation; rotation cannot be part of candidate admission or publication. */
export function rotateBootstrapRescue(config: SupervisorFile, selected: ReleaseTarget): void {
  const boot = bootstrapDirectory(config.host.stateDirectory);
  assertPrivateHostDirectory(boot);
  const lease = new ProcessLease(join(boot, 'publication.sqlite'));
  try {
    const state = accepted(config, selected);
    invariant(!existsSync(join(boot, 'failed')), 'Cannot rotate rescue while rescue is latched');
    const path = prepare(config, selected);
    invariant(realpathSync(join(boot, 'active')) === path, 'Only the separately accepted active bootstrap may become rescue');
    const ready = JSON.parse(readHostFile(join(path, 'boot-ready.json')).toString());
    const descriptor = JSON.parse(readHostFile(join(path, 'target.json')).toString());
    invariant(Object.keys(ready).sort().join(',') === 'authority,runtimeHash,target' && identity(ready.target) === identity(selected) && identity(ready.authority) === identity(state.authority) && ready.runtimeHash === descriptor.runtimeHash, 'Rescue rotation requires this snapshot boot-ready under current authority');
    point(boot, 'rescue', path);
  } finally { lease.close(); }
}
/** Fixed process-manager configuration only: OS tools select one cwd, then execute selected code.
 * systemd drains KillMode=control-group before Restart=on-failure; no inline fallback races. */
export function bootstrapCommands(state: string, manifest: string): { start: string; stopPost: string } {
  for (const path of [state, manifest]) invariant(/^\/[A-Za-z0-9_./-]+$/.test(path) && resolve(path) === path, 'Canonical bootstrap command path required');
  const boot = bootstrapDirectory(state);
  return {
    start: `/bin/sh -c 'if test -e ${boot}/failed; then exec /usr/bin/env --chdir=${boot}/rescue ./node payload/deployment/bootstrap-evolution.ts run ${manifest} rescue; else exec /usr/bin/env --chdir=${boot}/active ./node payload/deployment/bootstrap-evolution.ts run ${manifest} normal; fi'`,
    stopPost: `/bin/sh -c 'if test "$$SERVICE_RESULT" != success; then /usr/bin/touch ${boot}/failed; fi'`,
  };
}
async function run(args: string[]): Promise<void> {
  const [operation, manifestPath, mode] = args;
  invariant(manifestPath && (operation === 'initialize' && args.length === 2 || operation === 'run' && args.length === 3 && ['normal', 'rescue'].includes(mode!)), 'Usage: bootstrap-evolution.ts initialize MANIFEST | run MANIFEST normal|rescue');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Installation;
  const config = JSON.parse(readHostFile(manifest.hostConfigFile).toString()) as SupervisorFile;
  if (operation === 'initialize') {
    invariant(config.bootstrap, 'Initial bootstrap policy required');
    initializeBootstrap(config, { candidateId: manifest.coordinatorCandidateId, policyDigest: config.bootstrap.policyDigest }); return;
  }
  const cwd = realpathSync(process.cwd()), descriptor = JSON.parse(readHostFile(join(cwd, 'target.json')).toString()) as ReleaseTarget & { runtimeHash: string };
  invariant(Object.keys(descriptor).sort().join(',') === 'candidateId,policyDigest,runtimeHash' && /^[a-f0-9]{64}$/.test(descriptor.runtimeHash), 'Exact retained bootstrap descriptor required');
  const selected = { candidateId: descriptor.candidateId, policyDigest: descriptor.policyDigest }; target(selected);
  invariant(cwd === join(bootstrapDirectory(manifest.stateDirectory), 'targets', selected.candidateId) && realpathSync(process.execPath) === join(cwd, 'node') && hashBytes(readFileSync(process.execPath)) === descriptor.runtimeHash, 'Exact retained bootstrap runtime required');
  invariant(realpathSync(fileURLToPath(import.meta.url)) === join(manifest.artifactStore, selected.candidateId, 'payload/deployment/bootstrap-evolution.ts'), 'Exact retained bootstrap source required');
  checkInstallation(manifest, 'service', true, { candidateId: selected.candidateId, nodeBinary: process.execPath });
  const lease = new ProcessLease(join(bootstrapDirectory(manifest.stateDirectory), 'entry.sqlite'));
  try {
    const { launchHost, restoreHostBootstrap } = await import('./host-successor.ts');
    config.host.nodeBinary = process.execPath;
    if (mode === 'rescue') restoreHostBootstrap(config, selected);
    const configPath = join(cwd, 'runtime-config.json');
    const temporary = join(cwd, 'runtime-config.pending'); rmSync(temporary, { force: true });
    writeFileSync(temporary, JSON.stringify(config), { flag: 'wx', mode: 0o600 }); sync(temporary); renameSync(temporary, configPath); sync(cwd);
    lease.close(); await launchHost(configPath, undefined, mode === 'normal' ? () => {
      const state = accepted(config, selected);
      const temporary = join(cwd, 'boot-ready.pending'); rmSync(temporary, { force: true });
      writeFileSync(temporary, JSON.stringify({ target: selected, authority: state.authority, runtimeHash: descriptor.runtimeHash }), { flag: 'wx', mode: 0o600 });
      sync(temporary); renameSync(temporary, join(cwd, 'boot-ready.json')); sync(cwd);
    } : undefined);
  } finally { lease.close(); }
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) void run(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : 'Bootstrap unavailable'); process.exitCode = 1; });
