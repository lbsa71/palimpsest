import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Store} from '../src/store.ts';
import {ReleasePublication} from '../src/release-publication.ts';
import type {EvolutionQueueItem} from '../src/evolution-scheduler.ts';
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
