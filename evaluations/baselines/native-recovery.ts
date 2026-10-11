import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { closeSync, constants, fstatSync, openSync, readFileSync, readlinkSync, readdirSync } from 'node:fs';
import type { ArtifactRef } from '../../packages/contracts/common.ts';
import type { BaselineObserver } from './observer.ts';
import type { ProcessLease } from '../../packages/supervisor/process-lease.ts';

function require(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function nativeSessionId(value: unknown): string { require(typeof value === 'string' && uuid.test(value), 'Exact canonical native session UUID required'); return value; }
export function nativeStateHome(kind: 'codex' | 'claude'): string { return `/work/.aeon-native-state/${kind}/home`; }
export interface NativeSessionIdentity { sessionId: string; startup: string }

/** Trusted source-bound host/worker observations, not caller-provided authority. */
export interface NativeLaunchContext {
  generation: number; manifestSha256: string; priorCleanupSha256: string | null;
  hostBootId: string; hostPid: number; startedNs: string;
}
const decimal = /^[1-9][0-9]*$/;
const processDigestPattern = /^[a-f0-9]{64}$/;
function ns(value: unknown): bigint { require(typeof value === 'string' && decimal.test(value), 'Positive monotonic observation required'); return BigInt(value); }
export function parseNativeProcessStat(raw: unknown, expectedPid: number) {
  require(typeof raw === 'string' && Buffer.byteLength(raw) <= 4096, 'Bounded raw process stat required');
  const close = raw.lastIndexOf(')'), open = raw.indexOf(' (');
  require(open > 0 && close > open && raw.slice(close + 1).startsWith(' '), 'Malformed process stat');
  const pid = Number(raw.slice(0, open)), fields = raw.slice(close + 2).trim().split(/\s+/);
  require(Number.isSafeInteger(expectedPid) && expectedPid > 0 && pid === expectedPid && String(pid) === raw.slice(0, open), 'Spawned process PID mismatch');
  require(fields.length >= 20 && /^[RSDTtWI]$/.test(fields[0]!), 'Live process stat required');
  require(/^(0|[1-9][0-9]*)$/.test(fields[1]!) && Number.isSafeInteger(Number(fields[1])) && decimal.test(fields[19]!), 'Process parent/start ticks unavailable');
  return { pid, parentPid: Number(fields[1]), startTicks: fields[19]!, state: fields[0]! };
}
export function assertNativeLaunchContext(value: any): asserts value is NativeLaunchContext {
  require(value && Object.keys(value).sort().join(',') === 'generation,hostBootId,hostPid,manifestSha256,priorCleanupSha256,startedNs', 'Exact host launch context required');
  require(Number.isSafeInteger(value.generation) && value.generation > 0 && processDigestPattern.test(value.manifestSha256) && (value.priorCleanupSha256 === null || processDigestPattern.test(value.priorCleanupSha256)), 'Host generation/manifest/cleanup binding unavailable');
  nativeSessionId(value.hostBootId); require(Number.isSafeInteger(value.hostPid) && value.hostPid > 0, 'Host launch PID required'); ns(value.startedNs);
  require((value.generation === 1) === (value.priorCleanupSha256 === null), 'Predecessor cleanup binding required');
}
export function assertNativeProcessLifetime(value: any, context: NativeLaunchContext, closed: boolean): void {
  assertNativeLaunchContext(context);
  require(value?.version === 'proc-child-lifetime-v1' && !value.observationError, 'Observed native process lifetime unavailable');
  assertNativeLaunchContext(value.context);
  require(Object.keys(context).every(key => value.context[key] === context[key as keyof NativeLaunchContext]), 'Foreign native launch context');
  require(value.pidScope === 'isolated-native-namespace' && Number.isSafeInteger(value.workerPid) && value.workerPid > 0 && value.pid !== value.workerPid, 'Actual native direct child required');
  const before = parseNativeProcessStat(value.rawStatBefore, value.pid), after = parseNativeProcessStat(value.rawStatAfter, value.pid);
  const workerBefore = parseNativeProcessStat(value.workerRawStatBefore, value.workerPid), workerAfter = parseNativeProcessStat(value.workerRawStatAfter, value.workerPid);
  require(before.parentPid === value.workerPid && after.parentPid === value.workerPid && before.startTicks === after.startTicks && before.startTicks === value.startTicks, 'Native parent/start observation changed');
  require(workerBefore.startTicks === workerAfter.startTicks && workerBefore.parentPid === workerAfter.parentPid && workerBefore.startTicks === value.workerStartTicks && BigInt(value.workerStartTicks) <= BigInt(value.startTicks), 'Worker process context changed');
  require(typeof value.pidNamespaceBefore === 'string' && value.pidNamespaceBefore.length <= 4096 && /^pid:\[[0-9]+\]$/.test(value.pidNamespaceBefore) && value.pidNamespaceBefore === value.pidNamespaceAfter && value.pidNamespaceBefore === value.workerPidNamespaceBefore && value.workerPidNamespaceBefore === value.workerPidNamespaceAfter, 'Native child namespace observation changed');
  require(typeof value.bootIdBefore === 'string' && Buffer.byteLength(value.bootIdBefore) <= 4096 && value.bootIdBefore === value.bootIdAfter && value.bootIdBefore.trim() === context.hostBootId, 'Observed boot identity changed');
  require(value.spawn?.event === 'spawn' && value.spawn.pid === value.pid && value.spawn.atNs === value.spawnNs, 'Actual spawned child observation required');
  require(ns(value.spawnNs) <= ns(value.observationBeginNs) && ns(value.observationBeginNs) <= ns(value.observationEndNs), 'Native spawn/observation ordering invalid');
  if (closed) require(value.close?.event === 'close' && value.close.pid === value.pid && ns(value.observationEndNs) < ns(value.close.atNs) && (value.close.code === null || Number.isInteger(value.close.code)) && (value.close.signal === null || typeof value.close.signal === 'string'), 'Actual native close after observation required');
  else require(value.close === undefined, 'Native already closed before admission');
}
export function observeNativeProcessSpawn(pid: number, context: NativeLaunchContext, io: {
  workerPid: number; read: (path: string) => string; readlink: (path: string) => string; now: () => string;
} = { workerPid: process.pid, read: path => readFileSync(path, 'utf8'), readlink: readlinkSync, now: () => process.hrtime.bigint().toString() }): any {
  const observed: any = { version: 'proc-child-lifetime-v1', context: structuredClone(context), pid, workerPid: io.workerPid, pidScope: 'isolated-native-namespace', spawnNs: io.now() };
  observed.spawn = { event: 'spawn', pid, atNs: observed.spawnNs };
  try {
    assertNativeLaunchContext(context); observed.observationBeginNs = io.now();
    const read = (path: string) => { const raw = io.read(path); require(Buffer.byteLength(raw) <= 4096, 'Bounded raw observation required'); return raw; };
    observed.bootIdBefore = read('/proc/sys/kernel/random/boot_id');
    observed.workerRawStatBefore = read('/proc/self/stat'); observed.workerPidNamespaceBefore = io.readlink('/proc/self/ns/pid');
    observed.rawStatBefore = read(`/proc/${pid}/stat`); observed.pidNamespaceBefore = io.readlink(`/proc/${pid}/ns/pid`);
    observed.rawStatAfter = read(`/proc/${pid}/stat`); observed.pidNamespaceAfter = io.readlink(`/proc/${pid}/ns/pid`);
    observed.workerRawStatAfter = read('/proc/self/stat'); observed.workerPidNamespaceAfter = io.readlink('/proc/self/ns/pid');
    observed.bootIdAfter = read('/proc/sys/kernel/random/boot_id'); observed.observationEndNs = io.now();
    observed.startTicks = parseNativeProcessStat(observed.rawStatBefore, pid).startTicks; observed.workerStartTicks = parseNativeProcessStat(observed.workerRawStatBefore, io.workerPid).startTicks;
    assertNativeProcessLifetime(observed, context, false);
  } catch (error) { observed.observationError = error instanceof Error ? error.message.slice(0, 256) : 'Native process observation failed'; }
  return observed;
}

/** Pinned acquired initial stdout schemas. No transcript or resumed event order is inferred.
 * A provider request racing ahead of the observed identity is refused, never delayed/retried. */
export class NativeSessionEvents {
  private buffer = Buffer.alloc(0);
  private bytes = 0;
  private identity?: NativeSessionIdentity;
  private completed = false;
  private turnStarted = false;
  private failed = false;
  private readonly tools = new Set<string>();
  private readonly children = new Set<string>();
  private readonly seenTools = new Set<string>();
  private readonly startedItems = new Map<string, string>();
  private readonly completedItems = new Set<string>();
  private readonly claudeTasks = new Map<string, { runId: string; toolUseId: string }>();
  private readonly claudeToolParents = new Map<string, string | null>();
  private readonly claudeToolNames = new Map<string, string>();
  private readonly claudeAgentTasks = new Map<string, string>();
  private readonly kind: 'codex' | 'claude';
  private readonly expected?: string;
  private readonly maxBytes: number;
  constructor(kind: 'codex' | 'claude', expected: string | undefined, maxBytes: number) {
    require(kind === 'codex' || kind === 'claude', 'Concrete native product required');
    if (expected !== undefined) nativeSessionId(expected);
    require(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 2_000_000, 'Bounded native event bytes required');
    this.kind = kind; this.expected = expected; this.maxBytes = maxBytes;
  }
  feed(chunk: Uint8Array): void {
    require(!this.failed, 'Native event gate already failed');
    try {
      this.bytes += chunk.byteLength; require(this.bytes <= this.maxBytes, 'Native event byte ceiling exceeded');
      this.buffer = Buffer.concat([this.buffer, chunk]);
      for (;;) {
        const newline = this.buffer.indexOf(10); if (newline < 0) break;
        const line = this.buffer.subarray(0, newline).toString('utf8'); this.buffer = this.buffer.subarray(newline + 1);
        require(line.length > 0, 'Empty native event refused'); this.event(JSON.parse(line), line);
      }
    } catch (error) { this.failed = true; throw error; }
  }
  private event(event: any, raw: string): void {
    require(event && typeof event === 'object' && !Array.isArray(event), 'Native event object required');
    const startup = this.kind === 'codex' ? event.type === 'thread.started' : event.type === 'system' && event.subtype === 'init';
    if (startup) {
      const sessionId = nativeSessionId(this.kind === 'codex' ? event.thread_id : event.session_id);
      require(this.identity === undefined && (this.expected === undefined || this.expected === sessionId), 'Native startup identity mismatch or duplicate');
      this.identity = { sessionId, startup: raw }; return;
    }
    // Claude emits ui_invalidate before init. It confers no identity or completion.
    if (this.kind === 'claude' && event.type === 'system' && event.subtype === 'ui_invalidate') return;
    require(this.identity, 'Native activity before observed startup identity');
    if (this.kind === 'codex') {
      require(!['error', 'turn.failed'].includes(event.type), 'Failed native turn');
      if (event.type === 'turn.started') { require(!this.turnStarted && !this.completed, 'Duplicate native turn'); this.turnStarted = true; }
      else if (event.type === 'turn.completed') { require(this.turnStarted && !this.completed && this.tools.size === 0 && this.children.size === 0, 'Native completion with active tools/children'); this.completed = true; }
      else if (event.type === 'item.started' || event.type === 'item.completed') {
        require(this.turnStarted && !this.completed, 'Native item outside running turn');
        const item = event.item; require(item && typeof item.id === 'string', 'Native item identity required');
        require(['agent_message', 'reasoning', 'command_execution', 'collab_tool_call'].includes(item.type), 'Unacquired native item');
        const operation = item.type === 'command_execution' || item.type === 'collab_tool_call';
        const itemIdentity = JSON.stringify(item.type === 'command_execution' ? { type: item.type, command: item.command } : item.type === 'collab_tool_call' ? { type: item.type, tool: item.tool, sender_thread_id: item.sender_thread_id, receiver_thread_ids: item.receiver_thread_ids, prompt: item.prompt } : { type: item.type });
        if (event.type === 'item.started') {
          require(operation && item.status === 'in_progress' && !this.startedItems.has(item.id) && !this.completedItems.has(item.id), 'Unacquired or duplicate native start');
          this.startedItems.set(item.id, itemIdentity); this.tools.add(item.id);
        } else {
          require(!this.completedItems.has(item.id), 'Duplicate native completion');
          const started = this.startedItems.get(item.id);
          require((!operation && started === undefined) || started === itemIdentity, 'Native completion differs from started operation or lacks its start');
          this.completedItems.add(item.id); this.tools.delete(item.id);
          if (item.type === 'command_execution') require(item.exit_code === 0 && item.status === 'completed', 'Failed or unresolved native command');
          if (item.type === 'collab_tool_call') {
            require(item.status === 'completed', 'Unresolved native child operation');
            require(item.agents_states && typeof item.agents_states === 'object', 'Native child state required');
            for (const id of item.receiver_thread_ids ?? []) this.children.add(id);
            for (const [id, state] of Object.entries(item.agents_states) as [string, any][]) {
              require(state.status !== 'errored' && state.status !== 'not_found', 'Failed native child');
              if (state.status === 'completed' || state.status === 'shutdown') this.children.delete(id);
              else this.children.add(id);
            }
          }
        }
      }
      else throw new Error('Unacquired native event');
    } else {
      require(event.session_id === this.identity.sessionId, 'Native event session identity mismatch');
      if (event.type === 'result') {
        require(!this.completed && event.subtype === 'success' && event.is_error === false && this.tools.size === 0 && this.children.size === 0, 'Failed native result or active tools/children'); this.completed = true;
      } else if (event.type === 'assistant' || event.type === 'user') {
        require(!this.completed && Array.isArray(event.message?.content), 'Native message outside running turn');
        const parent = event.parent_tool_use_id;
        require(parent === null || typeof parent === 'string', 'Native parent call identity required');
        if (event.agent_id !== undefined) {
          const task = this.claudeTasks.get(event.agent_id);
          require(task && this.children.has(event.agent_id) && task.toolUseId === parent, 'Native child parent attribution mismatch');
        } else require(parent === null, 'Unattributed native child message');
        for (const part of event.message.content) {
          const key = `${event.agent_id ?? 'parent'}:${part.id ?? part.tool_use_id}`;
          if (part.type === 'tool_use') { require(event.type === 'assistant' && typeof part.id === 'string' && typeof part.name === 'string' && !this.seenTools.has(key), 'Duplicate or unacquired native tool'); this.tools.add(key); this.seenTools.add(key); this.claudeToolParents.set(key, parent); this.claudeToolNames.set(key, part.name); }
          if (part.type === 'tool_result') {
            require(event.type === 'user' && typeof part.tool_use_id === 'string' && this.tools.has(key) && this.claudeToolParents.get(key) === parent && part.is_error !== true && (part.is_error === false || part.is_error === undefined && event.tool_use_result?.status === 'completed'), 'Unmatched, misattributed or failed native tool result');
            if (event.tool_use_result?.status !== undefined) require(event.tool_use_result.status === 'completed', 'Unresolved native tool result');
            if (this.claudeToolNames.get(key) === 'Agent') {
              const taskId = this.claudeAgentTasks.get(key);
              require(taskId && !this.children.has(taskId) && event.tool_use_result?.agentId === taskId, 'Native Agent result lacks its completed attributable child');
            }
            this.tools.delete(key);
          }
        }
      } else if (event.type === 'system' && event.subtype === 'task_started') {
        require(!this.completed && typeof event.task_id === 'string' && typeof event.run_id === 'string' && event.run_id.length > 0 && typeof event.tool_use_id === 'string' && !this.claudeTasks.has(event.task_id), 'Duplicate or unacquired native child');
        const call = `parent:${event.tool_use_id}`;
        require(this.tools.has(call) && this.claudeToolNames.get(call) === 'Agent' && !this.claudeAgentTasks.has(call), 'Native child lacks an observed parent Agent call');
        this.claudeAgentTasks.set(call, event.task_id); this.claudeTasks.set(event.task_id, { runId: event.run_id, toolUseId: event.tool_use_id }); this.children.add(event.task_id);
      } else if (event.type === 'system' && event.subtype === 'task_notification') {
        const task = this.claudeTasks.get(event.task_id);
        require(task && this.children.has(event.task_id) && task.runId === event.run_id && task.toolUseId === event.tool_use_id && event.status === 'completed', 'Unmatched, misattributed or failed native child');
        require(![...this.tools].some(key => key.startsWith(`${event.task_id}:`)), 'Native child completed with active tools'); this.children.delete(event.task_id);
      } else {
        require(event.type === 'system' && ['task_progress', 'task_updated'].includes(event.subtype), 'Unacquired native event');
        const task = this.claudeTasks.get(event.task_id);
        require(task && this.children.has(event.task_id) && task.runId === event.run_id && (event.tool_use_id === undefined || event.tool_use_id === task.toolUseId), 'Native task update attribution mismatch');
      }
    }
  }
  beforeProvider(): NativeSessionIdentity { require(!this.failed && this.identity && !this.completed, 'Native startup identity required before provider dispatch'); return { ...this.identity }; }
  finish(): NativeSessionIdentity {
    require(!this.failed && this.buffer.length === 0 && this.identity && this.completed && this.tools.size === 0 && this.children.size === 0, 'Incomplete native turn, identity, tool or child observation');
    return { ...this.identity };
  }
}

interface TreeEntry { path: string; mode: number; kind: 'directory' | 'file'; bytes?: ArtifactRef }
interface Tree { entries: TreeEntry[]; sha256: string }
interface CapturedTree { entries: (Omit<TreeEntry, 'bytes'> & { content?: Buffer })[]; sha256: string }
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
function captureTree(root: string, subtree: string[] = []): CapturedTree {
  const entries: CapturedTree['entries'] = []; let total = 0, files = 0;
  // Descend through pinned directory descriptors. O_NOFOLLOW alone on the final
  // component would leave ancestor substitution able to escape the subtree.
  const visit = (path: string, relative: string): void => {
    const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd); require(stat.uid === process.getuid!(), 'Native/workspace directory requires current owner');
      entries.push({ path: relative, mode: stat.mode & 0o7777, kind: 'directory' }); require(entries.length <= 512, 'Checkpoint entry ceiling exceeded');
      const pinned = `/proc/self/fd/${fd}`;
      for (const name of readdirSync(pinned).sort()) {
        require(name !== '.' && name !== '..' && !name.includes('/'), 'Escaping native path');
        const child = join(pinned, name), childRelative = relative ? `${relative}/${name}` : name;
        // O_NONBLOCK ensures FIFOs/devices cannot block a checkpoint reader.
        const childFd = openSync(child, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const before = fstatSync(childFd);
          require(before.uid === process.getuid!() && (before.isDirectory() || before.isFile() && before.nlink === 1), 'Checkpoint requires owned directories/ordinary files without links');
          if (before.isDirectory()) visit(`/proc/self/fd/${childFd}/.`, childRelative);
          else {
            require(++files <= 256 && before.size <= 16 * 1024 * 1024 - total, 'Checkpoint native/workspace byte or file ceiling exceeded');
            const content = readFileSync(childFd), after = fstatSync(childFd);
            require(content.length === before.size && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && after.nlink === 1, 'Native/workspace file changed during sealing');
            total += content.length; entries.push({ path: childRelative, mode: before.mode & 0o7777, kind: 'file', content });
            require(entries.length <= 512, 'Checkpoint entry ceiling exceeded');
          }
        } finally { closeSync(childFd); }
      }
      const after = fstatSync(fd); require(stat.mtimeMs === after.mtimeMs && stat.ctimeMs === after.ctimeMs, 'Native/workspace directory changed during sealing');
    } finally { closeSync(fd); }
  };
  const ancestors: number[] = [];
  try {
    if (subtree.length) {
      let fd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); ancestors.push(fd);
      for (const name of subtree) {
        require(name !== '.' && name !== '..' && !name.includes('/'), 'Escaping native subtree');
        fd = openSync(`/proc/self/fd/${fd}/${name}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); ancestors.push(fd);
        require(fstatSync(fd).uid === process.getuid!(), 'Native subtree ancestor requires current owner');
      }
      visit(`/proc/self/fd/${fd}/.`, '');
    } else visit(root, '');
  } finally { for (const fd of ancestors.reverse()) closeSync(fd); }
  const identity = entries.map(({ content, ...entry }) => ({ ...entry, ...(content ? { sha256: digest(content) } : {}) }));
  return { entries, sha256: digest(JSON.stringify(identity)) };
}
export interface NativeCheckpointRef { id: string; generation: number; revision: number }
export interface NativeCheckpoint {
  id: string; status: 'ready' | 'running'; generation: number; sessionId: string; identity: string;
  ledger: string; native: ArtifactRef; workspace: ArtifactRef; manifest: ArtifactRef; result: ArtifactRef; cleanup: ArtifactRef;
  originalStartedAt: number; originalDeadline: number;
}
/** Trusted host-internal coordinator. Only runNativeBaseline admits public input and
 * mints exit/cleanup observations after awaited runWorker cleanup. Caller artifact
 * text is not an independently authenticated cleanup or admission proof. */
export class NativeRecovery {
  private readonly observer: BaselineObserver;
  private readonly lease: ProcessLease;
  private readonly workspace: string;
  private readonly kind: 'codex' | 'claude';
  constructor(options: { observer: BaselineObserver; lease: ProcessLease; workspace: string; kind: 'codex' | 'claude' }) {
    this.observer = options.observer; this.lease = options.lease; this.workspace = options.workspace; this.kind = options.kind;
  }
  private ledgerIdentity(): string {
    const store = this.observer.store;
    return digest(JSON.stringify(['baseline-grants', 'allocations', 'budgets', 'requests', 'baseline-attempts'].map(namespace => ({ namespace, rows: store.list(namespace) }))));
  }
  private available(): void {
    this.lease.assertHeld(); this.observer.assertQuiescent();
    const used = this.observer.ledger.snapshot(this.observer.grant.id), grant = this.observer.grant.resources, ceiling = this.observer.ledger.defaultCeiling;
    require(used.requests + 1 <= grant.maxRequests && used.tokens + ceiling.tokens <= grant.maxTokens && used.costUsd + ceiling.costUsd <= grant.maxCostUsd && used.elapsedMs + ceiling.elapsedMs <= grant.maxElapsedMs, 'Original recovery allowance expired or exhausted');
  }
  publish(input: { id: string; generation: number; identity: string; outcome: { code: number | null; signal: string | null; exceeded: boolean; stdout: string }; pendingOperations: number; cleanup: ArtifactRef; manifest: ArtifactRef; result: ArtifactRef }): NativeCheckpointRef {
    this.available(); require(this.observer.evidence().length > 0, 'Checkpoint requires actual known provider observations, not a claimed completion'); require(typeof input.id === 'string' && input.id.length > 0 && input.id.length <= 128 && Number.isSafeInteger(input.generation) && input.generation > 0 && input.identity.length > 0, 'Explicit checkpoint identity/generation required');
    require(input.pendingOperations === 0 && input.outcome.code === 0 && input.outcome.signal === null && !input.outcome.exceeded, 'Checkpoint requires observed successful native exit and drained requests');
    const gate = new NativeSessionEvents(this.kind, undefined, 2_000_000); gate.feed(Buffer.from(input.outcome.stdout)); const session = gate.finish();
    const workspace = captureTree(this.workspace), native = captureTree(this.workspace, ['.aeon-native-state', this.kind]);
    require(native.entries.some(entry => entry.kind === 'file'), 'Actual nonempty native store required');
    // Store artifacts and ready state atomically only after complete tree validation.
    return this.observer.store.transaction(() => {
      this.available(); const store = this.observer.store;
      for (const ref of [input.cleanup, input.manifest, input.result]) store.readArtifact(ref);
      const retain = (tree: CapturedTree): ArtifactRef => store.putArtifact(JSON.stringify({ entries: tree.entries.map(({ content, ...entry }) => ({ ...entry, ...(content ? { bytes: store.putArtifact(content) } : {}) })), sha256: tree.sha256 }));
      const budget = store.get<{ startedAt: number }>('budgets', this.observer.grant.id)!;
      const checkpoint: NativeCheckpoint = { id: input.id, status: 'ready', generation: input.generation, sessionId: session.sessionId, identity: input.identity, ledger: this.ledgerIdentity(), native: retain(native), workspace: retain(workspace), manifest: input.manifest, result: input.result, cleanup: input.cleanup, originalStartedAt: budget.value.startedAt, originalDeadline: budget.value.startedAt + this.observer.grant.resources.maxElapsedMs };
      const revision = store.put('native-checkpoints', input.id, checkpoint, null); return { id: input.id, generation: input.generation, revision };
    });
  }
  consume(expected: NativeCheckpointRef & { identity: string }): NativeCheckpoint {
    return this.observer.store.transaction(() => {
      this.available(); const store = this.observer.store, row = store.get<NativeCheckpoint>('native-checkpoints', expected.id);
      require(row && row.revision === expected.revision && row.value.status === 'ready' && row.value.generation === expected.generation, 'Exact ready checkpoint revision/generation required');
      const checkpoint = row.value;
      require(checkpoint.identity === expected.identity && checkpoint.ledger === this.ledgerIdentity(), 'Immutable recovery launch or ledger identity changed');
      nativeSessionId(checkpoint.sessionId);
      const budget = store.get<{ startedAt: number }>('budgets', this.observer.grant.id)!;
      require(checkpoint.originalStartedAt === budget.value.startedAt && checkpoint.originalDeadline === budget.value.startedAt + this.observer.grant.resources.maxElapsedMs, 'Original checkpoint clock changed');
      for (const ref of [checkpoint.cleanup, checkpoint.manifest, checkpoint.result]) store.readArtifact(ref);
      for (const [subtree, ref] of [[['.aeon-native-state', this.kind], checkpoint.native], [[], checkpoint.workspace]] as const) {
        const tree = store.readJsonArtifact<Tree>(ref);
        // Recompute the retained byte identities, rather than trusting tree.sha256.
        const original = tree.entries.map(({ bytes, ...entry }) => ({ ...entry, ...(bytes ? { sha256: digest(store.readArtifact(bytes)) } : {}) }));
        require(digest(JSON.stringify(original)) === tree.sha256 && captureTree(this.workspace, [...subtree]).sha256 === tree.sha256, 'Native store or workspace bytes changed; continuation refused');
      }
      const running: NativeCheckpoint = { ...checkpoint, status: 'running', generation: checkpoint.generation + 1 };
      store.put('native-checkpoints', expected.id, running, row.revision); return running;
    });
  }
}
