import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { identity, invariant } from '../packages/contracts/index.ts';
import { ProcessLease } from '../packages/supervisor/process-lease.ts';
import { policyDescriptor, type ReleaseState, type ReleaseTarget } from '../packages/release/controller.ts';
import { admitCandidate } from '../packages/release/admission.ts';
import { verifyApplication } from './candidate.ts';
import type { SupervisorFile } from './cli.ts';
import { contentAddressedEvidence, loadHostPolicy, readHostFile } from './host-policy.ts';

export interface HostSelection {
  selected: ReleaseTarget;
  rescue: ReleaseTarget;
  phase: 'ready' | 'requested' | 'booting' | 'rescue';
}
/** Host-private durable selection. No source paths or provider credentials come from a release request. */
function journal<T>(config: SupervisorFile, operation: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(join(config.host.stateDirectory, 'host-successor.sqlite'));
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS selection(singleton INTEGER PRIMARY KEY CHECK(singleton=1), value TEXT NOT NULL)');
    return operation(db);
  } finally { db.close(); }
}
export function hostSelection(config: SupervisorFile): HostSelection | undefined {
  return journal(config, db => { const row = db.prepare('SELECT value FROM selection WHERE singleton=1').get(); return row ? JSON.parse(String(row.value)) : undefined; });
}
function save(config: SupervisorFile, value: HostSelection): void {
  journal(config, db => db.prepare('INSERT INTO selection VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET value=excluded.value').run(JSON.stringify(value)));
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
  save(config, { selected, rescue, phase: 'requested' });
}
function rescue(config: SupervisorFile, current: HostSelection): HostSelection {
  const next: HostSelection = { selected: current.rescue, rescue: current.rescue, phase: 'rescue' };
  save(config, next); return next;
}
/** A non-serving bootstrap enters here; every accepted launcher replaces this process with execve.
 * A pending boot after an OS restart chooses old code. No ancestor coordinator remains in memory. */
export async function launchHost(configPath: string, selectedBoot?: string): Promise<void> {
  const config = JSON.parse(readHostFile(configPath).toString('utf8')) as SupervisorFile;
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
      process.execve(config.host.nodeBinary, [config.host.nodeBinary, join(config.host.artifactStore, target.selected.candidateId, 'payload/deployment/cli.ts'), 'launch-selected', configPath, target.selected.candidateId], process.env as Record<string, string>);
      throw new Error('Host execve returned');
    }
    const selectedModule = join(config.host.artifactStore, current.selected.candidateId, 'payload/deployment/host-successor.ts');
    if (current.phase === 'requested') { current = { ...current, phase: 'booting' }; save(config, current); return replace(current); }
    if (resolve(fileURLToPath(import.meta.url)) !== selectedModule) return replace(current);
    verifyApplication(config.host.artifactStore, current.selected.candidateId, config.host.nodeBinary);
    // A killed launcher closes IPC; allow its old coordinator to drain before taking the lease.
    const drainDeadline = Date.now() + 15000;
    while (true) {
      try { const prior = new ProcessLease(join(config.host.stateDirectory, 'supervisor-lease.sqlite')); prior.close(); break; }
      catch (error) { if (Date.now() >= drainDeadline) throw error; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const child = spawn(config.host.nodeBinary, [join(config.host.artifactStore, current.selected.candidateId, 'payload/deployment/cli.ts'), 'supervise', configPath], {
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
      });
    }).finally(() => { clearTimeout(timer); if (shutdownTimer) clearTimeout(shutdownTimer); process.off('SIGTERM', stop); process.off('SIGINT', stop); });
    if (stopping) return;
    const latest = hostSelection(config)!;
    if (exit.code === 75 && latest.phase === 'requested') { save(config, { ...latest, phase: 'booting' }); return replace({ ...latest, phase: 'booting' }); }
    if ((!ready || exit.code !== 0 || exit.signal) && latest.selected.candidateId !== latest.rescue.candidateId) return replace(rescue(config, latest));
    invariant(exit.code === 0 && !exit.signal, 'Host coordinator unavailable; bounded rescue exhausted');
  } finally { lease.close(); }
}
