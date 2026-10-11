import { realpathSync, lstatSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import { canonicalJson, invariant, scopeAllows, validateArtifact, validateProvenance, validateScope } from '../contracts/common.ts';
import type { ArtifactRef, DataScope, JsonValue, ResourceEnvelope } from '../contracts/common.ts';
import type { DelegationTask, Effect, EffectReceiver } from '../contracts/execution/index.ts';
import type { AuthorityFence } from '../effects/index.ts';
import { OperationalStore } from '../storage/index.ts';
export interface ChildResult { childRunId:string; artifacts:ArtifactRef[]; observations?:JsonValue }
export interface DelegationGrant { scope:DataScope; writableRoots:string[]; allowedEffects:string[]; resources:ResourceEnvelope; modelProfiles:{provider:string;model:string;effort:string|null}[]; maxDepth:number; currentDepth:number; maxChildren:number; maxConcurrency:number }
export interface DelegationRecord { task:DelegationTask; depth:number; status:'created'|'running'|'completed'|'cancelled'|'uncertain'|'accepted'|'rejected'; result?:ChildResult; inspection?:ArtifactRef; verdict?:ArtifactRef }
export interface DelegationOptions {
  store:OperationalStore; fence:AuthorityFence;
  grantForParent:(runId:string)=>DelegationGrant;
  artifactScope:(artifact:ArtifactRef)=>DataScope;
  /** Synchronous host admission checks run for every packet and the complete batch before execution. */
  validateAdmission?:(tasks:DelegationTask[])=>void;
  executeChild:(task:DelegationTask,signal?:AbortSignal)=>Promise<ChildResult>;
  cancelChild?:(childRunId:string,reason:string)=>void;
}
function contains(parent:string,child:string):boolean {const p=relative(parent,child);return p===''||(!isAbsolute(p)&&p!=='..'&&!p.startsWith(`..${sep}`));}
function physical(path:string):string {invariant(isAbsolute(path),'delegated paths must be absolute');const real=realpathSync(path);invariant(real===path&&!lstatSync(path).isSymbolicLink(),'delegated paths must be canonical without symlinks');return real;}
/** The injected callback must admit and run a real ShellPort under the shared runtime/ledger. */
export class DelegationCoordinator implements EffectReceiver {
  readonly options:DelegationOptions;
  private active=new Map<string,AbortController>();
  constructor(options:DelegationOptions){this.options=options;}
  get(id:string):DelegationRecord|undefined{return this.options.store.get<DelegationRecord>('delegations',id)?.value;}
  private save(id:string,value:DelegationRecord):void {const row=this.options.store.get('delegations',id);this.options.store.put('delegations',id,value,row?.revision??null);}
  create(task:DelegationTask):DelegationRecord {
    invariant(task&&typeof task==='object'&&typeof task.id==='string'&&typeof task.parentRunId==='string'&&typeof task.objective==='string'&&Array.isArray(task.acceptanceCriteria)&&Array.isArray(task.inputs)&&Array.isArray(task.writablePaths)&&Array.isArray(task.allowedEffects)&&Array.isArray(task.cancellationConditions),'invalid delegation packet');
    const grant=this.options.grantForParent(task.parentRunId);validateScope(task.scope);validateProvenance(task.provenance);
    invariant(task.id&&task.objective.trim()&&task.parentGoalId&&task.outputLocation&&task.acceptanceCriteria.length>0&&task.acceptanceCriteria.every(a=>a.trim())&&task.cancellationConditions.length>0,'finite objective, acceptance, output and cancellation packet required');
    invariant(scopeAllows(grant.scope,task.scope),'child scope broadens parent');
    invariant(grant.modelProfiles.some(p=>canonicalJson(p)===canonicalJson(task.modelPolicy)),'model/effort profile unavailable');
    invariant(task.allowedEffects.every(a=>grant.allowedEffects.includes(a)),'child effect permission exceeds parent');
    for(const key of Object.keys(grant.resources) as (keyof ResourceEnvelope)[])invariant(Number.isFinite(task.resources[key])&&task.resources[key]>=0&&task.resources[key]<=grant.resources[key],'child resource envelope exceeds parent');
    for(const key of ['maxRequests','maxTokens','maxConcurrency'] as const)invariant(Number.isSafeInteger(task.resources[key]),'child resource counts must be integers');
    invariant(task.resources.maxConcurrency>=1&&task.resources.maxElapsedMs>0,'child concurrency and time must be positive');
    const depth=grant.currentDepth+1;
    invariant(Number.isSafeInteger(grant.currentDepth)&&grant.currentDepth>=0&&Number.isSafeInteger(task.maxDepth)&&task.maxDepth>=depth&&task.maxDepth<=grant.maxDepth,'delegation depth exceeds grant');
    task.inputs.forEach(ref=>{validateArtifact(ref);this.options.store.readArtifact(ref);invariant(scopeAllows(this.options.artifactScope(ref),task.scope),'child input discloses restricted artifact');});
    const paths=task.writablePaths.map(physical),roots=grant.writableRoots.map(physical);
    invariant(paths.length>0&&new Set(paths).size===paths.length&&paths.every(p=>roots.some(root=>contains(root,p))),'child workspace exceeds parent writable roots');
    invariant(paths.every((p,i)=>paths.every((q,j)=>i===j||!contains(p,q)&&!contains(q,p))),'child paths overlap');
    this.options.validateAdmission?.([task]);
    const all=this.options.store.list<DelegationRecord>('delegations');
    const existing=this.get(task.id);if(existing){invariant(canonicalJson(existing.task)===canonicalJson(task),'task id changed');return existing;}
    invariant(all.filter(r=>r.value.task.parentRunId===task.parentRunId).length<grant.maxChildren,'child count exceeds grant');
    for(const row of all.filter(r=>!['accepted','rejected','cancelled'].includes(r.value.status)))for(const p of paths)for(const q of row.value.task.writablePaths)invariant(!contains(p,q)&&!contains(q,p),'workspace already owned by another child');
    const record:DelegationRecord={task,depth,status:'created'};this.save(task.id,record);return record;
  }
  async start(id:string,signal?:AbortSignal):Promise<DelegationRecord> {
    const record=this.get(id);invariant(record?.status==='created','child is not ready; uncertain child cannot replay');
    const grant=this.options.grantForParent(record.task.parentRunId);
    const siblings=this.options.store.list<DelegationRecord>('delegations').filter(r=>r.value.task.parentRunId===record.task.parentRunId&&r.value.status==='running');
    invariant(siblings.length<grant.maxConcurrency,'delegation concurrency exhausted');signal?.throwIfAborted();
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new Error('child elapsed limit')),record.task.resources.maxElapsedMs),abort=()=>controller.abort(signal?.reason);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();this.active.set(id,controller);this.save(id,{...record,status:'running'});
    try {
      const result=await this.options.executeChild(record.task,controller.signal);
      invariant(result.childRunId!==record.task.parentRunId&&result.childRunId,'child must have a separate runtime identity');
      result.artifacts.forEach(ref=>{validateArtifact(ref);this.options.store.readArtifact(ref);invariant(scopeAllows(this.options.artifactScope(ref),grant.scope),'child result disclosure exceeds parent');});
      const next:DelegationRecord={...record,status:controller.signal.aborted?'cancelled':'completed',result};this.save(id,next);return next;
    } catch(error) {
      const next:DelegationRecord={...record,status:controller.signal.aborted?'cancelled':'uncertain'};this.save(id,next);throw error;
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);this.active.delete(id);}
  }
  cancel(id:string,reason:string):void {const record=this.get(id);invariant(record,'missing child');this.active.get(id)?.abort(new Error(reason));if(record.result)this.options.cancelChild?.(record.result.childRunId,reason);if(!this.active.has(id))this.save(id,{...record,status:'cancelled'});}
  /** Parent reads immutable artifact bytes. Candidate prose alone cannot create this inspection receipt. */
  inspect(id:string):{artifacts:{ref:ArtifactRef;bytes:Uint8Array}[];receipt:ArtifactRef} {
    const record=this.get(id);invariant(record?.status==='completed'&&record.result&&record.result.artifacts.length>0,'completed child artifacts required');
    const artifacts=record.result.artifacts.map(ref=>({ref,bytes:this.options.store.readArtifact(ref)}));
    const receipt=this.options.store.putJsonArtifact({taskId:id,childRunId:record.result.childRunId,inspected:artifacts.map(a=>({sha256:a.ref.sha256,bytes:a.bytes.length}))});this.save(id,{...record,inspection:receipt});return {artifacts,receipt};
  }
  /** Called by the trusted parent inspector after applying task acceptance criteria, never by child text. */
  judge(id:string,inspection:ArtifactRef,checks:{criterion:string;passed:boolean;evidence:ArtifactRef}[]):DelegationRecord {
    const record=this.get(id);invariant(record?.status==='completed'&&record.inspection&&canonicalJson(record.inspection)===canonicalJson(inspection),'parent must inspect before acceptance');
    invariant(checks.length===record.task.acceptanceCriteria.length&&record.task.acceptanceCriteria.every(c=>checks.filter(k=>k.criterion===c).length===1),'all acceptance criteria require checks');checks.forEach(c=>{invariant(typeof c.passed==='boolean','check verdict required');this.options.store.readArtifact(c.evidence);});
    const verdict=this.options.store.putJsonArtifact(JSON.parse(JSON.stringify({taskId:id,inspection,checks})) as JsonValue);const next:DelegationRecord={...record,status:checks.every(c=>c.passed)?'accepted':'rejected',verdict};this.save(id,next);return next;
  }
  recover():string[]{const ids:string[]=[];for(const row of this.options.store.list<DelegationRecord>('delegations'))if(row.value.status==='running'){this.save(row.key,{...row.value,status:'uncertain'});ids.push(row.key);}return ids;}
  /** Register the whole finite packet set atomically before any child starts. */
  createBatch(tasks:DelegationTask[],parentRunId:string):DelegationRecord[] {
    invariant(Array.isArray(tasks)&&tasks.length>0,'nonempty child batch required');
    const grant=this.options.grantForParent(parentRunId);
    invariant(tasks.length<=grant.maxConcurrency,'child batch exceeds concurrency grant');
    invariant(new Set(tasks.map(task=>task.id)).size===tasks.length,'duplicate child batch identity');
    return this.options.store.transaction(()=> {
      const running=this.options.store.list<DelegationRecord>('delegations').filter(row=>row.value.task.parentRunId===parentRunId&&row.value.status==='running').length;
      invariant(running+tasks.length<=grant.maxConcurrency,'delegation concurrency exhausted');
      this.options.validateAdmission?.(tasks);
      const records=tasks.map(task=> {invariant(task.parentRunId===parentRunId,'foreign delegation parent');const record=this.create(task);invariant(record.status==='created','child is not ready; uncertain child cannot replay');return record;});
      return records;
    });
  }
  async dispatch(effect:Effect,signal?:AbortSignal):Promise<Awaited<ReturnType<EffectReceiver['dispatch']>>> {
    this.options.fence.assert(effect.authority);
    try {
      if(effect.kind==='delegation.start_batch') {
        const payload=effect.payload as unknown as {tasks:DelegationTask[]};
        const registered=this.createBatch(payload?.tasks,effect.runId);
        this.options.fence.assert(effect.authority);signal?.throwIfAborted();
        // Wait for every child, including failed/cancelled siblings. Never detach work.
        const settled=await Promise.allSettled(registered.map(record=>this.start(record.task.id,signal)));
        const children=settled.map((result,index)=>({record:this.get(registered[index]!.task.id)!,...(result.status==='rejected'?{error:String(result.reason)}:{})}));
        // Cancellation cannot prove that already dispatched child work never applied.
        const outcome=children.every(child=>child.record.status==='completed')?'succeeded':children.some(child=>['uncertain','cancelled'].includes(child.record.status))?'uncertain':'failed';
        return {outcome,receipt:this.options.store.putJsonArtifact(JSON.parse(JSON.stringify({children})) as JsonValue)};
      }
      invariant(effect.kind==='delegation.start','only bounded delegation starts are model callable');const task=effect.payload as unknown as DelegationTask;invariant(task.parentRunId===effect.runId,'foreign delegation parent');this.create(task);this.options.fence.assert(effect.authority);const record=await this.start(task.id,signal);return {outcome:record.status==='completed'?'succeeded':'failed',receipt:this.options.store.putJsonArtifact(JSON.parse(JSON.stringify(record)) as JsonValue)};}
    catch(error){const id=effect.payload&&typeof effect.payload==='object'&&!Array.isArray(effect.payload)&&typeof effect.payload.id==='string'?effect.payload.id:undefined;return {outcome:id&&this.get(id)?.status==='uncertain'?'uncertain':'failed',receipt:this.options.store.putJsonArtifact({error:error instanceof Error?error.message:String(error)})};}
  }
  async reconcile(effect:Effect):Promise<Awaited<ReturnType<EffectReceiver['reconcile']>>> {return {outcome:'unresolved',receipt:this.options.store.putJsonArtifact({effectId:effect.id,reason:'inspect durable child run; no automatic replay'})};}
}
