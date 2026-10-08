import { CommunicationsError, parseSlackPayload } from './communications.ts';
import type { InboundMessage, SlackAllowlistOptions } from './communications.ts';

export interface SlackSocket {
  readonly readyState: number;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface SlackSocketOptions extends SlackAllowlistOptions {
  appToken: string;
  fetch?: typeof globalThis.fetch;
  createSocket?: (url: string) => SlackSocket;
  connectionTimeoutMs?: number;
  submitTimeoutMs?: number;
  maxReconnectAttempts?: number;
  reconnectDelayMs?: number;
}

export interface SlackSocketStatus {
  state: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'stopped' | 'failed';
  reconnectAttempts: number;
}

interface Connection {
  socket: SlackSocket;
  controller: AbortController;
  healthTimer: ReturnType<typeof setTimeout> | undefined;
  cleanup(): void;
}

const MAX_BYTES = 64 * 1024;
const MAX_PENDING = 32;
const HEALTHY_SESSION_MS = 60_000;
const RECONNECT_COOLDOWN_MS = 5 * 60_000;
const error = () => new CommunicationsError('slack_socket_connection_failed');
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function integer(value: number | undefined, fallback: number, maximum: number, minimum = 1): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new CommunicationsError('invalid_slack_socket_options');
  return result;
}

/** Abort bounds our wait even when an injected callback ignores its signal. */
async function bounded<T>(operation: (signal: AbortSignal) => Promise<T>, parent: AbortSignal, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  parent.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  let rejectAbort!: () => void;
  try {
    if (parent.aborted) controller.abort();
    if (controller.signal.aborted) throw error();
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(error());
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
    });
    return await Promise.race([operation(controller.signal), aborted]);
  } finally {
    clearTimeout(timer);
    parent.removeEventListener('abort', abort);
    if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort);
    controller.abort();
  }
}

async function responseJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.ok || !response.body) throw error();
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) { await response.body.cancel().catch(() => {}); throw error(); }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw error();
      const result = await reader.read(); if (result.done) break;
      bytes += result.value.length;
      if (bytes > MAX_BYTES) throw error();
      chunks.push(result.value);
    }
    if (signal.aborted) throw error();
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); }
}

function connectionUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 16_384) throw error();
  const url = new URL(value);
  if (url.protocol !== 'wss:' || !(url.hostname === 'slack.com' || url.hostname.endsWith('.slack.com'))
    || url.username || url.password || url.hash || (url.port && url.port !== '443')) throw error();
  return url.href;
}

function opened(socket: SlackSocket, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(error());
  if (socket.readyState === 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => { socket.removeEventListener('open', success); socket.removeEventListener('close', failure); socket.removeEventListener('error', failure); signal.removeEventListener('abort', failure); };
    const success = () => { cleanup(); resolve(); };
    const failure = () => { cleanup(); reject(error()); };
    socket.addEventListener('open', success); socket.addEventListener('close', failure); socket.addEventListener('error', failure); signal.addEventListener('abort', failure, { once: true });
    if (socket.readyState > 1) failure();
  });
}

/** Transport only: the injected submit callback owns durable deduplication and work. */
export class SlackSocketClient {
  readonly #api: { submit(input: InboundMessage): Promise<unknown> };
  readonly #options: SlackSocketOptions;
  readonly #fetch: typeof globalThis.fetch;
  readonly #createSocket: (url: string) => SlackSocket;
  readonly #lifetime = new AbortController();
  readonly #connectionTimeout: number;
  readonly #submitTimeout: number;
  readonly #maxAttempts: number;
  readonly #delay: number;
  readonly #pending = new Set<Promise<void>>();
  #state: SlackSocketStatus['state'] = 'idle';
  #attempts = 0;
  #connection: Connection | undefined;
  #opening: SlackSocket | undefined;
  #connecting: Promise<void> | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(api: { submit(input: InboundMessage): Promise<unknown> }, options: SlackSocketOptions) {
    if (typeof options.appToken !== 'string' || !options.appToken.startsWith('xapp-') || options.appToken.length > 4096 || /\s/.test(options.appToken)) throw new CommunicationsError('invalid_slack_app_token');
    this.#api = api;
    this.#options = { ...options, allowedTeamIds: [...options.allowedTeamIds], allowedUserIds: [...options.allowedUserIds], ...(options.allowedChannelIds ? { allowedChannelIds: [...options.allowedChannelIds] } : {}) };
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#createSocket = options.createSocket ?? (url => new WebSocket(url));
    this.#connectionTimeout = integer(options.connectionTimeoutMs, 10_000, 60_000);
    this.#submitTimeout = integer(options.submitTimeoutMs, 2_500, 3_000);
    this.#maxAttempts = integer(options.maxReconnectAttempts, 8, 100, 0);
    this.#delay = integer(options.reconnectDelayMs, 1_000, 30_000);
  }

  status(): SlackSocketStatus { return { state: this.#state, reconnectAttempts: this.#attempts }; }

  async start(): Promise<void> {
    if (this.#state !== 'idle') throw new CommunicationsError('slack_socket_already_started');
    this.#state = 'connecting';
    this.#connecting = this.#connect();
    try { await this.#connecting; }
    catch { if (!this.#lifetime.signal.aborted) this.#state = 'failed'; throw error(); }
    finally { this.#connecting = undefined; }
  }

  async close(): Promise<void> {
    this.#state = 'stopped'; this.#lifetime.abort();
    if (this.#timer) clearTimeout(this.#timer); this.#timer = undefined;
    this.#dispose(this.#connection);
    try { this.#opening?.close(); } catch { /* Never surface credential-bearing library errors. */ }
    await Promise.allSettled([this.#connecting, ...this.#pending]);
  }

  async #connect(): Promise<void> {
    let socket: SlackSocket | undefined;
    try {
      await bounded(async signal => {
        const response = await this.#fetch('https://slack.com/api/apps.connections.open', {
          method: 'POST', redirect: 'error', signal,
          headers: { authorization: `Bearer ${this.#options.appToken}`, 'content-type': 'application/x-www-form-urlencoded' }, body: '',
        });
        if (signal.aborted) throw error();
        const data = await responseJson(response, signal);
        if (signal.aborted || !object(data) || data.ok !== true) throw error();
        socket = this.#createSocket(connectionUrl(data.url)); this.#opening = socket;
        await opened(socket, signal);
        if (signal.aborted || this.#lifetime.signal.aborted) throw error();
        const controller = new AbortController();
        const connection: Connection = { socket, controller, healthTimer: undefined, cleanup: () => {
          if (connection.healthTimer) clearTimeout(connection.healthTimer);
          socket!.removeEventListener('message', message); socket!.removeEventListener('close', lost); socket!.removeEventListener('error', lost);
        } };
        const message: EventListener = event => this.#message(connection, (event as MessageEvent<unknown>).data);
        const lost = () => this.#lost(connection);
        socket.addEventListener('message', message); socket.addEventListener('close', lost); socket.addEventListener('error', lost);
        this.#connection = connection; this.#opening = undefined; this.#state = 'connected';
      }, this.#lifetime.signal, this.#connectionTimeout);
    } catch {
      this.#opening = undefined;
      try { socket?.close(); } catch { /* Opaque transport failure. */ }
      throw error();
    }
  }

  #dispose(connection: Connection | undefined): void {
    if (!connection) return;
    if (this.#connection === connection) this.#connection = undefined;
    connection.cleanup(); connection.controller.abort();
    try { connection.socket.close(1000); } catch { /* Opaque transport failure. */ }
  }

  #lost(connection: Connection): void {
    if (this.#connection !== connection) return;
    this.#dispose(connection); this.#reconnect();
  }

  #reconnect(): void {
    if (this.#lifetime.signal.aborted || this.#timer) return;
    if (this.#maxAttempts === 0) { this.#state = 'failed'; return; }
    this.#state = 'reconnecting';
    const cooldown = this.#attempts >= this.#maxAttempts;
    const wait = cooldown ? RECONNECT_COOLDOWN_MS : Math.min(30_000, this.#delay * 2 ** this.#attempts);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      if (this.#lifetime.signal.aborted) return;
      if (cooldown) this.#attempts = 0;
      this.#attempts++;
      const work = this.#connect(); this.#connecting = work;
      void work.catch(() => this.#reconnect()).finally(() => { if (this.#connecting === work) this.#connecting = undefined; });
    }, wait);
  }

  #message(connection: Connection, raw: unknown): void {
    if (this.#connection !== connection || this.#lifetime.signal.aborted) return;
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_BYTES || this.#pending.size >= MAX_PENDING) { this.#lost(connection); return; }
    let body: unknown;
    try { body = JSON.parse(raw); } catch { this.#lost(connection); return; }
    if (!object(body) || typeof body.type !== 'string') { this.#lost(connection); return; }
    if (body.type === 'hello') {
      // Opening alone cannot replenish retries: repeated immediate failures retain
      // their backoff. A continuously open authenticated session is health evidence.
      if (connection.healthTimer === undefined) connection.healthTimer = setTimeout(() => {
        if (this.#connection === connection && !connection.controller.signal.aborted && connection.socket.readyState === 1) this.#attempts = 0;
      }, HEALTHY_SESSION_MS);
      return;
    }
    if (body.type === 'disconnect') {
      if (body.reason === 'link_disabled') { this.#dispose(connection); this.#state = 'failed'; }
      else this.#lost(connection);
      return;
    }
    if (body.type !== 'events_api') return;
    if (typeof body.envelope_id !== 'string' || !body.envelope_id.trim() || body.envelope_id.length > 512) { this.#lost(connection); return; }
    const envelopeId = body.envelope_id;
    const work = Promise.resolve().then(async () => {
      if (connection.controller.signal.aborted) return;
      const parsed = parseSlackPayload(body.payload, this.#options);
      if (parsed.kind === 'message') await bounded(() => this.#api.submit(parsed.message), connection.controller.signal, this.#submitTimeout);
      if (this.#connection === connection && !connection.controller.signal.aborted && connection.socket.readyState === 1) connection.socket.send(JSON.stringify({ envelope_id: envelopeId }));
    }).catch(() => this.#lost(connection));
    this.#pending.add(work);
    void work.finally(() => this.#pending.delete(work));
  }
}
