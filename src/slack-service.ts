import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { CommunicationsError, parseSlackEvent } from './communications.ts';
import type { InboundMessage, SlackAllowlistOptions } from './communications.ts';

export interface SlackIngressApi {
  /** Resolve only after durable acceptance; execution and outbound replies are separate. */
  submit(input: InboundMessage): Promise<unknown>;
}
export interface SlackServerOptions extends SlackAllowlistOptions {
  signingSecret: string;
  host?: string;
  port?: number;
  ackTimeoutMs?: number;
}
export interface SlackServer { server: Server; url: string; close(): Promise<void> }

class IngressError extends Error {
  readonly status: number;
  constructor(status: number, code: string) { super(code); this.status = status; }
}

function reply(response: ServerResponse, status: number, body: unknown): void {
  if (response.destroyed || response.writableEnded) return;
  const serialized = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(serialized);
}

function readRawBody(request: IncomingMessage, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0; let settled = false;
    const timer = setTimeout(() => finish(new IngressError(408, 'body_timeout')), timeoutMs);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      request.off('data', receive); request.off('end', complete); request.off('error', invalid); request.off('aborted', invalid);
      if (error) { request.once('error', () => {}); request.resume(); reject(error); }
      else resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const receive = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 65_536) finish(new IngressError(413, 'body_too_large'));
      else chunks.push(chunk);
    };
    const complete = () => finish();
    const invalid = () => finish(new IngressError(400, 'invalid_body'));
    request.on('data', receive); request.once('end', complete); request.once('error', invalid); request.once('aborted', invalid);
  });
}

async function durableSubmit(api: SlackIngressApi, message: InboundMessage, remainingMs: number): Promise<void> {
  if (remainingMs < 1) throw new IngressError(503, 'acceptance_unconfirmed');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      api.submit(message),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new IngressError(503, 'acceptance_unconfirmed')), remainingMs); }),
    ]);
  } catch { throw new IngressError(503, 'acceptance_unconfirmed'); }
  finally { if (timer) clearTimeout(timer); }
}

/** Signed loopback HTTP adapter; durable event deduplication stays in shared ingress. */
export async function createSlackServer(api: SlackIngressApi, options: SlackServerOptions): Promise<SlackServer> {
  const host = options.host ?? '127.0.0.1';
  if (!['127.0.0.1', '::1'].includes(host)) throw new Error('Slack ingress requires a literal loopback address');
  if (typeof options.signingSecret !== 'string' || !options.signingSecret.trim()) throw new Error('Slack signing secret is required');
  for (const list of [options.allowedTeamIds, options.allowedUserIds, options.allowedChannelIds ?? []]) {
    if (!Array.isArray(list) || list.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9]+$/.test(id))) throw new Error('Slack allowlists must contain explicit IDs');
  }
  const ackTimeoutMs = options.ackTimeoutMs ?? 2500;
  if (!Number.isInteger(ackTimeoutMs) || ackTimeoutMs < 1 || ackTimeoutMs > 3000) throw new Error('Slack acknowledgement timeout must be between 1 and 3000 ms');
  const port = options.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid Slack ingress port');
  const parserOptions = { signingSecret: options.signingSecret, allowedTeamIds: [...options.allowedTeamIds], allowedUserIds: [...options.allowedUserIds], hasJoinedThread: options.hasJoinedThread, hasAcceptedEvent: options.hasAcceptedEvent, ...(options.allowedChannelIds ? { allowedChannelIds: [...options.allowedChannelIds] } : {}) };
  const server = createServer(async (request, response) => {
    const started = performance.now();
    try {
      if (request.method !== 'POST' || request.url !== '/slack/events') throw new IngressError(404, 'route_not_found');
      if (request.headers.origin !== undefined) throw new IngressError(403, 'browser_origin_not_allowed');
      if (request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new IngressError(415, 'json_required');
      const signature = request.headers['x-slack-signature'];
      const timestamp = request.headers['x-slack-request-timestamp'];
      if (typeof signature !== 'string' || typeof timestamp !== 'string') throw new IngressError(401, 'unauthorized');
      const raw = await readRawBody(request, ackTimeoutMs);
      let parsed;
      try { parsed = parseSlackEvent(raw, { ...parserOptions, signature, timestamp }); }
      catch (error) {
        if (error instanceof CommunicationsError && ['invalid_slack_signature', 'expired_slack_request'].includes(error.message)) throw new IngressError(401, 'unauthorized');
        throw new IngressError(400, 'invalid_slack_event');
      }
      if (parsed.kind === 'challenge') { reply(response, 200, { challenge: parsed.challenge }); return; }
      if (parsed.kind === 'message') await durableSubmit(api, parsed.message, Math.floor(ackTimeoutMs - (performance.now() - started)));
      reply(response, 200, { ok: true });
    } catch (error) {
      const known = error instanceof IngressError;
      reply(response, known ? error.status : 503, { error: known ? error.message : 'acceptance_unconfirmed' });
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.setTimeout(5000, (socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Slack ingress address unavailable');
  return {
    server, url: `http://${host === '::1' ? '[::1]' : host}:${address.port}/slack/events`,
    close: () => new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeIdleConnections(); }),
  };
}
