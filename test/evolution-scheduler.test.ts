import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { EvolutionScheduler } from '../src/evolution-scheduler.ts';
import { digestJson } from '../src/candidates.ts';
import type { EvolutionReport, EvolutionRequest } from '../src/evolution.ts';
import type { GrowthProposal } from '../src/growth.ts';
import { GrowthScheduler } from '../src/scheduler.ts';
import { Store } from '../src/store.ts';

const proposal: GrowthProposal = { summary: 'Synthetic improvement', rationale: 'Fixture hypothesis', acceptanceCriteria: ['Independent gates still required'], files: [{ path: 'src/agent/brain.ts', content: 'export const synthetic = true;' }] };
const reflection = { observation: 'Synthetic observation', lesson: 'Unverified fixture lesson', nextQuestion: 'What else?', proposedChange: proposal };
function report(request: EvolutionRequest, status: EvolutionReport['status'] = 'declined'): EvolutionReport {
  return { id: request.id, growthId: request.growthId, proposalDigest: digestJson(request.proposal), phase: 'finished', status, reason: 'Synthetic executor outcome', calls: 0, startedAt: new Date().toISOString() };
}
function recorded(store: Store, id: string) {
  const item = store.addGrowth({ id, question: 'Synthetic question', origin: 'fixture', dimension: 'code_quality' });
  return store.updateGrowth(item.id, { state: 'completed', outcome: JSON.parse(JSON.stringify({ result: reflection })) });
}
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'palimpsest-evolution-scheduler-')); const path = join(dir, 'state.sqlite'); const store = new Store(path);
  return { store, path, close() { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('proposal callback only enqueues; release runs outside it and can quiesce growth without deadlock', async (t) => {
  const f = fixture(); let executions = 0; let scheduler!: GrowthScheduler; let queue!: EvolutionScheduler;
  queue = new EvolutionScheduler({ store: f.store, hasUserWork: () => false, phase: () => 'normal', run: async request => {
    executions++; await scheduler.stop(); assert.equal(queue.reserveCall(`evolution:${request.id}:call:1`), true); return report(request);
  } });
  scheduler = new GrowthScheduler({ store: f.store, hasUserWork: () => false, provider: { name: 'fixture', complete: async () => ({ text: JSON.stringify(reflection), provider: 'fixture', model: 'fixture', usage: { inputTokens: 1, outputTokens: 1 } }) },
    onProposedChange: event => { queue.enqueue(event.growth.id, event.proposedChange); } });
  t.after(async () => { await queue.stop(); await scheduler.stop(); f.close(); });
  await scheduler.tick(); assert.equal(executions, 0); assert.equal(queue.items()[0]?.state, 'queued');
  await queue.tick(); assert.equal(executions, 1); assert.equal(queue.items()[0]?.state, 'finished');
  await queue.tick(); assert.equal(executions, 1);
});

test('claims and a separate immutable daily allocation survive restart without duplicate calls', async () => {
  const f = fixture(); let time = 0; let calls = 0; let queue!: EvolutionScheduler;
  const options = { store: f.store, callsPerDay: 2, hasUserWork: () => false, phase: () => 'normal' as const, now: () => time,
    run: async (request: EvolutionRequest) => {
      for (let ordinal = 1; ordinal <= 3; ordinal++) if (queue.reserveCall(`evolution:${request.id}:call:${ordinal}`)) calls++;
      assert.equal(queue.reserveCall(`evolution:${request.id}:call:1`), false); return report(request);
    } };
  try {
    recorded(f.store, 'one'); recorded(f.store, 'two'); queue = new EvolutionScheduler(options); queue.reconcile();
    await Promise.all([queue.tick(), queue.tick()]); assert.equal(calls, 2); assert.equal(queue.items().filter(item => item.state === 'finished').length, 1);
    await queue.stop(); queue = new EvolutionScheduler(options); await queue.tick(); assert.equal(calls, 2);
    const changed = new EvolutionScheduler({ ...options, callsPerDay: 3 }); await assert.rejects(changed.tick(), /immutable/); await changed.stop();
    time = 86_400_000; await queue.tick(); assert.equal(calls, 4); assert.equal(queue.items().every(item => item.state === 'finished'), true);
    await queue.stop(); f.store.close();
    const reopened = new Store(f.path); let replay = 0;
    const restored = new EvolutionScheduler({ ...options, store: reopened, run: async request => { replay++; return report(request); } });
    restored.reconcile(); await restored.tick(); assert.equal(replay, 0); await restored.stop(); reopened.close();
  } finally { await queue!.stop(); f.close(); }
});

test('zero release allowance preserves exact proposals and a reserved dispatch is reconciled once', async () => {
  const f = fixture(); recorded(f.store, 'original'); f.store.reserveGrowthProposal('original');
  const queue = new EvolutionScheduler({ store: f.store, callsPerDay: 0, hasUserWork: () => false, phase: () => 'normal', run: async () => { assert.fail('disabled release must not run'); } });
  try {
    assert.throws(() => queue.enqueue('original', { ...proposal, summary: 'forged source' }), /exact recorded/);
    queue.reconcile(); queue.reconcile(); await queue.tick(); assert.equal(queue.items().length, 1); assert.equal(queue.items()[0]?.state, 'queued');
    assert.equal(f.store.growthProposalDelivery('original')?.state, 'delivered');
    assert.deepEqual((f.store.growth('original')!.outcome as { result: unknown }).result, reflection);
  } finally { await queue.stop(); f.close(); }
});

test('user work aborts before transfer, but a fenced transfer completes mechanically', async () => {
  for (const fenced of [false, true]) {
    const f = fixture(); recorded(f.store, 'priority'); let userWork = false; let phase: 'normal' | 'transfer' = 'normal'; let finish!: () => void; let sawAbort = false;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const queue = new EvolutionScheduler({ store: f.store, hasUserWork: () => userWork, phase: () => phase,
      run: async request => { request.signal!.addEventListener('abort', () => { sawAbort = true; finish(); }, { once: true }); await pending; return report(request, sawAbort ? 'declined' : 'promoted'); } });
    try {
      queue.reconcile(); const running = queue.tick(); await Promise.resolve(); await Promise.resolve();
      if (fenced) phase = 'transfer'; userWork = true; queue.interrupt();
      assert.equal(sawAbort, !fenced); finish(); await running;
      assert.equal(queue.items()[0]?.result?.status, fenced ? 'promoted' : 'declined');
    } finally { finish(); await queue.stop(); f.close(); }
  }
});

test('pending host maintenance settles before execution and user arrival prevents a queued claim', async () => {
  const f = fixture(); recorded(f.store, 'held'); let finish!: () => void; let userWork = false; let executed = false;
  const maintenance = new Promise<void>(resolve => { finish = resolve; });
  const queue = new EvolutionScheduler({ store: f.store, hasUserWork: () => userWork, phase: () => 'normal', beforeRun: () => maintenance,
    run: async request => { executed = true; return report(request); } });
  try {
    queue.reconcile(); const pending = queue.tick(); await Promise.resolve(); assert.equal(queue.busy, true); assert.equal(executed, false);
    userWork = true; finish(); await pending; assert.equal(executed, false); assert.equal(queue.items()[0]?.state, 'queued');
    userWork = false; await queue.tick(); assert.equal(executed, true);
  } finally { finish(); await queue.stop(); f.close(); }
});

test('interrupted claims without a report are not replayed; persisted probation can be observed without budget', async () => {
  const f = fixture(); recorded(f.store, 'crashed'); recorded(f.store, 'probation'); let runs = 0;
  const setup = new EvolutionScheduler({ store: f.store, hasUserWork: () => false, phase: () => 'normal', run: async request => report(request) });
  setup.reconcile(); const [crashed, probation] = setup.items();
  f.store.appendEvent('evolution.queue.claimed', { id: crashed!.id });
  f.store.appendEvent('evolution.queue.claimed', { id: probation!.id });
  f.store.appendEvent('evolution.checkpoint', JSON.parse(JSON.stringify({ runId: probation!.id, report: { ...report({ id: probation!.id, growthId: probation!.growthId, proposal }, 'probation'), proposalDigest: probation!.proposalDigest } })));
  await setup.stop();
  const queue = new EvolutionScheduler({ store: f.store, callsPerDay: 0, hasUserWork: () => true, phase: () => 'probation', run: async request => { runs++; assert.equal(queue.reserveCall(`evolution:${request.id}:call:1`), false); return report(request, 'promoted'); } });
  try {
    await queue.tick(); assert.equal(queue.items()[0]?.result?.status, 'interrupted');
    await queue.tick(); assert.equal(runs, 1); assert.equal(queue.items()[1]?.result?.status, 'promoted');
  } finally { await queue.stop(); f.close(); }
});

test('human release has separate allocation, keeps running during conversation and obeys cancellation/current policy',async()=>{
  const f=fixture();let allowed=true;let userWork=false;let finish!:()=>void;let queue!:EvolutionScheduler;
  const task=f.store.enqueue({source:'slack',conversationId:'slack:T1:C1:123.000',input:'Improve',slackAuthor:{teamId:'T1',userId:'U1'}});
  f.store.recordConversationProposal(task.id,JSON.parse(JSON.stringify({result:reflection})));
  let aborted=false;
  queue=new EvolutionScheduler({store:f.store,callsPerDay:0,interactiveCallsPerDay:2,authorizeProposal:()=>allowed,hasUserWork:()=>userWork,phase:()=> 'normal',run:async request=>{
    assert.equal(queue.reserveCall(`evolution:${request.id}:call:1`),true);
    await new Promise<void>(resolve=>{finish=resolve;request.signal!.addEventListener('abort',()=>{aborted=true;resolve();},{once:true});});
    return report(request,aborted?'declined':'promoted');
  }});
  try{
    queue.reconcile();const running=queue.tick();while(!finish)await Promise.resolve();
    userWork=true;queue.interrupt(true);assert.equal(aborted,false);
    assert.equal(queue.cancelTask(task.id),true);await running;assert.equal(aborted,true);assert.equal(queue.items()[0]?.result?.status,'declined');
    const next=f.store.enqueue({source:'slack',conversationId:'slack:T1:C1:123.000',input:'Improve again',slackAuthor:{teamId:'T1',userId:'U1'}});
    f.store.recordConversationProposal(next.id,JSON.parse(JSON.stringify({result:reflection})));queue.reconcile();allowed=false;userWork=false;
    await queue.tick();assert.equal(queue.items()[1]?.result?.status,'declined');
    assert.equal(f.store.listEvents().filter(e=>e.type==='evolution.scheduler.call_reserved').length,1);
  }finally{finish?.();await queue.stop();f.close();}
});

test('a partially funded release waits without spending or abandoning the proposal, then runs in a later window',async()=>{
  const f=fixture();let time=0;let queue!:EvolutionScheduler;let runs=0;
  try{
    recorded(f.store,'first');recorded(f.store,'second');
    queue=new EvolutionScheduler({store:f.store,callsPerDay:8,minimumCallsPerAttempt:8,now:()=>time,hasUserWork:()=>false,phase:()=> 'normal',run:async request=>{
      runs++;for(let i=1;i<=5;i++)assert.equal(queue.reserveCall(`evolution:${request.id}:call:${i}`),true);return report(request);
    }});
    queue.reconcile();await queue.tick();await queue.tick();assert.equal(runs,1);assert.equal(queue.items()[1]?.state,'queued');
    assert.equal(f.store.listEvents().filter(e=>e.type==='evolution.scheduler.call_reserved').length,5);
    time=86400000;await queue.tick();assert.equal(runs,2);assert.equal(queue.items()[1]?.state,'finished');
  }finally{await queue.stop();f.close();}
});

test('plan releases use a distinct immutable window and do not consume standing-growth allocation', async()=>{
  const f=fixture();let queue!:EvolutionScheduler;const lanes:string[]=[];
  try {
    recorded(f.store,'standing');
    const item=f.store.addGrowth({id:'plan:fixture',dimension:'code_quality',question:'Selected plan work',origin:'development-plan:fixture',budget:0});
    f.store.updateGrowth(item.id,{state:'completed',outcome:JSON.parse(JSON.stringify({result:reflection,development:{attemptId:'host-attempt'}}))});
    const options={store:f.store,callsPerDay:8,planCallsPerDay:8,minimumCallsPerAttempt:8,hasUserWork:()=>false,phase:()=> 'normal' as const,
      run:async(request:EvolutionRequest)=>{lanes.push(request.growthId);for(let ordinal=1;ordinal<=8;ordinal++)assert.equal(queue.reserveCall(`evolution:${request.id}:call:${ordinal}`),true);return {...report(request),calls:8};}};
    queue=new EvolutionScheduler(options);queue.reconcile();await queue.tick();await queue.tick();
    assert.deepEqual(lanes,['plan:fixture','standing']);
    const debits=f.store.listEvents().filter(e=>e.type==='evolution.scheduler.call_reserved');
    assert.equal(debits.filter(e=>(e.payload as Record<string,unknown>).plan===true).length,8);
    assert.equal(debits.filter(e=>(e.payload as Record<string,unknown>).plan!==true).length,8);
    await queue.stop();recorded(f.store,'later-standing');
    const changed=new EvolutionScheduler({...options,planCallsPerDay:16});
    const plan2=f.store.addGrowth({id:'plan:next',dimension:'code_quality',question:'New selected work',origin:'development-plan:fixture',budget:0});
    f.store.updateGrowth(plan2.id,{state:'completed',outcome:JSON.parse(JSON.stringify({result:reflection,development:{attemptId:'new-host-attempt'}}))});
    changed.reconcile();await assert.rejects(changed.tick(),/immutable/);await changed.stop();
  }finally{await queue?.stop();f.close();}
});

test('an unfunded plan proposal does not starve a separately funded standing release',async()=>{
  const f=fixture();let queue!:EvolutionScheduler;const ran:string[]=[];
  try{
    const plan=f.store.addGrowth({id:'plan:held',dimension:'code_quality',question:'Unfunded selected work',origin:'development-plan:fixture',budget:0});
    f.store.updateGrowth(plan.id,{state:'completed',outcome:JSON.parse(JSON.stringify({result:reflection,development:{attemptId:'host-held'}}))});
    recorded(f.store,'funded-standing');
    queue=new EvolutionScheduler({store:f.store,callsPerDay:8,planCallsPerDay:0,minimumCallsPerAttempt:8,hasUserWork:()=>false,phase:()=> 'normal',run:async request=>{ran.push(request.growthId);return report(request);}});
    queue.reconcile();await queue.tick();assert.deepEqual(ran,['funded-standing']);
    assert.equal(queue.items().find(item=>item.growthId===plan.id)?.state,'queued');
  }finally{await queue?.stop();f.close();}
});
