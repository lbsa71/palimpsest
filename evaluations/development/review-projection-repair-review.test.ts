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


test('independent P1 callback mutations cannot rewrite checked bounds, index length, selector or cursor',()=>{
  const g=fixture(),source=Buffer.from('prefix😀negative'),a=g.put(source),args={version:1 as const,behaviorDigest:identity(g.b),selector:{kind:'original' as const,artifact:{...a}},cursor:{index:0,offset:0}},bounds={maxReceiptBytes:2048,remainingReadBytes:2048+source.length},initial=structuredClone(args);
  const result=projectDevelopmentReviewRead(g.b,args,(passed,n)=>{assert.deepEqual(passed,a);assert.equal(n,source.length);passed.uri='sha256:'+'0'.repeat(64);passed.sha256='0'.repeat(64);args.cursor.offset=6;args.selector.artifact.sha256='1'.repeat(64);bounds.remainingReadBytes=0;bounds.maxReceiptBytes=0;g.b.artifactIndex[0]!.bytes=0;g.b.manifest.value.limits.maxArtifactBytes=1;return source;},bounds);
  const receipt=JSON.parse(Buffer.from(result.bytes).toString());assert.deepEqual(receipt.selector,initial.selector);assert.deepEqual(receipt.cursor,initial.cursor);assert.equal(receipt.behaviorDigest,initial.behaviorDigest);assert.equal(receipt.records[0].content,source.toString());assert.equal(receipt.records[0].bytes,source.length);assert.equal(result.debitBytes,source.length+result.bytes.length);
});

test('independent P1 cannot authorize callback over-return by increasing index and limits',()=>{
  const g=fixture(),source=Buffer.from('ok'),a=g.put(source),args={version:1 as const,behaviorDigest:identity(g.b),selector:{kind:'original' as const,artifact:{...a}},cursor:{index:0,offset:0}},bounds={maxReceiptBytes:2048,remainingReadBytes:2050};
  assert.throws(()=>projectDevelopmentReviewRead(g.b,args,()=>{g.b.artifactIndex[0]!.bytes=100;bounds.remainingReadBytes=100000;return Buffer.alloc(100);},bounds),/indexed length\/digest/);
});
