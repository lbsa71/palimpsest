import { GrowthCoordinator, parseGrowthReflection, type GrowthProposal } from './growth.ts';
import type { Provider } from './providers.ts';
import { Store, type Growth, type GrowthDimension } from './store.ts';

export interface GrowthSchedulerOptions {
  store: Store;
  provider: Provider;
  hasUserWork: () => boolean;
  schedulerId?: string;
  callsPerWindow?: number;
  windowMs?: number;
  intervalMs?: number;
  now?: () => number;
  memoryScope?: string;
  context?: () => string;
  maxOutputTokens?: number;
  proposalTimeoutMs?: number;
  onProposedChange?: (event: { proposalId: string; growth: Growth; proposedChange: GrowthProposal; signal: AbortSignal }) => void | Promise<void>;
  onError?: (code: 'scheduler_tick_failed') => void;
}

const dimensions: GrowthDimension[] = ['personality_judgment', 'interests_curiosity', 'code_quality', 'capability_potential'];
function integer(value: number, minimum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error('Scheduler budget/limit must be a finite integer in range');
  return value;
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Autonomous initiation inside a running service. The host retains authority;
 * SQLite owns budget truth; model-authored followups cannot allocate resources. */
export class GrowthScheduler {
  readonly #options: GrowthSchedulerOptions;
  readonly #schedulerId: string;
  readonly #calls: number;
  readonly #windowMs: number;
  readonly #intervalMs: number;
  #timer?: ReturnType<typeof setInterval>;
  #active?: Promise<Growth | null>;
  #controller?: AbortController;
  #stopped = false;

  constructor(options: GrowthSchedulerOptions) {
    this.#options = options;
    this.#schedulerId = options.schedulerId ?? 'standing-growth-v1';
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(this.#schedulerId)) throw new Error('Invalid scheduler identity');
    this.#calls = integer(options.callsPerWindow ?? 4, 0);
    this.#windowMs = integer(options.windowMs ?? 86_400_000, 1);
    this.#intervalMs = integer(options.intervalMs ?? 1_000, 1);
    if (this.#intervalMs > 2_147_483_647) throw new Error('Scheduler interval exceeds timer range');
    if (integer(options.proposalTimeoutMs ?? 30_000, 1) > 2_147_483_647) throw new Error('Proposal deadline exceeds timer range');
  }

  start(): void {
    if (this.#stopped) throw new Error('Growth scheduler is stopped');
    if (this.#timer) return;
    const run = () => { void this.tick().catch(() => {
      this.#stopped = true;
      if (this.#timer) clearInterval(this.#timer);
      this.#timer = undefined;
      try { this.#options.store.appendEvent('growth.scheduler.error', { code: 'scheduler_tick_failed' }); } catch { /* State may be unavailable. */ }
      try { this.#options.onError?.('scheduler_tick_failed'); } catch { /* Error callbacks cannot create an unhandled timer rejection. */ }
    }); };
    this.#timer = setInterval(run, this.#intervalMs);
    run();
  }

  async tick(): Promise<Growth | null> {
    if (this.#stopped) return null;
    if (this.#options.hasUserWork()) { this.#controller?.abort(); return null; }
    if (this.#active) return null;
    this.#controller = new AbortController();
    const pending = this.#run(this.#controller.signal);
    this.#active = pending;
    try { return await pending; }
    finally { this.#active = undefined; this.#controller = undefined; }
  }

  async #run(signal: AbortSignal): Promise<Growth | null> {
    const { store } = this.#options;
    const now = integer((this.#options.now ?? Date.now)(), 0);
    const startsAt = Math.floor(now / this.#windowMs) * this.#windowMs;
    const endsAt = integer(startsAt + this.#windowMs, 1);
    const window = store.openGrowthWindow({ id: `${this.#schedulerId}:${startsAt}`, schedulerId: this.#schedulerId, startsAt, endsAt, maxCalls: this.#calls });
    const coordinator = new GrowthCoordinator({
      store, provider: this.#options.provider, hasUserWork: this.#options.hasUserWork, budgetPerExperiment: 0,
      memoryScope: this.#options.memoryScope, context: this.#options.context, maxOutputTokens: this.#options.maxOutputTokens,
      claim: (id) => signal.aborted || this.#options.hasUserWork() ? undefined : store.claimGrowthInWindow(id, window.id, integer((this.#options.now ?? Date.now)(), 0)),
    });
    coordinator.seedAgenda();
    const all = store.listGrowth();
    const publishing = all.find((item) => item.state === 'paused' && record(item.checkpoint).phase === 'publish_result');
    let result: Growth | null = null;
    if (publishing) result = await coordinator.tick({ signal, growthId: publishing.id });
    else if (window.usedCalls < window.maxCalls) {
      const lastDimension = new Map<GrowthDimension, number>();
      const lastItem = new Map<string, number>();
      for (const event of store.listEvents()) {
        const data = record(event.payload);
        if (event.type.startsWith('growth.') && typeof data.growthId === 'string') lastItem.set(data.growthId, event.seq);
        if (event.type === 'growth.window.call_reserved' && data.schedulerId === this.#schedulerId && dimensions.includes(data.dimension as GrowthDimension)) lastDimension.set(data.dimension as GrowthDimension, event.seq);
      }
      const order = [...dimensions].sort((a, b) => (lastDimension.get(a) ?? 0) - (lastDimension.get(b) ?? 0));
      for (const dimension of order) {
        const inquiry = all.filter((item) => item.dimension === dimension && ['queued', 'paused'].includes(item.state))
          .sort((a, b) => (lastItem.get(a.id) ?? 0) - (lastItem.get(b.id) ?? 0))[0];
        if (!inquiry) continue;
        result = await coordinator.tick({ signal, growthId: inquiry.id });
        break;
      }
    }
    if (!signal.aborted && !this.#options.hasUserWork()) await this.#deliverProposal(signal);
    return result;
  }

  async #deliverProposal(signal: AbortSignal): Promise<void> {
    const callback = this.#options.onProposedChange;
    if (!callback) return;
    const { store } = this.#options;
    for (const growth of store.listGrowth()) {
      if (growth.state !== 'completed' || store.growthProposalDelivery(growth.id)) continue;
      const outcome = record(growth.outcome);
      let proposedChange: GrowthProposal | null | undefined;
      try { proposedChange = parseGrowthReflection(JSON.stringify(outcome.result)).proposedChange; }
      catch { continue; }
      if (!proposedChange || !store.reserveGrowthProposal(growth.id)) continue;
      const controller = new AbortController();
      let abort!: () => void;
      let timer!: ReturnType<typeof setTimeout>;
      const interrupted = new Promise<never>((_resolve, reject) => {
        abort = () => { controller.abort(); reject(new Error('Proposal dispatch interrupted')); };
        signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(abort, this.#options.proposalTimeoutMs ?? 30_000);
        if (signal.aborted) abort();
      });
      try {
        if (signal.aborted) throw new Error('Proposal dispatch interrupted');
        await Promise.race([Promise.resolve().then(() => callback({ proposalId: `growth:${growth.id}`, growth, proposedChange: proposedChange!, signal: controller.signal })), interrupted]);
        store.settleGrowthProposal(growth.id, 'delivered');
      } catch { store.settleGrowthProposal(growth.id, 'uncertain'); }
      finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
      // A callback may perform slow governed work; deliver at most one per tick.
      return;
    }
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    this.#controller?.abort();
    await this.#active;
  }
}
