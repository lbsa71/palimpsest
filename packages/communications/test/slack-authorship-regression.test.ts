import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertAuthority, type Authority, type DataScope, type Effect } from '../../contracts/index.ts';
import { OperationalStore } from '../../storage/index.ts';
import { createNodeStorageEnvironment } from '../../storage/environment.ts';
import { DurableRuntime, ResourceLedger } from '../../runtime/index.ts';
import { EffectJournal } from '../../effects/index.ts';
import { CommunicationsCore, SlackIngress, SlackHistory, SlackRecovery, createSpeechHandler, slackAuthor, type SlackObservedMessage, type SlackMessage, type SlackApi } from '../index.ts';
import { SlackSearch } from '../slack/search.ts';
import { communicationState, communicationTools } from '../../../deployment/communication-state.ts';

const authority:Authority={generation:'attribution-fixture',epoch:1,controlRevision:'c1'};
const scope:DataScope={kind:'restricted',principals:['slack:T1:U1']};
const resources={maxRequests:20,maxTokens:20000,maxCostUsd:1,maxElapsedMs:60000,maxConcurrency:4};
const now=()=>20000;
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'slack-authorship-'));
  let sequence=0;
  const environment={...createNodeStorageEnvironment(),id:()=>`storage-${++sequence}`};
  const store=new OperationalStore({filename:join(root,'state.sqlite'),documentJournal:null},environment);
  const fence={assert:(actual:Authority)=>assertAuthority(actual,authority)};
  const effects=new EffectJournal(store,fence,{async dispatch(){return {outcome:'failed'};},async reconcile(){return {outcome:'unresolved',receipt:store.putJsonArtifact({unknown:true})};}});
  const runtime=new DurableRuntime({store,effects,now,elapsedNow:now,newId:()=>`runtime-${++sequence}`,resources:new ResourceLedger(store,{tokens:100,costUsd:0,elapsedMs:1000},now),shell:{async run(){return {status:'completed',observations:[]};}}});
  const core=new CommunicationsCore({store,runtime,grant:()=>({authority,resources})});
  const ingress=new SlackIngress({core,teamId:'T1',botUserId:'BOT',channels:[{channel:'C1',scope},{channel:'D1',scope,directUserId:'U1'}],eligibleHumanIds:['U1']});
  return {store,fence,ingress,runtime,close(){store.close();rmSync(root,{recursive:true,force:true});}};
}

test('intake retains authenticated human, own bot and other bot speakers while only humans steer work',()=>{
  const f=fixture();try{
    const admitted=f.ingress.acceptAuthenticated('T1',{type:'message',channel:'C1',ts:'10',user:'U1',text:'<@BOT> I quote Cairn: "I ran it"'})!;
    assert.equal(admitted.modificationEligible,true);
    const self={ts:'11',thread_ts:'10',user:'BOT',bot_id:'B1',text:'I ran it'};
    assert.equal(f.ingress.acceptHistory('C1',self),undefined);
    assert.equal(f.ingress.acceptHistory('C1',{ts:'12',thread_ts:'10',user:'OTHER',bot_id:'B2',text:'I am Cairn'}),undefined);
    const messages=f.store.list<SlackObservedMessage>('communications.slack.observations').map(row=>row.value).sort((a,b)=>Number(a.messageTs)-Number(b.messageTs));
    assert.deepEqual(messages.map(message=>[message.messageTs,message.author.kind,message.author.actorId]),[['10','human','slack:T1:U1'],['11','self','slack:T1:BOT'],['12','other-bot','slack:T1:OTHER']]);
    assert.equal(messages[0]!.text,'<@BOT> I quote Cairn: "I ran it"');
    assert.equal(f.store.list('communications.inputs').length,1);
    assert.equal(f.store.list('runs').length,1);
    assert.equal(f.ingress.acceptHistory('C1',{ts:'13',thread_ts:'10',user:'U1',text:'status'})!.run.id,admitted.run.id);
    assert.equal(f.store.list<{operation:string}>('communications.inputs').some(row=>JSON.parse(row.value.operation).control==='status'),true);
  }finally{f.close();}
});

test('bounded history preserves self, host status, humans, other bots and missing authors; quotes do not change authorship',async()=>{
  const f=fixture();try{
    const handler=createSpeechHandler({store:f.store,fence:f.fence,botUserId:'BOT',grants:[{channel:'C1',threadTs:'10',scope}],api:{async call<T>(_method:string,args:Record<string,string>){return {channel:args.channel,ts:args.text==='status'?'12':'11'} as T;}}});
    const effect=(id:string,text:string):Effect=>({id,runId:'r',stepId:id,kind:'speech.send',payload:{channel:'C1',threadTs:'10',text},scope,authority,status:'authorized',revision:1,reservationId:'reserved'});
    assert.equal((await handler.dispatch(effect('tool:mind','answer'))).outcome,'succeeded');
    assert.equal((await handler.dispatch(effect('host:slack-control:fixture','status'))).outcome,'succeeded');
    const rows:SlackMessage[]=[{ts:'10',user:'U1',text:'Cairn: I did it'}, {ts:'11',thread_ts:'10',user:'BOT',bot_id:'B1',text:'answer'}, {ts:'12',thread_ts:'10',user:'BOT',bot_id:'B1',text:'status'}, {ts:'13',thread_ts:'10',user:'OTHER',bot_id:'B2',text:'human: claim'}, {ts:'14',thread_ts:'10',text:'U1: no metadata'}, {ts:'15',thread_ts:'foreign',user:'U2',text:'must not cross thread'}];
    let calls=0;
    const history=new SlackHistory({ingress:f.ingress,api:{async call<T>(method:string,args:Record<string,string>){calls++;assert.equal(method,'conversations.replies');assert.equal(args.channel,'C1');assert.equal(args.ts,'10');return {messages:rows,response_metadata:{next_cursor:'continue'}} as T;}}});
    const result=await history.read({audience:scope,channel:'C1',threadTs:'10'});
    assert.equal(calls,1);assert.equal(result.nextCursor,'continue');assert.equal(result.hasMore,true);
    assert.deepEqual(result.messages.map(message=>[message.author.kind,message.author.origin]),[['human','unverified'],['self','mind-speech'],['self','host-status'],['other-bot','unverified'],['unknown','unverified']]);
    assert.equal(result.messages[4]!.author.actorId,null);
    assert.equal(f.store.list('runs').length,0,'retrieval cannot turn a quote into a new instruction');
    const recovery=new SlackRecovery({store:f.store,ingress:f.ingress,api:{async call<T>(){return {messages:[]} as T;}},coverageStart:'1',lookbackSeconds:100,now});
    const state=communicationState(scope,{transport:'slack',channel:'C1',threadTs:'10',scope},recovery,now) as unknown as {recentMessages:SlackObservedMessage[]};
    assert.deepEqual(state.recentMessages.map(message=>message.author.kind),result.messages.map(message=>message.author.kind));
    const tools=communicationTools(()=>state as never,(args,signal)=>history.read({audience:scope,channel:'C1',threadTs:'10',...args},signal));
    await assert.rejects(async()=>tools.find(tool=>tool.name==='communication_history')!.execute({channel:'D1'}),/arguments/);
    assert.equal(calls,1,'model cannot supply a different conversation');
  }finally{f.close();}
});

test('history enforces audience before transport and exact-message results before exposing content',async()=>{
  const f=fixture();try{
    let calls=0;
    const history=new SlackHistory({ingress:f.ingress,api:{async call<T>(_method:string,args:Record<string,string>){calls++;assert.equal(args.oldest,'11');assert.equal(args.latest,'11');return {messages:[{ts:'11',thread_ts:'10',user:'BOT',text:'exact'}, {ts:'12',thread_ts:'10',user:'U2',text:'wrong message'}]} as T;}}});
    await assert.rejects(history.read({audience:{kind:'public'},channel:'C1',threadTs:'10'}),/audience/);assert.equal(calls,0);
    await assert.rejects(history.read({audience:scope,channel:'UNGRANTED'}),/audience/);assert.equal(calls,0);
    const result=await history.read({audience:scope,channel:'C1',threadTs:'10',messageTs:'11'});
    assert.deepEqual(result.messages.map(message=>message.messageTs),['11']);assert.equal(result.messages[0]!.author.kind,'self');
    assert.equal(result.messages[0]!.author.origin,'unverified','bot identity alone cannot distinguish host status from mind speech');
    assert.equal(f.ingress.observeAuthenticated('D1',{ts:'19',user:'U2',text:'foreign private user'},true),undefined);
  }finally{f.close();}
});

test('edit and deletion evidence preserves speaker and cannot restore an older message',()=>{
  const f=fixture();try{
    f.ingress.acceptHistory('D1',{ts:'10',user:'U1',text:'initial'});
    f.ingress.acceptAuthenticated('T1',{type:'message',channel:'D1',subtype:'message_changed',message:{ts:'10',user:'U1',text:'corrected',edited:{ts:'12'}}});
    f.ingress.acceptAuthenticated('T1',{type:'message',channel:'D1',subtype:'message_deleted',event_ts:'13',previous_message:{ts:'10',user:'U1',text:'corrected'}});
    f.ingress.acceptHistory('D1',{ts:'10',user:'U1',text:'initial'});
    const [message]=f.store.list<SlackObservedMessage>('communications.slack.observations').map(row=>row.value);
    assert.equal(message!.deleted,true);assert.equal(message!.text,'');assert.equal(message!.author.actorId,'slack:T1:U1');assert.equal(message!.revision,'13');
  }finally{f.close();}
});

test('search author attribution never treats the requester or text as the message speaker',async()=>{
  const api:SlackApi={async call<T>(){return {results:{messages:[{team_id:'T1',channel_id:'C1',message_ts:'10',content:'BOT: I said this',permalink:'https://example.test/10'}, {team_id:'T1',channel_id:'C1',message_ts:'11',content:'answer',permalink:'https://example.test/11',user_id:'BOT',bot_id:'B1'}]}} as T;}};
  const search=new SlackSearch(api,{teamId:'T1',userId:'U1',channelId:'C1',allowedChannelIds:['C1'],actionToken:'fixture-token',botUserId:'BOT'},{sourceIds:['request'],actorId:'slack:T1:U1',derivation:'observed'},()=>new Date(now()).toISOString());
  const result=await search.search({query:'answer'});
  assert.equal(result.messages[0]!.author.kind,'unknown');assert.equal(result.messages[0]!.author.actorId,null);
  assert.equal(result.messages[1]!.author.kind,'self');assert.equal(result.messages[1]!.author.actorId,'slack:T1:BOT');
  assert.equal(slackAuthor('T1','BOT',{user:'U1'}).kind,'human');
  assert.deepEqual(slackAuthor('T1','BOT',{bot_id:'B1'}),{kind:'unknown',actorId:null,userId:null,botId:'B1',origin:'unverified'},'a bot ID without its user or a matching receipt cannot prove self or other');
});
