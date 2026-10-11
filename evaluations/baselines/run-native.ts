import { constants, chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import { canonicalJson, invariant, nonempty } from '../../packages/contracts/common.ts';
import type { ArtifactRef, JsonValue } from '../../packages/contracts/common.ts';
import { OperationalStore } from '../../packages/storage/index.ts';
import { ProcessLease } from '../../packages/supervisor/process-lease.ts';
import { runWorker } from '../../packages/supervisor/worker-process.ts';
import type { ResourceLimits } from '../../packages/supervisor/resource-limits.ts';
import { BaselineObserver, openAITransport, validateObserverGrant } from './observer.ts';
import type { BaselineTransport, ObserverGrant, ProviderAttempt } from './observer.ts';

export interface NativeBaselineRun {
  kind: 'codex' | 'claude';
  privateStateRoot: string; checkoutRoot: string; workspace: string; protectedPaths: string[];
  native: { version: string; files: { path: string; name: string; sha256: string }[] };
  prompt: string; grant: ObserverGrant; maxCliOutputBytes: number;
  provider: { kind: 'fixture'; transport: BaselineTransport; resourceLimits?: ResourceLimits } | { kind: 'openai'; apiKey: string; resourceLimits: ResourceLimits };
  signal?: AbortSignal;
}
export interface NativeBaselineResult {
  kind: 'engineering-baseline'; qualification: 'namespace-fixture' | 'kernel-profile';
  manifest: ArtifactRef; result: ArtifactRef; physicalRequests: number; outcome: JsonValue;
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
  invariant(input.grant.resources.maxRequests <= 64 && input.grant.resources.maxElapsedMs <= 900_000, 'baseline run exceeds 64 requests or 15 minute engineering ceiling');
  for (const path of [input.privateStateRoot, input.checkoutRoot, input.workspace, ...input.native.files.map(file => file.path), ...input.protectedPaths]) invariant(isAbsolute(path), 'absolute host paths required');
  invariant(input.protectedPaths.length > 0, 'evaluator/control protected paths required');
  nonempty(input.prompt, 'prompt'); nonempty(input.native.version, 'native version');
  for (const hash of input.native.files.map(file => file.sha256)) invariant(/^[a-f0-9]{64}$/.test(hash), 'pinned native digest required');
  invariant(Number.isSafeInteger(input.maxCliOutputBytes) && input.maxCliOutputBytes > 0 && input.maxCliOutputBytes <= 2_000_000, 'finite CLI output ceiling required');
  invariant(input.provider?.kind === 'fixture' || input.provider?.kind === 'openai', 'explicit provider fixture or host credential required');
  invariant(input.kind === 'codex' ? input.grant.profile.provider === 'openai' : input.grant.profile.provider === 'anthropic-fixture' && input.provider.kind === 'fixture', 'native protocol/profile mismatch or live Claude accounting unavailable');
  invariant(input.kind === 'codex' ? input.native.files.map(file => file.name).join(',') === 'codex,codex-code-mode-host' : input.native.files.map(file => file.name).join(',') === 'claude', 'exact native closure required');
  if (input.provider.kind === 'openai') invariant(input.provider.resourceLimits && typeof input.provider.apiKey === 'string' && input.provider.apiKey.length > 0, 'paid runner requires explicit kernel limits and host credential');
  invariant(/^24\./.test(process.versions.node), 'qualified Node 24 runtime required');
}

/** Callable engineering runner. No ambient credential discovery, default grant, paid test or automatic resume. */
export async function runNativeBaseline(input: NativeBaselineRun): Promise<NativeBaselineResult> {
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
  try {
    store = new OperationalStore({ filename: join(stateRoot, 'observer.sqlite'), checkoutRoot: checkout });
    observer = new BaselineObserver({ store, grant: input.grant, transport: input.provider.kind === 'fixture' ? input.provider.transport : openAITransport(input.provider.apiKey) });
    invariant(!observer.ledger.snapshot(input.grant.id).cancelled, 'baseline grant already cancelled or uncertain');
    const files = input.native.files.map(file => ({ ...file, path: realpathSync(file.path) }));
    for (const file of files) invariant(lstatSync(file.path).isFile() && sha256(file.path) === file.sha256, 'ordinary pinned native closure required');
    const workerName = `${input.kind}-worker.mjs`;
    const worker = new URL(`./${workerName}`, import.meta.url);
    const specification = {
      grant: observer.grant, prompt: store.putArtifact(input.prompt), workspace,
      native: { kind: input.kind, version: input.native.version, files },
      workerSha256: createHash('sha256').update(readFileSync(worker)).digest('hex'), nodeSha256: sha256(process.execPath),
      nodeVersion: process.versions.node, sourceIdentity: sourceIdentity(),
      hostTools: ['/usr/bin/bash', '/usr/bin/bwrap', '/usr/bin/setpriv', '/usr/bin/prlimit'].map(path => ({ path, sha256: sha256(realpathSync(path)) })),
      maxCliOutputBytes: input.maxCliOutputBytes, protectedPaths: input.protectedPaths.map(path => realpathSync(path)),
      providerTransport: input.provider.kind,
      qualification: input.provider.resourceLimits ? 'kernel-profile' as const : 'namespace-fixture' as const,
      kernelLimits: input.provider.resourceLimits ?? null,
      nativeConfiguration: input.kind === 'codex'
        ? { ignoreUserConfig: true, ignoreRules: true, ephemeral: true, webSearch: 'disabled', requestRetries: 0, streamRetries: 0, credentials: 'dummy-bridge-token-only' }
        : { bare: true, settingSources: '', tools: 'Bash', strictMcpConfig: true, disableSlashCommands: true, noSessionPersistence: true, nativePermissions: 'bypassed only inside namespace', retries: 'each observed separately; host grant unchanged', credentials: 'dummy-bridge-token-only', scope: 'synthetic Messages only; live unavailable' },
    };
    const previous = store.get<{ specification: typeof specification; status: string }>('baseline-run', 'run');
    if (previous) {
      invariant(canonicalJson(previous.value.specification) === canonicalJson(specification), 'immutable baseline run changed');
      throw new Error('Baseline run already attempted; automatic resume or retry is refused');
    }
    const manifest = store.putArtifact(canonicalJson(specification));
    store.put('baseline-run', 'run', { specification, status: 'started', manifest }, null);
    image = mkdtempSync(join(tmpdir(), `aeon-${input.kind}-image-`));
    for (const file of files) copyFileSync(file.path, join(image, file.name), constants.COPYFILE_FICLONE);
    copyFileSync(worker, join(image, workerName));
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
        maxRequestBytes: input.grant.maxRequestBytes, maxOutputBytes: input.maxCliOutputBytes },
      maxMessageBytes, maxRequests: input.grant.resources.maxRequests,
      async handle(method, args, signal) {
        invariant(method === 'baseline.provider' && args.length === 1, 'only native provider attempts permitted');
        const operation = observer!.handle(args[0] as unknown as ProviderAttempt, signal); pendingOperations.add(operation);
        try { return await operation as unknown as JsonValue; } finally { pendingOperations.delete(operation); }
      },
    });
    const result = store.putArtifact(canonicalJson(outcome));
    const row = store.get('baseline-run', 'run')!;
    store.put('baseline-run', 'run', { specification, status: 'completed', manifest, result }, row.revision);
    return { kind: 'engineering-baseline', qualification: specification.qualification, manifest, result,
      physicalRequests: observer.ledger.snapshot(input.grant.id).requests, outcome };
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
    observer?.cancel(); await Promise.allSettled([...pendingOperations]);
    if (image) rmSync(image, { recursive: true, force: true }); store?.close(); lease.close();
  }
}
