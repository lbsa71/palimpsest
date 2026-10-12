import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {identity} from '../packages/contracts/index.ts';
import {AuthorityStore} from '../packages/supervisor/authority.ts';
import {AutarkApplication} from './application.ts';
import {validateConfiguration,type ApplicationConfig} from './config.ts';
import {transportRecorder} from './provider-gateway.ts';
function fixture() {
 const root=mkdtempSync(join(tmpdir(),'aeon-coding-policy-')), stateDirectory=join(root,'state'),workspaceDirectory=join(root,'work');mkdirSync(stateDirectory);mkdirSync(workspaceDirectory);
 const promptFile=join(root,'mind'),compactionPromptFile=join(root,'compact');writeFileSync(promptFile,'Fixture: answer a question.');writeFileSync(compactionPromptFile,'Summarize.');
 const resources={maxRequests:100,maxTokens:1000,maxCostUsd:5,maxElapsedMs:300000,maxConcurrency:8};
 const config:ApplicationConfig={stateDirectory,workspaceDirectory,applicationRoot:dirname(dirname(fileURLToPath(import.meta.url))),nodeBinary:process.execPath,workerEntrypoint:'deployment/shell-worker.ts',artifactId:'coding-fixture',controlRevision:'coding-control',promptFile,compactionPromptFile,model:{id:'mistral-fixture-v1',contextWindow:128000,reasoning:false,effort:'none',maxOutputTokens:256,maxRequestsPerSlice:2,timeoutMs:10000,pricesPerMillion:{input:1,output:2}},resources,conversationResources:{...resources,maxCostUsd:0.001},scheduler:{windowMs:1000,maxSlicesPerWindow:2,maxLifetimeSlices:2,quantumMs:20,idleRetryMs:1000,maxStalls:2,resources},bootstrapInitiative:false,maxConcurrentRuns:1,pollMs:100,commands:['/runtime/node'],researchHosts:[],direct:{host:'127.0.0.1',port:0,actorId:'operator',scope:{kind:'restricted',principals:['operator']},modificationEligible:true}};
 const authorityStore=new AuthorityStore(join(stateDirectory,'authority.sqlite')),authority=authorityStore.bootstrap('instance',config.controlRevision,config.artifactId);
 return {root,config,authorityStore,authority};
}
const response={status:200,body:JSON.stringify({model:'mistral-fixture-v1',choices:[{finish_reason:'stop',message:{role:'assistant',content:'Observed completion.'}}],usage:{prompt_tokens:100,completion_tokens:20}})};
for(const enabled of [false,true])test(`production composition ${enabled?'permits':'blocks'} coding under explicit money policy`,async()=>{
 const f=fixture();let calls=0;f.config.conversationTimeoutMs=10000;
 if(enabled){f.config.allowanceAmendment={id:'user-policy',authorizationRef:'fixture:chosen-$5',rootId:'operating-envelope:v1',expectedEnvelopeDigest:identity(f.config.resources),cumulativeTokenLimit:null,scope:'root-and-descendants',descendantCostLimit:'root'};f.config.conversationTimeoutMs=10000;}
 const app=new AutarkApplication({...f,secrets:{mistralApiKey:'fixture',directToken:'fixture'},performRequest:async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,60));return response;}});
 try{
  const run=app.communications.receive({source:'direct',externalId:'coding',revision:'1',conversation:'coding',text:'Check the coding path.',actor:{id:'operator',scope:f.config.direct.scope,modificationEligible:true}}).run;
  const before=app.store.get('allocations','operating-envelope:v1')!.value;
  const result=await app.resume(run.id);assert.equal(result.status,enabled?'completed':'blocked');assert.equal(calls,enabled?1:0);
  const after=app.store.get('allocations','operating-envelope:v1')!.value as {envelope:unknown;startedAt:number};assert.deepEqual(after.envelope,f.config.resources);assert.equal(after.startedAt,(before as {startedAt:number}).startedAt);
  if(enabled){assert.equal(app.resources.effectiveEnvelope(run.id).maxTokens,null);assert.equal(app.resources.effectiveEnvelope(run.id).maxCostUsd,5);assert.equal(app.store.list('host.model-responses').length,1);assert.equal(app.resources.snapshot(run.id).tokens,120);}
 }finally{await app.close();f.authorityStore.close();rmSync(f.root,{recursive:true,force:true});}
});
test('conversation deadline and amendment require exact operator configuration',()=>{
 const f=fixture();try{
  f.config.conversationTimeoutMs=Infinity;assert.throws(()=>validateConfiguration(f.config),/conversation worker deadline/);
  f.config.conversationTimeoutMs=10000;f.config.allowanceAmendment={} as never;assert.throws(()=>validateConfiguration(f.config),/allowance amendment/);
 }finally{f.authorityStore.close();rmSync(f.root,{recursive:true,force:true});}
});

test('uncapped operator policy retains charges and permits real composition work beyond the original total',async()=>{
 const f=fixture();let calls=0;
 f.config.allowanceAmendment={id:'uncapped-coding-trial',authorizationRef:'fixture:user-disable-local-caps',rootId:'operating-envelope:v1',expectedEnvelopeDigest:identity(f.config.resources),cumulativeTokenLimit:null,cumulativeCostLimit:null,cumulativeRequestLimit:null,scope:'root-and-descendants',descendantCostLimit:'root',descendantRequestLimit:'root'};
 f.config.conversationTimeoutMs=10000;
 const app=new AutarkApplication({...f,secrets:{mistralApiKey:'fixture',directToken:'fixture'},performRequest:async()=>{calls++;return response;}});
 try{
  const charged={id:'retained-unknown',runId:'operating-envelope:v1',purpose:'reasoning' as const,provider:'fixture',model:'fixture',promptManifestId:'fixture',requestDigest:identity('retained-unknown'),reservationId:'retained-unknown',status:'reserved' as const,usage:{requests:1,inputTokens:0,outputTokens:0,costUsd:5.5,elapsedMs:0}};
  app.resources.reserve(charged);app.resources.dispatched({...charged,status:'dispatched'});app.resources.settle({...charged,status:'uncertain'});
  const before=app.store.get('requests',charged.id),allocation=app.store.get<{envelope:unknown;startedAt:number}>('allocations','operating-envelope:v1')!.value;
  assert.equal(app.resources.snapshot('operating-envelope:v1').costUsd,5.5);
  assert.ok(!(app.health() as {execution:{reasons:string[]}}).execution.reasons.includes('allowance-exhausted'));
  const run=app.communications.receive({source:'direct',externalId:'uncapped-coding',revision:'1',conversation:'uncapped-coding',text:'Check the coding path.',actor:{id:'operator',scope:f.config.direct.scope,modificationEligible:true}}).run;
  assert.equal((await app.resume(run.id)).status,'completed');assert.equal(calls,1);
  assert.deepEqual(app.store.get('requests',charged.id),before);
  assert.deepEqual(app.store.get<{envelope:unknown;startedAt:number}>('allocations','operating-envelope:v1')!.value.envelope,allocation.envelope);
  assert.equal(app.store.get<{startedAt:number}>('allocations','operating-envelope:v1')!.value.startedAt,allocation.startedAt);
  assert.ok(app.resources.snapshot('operating-envelope:v1').costUsd>5.5);
  assert.equal(app.resources.effectiveEnvelope(run.id).maxCostUsd,null);assert.equal(app.resources.effectiveEnvelope(run.id).maxRequests,null);
 }finally{await app.close();f.authorityStore.close();rmSync(f.root,{recursive:true,force:true});}
});

test('explicit elapsed-only recovery survives application receipt reconciliation and a second startup',async()=>{
 const f=fixture();let app:AutarkApplication|undefined;
 const base={id:'old-money-policy',authorizationRef:'fixture:chosen-$5',rootId:'operating-envelope:v1',expectedEnvelopeDigest:identity(f.config.resources),cumulativeTokenLimit:null,scope:'root-and-descendants' as const,descendantCostLimit:'root' as const};
 f.config.allowanceAmendment=base;f.config.conversationTimeoutMs=10000;
 const options={...f,secrets:{mistralApiKey:'fixture',directToken:'fixture'},performRequest:async()=>response};
 try{
  app=new AutarkApplication(options);
  const r={id:'old-timeout',runId:'operating-envelope:v1',purpose:'reasoning' as const,provider:'mistral',model:'fixture',promptManifestId:'fixture',requestDigest:identity('old-timeout'),reservationId:'old-timeout',status:'reserved' as const,usage:{requests:1,inputTokens:null,outputTokens:null,costUsd:null,elapsedMs:0}};
  app.resources.reserve(r);app.resources.dispatched({...r,status:'dispatched'});
  const usage={...r.usage,elapsedMs:10008};
  transportRecorder(app.store)({requestId:r.id,dispatched:true,status:'uncertain',httpStatus:null,responseModel:null,responseDigest:null,usage});
  app.resources.settle({...r,status:'uncertain',usage});
  assert.equal(app.resources.snapshot('operating-envelope:v1').cancelled,true);
  const cause=app.store.get('requests',r.id)!,beforeRequests=app.store.list('requests'),beforeAllocation=app.store.get<{envelope:unknown;startedAt:number}>('allocations','operating-envelope:v1')!.value;
  await app.close();app=undefined;
  f.config.allowanceAmendment={...base,id:'explicit-timeout-recovery',cumulativeCostLimit:null,cumulativeRequestLimit:null,resumeAfterElapsedOverrun:{requestId:r.id,expectedRequestDigest:identity(cause.value)}};
  app=new AutarkApplication(options);
  assert.equal(app.resources.snapshot('operating-envelope:v1').cancelled,false);
  assert.deepEqual(app.store.list('requests'),beforeRequests);
  await app.close();app=undefined;
  app=new AutarkApplication(options);
  assert.equal(app.resources.snapshot('operating-envelope:v1').cancelled,false);
  assert.deepEqual(app.store.list('requests'),beforeRequests);
  const afterAllocation=app.store.get<{envelope:unknown;startedAt:number}>('allocations','operating-envelope:v1')!.value;
  assert.deepEqual(afterAllocation.envelope,beforeAllocation.envelope);assert.equal(afterAllocation.startedAt,beforeAllocation.startedAt);
  const run=app.communications.receive({source:'direct',externalId:'recovered-coding',revision:'1',conversation:'recovered-coding',text:'Verify execution after recovery.',actor:{id:'operator',scope:f.config.direct.scope,modificationEligible:true}}).run;
  assert.equal((await app.resume(run.id)).status,'completed');
  const newOverrun={...r,id:'new-overrun',reservationId:'new-overrun',requestDigest:identity('new-overrun')};
  app.resources.reserve(newOverrun);app.resources.dispatched({...newOverrun,status:'dispatched'});app.resources.settle({...newOverrun,status:'uncertain',usage});
  await app.close();app=undefined;
  app=new AutarkApplication(options);
  assert.equal(app.resources.snapshot('operating-envelope:v1').cancelled,true);
 }finally{await app?.close();f.authorityStore.close();rmSync(f.root,{recursive:true,force:true});}
});
