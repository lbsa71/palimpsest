import { pagedRecorderFixture } from './acquisition-pages.test-fixture.ts';
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

/** NEW explicitly synthetic, independently signed unclaimed full126/156 profile. No actual workload-fit assertion. */
function fixture(t:TestContext) { return pagedRecorderFixture(t, true); }

import { evidenceRetentionDomain, evidenceCustodianDomain, retentionSourceDigest } from './acquisition-plan.ts';

function independentCustodian(f: ReturnType<typeof fixture>) {
  const value = {version: 1 as const,id:'independent-review-copy',attemptDigest:identity(f.m),sourceDigest:retentionSourceDigest(f.plan),rawStoreDigest:identity(f.plan.rawStore),custodianId:'review-custodian',purpose:'bounded independent review',audiences:[`principal:${f.m.observerId}`,...f.roles.map(r=>`provider:${r.profile?.provider??'mistral'}`),...f.roles.filter(r=>r.kind==='reviewer').map(r=>`reviewer:${r.assignmentId}`)].filter((v,i,a)=>a.indexOf(v)===i),dataScope:'complete-operational-role-sources' as const,retention:'independent-indefinite' as const,withdrawal:'stop-use-retain-originals' as const};
  f.plan.retention=signDocument(evidenceRetentionDomain,value,'issuer',f.f.keys.get('issuer')!);
  f.trust.retention={acceptedGrantDigest:identity(value),issuers:f.f.trust.issuers,custodianSigner:'issuer',custodianKey:f.f.keys.get('issuer')!};
  f.options.custodian={store:f.state,key:value.custodianId};
  const write=(status:'active'|'withdrawn'|'destruction-pending')=>{const old=f.state.get('development.evidence-custodian',value.custodianId);f.state.put('development.evidence-custodian',value.custodianId,signDocument(evidenceCustodianDomain,{version:1,grantDigest:identity(value),attemptDigest:identity(f.m),custodianId:value.custodianId,status},'issuer',f.f.keys.get('issuer')!),old?.revision??null);};
  write('active');f.accept();return write;
}

test('independent complete capture equals direct committed snapshot and preserves cross-role original associations',t=>{
  const f=fixture(t),one=f.stores.get('candidate')!,two=f.stores.get('no-memory')!;
  const a=one.putArtifact('same public original'),b=two.putArtifact('same public original');assert.deepEqual(a,b);
  one.put('review','kept',{a},null);one.put('review','deleted','earlier value',null);one.delete('review','deleted',1);two.put('review','kept',{b},null);
  const r=f.claim();f.initial(r);const direct=one.captureDevelopmentSnapshot({maxRows:512,maxBytes:1000000});
  const c=r.status().snapshots.find(c=>c.roleId==='candidate')!,reader=r.openAcquiredCapture(c.artifact),pages=[...reader.pages()];
  assert.equal(canonicalJson(pages.flatMap(p=>p.table==='events'?p.rows:[])),canonicalJson(direct.events));
  const docs:any[]=[];reader.forEachCurrentDocument(row=>docs.push(row));assert.equal(canonicalJson(docs),canonicalJson(direct.documents.filter(d=>!d.namespace.startsWith('system.document-journal'))));
  for(const payload of direct.journalPayloads){assert.equal(payload.state,'available');if(payload.state==='available')assert.equal(canonicalJson(reader.resolveJournalVersion(payload.ref.versionId)),canonicalJson({ref:payload.ref,document:payload.document}));}
  assert.equal(r.status().originals!.filter(o=>identity(o.original)===identity(a)).length,1);
  for(const role of ['candidate','no-memory']){const ref=r.status().snapshots.find(c=>c.roleId===role)!.artifact;const rd=r.openAcquiredCapture(ref);assert.ok(rd.manifest.cut.operationalArtifacts.some(m=>identity(m.original)===identity(a)));assert.equal(rd.resolve(a,20).toString(),'same public original');}
  const forged=f.raw.putBytes(Buffer.from(canonicalJson({...reader.manifest,clock:{...reader.manifest.clock,wallMs:0}})));assert.throws(()=>r.openAcquiredCapture(forged),/Accepted page capture/);
});

test('independent historical union retains superseded and deleted versions across accepted captures and denies after supported withdrawal',t=>{
  const f=fixture(t),store=f.stores.get('no-standing-goals')!;store.put('review','history','first',null);
  const r=f.claim(),sources=f.initial(r),first=r.status().snapshots.find(c=>c.roleId==='no-standing-goals')!.artifact,old=r.openAcquiredCapture(first);
  const version=store.captureDevelopmentSnapshot({maxRows:512,maxBytes:1000000}).journalPayloads.find(p=>p.ref.namespace==='review')!.ref;
  store.put('review','history','second',1);store.delete('review','history',2);store.put('review','history','third',null);
  const source=sources.get('no-standing-goals')!;r.captureApplication('no-standing-goals',source.application,source.accounting);
  assert.equal(old.resolveJournalVersion(version.versionId).document.value,'first');r.assertCurrentUse();
  const reopened=DevelopmentAcquisitionRecorder.reopen(f.options);for(const [id,s]of f.sources(reopened))reopened.attachApplication(id,s.application,s.accounting);
  reopened.assertCurrentUse();const cached=reopened.openAcquiredCapture(first),before=reopened.status().inventory.length;
  store.withdrawDocumentJournalContent({id:'independent-old-history-withdrawal',reason:'forget',targets:[{namespace:'review',key:'history',expectedRevision:1}]});
  assert.throws(()=>cached.resolveJournalVersion(version.versionId),/document-history-withdrawn/);assert.equal(reopened.status().inventory.length,before);assert.equal(reopened.status().useDisposition!.value.source,null);
});

for(const status of ['withdrawn','destruction-pending'] as const)test(`independent cached pages and exact originals stop on ${status} custody and cannot reopen after restoration`,t=>{
  const f=fixture(t),write=independentCustodian(f),s=f.stores.get('candidate')!,a=s.putArtifact('custodied');s.put('review','original',{a},null);const r=f.claim();f.initial(r);const ref=r.status().snapshots[0]!.artifact,rd=r.openAcquiredCapture(ref),iterator=rd.pages();assert.equal(rd.resolve(a,20).toString(),'custodied');assert.equal(iterator.next().done,false);
  write(status);assert.throws(()=>iterator.next(),/withdrawn|destruction-pending/);assert.throws(()=>rd.resolve(a,20),/withdrawn|destruction-pending/);assert.equal(r.status().useDisposition!.value.status,status);write('active');
  const reopened=DevelopmentAcquisitionRecorder.reopen(f.options);for(const [id,source]of f.sources(reopened))reopened.attachApplication(id,source.application,source.accounting);assert.throws(()=>reopened.openAcquiredCapture(ref),/withdrawn|destruction-pending/);assert.equal(f.original.snapshot(f.registration.rootId).requests,0);
});

test('independent actual semantic callback rejects reentry, function thenables and every source writer, releasing guards after exceptions',t=>{
  const f=fixture(t),r=f.claim(),sources=f.initial(r),store=f.stores.get('candidate')!,rd=r.openAcquiredCapture(r.status().snapshots[0]!.artifact);
  let visited=0;rd.forEachEvent(()=>{if(visited++)return;assert.throws(()=>rd.resolveEvent(1),/transaction|reentrant/);assert.throws(()=>r.captureApplication('candidate',sources.get('candidate')!.application),/depth-zero/);for(const role of f.roles.filter(role=>role.kind!=='reviewer'))assert.throws(()=>f.stores.get(role.id)!.put('review','forbidden',true,null),/development/);});
  const thenable=Object.assign(()=>{}, {then:()=>{}});assert.throws(()=>r.withCurrentUse(()=>thenable),/synchronous/);assert.equal(r.status().useDisposition,null);
  store.transaction(()=>{assert.throws(()=>r.withCurrentUse(()=>{throw Error('document-history callback sentinel');}),/callback sentinel/);store.put('review','after-exception',true,null);});assert.equal(store.get('review','after-exception')!.value,true);assert.equal(r.status().useDisposition,null);r.assertCurrentUse();
});

test('independent owner copies and detached status cannot enlarge accepted reservations',t=>{
  const f=fixture(t),r=f.claim();f.initial(r);const signed=canonicalJson(r.plan),capacity=canonicalJson(r.capacity),status=r.status();status.inventory.length=0;status.snapshots.length=0;
  for(const object of [r.plan.protocol!.schedule[0]!,r.plan.roles[0]!,r.plan.captureLayout!.page,r.plan.captureLayout!.metadata])assert.equal(Object.isFrozen(object),true);
  assert.throws(()=>{r.plan.protocol!.schedule.push(r.plan.protocol!.schedule[0]!);});assert.equal(canonicalJson(r.plan),signed);assert.equal(canonicalJson(r.capacity),capacity);assert.equal(r.status().snapshots.length,6);r.assertCurrentUse();
});

test('independent custody loss preserves only exact dispatched authentic response maintenance',async t=>{
  const f=fixture(t),custody=independentCustodian(f),r=f.claim(),sources=f.initial(r),a=sources.get('candidate')!.accounting,store=f.stores.get('candidate')!;f.setTime(0);r.begin();let signal!:()=>void,release!:()=>void;const started=new Promise<void>(done=>signal=done),pending=new Promise<void>(done=>release=done);
  const receiver=a.wrapReceiver({async dispatch(){signal();await pending;return {outcome:'succeeded' as const,receipt:store.putJsonArtifact({authentic:'late-custody-response'})};},async reconcile(){throw Error('unexpected reconcile');}});
  const runtime=new DurableRuntime({store,resources:a.resources,effects:new EffectJournal(store,{assert(){}},receiver),shell:a.wrapShell({async run(input,bridge){return {status:'completed' as const,observations:[await bridge.execute({id:'custody-effect',runId:input.run.id,stepId:'one',name:'fixture_write',arguments:{}})]};}}),now:f.original.now});
  const run=runtime.admit({id:'custody-in',source:'direct',externalId:'custody-in',externalRevision:'1',actorId:'synthetic-host',authenticated:true,scope:{kind:'public'},value:'public synthetic input'},{generation:'synthetic',epoch:1,controlRevision:'synthetic-controls'},a.role.resources,a.role.allocationId),completion=runtime.resume(run.id,{id:'base',requestDigest:identity('base'),fragments:[]});await started;
  custody('withdrawn');assert.throws(()=>r.assertCurrentUse(),/withdrawn/);assert.throws(()=>r.retainResponse('unmapped',Buffer.from('foreign')),/reservation|request/i);release();await completion;
  const terminal=a.transitions().at(-1)!;assert.equal(terminal.state.request.status,'succeeded');const response=terminal.settlement!.value.response!;
  assert.match(r.readRetainedResponse(terminal.state.request.id,response,4096).toString(),/late-custody-response/);assert.throws(()=>r.readRetainedResponse('unmapped',response,4096),/exact dispatched/);assert.throws(()=>r.readRetainedResponse(terminal.state.request.id,r.plan.assignmentPacket,1000000),/exact dispatched/);assert.throws(()=>r.readArtifact(response,4096),/withdrawn/);assert.throws(()=>a.captureTool({id:'later',runId:run.id,stepId:'later',name:'fixture_write',arguments:{}}),/withdrawn/);assert.equal(f.original.snapshot(f.registration.rootId).requests,1);
});

test('independent final publication fences the last behavioral role and refuses its committed cut change',t=>{
  const f=fixture(t),r=f.claim(),sources=f.initial(r),last=f.roles.filter(role=>role.kind!=='reviewer').at(-1)!,store=f.stores.get(last.id)!,cut=store.withDevelopmentSourceCut.bind(store);f.setTime(0);r.begin();f.setTime(180);let entries=0;
  store.withDevelopmentSourceCut=((input:any,use:any)=>{entries++;store.put('review','changed-last-cut',true,null);return cut(input,use);}) as typeof store.withDevelopmentSourceCut;
  assert.throws(()=>r.freezeBehavior(sources.get('candidate')!.accounting,sources),/source cut changed/);assert.equal(entries,1);assert.equal(r.status().behavior,null);assert.equal(r.status().phase,'failed');assert.equal(r.status().snapshots.length,12);assert.throws(()=>r.freezeBehavior(sources.get('candidate')!.accounting,sources),/stopped|already frozen/);
});
