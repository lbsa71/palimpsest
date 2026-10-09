import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { digestJson, readManifest } from './candidates.ts';
import type { CandidateFile } from './candidates.ts';
import type { Release } from './custodian.ts';

/** Host observation, never part of model-authored GrowthReflection. Complete
 * replacement files are valid only against this exact admitted source/base. */
export interface SourceBinding {
  version: 1;
  releaseDigest: string;
  sourceDigest: string;
  baseCommit: string;
}

const cognitivePath = /^src\/agent\/[A-Za-z0-9][A-Za-z0-9._-]*\.ts$/;
const sha256 = (value: Buffer): string => createHash('sha256').update(value).digest('hex');

export function parseSourceBinding(value: unknown): SourceBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Missing or invalid source binding');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 4 || Object.keys(record).some(key => !['version', 'releaseDigest', 'sourceDigest', 'baseCommit'].includes(key))
    || record.version !== 1 || typeof record.releaseDigest !== 'string' || !/^[a-f0-9]{64}$/.test(record.releaseDigest)
    || typeof record.sourceDigest !== 'string' || !/^[a-f0-9]{64}$/.test(record.sourceDigest)
    || typeof record.baseCommit !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(record.baseCommit)) throw new Error('Invalid source binding');
  return Object.freeze({ version: 1, releaseDigest: record.releaseDigest, sourceDigest: record.sourceDigest, baseCommit: record.baseCommit });
}

export function assertSourceBindingCurrent(recorded: unknown, current: SourceBinding): void {
  const binding = parseSourceBinding(recorded);
  const observed = parseSourceBinding(current);
  if (binding.releaseDigest !== observed.releaseDigest || binding.sourceDigest !== observed.sourceDigest || binding.baseCommit !== observed.baseCommit) {
    throw new Error('Stale source binding: proposal must be authored against the current admitted release and Git base');
  }
}

/** Observe before inference. Publication may have advanced HEAD beyond the
 * release's original freeze base; actual current HEAD and cognitive bytes must
 * agree with the serving artifact. No source is edited or silently rebased. */
export function observeSourceIdentity(options: { repositoryRoot: string; release: Pick<Release, 'digest' | 'artifactPath'> }): SourceBinding {
  const root = realpathSync(options.repositoryRoot);
  const git = (...args: string[]) => execFileSync('/usr/bin/git', args, { cwd: root, maxBuffer: 67_108_864, stdio: ['ignore', 'pipe', 'pipe'] });
  if (realpathSync(git('rev-parse', '--show-toplevel').toString().trim()) !== root) throw new Error('Source observation requires the Git checkout root');
  const cleanHead = () => {
    if (git('status', '--porcelain=v1', '--untracked-files=all').length) throw new Error('Source observation requires a clean Git checkout');
    return git('rev-parse', 'HEAD').toString().trim();
  };
  const baseCommit = cleanHead();
  const manifest = readManifest(options.release.artifactPath);
  if (manifest.manifestDigest !== options.release.digest) throw new Error('Active release descriptor does not match its manifest');
  const files: CandidateFile[] = git('ls-tree', '-rz', '--full-tree', baseCommit).toString().split('\0').filter(Boolean).flatMap<CandidateFile>(entry => {
    const split = entry.indexOf('\t');
    const path = entry.slice(split + 1);
    if (!cognitivePath.test(path)) return [];
    const [mode, kind, blob] = entry.slice(0, split).split(' ');
    if ((mode !== '100644' && mode !== '100755') || kind !== 'blob' || !blob) throw new Error('Cognitive source must be regular tracked files');
    const bytes = git('cat-file', 'blob', blob);
    return [{ path, mode, size: bytes.length, sha256: sha256(bytes) }];
  }).sort((a, b) => a.path.localeCompare(b.path));
  const admitted = manifest.files.filter(file => cognitivePath.test(file.path));
  if (!files.some(file => file.path === 'src/agent/brain.ts') || digestJson(files) !== manifest.sourceDigest || digestJson(admitted) !== manifest.sourceDigest) {
    throw new Error('Checkout cognitive source does not match the admitted source digest');
  }
  for (const sourceRoot of [root, manifest.candidateRoot]) {
    for (const directory of ['src', 'src/agent']) {
      const stat = lstatSync(join(sourceRoot, directory));
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid cognitive source directory');
    }
    for (const file of admitted) {
      const path = join(sourceRoot, file.path), stat = lstatSync(path);
      // Git status alone can miss assume-unchanged/skip-worktree changes. Check
      // actual checkout bytes as well as the retained admitted artifact.
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.size || (stat.mode & 0o111 ? '100755' : '100644') !== file.mode
        || sha256(readFileSync(path)) !== file.sha256) throw new Error('Checkout or frozen admitted cognitive source digest mismatch');
    }
  }
  if (cleanHead() !== baseCommit) throw new Error('Git source changed during source observation');
  return parseSourceBinding({ version: 1, releaseDigest: manifest.manifestDigest, sourceDigest: manifest.sourceDigest, baseCommit });
}
