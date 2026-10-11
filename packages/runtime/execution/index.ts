import { randomUUID } from 'node:crypto';
import { assertAuthority, canonicalJson, identity, invariant } from '../../contracts/common.ts';
import type { Authority, JsonValue, ResourceEnvelope } from '../../contracts/common.ts';
import { inputIdentity, transitionRun, validateObservation, validateRun, validateCheckpoint } from '../../contracts/execution/index.ts';
import type { Effect, InboundInput, Observation, Run, ShellBridge, ShellCheckpoint, ShellPort, ShellResult, ToolCall } from '../../contracts/execution/index.ts';
import { validateCapturedPrompt } from '../../contracts/control/index.ts';
import type { PhysicalRequest, PromptManifest } from '../../contracts/control/index.ts';
import { OperationalStore } from '../../storage/index.ts';
import { EffectJournal } from '../../effects/index.ts';
import { BudgetExceeded, ResourceLedger } from '../resources/index.ts';
export class UncertainEffect extends Error { override name='UncertainEffect'; }
interface InboxEntry { input: InboundInput; runId: string }
interface ExecutionState { checkpoint?: ShellCheckpoint; lastResult?: ShellResult; failure?: string; messageSequence?: number }
export interface RuntimeOptions { store: OperationalStore; shell: ShellPort; effects: EffectJournal; resources: ResourceLedger; now?: ()=>number;
  /** Host eligibility, checked under the same operational write lock as the running claim. */
  canResume?: (run: Run) => boolean;
}
export interface PreparedResume {
  run: Run; deferred: boolean;
  /** Invoke once after the claim transaction commits; never execute a shell inside a write lock. */
  execute(prompt: PromptManifest, signal?: AbortSignal): Promise<Run>;
}
/** Durable host orchestration; the selected shell retains cognition, while this owns effects and receipts. */
export class DurableRuntime {
  readonly store: OperationalStore; readonly shell: ShellPort; readonly effects: EffectJournal; readonly resources: ResourceLedger; readonly now: ()=>number;
  private active = new Map<string,AbortController>();
  readonly canResume?: (run: Run) => boolean;
  constructor(options: RuntimeOptions) { this.store=options.store;this.shell=options.shell;this.effects=options.effects;this.resources=options.resources;this.now=options.now??Date.now;this.canResume=options.canResume; }
  getRun(id: string): Run | undefined { return this.store.get<Run>('runs',id)?.value; }
  admit(input: InboundInput, authority: Authority, envelope: ResourceEnvelope, parentRunId?: string): Run {
    invariant(input.authenticated,'input requires authenticated principal');
    return this.store.transaction(()=> {
      const id=inputIdentity(input),existing=this.store.get<InboxEntry>('inbox',id);
      if(existing) { invariant(canonicalJson(existing.value.input)===canonicalJson(input),'conflicting duplicate input'); return this.getRun(existing.value.runId)!; }
      const run:Run={id:`run:${id}`,status:'ready',revision:0,authority,scope:input.scope};validateRun(run);
      this.store.put('runs',run.id,run,null);this.resources.allocate(run.id,envelope,parentRunId);
      this.store.put('inbox',id,{input,runId:run.id},null);this.store.append({id:`input:${id}`,stream:run.id,type:'admitted',data:input});return run;
    });
  }
  steer(runId: string, input: InboundInput): void {
    invariant(input.authenticated,'steering requires authenticated principal');
    this.store.transaction(()=> { const run=this.getRun(runId);invariant(run && !['completed','cancelled'].includes(run.status),'run cannot be steered');
      invariant(canonicalJson(input.scope)===canonicalJson(run.scope),'steering audience mismatch');
      this.store.append({id:`steer:${runId}:${inputIdentity(input)}`,stream:runId,type:'steering',data:input});
    });
    this.active.get(runId)?.abort(new Error('durable steering received'));
  }
  private status(runId:string,status:Run['status']):Run {
    return this.store.transaction(()=> {const row=this.store.get<Run>('runs',runId);invariant(row,'missing run');const next=transitionRun(row.value,status);this.store.put('runs',runId,next,row.revision);this.store.append({id:randomUUID(),stream:runId,type:'status',data:next});return next;});
  }
  cancel(runId: string, requestedBy: string, reason: string): void {
    this.store.transaction(()=> {const run=this.getRun(runId);invariant(run,'missing run');if(['completed','cancelled'].includes(run.status))return;
      this.store.append({id:randomUUID(),stream:runId,type:'cancelled',data:{requestedBy,reason,requestedAt:new Date(this.now()).toISOString()}});this.status(runId,'cancelled');this.resources.cancel(runId);
    });this.active.get(runId)?.abort(new Error(reason));
    for(const childId of this.resources.descendants(runId)) {const child=this.getRun(childId);if(child && !['completed','cancelled'].includes(child.status))this.cancel(childId,requestedBy,reason);}
  }
  /** Call once on host startup, after exclusive process authority is acquired. */
  recover(): string[] {
    return this.store.transaction(()=> {this.effects.recoverDispatched();this.resources.recoverDispatched();this.resources.recoverUndispatchedEffects();
      return this.store.list<Run>('runs').filter(r=>r.value.status==='running').map(r=>{this.status(r.key,this.effects.unresolved(r.key).length?'blocked':'waiting');return r.key;});
    });
  }
  /** Explicit takeover changes the worker grant, retaining all observations and uncertain effects. */
  adopt(runId:string,authority:Authority):void {
    this.effects.fence.assert(authority);
    this.store.transaction(()=>{const row=this.store.get<Run>('runs',runId);invariant(row && row.value.status!=='running','cannot adopt active run');invariant(!['completed','cancelled'].includes(row.value.status),'cannot adopt terminal run');this.effects.adoptUndispatched(runId,authority);const next={...row.value,authority,revision:row.value.revision+1};this.store.put('runs',runId,next,row.revision);this.store.append({id:randomUUID(),stream:runId,type:'adopted',data:next});});
  }
  observations(runId:string):Observation[] {return this.store.list<Observation>('observations').map(r=>r.value).filter(o=>o.runId===runId);}
  private execution(runId:string):ExecutionState {return this.store.get<ExecutionState>('execution',runId)?.value??{};}
  private saveExecution(runId:string,value:ExecutionState):void {const row=this.store.get('execution',runId);this.store.put('execution',runId,value,row?.revision??null);}
  bridge(runId:string,authority:Authority,messageSequence?:number):ShellBridge {
    const runtime=this;
    function allowed():Run {const run=runtime.getRun(runId);invariant(run?.status==='running','run ownership withdrawn');assertAuthority(run.authority,authority);runtime.effects.fence.assert(authority);return run;}
    return {
      async execute(call:ToolCall,signal?:AbortSignal):Promise<Observation> {
        allowed();invariant(call.runId===runId,'foreign tool call');signal?.throwIfAborted();
        const existing=runtime.store.get<Observation>('observations',`tool:${call.id}`)?.value;
        const effect:Effect={id:`tool:${call.id}`,runId,stepId:call.stepId,kind:call.name,payload:call.arguments,scope:runtime.getRun(runId)!.scope,authority:runtime.effects.get(`tool:${call.id}`)?.authority??authority,status:'pending',revision:0};
        let current=runtime.effects.ensure(effect);
        if(existing) return existing;
        if(runtime.effects.unresolved(runId).length) throw new UncertainEffect('prior effect requires reconciliation');
        if(current.status==='pending') {
          const digest=identity(call);const request:PhysicalRequest={id:`tool:${call.id}`,runId,purpose:'reasoning',provider:'effect-receiver',model:call.name,promptManifestId:`tool:${call.id}`,requestDigest:digest,reservationId:`tool:${call.id}`,status:'reserved',usage:{requests:1,inputTokens:0,outputTokens:0,costUsd:0,elapsedMs:0}};
          runtime.store.transaction(()=>{runtime.resources.reserve(request);runtime.effects.authorize(current.id,request.reservationId,authority);});
          current=runtime.effects.get(current.id)!;
        }
        if(current.status==='authorized') {
          const request=runtime.resources.request(current.reservationId!)!;
          const started=runtime.now();current=await runtime.effects.dispatch(current.id,authority,signal,()=>runtime.resources.dispatched({...request,status:'dispatched'}));
          runtime.resources.settle({...request,status:current.status==='succeeded'?'succeeded':current.status==='failed'?'failed':'uncertain',usage:{...request.usage,elapsedMs:Math.max(0,runtime.now()-started)}});
        }
        if(current.status==='uncertain'||current.status==='dispatched')throw new UncertainEffect('tool outcome unknown; reconcile before another effect');
        let value:JsonValue={effectId:current.id,status:current.status};
        if(current.receipt) {try {value=runtime.store.readJsonArtifact(current.receipt);}catch {value={receipt:current.receipt.uri,sha256:current.receipt.sha256,status:current.status};}}
        const observation:Observation={id:current.id,runId,stepId:call.stepId,sourceId:call.id,kind:current.status==='succeeded'?'result':'error',value,provenance:{sourceIds:[current.id],actorId:'effect-receiver',recordedAt:new Date(runtime.now()).toISOString(),derivation:'observed'}};validateObservation(observation);
        runtime.store.transaction(()=>{runtime.store.put('observations',observation.id,observation,null);runtime.store.append({id:randomUUID(),stream:runId,type:'observation',data:observation});});return observation;
      },
      async capturePrompt(manifest:PromptManifest,payload:string):Promise<void> {allowed();validateCapturedPrompt(manifest,payload);runtime.store.transaction(()=>{const artifact=runtime.store.putArtifact(payload);const row=runtime.store.get('prompts',manifest.id);const value={manifest,artifact};if(row)invariant(canonicalJson(row.value)===canonicalJson(value),'prompt id reused');else runtime.store.put('prompts',manifest.id,value,null);});},
      async reserve(request:PhysicalRequest):Promise<void> {allowed();invariant(request.runId===runId,'foreign physical request');const prompt=runtime.store.get<{manifest:PromptManifest}>('prompts',request.promptManifestId);invariant(prompt?.value.manifest.requestDigest===request.requestDigest,'uncaptured physical payload');runtime.resources.reserve(request);},
      async dispatched(request:PhysicalRequest):Promise<void> {allowed();invariant(request.runId===runId,'foreign physical request');runtime.resources.dispatched(request);},
      async settle(receipt:PhysicalRequest):Promise<void> {invariant(receipt.runId===runId,'foreign physical receipt');runtime.resources.settle(receipt);},
      async persistCheckpoint(id:string,revision:number,shell:string,content:JsonValue):Promise<ShellCheckpoint> {allowed();invariant(id===runId,'foreign checkpoint');const run=runtime.getRun(id);invariant(run && revision===run.revision,'checkpoint revision changed');const index=typeof content==='object' && content!==null && !Array.isArray(content) ? content.observationIds : undefined;const ids=Array.isArray(index)?index:runtime.observations(id).map(o=>o.id);invariant(ids.every(o=>typeof o==='string' && runtime.store.get<Observation>('observations',o)?.value.runId===id),'checkpoint cites missing observation');invariant(new Set(ids).size===ids.length,'duplicate checkpoint observation');const checkpoint:ShellCheckpoint={runId:id,revision,shell,artifact:runtime.store.putJsonArtifact(content),observationIds:ids as string[]};runtime.store.transaction(()=>{runtime.saveExecution(id,{...runtime.execution(id),checkpoint,...(messageSequence!==undefined?{messageSequence}:{})});runtime.store.append({id:randomUUID(),stream:id,type:'checkpoint',data:checkpoint});});return checkpoint;},
      async readCheckpoint(checkpoint:ShellCheckpoint):Promise<JsonValue> {allowed();invariant(checkpoint.runId===runId,'foreign checkpoint');const saved=runtime.execution(runId).checkpoint;invariant(saved && canonicalJson(saved.artifact)===canonicalJson(checkpoint.artifact) && saved.shell===checkpoint.shell && canonicalJson(saved.observationIds)===canonicalJson(checkpoint.observationIds),'checkpoint is not assigned to this run');return runtime.store.readJsonArtifact(checkpoint.artifact);},
    };
  }
  /** A scheduler may commit its selection and this claim in one synchronous transaction. */
  prepareResume(runId:string):PreparedResume {
    const claim = this.store.transaction(() => {
      let run=this.getRun(runId);invariant(run,'missing run');invariant(!this.active.has(runId),'run already active');this.effects.fence.assert(run.authority);
      if(['completed','cancelled'].includes(run.status))return {run,started:false,deferred:false};
      if(this.canResume && !this.canResume(run))return {run,started:false,deferred:true};
      if(this.effects.unresolved(runId).length) {if(run.status==='waiting')run=this.status(runId,'blocked');return {run,started:false,deferred:false};}
      if(run.status==='waiting'||run.status==='blocked')run=this.status(runId,'ready');
      invariant(run.status==='ready','run owned by another execution');return {run:this.status(runId,'running'),started:true,deferred:false};
    });
    let executed=false;
    return {run:claim.run,deferred:claim.deferred,execute:async(prompt,signal)=>{
      invariant(!executed,'prepared runtime claim already executed');executed=true;
      return claim.started?this.executeClaim(claim.run,prompt,signal):claim.run;
    }};
  }
  async resume(runId:string,prompt:PromptManifest,signal?:AbortSignal):Promise<Run> {
    return this.prepareResume(runId).execute(prompt,signal);
  }
  private async executeClaim(run:Run,prompt:PromptManifest,signal?:AbortSignal):Promise<Run> {
    const runId=run.id,current=this.getRun(runId);invariant(current,'missing claimed run');
    if(['completed','cancelled'].includes(current.status))return current;
    invariant(current.status==='running' && current.revision===run.revision && identity(current.authority)===identity(run.authority),'runtime claim changed before execution');
    const controller=new AbortController();this.active.set(runId,controller);const abort=()=>controller.abort(signal?.reason);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    try {
      this.effects.fence.assert(run.authority);signal?.throwIfAborted();
      const state=this.execution(runId);
      const entries=this.store.events<InboundInput>(runId,state.messageSequence??0).filter(e=>e.type==='admitted'||e.type==='steering');
      const messageSequence=entries.at(-1)?.sequence??state.messageSequence??0;
      const checkpoint=state.checkpoint?{...state.checkpoint,revision:run.revision}:undefined;
      const messages=entries.map(e=>({role:'user',content:typeof e.data.value==='string'?e.data.value:canonicalJson(e.data.value),timestamp:this.now()}));
      const result=await this.shell.run({run,messages,prompt,...(checkpoint?{checkpoint}:{})},this.bridge(runId,run.authority,messageSequence),controller.signal);
      if(result.checkpoint){validateCheckpoint(result.checkpoint,run);const issued=this.execution(runId).checkpoint;invariant(issued && canonicalJson({...issued,revision:run.revision})===canonicalJson(result.checkpoint),'shell returned an unissued checkpoint');this.store.readArtifact(result.checkpoint.artifact);}
      this.store.transaction(()=> {for(const observation of result.observations) {validateObservation(observation);invariant(observation.runId===runId,'foreign shell observation');const row=this.store.get<Observation>('observations',observation.id);invariant(row && canonicalJson(row.value)===canonicalJson(observation),'shell returned an unissued or changed observation');}this.saveExecution(runId,{...this.execution(runId),lastResult:result,messageSequence,...(result.checkpoint?{checkpoint:result.checkpoint}:{})});});
      if(this.getRun(runId)!.status==='cancelled')return this.getRun(runId)!;
      if(this.effects.unresolved(runId).length)return this.status(runId,'blocked');
      return this.status(runId,result.status==='completed'?'completed':result.status==='blocked'?'blocked':'waiting');
    } catch(error) {
      if(this.getRun(runId)!.status==='cancelled')return this.getRun(runId)!;
      this.saveExecution(runId,{...this.execution(runId),failure:error instanceof Error?error.message:String(error)});
      return this.status(runId,error instanceof BudgetExceeded||error instanceof UncertainEffect?'blocked':'waiting');
    } finally {signal?.removeEventListener('abort',abort);this.active.delete(runId);}
  }
}
