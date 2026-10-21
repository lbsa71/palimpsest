import { invariant, nonempty } from '../../contracts/common.ts';
import type { Provenance } from '../../contracts/common.ts';
import type { SlackApi } from './client.ts';
import { slackAuthor } from './authorship.ts';
import type { SlackAuthor } from './authorship.ts';

export const SLACK_SEARCH_METHOD = 'assistant.search.context' as const;
export const SLACK_SEARCH_MAX_QUERY_CHARS = 500;
export const SLACK_SEARCH_MAX_RESULTS = 20;

/** Explicit environmental dependency: callers supply the provenance timestamp source. */
export type SlackSearchClock = () => string;

export interface SlackSearchContext {
  teamId: string;
  userId: string;
  channelId: string;
  actionToken: string;
  allowedChannelIds: readonly string[];
  botUserId?: string;
}

export interface SlackSearchRequest {
  query: string;
  maxResults?: number;
  signal?: AbortSignal;
}

export interface SlackSearchMessage {
  teamId: string;
  channelId: string;
  messageTs: string;
  content: string;
  permalink: string;
  provenance: Provenance;
  author: SlackAuthor;
}

export interface SlackSearchResult {
  messages: SlackSearchMessage[];
  nextCursor: string | null;
}

interface AssistantSearchResponse {
  results?: {
    messages?: unknown;
  };
  response_metadata?: {
    next_cursor?: unknown;
  };
}

interface RawSearchMessage {
  team_id?: unknown;
  channel_id?: unknown;
  message_ts?: unknown;
  content?: unknown;
  permalink?: unknown;
  user?: unknown;
  user_id?: unknown;
  bot_id?: unknown;
  subtype?: unknown;
}

function text(value: unknown, field: string): string {
  invariant(typeof value === 'string' && value.trim().length > 0, `Slack search result has invalid ${field}`);
  return value;
}

function validateContext(context: SlackSearchContext): void {
  nonempty(context.teamId, 'Slack search teamId');
  nonempty(context.userId, 'Slack search userId');
  nonempty(context.channelId, 'Slack search channelId');
  nonempty(context.actionToken, 'Slack search action token');
  invariant(Array.isArray(context.allowedChannelIds) && context.allowedChannelIds.length > 0, 'Slack search needs allowed public channels');
  for (const channelId of context.allowedChannelIds) nonempty(channelId, 'allowed Slack channel ID');
  invariant(new Set(context.allowedChannelIds).size === context.allowedChannelIds.length, 'duplicate allowed Slack channel ID');
}

function validateClock(clock: SlackSearchClock): void {
  invariant(typeof clock === 'function', 'Slack search clock must be a function');
}

function validateQuery(query: string): string {
  invariant(typeof query === 'string', 'Slack search query must be a string');
  const normalized = query.trim();
  invariant(normalized.length > 0, 'Slack search query must be nonempty');
  invariant(normalized.length <= SLACK_SEARCH_MAX_QUERY_CHARS, `Slack search query exceeds ${SLACK_SEARCH_MAX_QUERY_CHARS} characters`);
  return normalized;
}

function validateMaxResults(maxResults: number | undefined): number {
  const value = maxResults ?? 10;
  invariant(Number.isSafeInteger(value) && value > 0 && value <= SLACK_SEARCH_MAX_RESULTS, `Slack search result count must be 1..${SLACK_SEARCH_MAX_RESULTS}`);
  return value;
}

function projectMessage(raw: unknown, context: SlackSearchContext, provenance: Provenance): SlackSearchMessage | null {
  invariant(typeof raw === 'object' && raw !== null, 'Slack search result message must be an object');
  const candidate = raw as RawSearchMessage;
  const teamId = text(candidate.team_id, 'team_id');
  const channelId = text(candidate.channel_id, 'channel_id');
  const messageTs = text(candidate.message_ts, 'message_ts');
  const content = text(candidate.content, 'content');
  const permalink = text(candidate.permalink, 'permalink');
  if (teamId !== context.teamId) return null;
  if (!context.allowedChannelIds.includes(channelId)) return null;
  const user = typeof candidate.user_id === 'string' ? candidate.user_id : typeof candidate.user === 'string' ? candidate.user : undefined;
  const author=slackAuthor(teamId,context.botUserId,{...(user?{user}:{}),...(typeof candidate.bot_id==='string'?{bot_id:candidate.bot_id}:{}),...(typeof candidate.subtype==='string'?{subtype:candidate.subtype}:{})});
  return { teamId, channelId, messageTs, content, permalink, provenance, author };
}

/**
 * Public Slack-search adapter. Host context supplies authority; the model query
 * cannot widen team, channel or result access. Exactly one API call, no retry.
 */
export class SlackSearch {
  private readonly api: SlackApi;
  private readonly context: SlackSearchContext;
  private readonly provenance: Omit<Provenance, 'recordedAt'>;
  private readonly clock: SlackSearchClock;

  constructor(api: SlackApi, context: SlackSearchContext, provenance: Omit<Provenance, 'recordedAt'>, clock: SlackSearchClock) {
    validateContext(context);
    validateClock(clock);
    invariant(Array.isArray(provenance.sourceIds) && provenance.sourceIds.length > 0, 'Slack search provenance needs sources');
    for (const sourceId of provenance.sourceIds) nonempty(sourceId, 'Slack search provenance sourceId');
    nonempty(provenance.actorId, 'Slack search provenance actorId');
    invariant(['observed', 'interpreted', 'summarized', 'imported'].includes(provenance.derivation), 'invalid Slack search provenance derivation');
    this.api = api;
    this.context = { ...context, allowedChannelIds: [...context.allowedChannelIds] };
    this.provenance = { ...provenance, sourceIds: [...provenance.sourceIds] };
    this.clock = clock;
  }

  async search(request: SlackSearchRequest): Promise<SlackSearchResult> {
    const query = validateQuery(request.query);
    const limit = validateMaxResults(request.maxResults);
    // Recheck immediately before dispatch: construction-time context is not dispatch authority.
    validateContext(this.context);
    nonempty(this.context.actionToken, 'Slack search action token');
    request.signal?.throwIfAborted();

    let response: AssistantSearchResponse;
    try {
      response = await this.api.call<AssistantSearchResponse>(SLACK_SEARCH_METHOD, {
        action_token: this.context.actionToken,
        query,
        context_channel_id: this.context.channelId,
        channel_types: 'public_channel',
        content_types: 'messages',
        limit: String(limit),
      }, request.signal);
    } catch {
      // The injected API is untrusted on failure: every failure shape, including
      // AbortError and AggregateError, may carry the action token in its message,
      // fields, nested causes or serialized representation. Replace it wholesale.
      throw new Error('Slack search request failed');
    }

    request.signal?.throwIfAborted();
    invariant(typeof response === 'object' && response !== null, 'Slack search response must be an object');
    invariant(Array.isArray(response.results?.messages), 'Slack search response messages missing');
    const recordedAt = this.clock();
    nonempty(recordedAt, 'Slack search clock recordedAt');
    invariant(Number.isFinite(Date.parse(recordedAt)), 'Slack search clock recordedAt must be a timestamp');
    const provenance: Provenance = { ...this.provenance, sourceIds: [...this.provenance.sourceIds], recordedAt };
    const messages: SlackSearchMessage[] = [];
    for (const raw of response.results.messages) {
      if (messages.length >= limit) break;
      const projected = projectMessage(raw, this.context, provenance);
      if (projected) messages.push(projected);
    }
    const nextCursor = response.response_metadata?.next_cursor;
    invariant(nextCursor === undefined || nextCursor === null || typeof nextCursor === 'string', 'Slack search next_cursor must be a string');
    const normalizedCursor = nextCursor?.trim() ?? '';
    return { messages, nextCursor: normalizedCursor.length > 0 ? normalizedCursor : null };
  }
}
