import { isAbsolute, join } from 'node:path';
import { capture, captureChild, resourceKeys, nodeResourceEnvironment, monotonicReader, scheduleTimer, throwFailures, type ResourceEnvironment, type ProcessChild, type Timer } from './environment.ts';

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
const read = (environment: ResourceEnvironment, directory: string, file: string) => environment.readText(join(directory, file)).trim();
const write = (environment: ResourceEnvironment, directory: string, file: string, value: string | number) => environment.writeText(join(directory, file), String(value));
const values = (environment: ResourceEnvironment, directory: string, file: string) => Object.fromEntries(read(environment, directory, file).split('\n').map(line => {
  const parts = line.split(/\s+/), value = Number(parts[1]);
  if (parts.length !== 2 || !parts[0] || !/^\d+$/.test(parts[1]!) || !Number.isSafeInteger(value) || value < 0) throw new Error('Malformed resource observation');
  return [parts[0], value];
}));
function rootPath(path: string, environment: ResourceEnvironment): string {
  if (environment.platform() !== 'linux' || !isAbsolute(path)) throw new Error('Resource enforcement requires an absolute Linux cgroup v2 delegation');
  const root = environment.realpath(path);
  if (!root.startsWith('/sys/fs/cgroup/') || !environment.stat(root).isDirectory() || environment.stat(root).uid !== environment.uid()) {
    throw new Error('Resource cgroup must be delegated to the supervisor UID');
  }
  const membership = environment.readText('/proc/self/cgroup').trim();
  const relativeRoot = root.slice('/sys/fs/cgroup'.length);
  if (!membership.startsWith('0::') || !(membership.slice(3) === relativeRoot || membership.slice(3).startsWith(relativeRoot + '/'))) {
    throw new Error('Supervisor must start inside its delegated cgroup (systemd Delegate=cpu memory pids)');
  }
  return root;
}

/** Move only this trusted host into a leaf before spawning descendants. Never reaps command groups. */
export function enterResourceHostLeaf(path: string, supplied: ResourceEnvironment = nodeResourceEnvironment()): string {
  const environment = capture(supplied, resourceKeys);
  const root = rootPath(path, environment);
  const available = read(environment, root, 'cgroup.controllers').split(/\s+/);
  if (controllers.some(controller => !available.includes(controller))) throw new Error('Required cgroup controllers unavailable');
  const host = join(root, 'host');
  environment.mkdir(host, { recursive: true });
  write(environment, host, 'cgroup.procs', environment.pid());
  write(environment, root, 'cgroup.subtree_control', controllers.map(controller => '+' + controller).join(' '));
  return root;
}

/** Called once after the exclusive supervisor lease, within a systemd-delegated service. No sudo at runtime. */
export async function initializeResourceDelegation(path: string, supplied: ResourceEnvironment = nodeResourceEnvironment()): Promise<void> {
  const environment = capture(supplied, resourceKeys);
  environment.monotonicNow = monotonicReader(environment.monotonicNow);
  const root = enterResourceHostLeaf(path, environment);
  // Recovery does not reuse stale children or guess PIDs; cgroup.kill includes detached descendants.
  for (const child of environment.readdir(root)) {
    if (!child.startsWith('command-')) continue;
    const group = join(root, child);
    write(environment, group, 'cgroup.kill', 1);
    await drain(group, environment);
    environment.rmdir(group);
  }
}

async function drain(group: string, environment: ResourceEnvironment): Promise<void> {
  const deadline = environment.monotonicNow() + 3000;
  while (values(environment, group, 'cgroup.events').populated !== 0) {
    if (environment.monotonicNow() > deadline) throw new Error('Resource group failed to drain; execution unavailable');
    let timer!: Timer;
    await new Promise<void>((resolve, reject) => {
      try { timer = scheduleTimer(environment, 10, resolve); } catch (error) { reject(error); }
    });
    timer.cancel();
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
export function assertResourceConfinement(workspace: string, limits: ResourceLimits, supplied: ResourceEnvironment = nodeResourceEnvironment()): void {
  const environment = capture(supplied, resourceKeys);
  validate(limits);
  const root = rootPath(limits.cgroupRoot, environment);
  const enabled = read(environment, root, 'cgroup.subtree_control').split(/\s+/);
  if (controllers.some(controller => !enabled.includes(controller))) throw new Error('Resource cgroup controllers are not enabled');
  const fs = environment.statfs(environment.realpath(workspace));
  // Fixed-size ext4 is persistent, bounds sparse-file allocation and inode creation, and has no host grow operation in the namespace.
  if (fs.type !== 0xef53n || fs.blocks * fs.bsize > BigInt(limits.workspaceBytes) || fs.files > BigInt(limits.workspaceInodes)) {
    throw new Error('Workspace requires a provisioned ext4 filesystem within declared byte/inode capacity');
  }
  const probe = makeGroup(root, limits, environment);
  environment.rmdir(probe);
}

export function diagnoseResourceConfinement(workspace: string, limits?: ResourceLimits, environment: ResourceEnvironment = nodeResourceEnvironment()): { ready: boolean; reason?: string } {
  if (!limits) return { ready: false, reason: 'Explicit enforced resource profile is required' };
  try { assertResourceConfinement(workspace, limits, environment); return { ready: true }; }
  catch (error) { return { ready: false, reason: error instanceof Error ? error.message : 'Resource enforcement unavailable' }; }
}

function makeGroup(root: string, limits: ResourceLimits, environment: ResourceEnvironment): string {
  const id = environment.id();
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid resource group ID');
  const directory = join(root, 'command-' + id);
  environment.mkdir(directory);
  try {
    write(environment, directory, 'memory.max', limits.memoryBytes);
    write(environment, directory, 'memory.swap.max', 0);
    write(environment, directory, 'memory.oom.group', 1);
    write(environment, directory, 'pids.max', limits.pids);
    write(environment, directory, 'cpu.max', `${limits.cpuQuotaMicros} ${limits.cpuPeriodMicros}`);
    if (read(environment, directory, 'memory.max') !== String(limits.memoryBytes) || read(environment, directory, 'memory.swap.max') !== '0' ||
        read(environment, directory, 'memory.oom.group') !== '1' || read(environment, directory, 'pids.max') !== String(limits.pids) ||
        read(environment, directory, 'cpu.max') !== `${limits.cpuQuotaMicros} ${limits.cpuPeriodMicros}`) throw new Error('Resource limits were not installed');
    return directory;
  } catch (error) {
    const failures = [error]; try { environment.rmdir(directory); } catch (cleanup) { failures.push(cleanup); } throwFailures(failures); throw error;
  }
}

export interface ConfinedProcess {
  child: ProcessChild;
  closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  stop(): void;
  cleanup(): Promise<ResourceObservation | undefined>;
}

/** Establish parent-death handling before the gate; only release after cgroup placement.
 * Checking the expected parent also closes death before setpriv installed PR_SET_PDEATHSIG.
 */
export async function spawnBounded(args: string[], options: { workspace: string; timeoutMs: number; resourceLimits?: ResourceLimits; input: 'ignore' | 'pipe' }, supplied: ResourceEnvironment = nodeResourceEnvironment()): Promise<ConfinedProcess> {
  const environment = capture(supplied, resourceKeys);
  environment.monotonicNow = monotonicReader(environment.monotonicNow);
  options = { ...options, ...(options.resourceLimits ? { resourceLimits: { ...options.resourceLimits } } : {}) };
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1) throw new Error('Finite process deadline required');
  const limits = options.resourceLimits;
  let group: string | undefined;
  if (limits) {
    assertResourceConfinement(options.workspace, limits, environment);
    group = makeGroup(rootPath(limits.cgroupRoot, environment), limits, environment);
  }
  const executable = '/usr/bin/setpriv';
  const bounded = limits ? ['/usr/bin/prlimit',
    `--fsize=${limits.maxFileBytes}:${limits.maxFileBytes}`, `--nofile=${limits.maxOpenFiles}:${limits.maxOpenFiles}`, '--core=0:0', '--memlock=0:0',
    `--cpu=${Math.ceil(options.timeoutMs / 1000)}:${Math.ceil(options.timeoutMs / 1000)}`, '--', '/usr/bin/bwrap', ...args] : ['/usr/bin/bwrap', ...args];
  const gateScript = '[ "$PPID" = "$1" ] || exit 125; shift; ' +
    (limits ? 'read -r ready <&3 || exit 125; exec 3<&-; ' : '') + 'exec "$@"';
  let child: ConfinedProcess['child'];
  try {
    const pid = environment.pid();
    if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid supervisor process identity');
    const arguments_ = ['--pdeathsig', 'SIGKILL', '--no-new-privs', '/bin/sh', '-c', gateScript,
      'aeon-resource-gate', String(pid), ...bounded];
    child = captureChild(environment.spawn(executable, arguments_, options.input, !!limits));
  }
  catch (error) {
    const failures = [error]; if (group) { try { environment.rmdir(group); } catch (cleanup) { failures.push(cleanup); } } throwFailures(failures); throw error;
  }
  let hasClosed = false;
  let resolveDrained!: () => void;
  const drained = new Promise<void>(resolve => { resolveDrained = resolve; });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', cause => reject(new Error('Confined process launch unavailable', { cause })));
    child.once('close', (code, signal) => { hasClosed = true; resolveDrained(); resolve({ code, signal }); });
  });
  // Avoid an unhandled rejected launch if setup itself fails before the caller receives the process.
  void closed.catch(() => {});
  const stop = () => {
    const failures: unknown[] = [];
    if (group) { try { write(environment, group, 'cgroup.kill', 1); } catch (error) { failures.push(error); } }
    if (child.pid && !hasClosed) {
      try { environment.kill(-child.pid, 'SIGKILL'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') failures.push(error); }
    }
    throwFailures(failures);
  };
  let cleaning: Promise<ResourceObservation | undefined> | undefined;
  const cleanup = (): Promise<ResourceObservation | undefined> => {
    if (cleaning) return cleaning;
    cleaning = (async () => {
      const failures: unknown[] = [...gateFailures];
      try { stop(); } catch (error) { failures.push(error); }
      await drained;
      let observation: ResourceObservation | undefined;
      if (group) {
        try {
          await drain(group, environment);
          const memory = values(environment, group, 'memory.events'), pids = values(environment, group, 'pids.events'), cpu = values(environment, group, 'cpu.stat');
          const peak = read(environment, group, 'memory.peak');
          if (!/^\d+$/.test(peak) || !Number.isSafeInteger(Number(peak))) throw new Error('Malformed resource observation');
          observation = { memoryPeakBytes: Number(peak), oomKills: memory.oom_kill ?? 0,
            pidsLimitHits: pids.max ?? 0, cpuUsageMicros: cpu.usage_usec ?? 0, cpuThrottledMicros: cpu.throttled_usec ?? 0 };
          environment.rmdir(group); group = undefined;
        } catch (error) { failures.push(error); }
      }
      throwFailures(failures);
      return observation;
    })();
    void cleaning.catch(() => { cleaning = undefined; });
    return cleaning;
  };
  const gateFailures: unknown[] = [];
  if (group) {
    const gate = child.gate;
    try {
      if (!gate) throw new Error('Resource gate pipe unavailable');
      gate.once('error', error => { gateFailures.push(error); try { stop(); } catch (stopError) { gateFailures.push(stopError); } });
      if (!child.pid) throw new Error('Resource gate did not start');
      write(environment, group, 'cgroup.procs', child.pid);
      gate.end('start\n');
      throwFailures(gateFailures);
    } catch (error) {
      const failures: unknown[] = [new Error('Cannot place process in enforced resource group', { cause: error })];
      try { await cleanup(); } catch (cleanupError) { failures.push(cleanupError); } throwFailures(failures);
    }
  }
  return { child, closed, stop, cleanup };
}
