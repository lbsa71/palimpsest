import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runIsolated } from './isolation.ts';
import type { CandidateRuntime } from './candidates.ts';

export interface WorkspaceCommand { tool: 'node' | 'native-tsc'; args: string[]; cwd?: string }
export interface WorkspaceCommandOptions {
  commandId: string; root: string; outputDirectory: string; runtime: CandidateRuntime; command: WorkspaceCommand;
  /** Trusted grants. The receiver verifies the admitted aggregate toolchain
   * digest; this runner verifies current executable identities. */
  readPaths?: string[]; denyReadPaths?: string[];
  timeoutMs?: number; maxOutputBytes?: number; signal?: AbortSignal;
  /** Synchronous durable PID observation; failure kills and drains the child. */
  onPid?: (pid: number) => void;
}
interface Identity { device: number; inode: number }
export interface WorkspaceCommandStream extends Identity { bytes: number; sha256: string }
export interface WorkspaceCommandReceipt {
  version: 1; commandId: string; command: WorkspaceCommand; runtime: CandidateRuntime;
  limits: { timeoutMs: number; maxOutputBytes: number };
  grants: { readPaths: string[]; denyReadPaths: string[] };
  root: Identity; outputDirectory: Identity;
  exit: { kind: 'observed'; code: number | null; signal: NodeJS.Signals | null };
  timedOut: boolean; aborted: boolean; outputLimitExceeded: boolean;
  exitSuccessful: boolean; outputComplete: boolean; durationMs: number;
  streams: { stdout: WorkspaceCommandStream; stderr: WorkspaceCommandStream };
}
export interface WorkspaceCommandPage {
  stream: 'stdout' | 'stderr'; offset: number; endOffset: number; totalBytes: number;
  nextOffset: number | null; sha256: string; outputComplete: boolean; base64: string; text?: string;
}
export class WorkspaceCommandError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = 'WorkspaceCommandError'; this.code = code; }
}
const maxCapture = 1_048_576, maxPage = 65_536;
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const validSha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const failure = (code: string): never => { throw new WorkspaceCommandError(code); };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const identity = (stat: fs.Stats): Identity => ({ device: stat.dev, inode: stat.ino });
const matchesIdentity = (stat: fs.Stats, expected: Identity) => stat.dev === expected.device && stat.ino === expected.inode;
const within = (parent: string, child: string) => { const path = relative(parent, child); return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)); };
function canonicalDirectory(path: string, privateDirectory: boolean): string {
  if (typeof path !== 'string' || !isAbsolute(path) || /[\x00-\x1f\x7f-\x9f]/.test(path)) failure('invalid-command-directory');
  const stat = fs.lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o7000) || (privateDirectory && (stat.mode & 0o077))) failure('invalid-command-directory');
  return fs.realpathSync(path);
}
function workingDirectory(root: string, cwd?: string): string {
  if (cwd === undefined || cwd === '.') return root;
  if (typeof cwd !== 'string' || !cwd || Buffer.byteLength(cwd) > 1024 || /[\x00-\x1f\x7f-\x9f\\]/.test(cwd)
      || Buffer.from(cwd).toString('utf8') !== cwd || cwd.split('/').length > 64
      || cwd.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) failure('invalid-command-cwd');
  let path = root;
  for (const part of cwd.split('/')) { path = join(path, part); const stat = fs.lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o7000)) failure('invalid-command-cwd'); }
  if (!within(root, fs.realpathSync(path))) failure('invalid-command-cwd'); return path;
}
function validateCommand(command: WorkspaceCommand): void {
  if (!object(command) || !['node', 'native-tsc'].includes(command.tool) || Object.keys(command).some(key => !['tool', 'args', 'cwd'].includes(key))
      || !Array.isArray(command.args) || command.args.length > 256 || command.args.some(arg => typeof arg !== 'string' || arg.includes('\0')
        || Buffer.from(arg).toString('utf8') !== arg || Buffer.byteLength(arg) > 16384)
      || Buffer.byteLength(JSON.stringify(command.args)) > 65536) failure('invalid-command-arguments');
}
function verifyRuntime(runtime: CandidateRuntime): { node: string; compiler: string } {
  if (!object(runtime) || runtime.nodeVersion !== process.version || !validSha(runtime.nodeSha256)
      || !validSha(runtime.compilerSha256) || !validSha(runtime.toolchainDigest)
      || Object.keys(runtime).sort().join(',') !== 'compilerPath,compilerSha256,nodeSha256,nodeVersion,toolchainDigest') failure('command-runtime-mismatch');
  const node = fs.realpathSync(process.execPath);
  const compiler = fs.realpathSync(fileURLToPath(new URL(`../node_modules/@typescript/typescript-${process.platform}-${process.arch}/lib/tsc`, import.meta.url)));
  if (runtime.compilerPath !== compiler || sha(fs.readFileSync(node)) !== runtime.nodeSha256
      || sha(fs.readFileSync(compiler)) !== runtime.compilerSha256) failure('command-runtime-mismatch');
  return { node, compiler };
}
function canonicalGrants(paths: string[]): string[] {
  if (!Array.isArray(paths) || paths.length > 32) failure('invalid-command-read-grants');
  return [...new Set(paths.map(path => {
    if (typeof path !== 'string' || !isAbsolute(path) || Buffer.byteLength(path) > 4096 || /[\x00-\x1f\x7f-\x9f]/.test(path)) failure('invalid-command-read-grants');
    const canonical = fs.realpathSync(path), stat = fs.statSync(canonical);
    if (!stat.isFile() && !stat.isDirectory()) failure('invalid-command-read-grants'); return canonical;
  }))];
}
function flushDirectory(path: string): void {
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); } return value;
}
function privateRegular(stat: fs.Stats): boolean { return stat.isFile() && stat.nlink === 1 && (stat.mode & 0o7077) === 0; }
function readExact(fd: number, bytes: number): Buffer {
  const buffer = Buffer.alloc(bytes); let offset = 0;
  while (offset < bytes) { const n = fs.readSync(fd, buffer, offset, bytes - offset, offset); if (!n) failure('command-output-invalid'); offset += n; } return buffer;
}

/** Internal mechanics: the receiver owns authority, leases, reservations,
 * checkpoints and acceptance of this observation under the current epoch. */
export async function runWorkspaceCommand(options: WorkspaceCommandOptions): Promise<WorkspaceCommandReceipt> {
  let stdoutFd: number | undefined, stderrFd: number | undefined; let observerCode: string | undefined;
  try {
    const command = structuredClone(options.command), runtime = structuredClone(options.runtime), commandId = options.commandId;
    if (typeof commandId !== 'string' || !commandId || Buffer.byteLength(commandId) > 256 || /[\x00-\x1f\x7f-\x9f]/.test(commandId)
        || Buffer.from(commandId).toString('utf8') !== commandId) failure('invalid-command-id');
    validateCommand(command);
    const timeoutMs = options.timeoutMs ?? 30000, maxOutputBytes = options.maxOutputBytes ?? maxCapture;
    if (!integer(timeoutMs, 1, 30000) || !integer(maxOutputBytes, 1, maxCapture)) failure('invalid-command-limits');
    const root = canonicalDirectory(options.root, false), outputDirectory = canonicalDirectory(options.outputDirectory, true);
    if (within(root, outputDirectory) || within(outputDirectory, root)) failure('invalid-command-directory');
    const rootIdentity = identity(fs.lstatSync(root)), outputIdentity = identity(fs.lstatSync(outputDirectory));
    const handle = fs.opendirSync(outputDirectory); try { if (handle.readSync() !== null) failure('command-output-exists'); } finally { handle.closeSync(); }
    const cwd = workingDirectory(root, command.cwd), readPaths = canonicalGrants([...(options.readPaths ?? [])]), denyReadPaths = canonicalGrants([...(options.denyReadPaths ?? [])]);
    if (readPaths.some(path => within(fs.realpathSync(path), outputDirectory))) failure('invalid-command-read-grants');
    const executables = verifyRuntime(runtime);
    const openSpool = (stream: string) => fs.openSync(join(outputDirectory, `${stream}.bin`),
      fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    stdoutFd = openSpool('stdout'); stderrFd = openSpool('stderr'); flushDirectory(outputDirectory);
    const stdoutIdentity = identity(fs.fstatSync(stdoutFd)), stderrIdentity = identity(fs.fstatSync(stderrFd));
    const hashes = { stdout: createHash('sha256'), stderr: createHash('sha256') }, bytes = { stdout: 0, stderr: 0 };
    const accept = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
      try { const fd = stream === 'stdout' ? stdoutFd! : stderrFd!; let offset = 0;
        while (offset < chunk.length) { const written = fs.writeSync(fd, chunk, offset, chunk.length - offset);
          if (!integer(written, 1, chunk.length - offset)) failure('command-output-storage-failed');
          hashes[stream].update(chunk.subarray(offset, offset + written)); bytes[stream] += written; offset += written; }
      } catch { observerCode = 'command-output-storage-failed'; failure(observerCode); }
    };
    const result = await runIsolated({
      program: command.tool === 'node' ? executables.node : executables.compiler,
      trustedExecutables: command.tool === 'native-tsc' ? [{ path: executables.compiler, sha256: runtime.compilerSha256 }] : undefined,
      args: command.args, cwd, readPaths: [root, ...readPaths], denyReadPaths, writePaths: [root], timeoutMs, maxOutputBytes, signal: options.signal,
      // No child exception or candidate-selected environment/program/grants.
      onSpawn: child => { try {
        if (!child.pid || child.pid <= 0) failure('command-pid-unavailable');
        const returned = (options.onPid as ((pid: number) => unknown) | undefined)?.(child.pid!);
        if (returned !== undefined && object(returned) && typeof returned.then === 'function') {
          // A mistaken async observer is not a durable synchronous PID receipt.
          // Consume its rejection while the isolated process is killed/drained.
          void Promise.resolve(returned).catch(() => {}); failure('command-pid-observer-failed');
        }
      } catch { observerCode = 'command-pid-observer-failed'; failure(observerCode); } },
      onStdout: chunk => accept('stdout', chunk), onStderr: chunk => accept('stderr', chunk),
    });
    verifyRuntime(runtime);
    if (!matchesIdentity(fs.lstatSync(root), rootIdentity) || !matchesIdentity(fs.lstatSync(outputDirectory), outputIdentity)
        || canonicalDirectory(outputDirectory, true) !== outputDirectory) failure('command-directory-changed');
    const seal = (fd: number, original: Identity, stream: 'stdout' | 'stderr'): WorkspaceCommandStream => {
      const stat = fs.fstatSync(fd), path = join(outputDirectory, `${stream}.bin`), entry = fs.lstatSync(path);
      if (!privateRegular(stat) || !privateRegular(entry) || !matchesIdentity(entry, original)
          || !matchesIdentity(stat, original) || stat.size !== bytes[stream]) failure('command-output-invalid');
      fs.fsyncSync(fd); fs.fchmodSync(fd, 0o400); fs.fsyncSync(fd); const sha256 = hashes[stream].digest('hex');
      if (sha(readExact(fd, bytes[stream])) !== sha256) failure('command-output-invalid');
      const sealed = fs.lstatSync(path);
      if (!privateRegular(sealed) || !matchesIdentity(sealed, original) || (sealed.mode & 0o777) !== 0o400) failure('command-output-invalid');
      return { ...original, bytes: bytes[stream], sha256 };
    };
    const receipt: WorkspaceCommandReceipt = {
      version: 1, commandId, command, runtime, root: rootIdentity, outputDirectory: outputIdentity,
      limits: { timeoutMs, maxOutputBytes }, grants: { readPaths: [root, ...readPaths], denyReadPaths },
      exit: { kind: 'observed', code: result.exitCode, signal: result.signal }, timedOut: result.timedOut, aborted: result.aborted,
      outputLimitExceeded: result.outputLimitExceeded,
      exitSuccessful: result.exitCode === 0 && result.signal === null && !result.timedOut && !result.aborted && !result.outputLimitExceeded,
      outputComplete: !result.outputLimitExceeded && !result.timedOut && !result.aborted && result.signal === null, durationMs: result.durationMs,
      streams: { stdout: seal(stdoutFd, stdoutIdentity, 'stdout'), stderr: seal(stderrFd, stderrIdentity, 'stderr') },
    };
    const receiptFd = fs.openSync(join(outputDirectory, 'receipt.json'), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(receiptFd, JSON.stringify(receipt)); fs.fsyncSync(receiptFd); fs.fchmodSync(receiptFd, 0o400); fs.fsyncSync(receiptFd); }
    finally { fs.closeSync(receiptFd); }
    flushDirectory(outputDirectory); return deepFreeze(receipt);
  } catch (error) {
    if (observerCode) throw new WorkspaceCommandError(observerCode);
    if (error instanceof WorkspaceCommandError) throw error;
    // Filesystem/isolation/observer errors can contain private paths or strings.
    throw new WorkspaceCommandError('command-execution-or-storage-failed');
  } finally { for (const fd of [stdoutFd, stderrFd]) if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* retain original failure */ } } }
}

/** Trusted receipt/directory only. Authorization and opaque identity lookup
 * belong to the receiver; model input can supply only stream/byte range. */
export function readWorkspaceCommandOutput(options: {
  outputDirectory: string; receipt: WorkspaceCommandReceipt; stream: 'stdout' | 'stderr'; offset: number; length: number;
}): WorkspaceCommandPage {
  let fd: number | undefined;
  try {
    const { receipt, stream, offset, length } = options;
    if (!object(receipt) || receipt.version !== 1 || !['stdout', 'stderr'].includes(stream)
        || !integer(offset, 0, maxCapture) || !integer(length, 1, maxPage) || !object(receipt.streams)
        || typeof receipt.outputComplete !== 'boolean') failure('invalid-command-output-request');
    const expected = receipt.streams[stream];
    if (!object(expected) || !validSha(expected.sha256) || !integer(expected.bytes, 0, maxCapture) || offset > expected.bytes
        || !integer(expected.device, 0, Number.MAX_SAFE_INTEGER) || !integer(expected.inode, 0, Number.MAX_SAFE_INTEGER)) failure('invalid-command-output-receipt');
    const directory = canonicalDirectory(options.outputDirectory, true);
    if (!object(receipt.outputDirectory) || !matchesIdentity(fs.lstatSync(directory), receipt.outputDirectory)) failure('command-output-directory-changed');
    fd = fs.openSync(join(directory, `${stream}.bin`), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const before = fs.fstatSync(fd);
    if (!privateRegular(before) || (before.mode & 0o777) !== 0o400 || !matchesIdentity(before, expected) || before.size !== expected.bytes) failure('command-output-invalid');
    const raw = readExact(fd, expected.bytes), after = fs.fstatSync(fd);
    if (!privateRegular(after) || !matchesIdentity(after, expected) || after.size !== before.size || after.mtimeMs !== before.mtimeMs
        || after.ctimeMs !== before.ctimeMs || sha(raw) !== expected.sha256) failure('command-output-invalid');
    const page = raw.subarray(offset, Math.min(offset + length, raw.length)); let text: string | undefined;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(page); } catch { /* raw binary stays available */ }
    const endOffset = offset + page.length;
    return { stream, offset, endOffset, totalBytes: expected.bytes, nextOffset: endOffset < expected.bytes ? endOffset : null,
      sha256: expected.sha256, outputComplete: receipt.outputComplete, base64: page.toString('base64'), ...(text === undefined ? {} : { text }) };
  } catch (error) { if (error instanceof WorkspaceCommandError) throw error; throw new WorkspaceCommandError('command-output-invalid'); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
