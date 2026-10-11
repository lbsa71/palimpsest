import { lstatSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { spawnBounded, type ResourceLimits, type ResourceObservation } from './resource-limits.ts';

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
  resourceLimits?: ResourceLimits;
}
export interface CommandReceipt {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  stoppedFor?: 'cancelled' | 'timeout' | 'output-limit' | 'resource-limit';
  elapsedMs: number;
  resources?: ResourceObservation;
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
  const protectedPaths = command.protectedPaths.map(path => realpathSync(path));
  for (const protectedPath of protectedPaths) {
    if (contains(workspace, protectedPath) || contains(protectedPath, workspace)) {
      throw new Error(`Workspace overlaps protected storage: ${protectedPath}`);
    }
  }
  // A preexisting hardlink could expose or mutate a host file despite namespace isolation.
  const inspect = (directory: string, device = statSync(directory).dev) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      const stat = lstatSync(path);
      if (command.resourceLimits && stat.dev !== device) throw new Error('Resource-bounded mount contains a nested filesystem');
      if (stat.isDirectory()) inspect(path, device);
      else if (!stat.isSymbolicLink() && (!stat.isFile() || stat.nlink !== 1)) {
        throw new Error('Workspace contains a special file or hardlink');
      }
    }
  };
  inspect(workspace);
  const assertMount = (mount: string) => {
    for (const protectedPath of protectedPaths) {
      if (contains(mount, protectedPath) || contains(protectedPath, mount)) throw new Error('Runtime mount overlaps protected storage');
    }
  };
  assertMount(realpathSync('/usr'));
  if (!Number.isSafeInteger(command.timeoutMs) || command.timeoutMs < 1 ||
    !Number.isSafeInteger(command.maxOutputBytes) || command.maxOutputBytes < 1) throw new Error('Finite command limits required');
  if (!isAbsolute(command.executable)) throw new Error('Sandbox executable must have an absolute path');
  const args = ['--unshare-all', '--unshare-user', '--disable-userns', '--assert-userns-disabled', '--die-with-parent', '--new-session',
    '--cap-drop', 'ALL', '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib',
    '--symlink', 'usr/lib64', '/lib64', '--proc', '/proc', '--dev', '/dev', '--size', '67108864', '--tmpfs', '/tmp',
    '--bind', workspace, '/work', '--chdir', '/work', '--clearenv', '--setenv', 'PATH', '/runtime:/usr/bin:/bin',
    '--setenv', 'LANG', 'C.UTF-8'];
  if (command.nodeBinary) {
    const binary = realpathSync(command.nodeBinary);
    assertMount(binary);
    const stat = lstatSync(binary);
    if (!stat.isFile() || stat.nlink !== 1) throw new Error('Runtime binary must be an ordinary file without hardlinks');
    args.push('--ro-bind', binary, '/runtime/node');
  }
  if (command.applicationRoot) {
    const application = realpathSync(command.applicationRoot);
    assertMount(application);
    inspect(application);
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
  const confined = await spawnBounded(args, { ...command, input: 'ignore' });
  const { child } = confined;
  let stoppedFor: CommandReceipt['stoppedFor'];
  let outputBytes = 0;
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  const stop = (reason: NonNullable<CommandReceipt['stoppedFor']>) => {
    stoppedFor ??= reason;
    confined.stop();
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
    const completion = await confined.closed;
    const resources = await confined.cleanup();
    if (resources?.oomKills) stoppedFor ??= 'resource-limit';
    return { exitCode: completion.code, signal: completion.signal, stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'), stoppedFor, elapsedMs: performance.now() - started, ...(resources ? { resources } : {}) };
  } finally {
    clearTimeout(timer);
    command.signal?.removeEventListener('abort', abort);
    await confined.cleanup();
  }
}
