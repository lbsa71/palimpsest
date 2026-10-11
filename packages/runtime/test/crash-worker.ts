import { writeFileSync } from 'node:fs';
import { setup, authority, envelope, input, prompt } from './fixtures.ts';
import { createAgentShell } from '../../agent-shell/index.ts';
import { Type } from 'typebox';
import type { ShellPort } from '../../contracts/execution/index.ts';
const [filename,marker,boundary]=process.argv.slice(2);
if(!filename||!marker)throw Error('missing fixture paths');
let shell:ShellPort={async run({run},bridge){
  const observation=await bridge.execute({id:'inspect',runId:run.id,stepId:'inspect',name:'inspect',arguments:{path:'project'}});
  await bridge.persistCheckpoint(run.id,run.revision,'fixture',{phase:'inspected',observations:[observation.id]});
  writeFileSync(marker,'checkpointed');await new Promise(()=>{});throw Error('unreachable');
}};
if(boundary?.startsWith('selected-')) {
  let round=0;
  shell=createAgentShell({resolveFragment:async()=>'',tools:[{name:'inspect',description:'Inspect project',parameters:Type.Object({path:Type.String()})}],apiKey:()=> 'fixture-key',maxRequests:3,fetch:async()=>{
    if(round++>0){writeFileSync(marker,'selected checkpoint');await new Promise(()=>{});}
    return Response.json({id:'fixture',model:'fixture',choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:'call00001',type:'function',function:{name:'inspect',arguments:'{"path":"project"}'}}]}}],usage:{prompt_tokens:10,completion_tokens:4}});
  }});
}
const fixture=setup(filename,shell,async effect=> {
  if(boundary==='dispatch'||boundary==='selected-dispatch'){writeFileSync(marker,effect.id);await new Promise(()=>{});}
  return {outcome:'succeeded',value:{observed:'inspect retained'}};
});
const run=fixture.runtime.admit(input,authority,envelope);await fixture.runtime.resume(run.id,prompt);
