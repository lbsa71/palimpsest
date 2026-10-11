import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createAgentShell } from '../../agent-shell/index.ts';
import { setup, authority, envelope, input, prompt } from './fixtures.ts';
function response(content:string|null,action?:string):Response {return Response.json({id:'fixture',model:'fixture',choices:[{finish_reason:action?'tool_calls':'stop',message:{content,...(action?{tool_calls:[{id:'call00001',type:'function',function:{name:'project',arguments:JSON.stringify({action})}}]}:{})}}],usage:{prompt_tokens:10,completion_tokens:4}});}
const tool={name:'project',description:'Inspect, edit and test fixture project',parameters:{type:'object',properties:{action:{type:'string'}},required:['action']}};
test('selected Pi shell + durable bridge observe failure, repair and verify with complete request accounting',async()=> {
 const filename=join(mkdtempSync(join(tmpdir(),'aeon-joined-')),'state.sqlite');let round=0;const observed:string[]=[];
 const shell=createAgentShell({resolveFragment:async()=>'',tools:[tool],apiKey:()=> 'fixture-key',maxRequests:5,fetch:async(_url,init)=>{
   const body=JSON.parse(String(init?.body));if(round===2)assert.match(body.messages.at(-1).content,/failed assertion/);if(round===4)assert.match(body.messages.at(-1).content,/all tests pass/);
   return round<4?response(null,['inspect','test','repair','retest'][round++]):response('Verified repaired project.');
 }});
 const f=setup(filename,shell,async effect=>{const action=(effect.payload as {action:string}).action;observed.push(action);return {outcome:action==='test'?'failed':'succeeded',value:action==='test'?'failed assertion':action==='retest'?'all tests pass':`observed ${action}`};});
 const run=f.runtime.admit(input,authority,{...envelope,maxConcurrency:1});const result=await f.runtime.resume(run.id,prompt);assert.equal(result.status,'completed');assert.deepEqual(observed,['inspect','test','repair','retest']);assert.equal(f.runtime.observations(run.id).length,4);assert.equal(f.resources.snapshot(run.id).requests,9);assert.equal(f.resources.snapshot(run.id).tokens,70);assert.equal(f.resources.snapshot(run.id).costUsd,5);assert.equal(f.store.list('prompts').length,5);f.store.close();
});
test('selected shell resumes a persisted assistant tool call after unknown outcome reconciliation without effect replay',async()=>{
 const filename=join(mkdtempSync(join(tmpdir(),'aeon-joined-')),'state.sqlite');let dispatches=0;let round=0;
 const shell=createAgentShell({resolveFragment:async()=>'',tools:[tool],apiKey:()=> 'fixture-key',maxRequests:3,fetch:async()=>round++===0?response(null,'inspect'):response('continued from retained receipt')});
 let f=setup(filename,shell,async()=>{dispatches++;return {outcome:'uncertain'};});const run=f.runtime.admit(input,authority,envelope);assert.equal((await f.runtime.resume(run.id,prompt)).status,'blocked');const uncertain=f.effects.unresolved(run.id);assert.equal(uncertain.length,1);f.effects.recordReconciliation(uncertain[0].id,authority,'succeeded',f.store.putJsonArtifact('retained inspection'));f.store.close();
 f=setup(filename,shell,async()=>{dispatches++;return {outcome:'succeeded',value:'unexpected replay'};});assert.equal((await f.runtime.resume(run.id,prompt)).status,'completed');assert.equal(dispatches,1);assert.equal(f.runtime.observations(run.id)[0].value,'retained inspection');assert.equal(f.resources.snapshot(run.id).requests,3);f.store.close();
});

test('SIGKILL of selected Pi host reopens retained checkpoint and continues without repeating inspection',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'aeon-selected-crash-')),filename=join(directory,'state.sqlite'),marker=join(directory,'marker');
 const child=spawn(process.execPath,[fileURLToPath(new URL('./crash-worker.ts',import.meta.url)),filename,marker,'selected-checkpoint'],{stdio:['ignore','ignore','pipe']});let stderr='';child.stderr.on('data',c=>stderr+=String(c));const exited=new Promise<void>(r=>child.once('exit',()=>r()));
 for(let i=0;i<100&&!existsSync(marker);i++){if(child.exitCode!==null)throw Error(stderr);await delay(20);}assert.ok(existsSync(marker),stderr);child.kill('SIGKILL');await exited;
 let dispatches=0,modelRequests=0;const shell=createAgentShell({resolveFragment:async()=>'',tools:[{name:'inspect',description:'Inspect project',parameters:{type:'object',properties:{path:{type:'string'}},required:['path']}}],apiKey:()=> 'fixture-key',maxRequests:1,fetch:async(_url,init)=>{modelRequests++;assert.match(JSON.parse(String(init?.body)).messages.at(-1).content,/inspect retained/);return response('finished with preserved inspection');}});
 const f=setup(filename,shell,async()=>{dispatches++;return {outcome:'succeeded',value:'unexpected'};});const run=f.runtime.admit(input,authority,envelope);assert.deepEqual(f.runtime.recover(),[run.id]);assert.equal((await f.runtime.resume(run.id,prompt)).status,'completed');assert.equal(dispatches,0);assert.equal(modelRequests,1);assert.equal(f.resources.snapshot(run.id).requests,4);assert.equal(f.store.list<{request:{status:string}}>('requests').filter(r=>r.value.request.status==='uncertain').length,1);f.store.close();
});
