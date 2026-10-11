import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync,mkdirSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DelegationCoordinator } from './index.ts';
import type { DelegationGrant } from './index.ts';
import { ToolEffectReceiver } from '../tools/index.ts';
import { OperationalStore } from '../storage/index.ts';
import { EffectJournal } from '../effects/index.ts';
import { DurableRuntime,ResourceLedger } from '../runtime/index.ts';
import { assertAuthority,identity } from '../contracts/common.ts';
import type { ArtifactRef,JsonValue } from '../contracts/common.ts';
import type { DelegationTask,ShellPort } from '../contracts/execution/index.ts';
const authority={generation:'g1',epoch:1,controlRevision:'c1'};
const envelope={maxRequests:100,maxTokens:1000,maxCostUsd:0,maxElapsedMs:600000,maxConcurrency:4};
const modelPolicy={provider:'fixture',model:'synthetic',effort:null};
const prompt={id:'fixture',fragments:[],requestDigest:identity('fixture')};
function fixture(){const root=mkdtempSync(join(tmpdir(),'aeon-delegation-')),state=join(root,'state'),work=join(root,'work');mkdirSync(state);mkdirSync(work);return {root,state,work};}

test('two real child ShellPort runs join actual isolated file/test artifacts; parent inspects then accepts or rejects',async()=>{
  const f=fixture(),a=join(f.work,'a'),b=join(f.work,'b');mkdirSync(a);mkdirSync(b);
  const store=new OperationalStore({filename:join(f.state,'state.sqlite')}),fence={assert(grant:typeof authority){assertAuthority(grant,authority);}};
  const workspaces=new Map<string,string>();
  const receiver=new ToolEffectReceiver({store,fence,grantForRun:runId=>({scope:{kind:'public'},actions:['workspace.write','workspace.read','command.run'],workspace:{workspace:workspaces.get(runId)!,protectedPaths:[f.state],nodeBinary:process.execPath,timeoutMs:5000,maxBytes:65536,maxFiles:100,maxArgs:10,executables:['/runtime/node']}})});
  const effects=new EffectJournal(store,fence,receiver),resources=new ResourceLedger(store,{tokens:0,costUsd:0,elapsedMs:5000});
  const shell:ShellPort={async run(input,bridge){let i=0;const call=async(name:string,args:JsonValue)=>bridge.execute({id:`${input.run.id}:${++i}`,runId:input.run.id,stepId:`s${i}`,name,arguments:args});
    const name=workspaces.get(input.run.id)!.endsWith('/a')?'a':'b';
    await call('workspace.write',{path:'result.mjs',expectedSha256:null,content:`export const result = '${name}';\n`});
    const check=await call('command.run',{executable:'/runtime/node',args:['--input-type=module','-e',`import {result} from './result.mjs';if(result!=='${name}')throw Error('wrong');`]});assert.equal(check.kind,'result');
    await call('workspace.read',{path:'result.mjs'});return {status:'completed',observations:[]};}};
  const runtime=new DurableRuntime({store,shell,effects,resources});
  const parent=runtime.admit({id:'parent',source:'direct',externalId:'parent',externalRevision:'1',actorId:'owner',authenticated:true,scope:{kind:'public'},value:'delegate'},authority,envelope);
  const grant:DelegationGrant={scope:{kind:'public'},writableRoots:[f.work],allowedEffects:['workspace.write','workspace.read','command.run'],resources:envelope,modelProfiles:[modelPolicy],maxDepth:2,currentDepth:0,maxChildren:4,maxConcurrency:2};
  const coordinator=new DelegationCoordinator({store,fence,grantForParent:()=>grant,artifactScope:()=>({kind:'public'}),executeChild:async(task,signal)=>{
    const child=runtime.admit({id:task.id,source:'delegation',externalId:task.id,externalRevision:'1',actorId:'trusted-parent',authenticated:true,scope:task.scope,value:JSON.parse(JSON.stringify(task)) as JsonValue},authority,task.resources,task.parentRunId);
    workspaces.set(child.id,task.writablePaths[0]!);assert.equal((await runtime.resume(child.id,prompt,signal)).status,'completed');
    const receipt=effects.get(`tool:${child.id}:3`)!.receipt!;return {childRunId:child.id,artifacts:[receipt]};
  },cancelChild:(id,reason)=>runtime.cancel(id,'parent',reason)});
  const task=(id:string,path:string):DelegationTask=>({id,parentRunId:parent.id,parentGoalId:'finite-goal',objective:`write tested module ${id}`,inputs:[],provenance:{sourceIds:['parent'],actorId:'parent',recordedAt:new Date().toISOString(),derivation:'observed'},scope:{kind:'public'},acceptanceCriteria:['module produces required result'],writablePaths:[path],allowedEffects:grant.allowedEffects,resources:envelope,modelPolicy,outputLocation:'artifact-receipts',cancellationConditions:['parent cancelled','elapsed ceiling'],maxDepth:2});
  try {
    coordinator.create(task('a',a));assert.throws(()=>coordinator.create(task('overlap',a)),/already owned/);coordinator.create(task('b',b));
    const results=await Promise.all([coordinator.start('a'),coordinator.start('b')]);assert.ok(results.every(r=>r.status==='completed'));
    assert.equal(readFileSync(join(a,'result.mjs'),'utf8'),"export const result = 'a';\n");assert.equal(readFileSync(join(b,'result.mjs'),'utf8'),"export const result = 'b';\n");
    const fake:ArtifactRef=store.putJsonArtifact({claim:'accepted'});assert.throws(()=>coordinator.judge('a',fake,[]),/inspect/);
    const inspectedA=coordinator.inspect('a'),observedA=JSON.parse(Buffer.from(inspectedA.artifacts[0]!.bytes).toString());assert.equal(observedA.content,"export const result = 'a';\n");
    const checkA=store.putJsonArtifact({observed:observedA.content,required:"export const result = 'a';\n"});assert.equal(coordinator.judge('a',inspectedA.receipt,[{criterion:'module produces required result',passed:true,evidence:checkA}]).status,'accepted');
    const inspectedB=coordinator.inspect('b'),checkB=store.putJsonArtifact({required:'different result',observed:"export const result = 'b';\n"});assert.equal(coordinator.judge('b',inspectedB.receipt,[{criterion:'module produces required result',passed:false,evidence:checkB}]).status,'rejected');
    assert.equal(resources.descendants(parent.id).length,2);assert.equal(resources.snapshot(parent.id).requests,6);
  }finally{store.close();rmSync(f.root,{recursive:true,force:true});}
});

test('delegation validates depth/model/resources/provenance and retains uncertain restart without replay',async()=>{
  const f=fixture(),store=new OperationalStore({filename:join(f.state,'state.sqlite')});
  const grant:DelegationGrant={scope:{kind:'restricted',principals:['alice']},writableRoots:[f.work],allowedEffects:[],resources:envelope,modelProfiles:[modelPolicy],maxDepth:1,currentDepth:0,maxChildren:2,maxConcurrency:1};
  let calls=0;
  const coordinator=new DelegationCoordinator({store,fence:{assert(){}},grantForParent:()=>grant,artifactScope:()=>({kind:'restricted',principals:['bob']}),executeChild:async()=>{calls++;throw Error('lost worker');}});
  const task:DelegationTask={id:'child',parentRunId:'p',parentGoalId:'g',objective:'finite',inputs:[],provenance:{sourceIds:['p'],actorId:'p',recordedAt:new Date().toISOString(),derivation:'observed'},scope:grant.scope,acceptanceCriteria:['artifact works'],writablePaths:[f.work],allowedEffects:[],resources:envelope,modelPolicy,outputLocation:'artifact',cancellationConditions:['parent cancellation'],maxDepth:1};
  try {
    assert.throws(()=>coordinator.create({...task,scope:{kind:'public'}}),/broadens/);
    assert.throws(()=>coordinator.create({...task,modelPolicy:{...modelPolicy,model:'unavailable'}}),/unavailable/);
    assert.throws(()=>coordinator.create({...task,resources:{...envelope,maxTokens:1001}}),/exceeds/);
    assert.throws(()=>coordinator.create({...task,inputs:[store.putJsonArtifact({private:true})]}),/discloses/);
    grant.currentDepth=1;assert.throws(()=>coordinator.create(task),/depth/);grant.currentDepth=0;
    coordinator.create(task);await assert.rejects(coordinator.start(task.id),/lost worker/);assert.equal(coordinator.get(task.id)!.status,'uncertain');await assert.rejects(coordinator.start(task.id),/uncertain/);assert.equal(calls,1);
  }finally{store.close();rmSync(f.root,{recursive:true,force:true});}
});


test('bounded batch registration is atomic and returns every completed or uncertain child without replay',async()=>{
  const f=fixture(),store=new OperationalStore({filename:join(f.state,'state.sqlite')});
  const a=join(f.work,'a'),b=join(f.work,'b');mkdirSync(a);mkdirSync(b);
  const grant:DelegationGrant={scope:{kind:'public'},writableRoots:[f.work],allowedEffects:[],resources:envelope,modelProfiles:[modelPolicy],maxDepth:1,currentDepth:0,maxChildren:2,maxConcurrency:2};
  let calls=0;
  const coordinator=new DelegationCoordinator({store,fence:{assert(){}},grantForParent:()=>grant,artifactScope:()=>({kind:'public'}),executeChild:async task=>{calls++;if(task.id==='b')throw Error('lost child response');return {childRunId:'runtime-a',artifacts:[store.putJsonArtifact({actual:'a'})]};}});
  const task=(id:string,path:string):DelegationTask=>({id,parentRunId:'p',parentGoalId:'g',objective:'finite',inputs:[],provenance:{sourceIds:['p'],actorId:'p',recordedAt:new Date().toISOString(),derivation:'observed'},scope:grant.scope,acceptanceCriteria:['artifact works'],writablePaths:[path],allowedEffects:[],resources:envelope,modelPolicy,outputLocation:'artifact',cancellationConditions:['parent cancellation'],maxDepth:1});
  const effect={id:'batch',runId:'p',stepId:'s',kind:'delegation.start_batch',payload:{tasks:[task('a',a),task('b',b)]} as unknown as JsonValue,scope:grant.scope,authority,status:'authorized' as const,revision:0};
  try {
    assert.throws(()=>coordinator.createBatch([task('a',a),task('b',a)],'p'),/already owned/);
    assert.equal(store.list('delegations').length,0);assert.equal(calls,0);
    grant.maxConcurrency=1;assert.throws(()=>coordinator.createBatch([task('a',a),task('b',b)],'p'),/concurrency grant/);assert.equal(store.list('delegations').length,0);grant.maxConcurrency=2;
    const result=await coordinator.dispatch(effect);assert.equal(result.outcome,'uncertain');
    const receipt=store.readJsonArtifact(result.receipt!) as any;assert.equal(receipt.children.length,2);assert.equal(receipt.children[0].record.status,'completed');assert.equal(receipt.children[1].record.status,'uncertain');assert.match(receipt.children[1].error,/lost child response/);
    assert.equal((await coordinator.dispatch(effect)).outcome,'failed');assert.equal(calls,2);
    coordinator.recover();assert.equal(coordinator.get('b')?.status,'uncertain');
  }finally{store.close();rmSync(f.root,{recursive:true,force:true});}
});
