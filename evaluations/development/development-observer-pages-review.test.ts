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
function recorderFixture(t:TestContext) { return pagedRecorderFixture(t, true); }


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
