import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { getEventListeners } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OperationalStore } from '../packages/storage/index.ts';
import { DevelopmentalMemory } from '../packages/development/index.ts';
import { DurableRuntime, ResourceLedger } from '../packages/runtime/index.ts';
import { EffectJournal } from '../packages/effects/index.ts';
import { FairScheduler, InitiativeRegistry, InitiativeRunner, ObligationRegistry } from '../packages/initiative/index.ts';
import { canonicalJson, identity } from '../packages/contracts/index.ts';
const at='2040-01-01T00:00:00.000Z',scope={kind:'public'} as const,resources={maxRequests:10,maxTokens:100,maxCostUsd:1,maxElapsedMs:10000,maxConcurrency:1};
const policy={windowMs:1000,maxSlicesPerWindow:5,maxLifetimeSlices:10,quantumMs:100,idleRetryMs:200,maxStalls:2,resources};
async function capture(task:()=>Promise<unknown>){try{await task();return {threw:false,value:undefined};}catch(value){return {threw:true,value};}}
function fixture(t:TestContext,operation:unknown,cleanup:unknown,where:'selection'|'delivery'|'none',failCleanup=true){
  const dir=mkdtempSync(join(tmpdir(),'initiative-dual-failure-')),store=new OperationalStore({filename:join(dir,'state.sqlite')});t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
  let failing=true,cancellations=0,n=0;
  const goals=new InitiativeRegistry(store,()=>`goal:${++n}`),obligations=new ObligationRegistry(store),memory=new DevelopmentalMemory(store,()=>at);
  const scheduler=new FairScheduler(store,goals,obligations,'s',policy,Date.parse(at),undefined,{newId:()=>{if(failing&&where==='selection')throw operation;return `selection:${++n}`;},compareIds:(a,b)=>a<b?-1:a>b?1:0});
  const effects=new EffectJournal(store,{assert(){}},{async dispatch(){throw Error('unexpected');},async reconcile(){throw Error('unexpected');}},()=>`effect:${++n}`),ledger=new ResourceLedger(store,{tokens:1,costUsd:0,elapsedMs:1},()=>Date.parse(at));
  const runtime=new DurableRuntime({store,effects,resources:ledger,shell:{async run(){throw Error('unexpected');}},now:()=>Date.parse(at),elapsedNow:()=>0,newId:()=>`run:${++n}`});
  if(where==='delivery')obligations.owe({id:'owed',inputId:'input',audience:scope,promisedOutcome:'delivery',dueAt:at});
  const runner=new InitiativeRunner({scheduler,runtime,memory,authority:{generation:'fixture',epoch:1,controlRevision:'c1'},prompt:()=>({id:'fixture',fragments:[],requestDigest:identity('fixture')}),decide:()=>{throw Error('unexpected');},deliver:async()=>{if(failing&&where==='delivery')throw operation;},scheduleTimeout:()=>()=>{cancellations++;if(failing&&failCleanup)throw cleanup;}});
  return {runner,store,scheduler,obligations,cancellations:()=>cancellations,restore:()=>{failing=false;},snapshot:()=>canonicalJson(store.captureDevelopmentSnapshot({maxRows:512,maxBytes:1000000}))};
}
for(const [label,operation,cleanup] of [['errors',Error('selection'),Error('cleanup')],['undefined',undefined,Error('cleanup')],['null',null,null],['falsy',false,0]] as const)test(`dual ${label} failures retain both values, original cause and cleanup guarantees`,async t=>{
  const f=fixture(t,operation,cleanup,'selection'),parent=new AbortController(),before=f.snapshot(),result=await capture(()=>f.runner.tick(parent.signal));
  assert.equal(result.threw,true);assert.ok(result.value instanceof AggregateError);assert.deepEqual(result.value.errors,[operation,cleanup]);assert.equal(result.value.cause,operation);assert.equal(f.snapshot(),before);assert.equal(getEventListeners(parent.signal,'abort').length,0);assert.equal(f.cancellations(),1);
  f.restore();assert.equal((await f.runner.tick()).kind,'idle');assert.equal(f.cancellations(),2);
});
for(const where of ['selection','none'] as const)test(`sole ${where==='none'?'cleanup':'operation'} undefined failure retains exact value`,async t=>{
  const f=fixture(t,undefined,undefined,where,where==='none'),parent=new AbortController(),result=await capture(()=>f.runner.tick(parent.signal));assert.equal(result.threw,true);assert.equal(result.value,undefined);assert.equal(getEventListeners(parent.signal,'abort').length,0);assert.equal(f.cancellations(),1);f.restore();assert.equal((await f.runner.tick()).kind,'idle');
});
test('failed delivery and failed cancellation retain original values and actual persisted backoff',async t=>{
  const delivery=Object.freeze({reason:'delivery failed'}),cleanup=Object.freeze({reason:'timer cleanup failed'}),f=fixture(t,delivery,cleanup,'delivery'),parent=new AbortController(),result=await capture(()=>f.runner.tick(parent.signal));
  assert.ok(result.value instanceof AggregateError);assert.equal(result.value.errors[0],delivery);assert.equal(result.value.errors[1],cleanup);assert.equal(result.value.cause,delivery);assert.equal(f.obligations.obligation('owed')!.status,'owed');assert.equal(f.store.get<{at:number}>('initiative.delivery-backoff','owed')!.value.at,Date.parse(at)+policy.idleRetryMs);assert.equal(f.scheduler.snapshot().lifetimeSlices,1);assert.equal(getEventListeners(parent.signal,'abort').length,0);
  f.restore();assert.equal((await f.runner.tick()).kind,'idle');assert.equal(f.scheduler.snapshot().lifetimeSlices,1);assert.equal(f.cancellations(),2);
});
