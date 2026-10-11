import { OperationalStore } from '../../storage/index.ts';
import { EffectJournal } from '../../effects/index.ts';
import { DurableRuntime, ResourceLedger } from '../index.ts';
import { assertAuthority, identity } from '../../contracts/common.ts';
import type { Authority, JsonValue, ResourceEnvelope } from '../../contracts/common.ts';
import type { Effect, EffectReceiver, InboundInput, ShellPort } from '../../contracts/execution/index.ts';
export const authority:Authority={generation:'g1',epoch:1,controlRevision:'c1'};
export const envelope:ResourceEnvelope={maxRequests:20,maxTokens:2000,maxCostUsd:10,maxElapsedMs:600000,maxConcurrency:3};
export const prompt={id:'test-prompt',fragments:[],requestDigest:identity('fixture')};
export const input:InboundInput={id:'i1',source:'direct',externalId:'m1',externalRevision:'1',actorId:'alice',authenticated:true,scope:{kind:'public'},value:'inspect test repair'};
export function setup(filename:string,shell:ShellPort,dispatch?:(effect:Effect)=>Promise<{outcome:'succeeded'|'failed'|'uncertain';value?:JsonValue}>) {
  const store=new OperationalStore({filename});let current=authority;
  const fence={assert(grant:Authority){assertAuthority(grant,current);}};
  const receiver:EffectReceiver={async dispatch(effect){fence.assert(effect.authority);const result=dispatch?await dispatch(effect):{outcome:'succeeded' as const,value:{command:effect.kind}};return {outcome:result.outcome,...(result.value!==undefined?{receipt:store.putJsonArtifact(result.value)}:{})};},async reconcile(effect){return {outcome:'unresolved',receipt:store.putArtifact({unknown:effect.id})};}};
  const effects=new EffectJournal(store,fence,receiver),resources=new ResourceLedger(store,{tokens:100,costUsd:1,elapsedMs:1000});
  return {store,effects,resources,runtime:new DurableRuntime({store,effects,resources,shell}),withdraw(){current={...authority,generation:'g2',epoch:2};return current;}};
}
