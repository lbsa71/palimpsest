import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OperationalStore } from '../../storage/index.ts';
import { EffectJournal } from '../index.ts';
import { assertAuthority } from '../../contracts/common.ts';
import type { Authority } from '../../contracts/common.ts';
import type { Effect } from '../../contracts/execution/index.ts';
const grant:Authority={generation:'g1',epoch:1,controlRevision:'c1'};
function effect():Effect{return {id:'e',runId:'r',stepId:'s',kind:'speech',payload:'hello',scope:{kind:'public'},authority:grant,status:'pending',revision:0};}
test('stale receiver grant cannot dispatch; payload identity conflicts rejected',async()=>{
 const store=new OperationalStore({filename:join(mkdtempSync(join(tmpdir(),'aeon-effects-')),'state.sqlite')});let current=grant,calls=0;
 const journal=new EffectJournal(store,{assert(a){assertAuthority(a,current);}},{async dispatch(){calls++;return {outcome:'succeeded'};},async reconcile(){return {outcome:'unresolved',receipt:store.putArtifact('unresolved')};}});
 journal.ensure(effect());assert.throws(()=>journal.ensure({...effect(),payload:'different'}));journal.authorize('e','reservation',grant);current={...grant,epoch:2};await assert.rejects(journal.dispatch('e',grant));assert.equal(calls,0);assert.equal(journal.get('e')?.status,'authorized');store.close();
});
test('late receipt after recovery/withdrawal settles old generation without allowing replay',async()=>{
 const store=new OperationalStore({filename:join(mkdtempSync(join(tmpdir(),'aeon-effects-')),'state.sqlite')});let current=grant,resolve!:()=>void;const waiting=new Promise<void>(r=>resolve=r);let entered!:()=>void;const active=new Promise<void>(r=>entered=r);let calls=0;
 const journal=new EffectJournal(store,{assert(a){assertAuthority(a,current);}},{async dispatch(){calls++;entered();await waiting;return {outcome:'succeeded',receipt:store.putArtifact({sent:true})};},async reconcile(){return {outcome:'unresolved',receipt:store.putArtifact('unresolved')};}});
 journal.ensure(effect());journal.authorize('e','reservation',grant);const pending=journal.dispatch('e',grant);await active;journal.recoverDispatched();current={...grant,epoch:2,generation:'g2'};resolve();assert.equal((await pending).status,'succeeded');assert.equal(journal.get('e')?.authority.epoch,1);await assert.rejects(journal.dispatch('e',current));assert.equal(calls,1);store.close();
});

test('reconciliation admission rejects stale grants while current generation can settle old effects', async () => {
 const store=new OperationalStore({filename:join(mkdtempSync(join(tmpdir(),'aeon-effects-')),'state.sqlite')});let current=grant,lookups=0;
 const journal=new EffectJournal(store,{assert(a){assertAuthority(a,current);}},{async dispatch(){return {outcome:'uncertain'};},async reconcile(){lookups++;return {outcome:'succeeded',receipt:store.putJsonArtifact({found:true})};}});
 try {
   journal.ensure(effect());journal.authorize('e','reservation',grant);await journal.dispatch('e',grant);current={...grant,epoch:2,generation:'g2'};
   await assert.rejects(journal.reconcile('e',grant), /authority/);
   assert.throws(()=>journal.recordReconciliation('e',grant,'succeeded',store.putJsonArtifact({fabricated:true})), /authority/);
   assert.equal(lookups,0);assert.equal(journal.get('e')?.status,'uncertain');
   assert.equal((await journal.reconcile('e',current)).status,'succeeded');assert.equal(lookups,1);
 } finally {store.close();}
});
