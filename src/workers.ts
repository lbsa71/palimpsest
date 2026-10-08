import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import { runIsolated } from './isolation.ts';
import type { IsolationResult } from './isolation.ts';
import type { CompletionRequest } from './providers.ts';
import type { Json, Memory, Task } from './store.ts';

export interface WorkerPeer { pid: number; instanceId: string }
export interface WorkerCheckpoint { sequence: number; snapshot: Json; policyVersion: string }
export interface WorkerOptions {
  candidateRoot: string;
  instanceId?: string;
  /** Cold process/module initialization allowance, independent of steady RPC. */
  startupTimeoutMs?: number;
  rpcTimeoutMs?: number;
  lifetimeMs?: number;
  /** One real conversation per process; omitted means the first request binds it. */
  scope?: string;
  authorize?: (peer: WorkerPeer) => void;
}
interface Pending { resolve: (result: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }

function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function conversationScope(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) throw new Error('Invalid worker conversation scope');
  return value;
}
function descriptor(value: unknown): CompletionRequest {
  if (!object(value) || Object.keys(value).some(key => !['system', 'prompt', 'maxOutputTokens'].includes(key)) ||
      typeof value.system !== 'string' || typeof value.prompt !== 'string' || !value.prompt.trim() ||
      Buffer.byteLength(value.system) + Buffer.byteLength(value.prompt) > 65_536 ||
      (value.maxOutputTokens !== undefined && (!Number.isSafeInteger(value.maxOutputTokens) || Number(value.maxOutputTokens) < 1 || Number(value.maxOutputTokens) > 4096))) {
    throw new Error('Invalid worker completion request');
  }
  return { system: value.system, prompt: value.prompt, maxOutputTokens: Number(value.maxOutputTokens ?? 2048) };
}

/** Trusted supervisor mapping actual private child streams to opaque custody. */
export class AgentWorker {
  readonly #options: WorkerOptions;
  readonly #controller = new AbortController();
  readonly #pending = new Map<string, Pending>();
  #child?: ChildProcess;
  #peer?: Readonly<WorkerPeer>;
  #completion?: Promise<IsolationResult | undefined>;
  #closed = false;
  #buffer = '';
  readonly #decoder = new StringDecoder('utf8');
  #sequence = 0;
  #scope?: string;
  #checkpointScope?: string;

  private constructor(options: WorkerOptions) {
    for (const timeout of [options.startupTimeoutMs ?? 3000, options.rpcTimeoutMs ?? 3000]) {
      if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2_147_483_647) throw new Error('Invalid worker deadline');
    }
    this.#options = options;
    if (options.scope !== undefined) this.#scope = conversationScope(options.scope);
  }

  static async start(options: WorkerOptions): Promise<AgentWorker> {
    const worker = new AgentWorker(options);
    const instanceId = options.instanceId ?? randomUUID();
    const harness = fileURLToPath(new URL('../trusted/agent-worker.mjs', import.meta.url));
    let spawned!: () => void; let failed!: (error: Error) => void;
    const available = new Promise<void>((resolve, reject) => { spawned = resolve; failed = reject; });
    worker.#completion = runIsolated({ program: process.execPath,
      args: ['--disable-warning=ExperimentalWarning', harness, join(options.candidateRoot, 'src/agent/brain.ts'), `--palimpsest-launch-id=${instanceId}`,
        ...(worker.#scope === undefined ? [] : [`--palimpsest-scope=${JSON.stringify(worker.#scope)}`])],
      cwd: options.candidateRoot, readPaths: [harness, options.candidateRoot],
      timeoutMs: options.lifetimeMs ?? 300_000, maxOutputBytes: 1_048_576, signal: worker.#controller.signal,
      keepStdinOpen: true, onSpawn(child) {
        if (!child.pid) throw new Error('Worker did not acquire an OS identity');
        worker.#child = child;
        worker.#peer = Object.freeze({ pid: child.pid, instanceId });
        child.stdin?.on('error', () => worker.#fail());
        spawned();
      }, onStdout(chunk) { worker.#receive(chunk); },
    }).then(result => { worker.#fail(); return result; }).catch(() => { failed(new Error('Restricted worker launch failed')); worker.#fail(); return undefined; });
    await available;
    try { const result = await worker.#call('ping', {}, options.startupTimeoutMs ?? 3000); if (!object(result) || result.alive !== true) throw new Error('Invalid worker handshake'); }
    catch (error) { await worker.stop(); throw error; }
    return worker;
  }

  get peer(): Readonly<WorkerPeer> { if (!this.#peer) throw new Error('Worker not started'); return this.#peer; }
  get sequence(): number { return this.#sequence; }
  get closed(): boolean { return this.#closed; }
  get scope(): string | undefined { return this.#scope; }

  async request(task: Task, memories: Memory[]): Promise<CompletionRequest> {
    this.#options.authorize?.(this.peer);
    const scope = conversationScope(task.conversationId);
    if (this.#scope !== undefined && this.#scope !== scope) throw new Error('Worker conversation scope mismatch');
    if (!Array.isArray(memories) || memories.some(memory => memory.scope !== scope)) throw new Error('Worker memory scope mismatch');
    if (this.#scope === undefined && this.#checkpointScope !== scope) { this.#sequence = 0; this.#checkpointScope = undefined; }
    this.#scope ??= scope;
    const result = await this.#call('request', { task, memories });
    if (this.#closed) throw new Error('Worker became unavailable');
    this.#options.authorize?.(this.peer);
    try { return descriptor(result); } catch (error) { this.#fail(); throw error; }
  }

  async catchUp(checkpoint: WorkerCheckpoint): Promise<void> {
    if (!Number.isSafeInteger(checkpoint.sequence) || checkpoint.sequence < this.#sequence || !checkpoint.policyVersion) throw new Error('Invalid worker checkpoint');
    if (!object(checkpoint.snapshot)) throw new Error('Worker checkpoint requires a conversation scope');
    const scope = conversationScope(checkpoint.snapshot.scope);
    if (this.#scope !== undefined && scope !== this.#scope) throw new Error('Worker checkpoint scope mismatch');
    const result = await this.#call('catchUp', checkpoint);
    if (!object(result) || result.sequence !== checkpoint.sequence) { this.#fail(); throw new Error('Worker checkpoint not acknowledged'); }
    this.#sequence = checkpoint.sequence;
    this.#checkpointScope = scope;
  }

  /** Trusted health path exercises source behavior without inference/production authority. */
  async probe(): Promise<'healthy' | 'failed'> {
    const input = `health:${randomUUID()}`;
    const task: Task = { id: 'health', conversationId: 'health', input, source: 'direct', state: 'running',
      checkpoint: null, output: null, error: null, createdAt: 'probe', updatedAt: 'probe' };
    try {
      const result = descriptor(await this.#call('probe', { task, memories: [] }));
      if (this.#closed || JSON.parse(result.prompt).request !== input) throw new Error('Worker behavioral health failed');
      return 'healthy';
    } catch { this.#fail(); return 'failed'; }
  }

  #call(method: string, payload: unknown, timeoutMs = this.#options.rpcTimeoutMs ?? 3000): Promise<unknown> {
    if (this.#closed || !this.#child?.stdin?.writable) return Promise.reject(new Error('Worker is unavailable'));
    const id = randomUUID(); const line = JSON.stringify({ id, method, payload }) + '\n';
    if (Buffer.byteLength(line) > 262_144) return Promise.reject(new Error('Worker input exceeds limit'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.#fail(), timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      this.#child!.stdin!.write(line);
    });
  }

  #receive(chunk: Buffer): void {
    this.#buffer += this.#decoder.write(chunk);
    if (Buffer.byteLength(this.#buffer) > 131_072) { this.#fail(); return; }
    for (;;) {
      const end = this.#buffer.indexOf('\n'); if (end < 0) return;
      const line = this.#buffer.slice(0, end); this.#buffer = this.#buffer.slice(end + 1);
      let response: unknown;
      try { response = JSON.parse(line); } catch { this.#fail(); return; }
      if (!object(response) || typeof response.id !== 'string' || Object.keys(response).some(key => !['id', 'result', 'error'].includes(key))) { this.#fail(); return; }
      const pending = this.#pending.get(response.id);
      if (!pending || response.error !== undefined) { this.#fail(); return; }
      this.#pending.delete(response.id); clearTimeout(pending.timer); pending.resolve(response.result);
    }
  }

  #fail(): void {
    this.#closed = true; this.#controller.abort();
    for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Worker failed or its response deadline expired')); }
    this.#pending.clear();
  }

  async stop(): Promise<void> { this.#fail(); await this.#completion; }
}
