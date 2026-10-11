import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

function enumerate(root: string, entries: readonly string[]): FrozenFile[] {
  const files = new Map<string, FrozenFile>();
  const visit = (path: string) => {
    localPath(path);
    const full = join(root, path);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error(`Candidate symlink not admitted: ${path}`);
    if (stat.isDirectory()) { readdirSync(full).sort().forEach(name => visit(`${path}/${name}`)); return; }
    if (!stat.isFile() || stat.nlink !== 1) throw new Error(`Candidate must contain ordinary unlinked files: ${path}`);
    files.set(path, { path, sha256: hashBytes(readFileSync(full)), executable: (stat.mode & 0o111) !== 0 });
  };
  entries.forEach(visit);
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

/** Store is a host-private path absent from candidate namespaces; chmod alone is not an isolation boundary. */
export function freezeCandidate(sourceRoot: string, storeRoot: string, entries: readonly string[], inputs: CandidateInputs): FrozenCandidate {
  const source = realpathSync(sourceRoot);
  mkdirSync(storeRoot, { recursive: true, mode: 0o700 });
  const store = realpathSync(storeRoot);
  const rel = relative(source, store);
  if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) throw new Error('Artifact store must be outside source workspace');
  const files = enumerate(source, entries);
  if (!files.length) throw new Error('Cannot freeze an empty candidate');
  const fields = { source: identity(files), dependencies: identity(inputs.dependencies), prompts: identity(inputs.prompts),
    model: identity(inputs.model), configuration: identity(inputs.configuration), controls: identity(inputs.controls), createdBy: inputs.createdBy };
  const candidate: FrozenCandidate = { manifest: { id: candidateIdentity(fields), ...fields }, files, inputs };
  validateCandidate(candidate.manifest);
  const destination = join(store, candidate.manifest.id);
  if (existsSync(destination)) { verifyCandidate(store, candidate.manifest.id); return candidate; }
  const staging = join(store, `.preparing-${randomUUID()}`);
  mkdirSync(staging, { mode: 0o700 });
  try {
    const directories = new Set<string>([staging]);
    for (const file of files) {
      const bytes = readFileSync(join(source, file.path));
      if (hashBytes(bytes) !== file.sha256) throw new Error('Source changed during freeze');
      const target = join(staging, 'payload', file.path);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      writeFileSync(target, bytes, { flag: 'wx', mode: file.executable ? 0o500 : 0o400 });
      syncPath(target);
      for (let directory = dirname(target); directory !== staging; directory = dirname(directory)) directories.add(directory);
    }
    writeFileSync(join(staging, 'candidate.json'), canonicalJson(candidate), { flag: 'wx', mode: 0o400 });
    syncPath(join(staging, 'candidate.json'));
    [...directories].sort((a, b) => b.length - a.length).forEach(syncPath);
    renameSync(staging, destination);
    syncPath(store);
    verifyCandidate(store, candidate.manifest.id);
    return candidate;
  } catch (error) { rmSync(staging, { recursive: true, force: true }); throw error; }
}

/** Rehash the actual payload at admission and immediately before activation. */
export function verifyCandidate(storeRoot: string, candidateId: string): FrozenCandidate {
  if (!/^[a-f0-9]{64}$/.test(candidateId)) throw new Error('Invalid candidate identity');
  const location = join(storeRoot, candidateId);
  for (const path of [location, join(location, 'payload')]) {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Artifact directories must be ordinary host-owned directories');
  }
  const descriptorStat = lstatSync(join(location, 'candidate.json'));
  if (!descriptorStat.isFile() || descriptorStat.isSymbolicLink() || descriptorStat.nlink !== 1) throw new Error('Candidate descriptor must be an ordinary unlinked file');
  const candidate = JSON.parse(readFileSync(join(location, 'candidate.json'), 'utf8')) as FrozenCandidate;
  validateCandidate(candidate.manifest);
  if (candidate.manifest.id !== candidateId || identity(candidate.files) !== candidate.manifest.source) throw new Error('Candidate source manifest mismatch');
  for (const key of ['dependencies', 'prompts', 'model', 'configuration', 'controls'] as const) {
    if (identity(candidate.inputs[key]) !== candidate.manifest[key]) throw new Error(`Candidate ${key} mismatch`);
  }
  if (candidate.inputs.createdBy !== candidate.manifest.createdBy) throw new Error('Candidate author mismatch');
  const files = enumerate(join(location, 'payload'), readdirSync(join(location, 'payload')));
  if (identity(files) !== candidate.manifest.source) throw new Error('Frozen candidate payload changed');
  return candidate;
}

