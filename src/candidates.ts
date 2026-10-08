import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveExternalPath } from './config.ts';
import { runIsolated } from './isolation.ts';
import type { IsolationResult } from './isolation.ts';
import type { Json } from './store.ts';

export interface CandidateChange { path: string; content: string }
export interface CandidateFile { path: string; mode: '100644' | '100755'; sha256: string; size: number }
export interface CandidateRuntime { nodeVersion: string; nodeSha256: string; compilerPath: string; compilerSha256: string; toolchainDigest: string }
export type CandidateCheckName = 'typecheck' | 'trusted-agent-contract' | 'cross-scope-memory';
interface ManifestRecord {
  version: 1; id: string; manifestDigest: string; baseCommit: string; createdAt: string;
  files: CandidateFile[]; snapshotDigest: string; sourceDigest: string; governanceDigest: string;
  configuration: Record<string, Json>; modelProfile: { provider: string; model: string | null };
  runtime: CandidateRuntime; dataSchemaVersion: 1; acceptanceContractDigest: string; trustedCheckDigest: string;
  requiredChecks: CandidateCheckName[];
}
export interface CandidateManifest extends ManifestRecord { releaseDir: string; candidateRoot: string }
export interface CandidateCheck {
  name: string; status: 'passed' | 'failed'; detail: string; exitCode?: number | null;
  stdout?: string; stderr?: string; stdoutDigest?: string; stderrDigest?: string;
}
export interface CandidateEvidence {
  version: 1; candidateId: string; manifestDigest: string; baseCommit: string; status: 'passed' | 'failed';
  checks: CandidateCheck[]; createdAt: string; evidenceDigest: string;
}
export interface FreezeOptions {
  repositoryRoot: string; dataDir: string; changes: CandidateChange[];
  configuration: Record<string, Json>; modelProfile: { provider: string; model: string | null };
  /** Trusted orchestration selects checks; never take this from model output. */
  requiredChecks?: CandidateCheckName[];
}
export interface VerifyOptions { repositoryRoot: string; releaseDir: string; expectedBase?: string; requireCurrentBase?: boolean }

const installedRoot = fileURLToPath(new URL('..', import.meta.url));
const trustedCheckPath = join(installedRoot, 'trusted', 'agent-contract.test.mjs');
const toolchainRoot = join(installedRoot, 'node_modules');
const acceptancePath = 'docs/seed-contract.md';
const writableAgentPath = /^src\/agent\/[A-Za-z0-9][A-Za-z0-9._-]*\.ts$/;
const availableChecks: CandidateCheckName[] = ['typecheck', 'trusted-agent-contract', 'cross-scope-memory'];
const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

function normalized(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalized(item)]));
  throw new Error('Frozen values must be finite JSON data');
}
/** Stable object-key ordering for release, evidence, and review identities. */
export function digestJson(value: unknown): string { return sha256(JSON.stringify(normalized(value))); }

function nonsecret(value: unknown): void {
  normalized(value);
  if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    if (/api.?key|secret|password|credential|authorization|access.?token|refresh.?token/i.test(key)) throw new Error('Secret configuration must not enter a frozen manifest');
    nonsecret(item);
  }
}
function safePath(path: string): string {
  if (!path || isAbsolute(path) || path.includes('\\') || /[\u0000-\u001f\u007f]/u.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid frozen source path');
  return path;
}
function git(repositoryRoot: string, ...args: string[]): Buffer {
  return execFileSync('/usr/bin/git', args, { cwd: repositoryRoot, maxBuffer: 67_108_864, stdio: ['ignore', 'pipe', 'pipe'] });
}
function repoRoot(path: string): string {
  const root = realpathSync(path);
  if (realpathSync(git(root, 'rev-parse', '--show-toplevel').toString().trim()) !== root) throw new Error('Repository root must name the Git checkout root');
  return root;
}
function cleanBase(repositoryRoot: string): string {
  if (git(repositoryRoot, 'status', '--porcelain=v1', '--untracked-files=all').length) throw new Error('Candidate freezing requires a clean Git working tree');
  return git(repositoryRoot, 'rev-parse', 'HEAD').toString().trim();
}

function baseFiles(repositoryRoot: string, commit: string): Array<{ path: string; mode: CandidateFile['mode']; blob: string }> {
  return git(repositoryRoot, 'ls-tree', '-rz', '--full-tree', commit).toString().split('\0').filter(Boolean).map(entry => {
    const split = entry.indexOf('\t'); const [mode, kind, blob] = entry.slice(0, split).split(' '); const path = safePath(entry.slice(split + 1));
    if (mode === '120000') throw new Error('Frozen snapshots cannot contain symlinks');
    if ((mode !== '100644' && mode !== '100755') || kind !== 'blob' || !blob) throw new Error('Frozen snapshots support regular tracked files only');
    return { path, mode, blob };
  });
}

function scanSnapshot(root: string): CandidateFile[] {
  const files: CandidateFile[] = [];
  const visit = (directory: string) => {
    const entries = readdirSync(directory).sort();
    if (!entries.length) throw new Error('Frozen snapshot contains an unexpected empty directory');
    for (const name of entries) {
      const path = join(directory, name); const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error('Frozen snapshot contains a symlink');
      if (stat.isDirectory()) visit(path);
      else if (stat.isFile()) files.push({ path: safePath(relative(root, path).split(sep).join('/')), mode: stat.mode & 0o111 ? '100755' : '100644', size: stat.size, sha256: sha256(readFileSync(path)) });
      else throw new Error('Frozen snapshot contains a nonregular file');
    }
  };
  visit(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function toolchainDigest(): string {
  const entries: Array<{ path: string; digest: string }> = [];
  const visit = (directory: string) => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name); const stat = lstatSync(path);
      if (stat.isDirectory()) visit(path);
      else entries.push({ path: relative(toolchainRoot, path), digest: sha256(stat.isSymbolicLink() ? readlinkSync(path) : readFileSync(path)) });
    }
  };
  visit(toolchainRoot); return digestJson(entries);
}
function currentRuntime(): CandidateRuntime {
  const compilerPath = realpathSync(join(toolchainRoot, '@typescript', `typescript-${process.platform}-${process.arch}`, 'lib', 'tsc'));
  return { nodeVersion: process.version, nodeSha256: sha256(readFileSync(process.execPath)), compilerPath, compilerSha256: sha256(readFileSync(compilerPath)), toolchainDigest: toolchainDigest() };
}
function manifestPayload(record: ManifestRecord): Omit<ManifestRecord, 'id' | 'manifestDigest'> {
  const { id: _id, manifestDigest: _digest, ...payload } = record; return payload;
}
function governance(files: CandidateFile[], acceptanceContractDigest: string, trustedCheckDigest: string): string {
  const controls = new Set(['AGENTS.md', 'package.json', 'package-lock.json', 'tsconfig.json', 'docs/seed-contract.md', 'docs/acceptance.md']);
  const governed = files.filter(file => controls.has(file.path) || (!writableAgentPath.test(file.path) && file.path.startsWith('src/')) || file.path.startsWith('trusted/') || file.path.startsWith('test/'));
  return digestJson({ files: governed, acceptanceContractDigest, trustedCheckDigest });
}

function checkSelection(value: CandidateCheckName[]): CandidateCheckName[] {
  if (!Array.isArray(value) || new Set(value).size !== value.length || value.some(name => !availableChecks.includes(name)) || !value.includes('typecheck') || !value.includes('trusted-agent-contract')) throw new Error('Candidate required checks must include the protected baseline checks');
  return [...value];
}

export function freezeCandidate(options: FreezeOptions): CandidateManifest {
  return freezeSource(options, false);
}

/** Trusted bootstrap operation: capture current clean source without inventing a change. */
export function freezeBaseline(options: Omit<FreezeOptions, 'changes'>): CandidateManifest {
  return freezeSource({ ...options, changes: [] }, true);
}

function freezeSource(options: FreezeOptions, baseline: boolean): CandidateManifest {
  const repositoryRoot = repoRoot(options.repositoryRoot);
  const dataDir = resolveExternalPath(repositoryRoot, options.dataDir);
  const requiredChecks = checkSelection(options.requiredChecks ?? ['typecheck', 'trusted-agent-contract']);
  nonsecret(options.configuration); nonsecret(options.modelProfile);
  if (!options.modelProfile.provider?.trim() || (options.modelProfile.model !== null && (typeof options.modelProfile.model !== 'string' || !options.modelProfile.model.trim()))) throw new Error('Frozen model profile requires an explicit provider and model or null');
  if (!Array.isArray(options.changes) || (!baseline && !options.changes.length) || options.changes.length > 32) throw new Error('Candidate requires between 1 and 32 cognitive source changes');
  const paths = new Set<string>();
  for (const change of options.changes) {
    safePath(change.path);
    if (!writableAgentPath.test(change.path)) throw new Error('Candidate path is protected; only direct src/agent/*.ts changes are admitted');
    if (paths.has(change.path)) throw new Error('Duplicate candidate path'); paths.add(change.path);
    if (typeof change.content !== 'string' || !change.content.trim() || Buffer.byteLength(change.content) > 524_288) throw new Error('Candidate source content must be nonempty and bounded');
  }
  const baseCommit = cleanBase(repositoryRoot); const tracked = baseFiles(repositoryRoot, baseCommit);
  const releaseParent = resolveExternalPath(repositoryRoot, join(dataDir, 'releases'));
  mkdirSync(releaseParent, { recursive: true, mode: 0o700 });
  const temporary = join(releaseParent, `.building-${randomUUID()}`); const candidateRoot = join(temporary, 'source');
  mkdirSync(candidateRoot, { recursive: true, mode: 0o700 });
  try {
    let total = 0;
    for (const file of tracked) {
      const content = git(repositoryRoot, 'cat-file', 'blob', file.blob); total += content.length;
      if (total > 67_108_864 || content.length > 16_777_216) throw new Error('Tracked snapshot exceeds seed size budget');
      const destination = join(candidateRoot, file.path); mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
      writeFileSync(destination, content, { mode: file.mode === '100755' ? 0o700 : 0o600 });
    }
    for (const change of options.changes) {
      const destination = join(candidateRoot, change.path);
      if (existsSync(destination) && readFileSync(destination, 'utf8') === change.content) throw new Error('No-op candidate change is not an improvement');
      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 }); writeFileSync(destination, change.content, { mode: 0o600 });
    }
    const files = scanSnapshot(candidateRoot);
    if (!files.some(file => file.path === 'src/agent/brain.ts')) throw new Error('Candidate must contain its cognitive entrypoint');
    const acceptanceContractDigest = sha256(readFileSync(join(candidateRoot, acceptancePath)));
    const trustedCheckDigest = sha256(readFileSync(trustedCheckPath));
    const payload = {
      version: 1 as const, baseCommit, createdAt: new Date().toISOString(), files,
      snapshotDigest: digestJson(files), sourceDigest: digestJson(files.filter(file => writableAgentPath.test(file.path))),
      governanceDigest: governance(files, acceptanceContractDigest, trustedCheckDigest), configuration: structuredClone(options.configuration), modelProfile: structuredClone(options.modelProfile),
      runtime: currentRuntime(), dataSchemaVersion: 1 as const, acceptanceContractDigest, trustedCheckDigest, requiredChecks,
    };
    const manifestDigest = digestJson(payload); const record: ManifestRecord = { ...payload, id: manifestDigest, manifestDigest };
    for (const file of files) chmodSync(join(candidateRoot, file.path), file.mode === '100755' ? 0o500 : 0o400);
    writeFileSync(join(temporary, 'manifest.json'), JSON.stringify(record, null, 2), { flag: 'wx', mode: 0o400 });
    if (cleanBase(repositoryRoot) !== baseCommit) throw new Error('Git base changed while freezing candidate');
    const releaseDir = join(releaseParent, record.id); renameSync(temporary, releaseDir);
    return { ...record, releaseDir, candidateRoot: join(releaseDir, 'source') };
  } catch (error) { rmSync(temporary, { recursive: true, force: true }); throw error; }
}

export function readManifest(releaseDirectory: string): CandidateManifest {
  const releaseDir = realpathSync(releaseDirectory); const manifestPath = join(releaseDir, 'manifest.json');
  if (!lstatSync(manifestPath).isFile() || lstatSync(manifestPath).size > 2_097_152) throw new Error('Invalid candidate manifest file');
  const record = JSON.parse(readFileSync(manifestPath, 'utf8')) as ManifestRecord;
  if (record.version !== 1 || record.dataSchemaVersion !== 1 || !Array.isArray(record.files) || record.id !== record.manifestDigest || digestJson(manifestPayload(record)) !== record.manifestDigest) throw new Error('Candidate manifest digest mismatch');
  checkSelection(record.requiredChecks);
  if (record.files.some(file => !file || safePath(file.path) !== file.path || !['100644', '100755'].includes(file.mode) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0)) throw new Error('Invalid frozen file manifest');
  if (new Set(record.files.map(file => file.path)).size !== record.files.length) throw new Error('Duplicate frozen manifest path');
  nonsecret(record.configuration); nonsecret(record.modelProfile);
  const candidateRoot = join(releaseDir, 'source');
  if (lstatSync(candidateRoot).isSymbolicLink() || !lstatSync(candidateRoot).isDirectory()) throw new Error('Invalid frozen source root');
  return { ...record, releaseDir, candidateRoot };
}

export function verifyFrozenCandidate(options: VerifyOptions): CandidateManifest {
  const repositoryRoot = repoRoot(options.repositoryRoot);
  resolveExternalPath(repositoryRoot, options.releaseDir);
  const manifest = readManifest(options.releaseDir);
  const expectedBase = options.expectedBase ?? git(repositoryRoot, 'rev-parse', 'HEAD').toString().trim();
  if ((options.requireCurrentBase !== false || options.expectedBase !== undefined) && manifest.baseCommit !== expectedBase) throw new Error('Candidate has a stale Git base');
  const files = scanSnapshot(manifest.candidateRoot);
  if (digestJson(files) !== manifest.snapshotDigest || digestJson(files) !== digestJson(manifest.files) || digestJson(files.filter(file => writableAgentPath.test(file.path))) !== manifest.sourceDigest) throw new Error('Frozen source digest mismatch: candidate was modified');
  const original = baseFiles(repositoryRoot, manifest.baseCommit);
  for (const file of original.filter(file => !writableAgentPath.test(file.path))) {
    const actual = files.find(candidate => candidate.path === file.path);
    if (!actual || actual.mode !== file.mode || actual.sha256 !== sha256(git(repositoryRoot, 'cat-file', 'blob', file.blob))) throw new Error('Frozen candidate modified protected baseline source');
  }
  if (files.some(file => !original.some(base => base.path === file.path) && !writableAgentPath.test(file.path))) throw new Error('Frozen candidate added protected source');
  if (sha256(readFileSync(join(manifest.candidateRoot, acceptancePath))) !== manifest.acceptanceContractDigest || sha256(readFileSync(trustedCheckPath)) !== manifest.trustedCheckDigest || governance(files, manifest.acceptanceContractDigest, manifest.trustedCheckDigest) !== manifest.governanceDigest) throw new Error('Frozen acceptance or trusted-check identity changed');
  if (digestJson(currentRuntime()) !== digestJson(manifest.runtime)) throw new Error('Frozen runtime or installed toolchain identity changed');
  return manifest;
}

function processCheck(name: string, result: IsolationResult): CandidateCheck {
  const passed = result.exitCode === 0 && !result.timedOut && !result.aborted && !result.outputLimitExceeded;
  return { name, status: passed ? 'passed' : 'failed', detail: passed ? 'Isolated process completed successfully' : `Isolated process failed: timeout=${result.timedOut}, cancelled=${result.aborted}, outputLimit=${result.outputLimitExceeded}, signal=${result.signal ?? 'none'}`, exitCode: result.exitCode,
    stdout: result.stdout, stderr: result.stderr, stdoutDigest: sha256(result.stdout), stderrDigest: sha256(result.stderr) };
}

async function protectedBehavior(manifest: CandidateManifest, name: 'trusted-agent-contract' | 'cross-scope-memory', timeoutMs?: number): Promise<CandidateCheck> {
  try {
    const contract = await import(pathToFileURL(trustedCheckPath).href) as {
      makeFixtures(): unknown[]; validateResponses(fixtures: unknown[], responses: unknown): unknown[];
      makeScopeIsolationFixtures(): unknown[]; validateScopeIsolationResponses(fixtures: unknown[], responses: unknown): unknown[];
    };
    const fixtures = name === 'cross-scope-memory' ? contract.makeScopeIsolationFixtures() : contract.makeFixtures();
    const bridge = `import { readFileSync } from 'node:fs'; import { pathToFileURL } from 'node:url'; const fixtures=JSON.parse(readFileSync(0,'utf8')); const {conversationRequest}=await import(pathToFileURL(process.argv[1]).href); const responses=[]; for(const fixture of fixtures) responses.push(await conversationRequest(fixture.task,fixture.memories)); process.stdout.write(JSON.stringify({responses}));`;
    const result = await runIsolated({ program: process.execPath, args: ['--input-type=module', '-e', bridge, join(manifest.candidateRoot, 'src', 'agent', 'brain.ts')], cwd: manifest.candidateRoot, stdin: JSON.stringify(fixtures), timeoutMs: timeoutMs ?? 30_000, maxOutputBytes: 262_144 });
    const check = processCheck(name, result);
    if (check.status === 'passed') {
      try {
        const responses = JSON.parse(result.stdout).responses;
        const assertions = name === 'cross-scope-memory' ? contract.validateScopeIsolationResponses(fixtures, responses) : contract.validateResponses(fixtures, responses);
        check.detail = `${assertions.length} protected behavioral fixtures passed outside candidate execution`;
      } catch (error) { check.status = 'failed'; check.detail = `Protected behavioral contract failed: ${error instanceof Error ? error.message : 'invalid candidate response'}`; }
    }
    return check;
  } catch (error) { return { name, status: 'failed', detail: error instanceof Error ? error.message : 'Trusted contract unavailable' }; }
}

/** Diagnostic baseline challenge, never itself admission evidence. */
export async function evaluateChallenge(options: VerifyOptions & { challenge: 'cross-scope-memory'; timeoutMs?: number }): Promise<CandidateCheck> {
  const manifest = verifyFrozenCandidate(options);
  const result = await protectedBehavior(manifest, options.challenge, options.timeoutMs);
  if (verifyFrozenCandidate(options).manifestDigest !== manifest.manifestDigest) throw new Error('Frozen candidate changed during challenge');
  return result;
}

export async function evaluateCandidate(options: { repositoryRoot: string; releaseDir: string; timeoutMs?: number }): Promise<CandidateEvidence> {
  const manifest = verifyFrozenCandidate(options); const checks: CandidateCheck[] = [];
  const compiler = manifest.runtime;
  try {
    const result = await runIsolated({ program: compiler.compilerPath, trustedExecutables: [{ path: compiler.compilerPath, sha256: compiler.compilerSha256 }],
      args: ['--ignoreConfig', '--noEmit', '--strict', '--target', 'es2024', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--allowImportingTsExtensions', '--erasableSyntaxOnly', '--verbatimModuleSyntax', '--skipLibCheck', '--types', 'node', '--typeRoots', join(toolchainRoot, '@types'), ...manifest.files.filter(file => file.path.endsWith('.ts')).map(file => join(manifest.candidateRoot, file.path))],
      cwd: manifest.candidateRoot, readPaths: [toolchainRoot], timeoutMs: options.timeoutMs ?? 30_000, maxOutputBytes: 262_144 });
    checks.push(processCheck('typecheck', result));
  } catch (error) { checks.push({ name: 'typecheck', status: 'failed', detail: error instanceof Error ? error.message : 'Typechecker unavailable' }); }
  checks.push(await protectedBehavior(manifest, 'trusted-agent-contract', options.timeoutMs));
  if (manifest.requiredChecks.includes('cross-scope-memory')) checks.push(await protectedBehavior(manifest, 'cross-scope-memory', options.timeoutMs));
  const after = verifyFrozenCandidate(options);
  if (after.manifestDigest !== manifest.manifestDigest) throw new Error('Frozen candidate changed during evaluation');
  const body = { version: 1 as const, candidateId: manifest.id, manifestDigest: manifest.manifestDigest, baseCommit: manifest.baseCommit, status: checks.every(check => check.status === 'passed') ? 'passed' as const : 'failed' as const, checks, createdAt: new Date().toISOString() };
  const evidence: CandidateEvidence = { ...body, evidenceDigest: digestJson(body) };
  const evidenceDir = join(manifest.releaseDir, 'evidence'); mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(evidenceDir, `${evidence.evidenceDigest}.json`), JSON.stringify(evidence, null, 2), { flag: 'wx', mode: 0o400 });
  return evidence;
}
