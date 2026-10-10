import { AsyncLocalStorage } from 'node:async_hooks';
import { isAbsolute } from 'node:path';
import type { IsolationOptions, IsolationResult } from './isolation.ts';

export type FiniteIsolationExecutor = (options: IsolationOptions) => Promise<IsolationResult>;

export class FiniteIsolationExecutorError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = 'FiniteIsolationExecutorError'; }
}

const optionKeys = new Set(['program', 'args', 'cwd', 'readPaths', 'denyReadPaths', 'writePaths', 'timeoutMs', 'maxOutputBytes', 'env', 'stdin', 'signal', 'allowNodeChildren', 'trustedExecutables']);
function plain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function text(value: unknown, label: string, path = false): asserts value is string {
  if (typeof value !== 'string' || value.includes('\0') || (path && (!isAbsolute(value) || /[\u0000-\u001f\u007f]/u.test(value)))) {
    throw new FiniteIsolationExecutorError(`Finite executor ${label} option is invalid`);
  }
}
function bound(value: number | undefined, maximum: number, label: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1 || value > maximum)) throw new FiniteIsolationExecutorError(`Finite executor ${label} option is invalid`);
}

/** Copy transportable finite options before any await. This is not admission:
 * the parent broker still verifies exact installed source/runtime/grants and
 * invokes the original launcher. Process objects and streaming observers cannot
 * cross this finite-request channel, and no local fallback is selected here. */
function copiedOptions(options: IsolationOptions): IsolationOptions {
  if (!plain(options) || Object.keys(options).some(key => !optionKeys.has(key))
    || ['onSpawn', 'onStdout', 'onStderr', 'keepStdinOpen'].some(key => key in options)) {
    throw new FiniteIsolationExecutorError('Finite executor options cannot include lifecycle callbacks, open input or unknown fields');
  }
  text(options.program, 'program', true); text(options.cwd, 'cwd', true);
  if (!Array.isArray(options.args)) throw new FiniteIsolationExecutorError('Finite executor args option is invalid');
  for (const value of options.args) text(value, 'args');
  bound(options.timeoutMs, 300_000, 'timeout'); bound(options.maxOutputBytes, 16_777_216, 'output limit');
  if (options.stdin !== undefined && (typeof options.stdin !== 'string' || Buffer.byteLength(options.stdin) > 1_048_576)) throw new FiniteIsolationExecutorError('Finite executor stdin option exceeds its bound or is invalid');
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) throw new FiniteIsolationExecutorError('Finite executor signal option is invalid');
  if (options.allowNodeChildren !== undefined && typeof options.allowNodeChildren !== 'boolean') throw new FiniteIsolationExecutorError('Finite executor fork option is invalid');
  const copied = { ...options, args: [...options.args] };
  for (const key of ['readPaths', 'denyReadPaths', 'writePaths'] as const) {
    const paths = options[key];
    if (paths === undefined) continue;
    if (!Array.isArray(paths)) throw new FiniteIsolationExecutorError(`Finite executor ${key} option is invalid`);
    for (const path of paths) text(path, key, true);
    copied[key] = [...paths]; Object.freeze(copied[key]);
  }
  if (options.env !== undefined) {
    if (!plain(options.env)) throw new FiniteIsolationExecutorError('Finite executor env option is invalid');
    for (const [key, value] of Object.entries(options.env)) { text(key, 'env'); text(value, 'env'); }
    copied.env = Object.freeze({ ...options.env });
  }
  if (options.trustedExecutables !== undefined) {
    if (!Array.isArray(options.trustedExecutables)) throw new FiniteIsolationExecutorError('Finite executor executable option is invalid');
    copied.trustedExecutables = options.trustedExecutables.map(grant => {
      if (!plain(grant) || Object.keys(grant).some(key => key !== 'path' && key !== 'sha256')) throw new FiniteIsolationExecutorError('Finite executor executable descriptor is invalid');
      text(grant.path, 'executable', true);
      if (typeof grant.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(grant.sha256)) throw new FiniteIsolationExecutorError('Finite executor executable digest is invalid');
      return Object.freeze({ path: grant.path, sha256: grant.sha256 });
    });
    Object.freeze(copied.trustedExecutables);
  }
  Object.freeze(copied.args);
  return Object.freeze(copied);
}

export class FiniteIsolationExecutorContext {
  #executor: FiniteIsolationExecutor;
  #closed = false;
  #failure: FiniteIsolationExecutorError | undefined;
  #pending = new Set<Promise<IsolationResult>>();
  constructor(executor: FiniteIsolationExecutor) {
    if (typeof executor !== 'function') throw new FiniteIsolationExecutorError('Finite executor must be a function');
    this.#executor = executor;
  }
  #assertOpen(): void {
    if (this.#closed || this.#failure) throw new FiniteIsolationExecutorError('Finite executor is closed or failed');
  }
  #fail(cause: unknown): void { this.#failure ??= new FiniteIsolationExecutorError('Finite executor failed', { cause }); }
  run(options: IsolationOptions): Promise<IsolationResult> {
    let pending: Promise<IsolationResult>;
    try {
      this.#assertOpen();
      const copied = copiedOptions(options);
      pending = Promise.resolve().then(() => {
        // A request queued earlier in this turn cannot dispatch after a known
        // validation/transport fault or after the operation closed its scope.
        try { this.#assertOpen(); return this.#executor(copied); }
        catch (error) { this.#fail(error); throw error; }
      });
    } catch (error) { this.#fail(error); pending = Promise.reject(error); }
    this.#pending.add(pending);
    // Consume even ignored rejections, while preserving the returned original
    // promise/error for callers and retaining a swallowed fault at scope close.
    void pending.then(() => this.#pending.delete(pending), cause => {
      this.#pending.delete(pending);
      this.#fail(cause);
    });
    return pending;
  }
  async close(): Promise<void> {
    this.#closed = true;
    const unfinished = [...this.#pending];
    await Promise.allSettled(unfinished);
    if (this.#failure) throw this.#failure;
    if (unfinished.length) throw new FiniteIsolationExecutorError('Finite executor operation ended with unfinished requests');
  }
}

const execution = new AsyncLocalStorage<FiniteIsolationExecutorContext>();
/** Trusted shared-launcher access; never selected by a candidate request. */
export function currentFiniteIsolationExecutor(): FiniteIsolationExecutorContext | undefined { return execution.getStore(); }

export async function withFiniteIsolationExecutor<T>(executor: FiniteIsolationExecutor, operation: () => Promise<T>): Promise<T> {
  if (execution.getStore()) throw new FiniteIsolationExecutorError('Finite executor scopes cannot be nested');
  if (typeof operation !== 'function') throw new FiniteIsolationExecutorError('Finite executor requires an operation');
  const context = new FiniteIsolationExecutorContext(executor);
  return execution.run(context, async () => {
    let failed = false;
    try { return await operation(); }
    catch (error) { failed = true; throw error; }
    finally { try { await context.close(); } catch (error) { if (!failed) throw error; } }
  });
}
