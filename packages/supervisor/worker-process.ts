import { spawn } from 'node:child_process';
import { confinementArguments, type ConfinedCommand } from './confinement.ts';
import type { JsonValue } from '../contracts/index.ts';

export interface WorkerOptions {
  command: ConfinedCommand;
  initial: JsonValue;
  maxMessageBytes: number;
  maxRequests: number;
  handle(method: string, args: JsonValue[], signal: AbortSignal): Promise<JsonValue>;
}

/** A narrow JSON pipe, not an authority grant. The host handler authenticates every operation. */
export async function runWorker(options: WorkerOptions): Promise<JsonValue> {
  const { command } = options;
  command.signal?.throwIfAborted();
  if (!Number.isSafeInteger(options.maxMessageBytes) || options.maxMessageBytes < 1 ||
    !Number.isSafeInteger(options.maxRequests) || options.maxRequests < 1) throw new Error('Finite worker protocol limits required');
  const child = spawn('/usr/bin/bwrap', confinementArguments(command), { detached: true, stdio: ['pipe', 'pipe', 'pipe'], env: {} });
  const controller = new AbortController();
  let buffer = Buffer.alloc(0);
  let emittedBytes = 0;
  let requests = 0;
  let pending = 0;
  let result: JsonValue | undefined;
  let failure: Error | undefined;
  const ids = new Set<string>();
  const stop = (error?: Error) => {
    failure ??= error;
    controller.abort(error);
    if (child.pid) {
      try { process.kill(-child.pid, 'SIGKILL'); }
      catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') failure ??= new Error('Worker termination failed'); }
    }
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
    void options.handle(value.method, value.args as JsonValue[], controller.signal).then(
      response => { if (!controller.signal.aborted) send({ kind: 'reply', id: value.id, ok: true, value: response }); },
      () => { if (!controller.signal.aborted) send({ kind: 'reply', id: value.id, ok: false, error: 'Host operation refused or unavailable' }); },
    ).catch(() => stop(new Error('Worker reply failed'))).finally(() => pending--);
  };
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
  const timer = setTimeout(() => stop(new Error('Worker deadline exceeded')), command.timeoutMs);
  const abort = () => stop(new Error('Worker cancelled'));
  command.signal?.addEventListener('abort', abort, { once: true });
  if (command.signal?.aborted) abort();
  try {
    const closed = new Promise<void>((resolve, reject) => {
      child.once('error', () => reject(new Error('Worker isolation unavailable')));
      child.once('close', () => resolve());
    });
    try { send({ kind: 'start', value: options.initial }); } catch (error) { stop(error as Error); }
    await closed;
    if (failure) throw failure;
    if (result === undefined) throw new Error('Worker exited without a completed result');
    return result;
  } finally {
    clearTimeout(timer);
    command.signal?.removeEventListener('abort', abort);
    stop();
  }
}
