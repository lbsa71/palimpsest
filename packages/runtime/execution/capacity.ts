import { CapacityUnavailable } from '../resources/index.ts';

/** Capacity changes are hints: the atomic reservation remains authoritative.
 * Subscribe before attempting work so a release cannot be lost between denial
 * and waiting. Notifications resume on a microtask, outside the ledger write.
 * Only pre-dispatch capacity denials may be retried by callers of this helper. */
export async function awaitCapacity<T>(options: {
  attempt(): T | Promise<T>;
  subscribe(listener: () => void): () => void;
  waiting(): void;
  signal?: AbortSignal;
}): Promise<T> {
  let changed = false;
  let wake: (() => void) | undefined;
  const notify = () => { changed = true; wake?.(); };
  const unsubscribe = options.subscribe(notify);
  options.signal?.addEventListener('abort', notify, { once: true });
  try {
    for (;;) {
      options.signal?.throwIfAborted();
      changed = false;
      try { return await options.attempt(); }
      catch (error) {
        if (!(error instanceof CapacityUnavailable)) throw error;
        options.signal?.throwIfAborted();
        options.waiting();
      }
      await new Promise<void>(resolve => {
        wake = resolve;
        if (changed || options.signal?.aborted) resolve();
      });
      wake = undefined;
    }
  } finally {
    options.signal?.removeEventListener('abort', notify);
    unsubscribe();
  }
}
