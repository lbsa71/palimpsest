import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

export interface IsolationOptions {
  program: string;
  args: string[];
  cwd: string;
  readPaths?: string[];
  /** Trusted policy exclusions; override broader read/cwd grants. Never model input. */
  denyReadPaths?: string[];
  writePaths?: string[];
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: Record<string, string>;
  stdin?: string;
  signal?: AbortSignal;
  /** Trusted Node test harnesses only; default fork denial has stronger cleanup. */
  allowNodeChildren?: boolean;
  /** Coordinator-selected installed toolchain only; never candidate input. */
  trustedExecutables?: Array<{ path: string; sha256: string }>;
  /** Trusted supervisor hooks only. Lifetime and aggregate output bounds remain. */
  onSpawn?: (child: ChildProcess) => void;
  onStdout?: (chunk: Buffer) => void;
  onStderr?: (chunk: Buffer) => void;
  keepStdinOpen?: boolean;
}

export interface IsolationResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
  outputLimitExceeded: boolean;
  durationMs: number;
}

export class IsolationError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = 'IsolationError'; }
}
export class IsolationUnavailableError extends IsolationError {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = 'IsolationUnavailableError'; }
}

const sandboxExecutable = '/usr/bin/sandbox-exec';
const environmentKeys = new Set(['LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'NO_COLOR', 'FORCE_COLOR', 'NODE_NO_WARNINGS']);

function finiteInteger(value: number, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new IsolationError(`${label} must be an integer between 1 and ${maximum}`);
  return value;
}

function canonical(path: string): string {
  if (!isAbsolute(path) || /[\u0000-\u001f\u007f]/u.test(path)) throw new IsolationError('Isolation grants require absolute paths without control characters');
  try { return realpathSync(path); }
  catch (cause) { throw new IsolationError('Isolation path does not exist or cannot be resolved', { cause }); }
}

function ancestor(path: string, descendant: string): boolean {
  const rel = relative(path, descendant);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function explicitGrant(path: string): string {
  const resolved = canonical(path);
  // Reject accidental all-host/all-user grants. Narrower explicit grants remain
  // trusted orchestrator input, never inferred from candidate-produced text.
  if (ancestor(resolved, canonical(homedir()))) throw new IsolationError('Isolation grants cannot expose the home directory or its ancestors');
  return resolved;
}

function filter(path: string): string {
  return `(${statSync(path).isDirectory() ? 'subpath' : 'literal'} ${JSON.stringify(path)})`;
}

function ancestorMetadata(paths: string[]): string {
  const parents = new Set(['/var', '/tmp', '/etc']);
  for (const path of paths) {
    let parent = dirname(path);
    while (parent !== '/') { parents.add(parent); parent = dirname(parent); }
  }
  return [...parents].map(path => `(literal ${JSON.stringify(path)})`).join('\n');
}

function runtimeReadPaths(executables: string[]): string[] {
  return [
    '/System/Library', '/System/Volumes/Preboot/Cryptexes/OS/System/Library', '/usr/lib',
    '/dev/null', '/dev/random', '/dev/urandom', ...executables,
  ].filter(existsSync);
}

function profile(executables: string[], reads: string[], writes: string[], denies: string[], allowChildren: boolean): string {
  const runtimePaths = runtimeReadPaths(executables);
  const allPaths = [...new Set([...runtimePaths, ...reads, ...writes])];
  const readFilters = allPaths.map(filter).join('\n');
  return `(version 1)
    (deny default)
    (allow process-exec ${executables.map(program => `(literal ${JSON.stringify(program)})`).join(' ')})
    ${allowChildren ? '(allow process-fork)' : ''}
    (allow sysctl-read)
    (allow file-read-metadata ${ancestorMetadata(allPaths)})
    (allow file-read* (literal "/") ${readFilters})
    ${denies.length ? `(deny file-read* ${denies.map(filter).join('\n')})` : ''}
    (allow file-write* ${writes.map(filter).join('\n')})
    (allow file-write-data (literal "/dev/null"))
  `;
}

function boundedText(raw: Buffer, limit: number): string {
  let text = raw.toString('utf8');
  // Invalid UTF-8 expands to replacement characters; the returned strings must
  // still obey the same byte bound as raw capture.
  if (Buffer.byteLength(text) > limit) {
    text = Buffer.from(text).subarray(0, limit).toString('utf8');
    while (Buffer.byteLength(text) > limit) text = text.slice(0, -1);
  }
  return text;
}

/** Execute the current trusted Node binary under a macOS deny-default profile.
 * Path grants and executable selection belong to trusted orchestration. There
 * is deliberately no shell, inherited environment, network, or unsafe fallback.
 */
export async function runIsolated(options: IsolationOptions): Promise<IsolationResult> {
  if (process.platform !== 'darwin' || !existsSync(sandboxExecutable)) throw new IsolationUnavailableError('Local candidate isolation requires macOS /usr/bin/sandbox-exec; no unconfined fallback is available');
  const trustedNode = canonical(process.execPath);
  const executables = [trustedNode];
  for (const grant of options.trustedExecutables ?? []) {
    const path = canonical(grant.path);
    if (!/^[a-f0-9]{64}$/.test(grant.sha256) || createHash('sha256').update(readFileSync(path)).digest('hex') !== grant.sha256) throw new IsolationError('Trusted executable digest mismatch');
    executables.push(path);
  }
  const program = canonical(options.program);
  if (!executables.includes(program)) throw new IsolationError('Only the current trusted Node executable or hash-bound installed toolchain is permitted');
  if (!Array.isArray(options.args) || options.args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) throw new IsolationError('Program arguments must be strings without NUL bytes');
  const cwd = explicitGrant(options.cwd);
  if (!statSync(cwd).isDirectory()) throw new IsolationError('Isolation working directory must be a directory');
  const reads = [...new Set([cwd, ...(options.readPaths ?? []).map(explicitGrant)])];
  const writes = [...new Set((options.writePaths ?? []).map(explicitGrant))];
  if (writes.some(path => !statSync(path).isDirectory())) throw new IsolationError('Writable scratch grants must be directories');
  const denies = [...new Set((options.denyReadPaths ?? []).map(canonical))];
  const requiredReads = runtimeReadPaths(executables).map(canonical);
  for (const path of denies) {
    const stat = statSync(path);
    if ((!stat.isFile() && !stat.isDirectory()) || requiredReads.some(required => ancestor(path, required) || ancestor(required, path))) {
      throw new IsolationError('Read exclusions must name regular files or directories outside required runtime paths and executables');
    }
  }
  const timeoutMs = finiteInteger(options.timeoutMs ?? 30_000, 'Timeout', 300_000);
  const outputLimit = finiteInteger(options.maxOutputBytes ?? 1_048_576, 'Output limit', 16_777_216);
  if (options.stdin !== undefined && (typeof options.stdin !== 'string' || Buffer.byteLength(options.stdin) > 1_048_576)) throw new IsolationError('stdin must be a string of at most 1048576 bytes');
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (!environmentKeys.has(key) || typeof value !== 'string' || value.includes('\0')) throw new IsolationError(`Environment variable ${key} is not allowed in isolated execution`);
  }
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'palimpsest-job-')));
  const started = performance.now();
  try {
    const env = {
      PATH: dirname(trustedNode), HOME: scratch, TMPDIR: scratch, LANG: 'C', NO_COLOR: '1',
      ...options.env,
    };
    const policy = profile(executables, reads, [...writes, scratch], denies, options.allowNodeChildren === true);
    return await new Promise<IsolationResult>((resolve, reject) => {
      const output: Buffer[] = []; const errors: Buffer[] = [];
      let outputBytes = 0; let errorBytes = 0; let captured = 0;
      let timedOut = false; let aborted = false; let outputLimitExceeded = false;
      let observerFailure: IsolationError | undefined;
      const child = spawn(sandboxExecutable, ['-p', policy, program, ...options.args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
      const kill = () => {
        if (!child.pid) return;
        try { process.kill(-child.pid, 'SIGKILL'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill('SIGKILL'); }
      };
      const cancel = () => { aborted = true; kill(); };
      const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
      const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); };
      const failObserver = (message: string, cause: unknown) => {
        observerFailure ??= new IsolationError(message, { cause });
        // Keep ownership and cancellation alive until close. Rejecting here
        // would let the caller release writable paths while the child drains.
        kill();
      };
      const capture = (chunk: Buffer, stderr: boolean) => {
        const accepted = chunk.subarray(0, Math.max(0, outputLimit - captured));
        if (accepted.length) {
          (stderr ? errors : output).push(accepted);
          captured += accepted.length;
          if (stderr) errorBytes += accepted.length; else outputBytes += accepted.length;
          if (!observerFailure) {
            try { (stderr ? options.onStderr : options.onStdout)?.(accepted); }
            catch (cause) { failObserver('Trusted stream observer failed', cause); }
          }
        }
        if (accepted.length < chunk.length) { outputLimitExceeded = true; kill(); }
      };
      child.stdout.on('data', (chunk: Buffer) => capture(chunk, false));
      child.stderr.on('data', (chunk: Buffer) => capture(chunk, true));
      child.once('error', error => {
        if (observerFailure) return; // The original failure still waits for close.
        cleanup(); reject(new IsolationUnavailableError('Could not launch the isolated Node process', { cause: error }));
      });
      child.once('close', (exitCode, signal) => {
        cleanup();
        if (observerFailure) { reject(observerFailure); return; }
        resolve({ exitCode, signal, stdout: boundedText(Buffer.concat(output), outputBytes), stderr: boundedText(Buffer.concat(errors), errorBytes), timedOut, aborted, outputLimitExceeded, durationMs: Math.ceil(performance.now() - started) });
      });
      child.stdin.on('error', () => { /* Early exit or cancellation can close stdin before input is consumed. */ });
      options.signal?.addEventListener('abort', cancel, { once: true });
      if (options.signal?.aborted) cancel();
      if (options.keepStdinOpen) { if (options.stdin) child.stdin.write(options.stdin); }
      else child.stdin.end(options.stdin ?? '');
      try { options.onSpawn?.(child); }
      catch (cause) { failObserver('Trusted process observer failed', cause); }
    });
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
