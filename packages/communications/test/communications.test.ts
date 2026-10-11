import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { createHmac } from 'node:crypto';
import { assertAuthority, identity } from '../../contracts/common.ts';
import type { Authority, DataScope, JsonValue } from '../../contracts/common.ts';
import type { Effect, EffectReceiver, ShellPort } from '../../contracts/execution/index.ts';
import { OperationalStore } from '../../storage/index.ts';
import { EffectJournal } from '../../effects/index.ts';
import { DurableRuntime, ResourceLedger } from '../../runtime/index.ts';
import { ObligationRegistry } from '../../initiative/index.ts';
import { CommunicationsCore, bearerAuthenticator, createDirectApi, SlackClient, SlackError, SlackIngress, SlackRecovery, SlackSocketMode, createSpeechHandler, verifySlackSignature } from '../index.ts';
import type { SlackApi, SlackPage, SocketLike } from '../index.ts';

const authority:Authority={generation:'test-generation',epoch:1,controlRevision:'c1'};
const scope:DataScope={kind:'restricted',principals:['channel:C1']};
const resources={maxRequests:20,maxTokens:20000,maxCostUsd:1,maxElapsedMs:60000,maxConcurrency:4};
const prompt={id:'communication-test',fragments:[],requestDigest:identity('fixture')};
const actor={id:'slack:T1:U1',scope,modificationEligible:true};
const noEffect:EffectReceiver={async dispatch(){return {outcome:'failed'};},async reconcile(){throw new Error('unused');}};
function fixture(shell:ShellPort={async run(){return {status:'completed',observations:[]};}}){
  const root=mkdtempSync(join(tmpdir(),'aeon-communications-')),filename=join(root,'state.db'),store=new OperationalStore({filename});
  const fence={assert(a:Authority){assertAuthority(a,authority);}};const effects=new EffectJournal(store,fence,noEffect),ledger=new ResourceLedger(store,{tokens:100,costUsd:0,elapsedMs:1000});
  const runtime=new DurableRuntime({store,effects,resources:ledger,shell});const core=new CommunicationsCore({store,runtime,grant:()=>({authority,resources})});
  const ingress=new SlackIngress({core,teamId:'T1',botUserId:'BOT',channels:[{channel:'C1',scope}],eligibleHumanIds:['U1']});
  return {root,filename,store,fence,runtime,core,ingress,close(){store.close();rmSync(root,{recursive:true,force:true});}};
}
async function listen(server:Server):Promise<string>{await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();assert(address && typeof address==='object');return `http://127.0.0.1:${address.port}`;}
async function closeServer(server:Server):Promise<void>{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
function message(externalId='m1',revision='1',text='start'){return {source:'direct',externalId,revision,conversation:'c1',text,actor};}
function recovery(f:ReturnType<typeof fixture>,api:SlackApi,maxPages=1){return new SlackRecovery({store:f.store,api,ingress:f.ingress,coverageStart:'1',lookbackSeconds:1000,now:()=>100000,maxPagesPerTick:maxPages,pageSize:2});}
async function complete(r:SlackRecovery){for(let n=0;n<30;n++)if((await r.tick()).complete)return;throw new Error('recovery did not complete');}

test('unbounded recovery or reconciliation configuration is rejected',()=>{
  const f=fixture();const api:SlackApi={async call<T>(){return {messages:[]} as T;}};
  try{const r=recovery(f,api);assert.throws(()=>new SlackRecovery({...r.options,lookbackSeconds:Infinity}),/bounded/);assert.throws(()=>new SlackRecovery({...r.options,maxPagesPerTick:0}),/bound/);assert.throws(()=>createSpeechHandler({store:f.store,fence:f.fence,api,botUserId:'BOT',grants:[],maxReconcilePages:Infinity}),/bound/);}finally{f.close();}
});
test('production Slack client accepts Socket Mode method and camel case speech, rejects redirects and bounded oversized bodies',async()=>{
  let forwarded=0;const methods:string[]=[];
  const server=createServer((req,res)=>{methods.push(req.url!);if(req.url==='/api/auth.test'){res.writeHead(307,{location:'/must-not-forward'});res.end();return;}if(req.url==='/must-not-forward'){forwarded++;res.end('{}');return;}if(req.url==='/api/conversations.history'){res.end(JSON.stringify({ok:true,messages:[{text:'x'.repeat(1000)}]}));return;}res.end(JSON.stringify(req.url==='/api/apps.connections.open'?{ok:true,url:'wss://wss.slack.com/link?ticket=fake'}:{ok:true,channel:'C1',ts:'55'}));});
  const url=await listen(server);const client=new SlackClient({token:'fake-token',endpoint:`${url}/api/`,maxResponseBytes:200});
  try{assert.equal((await client.call<{url:string}>('apps.connections.open',{})).url,'wss://wss.slack.com/link?ticket=fake');assert.equal((await client.call<{ts:string}>('chat.postMessage',{})).ts,'55');await assert.rejects(client.call('auth.test',{}));assert.equal(forwarded,0);await assert.rejects(client.call('conversations.history',{}),/byte bound/);assert(methods.includes('/api/apps.connections.open'));assert(methods.includes('/api/chat.postMessage'));}finally{await closeServer(server);}
});
test('direct output view authenticates audience before accessing host explicit speech outbox',async()=>{
  const f=fixture();const run=f.core.receive(message()).run;let reads=0;
  const foreign={id:'foreign',scope:{kind:'restricted',principals:['other']} as DataScope,modificationEligible:false};
  const server=createDirectApi({core:f.core,authenticate:bearerAuthenticator([{token:'owner',principal:actor},{token:'foreign',principal:foreign}]),outputForRun(id){reads++;assert.equal(id,run.id);return [{text:'explicit delivered speech'}];}});const url=await listen(server);
  try{const path=`${url}/runs/${encodeURIComponent(run.id)}/output`;assert.equal((await fetch(path,{headers:{authorization:'Bearer foreign'}})).status,400);assert.equal(reads,0);const result=await fetch(path,{headers:{authorization:'Bearer owner'}});assert.equal(result.status,200);assert.deepEqual(await result.json(),[{text:'explicit delivered speech'}]);assert.equal(reads,1);}finally{await closeServer(server);f.close();}
});
test('distinct conversation runs share the trusted host parent resource envelope',async()=>{
  const f=fixture({async run(input,bridge,signal){await bridge.execute({id:`request:${input.run.id}`,runId:input.run.id,stepId:'one',name:'test-tool',arguments:{}},signal);return {status:'completed',observations:[]};}});
  try{const maximum={...resources,maxRequests:1};f.runtime.resources.allocate('host-envelope',maximum);const core=new CommunicationsCore({store:f.store,runtime:f.runtime,grant:()=>({authority,resources:maximum,parentRunId:'host-envelope'})});
    const first=core.receive(message()).run,second=core.receive({...message('another','1','new request'),conversation:'second'}).run;
    assert.equal((await f.runtime.resume(first.id,prompt)).status,'completed');assert.equal((await f.runtime.resume(second.id,prompt)).status,'blocked');assert.equal(f.store.list('effects').filter(e=>(e.value as unknown as Effect).status==='failed').length,1);
  }finally{f.close();}
});

test('same runtime admission is durable, authenticated, conflicting duplicates rejected and author eligibility separate',()=>{
  const f=fixture();try{
    const first=f.core.receive(message());assert.equal(first.run.status,'ready');assert.equal(f.core.receive(message()).duplicate,true);
    assert.throws(()=>f.core.receive(message('m1','1','conflicting')),/conflicting/);
    const slack=f.ingress.acceptAuthenticated('T1',{type:'app_mention',channel:'C1',ts:'2',user:'U2',text:'<@BOT> hello'})!;
    assert.equal(slack.modificationEligible,false);assert.equal(slack.run.status,'ready');assert.equal(f.store.list('runs').length,2);
    assert.throws(()=>f.ingress.acceptAuthenticated('T2',{type:'message',channel:'C1'}),/foreign/);
    assert.equal(f.ingress.acceptAuthenticated('T1',{type:'message',channel:'C2',ts:'3',user:'U1',text:'<@BOT>'}),undefined);
  }finally{f.close();}
});
test('mention joins thread, ordinary follow-up steers same run and edited input reaches original run',()=>{
  const f=fixture();try{
    assert.equal(f.ingress.acceptHistory('C1',{ts:'10',user:'U1',text:'ordinary'}),undefined);
    const run=f.ingress.acceptHistory('C1',{ts:'11',user:'U1',text:'<@BOT> work'})!.run;
    assert.equal(f.ingress.acceptHistory('C1',{ts:'12',thread_ts:'11',user:'U2',text:'follow-up'})!.run.id,run.id);
    assert.equal(f.ingress.acceptAuthenticated('T1',{type:'message',channel:'C1',subtype:'message_changed',message:{ts:'11',user:'U1',text:'revised',edited:{ts:'13'}}})!.run.id,run.id);
    assert.equal(f.store.events(run.id).filter(e=>e.type==='steering').length,2);
    f.ingress.acceptHistory('C1',{ts:'11',user:'U1',text:'<@BOT> work'});
    assert.equal(f.store.events(run.id).filter(e=>e.type==='steering').length,2);
    assert.throws(()=>f.ingress.acceptHistory('C1',{ts:'11',user:'IMPOSTOR',text:'revised',edited:{ts:'14'}}),/origin/);
  }finally{f.close();}
});
test('reordered recovered revisions cannot steer newer input backwards; controls and target bound to dedup',()=>{
  const f=fixture();try{
    const run=f.core.receive(message()).run;f.core.receive(message('m1','3','latest'));f.core.receive(message('m1','2','stale'));
    assert.equal(f.store.events(run.id).filter(e=>e.type==='steering').length,1);
    assert.throws(()=>f.core.receive({...message(),control:'cancel'}),/conflicting/);
    assert.throws(()=>f.core.receive({...message('foreign-control','1','stop'),conversation:'another-conversation',targetRunId:run.id,control:'cancel'}),/registered/);
    assert.throws(()=>f.core.status(run.id,{...actor,scope:{kind:'restricted',principals:['someone-else']}}),/denied/);
  }finally{f.close();}
});
test('control of an old completed run preserves the thread current run mapping',async()=>{
  const f=fixture();try{const first=f.core.receive(message()).run;await f.runtime.resume(first.id,prompt);const current=f.core.receive(message('second','1','new work')).run;
    f.core.receive({...message('old-status','1','status'),actor:{...actor,controlledRunIds:[first.id]},control:'status',targetRunId:first.id});
    assert.equal(f.core.receive(message('followup','1','continue')).run.id,current.id);
  }finally{f.close();}
});
test('revised input interrupts its running run and persists correction for resumed execution',async()=>{
  let started!:()=>void;const entered=new Promise<void>(r=>{started=r;});let calls=0;const seen:string[]=[];
  const f=fixture({async run(input,_bridge,signal){calls++;seen.push(JSON.stringify(input.messages));if(calls===1){started();await new Promise<void>(r=>signal!.addEventListener('abort',()=>r(),{once:true}));return {status:'checkpointed',observations:[]};}return {status:'completed',observations:[]};}});
  try{const run=f.core.receive(message()).run,active=f.runtime.resume(run.id,prompt);await entered;assert.equal(f.core.receive(message('m1','2','corrected objective')).run.id,run.id);assert.equal((await active).status,'waiting');assert.equal((await f.runtime.resume(run.id,prompt)).status,'completed');assert(seen[1]!.includes('corrected objective'));}finally{f.close();}
});
test('real HTTP server serves status and cancellation while a real DurableRuntime shell is waiting',async()=>{
  let started!:()=>void;const entered=new Promise<void>(r=>{started=r;});
  const f=fixture({async run(_input,_bridge,signal){started();await new Promise<void>(r=>signal!.addEventListener('abort',()=>r(),{once:true}));return {status:'cancelled',observations:[]};}});
  const api=createDirectApi({core:f.core,authenticate:bearerAuthenticator([{token:'test-secret',principal:actor}])}),url=await listen(api);
  const post=(value:unknown,token='test-secret')=>fetch(`${url}/inputs`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(value)});
  try{
    assert.equal((await post({externalId:'x',revision:'1',conversation:'x',text:'x'},'wrong')).status,401);
    assert.equal((await post({externalId:'x',revision:'1',conversation:'x',text:'x',authority})).status,400);
    const response=await post({externalId:'x',revision:'1',conversation:'x',text:'slow work'});assert.equal(response.status,202);const admitted=await response.json() as {run:{id:string}};
    const work=f.runtime.resume(admitted.run.id,prompt);await entered;
    const before=performance.now();const status=await fetch(`${url}/runs/${encodeURIComponent(admitted.run.id)}`,{headers:{authorization:'Bearer test-secret'}});assert.equal((await status.json() as {status:string}).status,'running');
    const cancel=await post({externalId:'cancel',revision:'1',conversation:'x',text:'stop',control:'cancel',targetRunId:admitted.run.id});assert.equal(cancel.status,202);assert.equal((await work).status,'cancelled');
    assert(performance.now()-before<1000,'status/cancel blocked behind long work');
  }finally{await closeServer(api);f.close();}
});
test('Slack live/history delivery race and restart deduplicate into same durable run',()=>{
  const f=fixture();try{
    const live=f.ingress.acceptHistory('C1',{ts:'10',user:'U1',text:'<@BOT> recover'})!;
    const other=new OperationalStore({filename:f.filename});const runtime=new DurableRuntime({store:other,effects:new EffectJournal(other,f.fence,noEffect),resources:new ResourceLedger(other,{tokens:100,costUsd:0,elapsedMs:1000}),shell:{async run(){return {status:'completed',observations:[]};}}});
    const core=new CommunicationsCore({store:other,runtime,grant:()=>({authority,resources})});
    const ingress=new SlackIngress({...f.ingress.options,core});assert.equal(ingress.acceptHistory('C1',{ts:'10',user:'U1',text:'<@BOT> recover'})!.duplicate,true);assert.equal(ingress.acceptHistory('C1',{ts:'11',thread_ts:'10',user:'U1',text:'while offline'})!.run.id,live.run.id);other.close();
    assert.equal(f.store.list('runs').length,1);
  }finally{f.close();}
});
test('paginated network history recovers first offline mention inside a previously unjoined thread, then ordinary replies',async()=>{
  const f=fixture();const calls:URLSearchParams[]=[];
  const server=createServer((req,res)=>{void(async()=>{let body='';for await(const chunk of req)body+=chunk;const p=new URLSearchParams(body);calls.push(p);assert.equal(req.headers.authorization,'Bearer fake-bot-token');
    const page=req.url?.endsWith('conversations.history')?p.has('cursor')?{messages:[{ts:'20',user:'U2',text:'older root',reply_count:2}]}:{messages:[{ts:'30',user:'U2',text:'irrelevant'}],response_metadata:{next_cursor:'page2'}}:p.has('cursor')?{messages:[{ts:'22',thread_ts:'20',user:'U2',text:'ordinary missed followup'}]}:{messages:[{ts:'20',user:'U2',text:'older root'},{ts:'21',thread_ts:'20',user:'U1',text:'<@BOT> first mention offline'}],response_metadata:{next_cursor:'reply2'}};
    res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,...page}));})().catch(e=>{res.statusCode=500;res.end(String(e));});});
  const url=await listen(server);
  try{
    const api=new SlackClient({token:'fake-bot-token',endpoint:`${url}/api/`});const first=recovery(f,api);assert.equal((await first.tick()).pages,1);assert.equal(first.state().cycle!.current!.cursor,'page2');
    // A fresh adapter resumes the durable page cursor.
    const restarted=recovery(f,api);await complete(restarted);assert.equal(f.store.list('runs').length,1);const run=f.store.list<{id:string}>('runs')[0]!.value;assert.equal(f.store.events(run.id).filter(e=>e.type==='steering').length,1);assert.equal(calls.length,4);assert(calls.every(c=>c.get('limit')==='2'&&c.get('latest')==='100'));
  }finally{await closeServer(server);f.close();}
});
test('rate-limit preserves cursor and retry deadline; permission and retention gaps remain visible',async()=>{
  const f=fixture();let count=0;const api:SlackApi={async call<T>(){count++;if(count===1)throw new SlackError('ratelimited',5000);return {messages:[],is_limited:true} as T;}};
  try{const r=recovery(f,api);assert.equal((await r.tick()).retryAt,105000);assert.equal((await r.tick()).pages,0);assert.equal(count,1);const later=new SlackRecovery({...r.options,now:()=>106000});await complete(later);assert(later.state().gaps.some(g=>g.kind==='retention'));
    const permission=recovery(f,{async call(){throw new SlackError('missing_scope');}},3);await complete(permission);assert(permission.state().gaps.some(g=>g.kind==='permission'));
  }finally{f.close();}
});
test('atomic cursor/admission rollback retains current page after conflicting history',async()=>{
  const f=fixture();f.ingress.acceptHistory('C1',{ts:'10',user:'U1',text:'<@BOT> existing'});
  try{const r=recovery(f,{async call<T>(){return {messages:[{ts:'9',user:'U1',text:'<@BOT> tentative'},{ts:'10',user:'U1',text:'<@BOT> conflicting'}],response_metadata:{next_cursor:'must-not-commit'}} as T;}});
    await assert.rejects(r.tick(),/conflicting/);assert.equal(r.state().cycle!.current!.cursor,'');assert.equal(f.store.list('runs').length,1);assert.equal(f.ingress.threads().length,1);
  }finally{f.close();}
});
test('known joined threads are scanned even if channel history contains no parent, with explicit coverage gap',async()=>{
  const f=fixture();f.ingress.acceptHistory('C1',{ts:'2',user:'U1',text:'<@BOT> join'});const methods:string[]=[];
  try{const r=new SlackRecovery({...recovery(f,{async call<T>(method:string){methods.push(method);return {messages:method==='conversations.replies'?[{ts:'90',thread_ts:'2',user:'U2',text:'missed'}]:[]} as T;}}).options,lookbackSeconds:10});await complete(r);assert(methods.includes('conversations.replies'));assert(r.state().gaps.some(g=>g.kind==='coverage'));assert.equal(f.store.list('runs').length,1);
  }finally{f.close();}
});
test('signature authentication rejects altered body and replay timestamp',()=>{
  const timestamp='100',body='{"event":"synthetic"}',secret='fake-signing-secret',signature=`v0=${createHmac('sha256',secret).update(`v0:${timestamp}:${body}`).digest('hex')}`;
  assert(verifySlackSignature({secret,timestamp,body,signature,nowMs:100000}));assert(!verifySlackSignature({secret,timestamp,body:body+'x',signature,nowMs:100000}));assert(!verifySlackSignature({secret,timestamp,body,signature,nowMs:500000}));
});
test('Socket Mode authenticates tokens, commits before ACK, reconnects and invokes recovery automatically',async()=>{
  const f=fixture();let opens=0,acks=0,recovered=0;const sockets:SocketLike[]=[];
  const r=recovery(f,{async call<T>(){recovered++;return {messages:[]} as T;}},4);
  const factory=()=>{const listeners=new Map<string,((e:any)=>void)[]>();const socket:SocketLike={addEventListener(type,fn){listeners.set(type,[...(listeners.get(type)??[]),fn]);},send(data){assert(f.store.list('communications.inputs').length===1,'ACK preceded durable input');assert.equal(JSON.parse(data).envelope_id,'envelope');acks++;},close(){}};sockets.push(socket);
    setTimeout(()=>{listeners.get('message')?.forEach(fn=>fn({data:JSON.stringify({type:'events_api',envelope_id:'envelope',payload:{team_id:'T1',event:{type:'app_mention',channel:'C1',ts:'50',user:'U1',text:'<@BOT> socket'}}})}));listeners.get('message')?.forEach(fn=>fn({data:JSON.stringify({type:'disconnect'})}));},1);return socket;};
  const socket=new SlackSocketMode({botApi:{async call<T>(){return {team_id:'T1',user_id:'BOT'} as T;}},appApi:{async call<T>(){opens++;return {url:'wss://wss.slack.com/link?ticket=fake'} as T;}},ingress:f.ingress,recovery:r,socket:factory,reconnectMinMs:2,reconnectMaxMs:4,recoveryIntervalMs:2});
  try{socket.start();for(let i=0;i<100 && (opens<2||acks<2||recovered<1);i++)await delay(2);await socket.stop();assert(opens>=2);assert(acks>=2);assert(recovered>=1);assert.equal(f.store.list('runs').length,1);}finally{await socket.stop();f.close();}
});
test('Socket Mode rejects foreign token identity and does not ACK malformed event intake',async()=>{
  const f=fixture();let opens=0,acks=0,rejections=0;
  const r=recovery(f,{async call<T>(){return {messages:[]} as T;}},4);
  const foreign=new SlackSocketMode({botApi:{async call<T>(){return {team_id:'OTHER',user_id:'BOT'} as T;}},appApi:{async call<T>(){opens++;return {url:'wss://wss.slack.com/link'} as T;}},ingress:f.ingress,recovery:r,reconnectMinMs:1,reconnectMaxMs:2,recoveryIntervalMs:2});
  try{foreign.start();await delay(10);await foreign.stop();assert.equal(opens,0);
    const malformed=new SlackSocketMode({...foreign.options,botApi:{async call<T>(){return {team_id:'T1',user_id:'BOT'} as T;}},onError(){rejections++;},socket:()=>{const listeners=new Map<string,(e:any)=>void>();const s:SocketLike={addEventListener(type,fn){listeners.set(type,fn);},send(){acks++;},close(){}};setTimeout(()=>{listeners.get('message')?.({data:JSON.stringify({type:'events_api',envelope_id:'malformed'})});listeners.get('close')?.({});},1);return s;}});
    malformed.start();await delay(10);await malformed.stop();assert.equal(acks,0);assert(rejections>0);
  }finally{await foreign.stop();f.close();}
});
test('explicit speech creates actual receipt; unregistered targets and forged authority/scope cannot send',async()=>{
  const f=fixture();let sends=0;const receiver=createSpeechHandler({store:f.store,fence:f.fence,botUserId:'BOT',api:{async call<T>(){sends++;return {channel:'C1',ts:'55'} as T;}},grants:[{channel:'C1',threadTs:'10',scope}]});
  const effect:Effect={id:'speech-1',runId:'run1',stepId:'step1',kind:'speech.send',payload:{channel:'C1',threadTs:'10',text:'verified outcome',kind:'report',obligationId:'owed1',obligationRevision:0},scope,authority,status:'pending',revision:0};
  try{const result=await receiver.dispatch(effect);assert.equal(result.outcome,'succeeded');const receipt=f.store.readJsonArtifact<{delivered:boolean;obligationId:string;obligationRevision:number;messageTs:string}>(result.receipt!);assert.equal(receipt.delivered,true);assert.equal(receipt.messageTs,'55');assert.equal(receipt.obligationId,'owed1');assert.equal(receipt.obligationRevision,0);
    await assert.rejects(receiver.dispatch({...effect,payload:{channel:'C2',text:'leak'}}),/denied/);await assert.rejects(receiver.dispatch({...effect,payload:{channel:'C1',threadTs:'10',text:'leak',authority:'self-granted'}}),/privileged/);await assert.rejects(receiver.dispatch({...effect,scope:{kind:'restricted',principals:['other']}}),/denied/);assert.equal(sends,1);
  }finally{f.close();}
});
test('lost send receipt reconciles durable effect using paginated client_msg_id without resending',async()=>{
  const f=fixture();let sentId='',posts=0,pages=0;const receiver=createSpeechHandler({store:f.store,fence:f.fence,botUserId:'BOT',api:{async call<T>(method:string,args:Record<string,string>){if(method==='chat.postMessage'){posts++;sentId=args.client_msg_id!;throw new Error('receipt lost after remote commit');}pages++;return (pages===1?{messages:[],response_metadata:{next_cursor:'older'}}:{messages:[{ts:'75',user:'BOT',thread_ts:'10',text:'report',client_msg_id:sentId}]}) as T;}},grants:[{channel:'C1',threadTs:'10',scope}]});const journal=new EffectJournal(f.store,f.fence,receiver);
  try{journal.create({id:'lost-speech',runId:'r',stepId:'s',kind:'speech.send',payload:{channel:'C1',threadTs:'10',text:'report',kind:'report'},scope,authority,status:'pending',revision:0});journal.authorize('lost-speech','reservation',authority);assert.equal((await journal.dispatch('lost-speech',authority)).status,'uncertain');assert.equal((await journal.reconcile('lost-speech',authority)).status,'succeeded');assert.equal(posts,1);assert.equal(pages,2);
  }finally{f.close();}
});
test('missing receipt remains uncertain through bounded scans or missing permission; no automatic retry',async()=>{
  const f=fixture();const receiver=createSpeechHandler({store:f.store,fence:f.fence,botUserId:'BOT',api:{async call<T>(){return {messages:[],response_metadata:{next_cursor:'more'}} as T;}},grants:[{channel:'C1',scope}],maxReconcilePages:2});
  try{const effect:Effect={id:'unknown',runId:'r',stepId:'s',kind:'speech.send',payload:{channel:'C1',text:'report'},scope,authority,status:'uncertain',revision:2,reservationId:'reserved'};assert.equal((await receiver.reconcile(effect)).outcome,'unresolved');const denied=createSpeechHandler({store:f.store,fence:f.fence,botUserId:'BOT',api:{async call(){throw new SlackError('missing_scope');}},grants:[{channel:'C1',scope}]});assert.equal((await denied.reconcile(effect)).outcome,'unresolved');}finally{f.close();}
});
test('matching client ID from another author never confirms delivery; matching bot survives Slack text sanitization',async()=>{
  const f=fixture();let clientId='';let user='IMPOSTOR';const receiver=createSpeechHandler({store:f.store,fence:f.fence,botUserId:'BOT',api:{async call<T>(method:string,args:Record<string,string>){if(method==='chat.postMessage'){clientId=args.client_msg_id!;throw new Error('lost');}return {messages:[{ts:'80',thread_ts:'80',text:'Slack sanitized text',user,client_msg_id:clientId}]} as T;}},grants:[{channel:'C1',scope}]});
  try{const effect:Effect={id:'author-check',runId:'r',stepId:'s',kind:'speech.send',payload:{channel:'C1',text:'original text'},scope,authority,status:'pending',revision:0};await receiver.dispatch(effect);assert.equal((await receiver.reconcile(effect)).outcome,'unresolved');user='BOT';assert.equal((await receiver.reconcile(effect)).outcome,'succeeded');}finally{f.close();}
});
test('joined actual runtime speech and obligation registry hold unknown delivery until bot receipt reconciles',async()=>{
  const f=fixture();const obligations=new ObligationRegistry(f.store);const owed=obligations.owe({id:'owed-report',inputId:'source-input',audience:scope,promisedOutcome:'verified result',dueAt:null});let clientId='',posts=0;
  const receiver=createSpeechHandler({store:f.store,fence:f.fence,botUserId:'BOT',grants:[{channel:'C1',threadTs:'10',scope}],api:{async call<T>(method:string,args:Record<string,string>){if(method==='chat.postMessage'){posts++;clientId=args.client_msg_id!;throw new Error('receipt lost');}return {messages:[{ts:'99',thread_ts:'10',user:'BOT',client_msg_id:clientId}]} as T;}}});
  const effects=new EffectJournal(f.store,f.fence,receiver),runtime=new DurableRuntime({store:f.store,effects,resources:f.runtime.resources,shell:{async run(input,bridge,signal){await bridge.execute({id:'owed-speech',runId:input.run.id,stepId:'speech-step',name:'speech.send',arguments:{channel:'C1',threadTs:'10',text:'verified result',kind:'report',obligationId:owed.id,obligationRevision:owed.revision}},signal);return {status:'completed',observations:[]};}}});
  try{const run=runtime.admit({id:'joined',source:'direct',externalId:'joined-source',externalRevision:'1',actorId:actor.id,authenticated:true,scope,value:'please report result'},authority,resources);const delivering=obligations.beginDelivery(owed.id,owed.revision,'tool:owed-speech');
    assert.equal((await runtime.resume(run.id,prompt)).status,'blocked');assert.equal(obligations.obligation(owed.id)!.status,'delivering');assert.throws(()=>obligations.confirmDelivery(owed.id,delivering.revision),/confirmed receipt/);
    assert.equal((await effects.reconcile('tool:owed-speech',authority)).status,'succeeded');assert.equal(obligations.confirmDelivery(owed.id,delivering.revision).status,'delivered');assert.equal(posts,1);
  }finally{f.close();}
});
