import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { IsolationError, IsolationUnavailableError } from './isolation.ts';

export const linuxSandboxExecutable = '/usr/bin/bwrap';
const trustedDirectory = fileURLToPath(new URL('../trusted/', import.meta.url));
const launcher = join(trustedDirectory, 'linux-isolation-launcher');
const source = launcher + '.c', receiptPath = launcher + '.json';
const insideLauncher = '/run/palimpsest-isolation-launcher';
const interpreter = '/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2';
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const ancestor = (parent: string, child: string) => {
  const path = relative(parent, child); return path === '' || (path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path));
};

/** Fixed, separately prepared host build. No compilation or candidate-selected
 * path is performed at runtime. Packaging/review owns these identities. */
export function linuxIsolationIdentity(): string[] {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new IsolationUnavailableError('Linux isolation requires the x86-64 syscall ABI');
  try {
    for (const path of [linuxSandboxExecutable, launcher, source, receiptPath]) {
      const metadata = lstatSync(path);
      if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o022)) throw new Error('Nonregular or writable-by-others trusted isolation input');
    }
    if (!(statSync(launcher).mode & 0o111)) throw new Error('Prepared launcher is not executable');
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    if (receipt.version !== 1 || receipt.arch !== 'x64' || !/^[a-f0-9]{64}$/.test(receipt.sourceSha256)
      || !/^[a-f0-9]{64}$/.test(receipt.binarySha256) || receipt.sourceSha256 !== hash(source) || receipt.binarySha256 !== hash(launcher)) throw new Error('Prepared isolation build identity mismatch');
    return [linuxSandboxExecutable, launcher, source, receiptPath, fileURLToPath(import.meta.url)];
  } catch (cause) { throw new IsolationUnavailableError('Linux isolation requires an exact prepared trusted launcher and Bubblewrap; no unconfined fallback is available', { cause }); }
}

/** Role/byte identity for a newly frozen Linux runtime. Absolute installation
 * paths are deliberately absent; historical Darwin manifests stay distinct. */
export function linuxIsolationRuntimeIdentity(): { sourceSha256: string; binarySha256: string; receiptSha256: string } {
  linuxIsolationIdentity();
  return { sourceSha256: hash(source), binarySha256: hash(launcher), receiptSha256: hash(receiptPath) };
}

/** Ubuntu x86-64 dynamic loader/library paths only. Executable policy is a
 * separate exact-inode Landlock gate; no /usr/bin or whole root/home mount. */
export function linuxRuntimeReadPaths(executables: string[]): string[] {
  return [...new Set(['/usr/lib/x86_64-linux-gnu', '/usr/lib64', '/etc/ld.so.cache', '/dev/null', '/dev/random', '/dev/urandom', ...executables]
    .filter(existsSync).map(path => realpathSync(path)))];
}

export interface LinuxIsolationLaunch {
  command: string;
  args: string[];
}
export function linuxIsolationLaunch(options: {
  executables: string[]; program: string; args: string[]; cwd: string;
  reads: string[]; writes: string[]; denies: string[]; allowChildren: boolean;
}): LinuxIsolationLaunch {
  linuxIsolationIdentity();
  const { executables, program, cwd, reads, writes, denies } = options;
  if (executables.length > 128) throw new IsolationError('Linux isolation admits at most 128 trusted executables');
  for (const path of [...reads, ...writes]) {
    if (['/proc', '/sys', '/dev'].some(root => ancestor(root, path) || ancestor(path, root))) throw new IsolationError('Linux grants cannot expose host process, kernel or device filesystems');
  }
  if (denies.some(denied => writes.some(write => ancestor(write, denied) || ancestor(denied, write)))) throw new IsolationError('Linux read exclusions cannot overlap writable grants');
  if (denies.some(denied => ancestor(denied, cwd))) throw new IsolationError('Linux working directory cannot be excluded');
  const args = ['--unshare-user', '--unshare-pid', '--unshare-net', '--unshare-ipc', '--unshare-uts',
    '--die-with-parent', '--as-pid-1', '--cap-drop', 'ALL', '--cap-add', 'CAP_SYS_ADMIN', '--cap-add', 'CAP_SETPCAP', '--proc', '/proc', '--dir', '/dev',
    '--dev-bind', '/dev/null', '/dev/null', '--dev-bind', '/dev/random', '/dev/random', '--dev-bind', '/dev/urandom', '/dev/urandom',
    '--symlink', '/proc/self/fd', '/dev/fd', '--symlink', '/proc/self/fd/0', '/dev/stdin', '--symlink', '/proc/self/fd/1', '/dev/stdout', '--symlink', '/proc/self/fd/2', '/dev/stderr',
    '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64'];
  const synthetic = new Set<string>(); let projected = 0;
  const project = (path: string) => {
    if (++projected > 65_536) throw new IsolationError('Linux read-exclusion projection exceeds its bounded entry count');
    if (denies.some(denied => ancestor(denied, path))) return;
    if (!denies.some(denied => ancestor(path, denied))) { args.push('--ro-bind', path, path); return; }
    const metadata = lstatSync(path);
    if (!metadata.isDirectory()) throw new IsolationError('Linux read projection requires canonical directory ancestors');
    args.push('--perms', (metadata.mode & 0o777).toString(8), '--tmpfs', path); synthetic.add(path);
    for (const name of readdirSync(path).sort()) {
      const child = join(path, name), entry = lstatSync(child);
      if (entry.isSymbolicLink()) args.push('--symlink', readlinkSync(child), child);
      else if (entry.isFile() || entry.isDirectory()) project(child);
      else throw new IsolationError('Linux read-exclusion projection supports regular files, directories and symlinks only');
    }
  };
  const runtime = linuxRuntimeReadPaths(executables).filter(path => !path.startsWith('/dev/'));
  for (const path of runtime) args.push('--ro-bind', path, path);
  // Source/runtime grants are sorted ancestor first; read exclusions are applied
  // to every overlapping read grant and cannot be undone by a later child bind.
  for (const path of [...new Set(reads)].sort((a, b) => a.length - b.length || a.localeCompare(b))) project(path);
  for (const path of writes) args.push('--bind', path, path);
  // Every executable is a final file bind. The trusted setup can clear noexec
  // on that exact mount without weakening its recursively noexec source parent.
  const allowed = [...executables, interpreter];
  for (const path of allowed) args.push('--ro-bind', path, path);
  args.push('--ro-bind', launcher, insideLauncher);
  for (const path of [...synthetic].sort((a, b) => b.length - a.length)) args.push('--remount-ro', path);
  const roots = [...new Set([...reads.filter(path => !denies.some(denied => ancestor(denied, path))), ...writes])];
  if (roots.length > 1024) throw new IsolationError('Linux isolation admits at most 1024 mount grants');
  args.push('--remount-ro', '/', '--chdir', cwd, '--', insideLauncher, options.allowChildren ? '1' : '0', String(allowed.length),
    ...allowed, String(roots.length), ...roots, String(writes.length), ...writes, '--', program, ...options.args);
  return { command: linuxSandboxExecutable, args };
}

/** The public ChildProcess belongs to Bubblewrap's outer monitor, never pretend
 * it is Node. Restart matching must check its exact trusted launch descriptor,
 * not merely a marker that candidate arguments could happen to contain. */
export function matchesLinuxIsolationMonitor(pid: number, options: { program: string; args: string[]; cwd: string; readPaths: string[]; denyReadPaths?: string[]; session?: boolean }): boolean {
  try {
    linuxIsolationIdentity();
    if (!Number.isSafeInteger(pid) || pid < 1 || statSync(`/proc/${pid}`).uid !== process.getuid?.()
      || realpathSync(`/proc/${pid}/exe`) !== linuxSandboxExecutable) return false;
    const argv = readFileSync(`/proc/${pid}/cmdline`).toString('utf8').split('\0');
    if (argv.pop() !== '' || argv[0] !== linuxSandboxExecutable) return false;
    const programIndex = argv.length - options.args.length - 1;
    if (programIndex < 2 || argv[programIndex - 1] !== '--') return false;
    const session = options.session !== false, writeCountIndex = programIndex - (session ? 2 : 3);
    if (argv[writeCountIndex] !== (session ? '0' : '1')) return false;
    const scratch = argv[writeCountIndex - 1]!;
    if (!session && argv[programIndex - 2] !== scratch) return false;
    if (!/^palimpsest-job-[a-zA-Z0-9]+$/.test(basename(scratch)) || !ancestor(realpathSync(tmpdir()), scratch)
      || realpathSync(scratch) !== scratch || statSync(scratch).uid !== process.getuid?.() || (statSync(scratch).mode & 0o777) !== 0o700) return false;
    const program = realpathSync(options.program), cwd = realpathSync(options.cwd);
    if (program !== realpathSync(process.execPath)) return false;
    const reads = [...new Set([cwd, ...options.readPaths.map(path => realpathSync(path)), ...(session ? [scratch] : [])])];
    const expected = linuxIsolationLaunch({ executables: [program], program, args: options.args, cwd, reads, writes: session ? [] : [scratch],
      denies: [...new Set((options.denyReadPaths ?? []).map(path => realpathSync(path)))], allowChildren: false });
    return argv.length === expected.args.length + 1 && expected.args.every((arg, index) => argv[index + 1] === arg);
  } catch { return false; }
}
