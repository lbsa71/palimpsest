import { digestJson } from './candidates.ts';
import type { CustodianState } from './custodian.ts';
import type { EvolutionReport, EvolutionRequest } from './evolution.ts';
import { parseGrowthReflection } from './growth.ts';
import type { GrowthProposal } from './growth.ts';
import { Store } from './store.ts';
import type { Json } from './store.ts';

export interface EvolutionQueueItem {
  id: string; growthId: string; proposalDigest: string;
  state: 'queued' | 'running' | 'probation' | 'finished';
  result?: { status: EvolutionReport['status']; reason: string; calls: number };
}
export interface EvolutionSchedulerOptions {
  store: Store;
  hasUserWork(): boolean;
  phase(): CustodianState['phase'];
  run(request: EvolutionRequest): Promise<EvolutionReport>;
  /** Claim starts only after current host maintenance has settled. */
  beforeRun?(): Promise<unknown>;
  callsPerDay?: number;
  interactiveCallsPerDay?: number;
  planCallsPerDay?: number;
  planCadence?: 'daily' | 'hourly';
  planCallsPerHour?: number;
  authorizeProposal?: (growthId: string) => boolean;
  /** Trusted admission keeps a new attempt from consuming a partial allocation. */
  minimumCallsPerAttempt?: number;
  intervalMs?: number;
  attemptTimeoutMs?: number;
  now?: () => number;
  onError?(code: 'evolution_scheduler_failed'): void;
}
const DAY = 86_400_000;
const HOUR = 3_600_000;
const plain = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const json = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;
function integer(value: number, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error('Evolution allocation/limit must be a finite integer in range');
  return value;
}

/** Trusted single-coordinator queue. The caller holds the external coordinator
 * lock; synchronous journal claim/debit operations cannot interleave in this owner.
 * Construction never recovers or interrupts another execution owner. */
export class EvolutionScheduler {
  readonly #options: EvolutionSchedulerOptions;
  readonly #calls: number;
  readonly #interactiveCalls: number;
  readonly #planCalls: number;
  readonly #planCallsPerHour: number;
  readonly #planCadence: 'daily' | 'hourly';
  readonly #interval: number;
  readonly #timeout: number;
  #active: Promise<EvolutionQueueItem | null> | undefined;
  #controller: AbortController | undefined;
  #current: { item: EvolutionQueueItem; recovery: boolean; calls: number; interactive: boolean; plan:boolean } | undefined;
  #timer: ReturnType<typeof setInterval> | undefined;
  #stopped = false;

  constructor(options: EvolutionSchedulerOptions) {
    this.#options = options;
    this.#calls = integer(options.callsPerDay ?? 8);
    this.#interactiveCalls = integer(options.interactiveCallsPerDay ?? 8);
    this.#planCalls = integer(options.planCallsPerDay ?? 0);
    this.#planCallsPerHour = integer(options.planCallsPerHour ?? 8);
    if (options.planCadence !== undefined && !['daily', 'hourly'].includes(options.planCadence)) throw new Error('Invalid plan evolution cadence');
    this.#planCadence = options.planCadence ?? 'daily';
    this.#interval = integer(options.intervalMs ?? 1000, 1, 2_147_483_647);
    this.#timeout = integer(options.attemptTimeoutMs ?? 20 * 60_000, 1, 2_147_483_647);
  }

  get busy(): boolean { return this.#active !== undefined; }

  items(): EvolutionQueueItem[] {
    const items = new Map<string, EvolutionQueueItem>();
    for (const event of this.#options.store.listEvents()) {
      const data = plain(event.payload); const id = data.id;
      if (typeof id !== 'string') continue;
      if (event.type === 'evolution.queue.enqueued') items.set(id, { id, growthId: String(data.growthId), proposalDigest: String(data.proposalDigest), state: 'queued' });
      const item = items.get(id); if (!item || item.state === 'finished') continue;
      if (event.type === 'evolution.queue.claimed') item.state = 'running';
      else if (event.type === 'evolution.queue.observed') {
        item.result = data.result as EvolutionQueueItem['result']; item.state = item.result?.status === 'probation' ? 'probation' : 'finished';
      }
    }
    return [...items.values()];
  }

  #proposal(growthId: string): GrowthProposal {
    const growth = this.#options.store.growth(growthId);
    if (!growth || growth.state !== 'completed') throw new Error('Evolution requires an exact recorded completed proposal');
    const proposal = parseGrowthReflection(JSON.stringify(plain(growth.outcome).result)).proposedChange;
    if (!proposal) throw new Error('Evolution requires an exact recorded completed proposal');
    return proposal;
  }

  enqueue(growthId: string, proposal: GrowthProposal): EvolutionQueueItem {
    if (digestJson(this.#proposal(growthId)) !== digestJson(proposal)) throw new Error('Evolution requires an exact recorded completed proposal');
    const id = `${this.#options.store.growth(growthId)?.sourceTaskId ? 'conversation' : 'autonomous'}:${digestJson({ growthId })}`;
    const previous = this.items().find(item => item.id === id);
    if (previous) {
      if (previous.proposalDigest !== digestJson(proposal)) throw new Error('Evolution queue identity conflict');
      return previous;
    }
    const item: EvolutionQueueItem = { id, growthId, proposalDigest: digestJson(proposal), state: 'queued' };
    this.#options.store.appendEvent('evolution.queue.enqueued', json(item));
    return item;
  }

  /** A crashed proposal callback can be reconciled because enqueue is a local,
   * observable operation keyed to the immutable completed growth outcome. */
  reconcile(): void {
    for (const growth of this.#options.store.listGrowth()) {
      if (growth.state !== 'completed') continue;
      let proposal: GrowthProposal;
      try { proposal = this.#proposal(growth.id); } catch { continue; }
      this.enqueue(growth.id, proposal);
      const delivery = this.#options.store.growthProposalDelivery(growth.id);
      if (delivery && delivery.state !== 'delivered') this.#options.store.settleGrowthProposal(growth.id, 'delivered');
    }
  }

  start(): void {
    if (this.#stopped) throw new Error('Evolution scheduler is stopped');
    if (this.#timer) return;
    this.reconcile();
    const run = () => { void this.tick().catch(() => {
      this.#stopped = true; if (this.#timer) clearInterval(this.#timer); this.#timer = undefined;
      try { this.#options.store.appendEvent('evolution.scheduler.error', { code: 'evolution_scheduler_failed' }); } catch { /* Store may be unavailable. */ }
      try { this.#options.onError?.('evolution_scheduler_failed'); } catch { /* No unhandled timer rejection. */ }
    }); };
    this.#timer = setInterval(run, this.#interval); run();
  }

  /** Before fencing, user arrival/timeout/shutdown cancels cognition. Once fenced,
   * the custodian's mechanical completion must finish instead of being abandoned. */
  interrupt(backgroundOnly = false): void {
    if (backgroundOnly && this.#current?.interactive) return;
    if (['normal', 'evaluation', 'empty'].includes(this.#options.phase())) this.#controller?.abort();
  }

  cancelTask(taskId: string): boolean {
    const item = this.items().find(value => value.state !== 'finished' && this.#options.store.growth(value.growthId)?.sourceTaskId === taskId);
    const growth = this.#options.store.growth(`conversation:${taskId}`);
    if (!growth || (this.items().some(value => value.growthId === growth.id) && !item)) return false;
    if (!this.#options.store.listEvents().some(event => event.type === 'conversation.proposal.cancelled' && event.taskId === taskId))
      this.#options.store.appendEvent('conversation.proposal.cancelled', { growthId: growth.id }, taskId);
    if (this.#current?.item.id === item?.id) this.interrupt();
    return true;
  }

  async stop(): Promise<void> {
    this.#stopped = true; if (this.#timer) clearInterval(this.#timer); this.#timer = undefined;
    this.interrupt(); await this.#active;
  }

  tick(): Promise<EvolutionQueueItem | null> {
    if (this.#stopped) return Promise.resolve(null);
    if (this.#options.hasUserWork()) this.interrupt(true);
    if (this.#active) return Promise.resolve(null);
    this.#controller = new AbortController();
    // Own the operation before any injected executor or maintenance hook runs.
    const work = Promise.resolve().then(() => this.#run(this.#controller!.signal)); this.#active = work;
    void work.finally(() => { if (this.#active === work) { this.#active = undefined; this.#controller = undefined; this.#current = undefined; } }).catch(() => {});
    return work;
  }

  #window(interactive = false, plan = false, now = integer((this.#options.now ?? Date.now)())) {
    const cadence = plan ? this.#planCadence : 'daily';
    const durationMs = cadence === 'hourly' ? HOUR : DAY;
    const startsAt = Math.floor(now / durationMs) * durationMs;
    const events = this.#options.store.listEvents();
    const maximum = interactive ? this.#interactiveCalls : plan ? cadence === 'hourly' ? this.#planCallsPerHour : this.#planCalls : this.#calls;
    const lane=(payload:unknown)=> (plain(payload).interactive === true) === interactive && (plain(payload).plan === true) === plan;
    // Legacy windows are daily. Hourly plan windows have a distinct identity,
    // including at UTC midnight where the start timestamps otherwise coincide.
    const old = events.find(event => event.type === 'evolution.scheduler.window' && plain(event.payload).startsAt === startsAt && lane(event.payload)
      && (plain(event.payload).cadence ?? 'daily') === cadence);
    if (old && (plain(old.payload).maxCalls !== maximum || (plain(old.payload).durationMs !== undefined && plain(old.payload).durationMs !== durationMs)))
      throw new Error('Evolution allocation is immutable');
    if (!old) this.#options.store.appendEvent('evolution.scheduler.window', { startsAt, endsAt: startsAt + durationMs, durationMs, cadence, maxCalls: maximum, interactive,plan });
    const used = events.filter(event => {
      if (event.type !== 'evolution.scheduler.call_reserved' || !lane(event.payload)) return false;
      if (!plan) return plain(event.payload).startsAt === startsAt;
      // Policy transitions never refill calls already spent in the actual hour
      // or day. Before explicit timestamps existed, journal time is evidence.
      const raw = plain(event.payload).reservedAt;
      if (raw !== undefined && typeof raw !== 'number') throw new Error('Cannot establish plan evolution reservation timestamp');
      const reservedAt = raw === undefined ? Date.parse(event.createdAt) : integer(raw);
      if (!Number.isSafeInteger(reservedAt) || reservedAt < 0) throw new Error('Cannot establish plan evolution reservation timestamp');
      return reservedAt >= startsAt && reservedAt < startsAt + durationMs;
    }).length;
    return { startsAt, cadence, durationMs, used, remaining: Math.max(0, maximum - used) };
  }

  reserveCall(attemptId: string): boolean {
    const current = this.#current;
    if (!current || current.recovery || this.#controller?.signal.aborted || (!current.interactive && this.#options.hasUserWork())
      || !['normal', 'evaluation'].includes(this.#options.phase()) || current.calls >= 8) return false;
    if (attemptId !== `evolution:${current.item.id}:call:${current.calls + 1}`) return false;
    if (this.#options.store.listEvents().some(event => event.type === 'evolution.scheduler.call_reserved' && plain(event.payload).attemptId === attemptId)) return false;
    const reservedAt = integer((this.#options.now ?? Date.now)());
    const window = this.#window(current.interactive,current.plan,reservedAt); if (window.remaining < 1) return false;
    this.#options.store.appendEvent('evolution.scheduler.call_reserved', { startsAt: window.startsAt, reservedAt, cadence: window.cadence,
      attemptId, runId: current.item.id, ordinal: current.calls + 1, interactive: current.interactive,plan:current.plan });
    current.calls++; return true;
  }

  #previous(id: string): EvolutionReport | undefined {
    const events = this.#options.store.listEvents().filter(event => ['evolution.checkpoint', 'evolution.finished'].includes(event.type) && plain(event.payload).runId === id);
    return events.length ? plain(events.at(-1)!.payload).report as EvolutionReport : undefined;
  }

  #finish(item: EvolutionQueueItem, result: NonNullable<EvolutionQueueItem['result']>): EvolutionQueueItem {
    this.#options.store.appendEvent('evolution.queue.observed', json({ id: item.id, result }));
    return this.items().find(value => value.id === item.id)!;
  }

  async #run(signal: AbortSignal): Promise<EvolutionQueueItem | null> {
    const all = this.items();
    const retained = all.find(item => item.state === 'running' || item.state === 'probation');
    const minimum=this.#options.minimumCallsPerAttempt??1;
    if(!Number.isSafeInteger(minimum)||minimum<1||minimum>8)throw new Error('Invalid minimum release allocation');
    const lane=(item:EvolutionQueueItem)=>{
      const growth=this.#options.store.growth(item.growthId)!;
      const interactive=!!growth.sourceTaskId;
      return {interactive,plan:!interactive&&!!plain(plain(growth.outcome).development).attemptId};
    };
    const priority=(item:EvolutionQueueItem)=>{const kind=lane(item);return kind.interactive?0:kind.plan?1:2;};
    const queued=all.filter(item=>item.state==='queued').sort((a,b)=>priority(a)-priority(b));
    let item = retained;
    if(!item)for(const candidate of queued){
      const kind=lane(candidate);
      if((kind.interactive&&!this.#options.authorizeProposal)||this.#options.authorizeProposal?.(candidate.growthId)===false)
        return this.#finish(candidate,{status:'declined',reason:'Current source-author policy denies this proposal or it was cancelled',calls:0});
      if(this.#window(kind.interactive,kind.plan).remaining>=minimum){item=candidate;break;}
    }
    if (!item) return null;
    if (!retained && (signal.aborted || this.#stopped || this.#options.hasUserWork() || this.#options.phase() !== 'normal')) return null;
    const growth = this.#options.store.growth(item.growthId)!;
    const interactive = !!growth.sourceTaskId;
    const plan = !interactive && !!plain(plain(growth.outcome).development).attemptId;
    if (!retained && ((interactive && !this.#options.authorizeProposal) || this.#options.authorizeProposal?.(item.growthId) === false))
      return this.#finish(item, { status: 'declined', reason: 'Current source-author policy denies this proposal or it was cancelled', calls: 0 });
    if (!retained && this.#window(interactive,plan).remaining < minimum) return null;
    await this.#options.beforeRun?.();
    if (!retained && (signal.aborted || this.#stopped || this.#options.hasUserWork() || this.#options.phase() !== 'normal')) return null;
    if (retained && !this.#previous(item.id)) return this.#finish(item, { status: 'interrupted', reason: 'Claim interrupted before a recoverable evolution report; uncertain work was not replayed', calls: 0 });
    if (!retained) {
      this.#options.store.appendEvent('evolution.queue.claimed', { id: item.id });
      item = { ...item, state: 'running' };
    }
    this.#current = { item, recovery: retained !== undefined, calls: 0, interactive,plan };
    const timer = setTimeout(() => this.interrupt(), this.#timeout);
    try {
      const result = await this.#options.run({ id: item.id, growthId: item.growthId, proposal: this.#proposal(item.growthId), signal });
      if (result.id !== item.id || result.growthId !== item.growthId || result.proposalDigest !== item.proposalDigest || result.status === 'running') throw new Error('Invalid evolution report binding');
      return this.#finish(item, { status: result.status, reason: result.reason, calls: result.calls });
    } catch {
      return this.#finish(item, { status: 'failed', reason: 'Evolution execution failed; inspect its external report before any new attempt', calls: this.#current.calls });
    } finally { clearTimeout(timer); }
  }
}
