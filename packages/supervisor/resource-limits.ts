import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, readdirSync, rmdirSync, statSync, statfsSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Trusted host configuration, never a tool/model argument. All descendants share these ceilings. */
export interface ResourceLimits {
  cgroupRoot: string;
  memoryBytes: number;
  pids: number;
  cpuQuotaMicros: number;
  cpuPeriodMicros: number;
  maxFileBytes: number;
  maxOpenFiles: number;
  workspaceBytes: number;
  workspaceInodes: number;
}
export interface ResourceObservation {
  memoryPeakBytes: number;
  oomKills: number;
  pidsLimitHits: number;
  cpuUsageMicros: number;
  cpuThrottledMicros: number;
}

const controllers = ['cpu', 'memory', 'pids'];
const read = (directory: string, file: string) => readFileSync(join(directory, file), 'utf8').trim();
const write = (directory: string, file: string, value: string | number) => writeFileSync(join(directory, file), String(value));
const values = (directory: string, file: string) => Object.fromEntries(read(directory, file).split('\n').map(line => {
  const [key, value] = line.split(/\s+/); return [key!, Number(value)];
}));
function rootPath(path: string): string {
  if (process.platform !== 'linux' || !isAbsolute(path)) throw new Error('Resource enforcement requires an absolute Linux cgroup v2 delegation');
  const root = realpathSync(path);
  if (!root.startsWith('/sys/fs/cgroup/') || !statSync(root).isDirectory() || statSync(root).uid !== process.getuid!()) {
    throw new Error('Resource cgroup must be delegated to the supervisor UID');
  }
  const membership = readFileSync('/proc/self/cgroup', 'utf8').trim();
  const relativeRoot = root.slice('/sys/fs/cgroup'.length);
  if (!membership.startsWith('0::') || !(membership.slice(3) === relativeRoot || membership.slice(3).startsWith(relativeRoot + '/'))) {
    throw new Error('Supervisor must start inside its delegated cgroup (systemd Delegate=cpu memory pids)');
  }
  return root;
}

/** Called once after the exclusive supervisor lease, within a systemd-delegated service. No sudo at runtime. */
export async function initializeResourceDelegation(path: string): Promise<void> {
  const root = rootPath(path);
  const available = read(root, 'cgroup.controllers').split(/\s+/);
  if (controllers.some(controller => !available.includes(controller))) throw new Error('Required cgroup controllers unavailable');
  const host = join(root, 'host');
  mkdirSync(host, { recursive: true });
  write(host, 'cgroup.procs', process.pid);
  write(root, 'cgroup.subtree_control', controllers.map(controller => '+' + controller).join(' '));
  // Recovery does not reuse stale children or guess PIDs; cgroup.kill includes detached descendants.
  for (const child of readdirSync(root)) {
    if (!child.startsWith('command-')) continue;
    const group = join(root, child);
    write(group, 'cgroup.kill', 1);
    await drain(group);
    rmdirSync(group);
  }
}

async function drain(group: string): Promise<void> {
  const deadline = performance.now() + 3000;
  while (values(group, 'cgroup.events').populated !== 0) {
    if (performance.now() > deadline) throw new Error('Resource group failed to drain; execution unavailable');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function validate(limits: ResourceLimits): void {
  for (const name of ['memoryBytes', 'pids', 'cpuQuotaMicros', 'cpuPeriodMicros', 'maxFileBytes', 'maxOpenFiles', 'workspaceBytes', 'workspaceInodes'] as const) {
    if (!Number.isSafeInteger(limits[name]) || limits[name] < 1) throw new Error('Finite positive resource ceilings required');
  }
  if (limits.pids < 4 || limits.maxOpenFiles < 16 || limits.memoryBytes < 4 * 1024 * 1024 ||
      limits.cpuPeriodMicros < 1000 || limits.cpuPeriodMicros > 1_000_000 || limits.cpuQuotaMicros < 1000) {
    throw new Error('Resource ceilings cannot launch the trusted confinement boundary');
  }
}

/** Fail-closed probe: actually create/write/remove a bounded leaf, and inspect the workspace filesystem capacity. */
export function assertResourceConfinement(workspace: string, limits: ResourceLimits): void {
  validate(limits);
  const root = rootPath(limits.cgroupRoot);
  const enabled = read(root, 'cgroup.subtree_control').split(/\s+/);
  if (controllers.some(controller => !enabled.includes(controller))) throw new Error('Resource cgroup controllers are not enabled');
  const fs = statfsSync(realpathSync(workspace), { bigint: true });
  // Fixed-size ext4 is persistent, bounds sparse-file allocation and inode creation, and has no host grow operation in the namespace.
  if (fs.type !== 0xef53n || fs.blocks * fs.bsize > BigInt(limits.workspaceBytes) || fs.files > BigInt(limits.workspaceInodes)) {
    throw new Error('Workspace requires a provisioned ext4 filesystem within declared byte/inode capacity');
  }
  const probe = makeGroup(root, limits);
  rmdirSync(probe);
}

export function diagnoseResourceConfinement(workspace: string, limits?: ResourceLimits): { ready: boolean; reason?: string } {
  if (!limits) return { ready: false, reason: 'Explicit enforced resource profile is required' };
  try { assertResourceConfinement(workspace, limits); return { ready: true }; }
  catch (error) { return { ready: false, reason: error instanceof Error ? error.message : 'Resource enforcement unavailable' }; }
}

function makeGroup(root: string, limits: ResourceLimits): string {
  const directory = join(root, 'command-' + randomUUID());
  mkdirSync(directory);
  try {
    write(directory, 'memory.max', limits.memoryBytes);
    write(directory, 'memory.swap.max', 0);
    write(directory, 'memory.oom.group', 1);
    write(directory, 'pids.max', limits.pids);
    write(directory, 'cpu.max', `${limits.cpuQuotaMicros} ${limits.cpuPeriodMicros}`);
    if (read(directory, 'memory.max') !== String(limits.memoryBytes) || read(directory, 'memory.swap.max') !== '0' ||
        read(directory, 'memory.oom.group') !== '1' || read(directory, 'pids.max') !== String(limits.pids) ||
        read(directory, 'cpu.max') !== `${limits.cpuQuotaMicros} ${limits.cpuPeriodMicros}`) throw new Error('Resource limits were not installed');
    return directory;
  } catch (error) { rmdirSync(directory); throw error; }
}

export interface ConfinedProcess {
  child: ChildProcessWithoutNullStreams;
  closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  stop(): void;
  cleanup(): Promise<ResourceObservation | undefined>;
}

/** The trusted shell blocks on fd 3 until the host installs its cgroup membership; no untrusted instruction can win a placement race. */
export async function spawnBounded(args: string[], options: { workspace: string; timeoutMs: number; resourceLimits?: ResourceLimits; input: 'ignore' | 'pipe' }): Promise<ConfinedProcess> {
  const limits = options.resourceLimits;
  let group: string | undefined;
  if (limits) {
    assertResourceConfinement(options.workspace, limits);
    group = makeGroup(rootPath(limits.cgroupRoot), limits);
  }
  const executable = limits ? '/bin/sh' : '/usr/bin/bwrap';
  const arguments_ = limits ? ['-c', 'read -r ready <&3 || exit 125; exec 3<&-; exec "$@"', 'aeon-resource-gate', '/usr/bin/prlimit',
    `--fsize=${limits.maxFileBytes}:${limits.maxFileBytes}`, `--nofile=${limits.maxOpenFiles}:${limits.maxOpenFiles}`, '--core=0:0', '--memlock=0:0',
    `--cpu=${Math.ceil(options.timeoutMs / 1000)}:${Math.ceil(options.timeoutMs / 1000)}`, '--', '/usr/bin/bwrap', ...args] : args;
  let child: ConfinedProcess['child'];
  try { child = spawn(executable, arguments_, { detached: true, stdio: [options.input, 'pipe', 'pipe', ...(limits ? ['pipe' as const] : [])], env: {} }) as unknown as ConfinedProcess['child']; }
  catch (error) { if (group) rmdirSync(group); throw error; }
  let hasClosed = false;
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', () => reject(new Error('Confined process launch unavailable')));
    child.once('close', (code, signal) => { hasClosed = true; resolve({ code, signal }); });
  });
  // Avoid an unhandled rejected launch if setup itself fails before the caller receives the process.
  void closed.catch(() => {});
  const stop = () => {
    if (group) write(group, 'cgroup.kill', 1);
    if (child.pid && !hasClosed) {
      try { process.kill(-child.pid, 'SIGKILL'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    }
  };
  const cleanup = async (): Promise<ResourceObservation | undefined> => {
    stop();
    await closed.catch(() => {});
    if (!group) return undefined;
    await drain(group);
    const memory = values(group, 'memory.events'), pids = values(group, 'pids.events'), cpu = values(group, 'cpu.stat');
    const observation: ResourceObservation = { memoryPeakBytes: Number(read(group, 'memory.peak')), oomKills: memory.oom_kill ?? 0,
      pidsLimitHits: pids.max ?? 0, cpuUsageMicros: cpu.usage_usec ?? 0, cpuThrottledMicros: cpu.throttled_usec ?? 0 };
    rmdirSync(group); group = undefined;
    return observation;
  };
  if (group) {
    const gate = child.stdio[3] as NodeJS.WritableStream;
    gate.once('error', () => stop());
    try {
      if (!child.pid) throw new Error('Resource gate did not start');
      write(group, 'cgroup.procs', child.pid);
      gate.end('start\n');
    } catch (error) {
      await cleanup();
      throw new Error('Cannot place process in enforced resource group', { cause: error });
    }
  }
  return { child, closed, stop, cleanup };
}
