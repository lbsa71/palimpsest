import { spawn } from 'node:child_process';
import type { ChildProcess, ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { currentIsolationOwnership, type IsolationDrain, type IsolationOwnershipContext } from './isolation-ownership.ts';
import { currentFiniteIsolationExecutor } from './isolation-executor.ts';
import { linuxIsolationLaunch, linuxRuntimeReadPaths, linuxIsolationIdentity, matchesLinuxIsolationMonitor } from './isolation-linux.ts';
export { matchesLinuxIsolationMonitor } from './isolation-linux.ts';

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

/** Read-only process lifetime is owned by a trusted supervisor. Its protocol
 * receiver supplies framing/RPC bounds; stdout is never a retained transcript. */
export type IsolationSessionOptions = Omit<IsolationOptions,
  'timeoutMs' | 'stdin' | 'keepStdinOpen' | 'writePaths' | 'allowNodeChildren' | 'trustedExecutables' | 'signal' | 'onSpawn' | 'onStdout'> & {
  signal: AbortSignal;
  onSpawn: (child: ChildProcess) => void;
  onStdout: (chunk: Buffer) => void;
};

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
  if (process.platform === 'linux') return linuxRuntimeReadPaths(executables);
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
    ${writes.length ? `(allow file-write* ${writes.map(filter).join('\n')})` : ''}
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

/** Only the group captured from this current detached launch is eligible.
 * Leader close does not drain ordinary descendants with ignored stdio. Never
 * infer absence from sending a signal, and never reconcile a persisted PID here.
 * EPERM can occur transiently during kernel teardown; keep observing without
 * claiming drain or signalling an uncertain group. Unresolved absence is held. */
async function drainCurrentGroup(pid: number): Promise<void> {
  const deadline = performance.now() + 1000;
  let signalled = false, uncertainty: unknown;
  for (;;) {
    let present = false;
    try { process.kill(-pid, 0); present = true; }
    catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      if (code === 'ESRCH') return;
      if (code !== 'EPERM') throw new IsolationError('Could not observe isolated process group drain', { cause });
      uncertainty = cause;
    }
    if (present && !signalled) {
      signalled = true;
      try { process.kill(-pid, 'SIGKILL'); }
      catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw new IsolationError('Could not terminate isolated process group for drain', { cause });
      }
      continue;
    }
    if (performance.now() >= deadline) throw new IsolationError('Isolated process group drain was not confirmed within its observation limit', { cause: uncertainty });
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

/** Reconcile only an exact trusted Linux monitor with its original detached
 * group. A successful signal or monitor disappearance is not drain evidence. */
export async function stopLinuxIsolationMonitor(pid: number, descriptor: Parameters<typeof matchesLinuxIsolationMonitor>[1]): Promise<void> {
  if (!matchesLinuxIsolationMonitor(pid, descriptor)) throw new IsolationError('Cannot verify retained Linux monitor identity');
  const status = readFileSync(`/proc/${pid}/stat`, 'utf8');
  // comm is parenthesized and can contain spaces; pgrp is field five.
  const group = Number(status.slice(status.lastIndexOf(')') + 2).split(' ')[2]);
  if (group !== pid) throw new IsolationError('Retained Linux monitor is not its detached group leader');
  await drainCurrentGroup(group);
}

/** Execute the selected trusted binary under the platform deny-default policy.
 * Path grants and executable selection belong to trusted orchestration. There
 * is deliberately no shell, inherited environment, network, or unsafe fallback.
 */
export function runIsolated(options: IsolationOptions): Promise<IsolationResult> {
  try {
    const executor = currentFiniteIsolationExecutor();
    if (executor) return executor.run(options);
    const ownership = currentIsolationOwnership();
    ownership?.assertOpen();
    const pending = executeIsolated(options, false, ownership);
    ownership?.track(pending);
    return pending;
  } catch (error) { return Promise.reject(error); }
}

/** Current Node only; no lifetime timer, filesystem writes or child exception.
 * Mandatory observers must complete synchronously, including durable PID work.
 * Cancellation/observer faults retain ownership until actual process close. */
export async function runIsolatedSession(options: IsolationSessionOptions): Promise<IsolationResult> {
  if (currentFiniteIsolationExecutor()) throw new IsolationError('Persistent session cannot run inside finite executor scope');
  if (currentIsolationOwnership()) throw new IsolationError('Persistent session cannot run inside finite isolation ownership');
  if (!options || !(options.signal instanceof AbortSignal) || typeof options.onSpawn !== 'function' || typeof options.onStdout !== 'function'
    || (options.onStderr !== undefined && typeof options.onStderr !== 'function')) throw new IsolationError('Session requires an owner signal and synchronous process/stdout observers');
  for (const key of ['timeoutMs', 'stdin', 'keepStdinOpen', 'writePaths', 'allowNodeChildren', 'trustedExecutables']) {
    if (key in options) throw new IsolationError(`Session cannot select ${key}`);
  }
  return executeIsolated(options, true);
}

async function executeIsolated(options: IsolationOptions, session: boolean, ownership?: IsolationOwnershipContext): Promise<IsolationResult> {
  if (process.platform === 'linux') linuxIsolationIdentity();
  else if (process.platform !== 'darwin' || !existsSync(sandboxExecutable)) throw new IsolationUnavailableError('Local candidate isolation requires macOS Seatbelt or prepared Linux Bubblewrap/Landlock confinement; no unconfined fallback is available');
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
  const args = [...options.args];
  const cwd = explicitGrant(options.cwd);
  if (!statSync(cwd).isDirectory()) throw new IsolationError('Isolation working directory must be a directory');
  const reads = [...new Set([cwd, ...(options.readPaths ?? []).map(explicitGrant)])];
  const writes = [...new Set((options.writePaths ?? []).map(explicitGrant))];
  if (writes.some(path => !statSync(path).isDirectory())) throw new IsolationError('Writable scratch grants must be directories');
  const denies = [...new Set((options.denyReadPaths ?? []).map(canonical))];
  const allowChildren = options.allowNodeChildren === true;
  const requiredReads = runtimeReadPaths(executables).map(canonical);
  for (const path of denies) {
    const stat = statSync(path);
    if ((!stat.isFile() && !stat.isDirectory()) || requiredReads.some(required => ancestor(path, required) || ancestor(required, path))) {
      throw new IsolationError('Read exclusions must name regular files or directories outside required runtime paths and executables');
    }
  }
  const timeoutMs = session ? undefined : finiteInteger(options.timeoutMs ?? 30_000, 'Timeout', 300_000);
  const outputLimit = finiteInteger(options.maxOutputBytes ?? 1_048_576, 'Output limit', 16_777_216);
  if (options.stdin !== undefined && (typeof options.stdin !== 'string' || Buffer.byteLength(options.stdin) > 1_048_576)) throw new IsolationError('stdin must be a string of at most 1048576 bytes');
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (!environmentKeys.has(key) || typeof value !== 'string' || value.includes('\0')) throw new IsolationError(`Environment variable ${key} is not allowed in isolated execution`);
  }
  const signal = ownership ? AbortSignal.any([ownership.signal, ...(options.signal ? [options.signal] : [])]) : options.signal;
  if (ownership && signal?.aborted) throw new IsolationError('Owned isolated operation is cancelled before spawn');
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'palimpsest-job-')));
  const started = performance.now();
  let spawnId: string | undefined, receipted = false, closed: IsolationDrain | undefined, scratchCanCleanup = true;
  try {
    const env = {
      PATH: dirname(trustedNode), HOME: scratch, TMPDIR: scratch, LANG: 'C', NO_COLOR: '1',
      ...options.env,
    };
    const launch = process.platform === 'linux'
      ? linuxIsolationLaunch({ executables, program, args, cwd, reads: session ? [...reads, scratch] : reads,
        writes: session ? [] : [...writes, scratch], denies, allowChildren })
      : { command: sandboxExecutable, args: ['-p', profile(executables, session ? [...reads, scratch] : reads, session ? [] : [...writes, scratch], denies, allowChildren), program, ...args] };
    if (ownership) {
      try { spawnId = ownership.beforeSpawn({ purpose: 'finite-isolated-process', program, args, cwd, scratch }); }
      catch (cause) { throw new IsolationError('Trusted isolation ownership intent failed', { cause }); }
      if (signal?.aborted) throw new IsolationError('Owned isolated operation is cancelled before spawn');
    }
    return await new Promise<IsolationResult>((resolve, reject) => {
      const output: Buffer[] = []; const errors: Buffer[] = [];
      let outputBytes = 0; let errorBytes = 0; let captured = 0;
      let timedOut = false; let aborted = false; let outputLimitExceeded = false;
      let observerFailure: IsolationError | undefined;
      let child: ChildProcessWithoutNullStreams;
      try { child = spawn(launch.command, launch.args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true }); }
      catch (cause) { ownership?.fail(cause); throw cause; }
      const currentGroup = child.pid;
      let leaderClosed = false;
      const kill = () => {
        if (!currentGroup || leaderClosed) return;
        try { process.kill(-currentGroup, 'SIGKILL'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill('SIGKILL'); }
      };
      const cancel = () => { aborted = true; kill(); };
      const timer = timeoutMs === undefined ? undefined : setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
      const cleanup = () => { if (timer !== undefined) clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
      const failObserver = (message: string, cause: unknown) => {
        observerFailure ??= new IsolationError(message, { cause });
        // Keep ownership and cancellation alive until close. Rejecting here
        // would let the caller release writable paths while the child drains.
        kill();
      };
      const observe = <T>(observer: ((value: T) => void) | undefined, value: T, message: string) => {
        if (!observer || observerFailure) return;
        try {
          const returned: unknown = observer(value);
          if ((session || ownership) && returned !== null && (typeof returned === 'object' || typeof returned === 'function')
            && typeof (returned as { then?: unknown }).then === 'function') {
            // Catch even later rejection before failing the synchronous contract;
            // an async PID receipt cannot authorize work while it is pending.
            void Promise.resolve(returned).catch(() => {});
            failObserver(message, new IsolationError('Trusted observer must complete synchronously'));
          }
        } catch (cause) { failObserver(message, cause); }
      };
      const capture = (chunk: Buffer, stderr: boolean) => {
        if (session && !stderr) { observe(options.onStdout, chunk, 'Trusted stream observer failed'); return; }
        const accepted = chunk.subarray(0, Math.max(0, outputLimit - captured));
        if (accepted.length) {
          (stderr ? errors : output).push(accepted);
          captured += accepted.length;
          if (stderr) errorBytes += accepted.length; else outputBytes += accepted.length;
          observe(stderr ? options.onStderr : options.onStdout, accepted, 'Trusted stream observer failed');
        }
        if (accepted.length < chunk.length) { outputLimitExceeded = true; kill(); }
      };
      child.stdout.on('data', (chunk: Buffer) => capture(chunk, false));
      child.stderr.on('data', (chunk: Buffer) => capture(chunk, true));
      child.once('error', error => {
        // Even an error on a positively spawned process is not evidence of
        // close. Preserve cancellation/deadline ownership until actual drain.
        observerFailure ??= new IsolationUnavailableError('Could not launch the isolated Node process', { cause: error });
        ownership?.fail(error);
        kill();
      });
      child.once('close', (exitCode, closedSignal) => {
        leaderClosed = true;
        if (timer !== undefined) clearTimeout(timer);
        // Keep owner cancellation observable during the bounded drain, while
        // the guard alone controls this still-owned group's final signal.
        void (async () => {
          try {
            if (currentGroup && ((!session && allowChildren) || process.platform === 'linux')) await drainCurrentGroup(currentGroup);
            closed = { exitCode, signal: closedSignal };
          } catch (cause) {
            scratchCanCleanup = false;
            ownership?.fail(cause);
            observerFailure ??= cause instanceof IsolationError ? cause : new IsolationError('Isolated process group drain failed', { cause });
          }
          cleanup();
          if (observerFailure) { reject(observerFailure); return; }
          resolve({ exitCode, signal: closedSignal, stdout: boundedText(Buffer.concat(output), outputBytes), stderr: boundedText(Buffer.concat(errors), errorBytes), timedOut, aborted, outputLimitExceeded, durationMs: Math.ceil(performance.now() - started) });
        })().catch(cause => { cleanup(); scratchCanCleanup = false; ownership?.fail(cause); reject(cause); });
      });
      child.stdin!.on('error', () => { /* Early exit or cancellation can close stdin before input is consumed. */ });
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      if (ownership && spawnId && child.pid) {
        try { ownership.spawned(spawnId, child); receipted = true; }
        catch (cause) { failObserver('Trusted isolation ownership PID receipt failed', cause); }
      } else if (ownership && spawnId) {
        const error = new IsolationUnavailableError('Isolated process has no trustworthy PID receipt');
        ownership.fail(error); failObserver('Could not launch the isolated process with a trustworthy PID receipt', error);
      }
      if (session || options.keepStdinOpen) { if (options.stdin) child.stdin!.write(options.stdin); }
      else child.stdin!.end(options.stdin ?? '');
      observe(options.onSpawn, child, 'Trusted process observer failed');
    });
  } finally {
    // Neither a PID nor outer promise rejection proves the scratch writer has
    // drained. Missing/failed PID receipt or cleanup leaves the intent held.
    if (scratchCanCleanup) {
      try { rmSync(scratch, { recursive: true, force: true }); }
      catch (cause) { ownership?.fail(cause); throw cause; }
      if (ownership && spawnId && receipted && closed) {
        try { ownership.drained(spawnId, closed); }
        catch (cause) { throw new IsolationError('Trusted isolation ownership drain receipt failed', { cause }); }
      }
    }
  }
}
