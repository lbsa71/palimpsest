import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { getEventListeners } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OperationalStore } from '../packages/storage/index.ts';
import { DevelopmentalMemory } from '../packages/development/index.ts';
import { DurableRuntime, ResourceLedger } from '../packages/runtime/index.ts';
import { EffectJournal } from '../packages/effects/index.ts';
import { DriveRegistry, FairScheduler, InitiativeRegistry, InitiativeRunner, ObligationRegistry, PlanRegistry, initiativeTools } from '../packages/initiative/index.ts';
import type { ScheduleTimeout, SchedulerEnvironment } from '../packages/initiative/environment.ts';
import { canonicalJson, identity, type ShellPort } from '../packages/contracts/index.ts';
const at = '2040-01-01T00:00:00.000Z', scope = { kind: 'public' } as const;
const authority = { generation: 'fixture', epoch: 1, controlRevision: 'c1' };
const resources = { maxRequests: 30, maxTokens: 3000, maxCostUsd: 10, maxElapsedMs: 600000, maxConcurrency: 1 };
const policy = { windowMs: 1000, maxSlicesPerWindow: 10, maxLifetimeSlices: 20, quantumMs: 100, idleRetryMs: 200, maxStalls: 3, resources };
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function ids(prefix: string) { let n=0; return function(this: unknown) { assert.equal(this,undefined); return `${prefix}:${++n}`; }; }
function fixture(t: TestContext, newId=ids('goal')) {
  const directory=mkdtempSync(join(tmpdir(),'initiative-di-')), filename=join(directory,'state.sqlite');
  const stores=new Set<OperationalStore>();
  const open=()=>{const store=new OperationalStore({filename});stores.add(store);return store;};
  const close=(store:OperationalStore)=>{store.close();stores.delete(store);};
  const store=open();t.after(()=>{for(const s of stores)s.close();rmSync(directory,{recursive:true,force:true});});
  let now=Date.parse(at);
  const memory=new DevelopmentalMemory(store,()=>new Date(now).toISOString(),{monotonicNow:()=>0,withdrawalId:ids('withdrawal'),compareIds:compare});
  const goals=new InitiativeRegistry(store,newId), obligations=new ObligationRegistry(store);
  const snapshot=()=>canonicalJson(store.captureDevelopmentSnapshot({maxRows:512,maxBytes:1000000}));
  return {store,memory,goals,obligations,snapshot,open,close,now:()=>now,advance:(ms:number)=>{now+=ms;}};
}
function propose(goals:InitiativeRegistry,id:string) { return goals.propose({id,origin:{kind:'self'},purpose:`observe ${id}`,scope,successCriteria:['measure outcome'],evidenceIds:[],dependencyIds:[],resources,priority:1,nextAction:'measure',reviewAt:at},{sourceIds:['prior'],actorId:'fixture',recordedAt:at,derivation:'interpreted'}); }
function ready(goals:InitiativeRegistry,id:string) { const g=propose(goals,id);return goals.accept(id,g.revision,'observe'); }
function scheduler(f:ReturnType<typeof fixture>,environment:SchedulerEnvironment={newId:ids('selection'),compareIds:compare},maxLifetimeSlices=20) { return new FairScheduler(f.store,f.goals,f.obligations,'s',{...policy,maxLifetimeSlices},f.now(),undefined,environment); }
function runtime(f:ReturnType<typeof fixture>,shell:ShellPort) {
  const effects=new EffectJournal(f.store,{assert(){}},{async dispatch(){throw Error('no effects expected');},async reconcile(){throw Error('no effects expected');}},ids('effect'));
  const ledger=new ResourceLedger(f.store,{tokens:10,costUsd:.01,elapsedMs:1},f.now);
  return new DurableRuntime({store:f.store,effects,resources:ledger,shell,now:f.now,elapsedNow:()=>0,newId:ids('runtime')});
}
function runnerOptions(f:ReturnType<typeof fixture>,s:FairScheduler,r:DurableRuntime,scheduleTimeout:ScheduleTimeout) {return {scheduler:s,runtime:r,memory:f.memory,authority,prompt:()=>({id:'fixture',fragments:[],requestDigest:identity('fixture')}),decide:()=>{throw Error('no observations expected');},scheduleTimeout};}
function manualTimer() {
  const pending=new Set<()=>void>(), callbacks:(()=>void)[]=[],delays:number[]=[];let cancellations=0;
  const schedule:ScheduleTimeout=function(this:unknown,delay,callback){assert.equal(this,undefined);delays.push(delay);callbacks.push(callback);pending.add(callback);let cancelled=false;return function(this:unknown){assert.equal(this,undefined);if(!cancelled){cancelled=true;cancellations++;pending.delete(callback);}};};
  return {schedule,pending,callbacks,delays,cancellations:()=>cancellations,fire:()=>{for(const callback of [...pending]){pending.delete(callback);callback();}}};
}
for(const mode of ['throw','empty','duplicate'] as const)test(`goal ${mode} event IDs roll back state, history and provenance`,t=>{
  let phase=false;const error=Error('ID unavailable');const f=fixture(t,()=>{if(!phase)return 'first';if(mode==='throw')throw error;return mode==='empty'?'':'first';});
  propose(f.goals,'a');const before=f.snapshot();phase=true;
  assert.throws(()=>propose(f.goals,'b'),mode==='throw'?(e:unknown)=>e===error:/./);assert.equal(f.snapshot(),before);assert.equal(f.goals.goal('b'),undefined);
});
test('captured scheduler ports choose independent tie order and deterministic journal IDs',t=>{
  const a=fixture(t),b=fixture(t);for(const f of [a,b]){ready(f.goals,'a');ready(f.goals,'b');}
  const environment={newId:ids('chosen'),compareIds:function(this:unknown,x:string,y:string){assert.equal(this,undefined);return -compare(x,y);}};
  const reverse=scheduler(a,environment),forward=scheduler(b);environment.newId=()=>{throw Error('late ID replacement');};environment.compareIds=()=>{throw Error('late comparison replacement');};
  const x=reverse.select(at),y=forward.select(at);assert.ok(x.kind==='selected'&&x.selection.kind==='goal');assert.ok(y.kind==='selected'&&y.selection.kind==='goal');assert.equal(x.selection.goal.id,'b');assert.equal(y.selection.goal.id,'a');
  assert.equal(a.store.events('scheduler:s',0).at(-1)!.id,'chosen:1');assert.equal(b.store.events('scheduler:s',0).at(-1)!.id,'selection:1');
});
for(const mode of ['ID throw','ID duplicate','comparison throw','comparison NaN'] as const)test(`scheduler ${mode} cannot consume fairness or lifetime state`,t=>{
  const f=fixture(t);ready(f.goals,'a');ready(f.goals,'b');f.store.append({id:'occupied',stream:'fixture',type:'existing',data:{}});const error=Error(mode);
  const s=scheduler(f,{newId:()=>{if(mode==='ID throw')throw error;return 'occupied';},compareIds:(a,b)=>{if(mode==='comparison throw')throw error;return mode==='comparison NaN'?NaN:compare(a,b);}}),before=f.snapshot();
  assert.throws(()=>s.select(at),mode.endsWith('throw')?(e:unknown)=>e===error:/./);assert.equal(f.snapshot(),before);assert.equal(s.snapshot().lifetimeSlices,0);
});
test('drive tie collation is injectable and preserves weighted priority',t=>{
  const f=fixture(t);f.memory.ingest({id:'episode',runId:'run',sourceId:'source',actorId:'fixture',channel:'speech',scope,at,content:'measured source'});
  const forward=new DriveRegistry(f.store,f.memory,compare),reverse=new DriveRegistry(f.store,f.memory,(a,b)=>-compare(a,b));
  forward.adopt({id:'drive',dimension:'curiosity',purpose:'investigate',scope,weight:2,active:true,reason:'observed',provenance:{sourceIds:['episode'],actorId:'fixture',recordedAt:at,derivation:'interpreted'}},null);
  for(const id of ['a','b'])forward.offer({id,driveId:'drive',scope,sourceIds:['episode'],question:'why',observationAction:'measure',successCriteria:['new observation'],reason:'uncertainty',priority:1});
  assert.deepEqual(forward.opportunities(scope).map(x=>x.id),['a','b']);assert.deepEqual(reverse.opportunities(scope).map(x=>x.id),['b','a']);
  assert.throws(()=>new DriveRegistry(f.store,f.memory,()=>Infinity).opportunities(scope),/collation/);
});
for(const trigger of ['quantum','parent'] as const)test(`manual ${trigger} abort yields checkpoint and cancels one timer without a real delay`,async t=>{
  const f=fixture(t),timer=manualTimer();ready(f.goals,'inquiry');let entered!:()=>void;const started=new Promise<void>(r=>{entered=r;});let aborts=0;
  const r=runtime(f,{async run(input,bridge,signal){const checkpoint=await bridge.persistCheckpoint(input.run.id,input.run.revision,'fixture',{observationIds:[]});await new Promise<void>(resolve=>{signal!.addEventListener('abort',()=>{aborts++;resolve();},{once:true});entered();});return {status:'checkpointed',checkpoint,observations:[]};}});
  const options=runnerOptions(f,scheduler(f),r,timer.schedule),runner=new InitiativeRunner(options);options.scheduleTimeout=()=>{throw Error('late replacement');};const parent=new AbortController();const result=runner.tick(parent.signal);await started;
  if(trigger==='quantum')timer.fire();else parent.abort(Error('parent stop'));
  await result;timer.callbacks[0]!();assert.equal(aborts,1);assert.deepEqual(timer.delays,[policy.quantumMs]);assert.equal(timer.pending.size,0);assert.equal(timer.cancellations(),1);assert.equal(getEventListeners(parent.signal,'abort').length,0);assert.equal(f.goals.goal('inquiry')?.status,'waiting');assert.equal(r.resources.snapshot(runner.rootAllocation).requests,0);
});
for(const mode of ['setup','cancel','inline'] as const)test(`timer ${mode} failure releases the runner latch and abort listener`,async t=>{
  const f=fixture(t);let failing=true,cancels=0;const error=Error(mode),parent=new AbortController();
  const schedule:ScheduleTimeout=(_delay,callback)=>{if(failing&&mode==='setup')throw error;if(failing&&mode==='inline')callback();return ()=>{cancels++;if(failing&&mode==='cancel')throw error;};};
  const r=runtime(f,{async run(){throw Error('idle must not run');}}),s=scheduler(f),runner=new InitiativeRunner(runnerOptions(f,s,r,schedule)),before=s.snapshot();
  await assert.rejects(runner.tick(parent.signal),mode==='inline'?/enqueue/:((e:unknown)=>e===error));assert.equal(getEventListeners(parent.signal,'abort').length,0);
  if(mode!=='cancel')assert.deepEqual(s.snapshot(),before);failing=false;assert.equal((await runner.tick(parent.signal)).kind,'idle');assert.equal(cancels,mode==='setup'?1:2);
});
test('preaborted tick does not register a timer or consume scheduler state',async t=>{
  const f=fixture(t),timer=manualTimer(),s=scheduler(f),r=runtime(f,{async run(){throw Error('must not run');}}),runner=new InitiativeRunner(runnerOptions(f,s,r,timer.schedule)),parent=new AbortController(),failure=Error('already cancelled');parent.abort(failure);const before=f.snapshot();
  await assert.rejects(runner.tick(parent.signal),(e:unknown)=>e===failure);assert.equal(f.snapshot(),before);assert.equal(timer.callbacks.length,0);assert.equal((await runner.tick()).kind,'idle');assert.equal(timer.cancellations(),1);
});
test('normal delivery cleanup ignores late timer callbacks and preserves backoff and lifetime across reopen',async t=>{
  const f=fixture(t),timer=manualTimer(),s=scheduler(f,undefined,2),r=runtime(f,{async run(){throw Error('delivery only');}});let deliveries=0,deliveredSignal:AbortSignal|undefined;
  f.obligations.owe({id:'owed',inputId:'input',audience:scope,promisedOutcome:'deliver',dueAt:at});
  const runner=new InitiativeRunner({...runnerOptions(f,s,r,timer.schedule),deliver:async(_id,signal)=>{deliveries++;deliveredSignal=signal;}});
  await runner.tick();timer.callbacks[0]!();assert.equal(deliveredSignal!.aborted,false);assert.equal(timer.cancellations(),1);assert.equal(s.snapshot().lifetimeSlices,1);assert.equal(f.obligations.obligation('owed')!.status,'owed');
  const budget=f.store.get('budgets',runner.rootAllocation)!.value;f.close(f.store);const store=f.open(),memory=new DevelopmentalMemory(store,()=>new Date(f.now()).toISOString()),goals=new InitiativeRegistry(store,ids('reopened-goal')),obligations=new ObligationRegistry(store);
  const reopened={...f,store,memory,goals,obligations},nextScheduler=scheduler(reopened, {newId:ids('reopened-selection'),compareIds:compare},2),nextRuntime=runtime(reopened,{async run(){throw Error('delivery only');}}),next=new InitiativeRunner({...runnerOptions(reopened,nextScheduler,nextRuntime,timer.schedule),deliver:async()=>{deliveries++;}});
  const idle=await next.tick();assert.equal(idle.kind,'idle');assert.equal(deliveries,1);assert.deepEqual(store.get('budgets',runner.rootAllocation)!.value,budget);f.advance(policy.idleRetryMs);await next.tick();assert.equal(deliveries,2);assert.equal(nextScheduler.snapshot().lifetimeSlices,2);assert.equal((await next.tick()).kind,'lifetime-exhausted');assert.equal(timer.pending.size,0);
});
for(const supplied of ['2040-01-01T01:00:00+01:00','2040-01-01T00:00:00','1/1/2040'])test(`tool wall adapter ${supplied} is explicit and cannot write ambiguous provenance`,t=>{
  const f=fixture(t);f.memory.ingest({id:'episode',runId:'run',sourceId:'source',actorId:'fixture',channel:'speech',scope,at,content:'measured source'});
  const tools=initiativeTools(f.goals,new DriveRegistry(f.store,f.memory,compare),new PlanRegistry(f.store),scope,'fixture',resources,'run',function(this:unknown){assert.equal(this,undefined);return supplied;});
  const tool=tools.find(x=>x.name==='initiative_goal_propose')!,args={id:'proposal',purpose:'measure',successCriteria:['observed'],sourceIds:['episode'],resources,priority:1,nextAction:'measure',reviewAt:at},before=f.snapshot();
  if(supplied.includes('+')){tool.execute(args);assert.equal(f.store.get<{recordedAt:string}>('initiative.goal-provenance','proposal')!.value.recordedAt,supplied);}else{assert.throws(()=>tool.execute(args),/explicit ISO timezone/);assert.equal(f.snapshot(),before);}
});
