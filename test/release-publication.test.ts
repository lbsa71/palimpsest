import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Store} from '../src/store.ts';
import {ReleasePublication} from '../src/release-publication.ts';
import type {EvolutionQueueItem} from '../src/evolution-scheduler.ts';
import type {CandidateManifest} from '../src/candidates.ts';
import type {PublicationControl} from '../src/git-publication.ts';
// Synthetic journal fixtures test this wrapper's control contract only. Actual
// admission, verification and Git effects are exercised by integration probes.
const setup=(store:Store,id:string)=>{
  const growth=store.addGrowth({id,origin:'standing growth mission v1',dimension:'code_quality',question:'A real observed limitation'});
  store.updateGrowth(growth.id,{state:'completed'});
  store.appendEvent('evolution.finished',{runId:id,report:{id,growthId:id,status:'promoted',candidate:{id:`candidate-${id}`}}});
  return {id,growthId:id,proposalDigest:'fixture',state:'finished',result:{status:'promoted',reason:'Observed',calls:5}} as EvolutionQueueItem;
};
test('autonomous publication reconciles independently of human notification and blocks the next release until confirmed',async()=>{
  const store=new Store(':memory:');const item=setup(store,'autonomous');let calls=0;let time=0;let confirmed=false;
  const options={store,authorize:()=>true,now:()=>time,publisher:{publish:async()=>{calls++;return {status:confirmed?'published' as const:'uncertain' as const,reason:'Observed exact remote effect'};}}};
  try{
    const first=new ReleasePublication(options);assert.equal(first.pending([item]),true);await first.reconcile([item]);assert.equal(calls,1);assert.equal(first.pending([item]),true);
    store.enqueuePreparedReply({source:'direct',conversationId:'local',eventId:`${item.id}:release-result`,input:'Already notified'},'Outcome was uncertain');
    const restarted=new ReleasePublication(options);await restarted.reconcile([item]);assert.equal(calls,1,'persistent backoff survives restart');
    confirmed=true;time=30000;await restarted.reconcile([item]);assert.equal(calls,2);assert.equal(restarted.pending([item]),false);
    time=60000;await restarted.reconcile([item]);assert.equal(calls,2,'observed publication is not repeated');
  }finally{store.close();}
});
test('publication policy and exact recorded promoted identity are enforced outside model output',async()=>{
  const store=new Store(':memory:');const item=setup(store,'denied');let calls=0;
  const reconciler=new ReleasePublication({store,authorize:()=>false,publisher:{publish:async()=>{calls++;return{status:'published',reason:'must not run'};}}});
  try{await reconciler.reconcile([item]);assert.equal(calls,0);assert.equal(reconciler.result(item.id)?.status,'declined');assert.equal(reconciler.pending([item]),true);}finally{store.close();}
});

test('slow publication observation starts its persistent backoff at completion', async () => {
  const store = new Store(':memory:'); const item = setup(store, 'slow'); let time = 0; let calls = 0;
  const options = { store, authorize: () => true, now: () => time, publisher: { publish: async () => {
    calls++; time += 45000; return { status: 'uncertain' as const, reason: 'Observation unavailable' };
  } } };
  try {
    await new ReleasePublication(options).reconcile([item]);
    const payload = store.listEvents().find(event => event.type === 'release.publication.result')!.payload as Record<string, unknown>;
    assert.equal(payload.observedAt, 45000);
    assert.equal(payload.nextObservationAt, 75000);
    time = 74999;
    const restarted = new ReleasePublication(options);
    await restarted.reconcile([item]); assert.equal(calls, 1);
    time = 75000;
    await restarted.reconcile([item]); assert.equal(calls, 2);
  } finally { store.close(); }
});

test('caller mutation cannot switch publication origin after the receiver accepts a queue item', async () => {
  const store = new Store(':memory:'); const item = setup(store, 'origin-a'); setup(store, 'origin-b');
  const originalId = item.id; let allowed = true;
  let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
  let resume!: () => void; const waiting = new Promise<void>(resolve => { resume = resolve; });
  const publication = new ReleasePublication({ store, authorize: growth => growth.id === 'origin-b' || allowed,
    publisher: { publish: async (_candidate: CandidateManifest, control?: PublicationControl) => {
      entered(); await waiting;
      assert.equal(control?.authorize?.(), false, 'The accepted origin stays withdrawn despite a permitted replacement');
      return { status: 'declined', reason: 'Current accepted origin is withdrawn' };
    } } });
  try {
    const running = publication.reconcile([item]); await started;
    allowed = false; item.growthId = 'origin-b'; item.id = 'unaccepted-run'; resume(); await running;
    assert.equal(publication.result(originalId)?.status, 'declined');
    assert.equal(publication.result(item.id), undefined);
  } finally { resume(); store.close(); }
});

test('recorded preparation or push stays unresolved after policy withdrawal and publication disablement', async () => {
  for (const phase of ['reserved', 'prepared', 'push_reserved']) {
    const store = new Store(':memory:'); const item = setup(store, `intent-${phase}`); let calls = 0;
    store.appendEvent(`git.publication.${phase}`, { candidateId: `candidate-${item.id}`, target: 'synthetic-target' });
    try {
      const publication = new ReleasePublication({ store, authorize: () => false,
        publisher: { publish: async (_candidate: CandidateManifest, control?: PublicationControl) => {
          calls++; assert.equal(control?.authorize?.(), false, 'Observation carries no new write authority');
          return { status: 'uncertain', reason: 'Recorded phase requires observation' };
        } } });
      await publication.reconcile([item]); assert.equal(calls, 1); assert.equal(publication.result(item.id)?.status, 'uncertain');
      const disabled = new ReleasePublication({ store, authorize: () => false, now: () => Date.now() + 60_000 });
      await disabled.reconcile([item]); assert.equal(disabled.result(item.id)?.status, 'uncertain'); assert.equal(calls, 1);
    } finally { store.close(); }
  }
});
