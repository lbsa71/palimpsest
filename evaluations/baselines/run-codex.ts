import { constants, chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
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

export interface CodexBaselineRun {
  privateStateRoot: string; checkoutRoot: string; workspace: string; protectedPaths: string[];
  native: { codex: string; helper: string; version: string; codexSha256: string; helperSha256: string };
  prompt: string; grant: ObserverGrant; maxCliOutputBytes: number;
  provider: { kind: 'fixture'; transport: BaselineTransport } | { kind: 'openai'; apiKey: string; resourceLimits: ResourceLimits };
  signal?: AbortSignal;
}
export interface CodexBaselineResult {
  kind: 'engineering-baseline'; qualification: 'namespace-fixture' | 'kernel-profile';
  manifest: ArtifactRef; result: ArtifactRef; physicalRequests: number; outcome: JsonValue;
}
function outside(parent: string, child: string): boolean {
  const path = relative(parent, child); return path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path);
}
function sha256(path: string): string { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function validate(input: CodexBaselineRun): void {
  validateObserverGrant(input.grant); input.signal?.throwIfAborted();
  invariant(input.grant.resources.maxRequests <= 64 && input.grant.resources.maxElapsedMs <= 900_000, 'baseline run exceeds 64 requests or 15 minute engineering ceiling');
  for (const path of [input.privateStateRoot, input.checkoutRoot, input.workspace, input.native.codex, input.native.helper, ...input.protectedPaths]) invariant(isAbsolute(path), 'absolute host paths required');
  invariant(input.protectedPaths.length > 0, 'evaluator/control protected paths required');
  nonempty(input.prompt, 'prompt'); nonempty(input.native.version, 'native version');
  for (const hash of [input.native.codexSha256, input.native.helperSha256]) invariant(/^[a-f0-9]{64}$/.test(hash), 'pinned native digest required');
  invariant(Number.isSafeInteger(input.maxCliOutputBytes) && input.maxCliOutputBytes > 0 && input.maxCliOutputBytes <= 2_000_000, 'finite CLI output ceiling required');
  invariant(input.provider?.kind === 'fixture' || input.provider?.kind === 'openai', 'explicit provider fixture or host credential required');
  if (input.provider.kind === 'openai') invariant(input.provider.resourceLimits && typeof input.provider.apiKey === 'string' && input.provider.apiKey.length > 0, 'paid runner requires explicit kernel limits and host credential');
  invariant(/^24\./.test(process.versions.node), 'qualified Node 24 runtime required');
}

/** Callable engineering runner. No ambient credential discovery, default grant, paid test or automatic resume. */
export async function runCodexBaseline(input: CodexBaselineRun): Promise<CodexBaselineResult> {
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
  const lease = new ProcessLease(join(stateRoot, 'lease.sqlite'));
  let store: OperationalStore | undefined; let image: string | undefined; let observer: BaselineObserver | undefined;
  const pendingOperations = new Set<Promise<unknown>>();
  try {
    store = new OperationalStore({ filename: join(stateRoot, 'observer.sqlite'), checkoutRoot: checkout });
    observer = new BaselineObserver({ store, grant: input.grant, transport: input.provider.kind === 'fixture' ? input.provider.transport : openAITransport(input.provider.apiKey) });
    invariant(!observer.ledger.snapshot(input.grant.id).cancelled, 'baseline grant already cancelled or uncertain');
    const binary = realpathSync(input.native.codex), helper = realpathSync(input.native.helper);
    for (const path of [binary, helper]) invariant(lstatSync(path).isFile(), 'ordinary native files required');
    invariant(sha256(binary) === input.native.codexSha256 && sha256(helper) === input.native.helperSha256, 'native closure digest changed');
    const worker = new URL('./codex-worker.mjs', import.meta.url);
    const specification = {
      grant: observer.grant, prompt: store.putArtifact(input.prompt), workspace,
      native: { version: input.native.version, codexSha256: input.native.codexSha256, helperSha256: input.native.helperSha256 },
      workerSha256: createHash('sha256').update(readFileSync(worker)).digest('hex'), nodeSha256: sha256(process.execPath),
      maxCliOutputBytes: input.maxCliOutputBytes, protectedPaths: input.protectedPaths.map(path => realpathSync(path)),
      qualification: input.provider.kind === 'fixture' ? 'namespace-fixture' as const : 'kernel-profile' as const,
      kernelLimits: input.provider.kind === 'fixture' ? null : input.provider.resourceLimits,
      nativeConfiguration: { ignoreUserConfig: true, ignoreRules: true, ephemeral: true, webSearch: 'disabled', requestRetries: 0, streamRetries: 0, credentials: 'dummy-bridge-token-only' },
    };
    const previous = store.get<{ specification: typeof specification; status: string }>('baseline-run', 'run');
    if (previous) {
      invariant(canonicalJson(previous.value.specification) === canonicalJson(specification), 'immutable baseline run changed');
      throw new Error('Baseline run already attempted; automatic resume or retry is refused');
    }
    const manifest = store.putArtifact(canonicalJson(specification));
    store.put('baseline-run', 'run', { specification, status: 'started', manifest }, null);
    image = mkdtempSync(join(tmpdir(), 'aeon-codex-image-'));
    copyFileSync(binary, join(image, 'codex'), constants.COPYFILE_FICLONE);
    copyFileSync(helper, join(image, 'codex-code-mode-host'), constants.COPYFILE_FICLONE);
    copyFileSync(worker, join(image, 'codex-worker.mjs'));
    // Hash the actual copies, closing an input change during staging.
    invariant(sha256(join(image, 'codex')) === specification.native.codexSha256 && sha256(join(image, 'codex-code-mode-host')) === specification.native.helperSha256 && sha256(join(image, 'codex-worker.mjs')) === specification.workerSha256, 'staged native image changed');
    const remainingMs = Math.floor(input.grant.resources.maxElapsedMs - observer.ledger.snapshot(input.grant.id).elapsedMs);
    invariant(remainingMs > 0, 'baseline grant elapsed during staging');
    // The protocol cap includes JSON escaping of bounded payloads and full CLI diagnostics.
    const maxMessageBytes = 6 * Math.max(input.grant.maxRequestBytes, input.grant.maxResponseBytes, input.maxCliOutputBytes) + 100_000;
    const outcome = await runWorker({
      command: { workspace, applicationRoot: image, nodeBinary: process.execPath, protectedPaths: [stateRoot, ...specification.protectedPaths],
        executable: '/runtime/node', args: ['/app/codex-worker.mjs'], timeoutMs: remainingMs,
        maxOutputBytes: maxMessageBytes * (input.grant.resources.maxRequests + 1), signal: input.signal,
        ...(input.provider.kind === 'openai' ? { resourceLimits: input.provider.resourceLimits } : {}) },
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
  } catch {
    observer?.cancel();
    if (store) {
      const row = store.get<Record<string, JsonValue>>('baseline-run', 'run');
      if (row?.value.status === 'started') store.put('baseline-run', 'run', { ...row.value, status: 'stopped', reason: 'Run failed or cancelled; no automatic retry' }, row.revision);
    }
    throw new Error('Codex engineering baseline unavailable or stopped; inspect private durable evidence');
  } finally {
    // runWorker can terminate before an aborted handler returns. Cancellation keeps its worst-case reservation held.
    observer?.cancel(); await Promise.allSettled([...pendingOperations]);
    if (image) rmSync(image, { recursive: true, force: true }); store?.close(); lease.close();
  }
}
