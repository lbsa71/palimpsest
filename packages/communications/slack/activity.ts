import { identity, invariant } from '../../contracts/common.ts';
import type { Authority } from '../../contracts/common.ts';
import type { AuthorityFence } from '../../effects/index.ts';
import type { OperationalStore } from '../../storage/index.ts';
import { SlackError } from './client.ts';
import type { SlackApi } from './client.ts';

const messages = 'communications.slack.activity';
const deliveries = 'communications.slack.activity-deliveries';
interface Activity { runId: string; channel: string; timestamp: string; desired: boolean; applied: boolean | null; attempts: number; error?: string }
export interface SlackActivityOptions { store: OperationalStore; api: SlackApi; fence: AuthorityFence; authority: Authority }

/** Host receipt indicator: durable intent precedes IO; it never publishes model text. */
export class SlackActivity {
  private readonly options: SlackActivityOptions;
  private readonly running = new Map<string, Promise<void>>();
  private readonly abort = new AbortController();
  private started = false;
  private closed = false;
  private missingScope = false;
  constructor(options: SlackActivityOptions) { this.options = options; }

  observe(runId: string, channel: string, timestamp: string): void {
    invariant(runId.length > 0 && channel.length > 0 && /^\d+\.\d+$/.test(timestamp), 'Invalid Slack activity message');
    const key = identity({ channel, timestamp });
    if (this.options.store.get(messages, key)) return;
    this.options.store.put(messages, key, { runId, channel, timestamp, desired: true, applied: false, attempts: 0 }, null);
    this.queue(key);
  }

  /** Bind the messages known before dispatch, also retained for uncertain-send reconciliation. */
  capture(effectId: string, runId: string): void {
    if (this.options.store.get(deliveries, effectId)) return;
    const keys = this.options.store.list<Activity>(messages).filter(row => row.value.runId === runId && row.value.desired).map(row => row.key);
    this.options.store.put(deliveries, effectId, { keys }, null);
  }

  delivered(effectId: string): void {
    const batch = this.options.store.get<{ keys: string[] }>(deliveries, effectId);
    if (!batch) return;
    for (const key of batch.value.keys) {
      const row = this.options.store.get<Activity>(messages, key);
      if (!row || !row.value.desired) continue;
      this.options.store.put(messages, key, { ...row.value, desired: false, attempts: 0 }, row.revision);
      this.queue(key);
    }
  }

  start(): void {
    if (this.started || this.closed) return;
    this.started = true;
    // One scope probe per process allows a reauthorized bot to resume retained work.
    for (const row of this.options.store.list<Activity>(messages)) {
      if (row.value.error === 'missing_scope') this.options.store.put(messages, row.key, { ...row.value, attempts: 0 }, row.revision);
    }
    this.tick();
  }
  tick(): void {
    if (!this.started || this.closed || this.missingScope) return;
    for (const row of this.options.store.list<Activity>(messages)) this.queue(row.key);
  }
  diagnosis(): { missingScope: boolean; pending: number; failed: number } {
    const rows = this.options.store.list<Activity>(messages).map(row => row.value);
    return { missingScope: this.missingScope || rows.some(row => row.error === 'missing_scope'), pending: rows.filter(row => row.applied !== row.desired).length, failed: rows.filter(row => row.error !== undefined).length };
  }
  private queue(key: string): void {
    if (!this.started || this.closed || this.missingScope || this.running.has(key)) return;
    const row = this.options.store.get<Activity>(messages, key);
    if (!row || row.value.applied === row.value.desired || row.value.attempts >= 3) return;
    const task = this.perform(key).catch(() => { /* Activity failure never changes conversation delivery. */ }).finally(() => { this.running.delete(key); });
    this.running.set(key, task);
  }
  private async perform(key: string): Promise<void> {
    while (!this.closed && !this.missingScope) {
      const row = this.options.store.get<Activity>(messages, key);
      if (!row || row.value.applied === row.value.desired || row.value.attempts >= 3) return;
      const desired = row.value.desired;
      this.options.fence.assert(this.options.authority);
      this.abort.signal.throwIfAborted();
      this.options.store.put(messages, key, { ...row.value, applied: null, attempts: row.value.attempts + 1 }, row.revision);
      let error: string | undefined;
      try {
        await this.options.api.call(desired ? 'reactions.add' : 'reactions.remove', { channel: row.value.channel, name: 'eyes', timestamp: row.value.timestamp }, this.abort.signal);
      } catch (failure) {
        const code = failure instanceof SlackError ? failure.code : 'unknown_reaction_outcome';
        if (!(desired && code === 'already_reacted' || !desired && code === 'no_reaction')) error = code;
      }
      const current = this.options.store.get<Activity>(messages, key);
      if (!current) return;
      const { error: previousError, ...value } = current.value;
      this.options.store.put(messages, key, { ...value, ...(error ? { error } : {}), applied: error ? null : desired }, current.revision);
      if (error === 'missing_scope') this.missingScope = true;
      // Retry later through the host poll, bounded across restart by retained attempts.
      if (error) return;
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    this.abort.abort();
    await Promise.allSettled([...this.running.values()]);
  }
}
