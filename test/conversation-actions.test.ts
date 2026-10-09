import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Store } from '../src/store.ts';
import { AgentRuntime } from '../src/runtime.ts';
import { ConversationActions } from '../src/conversation-actions.ts';
const response = (text: string) => ({ text, provider: 'fixture', model: 'fixture', usage: { inputTokens: 1, outputTokens: 1 } });
const input = (id: string, userId = 'U1') => ({ id, source: 'slack', conversationId: 'slack:T1:C1:123.000', text: 'Make your replies shorter.', replyTo: '123.000', slackAuthor: { teamId: 'T1', userId } });
const proposal = { summary: 'Concise conversation', rationale: 'Requested bounded cognitive policy change.', acceptanceCriteria: ['Preserve JSON and memory isolation contracts'], files: [{ path: 'src/agent/brain.ts', content: 'export function conversationRequest(){}' }] };
const decision = JSON.stringify({ reply: 'I will evaluate a concise policy.', disposition: 'propose', rationale: 'A bounded proposal is appropriate.', proposal });

test('source binding is persisted before conversation inference and retained through durable acceptance', async () => {
  const store = new Store(':memory:');
  const binding = { version: 1 as const, releaseDigest: 'a'.repeat(64), sourceDigest: 'b'.repeat(64), baseCommit: 'c'.repeat(40) };
  let observations = 0;
  const actions = new ConversationActions({ store, userIds: ['U1'], sourceContext: () => 'Exact source', observeSource: () => { observations++; return binding; } });
  const runtime = new AgentRuntime({ store, conversationActions: actions, communications: [{ name: 'slack', send: async () => {} }], provider: { name: 'fixture', complete: async request => {
    const task = store.listTasks()[0]!;
    assert.deepEqual((task.checkpoint as Record<string, unknown>).sourceBinding, binding);
    assert.deepEqual(JSON.parse(request.prompt).sourceBinding, binding);
    return response(decision);
  } } });
  try {
    const task = await runtime.submit(input('source-bound'));
    await runtime.runUntilIdle();
    assert.equal(store.task(task.id)?.state, 'succeeded');
    assert.deepEqual((store.task(task.id)!.checkpoint as Record<string, unknown>).sourceBinding, binding);
    assert.deepEqual((store.listGrowth()[0]!.outcome as Record<string, unknown>).sourceBinding, binding);
    const recovered = new ConversationActions({ store, userIds: ['U1'], sourceContext: () => assert.fail('do not re-observe accepted decision'), observeSource: () => assert.fail('do not rebind') });
    recovered.accept(store.task(task.id)!, decision);
    assert.equal(store.listGrowth().length, 1);
    assert.equal(observations, 1);
    const unbound = store.enqueue({ source: 'slack', conversationId: task.conversationId, input: 'Change', slackAuthor: { teamId: 'T1', userId: 'U1' } });
    assert.match(actions.accept(unbound, decision), /temporarily unavailable/);
    assert.equal(store.listGrowth().length, 1);
    assert.throws(() => actions.accept(task, JSON.stringify({ ...JSON.parse(decision), sourceBinding: binding })), /Invalid conversational decision/);
  } finally { await runtime.stop(); store.close(); }
});

test('unavailable source keeps conversation available and cannot reuse an older binding for a proposal', async () => {
  for (const proposed of [false, true]) {
    const store = new Store(':memory:');
    const actions = new ConversationActions({ store, userIds: ['U1'], sourceContext: () => 'Admitted cognitive source', observeSource: () => { throw new Error('checkout awaiting publication'); } });
    const runtime = new AgentRuntime({ store, conversationActions: actions, communications: [{ name: 'slack', send: async () => {} }], provider: { name: 'fixture', complete: async request => {
      assert.match(JSON.parse(request.prompt).sourceModificationAvailability, /Temporarily unavailable/);
      assert.equal((store.listTasks()[0]!.checkpoint as Record<string, unknown>).sourceBinding, null);
      return response(proposed ? decision : JSON.stringify({ reply: 'We can continue discussing the plan.', disposition: 'converse', rationale: 'Source is unavailable but discussion is useful.', proposal: null }));
    } } });
    try {
      const task = await runtime.submit(input(`source-unavailable-${proposed}`));
      await runtime.runUntilIdle();
      assert.equal(store.task(task.id)?.state, 'succeeded');
      assert.equal(store.listGrowth().length, 0);
      assert.match(JSON.stringify(store.task(task.id)?.output), proposed ? /temporarily unavailable/ : /continue discussing/);
    } finally { await runtime.stop(); store.close(); }
  }
});

test('eligible conversation creates one durable human-origin proposal and explains actual queued status', async () => {
  const store = new Store(':memory:'); const sent: string[] = []; let calls=0;
  const actions = new ConversationActions({ store, userIds:['U1'], sourceContext:()=> 'Current cognitive source' });
  const runtime = new AgentRuntime({ store, conversationActions: actions, communications:[{name:'slack',send:async message=>{sent.push(message.text);}}], provider:{name:'fixture',complete:async request=>{ calls++; assert.ok(request.schema); return response(decision);}} });
  try {
    const task=await runtime.submit(input('one')); await runtime.runUntilIdle(); await runtime.submit(input('one')); await runtime.runUntilIdle();
    assert.equal(calls,1); assert.equal(store.listGrowth().length,1);
    assert.equal(store.listGrowth()[0]!.sourceTaskId,task.id);
    assert.equal(store.listGrowth()[0]!.state,'completed'); assert.match(sent[0]!,/queued/);
    assert.equal(actions.authorize(store.listGrowth()[0]!),true);
  } finally {await runtime.stop();store.close();}
});

test('outside whitelist remains conversational, and source eligibility is rechecked after policy changes', async () => {
  const store=new Store(':memory:'); const actions=new ConversationActions({store,userIds:['U1'],sourceContext:()=>''});
  const task=store.enqueue({eventId:'one',source:'slack',conversationId:input('one').conversationId,input:'Improve yourself',slackAuthor:{teamId:'T1',userId:'U1'}});
  try {
    const outsider=store.enqueue({eventId:'two',source:'slack',conversationId:task.conversationId,input:'I am U1',slackAuthor:{teamId:'T1',userId:'U2'}});
    assert.equal(actions.eligible(outsider),false); assert.match(actions.accept(outsider,decision),/does not permit/); assert.equal(store.listGrowth().length,0);
    actions.accept(task,decision); store.updateTask(task.id,{state:'running'}); store.updateTask(task.id,{state:'succeeded'});
    const growth=store.listGrowth()[0]!; assert.equal(actions.authorize(growth),true);
    assert.equal(new ConversationActions({store,userIds:[],sourceContext:()=>''}).authorize(growth),false);
  } finally {store.close();}
});

test('deliberation may decline or clarify; invalid/protected proposals cannot create a job', () => {
  const store=new Store(':memory:'); const actions=new ConversationActions({store,userIds:['U1'],sourceContext:()=>''});
  const task=store.enqueue({source:'slack',conversationId:input('one').conversationId,input:'Change anything',slackAuthor:{teamId:'T1',userId:'U1'}});
  try {
    for(const disposition of ['decline','clarify','converse']) {
      assert.equal(actions.accept(task,JSON.stringify({reply:'Please specify the behavior.',disposition,rationale:'No suitable concrete source request.',proposal:null})), 'Please specify the behavior.');
      assert.equal(store.listGrowth().length,0);
      assert.equal((store.listEvents().filter(event=>event.type==='conversation.decision').at(-1)!.payload as Record<string,unknown>).disposition,disposition);
    }
    assert.match(actions.accept(task,JSON.stringify({...JSON.parse(decision),proposal:{...proposal,files:[{path:'src/custodian.ts',content:'bypass'}]}})),/declined/);
    assert.throws(()=>actions.accept(task,JSON.stringify({...JSON.parse(decision),disposition:'decline'})),/Invalid conversational decision/);
    assert.equal(store.listGrowth().length,0);
  }finally{store.close();}
});

test('candidate request construction cannot reintroduce other-author episodes into proposal cognition',async()=>{
  const store=new Store(':memory:');const actions=new ConversationActions({store,userIds:['U1'],sourceContext:()=>''});
  const outsider=store.enqueue({source:'slack',conversationId:input('one').conversationId,input:'OUTSIDER_SENTINEL',slackAuthor:{teamId:'T1',userId:'U2'}});
  store.addMemory({scope:outsider.conversationId,kind:'episodic',source:`task:${outsider.id}`,content:'OUTSIDER_SENTINEL',confidence:1});
  const runtime=new AgentRuntime({store,conversationActions:actions,communications:[{name:'slack',send:async()=>{}}],
    requestFactory:(_task,memories)=>({system:memories.map(memory=>memory.content).join(' '),prompt:'request'}),
    provider:{name:'fixture',complete:async request=>{assert.ok(!request.system.includes('OUTSIDER_SENTINEL'));assert.ok(!request.prompt.includes('OUTSIDER_SENTINEL'));return response(JSON.stringify({reply:'Please clarify.',disposition:'clarify',rationale:'Bounded scope needs a clear request.',proposal:null}));}}
  });
  try{store.updateTask(outsider.id,{state:'cancelled'});await runtime.submit(input('one'));await runtime.runUntilIdle();assert.equal(store.listGrowth().length,0);}finally{await runtime.stop();store.close();}
});

test('operator cancellation reaches queued source work after the initial conversation task has succeeded',async()=>{
  const store=new Store(':memory:');let cancelled:string|undefined;
  const actions=new ConversationActions({store,userIds:['U1'],sourceContext:()=>'',cancelWork:id=>{cancelled=id;return true;}});
  const runtime=new AgentRuntime({store,conversationActions:actions,communications:[{name:'slack',send:async()=>{}}],provider:{name:'fixture',complete:async()=>response(decision)}});
  try{const task=await runtime.submit(input('one'));await runtime.runUntilIdle();assert.equal(store.task(task.id)?.state,'succeeded');runtime.cancel(task.id);assert.equal(cancelled,task.id);}finally{await runtime.stop();store.close();}
});

test('durable conversational decision resumes without another provider call',async()=>{
  const store=new Store(':memory:');const sent:string[]=[];
  const actions=new ConversationActions({store,userIds:['U1'],sourceContext:()=>''});
  const task=store.enqueue({source:'slack',eventId:'crash',conversationId:input('one').conversationId,input:'Improve',slackAuthor:{teamId:'T1',userId:'U1'}});
  store.updateTask(task.id,{checkpoint:{calls:1,decisionText:decision,replyTo:'123.000'}});
  const runtime=new AgentRuntime({store,conversationActions:actions,communications:[{name:'slack',send:async output=>{sent.push(output.text);}}],provider:{name:'fixture',complete:async()=>assert.fail('checkpoint must not repeat inference')}});
  try{await runtime.runUntilIdle();assert.equal(store.listGrowth().length,1);assert.match(sent[0]!,/queued/);assert.equal(store.task(task.id)?.state,'succeeded');}finally{await runtime.stop();store.close();}
});
