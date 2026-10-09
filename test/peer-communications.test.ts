import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DirectCommunications, createLocalServer } from '../src/communications.ts';
import type { InboundMessage } from '../src/communications.ts';

const operator='operator-token-at-least-16-characters',peer='peer-token-at-least-16-characters';
const headers=(token:string)=>({authorization:`Bearer ${token}`,'content-type':'application/json'});
test('peer route fixes source and namespace and role bearers cannot interchange',async t=>{
  const received:InboundMessage[]=[];const cancelled:string[]=[];
  const tasks:Record<string,unknown>={own:{id:'own',source:'peer',conversationId:'peer:alpha',state:'running'},operator:{id:'operator',source:'direct',conversationId:'local'},slack:{id:'slack',source:'slack',conversationId:'slack:T1:C1:1'},forged:{id:'forged',source:'direct',conversationId:'peer:alpha'},badPeer:{id:'badPeer',source:'peer',conversationId:'local'}};
  const options={token:operator,peerToken:peer};
  const server=await createLocalServer({submit:async input=>{received.push(input);return {id:'own'};},status:id=>tasks[id],cancel:id=>{cancelled.push(id);return {...tasks[id] as object,state:'cancelled'};},events:()=>['operator-only']},options);
  t.after(()=>server.close());
  const message={id:'peer-message',conversationId:'alpha',text:'Ordinary peer conversation'};
  const submitted=await fetch(server.url+'/peer/messages',{method:'POST',headers:headers(peer),body:JSON.stringify(message)});
  assert.equal(submitted.status,202);assert.deepEqual(received,[{...message,source:'peer',conversationId:'peer:alpha'}]);
  assert.equal((await fetch(server.url+'/peer/tasks/own',{headers:headers(peer)})).status,200);
  assert.equal((await fetch(server.url+'/peer/tasks/own/cancel',{method:'POST',headers:headers(peer)})).status,200);assert.deepEqual(cancelled,['own']);
  for(const path of ['/messages','/tasks/operator','/tasks/operator/cancel','/events'])assert.equal((await fetch(server.url+path,{headers:headers(peer)})).status,401,path);
  for(const path of ['/peer/messages','/peer/tasks/own','/peer/tasks/own/cancel'])assert.equal((await fetch(server.url+path,{headers:headers(operator)})).status,401,path);
  for(const id of ['operator','slack','forged','badPeer','missing']){
    assert.equal((await fetch(server.url+'/peer/tasks/'+id,{headers:headers(peer)})).status,404,id);
    assert.equal((await fetch(server.url+'/peer/tasks/'+id+'/cancel',{method:'POST',headers:headers(peer)})).status,404,id);
  }
  assert.deepEqual(cancelled,['own']);
});
test('peer ingress rejects metadata forgery, browser origins and bad bodies before runtime ingress',async t=>{
  let calls=0;const options={token:operator,peerToken:peer};
  const server=await createLocalServer({submit:async()=>{calls++;return {};},status:()=>undefined,cancel:()=>undefined,events:()=>[]},options);t.after(()=>server.close());
  const ordinary={id:'peer-message',conversationId:'alpha',text:'Converse'};
  for(const patch of [{source:'direct'},{source:'slack'},{slackAuthor:{teamId:'T1',userId:'U1'}},{role:'operator'},{eligible:true},{conversationId:''}]){
    const reply=await fetch(server.url+'/peer/messages',{method:'POST',headers:headers(peer),body:JSON.stringify({...ordinary,...patch})});assert.equal(reply.status,400);
  }
  assert.equal((await fetch(server.url+'/peer/messages',{method:'POST',headers:{...headers(peer),origin:'https://example.invalid'},body:JSON.stringify(ordinary)})).status,403);
  assert.equal(calls,0);
  assert.equal((await fetch(server.url+'/peer/messages',{method:'POST',headers:headers(peer),body:JSON.stringify({...ordinary,source:'peer',replyTo:'reply-root'})})).status,202);assert.equal(calls,1);
  assert.equal((await fetch(server.url+'/messages',{method:'POST',headers:headers(operator),body:JSON.stringify({...ordinary,source:'direct',conversationId:'peer:alpha'})})).status,400);assert.equal(calls,1);
  const direct=new DirectCommunications();await assert.rejects(direct.receive({...ordinary,source:'direct',conversationId:'peer:alpha'},async()=>1),/invalid.*context|invalid_message/);
});
