import assert from 'node:assert/strict';
import test, { mock, type TestContext } from 'node:test';
import { canonicalJson, identity, type ArtifactRef, type Effect, type JsonValue, type PhysicalRequest, type ShellBridge, type ShellInput } from '../../packages/contracts/index.ts';
import { createAgentShell, type ShellOptions } from '../../packages/agent-shell/index.ts';
import type { WorkerOptions } from '../../packages/supervisor/worker-process.ts';
import { pagedRecorderFixture } from './acquisition-pages.test-fixture.ts';
import { developmentReviewReservation } from './review-reservation.ts';
import { verifyAcquisitionPlan, mandatoryAcquisitionSlots } from './acquisition-plan.ts';
import type { DevelopmentModelReviewOptions } from './model-review.ts';
import type { BoundedReadArguments, BoundedReadReceipt } from './review-projection.ts';

assert.ok(process.execArgv.includes('--experimental-test-module-mocks'), 'Independent review requires explicit in-process worker mock');
mock.module('../../packages/supervisor/worker-process.ts', { namedExports: { async runWorker(o: WorkerOptions) {
  const initial = o.initial as unknown as { input: ShellInput; options: ShellOptions; fragments: Record<string,string> };
  const call = (name: string, ...args: unknown[]) => o.handle(name, args as JsonValue[], new AbortController().signal);
  const shell = createAgentShell({ ...initial.options, apiKey: () => 'synthetic-review-no-network', resolveFragment: async f => initial.fragments[f.artifact.sha256], fetch: async (_url, init) => {
    const response = await call('provider.fetch', init!.body) as { body: string; status: number };
    return new Response(response.body, { status: response.status });
  } });
  const bridge: ShellBridge = {
    execute: async c => await call('execute', c) as unknown as Awaited<ReturnType<ShellBridge['execute']>>,
    capturePrompt: async (...a) => { await call('capturePrompt', ...a); }, reserve: async q => { await call('reserve', q); },
    dispatched: async q => { await call('dispatched', q); }, settle: async q => { await call('settle', q); },
    persistCheckpoint: async (...a) => await call('persistCheckpoint', ...a) as unknown as Awaited<ReturnType<ShellBridge['persistCheckpoint']>>,
    readCheckpoint: async q => call('readCheckpoint', q),
  };
  return await shell.run(initial.input, bridge) as unknown as JsonValue;
} } });
const { runDevelopmentModelReviews } = await import('./model-review.ts');
type Fixture = ReturnType<typeof pagedRecorderFixture>;
const verify = (f: Fixture) => verifyAcquisitionPlan(f.sign(), f.trust, (a,n) => f.raw.readArtifact(a,n), Date.parse(f.m.registeredAt));
const reacceptSessions = (f: Fixture) => { f.reviewAdmission.acceptedSessions = new Map(f.sessions.map(s => [s.roleId, identity(s)])); };

function ready(t: TestContext) {
  const f = pagedRecorderFixture(t,true);
  f.stores.get('no-memory')!.put('memory','withdraw-target',{ public: 'independent source fixture' },null);
  const recorder = f.claim(), sources = f.initial(recorder);
  f.setTime(0); recorder.begin(); f.setTime(180);
  const candidate = sources.get('candidate')!.accounting, behavior = recorder.freezeBehavior(candidate,sources);
  const reservations = () => recorder.withEvidenceRead(read => f.sessions.map(s => developmentReviewReservation(s,f.plan.roles.find(r=>r.roleId===s.roleId)!,{
    manifest:f.m,registration:f.registration,template:f.template,behavior:behavior.value,
    instructionBytes:s.prompt.fragments.map(p=>({artifact:p.artifact,bytes:read({uri:`sha256:${p.artifact.sha256}`,sha256:p.artifact.sha256},s.plan.maxPayloadBytes)})),
  })));
  const admit = () => { const r=reservations(); recorder.admitModelReviews(f.sessions,f.host,f.template,r); return r; };
  return {...f,recorder,candidate,behavior,reservations,admit};
}
type Ready = ReturnType<typeof ready>;
function model(g: Ready) {
  const calls: {role:string;payload:string}[]=[];
  const judgment = () => ({opportunities:g.m.opportunities.map(o=>({id:o.id,outcome:'unavailable',reason:'Independent synthetic negative'})),controls:g.m.controls.map(c=>({id:c.id,outcome:'unavailable',reason:'Independent synthetic negative'})),boundaries:g.m.boundaries.map(id=>({id,outcome:'unavailable',reason:'Independent synthetic negative'})),overall:'unavailable',reason:'No model competence claim'});
  type Message = {content?:string;tool_calls?:unknown[]};
  let provider:(role:string,n:number)=>Message|Promise<Message>=()=>({content:JSON.stringify(judgment())});
  const options:DevelopmentModelReviewOptions={registration:g.plan.registration,behavior:g.behavior,trust:g.trust.envelope,original:g.original,claims:g.state,recorder:g.recorder,reservationTemplate:g.template,sessions:g.sessions,acceptedSessions:g.reviewAdmission.acceptedSessions,acceptedHostDigest:g.reviewAdmission.acceptedHostDigest,host:g.host,
    readInstruction:(a,n)=>g.raw.readArtifact({uri:`sha256:${a.sha256}`,sha256:a.sha256},n),artifactAudiences:new Map(g.behavior.value.artifactIndex.map(i=>[i.artifact.sha256,{kind:'public' as const}])),
    performRequest:async(role,payload)=>{calls.push({role,payload});const message=await provider(role,calls.filter(c=>c.role===role).length);return{status:200,body:JSON.stringify({model:g.sessions.find(s=>s.roleId===role)!.profile.id,choices:[{finish_reason:message.tool_calls?'tool_calls':'stop',message:{role:'assistant',...message}}],usage:{prompt_tokens:2,completion_tokens:3}})};},
  };
  const args=(selector:BoundedReadArguments['selector']):BoundedReadArguments=>({version:1,behaviorDigest:identity(g.behavior.value),selector,cursor:{index:0,offset:0}});
  const tool=(a:BoundedReadArguments)=>({id:'independent-tool',type:'function',function:{name:'evidence_read',arguments:JSON.stringify(a)}});
  return{options,calls,args,tool,judgment,setProvider:(p:typeof provider)=>{provider=p;},run:()=>runDevelopmentModelReviews(options)};
}

for(const [name,change] of [
  ['host', (f:Fixture)=>{f.host.entrypoint='substituted.ts';}],
  ['template', (f:Fixture)=>{f.template.localIdMaxUnits=129;}],
  ['session', (f:Fixture)=>{f.sessions[1].plan.maxElapsedMs--;}],
  ['context despite reaccepted session', (f:Fixture)=>{f.sessions[0].contextDigest=identity('forged-context');reacceptSessions(f);} ],
  ['workspace despite reaccepted session', (f:Fixture)=>{f.sessions[0].workspace=f.sessions[1].workspace;reacceptSessions(f);} ],
  ['missing reviewer acceptance', (f:Fixture)=>{f.reviewAdmission.acceptedSessions=new Map();}],
] as const) test(`preclaim refuses ${name} substitution without durable effects`,t=>{
  const f=pagedRecorderFixture(t,true),usage=f.raw.usage(),allocations=identity(f.stores.get('candidate')!.list('allocations'));
  change(f);
  assert.throws(f.claim,/Reviewer preclaim admission/);
  assert.deepEqual(f.raw.usage(),usage);assert.equal(f.state.get('development.acquisition',f.plan.id),undefined);
  assert.equal(f.state.list('development.model-review').length,0);assert.equal(f.original.snapshot(f.registration.rootId).requests,0);
  assert.equal(identity(f.stores.get('candidate')!.list('allocations')),allocations);
});

test('preclaim exact reservations protect local response copies and reject one missing mandatory slot',t=>{
  const f=pagedRecorderFixture(t,true),before=f.raw.usage(),checked=verify(f),capacity=checked.capacity;
  assert.deepEqual(f.raw.usage(),before);assert.equal(capacity.reviewReservations!.length,2);
  for(const r of capacity.reviewReservations!){
    const s=f.sessions.find(s=>s.roleId===r.roleId)!,p=s.plan;
    const localResponses=(p.maxModelRequests+p.maxToolReads)*p.maxResponseBytes;
    assert.equal(r.responseBytes,localResponses);
    assert.equal(r.metadataBytes-r.draftBytes-p.maxToolReads*r.observationBytes-r.claimBytes-2*r.bindingBytes-p.maxToolReads*r.readEntryBytes,localResponses);
    assert.ok(r.draftSlots>p.maxModelRequests+p.maxToolReads);assert.ok(r.continuationPayloadBytes>r.initialPayloadBytes);
  }
  f.plan.capacity.maxArtifacts=mandatoryAcquisitionSlots(f.plan,capacity)-1;f.accept();
  assert.throws(f.claim,/artifact slots/);assert.deepEqual(f.raw.usage(),before);assert.equal(f.state.get('development.acquisition',f.plan.id),undefined);
});

test('repeated escaped instructions and undersized checkpoints fail before claim',t=>{
  const f=pagedRecorderFixture(t,true),s=f.sessions[0],rp=f.plan.roles.find(r=>r.roleId===s.roleId)!;
  const bytes=Buffer.from('\u0000'.repeat(2200)),ref=f.raw.putBytes(bytes);
  s.prompt.fragments=[0,1,2,3].map(i=>({...s.prompt.fragments[0]!,id:`repeated-${i}`,order:i,artifact:{uri:`aeon:artifact:${ref.sha256}`,sha256:ref.sha256}}));
  reacceptSessions(f);const before=f.raw.usage();
  assert.ok(bytes.byteLength<rp.maxFragmentBytes);assert.ok(4*bytes.byteLength>rp.maxFragmentBytes);
  assert.throws(f.claim,/Canonical review/);assert.deepEqual(f.raw.usage(),before);
  const other=pagedRecorderFixture(t,true);other.sessions[0].plan.maxCheckpointBytes=1024;reacceptSessions(other);
  const beforeOther=other.raw.usage();assert.throws(other.claim,/Canonical review/);assert.deepEqual(other.raw.usage(),beforeOther);
});

test('actual entry pins accepted descriptors and cannot borrow spare role slots',t=>{
  const g=ready(t),reservations=g.reservations(),role=g.sessions[0].roleId,raw=g.recorder.rawStoreForRole(role);
  assert.throws(()=>raw.putBytes(Buffer.from('unadmitted')),/admitted/);
  const changed=structuredClone(g.sessions);changed[0].plan.maxElapsedMs--;
  assert.throws(()=>g.recorder.admitModelReviews(changed,g.host,g.template,reservations),/substituted/);
  assert.throws(()=>g.recorder.admitModelReviews(g.sessions,{...g.host,entrypoint:'changed'},g.template,reservations),/substituted/);
  assert.throws(()=>g.recorder.admitModelReviews(g.sessions,g.host,{...g.template,localIdMaxUnits:129},reservations),/substituted/);
  assert.throws(()=>g.recorder.admitModelReviews(g.sessions,g.host,g.template,reservations.map(r=>({...r,metadataBytes:r.metadataBytes-1}))),/canonical wire/);
  assert.equal(g.recorder.status().reviewEntries!.length,0);
  g.admit();const q=reservations[0]!;
  for(let n=0;n<q.draftSlots;n++)raw.putBytes(Buffer.from(`unique independent tiny draft ${n}`));
  assert.ok(g.recorder.status().draftBytes[role]!<q.draftBytes);
  const before=g.raw.usage();assert.throws(()=>raw.putBytes(Buffer.from('spare role slot is not a reviewer slot')),/protected bytes\/slots/);
  assert.deepEqual(g.raw.usage(),before);assert.equal(g.original.snapshot(g.registration.rootId).requests,0);
});

test('callback lease rejects hostile thenables, writes, reentry, aliases and post-scope reads',t=>{
  const g=ready(t),artifact=g.behavior.value.artifactIndex[0]!.artifact;
  let escaped!:(a:ArtifactRef,n:number)=>Uint8Array;
  const bytes=g.recorder.withEvidenceRead(read=>{escaped=read;return read(artifact,1000000);});assert.ok(bytes.byteLength>0);
  assert.throws(()=>escaped(artifact,1000000),/escaped/);
  assert.throws(()=>g.recorder.withEvidenceRead(read=>{escaped=read;throw new Error('independent callback failure');}),/independent callback failure/);
  assert.throws(()=>escaped(artifact,1000000),/escaped/);
  let touched=false;
  const thenable=Object.create({get then(){touched=true;return()=>{};}}) as unknown;
  assert.throws(()=>g.recorder.withEvidenceRead(read=>{escaped=read;return thenable;}),/synchronous|thenable/);
  assert.equal(touched,false);assert.throws(()=>escaped(artifact,1000000),/escaped/);
  for(const bound of [-1,NaN,1.5,1000001])assert.throws(()=>g.recorder.withEvidenceRead(read=>read(artifact,bound)),/Bounded/);
  assert.throws(()=>g.recorder.withEvidenceRead(read=>read({...artifact,uri:'alias'},1000000)),/Exact inventory/);
  assert.throws(()=>g.recorder.withEvidenceRead(read=>read(artifact,bytes.byteLength-1)),/Exact inventory/);
  assert.throws(()=>g.recorder.withEvidenceRead(()=>g.recorder.withEvidenceRead(()=>0)),/current-use guard/);
  assert.throws(()=>g.recorder.withEvidenceRead(()=>g.stores.get('candidate')!.put('test','source-write',true,null)),/current-use|development/);
  assert.equal(g.stores.get('candidate')!.get('test','source-write'),undefined);
  g.recorder.assertCurrentUse();assert.equal(g.recorder.status().useDisposition,null);
});

test('actual historical source withdrawal refuses callback invocation and leaves retained inventory',t=>{
  const g=ready(t),before=g.recorder.status().inventory.map(i=>i.artifact.sha256);let called=false;
  g.stores.get('no-memory')!.withdrawDocumentJournalContent({id:'independent-withdraw',reason:'forget',targets:[{namespace:'memory',key:'withdraw-target',expectedRevision:1}]});
  assert.throws(()=>g.recorder.withEvidenceRead(()=>{called=true;}),/withdrawn/);assert.equal(called,false);
  assert.equal(g.recorder.status().useDisposition!.value.status,'document-history-withdrawn');
  for(const sha of before)assert.ok(g.recorder.status().inventory.some(i=>i.artifact.sha256===sha));
});

function physical(g:Ready){
  g.admit();const role=g.sessions[0].roleId,a=g.bridge(g.recorder,role),local=g.stores.get(role)!;
  a.resources.allocate(g.registration.rootId,a.role.resources);a.resources.allocate('independent',a.role.resources,g.registration.rootId);
  const request=(id:string):PhysicalRequest=>{
    const call={id,runId:'independent',stepId:'independent-step',name:'evidence_read',arguments:{version:1,behaviorDigest:identity(g.behavior.value),selector:{kind:'collection',name:'findings'},cursor:{index:0,offset:0}}};
    a.captureTool(call);return{id:`tool:${id}`,runId:'independent',purpose:'reasoning',provider:'effect-receiver',model:'evidence_read',promptManifestId:`tool:${id}`,requestDigest:identity(call),reservationId:`tool:${id}`,status:'reserved',usage:{requests:1,inputTokens:0,outputTokens:0,costUsd:0,elapsedMs:0}};
  };
  const effect=(q:PhysicalRequest):Effect=>({id:q.id,runId:q.runId,stepId:'independent-step',kind:'evidence_read',payload:{},scope:{kind:'public'},authority:{generation:'synthetic',epoch:1,controlRevision:'independent'},status:'dispatched',revision:0,reservationId:q.reservationId});
  return{a,local,request,effect};
}

test('source-pool response dedup preserves its original charge and exact immutable request binding',async t=>{
  const g=ready(t),p=physical(g),q=p.request('source-dedup'),other=p.request('unrelated-request');
  p.a.resources.reserve(q);p.a.resources.reserve(other);const id=p.a.requestId(q.id),otherId=p.a.requestId(other.id);
  const source=g.recorder.status().inventory.find(i=>i.slot==='source'&&i.bytes>0&&i.bytes<8192)!;
  const bytes=g.recorder.readArtifact(source.artifact,8192),originalEntry=structuredClone(source),before=g.raw.usage();
  assert.throws(()=>g.recorder.retainResponse(id,bytes),/undispatched/);
  p.a.resources.dispatched({...q,status:'dispatched'});p.a.resources.dispatched({...other,status:'dispatched'});
  assert.throws(()=>g.recorder.readRetainedResponse(id,source.artifact,8192),/scope/);
  const receiver=p.a.wrapReceiver({dispatch:async()=>({outcome:'succeeded',receipt:p.local.putArtifact(bytes)}),reconcile:async()=>{throw new Error('unused');}});
  await receiver.dispatch(p.effect(q));p.a.resources.settle({...q,status:'succeeded'});
  assert.equal(identity(g.recorder.status().inventory.find(i=>i.artifact.sha256===source.artifact.sha256)),identity(originalEntry));
  assert.deepEqual(g.raw.usage(),before);assert.deepEqual(g.recorder.readRetainedResponse(id,source.artifact,8192),bytes);
  assert.throws(()=>g.recorder.readRetainedResponse(otherId,source.artifact,8192),/scope/);
  assert.throws(()=>g.recorder.readRetainedResponse(id,{...source.artifact,uri:'alias'},8192),/scope/);
  assert.throws(()=>g.recorder.readRetainedResponse(id,source.artifact,bytes.byteLength-1),/scope/);
  assert.throws(()=>g.recorder.retainResponse(id,Buffer.from('replacement response')),/undispatched|immutable/);
  assert.equal(identity(g.recorder.retainResponse(id,bytes)),identity(source.artifact));
  assert.equal(g.recorder.status().reservations[id]!.responseLimit,8192);assert.equal(g.original.snapshot(g.registration.rootId).requests,2);
});

test('failed undispatched reservations cannot manufacture maintenance response membership',t=>{
  const g=ready(t),p=physical(g),q=p.request('never-dispatched');p.a.resources.reserve(q);
  const id=p.a.requestId(q.id);assert.throws(()=>p.a.resources.settle({...q,status:'failed'}),/trusted non-dispatch proof/);
  // Host ledger records a genuinely undispatched terminal reservation; worker advice alone was refused.
  g.original.settle({...g.original.request(id)!,status:'failed'});
  const entry=g.recorder.status().inventory.find(i=>i.bytes>0&&i.bytes<8192)!;
  assert.throws(()=>g.recorder.retainResponse(id,g.recorder.readArtifact(entry.artifact,8192)),/undispatched/);
  assert.throws(()=>g.recorder.readRetainedResponse(id,entry.artifact,8192),/scope/);assert.equal(g.recorder.status().reservations[id]!.responseArtifacts.length,0);
});

test('pending draft-origin receiver settles after real source withdrawal and failure, without new work',async t=>{
  const g=ready(t),p=physical(g),bytes=Buffer.from('independently pending original response'),ref=g.recorder.rawStoreForRole(g.sessions[0].roleId).putBytes(bytes);
  const entry=structuredClone(g.recorder.status().inventory.find(i=>i.artifact.sha256===ref.sha256)!),q=p.request('late-response');p.a.resources.reserve(q);p.a.resources.dispatched({...q,status:'dispatched'});
  let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>{enter=r;}),gate=new Promise<void>(r=>{release=r;});
  const receiver=p.a.wrapReceiver({dispatch:async()=>{enter();await gate;return{outcome:'succeeded',receipt:p.local.putArtifact(bytes)};},reconcile:async()=>{throw new Error('unused');}});
  const pending=receiver.dispatch(p.effect(q));await entered;
  g.stores.get('no-memory')!.withdrawDocumentJournalContent({id:'during-physical',reason:'forget',targets:[{namespace:'memory',key:'withdraw-target',expectedRevision:1}]});
  assert.throws(()=>g.recorder.assertCurrentUse(),/withdrawn/);g.recorder.fail('independent-stop',new Error('stop'));
  release();await pending;p.a.resources.settle({...q,status:'succeeded'});const id=p.a.requestId(q.id);
  assert.deepEqual(g.recorder.readRetainedResponse(id,ref,8192),bytes);assert.equal(g.original.request(id)!.status,'succeeded');
  assert.equal(identity(g.recorder.status().inventory.find(i=>i.artifact.sha256===ref.sha256)),identity(entry));assert.equal(g.recorder.status().pending,null);
  assert.throws(()=>g.recorder.readArtifact(ref,8192),/withdrawn/);assert.throws(()=>p.request('post-withdrawal'),/withdrawn/);
  assert.equal(g.original.snapshot(g.registration.rootId).requests,1);
});

test('actual reviewer receipt settles before final request and successful claims replay without calls',async t=>{
  const g=ready(t),m=model(g);m.setProvider((_role,n)=>n===1?{tool_calls:[m.tool(m.args({kind:'collection',name:'findings'}))]}:{content:JSON.stringify(m.judgment())});
  const result=await m.run();assert.ok(result.roles.every(r=>r.status==='completed'),canonicalJson(result.roles));assert.equal(m.calls.length,4);assert.equal(result.accounting.usage.requests,6);
  for(const role of result.roles){const e=role.binding!.value.execution.value;assert.equal(e.inputMode,'bounded-sections-v1');assert.equal(e.evidenceReads.length,1);const read=e.evidenceReads[0]!;assert.ok('receipt' in read);
    const receipt=JSON.parse(g.recorder.readArtifact(read.receipt,2048).toString()) as BoundedReadReceipt;assert.equal(receipt.behaviorDigest,identity(g.behavior.value));assert.deepEqual(receipt.selector,{kind:'collection',name:'findings'});
    const toolIndex=result.transitions.findIndex(t=>t.state.request.id===read.requestId&&t.state.request.status==='succeeded'),finalIndex=result.transitions.findIndex(t=>t.state.request.id===e.requestId&&t.state.request.status==='dispatched');
    assert.ok(toolIndex>=0&&finalIndex>toolIndex);assert.equal(result.transitions[toolIndex]!.settlement!.value.response!.sha256,read.receipt.sha256);
    assert.equal(g.recorder.status().inventory.find(i=>i.artifact.sha256===read.receipt.sha256)!.pool,'draft');
  }
  const again=await m.run();assert.deepEqual(again.roles,result.roles);assert.equal(m.calls.length,4);assert.equal(g.state.list('development.model-review').length,2);assert.equal(g.original.snapshot(g.registration.rootId).requests,6);
  const closed=g.recorder.close(g.candidate,result.roles.map(r=>r.binding!));assert.equal(closed.h1Eligible,false);assert.equal(closed.automaticReleaseEligible,false);
});

test('actual invalid indexed-original request cannot read an unindexed retained source',async t=>{
  const g=ready(t),m=model(g),hidden=g.raw.putBytes(Buffer.from('not in B nor recorder inventory'));
  m.setProvider(()=>({tool_calls:[m.tool(m.args({kind:'original',artifact:hidden}))]}));
  const result=await m.run();assert.ok(result.roles.every(r=>r.status==='unavailable'&&r.evidenceReads.length===0));
  assert.equal(result.transitions.filter(t=>t.state.request.provider==='effect-receiver'&&t.state.request.status==='succeeded').length,0);
  const calls=m.calls.length;await m.run();assert.equal(m.calls.length,calls);assert.equal(g.state.list('development.model-review').length,2);
});

test('actual provider late response is retained after source withdrawal and prevents second reviewer entry',async t=>{
  const g=ready(t),m=model(g);m.setProvider(async()=>{await Promise.resolve();g.stores.get('no-memory')!.withdrawDocumentJournalContent({id:'during-model',reason:'forget',targets:[{namespace:'memory',key:'withdraw-target',expectedRevision:1}]});return{content:JSON.stringify(m.judgment())};});
  await assert.rejects(m.run,/withdrawn/);assert.equal(m.calls.length,1);assert.equal(g.state.list('development.model-review').length,1);
  const entries=Object.entries(g.recorder.status().reservations);assert.equal(entries.length,1);const [id,r]=entries[0]!;assert.equal(r.responseArtifacts.length,1);
  const ref={uri:`sha256:${r.responseArtifacts[0]}`,sha256:r.responseArtifacts[0]!};assert.ok(g.recorder.readRetainedResponse(id,ref,8192).byteLength>0);
  await assert.rejects(m.run,/withdrawn/);assert.equal(m.calls.length,1);assert.equal(g.original.snapshot(g.registration.rootId).requests,1);
});

test('entry detects changed instruction bytes and caller reacceptance cannot replace claimed sessions',async t=>{
  const g=ready(t),m=model(g);m.options.readInstruction=()=>Buffer.from('substituted owned instruction');
  await assert.rejects(m.run,/instruction bytes changed/);assert.equal(g.state.list('development.model-review').length,0);assert.equal(m.calls.length,0);
  g.sessions[0].plan.maxElapsedMs--;reacceptSessions(g);
  const reservations=g.reservations();
  assert.throws(()=>g.recorder.admitModelReviews(g.sessions,g.host,g.template,reservations),/substituted/);
  assert.equal(g.recorder.status().reviewEntries!.length,0);assert.equal(g.original.snapshot(g.registration.rootId).requests,0);
});

test('overlapping one-use invocations cannot dispatch either reviewer twice',async t=>{
  const g=ready(t),m=model(g);let entered!:()=>void,release!:()=>void;
  const firstEntered=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;});
  m.setProvider(async(role)=>{if(role===g.sessions[0].roleId){entered();await gate;}return{content:JSON.stringify(m.judgment())};});
  const first=m.run();await firstEntered;
  try { await m.run(); } finally { release(); }
  await first;
  assert.equal(m.calls.filter(c=>c.role===g.sessions[0].roleId).length,1);assert.equal(m.calls.filter(c=>c.role===g.sessions[1].roleId).length,1);
  assert.equal(g.original.snapshot(g.registration.rootId).requests,2);assert.equal(g.state.list('development.model-review').length,2);
  await m.run();assert.equal(m.calls.length,2);
});


test('scoped callback must refuse owner writes and cannot release bytes after synchronous withdrawal',t=>{
  const g=ready(t),artifact=g.behavior.value.artifactIndex[0]!.artifact;
  let released:Uint8Array|undefined;
  let refused:unknown;
  try { g.recorder.withEvidenceRead(read=>{
    g.recorder.withdrawAttemptUse('inside-scoped-read');
    released=read(artifact,1000000);
  }); } catch(error) { refused=error; }
  t.diagnostic(canonicalJson({releasedBytes:released?.byteLength??0,disposition:g.recorder.status().useDisposition?.value.status??null,refusal:refused?String(refused):null}));
  assert.ok(refused&&/current-use|development|withdrawn/.test(String(refused)),'Scoped callback must refuse owner mutation/withdrawal before returning bytes');
  assert.equal(released,undefined,'No byte release after authority withdrawal inside the scoped callback');
});

test('shared public current-use callback must refuse and roll back owner-state writes',t=>{
  const g=ready(t);let refusal:unknown;
  try{g.recorder.withCurrentUse(()=>g.state.put('independent-probe','forbidden-owner-write',true,null));}catch(error){refusal=error;}
  const committed=g.state.get('independent-probe','forbidden-owner-write')!==undefined;
  t.diagnostic(canonicalJson({committed,refusal:refusal?String(refusal):null}));
  assert.ok(refusal&&/current-use|development/.test(String(refusal)),'Owner writes must refuse inside public current-use callbacks');
  assert.equal(committed,false);
});
