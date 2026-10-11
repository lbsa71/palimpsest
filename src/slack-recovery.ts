import { parseSlackPayload } from './communications.ts';
import type { InboundMessage, SlackAllowlistOptions } from './communications.ts';
import { SlackHistoryClient, SlackHistoryError } from './slack-history.ts';
import type { Store, SlackRecoveryCheckpoint } from './store.ts';

export interface SlackRecoveryOptions extends SlackAllowlistOptions {
  store: Store;
  client: SlackHistoryClient;
  /** Resolve only after the ordinary host has durably admitted this message. */
  submit(input: InboundMessage): Promise<unknown>;
  intervalMs?: number;
  maxPagesPerPass?: number;
  submitTimeoutMs?: number;
  now?: () => number;
}

const TIMESTAMP = /^\d{1,12}\.\d{1,6}$/;
const OVERLAP_US = 60_000_000n;
function micros(value: string): bigint {
  if (!TIMESTAMP.test(value)) throw new SlackHistoryError('protocol');
  const [seconds, fraction] = value.split('.');
  return BigInt(seconds!) * 1_000_000n + BigInt(fraction!.padEnd(6, '0'));
}
function timestamp(value: bigint): string { return `${value / 1_000_000n}.${String(value % 1_000_000n).padStart(6, '0')}`; }
function limit(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new SlackHistoryError('configuration');
  return result;
}

/** History reconciliation owns only read/acceptance progress, never task execution
 * or outgoing-effect replay. A live message cannot move its independent cursor. */
export class SlackRecovery {
  readonly #options: SlackRecoveryOptions;
  readonly #controller = new AbortController();
  readonly #interval: number;
  readonly #pageBudget: number;
  readonly #submitTimeout: number;
  readonly #now: () => number;
  #identity: { teamId: string; userId: string } | undefined;
  #running: Promise<void> | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #started = false;
  #error: string | undefined;

  constructor(options: SlackRecoveryOptions) {
    this.#interval = limit(options.intervalMs, 60_000, 1_000, 3_600_000);
    this.#pageBudget = limit(options.maxPagesPerPass, 10, 1, 100);
    this.#submitTimeout = limit(options.submitTimeoutMs, 10_000, 1, 60_000);
    this.#now = options.now ?? Date.now;
    this.#options = { ...options, allowedTeamIds: [...options.allowedTeamIds],
      ...(options.allowedChannelIds ? { allowedChannelIds: [...options.allowedChannelIds] } : {}) };
  }

  status(): { state: 'idle' | 'running' | 'degraded' | 'stopped'; error: string | null; threads: number; pending: number; legacyFloors: number; failures: { conversationId: string; error: string; retryAt: number | null }[] } {
    const targets = this.#targets();
    const checkpoints = targets.map(target => this.#options.store.slackRecoveryCheckpoint(target.conversationId));
    const failures = checkpoints.filter((item): item is SlackRecoveryCheckpoint => !!item?.error)
      .map(item => ({ conversationId: item.conversationId, error: item.error!, retryAt: item.retryAt ?? null }));
    return { state: this.#controller.signal.aborted ? 'stopped' : this.#running ? 'running' : this.#error || failures.length ? 'degraded' : 'idle',
      error: this.#error ?? null, threads: targets.length,
      pending: checkpoints.filter(item => !item || item.latest !== undefined || item.lastCompletedAt === undefined).length,
      legacyFloors: targets.filter(target => target.bootstrap === 'legacy').length, failures };
  }

  start(): void {
    if (this.#started || this.#controller.signal.aborted) throw new SlackHistoryError('configuration');
    this.#started = true; this.wake();
  }

  /** Reconnects request an early pass, independently of socket acknowledgement. */
  wake(): void {
    if (!this.#started || this.#controller.signal.aborted || this.#running) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => { this.#timer = undefined; void this.tick(); }, 0);
  }

  tick(): Promise<void> {
    if (this.#controller.signal.aborted) return Promise.resolve();
    if (this.#running) return this.#running;
    const work = this.#run().catch(() => { if (!this.#controller.signal.aborted) this.#error = 'unavailable'; });
    this.#running = work;
    void work.finally(() => {
      if (this.#running === work) this.#running = undefined;
      if (this.#started && !this.#controller.signal.aborted) {
        if (this.#timer) clearTimeout(this.#timer);
        this.#timer = setTimeout(() => { this.#timer = undefined; void this.tick(); }, this.#interval);
      }
    });
    return work;
  }

  async close(): Promise<void> {
    this.#controller.abort();
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    await this.#running;
  }

  #targets() {
    return this.#options.store.slackRecoveryThreads().filter(target => {
      const [, team, channel] = target.conversationId.split(':');
      return this.#options.allowedTeamIds.includes(team!)
        && (this.#options.allowedChannelIds === undefined || this.#options.allowedChannelIds.includes(channel!));
    });
  }

  #check(): void { if (this.#controller.signal.aborted) throw new SlackHistoryError('cancelled'); }

  async #run(): Promise<void> {
    const targets = this.#targets();
    if (!targets.length) { this.#error = undefined; return; }
    if (targets.some(target => {
      const checkpoint = this.#options.store.slackRecoveryCheckpoint(target.conversationId);
      return checkpoint?.error === 'auth_ratelimited' && (checkpoint.retryAt ?? 0) > this.#now();
    })) { this.#error = 'ratelimited'; return; }
    try {
      this.#identity ??= await this.#options.client.authenticate(this.#controller.signal);
      this.#check();
      if (!this.#options.allowedTeamIds.includes(this.#identity.teamId)) { this.#error = 'unauthorized'; return; }
    } catch (error) {
      if (!this.#controller.signal.aborted) {
        this.#error = error instanceof SlackHistoryError ? error.code : 'unavailable';
        if (error instanceof SlackHistoryError && error.code === 'ratelimited') {
          for (const target of targets) {
            const checkpoint = this.#options.store.slackRecoveryCheckpoint(target.conversationId) ?? { ...target };
            this.#options.store.saveSlackRecoveryCheckpoint({ ...checkpoint, error: 'auth_ratelimited', lastAttemptAt: this.#now(),
              retryAt: Math.max(checkpoint.retryAt ?? 0, this.#now() + (error.retryAfterMs ?? this.#interval)) });
          }
        }
      }
      return;
    }
    this.#error = undefined;
    const authorized = targets.filter(target => target.conversationId.split(':')[1] === this.#identity!.teamId);
    const checkpoints = authorized.map(target => this.#options.store.slackRecoveryCheckpoint(target.conversationId));
    // Slack limits this method/workspace, not each thread. Retain the backoff in
    // the failed thread's durable checkpoint so restarting cannot evade it.
    if (checkpoints.some(item => item?.error === 'ratelimited' && (item.retryAt ?? 0) > this.#now())) return;
    const queue = authorized.filter(target => (this.#options.store.slackRecoveryCheckpoint(target.conversationId)?.retryAt ?? 0) <= this.#now())
      .sort((left, right) => (this.#options.store.slackRecoveryCheckpoint(left.conversationId)?.lastAttemptAt ?? 0)
        - (this.#options.store.slackRecoveryCheckpoint(right.conversationId)?.lastAttemptAt ?? 0) || left.conversationId.localeCompare(right.conversationId));
    for (let pages = 0; pages < this.#pageBudget && queue.length; pages++) {
      this.#check();
      const target = queue.shift()!;
      const more = await this.#page(target);
      if (this.#controller.signal.aborted) return;
      const checkpoint = this.#options.store.slackRecoveryCheckpoint(target.conversationId);
      if (checkpoint?.error === 'ratelimited') return;
      if (more) queue.push(target);
    }
  }

  async #page(target: { conversationId: string; oldest: string; bootstrap: 'canonical' | 'legacy' }): Promise<boolean> {
    const { store, client } = this.#options;
    const [, teamId, channelId, threadTs] = target.conversationId.split(':');
    let checkpoint = store.slackRecoveryCheckpoint(target.conversationId) ?? { ...target };
    if (checkpoint.latest === undefined) {
      // Keep a small overlap behind a completed scan and a two-second visibility
      // margin ahead. Never cross the original admission/migration floor.
      const previous = micros(checkpoint.oldest);
      const floor = micros(target.oldest);
      const lower = checkpoint.lastCompletedAt === undefined ? previous : previous - OVERLAP_US > floor ? previous - OVERLAP_US : floor;
      const upper = BigInt(Math.max(0, Math.floor(this.#now()) - 2_000)) * 1_000n;
      if (upper <= lower) return false;
      checkpoint = { ...checkpoint, oldest: timestamp(lower), scanOldest: timestamp(lower), latest: timestamp(upper), cursor: undefined };
    }
    checkpoint = { ...checkpoint, lastAttemptAt: this.#now(), error: undefined, retryAt: undefined };
    this.#check(); store.saveSlackRecoveryCheckpoint(checkpoint);
    try {
      const page = await client.replies({ channelId: channelId!, threadTs: threadTs!, oldest: checkpoint.scanOldest ?? checkpoint.oldest,
        latest: checkpoint.latest!, ...(checkpoint.cursor ? { cursor: checkpoint.cursor } : {}) }, this.#controller.signal);
      this.#check();
      const lower = micros(checkpoint.oldest), upper = micros(checkpoint.latest!);
      let previous = -1n;
      const messages: Record<string, unknown>[] = [];
      // Validate the whole page before committing any of it. Slack may repeat
      // the parent outside the requested time range, but no other thread.
      for (const message of page.messages) {
        if (typeof message.ts !== 'string') throw new SlackHistoryError('protocol');
        const at = micros(message.ts);
        if (at < previous || at > upper) throw new SlackHistoryError('protocol');
        previous = at;
        if (message.ts !== threadTs && message.thread_ts !== threadTs) throw new SlackHistoryError('protocol');
        if (message.thread_ts !== undefined && message.thread_ts !== threadTs) throw new SlackHistoryError('protocol');
        if (message.channel !== undefined && message.channel !== channelId) throw new SlackHistoryError('protocol');
        if (at < lower) {
          if (message.ts !== threadTs) throw new SlackHistoryError('protocol');
          continue;
        }
        if (message.type !== 'message'
          || (message.bot_id !== undefined && (typeof message.bot_id !== 'string' || !/^B[A-Za-z0-9]+$/.test(message.bot_id)))
          || (message.subtype !== undefined && (typeof message.subtype !== 'string' || !message.subtype))) throw new SlackHistoryError('protocol');
        const accepted = store.hasSlackEvent(`slack-message:${teamId}:${channelId}:${message.ts}`);
        if (!accepted && message.bot_id === undefined && message.subtype === undefined
          && (typeof message.user !== 'string' || !/^[UW][A-Za-z0-9]+$/.test(message.user)
            || typeof message.text !== 'string' || !message.text.trim() || message.text.length > 60_000)) throw new SlackHistoryError('protocol');
        messages.push(message);
      }
      if (page.hasMore && (!page.nextCursor || page.nextCursor === checkpoint.cursor || previous <= lower)) throw new SlackHistoryError('protocol');
      for (const message of messages) {
        this.#check();
        const id = `slack-message:${teamId}:${channelId}:${String(message.ts)}`;
        // An edit to an already accepted message is not a new task, and must
        // not overwrite its author/body or replay an uncertain outgoing effect.
        if (store.hasSlackEvent(id) || message.user === this.#identity!.userId) continue;
        const parsed = parseSlackPayload({ type: 'event_callback', team_id: teamId, event_id: id,
          event: { type: 'message', channel: channelId, channel_type: channelId!.startsWith('G') ? 'group' : 'channel',
            user: message.user, text: message.text, ts: message.ts, thread_ts: threadTs, bot_id: message.bot_id, subtype: message.subtype } },
        { ...this.#options, hasJoinedThread: id => store.hasSlackThread(id), hasAcceptedEvent: id => store.hasSlackEvent(id) });
        if (parsed.kind === 'message') await this.#submit(parsed.message);
      }
      this.#check();
      if (page.hasMore) {
        store.saveSlackRecoveryCheckpoint({ ...checkpoint, oldest: timestamp(previous), cursor: page.nextCursor });
        return true;
      }
      store.saveSlackRecoveryCheckpoint({ ...checkpoint, oldest: checkpoint.latest!, latest: undefined, scanOldest: undefined,
        cursor: undefined, lastCompletedAt: this.#now() });
    } catch (error) {
      if (this.#controller.signal.aborted) return false;
      const code = error instanceof SlackHistoryError ? error.code : 'acceptance_failed';
      if (code === 'invalid_auth' || code === 'token_revoked') this.#identity = undefined;
      store.saveSlackRecoveryCheckpoint({ ...checkpoint, error: code,
        retryAt: this.#now() + (error instanceof SlackHistoryError && error.retryAfterMs ? error.retryAfterMs : this.#interval),
        ...(code === 'invalid_cursor' ? { cursor: undefined, scanOldest: checkpoint.oldest } : {}) });
    }
    return false;
  }

  async #submit(input: InboundMessage): Promise<void> {
    this.#check();
    const signal = this.#controller.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort!: () => void;
    try {
      await Promise.race([this.#options.submit(input), new Promise<never>((_, reject) => {
        abort = () => reject(new SlackHistoryError('cancelled'));
        signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => reject(new SlackHistoryError('timeout')), this.#submitTimeout);
      })]);
      this.#check();
    } finally {
      if (timer) clearTimeout(timer);
      if (abort) signal.removeEventListener('abort', abort);
    }
  }
}
