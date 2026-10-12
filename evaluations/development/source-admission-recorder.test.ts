import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalJson,identity} from '../../packages/contracts/index.ts';
import {DevelopmentAcquisitionRecorder} from './acquire.ts';
import {verifyAcquisitionPlan} from './acquisition-plan.ts';
import {sourceRecorderFixture} from './source-admission-recorder.test-fixture.ts';

test('mechanical policy is charged at claim; actual scheduler selection records and replays one signed cycle',async t=>{
  const f=sourceRecorderFixture(t),r=f.claim();assert.equal(r.status().proofs!.length,1);assert.equal(r.status().proofs![0]!.ordinal,0);
  const source=f.setup(r),selector=await source.cycle(),result=r.recordCycle(selector);assert.equal(result.status,'recorded',JSON.stringify(result));if(result.status!=='recorded')return;
  assert.equal(result.observationId,'source:cycle:candidate:cycle-1');const observation=r.status().observations.find(o=>o.value.id===result.observationId)!;const wrapper=JSON.parse(r.readArtifact(observation.value.artifact,4096).toString());assert.equal(wrapper.proof.sha256,result.proof.sha256);assert.equal(wrapper.sourceAdmissionDigest,r.status().sourceAdmissionDigest);assert.equal(wrapper.observedAt,f.f.at(61));
  const old=identity(r.status());assert.deepEqual(r.recordCycle(selector),result);assert.equal(identity(r.status()),old);assert.equal(r.recordCycle({...selector,selectionId:'changed'}).status,'failed');assert.equal(r.status().admissions!.length,1);
  const reopened=DevelopmentAcquisitionRecorder.reopen(f.options);for(const[id,s]of source.sources)reopened.attachApplication(id,s.application,s.accounting);assert.deepEqual(reopened.recordCycle(selector),result);
});
test('actual assignment inspection is unsigned and mechanical experience is explicitly unavailable',async t=>{
  const f=sourceRecorderFixture(t),r=f.claim(),source=f.setup(r),selector=await source.assignment(),before=identity(r.status()),result=r.inspectAssignment(selector);assert.equal(result.status,'derived',JSON.stringify(result));assert.equal(identity(r.status()),before);assert.equal(r.recordExperience({...selector,interferenceId:f.m.opportunities.find(o=>o.family==='transfer')!.interferenceIds[0]!}).status,'unavailable');assert.equal(r.status().admissions!.length,0);
});
test('full policy reserves 202+52 without cap increase and derives actual mapped experience',async t=>{
  const f=sourceRecorderFixture(t,true),capacity=verifyAcquisitionPlan(f.options.document,f.trust,(a,n)=>f.raw.readArtifact(a,n),Date.parse(f.m.registeredAt),f.admission).capacity;assert.equal(capacity.sourceAdmission!.slots.length,52);assert.equal(f.plan.captureLayout!.proofPool.maxArtifacts,256);assert.equal(f.plan.captureLayout!.proofPool.maxBytes,16777216);const r=f.claim(),source=f.setup(r),selector=await source.assignment('interference:0',true),result=r.recordExperience({...selector,interferenceId:f.m.opportunities.find(o=>o.family==='transfer')!.interferenceIds[0]!});assert.equal(result.status,'recorded',JSON.stringify(result));
});

import {signDocument} from '../qualification/manifest.ts';
import {domains} from './witness.ts';
import {reviewEnvelopeDomains} from './review-envelope.ts';
import {developmentSourceCheckDomain,type DevelopmentSourceCheck} from './development-source-admission.ts';
import {evidenceRetentionDomain,evidenceCustodianDomain,retentionSourceDigest} from './acquisition-plan.ts';
import {OperationalStore} from '../../packages/storage/index.ts';
import {join,dirname} from 'node:path';
import {chmodSync} from 'node:fs';

function receipt(f:ReturnType<typeof sourceRecorderFixture>,changes:Partial<DevelopmentSourceCheck>={}){
  const subject=f.m.opportunities.find(o=>o.family==='transfer')!.id,map=f.workload.opportunities.find(o=>o.id===subject)!.roles[0]!,ref={uri:`sha256:${identity('public extracted fixture')}`,sha256:identity('public extracted fixture')};
  const value:DevelopmentSourceCheck={version:1,planDigest:identity(f.plan),policyDigest:f.admission.trust.acceptedPolicyDigest,roleId:'candidate',opportunityId:subject,assignmentIds:[map.learningAssignmentId!],sourceDigest:identity('fixture-check-source'),checkerSourceDigest:f.policy.checkerSourceDigest!,extractorSourceDigest:f.policy.extractorSourceDigest!,rubricDigest:f.policy.rubricDigest!,output:ref,feedback:ref,acquisition:'completed',behavior:'pass',disclosure:'preserved',matching:'valid',judgments:[],checkedAt:f.f.at(10),...changes};
  const signed=signDocument(developmentSourceCheckDomain,value,'fixture-checker',Buffer.alloc(32,29));return {artifact:f.raw.putBytes(Buffer.from(canonicalJson(signed))),value,signed};
}
function custodian(f:ReturnType<typeof sourceRecorderFixture>,t:import('node:test').TestContext){
  const store=new OperationalStore({filename:join(dirname(f.raw.identity().directory),'custodian.sqlite')});chmodSync(store.filename,0o600);t.after(()=>store.close());
  const value={version:1 as const,id:'admission-retention',attemptDigest:identity(f.m),sourceDigest:retentionSourceDigest(f.plan),rawStoreDigest:identity(f.plan.rawStore),custodianId:'admission-custodian',purpose:'local fixture',audiences:[`principal:${f.m.observerId}`,...new Set(f.roles.map(r=>`provider:${r.profile?.provider??'mistral'}`)),...f.m.reviewers.map(r=>`reviewer:${r.id}`)],dataScope:'complete-operational-role-sources' as const,retention:'independent-indefinite' as const,withdrawal:'stop-use-retain-originals' as const};
  f.plan.retention=signDocument(evidenceRetentionDomain,value,'issuer',f.f.keys.get('issuer')!);f.trust.retention={acceptedGrantDigest:identity(value),issuers:f.f.trust.issuers,custodianSigner:'issuer',custodianKey:f.f.keys.get('issuer')!};f.options.custodian={store,key:value.custodianId};
  const disposition=(status:'active'|'withdrawn')=>{const old=store.get('development.evidence-custodian',value.custodianId);store.put('development.evidence-custodian',value.custodianId,signDocument(evidenceCustodianDomain,{version:1,grantDigest:identity(value),attemptDigest:identity(f.m),custodianId:value.custodianId,status},'issuer',f.f.keys.get('issuer')!),old?.revision??null);};disposition('active');f.accept();return {store,disposition};
}
test('changed accepted descriptor, policy, optional layout and missing admission refuse before claim or reopen',t=>{
  const f=sourceRecorderFixture(t),before=f.raw.usage();f.admission.acceptedCompositionDigest=identity('wrong');assert.throws(()=>f.claim(),/composition/);assert.deepEqual(f.raw.usage(),before);assert.equal(f.state.get('development.acquisition',f.plan.id),undefined);f.accept();const r=f.claim();
  const changed=structuredClone(f.admission.composition);changed.maxExtractedBytes--;assert.throws(()=>DevelopmentAcquisitionRecorder.reopen({...f.options,sourceAdmission:{...f.admission,composition:changed,acceptedCompositionDigest:identity(changed)}}),/binding/);
  assert.throws(()=>DevelopmentAcquisitionRecorder.reopen({...f.options,sourceAdmission:undefined}),/binding/);assert.throws(()=>DevelopmentAcquisitionRecorder.reopen({...f.options,sourceAdmission:{...f.admission,trust:{...f.admission.trust,acceptedPolicyDigest:identity('wrong')}}}),/policy/);
  f.admission.composition.maxExtractedBytes--;assert.equal(r.capacity.sourceAdmission!.composition.maxExtractedBytes,65536);
});
test('native checker key is copied, its digest is pinned, and no secret key enters retained owner/raw bytes',t=>{
  const f=sourceRecorderFixture(t,true),r=f.claim();f.setup(r);f.setTime(10);f.key.fill(44);const check=receipt(f),ref=r.importSourceCheck({kind:'learning',roleId:'candidate',subjectId:check.value.opportunityId,artifact:check.artifact});assert.equal(identity(ref),identity(check.artifact));assert.throws(()=>DevelopmentAcquisitionRecorder.reopen(f.options),/binding/);
  const owner=canonicalJson(r.status());assert.ok(!owner.includes('keyDigest'));assert.ok(!owner.includes('principalId'));for(const entry of r.status().inventory){const bytes=f.raw.readArtifact(entry.artifact,entry.bytes);assert.ok(!bytes.includes(Buffer.alloc(32,29)));assert.ok(!bytes.includes(Buffer.alloc(32,44)));}
});
test('admission descriptor, key and selector proxies/accessors execute zero traps',t=>{
  const f=sourceRecorderFixture(t,true);let effects=0;const trap={get(){effects++;throw Error('proxy executed');},ownKeys(){effects++;throw Error('proxy executed');},getPrototypeOf(){effects++;throw Error('proxy executed');}};
  const getter=structuredClone(f.admission.composition);Object.defineProperty(getter,'layout',{enumerable:true,get(){effects++;return 'source-admission-fixed-54-v1';}});
  for(const admission of [{...f.admission,composition:getter},{...f.admission,composition:new Proxy(f.admission.composition,trap)},{...f.admission,trust:{...f.admission.trust,checker:{...f.admission.trust.checker!,key:new Proxy(f.key,trap)}}},new Proxy(f.admission,trap)])assert.throws(()=>DevelopmentAcquisitionRecorder.claim({...f.options,sourceAdmission:admission}));
  assert.equal(effects,0);const r=f.claim();f.setup(r);const bracket={roleId:'candidate',before:r.status().snapshots[0]!.artifact,after:r.status().snapshots[0]!.artifact,assignmentId:'opportunity:0'};assert.equal(r.inspectAssignment(new Proxy(bracket,trap)).status,'failed');Object.defineProperty(bracket,'assignmentId',{enumerable:true,get(){effects++;return 'opportunity:0';}});assert.equal(r.inspectAssignment(bracket).status,'failed');assert.equal(effects,0);
});
test('future proof/receipt slots remain protected from early optional pressure and q+1 support refuses',t=>{
  const f=sourceRecorderFixture(t,true),q=65536,first=f.raw.putBytes(Buffer.alloc(q,1)),second=f.raw.putBytes(Buffer.alloc(q,2)),changed=f.raw.putBytes(Buffer.alloc(q,3)),over=f.raw.putBytes(Buffer.alloc(q+1,4));
  f.admission.composition.support=[{ordinal:52,purpose:'first-public-pressure',maxBytes:q,expected:null},{ordinal:53,purpose:'second-public-pressure',maxBytes:q,expected:null}];f.accept();const r=f.claim();f.setup(r);
  for(const [kind,ordinal]of [['adaptation',16],['adaptation',4],['cycle',0],['checker',0]]as const)assert.throws(()=>r.retainProtocolArtifact(kind,ordinal,Buffer.from('arbitrary early bytes')),/Composition-owned/);
  for(const ordinal of [52,53,54])assert.throws(()=>r.retainProtocolArtifact('adaptation',ordinal,Buffer.from('arbitrary early bytes')),/Composition-owned/);
  assert.throws(()=>r.importSourceSupport({ordinal:52,purpose:'first-public-pressure',artifact:over}),/bound|Bound|budget|Budget/);
  const one=r.importSourceSupport({ordinal:52,purpose:'first-public-pressure',artifact:first}),two=r.importSourceSupport({ordinal:53,purpose:'second-public-pressure',artifact:second});assert.ok(one.sha256!==two.sha256);assert.throws(()=>r.importSourceSupport({ordinal:52,purpose:'first-public-pressure',artifact:changed}),/Immutable|Changed occupied/);
  const logical=r.status().proofs!.reduce((n,p)=>n+p.bytes,0),future=r.capacity.sourceAdmission!.slots.filter(s=>!r.status().proofs!.some(p=>p.kind==='adaptation'&&p.ordinal===s.ordinal));assert.ok(logical+202*q+future.reduce((n,s)=>n+s.maxBytes,0)<=16777216);
});
test('only enabled public support intake may read preexisting custodian bytes and all copies are charged',t=>{
  const f=sourceRecorderFixture(t),q=65536,bytes=Buffer.alloc(q,72),artifact=f.raw.putBytes(bytes),over=f.raw.putBytes(Buffer.alloc(q+1,73));f.admission.composition.support=[{ordinal:52,purpose:'public-rubric-support',maxBytes:q,expected:artifact}];f.accept();const r=f.claim();f.setup(r);
  assert.throws(()=>r.readArtifact(artifact,q),/absent/);assert.throws(()=>r.retainProtocolArtifact('adaptation',52,bytes),/Composition-owned/);
  assert.throws(()=>r.importSourceSupport({ordinal:53,purpose:'public-rubric-support',artifact}),/Unaccepted/);assert.throws(()=>r.importSourceSupport({ordinal:52,purpose:'private-answer',artifact}),/Unaccepted/);assert.throws(()=>r.importSourceSupport({ordinal:52,purpose:'public-rubric-support',artifact:over}),/Unaccepted/);
  assert.equal(identity(r.importSourceSupport({ordinal:52,purpose:'public-rubric-support',artifact})),identity(artifact));assert.equal(r.readArtifact(artifact,q).length,q);assert.equal(identity(r.importSourceSupport({ordinal:52,purpose:'public-rubric-support',artifact})),identity(artifact));assert.equal(r.status().proofs!.filter(p=>p.ordinal===52).length,1);
});
test('typed source receipts authenticate exact subject/signature and consume immutable slots despite raw deduplication',t=>{
  const f=sourceRecorderFixture(t,true),r=f.claim();f.setup(r);f.setTime(10);const check=receipt(f),selector={kind:'learning' as const,roleId:'candidate',subjectId:check.value.opportunityId,artifact:check.artifact};assert.throws(()=>r.readArtifact(check.artifact,65536),/absent/);assert.equal(identity(r.importSourceCheck(selector)),identity(check.artifact));assert.equal(identity(r.importSourceCheck(selector)),identity(check.artifact));assert.equal(r.status().proofs!.filter(p=>p.kind==='adaptation'&&p.ordinal===4).length,1);
  const changed=receipt(f,{sourceDigest:identity('changed-source')});assert.throws(()=>r.importSourceCheck({...selector,artifact:changed.artifact}),/Changed occupied/);
  const wrong=receipt(f,{assignmentIds:['learning:2']});assert.throws(()=>r.importSourceCheck({...selector,artifact:wrong.artifact}),/delivery/);
  const bad={...check.signed,signature:'0'.repeat(64)},badRef=f.raw.putBytes(Buffer.from(canonicalJson(bad)));assert.throws(()=>r.importSourceCheck({...selector,artifact:badRef}),/signature|Signature/);
  assert.throws(()=>r.importSourceCheck({...selector,roleId:'no-memory'}),/binding/);assert.throws(()=>r.importSourceCheck({...selector,kind:'script'}),/delivery/);
});
test('three proposed support objects and full policy wrong ordinals fail before irreversible raw claim',t=>{
  const f=sourceRecorderFixture(t,true),before=f.raw.usage();f.admission.composition.support=[52,53,54].map(ordinal=>({ordinal,purpose:'public',maxBytes:65536,expected:null})) as any;f.accept();assert.throws(()=>f.claim(),/support/);assert.deepEqual(f.raw.usage(),before);assert.equal(f.state.get('development.acquisition',f.plan.id),undefined);
  f.admission.composition.support=[];f.policy.adaptationOrdinals.learningChecks[0]!.ordinal=3;f.accept();assert.throws(()=>f.claim(),/Fixed learning/);assert.deepEqual(f.raw.usage(),before);
});
test('preclaim includes escaped wrapper/index and all B copies under the existing singleton/metadata caps',t=>{
  const f=sourceRecorderFixture(t),plain=verifyAcquisitionPlan(f.options.document,f.trust,(a,n)=>f.raw.readArtifact(a,n),Date.parse(f.m.registeredAt)).capacity,admitted=verifyAcquisitionPlan(f.options.document,f.trust,(a,n)=>f.raw.readArtifact(a,n),Date.parse(f.m.registeredAt),f.admission).capacity;
  assert.ok(admitted.ownerBaseBytes>plain.ownerBaseBytes);assert.ok(admitted.behaviorBaseBytes>plain.behaviorBaseBytes);assert.ok(admitted.sourceAdmission!.observationBytes>2048);assert.ok(admitted.sourceAdmission!.observationBytes<=4096);
  f.plan.capacity.envelopeBytes+=plain.maxRequests*5*(f.plan.capacity.transitionBytes-1024);f.plan.capacity.transitionBytes=1024;f.accept();const before=f.raw.usage();assert.throws(()=>f.claim(),/observation template/);assert.deepEqual(f.raw.usage(),before);assert.equal(f.state.get('development.acquisition',f.plan.id),undefined);
});
test('escaped preregistered experience identities are included in the decisive preclaim wire bound',t=>{
  const f=sourceRecorderFixture(t,true),manifest=structuredClone(f.plan.manifest.value),old=manifest.opportunities.find(o=>o.family==='transfer')!.interferenceIds[0]!,replacement='\u0000'.repeat(200);
  for(const opportunity of manifest.opportunities)opportunity.interferenceIds=opportunity.interferenceIds.map(id=>id===old?replacement:id);
  f.plan.manifest=signDocument(domains.attempt,manifest,'issuer',f.f.keys.get('issuer')!);const registration={...f.plan.registration.value,attemptDigest:identity(manifest)};
  f.plan.registration=signDocument(reviewEnvelopeDomains.registration,registration,'issuer',f.f.keys.get('issuer')!);f.trust.envelope.behavior.acceptedAttemptDigest=identity(manifest);f.trust.envelope.acceptedRegistrationDigest=identity(registration);f.accept();
  verifyAcquisitionPlan(f.options.document,f.trust,(a,n)=>f.raw.readArtifact(a,n),Date.parse(manifest.registeredAt));const before=f.raw.usage();assert.throws(()=>f.claim(),/observation template/);assert.deepEqual(f.raw.usage(),before);assert.equal(f.state.get('development.acquisition',f.plan.id),undefined);
});
for(const boundary of ['owner','source','custodian']as const)test(`raw proof callback cannot write or withdraw ${boundary} before source bytes are released`,async t=>{
  const f=sourceRecorderFixture(t),c=boundary==='custodian'?custodian(f,t):undefined,r=f.claim(),source=f.setup(r),selector=await source.cycle(),put=f.raw.putBytes.bind(f.raw);let trapped=0;
  f.raw.putBytes=((bytes:Uint8Array)=>{if(!trapped&&r.status().admissionPending&&r.status().pending){trapped++;if(boundary==='custodian')c!.disposition('withdrawn');else (boundary==='owner'?f.state:source.store).put('attack','write','forbidden',null);}return put(bytes);}) as typeof f.raw.putBytes;
  const result=r.recordCycle(selector);assert.ok(result.status!=='recorded');assert.ok(trapped>0);assert.equal(f.state.get('attack','write'),undefined);assert.equal(source.store.get('attack','write'),undefined);assert.equal(r.status().observations.filter(o=>o.value.data.kind==='cycle').length,0);assert.ok(r.status().admissionPending);assert.equal(r.status().phase,'failed');assert.throws(()=>DevelopmentAcquisitionRecorder.reopen(f.options),/Interrupted/);
});
test('private derivation raw reads fence owner and public reentry without mislabeling callback refusal as source corruption',async t=>{
  const f=sourceRecorderFixture(t),r=f.claim(),source=f.setup(r),selector=await source.assignment(),read=f.raw.readArtifact.bind(f.raw);let refused=0;
  f.raw.readArtifact=((artifact,max)=>{if(f.state.transactionActive){assert.throws(()=>f.state.put('attack','read','forbidden',null),/writes forbidden/);assert.throws(()=>r.readArtifact(artifact,max??65536),/reenter/);refused++;}return read(artifact,max);}) as typeof f.raw.readArtifact;
  assert.equal(r.inspectAssignment(selector).status,'derived');assert.ok(refused>0);assert.equal(f.state.get('attack','read'),undefined);assert.equal(r.status().useDisposition,null);
});
test('source-looking raw retention callback failure preserves source disposition and durable admission pending',async t=>{
  const f=sourceRecorderFixture(t),r=f.claim(),source=f.setup(r),selector=await source.cycle(),put=f.raw.putBytes.bind(f.raw);let injected=false;
  f.raw.putBytes=((bytes:Uint8Array)=>{if(!injected&&r.status().admissionPending&&r.status().pending){injected=true;throw Error('document-history-corrupt-or-missing from host raw callback');}return put(bytes);}) as typeof f.raw.putBytes;
  assert.equal(r.recordCycle(selector).status,'failed');assert.ok(injected);assert.equal(r.status().useDisposition,null);assert.ok(r.status().admissionPending);assert.equal(r.status().phase,'failed');assert.equal(r.status().observations.filter(o=>o.value.data.kind==='cycle').length,0);assert.throws(()=>DevelopmentAcquisitionRecorder.reopen(f.options),/Interrupted/);f.state.put('callback-scope','released',true,null);
});
test('unrelated captured role withdrawal denies committed replay and no new admission/signature appears',async t=>{
  const f=sourceRecorderFixture(t),control=f.stores.get('no-memory')!;control.put('private','episode','public synthetic target',null);const r=f.claim(),source=f.setup(r),selector=await source.cycle(),record=r.recordCycle(selector);assert.equal(record.status,'recorded');const before=r.status().observations.length;
  control.withdrawDocumentJournalContent({id:'admission-withdrawal',reason:'forget',targets:[{namespace:'private',key:'episode',expectedRevision:1}]});assert.equal(r.recordCycle(selector).status,'unavailable');assert.equal(r.status().observations.length,before);assert.equal(r.status().useDisposition!.value.status,'document-history-withdrawn');
});
test('owner withdrawal denies unsigned source inspection and signed cycle replay',async t=>{
  const f=sourceRecorderFixture(t),r=f.claim(),source=f.setup(r),selector=await source.cycle();assert.equal(r.recordCycle(selector).status,'recorded');const before=r.status().observations.length;r.withdrawAttemptUse('explicit owner withdrawal');assert.equal(r.recordCycle(selector).status,'unavailable');assert.equal(r.inspectAssignment({roleId:'candidate',assignmentId:'opportunity:0',before:selector.before,after:selector.after}).status,'unavailable');assert.equal(r.status().observations.length,before);
});
test('custodian withdrawal denies admission before signing and preserves the terminal disposition',async t=>{
  const f=sourceRecorderFixture(t),c=custodian(f,t),r=f.claim(),source=f.setup(r),selector=await source.cycle();c.disposition('withdrawn');assert.equal(r.recordCycle(selector).status,'unavailable');assert.equal(r.status().admissions!.length,0);assert.equal(r.status().useDisposition!.value.status,'withdrawn');
});
for(const stage of ['admission-pending','raw-pending','bytes-written','inventory','logical-proof','raw-wrapper']as const)test(`interrupted ${stage} retains durable pending and refuses reopening/signing replay`,async t=>{
  const f=sourceRecorderFixture(t),r=f.claim(),source=f.setup(r),selector=await source.cycle(),put=f.state.put.bind(f.state),rawPut=f.raw.putBytes.bind(f.raw);let injected=false;
  f.state.put=((namespace,key,value,revision)=>{const s=value as any;if(!injected&&namespace==='development.acquisition'&&(s.admissionPending||(stage==='raw-wrapper'&&r.status().admissionPending))){const fire=stage==='admission-pending'&&s.pending||stage==='inventory'&&!s.pending&&s.inventory.some((i:any)=>i.artifact.sha256===s.admissionPending.planned[0].artifact.sha256)||stage==='logical-proof'&&s.proofs.some((p:any)=>p.kind==='cycle')||stage==='raw-wrapper'&&s.admissions.some((a:any)=>a.kind==='cycle');if(fire){injected=true;throw Error(`injected ${stage}`);}}return put(namespace,key,value,revision);}) as typeof f.state.put;
  f.raw.putBytes=((bytes)=>{if(!injected&&r.status().admissionPending&&r.status().pending){if(stage==='raw-pending'){injected=true;throw Error('injected raw pending');}if(stage==='bytes-written'){injected=true;rawPut(bytes);throw Error('injected bytes written');}}return rawPut(bytes);}) as typeof f.raw.putBytes;
  const result=r.recordCycle(selector);assert.ok(result.status!=='recorded',JSON.stringify(result));assert.equal(injected,true);assert.ok(r.status().admissionPending);assert.equal(r.status().phase,'failed');assert.equal(r.status().admissions!.length,0);assert.equal(r.status().observations.filter(o=>o.value.data.kind==='cycle').length,0);assert.throws(()=>DevelopmentAcquisitionRecorder.reopen(f.options),/Interrupted/);assert.equal(f.original.snapshot(f.registration.rootId).requests,1);
});
test('active owner transaction and asynchronous selectors cannot enter private admission',async t=>{
  const f=sourceRecorderFixture(t),r=f.claim(),source=f.setup(r),selector=await source.cycle(),before=identity(r.status());f.state.transaction(()=>{const result=r.recordCycle(selector);assert.ok(result.status!=='recorded');});assert.equal(identity(r.status()),before);assert.equal(r.recordCycle({...selector,then(){}} as any).status,'failed');assert.equal(identity(r.status()),before);
});

test('actual unqualified host clock retains sourced cycle proof but emits no positive observation',async t=>{
  const f=sourceRecorderFixture(t,false,true),r=f.claim();await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(f.m.notBefore)-Date.now()+100)));const source=f.setup(r),selector=await source.cycle(),result=r.recordCycle(selector);assert.equal(result.status,'unavailable',JSON.stringify(result));if(result.status==='unavailable')assert.match(result.code,/temporal qualification/);assert.equal(r.status().admissions!.length,1);const proof=r.status().proofs!.find(p=>p.kind==='cycle')!,value=JSON.parse(r.readArtifact(proof.artifact,65536).toString());assert.equal(value.interval.clockKind,'host');assert.equal(value.interval.temporalEligibility,'unavailable');assert.equal(r.status().observations.filter(o=>o.value.data.kind==='cycle').length,0);
});

test('source-admitted recorder preserves authentic late physical response and settlement after owner withdrawal',async t=>{
  const f=sourceRecorderFixture(t),r=f.claim(),source=f.setup(r,true),pending=source.assignment();await source.enteredReceiver;const request=f.original.store.list<any>('requests').find(x=>x.value.request.status==='dispatched')!.value.request;r.withdrawAttemptUse('late original receiver response');source.release();await assert.rejects(pending,/withdrawn/);assert.equal(f.original.request(request.id)!.status,'succeeded');const reservation=r.status().reservations[request.id]!;assert.equal(reservation.responseArtifacts.length,1);const entry=r.status().inventory.find(i=>i.artifact.sha256===reservation.responseArtifacts[0])!;assert.ok(r.readRetainedResponse(request.id,entry.artifact,4096).length>0);assert.throws(()=>r.readArtifact(entry.artifact,4096),/withdrawn/);const before=identity(r.status().inventory);assert.equal(identity(r.retainResponse(request.id,f.raw.readArtifact(entry.artifact,4096))),identity(entry.artifact));assert.equal(identity(r.status().inventory),before);
});
test('support q+1 input is refused by the original singleton bound before pending or logical inventory',t=>{
  const f=sourceRecorderFixture(t),q=65536;f.admission.composition.support=[{ordinal:52,purpose:'public',maxBytes:q,expected:null}];f.accept();const big=f.raw.putBytes(Buffer.alloc(q+1,81)),small=f.raw.putBytes(Buffer.alloc(q,82)),r=f.claim();f.setup(r);const prior=identity(r.status());assert.throws(()=>r.importSourceSupport({ordinal:52,purpose:'public',artifact:big}),/bound|limit|exceeds/i);assert.equal(identity(r.status()),prior);assert.equal(identity(r.importSourceSupport({ordinal:52,purpose:'public',artifact:small})),identity(small));assert.equal(r.status().proofs!.find(p=>p.ordinal===52)!.bytes,q);
});
test('reopening verifies the committed observation signature and original custodian Store identity',async t=>{
  const f=sourceRecorderFixture(t),c=custodian(f,t),r=f.claim(),source=f.setup(r),selector=await source.cycle();assert.equal(r.recordCycle(selector).status,'recorded');const row=f.state.get<any>('development.acquisition',f.plan.id)!;row.value.observations.find((o:any)=>o.value.data.kind==='cycle').signature='0'.repeat(64);f.state.put('development.acquisition',f.plan.id,row.value,row.revision);assert.throws(()=>DevelopmentAcquisitionRecorder.reopen(f.options),/signature|Signature/);
  const replacement=new OperationalStore({filename:join(dirname(f.raw.identity().directory),'second-custodian.sqlite')});chmodSync(replacement.filename,0o600);t.after(()=>replacement.close());const disposition=c.store.get('development.evidence-custodian','admission-custodian')!;replacement.put('development.evidence-custodian','admission-custodian',disposition.value,null);assert.throws(()=>DevelopmentAcquisitionRecorder.reopen({...f.options,custodian:{store:replacement,key:'admission-custodian'}}),/binding/);
});
test('cancellation of the original allowance denies further unsigned or signed source admission',async t=>{
  const f=sourceRecorderFixture(t),r=f.claim(),source=f.setup(r),selector=await source.assignment();f.original.cancel(f.registration.rootId);assert.equal(r.inspectAssignment(selector).status,'unavailable');assert.equal(r.status().admissions!.length,0);
});
