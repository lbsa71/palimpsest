import type { ChildProcess } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface IsolationSpawnDescriptor {
  readonly purpose: 'finite-isolated-process';
  readonly program: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly scratch: string;
}
export interface IsolationDrain {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}
export interface IsolationOwnership {
  signal: AbortSignal;
  beforeSpawn(descriptor: IsolationSpawnDescriptor): string;
  spawned(spawnId: string, child: ChildProcess): void;
  drained(spawnId: string, result: IsolationDrain): void;
}

export class IsolationOwnershipError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = 'IsolationOwnershipError'; }
}

function synchronous<T>(hook: () => T): T {
  const result = hook();
  if (result !== null && (typeof result === 'object' || typeof result === 'function')
    && typeof (result as { then?: unknown }).then === 'function') {
    // Reject the synchronous receipt contract now, but consume later failure too.
    void Promise.resolve(result).catch(() => {});
    throw new IsolationOwnershipError('Isolation ownership hooks must complete synchronously');
  }
  return result;
}

/** Trusted ownership observes the existing launcher; it grants no capability.
 * Copy callbacks before asynchronous dispatch so caller mutation cannot switch
 * journals or cancellation ownership underneath an already admitted operation. */
export class IsolationOwnershipContext {
  readonly signal: AbortSignal;
  #closed = false;
  #failure: IsolationOwnershipError | undefined;
  #stop = new AbortController();
  #ids = new Set<string>();
  #pending = new Set<Promise<unknown>>();
  #intent: IsolationOwnership['beforeSpawn'];
  #spawned: IsolationOwnership['spawned'];
  #drained: IsolationOwnership['drained'];
  constructor(owner: IsolationOwnership) {
    const signal = owner?.signal, intent = owner?.beforeSpawn, spawned = owner?.spawned, drained = owner?.drained;
    if (!(signal instanceof AbortSignal) || typeof intent !== 'function' || typeof spawned !== 'function' || typeof drained !== 'function') {
      throw new IsolationOwnershipError('Isolation ownership requires a signal and synchronous intent, PID and drain hooks');
    }
    this.signal = AbortSignal.any([signal, this.#stop.signal]);
    this.#intent = intent; this.#spawned = spawned; this.#drained = drained;
  }
  assertOpen(): void {
    if (this.#closed || this.signal.aborted) throw new IsolationOwnershipError('Isolation ownership is closed or cancelled');
  }
  cancel(): void { this.#stop.abort(); }
  fail(cause: unknown): void {
    this.#failure ??= new IsolationOwnershipError('Isolation ownership failed', { cause });
    this.cancel();
  }
  #receipt<T>(hook: () => T): T {
    try { return synchronous(hook); }
    catch (cause) { this.fail(cause); throw cause; }
  }
  beforeSpawn(descriptor: IsolationSpawnDescriptor): string {
    this.assertOpen();
    const copied = Object.freeze({ ...descriptor, args: Object.freeze([...descriptor.args]) });
    const id = this.#receipt(() => this.#intent(copied));
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id) || this.#ids.has(id)) {
      const error = new IsolationOwnershipError('Isolation ownership spawn identity is invalid or duplicated');
      this.fail(error); throw error;
    }
    this.#ids.add(id);
    this.assertOpen();
    return id;
  }
  spawned(id: string, child: ChildProcess): void { this.#receipt(() => this.#spawned(id, child)); }
  drained(id: string, result: IsolationDrain): void { this.#receipt(() => this.#drained(id, Object.freeze({ ...result }))); }
  track(pending: Promise<unknown>): void {
    this.#pending.add(pending);
    void pending.then(() => this.#pending.delete(pending), () => this.#pending.delete(pending));
  }
  async close(): Promise<void> {
    this.#closed = true;
    this.#stop.abort();
    // An early operation return cannot release ownership while detached children
    // are still writing. Await the launcher, including scratch cleanup/receipts.
    const unfinished = [...this.#pending];
    await Promise.allSettled(unfinished);
    if (this.#failure) throw this.#failure;
    if (unfinished.length) throw new IsolationOwnershipError('Isolation ownership operation ended with unfinished isolated execution');
  }
}

const ownership = new AsyncLocalStorage<IsolationOwnershipContext>();
/** Shared launcher access only; a candidate does not select this trusted context. */
export function currentIsolationOwnership(): IsolationOwnershipContext | undefined { return ownership.getStore(); }

export async function withIsolationOwnership<T>(owner: IsolationOwnership, operation: () => Promise<T>): Promise<T> {
  if (ownership.getStore()) throw new IsolationOwnershipError('Isolation ownership contexts cannot be nested');
  if (typeof operation !== 'function') throw new IsolationOwnershipError('Isolation ownership requires an operation');
  const context = new IsolationOwnershipContext(owner);
  return ownership.run(context, async () => {
    let operationFailed = false;
    try { return await operation(); }
    catch (error) { operationFailed = true; throw error; }
    finally {
      // Preserve an already propagated operation error and its evidence/cause.
      // Only a swallowed ownership fault needs an additional scope rejection.
      try { await context.close(); }
      catch (error) { if (!operationFailed) throw error; }
    }
  });
}
