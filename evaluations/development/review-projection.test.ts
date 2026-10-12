import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, identity, type ArtifactRef } from '../../packages/contracts/index.ts';
import { hashBytes } from '../../packages/release/artifacts.ts';
import { signDocument } from '../qualification/manifest.ts';
import { syntheticWitnessFixture } from './witness-fixture.ts';
import { collectDevelopmentEvidence, developmentCapacityProfile } from './witness.ts';
import { developmentReviewInput, type DevelopmentBehavior } from './review-envelope.ts';
import { boundedDevelopmentReviewInput, developmentReviewCollections, projectDevelopmentReviewRead, type BoundedReadReceipt, type ReviewCursor, type ReviewSelector } from './review-projection.ts';

function fixture() {
  const f = syntheticWitnessFixture(); Object.assign(f.m, { version: 2, capacityProfile: developmentCapacityProfile });
  f.m.limits = { maxRecords: 32768, maxArtifactBytes: 4_000_000, maxEvidenceBytes: 8_000_000 }; f.trust.acceptedAttemptDigest = identity(f.m); f.observations.forEach(o => o.attemptDigest = identity(f.m));
  const b: DevelopmentBehavior = { version: 2, registrationDigest: identity('registration'), frozenAt: f.at(180), manifest: f.manifest(), observations: f.records(), requests: [], transitions: [], rootCancelled: false, evidence: collectDevelopmentEvidence(f.manifest(), f.records(), f.trust, f.reader, f.now), artifactIndex: [] };
  const put = (bytes: Uint8Array): ArtifactRef => { const sha256 = hashBytes(bytes); f.artifacts.set(sha256, bytes); const artifact = { uri: `sha256:${sha256}`, sha256 }; b.artifactIndex.push({ artifact, bytes: bytes.byteLength }); b.artifactIndex.sort((a,c) => a.artifact.sha256.localeCompare(c.artifact.sha256)); return artifact; };
  const read = (selector: ReviewSelector, cursor: ReviewCursor = { index: 0, offset: 0 }, remainingReadBytes = 2_000_000, reader = f.reader) => projectDevelopmentReviewRead(b, { version: 1, behaviorDigest: identity(b), selector, cursor }, reader, { maxReceiptBytes: 2048, remainingReadBytes });
  const all = (selector: ReviewSelector) => {
    let cursor: ReviewCursor | null = { index: 0, offset: 0 }; const records = new Map<number, Buffer[]>(), pages: BoundedReadReceipt[] = [];
    while (cursor) { const result = read(selector, cursor); assert(result.bytes.length <= 2048); assert.equal(hashBytes(result.bytes), result.artifact.sha256); const page: BoundedReadReceipt = JSON.parse(Buffer.from(result.bytes).toString()); pages.push(page); assert.equal(canonicalJson(page), Buffer.from(result.bytes).toString());
      for (const r of page.records) { const fragments = records.get(r.index) ?? []; assert.equal(fragments.reduce((n,v) => n+v.length,0), r.offset); const fragment = Buffer.from(r.content, r.encoding === 'base64' ? 'base64' : 'utf8'); fragments.push(fragment); records.set(r.index, fragments); if (!page.next || page.next.index > r.index) assert.equal(Buffer.concat(fragments).length, r.bytes); }
      assert.notDeepEqual(page.next, cursor); cursor = page.next;
    }
    return { records: [...records.values()].map(v => Buffer.concat(v)), pages };
  };
  return { f, b, put, read, all };
}

test('compact exact input counts all fixed collections and retains byte-identical v1 packet', () => {
  const g = fixture(), b = g.b; const compact = boundedDevelopmentReviewInput(b, 'reviewer');
  assert.equal(Buffer.byteLength(canonicalJson(compact)) < 2048, true); assert.equal('behavior' in compact, false); assert.equal('artifact' in compact, false);
  assert.deepEqual(compact.collections.map(v => v.name), [...developmentReviewCollections]); assert.equal(compact.collections.find(v => v.name === 'observations')!.records, b.observations.length);
  assert.deepEqual(developmentReviewInput(b, 'reviewer'), compact);
  Object.assign(b.manifest.value, { version: 1 }); delete (b.manifest.value as unknown as {capacityProfile?: string}).capacityProfile;
  assert.equal(canonicalJson(developmentReviewInput(b, 'reviewer')), canonicalJson({ version: 2, registrationDigest: b.registrationDigest, behaviorDigest: identity(b), roleId: 'reviewer', behavior: b }));
});

test('every B field is reconstructible including duplicate evidence, failures, uncertainty and escaped fragments', () => {
  const g = fixture(), b = g.b;
  b.evidence.finalAccounting = null; b.evidence.findings.push({ code: 'negative', status: 'failed', detail: '"\u0000😀\ud800\\'.repeat(500) }, { code: 'missing', status: 'unavailable', detail: 'Absent evidence' });
  const views = Object.fromEntries(developmentReviewCollections.map(name => [name, g.all({ kind: 'collection', name }).records.map(v => JSON.parse(v.toString()))]));
  const values = (name: string) => views[name]!.map(v => v.value);
  const reconstructed = { ...values('behaviorHeader')[0], manifest: values('manifest')[0], observations: values('observations'), requests: values('requests'), transitions: values('transitions'), evidence: { ...values('evidenceHeader')[0], manifest: values('evidenceManifest')[0], observations: values('evidenceObservations'), artifacts: values('evidenceArtifacts'), findings: values('findings') }, artifactIndex: values('artifactIndex') };
  assert.equal(canonicalJson(reconstructed), canonicalJson(b)); assert(views.findings!.some(v => v.value.code === 'negative')); assert.equal(values('evidenceHeader')[0].finalAccounting, null);
});

test('multi-MiB B has constant initial packet and late exact case membership excludes global negatives', () => {
  const g = fixture(); const target = g.b.manifest.value.opportunities.at(-1)!;
  g.b.evidence.findings.push({ status: 'failed', code: 'global', detail: 'x'.repeat(2_100_000) });
  const input = boundedDevelopmentReviewInput(g.b, 'reviewer'); assert(Buffer.byteLength(canonicalJson(g.b)) > 2_000_000); assert(Buffer.byteLength(canonicalJson(input)) < 2048);
  const records = g.all({ kind: 'case', caseKind: 'opportunity', id: target.id }).records.map(v => JSON.parse(v.toString()));
  assert.equal(canonicalJson(records[0].value), canonicalJson(target)); assert.equal(records[1].value.value.data.result, 'failed'); assert.equal(records.length, 2);
  assert.equal(g.all({ kind: 'observation', id: records[1].value.value.id }).records.length, 1);
  const transfer = g.all({ kind: 'case', caseKind: 'opportunity', id: 'transfer-0' }).records.map(v => JSON.parse(v.toString()));
  assert.deepEqual(transfer.slice(1).map(v => v.value.value.data.kind), ['learning','experience','experience','experience','opportunity']);
});

for (const [name, bytes] of [['unicode', Buffer.from('\ufeff😀漢é\u0000"\\'.repeat(700))], ['binary', Buffer.from(Array.from({length:5000}, (_,i)=>i%256))], ['empty', Buffer.alloc(0)]] as const) test(`lossless ${name} original pages and repeated actual source I/O debit`, () => {
  const g = fixture(), artifact = g.put(bytes); let calls = 0; const reader = (ref: ArtifactRef, bound: number) => { calls++; assert.equal(bound, Math.max(1,bytes.length)); return g.f.reader(ref,bound); };
  const result = g.read({ kind:'original', artifact }, undefined, 2_000_000, reader), first: BoundedReadReceipt = JSON.parse(Buffer.from(result.bytes).toString());
  assert.equal(result.debitBytes, bytes.length + result.bytes.length); g.read({kind:'original',artifact}, undefined, 2_000_000, reader); assert.equal(calls,2);
  assert.deepEqual(g.all({kind:'original',artifact}).records, [bytes]); assert.equal(first.records[0]!.encoding, name === 'binary' ? 'base64' : 'utf8');
});

test('cursor and schema refusals happen before original reader entry', () => {
  const g = fixture(), artifact = g.put(Buffer.from('😀tail')); let calls = 0; const reader = () => { calls++; return Buffer.from('😀tail'); };
  for (const cursor of [{index:1,offset:0},{index:0,offset:8},{index:Number.MAX_SAFE_INTEGER+1,offset:0}]) assert.throws(()=>g.read({kind:'original',artifact},cursor,2_000_000,reader));
  assert.throws(()=>g.read({kind:'original',artifact:{...artifact,uri:`aeon:artifact:${artifact.sha256}`}},undefined,2_000_000,reader),/membership/);
  assert.throws(()=>g.read({kind:'original',artifact},undefined,2048+7,reader),/budget/); assert.equal(calls,0);
  assert.throws(()=>g.read({kind:'original',artifact},{index:0,offset:1},2_000_000,reader),/code point/); assert.equal(calls,1);
  assert.throws(()=>g.read({kind:'collection',name:'requests'},{index:0,offset:1}),/Terminal/);
  assert.throws(()=>g.read({kind:'collection',name:'observations'},{index:g.b.observations.length,offset:0}),/Terminal/);
  assert.throws(()=>g.read({kind:'observation',id:'absent'}),/Missing/);
  g.b.observations.push(g.b.observations[0]!); assert.throws(()=>g.read({kind:'observation',id:g.b.observations[0]!.value.id}),/duplicate/);
});

test('one-million singleton admission is independent of larger signed metadata ceiling and reader cache', () => {
  const g = fixture(), artifact = g.put(Buffer.alloc(1_000_000,65)); let calls = 0;
  const reader = (ref:ArtifactRef,bound:number) => { calls++; assert.equal(bound,1_000_000); return g.f.reader(ref,bound); };
  g.read({kind:'original',artifact},undefined,1_002_048,reader); assert.equal(calls,1);
  g.b.artifactIndex.find(v=>v.artifact.sha256===artifact.sha256)!.bytes=1_000_001;
  assert.throws(()=>g.read({kind:'original',artifact},undefined,2_000_000,reader),/singleton/); assert.equal(calls,1);
  assert.throws(()=>boundedDevelopmentReviewInput(g.b,'reviewer'),/singleton/);
});

test('tampered source, foreign B, extra selector fields and unknown profiles refuse', () => {
  const g = fixture(), artifact=g.put(Buffer.from('actual'));
  assert.throws(()=>g.read({kind:'original',artifact},undefined,2_000_000,()=>Buffer.from('forged')),/digest/);
  assert.throws(()=>projectDevelopmentReviewRead(g.b,{version:1,behaviorDigest:identity('other'),selector:{kind:'collection',name:'findings'},cursor:{index:0,offset:0}},g.f.reader,{maxReceiptBytes:2048,remainingReadBytes:2048}),/immutable B/);
  assert.throws(()=>g.read({kind:'collection',name:'findings',extra:true} as ReviewSelector),/Exact/);
  Object.assign(g.b.manifest.value,{capacityProfile:'unknown'}); assert.throws(()=>developmentReviewInput(g.b,'reviewer'),/profile/);
});

test('request selector enumerates only its exact physical state and complete ordered transition history',()=>{
  const g=fixture(), observation=g.f.observations.find(v=>v.data.kind==='request')!; assert(observation.data.kind==='request'); const d=observation.data;
  const state={rootId:'root',roleId:'candidate',configurationDigest:observation.configurationDigest,closureDigest:identity('closure'),allocationPath:['root','candidate',d.request.runId],observedAt:observation.observedAt,request:d.request,ceiling:d.ceiling,charged:d.charged,payload:d.payload,prompt:d.prompt};
  g.b.requests=[state];g.b.transitions=[{beforeDigest:null,state,settlement:null},{beforeDigest:identity(state),state,settlement:null}];
  const result=g.all({kind:'request',id:state.request.id}).records.map(v=>JSON.parse(v.toString()));
  assert.deepEqual(result.map(v=>v.source),['requests/0','transitions/0','transitions/1']);assert.equal(canonicalJson(result[0].value),canonicalJson(state));
  g.b.requests.push(state);assert.throws(()=>g.read({kind:'request',id:state.request.id}),/duplicate/);
});

test('empty collection, mixed complete records and largest fitting fragment use exact exhaustion and continuation',()=>{
  const g=fixture(); const empty:BoundedReadReceipt=JSON.parse(Buffer.from(g.read({kind:'collection',name:'requests'}).bytes).toString()); assert.deepEqual(empty.records,[]);assert.equal(empty.next,null);
  g.b.evidence.findings=[{code:'a',status:'failed',detail:'negative'},{code:'b',status:'unavailable',detail:'"'.repeat(3000)},{code:'c',status:'failed',detail:'last'}];
  const page:BoundedReadReceipt=JSON.parse(Buffer.from(g.read({kind:'collection',name:'findings'}).bytes).toString());assert.deepEqual(page.records.map(v=>v.index),[0,1]);assert.equal(page.next!.index,1);assert(page.next!.offset>0);
  const all=g.all({kind:'collection',name:'findings'});assert.equal(all.records.length,3);assert.equal(all.pages.at(-1)!.next,null);assert.equal(JSON.parse(all.records[2]!.toString()).value.detail,'last');
  const first=page.records[1]!, source=Buffer.from(canonicalJson({source:'evidence/findings/1',value:g.b.evidence.findings[1]})), consumed=Buffer.byteLength(first.content);
  const extended=structuredClone(page);extended.records[1]!.content=source.subarray(0,consumed+1).toString();extended.next!.offset=consumed+1;assert(Buffer.byteLength(canonicalJson(extended))>2048);
});
