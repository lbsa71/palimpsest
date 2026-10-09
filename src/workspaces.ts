import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, constants, existsSync, fchmodSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveExternalPath } from './config.ts';
import { runIsolated } from './isolation.ts';
import type { Json } from './store.ts';
import { Store } from './store.ts';
import { CoordinatorLock } from './ownership.ts';
import { verifyFrozenCandidate, type CandidateRuntime } from './candidates.ts';
import { readWorkspaceCommandOutput, runWorkspaceCommand, type WorkspaceCommand, type WorkspaceCommandReceipt, type WorkspaceCommandPage } from './workspace-command.ts';
import type { WorkspaceOperation as HelperOperation, WorkspaceResponse, WorkspaceCheckpoint, WorkspaceCheckpointPage } from '../trusted/workspace-files.mjs';

export interface WorkspaceFileInput { path: string; content: Uint8Array; mode: 0o644 | 0o755 }
export interface WorkspaceFile { path: string; sha256: string; bytes: number; mode: number }
export interface WorkspaceBase { releaseDigest: string; baseCommit: string; treeDigest: string }
export interface WorkspaceRecord {
  version: 1; id: string; taskId: string; epoch: number; base: WorkspaceBase; files: WorkspaceFile[];
  device: number; inode: number;
  restoration?: { workspaceId: string; commandId: string; checkpointDigest: string; draftTreeDigest: string };
}
export interface WorkspaceAuthority { taskId: string; workspaceId: string; epoch: number }
export type WorkspaceOperation = Exclude<HelperOperation, { kind: 'observe' | 'checkpoint' | 'checkpoint-read' }>;
export type WorkspaceReply = WorkspaceResponse;
export interface WorkspaceCommandObservation {
  commandId: string;
  exit: WorkspaceCommandReceipt['exit'] | { kind: 'unknown' };
  exitSuccessful: boolean; outputComplete: boolean; workspaceUsable: boolean;
  afterTreeDigest?: string;
  streams?: { stdout: { bytes: number; sha256: string }; stderr: { bytes: number; sha256: string } };
}
interface CommandResult { observation: WorkspaceCommandObservation; receipt?: WorkspaceCommandReceipt }
interface WriterClaim { version: 1; operationId: string; ownerPid: number; ownerNonce: string; pid: number | null }
interface WorkspaceOptions {
  store: Store; directory: string; repositoryRoot: string;
  /** Mandatory trusted policy receiver; not a model-provided authorization. */
  authorize: (authority: WorkspaceAuthority) => boolean;
  /** Independently selected frozen host profile, not a candidate-selected path. */
  runtimeRelease?: { releaseDir: string; digest: string };
  runtime?: CandidateRuntime;
  /** If supplied, must exactly match the installed compiler's package root. */
  toolchainReadPaths?: string[];
  maxCommands?: number; maxWorkspaces?: number;
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
 * File and staged command primitives are available to trusted host callers; no
 * model loop or serving route uses this backend yet. */
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
    // Runtime/grants are immutable per receiver, while trusted policy remains a
    // live lookup so revocation (including replacement of the policy callback)
    // is observed after each asynchronous boundary.
    this.#options = { ...options, authorize: authority => options.authorize(authority), ...(options.runtime ? { runtime: structuredClone(options.runtime) } : {}),
      ...(options.runtimeRelease ? { runtimeRelease: structuredClone(options.runtimeRelease) } : {}),
      ...(options.toolchainReadPaths ? { toolchainReadPaths: [...options.toolchainReadPaths] } : {}) };
    for (const [value, maximum] of [[options.maxCommands ?? 16, 16], [options.maxWorkspaces ?? 8, 8]]) {
      if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error('Invalid workspace retention limit');
    }
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
    return this.#create(input);
  }

  #create(input: { taskId: string; epoch: number; base: WorkspaceBase; files: WorkspaceFileInput[] }, restoration?: {
    original: WorkspaceRecord; commandId: string; checkpoint: WorkspaceCheckpoint;
  }): WorkspaceRecord {
    const id = randomUUID();
    if (!Number.isSafeInteger(input.epoch) || input.epoch < 0) throw new Error('Invalid authority epoch');
    this.#authority({ taskId: input.taskId, workspaceId: id, epoch: input.epoch }); this.#identity();
    const imported = input.files.map(file => ({ ...file, content: Buffer.from(file.content) }));
    const files = inputManifest(imported);
    const expectedTree = restoration?.checkpoint.treeDigest ?? input.base.treeDigest;
    if (!/^[a-f0-9]{64}$/.test(input.base.releaseDigest) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(input.base.baseCommit)
      || sha(JSON.stringify(files)) !== expectedTree
      || (restoration && (sha(JSON.stringify(restoration.original.files)) !== input.base.treeDigest
        || JSON.stringify(restoration.original.base) !== JSON.stringify(input.base)))) throw new Error('Workspace source/base digest mismatch');
    // Retained copies, including abandoned/partial controls, count until an
    // explicit future retention procedure removes them; restart never refunds.
    if (readdirSync(this.#directory).filter(name => /^[a-f0-9-]{36}$/.test(name)).length >= (this.#options.maxWorkspaces ?? 8)) throw new Error('Workspace retention limit reached');
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
      if (restoration) {
        const checkpoint = restoration.checkpoint;
        if (![0o700, 0o755].includes(checkpoint.rootMode) || sha(JSON.stringify(files)) !== checkpoint.treeDigest
          || sha(JSON.stringify({ files, directories: checkpoint.directories, rootMode: checkpoint.rootMode })) !== checkpoint.fullTreeDigest) throw new Error('Invalid checkpoint tree metadata');
        const aliases = new Map<string, string>();
        for (const directory of checkpoint.directories) {
          validPath(directory.path);
          const key = directory.path.normalize('NFC').toLocaleLowerCase('en-US');
          if (aliases.has(key) || ![0o700, 0o755].includes(directory.mode)) throw new Error('Invalid checkpoint directory');
          aliases.set(key, directory.path);
          const path = join(tree, directory.path); mkdirSync(path, { recursive: true, mode: 0o700 }); chmodSync(path, directory.mode); directories.add(path);
        }
        chmodSync(tree, checkpoint.rootMode);
      }
      for (const path of [...directories].sort((a, b) => b.length - a.length)) flushDirectory(path);
      this.#authority({ taskId: input.taskId, workspaceId: id, epoch: input.epoch });
      const stat = lstatSync(tree);
      const record: WorkspaceRecord = { version: 1, id, taskId: input.taskId, epoch: input.epoch, base: structuredClone(input.base),
        files: restoration ? structuredClone(restoration.original.files) : files, device: stat.dev, inode: stat.ino,
        ...(restoration ? { restoration: { workspaceId: restoration.original.id, commandId: restoration.commandId,
          checkpointDigest: restoration.checkpoint.checkpointDigest, draftTreeDigest: expectedTree } } : {}) };
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

  #claimPid(record: WorkspaceRecord, claim: { path: string; value: WriterClaim }, pid: number | null): void {
    claim.value.pid = pid;
    const update = `${claim.path}.${this.#ownerNonce}`;
    durableWrite(update, JSON.stringify(claim.value)); renameSync(update, claim.path); flushDirectory(this.controlPath(record.id));
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
    const checkpoint = operation.kind === 'checkpoint' || operation.kind === 'checkpoint-read';
    const request = JSON.stringify({ version: 1, operationId: sha(operationId), limits, operation,
      ...(checkpoint ? { expectedRoot: { device: record.device, inode: record.inode } } : {}), ...(expectedOperationDigest ? { expectedOperationDigest } : {}) });
    // Every process transition starts with an unknown writer, so a crash between
    // OS spawn and durable PID observation cannot inherit a dead predecessor PID.
    this.#claimPid(record, claim, null);
    const result = await runIsolated({ program: process.execPath, args: [helper, this.path(record.id), join(this.controlPath(record.id), 'staging')],
      cwd: join(this.controlPath(record.id), 'staging'),
      readPaths: [helper, this.path(record.id), join(this.controlPath(record.id), 'staging')],
      writePaths: operation.kind === 'checkpoint-read' ? [] : [this.path(record.id), join(this.controlPath(record.id), 'staging')],
      stdin: request, signal: controller.signal, timeoutMs: 10_000, maxOutputBytes: limits.maxResponseBytes,
      onSpawn: child => {
        this.#claimPid(record, claim, child.pid ?? null);
      } });
    if (result.exitCode !== 0 || result.timedOut || result.aborted || result.outputLimitExceeded || sha(readFileSync(helper)) !== helperDigest) throw new Error('Workspace helper failed or outcome unknown');
    const response: unknown = JSON.parse(result.stdout);
    if (!response || typeof response !== 'object' || Array.isArray(response) || typeof (response as WorkspaceReply).ok !== 'boolean') throw new Error('Invalid workspace helper response');
    const envelope = response as Record<string, unknown>;
    if (envelope.ok ? Object.keys(envelope).sort().join(',') !== 'ok,result' || !envelope.result || typeof envelope.result !== 'object'
      : Object.keys(envelope).some(key => !['ok', 'code', 'conflict'].includes(key)) || typeof envelope.code !== 'string' || !/^[a-z][a-z-]{0,63}$/.test(envelope.code)) throw new Error('Invalid workspace helper envelope');
    return response as WorkspaceReply;
  }

  #held(id: string): boolean { return this.#options.store.listEvents().some(event => event.type === 'workspace.held' && object(event.payload).workspaceId === id); }

  async perform(id: string, epoch: number, effectId: string, operation: WorkspaceOperation): Promise<WorkspaceReply> {
    operation = structuredClone(operation);
    const record = this.workspace(id);
    if (epoch !== record.epoch) throw new Error('Stale workspace authority epoch');
    this.#authority({ taskId: record.taskId, workspaceId: id, epoch }); this.#identity(record);
    if (this.#held(id)) throw new Error('Workspace held after invalid command tree');
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

  #commandRecord(id: string, epoch: number, running = true): WorkspaceRecord {
    const record = this.workspace(id);
    if (record.epoch !== epoch) throw new Error('Stale workspace authority epoch');
    this.#authority({ taskId: record.taskId, workspaceId: id, epoch }, running); this.#identity(record);
    return record;
  }

  #commandEffect(record: WorkspaceRecord, effectId: string) {
    const effect = this.#options.store.effect(effectId);
    if (!effect || effect.kind !== 'workspace.command' || effect.taskId !== record.taskId
      || object(effect.payload).workspaceId !== record.id || object(effect.payload).collectionDigest !== sha(this.#directory)) throw new Error('Unknown command identity or task conflict');
    return effect;
  }

  #commandDirectory(record: WorkspaceRecord, effectId: string): string { return join(this.controlPath(record.id), 'commands', sha(effectId)); }

  #runtimeProfile(): { runtime: CandidateRuntime; readPaths: string[] } {
    const { runtime, runtimeRelease } = this.#options;
    if (!runtime || !runtimeRelease || !/^[a-f0-9]{64}$/.test(runtimeRelease.digest)) throw new Error('Command runtime profile unavailable');
    const profile = verifyFrozenCandidate({ repositoryRoot: this.#options.repositoryRoot, releaseDir: runtimeRelease.releaseDir,
      expectedLegacyManifestDigest: runtimeRelease.digest, requireCurrentBase: false });
    if (profile.manifestDigest !== runtimeRelease.digest || JSON.stringify(profile.runtime) !== JSON.stringify(runtime)) throw new Error('Command runtime profile identity mismatch');
    const toolchain = realpathSync(dirname(dirname(dirname(dirname(runtime.compilerPath)))));
    if (this.#options.toolchainReadPaths && JSON.stringify(this.#options.toolchainReadPaths.map(path => realpathSync(path))) !== JSON.stringify([toolchain])) throw new Error('Command toolchain grants mismatch');
    return { runtime: structuredClone(runtime), readPaths: [toolchain] };
  }

  #sameProfile(expected: { runtime: CandidateRuntime; readPaths: string[] }): void {
    if (JSON.stringify(this.#runtimeProfile()) !== JSON.stringify(expected)) throw new Error('Command runtime profile changed');
  }

  #commandInput(effectId: string, command: WorkspaceCommand, options: { timeoutMs?: number; maxOutputBytes?: number }) {
    if (typeof effectId !== 'string' || !effectId || Buffer.byteLength(effectId) > 256 || /[\u0000-\u001f\u007f-\u009f]/u.test(effectId)
      || Buffer.from(effectId).toString('utf8') !== effectId) throw new Error('Invalid command identity');
    if (!command || !['node', 'native-tsc'].includes(command.tool) || Object.keys(command).some(key => !['tool', 'args', 'cwd'].includes(key))
      || !Array.isArray(command.args) || command.args.length > 256 || command.args.some(arg => typeof arg !== 'string' || arg.includes('\0')
        || Buffer.from(arg).toString('utf8') !== arg || Buffer.byteLength(arg) > 16384) || Buffer.byteLength(JSON.stringify(command.args)) > 65536) throw new Error('Invalid command arguments');
    if (command.cwd !== undefined && command.cwd !== '.') validPath(command.cwd);
    if (!options || Object.keys(options).some(key => !['timeoutMs', 'maxOutputBytes'].includes(key))) throw new Error('Invalid command limits');
    const timeoutMs = options.timeoutMs === undefined ? 30000 : options.timeoutMs;
    const maxOutputBytes = options.maxOutputBytes === undefined ? 1048576 : options.maxOutputBytes;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000 || !Number.isSafeInteger(maxOutputBytes)
      || maxOutputBytes < 1 || maxOutputBytes > 1048576) throw new Error('Invalid command limits');
    return { command: structuredClone(command), limits: { timeoutMs, maxOutputBytes } };
  }

  #observation(commandId: string, treeDigest?: string, receipt?: WorkspaceCommandReceipt): WorkspaceCommandObservation {
    return { commandId, exit: receipt ? structuredClone(receipt.exit) : { kind: 'unknown' },
      exitSuccessful: receipt?.exitSuccessful ?? false, outputComplete: receipt?.outputComplete ?? false,
      workspaceUsable: treeDigest !== undefined, ...(treeDigest ? { afterTreeDigest: treeDigest } : {}),
      ...(receipt ? { streams: { stdout: { bytes: receipt.streams.stdout.bytes, sha256: receipt.streams.stdout.sha256 },
        stderr: { bytes: receipt.streams.stderr.bytes, sha256: receipt.streams.stderr.sha256 } } } : {}) };
  }

  async #tree(record: WorkspaceRecord, effectId: string, controller: AbortController, claim: { path: string; value: WriterClaim }, helperDigest: string): Promise<string | undefined> {
    const result = await this.#run(record, effectId, { kind: 'manifest' }, controller, claim, helperDigest);
    if (!result.ok || !('files' in result.result)) return undefined;
    return sha(JSON.stringify(result.result.files));
  }

  #hold(record: WorkspaceRecord, effectId: string): void {
    this.#options.store.appendEvent('workspace.held', { workspaceId: record.id, commandId: effectId, reason: 'invalid-post-command-tree' }, record.taskId);
  }

  #commandCapacity(): void {
    if (this.#options.store.listEffects().filter(effect => effect.kind === 'workspace.command'
      && object(effect.payload).collectionDigest === sha(this.#directory)).length >= (this.#options.maxCommands ?? 16)) throw new Error('Command retention ceiling reached');
  }

  async runCommand(id: string, epoch: number, effectId: string, command: WorkspaceCommand,
    options: { timeoutMs?: number; maxOutputBytes?: number } = {}): Promise<WorkspaceCommandObservation> {
    const input = this.#commandInput(effectId, command, options), record = this.#commandRecord(id, epoch);
    const prior = this.#options.store.effect(effectId);
    if (prior) {
      this.#commandEffect(record, effectId);
      if (JSON.stringify(object(prior.payload).command) !== JSON.stringify(input.command)
        || JSON.stringify(object(prior.payload).limits) !== JSON.stringify(input.limits)) throw new Error('Command effect identity conflict; never replay');
      if (prior.state !== 'completed') throw new Error('Command requires reconciliation; never replay');
      return structuredClone((prior.result as unknown as CommandResult).observation);
    }
    if (this.#held(id)) throw new Error('Workspace held after invalid command tree');
    if (this.#options.store.listEffects(record.taskId).some(effect => effect.state !== 'completed' && object(effect.payload).workspaceId === id)) throw new Error('Workspace has uncertain effects requiring reconciliation');
    this.#commandCapacity();
    const profile = this.#runtimeProfile(), helperDigest = sha(readFileSync(helper));
    const claim = this.#claim(record, effectId), controller = new AbortController();
    let reserved = false;
    const drained = Promise.resolve().then(async () => {
      try {
        this.#commandRecord(id, epoch);
        // Distinct workspaces can queue concurrently. Recheck immediately before
        // the synchronous directory/reservation segment; no await may split it.
        this.#commandCapacity();
        const outputDirectory = this.#commandDirectory(record, effectId);
        mkdirSync(join(this.controlPath(id), 'commands'), { recursive: true, mode: 0o700 }); mkdirSync(outputDirectory, { mode: 0o700 });
        flushDirectory(dirname(outputDirectory)); const outputStat = lstatSync(outputDirectory);
        const payload = { workspaceId: id, epoch, collectionDigest: sha(this.#directory), baseTreeDigest: record.base.treeDigest,
          helperDigest, command: input.command, limits: input.limits, runtime: profile.runtime, readPaths: profile.readPaths,
          root: { device: record.device, inode: record.inode }, outputDirectory: { device: outputStat.dev, inode: outputStat.ino } } as unknown as Json;
        this.#options.store.reserveEffect({ id: effectId, taskId: record.taskId, kind: 'workspace.command', payload }); reserved = true;
        const treeDigest = await this.#tree(record, effectId, controller, claim, helperDigest);
        this.#commandRecord(id, epoch);
        if (!treeDigest) throw new Error('Invalid pre-command workspace tree');
        const captured = await this.#run(record, effectId, { kind: 'checkpoint', expectedTreeDigest: treeDigest }, controller, claim, helperDigest);
        this.#commandRecord(id, epoch);
        if (!captured.ok || !('checkpointDigest' in captured.result) || !('files' in captured.result)) throw new Error('Command checkpoint unavailable');
        this.#options.store.appendEvent('workspace.command.checkpointed', { workspaceId: id, commandId: effectId, checkpoint: captured.result as unknown as Json }, record.taskId);
        this.#sameProfile(profile); this.#commandRecord(id, epoch);
        this.#claimPid(record, claim, null);
        const receipt = await runWorkspaceCommand({ commandId: effectId, root: this.path(id), outputDirectory,
          runtime: profile.runtime, command: input.command, readPaths: profile.readPaths, ...input.limits, signal: controller.signal,
          onPid: pid => this.#claimPid(record, claim, pid) });
        this.#commandRecord(id, epoch);
        this.#sameProfile(profile); this.#commandRecord(id, epoch);
        const afterTreeDigest = await this.#tree(record, effectId, controller, claim, helperDigest);
        this.#sameProfile(profile);
        this.#commandRecord(id, epoch);
        if (!afterTreeDigest) this.#hold(record, effectId);
        const observation = this.#observation(effectId, afterTreeDigest, receipt);
        this.#options.store.completeEffect(effectId, { observation, receipt } as unknown as Json);
        return observation;
      } catch (error) {
        if (reserved) this.#options.store.markEffectUnknown(effectId, 'Command interrupted, revoked or receipt not verified');
        throw error;
      } finally { rmSync(claim.path); flushDirectory(this.controlPath(id)); this.#active.delete(id); }
    });
    this.#active.set(id, { controller, drained }); return await drained;
  }

  readCommandOutput(id: string, epoch: number, effectId: string, stream: 'stdout' | 'stderr', offset: number, length: number): WorkspaceCommandPage {
    const record = this.#commandRecord(id, epoch, false), effect = this.#commandEffect(record, effectId);
    if (effect.state !== 'completed') throw new Error('Command output requires reconciliation');
    const receipt = (effect.result as unknown as CommandResult).receipt;
    if (!receipt) throw new Error('Command output receipt unavailable');
    const page = readWorkspaceCommandOutput({ outputDirectory: this.#commandDirectory(record, effectId), receipt, stream, offset, length });
    this.#commandRecord(id, epoch, false); return page;
  }

  #receipt(record: WorkspaceRecord, effectId: string): WorkspaceCommandReceipt | undefined {
    const effect = this.#commandEffect(record, effectId), payload = object(effect.payload);
    try {
      const path = join(this.#commandDirectory(record, effectId), 'receipt.json'), stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o7777) !== 0o400 || stat.size > 65536) return undefined;
      const receipt = JSON.parse(readFileSync(path, 'utf8')) as WorkspaceCommandReceipt;
      if (receipt.version !== 1 || receipt.commandId !== effectId || JSON.stringify(receipt.command) !== JSON.stringify(payload.command)
        || JSON.stringify(receipt.runtime) !== JSON.stringify(payload.runtime) || JSON.stringify(receipt.limits) !== JSON.stringify(payload.limits)
        || JSON.stringify(receipt.root) !== JSON.stringify(payload.root) || JSON.stringify(receipt.outputDirectory) !== JSON.stringify(payload.outputDirectory)
        || JSON.stringify(receipt.grants) !== JSON.stringify({ readPaths: [this.path(record.id), ...(payload.readPaths as string[])], denyReadPaths: [] })
        || receipt.exit?.kind !== 'observed' || !(receipt.exit.code === null || (Number.isSafeInteger(receipt.exit.code) && receipt.exit.code >= 0 && receipt.exit.code <= 255))
        || !(receipt.exit.signal === null || (typeof receipt.exit.signal === 'string' && /^SIG[A-Z0-9]+$/.test(receipt.exit.signal)))
        || ![receipt.timedOut, receipt.aborted, receipt.outputLimitExceeded, receipt.exitSuccessful, receipt.outputComplete].every(value => typeof value === 'boolean')
        || !Number.isFinite(receipt.durationMs) || receipt.durationMs < 0
        || receipt.exitSuccessful !== (receipt.exit.code === 0 && receipt.exit.signal === null && !receipt.timedOut && !receipt.aborted && !receipt.outputLimitExceeded)
        || receipt.outputComplete !== (!receipt.timedOut && !receipt.aborted && !receipt.outputLimitExceeded && receipt.exit.signal === null)
        || receipt.streams.stdout.bytes + receipt.streams.stderr.bytes > receipt.limits.maxOutputBytes) return undefined;
      for (const stream of ['stdout', 'stderr'] as const) readWorkspaceCommandOutput({ outputDirectory: dirname(path), receipt, stream, offset: 0, length: 1 });
      return receipt;
    } catch { return undefined; }
  }

  async reconcileCommand(id: string, epoch: number, effectId: string): Promise<WorkspaceCommandObservation> {
    const record = this.#commandRecord(id, epoch, false), effect = this.#commandEffect(record, effectId);
    if (effect.state === 'completed') return structuredClone((effect.result as unknown as CommandResult).observation);
    this.#clearStoppedClaim(id, effectId);
    const claim = this.#claim(record, effectId), controller = new AbortController();
    const drained = Promise.resolve().then(async () => {
      try {
        const receipt = this.#receipt(record, effectId);
        const treeDigest = await this.#tree(record, effectId, controller, claim, String(object(effect.payload).helperDigest));
        this.#commandRecord(id, epoch, false);
        if (!treeDigest) this.#hold(record, effectId);
        const observation = this.#observation(effectId, treeDigest, receipt);
        this.#options.store.completeEffect(effectId, { observation, ...(receipt ? { receipt } : {}) } as unknown as Json);
        this.#options.store.appendEvent('workspace.command.reconciled', { workspaceId: id, commandId: effectId, exitKind: observation.exit.kind, workspaceUsable: observation.workspaceUsable }, record.taskId);
        return observation;
      } finally { rmSync(claim.path); flushDirectory(this.controlPath(id)); this.#active.delete(id); }
    });
    this.#active.set(id, { controller, drained }); return await drained;
  }

  async restoreCommandCheckpoint(id: string, epoch: number, effectId: string): Promise<WorkspaceRecord> {
    const record = this.#commandRecord(id, epoch, false), effect = this.#commandEffect(record, effectId);
    const event = this.#options.store.listEvents({ taskId: record.taskId }).find(entry => entry.type === 'workspace.command.checkpointed'
      && object(entry.payload).workspaceId === id && object(entry.payload).commandId === effectId);
    if (!event) throw new Error('Verified command checkpoint unavailable');
    const checkpoint = structuredClone(object(event.payload).checkpoint) as unknown as WorkspaceCheckpoint;
    if (!/^[a-f0-9]{64}$/.test(checkpoint.checkpointDigest)) throw new Error('Invalid command checkpoint identity');
    this.#clearStoppedClaim(id, effectId);
    const claim = this.#claim(record, effectId), controller = new AbortController();
    const drained = Promise.resolve().then(async () => {
      try {
        const operation = { kind: 'checkpoint-read' as const, checkpointDigest: checkpoint.checkpointDigest };
        const verified = await this.#run(record, effectId, operation, controller, claim, String(object(effect.payload).helperDigest));
        this.#commandRecord(id, epoch, false);
        if (!verified.ok || JSON.stringify(verified.result) !== JSON.stringify(checkpoint)) throw new Error('Checkpoint metadata changed');
        const files: WorkspaceFileInput[] = [];
        for (const file of checkpoint.files) {
          const chunks: Buffer[] = []; let offset = 0;
          do {
            const result = await this.#run(record, effectId, { ...operation, path: file.path, startByte: offset, endByte: Math.min(file.bytes, offset + 131072) }, controller, claim, String(object(effect.payload).helperDigest));
            this.#commandRecord(id, epoch, false);
            if (!result.ok || !('base64' in result.result)) throw new Error('Checkpoint page unavailable');
            const page = result.result as WorkspaceCheckpointPage, bytes = Buffer.from(page.base64, 'base64');
            if (page.checkpointDigest !== checkpoint.checkpointDigest || page.path !== file.path || page.sha256 !== file.sha256 || page.bytes !== file.bytes
              || page.mode !== file.mode || page.startByte !== offset || page.endByte !== Math.min(file.bytes, offset + 131072)
              || bytes.length !== page.endByte - offset || bytes.toString('base64') !== page.base64) throw new Error('Checkpoint page identity mismatch');
            chunks.push(bytes); offset = page.endByte;
          } while (offset < file.bytes);
          const content = Buffer.concat(chunks); if (sha(content) !== file.sha256) throw new Error('Checkpoint bytes changed');
          files.push({ path: file.path, content, mode: file.mode });
        }
        this.#commandRecord(id, epoch, false);
        const restored = this.#create({ taskId: record.taskId, epoch, base: record.base, files }, { original: record, commandId: effectId, checkpoint });
        this.#options.store.appendEvent('workspace.restored', { workspaceId: id, newWorkspaceId: restored.id, commandId: effectId,
          checkpointDigest: checkpoint.checkpointDigest, draftTreeDigest: checkpoint.treeDigest }, record.taskId);
        // Settles operational uncertainty only. The abandoned command never
        // acquires an exit success or engineering grade through restoration.
        if (effect.state !== 'completed') this.#options.store.completeEffect(effectId, { observation: this.#observation(effectId) } as unknown as Json);
        return restored;
      } finally { rmSync(claim.path); flushDirectory(this.controlPath(id)); this.#active.delete(id); }
    });
    this.#active.set(id, { controller, drained }); return await drained;
  }

  /** Trusted coordinator cancellation hook, like stop(): call this when task
   * cancellation/revocation occurs. The policy callback alone rejects late
   * acceptance; it is not a subscription to policy changes or a kill signal. */
  async cancel(id: string): Promise<void> {
    this.workspace(id);
    const active = this.#active.get(id);
    if (active) { active.controller.abort(); await Promise.allSettled([active.drained]); }
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    const active = [...this.#active.values()];
    for (const item of active) item.controller.abort();
    await Promise.allSettled(active.map(item => item.drained));
    this.#ownership.close();
  }
}
