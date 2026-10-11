import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { setup, authority, envelope, input, prompt } from './fixtures.ts';
import type { JsonValue } from '../../contracts/common.ts';
import type { ShellPort } from '../../contracts/execution/index.ts';
function paths(){const dir=mkdtempSync(join(tmpdir(),'aeon-runtime-'));return {filename:join(dir,'state.sqlite'),marker:join(dir,'marker')};}
async function crash(filename:string,marker:string,boundary:string){
  const child=spawn(process.execPath,[fileURLToPath(new URL('./crash-worker.ts',import.meta.url)),filename,marker,boundary],{stdio:['ignore','ignore','pipe']});
  let stderr='';child.stderr.on('data',chunk=>stderr+=String(chunk));
  const exit=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
  for(let i=0;i<100&&!existsSync(marker);i++){if(child.exitCode!==null)throw Error(stderr);await delay(20);}
  assert.ok(existsSync(marker),stderr);child.kill('SIGKILL');await exit;
}
test('duplicate admission retains one run; multi-step failure changes action and completes',async()=>{
  const calls:string[]=[];const shell:ShellPort={async run({run},bridge){
    const observations=[];for(const name of ['inspect','test','repair','retest']){const result=await bridge.execute({id:name,runId:run.id,stepId:name,name,arguments:null});observations.push(result);if(name==='test')assert.equal(result.kind,'error');}
    return {status:'completed',observations};
  }};
  const f=setup(paths().filename,shell,async effect=>{calls.push(effect.kind);return {outcome:effect.kind==='test'?'failed':'succeeded',value:(effect.kind==='test'?{error:'missing assertion'}:{ok:true}) as JsonValue};});
  const run=f.runtime.admit(input,authority,envelope);assert.equal(f.runtime.admit(input,authority,envelope).id,run.id);
  assert.equal((await f.runtime.resume(run.id,prompt)).status,'completed');assert.deepEqual(calls,['inspect','test','repair','retest']);assert.equal(f.runtime.observations(run.id).length,4);assert.equal(f.resources.snapshot(run.id).requests,4);f.store.close();
});
test('SIGKILL after checkpoint reopens SQLite and resumes from actual retained observation',async()=>{
  const {filename,marker}=paths();await crash(filename,marker,'checkpoint');const calls:string[]=[];
  const shell:ShellPort={async run({run,checkpoint},bridge){assert.ok(checkpoint);const content=await bridge.readCheckpoint(checkpoint);assert.deepEqual(content,{phase:'inspected',observations:['tool:inspect']});
    const retained=await bridge.execute({id:'inspect',runId:run.id,stepId:'inspect',name:'inspect',arguments:{path:'project'}});assert.deepEqual(retained.value,{observed:'inspect retained'});
    const observation=await bridge.execute({id:'test',runId:run.id,stepId:'test',name:'test',arguments:null});return {status:'completed',observations:[retained,observation]};}};
  const f=setup(filename,shell,async effect=>{calls.push(effect.kind);return {outcome:'succeeded',value:{tested:true}};});const run=f.runtime.admit(input,authority,envelope);assert.deepEqual(f.runtime.recover(),[run.id]);assert.equal((await f.runtime.resume(run.id,prompt)).status,'completed');assert.deepEqual(calls,['test']);f.store.close();
});
test('SIGKILL during dispatch preserves uncertainty and never replays; old grant reconciliation permits takeover',async()=>{
  const {filename,marker}=paths();await crash(filename,marker,'dispatch');let shellCalls=0;
  const shell:ShellPort={async run(){shellCalls++;return {status:'completed',observations:[]};}};
  const f=setup(filename,shell);const run=f.runtime.admit(input,authority,envelope);f.runtime.recover();assert.equal(f.effects.get('tool:inspect')?.status,'uncertain');assert.equal((await f.runtime.resume(run.id,prompt)).status,'blocked');assert.equal(shellCalls,0);
  const next=f.withdraw();f.runtime.adopt(run.id,next);f.effects.recordReconciliation('tool:inspect',next,'succeeded',f.store.putArtifact({applied:true}));assert.equal((await f.runtime.resume(run.id,prompt)).status,'completed');assert.equal(shellCalls,1);assert.equal(f.resources.request('tool:inspect')?.status,'uncertain');f.store.close();
});
test('cancellation withdraws run effects and persists through reopen',async()=>{
  let ready!:()=>void;const waiting=new Promise<void>(r=>ready=r);
  const shell:ShellPort={async run({run},bridge,signal){ready();await new Promise<void>(r=>signal!.addEventListener('abort',()=>r(),{once:true}));await assert.rejects(bridge.execute({id:'after-cancel',runId:run.id,stepId:'s',name:'speech',arguments:'forbidden'}));return {status:'cancelled',observations:[]};}};
  const {filename}=paths(),f=setup(filename,shell);const run=f.runtime.admit(input,authority,envelope);const pending=f.runtime.resume(run.id,prompt);await waiting;f.runtime.cancel(run.id,'alice','stop');assert.equal((await pending).status,'cancelled');assert.equal(f.effects.get('tool:after-cancel'),undefined);f.store.close();const reopened=setup(filename,shell);assert.equal(reopened.runtime.getRun(run.id)?.status,'cancelled');reopened.store.close();
});
