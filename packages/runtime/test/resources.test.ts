import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { identity } from '../../contracts/common.ts';
import type { PhysicalRequest } from '../../contracts/control/index.ts';
import { OperationalStore } from '../../storage/index.ts';
import { ResourceLedger, BudgetExceeded } from '../resources/index.ts';
import { envelope } from './fixtures.ts';
function request(id:string,runId='parent',purpose:PhysicalRequest['purpose']='reasoning'):PhysicalRequest {return {id,runId,purpose,provider:'fixture',model:'fixture',promptManifestId:'p',requestDigest:identity(id),reservationId:id,status:'reserved',usage:{requests:1,inputTokens:null,outputTokens:null,costUsd:null,elapsedMs:0}};}
test('retries, compaction, reviewers and children share ceiling; unknown usage survives reopen',()=>{
 const filename=join(mkdtempSync(join(tmpdir(),'aeon-budget-')),'state.sqlite');let store=new OperationalStore({filename}),ledger=new ResourceLedger(store,{tokens:100,costUsd:1,elapsedMs:10},()=>100);
 ledger.allocate('parent',{...envelope,maxRequests:3,maxTokens:250,maxCostUsd:2,maxElapsedMs:1000});ledger.allocate('child',envelope,'parent');
 const r1=request('r1');ledger.reserve(r1);ledger.dispatched({...r1,status:'dispatched'});ledger.settle({...r1,status:'succeeded'});
 const r2=request('r2','child','compaction');ledger.reserve(r2);ledger.dispatched({...r2,status:'dispatched'});store.close();
 store=new OperationalStore({filename});ledger=new ResourceLedger(store,{tokens:100,costUsd:1,elapsedMs:10},()=>100);ledger.recoverDispatched();assert.equal(ledger.request('r2')?.status,'uncertain');assert.equal(ledger.snapshot('child').tokens,200);assert.equal(ledger.snapshot('parent').costUsd,2);
 assert.throws(()=>ledger.reserve(request('review','child','review')),BudgetExceeded);assert.throws(()=>ledger.reserve(request('retry','parent')),BudgetExceeded);store.close();
});
test('cancelled child does not cancel parent; cancelled parent bars every descendant',()=>{
 const store=new OperationalStore({filename:join(mkdtempSync(join(tmpdir(),'aeon-budget-')),'state.sqlite')}),ledger=new ResourceLedger(store,{tokens:10,costUsd:0.01,elapsedMs:1});ledger.allocate('parent',envelope);ledger.allocate('child',envelope,'parent');ledger.allocate('grandchild',envelope,'child');ledger.cancel('child');
 assert.throws(()=>ledger.reserve(request('c','child')),BudgetExceeded);assert.throws(()=>ledger.reserve(request('g','grandchild')),BudgetExceeded);ledger.reserve(request('p'));ledger.allocate('sibling',envelope,'parent');ledger.cancel('parent');assert.throws(()=>ledger.reserve(request('s','sibling')),BudgetExceeded);store.close();
});
test('request immutable identity and deadline enforced before dispatch; over-ceiling usage freezes budget',()=>{
 let now=0;const store=new OperationalStore({filename:join(mkdtempSync(join(tmpdir(),'aeon-budget-')),'state.sqlite')}),ledger=new ResourceLedger(store,{tokens:10,costUsd:0.01,elapsedMs:1},()=>now);ledger.allocate('parent',{...envelope,maxElapsedMs:10});const r=request('r');ledger.reserve(r);
 assert.throws(()=>ledger.dispatched({...r,model:'changed',status:'dispatched'}));now=11;assert.throws(()=>ledger.dispatched({...r,status:'dispatched'}),BudgetExceeded);now=0;assert.throws(()=>ledger.dispatched({...r,status:'dispatched'}),BudgetExceeded);
 now=11;ledger.allocate('fresh',{...envelope,maxElapsedMs:10});const fresh=request('fresh-request','fresh');ledger.reserve(fresh);ledger.dispatched({...fresh,status:'dispatched'});ledger.settle({...fresh,status:'succeeded',usage:{requests:1,inputTokens:30,outputTokens:1,costUsd:0.2,elapsedMs:1}});assert.equal(ledger.snapshot('fresh').tokens,31);assert.equal(ledger.snapshot('fresh').cancelled,true);store.close();
});
test('narrow child grant cannot borrow unallocated requests from a roomy parent',()=>{
 const store=new OperationalStore({filename:join(mkdtempSync(join(tmpdir(),'aeon-budget-')),'state.sqlite')}),ledger=new ResourceLedger(store,{tokens:10,costUsd:0.01,elapsedMs:1});ledger.allocate('parent',envelope);ledger.allocate('child',{...envelope,maxRequests:1},'parent');ledger.allocate('grandchild',envelope,'child');const first=request('first','grandchild');ledger.reserve(first);ledger.dispatched({...first,status:'dispatched'});ledger.settle({...first,status:'succeeded'});assert.throws(()=>ledger.reserve(request('second','child')),BudgetExceeded);ledger.reserve(request('parent-next'));store.close();
});
