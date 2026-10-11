import { constants, chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir, release, version, platform, arch } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import { canonicalJson, invariant, nonempty } from '../../packages/contracts/common.ts';
import type { ArtifactRef, JsonValue } from '../../packages/contracts/common.ts';
import { OperationalStore } from '../../packages/storage/index.ts';
import { ProcessLease } from '../../packages/supervisor/process-lease.ts';
import { runWorker } from '../../packages/supervisor/worker-process.ts';
import type { ResourceLimits } from '../../packages/supervisor/resource-limits.ts';
import { NativeRecovery, NativeSessionEvents, nativeStateHome } from './native-recovery.ts';
import type { NativeCheckpoint, NativeCheckpointRef } from './native-recovery.ts';
import type { ClaudeNativeOptions } from './claude-configuration.ts';
import { claudeInvocation } from './claude-configuration.ts';
import { anthropicTransport } from './anthropic-codec.ts';
import { BaselineObserver, openAITransport, validateObserverGrant } from './observer.ts';
import type { BaselineTransport, ObserverGrant, ProviderAttempt } from './observer.ts';

export type NativeRecoveryRequest = { mode: 'start'; checkpointId: string } | { mode: 'resume'; checkpoint: NativeCheckpointRef; checkpointAfter?: string };
export interface NativeBaselineRun {
  kind: 'codex' | 'claude';
  privateStateRoot: string; checkoutRoot: string; workspace: string; protectedPaths: string[];
  native: { version: string; files: { path: string; name: string; sha256: string }[] };
  prompt: string; grant: ObserverGrant; maxCliOutputBytes: number;
  claudeOptions?: ClaudeNativeOptions;
  provider: { kind: 'fixture'; transport: BaselineTransport; resourceLimits?: ResourceLimits } | { kind: 'openai' | 'anthropic'; apiKey: string; resourceLimits: ResourceLimits };
  recovery?: NativeRecoveryRequest;
  signal?: AbortSignal;
}
export interface NativeBaselineResult {
  kind: 'engineering-baseline'; qualification: 'namespace-fixture' | 'kernel-profile';
  manifest: ArtifactRef; result: ArtifactRef; physicalRequests: number; outcome: JsonValue; checkpoint?: NativeCheckpointRef;
}
function outside(parent: string, child: string): boolean {
  const path = relative(parent, child); return path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path);
}
function sha256(path: string): string { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function sourceIdentity(): { files: { path: string; sha256: string }[]; sha256: string } {
  const root = new URL('../../', import.meta.url);
  // Native fixtures use Node builtins; bind the complete source-owned package tree,
  // both concrete baseline adapters and their workers instead of only the launch script.
  const files = ['packages', 'evaluations/baselines'].flatMap(directory => readdirSync(new URL(directory, root), { recursive: true, encoding: 'utf8' })
    .filter(path => /\.(ts|mjs)$/.test(path) && !path.endsWith('.test.ts'))
    .map(path => ({ path: `${directory}/${path}`, sha256: sha256(new URL(`${directory}/${path}`, root).pathname) })))
    .sort((a, b) => a.path.localeCompare(b.path));
  return { files, sha256: createHash('sha256').update(canonicalJson(files)).digest('hex') };
}
function validate(input: NativeBaselineRun): void {
  invariant(input.kind === 'codex' || input.kind === 'claude', 'concrete supported native baseline required');
  validateObserverGrant(input.grant); input.signal?.throwIfAborted();
  if (input.recovery) {
    invariant(input.provider.kind === 'fixture', 'Native recovery is opt-in synthetic engineering only');
    if (input.kind === 'claude') invariant(input.grant.profile.provider === 'anthropic' && input.claudeOptions?.delegation === 'isolated-native', 'Native Claude recovery requires the original isolated safe-mode profile');
    invariant(input.recovery.mode === 'start' || input.recovery.mode === 'resume', 'Explicit recovery start or exact checkpoint required');
    invariant(Object.keys(input.recovery).every(key => (input.recovery!.mode === 'start' ? ['mode', 'checkpointId'] : ['mode', 'checkpoint', 'checkpointAfter']).includes(key)), 'Unknown recovery option');
    const id = input.recovery.mode === 'start' ? input.recovery.checkpointId : input.recovery.checkpoint.id;
    invariant(typeof id === 'string' && id.length > 0 && id.length <= 128, 'Explicit bounded checkpoint ID required');
    if (input.recovery.mode === 'resume') invariant(Number.isSafeInteger(input.recovery.checkpoint.generation) && input.recovery.checkpoint.generation > 0 && Number.isSafeInteger(input.recovery.checkpoint.revision) && input.recovery.checkpoint.revision > 0, 'Exact checkpoint revision/generation required');
    else invariant(readdirSync(input.workspace).length === 0, 'Native recovery requires a blank initial workload workspace');
  }
  invariant(input.grant.resources.maxRequests <= 64 && input.grant.resources.maxElapsedMs <= 900_000, 'baseline run exceeds 64 requests or 15 minute engineering ceiling');
  for (const path of [input.privateStateRoot, input.checkoutRoot, input.workspace, ...input.native.files.map(file => file.path), ...input.protectedPaths]) invariant(isAbsolute(path), 'absolute host paths required');
  invariant(input.protectedPaths.length > 0, 'evaluator/control protected paths required');
  nonempty(input.prompt, 'prompt'); nonempty(input.native.version, 'native version');
  for (const hash of input.native.files.map(file => file.sha256)) invariant(/^[a-f0-9]{64}$/.test(hash), 'pinned native digest required');
  invariant(Number.isSafeInteger(input.maxCliOutputBytes) && input.maxCliOutputBytes > 0 && input.maxCliOutputBytes <= 2_000_000, 'finite CLI output ceiling required');
  invariant(input.provider?.kind === 'fixture' || input.provider?.kind === 'openai' || input.provider?.kind === 'anthropic', 'explicit provider fixture or host credential required');
  invariant(input.kind === 'codex' ? input.grant.profile.provider === 'openai' && input.provider.kind !== 'anthropic' : (input.grant.profile.provider === 'anthropic-fixture' && input.provider.kind === 'fixture') || (input.grant.profile.provider === 'anthropic' && input.provider.kind !== 'openai'), 'native protocol/profile mismatch');
  if (input.grant.profile.codexNativeProtocol) {
    const protocol = input.grant.profile.codexNativeProtocol;
    invariant(input.kind === 'codex' && input.native.version === protocol.codexVersion && input.native.files[0]?.sha256 === protocol.codexSha256 && input.native.files[1]?.sha256 === protocol.helperSha256, 'native Codex binary/version differs from pinned protocol');
    invariant(input.provider.kind === 'fixture', 'pinned native Codex child protocol is synthetic-only');
  }
  if (input.kind === 'claude' && input.grant.profile.provider === 'anthropic') {
    invariant(input.claudeOptions && typeof input.claudeOptions.tools === 'string' && input.claudeOptions.tools.length > 0, 'explicit real native Claude tool selection required');
    invariant(Object.keys(input.claudeOptions).every(key => ['tools', 'modelRoles', 'delegation'].includes(key)) && Object.keys(input.claudeOptions.modelRoles ?? {}).every(key => ['haiku', 'sonnet', 'opus', 'subagent'].includes(key)), 'unknown native Claude options refused');
    if (input.grant.profile.anthropic?.nativeProtocol) { const protocol = input.grant.profile.anthropic.nativeProtocol;
      invariant(input.native.version === protocol.claudeVersion && input.native.files[0]?.sha256 === protocol.claudeSha256, 'native binary/version differs from pinned protocol');
      invariant(input.provider.kind === 'fixture', 'pinned beta compatibility is synthetic-only; paid feature/pricing qualification required');
    }
    if (input.claudeOptions.delegation !== undefined) {
      invariant(input.claudeOptions.delegation === 'isolated-native' && input.provider.kind === 'fixture' && input.grant.profile.anthropic?.nativeProtocol, 'native Claude delegation requires pinned synthetic-only profile');
      claudeInvocation({ model: input.grant.profile.model, effort: input.grant.profile.effort, profile: input.grant.profile.provider, claudeOptions: input.claudeOptions }, 0);
      invariant(input.recovery?.mode === 'resume' || readdirSync(input.workspace).length === 0, 'isolated native delegation requires a blank initial workspace without project configuration');
    }
    invariant(Object.values(input.claudeOptions.modelRoles ?? {}).every(model => model === input.grant.profile.model), 'multiple native models require separately priced/qualified profiles');
  } else invariant(input.claudeOptions === undefined, 'native options require separate real Claude profile');
  invariant(input.kind === 'codex' ? input.native.files.map(file => file.name).join(',') === 'codex,codex-code-mode-host' : input.native.files.map(file => file.name).join(',') === 'claude', 'exact native closure required');
  if (input.provider.kind !== 'fixture') invariant(input.provider.resourceLimits && typeof input.provider.apiKey === 'string' && input.provider.apiKey.length > 0, 'paid runner requires explicit kernel limits and host credential');
  invariant(/^24\./.test(process.versions.node), 'qualified Node 24 runtime required');
}

/** Callable engineering runner. No ambient credential discovery, default grant, paid test or automatic resume. */
export async function runNativeBaseline(input: NativeBaselineRun): Promise<NativeBaselineResult> {
  // Snapshot invocation options before the asynchronous native launch.
  input = { ...input, ...(input.recovery ? { recovery: structuredClone(input.recovery) } : {}), ...(input.claudeOptions ? { claudeOptions: structuredClone(input.claudeOptions) } : {}) };
  validate(input);
  const checkout = realpathSync(input.checkoutRoot), workspace = realpathSync(input.workspace);
  // Create private storage only after checking its nearest existing parent through realpath.
  const nearest = (path: string): string => {
    try { return realpathSync(path); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const index = path.lastIndexOf('/'); return join(nearest(path.slice(0, index) || '/'), path.slice(index + 1));
    }
  };
  const stateRoot = nearest(input.privateStateRoot);
  invariant(outside(checkout, stateRoot) && outside(workspace, stateRoot) && outside(stateRoot, workspace), 'baseline state must be external to checkout and workspace');
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 }); chmodSync(stateRoot, 0o700);
  // SQLite follows existing database/sidecar links. Refuse them before opening
  // either database, so private evidence cannot escape through a workspace alias.
  for (const database of ['lease.sqlite', 'observer.sqlite']) {
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      const path = join(stateRoot, database + suffix);
      const stat = lstatSync(path, { throwIfNoEntry: false });
      invariant(!stat || (stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid!()), 'private state requires owned ordinary files without links');
    }
  }
  const lease = new ProcessLease(join(stateRoot, 'lease.sqlite'));
  let store: OperationalStore | undefined; let image: string | undefined; let observer: BaselineObserver | undefined;
  const pendingOperations = new Set<Promise<unknown>>();
  let preserveReadyAllocation = false;
  try {
    store = new OperationalStore({ filename: join(stateRoot, 'observer.sqlite'), checkoutRoot: checkout });
    observer = new BaselineObserver({ store, grant: input.grant, transportKind: input.provider.kind, transport: input.provider.kind === 'fixture' ? input.provider.transport : input.provider.kind === 'anthropic' ? anthropicTransport(input.provider.apiKey) : openAITransport(input.provider.apiKey) });
    invariant(!observer.ledger.snapshot(input.grant.id).cancelled, 'baseline grant already cancelled or uncertain');
    const files = input.native.files.map(file => ({ ...file, path: realpathSync(file.path) }));
    for (const file of files) invariant(lstatSync(file.path).isFile() && sha256(file.path) === file.sha256, 'ordinary pinned native closure required');
    const workerName = `${input.kind}-worker.mjs`;
    const worker = new URL(`./${workerName}`, import.meta.url);
    const previous = store.get<{ specification: { nativeRecovery?: { initialSessionId: string | null } }; status: string }>('baseline-run', 'run');
    const initialSessionId = input.recovery ? (input.recovery.mode === 'resume' ? previous?.value.specification.nativeRecovery?.initialSessionId ?? null : input.kind === 'claude' ? randomUUID() : null) : null;
    const declaredSession = input.recovery ? { mode: 'start' as const, ...(initialSessionId ? { sessionId: initialSessionId } : {}) } : undefined;
    const specification = {
      nativeRecovery: input.recovery ? { initialSessionId, home: nativeStateHome(input.kind), storeLimits: { files: 256, entries: 512, bytes: 16 * 1024 * 1024 }, restore: 'unavailable; verify retained workspace bytes' } : null,
      grant: observer.grant, prompt: store.putArtifact(input.prompt), workspace,
      native: { kind: input.kind, version: input.native.version, files },
      workerSha256: createHash('sha256').update(readFileSync(worker)).digest('hex'), nodeSha256: sha256(process.execPath),
      nodeVersion: process.versions.node, kernelIdentity: { platform: platform(), architecture: arch(), release: release(), version: version() }, sourceIdentity: sourceIdentity(),
      hostTools: ['/usr/bin/bash', '/usr/bin/bwrap', '/usr/bin/setpriv', '/usr/bin/prlimit'].map(path => ({ path, sha256: sha256(realpathSync(path)) })),
      maxCliOutputBytes: input.maxCliOutputBytes, workerLimits: { maxConcurrency: observer.grant.resources.maxConcurrency, maxRequestBytes: observer.grant.maxRequestBytes }, protectedPaths: input.protectedPaths.map(path => realpathSync(path)),
      providerTransport: input.provider.kind,
      qualification: input.provider.resourceLimits ? 'kernel-profile' as const : 'namespace-fixture' as const,
      kernelLimits: input.provider.resourceLimits ?? null,
      nativeInvocation: input.kind === 'claude' ? claudeInvocation({ model: input.grant.profile.model, effort: input.grant.profile.effort, profile: input.grant.profile.provider, ...(input.claudeOptions ? { claudeOptions: input.claudeOptions } : {}), ...(input.recovery ? { nativeRecovery: { mode: 'start', sessionId: initialSessionId! } } : {}) }, 0) : null,
      nativeConfiguration: input.kind === 'codex'
        ? { ignoreUserConfig: true, ignoreRules: true, ephemeral: !input.recovery, webSearch: 'disabled', requestRetries: 0, streamRetries: 0, credentials: 'dummy-bridge-token-only' }
        : { bare: input.claudeOptions?.delegation === undefined, safeMode: input.claudeOptions?.delegation === 'isolated-native', delegation: input.claudeOptions?.delegation ?? null, suppliedAgents: null, settingSources: '', tools: input.claudeOptions?.tools ?? 'Bash', effort: input.grant.profile.effort, modelRoles: input.claudeOptions?.modelRoles ?? (input.grant.profile.provider === 'anthropic-fixture' ? { haiku: input.grant.profile.model, sonnet: input.grant.profile.model, opus: input.grant.profile.model, subagent: input.grant.profile.model } : null), thinking: input.grant.profile.anthropic?.thinking ?? 'disabled', strictMcpConfig: true, disableSlashCommands: true, noSessionPersistence: !input.recovery, nativePermissions: 'bypassed only inside namespace', retries: 'each observed separately; host grant unchanged', credentials: 'dummy-bridge-token-only', scope: input.grant.profile.provider === 'anthropic-fixture' ? 'synthetic Messages only' : 'first-party standard Messages engineering; native affordance/kernel/live qualification outstanding' },
    };
    const immutable = ({ prompt: _prompt, ...value }: typeof specification) => canonicalJson(value);
    const identity = immutable(specification);
    const recovery = input.recovery ? new NativeRecovery({ observer, lease, workspace, kind: input.kind }) : undefined;
    let generation = 1, resumed: NativeCheckpoint | undefined;
    if (previous) {
      if (input.recovery?.mode !== 'resume') {
        invariant(canonicalJson(previous.value.specification) === canonicalJson(specification), 'immutable baseline run changed');
        throw new Error('Baseline run already attempted; automatic resume or retry is refused');
      }
      invariant(immutable(previous.value.specification as typeof specification) === identity, 'immutable baseline run changed');
      resumed = recovery!.consume({ ...input.recovery.checkpoint, identity }); generation = resumed.generation;
    } else invariant(input.recovery?.mode !== 'resume', 'No original native run/checkpoint exists');
    const nativeSession = input.recovery ? resumed ? { mode: 'resume' as const, sessionId: resumed.sessionId } : declaredSession : undefined;
    const manifest = store.putArtifact(canonicalJson(input.recovery ? { ...specification, generation, nativeSession: nativeSession ?? null, checkpoint: input.recovery.mode === 'resume' ? input.recovery.checkpoint : null } : specification));
    store.put('baseline-launches', String(generation), { manifest, status: 'started' }, null);
    store.put('baseline-run', 'run', { specification: previous?.value.specification ?? specification, status: 'started', manifest, generation }, previous?.revision ?? null);
    image = mkdtempSync(join(tmpdir(), `aeon-${input.kind}-image-`));
    for (const file of files) copyFileSync(file.path, join(image, file.name), constants.COPYFILE_FICLONE);
    copyFileSync(worker, join(image, workerName));
    if (input.recovery) copyFileSync(new URL('./native-recovery.ts', import.meta.url), join(image, 'native-recovery.ts'));
    if (input.kind === 'claude') {
      const configuration = new URL('./claude-configuration.ts', import.meta.url);
      copyFileSync(configuration, join(image, 'claude-configuration.ts'));
      invariant(sha256(join(image, 'claude-configuration.ts')) === specification.sourceIdentity.files.find(file => file.path === 'evaluations/baselines/claude-configuration.ts')!.sha256, 'staged Claude configuration changed');
    }
    if (input.recovery) invariant(sha256(join(image, 'native-recovery.ts')) === specification.sourceIdentity.files.find(file => file.path === 'evaluations/baselines/native-recovery.ts')!.sha256, 'Staged native recovery gate changed');
    // Hash the actual copies, closing an input change during staging.
    invariant(files.every(file => sha256(join(image!, file.name)) === file.sha256) && sha256(join(image, workerName)) === specification.workerSha256, 'staged native image changed');
    const remainingMs = Math.floor(input.grant.resources.maxElapsedMs - observer.ledger.snapshot(input.grant.id).elapsedMs);
    invariant(remainingMs > 0, 'baseline grant elapsed during staging');
    // The protocol cap includes JSON escaping of bounded payloads and full CLI diagnostics.
    const maxMessageBytes = 6 * Math.max(input.grant.maxRequestBytes, input.grant.maxResponseBytes, input.maxCliOutputBytes) + 100_000;
    const outcome = await runWorker({
      command: { workspace, applicationRoot: image, nodeBinary: process.execPath, protectedPaths: [stateRoot, ...specification.protectedPaths],
        executable: '/runtime/node', args: [`/app/${workerName}`], timeoutMs: remainingMs,
        maxOutputBytes: maxMessageBytes * (input.grant.resources.maxRequests + 1), signal: input.signal,
        ...(input.provider.resourceLimits ? { resourceLimits: input.provider.resourceLimits } : {}) },
      initial: { prompt: input.prompt, model: input.grant.profile.model, effort: input.grant.profile.effort,
        maxConcurrency: observer.grant.resources.maxConcurrency, maxRequestBytes: input.grant.maxRequestBytes, maxOutputBytes: input.maxCliOutputBytes,
        ...(nativeSession ? { nativeRecovery: nativeSession } : {}),
        ...(input.kind === 'claude' ? { profile: input.grant.profile.provider, ...(input.claudeOptions ? { claudeOptions: input.claudeOptions } : {}) } : {}) },
      maxMessageBytes, maxRequests: input.grant.resources.maxRequests,
      async handle(method, args, signal) {
        invariant(method === 'baseline.provider' && args.length === 1, 'only native provider attempts permitted');
        const attempt = args[0] as unknown as ProviderAttempt;
        if (nativeSession) {
          try {
            invariant(attempt.nativeSession, 'Native startup identity missing before provider dispatch');
            const gate = new NativeSessionEvents(input.kind, resumed?.sessionId ?? initialSessionId ?? undefined, input.maxCliOutputBytes);
            gate.feed(Buffer.from(attempt.nativeSession.startup + '\n'));
            invariant(gate.beforeProvider().sessionId === attempt.nativeSession.sessionId, 'Native startup identity mismatch');
          } catch (error) {
            store!.put('native-recovery-refusals', randomUUID(), { generation, request: store!.putArtifact(Buffer.from(attempt.payload ?? '').subarray(0, input.grant.maxRequestBytes)), observation: store!.putArtifact(canonicalJson(attempt.nativeSession ?? null)), reason: error instanceof Error ? error.message.slice(0, 256) : 'Native identity unavailable' }, null);
            observer!.cancel(); throw error;
          }
        }
        const operation = observer!.handle(attempt, signal); pendingOperations.add(operation);
        try { return await operation as unknown as JsonValue; } finally { pendingOperations.delete(operation); }
      },
    });
    const result = store.putArtifact(canonicalJson(outcome));
    const launch = store.get('baseline-launches', String(generation))!;
    store.put('baseline-launches', String(generation), { manifest, result, status: 'completed' }, launch.revision);
    let checkpoint: NativeCheckpointRef | undefined;
    const checkpointId = input.recovery?.mode === 'start' ? input.recovery.checkpointId : input.recovery?.checkpointAfter;
    if (recovery && checkpointId) {
      const observed = outcome as unknown as { code: number | null; signal: string | null; exceeded: boolean; stdout: string; recoveryError?: string | null };
      invariant(observed.recoveryError === null, 'Native recovery event observation unavailable');
      const gate = new NativeSessionEvents(input.kind, resumed?.sessionId ?? initialSessionId ?? undefined, input.maxCliOutputBytes); gate.feed(Buffer.from(observed.stdout)); gate.finish();
      const cleanup = store.putArtifact(canonicalJson({ observation: 'runWorker returned after awaited confinement cleanup', generation, nativeExit: observed.code, nativeSignal: observed.signal, pendingOperations: pendingOperations.size, namespace: 'PID namespace drained on owner exit', kernel: specification.kernelLimits ? 'command cgroup drained and removed before return' : null }));
      store.transaction(() => {
        checkpoint = recovery.publish({ id: checkpointId, generation, identity, outcome: observed, pendingOperations: pendingOperations.size, cleanup, manifest, result });
        const row = store!.get('baseline-run', 'run')!;
        store!.put('baseline-run', 'run', { specification: previous?.value.specification ?? specification, status: 'ready', manifest, result, generation, checkpoint }, row.revision);
      });
      preserveReadyAllocation = true;
    } else {
      const row = store.get('baseline-run', 'run')!;
      store.put('baseline-run', 'run', { specification: previous?.value.specification ?? specification, status: 'completed', manifest, result, generation }, row.revision);
    }
    return { kind: 'engineering-baseline', qualification: specification.qualification, manifest, result,
      physicalRequests: observer.ledger.snapshot(input.grant.id).requests, outcome, ...(checkpoint ? { checkpoint } : {}) };
  } catch (error) {
    observer?.cancel();
    if (store) {
      const row = store.get<Record<string, JsonValue>>('baseline-run', 'run');
      if (row?.value.status === 'started') store.put('baseline-run', 'run', { ...row.value, status: 'stopped', reason: 'Run failed or cancelled; no automatic retry',
        diagnostic: error instanceof Error ? error.message.slice(0, 256) : 'unavailable' }, row.revision);
    }
    throw new Error(`${input.kind === 'codex' ? 'Codex' : 'Claude'} engineering baseline unavailable or stopped; inspect private durable evidence`);
  } finally {
    // runWorker can terminate before an aborted handler returns. Cancellation keeps its worst-case reservation held.
    if (!preserveReadyAllocation) observer?.cancel(); await Promise.allSettled([...pendingOperations]);
    if (image) rmSync(image, { recursive: true, force: true }); store?.close(); lease.close();
  }
}
