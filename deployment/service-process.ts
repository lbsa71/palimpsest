import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, constants, fstatSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { invariant } from '../packages/contracts/index.ts';
import type { Authority } from '../packages/contracts/index.ts';
import { candidateNodeBinary, verifyApplication } from './candidate.ts';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import type { HostBindings } from './materialize.ts';
import type { ApplicationSecrets } from './config.ts';

export interface ServiceReady { kind: 'ready'; candidateId: string; authority: Authority; address: { address: string; family: string; port: number } }
export interface ServiceProcessOptions { mode: 'engineering' | 'product'; onUnexpectedExit?: () => void }
/** Previously accepted judging policy information; evaluator keys and grants stay in the parent. */
export interface EvolutionMetadata { policyDigest: string; allowedModelIds?: string[] }
export function validateEvolutionMetadata(metadata: EvolutionMetadata): void {
  invariant(metadata && Object.keys(metadata).every(key => ['policyDigest', 'allowedModelIds'].includes(key)) && /^[a-f0-9]{64}$/.test(metadata.policyDigest), 'Public frozen evolution policy digest required');
  if (metadata.allowedModelIds !== undefined) invariant(Array.isArray(metadata.allowedModelIds) && metadata.allowedModelIds.length <= 32 && new Set(metadata.allowedModelIds).size === metadata.allowedModelIds.length && metadata.allowedModelIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 256), 'Bounded public qualified model IDs required');
}
/** Pin both directories and refuse a pre-existing public or redirected diagnostic sink. */
function writeDiagnostic(stateDirectory: string, value: object): void {
  const state = openSync(stateDirectory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  let directory: number | undefined;
  try {
    const path = `/proc/self/fd/${state}/host-diagnostics`;
    try { mkdirSync(path, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    directory = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const stat = fstatSync(directory);
    invariant((stat.mode & 0o077) === 0 && stat.uid === process.getuid?.(), 'Private host diagnostics directory required');
    const fd = openSync(`/proc/self/fd/${directory}/${randomUUID()}.json`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(fd, JSON.stringify(value)); } finally { closeSync(fd); }
  } finally { if (directory !== undefined) closeSync(directory); closeSync(state); }
}
/** The supervisor holds its own lease; each application holds the separate execution lease. */
export class ServiceProcess {
  readonly host: HostBindings; readonly secrets: ApplicationSecrets;
  private child?: ChildProcess; private closed?: Promise<void>;
  private stopping = false;
  readonly options: ServiceProcessOptions;
  constructor(host: HostBindings, secrets: ApplicationSecrets, options: ServiceProcessOptions = { mode: 'product' }) { this.host = host; this.secrets = secrets; this.options = options; }
  get running(): boolean { return !!this.child && this.child.exitCode === null && this.child.signalCode === null; }
  get processId(): number | undefined { return this.running ? this.child?.pid : undefined; }
  async start(candidateId: string, authority: Authority, evolution?: EvolutionMetadata): Promise<ServiceReady> {
    invariant(!this.child, 'Stop the current application before starting a successor');
    const candidate = verifyApplication(this.host.artifactStore, candidateId, this.host.nodeBinary);
    invariant(this.options.mode === 'engineering' || (candidate.inputs.configuration as { resourceLimits?: unknown }).resourceLimits && this.host.cgroupRoot, 'Product startup requires enforced kernel resource ceilings');
    invariant(this.options.mode === 'engineering' || evolution, 'Product startup requires previously accepted evolution policy metadata');
    if (evolution) validateEvolutionMetadata(evolution);
    const authorityStore = new AuthorityStore(join(this.host.stateDirectory, 'authority.sqlite'));
    try {
      authorityStore.assert(authority);
      invariant(authorityStore.current()?.artifactId === candidateId && authority.controlRevision === candidate.manifest.controls, 'Serving authority does not qualify this candidate');
    } finally { authorityStore.close(); }
    const entrypoint = join(this.host.artifactStore, candidateId, 'payload/deployment/service-child.ts');
    const child = spawn(candidateNodeBinary(candidate, this.host.artifactStore, this.host.nodeBinary), [entrypoint], { detached: true, env: { PATH: '/usr/bin:/bin', NODE_NO_WARNINGS: '1' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    this.child = child; this.stopping = false;
    let diagnostic = Buffer.alloc(0); child.stderr?.on('data', (chunk: Buffer) => { if (diagnostic.length < 32768) diagnostic = Buffer.concat([diagnostic, chunk.subarray(0, 32768 - diagnostic.length)]); });
    let ready = false;
    this.closed = new Promise(resolve => { child.once('exit', () => { resolve(); if (ready && !this.stopping) this.options.onUnexpectedExit?.(); }); child.once('error', () => resolve()); });
    try {
      return await new Promise<ServiceReady>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Application readiness deadline exceeded')), 30000);
        const error = () => { clearTimeout(timer); reject(new Error('Frozen application unavailable')); };
        child.once('error', error); child.once('exit', error);
        child.on('message', message => {
          const value = message as Partial<ServiceReady> | null;
          if (value?.kind === 'ready' && value.candidateId === candidateId && value.authority?.epoch === authority.epoch && value.authority.generation === authority.generation && value.authority.controlRevision === authority.controlRevision && value.address && Number.isSafeInteger(value.address.port)) { ready = true; clearTimeout(timer); child.off('error', error); child.off('exit', error); resolve(value as ServiceReady); }
          else error();
        });
        child.send({ kind: 'start', mode: this.options.mode, bindings: this.host, candidateId, authority, secrets: this.secrets, ...(evolution ? { evolution } : {}) }, failure => { if (failure) error(); });
      });
    } catch (error) {
      try { writeDiagnostic(this.host.stateDirectory, { candidateId, at: new Date().toISOString(), diagnostic: diagnostic.toString('utf8') }); }
      catch { /* Failure to retain private diagnostics must never prevent cleanup. */ }
      finally { await this.stop(); }
      throw error;
    }
  }
  async stop(): Promise<void> {
    const child = this.child; if (!child) return;
    this.stopping = true;
    if (child.connected) child.send({ kind: 'stop' }, () => {});
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([this.closed, new Promise<void>(resolve => { timer = setTimeout(resolve, 5000); })]);
    if (timer) clearTimeout(timer);
    if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; } await this.closed; }
    this.child = undefined; this.closed = undefined;
  }
}
