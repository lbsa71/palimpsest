import { nodeMemoryEnvironment, nodeMemoryWallClock, type MemoryEnvironment } from './environment.ts';
import { assertDerivationScope, canonicalJson, identity, integer, invariant, nonempty, scopeAllows, validateMemory, validateScope } from '../contracts/index.ts';
import type { DataScope, JsonValue, MemoryPort, MemoryRecord } from '../contracts/index.ts';
import type { OperationalStore } from '../storage/index.ts';
import type { AttributedEpisode, Derivation, MemoryEntry } from './experience/types.ts';
import type { AdoptedSelf, AdoptSelf } from './self/types.ts';
import type { ClaimedJob, ConsolidationJob, ConsolidationOutput } from './consolidation/types.ts';
import { relevance, terms, validateBudget } from './retrieval/context.ts';
import type { ContextRequest, DevelopmentContext } from './retrieval/context.ts';

export type { AttributedEpisode, Derivation, MemoryEntry, AdoptedSelf, AdoptSelf, ClaimedJob, ConsolidationJob, ConsolidationOutput, ContextRequest, DevelopmentContext };
const MEMORIES = 'development.memories';
const SELF = 'development.self';
const HISTORY = 'development.self-history';
const JOBS = 'development.jobs';
function timestamp(value: string): void { invariant(Number.isFinite(Date.parse(value)), 'invalid timestamp'); }
function unique(ids: string[]): void { invariant(ids.length > 0 && new Set(ids).size === ids.length, 'sources must be nonempty and unique'); ids.forEach(id => nonempty(id, 'sourceId')); }

/** Trusted application service. Admission/authentication, effects and scheduling remain outside this component. */
export class DevelopmentalMemory implements MemoryPort {
  private store: OperationalStore;
  private clock: () => string;
  private readonly environment: Readonly<MemoryEnvironment>;
  constructor(store: OperationalStore, clock?: () => string, environment: MemoryEnvironment = nodeMemoryEnvironment()) {
    this.store = store;
    const wallClock = clock ?? nodeMemoryWallClock();
    const { monotonicNow, withdrawalId, compareIds } = environment;
    invariant([wallClock, monotonicNow, withdrawalId, compareIds].every(f => typeof f === 'function'), 'Memory environmental callbacks required');
    this.environment = Object.freeze({ monotonicNow: () => monotonicNow(), withdrawalId: () => withdrawalId(),
      compareIds: (left: string, right: string) => { const value = compareIds(left, right); invariant(Number.isFinite(value), 'Invalid memory collation result'); return value; } });
    this.clock = () => {
      const value = wallClock();
      invariant(typeof value === 'string' && /^(?:\d{4}|[+-]\d{6})-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value), 'invalid timestamp: Memory wall clock must return an ISO timestamp with explicit timezone');
      timestamp(value); return value;
    };
  }
  private monotonicTime(): number {
    const value = this.environment.monotonicNow();
    invariant(Number.isFinite(value) && value >= 0, 'Invalid memory monotonic time'); return value;
  }

  private raw(id: string): MemoryEntry | undefined { return this.store.get<MemoryEntry>(MEMORIES, id)?.value; }
  private activeSources(ids: string[], scope: DataScope): MemoryRecord[] {
    const sources = this.availableSources(ids, scope);
    invariant(sources, 'source unavailable for destination'); return sources;
  }
  private availableSources(ids: string[], scope: DataScope): MemoryRecord[] | undefined {
    unique(ids); validateScope(scope);
    const sources: MemoryRecord[] = [];
    for (const id of ids) {
      const entry = this.raw(id);
      if (!entry || entry.record.status !== 'active' || entry.expiresAt !== null && Date.parse(entry.expiresAt) <= Date.parse(this.clock()) || !scopeAllows(entry.record.scope, scope)) return undefined;
      sources.push(entry.record);
    }
    return sources;
  }
  get(id: string, audience: DataScope): MemoryRecord | undefined {
    validateScope(audience); const entry = this.raw(id);
    if (!entry || entry.record.status !== 'active' || !scopeAllows(entry.record.scope, audience)) return undefined;
    if (entry.expiresAt !== null && Date.parse(entry.expiresAt) <= Date.parse(this.clock())) return undefined;
    return entry.record;
  }
  private saveNew(record: MemoryRecord, expiresAt: string | null): MemoryRecord {
    validateMemory(record); invariant(record.revision === 1 && record.status === 'active', 'new memory must be active revision 1');
    invariant(!this.raw(record.id), 'memory id already exists');
    if (expiresAt !== null) { timestamp(expiresAt); invariant(Date.parse(expiresAt) > Date.parse(this.clock()), 'new memory already expired'); }
    this.store.put(MEMORIES, record.id, { record, expiresAt }, null); return record;
  }
  ingest(input: AttributedEpisode, expiresAt: string | null = null): MemoryRecord {
    nonempty(input.runId, 'runId'); nonempty(input.sourceId, 'sourceId');
    invariant(['speech', 'tool', 'action'].includes(input.channel), 'invalid episode channel');
    // The observed fact is that the actor supplied this content, not that its claims are true.
    return this.store.transaction(() => this.saveNew({
      id: input.id, kind: input.channel === 'speech' ? 'episode' : 'observation', revision: 1,
      scope: input.scope, provenance: { sourceIds: [input.sourceId], actorId: input.actorId, recordedAt: input.at, derivation: 'observed' },
      content: { runId: input.runId, channel: input.channel, attributedContent: input.content, epistemicStatus: 'attributed-observation' },
      confidence: null, supersedes: [], contradictions: [], status: 'active',
    }, expiresAt));
  }
  derive(input: Derivation): MemoryRecord {
    return this.store.transaction(() => {
      const sources = this.activeSources(input.sourceIds, input.scope);
      invariant(['interpretation', 'belief', 'procedure', 'relationship', 'self-description'].includes(input.kind), 'invalid derived kind');
      const links = [...(input.supersedes ?? []), ...(input.contradictions ?? [])];
      for (const link of links) invariant(input.sourceIds.includes(link), 'correction/contradiction must include its source');
      const record: MemoryRecord = {
        id: input.id, kind: input.kind, revision: 1, scope: input.scope,
        provenance: { sourceIds: input.sourceIds, actorId: input.actorId, recordedAt: input.at, derivation: input.derivation ?? 'interpreted' },
        content: input.content, confidence: input.confidence, supersedes: input.supersedes ?? [], contradictions: input.contradictions ?? [], status: 'active',
      };
      assertDerivationScope(sources, record);
      const expirations = input.sourceIds.map(id => this.raw(id)!.expiresAt).filter((v): v is string => v !== null);
      const expiresAt = expirations.sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
      return this.saveNew(record, expiresAt);
    });
  }
  /** C1 adapter: immutable evidence uses new IDs for revisions/corrections. Forgetting uses the lineage operation. */
  async append(record: MemoryRecord, expectedRevision: number | null): Promise<void> {
    invariant(expectedRevision === null, 'evidence is immutable; derive a correction with a new id');
    this.store.transaction(() => {
      validateMemory(record);
      if (record.provenance.derivation !== 'observed') {
        const sources = this.activeSources(record.provenance.sourceIds, record.scope);
        unique(record.provenance.sourceIds); assertDerivationScope(sources, record);
        for (const id of [...record.supersedes, ...record.contradictions]) invariant(record.provenance.sourceIds.includes(id), 'correction/contradiction must include its source');
      } else {
        invariant(record.kind === 'observation' || record.kind === 'episode', 'observed record must be episode or observation');
        invariant(record.supersedes.length === 0 && record.contradictions.length === 0, 'observed records cannot resolve beliefs');
      }
      const expirations = record.provenance.sourceIds.map(id => this.raw(id)?.expiresAt).filter((v): v is string => typeof v === 'string');
      this.saveNew(record, expirations.sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null);
    });
  }
  context(request: ContextRequest): DevelopmentContext {
    const start = this.monotonicTime(); validateScope(request.audience); validateBudget(request);
    const queryTerms = terms([request.query, ...(request.expand ?? [])].join(' '));
    const visible = this.store.list<MemoryEntry>(MEMORIES).map(entry => this.get(entry.key, request.audience)).filter((record): record is MemoryRecord => record !== undefined);
    // Suppression only uses visible corrections: a hidden correction cannot disclose its existence.
    const superseded = new Set(visible.flatMap(record => record.supersedes));
    const candidates = visible.filter(record => !superseded.has(record.id) && (queryTerms.size === 0 || relevance(record, queryTerms) > 0))
      .sort((a, b) => relevance(b, queryTerms) - relevance(a, queryTerms) || Date.parse(b.provenance.recordedAt) - Date.parse(a.provenance.recordedAt) || this.environment.compareIds(a.id, b.id));
    const self = request.includeSelf === false ? [] : this.store.list<AdoptedSelf>(SELF).map(entry => entry.value).filter(facet => facet.status === 'active' && scopeAllows(facet.scope, request.audience) && facet.memoryIds.every(id => this.get(id, request.audience)));
    // Whole records only. The budget covers canonical serialized memories + self, including provenance.
    const payload: { memories: MemoryRecord[]; self: AdoptedSelf[] } = { memories: [], self: [] }; let omitted = 0;
    for (const facet of self.sort((a, b) => this.environment.compareIds(a.id, b.id))) {
      const next = { memories: payload.memories, self: [...payload.self, facet] };
      if (Buffer.byteLength(canonicalJson(next)) <= request.maxBytes && payload.memories.length + payload.self.length < request.maxRecords) payload.self.push(facet); else omitted++;
    }
    for (const record of candidates) {
      const next = { memories: [...payload.memories, record], self: payload.self };
      if (Buffer.byteLength(canonicalJson(next)) <= request.maxBytes && payload.memories.length + payload.self.length < request.maxRecords) payload.memories.push(record); else omitted++;
    }
    const end = this.monotonicTime(); invariant(end >= start, 'Memory monotonic time regressed');
    return { ...payload, selection: { policy: 'adopted-self-then-lexical-relevance-recency-whole-records-v1', omittedForBudget: omitted, bytes: Buffer.byteLength(canonicalJson(payload)), elapsedMs: end - start } };
  }
  async retrieve(scope: DataScope, query: string, limit: number): Promise<MemoryRecord[]> {
    return this.context({ audience: scope, query, maxRecords: limit, maxBytes: 64 * 1024, includeSelf: false }).memories;
  }
  adoptSelf(input: AdoptSelf, expectedRevision: number | null): AdoptedSelf {
    return this.store.transaction(() => {
      this.activeSources(input.memoryIds, input.scope); nonempty(input.reason, 'self adoption reason'); timestamp(input.at); nonempty(input.actorId, 'self actorId');
      invariant(['interest', 'value', 'ability', 'uncertainty', 'preference', 'description'].includes(input.category), 'invalid self category');
      identity(input.value); const previous = this.store.get<AdoptedSelf>(SELF, input.id); const revision = (previous?.revision ?? 0) + 1;
      const facet: AdoptedSelf = { id: input.id, revision, scope: input.scope, memoryIds: input.memoryIds, status: 'active',
        preferences: { category: input.category, value: input.value, reason: input.reason },
        provenance: { sourceIds: input.memoryIds, actorId: input.actorId, recordedAt: input.at, derivation: 'interpreted' },
      };
      this.store.put(SELF, input.id, facet, expectedRevision);
      this.store.put(HISTORY, `${input.id}:${revision}`, facet, null); return facet;
    });
  }
  selfHistory(id: string, audience: DataScope): AdoptedSelf[] {
    validateScope(audience);
    return this.store.list<AdoptedSelf>(HISTORY).map(entry => entry.value)
      .filter(facet => facet.id === id && facet.status === 'active' && scopeAllows(facet.scope, audience) && facet.memoryIds.every(source => this.get(source, audience)))
      .sort((a, b) => a.revision - b.revision);
  }
  /** Erase content and all descendants atomically, including self history and queued jobs. No raw payload is copied into audit events. */
  forget(ids: string[], resultAudience?: DataScope): string[] {
    return this.forgetOwned(ids, 'forget', resultAudience);
  }
  private forgetOwned(ids: string[], reason: 'forget' | 'expiry', resultAudience?: DataScope): string[] {
    unique(ids); if (resultAudience) validateScope(resultAudience);
    return this.store.transaction(() => {
      const entries = this.store.list<MemoryEntry>(MEMORIES); const forgotten = new Set(ids);
      for (const id of ids) invariant(entries.some(entry => entry.key === id), 'unknown memory to forget');
      let changed = true;
      while (changed) { changed = false; for (const entry of entries) if (!forgotten.has(entry.key) && entry.value.record.provenance.sourceIds.some(id => forgotten.has(id))) { forgotten.add(entry.key); changed = true; } }
      const self = this.store.list<AdoptedSelf>(SELF).filter(entry => entry.value.memoryIds.some(id => forgotten.has(id)));
      const history = this.store.list<AdoptedSelf>(HISTORY).filter(entry => entry.value.memoryIds.some(id => forgotten.has(id)));
      const jobs = this.store.list<ConsolidationJob>(JOBS).filter(entry => entry.value.sourceIds.some(id => forgotten.has(id)));
      const targets = new Map<string, { namespace: string; key: string }>();
      const select = (namespace: string, key: string) => targets.set(canonicalJson([namespace, key]), { namespace, key });
      for (const id of forgotten) select(MEMORIES, id);
      for (const entry of self) select(SELF, entry.key);
      for (const entry of history) { select(HISTORY, entry.key); select(SELF, entry.value.id); }
      for (const entry of jobs) select(JOBS, entry.key);
      for (const entry of entries) if (forgotten.has(entry.key) && entry.value.record.status !== 'forgotten') {
        const record = { ...entry.value.record, revision: entry.revision + 1, status: 'forgotten' as const, content: null, confidence: null };
        this.store.put(MEMORIES, entry.key, { record, expiresAt: null }, entry.revision);
      }
      for (const entry of self) {
        this.store.put(SELF, entry.key, { ...entry.value, revision: entry.revision + 1, status: 'forgotten', memoryIds: [], preferences: { category: entry.value.preferences.category, value: null, reason: 'evidence forgotten' } }, entry.revision);
      }
      for (const entry of history) this.store.delete(HISTORY, entry.key, entry.revision);
      for (const entry of jobs) this.writeJob({ ...entry.value, state: 'cancelled', lease: null, error: 'source forgotten', outputIds: [] }, entry.revision);
      const withdrawalId = this.environment.withdrawalId(); nonempty(withdrawalId, 'withdrawal id');
      this.store.withdrawDocumentJournalContent({ id: withdrawalId, reason, targets: [...targets.values()].map(target => ({ ...target, expectedRevision: this.store.get(target.namespace, target.key)?.revision ?? null })) });
      return [...forgotten].filter(id => !resultAudience || scopeAllows(entries.find(entry => entry.key === id)!.value.record.scope, resultAudience));
    });
  }
  expire(at = this.clock()): string[] {
    timestamp(at); const ids = this.store.list<MemoryEntry>(MEMORIES).filter(entry => entry.value.record.status === 'active' && entry.value.expiresAt !== null && Date.parse(entry.value.expiresAt) <= Date.parse(at)).map(entry => entry.key);
    return ids.length ? this.forgetOwned(ids, 'expiry') : [];
  }
  private writeJob(job: ConsolidationJob, expected: number | null): ConsolidationJob {
    const next = { ...job, revision: (expected ?? 0) + 1 }; this.store.put(JOBS, job.id, next, expected); return next;
  }
  scheduleConsolidation(id: string, sourceIds: string[], scope: DataScope, dueAt: string): ConsolidationJob {
    return this.store.transaction(() => {
      nonempty(id, 'job id'); timestamp(dueAt); const sources = this.activeSources(sourceIds, scope);
      return this.writeJob({ id, revision: 1, sourceIds, sourceRevisions: sources.map(source => source.revision), scope, dueAt, state: 'pending', attempts: 0, lease: null, outputIds: [], error: null }, null);
    });
  }
  claimConsolidation(owner: string, leaseMs: number, at = this.clock()): ClaimedJob | undefined {
    nonempty(owner, 'worker owner'); integer(leaseMs, 'leaseMs'); invariant(leaseMs > 0, 'lease must be positive'); timestamp(at);
    return this.store.transaction(() => {
      const candidates = this.store.list<ConsolidationJob>(JOBS).filter(entry => Date.parse(entry.value.dueAt) <= Date.parse(at) && (entry.value.state === 'pending' || (entry.value.state === 'running' && entry.value.lease !== null && Date.parse(entry.value.lease.until) <= Date.parse(at))));
      for (const entry of candidates.sort((a, b) => Date.parse(a.value.dueAt) - Date.parse(b.value.dueAt) || this.environment.compareIds(a.key, b.key))) {
        const sources = this.availableSources(entry.value.sourceIds, entry.value.scope);
        if (!sources || !sources.every((source, i) => source.revision === entry.value.sourceRevisions[i])) {
          this.writeJob({ ...entry.value, state: 'cancelled', lease: null, error: 'source unavailable or revised' }, entry.revision); continue;
        }
        return { job: this.writeJob({ ...entry.value, state: 'running', attempts: entry.value.attempts + 1, lease: { owner, until: new Date(Date.parse(at) + leaseMs).toISOString() }, error: null }, entry.revision) };
      }
      return undefined;
    });
  }
  private leased(claim: ClaimedJob): ConsolidationJob {
    const current = this.store.get<ConsolidationJob>(JOBS, claim.job.id);
    invariant(current && current.revision === claim.job.revision && current.value.state === 'running' && current.value.lease?.owner === claim.job.lease?.owner, 'stale consolidation lease');
    invariant(Date.parse(current.value.lease!.until) > Date.parse(this.clock()), 'consolidation lease expired');
    return current.value;
  }
  consolidationSources(claim: ClaimedJob): MemoryRecord[] { const job = this.leased(claim); return this.activeSources(job.sourceIds, job.scope); }
  completeConsolidation(claim: ClaimedJob, output: ConsolidationOutput): ConsolidationJob {
    return this.store.transaction(() => {
      const job = this.leased(claim); invariant(output.length > 0, 'consolidation requires output');
      for (const record of output) {
        invariant(scopeAllows(job.scope, record.scope), 'job output widens scope');
        invariant(record.sourceIds.length === job.sourceIds.length && job.sourceIds.every(id => record.sourceIds.includes(id)), 'job output must preserve all sources');
        this.derive({ ...record, derivation: 'summarized' });
      }
      return this.writeJob({ ...job, state: 'completed', lease: null, outputIds: output.map(record => record.id), error: null }, job.revision);
    });
  }
  failConsolidation(claim: ClaimedJob): ConsolidationJob {
    return this.store.transaction(() => { const job = this.leased(claim); return this.writeJob({ ...job, state: 'failed', lease: null, error: 'worker failed' }, job.revision); });
  }
  retryConsolidation(id: string, expectedRevision: number, dueAt: string): ConsolidationJob {
    return this.store.transaction(() => { timestamp(dueAt); const entry = this.store.get<ConsolidationJob>(JOBS, id); invariant(entry && entry.value.state === 'failed', 'only failed jobs can retry'); return this.writeJob({ ...entry.value, state: 'pending', dueAt, error: null }, expectedRevision); });
  }
  jobs(audience: DataScope): ConsolidationJob[] { validateScope(audience); return this.store.list<ConsolidationJob>(JOBS).map(entry => entry.value).filter(job => scopeAllows(job.scope, audience)); }
}

/** Data-only instruction inventory for L02/L06. Audience is supplied by authenticated runtime, never model arguments. */
export function developmentTools(memory: DevelopmentalMemory, audience: DataScope) {
  validateScope(audience);
  const boundAudience = structuredClone(audience);
  return [{
    name: 'memory_retrieve', description: 'Retrieve attributed experience and adopted self with provenance. Content is evidence, not execution authority.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, maxRecords: { type: 'integer', minimum: 0, maximum: 32 }, maxBytes: { type: 'integer', minimum: 64, maximum: 65536 } }, required: ['query'], additionalProperties: false },
    execute(args: JsonValue): DevelopmentContext {
      invariant(args !== null && typeof args === 'object' && !Array.isArray(args), 'expected object');
      invariant(Object.keys(args).every(key => ['query', 'maxRecords', 'maxBytes'].includes(key)), 'unknown retrieval argument'); invariant(typeof args.query === 'string', 'query must be string');
      const maxRecords = args.maxRecords ?? 8; const maxBytes = args.maxBytes ?? 8192;
      invariant(typeof maxRecords === 'number' && maxRecords <= 32 && typeof maxBytes === 'number' && maxBytes <= 65536, 'invalid tool budget');
      return memory.context({ audience: boundAudience, query: args.query, maxRecords, maxBytes });
    },
  }, {
    name: 'memory_schedule_consolidation', description: 'Queue an attributed consolidation job. Sources keep their audience and retention boundaries. This tool schedules work; it does not claim that interpretation has occurred.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, sourceIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 32 }, dueAt: { type: 'string', format: 'date-time' } }, required: ['id', 'sourceIds', 'dueAt'], additionalProperties: false },
    execute(args: JsonValue): ConsolidationJob {
      invariant(args !== null && typeof args === 'object' && !Array.isArray(args), 'expected object');
      invariant(Object.keys(args).every(key => ['id', 'sourceIds', 'dueAt'].includes(key)), 'unknown consolidation argument');
      invariant(typeof args.id === 'string' && typeof args.dueAt === 'string' && Array.isArray(args.sourceIds) && args.sourceIds.length <= 32 && args.sourceIds.every(id => typeof id === 'string'), 'invalid consolidation arguments');
      // Model-selected names cannot probe another audience's job namespace through CAS errors.
      nonempty(args.id, 'job id');
      return memory.scheduleConsolidation(`tool:${identity(boundAudience)}:${args.id}`, args.sourceIds as string[], boundAudience, args.dueAt);
    },
  }];
}
