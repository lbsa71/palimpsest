import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolEffectReceiver,WorkspaceTools,executeCommand } from '../index.ts';
import { isPublicAddress,validateResearchUrl,fetchPublic } from '../information/research.ts';
import { OperationalStore } from '../../storage/index.ts';
import { EffectJournal } from '../../effects/index.ts';
import { DurableRuntime,ResourceLedger } from '../../runtime/index.ts';
import { assertAuthority,identity } from '../../contracts/common.ts';
import type { JsonValue } from '../../contracts/common.ts';
import type { ShellPort,Effect } from '../../contracts/execution/index.ts';
const authority={generation:'g1',epoch:1,controlRevision:'c1'};
const envelope={maxRequests:100,maxTokens:1000,maxCostUsd:0,maxElapsedMs:600000,maxConcurrency:4};
const prompt={id:'fixture',fragments:[],requestDigest:identity('fixture')};
function fixture(){const root=mkdtempSync(join(tmpdir(),'aeon-tools-')),workspace=join(root,'work'),state=join(root,'state');mkdirSync(workspace);mkdirSync(state);const policy={workspace,protectedPaths:[state],nodeBinary:process.execPath,timeoutMs:5000,maxBytes:65536,maxFiles:200,executables:['/runtime/node','/bin/sh'],maxArgs:20};return {root,workspace,state,policy};}
function asObject(value:JsonValue){assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value;}

test('real discover/search/read/CAS patch/move/diff/delete and symlink/hardlink boundaries',async()=>{
  const f=fixture(),tools=new WorkspaceTools(f.policy);
  try {
    const written=asObject(await tools.execute('write',{path:'sample.txt',content:'alpha\nbeta\n',expectedSha256:null}));
    assert.deepEqual(await tools.execute('discover',{}),{files:['sample.txt']});
    assert.deepEqual(await tools.execute('search',{text:'beta'}),{matches:[{path:'sample.txt',line:2,text:'beta'}]});
    const read=asObject(await tools.execute('read',{path:'sample.txt',startLine:2,endLine:2}));assert.equal(read.content,'beta');
    await assert.rejects(tools.execute('patch',{path:'sample.txt',expectedSha256:'0'.repeat(64),oldText:'beta',newText:'gamma'}),/digest changed/);
    await assert.rejects(tools.execute('write',{path:'../escape',content:'bad',expectedSha256:null}),/invalid workspace/);
    const changed=asObject(await tools.execute('patch',{path:'sample.txt',expectedSha256:written.sha256!,oldText:'beta',newText:'gamma'}));
    assert.equal(readFileSync(join(f.workspace,'sample.txt'),'utf8'),'alpha\ngamma\n');
    assert.equal(asObject(await tools.execute('diff',{path:'sample.txt',before:'alpha\nbeta\n'})).changed,true);
    await tools.execute('move',{path:'sample.txt',to:'moved.txt',expectedSha256:changed.sha256!});
    await tools.execute('delete',{path:'moved.txt',expectedSha256:changed.sha256!});
    assert.deepEqual(await tools.execute('discover',{}),{files:[]});
    writeFileSync(join(f.state,'secret'),'private');symlinkSync(join(f.state,'secret'),join(f.workspace,'alias'));
    await assert.rejects(tools.execute('read',{path:'alias'}),/symlink/);
    rmSync(join(f.workspace,'alias'));linkSync(join(f.state,'secret'),join(f.workspace,'hard'));
    await assert.rejects(tools.execute('read',{path:'hard'}),/hardlink/);
    assert.equal(readFileSync(join(f.state,'secret'),'utf8'),'private');
  }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('ordinary durable shell bridge inspects, observes failed real test, edits, repairs, verifies and retains restart artifacts',async()=>{
  const f=fixture();writeFileSync(join(f.workspace,'calc.mjs'),'export const total = (a,b) => a-b;\n');
  writeFileSync(join(f.workspace,'calc.test.mjs'),"import assert from 'node:assert/strict';import {total} from './calc.mjs';assert.equal(total(2,3),5);\n");
  const store=new OperationalStore({filename:join(f.state,'state.sqlite')});let current=authority;
  const fence={assert(grant:typeof authority){assertAuthority(grant,current);}};
  const receiver=new ToolEffectReceiver({store,fence,grantForRun:()=>({scope:{kind:'public'},workspace:f.policy,actions:['workspace.read','workspace.patch','command.run']})});
  const effects=new EffectJournal(store,fence,receiver),resources=new ResourceLedger(store,{tokens:0,costUsd:0,elapsedMs:5000});
  const trace:string[]=[];
  const shell:ShellPort={async run(input,bridge){let i=0;const call=async(name:string,args:JsonValue)=>bridge.execute({id:`${input.run.id}:${++i}`,runId:input.run.id,stepId:`step:${i}`,name,arguments:args});
    const read=await call('workspace.read',{path:'calc.mjs'});trace.push('inspect');
    const failed=await call('command.run',{executable:'/runtime/node',args:['calc.test.mjs']});assert.equal(failed.kind,'error');assert.equal(asObject(failed.value).exitCode,1);trace.push('failed-test');
    await call('workspace.patch',{path:'calc.mjs',expectedSha256:asObject(read.value).sha256!,oldText:'a-b',newText:'a+b'});trace.push('repair');
    const verified=await call('command.run',{executable:'/runtime/node',args:['calc.test.mjs']});assert.equal(verified.kind,'result');assert.equal(asObject(verified.value).exitCode,0);trace.push('verify');return {status:'completed',observations:[]};}};
  const runtime=new DurableRuntime({store,shell,effects,resources});
  try {
    const run=runtime.admit({id:'i',source:'direct',externalId:'coding',externalRevision:'1',actorId:'owner',authenticated:true,scope:{kind:'public'},value:'repair calc'},authority,envelope);
    assert.equal((await runtime.resume(run.id,prompt)).status,'completed');assert.deepEqual(trace,['inspect','failed-test','repair','verify']);assert.equal(runtime.observations(run.id).length,4);
    const receipts=store.list<Effect>('effects').map(row=>row.value.receipt!);receipts.forEach(ref=>assert.ok(store.readArtifact(ref).length));store.close();
    const reopened=new OperationalStore({filename:join(f.state,'state.sqlite')});try{receipts.forEach(ref=>assert.ok(reopened.readArtifact(ref).length));}finally{reopened.close();}
  }finally{try{store.close();}catch{}rmSync(f.root,{recursive:true,force:true});}
});

test('bounded commands cancel descendants, enforce output limit and reject ungranted executable',async()=>{
  const f=fixture();try {
    await assert.rejects(executeCommand(f.policy,{executable:'/usr/bin/curl',args:[]}),/not granted/);
    const controller=new AbortController(),running=executeCommand(f.policy,{executable:'/bin/sh',args:['-c',"setsid /bin/sh -c 'sleep 1; echo escaped > escaped' & wait"]},controller.signal);setTimeout(()=>controller.abort(),100);
    assert.equal((await running).stoppedFor,'cancelled');
    await new Promise(resolve=>setTimeout(resolve,1100));assert.equal((await executeCommand(f.policy,{executable:'/bin/sh',args:['-c','test ! -e escaped']})).exitCode,0);
    const limited=await executeCommand(f.policy,{executable:'/bin/sh',args:['-c','yes'],maxOutputBytes:128});assert.equal(limited.stoppedFor,'output-limit');assert.ok(Buffer.byteLength(limited.stdout)+Buffer.byteLength(limited.stderr)<=128);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('public research validation rejects credentials, private IPs, mapped IPv6, host and redirect targets',async()=>{
  for(const ip of ['127.0.0.1','10.2.3.4','169.254.169.254','172.16.1.2','192.168.1.1','100.64.0.1','::1','fc00::1','::ffff:127.0.0.1','::ffff:7f00:1','2001:db8::1','2002:7f00:1::'])assert.equal(isPublicAddress(ip),false,ip);
  assert.equal(isPublicAddress('8.8.8.8'),true);assert.equal(isPublicAddress('2606:4700:4700::1111'),true);
  const policy={allowedHosts:['example.com','127.0.0.1'],timeoutMs:1000,maxBytes:4096,maxRedirects:2};
  for(const url of ['http://example.com','https://user:pass@example.com','https://127.0.0.1','https://localhost','https://example.com:8443'])assert.throws(()=>validateResearchUrl(url,policy));
  await assert.rejects(fetchPublic('https://127.0.0.1',policy),/private/);
});

test('queued effect rechecks authority at actual dispatch and explicit speech delegates to its receiver',async()=>{
  const f=fixture(),store=new OperationalStore({filename:join(f.state,'state.sqlite')});let current=authority;
  const fence={assert(grant:typeof authority){assertAuthority(grant,current);}};let spoken=0;
  const speech={async dispatch(){spoken++;return {outcome:'succeeded' as const,receipt:store.putJsonArtifact({sent:true})};},async reconcile(){return {outcome:'unresolved' as const,receipt:store.putJsonArtifact({unknown:true})};}};
  const receiver=new ToolEffectReceiver({store,fence,speechReceiver:speech,grantForRun:()=>({scope:{kind:'public'},workspace:f.policy,actions:['command.run','workspace.write','speech.send']})});
  const effect=(id:string,kind:string,payload:JsonValue):Effect=>({id,runId:'r',stepId:'s',kind,payload,scope:{kind:'public'},authority,status:'dispatched',revision:2,reservationId:id});
  try {
    assert.equal((await receiver.dispatch(effect('speech','speech_send',{channel:'c',text:'hello'}))).outcome,'succeeded');assert.equal(spoken,1);
    const running=receiver.dispatch(effect('first','command.run',{executable:'/bin/sh',args:['-c','sleep .15']}));
    const queued=receiver.dispatch(effect('queued','workspace_write',{path:'late',content:'bad',expectedSha256:null}));setTimeout(()=>{current={...authority,epoch:2};},50);await running;
    assert.equal((await queued).outcome,'failed');
    assert.deepEqual(await new WorkspaceTools(f.policy).execute('discover',{}),{files:[]});
  }finally{store.close();rmSync(f.root,{recursive:true,force:true});}
});
