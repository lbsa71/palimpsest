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
function recorderFixture(t:TestContext) {
  const f=syntheticWitnessFixture(),directory=mkdtempSync(join(tmpdir(),'aeon-observer-independent-'));mkdirSync(join(directory,'raw'),{mode:0o700});
  const raw=new QualificationStore(join(directory,'raw'),developmentCapacityLimits.maxEvidenceBytes,developmentCapacityProfile);
  const m:DevelopmentAttempt={...f.m,version:2,capacityProfile:developmentCapacityProfile,limits:{...developmentCapacityLimits},grant:{...f.m.grant,resources:{...f.m.grant.resources,maxRequests:512,maxTokens:200000,maxCostUsd:500},originalAccounting:{grantId:f.m.grant.id,usage:{requests:0,inputTokens:0,outputTokens:0,costUsd:0,elapsedMs:3000},chargedTokens:0,chargedCostUsd:0,chargedElapsedMs:0,requestIds:[],unknownRequestIds:[]}}};
  const config=JSON.parse(Buffer.from(f.reader(m.configurationArtifact,10000)).toString('utf8'));
  const roleResources={...m.grant.resources,maxRequests:64};
  const roles:DevelopmentRoleBinding[]=['candidate',...m.controls.map(c=>c.id),...m.reviewers.map(r=>r.id)].map((id,i)=>({id,kind:i===0?'candidate':i<=m.controls.length?'control':'reviewer',assignmentId:i===0?null:id,allocationId:`role:${id}`,configurationDigest:m.candidate.configuration,closureDigest:identity({id,synthetic:'closure'}),profile:config.model,allowedEffects:['fixture_write'],resources:roleResources}));
  const schedule:NonNullable<DevelopmentAcquisitionPlan['protocol']>['schedule']=[],assignments:any[]=[];
  const add=(roleId:string,phase:typeof schedule[number]['phase'],n:number)=>{for(let ordinal=0;ordinal<n;ordinal++){const id=`${phase}:${ordinal}`;schedule.push({roleId,assignmentId:id,phase,ordinal});assignments.push({roleId,id,message:{source:'synthetic-pages',externalId:id,revision:'1',conversation:`${roleId}:${id}`,text:'Public synthetic ordinary assignment',actor:{id:'synthetic-host',scope:{kind:'public'},modificationEligible:false}}});}};
  for(const roleId of ['candidate','no-memory','no-standing-goals'])for(const [phase,n]of [['opportunity',12],['learning',3],['interference',9],['feedback',12]]as const)add(roleId,phase,n);
  for(const roleId of m.controls.filter(c=>!['no-memory','no-standing-goals'].includes(c.id)).map(c=>c.id)){add(roleId,'script',3);add(roleId,'script-feedback',3);}
  const packet=f.put({version:1,assignments});
  const registration:DevelopmentRegistration={version:2,attemptDigest:identity(m),rootId:'operating-envelope:v1',rootCancelled:false,registeredAt:m.registeredAt,reviewDeadlineAt:f.at(290),observerClosureDigest:f.trust.observer.artifactDigest,closureVerifierDigest:identity('synthetic closure verifier'),assignmentDigest:packet.sha256,roles,originalRequests:[]};
  const plan:DevelopmentAcquisitionPlan={version:2,id:'synthetic-complete-page-protocol',manifest:signDocument(domains.attempt,m,'issuer',f.keys.get('issuer')!),registration:signDocument(reviewEnvelopeDomains.registration,registration,'issuer',f.keys.get('issuer')!),assignmentPacket:packet,originalStateFile:join(directory,'candidate.sqlite'),closures:{node:identity('synthetic node'),dependencies:m.candidate.dependencies,prompts:m.candidate.prompts,tools:identity('synthetic tools'),acquisition:m.acquisitionDigest},rawStore:raw.identity(),roles:roles.map(r=>({roleId:r.id,stateFile:join(directory,`${r.id}.sqlite`),workspace:join(directory,`workspace-${r.id}`),configuration:m.configurationArtifact,closure:f.put({id:r.id,synthetic:'closure'}),journal:{stream:`journal:${r.id}`,hostId:`host:${r.id}`,maxAnchorDocuments:512,maxAnchorBytes:1000000},maxDrafts:64,maxPayloadBytes:8192,maxPromptBytes:2048,maxFragmentBytes:8192,maxResponseBytes:4096})),capacity:{captureBytes:854228992,maxSnapshots:156,maxSnapshotBytes:1048576,envelopeBytes:75497472,transitionBytes:4096,failureBytes:65536,inventoryEntryBytes:384,maxArtifacts:13568,maxObservations:424},captureLayout:{kind:'complete-pages-global-originals-v1',page:{maxPageRows:512,maxPageBytes:262144,maxPages:64,maxPhysicalRows:32768,maxConservativeBytes:16777216,maxSerializedBytes:4194304,maxOperationalArtifacts:2048,maxOperationalArtifactBytes:1000000,maxOperationalArtifactTotalBytes:16777216},maxManifestBytes:1048576,maxCaptureIndexBytes:4096,referencedOriginalPool:{maxOriginals:2048,maxBytes:16777216},sourcePool:{maxArtifacts:32,maxBytes:1048576},proofPool:{maxArtifacts:256,maxBytes:16777216,mandatoryArtifacts:202,mandatoryArtifactBytes:65536},metadata:{behaviorBytes:16777216,finalBytes:25165824,ownerWithoutBehaviorBytes:25165824,ownerBytes:41943040}},protocol:{nonRequestObservations:40,initialCaptures:6,cycleCaptures:6,boundaryCaptures:12,schedule}};
  for(const bytes of f.artifacts.values())raw.putBytes(bytes);
  const stateFile=join(directory,'recorder.sqlite');writeFileSync(stateFile,'',{mode:0o600});const state=new OperationalStore({filename:stateFile});
  const stores=new Map<string,OperationalStore>();for(const rp of plan.roles){mkdirSync(rp.workspace,{mode:0o700});const store=new OperationalStore({filename:rp.stateFile,documentJournal:rp.journal});chmodSync(store.filename,0o600);stores.set(rp.roleId,store);}
  let now=Date.parse(m.grant.issuedAt);const original=new ResourceLedger(stores.get('candidate')!,{tokens:100,costUsd:0.1,elapsedMs:5000},()=>now);original.allocate(registration.rootId,m.grant.resources);for(const role of roles)original.allocate(role.allocationId,role.resources,registration.rootId);now=Date.parse(m.registeredAt);
  const trust:AcquisitionPlanTrust={acceptedPlanDigest:identity(plan),issuers:f.trust.issuers,envelope:{acceptedRegistrationDigest:identity(registration),behavior:{...f.trust,acceptedAttemptDigest:identity(m)},acceptedRoles:new Map(roles.map(r=>[r.id,identity(r)])),closure:{id:'closer',key:Buffer.alloc(32,9),verifierDigest:registration.closureVerifierDigest},transports:new Map([['transport',Buffer.alloc(32,10)]])}};
  const guardMeasurements:{wallMs:number;cpuMs:number}[]=[];
  const sign=()=>signDocument(acquisitionPlanDomain,plan,'issuer',f.keys.get('issuer')!);const options:AcquisitionRecorderOptions={state,raw,original,document:sign(),trust,syntheticClock:()=>({wallMs:now,monotonicMs:now-Date.parse(m.grant.issuedAt),bootId:'synthetic-boot',processStart:'synthetic-process'})};
  const accept=()=>{trust.acceptedPlanDigest=identity(plan);options.document=sign();};
  const bridge=(recorder:DevelopmentAcquisitionRecorder,roleId:string)=>{const role=roles.find(r=>r.id===roleId)!,store=stores.get(roleId)!,rp=plan.roles.find(r=>r.roleId===roleId)!;return new DevelopmentAccounting({localStore:store,original,localDefaultCeiling:{tokens:100,costUsd:0.1,elapsedMs:5000},registration,acceptedRegistrationDigest:identity(registration),roleId,acceptedRoleDigest:identity(role),originalGrant:{resources:m.grant.resources,issuedAt:m.grant.issuedAt,expiresAt:m.grant.expiresAt},behaviorWindow:{notBefore:m.notBefore,deadlineAt:m.deadlineAt},actualConfigurationDigest:role.configurationDigest,actualClosureDigest:role.closureDigest,actualProfile:role.profile,rawStore:recorder.rawStoreForRole(roleId),reserveEvidence:q=>recorder.reserveEvidence(roleId,q),retainResponse:(id,bytes)=>recorder.retainResponse(id,bytes),assertCurrentUse:()=>{const start=performance.now(),cpu=process.cpuUsage();try{recorder.assertCurrentUse();}finally{const spent=process.cpuUsage(cpu);guardMeasurements.push({wallMs:performance.now()-start,cpuMs:(spent.user+spent.system)/1000});}},readRetainedResponse:(id,a,n)=>recorder.readRetainedResponse(id,a,n),transport:{id:'transport',key:Buffer.alloc(32,10)},maxResponseBytes:rp.maxResponseBytes});};
  const sources=(r:DevelopmentAcquisitionRecorder)=>new Map(roles.filter(role=>role.kind!=='reviewer').map(role=>[role.id,{application:{store:stores.get(role.id)!,config},accounting:bridge(r,role.id)}]));
  const initial=(r:DevelopmentAcquisitionRecorder)=>{const all=sources(r);for(const [id,s]of all)r.captureApplication(id,s.application,s.accounting);return all;};
  t.after(()=>{for(const store of stores.values())store.close();state.close();rmSync(directory,{recursive:true,force:true});});
  return {f,m,plan,registration,roles,trust,options,raw,state,stores,original,sign,accept,bridge,sources,initial,guardMeasurements,claim:()=>DevelopmentAcquisitionRecorder.claim(options),setTime:(seconds:number)=>{now=Date.parse(f.at(seconds));}};
}


import { projectDevelopmentPageSources, type DevelopmentPageSourceInput } from './development-observer.ts';
import type { AuthenticatedMessage } from '../../packages/communications/core/index.ts';
function actualReaderInput(r: DevelopmentAcquisitionRecorder, before: ArtifactRef, after: ArtifactRef, current = after): DevelopmentPageSourceInput {
  const m = r.openAcquiredCapture(after).manifest;
  return { before, after, current, assignmentPacket: r.plan.assignmentPacket, roleId: m.roleId, configurationDigest: m.configurationDigest, pathIdentity: m.source.pathIdentity, journal: m.cut.journalBinding,
    bounds: { maxCaptureBytes: 1048576, maxArtifactBytes: 1048576, maxRows: 512, maxProofBytes: 1048576 }, metadataBounds: { maxRecords: 20000, maxBytes: 8388608 }, readArtifact: (ref, max) => r.readArtifact(ref, max), openAcquiredCapture: ref => r.openAcquiredCapture(ref) };
}

function actualCore(f: ReturnType<typeof recorderFixture>, r: DevelopmentAcquisitionRecorder, a: DevelopmentAccounting) {
  const store = f.stores.get('candidate')!, actualAuthority = { generation: 'synthetic', epoch: 1, controlRevision: 'synthetic-controls' };
  let calls = 0, failedCheckpoint = false;
  const receiver = a.wrapReceiver({ async dispatch(effect) { return { outcome: 'succeeded' as const, receipt: store.putJsonArtifact({ publicSynthetic: true, actualEffect: effect.id }) }; }, async reconcile() { throw Error('unused reconciliation'); } });
  const runtime = new DurableRuntime({ store, resources: a.resources, effects: new EffectJournal(store, { assert() {} }, receiver), now: f.original.now,
    shell: a.wrapShell({ async run(input, bridge) {
      calls++;
      if (failedCheckpoint) { await bridge.persistCheckpoint(input.run.id, input.run.revision, 'synthetic', { observationIds: [], progress: 'new cursor before interrupted return' }); throw Error('actual recorder checkpoint interruption'); }
      return { status: 'checkpointed' as const, observations: [await bridge.execute({ id: `joined-effect:${calls}`, runId: input.run.id, stepId: `step:${calls}`, name: 'fixture_write', arguments: { publicSynthetic: true } })] };
    } }) });
  const core = new CommunicationsCore({ store, runtime, grant: () => ({ authority: actualAuthority, resources: a.role.resources, parentRunId: a.role.allocationId }) });
  return { runtime, core, checkpointFailure: () => { failedCheckpoint = true; } };
}


test('independent actual lazy observer rejects altered event and exact version bodies after positive result provenance',async t=>{
  const f=recorderFixture(t),r=f.claim(),sources=f.initial(r),source=sources.get('candidate')!,{core,runtime}=actualCore(f,r,source.accounting),before=r.status().snapshots[0]!.artifact;
  const packet=JSON.parse(r.readArtifact(r.plan.assignmentPacket,1000000).toString()) as {assignments:{roleId:string,id:string,message:AuthenticatedMessage}[]},entry=packet.assignments.find(e=>e.roleId==='candidate')!;f.setTime(0);r.begin();const run=core.receive(entry.message).run;await runtime.resume(run.id,{id:'independent',requestDigest:identity('independent'),fragments:[]});
  const after=r.captureApplication('candidate',source.application,source.accounting),input=actualReaderInput(r,before,after),open=input.openAcquiredCapture;let events=0,versions=0;let mode:'correct'|'event'|'version'='correct';
  input.openAcquiredCapture=ref=>{const actual=open(ref);return {...actual,resolveEvent(sequence){events++;const result=actual.resolveEvent(sequence);return mode==='event'?{...result,data:{forged:'same-position'}}:result;},resolveJournalVersion(id){versions++;const result=actual.resolveJournalVersion(id);return mode==='version'?{...result,document:{...result.document,value:{forged:'same-ref'}}}:result;}};};
  const positive=projectDevelopmentPageSources(input),assignment=positive.assignments.find(a=>a.assignmentId===entry.id)!;assert.ok(assignment.result);assert.ok(events>0&&versions>0);const rd=open(after);assert.equal(identity(rd.resolveJournalVersion(assignment.result.origin.execution.versionId).document),assignment.result.origin.execution.sha256);
  for(const changed of ['event','version'] as const){mode=changed;const negative=projectDevelopmentPageSources(input);assert.equal(negative.assignments.some(a=>a.assignmentId===entry.id&&a.result!==null),false);assert.ok(negative.unavailable.some(u=>/resolver differs|commitment differs/.test(u.reason)),canonicalJson(negative.unavailable));}
  assert.equal(f.original.snapshot(f.registration.rootId).requests,1);r.assertCurrentUse();
});

test('independent actual observer leaves irrelevant bodies lazy and refuses bounded metadata before body resolution',t=>{
  const f=recorderFixture(t),store=f.stores.get('candidate')!;for(let i=0;i<8;i++)store.put('review-unused',String(i),'x'.repeat(8192),null);
  const r=f.claim();f.initial(r);const ref=r.status().snapshots[0]!.artifact,input=actualReaderInput(r,ref,ref),open=input.openAcquiredCapture;let bodies=0;
  input.openAcquiredCapture=a=>{const actual=open(a);return {...actual,resolveEvent(n){bodies++;return actual.resolveEvent(n);},resolveJournalVersion(id){bodies++;return actual.resolveJournalVersion(id);}};};
  const positive=projectDevelopmentPageSources(input);assert.equal(positive.unavailable.some(u=>u.subject==='source'),false);assert.equal(bodies,0);assert.equal(positive.assignments.length,0);
  input.metadataBounds={maxRecords:1,maxBytes:8388608};const count=projectDevelopmentPageSources(input);assert.ok(count.unavailable.some(u=>/metadata record\/byte/.test(u.reason)));assert.equal(bodies,0);
  input.metadataBounds={maxRecords:20000,maxBytes:1};const bytes=projectDevelopmentPageSources(input);assert.ok(bytes.unavailable.some(u=>/metadata record\/byte/.test(u.reason)));assert.equal(bodies,0);
});

test('independent actual observer refuses another role withdrawal immediately after a semantic page fence releases',t=>{
  const f=recorderFixture(t),control=f.stores.get('no-memory')!;control.put('review','target','synthetic public source',null);const r=f.claim();f.initial(r);const ref=r.status().snapshots[0]!.artifact,input=actualReaderInput(r,ref,ref),open=input.openAcquiredCapture;let withdrew=false;
  input.openAcquiredCapture=a=>{const actual=open(a);return {...actual,forEachEvent(visit){actual.forEachEvent(visit);if(!withdrew){withdrew=true;control.withdrawDocumentJournalContent({id:'between-semantic-pages',reason:'forget',targets:[{namespace:'review',key:'target',expectedRevision:1}]});}}};};
  const result=projectDevelopmentPageSources(input);assert.equal(withdrew,true);assert.deepEqual(result.assignments,[]);assert.deepEqual(result.cycles,[]);assert.ok(result.unavailable.some(u=>/withdrawn/.test(u.reason)));assert.equal(r.status().useDisposition!.value.source,null);assert.equal(f.original.snapshot(f.registration.rootId).requests,0);
});
