import { writeFileSync } from 'node:fs';
import { setup, authority, envelope, input, prompt } from './fixtures.ts';
import { createAgentShell } from '../../agent-shell/index.ts';
import { identity } from '../../contracts/common.ts';
import type { ShellPort } from '../../contracts/execution/index.ts';
const [filename,marker,boundary]=process.argv.slice(2);
if(!filename||!marker)throw Error('missing fixture paths');
let shell:ShellPort={async run({run},bridge){
  const observation=await bridge.execute({id:'inspect',runId:run.id,stepId:'inspect',name:'inspect',arguments:{path:'project'}});
  await bridge.persistCheckpoint(run.id,run.revision,'fixture',{phase:'inspected',observations:[observation.id]});
  writeFileSync(marker,'checkpointed');await new Promise(()=>{});throw Error('unreachable');
}};
if (['pending', 'authorized', 'resource-dispatched'].includes(boundary)) {
  shell = { async run({run}) {
    const call = {id:'inspect',runId:run.id,stepId:'inspect',name:'inspect',arguments:{path:'project'}};
    fixture.effects.ensure({id:'tool:inspect',runId:run.id,stepId:'inspect',kind:'inspect',payload:call.arguments,scope:run.scope,authority:run.authority,status:'pending',revision:0});
    if (boundary !== 'pending') {
      const request = {id:'tool:inspect',runId:run.id,purpose:'reasoning' as const,provider:'effect-receiver',model:'inspect',promptManifestId:'tool:inspect',requestDigest:identity(call),reservationId:'tool:inspect',status:'reserved' as const,usage:{requests:1,inputTokens:0,outputTokens:0,costUsd:0,elapsedMs:0}};
      fixture.store.transaction(()=>{fixture.resources.reserve(request);fixture.effects.authorize('tool:inspect',request.id,run.authority);});
      if(boundary==='resource-dispatched')fixture.resources.dispatched({...request,status:'dispatched'});
    }
    writeFileSync(marker,boundary);await new Promise(()=>{});throw Error('unreachable');
  }};
}
if(boundary?.startsWith('selected-')) {
  let round=0;
  shell=createAgentShell({resolveFragment:async()=>'',tools:[{name:'inspect',description:'Inspect project',parameters:{type:'object',properties:{path:{type:'string'}},required:['path']}}],apiKey:()=> 'fixture-key',maxRequests:3,fetch:async()=>{
    if(round++>0){writeFileSync(marker,'selected checkpoint');await new Promise(()=>{});}
    return Response.json({id:'fixture',model:'fixture',choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:'call00001',type:'function',function:{name:'inspect',arguments:'{"path":"project"}'}}]}}],usage:{prompt_tokens:10,completion_tokens:4}});
  }});
}
const fixture=setup(filename,shell,async effect=> {
  if(boundary==='dispatch'||boundary==='selected-dispatch'){writeFileSync(marker,effect.id);await new Promise(()=>{});}
  return {outcome:'succeeded',value:{observed:'inspect retained'}};
});
const run=fixture.runtime.admit(input,authority,envelope);await fixture.runtime.resume(run.id,prompt);
