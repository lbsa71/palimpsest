import { invariant, validateUsage, canonicalJson } from '../../contracts/common.ts';
import type { ResourceEnvelope } from '../../contracts/common.ts';
import { validatePhysicalRequest } from '../../contracts/control/index.ts';
import type { PhysicalRequest } from '../../contracts/control/index.ts';
import type { Effect } from '../../contracts/execution/index.ts';
import { OperationalStore } from '../../storage/index.ts';
export interface RequestCeiling { tokens: number; costUsd: number; elapsedMs: number }
interface Budget { envelope: ResourceEnvelope; startedAt: number; cancelled: boolean }
interface Allocation { rootId: string; parentRunId?: string; cancelled: boolean; envelope: ResourceEnvelope; startedAt:number }
interface Reservation { rootId: string; request: PhysicalRequest; ceiling: RequestCeiling; charged: RequestCeiling }
export class BudgetExceeded extends Error { override name = 'BudgetExceeded'; }
export class ResourceLedger {
  readonly store: OperationalStore; readonly defaultCeiling: RequestCeiling; readonly now: () => number;
  constructor(store: OperationalStore, defaultCeiling: RequestCeiling, now: () => number = Date.now) { this.store=store; this.defaultCeiling=defaultCeiling; this.now=now; this.validateCeiling(defaultCeiling); }
  private validateCeiling(c: RequestCeiling): void { for (const v of Object.values(c)) invariant(Number.isFinite(v)&&v>=0,'invalid request ceiling');invariant(Number.isSafeInteger(c.tokens),'token ceiling must be integer'); }
  allocate(runId: string, envelope: ResourceEnvelope, parentRunId?: string): void {
    for (const v of Object.values(envelope)) invariant(Number.isFinite(v)&&v>=0,'invalid resource envelope');for(const key of ['maxRequests','maxTokens','maxConcurrency'] as const)invariant(Number.isSafeInteger(envelope[key]),'resource counts must be integers'); invariant(envelope.maxConcurrency>=1,'concurrency must be positive');
    this.store.transaction(()=> {
      invariant(!this.store.get('allocations',runId),'run already allocated');
      if (parentRunId) { const parent=this.store.get<Allocation>('allocations',parentRunId); invariant(parent,'missing parent allocation'); const budget=this.store.get<Budget>('budgets',parent.value.rootId); invariant(budget && !budget.value.cancelled,'parent cancelled'); invariant(!this.cancelled(parentRunId),'parent cancelled');this.store.put('allocations',runId,{rootId:parent.value.rootId,parentRunId,cancelled:false,envelope,startedAt:this.now()},null); }
      else { this.store.put('allocations',runId,{rootId:runId,cancelled:false,envelope,startedAt:this.now()},null); this.store.put('budgets',runId,{envelope,startedAt:this.now(),cancelled:false},null); }
    });
  }
  private root(runId: string): string { const row=this.store.get<Allocation>('allocations',runId); invariant(row,'missing resource allocation'); return row.value.rootId; }
  private cancelled(runId:string):boolean {const allocation=this.store.get<Allocation>('allocations',runId);invariant(allocation,'missing allocation');return allocation.value.cancelled || (allocation.value.parentRunId?this.cancelled(allocation.value.parentRunId):false);}
  descendants(runId:string):string[] {return this.store.list<Allocation>('allocations').filter(row=>row.value.parentRunId===runId).flatMap(row=>[row.key,...this.descendants(row.key)]);}
  snapshot(runId: string): { requests: number; tokens: number; costUsd: number; elapsedMs: number; concurrent: number; cancelled: boolean } {
    const rootId=this.root(runId),budget=this.store.get<Budget>('budgets',rootId)!;
    const records=this.store.list<Reservation>('requests').map(r=>r.value).filter(r=>r.rootId===rootId);
    return { requests:records.length,tokens:records.reduce((a,r)=>a+r.charged.tokens,0),costUsd:records.reduce((a,r)=>a+r.charged.costUsd,0),elapsedMs:Math.max(this.now()-budget.value.startedAt,records.reduce((a,r)=>a+r.charged.elapsedMs,0)),concurrent:records.filter(r=>['reserved','dispatched','uncertain'].includes(r.request.status)).length,cancelled:budget.value.cancelled||this.cancelled(runId) };
  }
  private lineage(runId:string):string[] {const allocation=this.store.get<Allocation>('allocations',runId);invariant(allocation,'missing allocation');return [runId,...(allocation.value.parentRunId?this.lineage(allocation.value.parentRunId):[])];}
  private allocationUsage(runId:string): {requests:number;tokens:number;costUsd:number;elapsedMs:number;concurrent:number} {
    const allocation=this.store.get<Allocation>('allocations',runId)!.value;const ids=new Set([runId,...this.descendants(runId)]);const records=this.store.list<Reservation>('requests').map(r=>r.value).filter(r=>ids.has(r.request.runId));
    return {requests:records.length,tokens:records.reduce((a,r)=>a+r.charged.tokens,0),costUsd:records.reduce((a,r)=>a+r.charged.costUsd,0),elapsedMs:Math.max(this.now()-allocation.startedAt,records.reduce((a,r)=>a+r.charged.elapsedMs,0)),concurrent:records.filter(r=>['reserved','dispatched','uncertain'].includes(r.request.status)).length};
  }
  reserve(request: PhysicalRequest): void {
    validatePhysicalRequest(request); invariant(request.status==='reserved','reserve requires reserved status');
    this.store.transaction(()=>{
      invariant(!this.store.get('requests',request.id),'physical request identity already used');
      const rootId=this.root(request.runId),budget=this.store.get<Budget>('budgets',rootId)!.value,snapshot=this.snapshot(request.runId);
      if(request.parentRequestId) { const parent=this.store.get<Reservation>('requests',request.parentRequestId); invariant(parent?.value.rootId===rootId,'foreign parent request'); }
      const ceiling: RequestCeiling={ tokens:request.usage.inputTokens===null || request.usage.outputTokens===null ? this.defaultCeiling.tokens : request.usage.inputTokens+request.usage.outputTokens,costUsd:request.usage.costUsd??this.defaultCeiling.costUsd,elapsedMs:Math.max(request.usage.elapsedMs,this.defaultCeiling.elapsedMs) }; this.validateCeiling(ceiling);
      if(snapshot.cancelled || snapshot.requests+1>budget.envelope.maxRequests || snapshot.tokens+ceiling.tokens>budget.envelope.maxTokens || snapshot.costUsd+ceiling.costUsd>budget.envelope.maxCostUsd || snapshot.elapsedMs+ceiling.elapsedMs>budget.envelope.maxElapsedMs || snapshot.concurrent+1>budget.envelope.maxConcurrency) throw new BudgetExceeded('shared physical request budget exhausted or cancelled');
      for(const allocationId of this.lineage(request.runId)) {const allocation=this.store.get<Allocation>('allocations',allocationId)!.value,used=this.allocationUsage(allocationId),limit=allocation.envelope;if(used.requests+1>limit.maxRequests || used.tokens+ceiling.tokens>limit.maxTokens || used.costUsd+ceiling.costUsd>limit.maxCostUsd || used.elapsedMs+ceiling.elapsedMs>limit.maxElapsedMs || used.concurrent+1>limit.maxConcurrency)throw new BudgetExceeded('bounded allocation exhausted');}
      this.store.put('requests',request.id,{rootId,request,ceiling,charged:ceiling},null);
    });
  }
  private sameRequest(a: PhysicalRequest,b: PhysicalRequest):void {
    const {status:as,usage:au,...ai}=a;const {status:bs,usage:bu,...bi}=b;invariant(canonicalJson(ai)===canonicalJson(bi),'physical request identity changed');
  }
  dispatched(request: PhysicalRequest): void {
    validatePhysicalRequest(request);
    this.store.transaction(()=> { const row=this.store.get<Reservation>('requests',request.id); invariant(row && row.value.request.status==='reserved','request not reserved'); invariant(request.status==='dispatched','dispatch status required'); this.sameRequest(request,row.value.request); const snapshot=this.snapshot(request.runId); if(snapshot.cancelled || snapshot.elapsedMs>this.store.get<Budget>('budgets',row.value.rootId)!.value.envelope.maxElapsedMs) throw new BudgetExceeded('allocation cancelled or expired'); for(const id of this.lineage(request.runId))if(this.allocationUsage(id).elapsedMs>this.store.get<Allocation>('allocations',id)!.value.envelope.maxElapsedMs)throw new BudgetExceeded('bounded allocation expired');this.store.put('requests',request.id,{...row.value,request},row.revision); });
  }
  settle(request: PhysicalRequest): void {
    validatePhysicalRequest(request); validateUsage(request.usage); invariant(['succeeded','failed','uncertain'].includes(request.status),'invalid settlement');
    this.store.transaction(()=> {
      const row=this.store.get<Reservation>('requests',request.id); invariant(row && (['dispatched','uncertain'].includes(row.value.request.status) || (row.value.request.status==='reserved' && request.status==='failed')),'request was not dispatched');
      this.sameRequest(request,row.value.request);
      const charged=row.value.request.status==='reserved'?{tokens:0,costUsd:0,elapsedMs:0}:{tokens:request.usage.inputTokens===null || request.usage.outputTokens===null ? row.value.ceiling.tokens : request.usage.inputTokens+request.usage.outputTokens,costUsd:request.usage.costUsd??row.value.ceiling.costUsd,elapsedMs:request.status==='uncertain'?Math.max(request.usage.elapsedMs,row.value.ceiling.elapsedMs):request.usage.elapsedMs};
      if (charged.tokens>row.value.ceiling.tokens || charged.costUsd>row.value.ceiling.costUsd || charged.elapsedMs>row.value.ceiling.elapsedMs) { const budget=this.store.get<Budget>('budgets',row.value.rootId)!; this.store.put('budgets',row.value.rootId,{...budget.value,cancelled:true},budget.revision); }
      this.store.put('requests',request.id,{...row.value,request,charged},row.revision);
    });
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
  cancel(runId: string): void { this.store.transaction(()=>{const row=this.store.get<Allocation>('allocations',runId);invariant(row,'missing allocation');this.store.put('allocations',runId,{...row.value,cancelled:true},row.revision);}); }
  request(id: string): PhysicalRequest | undefined { return this.store.get<Reservation>('requests',id)?.value.request; }
}
