import { randomUUID } from 'node:crypto';
import type { AssistantClock } from './vendor/pi/ai/types.ts';

export interface ShellEnvironment extends AssistantClock {
  newId(): string;
  scheduleTimeout(delayMs: number, callback: () => void): () => void;
}
/** Concrete host observations are selected only at construction. */
export function nodeShellClock(): AssistantClock {
  return { wallNow: Date.now, monotonicNow: performance.now.bind(performance) };
}
export function nodeShellEnvironment(): ShellEnvironment {
  const schedule = setTimeout, clear = clearTimeout;
  return { ...nodeShellClock(), newId: randomUUID, scheduleTimeout(delayMs, callback) {
    const timer = schedule(callback, delayMs); timer.unref();
    return () => clear(timer);
  } };
}
export function nodeShellFetch(): typeof fetch { return globalThis.fetch.bind(globalThis); }
export function captureShellClock(supplied: AssistantClock = nodeShellClock()): AssistantClock {
  const { wallNow, monotonicNow } = supplied;
  let previous: number | undefined;
  return {
    wallNow() {
      const value = wallNow();
      if (!Number.isFinite(value)) throw new Error('Shell wall time unavailable');
      return value;
    },
    monotonicNow() {
      const value = monotonicNow();
      if (!Number.isFinite(value) || value < 0 || (previous !== undefined && value < previous)) throw new Error('Shell monotonic time unavailable or regressed');
      previous = value; return value;
    },
  };
}
export function captureShellEnvironment(supplied: ShellEnvironment = nodeShellEnvironment()): ShellEnvironment {
  const clock = captureShellClock(supplied), { newId, scheduleTimeout } = supplied;
  return { ...clock, newId() {
    const value = newId();
    if (typeof value !== 'string' || !value.trim()) throw new Error('Shell identity unavailable');
    return value;
  }, scheduleTimeout(delayMs, callback) {
    if (!Number.isSafeInteger(delayMs) || delayMs < 0) throw new Error('Invalid shell timeout');
    return scheduleTimeout(delayMs, callback);
  } };
}
export function shellTimeout(schedule: ShellEnvironment['scheduleTimeout'], delayMs: number, parent?: AbortSignal): { signal: AbortSignal; cancel(): void } {
  parent?.throwIfAborted();
  const controller = new AbortController();
  let active = true, cancel: (() => void) | undefined;
  const abort = () => { if (active) controller.abort(parent?.reason); };
  parent?.addEventListener('abort', abort, { once: true });
  try {
    cancel = schedule(delayMs, () => { if (active) controller.abort(new DOMException('Shell request timed out', 'TimeoutError')); });
    if (typeof cancel !== 'function') throw new Error('Shell timeout cancellation unavailable');
  } catch (error) { active = false; parent?.removeEventListener('abort', abort); throw error; }
  return { signal: controller.signal, cancel() {
    if (!active) return;
    active = false; parent?.removeEventListener('abort', abort); cancel!();
  } };
}

export function throwShellFailures(failures: unknown[]): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Shell operation or cleanup failed', { cause: failures[0] });
}
/** Own the supplied response body until EOF or one cancellation attempt, including failed reader acquisition. */
export async function readShellJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const body = response.body;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, consumed = false;
  const failures: unknown[] = [], chunks: Uint8Array[] = [];
  let result: unknown;
  try {
    reader = body?.getReader();
    if (!reader) throw new Error('Provider response body absent');
    for (;;) {
      const part = await reader.read();
      if (part.done) consumed = true;
      signal.throwIfAborted();
      if (part.done) break;
      chunks.push(part.value);
    }
    result = JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
  } catch (error) { failures.push(error); }
  finally {
    if (body && !consumed) { try { if (reader) await reader.cancel(); else await body.cancel(); } catch (error) { failures.push(error); } }
    if (reader) { try { reader.releaseLock(); } catch (error) { failures.push(error); } }
  }
  throwShellFailures(failures); return result;
}
