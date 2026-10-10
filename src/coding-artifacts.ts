import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { closeSync, constants, existsSync, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { join } from 'node:path';
import { digestJson, readManifest } from './candidates.ts';
import type { CandidateChange, CandidateManifest, CandidateRuntime } from './candidates.ts';
import { resolveExternalPath } from './config.ts';
import type { GenerationHost } from './generations.ts';
import type { Json, Store } from './store.ts';
import { workspaceTreeDigest } from './workspaces.ts';
import type { CodingWorkspaces, WorkspaceBase, WorkspaceFile, WorkspaceFileInput } from './workspaces.ts';

export interface CodingArtifactImportAuthority {
  taskId: string; sessionId: string; attemptId: string; epoch: number; expiresAt: number; contractDigest?: string;
}
export interface CodingArtifactAuthority extends CodingArtifactImportAuthority { contractDigest: string }
export interface AdmittedCodingSource {
  version: 'admitted-coding-source/1'; base: WorkspaceBase; files: WorkspaceFileInput[]; manifest: CandidateManifest; epoch: number;
  directories: CodingArtifactDirectory[]; rootMode: number;
  runtimeRelease: { releaseDir: string; digest: string }; runtime: CandidateRuntime;
  modelProfile: CandidateManifest['modelProfile']; configuration: CandidateManifest['configuration'];
}
export interface CodingArtifactDirectory { path: string; mode: number }
type Directory = CodingArtifactDirectory;
interface SerializedFile extends WorkspaceFile { base64: string }
interface Tree { files: WorkspaceFileInput[]; manifest: WorkspaceFile[]; directories: Directory[]; rootMode: number }
interface SourceArtifact {
  version: 'coding-source/1'; taskId: string; sessionId: string; attemptId: string; epoch: number;
  base: WorkspaceBase; manifest: CandidateManifest; files: SerializedFile[]; directories: Directory[]; rootMode: number;
}
export interface CodingArtifactChange {
  path: string; kind: 'added' | 'modified' | 'deleted'; before?: WorkspaceFile; after?: WorkspaceFile;
}
export interface CodingSubmissionReceipt {
  version: 'coding-submission/1'; id: string; submissionId: string; artifactPath: string; sourceArtifactId: string;
  workspaceId: string; treeDigest: string; fullTreeDigest: string; originalBase: WorkspaceBase; currentBase: WorkspaceBase;
  disposition: 'cognitive_compatible' | 'awaiting_supported_admission'; reason: string; changes: CodingArtifactChange[];
  cognitiveBridge?: { submissionDigest: string; treeDigest: string; base: WorkspaceBase; changes: CandidateChange[];
    sourceBinding: { version: 1; releaseDigest: string; sourceDigest: string; baseCommit: string } };
}
interface SubmissionArtifact {
  version: 'coding-submission/1'; submissionId: string; authority: CodingArtifactAuthority; sourceArtifactId: string; workspaceId: string;
  originalBase: WorkspaceBase; currentBase: WorkspaceBase; treeDigest: string; fullTreeDigest: string;
  files: SerializedFile[]; directories: Directory[]; rootMode: number; changes: CodingArtifactChange[];
  commandReceipts: { effectId: string; resultDigest: string; outcome: Json }[];
  provenance: { source: string; conversationId: string; slackAuthor?: { teamId: string; userId: string } };
}
interface ArtifactOptions {
  host: GenerationHost; store: Store; repositoryRoot: string; directory: string;
  authorize: (authority: CodingArtifactImportAuthority) => boolean; now?: () => number;
}
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const object = (value: Json): Record<string, Json> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
const sorted = <T extends { path: string }>(files: T[]) => files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const token = (value: string) => typeof value === 'string' && !!value.trim() && value.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(value);
const digest = (value: string) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fileManifest = (files: WorkspaceFileInput[]): WorkspaceFile[] => sorted(files.map(file => ({ path: file.path, sha256: hash(file.content), bytes: file.content.byteLength, mode: file.mode })));
const serialize = (files: WorkspaceFileInput[]): SerializedFile[] => fileManifest(files).map(file => ({ ...file, base64: Buffer.from(files.find(input => input.path === file.path)!.content).toString('base64') }));
function deserialize(files: SerializedFile[]): WorkspaceFileInput[] {
  if (!Array.isArray(files)) throw new Error('Invalid coding artifact files');
  const result = files.map(file => {
    const content = Buffer.from(file.base64, 'base64');
    if (content.toString('base64') !== file.base64 || hash(content) !== file.sha256 || content.length !== file.bytes || ![0o644, 0o755].includes(file.mode)) throw new Error('Coding artifact bytes or modes changed');
    return { path: file.path, content, mode: file.mode as 0o644 | 0o755 };
  });
  workspaceTreeDigest(result); return result;
}
function fingerprint(stat: Stats): string {
  return [stat.dev, stat.ino, stat.mode, stat.size, stat.nlink, stat.mtimeMs, stat.ctimeMs].join(':');
}
function regularBytes(path: string, maximum: number, expectedMode?: number): Buffer {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maximum
    || (expectedMode !== undefined && (before.mode & 0o7777) !== expectedMode)) throw new Error('Invalid regular coding source or artifact');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd); if (fingerprint(opened) !== fingerprint(before)) throw new Error('Coding file identity changed during open');
    const content = Buffer.alloc(opened.size); let offset = 0;
    while (offset < content.length) { const size = readSync(fd, content, offset, content.length - offset, offset); if (!size) throw new Error('Coding file changed during read'); offset += size; }
    if (readSync(fd, Buffer.alloc(1), 0, 1, offset) !== 0 || fingerprint(fstatSync(fd)) !== fingerprint(before)
      || fingerprint(lstatSync(path)) !== fingerprint(before)) throw new Error('Coding file changed during read');
    return content;
  } finally { closeSync(fd); }
}
function scan(root: string, frozen = false): Tree {
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Invalid coding source root');
  const files: WorkspaceFileInput[] = [], directories: Directory[] = [], names = new Set<string>(); let total = 0, count = 0;
  const visit = (directory: string, prefix: string) => {
    const before = lstatSync(directory); const entries = readdirSync(directory).sort();
    if (!before.isDirectory() || before.isSymbolicLink()) throw new Error('Coding source contains a linked directory');
    for (const name of entries) {
      const path = prefix ? prefix + '/' + name : name;
      if (!name || name === '.' || name === '..' || name.toLowerCase() === '.git' || /[\u0000-\u001f\u007f-\u009f\\]/u.test(path)) throw new Error('Invalid coding source path');
      const key = path.normalize('NFC').toLocaleLowerCase('en-US'); if (names.has(key) || ++count > 4096) throw new Error('Coding source collision or entry limit'); names.add(key);
      const location = join(directory, name), stat = lstatSync(location);
      if (stat.isSymbolicLink()) throw new Error('Coding source contains a symlink');
      if (stat.isDirectory()) { directories.push({ path, mode: stat.mode & 0o7777 }); visit(location, path); }
      else {
        const mode = stat.mode & 0o111 ? 0o755 : 0o644;
        const bytes = regularBytes(location, 1_048_576, frozen ? (mode === 0o755 ? 0o500 : 0o400) : mode);
        total += bytes.length; if (total > 33_554_432) throw new Error('Coding source exceeds byte limit'); files.push({ path, content: bytes, mode });
      }
    }
    if (fingerprint(lstatSync(directory)) !== fingerprint(before) || JSON.stringify(readdirSync(directory).sort()) !== JSON.stringify(entries)) throw new Error('Coding directory changed during collection');
  };
  visit(root, ''); workspaceTreeDigest(files);
  return { files, manifest: fileManifest(files), directories: sorted(directories), rootMode: rootStat.mode & 0o7777 };
}
const treeIdentity = (tree: Tree) => digestJson({ files: tree.manifest, directories: tree.directories, rootMode: tree.rootMode });
const cognitivePath = /^src\/agent\/[A-Za-z0-9][A-Za-z0-9._-]*\.ts$/;
type FreezerBase = Map<string, { mode: number; blob: string }>;
async function readFreezerBase(repositoryRoot: string, baseCommit: string, validateCurrent: () => void, signal?: AbortSignal): Promise<FreezerBase | undefined> {
  // Read only historical Git object identities and current revision evidence.
  // Source bytes always come from the sealed authored tree. The legacy freezer
  // starts from Git HEAD, so unchanged edits inherited from a serving cognitive
  // release must also be supplied, while Git-identical no-ops must be omitted.
  const git = (...args: string[]) => new Promise<Buffer>((resolve, reject) => {
    validateCurrent(); let result: { error: Error | null; stdout: Buffer } | undefined;
    const child = execFile('/usr/bin/git', ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...args],
      { cwd: repositoryRoot, maxBuffer: 8_388_608, timeout: 2000, encoding: 'buffer', signal, killSignal: 'SIGKILL' },
      (error, stdout) => { result = { error, stdout }; });
    // AbortError may be delivered before process exit. Accept metadata or an
    // unavailable result only after the positively owned process has closed.
    child.once('close', () => result?.error ? reject(result.error) : result ? resolve(result.stdout) : reject(new Error('Git metadata outcome unavailable')));
  });
  try {
    if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(baseCommit)) return undefined;
    const head = await git('rev-parse', 'HEAD'); validateCurrent(); if (head.toString().trim() !== baseCommit) return undefined;
    const status = await git('status', '--porcelain=v1', '--untracked-files=all'); validateCurrent(); if (status.length) return undefined;
    const entries = await git('ls-tree', '-rz', '--full-tree', baseCommit, '--', 'src/agent'); validateCurrent();
    const base: FreezerBase = new Map();
    for (const entry of entries.toString().split('\0').filter(Boolean)) {
      const split = entry.indexOf('\t'), [mode, kind, blob] = entry.slice(0, split).split(' '), path = entry.slice(split + 1);
      if (cognitivePath.test(path)) {
        if (!['100644', '100755'].includes(mode!) || kind !== 'blob' || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(blob!)) return undefined;
        base.set(path, { mode: mode === '100755' ? 0o755 : 0o644, blob: blob! });
      }
    }
    return base;
  } catch { validateCurrent(); return undefined; }
}
function bridgeInputs(base: FreezerBase | undefined, tree: Tree): { changes?: CandidateChange[]; reason: string } {
  const unavailable = { reason: 'freezer_revision_or_representation_requires_reconciliation' };
  if (base) {
    if ([...base.keys()].some(path => !tree.files.some(file => file.path === path))) return unavailable;
    const changes: CandidateChange[] = [];
    for (const file of tree.files.filter(file => cognitivePath.test(file.path))) {
      const original = base.get(file.path), bytes = Buffer.from(file.content);
      const blob = createHash(original?.blob.length === 64 ? 'sha256' : 'sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      if (original?.blob === blob && original.mode === file.mode) continue;
      const content = bytes.toString('utf8');
      if (file.path.length > 240 || content.length > 100_000 || bytes.length > 524_288) return { reason: 'legacy_cognitive_format_limits_require_supported_admission' };
      if ((original?.mode ?? 0o644) !== file.mode || !content.trim() || !Buffer.from(content).equals(bytes)) return unavailable;
      changes.push({ path: file.path, content });
    }
    if (changes.length > 10) return { reason: 'legacy_cognitive_format_limits_require_supported_admission' };
    if (changes.length) return { changes: sorted(changes), reason: 'lossless_cognitive_changes_require_existing_admission' };
  }
  return unavailable;
}

/** Select the complete source only from the current trusted custody grant.
 * The installed async verifier remains authoritative; native reads add an
 * independent byte/mode/stability check and never graft the current checkout. */
export async function importAdmittedCodingSource(options: {
  host: GenerationHost; repositoryRoot: string; signal?: AbortSignal; validateCurrent?: () => void;
}): Promise<AdmittedCodingSource> {
  const { host, signal } = options, state = host.custodian.inspect(), active = state.active;
  if (!active || !['normal', 'evaluation', 'probation'].includes(state.phase)) throw new Error('No serving admitted coding source');
  const actor = host.actor, release = structuredClone(active.release);
  const validate = () => {
    signal?.throwIfAborted(); const current = host.custodian.inspect();
    if (current.epoch !== state.epoch || digestJson(current.active ?? null) !== digestJson(active) || !['normal', 'evaluation', 'probation'].includes(current.phase)
      || host.worker(active.process).closed) throw new Error('Coding source serving authority changed');
    host.custodian.assertAuthority(actor, 'tool', active.process); options.validateCurrent?.(); signal?.throwIfAborted();
  };
  validate();
  const releaseStat = lstatSync(release.artifactPath);
  if (!releaseStat.isDirectory() || releaseStat.isSymbolicLink()) throw new Error('Admitted coding release is linked or unavailable');
  const retainedManifest = regularBytes(join(release.artifactPath, 'manifest.json'), 8_388_608, 0o400);
  const manifest = await host.collectCandidate({ kind: 'verify', options: { repositoryRoot: options.repositoryRoot, releaseDir: release.artifactPath,
    requireCurrentBase: false, expectedLegacyManifestDigest: release.digest } }, { signal, validateBinding: validate });
  validate();
  if (manifest.manifestDigest !== release.digest || manifest.governanceDigest !== release.governanceDigest || manifest.dataSchemaVersion !== release.dataSchemaVersion)
    throw new Error('Coding source manifest differs from admitted custody');
  const first = scan(manifest.candidateRoot, true), again = scan(manifest.candidateRoot, true);
  const candidateFiles = first.manifest.map(file => ({ path: file.path, mode: file.mode === 0o755 ? '100755' : '100644', sha256: file.sha256, size: file.bytes })).sort((a, b) => a.path.localeCompare(b.path));
  if (digestJson(candidateFiles) !== manifest.snapshotDigest || digestJson(candidateFiles) !== digestJson(manifest.files)
    || treeIdentity(first) !== treeIdentity(again) || digestJson(readManifest(release.artifactPath)) !== digestJson(manifest)
    || fingerprint(lstatSync(release.artifactPath)) !== fingerprint(releaseStat)
    || !regularBytes(join(release.artifactPath, 'manifest.json'), 8_388_608, 0o400).equals(retainedManifest)) throw new Error('Admitted complete source changed after verification');
  validate();
  return { version: 'admitted-coding-source/1', base: { releaseDigest: release.digest, baseCommit: manifest.baseCommit, treeDigest: workspaceTreeDigest(first.files) },
    files: first.files, directories: first.directories, rootMode: first.rootMode, manifest: structuredClone(manifest), epoch: state.epoch, runtimeRelease: { releaseDir: manifest.releaseDir, digest: release.digest },
    runtime: structuredClone(manifest.runtime), modelProfile: structuredClone(manifest.modelProfile), configuration: structuredClone(manifest.configuration) };
}

/** Durable source/submission receiver. Its classifications describe supported
 * routes only; the existing review/succession/publication receivers still own
 * admission and must revalidate the exact frozen bridge against current base. */
export class CodingArtifacts {
  readonly #options: ArtifactOptions;
  readonly #directory: string;
  readonly #identity: string;
  readonly #pendingImports = new Set<string>();
  readonly #pendingSubmissions = new Set<string>();
  constructor(options: ArtifactOptions) {
    if (typeof options.authorize !== 'function') throw new Error('Coding artifacts require current trusted authority');
    this.#options = options; this.#directory = resolveExternalPath(options.repositoryRoot, options.directory);
    mkdirSync(this.#directory, { recursive: true, mode: 0o700 }); const stat = lstatSync(this.#directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw new Error('Coding artifacts require a private external directory');
    this.#directory = realpathSync(this.#directory); this.#identity = `${stat.dev}:${stat.ino}`;
  }
  #current(authority: CodingArtifactImportAuthority, signal?: AbortSignal, finalized = false): void {
    signal?.throwIfAborted(); const task = this.#options.store.task(authority.taskId), state = this.#options.host.custodian.inspect(), now = this.#options.now?.() ?? Date.now();
    if (![authority.taskId, authority.sessionId, authority.attemptId].every(token) || !Number.isSafeInteger(authority.epoch)
      || authority.epoch !== state.epoch || !Number.isSafeInteger(now) || !Number.isSafeInteger(authority.expiresAt) || authority.expiresAt <= now
      || (finalized && !digest(authority.contractDigest!)) || (authority.contractDigest !== undefined && !digest(authority.contractDigest))
      || !task || task.state !== 'running' || task.source === 'peer' || task.conversationId.startsWith('peer:') || !state.active
      || !['normal', 'evaluation', 'probation'].includes(state.phase) || this.#options.host.worker(state.active.process).closed
      || !this.#options.authorize(structuredClone(authority))) throw new Error('Coding artifact authority revoked, expired or unavailable');
    this.#options.host.custodian.assertAuthority(this.#options.host.actor, 'tool', state.active.process);
    const stat = lstatSync(this.#directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || `${stat.dev}:${stat.ino}` !== this.#identity || (stat.mode & 0o077)) throw new Error('Coding artifact directory identity changed');
    signal?.throwIfAborted();
  }
  #write(body: SourceArtifact | SubmissionArtifact): { id: string; artifactPath: string } {
    const id = digestJson(body), artifactPath = join(this.#directory, id + '.json'), bytes = JSON.stringify(body);
    if (existsSync(artifactPath)) {
      if (digestJson(JSON.parse(regularBytes(artifactPath, 67_108_864, 0o400).toString('utf8'))) !== id) throw new Error('Existing immutable coding artifact differs');
    } else {
      const fd = openSync(artifactPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { writeFileSync(fd, bytes); fchmodSync(fd, 0o400); fsyncSync(fd); } finally { closeSync(fd); }
      const directory = openSync(this.#directory, constants.O_RDONLY | constants.O_NOFOLLOW); try { fsyncSync(directory); } finally { closeSync(directory); }
    }
    return { id, artifactPath };
  }
  #read<T extends SourceArtifact | SubmissionArtifact>(id: string): T {
    if (!digest(id)) throw new Error('Invalid coding artifact identity');
    const artifact = JSON.parse(regularBytes(join(this.#directory, id + '.json'), 67_108_864, 0o400).toString('utf8')) as T;
    if (digestJson(artifact) !== id || !['coding-source/1', 'coding-submission/1'].includes(artifact.version)) throw new Error('Immutable coding artifact changed');
    const files = deserialize(artifact.files);
    if (artifact.version === 'coding-source/1' ? workspaceTreeDigest(files) !== artifact.base.treeDigest : workspaceTreeDigest(files) !== artifact.treeDigest)
      throw new Error('Coding artifact complete tree identity changed');
    if (artifact.version === 'coding-submission/1' && treeIdentity({ files, manifest: fileManifest(files), directories: artifact.directories, rootMode: artifact.rootMode }) !== artifact.fullTreeDigest)
      throw new Error('Coding artifact directory identity changed');
    return artifact;
  }
  #source(authority: CodingArtifactImportAuthority, sourceArtifactId: string): SourceArtifact {
    const receipt = this.#options.store.listEvents({ taskId: authority.taskId }).find(event => event.type === 'coding.source.imported'
      && object(event.payload).sourceArtifactId === sourceArtifactId);
    const source = this.#read<SourceArtifact>(sourceArtifactId);
    if (!receipt || source.version !== 'coding-source/1' || source.taskId !== authority.taskId || source.sessionId !== authority.sessionId || source.attemptId !== authority.attemptId)
      throw new Error('Coding source artifact provenance mismatch');
    return source;
  }
  async importSource(input: { authority: CodingArtifactImportAuthority; signal?: AbortSignal }): Promise<AdmittedCodingSource & { sourceArtifactId: string; artifactPath: string }> {
    const identity = digestJson([input.authority.taskId, input.authority.sessionId, input.authority.attemptId]);
    if (this.#pendingImports.has(identity)) throw new Error('Coding source import already running; await its durable receipt');
    this.#pendingImports.add(identity);
    try { return await this.#importSource(input); } finally { this.#pendingImports.delete(identity); }
  }
  async #importSource(input: { authority: CodingArtifactImportAuthority; signal?: AbortSignal }): Promise<AdmittedCodingSource & { sourceArtifactId: string; artifactPath: string }> {
    const authority = structuredClone(input.authority); this.#current(authority, input.signal);
    const prior = this.#options.store.listEvents({ taskId: authority.taskId }).find(event => event.type === 'coding.source.imported'
      && object(event.payload).sessionId === authority.sessionId && object(event.payload).attemptId === authority.attemptId);
    let source: SourceArtifact, sourceArtifactId: string, artifactPath: string;
    if (prior) {
      sourceArtifactId = String(object(prior.payload).sourceArtifactId); source = this.#source(authority, sourceArtifactId); artifactPath = join(this.#directory, sourceArtifactId + '.json');
    } else {
      const intended = this.#options.store.listEvents({ taskId: authority.taskId }).find(event => event.type === 'coding.source.import.intent'
        && object(event.payload).sessionId === authority.sessionId && object(event.payload).attemptId === authority.attemptId);
      const active = this.#options.host.custodian.inspect().active!;
      const intent = intended ? object(intended.payload) : { taskId: authority.taskId, sessionId: authority.sessionId, attemptId: authority.attemptId,
        epoch: authority.epoch, releaseDigest: active.release.digest, releaseDir: active.release.artifactPath };
      if (intent.releaseDigest !== active.release.digest || intent.releaseDir !== active.release.artifactPath || !Number.isSafeInteger(intent.epoch))
        throw new Error('Original coding import source is unavailable; cannot relabel a changed serving base');
      if (!intended) this.#options.store.appendEvent('coding.source.import.intent', intent, authority.taskId);
      const admitted = await importAdmittedCodingSource({ host: this.#options.host, repositoryRoot: this.#options.repositoryRoot, signal: input.signal,
        validateCurrent: () => this.#current(authority, input.signal) });
      // A concurrent receiver may have committed the same import while this
      // collector yielded. Its original baseline wins over a fresh selection.
      if (this.#options.store.listEvents({ taskId: authority.taskId }).some(event => event.type === 'coding.source.imported'
        && object(event.payload).sessionId === authority.sessionId && object(event.payload).attemptId === authority.attemptId)) return await this.#importSource(input);
      this.#current(authority, input.signal); const tree = scan(admitted.manifest.candidateRoot, true);
      if (workspaceTreeDigest(tree.files) !== admitted.base.treeDigest || admitted.base.releaseDigest !== intent.releaseDigest || admitted.manifest.releaseDir !== intent.releaseDir)
        throw new Error('Admitted source changed before retention');
      source = { version: 'coding-source/1', taskId: authority.taskId, sessionId: authority.sessionId, attemptId: authority.attemptId, epoch: intent.epoch as number,
        base: admitted.base, manifest: admitted.manifest, files: serialize(admitted.files), directories: tree.directories, rootMode: tree.rootMode };
      this.#current(authority, input.signal); const written = this.#write(source); sourceArtifactId = written.id; artifactPath = written.artifactPath;
      this.#current(authority, input.signal);
      this.#options.store.appendEvent('coding.source.imported', { sourceArtifactId, taskId: authority.taskId, sessionId: authority.sessionId, attemptId: authority.attemptId,
        base: source.base as unknown as Json, artifactPath }, authority.taskId);
    }
    this.#current(authority, input.signal);
    return { version: 'admitted-coding-source/1', sourceArtifactId, artifactPath, base: structuredClone(source.base), files: deserialize(source.files), manifest: structuredClone(source.manifest),
      directories: structuredClone(source.directories), rootMode: source.rootMode,
      epoch: authority.epoch, runtimeRelease: { releaseDir: source.manifest.releaseDir, digest: source.base.releaseDigest }, runtime: structuredClone(source.manifest.runtime),
      modelProfile: structuredClone(source.manifest.modelProfile), configuration: structuredClone(source.manifest.configuration) };
  }
  readBaseFiles(input: { authority: CodingArtifactAuthority; sourceArtifactId: string }): WorkspaceFileInput[] {
    return this.readBaseTree(input).files;
  }
  readBaseTree(input: { authority: CodingArtifactAuthority; sourceArtifactId: string }): { files: WorkspaceFileInput[]; directories: CodingArtifactDirectory[]; rootMode: number } {
    this.#current(input.authority, undefined, true); const source = this.#source(input.authority, input.sourceArtifactId);
    const tree = { files: deserialize(source.files), directories: structuredClone(source.directories), rootMode: source.rootMode };
    this.#current(input.authority, undefined, true); return tree;
  }
  submissionReceipt(submissionId: string): CodingSubmissionReceipt | undefined {
    const entry = this.#options.store.listEvents().find(event => event.type === 'coding.submission.registered' && object(event.payload).submissionId === submissionId);
    return entry ? structuredClone(entry.payload) as unknown as CodingSubmissionReceipt : undefined;
  }
  async submit(input: { authority: CodingArtifactAuthority; workspaces: CodingWorkspaces; workspaceId: string; sourceArtifactId: string;
    expectedTreeDigest: string; submissionId: string; signal?: AbortSignal }): Promise<CodingSubmissionReceipt> {
    if (this.#pendingSubmissions.has(input.submissionId)) throw new Error('Coding submission already running; await its durable receipt');
    this.#pendingSubmissions.add(input.submissionId);
    try { return await this.#submit(input); } finally { this.#pendingSubmissions.delete(input.submissionId); }
  }
  async #submit(input: { authority: CodingArtifactAuthority; workspaces: CodingWorkspaces; workspaceId: string; sourceArtifactId: string;
    expectedTreeDigest: string; submissionId: string; signal?: AbortSignal }): Promise<CodingSubmissionReceipt> {
    const authority = structuredClone(input.authority); const { workspaces, workspaceId, signal } = input;
    this.#current(authority, signal, true);
    if (!token(input.submissionId) || !digest(input.expectedTreeDigest)) throw new Error('Invalid coding submission identity');
    const source = this.#source(authority, input.sourceArtifactId), workspace = workspaces.workspace(workspaceId);
    if (workspace.taskId !== authority.taskId || workspace.epoch !== authority.epoch || digestJson(workspace.base) !== digestJson(source.base)) throw new Error('Coding submission workspace or original base mismatch');
    const prior = this.submissionReceipt(input.submissionId);
    if (prior) {
      const artifact = this.#read<SubmissionArtifact>(prior.id);
      if (artifact.version !== 'coding-submission/1' || artifact.authority.taskId !== authority.taskId || artifact.authority.sessionId !== authority.sessionId
        || artifact.authority.attemptId !== authority.attemptId || artifact.authority.contractDigest !== authority.contractDigest || artifact.workspaceId !== workspaceId
        || artifact.sourceArtifactId !== input.sourceArtifactId || artifact.treeDigest !== input.expectedTreeDigest) throw new Error('Coding submission receipt identity conflict');
      this.#current(authority, signal, true); return prior;
    }
    const quiescent = () => {
      this.#current(authority, signal, true);
      if (existsSync(join(workspaces.controlPath(workspaceId), 'writer.json')) || this.#options.store.listEffects(authority.taskId).some(effect => effect.state !== 'completed' && object(effect.payload).workspaceId === workspaceId))
        throw new Error('Coding submission requires proven quiescence and reconciled effects');
    };
    quiescent();
    const current = await importAdmittedCodingSource({ host: this.#options.host, repositoryRoot: this.#options.repositoryRoot, signal, validateCurrent: quiescent });
    quiescent();
    if (this.submissionReceipt(input.submissionId)) return await this.#submit(input);
    const freezerBase = await readFreezerBase(this.#options.repositoryRoot, current.base.baseCommit, quiescent, signal);
    quiescent();
    const cancel = () => { void workspaces.cancel(workspaceId).catch(() => {}); }; signal?.addEventListener('abort', cancel, { once: true });
    let observed;
    try { observed = await workspaces.perform(workspaceId, authority.epoch, `${input.submissionId}:manifest`, { kind: 'manifest' }); }
    finally { signal?.removeEventListener('abort', cancel); }
    quiescent();
    if (this.submissionReceipt(input.submissionId)) return await this.#submit(input);
    if (!observed.ok || !('files' in observed.result)) throw new Error('Coding submission manifest unavailable');
    const claimPath = join(workspaces.controlPath(workspaceId), 'writer.json'), ownerNonce = randomUUID();
    const claim = JSON.stringify({ version: 1, operationId: input.submissionId, ownerPid: process.pid, ownerNonce, pid: null });
    const fd = openSync(claimPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(fd, claim); fsyncSync(fd); } finally { closeSync(fd); }
    const controlFd = openSync(workspaces.controlPath(workspaceId), constants.O_RDONLY | constants.O_NOFOLLOW);
    try { fsyncSync(controlFd); } finally { closeSync(controlFd); }
    try {
      this.#current(authority, signal, true);
      const root = workspaces.path(workspaceId), stat = lstatSync(root);
      if (stat.dev !== workspace.device || stat.ino !== workspace.inode) throw new Error('Coding workspace root identity changed');
      const tree = scan(root), second = scan(root), treeDigest = workspaceTreeDigest(tree.files);
      if (digestJson(tree.manifest) !== digestJson(observed.result.files) || treeDigest !== input.expectedTreeDigest || treeIdentity(tree) !== treeIdentity(second))
        throw new Error('Coding submission expected tree or stable bytes mismatch');
      const initial = deserialize(source.files), before = new Map(fileManifest(initial).map(file => [file.path, file])), after = new Map(tree.manifest.map(file => [file.path, file]));
      const changes: CodingArtifactChange[] = sorted([...new Set([...before.keys(), ...after.keys()])].flatMap(path => {
        const old = before.get(path), next = after.get(path);
        return digestJson(old ?? null) === digestJson(next ?? null) ? [] : [{ path, kind: (!old ? 'added' : !next ? 'deleted' : 'modified') as CodingArtifactChange['kind'], ...(old ? { before: old } : {}), ...(next ? { after: next } : {}) }];
      }));
      const task = this.#options.store.task(authority.taskId)!;
      const body: SubmissionArtifact = { version: 'coding-submission/1', submissionId: input.submissionId, authority, workspaceId, sourceArtifactId: input.sourceArtifactId,
        originalBase: structuredClone(source.base), currentBase: current.base, treeDigest, fullTreeDigest: treeIdentity(tree), files: serialize(tree.files), directories: tree.directories, rootMode: tree.rootMode,
        changes, commandReceipts: this.#options.store.listEffects(authority.taskId).filter(effect => effect.kind === 'workspace.command' && object(effect.payload).workspaceId === workspaceId)
          .map(effect => ({ effectId: effect.id, resultDigest: digestJson(effect.result), outcome: structuredClone(effect.result) })),
        provenance: { source: task.source, conversationId: task.conversationId, ...(task.slackAuthor ? { slackAuthor: task.slackAuthor } : {}) } };
      let reason = 'broader_source_changes_require_supported_admission', bridge: CandidateChange[] | undefined;
      if (digestJson(source.base) !== digestJson(current.base)) reason = 'base_changed_reconciliation_required';
      else if (digestJson(source.directories) !== digestJson(current.directories) || source.rootMode !== current.rootMode) reason = 'source_directory_changed_reconciliation_required';
      else if (!changes.length) reason = digestJson(source.directories) === digestJson(tree.directories) && source.rootMode === tree.rootMode ? 'no_file_changes' : 'directory_changes_require_supported_admission';
      else if (digestJson(source.directories) === digestJson(tree.directories) && source.rootMode === tree.rootMode
        && tree.rootMode === 0o700 && tree.directories.every(directory => directory.mode === 0o700 && tree.files.some(file => file.path.startsWith(directory.path + '/')))
        && changes.every(change => change.kind !== 'deleted' && cognitivePath.test(change.path) && change.after?.mode === 0o644 && (!change.before || change.before.mode === 0o644))) {
        const compatible = bridgeInputs(freezerBase, tree); bridge = compatible.changes; reason = compatible.reason;
      }
      this.#current(authority, signal, true);
      const written = this.#write(body), receipt: CodingSubmissionReceipt = { version: 'coding-submission/1', ...written, submissionId: input.submissionId,
        sourceArtifactId: input.sourceArtifactId, workspaceId, treeDigest, fullTreeDigest: body.fullTreeDigest, originalBase: body.originalBase, currentBase: body.currentBase,
        disposition: bridge ? 'cognitive_compatible' : 'awaiting_supported_admission', reason, changes,
        ...(bridge ? { cognitiveBridge: { submissionDigest: written.id, treeDigest, base: current.base, changes: bridge,
          sourceBinding: { version: 1, releaseDigest: source.base.releaseDigest, sourceDigest: source.manifest.sourceDigest, baseCommit: source.base.baseCommit } } } : {}) };
      this.#current(authority, signal, true);
      this.#options.store.appendEvent('coding.submission.registered', receipt as unknown as Json, authority.taskId); return structuredClone(receipt);
    } finally {
      if (regularBytes(claimPath, 4096, 0o600).toString('utf8') !== claim) throw new Error('Coding submission writer ownership changed');
      unlinkSync(claimPath);
      const controlFd = openSync(workspaces.controlPath(workspaceId), constants.O_RDONLY | constants.O_NOFOLLOW);
      try { fsyncSync(controlFd); } finally { closeSync(controlFd); }
    }
  }
}
