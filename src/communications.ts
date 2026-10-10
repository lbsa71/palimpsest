import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

export interface InboundMessage {
  id: string;
  conversationId: string;
  text: string;
  source: string;
  replyTo?: string;
  /** Set only by an authenticated Slack adapter, never taken from message text. */
  slackAuthor?: { teamId: string; userId: string };
}

export interface OutboundMessage {
  conversationId: string;
  taskId: string;
  text: string;
  kind: 'progress' | 'result' | 'error';
  replyTo?: string;
}

export interface Communications {
  name: string;
  /** Successful send can retain an externally observed receipt. Void remains
   * compatible with transports which offer no independent message identity. */
  send(message: OutboundMessage): Promise<void | { transport: string; messageId: string }>;
}

export class CommunicationsError extends Error {
  readonly delivery: 'rejected' | 'uncertain' | undefined;

  constructor(code: string, delivery?: 'rejected' | 'uncertain') {
    super(code);
    this.name = 'CommunicationsError';
    this.delivery = delivery;
  }
}

const MAX_BODY_BYTES = 64 * 1024;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonempty(value: unknown, maxLength = 512): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function inbound(value: unknown, source?: string): InboundMessage {
  if (!record(value) || !nonempty(value.id) || !nonempty(value.conversationId) || !nonempty(value.text, 60_000)
    || (value.replyTo !== undefined && !nonempty(value.replyTo))
    || (value.source !== undefined && !nonempty(value.source))
    || (source !== undefined && value.source !== undefined && source !== value.source)
    || (source === undefined && !nonempty(value.source))
    || Object.keys(value).some((key) => !['id', 'conversationId', 'text', 'source', 'replyTo'].includes(key))) {
    throw new CommunicationsError('invalid_message');
  }
  return {
    id: value.id, conversationId: value.conversationId, text: value.text, source: source ?? value.source as string,
    ...(value.replyTo === undefined ? {} : { replyTo: value.replyTo as string }),
  };
}

function peerInbound(value: unknown): InboundMessage {
  const message = inbound(value, 'peer');
  // The caller supplies a label, never a trusted runtime scope or source role.
  if (message.conversationId.length > 507) throw new CommunicationsError('invalid_message');
  return { ...message, conversationId: `peer:${message.conversationId}` };
}

function peerScope(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('peer:') && nonempty(value.slice(5), 507);
}

function outbound(message: OutboundMessage): OutboundMessage {
  if (!nonempty(message.conversationId) || !nonempty(message.taskId) || !nonempty(message.text, 60_000)
    || !['progress', 'result', 'error'].includes(message.kind)
    || (message.replyTo !== undefined && !nonempty(message.replyTo))) {
    throw new CommunicationsError('invalid_message');
  }
  return { ...message };
}

/** Calls the runtime directly; retained outputs are test observations, not durable history. */
export class DirectCommunications implements Communications {
  readonly name = 'direct';
  readonly #outputs = new Map<string, OutboundMessage[]>();

  async receive<T>(message: InboundMessage, ingress: (input: InboundMessage) => Promise<T>): Promise<T> {
    const input = inbound(message, 'direct');
    if (input.conversationId.startsWith('peer:')) throw new CommunicationsError('invalid_direct_context');
    return ingress(input);
  }

  async send(message: OutboundMessage): Promise<void> {
    const copy = outbound(message);
    const messages = this.#outputs.get(copy.conversationId) ?? [];
    messages.push(copy);
    this.#outputs.set(copy.conversationId, messages);
  }

  messages(conversationId: string): OutboundMessage[] {
    return (this.#outputs.get(conversationId) ?? []).map((message) => ({ ...message }));
  }
}

/** One unprivileged local peer principal. Runtime task/output history is durable;
 * these snapshots are only transport observations, as with direct calls. */
export class PeerCommunications implements Communications {
  readonly name = 'peer';
  readonly #outputs = new Map<string, OutboundMessage[]>();

  async receive<T>(message: unknown, ingress: (input: InboundMessage) => Promise<T>): Promise<T> {
    return ingress(peerInbound(message));
  }

  async send(message: OutboundMessage): Promise<void> {
    const copy = outbound(message);
    if (!peerScope(copy.conversationId)) throw new CommunicationsError('invalid_peer_context', 'rejected');
    const messages = this.#outputs.get(copy.conversationId) ?? [];
    messages.push(copy); this.#outputs.set(copy.conversationId, messages);
  }

  messages(conversationId: string): OutboundMessage[] {
    return (this.#outputs.get(conversationId) ?? []).map(message => ({ ...message }));
  }
}

export interface LocalApi {
  submit(input: InboundMessage): Promise<unknown>;
  status(id: string): unknown;
  cancel(id: string): unknown;
  events(after: number): unknown;
}

export interface LocalServerOptions {
  token: string;
  /** Independent unprivileged principal, restricted to /peer routes. */
  peerToken?: string;
  host?: string;
  port?: number;
}

export interface LocalServer {
  server: Server;
  url: string;
  close(): Promise<void>;
}

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
  }
}

function equalSecret(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    request.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        chunks.length = 0;
        reject(new HttpError(413, 'body_too_large'));
      } else {
        chunks.push(chunk);
      }
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', () => reject(new HttpError(400, 'invalid_body')));
    request.on('aborted', () => reject(new HttpError(400, 'aborted_request')));
  });
}

function respond(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(body ?? null));
}

/** A conversation participant observes task state and admitted speech, never
 * the autark's decision checkpoints or privileged host diagnostics. Whitelisting
 * also protects duplicate submit and cancel responses as task fields evolve. */
function peerTask(value: unknown): unknown {
  if (!record(value)) return value;
  return Object.fromEntries(['id', 'source', 'conversationId', 'input', 'state', 'output', 'error', 'createdAt', 'updatedAt']
    .filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
}

/** Distinct operator/peer roles. State and task semantics remain in the runtime. */
export async function createLocalServer(api: LocalApi, options: LocalServerOptions): Promise<LocalServer> {
  const host = options.host ?? '127.0.0.1';
  if (!['127.0.0.1', '::1'].includes(host)) throw new CommunicationsError('local_server_requires_loopback');
  if (typeof options.token !== 'string' || options.token.length < 16 || /\s/.test(options.token)) throw new CommunicationsError('local_server_requires_token_at_least_16_characters');
  if (options.peerToken !== undefined && (typeof options.peerToken !== 'string' || options.peerToken.length < 16 || /\s/.test(options.peerToken))) throw new CommunicationsError('local_server_requires_peer_token_at_least_16_characters');
  if (options.peerToken === options.token) throw new CommunicationsError('local_server_role_tokens_must_differ');
  const port = options.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new CommunicationsError('invalid_port');
  const server = createServer(async (request, response) => {
    try {
      const authorization = request.headers.authorization ?? '';
      const operator = equalSecret(authorization, `Bearer ${options.token}`);
      const peer = options.peerToken !== undefined && equalSecret(authorization, `Bearer ${options.peerToken}`);
      if (!operator && !peer) throw new HttpError(401, 'unauthorized');
      if (request.headers.origin !== undefined) throw new HttpError(403, 'browser_origin_not_allowed');
      let url: URL;
      try { url = new URL(request.url ?? '/', 'http://localhost'); } catch { throw new HttpError(400, 'invalid_url'); }
      const peerRoute = url.pathname.startsWith('/peer/');
      if (peerRoute !== peer) throw new HttpError(401, 'unauthorized');
      if (request.method === 'POST' && url.pathname === (peer ? '/peer/messages' : '/messages')) {
        if (request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new HttpError(415, 'json_required');
        const body = await readBody(request);
        let input: InboundMessage;
        try {
          input = peer ? peerInbound(JSON.parse(body)) : inbound(JSON.parse(body), 'direct');
          if (!peer && input.conversationId.startsWith('peer:')) throw new Error();
        } catch { throw new HttpError(400, 'invalid_message'); }
        const accepted = await api.submit(input);
        respond(response, 202, peer ? peerTask(accepted) : accepted);
        return;
      }
      if (!peer && request.method === 'GET' && url.pathname === '/events') {
        const cursor = url.searchParams.get('after') ?? '0';
        const after = Number(cursor);
        if (!/^\d+$/.test(cursor) || !Number.isSafeInteger(after)) throw new HttpError(400, 'invalid_cursor');
        respond(response, 200, await api.events(after));
        return;
      }
      const taskRoute = (peer ? /^\/peer\/tasks\/([^/]+)(\/cancel)?$/ : /^\/tasks\/([^/]+)(\/cancel)?$/).exec(url.pathname);
      if (taskRoute && ((!taskRoute[2] && request.method === 'GET') || (taskRoute[2] && request.method === 'POST'))) {
        let id: string;
        try { id = decodeURIComponent(taskRoute[1]!); } catch { throw new HttpError(400, 'invalid_task_id'); }
        if (!nonempty(id) || id.includes('/')) throw new HttpError(400, 'invalid_task_id');
        // Check trusted provenance before invoking a control callback. The peer
        // token owns one principal's peer scopes, never operator/Slack tasks.
        const observed = peer ? await api.status(id) : undefined;
        if (peer && (!record(observed) || observed.source !== 'peer' || !peerScope(observed.conversationId))) throw new HttpError(404, 'task_not_found');
        const result = taskRoute[2] ? await api.cancel(id) : peer ? observed : await api.status(id);
        if (result === null || result === undefined) throw new HttpError(404, 'task_not_found');
        respond(response, 200, peer ? peerTask(result) : result);
        return;
      }
      throw new HttpError(404, 'route_not_found');
    } catch (error) {
      if (!response.headersSent) respond(response, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : 'internal_error' });
      else response.destroy();
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.setTimeout(15_000, (socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new CommunicationsError('local_server_address_unavailable');
  return {
    server,
    url: `http://${host === '::1' ? '[::1]' : host}:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeIdleConnections();
    }),
  };
}

export interface SlackAllowlistOptions {
  allowedTeamIds: readonly string[];
  /** @deprecated User IDs no longer restrict conversation; configure modification policy in the host. */
  allowedUserIds?: readonly string[];
  allowedChannelIds?: readonly string[];
  /** Trusted durable lookup; ordinary messages cannot enroll a thread. */
  hasJoinedThread?: (conversationId: string) => boolean;
  /** Preserve retry identity for events accepted before message-based dedup. */
  hasAcceptedEvent?: (eventId: string) => boolean;
}

export interface SlackEventOptions extends SlackAllowlistOptions {
  signingSecret: string;
  signature: string;
  timestamp: string;
  /** Milliseconds since the Unix epoch; injectable for deterministic tests. */
  now?: number;
}

export type SlackEvent = { kind: 'message'; message: InboundMessage } | { kind: 'challenge'; challenge: string } | { kind: 'ignored' };

/** Authenticate the original bytes before parsing and stable-message normalization. */
export function parseSlackEvent(rawBody: string, options: SlackEventOptions): SlackEvent {
  if (!nonempty(options.signingSecret, 1024)) throw new CommunicationsError('missing_slack_signing_secret');
  const now = options.now ?? Date.now();
  if (!/^\d+$/.test(options.timestamp) || !Number.isFinite(now) || Math.abs(now / 1000 - Number(options.timestamp)) > 300) throw new CommunicationsError('expired_slack_request');
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) throw new CommunicationsError('body_too_large');
  const signature = 'v0=' + createHmac('sha256', options.signingSecret).update(`v0:${options.timestamp}:${rawBody}`).digest('hex');
  if (!equalSecret(options.signature, signature)) throw new CommunicationsError('invalid_slack_signature');
  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { throw new CommunicationsError('invalid_slack_event'); }
  return parseSlackPayload(body, options);
}

/** Normalization only. Call after HTTP HMAC verification or on an authenticated Slack socket. */
export function parseSlackPayload(body: unknown, options: SlackAllowlistOptions): SlackEvent {
  if (!record(body)) throw new CommunicationsError('invalid_slack_event');
  if (body.type === 'url_verification' && nonempty(body.challenge, 4096)) return { kind: 'challenge', challenge: body.challenge };
  if (body.type !== 'event_callback' || !record(body.event)) return { kind: 'ignored' };
  const event = body.event;
  if (!['message', 'app_mention'].includes(String(event.type)) || event.bot_id !== undefined || event.subtype !== undefined) return { kind: 'ignored' };
  if (event.channel_type !== undefined && !['channel', 'group'].includes(String(event.channel_type))) return { kind: 'ignored' };
  if (!nonempty(body.team_id) || !nonempty(event.user) || !nonempty(event.channel)
    || !options.allowedTeamIds.includes(body.team_id)
    || (options.allowedChannelIds !== undefined && !options.allowedChannelIds.includes(event.channel))) return { kind: 'ignored' };
  const root = event.thread_ts ?? event.ts;
  if (!nonempty(body.event_id) || !nonempty(event.text, 60_000) || !nonempty(root) || !nonempty(event.ts)
    || !/^[A-Za-z0-9]+$/.test(body.team_id) || !/^[A-Za-z0-9]+$/.test(event.channel) || !/^[A-Za-z0-9]+$/.test(event.user)
    || !/^\d+\.\d+$/.test(root) || !/^\d+\.\d+$/.test(event.ts)) throw new CommunicationsError('invalid_slack_event');
  const conversationId = `slack:${body.team_id}:${event.channel}:${root}`;
  if (event.type === 'message' && (event.thread_ts === undefined
    || !['channel', 'group'].includes(String(event.channel_type)) || !options.hasJoinedThread?.(conversationId))) return { kind: 'ignored' };
  // Slack can deliver the same message as both app_mention and message events.
  // The individual message timestamp is stable across subscriptions and retries.
  const id = options.hasAcceptedEvent?.(body.event_id) ? body.event_id : `slack-message:${body.team_id}:${event.channel}:${event.ts}`;
  return { kind: 'message', message: { id, source: 'slack', conversationId, text: event.text, replyTo: root,
    slackAuthor: { teamId: body.team_id, userId: event.user } } };
}

export interface SlackCommunicationsOptions {
  token: string;
  fetch?: typeof globalThis.fetch;
}

export class SlackCommunications implements Communications {
  readonly name = 'slack';
  readonly #token: string;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: SlackCommunicationsOptions) {
    if (!nonempty(options.token, 4096) || /\s/.test(options.token)) throw new CommunicationsError('missing_slack_token');
    this.#token = options.token;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async send(message: OutboundMessage): Promise<{ transport: string; messageId: string }> {
    outbound(message);
    const context = /^slack:([A-Za-z0-9]+):([A-Za-z0-9]+):(\d+\.\d+)$/.exec(message.conversationId);
    if (!context || (message.replyTo !== undefined && message.replyTo !== context[3])) throw new CommunicationsError('invalid_slack_context', 'rejected');
    let response: Response;
    try {
      response = await this.#fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${this.#token}`, 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ channel: context[2], thread_ts: context[3], text: message.text, mrkdwn: false, unfurl_links: false, unfurl_media: false }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch { throw new CommunicationsError('slack_delivery_uncertain', 'uncertain'); }
    if (!response.ok) throw new CommunicationsError('slack_http_error', response.status >= 500 ? 'uncertain' : 'rejected');
    let result: unknown;
    try { result = await response.json(); } catch { throw new CommunicationsError('slack_delivery_uncertain', 'uncertain'); }
    if (!record(result)) throw new CommunicationsError('slack_delivery_uncertain', 'uncertain');
    if (result.ok === false) throw new CommunicationsError('slack_api_rejected', 'rejected');
    if (result.ok !== true || result.channel !== context[2] || !nonempty(result.ts)) throw new CommunicationsError('slack_delivery_uncertain', 'uncertain');
    return { transport: 'slack', messageId: result.ts };
  }
}
