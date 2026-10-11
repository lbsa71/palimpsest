import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { invariant } from '../packages/contracts/index.ts';
import type { Authority } from '../packages/contracts/index.ts';
import { verifyApplication } from './candidate.ts';
import type { HostBindings } from './materialize.ts';
import type { ApplicationSecrets } from './config.ts';

export interface ServiceReady { kind: 'ready'; candidateId: string; authority: Authority; address: { address: string; family: string; port: number } }
export interface ServiceProcessOptions { mode: 'engineering' | 'product'; onUnexpectedExit?: () => void }
/** The supervisor holds its own lease; each application holds the separate execution lease. */
export class ServiceProcess {
  readonly host: HostBindings; readonly secrets: ApplicationSecrets;
  private child?: ChildProcess; private closed?: Promise<void>;
  private stopping = false;
  readonly options: ServiceProcessOptions;
  constructor(host: HostBindings, secrets: ApplicationSecrets, options: ServiceProcessOptions = { mode: 'product' }) { this.host = host; this.secrets = secrets; this.options = options; }
  get running(): boolean { return !!this.child && this.child.exitCode === null && this.child.signalCode === null; }
  get processId(): number | undefined { return this.running ? this.child?.pid : undefined; }
  async start(candidateId: string, authority: Authority): Promise<ServiceReady> {
    invariant(!this.child, 'Stop the current application before starting a successor');
    const candidate = verifyApplication(this.host.artifactStore, candidateId, this.host.nodeBinary);
    invariant(this.options.mode === 'engineering' || (candidate.inputs.configuration as { resourceLimits?: unknown }).resourceLimits && this.host.cgroupRoot, 'Product startup requires enforced kernel resource ceilings');
    const entrypoint = join(this.host.artifactStore, candidateId, 'payload/deployment/service-child.ts');
    const child = spawn(this.host.nodeBinary, [entrypoint], { detached: true, env: { PATH: '/usr/bin:/bin', NODE_NO_WARNINGS: '1' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    this.child = child; this.stopping = false;
    let diagnostic = ''; child.stderr?.on('data', (chunk: Buffer) => { if (Buffer.byteLength(diagnostic) < 32768) diagnostic += chunk.toString('utf8').slice(0, 32768 - diagnostic.length); });
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
        child.send({ kind: 'start', mode: this.options.mode, bindings: this.host, candidateId, authority, secrets: this.secrets }, failure => { if (failure) error(); });
      });
    } catch (error) { const directory = join(this.host.stateDirectory, 'host-diagnostics'); mkdirSync(directory, { recursive: true, mode: 0o700 }); writeFileSync(join(directory, `${randomUUID()}.json`), JSON.stringify({ candidateId, at: new Date().toISOString(), diagnostic }), { mode: 0o600, flag: 'wx' }); await this.stop(); throw error; }
  }
  async stop(): Promise<void> {
    const child = this.child; if (!child) return;
    this.stopping = true;
    if (child.connected) child.send({ kind: 'stop' }, () => {});
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([this.closed, new Promise<void>(resolve => { timer = setTimeout(resolve, 5000); })]);
    if (timer) clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null && child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; } await this.closed; }
    this.child = undefined; this.closed = undefined;
  }
}
