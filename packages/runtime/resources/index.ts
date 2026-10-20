import { invariant, validateUsage, validateAuthority, canonicalJson, identity } from '../../contracts/common.ts';
import type { Authority, ResourceEnvelope } from '../../contracts/common.ts';
import { validatePhysicalRequest } from '../../contracts/control/index.ts';
import type { PhysicalRequest } from '../../contracts/control/index.ts';
import type { Effect } from '../../contracts/execution/index.ts';
import { OperationalStore } from '../../storage/index.ts';
import { createProductionWallClock } from '../environment.ts';
export interface RequestCeiling { tokens: number; costUsd: number; elapsedMs: number }
/** An explicit accepted host policy; original numeric envelopes remain recovery inputs. */
export interface AllowanceAmendment {
  id: string; authorizationRef: string; rootId: string; expectedEnvelopeDigest: string;
  cumulativeTokenLimit: null; scope: 'root-and-descendants'; descendantCostLimit: 'root';
  descendantRequestLimit?: 'root';
  cumulativeCostLimit?: null; cumulativeRequestLimit?: null; cumulativeElapsedLimit?: null;
  resumeAfterElapsedOverrun?: { requestId: string; expectedRequestDigest: string };
}
export function validateAllowanceAmendment(amendment: AllowanceAmendment): void {
  invariant(amendment, 'Invalid allowance amendment');
  const sharesRequests = Object.hasOwn(amendment, 'descendantRequestLimit');
  const expectedKeys = ['authorizationRef', 'cumulativeTokenLimit', 'descendantCostLimit', 'expectedEnvelopeDigest', 'id', 'rootId', 'scope'];
  if (sharesRequests) expectedKeys.push('descendantRequestLimit');
  for (const field of ['cumulativeCostLimit', 'cumulativeRequestLimit', 'cumulativeElapsedLimit'] as const) {
    if (Object.hasOwn(amendment, field)) {
      expectedKeys.push(field);
      invariant(amendment[field] === null, 'Invalid allowance amendment');
    }
  }
  if (Object.hasOwn(amendment, 'resumeAfterElapsedOverrun')) {
    expectedKeys.push('resumeAfterElapsedOverrun');
    const recovery = amendment.resumeAfterElapsedOverrun;
    invariant(recovery && Object.keys(recovery).sort().join(',') === 'expectedRequestDigest,requestId'
      && typeof recovery.requestId === 'string' && recovery.requestId.trim().length > 0
      && typeof recovery.expectedRequestDigest === 'string' && /^[a-f0-9]{64}$/.test(recovery.expectedRequestDigest), 'Invalid allowance amendment');
  }
  invariant(Object.keys(amendment).sort().join(',') === expectedKeys.sort().join(',') && (!sharesRequests || amendment.descendantRequestLimit === 'root'), 'Invalid allowance amendment');
  invariant([amendment.id, amendment.authorizationRef, amendment.rootId].every(value => typeof value === 'string' && value.trim().length > 0)
    && typeof amendment.expectedEnvelopeDigest === 'string' && /^[a-f0-9]{64}$/.test(amendment.expectedEnvelopeDigest)
    && amendment.cumulativeTokenLimit === null && amendment.scope === 'root-and-descendants' && amendment.descendantCostLimit === 'root', 'Invalid allowance amendment');
}
export type EffectiveResourceEnvelope = Omit<ResourceEnvelope, 'maxTokens' | 'maxCostUsd' | 'maxRequests' | 'maxElapsedMs'> & {
  maxTokens: number | null; maxCostUsd: number | null; maxRequests: number | null; maxElapsedMs: number | null;
};
interface AmendmentRecord {
  amendment: AllowanceAmendment; originalEnvelope: ResourceEnvelope; authority: Authority; appliedAt: number;
  elapsedOverrunRecovery?: { priorBudget: Budget; cause: Reservation };
}
interface Budget { envelope: ResourceEnvelope; startedAt: number; cancelled: boolean; elapsedFloorMs?: number }
interface Allocation { rootId: string; parentRunId?: string; cancelled: boolean; envelope: ResourceEnvelope; startedAt:number; elapsedFloorMs?: number }
interface Reservation { rootId: string; request: PhysicalRequest; ceiling: RequestCeiling; charged: RequestCeiling }
export class BudgetExceeded extends Error { override name = 'BudgetExceeded'; }
/** Admission may wait for this condition; spending/cancellation failures remain BudgetExceeded. */
export class CapacityUnavailable extends BudgetExceeded { override name = 'CapacityUnavailable'; }
export interface ConcurrencyReleaseEvidence {
  kind: 'transport-terminal' | 'host-recovery';
  reason: string;
}
interface ConcurrencyRelease {
  requestId: string; requestRevision: number; reservation: Reservation; reservationDigest: string;
  evidence: ConcurrencyReleaseEvidence; releasedAt: number;
}
interface ReleasedConcurrency { releaseId: string }
export class ResourceLedger {
  readonly store: OperationalStore; readonly defaultCeiling: RequestCeiling; readonly now: () => number;
  private readonly observedElapsed = new Map<string, number>();
  private readonly boundAmendments = new Map<string, AllowanceAmendment>();
  private readonly capacityListeners = new Set<() => void>();
  /** Thin host production composition facade; the existing third argument replaces wall time. */
  constructor(store: OperationalStore, defaultCeiling: RequestCeiling, now?: () => number) {
    this.store=store; this.defaultCeiling=defaultCeiling; this.validateCeiling(defaultCeiling);
    const clock=now??createProductionWallClock();this.now=()=>{const value=clock();invariant(Number.isFinite(value),'invalid wall clock reading');return value;};
  }
  /** Subscribe before attempting admission, then retry only CapacityUnavailable after a hint. */
  subscribeCapacity(listener: () => void): () => void {
    invariant(typeof listener === 'function', 'Capacity subscription requires a listener');
    this.capacityListeners.add(listener);
    return () => { this.capacityListeners.delete(listener); };
  }
  private notifyCapacity(): void {
    // Listeners wake asynchronous admission loops; they cannot alter a committed mutation's outcome.
    for (const listener of [...this.capacityListeners]) { try { listener(); } catch {} }
  }
  /** Binding requires accepted host authority on every startup. History alone never
   * relaxes enforcement. This method is deliberately absent from model tools. */
  applyAllowanceAmendment(amendment: AllowanceAmendment, host: { authority: Authority; assertAuthority: () => void }): void {
    validateAllowanceAmendment(amendment);
    invariant(host && typeof host.assertAuthority === 'function', 'Allowance amendment requires host authority');
    const accepted = structuredClone(amendment), authority = structuredClone(host.authority), assertAuthority = host.assertAuthority;
    validateAuthority(authority);
    this.store.transaction(() => {
      invariant(assertAuthority() === undefined, 'Allowance authority validation must be synchronous');
      const allocation = this.store.get<Allocation>('allocations', accepted.rootId), budget = this.store.get<Budget>('budgets', accepted.rootId);
      invariant(allocation && allocation.value.rootId === accepted.rootId && !allocation.value.parentRunId && budget, 'Allowance amendment requires original root allocation');
      invariant(identity(allocation.value.envelope) === accepted.expectedEnvelopeDigest && identity(budget.value.envelope) === accepted.expectedEnvelopeDigest, 'Allowance amendment original envelope changed');
      const existing = this.store.get<AmendmentRecord>('resource.allowance-amendments', accepted.id);
      if (existing) invariant(canonicalJson(existing.value.amendment) === canonicalJson(accepted) && identity(existing.value.originalEnvelope) === accepted.expectedEnvelopeDigest, 'Allowance amendment identity changed');
      else {
        const record: AmendmentRecord = { amendment: accepted, originalEnvelope: allocation.value.envelope, authority, appliedAt: this.now() };
        if (accepted.resumeAfterElapsedOverrun) {
          const recovery = accepted.resumeAfterElapsedOverrun, cause = this.store.get<Reservation>('requests', recovery.requestId)?.value;
          invariant(budget.value.cancelled && cause && identity(cause) === recovery.expectedRequestDigest
            && cause.rootId === accepted.rootId && cause.request.id === recovery.requestId && this.root(cause.request.runId) === accepted.rootId,
          'Elapsed overrun recovery requires the exact cancelled root cause');
          validatePhysicalRequest(cause.request); this.validateCeiling(cause.ceiling); this.validateCeiling(cause.charged);
          invariant(cause.request.status === 'uncertain' && cause.request.usage.inputTokens === null && cause.request.usage.outputTokens === null
            && cause.request.usage.costUsd === null && cause.charged.elapsedMs > cause.ceiling.elapsedMs
            && cause.charged.tokens <= cause.ceiling.tokens && cause.charged.costUsd <= cause.ceiling.costUsd,
          'Elapsed overrun recovery requires an uncertain elapsed-only overrun');
          invariant(!this.cancelled(cause.request.runId), 'Elapsed overrun recovery cannot clear allocation cancellation');
          for (const row of this.store.list<Reservation>('requests')) {
            if (row.value.rootId !== accepted.rootId || row.key === recovery.requestId) continue;
            this.validateCeiling(row.value.ceiling); this.validateCeiling(row.value.charged);
            invariant(row.value.charged.tokens <= row.value.ceiling.tokens && row.value.charged.costUsd <= row.value.ceiling.costUsd
              && row.value.charged.elapsedMs <= row.value.ceiling.elapsedMs, 'Elapsed overrun recovery has another physical overrun');
          }
          record.elapsedOverrunRecovery = { priorBudget: budget.value, cause };
          this.store.put('budgets', accepted.rootId, { ...budget.value, cancelled: false }, budget.revision);
        }
        this.store.put('resource.allowance-amendments', accepted.id, record, null);
        this.store.append({ id: `allowance-amendment:${accepted.id}`, stream: accepted.rootId, type: 'allowance-amended', data: record });
      }
    });
    this.boundAmendments.set(accepted.rootId, accepted);
  }
  /** Effective policy is a detached view. Requests, starts, original envelopes and
   * uncertain charges are never rewritten by an allowance amendment. */
  effectiveEnvelope(runId: string): EffectiveResourceEnvelope {
    const allocation = this.store.get<Allocation>('allocations', runId); invariant(allocation, 'missing resource allocation');
    const amendment = this.boundAmendments.get(allocation.value.rootId);
    if (!amendment) return { ...allocation.value.envelope };
    const retained = this.store.get<AmendmentRecord>('resource.allowance-amendments', amendment.id);
    invariant(retained && canonicalJson(retained.value.amendment) === canonicalJson(amendment), 'Bound allowance amendment history unavailable');
    const budget = this.store.get<Budget>('budgets', allocation.value.rootId); invariant(budget, 'missing root budget');
    return { ...allocation.value.envelope, maxTokens: null,
      maxElapsedMs: amendment.cumulativeElapsedLimit === null ? null : allocation.value.envelope.maxElapsedMs,
      maxCostUsd: amendment.cumulativeCostLimit === null ? null : budget.value.envelope.maxCostUsd,
      maxRequests: amendment.cumulativeRequestLimit === null ? null
        : amendment.descendantRequestLimit === 'root' ? budget.value.envelope.maxRequests : allocation.value.envelope.maxRequests };
  }
  private elapsed(key: string, value: { startedAt: number; elapsedFloorMs?: number }, now: number): number {
    const elapsed=Math.max(0,now-value.startedAt,value.elapsedFloorMs??0,this.observedElapsed.get(key)??0);
    invariant(Number.isFinite(elapsed),'invalid elapsed wall duration');this.observedElapsed.set(key,elapsed);return elapsed;
  }
  /** Reads never write to source state. Explicit mutations may commit this observation
   * before denial; an enclosing caller rollback also rolls back these floor writes. */
  private observeElapsed(runId: string, persist: boolean, now=this.now()): number {
    const rootId=this.root(runId);
    const observe=()=>{
      const budget=this.store.get<Budget>('budgets',rootId)!;
      const elapsed=this.elapsed(`budget:${rootId}`,budget.value,now);
      if(persist && elapsed>(budget.value.elapsedFloorMs??0))this.store.put('budgets',rootId,{...budget.value,elapsedFloorMs:elapsed},budget.revision);
      for(const id of this.lineage(runId)) {
        const row=this.store.get<Allocation>('allocations',id)!;
        const floor=this.elapsed(`allocation:${id}`,row.value,now);
        if(persist && floor>(row.value.elapsedFloorMs??0))this.store.put('allocations',id,{...row.value,elapsedFloorMs:floor},row.revision);
      }
      return elapsed;
    };
    return persist?this.store.transaction(observe):observe();
  }
  private validateCeiling(c: RequestCeiling): void { for (const v of Object.values(c)) invariant(Number.isFinite(v)&&v>=0,'invalid request ceiling');invariant(Number.isSafeInteger(c.tokens),'token ceiling must be integer'); }
  allocate(runId: string, envelope: ResourceEnvelope, parentRunId?: string): void {
    for (const v of Object.values(envelope)) invariant(Number.isFinite(v)&&v>=0,'invalid resource envelope');for(const key of ['maxRequests','maxTokens','maxConcurrency'] as const)invariant(Number.isSafeInteger(envelope[key]),'resource counts must be integers'); invariant(envelope.maxConcurrency>=1,'concurrency must be positive');
    this.store.transaction(()=> {
      invariant(!this.store.get('allocations',runId),'run already allocated');
      const startedAt=this.now();
      if (parentRunId) { const parent=this.store.get<Allocation>('allocations',parentRunId); invariant(parent,'missing parent allocation'); const budget=this.store.get<Budget>('budgets',parent.value.rootId); invariant(budget && !budget.value.cancelled,'parent cancelled'); invariant(!this.cancelled(parentRunId),'parent cancelled');this.observeElapsed(parentRunId,true,startedAt);this.store.put('allocations',runId,{rootId:parent.value.rootId,parentRunId,cancelled:false,envelope,startedAt,elapsedFloorMs:0},null); }
      else { this.store.put('allocations',runId,{rootId:runId,cancelled:false,envelope,startedAt,elapsedFloorMs:0},null); this.store.put('budgets',runId,{envelope,startedAt,cancelled:false,elapsedFloorMs:0},null); }
    });
  }
  private root(runId: string): string { const row=this.store.get<Allocation>('allocations',runId); invariant(row,'missing resource allocation'); return row.value.rootId; }
  private cancelled(runId:string):boolean {const allocation=this.store.get<Allocation>('allocations',runId);invariant(allocation,'missing allocation');return allocation.value.cancelled || (allocation.value.parentRunId?this.cancelled(allocation.value.parentRunId):false);}
  descendants(runId:string):string[] {return this.store.list<Allocation>('allocations').filter(row=>row.value.parentRunId===runId).flatMap(row=>[row.key,...this.descendants(row.key)]);}
  snapshot(runId: string): { requests: number; tokens: number; costUsd: number; elapsedMs: number; concurrent: number; cancelled: boolean } {
    return this.usage(runId,this.observeElapsed(runId,false));
  }
  /** Financial uncertainty does not establish whether a bounded local execution is still alive. */
  holdsConcurrency(requestId: string): boolean {
    const row = this.store.get<Reservation>('requests', requestId);
    return row ? this.reservationHoldsConcurrency(row.value) : false;
  }
  private reservationHoldsConcurrency(reservation: Reservation): boolean {
    if (!['reserved', 'dispatched', 'uncertain'].includes(reservation.request.status)) return false;
    const released = this.store.get<ReleasedConcurrency>('resource.concurrency-released', reservation.request.id);
    if (!released) return true;
    const evidence = this.store.get<ConcurrencyRelease>('resource.concurrency-releases', released.value.releaseId);
    invariant(evidence && evidence.value.requestId === reservation.request.id && evidence.value.reservation.rootId === reservation.rootId
      && evidence.value.reservationDigest === identity(evidence.value.reservation), 'Execution capacity release evidence unavailable');
    this.sameRequest(evidence.value.reservation.request, reservation.request);
    return false;
  }
  /** Trusted host only: the bounded transport/process has terminated, or exclusive startup
   * ownership proves the previous host cannot still execute it. No timer or financial
   * outcome supplies that proof. Original requests and charges remain untouched. */
  releaseConcurrency(requestId: string, evidence: ConcurrencyReleaseEvidence): void {
    invariant(evidence && ['transport-terminal', 'host-recovery'].includes(evidence.kind)
      && typeof evidence.reason === 'string' && evidence.reason.trim().length > 0, 'Execution capacity release requires terminal or recovery evidence');
    this.store.transaction(() => {
      const row = this.store.get<Reservation>('requests', requestId);
      invariant(row, 'Execution capacity release requires an existing physical request');
      const current = this.store.get<ReleasedConcurrency>('resource.concurrency-released', requestId);
      if (current) {
        invariant(this.store.get<ConcurrencyRelease>('resource.concurrency-releases', current.value.releaseId), 'Execution capacity release evidence unavailable');
        return;
      }
      const releaseId = identity({ requestId, requestRevision: row.revision });
      const record: ConcurrencyRelease = { requestId, requestRevision: row.revision, reservation: row.value,
        reservationDigest: identity(row.value), evidence: { kind: evidence.kind, reason: evidence.reason }, releasedAt: this.now() };
      this.store.put('resource.concurrency-releases', releaseId, record, null);
      this.store.put('resource.concurrency-released', requestId, { releaseId }, null);
      this.store.append({ id: `concurrency-release:${releaseId}`, stream: row.value.request.runId, type: 'execution-capacity-released', data: record });
    });
    this.notifyCapacity();
  }
  private usage(runId: string, elapsed: number): { requests: number; tokens: number; costUsd: number; elapsedMs: number; concurrent: number; cancelled: boolean } {
    const rootId=this.root(runId),budget=this.store.get<Budget>('budgets',rootId)!;
    const records=this.store.list<Reservation>('requests').map(r=>r.value).filter(r=>r.rootId===rootId);
    return { requests:records.length,tokens:records.reduce((a,r)=>a+r.charged.tokens,0),costUsd:records.reduce((a,r)=>a+r.charged.costUsd,0),elapsedMs:Math.max(elapsed,records.reduce((a,r)=>a+r.charged.elapsedMs,0)),concurrent:records.filter(r=>this.reservationHoldsConcurrency(r)).length,cancelled:budget.value.cancelled||this.cancelled(runId) };
  }
  private lineage(runId:string):string[] {const allocation=this.store.get<Allocation>('allocations',runId);invariant(allocation,'missing allocation');return [runId,...(allocation.value.parentRunId?this.lineage(allocation.value.parentRunId):[])];}
  private allocationUsage(runId:string): {requests:number;tokens:number;costUsd:number;elapsedMs:number;concurrent:number} {
    const allocation=this.store.get<Allocation>('allocations',runId)!.value;const ids=new Set([runId,...this.descendants(runId)]);const records=this.store.list<Reservation>('requests').map(r=>r.value).filter(r=>ids.has(r.request.runId));
    return {requests:records.length,tokens:records.reduce((a,r)=>a+r.charged.tokens,0),costUsd:records.reduce((a,r)=>a+r.charged.costUsd,0),elapsedMs:Math.max(allocation.elapsedFloorMs??0,this.observedElapsed.get(`allocation:${runId}`)??0,records.reduce((a,r)=>a+r.charged.elapsedMs,0)),concurrent:records.filter(r=>this.reservationHoldsConcurrency(r)).length};
  }
  reserve(request: PhysicalRequest): void {
    validatePhysicalRequest(request); invariant(request.status==='reserved','reserve requires reserved status');
    const elapsed=this.observeElapsed(request.runId,true);
    this.store.transaction(()=>{
      invariant(!this.store.get('requests',request.id),'physical request identity already used');
      const rootId=this.root(request.runId),limit=this.effectiveEnvelope(rootId),snapshot=this.usage(request.runId,elapsed);
      if(request.parentRequestId) { const parent=this.store.get<Reservation>('requests',request.parentRequestId); invariant(parent?.value.rootId===rootId,'foreign parent request'); }
      const ceiling: RequestCeiling={ tokens:request.usage.inputTokens===null || request.usage.outputTokens===null ? this.defaultCeiling.tokens : request.usage.inputTokens+request.usage.outputTokens,costUsd:request.usage.costUsd??this.defaultCeiling.costUsd,elapsedMs:Math.max(request.usage.elapsedMs,this.defaultCeiling.elapsedMs) }; this.validateCeiling(ceiling);
      if(snapshot.cancelled || limit.maxRequests!==null && snapshot.requests+1>limit.maxRequests || limit.maxTokens!==null && snapshot.tokens+ceiling.tokens>limit.maxTokens || limit.maxCostUsd!==null && snapshot.costUsd+ceiling.costUsd>limit.maxCostUsd || limit.maxElapsedMs!==null && snapshot.elapsedMs+ceiling.elapsedMs>limit.maxElapsedMs) throw new BudgetExceeded('shared physical request budget exhausted or cancelled');
      const ancestors = this.lineage(request.runId).map(id => ({ used: this.allocationUsage(id), limit: this.effectiveEnvelope(id) }));
      for(const {used,limit} of ancestors) {if(limit.maxRequests!==null && used.requests+1>limit.maxRequests || limit.maxTokens!==null && used.tokens+ceiling.tokens>limit.maxTokens || limit.maxCostUsd!==null && used.costUsd+ceiling.costUsd>limit.maxCostUsd || limit.maxElapsedMs!==null && used.elapsedMs+ceiling.elapsedMs>limit.maxElapsedMs)throw new BudgetExceeded('bounded allocation exhausted');}
      if(snapshot.concurrent+1>limit.maxConcurrency) throw new CapacityUnavailable('shared physical request execution capacity unavailable');
      for(const {used,limit} of ancestors) if(used.concurrent+1>limit.maxConcurrency)throw new CapacityUnavailable('bounded allocation execution capacity unavailable');
      this.store.put('requests',request.id,{rootId,request,ceiling,charged:ceiling},null);
    });
  }
  private sameRequest(a: PhysicalRequest,b: PhysicalRequest):void {
    const {status:as,usage:au,...ai}=a;const {status:bs,usage:bu,...bi}=b;invariant(canonicalJson(ai)===canonicalJson(bi),'physical request identity changed');
  }
  dispatched(request: PhysicalRequest): void {
    validatePhysicalRequest(request);
    const elapsed=this.observeElapsed(request.runId,true);
    this.store.transaction(()=> {
      const row=this.store.get<Reservation>('requests',request.id); invariant(row && row.value.request.status==='reserved','request not reserved');
      invariant(request.status==='dispatched','dispatch status required'); this.sameRequest(request,row.value.request);
      const snapshot=this.usage(request.runId,elapsed), rootLimit=this.effectiveEnvelope(row.value.rootId);
      if(snapshot.cancelled || rootLimit.maxElapsedMs!==null && snapshot.elapsedMs>rootLimit.maxElapsedMs) throw new BudgetExceeded('allocation cancelled or expired');
      const ancestors=this.lineage(request.runId).map(id=>({used:this.allocationUsage(id),limit:this.effectiveEnvelope(id)}));
      for(const {used,limit} of ancestors)if(limit.maxElapsedMs!==null && used.elapsedMs>limit.maxElapsedMs)throw new BudgetExceeded('bounded allocation expired');
      const released=this.store.get<ReleasedConcurrency>('resource.concurrency-released',request.id);
      if(released) {
        // The reservation is already charged; reacquisition neither resets nor charges it twice.
        const budgets=[{used:snapshot,limit:rootLimit},...ancestors];
        for(const {used,limit} of budgets)if(limit.maxRequests!==null && used.requests>limit.maxRequests || limit.maxTokens!==null && used.tokens>limit.maxTokens || limit.maxCostUsd!==null && used.costUsd>limit.maxCostUsd)throw new BudgetExceeded('released reservation budget exhausted');
        for(const {used,limit} of budgets)if(used.concurrent+1>limit.maxConcurrency)throw new CapacityUnavailable('released reservation execution capacity unavailable');
        this.store.delete('resource.concurrency-released',request.id,released.revision);
        this.store.append({id:`concurrency-reacquired:${released.value.releaseId}`,stream:request.runId,type:'execution-capacity-reacquired',data:{requestId:request.id,releaseId:released.value.releaseId,reacquiredAt:this.now()}});
      }
      this.store.put('requests',request.id,{...row.value,request},row.revision);
    });
  }
  settle(request: PhysicalRequest): void {
    validatePhysicalRequest(request); validateUsage(request.usage); invariant(['succeeded','failed','uncertain'].includes(request.status),'invalid settlement');
    this.store.transaction(()=> {
      const row=this.store.get<Reservation>('requests',request.id); invariant(row && (['dispatched','uncertain'].includes(row.value.request.status) || (row.value.request.status==='reserved' && request.status==='failed')),'request was not dispatched');
      this.sameRequest(request,row.value.request);
      const charged=row.value.request.status==='reserved'?{tokens:0,costUsd:0,elapsedMs:0}:{tokens:request.usage.inputTokens===null || request.usage.outputTokens===null ? row.value.ceiling.tokens : request.usage.inputTokens+request.usage.outputTokens,costUsd:request.usage.costUsd??row.value.ceiling.costUsd,elapsedMs:request.status==='uncertain'?Math.max(request.usage.elapsedMs,row.value.ceiling.elapsedMs):request.usage.elapsedMs};
      // In the explicit fully unlimited policy, a reservation is an accounting estimate,
      // not a hidden lifetime kill switch. Preserve actual/unknown charges either way.
      const limit=this.effectiveEnvelope(row.value.rootId);
      const unlimited=limit.maxTokens===null && limit.maxCostUsd===null && limit.maxRequests===null && limit.maxElapsedMs===null;
      if (!unlimited && (charged.tokens>row.value.ceiling.tokens || charged.costUsd>row.value.ceiling.costUsd || charged.elapsedMs>row.value.ceiling.elapsedMs)) { const budget=this.store.get<Budget>('budgets',row.value.rootId)!; this.store.put('budgets',row.value.rootId,{...budget.value,cancelled:true},budget.revision); }
      this.store.put('requests',request.id,{...row.value,request,charged},row.revision);
    });
    this.notifyCapacity();
  }
  /** An authoritative authorized effect proves the receiver was never entered. Retain
   * its original reservation and charges while repairing a pre-atomic crash gap. */
  recoverUndispatchedEffects(): void {
    this.store.transaction(() => {
      for (const effect of this.store.list<Effect>('effects').map(row => row.value)) {
        if (effect.status !== 'authorized') continue;
        const row = this.store.get<Reservation>('requests', effect.reservationId!);
        invariant(row && row.value.request.provider === 'effect-receiver' && row.value.request.runId === effect.runId && row.value.request.id === effect.id, 'effect reservation mismatch');
        if (!['dispatched', 'uncertain'].includes(row.value.request.status)) continue;
        invariant(!effect.receipt, 'undispatched effect has an unexpected receipt');
        this.store.put('requests', row.value.request.id, { ...row.value, request: { ...row.value.request, status: 'reserved' } }, row.revision);
        this.store.append({ id: `restore-undispatched:${row.value.request.id}:${row.revision}`, stream: effect.runId, type: 'restored-undispatched-reservation', data: { effectId: effect.id, request: row.value.request } });
      }
    });
  }
  recoverDispatched(): void { this.store.transaction(()=>{ for(const row of this.store.list<Reservation>('requests')) if(row.value.request.status==='dispatched') this.store.put('requests',row.key,{...row.value,request:{...row.value.request,status:'uncertain'}},row.revision); }); }
  cancel(runId: string): void { this.store.transaction(()=>{const row=this.store.get<Allocation>('allocations',runId);invariant(row,'missing allocation');this.store.put('allocations',runId,{...row.value,cancelled:true},row.revision);});this.notifyCapacity(); }
  request(id: string): PhysicalRequest | undefined { return this.store.get<Reservation>('requests',id)?.value.request; }
}
