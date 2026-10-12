import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, {type TestContext} from 'node:test';
import {performance} from 'node:perf_hooks';
import { canonicalJson, identity, type ArtifactRef } from '../../packages/contracts/index.ts';
import { OperationalStore } from '../../packages/storage/index.ts';
import { ResourceLedger, DurableRuntime } from '../../packages/runtime/index.ts';
import { DevelopmentAccounting } from '../../deployment/development-accounting.ts';
import { CommunicationsCore } from '../../packages/communications/core/index.ts';
import { EffectJournal } from '../../packages/effects/index.ts';
import { QualificationStore } from '../qualification/store.ts';
import { signDocument } from '../qualification/manifest.ts';
import { syntheticWitnessFixture } from './witness-fixture.ts';
import { domains, developmentCapacityProfile, developmentCapacityLimits, type DevelopmentAttempt } from './witness.ts';
import { reviewEnvelopeDomains, type DevelopmentRegistration, type DevelopmentRoleBinding } from './review-envelope.ts';
import { acquisitionPlanDomain, acquisitionCapacity, acquisitionMetadataUsage, mandatoryAcquisitionCaptureBytes, mandatoryAcquisitionSlots, verifyAcquisitionPlan, type AcquisitionPlanTrust, type DevelopmentAcquisitionPlan } from './acquisition-plan.ts';
import { DevelopmentAcquisitionRecorder, type AcquisitionRecorderOptions } from './acquire.ts';

import { pagedRecorderFixture } from './acquisition-pages.test-fixture.ts';
const fixture=(t:TestContext)=>pagedRecorderFixture(t,true);

test('historical126/156 arithmetic remains unchanged but absent reviewer admission refuses before claim',t=>{
  const f=pagedRecorderFixture(t),c=acquisitionCapacity(f.plan);assert.equal(c.records,17066);assert.equal(c.totalBytes,957022208);assert.equal(c.draftBytes,9437184);assert.equal(c.responseBytes,2097152);assert.equal(c.metadataBytes,91193344);const before=f.raw.usage();assert.throws(()=>f.claim(),/Reviewer preclaim admission/);assert.deepEqual(f.raw.usage(),before);assert.equal(f.state.get('development.acquisition',f.plan.id),undefined);
});

test('new signed126-delivery reviewer allocation proves every copied pool before one-use claim',t=>{
  const f=fixture(t),v=verifyAcquisitionPlan(f.sign(),f.trust,(a,n)=>f.raw.readArtifact(a,n),Date.parse(f.m.registeredAt)),c=v.capacity,p=f.plan;
  assert.equal(p.protocol!.schedule.length,126);assert.equal(c.mandatorySnapshots,156);assert.equal(c.mandatoryObservations,424);assert.equal(mandatoryAcquisitionCaptureBytes(p,c),854228992);assert.ok(mandatoryAcquisitionSlots(p,c)>13415);assert.ok(c.totalBytes>957022208);assert.ok(c.totalBytes<=1073741824);assert.equal(c.reviewReservations!.length,2);
  const actual=acquisitionMetadataUsage(p,c,mandatoryAcquisitionSlots(p,c),[]);assert.ok(actual.behaviorBytes<=p.captureLayout!.metadata.behaviorBytes);assert.ok(actual.finalBytes<=p.captureLayout!.metadata.finalBytes);assert.ok(actual.ownerBytes<=p.captureLayout!.metadata.ownerWithoutBehaviorBytes);assert.ok(actual.totalBytes<=c.metadataBytes);
  assert.equal(f.state.get('development.acquisition',p.id),undefined);assert.equal(f.original.snapshot(f.registration.rootId).requests,0);assert.equal(f.claim().status().phase,'claimed');
  t.diagnostic(canonicalJson({capacity:{...c,reviewSources:c.reviewSources!.map(({contentBase64,...i})=>i)},mandatorySlots:mandatoryAcquisitionSlots(p,c),signedPlanBytes:Buffer.byteLength(canonicalJson(f.sign())),mandatoryMetadata:actual,fullIndexMetadata:acquisitionMetadataUsage(p,c,p.capacity.maxArtifacts,[])}));
});

test('new signed byte, record, singleton, copy and source inventory overruns refuse before raw/owner claim',t=>{
  const f=fixture(t),p=f.plan,before=f.raw.usage(),original=canonicalJson(f.original.snapshot(f.registration.rootId));
  const cases=[()=>{p.capacity.captureBytes--;},()=>{p.capacity.maxArtifacts=13414;},()=>{p.captureLayout!.sourcePool.maxArtifacts=1;},()=>{p.captureLayout!.metadata.behaviorBytes=1000;},()=>{p.captureLayout!.metadata.finalBytes=1000;},()=>{p.captureLayout!.page.maxOperationalArtifactBytes=1000001;}];
  for(const change of cases){const old=structuredClone(p);change();f.accept();assert.throws(()=>f.claim());assert.deepEqual(f.raw.usage(),before);assert.equal(f.state.get('development.acquisition',p.id),undefined);assert.equal(canonicalJson(f.original.snapshot(f.registration.rootId)),original);Object.assign(p,old);}
});

test('new unclaimed driver allocation fits the exact accepted bounded review templates without consuming claims',t=>{
  const f=fixture(t);for(const role of f.plan.roles)Object.assign(role,{maxPayloadBytes:65536,maxPromptBytes:65536,maxFragmentBytes:65536,maxResponseBytes:4096});for(const session of f.sessions)Object.assign(session.plan,{maxPayloadBytes:65536,maxResponseBytes:4096});f.reviewAdmission.acceptedSessions=new Map(f.sessions.map(s=>[s.roleId,identity(s)]));f.accept();
  const before=f.raw.usage(),c=verifyAcquisitionPlan(f.sign(),f.trust,(a,n)=>f.raw.readArtifact(a,n),Date.parse(f.m.registeredAt)).capacity;
  assert.equal(c.totalBytes,1048248320);assert.equal(mandatoryAcquisitionSlots(f.plan,c),13529);assert.equal(c.sourceArtifacts,15);assert.ok(c.sourceBytes<=1048576);assert.ok(c.reviewReservations!.every(r=>r.draftBytes===694661&&r.draftSlots===57&&r.continuationPayloadBytes===55857&&r.responseBytes===16384));assert.deepEqual(f.raw.usage(),before);assert.equal(f.state.get('development.acquisition',f.plan.id),undefined);assert.equal(f.original.snapshot(f.registration.rootId).requests,0);
  t.diagnostic(canonicalJson({totalBytes:c.totalBytes,sourceBytes:c.sourceBytes,mandatorySlots:mandatoryAcquisitionSlots(f.plan,c),reviewReservations:c.reviewReservations,fullIndexMetadata:acquisitionMetadataUsage(f.plan,c,f.plan.capacity.maxArtifacts,[])}));
});

test('page reader reassembles complete bounded source and original mapping, including repeated global pairs',t=>{
  const f=fixture(t),candidate=f.stores.get('candidate')!,original=candidate.putArtifact('public operational original');candidate.put('ordinary','reference',{original},null);const r=f.claim(),sources=f.initial(r),first=r.status().snapshots.find(c=>c.roleId==='candidate')!.artifact,reader=r.openAcquiredCapture(first),pages=[...reader.pages()];
  assert.equal(pages.reduce((n,p)=>n+p.rows.length,0),reader.manifest.cut.physicalRows);assert.ok(pages.some(p=>p.table==='documents'&&p.rows.some(row=>row.namespace==='ordinary')));assert.equal(reader.resolve(original,100).toString(),'public operational original');assert.throws(()=>reader.resolve(original,1));assert.throws(()=>reader.resolve({uri:original.uri,sha256:'0'.repeat(64)},100));
  const before=r.status().originals!.length;r.captureApplication('candidate',sources.get('candidate')!.application,sources.get('candidate')!.accounting);assert.equal(r.status().originals!.length,before);assert.equal(r.status().originals!.find(x=>identity(x.original)===identity(original))!.bytes,27);
});

test('version2 admission requires all actual initial role captures even for synthetic work',t=>{
  const f=fixture(t),r=f.claim();assert.throws(()=>r.begin(),/Complete initial/);assert.throws(()=>r.rawStoreForRole('candidate').putBytes(Buffer.from('draft')),/Complete initial/);assert.equal(f.original.snapshot(f.registration.rootId).requests,0);f.initial(r);f.setTime(0);r.begin();assert.equal(r.status().phase,'acquiring');
});

test('historical guard permits ordinary accounting suffix and actual outer role transaction, refuses callback writes and promises',t=>{
  const f=fixture(t),r=f.claim();f.initial(r);const store=f.stores.get('candidate')!,count=r.status().snapshots.length;store.put('ordinary','suffix','legitimate after capture',null);r.assertCurrentUse();
  store.transaction(()=>{r.assertCurrentUse();assert.throws(()=>r.withCurrentUse(()=>store.put('ordinary','illegal','bad',null)),/document-history|development/);});assert.equal(store.get('ordinary','illegal'),undefined);assert.equal(r.status().snapshots.length,count);
});

test('control withdrawal during caller rollback stops cached reader without retaining uncommitted source provenance',t=>{
  const f=fixture(t),control=f.stores.get('no-memory')!;control.put('memory','private','public synthetic withdrawal target',null);const r=f.claim();f.initial(r);const reader=r.openAcquiredCapture(r.status().snapshots[0]!.artifact),before=r.status().inventory.length;
  assert.throws(()=>control.transaction(()=>{control.withdrawDocumentJournalContent({id:'uncommitted-withdraw',reason:'forget',targets:[{namespace:'memory',key:'private',expectedRevision:1}]});reader.assertUsable();}),/document-history-withdrawn/);
  assert.equal(control.get('memory','private')!.value,'public synthetic withdrawal target');assert.equal(r.status().inventory.length,before);assert.equal(r.status().useDisposition!.value.source,null);assert.equal(r.status().useDisposition!.value.reasonCode,'source-use-denied');assert.throws(()=>reader.manifest,/withdrawn/);assert.throws(()=>reader.pages().next(),/withdrawn/);
});

test('semantic readers release exact captured events, current documents and versions under bounded per-page fences',t=>{
  const f=fixture(t),store=f.stores.get('candidate')!;store.put('ordinary','entry',{public:'original'},null);const r=f.claim();f.initial(r);const reader=r.openAcquiredCapture(r.status().snapshots[0]!.artifact),events:any[]=[],docs:any[]=[];reader.forEachEvent(e=>events.push({sequence:e.sequence,type:e.type}));reader.forEachCurrentDocument(d=>docs.push(d));
  assert.equal(events.length,reader.manifest.cut.events);assert.ok(docs.every(d=>!d.namespace.startsWith('system.document-journal')));assert.equal(canonicalJson(docs.find(d=>d.namespace==='ordinary').value),canonicalJson({public:'original'}));
  const capture=[...reader.pages()].flatMap(p=>p.table==='documents'?p.rows:[]).find(d=>d.namespace==='system.document-journal.payloads'&&(d.value as any).ref.namespace==='ordinary')!,version=(capture.value as any).ref.versionId;
  const resolved=reader.resolveJournalVersion(version);assert.equal(canonicalJson(resolved.document.value),canonicalJson({public:'original'}));assert.equal(identity(resolved.document),resolved.ref.sha256);assert.throws(()=>reader.resolveJournalVersion('not-captured'));
  const first=reader.resolveEvent(1);assert.equal(first.sequence,1);assert.throws(()=>reader.resolveEvent(reader.manifest.cut.lastSequence+1));(first as any).type='changed';assert.equal(reader.resolveEvent(1).type,'document-journal-anchor');
  assert.throws(()=>reader.forEachEvent((()=>Promise.resolve())as any),/synchronous/);assert.throws(()=>reader.forEachCurrentDocument(()=>store.put('ordinary','illegal','write',null)),/development/);assert.equal(store.get('ordinary','illegal'),undefined);reader.assertUsableNow();
});

test('mandatory named proof bytes and logical slots survive optional pressure without replacing original bytes',t=>{
  const f=fixture(t),r=f.claim();f.initial(r);const objects=[];let refusal:unknown;
  for(let n=0;n<54;n++){try{objects.push(r.retainProtocolArtifact('adaptation',n,Buffer.alloc(65537,65+n)));}catch(error){refusal=error;break;}}
  assert.ok(objects.length>0);assert.match(String(refusal),/Protected mandatory proof/);const before=r.status().inventory.length;
  const proof=r.retainProtocolArtifact('task-output',0,Buffer.alloc(65536,1));assert.equal(r.status().proofs!.filter(p=>p.kind==='task-output').length,1);assert.throws(()=>r.retainProtocolArtifact('task-output',0,Buffer.from('replacement')),/Immutable/);assert.throws(()=>r.retainProtocolArtifact('task-output',36,Buffer.from('bad')),/Bounded/);assert.throws(()=>r.retainProtocolArtifact('feedback',0,Buffer.alloc(65537)),/Bounded/);assert.equal(r.readArtifact(proof,65536).byteLength,65536);assert.equal(r.status().inventory.length,before+1);
});

for(const roleId of ['candidate','no-memory'])test(`actual ${roleId} runtime/effect reserve and dispatch compose nested all-role guard then allow receiver writes`,async t=>{
  const f=fixture(t),r=f.claim(),sources=f.initial(r),a=sources.get(roleId)!.accounting,store=f.stores.get(roleId)!;f.setTime(0);r.begin();const authority={generation:'synthetic',epoch:1,controlRevision:'synthetic-controls'};let entered=0;
  const receiver=a.wrapReceiver({dispatch:async effect=>{entered++;assert.equal(store.transactionActive,false);assert.equal(f.stores.get('candidate')!.transactionActive,false);store.put('ordinary','after-entry',{actual:effect.id},null);return {outcome:'succeeded' as const,receipt:store.putJsonArtifact({synthetic:true,actualEffect:effect.id})};},reconcile:async()=>{throw new Error('unexpected reconciliation');}});
  const runtime=new DurableRuntime({store,resources:a.resources,effects:new EffectJournal(store,{assert(){}},receiver),shell:a.wrapShell({run:async(input,bridge)=>({status:'completed' as const,observations:[await bridge.execute({id:'actual-effect',runId:input.run.id,stepId:'step',name:'fixture_write',arguments:{synthetic:true}})]})}),now:f.original.now});
  if(roleId!=='candidate')a.resources.allocate(f.registration.rootId,a.role.resources);
  const run=runtime.admit({id:'public-in',source:'direct',externalId:'public-in',externalRevision:'1',actorId:'synthetic-host',authenticated:true,scope:{kind:'public'},value:'ordinary source input'},authority,a.role.resources,roleId==='candidate'?a.role.allocationId:f.registration.rootId);
  const result=await runtime.resume(run.id,{id:'base',requestDigest:identity('base'),fragments:[]});assert.equal(result.status,'completed');assert.equal(entered,1);assert.ok(store.get('ordinary','after-entry'));assert.equal(f.original.snapshot(f.registration.rootId).requests,1);assert.deepEqual(a.transitions().map(t=>t.state.request.status),['reserved','dispatched','succeeded']);r.assertCurrentUse();t.diagnostic(canonicalJson({roleId,guardMeasurements:f.guardMeasurements,processPeakRssKiB:process.resourceUsage().maxRSS}));assert.ok(Math.max(...f.guardMeasurements.map(m=>m.wallMs))<=1000,'Small actual entry guard exceeds adopted one-second maximum');
});

test('late authentic effect response settles after another captured role withdraws, with no new entry',async t=>{
  const f=fixture(t),control=f.stores.get('no-standing-goals')!;control.put('memory','entry','public synthetic source',null);const r=f.claim(),sources=f.initial(r),a=sources.get('candidate')!.accounting,store=f.stores.get('candidate')!;f.setTime(0);r.begin();let release!:()=>void,started!:()=>void;const entry=new Promise<void>(resolve=>{started=resolve;}),wait=new Promise<void>(resolve=>{release=resolve;});
  const receiver=a.wrapReceiver({dispatch:async()=>{started();await wait;return {outcome:'succeeded' as const,receipt:store.putJsonArtifact({synthetic:'authentic late response'})};},reconcile:async()=>{throw new Error('no reconcile');}});
  const runtime=new DurableRuntime({store,resources:a.resources,effects:new EffectJournal(store,{assert(){}},receiver),shell:a.wrapShell({run:async(input,bridge)=>({status:'completed' as const,observations:[await bridge.execute({id:'late-effect',runId:input.run.id,stepId:'step',name:'fixture_write',arguments:{synthetic:true}})]})}),now:f.original.now});
  const run=runtime.admit({id:'late-in',source:'direct',externalId:'late-in',externalRevision:'1',actorId:'synthetic-host',authenticated:true,scope:{kind:'public'},value:'ordinary late input'},{generation:'synthetic',epoch:1,controlRevision:'synthetic-controls'},a.role.resources,a.role.allocationId),pending=runtime.resume(run.id,{id:'base',requestDigest:identity('base'),fragments:[]});await entry;
  control.withdrawDocumentJournalContent({id:'committed-withdraw',reason:'forget',targets:[{namespace:'memory',key:'entry',expectedRevision:1}]});assert.throws(()=>r.assertCurrentUse(),/document-history-withdrawn/);r.fail('\u0000'.repeat(128),new Error('\u0000'.repeat(512)));assert.equal(r.status().phase,'failed');assert.throws(()=>a.captureTool({id:'new-work',runId:run.id,stepId:'new',name:'fixture_write',arguments:{}}),/withdrawn/);release();await pending;
  const terminal=a.transitions().at(-1)!;assert.equal(terminal.state.request.status,'succeeded');const response=terminal.settlement!.value.response!;assert.ok(r.readRetainedResponse(terminal.state.request.id,response,4096).byteLength>0);assert.throws(()=>r.readArtifact(response,4096),/withdrawn/);assert.equal(f.original.snapshot(f.registration.rootId).requests,1);assert.equal(r.status().pending,null);assert.equal(r.status().useDisposition!.value.source,null);
});

test('owner marker failure leaves conservative in-memory denial and raw/original claims unchanged',t=>{
  const f=fixture(t),store=f.stores.get('no-memory')!;store.put('memory','entry','synthetic public memory',null);const r=f.claim();f.initial(r);const before=r.status().inventory.length,put=f.state.put.bind(f.state);f.state.put=((namespace:string,key:string,value:any,expected:any)=>{if(namespace==='development.acquisition'&&value.useDisposition)throw new Error('injected marker persistence failure');return put(namespace,key,value,expected);})as typeof f.state.put;
  store.withdrawDocumentJournalContent({id:'withdraw-before-marker',reason:'forget',targets:[{namespace:'memory',key:'entry',expectedRevision:1}]});assert.throws(()=>r.assertCurrentUse(),/marker persistence failed/);f.state.put=put;assert.equal(r.status().useDisposition,null);assert.equal(r.status().inventory.length,before);assert.throws(()=>r.rawStoreForRole('candidate').putBytes(Buffer.from('blocked')),/conservatively refused/);assert.equal(f.original.snapshot(f.registration.rootId).requests,0);
  const reopened=DevelopmentAcquisitionRecorder.reopen(f.options);for(const [id,s]of f.sources(reopened))reopened.attachApplication(id,s.application,s.accounting);assert.throws(()=>reopened.assertCurrentUse(),/document-history-withdrawn/);assert.equal(reopened.status().useDisposition!.value.source,null);assert.equal(reopened.status().inventory.length,before);
});

test('B publication uses committed exact final cuts; historical reads permit later original accounting suffix',t=>{
  const f=fixture(t),r=f.claim(),sources=f.initial(r);f.setTime(0);r.begin();f.setTime(180);const candidate=sources.get('candidate')!.accounting,b=r.freezeBehavior(candidate,sources),before=canonicalJson(b),cuts=canonicalJson(r.status().snapshots),reader=r.openAcquiredCapture(r.status().snapshots.at(-1)!.artifact),store=f.stores.get('candidate')!;
  store.put('ordinary','review-accounting-suffix',{synthetic:'post-B'},null);reader.assertUsableNow();assert.equal(canonicalJson(r.status().behavior),before);assert.equal(canonicalJson(r.status().snapshots),cuts);assert.equal(r.status().phase,'reviewing');assert.throws(()=>r.freezeBehavior(candidate,sources),/already frozen|stopped/);const result=r.close(candidate,[]);assert.equal(result.automaticReleaseEligible,false);assert.equal(result.h1Eligible,false);assert.equal(r.status().phase,'closed');
});

test('fixed accepted plan and capacity cannot be expanded after claim',t=>{
  const f=fixture(t),r=f.claim(),before=r.plan.capacity.maxArtifacts;assert.throws(()=>{r.plan.capacity.maxArtifacts++;},/read only|readonly/);assert.throws(()=>{r.capacity.totalBytes=1;},/read only|readonly/);assert.throws(()=>{r.plan.captureLayout!.proofPool.maxBytes++;},/read only|readonly/);f.plan.capacity.maxArtifacts++;assert.equal(r.plan.capacity.maxArtifacts,before);
});

test('a committed source write between final capture and B publication refuses without second freeze or recapture',t=>{
  const f=fixture(t),r=f.claim(),sources=f.initial(r),store=f.stores.get('candidate')!,cut=store.withDevelopmentSourceCut.bind(store);f.setTime(0);r.begin();f.setTime(180);let count=0;store.withDevelopmentSourceCut=((input:any,use:any)=>{count++;store.put('ordinary','between-final-cut-and-publication','actual committed write',null);return cut(input,use);})as typeof store.withDevelopmentSourceCut;
  assert.throws(()=>r.freezeBehavior(sources.get('candidate')!.accounting,sources),/source cut changed/);assert.equal(count,1);assert.equal(r.status().phase,'failed');assert.equal(r.status().behavior,null);assert.equal(r.status().snapshots.length,12);assert.ok(store.get('development.accounting.freeze',identity(f.registration)));assert.ok(r.status().failure);assert.throws(()=>r.freezeBehavior(sources.get('candidate')!.accounting,sources),/stopped|already frozen/);
});

test('global original exhaustion preserves retained attempted bytes and one-use claims before any dispatch',t=>{
  const f=fixture(t),store=f.stores.get('candidate')!;f.plan.captureLayout!.referencedOriginalPool.maxOriginals=1;f.plan.captureLayout!.referencedOriginalPool.maxBytes=8;f.accept();const one=store.putArtifact('one'),two=store.putArtifact('two');store.put('ordinary','refs',{one,two},null);const r=f.claim();assert.throws(()=>r.captureApplication('candidate',{store,config:JSON.parse(Buffer.from(f.f.reader(f.m.configurationArtifact,10000)).toString('utf8'))}),/Global original count/);assert.equal(r.status().originals!.length,1);assert.equal(r.status().snapshots.length,0);assert.equal(r.status().pending,null);assert.equal(r.status().originals![0]!.bytes,3);assert.equal(f.original.snapshot(f.registration.rootId).requests,0);assert.throws(()=>f.claim(),/already claimed/);assert.ok(r.status().inventory.some(i=>i.slot==='original'));r.fail('original-bound','actual pool exhausted');assert.equal(r.status().phase,'failed');
});
