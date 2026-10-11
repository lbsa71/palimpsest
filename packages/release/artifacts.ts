import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, opendirSync, readSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { canonicalJson, candidateIdentity, identity, validateCandidate, type CandidateManifest, type JsonValue } from '../contracts/index.ts';

export interface FrozenFile { path: string; sha256: string; executable: boolean }
export interface CandidateInputs {
  dependencies: JsonValue;
  prompts: JsonValue;
  model: JsonValue;
  configuration: JsonValue;
  controls: JsonValue;
  createdBy: string;
}
export interface FrozenCandidate { manifest: CandidateManifest; files: FrozenFile[]; inputs: CandidateInputs }
export function hashBytes(bytes: string | Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }

function syncPath(path: string): void {
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function localPath(path: string): void {
  if (!path || isAbsolute(path) || path.split(/[\\/]/).some(p => p === '..' || p === '.' || p === '') || path.includes('\0')) {
    throw new Error('Candidate paths must be normalized relative paths');
  }
}

/** Linux descriptor-relative traversal pins each parent and refuses symlinks at every component.
 * Checking lstat/realpath and subsequently reopening by pathname leaves a replacement race.
 */
function openLocal(root: string, path: string): number {
  localPath(path);
  if (process.platform !== 'linux') throw new Error('Descriptor-relative artifact traversal requires Linux');
  let fd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const parts = path.split('/');
    for (let i = 0; i < parts.length; i++) {
      const next = openSync(`/proc/self/fd/${fd}/${parts[i]}`, constants.O_RDONLY | constants.O_NOFOLLOW |
        (i < parts.length - 1 ? constants.O_DIRECTORY : constants.O_NONBLOCK));
      closeSync(fd); fd = next;
    }
    return fd;
  } catch (cause) {
    closeSync(fd); throw new Error(`Candidate symlink or invalid directory/file: ${path}`, { cause });
  }
}

/** Host-selected limits; candidate metadata cannot increase these bounds. */
export interface ArtifactLimits { maxFiles: number; maxEntries: number; maxBytes: number; maxFileBytes: number; maxDepth: number }
export const defaultArtifactLimits: Readonly<ArtifactLimits> = Object.freeze({ maxFiles: 20000, maxEntries: 40000, maxBytes: 512 * 1024 * 1024, maxFileBytes: 128 * 1024 * 1024, maxDepth: 64 });
function limitsFor(limits: ArtifactLimits): ArtifactLimits {
  for (const key of Object.keys(defaultArtifactLimits) as (keyof ArtifactLimits)[]) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0) throw new Error('Finite positive artifact limits required');
  }
  return { ...limits };
}
interface ReadBudget { bytes: number; limits: ArtifactLimits }
function readDescriptor(fd: number, path: string, budget: ReadBudget): Uint8Array {
  const before = fstatSync(fd, { bigint: true });
  if (!before.isFile() || before.nlink !== 1n) throw new Error(`Candidate must contain ordinary unlinked files: ${path}`);
  if (before.size > BigInt(budget.limits.maxFileBytes) || before.size > BigInt(budget.limits.maxBytes - budget.bytes)) throw new Error('Candidate exceeds artifact byte limits');
  const size = Number(before.size), bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const count = readSync(fd, bytes, offset, Math.min(size - offset, 64 * 1024), offset);
    if (count === 0) throw new Error('Source changed during bounded read');
    offset += count;
  }
  const after = fstatSync(fd, { bigint: true });
  if (readSync(fd, Buffer.alloc(1), 0, 1, size) !== 0 || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || before.mode !== after.mode || after.nlink !== 1n) throw new Error('Source changed during bounded read');
  budget.bytes += size;
  return bytes;
}
function readLocal(root: string, path: string, budget: ReadBudget): Uint8Array {
  const fd = openLocal(root, path);
  try { return readDescriptor(fd, path, budget); } finally { closeSync(fd); }
}

/** Shared deployment/release inventory: no pathname read before descriptor-safe admission. */
export function inventoryCandidateSource(root: string, entries: readonly string[], selectedLimits: ArtifactLimits = defaultArtifactLimits): FrozenFile[] {
  const limits = limitsFor(selectedLimits), budget = { bytes: 0, limits };
  const files = new Map<string, FrozenFile>(), countedPaths = new Set<string>(); let visits = 0;
  const visit = (path: string) => {
    const parts = path.split('/');
    if (++visits > limits.maxEntries || parts.length > limits.maxDepth) throw new Error('Candidate exceeds artifact entry/depth limits');
    for (let i = 1; i <= parts.length; i++) { countedPaths.add(parts.slice(0, i).join('/')); if (countedPaths.size > limits.maxEntries) throw new Error('Candidate exceeds artifact entry/depth limits'); }
    const fd = openLocal(root, path);
    try {
      const stat = fstatSync(fd);
      if (stat.isDirectory()) {
        const directory = opendirSync(`/proc/self/fd/${fd}`);
        try { for (let entry = directory.readSync(); entry; entry = directory.readSync()) visit(`${path}/${entry.name}`); } finally { directory.closeSync(); }
        return;
      }
      if (!files.has(path) && files.size >= limits.maxFiles) throw new Error('Candidate exceeds artifact file limit');
      files.set(path, { path, sha256: hashBytes(readDescriptor(fd, path, budget)), executable: (stat.mode & 0o111) !== 0 });
    } finally { closeSync(fd); }
  };
  entries.forEach(visit);
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

/** Store is a host-private path absent from candidate namespaces; chmod alone is not an isolation boundary. */
export function freezeCandidate(sourceRoot: string, storeRoot: string, entries: readonly string[], inputs: CandidateInputs, selectedLimits: ArtifactLimits = defaultArtifactLimits): FrozenCandidate {
  const limits = limitsFor(selectedLimits);
  const source = realpathSync(sourceRoot);
  mkdirSync(storeRoot, { recursive: true, mode: 0o700 });
  const store = realpathSync(storeRoot);
  const rel = relative(source, store);
  if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) throw new Error('Artifact store must be outside source workspace');
  const files = inventoryCandidateSource(source, entries, limits);
  if (!files.length) throw new Error('Cannot freeze an empty candidate');
  const fields = { source: identity(files), dependencies: identity(inputs.dependencies), prompts: identity(inputs.prompts),
    model: identity(inputs.model), configuration: identity(inputs.configuration), controls: identity(inputs.controls), createdBy: inputs.createdBy };
  const candidate: FrozenCandidate = { manifest: { id: candidateIdentity(fields), ...fields }, files, inputs };
  validateCandidate(candidate.manifest);
  const descriptor = canonicalJson(candidate);
  if (Buffer.byteLength(descriptor) > 16 * 1024 * 1024) throw new Error('Candidate exceeds artifact descriptor limit');
  const destination = join(store, candidate.manifest.id);
  if (existsSync(destination)) { verifyCandidate(store, candidate.manifest.id, limits); return candidate; }
  const staging = join(store, `.preparing-${randomUUID()}`);
  mkdirSync(staging, { mode: 0o700 });
  try {
    const directories = new Set<string>([staging]);
    const budget = { bytes: 0, limits };
    for (const file of files) {
      const bytes = readLocal(source, file.path, budget);
      if (hashBytes(bytes) !== file.sha256) throw new Error('Source changed during freeze');
      const target = join(staging, 'payload', file.path);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      writeFileSync(target, bytes, { flag: 'wx', mode: file.executable ? 0o500 : 0o400 });
      syncPath(target);
      for (let directory = dirname(target); directory !== staging; directory = dirname(directory)) directories.add(directory);
    }
    writeFileSync(join(staging, 'candidate.json'), descriptor, { flag: 'wx', mode: 0o400 });
    syncPath(join(staging, 'candidate.json'));
    [...directories].sort((a, b) => b.length - a.length).forEach(syncPath);
    renameSync(staging, destination);
    syncPath(store);
    verifyCandidate(store, candidate.manifest.id, limits);
    return candidate;
  } catch (error) { rmSync(staging, { recursive: true, force: true }); throw error; }
}

/** Rehash the actual payload at admission and immediately before activation. */
export function verifyCandidate(storeRoot: string, candidateId: string, selectedLimits: ArtifactLimits = defaultArtifactLimits): FrozenCandidate {
  const limits = limitsFor(selectedLimits);
  if (!/^[a-f0-9]{64}$/.test(candidateId)) throw new Error('Invalid candidate identity');
  const location = join(storeRoot, candidateId);
  for (const path of [location, join(location, 'payload')]) {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Artifact directories must be ordinary host-owned directories');
  }
  const descriptorStat = lstatSync(join(location, 'candidate.json'));
  if (!descriptorStat.isFile() || descriptorStat.isSymbolicLink() || descriptorStat.nlink !== 1) throw new Error('Candidate descriptor must be an ordinary unlinked file');
  const candidate = JSON.parse(Buffer.from(readLocal(location, 'candidate.json', { bytes: 0, limits: { ...limits, maxFileBytes: 16 * 1024 * 1024, maxBytes: 16 * 1024 * 1024 } })).toString('utf8')) as FrozenCandidate;
  validateCandidate(candidate.manifest);
  if (candidate.manifest.id !== candidateId || identity(candidate.files) !== candidate.manifest.source) throw new Error('Candidate source manifest mismatch');
  for (const key of ['dependencies', 'prompts', 'model', 'configuration', 'controls'] as const) {
    if (identity(candidate.inputs[key]) !== candidate.manifest[key]) throw new Error(`Candidate ${key} mismatch`);
  }
  if (candidate.inputs.createdBy !== candidate.manifest.createdBy) throw new Error('Candidate author mismatch');
  const files = inventoryCandidateSource(location, ['payload'], { ...limits, maxDepth: limits.maxDepth + 1, maxEntries: limits.maxEntries + 1 }).map(file => ({ ...file, path: file.path.slice('payload/'.length) }));
  if (identity(files) !== candidate.manifest.source) throw new Error('Frozen candidate payload changed');
  return candidate;
}

