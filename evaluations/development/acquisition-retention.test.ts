import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { canonicalJson, identity, type PhysicalRequest, type PromptManifest } from '../../packages/contracts/index.ts';
import { DurableRuntime, ResourceLedger } from '../../packages/runtime/index.ts';
import { DevelopmentalMemory } from '../../packages/development/index.ts';
import { EffectJournal } from '../../packages/effects/index.ts';
import { CommunicationsCore } from '../../packages/communications/core/index.ts';
import { hashBytes } from '../../packages/release/artifacts.ts';
import { OperationalStore } from '../../packages/storage/index.ts';
import { DevelopmentAccounting } from '../../deployment/development-accounting.ts';
import type { AutarkApplication } from '../../deployment/application.ts';
import { QualificationStore } from '../qualification/store.ts';
import { signDocument } from '../qualification/manifest.ts';
import { AcquisitionInfeasible, acquisitionPlanDomain, verifyAcquisitionPlan, type AcquisitionPlanTrust, evidenceRetentionDomain, evidenceCustodianDomain, retentionSourceDigest, type DevelopmentAcquisitionPlan } from './acquisition-plan.ts';
import { reviewEnvelopeDomains, type DevelopmentRegistration, type DevelopmentRoleBinding } from './review-envelope.ts';
import { syntheticWitnessFixture } from './witness-fixture.ts';
import { DevelopmentAcquisitionRecorder, type AcquisitionRecorderOptions } from './acquire.ts';

function syntheticAcquisitionPlanFixture() {
  const f = syntheticWitnessFixture(), m = f.m;
  m.limits = { maxRecords: 512, maxArtifactBytes: 1_000_000, maxEvidenceBytes: 8 * 1024 * 1024 };
  m.grant.originalAccounting = { grantId: m.grant.id, usage: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 3000 }, chargedTokens: 0, chargedCostUsd: 0, chargedElapsedMs: 0, requestIds: [], unknownRequestIds: [] };
  const configuration = JSON.parse(Buffer.from(f.reader(m.configurationArtifact, 10000)).toString('utf8'));
  const roles: DevelopmentRoleBinding[] = ['candidate', ...m.controls.map(c => c.id), ...m.reviewers.map(r => r.id)].map((id, i) => ({ id, kind: i === 0 ? 'candidate' : i <= m.controls.length ? 'control' : 'reviewer', assignmentId: i === 0 ? null : id, allocationId: `role:${id}`, configurationDigest: m.candidate.configuration, closureDigest: identity({ id, synthetic: 'closure' }), profile: configuration.model, allowedEffects: ['fixture_read'], resources: m.grant.resources }));
  const assignmentPacket = f.put({ version: 1, assignments: [] });
  const registration: DevelopmentRegistration = { version: 2, attemptDigest: identity(m), rootId: 'operating-envelope:v1', rootCancelled: false, registeredAt: m.registeredAt, reviewDeadlineAt: f.at(290), observerClosureDigest: f.trust.observer.artifactDigest, closureVerifierDigest: identity('synthetic closure verifier'), assignmentDigest: assignmentPacket.sha256, roles, originalRequests: [] };
  const plan: DevelopmentAcquisitionPlan = { version: 1, id: 'synthetic-acquisition', manifest: f.manifest(), registration: signDocument(reviewEnvelopeDomains.registration, registration, 'issuer', f.keys.get('issuer')!), assignmentPacket, originalStateFile: '/tmp/aeon-acquisition/original.sqlite', closures: { node: identity('synthetic node'), dependencies: m.candidate.dependencies, prompts: m.candidate.prompts, tools: identity('synthetic tools'), acquisition: m.acquisitionDigest }, rawStore: { directory: '/tmp/aeon-acquisition/raw', device: '1', inode: '2', uid: '3', capacityBytes: 32 * 1024 * 1024 }, roles: roles.map(r => ({ roleId: r.id, stateFile: `/tmp/aeon-acquisition/${r.id === 'candidate' ? 'original' : r.id}.sqlite`, workspace: `/tmp/aeon-acquisition/work-${r.id}`, configuration: m.configurationArtifact, closure: f.put({ id: r.id, synthetic: 'closure' }), journal: null, maxDrafts: 1, maxPayloadBytes: 5000, maxPromptBytes: 5000, maxFragmentBytes: 1000, maxResponseBytes: 1000 })), capacity: { captureBytes: 6100000, maxSnapshots: 20, maxSnapshotBytes: 300000, envelopeBytes: 200000, transitionBytes: 5000, failureBytes: 4096, inventoryEntryBytes: 256, maxArtifacts: 256, maxObservations: 128 } };
  const trust: AcquisitionPlanTrust = { acceptedPlanDigest: identity(plan), issuers: f.trust.issuers, envelope: { acceptedRegistrationDigest: identity(registration), behavior: { ...f.trust, acceptedAttemptDigest: identity(m) }, acceptedRoles: new Map(roles.map(r => [r.id, identity(r)])), closure: { id: 'closer', key: Buffer.alloc(32, 9), verifierDigest: registration.closureVerifierDigest }, transports: new Map([['transport', Buffer.alloc(32, 10)]]) } };
  const sign = () => signDocument(acquisitionPlanDomain, plan, 'issuer', f.keys.get('issuer')!);
  const accept = () => { plan.registration = signDocument(reviewEnvelopeDomains.registration, registration, 'issuer', f.keys.get('issuer')!); plan.manifest = f.manifest(); registration.attemptDigest = identity(m); trust.acceptedPlanDigest = identity(plan); trust.envelope.acceptedRegistrationDigest = identity(registration); trust.envelope.behavior.acceptedAttemptDigest = identity(m); trust.envelope.acceptedRoles = new Map(roles.map(r => [r.id, identity(r)])); };
  return { f, m, roles, registration, plan, trust, sign, accept, verify: () => verifyAcquisitionPlan(sign(), trust, f.reader, Date.parse(m.registeredAt)) };
}


function fixture(t: TestContext, journal = false, assignments = false) {
  const f = syntheticAcquisitionPlanFixture(), directory = mkdtempSync(join(tmpdir(), 'aeon-recorder-'));
  if (assignments) { f.plan.assignmentPacket = f.f.put({ version: 1, assignments: f.roles.filter(r => r.kind !== 'reviewer').map(r => ({ roleId: r.id, id: 'opportunity', message: { source: 'synthetic-assignment', externalId: 'opportunity', revision: '1', conversation: 'opportunity', text: 'Public synthetic assignment', actor: { id: 'synthetic-host', scope: { kind: 'public' }, modificationEligible: false } } })) }); f.registration.assignmentDigest = f.plan.assignmentPacket.sha256; }
  const rawDirectory = join(directory, 'raw'); mkdirSync(rawDirectory, { mode: 0o700 });
  const raw = new QualificationStore(rawDirectory, 32 * 1024 * 1024);
  for (const bytes of f.f.artifacts.values()) raw.putBytes(bytes);
  f.plan.originalStateFile = join(directory, 'original.sqlite'); f.plan.rawStore = raw.identity();
  for (const rp of f.plan.roles) { rp.stateFile = join(directory, rp.roleId === 'candidate' ? 'original.sqlite' : `${rp.roleId}.sqlite`); rp.workspace = join(directory, `workspace-${rp.roleId}`); rp.journal = journal ? { stream: `source-journal:${rp.roleId}`, hostId: `synthetic-host:${rp.roleId}`, maxAnchorDocuments: 512, maxAnchorBytes: 1_000_000 } : null; mkdirSync(rp.workspace, { mode: 0o700 }); }
  const file = join(directory, 'recorder.sqlite'); writeFileSync(file, '', { mode: 0o600 });
  const state = new OperationalStore({ filename: file }), originalStore = new OperationalStore({ filename: f.plan.originalStateFile, documentJournal: f.plan.roles[0]!.journal });
  let now = Date.parse(f.m.grant.issuedAt);
  const original = new ResourceLedger(originalStore, { tokens: 100, costUsd: 0.1, elapsedMs: 5000 }, () => now);
  original.allocate(f.registration.rootId, f.m.grant.resources);
  for (const role of f.roles) original.allocate(role.allocationId, role.resources, f.registration.rootId);
  now = Date.parse(f.m.registeredAt); f.accept();
  const options: AcquisitionRecorderOptions = { state, original, raw, document: f.sign(), trust: f.trust, syntheticClock: () => ({ wallMs: now, monotonicMs: now - Date.parse(f.m.grant.issuedAt), bootId: 'synthetic-boot', processStart: 'synthetic-process' }) };
  const recorder = () => DevelopmentAcquisitionRecorder.claim(options);
  const stores: OperationalStore[] = [];
  const bridge = (r: DevelopmentAcquisitionRecorder, roleId = 'no-memory', actualOriginal = original) => {
    const role = f.roles.find(r => r.id === roleId)!, rp = f.plan.roles.find(r => r.roleId === roleId)!;
    const store = role.kind === 'candidate' ? originalStore : new OperationalStore({ filename: rp.stateFile, documentJournal: rp.journal }); if (store !== originalStore) stores.push(store);
    const a = new DevelopmentAccounting({ localStore: store, original: actualOriginal, localDefaultCeiling: { tokens: 100, costUsd: 0.1, elapsedMs: 5000 }, registration: f.registration, acceptedRegistrationDigest: identity(f.registration), roleId, acceptedRoleDigest: identity(role), originalGrant: { resources: f.m.grant.resources, issuedAt: f.m.grant.issuedAt, expiresAt: f.m.grant.expiresAt }, behaviorWindow: { notBefore: f.m.notBefore, deadlineAt: f.m.deadlineAt }, actualConfigurationDigest: role.configurationDigest, actualClosureDigest: role.closureDigest, actualProfile: role.profile, rawStore: r.rawStoreForRole(roleId), reserveEvidence: q => r.reserveEvidence(roleId, q), retainResponse: (id, bytes) => r.retainResponse(id, bytes), assertCurrentUse: () => r.assertCurrentUse(), readRetainedResponse: (id, ref, n) => r.readRetainedResponse(id,ref,n), transport: { id: 'transport', key: Buffer.alloc(32, 10) }, maxResponseBytes: rp.maxResponseBytes });
    if (!store.get('allocations', f.registration.rootId)) a.resources.allocate(f.registration.rootId, role.resources); if (!store.get('allocations', 'run')) a.resources.allocate('run', role.resources, f.registration.rootId); return { a, store, role, rp };
  };
  const model = (x: ReturnType<typeof bridge>, id = 'physical') => {
    const payload = canonicalJson({ model: x.role.profile!.id, synthetic: id }), fragment = x.store.putArtifact('Synthetic host-owned prompt');
    const manifest: PromptManifest = { id: `prompt:${id}`, requestDigest: identity(JSON.parse(payload)), fragments: [{ id: 'owned', owner: 'application', role: 'system', order: 0, artifact: fragment, scope: { kind: 'public' }, replaceable: true, derivedFrom: [] }] };
    x.a.capturePrompt(manifest, payload); const profile = x.role.profile!, inputTokens = Buffer.byteLength(payload) + 1024;
    return { id, runId: 'run', purpose: 'reasoning', provider: 'mistral', model: profile.id, promptManifestId: manifest.id, requestDigest: manifest.requestDigest, reservationId: id, status: 'reserved', usage: { requests: 1, inputTokens, outputTokens: profile.maxOutputTokens, costUsd: (inputTokens * profile.pricesPerMillion.input + profile.maxOutputTokens * profile.pricesPerMillion.output) / 1_000_000, elapsedMs: profile.timeoutMs } } satisfies PhysicalRequest;
  };
  const app = (roleId = 'candidate', store = originalStore) => ({ store, config: JSON.parse(raw.readArtifact(f.m.configurationArtifact, 10000).toString('utf8')) }) as Pick<AutarkApplication, 'store' | 'config'>;
  const freezeSources = (r: DevelopmentAcquisitionRecorder) => new Map(f.roles.filter(role => role.kind !== 'reviewer').map(role => { const x = bridge(r, role.id); return [role.id, { application: app(role.id, x.store), accounting: x.a }] as const; }));
  const ingress = (r: DevelopmentAcquisitionRecorder, roleId = 'candidate', actualOriginal = original) => {
    const x = bridge(r, roleId, actualOriginal), effects = new EffectJournal(x.store, { assert() {} }, { async dispatch() { throw new Error('Synthetic fixture forbids effects'); }, async reconcile() { throw new Error('Synthetic fixture forbids reconciliation'); } });
    const runtime = new DurableRuntime({ store: x.store, resources: x.a.resources, effects, shell: { async run() { return { status: 'completed', observations: [] }; } }, now: original.now });
    const communications = new CommunicationsCore({ store: x.store, runtime, grant: () => ({ authority: { generation: 'synthetic', epoch: 1, controlRevision: 'synthetic' }, resources: x.role.resources, parentRunId: f.registration.rootId }) });
    return { ...x, runtime, application: { ...app(roleId, x.store), communications, runtime, resources: x.a.resources } };
  };
  t.after(() => { for (const store of new Set(stores)) { try { store.close(); } catch {} } state.close(); originalStore.close(); raw.close(); rmSync(directory, { recursive: true, force: true }); });
  return { ...f, raw, state, originalStore, original, options, recorder, bridge, model, app, freezeSources, ingress, setTime: (seconds: number) => { now = Date.parse(f.f.at(seconds)); } };
}


function grant(f: ReturnType<typeof fixture>) {
  const value = {version: 1 as const, id:'synthetic-independent-copy',attemptDigest:identity(f.m),sourceDigest:retentionSourceDigest(f.plan),rawStoreDigest:identity(f.plan.rawStore),custodianId:'synthetic-custodian',purpose:'bounded synthetic retention checks',audiences:[`principal:${f.m.observerId}`,...f.roles.map(r=>`provider:${r.profile?.provider??'mistral'}`),...f.roles.filter(r=>r.kind==='reviewer').map(r=>`reviewer:${r.assignmentId}`)].filter((v,i,a)=>a.indexOf(v)===i),dataScope:'complete-operational-role-sources' as const,retention:'independent-indefinite' as const,withdrawal:'stop-use-retain-originals' as const};
  f.plan.retention=signDocument(evidenceRetentionDomain,value,'issuer',f.f.keys.get('issuer')!);
  f.trust.retention={acceptedGrantDigest:identity(value),issuers:f.f.trust.issuers,custodianSigner:'issuer',custodianKey:f.f.keys.get('issuer')!};
  const key='synthetic-custodian'; f.options.custodian={store:f.state,key};
  const write=(status:'active'|'withdrawn'|'destruction-pending')=>{const old=f.state.get('development.evidence-custodian',key);f.state.put('development.evidence-custodian',key,signDocument(evidenceCustodianDomain,{version:1,grantDigest:identity(value),attemptDigest:identity(f.m),custodianId:value.custodianId,status},'issuer',f.f.keys.get('issuer')!),old?.revision??null);};
  write('active'); f.accept(); f.options.document=f.sign(); return {value,write};
}

for (const policy of ['timed-destruction','deletion-on-forget','revocable'] as const) test(`JR2 unsupported ${policy} copy policy refuses before claim`,t=>{
  const f=fixture(t),g=grant(f),before=f.raw.usage(); const bad={...g.value,retention:policy};
  f.plan.retention=signDocument(evidenceRetentionDomain,bad,'issuer',f.f.keys.get('issuer')!) as unknown as typeof f.plan.retention; f.trust.retention!.acceptedGrantDigest=identity(bad); f.accept(); f.options.document=f.sign();
  assert.throws(f.recorder,/Unsupported evidence retention/); assert.equal(f.state.get('development.acquisition',f.plan.id),undefined); assert.deepEqual(f.raw.usage(),before);
});
for(const change of ['acceptance','source','audience','custodian'] as const) test(`JR2 ${change} retention authority cannot be invented by signed plan`,t=>{
  const f=fixture(t),g=grant(f),before=f.raw.usage();
  if(change==='acceptance') f.trust.retention=undefined;
  if(change==='source') f.plan.roles[0]!.workspace=join(f.plan.roles[0]!.workspace,'changed');
  if(change==='audience'){g.value.audiences=g.value.audiences.filter(s=>!s.startsWith('provider:'));f.plan.retention=signDocument(evidenceRetentionDomain,g.value,'issuer',f.f.keys.get('issuer')!); f.trust.retention!.acceptedGrantDigest=identity(g.value);}
  if(change==='custodian') g.write('withdrawn');
  f.accept();f.options.document=f.sign(); assert.throws(f.recorder,/retention|custodian/i);assert.equal(f.state.get('development.acquisition',f.plan.id),undefined);assert.deepEqual(f.raw.usage(),before);
});

test('JR2 complete v2 ref replay preserves available intermediate deletion and recreation',t=>{
  const f=fixture(t,true),r=f.recorder(); f.originalStore.put('ordinary','doc',{value:'first'},null);const first=r.captureApplication('candidate',f.app());
  f.originalStore.put('ordinary','doc',{value:'second'},1);f.originalStore.delete('ordinary','doc',2);f.originalStore.put('ordinary','doc',{value:'new incarnation'},null);
  const second=r.captureApplication('candidate',f.app()),snapshot=JSON.parse(r.readArtifact(second,300000).toString()).snapshot;
  const versions=snapshot.journalPayloads.filter((p:{ref:{namespace:string}})=>p.ref.namespace==='ordinary'); assert.equal(versions.length,3);assert.equal(new Set(versions.map((p:{ref:{versionId:string}})=>p.ref.versionId)).size,3);assert.notEqual(first.sha256,second.sha256);assert.equal(r.status().useDisposition,null);
});

test('JR2 actual source withdrawal retains structural bytes and raw originals, stops use after reopen',t=>{
  const f=fixture(t,true),r=f.recorder(); f.originalStore.put('ordinary','private-doc',{sentinel:'synthetic historical secret'},null);const original=r.captureApplication('candidate',f.app()),bytes=f.raw.readArtifact(original,300000),charged=f.original.snapshot(f.registration.rootId),count=r.status().inventory.length;
  f.originalStore.withdrawDocumentJournalContent({id:'actual-withdrawal',reason:'forget',targets:[{namespace:'ordinary',key:'private-doc',expectedRevision:1}]});
  assert.throws(()=>r.captureApplication('candidate',f.app()),/document-history-withdrawn/); const stopped=r.status();assert.equal(stopped.useDisposition!.value.status,'document-history-withdrawn');assert.ok(stopped.inventory.length>count); assert.ok(stopped.useDisposition!.value.source?.withdrawalCount);assert.deepEqual(f.raw.readArtifact(original,300000),bytes);assert.deepEqual(f.original.snapshot(f.registration.rootId),charged);
  const reopened=DevelopmentAcquisitionRecorder.reopen(f.options);assert.equal(reopened.status().useDisposition!.value.planDigest,stopped.planDigest);assert.throws(()=>reopened.readArtifact(original,300000),/document-history-withdrawn/);assert.throws(()=>reopened.begin(),/document-history-withdrawn/);assert.throws(f.recorder,/claimed/);
});

test('JR2 stale captured ref cannot bypass complete current restored-payload corruption',t=>{
  const f=fixture(t,true),r=f.recorder();f.originalStore.put('ordinary','private-doc',{sentinel:'synthetic secret'},null);const original=r.captureApplication('candidate',f.app()),snap=JSON.parse(f.raw.readArtifact(original,300000).toString()).snapshot;
  const saved=snap.journalPayloads.find((p:{ref:{namespace:string}})=>p.ref.namespace==='ordinary');
  f.originalStore.withdrawDocumentJournalContent({id:'actual-withdrawal',reason:'forget',targets:[{namespace:'ordinary',key:'private-doc',expectedRevision:1}]});
  const db=new DatabaseSync(f.originalStore.filename);try{db.prepare('UPDATE documents SET revision=1,value=? WHERE namespace=? AND key=?').run(canonicalJson(saved),'system.document-journal.payloads',saved.ref.versionId);}finally{db.close();}
  assert.throws(()=>r.readArtifact(original,300000),/disposition differs/);assert.equal(r.status().useDisposition!.value.status,'document-history-corrupt-or-missing');assert.deepEqual(f.raw.readArtifact(original,300000),Buffer.from(canonicalJson(JSON.parse(f.raw.readArtifact(original,300000).toString()))));
});

test('JR2 unrelated new suffix withdrawal does not erase historical B source scope',t=>{
  const f=fixture(t,true),r=f.recorder();f.originalStore.put('ordinary','old',{value:'available'},null);const original=r.captureApplication('candidate',f.app());
  f.originalStore.put('new-owner','later',{value:'outside prior capture'},null); f.originalStore.withdrawDocumentJournalContent({id:'suffix-withdrawal',reason:'expiry',targets:[{namespace:'new-owner',key:'later',expectedRevision:1}]});
  assert.ok(r.readArtifact(original,300000).length);assert.equal(r.status().useDisposition,null);
});

test('JR2 reopen requires actual pinned source attachment before evidence read',t=>{
  const f=fixture(t,true),r=f.recorder(),original=r.captureApplication('candidate',f.app()),reopened=DevelopmentAcquisitionRecorder.reopen(f.options);
  assert.throws(()=>reopened.readArtifact(original,300000),/handle must be attached/);reopened.attachApplication('candidate',f.app());assert.deepEqual(reopened.readArtifact(original,300000),f.raw.readArtifact(original,300000));
});

for(const destruction of [false,true]) test(`JR2 durable ${destruction?'destruction-pending':'withdrawn'} cannot be reset or purge originals`,t=>{
  const f=fixture(t),r=f.recorder(),entry=r.status().inventory[0]!,bytes=f.raw.readArtifact(entry.artifact,entry.bytes),before=f.raw.usage();const marker=r.withdrawAttemptUse('host-withdrawal',destruction);assert.equal(marker.value.status,destruction?'destruction-pending':'withdrawn');assert.deepEqual(r.withdrawAttemptUse('another-reason'),marker);
  assert.throws(()=>r.readArtifact(entry.artifact,entry.bytes),/withdrawn|destruction-pending/); assert.throws(()=>r.rawStoreForRole('no-memory').putBytes(Buffer.from('new work')),/withdrawn|destruction-pending/);
  assert.deepEqual(f.raw.usage(),before);assert.deepEqual(f.raw.readArtifact(entry.artifact,entry.bytes),bytes);assert.equal(DevelopmentAcquisitionRecorder.reopen(f.options).status().useDisposition!.value.inventoryDigest,marker.value.inventoryDigest);assert.throws(f.recorder,/claimed/);
});

test('JR2 independently signed current custodian status stops later use without changing copies',t=>{
  const f=fixture(t),g=grant(f),r=f.recorder(),entry=r.status().inventory[0]!,before=f.raw.usage();g.write('destruction-pending');assert.throws(()=>r.readArtifact(entry.artifact,entry.bytes),/destruction-pending/);assert.equal(r.status().useDisposition!.value.status,'destruction-pending');g.write('active');assert.throws(()=>r.readArtifact(entry.artifact,entry.bytes),/destruction-pending/);assert.deepEqual(f.raw.usage(),before);
});

test('JR2 dispatched response maintenance stays exact and settles after use withdrawal',t=>{
  const f=fixture(t),r=f.recorder();f.setTime(0);const x=f.bridge(r),q=f.model(x);x.a.resources.reserve(q);x.a.resources.dispatched({...q,status:'dispatched'});const physical=x.a.requestId(q.id),before=f.original.snapshot(f.registration.rootId);r.withdrawAttemptUse('stop-evidence-use');
  const body='{"model":"synthetic-model","synthetic":"late retained"}';x.a.recordResponse(q.id,{status:200,body});const entry=r.status().inventory.find(i=>i.pool==='response')!;assert.deepEqual(r.readRetainedResponse(physical,entry.artifact,1000),Buffer.from(body));assert.throws(()=>r.readArtifact(entry.artifact,1000),/withdrawn/);assert.throws(()=>r.readRetainedResponse(physical,r.status().inventory[0]!.artifact,1000),/scope/);assert.throws(()=>r.readRetainedResponse('foreign',entry.artifact,1000),/scope/);
  x.a.recordTransport({requestId:q.id,dispatched:true,status:'succeeded',httpStatus:200,usage:{requests:1,inputTokens:2,outputTokens:1,costUsd:0.000004,elapsedMs:1000},responseModel:'synthetic-model',responseDigest:entry.artifact.sha256});x.a.resources.settle({...q,status:'succeeded'});assert.equal(f.original.request(physical)!.status,'succeeded');assert.equal(f.original.snapshot(f.registration.rootId).requests,before.requests);
});

test('JR2 terminal owner marker fits worst escaped reason after optional raw metadata pressure',t=>{
  const f=fixture(t),r=f.recorder(),writer=r.rawStoreForRole('no-memory');let refused=false;for(let i=0;i<300;i++){try{writer.putBytes(Buffer.from(`distinct-${i}`));}catch{refused=true;break;}}assert.ok(refused);const marker=r.withdrawAttemptUse('\0'.repeat(128));assert.ok(Buffer.byteLength(canonicalJson(marker))<=r.capacity.dispositionOwnerBytes);assert.equal(marker.value.reasonCode,'\0'.repeat(128));assert.equal(r.status().pending,null);assert.throws(()=>r.begin(),/withdrawn/);
});

test('JR2 trusted current-use callback refuses a promise and closes source transactions',t=>{
  const f=fixture(t,true),r=f.recorder();r.captureApplication('candidate',f.app());assert.throws(()=>r.withCurrentUse(()=>Promise.resolve('not fenced')),/synchronous/);f.originalStore.put('ordinary','after',{value:'works'},null);r.assertCurrentUse();
});

test('JR2 actual DurableRuntime and EffectJournal keep nested reserve guards and late receipt maintenance',async t=>{
  const f=fixture(t),r=f.recorder();f.setTime(0);const sources=f.freezeSources(r);for(const [id,s]of sources)r.captureApplication(id,s.application,s.accounting);
  const x=sources.get('no-memory')!,a=x.accounting,store=x.application.store;let entries=0;const authority={generation:'synthetic',epoch:1,controlRevision:'synthetic'};
  const receiver=a.wrapReceiver({async dispatch(){entries++;r.assertCurrentUse();r.withdrawAttemptUse('during-actual-effect');return{outcome:'succeeded' as const,receipt:store.putJsonArtifact({synthetic:'late receipt'})};},async reconcile(){throw new Error('No retry');}});
  const effects=new EffectJournal(store,{assert(){}},receiver),runtime=new DurableRuntime({store,resources:a.resources,effects,shell:a.wrapShell({async run(input,bridge){const observation=await bridge.execute({id:'effect-entry',runId:input.run.id,stepId:'step',name:'fixture_read',arguments:{synthetic:true}});return{status:'completed' as const,observations:[observation]};}}),now:f.original.now});
  const run=runtime.admit({id:'synthetic-input',source:'direct',externalId:'input',externalRevision:'1',actorId:'synthetic-host',authenticated:true,scope:{kind:'public'},value:'Synthetic effect'},authority,a.role.resources,f.registration.rootId);const result=await runtime.resume(run.id,{id:'base',requestDigest:identity('base'),fragments:[]});
  assert.equal(result.status,'completed');assert.equal(entries,1);assert.equal(a.originalRequest('tool:effect-entry')!.status,'succeeded');assert.equal(r.status().useDisposition!.value.status,'withdrawn');assert.throws(()=>r.assertCurrentUse(),/withdrawn/);
});

test('JR2 actual DevelopmentalMemory forget erases operational values but preserves separately retained originals',t=>{
 const f=fixture(t,true),r=f.recorder(),memory=new DevelopmentalMemory(f.originalStore,()=>f.f.at(0));
 memory.ingest({id:'synthetic-memory',runId:'synthetic-run',sourceId:'synthetic-source',channel:'speech',actorId:'synthetic-actor',at:f.f.at(0),scope:{kind:'public'},content:'synthetic erasable sentinel'});
 const capture=r.captureApplication('candidate',f.app()),bytes=f.raw.readArtifact(capture,300000);memory.forget(['synthetic-memory'],{kind:'public'});
 assert.equal(memory.get('synthetic-memory',{kind:'public'}),undefined);assert.throws(()=>r.readArtifact(capture,300000),/document-history-withdrawn/);assert.equal(r.status().useDisposition!.value.status,'document-history-withdrawn');assert.ok(bytes.includes(Buffer.from('synthetic erasable sentinel')));assert.deepEqual(f.raw.readArtifact(capture,300000),bytes);
});

test('JR2 withdrawal after B prevents stale evidence read and final closure without resigning inventory',t=>{
 const f=fixture(t);f.plan.roles.find(r=>r.roleId==='no-memory')!.journal={stream:'synthetic-control-journal',hostId:'synthetic-control',maxAnchorDocuments:512,maxAnchorBytes:1000000};f.accept();f.options.document=f.sign();const r=f.recorder();f.setTime(0);r.begin();const sources=f.freezeSources(r),control=sources.get('no-memory')!.application.store;control.put('ordinary','before-B',{value:'synthetic retained original'},null);f.setTime(180);const bridge=sources.get('candidate')!.accounting,b=r.freezeBehavior(bridge,sources),old=identity(b),before=r.status().inventory;
 control.withdrawDocumentJournalContent({id:'after-B-withdrawal',reason:'forget',targets:[{namespace:'ordinary',key:'before-B',expectedRevision:1}]});
 assert.throws(()=>r.close(bridge,[]),/document-history-withdrawn/);assert.equal(identity(r.status().behavior),old);assert.equal(r.status().useDisposition!.value.behaviorDigest,identity(b.value));for(const entry of before)assert.equal(f.raw.readArtifact(entry.artifact,entry.bytes).byteLength,entry.bytes);assert.throws(()=>r.freezeBehavior(bridge,sources),/document-history-withdrawn/);
});

test('JR2 nested source rollback can stop use without retaining uncommitted withdrawal provenance',t=>{
 const f=fixture(t,true),r=f.recorder();f.originalStore.put('ordinary','version',{sentinel:'synthetic committed'},null);const original=r.captureApplication('candidate',f.app()),before=r.status().inventory.length;
 assert.throws(()=>f.originalStore.transaction(()=>{f.originalStore.withdrawDocumentJournalContent({id:'uncommitted-withdrawal',reason:'forget',targets:[{namespace:'ordinary',key:'version',expectedRevision:1}]});r.assertCurrentUse();}),/document-history-withdrawn/);
 const current=f.originalStore.captureDevelopmentSnapshot({maxRows:512,maxBytes:300000});assert.ok(current.journalPayloads.filter(p=>p.ref.namespace==='ordinary').every(p=>p.state==='available'));assert.equal(r.status().inventory.length,before);assert.equal(r.status().useDisposition!.value.source,null);assert.equal(r.status().useDisposition!.value.status,'document-history-withdrawn');assert.throws(()=>r.readArtifact(original,300000),/document-history-withdrawn/);assert.ok(f.raw.readArtifact(original,300000).length);
});

test('JR2 host withdrawal preserves an interrupted raw intent and original held request',t=>{
 const f=fixture(t),r=f.recorder();f.setTime(0);const x=f.bridge(r),q=f.model(x);x.a.resources.reserve(q);x.a.resources.dispatched({...q,status:'dispatched'});const write=f.raw.putBytes.bind(f.raw);f.raw.putBytes=()=>{throw new Error('synthetic disk unavailable');};assert.throws(()=>r.rawStoreForRole('no-memory').putBytes(Buffer.from('interrupted attempted bytes')),/disk unavailable/);f.raw.putBytes=write;const pending=r.status().pending,held=f.original.snapshot(f.registration.rootId);r.withdrawAttemptUse('\0'.repeat(128));assert.equal(identity(r.status().pending),identity(pending));assert.deepEqual(f.original.snapshot(f.registration.rootId),held);assert.equal(f.original.request(x.a.requestId(q.id))!.status,'dispatched');assert.throws(()=>r.retainResponse(x.a.requestId(q.id),Buffer.from('late')),/Incomplete prior raw retention/);assert.equal(r.status().useDisposition!.value.status,'withdrawn');
});

test('JR2 full source capture rejects actual outer transaction before owner or raw evidence changes',t=>{
 const f=fixture(t,true),r=f.recorder(),before=identity(r.status()),usage=f.raw.usage();assert.throws(()=>f.originalStore.transaction(()=>r.captureApplication('candidate',f.app())),/depth-zero/);assert.equal(identity(r.status()),before);assert.deepEqual(f.raw.usage(),usage);
});

test('JR2 reopened depth-zero withdrawal diagnostic retains committed structure without reviving evidence use',t=>{
 const f=fixture(t,true),r=f.recorder();f.originalStore.put('ordinary','version',{sentinel:'synthetic value'},null);r.captureApplication('candidate',f.app());f.originalStore.withdrawDocumentJournalContent({id:'committed-withdrawal',reason:'forget',targets:[{namespace:'ordinary',key:'version',expectedRevision:1}]});assert.throws(()=>r.assertCurrentUse(),/document-history-withdrawn/);const marker=identity(r.status().useDisposition),before=f.raw.usage();const reopened=DevelopmentAcquisitionRecorder.reopen(f.options);assert.throws(()=>f.originalStore.transaction(()=>reopened.captureWithdrawalDiagnostic('candidate',f.app())),/depth-zero/);assert.deepEqual(f.raw.usage(),before);const ref=reopened.captureWithdrawalDiagnostic('candidate',f.app()),raw=f.raw.readArtifact(ref,300000);assert.ok(raw.includes(Buffer.from('committed-withdrawal')));assert.equal(identity(reopened.status().useDisposition),marker);assert.throws(()=>reopened.readArtifact(ref,300000),/document-history-withdrawn/);assert.equal(reopened.status().phase,r.status().phase);
});
