import { closeSync, constants, existsSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { identity, invariant } from '../packages/contracts/index.ts';
import { ProcessLease } from '../packages/supervisor/process-lease.ts';
import { policyDescriptor, type ReleaseState, type ReleaseTarget } from '../packages/release/controller.ts';
import { hashBytes } from '../packages/release/artifacts.ts';
import { admitCandidate } from '../packages/release/admission.ts';
import { candidateNodeBinary, verifyApplication } from './candidate.ts';
import type { SupervisorFile } from './cli.ts';
import { assertPrivateHostDirectory, contentAddressedEvidence, loadHostPolicy, readHostFile } from './host-policy.ts';
import { validateHostBindings } from './supervisor.ts';
import { publishBootstrapSelection } from './bootstrap-evolution.ts';

export interface HostSelection {
  selected: ReleaseTarget;
  rescue: ReleaseTarget;
  phase: 'ready' | 'requested' | 'booting' | 'rescue';
}
/** Host-private durable selection. No source paths or provider credentials come from a release request. */
function journal<T>(config: SupervisorFile, operation: (db: DatabaseSync) => T): T {
  assertPrivateHostDirectory(config.host.stateDirectory);
  const path = join(config.host.stateDirectory, 'host-successor.sqlite');
  try { const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); closeSync(fd); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  // The containing directory is host-private. Refuse redirected/preexisting public SQLite files,
  // including sidecars, before SQLite can modify them or interpret selection state.
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try {
      const stat = lstatSync(path + suffix);
      invariant(stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid?.() && (stat.mode & 0o077) === 0 && stat.size <= 1024 * 1024, 'Private bounded host selection journal required');
    } catch (error) { if (suffix && (error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
  }
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS selection(singleton INTEGER PRIMARY KEY CHECK(singleton=1), value TEXT NOT NULL)');
    return operation(db);
  } finally { db.close(); }
}
export function hostSelection(config: SupervisorFile): HostSelection | undefined {
  return journal(config, db => {
    const row = db.prepare('SELECT CASE WHEN length(CAST(value AS BLOB)) <= 8192 THEN value ELSE NULL END AS value FROM selection WHERE singleton=1').get();
    if (!row) return undefined;
    invariant(typeof row.value === 'string', 'Host selection exceeds byte limit');
    const value = JSON.parse(row.value) as HostSelection;
    const target = (value: ReleaseTarget) => value && Object.keys(value).sort().join(',') === 'candidateId,policyDigest' &&
      /^[a-f0-9]{64}$/.test(value.candidateId) && /^[a-f0-9]{64}$/.test(value.policyDigest);
    invariant(value && Object.keys(value).sort().join(',') === 'phase,rescue,selected' && target(value.selected) && target(value.rescue) && ['ready', 'requested', 'booting', 'rescue'].includes(value.phase), 'Exact host selection required');
    return value;
  });
}
function save(config: SupervisorFile, value: HostSelection): void {
  journal(config, db => db.prepare('INSERT INTO selection VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET value=excluded.value').run(JSON.stringify(value)));
}
/** Called only by the independent process-manager rescue after its failed cgroup was drained. */
export function restoreHostBootstrap(config: SupervisorFile, selected: ReleaseTarget): void {
  const launcher = new ProcessLease(join(config.host.stateDirectory, 'host-launcher-lease.sqlite'));
  let coordinator: ProcessLease | undefined;
  try {
    coordinator = new ProcessLease(join(config.host.stateDirectory, 'supervisor-lease.sqlite'));
    const path = join(config.host.stateDirectory, 'release.sqlite');
    if (!existsSync(path)) return; // Initial admission has not yet committed; bootstrap proof remains required.
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const retained = db.prepare('SELECT value FROM release_events').all().some(row => {
        const state = JSON.parse(String(row.value)) as Partial<ReleaseState>;
        return state.phase === 'accepted' && identity(state.accepted) === identity(selected);
      });
      invariant(retained, 'Independent bootstrap rescue was never accepted');
    } finally { db.close(); }
    verifyApplication(config.host.artifactStore, selected.candidateId, config.host.nodeBinary);
    save(config, { selected, rescue: selected, phase: 'rescue' });
  } finally { coordinator?.close(); launcher.close(); }
}
/** Called synchronously by the incumbent coordinator only after its old-policy probation verdict. */
export function requestHostSuccessor(config: SupervisorFile, selected: ReleaseTarget, rescue: ReleaseTarget): void {
  const db = new DatabaseSync(join(config.host.stateDirectory, 'release.sqlite'), { readOnly: true });
  try {
    const row = db.prepare('SELECT value FROM release_state WHERE singleton=1').get();
    const state = JSON.parse(String(row?.value)) as ReleaseState;
    invariant(state.phase === 'accepted' && identity(state.accepted) === identity(selected), 'Host successor requires journaled probation acceptance');
  } finally { db.close(); }
  verifyApplication(config.host.artifactStore, selected.candidateId, config.host.nodeBinary);
  verifyApplication(config.host.artifactStore, rescue.candidateId, config.host.nodeBinary);
  publishBootstrapSelection(config, selected);
  save(config, { selected, rescue, phase: 'requested' });
}
function rescue(config: SupervisorFile, current: HostSelection): HostSelection {
  const next: HostSelection = { selected: current.rescue, rescue: current.rescue, phase: 'rescue' };
  save(config, next); return next;
}
/** A non-serving bootstrap enters here; every accepted launcher replaces this process with execve.
 * A pending boot after an OS restart chooses old code. No ancestor coordinator remains in memory. */
export async function launchHost(configPath: string, selectedBoot?: string, onReady?: () => void): Promise<void> {
  const config = JSON.parse(readHostFile(configPath).toString('utf8')) as SupervisorFile;
  validateHostBindings(config.host);
  const lease = new ProcessLease(join(config.host.stateDirectory, 'host-launcher-lease.sqlite'));
  try {
    let current = hostSelection(config);
    if (!current) {
      invariant(config.bootstrap, 'Initial host launcher requires a bootstrap proof');
      const proof = JSON.parse(readHostFile(config.bootstrap.proofFile).toString('utf8'));
      const policyPath = new Map(config.policyFiles).get(config.bootstrap.policyDigest);
      invariant(policyPath, 'Bootstrap policy missing');
      const policy = loadHostPolicy(policyPath, [config.host.workspaceDirectory, config.host.artifactStore]);
      invariant(policy.policyDigest === config.bootstrap.policyDigest, 'Bootstrap policy registry changed');
      invariant(config.mode === 'engineering' || policy.kind === 'product', 'Product host requires product bootstrap policy');
      const candidate = verifyApplication(config.host.artifactStore, proof.proposal.candidate.id, config.host.nodeBinary);
      invariant(identity((candidate.inputs.controls as { policy?: unknown }).policy) === identity(policyDescriptor(policy)), 'Bootstrap host policy descriptor differs');
      invariant(proof.proposal.priorAuthority.epoch === 1 && proof.proposal.priorAuthority.controlRevision === candidate.manifest.controls && proof.proposal.priorAuthority.generation.trim().length > 0, 'Initial host proof must bind the first authority epoch and candidate controls');
      invariant(proof.proposal.recoveryArtifact.sha256 === hashBytes(readFileSync(join(config.host.artifactStore, candidate.manifest.id, 'candidate.json'))), 'Initial host rescue must bind the current candidate manifest');
      admitCandidate(config.host.artifactStore, proof.proposal, proof.proposal.priorAuthority, policy, proof.signed, contentAddressedEvidence(config.evidenceDirectory));
      const target = { candidateId: proof.proposal.candidate.id as string, policyDigest: config.bootstrap.policyDigest };
      current = { selected: target, rescue: target, phase: 'ready' }; save(config, current);
    }
    // Acceptance and launcher selection live in separate durable journals. Complete an interrupted
    // post-accept selection from the controller's committed verdict, never from pending probation.
    const releasePath = join(config.host.stateDirectory, 'release.sqlite');
    if (current.phase === 'ready' && existsSync(releasePath)) {
      const db = new DatabaseSync(releasePath, { readOnly: true });
      try {
        const row = db.prepare('SELECT value FROM release_state WHERE singleton=1').get();
        const state = row ? JSON.parse(String(row.value)) as ReleaseState : undefined;
        if (state?.phase === 'accepted' && identity(state.accepted) !== identity(current.selected)) {
          current = { selected: state.accepted, rescue: current.selected, phase: 'requested' }; save(config, current);
        }
      } finally { db.close(); }
    }
    if (current.phase === 'booting' && selectedBoot !== current.selected.candidateId) current = rescue(config, current);
    function replace(target: HostSelection): never {
      const candidate = verifyApplication(config.host.artifactStore, target.selected.candidateId, config.host.nodeBinary);
      invariant(candidate.files.some(file => file.path === 'deployment/host-successor.ts') && candidate.files.some(file => file.path === 'deployment/cli.ts'), 'Frozen host launcher closure missing');
      lease.close();
      invariant(process.execve, 'Host succession requires execve');
      const executable = candidateNodeBinary(candidate, config.host.artifactStore, config.host.nodeBinary);
      process.execve(executable, [executable, join(config.host.artifactStore, target.selected.candidateId, 'payload/deployment/cli.ts'), 'launch-selected', configPath, target.selected.candidateId], process.env as Record<string, string>);
      throw new Error('Host execve returned');
    }
    const selectedModule = join(config.host.artifactStore, current.selected.candidateId, 'payload/deployment/host-successor.ts');
    // A selected installed bootstrap already loaded this exact launcher. Re-execing the
    // CLI here would discard its normal-boot readiness witness callback.
    if (current.phase === 'requested') { current = { ...current, phase: 'booting' }; save(config, current); }
    if (resolve(fileURLToPath(import.meta.url)) !== selectedModule) return replace(current);
    verifyApplication(config.host.artifactStore, current.selected.candidateId, config.host.nodeBinary);
    // A killed launcher closes IPC; allow its old coordinator to drain before taking the lease.
    const drainDeadline = Date.now() + 15000;
    while (true) {
      try { const prior = new ProcessLease(join(config.host.stateDirectory, 'supervisor-lease.sqlite')); prior.close(); break; }
      catch (error) { if (Date.now() >= drainDeadline) throw error; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const selectedCandidate = verifyApplication(config.host.artifactStore, current.selected.candidateId, config.host.nodeBinary);
    const child = spawn(candidateNodeBinary(selectedCandidate, config.host.artifactStore, config.host.nodeBinary), [join(config.host.artifactStore, current.selected.candidateId, 'payload/deployment/cli.ts'), 'supervise', configPath], {
      env: { ...process.env, AEON_HOST_LAUNCHER: String(process.pid) }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    let stopping = false, ready = false;
    let shutdownTimer: NodeJS.Timeout | undefined;
    const stop = () => { stopping = true; child.kill('SIGTERM'); shutdownTimer = setTimeout(() => child.kill('SIGKILL'), 10000); };
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
    const timer = setTimeout(() => child.kill('SIGKILL'), 45000);
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((accept, reject) => {
      child.once('error', reject); child.once('exit', (code, signal) => accept({ code, signal }));
      child.on('message', message => {
        if ((message as { kind?: string })?.kind !== 'host-ready') return;
        ready = true; clearTimeout(timer);
        const latest = hostSelection(config)!;
        if (latest.phase !== 'requested') save(config, { ...latest, phase: 'ready' });
        onReady?.();
      });
    }).finally(() => { clearTimeout(timer); if (shutdownTimer) clearTimeout(shutdownTimer); process.off('SIGTERM', stop); process.off('SIGINT', stop); });
    if (stopping) return;
    const latest = hostSelection(config)!;
    if (exit.code === 75 && latest.phase === 'requested') { save(config, { ...latest, phase: 'booting' }); return replace({ ...latest, phase: 'booting' }); }
    if ((!ready || exit.code !== 0 || exit.signal) && latest.selected.candidateId !== latest.rescue.candidateId) return replace(rescue(config, latest));
    invariant(exit.code === 0 && !exit.signal, 'Host coordinator unavailable; bounded rescue exhausted');
  } finally { lease.close(); }
}
