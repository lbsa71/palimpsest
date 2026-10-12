import { createServer } from 'node:http';
import { setTimeout, clearTimeout } from 'node:timers';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { invariant } from '../contracts/common.ts';
import type { SocketLike } from './slack/socket.ts';

export interface CommunicationTimer { cancel(): void }
export type CommunicationSchedule = (delayMs: number, callback: () => void) => CommunicationTimer;
export type HttpListenerFactory = (handler: (request: IncomingMessage, response: ServerResponse) => void) => Server;

/** Trusted Node composition; constructing adapters performs no IO. */
export function createNodeCommunicationsEnvironment() {
  const transport = globalThis.fetch.bind(globalThis);
  const wall = Date.now.bind(Date), elapsed = performance.now.bind(performance);
  const Socket = globalThis.WebSocket;
  return {
    fetch: transport,
    now: wall,
    monotonicNow: elapsed,
    schedule: ((ms, callback) => {
      validDelay(ms);
      const handle = setTimeout(callback, ms);
      let cancelled = false;
      return { cancel() { if (!cancelled) { cancelled = true; clearTimeout(handle); } } };
    }) as CommunicationSchedule,
    socket: (url: string): SocketLike => new Socket(url),
    createListener: ((handler) => createServer(handler)) as HttpListenerFactory,
  };
}

function validDelay(ms: number): void {
  invariant(Number.isSafeInteger(ms) && ms >= 0 && ms <= 2147483647, 'invalid communications timer delay');
}
export function captureWallClock(now: () => number): () => number {
  return () => { const value = now(); invariant(Number.isFinite(value) && Math.abs(value) <= 8640000000000000, 'invalid communications wall clock'); return value; };
}
export function captureMonotonicClock(now: () => number): () => number {
  let previous = 0;
  return () => { const value = now(); invariant(Number.isFinite(value) && value >= previous, 'invalid or regressed communications monotonic clock'); previous = value; return value; };
}

/** Every terminal path disposes the timer and abort listener. Cleanup errors propagate. */
export async function communicationDelay(schedule: CommunicationSchedule, ms: number, signal: AbortSignal): Promise<void> {
  validDelay(ms); signal.throwIfAborted();
  let cancelTimer: (()=>void) | undefined;
  let abort!: () => void;let failed=false;let failure:unknown;
  try {
    await new Promise<void>((resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      try { const timer = schedule(ms, resolve); cancelTimer = timer.cancel.bind(timer); } catch (error) { reject(error); }
      if (signal.aborted) abort();
    });
  } catch(error) { failed=true;failure=error;throw error; } finally {
    signal.removeEventListener('abort', abort);
    try{cancelTimer?.();}catch(error){if(failed)throw new AggregateError([failure,error],'communications delay timer cleanup failed');throw error;}
  }
}

export function communicationTimeout(schedule: CommunicationSchedule, ms: number, parent?: AbortSignal): { signal: AbortSignal; cancel(): void } {
  validDelay(ms); parent?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(parent!.reason);
  let cancelTimer: ()=>void;
  parent?.addEventListener('abort', abort, { once: true });
  try { const timer = schedule(ms, () => controller.abort(new Error('Slack request timeout'))); cancelTimer = timer.cancel.bind(timer); }
  catch (error) { parent?.removeEventListener('abort', abort); throw error; }
  if (parent?.aborted) abort();
  let cancelled = false;
  return { signal: controller.signal, cancel() {
    if (cancelled) return;
    cancelled = true;
    parent?.removeEventListener('abort', abort);
    cancelTimer();
  } };
}
