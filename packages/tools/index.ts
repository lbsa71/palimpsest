import { canonicalJson, invariant, scopeAllows } from '../contracts/common.ts';
import type { DataScope, JsonValue } from '../contracts/common.ts';
import type { Effect, EffectReceiver } from '../contracts/execution/index.ts';
import type { AuthorityFence } from '../effects/index.ts';
import { OperationalStore } from '../storage/index.ts';
import { WorkspaceTools, WorkspaceFailure, workspaceOperations } from './workspace/index.ts';
import type { WorkspaceOperation } from './workspace/index.ts';
import { executeCommand } from './commands/index.ts';
import type { CommandPolicy } from './commands/index.ts';
import { fetchPublic } from './information/research.ts';
import type { ResearchPolicy } from './information/research.ts';
export { WorkspaceTools, workspaceOperations, executeCommand, fetchPublic };
export const modelToolToEffectKind:Readonly<Record<string,string>> = Object.freeze({
  ...Object.fromEntries(workspaceOperations.map(operation=>[`workspace_${operation}`,`workspace.${operation}`])),
  command_run:'command.run',research_fetch:'research.fetch',speech_send:'speech.send',delegation_start:'delegation.start',delegation_start_batch:'delegation.start_batch',
});
export type { WorkspaceOptions, WorkspaceOperation } from './workspace/index.ts';
export type { CommandPolicy, ResearchPolicy };
export interface ToolGrant { scope: DataScope; workspace?: CommandPolicy; research?: ResearchPolicy; actions: string[] }
export interface ToolReceiverOptions { store: OperationalStore; fence: AuthorityFence; grantForRun:(runId:string)=>ToolGrant; speechReceiver?:EffectReceiver; delegationReceiver?:EffectReceiver }
function object(value:JsonValue):{[key:string]:JsonValue} {invariant(value!==null&&typeof value==='object'&&!Array.isArray(value),'object tool arguments required');return value;}
/** Trusted grants are selected by durable run identity, never by model-supplied fields. */
export class ToolEffectReceiver implements EffectReceiver {
  readonly options: ToolReceiverOptions;
  private queues=new Map<string,Promise<unknown>>();
  constructor(options:ToolReceiverOptions){this.options=options;}
  private async serialized<T>(key:string,action:()=>Promise<T>):Promise<T> {
    const previous=this.queues.get(key)??Promise.resolve();
    const next=previous.catch(()=>undefined).then(action);this.queues.set(key,next);
    try{return await next;}finally{if(this.queues.get(key)===next)this.queues.delete(key);}
  }
  async dispatch(effect:Effect,signal?:AbortSignal):Promise<Awaited<ReturnType<EffectReceiver['dispatch']>>> {
    effect={...effect,kind:modelToolToEffectKind[effect.kind]??effect.kind};
    const grant=structuredClone(this.options.grantForRun(effect.runId));let delegatedStarted=false;
    const check=()=> {signal?.throwIfAborted();this.options.fence.assert(effect.authority);invariant(canonicalJson(this.options.grantForRun(effect.runId))===canonicalJson(grant),'tool grant changed before dispatch');invariant(grant.actions.some(action=>(modelToolToEffectKind[action]??action)===effect.kind),'tool action is not granted');invariant(scopeAllows(effect.scope,grant.scope),'tool disclosure scope exceeds source');};
    try {
      check();
      if(effect.kind==='speech.send') {invariant(this.options.speechReceiver,'speech receiver unavailable');delegatedStarted=true;return await this.options.speechReceiver.dispatch(effect,signal);}
      if(effect.kind.startsWith('delegation.')) {invariant(this.options.delegationReceiver,'delegation receiver unavailable');delegatedStarted=true;return await this.options.delegationReceiver.dispatch(effect,signal);}
      const args=object(effect.payload);
      const work=async()=> {
        check();let value:JsonValue;
        if(effect.kind.startsWith('workspace.')) {
          invariant(grant.workspace,'workspace not granted');
          const operation=effect.kind.slice('workspace.'.length) as WorkspaceOperation;
          invariant(workspaceOperations.includes(operation),'unknown workspace action');
          value=await new WorkspaceTools(grant.workspace).execute(operation,args,signal);
        } else if(effect.kind==='command.run') {
          invariant(grant.workspace,'command workspace not granted');
          const receipt=await executeCommand(grant.workspace,args as unknown as Parameters<typeof executeCommand>[1],signal);
          value=JSON.parse(JSON.stringify(receipt)) as JsonValue;
          return {outcome:receipt.stoppedFor?'uncertain' as const:receipt.exitCode===0?'succeeded' as const:'failed' as const,receipt:this.options.store.putJsonArtifact(value)};
        } else if(effect.kind==='research.fetch') {invariant(grant.research,'research access not granted');invariant(typeof args.url==='string','research URL required');value=await fetchPublic(args.url,grant.research,signal);}
        else throw new Error('unknown tool action');
        return {outcome:'succeeded' as const,receipt:this.options.store.putJsonArtifact(value)};
      };
      return grant.workspace&&(effect.kind.startsWith('workspace.')||effect.kind==='command.run')?await this.serialized(grant.workspace.workspace,work):await work();
    } catch(error) {
      // Interrupted mutations remain uncertain; no implicit replay is granted by an error receipt.
      return {outcome:delegatedStarted||error instanceof WorkspaceFailure&&error.mayHaveApplied?'uncertain':'failed',receipt:this.options.store.putJsonArtifact({error:error instanceof Error?error.message:String(error),tool:effect.kind})};
    }
  }
  async reconcile(effect:Effect):Promise<Awaited<ReturnType<EffectReceiver['reconcile']>>> {
    effect={...effect,kind:modelToolToEffectKind[effect.kind]??effect.kind};
    if(effect.kind==='speech.send'&&this.options.speechReceiver)return this.options.speechReceiver.reconcile(effect);
    if(effect.kind.startsWith('delegation.')&&this.options.delegationReceiver)return this.options.delegationReceiver.reconcile(effect);
    // A lost local mutation receipt is also uncertain; inspect the workspace before a new operation.
    return {outcome:'unresolved',receipt:this.options.store.putJsonArtifact({effectId:effect.id,reason:'physical outcome requires explicit inspection; no automatic replay'})};
  }
}
const string={type:'string'};
const workspaceRequired:Record<WorkspaceOperation,string[]>={discover:[],search:['text'],read:['path'],write:['path','content','expectedSha256'],patch:['path','oldText','newText','expectedSha256'],delete:['path','expectedSha256'],move:['path','to','expectedSha256'],diff:['path','before']};
const artifactSchema={type:'object',properties:{uri:string,sha256:{type:'string',pattern:'^[a-f0-9]{64}$'}},required:['uri','sha256'],additionalProperties:false};
const strings={type:'array',items:string};
const scopeSchema={anyOf:[{type:'object',properties:{kind:{const:'public'}},required:['kind'],additionalProperties:false},{type:'object',properties:{kind:{const:'restricted'},principals:{...strings,minItems:1,uniqueItems:true}},required:['kind','principals'],additionalProperties:false}]};
const resourceSchema={type:'object',properties:{maxRequests:{type:'integer',minimum:0},maxTokens:{type:'integer',minimum:0},maxCostUsd:{type:'number',minimum:0},maxElapsedMs:{type:'number',exclusiveMinimum:0},maxConcurrency:{type:'integer',minimum:1}},required:['maxRequests','maxTokens','maxCostUsd','maxElapsedMs','maxConcurrency'],additionalProperties:false};
const delegationTool = {name:'delegation_start',description:'Run a finite child objective with explicit acceptance, isolated workspace, scope, model and cumulative resources; the parent must inspect artifacts before acceptance',parameters:{type:'object',properties:{id:string,parentRunId:string,parentGoalId:string,objective:string,inputs:{type:'array',items:artifactSchema},provenance:{type:'object',properties:{sourceIds:strings,actorId:string,recordedAt:string,derivation:{type:'string',enum:['observed','interpreted','summarized','imported']}},required:['sourceIds','actorId','recordedAt','derivation'],additionalProperties:false},scope:scopeSchema,acceptanceCriteria:{...strings,minItems:1},writablePaths:{...strings,minItems:1},allowedEffects:strings,resources:resourceSchema,modelPolicy:{type:'object',properties:{provider:string,model:string,effort:{type:['string','null']}},required:['provider','model','effort'],additionalProperties:false},outputLocation:string,cancellationConditions:{...strings,minItems:1},maxDepth:{type:'integer',minimum:1}},required:['id','parentRunId','parentGoalId','objective','inputs','provenance','scope','acceptanceCriteria','writablePaths','allowedEffects','resources','modelPolicy','outputLocation','cancellationConditions','maxDepth'],additionalProperties:false}};
/** Data-only schemas consumed by the Pi bridge; no persona instructions. */
export const toolDefinitions = [
  ...workspaceOperations.map(operation=>({name:`workspace_${operation}`,description:`${operation} files in the granted exclusive workspace; mutations require observed digests`,parameters:{type:'object',properties:{path:string,to:string,text:string,content:string,oldText:string,newText:string,before:string,expectedSha256:{type:['string','null']},startLine:{type:'integer',minimum:1},endLine:{type:'integer',minimum:1}},required:workspaceRequired[operation],additionalProperties:false}})),
  {name:'command_run',description:'Execute a finite command in the granted namespace and retain actual exit/output evidence',parameters:{type:'object',properties:{executable:string,args:{type:'array',items:string},timeoutMs:{type:'integer',minimum:1},maxOutputBytes:{type:'integer',minimum:1}},required:['executable','args'],additionalProperties:false}},
  {name:'research_fetch',description:'Fetch bounded attributed public HTTPS evidence from granted hosts',parameters:{type:'object',properties:{url:string},required:['url'],additionalProperties:false}},
  {name:'speech_send',description:'Send explicit speech through the durable communication receiver',parameters:{type:'object',properties:{channel:string,threadTs:string,text:string,kind:{type:'string',enum:['message','progress','report']},obligationId:string,obligationRevision:{type:'integer'},reportRevision:{type:'integer'}},required:['channel','text'],additionalProperties:false}},
  delegationTool,
  {name:'delegation_start_batch',description:'Run a bounded batch of disjoint finite child tasks concurrently, wait for every result and inspect each artifact before accepting or rejecting it; use prepared workspaces and the host grant',parameters:{type:'object',properties:{tasks:{type:'array',minItems:1,items:delegationTool.parameters}},required:['tasks'],additionalProperties:false}},
] as const;
