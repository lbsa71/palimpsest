import { capture, executionKeys, nodeExecutionEnvironment, scheduleTimer, throwFailures, type ExecutionEnvironment, type Timer } from './environment.ts';
import { confinementArguments, type ConfinedCommand } from './confinement.ts';
import { spawnBounded } from './resource-limits.ts';
import type { JsonValue } from '../contracts/index.ts';

export interface WorkerOptions {
  command: ConfinedCommand;
  initial: JsonValue;
  maxMessageBytes: number;
  maxRequests: number;
  handle(method: string, args: JsonValue[], signal: AbortSignal): Promise<JsonValue>;
}

/** A narrow JSON pipe, not an authority grant. The host handler authenticates every operation. */
export async function runWorker(options: WorkerOptions, supplied: ExecutionEnvironment = nodeExecutionEnvironment()): Promise<JsonValue> {
  const environment = capture(supplied, executionKeys);
  const handle = options.handle;
  options = { command: options.command, initial: options.initial, maxMessageBytes: options.maxMessageBytes,
    maxRequests: options.maxRequests, handle: handle.bind(options) };
  const command = { ...options.command, args: [...options.command.args], protectedPaths: [...options.command.protectedPaths], ...(options.command.resourceLimits ? { resourceLimits: { ...options.command.resourceLimits } } : {}) };
  command.signal?.throwIfAborted();
  if (!Number.isSafeInteger(options.maxMessageBytes) || options.maxMessageBytes < 1 ||
    !Number.isSafeInteger(options.maxRequests) || options.maxRequests < 1) throw new Error('Finite worker protocol limits required');
  const confined = await spawnBounded(confinementArguments(command, environment), { ...command, input: 'pipe' }, environment);
  const { child } = confined;
  const controller = new AbortController();
  let buffer = Buffer.alloc(0);
  let emittedBytes = 0;
  let requests = 0;
  let pending = 0;
  let result: JsonValue | undefined;
  let failure: Error | undefined;
  const cleanupFailures: unknown[] = [];
  const handlers = new Set<Promise<void>>();
  const ids = new Set<string>();
  const stop = (error?: Error) => {
    failure ??= error;
    controller.abort(error);
    try { confined.stop(); } catch (error) { cleanupFailures.push(error); }
  };
  const send = (value: unknown) => {
    const line = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(line) > options.maxMessageBytes) throw new Error('Worker input/response exceeds message limit');
    if (!child.stdin.destroyed) child.stdin.write(line);
  };
  const onLine = (line: Buffer) => {
    let value: Record<string, unknown>;
    try { value = JSON.parse(line.toString('utf8')) as Record<string, unknown>; }
    catch { stop(new Error('Worker emitted an invalid protocol record')); return; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) { stop(new Error('Invalid worker message')); return; }
    if (value.kind === 'done') {
      if (pending !== 0 || !Object.hasOwn(value, 'value')) { stop(new Error('Worker completed with unresolved requests')); return; }
      result = value.value as JsonValue;
      stop();
      return;
    }
    if (value.kind !== 'request' || typeof value.id !== 'string' || value.id.length > 128 || ids.has(value.id) ||
      typeof value.method !== 'string' || value.method.length > 128 || !Array.isArray(value.args)) {
      stop(new Error('Invalid or duplicate worker request')); return;
    }
    if (++requests > options.maxRequests || pending >= 8) { stop(new Error('Worker request budget exceeded')); return; }
    ids.add(value.id); pending++;
    // Host refusals may throw before returning a promise. Keep both forms inside the protocol boundary.
    const handling = (async () => options.handle(value.method as string, value.args as JsonValue[], controller.signal))().then(
      response => { if (!controller.signal.aborted) send({ kind: 'reply', id: value.id, ok: true, value: response }); },
      () => { if (!controller.signal.aborted) send({ kind: 'reply', id: value.id, ok: false, error: 'Host operation refused or unavailable' }); },
    ).catch(() => stop(new Error('Worker reply failed'))).finally(() => { pending--; handlers.delete(handling); });
    handlers.add(handling);
  };
  let timer: Timer | undefined;
  const abort = () => stop(new Error('Worker cancelled'));
  const failures: unknown[] = [];
  try {
    child.stdout.on('data', (chunk: Buffer) => {
      emittedBytes += chunk.length;
      if (emittedBytes > command.maxOutputBytes) { stop(new Error('Worker output limit exceeded')); return; }
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const newline = buffer.indexOf(10);
        if (newline < 0) break;
        const line = buffer.subarray(0, newline); buffer = buffer.subarray(newline + 1);
        if (line.length > options.maxMessageBytes) { stop(new Error('Worker message limit exceeded')); return; }
        if (!controller.signal.aborted) onLine(line);
      }
      if (buffer.length > options.maxMessageBytes) stop(new Error('Worker message limit exceeded'));
    });
    // Count diagnostics but do not expose arbitrary worker/provider content as a host error.
    child.stderr.on('data', (chunk: Buffer) => { emittedBytes += chunk.length; if (emittedBytes > command.maxOutputBytes) stop(new Error('Worker output limit exceeded')); });
    child.stdin.on('error', () => stop(new Error('Worker input pipe failed')));
    timer = scheduleTimer(environment, command.timeoutMs, () => stop(new Error('Worker deadline exceeded')));
    command.signal?.addEventListener('abort', abort, { once: true });
    if (command.signal?.aborted) abort();
    try { send({ kind: 'start', value: options.initial }); } catch (error) { stop(error as Error); }
    await confined.closed;
    if (failure) throw failure;
    if (result === undefined) throw new Error('Worker exited without a completed result');
  } catch (error) { failures.push(error); }
  if (timer) { try { timer.cancel(); } catch (error) { cleanupFailures.push(error); } }
  command.signal?.removeEventListener('abort', abort);
  stop();
  // Already-dispatched host effects retain their authority/resources until actual settlement.
  await Promise.all(handlers);
  try { await confined.cleanup(); } catch (error) { cleanupFailures.push(error); }
  throwFailures([...failures, ...cleanupFailures]);
  return result!;
}
