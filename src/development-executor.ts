import { digestJson } from './candidates.ts';
import type { DevelopmentCheckId, DevelopmentPlan, DevelopmentWorkId, DevelopmentWorkItem } from './development-plan.ts';
import { parseGrowthReflection } from './growth.ts';
import type { GrowthProposal } from './growth.ts';
import { ProviderError } from './providers.ts';
import { Store } from './store.ts';
import { developmentAllocation } from './coding-accounting.ts';
import type { Growth, Json } from './store.ts';

export interface DevelopmentSource {
  releaseId: string; sourceDigest: string; baseCommit: string;
  files: Array<{ path: string; content: string }>;
}
export interface DevelopmentEvidence {
  catalogDigest: string; releaseId: string; sourceDigest: string; evidenceDigest: string;
  checks: Array<{ id: DevelopmentCheckId; status: 'passed' | 'failed'; detail: string }>;
}
export interface DevelopmentReleaseObservation {
  attemptId: string; growthId: string; catalogDigest: string;
  status: 'pending' | 'promoted' | 'declined' | 'failed' | 'interrupted' | 'rolled_back'; reason: string;
  candidateId?: string; candidateSourceDigest?: string; evidence?: DevelopmentEvidence;
  publication: { status: 'pending' | 'published' | 'declined' | 'uncertain' | 'disabled'; publishedSourceDigest?: string; commit?: string };
}
export interface DevelopmentFeedback { reason: string; checks?: DevelopmentEvidence['checks'] }
export interface DevelopmentAttempt {
  id: string; itemId: DevelopmentWorkId; catalogDigest: string; ordinal: number; startedAt: number;
  state: 'authoring' | 'proposed' | 'queued' | 'paused' | 'completed'; source: DevelopmentSource;
  growthId?: string; proposal?: GrowthProposal; feedback?: DevelopmentFeedback; nextEligibleAt?: number;
  observation?: DevelopmentReleaseObservation;
}
export interface DevelopmentAuthoringInput {
  attemptId: string; catalogDigest: string; item: DevelopmentWorkItem; source: DevelopmentSource;
  feedback: DevelopmentFeedback[]; signal: AbortSignal;
}
export interface DevelopmentExecutorOptions {
  store: Store; plan: DevelopmentPlan; proposalCallsPerDay: number;
  proposalCadence?: 'daily' | 'hourly'; proposalCallsPerHour?: number;
  /** Trusted admission to new authoring only; retained work still reconciles. */
  mayAuthor?: () => boolean;
  hasUserWork(): boolean;
  readSource(): Promise<DevelopmentSource>;
  /** Independent host collector, never the authoring model or candidate. */
  checkCurrent(source: DevelopmentSource, signal?: AbortSignal): Promise<DevelopmentEvidence>;
  propose(input: DevelopmentAuthoringInput): Promise<GrowthProposal | null>;
  /** Local idempotent queue operation only, keyed to attempt.id/growth.id. */
  enqueue(attempt: DevelopmentAttempt, growth: Growth): Promise<void>;
  /** Independently reconcile the exact release and publication; no blind replay. */
  observe(attempt: DevelopmentAttempt): Promise<DevelopmentReleaseObservation | undefined>;
  now?: () => number;
}
const json = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const validDigest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function integer(value: number): number { if (!Number.isSafeInteger(value) || value < 0) throw new Error('Development allocation/time must be a finite nonnegative integer'); return value; }
function sourceValid(source: DevelopmentSource): void {
  if (!source || !validDigest(source.releaseId) || !validDigest(source.sourceDigest) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(source.baseCommit)
    || !Array.isArray(source.files) || source.files.length < 1 || source.files.length > 32 || new Set(source.files.map(file => file.path)).size !== source.files.length
    || source.files.some(file => !/^src\/agent\/[A-Za-z0-9][A-Za-z0-9._-]*\.ts$/.test(file.path) || typeof file.content !== 'string' || Buffer.byteLength(file.content) > 524_288)
    || !source.files.some(file => file.path === 'src/agent/brain.ts') || Buffer.byteLength(JSON.stringify(source)) > 1_048_576) throw new Error('Invalid independently observed development source');
}

/** Trusted single-owner delivery agenda. The caller holds the coordinator lock,
 * owns source/check/release collectors and admission, and drives maintenance.
 * Constructor never decides that another owner died. All inference attempts are
 * durably debited before callbacks; only explicit recovery abandons old calls. */
export class DevelopmentExecutor {
  readonly #options: DevelopmentExecutorOptions;
  #active: Promise<DevelopmentAttempt | null> | undefined;
  #controller: AbortController | undefined;
  constructor(options: DevelopmentExecutorOptions) {
    integer(options.proposalCallsPerDay);
    integer(options.proposalCallsPerHour ?? 1);
    if (options.proposalCadence !== undefined && !['daily', 'hourly'].includes(options.proposalCadence)) throw new Error('Invalid development proposal cadence');
    if (!validDigest(options.plan?.digest) || options.plan.version !== 1) throw new Error('Development executor requires a trusted versioned plan');
    this.#options = { ...options, plan: structuredClone(options.plan) };
  }
  get busy(): boolean { return this.#active !== undefined; }
  attempts(): DevelopmentAttempt[] {
    const records = new Map<string, DevelopmentAttempt>();
    for (const event of this.#options.store.listEvents()) {
      if (!['development.attempt.started', 'development.attempt.updated'].includes(event.type)) continue;
      const value = object(event.payload).attempt as unknown as DevelopmentAttempt;
      if (value?.catalogDigest === this.#options.plan.digest) records.set(value.id, value);
    }
    return [...records.values()];
  }
  allocation(): { startsAt: number; endsAt: number; cadence: 'daily' | 'hourly'; used: number; remaining: number } {
    return this.#allocation(integer((this.#options.now ?? Date.now)()));
  }
  #allocation(now: number): ReturnType<DevelopmentExecutor['allocation']> {
    const cadence = this.#options.proposalCadence ?? 'daily';
    const maxCalls = cadence === 'hourly' ? this.#options.proposalCallsPerHour ?? 1 : this.#options.proposalCallsPerDay;
    return developmentAllocation(this.#options.store, { cadence, maxCalls }, now);
  }
  recoverInterrupted(): void {
    if (this.busy) throw new Error('Cannot recover a running development execution owner');
    for (const attempt of this.attempts().filter(item => item.state === 'authoring')) this.#pause(attempt, 'Prior authoring owner stopped; uncertain inference was not replayed or refunded');
  }
  interrupt(): void { this.#controller?.abort(); }
  async stop(): Promise<void> { this.interrupt(); await this.#active; }
  tick(): Promise<DevelopmentAttempt | null> {
    if (this.#options.hasUserWork()) this.interrupt();
    if (this.#active || this.#options.hasUserWork()) return Promise.resolve(null);
    const controller = new AbortController(); this.#controller = controller;
    const work = Promise.resolve().then(() => this.#run(controller.signal)); this.#active = work;
    void work.finally(() => { if (this.#active === work) { this.#active = undefined; this.#controller = undefined; } }).catch(() => {});
    return work;
  }
  #save(attempt: DevelopmentAttempt): DevelopmentAttempt {
    this.#options.store.appendEvent('development.attempt.updated', json({ attempt })); return structuredClone(attempt);
  }
  #latest(attempt: DevelopmentAttempt): DevelopmentAttempt | undefined { return this.attempts().find(item => item.id === attempt.id); }
  #pause(attempt: DevelopmentAttempt, reason: string, checks?: DevelopmentEvidence['checks']): DevelopmentAttempt {
    const item = this.#options.plan.items.find(value => value.id === attempt.itemId)!;
    return this.#save({ ...attempt, state: 'paused', feedback: { reason: reason.slice(0, 12_000), ...(checks ? { checks } : {}) },
      nextEligibleAt: integer((this.#options.now ?? Date.now)()) + item.budget.retryAfterMs });
  }
  #evidenceValid(evidence: DevelopmentEvidence, source: Pick<DevelopmentSource, 'releaseId' | 'sourceDigest'>): boolean {
    const knownChecks = new Set(this.#options.plan.items.flatMap(item => item.authoritativeChecks));
    return !!evidence && evidence.catalogDigest === this.#options.plan.digest && evidence.releaseId === source.releaseId && evidence.sourceDigest === source.sourceDigest
      && validDigest(evidence.evidenceDigest) && Array.isArray(evidence.checks) && evidence.checks.length <= knownChecks.size
      && new Set(evidence.checks.map(check => check.id)).size === evidence.checks.length
      && evidence.checks.every(check => knownChecks.has(check.id) && ['passed', 'failed'].includes(check.status) && typeof check.detail === 'string' && check.detail.length <= 12_000);
  }
  #passes(item: DevelopmentWorkItem, evidence: DevelopmentEvidence): boolean {
    return item.authoritativeChecks.every(id => evidence.checks.some(check => check.id === id && check.status === 'passed'));
  }
  async #run(signal: AbortSignal): Promise<DevelopmentAttempt | null> {
    if (signal.aborted || this.#options.hasUserWork()) return null;
    const source = structuredClone(await this.#options.readSource()); sourceValid(source);
    const attempts = this.attempts();
    const pending = attempts.find(item => ['authoring', 'proposed', 'queued'].includes(item.state));
    if (pending?.state === 'queued') {
      // A bound failed result grants no release/completion authority. Reconcile
      // it promptly even when unrelated current diagnostics are slow or down.
      const observed = await this.#observe(pending, source);
      if (observed.state === 'paused') return observed;
    }
    let current: DevelopmentEvidence;
    try { current = structuredClone(await this.#options.checkCurrent(structuredClone(source), signal)); }
    catch (error) { if (signal.aborted) return null; throw error; }
    if (!this.#evidenceValid(current, source)) throw new Error('Current development evidence has invalid source/catalog bindings');
    if (signal.aborted || this.#options.hasUserWork()) return null;
    if (pending?.state === 'authoring') return pending; // Another owner requires explicit recovery, never inference from age.
    if (pending?.state === 'proposed') return await this.#enqueue(pending, source, signal);
    if (pending?.state === 'queued') return await this.#observe(pending, source, current);
    if (this.#options.mayAuthor && !this.#options.mayAuthor()) return null;
    const item = this.#options.plan.items.find(candidate => !this.#passes(candidate, current)
      && candidate.dependencies.every(id => this.#passes(this.#options.plan.items.find(dependency => dependency.id === id)!, current)));
    if (!item) return null;
    const previous = attempts.filter(attempt => attempt.itemId === item.id);
    const now = integer((this.#options.now ?? Date.now)());
    if (previous.length >= item.budget.maxAttempts || (previous.at(-1)?.nextEligibleAt ?? 0) > now) return null;
    if (previous.some(attempt => attempt.state === 'completed') && !this.#options.store.listEvents().some(event => event.type === 'development.capability.reopened'
      && object(event.payload).itemId === item.id && object(event.payload).sourceDigest === source.sourceDigest && object(event.payload).catalogDigest === this.#options.plan.digest))
      this.#options.store.appendEvent('development.capability.reopened', json({ itemId: item.id, catalogDigest: this.#options.plan.digest, releaseId: source.releaseId, sourceDigest: source.sourceDigest, evidence: current }));
    const ordinal = previous.length + 1;
    const attempt: DevelopmentAttempt = { id: `development:${digestJson({ catalogDigest: this.#options.plan.digest, itemId: item.id, ordinal })}`,
      itemId: item.id, catalogDigest: this.#options.plan.digest, ordinal, startedAt: now, state: 'authoring', source };
    // One durable record is both the attempt claim and its call reservation, so a
    // crash cannot reserve a call and then reuse the same attempt identity.
    const admitted = this.#options.store.transaction(() => {
      if (signal.aborted || this.#options.hasUserWork() || this.#options.mayAuthor && !this.#options.mayAuthor()) return false;
      const current = this.attempts();
      if (current.some(value => ['authoring', 'proposed', 'queued'].includes(value.state)) || current.filter(value => value.itemId === item.id).length !== previous.length) return false;
      const reservedAt = integer((this.#options.now ?? Date.now)());
      const allocation = this.#allocation(reservedAt); if (allocation.remaining < 1) return false;
      attempt.startedAt = reservedAt;
      this.#options.store.appendEvent('development.attempt.started', json({ startsAt: allocation.startsAt, cadence: allocation.cadence, attempt })); return true;
    });
    if (!admitted) return null;
    let proposed: GrowthProposal | null;
    const feedback = [...previous.flatMap(value => value.feedback ? [value.feedback] : []), { reason: 'Current independently observed item checks', checks: current.checks }];
    try { proposed = await this.#options.propose({ attemptId: attempt.id, catalogDigest: attempt.catalogDigest, item: structuredClone(item), source: structuredClone(source), feedback: structuredClone(feedback), signal }); }
    catch (error) {
      if (this.#latest(attempt)?.state !== 'authoring') return this.#latest(attempt) ?? null;
      return this.#pause(attempt, signal.aborted ? 'Authoring interrupted; allocation retained' : `Authoring failed or outcome unknown: ${error instanceof ProviderError ? error.code : 'provider_unavailable'}`);
    }
    if (this.#latest(attempt)?.state !== 'authoring') return this.#latest(attempt) ?? null;
    if (signal.aborted || this.#options.hasUserWork()) return this.#pause(attempt, 'Authoring interrupted for user work; late proposal discarded');
    let after: DevelopmentSource;
    try { after = structuredClone(await this.#options.readSource()); sourceValid(after); }
    catch { return this.#pause(attempt, 'Current source could not be independently observed after authoring; proposal withheld'); }
    if (digestJson(after) !== digestJson(source)) return this.#pause(attempt, 'Admitted source changed during authoring; stale proposal discarded');
    if (!proposed) return this.#pause(attempt, 'Bounded authoring proposed no source change');
    try {
      proposed = parseGrowthReflection(JSON.stringify({ observation: item.problem, lesson: 'Proposed implementation awaits authoritative evaluation', nextQuestion: item.title, proposedChange: proposed })).proposedChange!;
      if (proposed.files.some(file => !item.permittedPaths.includes(file.path as 'src/agent/brain.ts'))
        || proposed.files.every(file => source.files.find(existing => existing.path === file.path)?.content === file.content)) throw new Error('Protected or unchanged proposal');
    } catch { return this.#pause(attempt, 'Proposal failed shape, permitted-source or meaningful-change validation'); }
    const ready = this.#save({ ...attempt, state: 'proposed', proposal: proposed, growthId: `plan:${attempt.id}` });
    return await this.#enqueue(ready, after, signal);
  }
  async #enqueue(attempt: DevelopmentAttempt, source: DevelopmentSource, signal: AbortSignal): Promise<DevelopmentAttempt> {
    if (signal.aborted || this.#options.hasUserWork()) return attempt;
    if (digestJson(attempt.source) !== digestJson(source)) return this.#pause(attempt, 'Admitted source changed before dispatch; stale proposal discarded');
    const item = this.#options.plan.items.find(value => value.id === attempt.itemId)!;
    const result = { observation: item.problem, lesson: 'Implementation proposal is unverified until independently checked', nextQuestion: item.title, proposedChange: attempt.proposal! };
    const development = { catalogDigest: attempt.catalogDigest, itemId: attempt.itemId, attemptId: attempt.id };
    const sourceBinding = { version: 1, releaseDigest: source.releaseId, sourceDigest: source.sourceDigest, baseCommit: source.baseCommit };
    const outcome = json({ assessment: 'unverified_plan_proposal', result, development, sourceBinding }); const id = attempt.growthId!;
    let growth = this.#options.store.growth(id);
    if (!growth) growth = this.#options.store.addGrowth({ id, dimension: 'code_quality', question: item.title, origin: `development-plan:${attempt.catalogDigest}:${attempt.itemId}`, budget: 0 });
    if (growth.sourceTaskId || growth.dimension !== 'code_quality' || growth.question !== item.title || growth.origin !== `development-plan:${attempt.catalogDigest}:${attempt.itemId}` || growth.budget !== 0)
      throw new Error('Development growth identity conflicts with its trusted origin');
    if (growth.state !== 'completed') growth = this.#options.store.updateGrowth(id, { state: 'completed', outcome, checkpoint: json({ development: {
      attemptId: attempt.id, catalogDigest: attempt.catalogDigest, itemId: attempt.itemId, source: { releaseId: source.releaseId, sourceDigest: source.sourceDigest, baseCommit: source.baseCommit },
      authoritativeChecks: item.authoritativeChecks, permittedPaths: item.permittedPaths, releaseCalls: item.budget.releaseCalls } }), nextStep: 'Await exact checked release and independently observed publication' });
    else if (digestJson(growth.outcome) !== digestJson(outcome)) throw new Error('Development growth identity conflicts with retained proposal');
    // enqueue is explicitly a local idempotent operation. Unknown release or
    // publication outcomes are handled only by observe, never retried here.
    try { await this.#options.enqueue(structuredClone(attempt), structuredClone(growth)); }
    catch { return attempt; }
    if (this.#latest(attempt)?.state !== 'proposed') return this.#latest(attempt) ?? attempt;
    return this.#save({ ...attempt, state: 'queued' });
  }
  async #observe(attempt: DevelopmentAttempt, source: DevelopmentSource, current?: DevelopmentEvidence): Promise<DevelopmentAttempt> {
    let observed: DevelopmentReleaseObservation | undefined;
    try { observed = await this.#options.observe(structuredClone(attempt)); }
    catch { return attempt; }
    if (!observed) return attempt;
    if (observed.attemptId !== attempt.id || observed.growthId !== attempt.growthId || observed.catalogDigest !== attempt.catalogDigest
      || !['pending', 'promoted', 'declined', 'failed', 'interrupted', 'rolled_back'].includes(observed.status)
      || typeof observed.reason !== 'string' || observed.reason.length > 12_000) return attempt;
    if (observed.status === 'pending') return attempt;
    if (observed.evidence && (!validDigest(observed.candidateId) || !validDigest(observed.candidateSourceDigest)
      || !this.#evidenceValid(observed.evidence, { releaseId: observed.candidateId, sourceDigest: observed.candidateSourceDigest }))) return attempt;
    if (observed.status !== 'promoted') return this.#pause({ ...attempt, observation: structuredClone(observed) }, observed.reason, observed.evidence?.checks);
    const item = this.#options.plan.items.find(value => value.id === attempt.itemId)!;
    if (!current || observed.candidateId !== source.releaseId || observed.candidateSourceDigest !== source.sourceDigest || !observed.evidence
      || !this.#evidenceValid(observed.evidence, source) || !this.#passes(item, observed.evidence) || !this.#passes(item, current)
      || observed.publication?.status !== 'published' || observed.publication.publishedSourceDigest !== source.sourceDigest || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(observed.publication.commit ?? '')) return attempt;
    return this.#save({ ...attempt, state: 'completed', observation: structuredClone(observed), feedback: { reason: 'Exact independently checked admitted source publication observed' } });
  }
}
