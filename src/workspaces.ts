import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, fchmodSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveExternalPath } from './config.ts';
import { runIsolated } from './isolation.ts';
import type { Json } from './store.ts';
import { Store } from './store.ts';
import { CoordinatorLock } from './ownership.ts';
import type { WorkspaceOperation as HelperOperation, WorkspaceResponse } from '../trusted/workspace-files.mjs';

export interface WorkspaceFileInput { path: string; content: Uint8Array; mode: 0o644 | 0o755 }
export interface WorkspaceFile { path: string; sha256: string; bytes: number; mode: number }
export interface WorkspaceBase { releaseDigest: string; baseCommit: string; treeDigest: string }
export interface WorkspaceRecord {
  version: 1; id: string; taskId: string; epoch: number; base: WorkspaceBase; files: WorkspaceFile[];
  device: number; inode: number;
}
export interface WorkspaceAuthority { taskId: string; workspaceId: string; epoch: number }
export type WorkspaceOperation = Exclude<HelperOperation, { kind: 'observe' }>;
export type WorkspaceReply = WorkspaceResponse;
interface WriterClaim { version: 1; operationId: string; ownerPid: number; ownerNonce: string; pid: number | null }
interface WorkspaceOptions {
  store: Store; directory: string; repositoryRoot: string;
  /** Mandatory trusted policy receiver; not a model-provided authorization. */
  authorize: (authority: WorkspaceAuthority) => boolean;
}

const helper = fileURLToPath(new URL('../trusted/workspace-files.mjs', import.meta.url));
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const limits = Object.freeze({ maxFiles: 4096, maxTotalBytes: 33_554_432, maxFileBytes: 1_048_576, maxResponseBytes: 1_048_576, maxResults: 100 });
const mutations = new Set(['create', 'replace', 'edit', 'delete', 'move', 'mkdir', 'rmdir']);
const object = (value: Json): Record<string, Json> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};

function validPath(path: string): void {
  if (typeof path !== 'string' || Buffer.from(path, 'utf8').toString('utf8') !== path || Buffer.byteLength(path) > 1024 || path.split('/').length > 64 || /[\u0000-\u001f\u007f-\u009f\\]/u.test(path)
    || path.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) throw new Error('Invalid workspace relative path');
}

function inputManifest(files: WorkspaceFileInput[]): WorkspaceFile[] {
  if (!Array.isArray(files) || files.length > limits.maxFiles) throw new Error('Workspace source exceeds file limit');
  const names = new Set<string>(); const directories = new Set<string>(); let total = 0;
  const result = files.map(file => {
    validPath(file.path);
    const key = file.path.normalize('NFC').toLocaleLowerCase('en-US');
    if (names.has(key)) throw new Error('Duplicate workspace source path or filesystem collision');
    names.add(key);
    if (!(file.content instanceof Uint8Array) || ![0o644, 0o755].includes(file.mode)) throw new Error('Invalid regular source file or mode');
    total += file.content.byteLength;
    if (file.content.byteLength > limits.maxFileBytes || total > limits.maxTotalBytes) throw new Error('Workspace source exceeds byte limit');
    return { path: file.path, sha256: sha(file.content), bytes: file.content.byteLength, mode: file.mode };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  for (const name of names) {
    const parts = name.split('/');
    while (parts.length > 1) {
      parts.pop(); const path = parts.join('/');
      if (names.has(path)) throw new Error('Workspace file/directory path collision');
      directories.add(path);
    }
  }
  const directoryNames = new Map<string, string>();
  for (const file of files) {
    const parts = file.path.split('/');
    while (parts.length > 1) {
      parts.pop(); const path = parts.join('/'); const key = path.normalize('NFC').toLocaleLowerCase('en-US');
      const prior = directoryNames.get(key);
      if (prior !== undefined && prior !== path) throw new Error('Workspace source directory alias collision');
      directoryNames.set(key, path);
    }
  }
  if (names.size + directories.size > limits.maxFiles) throw new Error('Workspace source exceeds entry limit');
  return result;
}

/** Full-tree identity for the explicit verified file import, not the legacy
 * cognitive-only sourceDigest. Import source verification belongs to the host. */
export function workspaceTreeDigest(files: WorkspaceFileInput[]): string { return sha(JSON.stringify(inputManifest(files))); }

function durableWrite(path: string, content: string | Uint8Array, flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, mode = 0o600): void {
  const fd = openSync(path, flags | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, content); fchmodSync(fd, mode); fsyncSync(fd); }
  finally { closeSync(fd); }
}
function flushDirectory(path: string): void {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

/** Host-only receiver. Its effect records/claims are outside the writable tree.
 * No model loop, command runner or serving route uses this backend yet. */
export class CodingWorkspaces {
  #options: WorkspaceOptions;
  #directory: string;
  #directoryIdentity: { device: number; inode: number };
  #ownership: CoordinatorLock;
  #ownerNonce = randomUUID();
  #active = new Map<string, { controller: AbortController; drained: Promise<unknown> }>();
  #stopped = false;

  constructor(options: WorkspaceOptions) {
    if (typeof options.authorize !== 'function') throw new Error('Workspace receiver requires trusted authority');
    this.#options = options;
    this.#directory = resolveExternalPath(options.repositoryRoot, options.directory);
    mkdirSync(this.#directory, { recursive: true, mode: 0o700 });
    const stat = lstatSync(this.#directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error('Workspace collection must be a private directory');
    this.#directory = realpathSync(this.#directory);
    this.#directoryIdentity = { device: stat.dev, inode: stat.ino };
    // OS-released coordinator exclusion and persistent child claims answer
    // different questions: a crash releases this lock, but not its writer claim.
    this.#ownership = new CoordinatorLock(join(this.#directory, 'coordinator.sqlite'));
  }

  workspace(id: string): WorkspaceRecord {
    const events = this.#options.store.listEvents().filter(event => ['workspace.created', 'workspace.adopted'].includes(event.type)
      && object(event.payload).id === id);
    if (!events.length) throw new Error('Unknown workspace identity');
    return structuredClone(events.at(-1)!.payload) as unknown as WorkspaceRecord;
  }
  controlPath(id: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid workspace identity');
    return join(this.#directory, id);
  }
  path(id: string): string { this.workspace(id); return join(this.controlPath(id), 'tree'); }

  #authority(record: WorkspaceAuthority, running = true): void {
    const task = this.#options.store.task(record.taskId);
    if (this.#stopped || !task || task.source === 'peer' || task.conversationId.startsWith('peer:')
      || (running && task.state !== 'running') || !this.#options.authorize(structuredClone(record))) throw new Error('Coding workspace authority revoked or unavailable');
  }
  #identity(record?: WorkspaceRecord): void {
    const collection = lstatSync(this.#directory);
    if (!collection.isDirectory() || collection.isSymbolicLink() || collection.dev !== this.#directoryIdentity.device
      || collection.ino !== this.#directoryIdentity.inode) throw new Error('Workspace collection identity changed');
    if (!record) return;
    for (const path of [this.controlPath(record.id), join(this.controlPath(record.id), 'staging')]) {
      const stat = lstatSync(path);
      if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error('Workspace control directory changed');
    }
    const root = lstatSync(this.path(record.id));
    if (!root.isDirectory() || root.isSymbolicLink() || root.dev !== record.device || root.ino !== record.inode) throw new Error('Workspace root identity changed');
  }

  create(input: { taskId: string; epoch: number; base: WorkspaceBase; files: WorkspaceFileInput[] }): WorkspaceRecord {
    const id = randomUUID();
    if (!Number.isSafeInteger(input.epoch) || input.epoch < 0) throw new Error('Invalid authority epoch');
    this.#authority({ taskId: input.taskId, workspaceId: id, epoch: input.epoch }); this.#identity();
    const imported = input.files.map(file => ({ ...file, content: Buffer.from(file.content) }));
    const files = inputManifest(imported);
    if (!/^[a-f0-9]{64}$/.test(input.base.releaseDigest) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(input.base.baseCommit)
      || sha(JSON.stringify(files)) !== input.base.treeDigest) throw new Error('Workspace source/base digest mismatch');
    const control = this.controlPath(id), tree = join(control, 'tree');
    mkdirSync(control, { mode: 0o700 });
    try {
      mkdirSync(tree, { mode: 0o700 }); mkdirSync(join(control, 'staging'), { mode: 0o700 });
      const directories = new Set([tree, join(control, 'staging'), control, this.#directory]);
      for (const file of imported) {
        const target = join(tree, file.path); mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
        durableWrite(target, file.content, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, file.mode);
        for (let parent = dirname(target); parent !== control; parent = dirname(parent)) directories.add(parent);
      }
      for (const path of [...directories].sort((a, b) => b.length - a.length)) flushDirectory(path);
      this.#authority({ taskId: input.taskId, workspaceId: id, epoch: input.epoch });
      const stat = lstatSync(tree);
      const record: WorkspaceRecord = { version: 1, id, taskId: input.taskId, epoch: input.epoch, base: structuredClone(input.base), files, device: stat.dev, inode: stat.ino };
      this.#options.store.appendEvent('workspace.created', record as unknown as Json, input.taskId);
      return structuredClone(record);
    } catch (error) { rmSync(control, { force: true, recursive: true }); throw error; }
  }

  adopt(id: string, epoch: number): WorkspaceRecord {
    const record = this.workspace(id);
    if (!Number.isSafeInteger(epoch) || epoch < record.epoch) throw new Error('Invalid workspace authority epoch');
    this.#authority({ taskId: record.taskId, workspaceId: id, epoch }, false); this.#identity(record);
    this.#clearStoppedClaim(id);
    const next = { ...record, epoch };
    this.#options.store.appendEvent('workspace.adopted', next as unknown as Json, record.taskId);
    return structuredClone(next);
  }

  #claim(record: WorkspaceRecord, operationId: string): { path: string; value: WriterClaim } {
    const path = join(this.controlPath(record.id), 'writer.json');
    const value: WriterClaim = { version: 1, operationId, ownerPid: process.pid, ownerNonce: this.#ownerNonce, pid: null };
    try { durableWrite(path, JSON.stringify(value)); flushDirectory(this.controlPath(record.id)); }
    catch { throw new Error('Workspace writer busy or requires recovery'); }
    return { path, value };
  }

  #clearStoppedClaim(id: string, effectId?: string): void {
    const path = join(this.controlPath(id), 'writer.json');
    if (!existsSync(path)) return;
    const claim = JSON.parse(readFileSync(path, 'utf8')) as WriterClaim;
    if (claim.version !== 1 || typeof claim.ownerNonce !== 'string' || !claim.ownerNonce || (effectId && claim.operationId !== effectId)
      || !Number.isSafeInteger(claim.ownerPid) || claim.ownerPid <= 0 || !Number.isSafeInteger(claim.pid) || claim.pid! <= 0) throw new Error('Workspace writer claim lacks proven termination');
    for (const pid of [claim.ownerPid, claim.pid!]) {
      try { process.kill(pid, 0); throw new Error('Prior workspace coordinator or writer still exists'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    }
    rmSync(path); flushDirectory(this.controlPath(id));
  }

  async #run(record: WorkspaceRecord, operationId: string, operation: HelperOperation, controller: AbortController, claim: { path: string; value: WriterClaim }, helperDigest: string, expectedOperationDigest?: string): Promise<WorkspaceReply> {
    // Helper identity and grants are trusted orchestration, never wire input.
    const helperStat = lstatSync(helper);
    if (!helperStat.isFile() || helperStat.isSymbolicLink() || helperStat.nlink !== 1) throw new Error('Invalid trusted workspace helper');
    if (!/^[a-f0-9]{64}$/.test(helperDigest) || sha(readFileSync(helper)) !== helperDigest) throw new Error('Trusted workspace helper identity changed');
    const request = JSON.stringify({ version: 1, operationId: sha(operationId), limits, operation, ...(expectedOperationDigest ? { expectedOperationDigest } : {}) });
    const result = await runIsolated({ program: process.execPath, args: [helper, this.path(record.id), join(this.controlPath(record.id), 'staging')],
      cwd: this.path(record.id), readPaths: [helper, join(this.controlPath(record.id), 'staging')], writePaths: [this.path(record.id), join(this.controlPath(record.id), 'staging')],
      stdin: request, signal: controller.signal, timeoutMs: 10_000, maxOutputBytes: limits.maxResponseBytes,
      onSpawn: child => {
        claim.value.pid = child.pid ?? null;
        const update = `${claim.path}.${this.#ownerNonce}`;
        durableWrite(update, JSON.stringify(claim.value)); renameSync(update, claim.path); flushDirectory(this.controlPath(record.id));
      } });
    if (result.exitCode !== 0 || result.timedOut || result.aborted || result.outputLimitExceeded || sha(readFileSync(helper)) !== helperDigest) throw new Error('Workspace helper failed or outcome unknown');
    const response: unknown = JSON.parse(result.stdout);
    if (!response || typeof response !== 'object' || Array.isArray(response) || typeof (response as WorkspaceReply).ok !== 'boolean') throw new Error('Invalid workspace helper response');
    const envelope = response as Record<string, unknown>;
    if (envelope.ok ? Object.keys(envelope).sort().join(',') !== 'ok,result' || !envelope.result || typeof envelope.result !== 'object'
      : Object.keys(envelope).some(key => !['ok', 'code', 'conflict'].includes(key)) || typeof envelope.code !== 'string' || !/^[a-z][a-z-]{0,63}$/.test(envelope.code)) throw new Error('Invalid workspace helper envelope');
    return response as WorkspaceReply;
  }

  async perform(id: string, epoch: number, effectId: string, operation: WorkspaceOperation): Promise<WorkspaceReply> {
    operation = structuredClone(operation);
    const record = this.workspace(id);
    if (epoch !== record.epoch) throw new Error('Stale workspace authority epoch');
    this.#authority({ taskId: record.taskId, workspaceId: id, epoch }); this.#identity(record);
    if (!effectId || effectId.length > 256 || !operation || !['manifest', 'list', 'search', 'read', ...mutations].includes(operation.kind)) throw new Error('Invalid workspace operation');
    const prior = this.#options.store.effect(effectId);
    const helperDigest = prior ? String(object(prior.payload).helperDigest) : sha(readFileSync(helper));
    const payload = { workspaceId: id, epoch, baseTreeDigest: record.base.treeDigest, helperDigest, operation } as unknown as Json;
    if (Buffer.byteLength(JSON.stringify({ version: 1, operationId: sha(effectId), limits, operation })) > 1_048_576) throw new Error('Workspace request exceeds input limit');
    if (prior) {
      if (prior.taskId !== record.taskId || prior.kind !== 'workspace.files' || JSON.stringify(prior.payload) !== JSON.stringify(payload)) throw new Error('Workspace effect identity conflict');
      if (prior.state !== 'completed') throw new Error('Workspace operation requires reconciliation; never replay');
      return structuredClone(prior.result) as unknown as WorkspaceReply;
    }
    if (mutations.has(operation.kind) && this.#options.store.listEffects(record.taskId).some(effect => effect.state !== 'completed' && object(effect.payload).workspaceId === id)) throw new Error('Workspace has uncertain effects requiring reconciliation');
    const claim = this.#claim(record, effectId);
    const controller = new AbortController();
    let reserved = false;
    const drained = Promise.resolve().then(async () => {
      try {
        this.#authority({ taskId: record.taskId, workspaceId: id, epoch }); this.#identity(record);
        this.#options.store.reserveEffect({ id: effectId, taskId: record.taskId, kind: 'workspace.files', payload }); reserved = true;
        const response = await this.#run(record, effectId, operation, controller, claim, helperDigest);
        this.#authority({ taskId: record.taskId, workspaceId: id, epoch }); this.#identity(record);
        if (!response.ok && mutations.has(operation.kind)) {
          const observed = await this.#run(record, effectId, { kind: 'observe' }, controller, claim, helperDigest, sha(JSON.stringify(operation)));
          const status = observed.ok ? object(observed.result as unknown as Json).status : undefined;
          if (!observed.ok || !['not-staged', 'not-completed'].includes(String(status))) throw new Error('Workspace mutation outcome requires reconciliation');
        }
        this.#authority({ taskId: record.taskId, workspaceId: id, epoch }); this.#identity(record);
        this.#options.store.completeEffect(effectId, response as unknown as Json);
        return response;
      } catch (error) {
        if (reserved) this.#options.store.markEffectUnknown(effectId, 'Workspace operation interrupted, revoked or outcome not verified');
        throw error;
      } finally { rmSync(claim.path); flushDirectory(this.controlPath(id)); this.#active.delete(id); }
    });
    this.#active.set(id, { controller, drained });
    return await drained;
  }

  async reconcile(id: string, epoch: number, effectId: string): Promise<{ status: string }> {
    const record = this.workspace(id);
    if (record.epoch !== epoch) throw new Error('Stale workspace authority epoch');
    this.#authority({ taskId: record.taskId, workspaceId: id, epoch }, false); this.#identity(record);
    const effect = this.#options.store.effect(effectId);
    if (!effect || effect.kind !== 'workspace.files' || effect.taskId !== record.taskId || object(effect.payload).workspaceId !== id) throw new Error('Unknown workspace effect');
    if (effect.state === 'completed') return { status: 'completed' };
    this.#clearStoppedClaim(id, effectId);
    const claim = this.#claim(record, effectId); const controller = new AbortController();
    const drained = Promise.resolve().then(async () => {
      try {
        const recordedOperation = object(effect.payload).operation;
        const observed = await this.#run(record, effectId, { kind: 'observe' }, controller, claim, String(object(effect.payload).helperDigest), sha(JSON.stringify(recordedOperation)));
        this.#authority({ taskId: record.taskId, workspaceId: id, epoch }, false); this.#identity(record);
        const status = observed.ok ? object(observed.result as unknown as Json).status : undefined;
        if (!observed.ok || !['completed', 'not-completed', 'not-staged', 'uncertain'].includes(String(status))) throw new Error('Invalid workspace reconciliation result');
        if (status !== 'uncertain') this.#options.store.completeEffect(effectId, status === 'completed' && observed.ok ? { ok: true, result: observed.result as unknown as Json } : { ok: false, code: 'not_applied' });
        return { status: String(status) };
      } finally { rmSync(claim.path); flushDirectory(this.controlPath(id)); this.#active.delete(id); }
    });
    this.#active.set(id, { controller, drained });
    return await drained;
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    const active = [...this.#active.values()];
    for (const item of active) item.controller.abort();
    await Promise.allSettled(active.map(item => item.drained));
    this.#ownership.close();
  }
}
