export type SlackHistoryErrorCode = 'configuration' | 'cancelled' | 'timeout' | 'unavailable' | 'protocol' | 'limit'
  | 'missing_scope' | 'not_in_channel' | 'channel_not_found' | 'thread_not_found' | 'invalid_cursor'
  | 'token_revoked' | 'invalid_auth' | 'ratelimited';

/** Operational diagnostics contain only local codes, never Slack response data. */
export class SlackHistoryError extends Error {
  readonly code: SlackHistoryErrorCode;
  readonly retryAfterMs: number | undefined;
  constructor(code: SlackHistoryErrorCode, retryAfterMs?: number) {
    super(`slack_history_${code}`); this.name = 'SlackHistoryError';
    this.code = code; this.retryAfterMs = retryAfterMs;
  }
}

export interface SlackHistoryOptions {
  token: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}
export interface SlackRepliesRequest {
  channelId: string;
  threadTs: string;
  oldest: string;
  latest: string;
  cursor?: string;
}
export interface SlackRepliesPage {
  messages: Record<string, unknown>[];
  nextCursor?: string;
  hasMore: boolean;
}

const MAX_BYTES = 1_048_576;
const safeApiErrors = new Set<SlackHistoryErrorCode>(['missing_scope', 'not_in_channel', 'channel_not_found',
  'thread_not_found', 'invalid_cursor', 'token_revoked', 'invalid_auth', 'ratelimited']);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const boundedText = (value: unknown, maximum: number): value is string => typeof value === 'string'
  && value.length > 0 && value.length <= maximum && !/[\u0000-\u0020\u007f]/u.test(value);
const timestamp = (value: unknown): value is string => typeof value === 'string' && /^\d{1,16}(?:\.\d{1,6})?$/.test(value);
function retryAfter(value: string | null): number {
  if (!value || !/^\d+$/.test(value)) return 60_000;
  return Math.max(1000, Math.min(2_147_483_647, Number(value) * 1000));
}
function cancelBody(response: Response): void { void response.body?.cancel().catch(() => {}); }

/** The deadline bounds both transport and body consumption, including injected
 * transports that ignore abort. Late responses are discarded by the operation. */
async function bounded<T>(operation: (signal: AbortSignal) => Promise<T>, parent: AbortSignal, timeoutMs: number): Promise<T> {
  if (parent.aborted) throw new SlackHistoryError('cancelled');
  const controller = new AbortController();
  let reject!: (error: SlackHistoryError) => void;
  let timedOut = false;
  const interrupted = new Promise<never>((_resolve, rejectPromise) => { reject = rejectPromise; });
  const abort = () => { reject(new SlackHistoryError('cancelled')); controller.abort(); };
  parent.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; reject(new SlackHistoryError('timeout')); controller.abort(); }, timeoutMs);
  try {
    if (parent.aborted) abort();
    return await Promise.race([operation(controller.signal), interrupted]);
  } catch (error) {
    if (parent.aborted) throw new SlackHistoryError('cancelled');
    if (timedOut) throw new SlackHistoryError('timeout');
    if (error instanceof SlackHistoryError) throw error;
    throw new SlackHistoryError('unavailable');
  } finally {
    clearTimeout(timer); parent.removeEventListener('abort', abort); controller.abort();
  }
}

async function responseJson(response: Response, signal: AbortSignal): Promise<Record<string, unknown>> {
  if (!response.body) throw new SlackHistoryError('protocol');
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) {
    cancelBody(response); throw new SlackHistoryError(/^\d+$/.test(length) ? 'limit' : 'protocol');
  }
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      if (signal.aborted) throw new SlackHistoryError('cancelled');
      const result = await reader.read();
      if (signal.aborted) throw new SlackHistoryError('cancelled');
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > MAX_BYTES) throw new SlackHistoryError('limit');
      chunks.push(result.value);
    }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw new SlackHistoryError('protocol'); }
    if (!object(value) || typeof value.ok !== 'boolean') throw new SlackHistoryError('protocol');
    return value;
  } finally {
    signal.removeEventListener('abort', abort);
    // An uncooperative cancel hook must not defeat the request deadline.
    void reader.cancel().catch(() => {}); reader.releaseLock();
  }
}

/** Read-only fixed Slack endpoints. History is returned as untrusted records;
 * the recovery coordinator owns thread/author admission and durable progress. */
export class SlackHistoryClient {
  readonly #token: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMs: number;
  constructor(options: SlackHistoryOptions) {
    const timeout = options.timeoutMs ?? 10_000;
    if (!boundedText(options.token, 4096) || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000) {
      throw new SlackHistoryError('configuration');
    }
    this.#token = options.token; this.#fetch = options.fetch ?? globalThis.fetch; this.#timeoutMs = timeout;
  }

  async authenticate(signal: AbortSignal): Promise<{ teamId: string; userId: string }> {
    const body = await this.#request('auth.test', {}, signal);
    if (typeof body.team_id !== 'string' || !/^T[A-Z0-9]{1,127}$/.test(body.team_id)
      || typeof body.user_id !== 'string' || !/^[UW][A-Z0-9]{1,127}$/.test(body.user_id)
      || typeof body.bot_id !== 'string' || !/^B[A-Z0-9]{1,127}$/.test(body.bot_id)) throw new SlackHistoryError('protocol');
    return { teamId: body.team_id, userId: body.user_id };
  }

  async replies(options: SlackRepliesRequest, signal: AbortSignal): Promise<SlackRepliesPage> {
    if (typeof options.channelId !== 'string' || !/^[CG][A-Z0-9]{1,127}$/.test(options.channelId)
      || !timestamp(options.threadTs) || !timestamp(options.oldest) || !timestamp(options.latest)
      || (options.cursor !== undefined && !boundedText(options.cursor, 4096))) throw new SlackHistoryError('configuration');
    const body = await this.#request('conversations.replies', { channel: options.channelId, ts: options.threadTs,
      oldest: options.oldest, latest: options.latest, inclusive: 'false', limit: '100',
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }) }, signal);
    if (!Array.isArray(body.messages) || !body.messages.every(object)
      || (body.has_more !== undefined && typeof body.has_more !== 'boolean')
      || (body.response_metadata !== undefined && !object(body.response_metadata))) throw new SlackHistoryError('protocol');
    const cursor = object(body.response_metadata) ? body.response_metadata.next_cursor : undefined;
    if (cursor !== undefined && cursor !== '' && !boundedText(cursor, 4096)) throw new SlackHistoryError('protocol');
    const nextCursor = typeof cursor === 'string' && cursor.length ? cursor : undefined;
    if (body.has_more === true && !nextCursor) throw new SlackHistoryError('protocol');
    return { messages: body.messages, ...(nextCursor ? { nextCursor } : {}), hasMore: body.has_more === true || nextCursor !== undefined };
  }

  #request(method: 'auth.test' | 'conversations.replies', parameters: Record<string, string>, signal: AbortSignal): Promise<Record<string, unknown>> {
    const url = new URL(`https://slack.com/api/${method}`);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    return bounded(async requestSignal => {
      if (requestSignal.aborted) throw new SlackHistoryError('cancelled');
      const response = await this.#fetch(url, { method: 'GET', redirect: 'error', signal: requestSignal,
        headers: { authorization: `Bearer ${this.#token}` } });
      if (requestSignal.aborted) { cancelBody(response); throw new SlackHistoryError('cancelled'); }
      if (response.redirected || (response.url && response.url !== url.href)) { cancelBody(response); throw new SlackHistoryError('protocol'); }
      if (response.status === 429) { cancelBody(response); throw new SlackHistoryError('ratelimited', retryAfter(response.headers.get('retry-after'))); }
      if (!response.ok) { cancelBody(response); throw new SlackHistoryError('unavailable'); }
      const body = await responseJson(response, requestSignal);
      if (!body.ok) {
        const code = typeof body.error === 'string' && safeApiErrors.has(body.error as SlackHistoryErrorCode)
          ? body.error as SlackHistoryErrorCode : 'unavailable';
        throw new SlackHistoryError(code, code === 'ratelimited' ? retryAfter(response.headers.get('retry-after')) : undefined);
      }
      return body;
    }, signal, this.#timeoutMs);
  }
}
