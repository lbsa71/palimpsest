import { spawn } from 'node:child_process';
import { lstatSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

export interface ConfinedCommand {
  workspace: string;
  protectedPaths: string[];
  executable: string;
  args: string[];
  nodeBinary?: string;
  /** Host-selected admitted application image; never supplied by a model/tool argument. */
  applicationRoot?: string;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
}
export interface CommandReceipt {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  stoppedFor?: 'cancelled' | 'timeout' | 'output-limit';
  elapsedMs: number;
}

function contains(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

export function confinementArguments(command: ConfinedCommand): string[] {
  if (process.platform !== 'linux') throw new Error('Linux namespace isolation unavailable');
  const workspace = realpathSync(command.workspace);
  if (!statSync(workspace).isDirectory()) throw new Error('Workspace must be a directory');
  if (command.protectedPaths.length === 0) throw new Error('Protected control/state/rescue paths must be declared');
  for (const path of command.protectedPaths) {
    const protectedPath = realpathSync(path);
    if (contains(workspace, protectedPath) || contains(protectedPath, workspace)) {
      throw new Error(`Workspace overlaps protected storage: ${protectedPath}`);
    }
  }
  // A preexisting hardlink could expose or mutate a host file despite namespace isolation.
  const inspect = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      const stat = lstatSync(path);
      if (stat.isDirectory()) inspect(path);
      else if (!stat.isSymbolicLink() && (!stat.isFile() || stat.nlink !== 1)) {
        throw new Error('Workspace contains a special file or hardlink');
      }
    }
  };
  inspect(workspace);
  if (!Number.isSafeInteger(command.timeoutMs) || command.timeoutMs < 1 ||
    !Number.isSafeInteger(command.maxOutputBytes) || command.maxOutputBytes < 1) throw new Error('Finite command limits required');
  if (!isAbsolute(command.executable)) throw new Error('Sandbox executable must have an absolute path');
  const args = ['--unshare-all', '--unshare-user', '--disable-userns', '--assert-userns-disabled', '--die-with-parent', '--new-session',
    '--cap-drop', 'ALL', '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib',
    '--symlink', 'usr/lib64', '/lib64', '--proc', '/proc', '--dev', '/dev', '--size', '67108864', '--tmpfs', '/tmp',
    '--bind', workspace, '/work', '--chdir', '/work', '--clearenv', '--setenv', 'PATH', '/runtime:/usr/bin:/bin',
    '--setenv', 'LANG', 'C.UTF-8'];
  if (command.nodeBinary) args.push('--ro-bind', realpathSync(command.nodeBinary), '/runtime/node');
  if (command.applicationRoot) {
    const application = realpathSync(command.applicationRoot);
    for (const path of command.protectedPaths) {
      const protectedPath = realpathSync(path);
      if (contains(application, protectedPath) || contains(protectedPath, application)) throw new Error('Application image overlaps protected storage');
    }
    args.push('--ro-bind', application, '/app');
  }
  // No host network, sockets, home, credentials, state or control mounts. Research uses a separate receiver.
  args.push('--', command.executable, ...command.args);
  return args;
}

/** Every command runs in a fresh PID/mount/network namespace; unavailable isolation fails closed. */
export async function runConfined(command: ConfinedCommand): Promise<CommandReceipt> {
  const args = confinementArguments(command);
  command.signal?.throwIfAborted();
  const started = performance.now();
  const child = spawn('/usr/bin/bwrap', args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: {} });
  let stoppedFor: CommandReceipt['stoppedFor'];
  let outputBytes = 0;
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  const stop = (reason: NonNullable<CommandReceipt['stoppedFor']>) => {
    stoppedFor ??= reason;
    if (child.pid) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    }
  };
  const collect = (destination: Buffer[]) => (chunk: Buffer) => {
    const remaining = Math.max(0, command.maxOutputBytes - outputBytes);
    destination.push(chunk.subarray(0, remaining));
    outputBytes += chunk.length;
    if (outputBytes > command.maxOutputBytes) stop('output-limit');
  };
  child.stdout.on('data', collect(stdout));
  child.stderr.on('data', collect(stderr));
  const timer = setTimeout(() => stop('timeout'), command.timeoutMs);
  const abort = () => stop('cancelled');
  command.signal?.addEventListener('abort', abort, { once: true });
  // Abort may have arrived between the preflight check and listener registration.
  if (command.signal?.aborted) abort();
  try {
    const completion = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    return { exitCode: completion.code, signal: completion.signal, stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'), stoppedFor, elapsedMs: performance.now() - started };
  } finally {
    clearTimeout(timer);
    command.signal?.removeEventListener('abort', abort);
  }
}
