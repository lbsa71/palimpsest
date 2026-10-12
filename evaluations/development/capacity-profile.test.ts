import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, identity, type ArtifactRef } from '../../packages/contracts/index.ts';
import { hashBytes } from '../../packages/release/artifacts.ts';
import { signDocument } from '../qualification/manifest.ts';
import { syntheticWitnessFixture } from './witness-fixture.ts';
import { collectDevelopmentEvidence, developmentCapacityLimits, developmentCapacityProfile, developmentOperationalArtifactBytes, domains, verifyDevelopmentAttempt, type DevelopmentAttempt, type DevelopmentAttemptV2 } from './witness.ts';
import { collectDevelopmentAccountingTail, collectDevelopmentBehavior, prepareDevelopmentReviewEnvelope, reviewEnvelopeDomains as d, type DevelopmentAccountingTransition, type DevelopmentEnvelopeTrust, type DevelopmentRegistration, type DevelopmentReviewEnvelope, type DevelopmentRoleBinding } from './review-envelope.ts';

/** Fresh synthetic, zero-physical-request capacity fixture: no claim of protocol competence. */
function fixture(limits: DevelopmentAttempt['limits'] = { ...developmentCapacityLimits }) {
  const f = syntheticWitnessFixture();
  const m: DevelopmentAttemptV2 = { ...structuredClone(f.m), version: 2, capacityProfile: developmentCapacityProfile, limits };
  m.grant.originalAccounting = { grantId: m.grant.id, usage: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 5000 }, chargedTokens: 0, chargedCostUsd: 0, chargedElapsedMs: 0, requestIds: [], unknownRequestIds: [] };
  const observations = f.observations.filter(o => !['request', 'intervention'].includes(o.data.kind));
  const refresh = () => {
    f.trust.acceptedAttemptDigest = identity(m); observations.forEach(o => o.attemptDigest = identity(m));
    const end = observations.find(o => o.data.kind === 'end')!; assert(end.data.kind === 'end');
    end.data.accounting = { ...structuredClone(m.grant.originalAccounting), usage: { ...m.grant.originalAccounting.usage, elapsedMs: 185000 } };
  };
  refresh();
  const manifest = () => signDocument<DevelopmentAttempt>(domains.attempt, m, 'issuer', f.keys.get('issuer')!);
  const records = () => observations.map(o => signDocument(domains.observation, o, 'observer', f.keys.get('observer')!));
  const model = JSON.parse(Buffer.from(f.reader(m.configurationArtifact, 10000)).toString('utf8')).model;
  const candidate: DevelopmentRoleBinding = { id: 'candidate', kind: 'candidate', assignmentId: null, allocationId: 'candidate-allocation', configurationDigest: m.candidate.configuration, closureDigest: identity('capacity candidate'), profile: model, allowedEffects: [], resources: m.grant.resources };
  const roles = [candidate, ...m.controls.map(c => ({ ...candidate, id: `control:${c.id}`, kind: 'control' as const, assignmentId: c.id, allocationId: `allocation:${c.id}` })), ...m.reviewers.map(r => ({ ...candidate, id: `reviewer:${r.id}`, kind: 'reviewer' as const, assignmentId: r.id, allocationId: `allocation:${r.id}` }))];
  const r: DevelopmentRegistration = { version: 2, attemptDigest: identity(m), rootId: 'capacity-root', rootCancelled: false, registeredAt: m.registeredAt, reviewDeadlineAt: f.at(250), observerClosureDigest: f.trust.observer.artifactDigest, closureVerifierDigest: identity('capacity closure'), assignmentDigest: identity('capacity assignments'), roles, originalRequests: [] };
  const trust: DevelopmentEnvelopeTrust = { acceptedRegistrationDigest: identity(r), behavior: f.trust, acceptedRoles: new Map(roles.map(role => [role.id, identity(role)])), closure: { id: 'closure', key: Buffer.alloc(32, 22), verifierDigest: r.closureVerifierDigest }, transports: new Map() };
  const registration = () => { r.attemptDigest = identity(m); trust.acceptedRegistrationDigest = identity(r); return signDocument(d.registration, r, 'issuer', f.keys.get('issuer')!); };
  const behavior = (retained: ArtifactRef[] = [], reader = f.reader) => collectDevelopmentBehavior(registration(), manifest(), records(), [], [], f.at(180), trust, reader, f.now, retained);
  const putRaw = (bytes: Uint8Array): ArtifactRef => { const sha256 = hashBytes(bytes); f.artifacts.set(sha256, bytes); return { uri: `sha256:${sha256}`, sha256 }; };
  const envelope = (retained: ArtifactRef[] = []): DevelopmentReviewEnvelope => {
    const b = behavior(retained), tail = collectDevelopmentAccountingTail(identity(r), b, [], [], [], f.reader, m.limits);
    return { version: 2, registration: registration(), behavior: signDocument(d.behavior, b, 'observer', f.keys.get('observer')!), reviews: [], accountingTail: signDocument(d.tail, tail, 'observer', f.keys.get('observer')!), closure: null };
  };
  return { ...f, m, observations, refresh, manifest, records, r, trust, registration, behavior, putRaw, envelope };
}

test('signed v2 opts into finite maxima while old exact schema rejects profile attachment and raised ceilings', () => {
  const g = fixture(); assert.deepEqual(verifyDevelopmentAttempt(g.manifest(), g.trust.behavior), g.m);
  assert(Object.isFrozen(developmentCapacityLimits)); assert.equal(developmentOperationalArtifactBytes, 1000000);
  const f = syntheticWitnessFixture();
  assert.equal(verifyDevelopmentAttempt(f.manifest(), f.trust).version, 1);
  Object.assign(f.m, { capacityProfile: developmentCapacityProfile }); f.trust.acceptedAttemptDigest = identity(f.m);
  assert.throws(() => verifyDevelopmentAttempt(f.manifest(), f.trust), /Exact fields/);
  delete (f.m as unknown as Record<string, unknown>).capacityProfile;
  for (const [key, excess] of [['maxRecords', 513], ['maxArtifactBytes', 1000001], ['maxEvidenceBytes', 8388609]] as const) {
    const old = f.m.limits[key]; f.m.limits[key] = excess; f.trust.acceptedAttemptDigest = identity(f.m);
    assert.throws(() => verifyDevelopmentAttempt(f.manifest(), f.trust), /host ceiling/); f.m.limits[key] = old;
  }
});

test('unknown, missing, extra, over-ceiling and downgraded v2 profiles fail before any reader', () => {
  for (const change of [
    (m: Record<string, unknown>) => m.capacityProfile = 'future',
    (m: Record<string, unknown>) => delete m.capacityProfile,
    (m: Record<string, unknown>) => m.extra = true,
    (m: Record<string, unknown>) => m.version = 1,
    ...(['maxRecords', 'maxArtifactBytes', 'maxEvidenceBytes'] as const).map(key => (m: Record<string, unknown>) => (m.limits as DevelopmentAttempt['limits'])[key] = developmentCapacityLimits[key] + 1),
  ]) {
    const g = fixture(); change(g.m as unknown as Record<string, unknown>); g.refresh(); let reads = 0;
    assert.throws(() => collectDevelopmentEvidence(g.manifest(), g.records(), g.trust.behavior, () => { reads++; throw new Error('read'); }, g.now));
    assert.equal(reads, 0);
  }
});

test('envelope registration authenticates the actual signed attempt before applying larger limits or reading', () => {
  const g = fixture(), manifest = g.manifest(); manifest.signature = '0'.repeat(64); let reads = 0;
  assert.throws(() => collectDevelopmentBehavior(g.registration(), manifest, g.records(), [], [], g.at(180), g.trust, () => { reads++; throw new Error('read'); }, g.now), /signature/);
  assert.equal(reads, 0);
});

test('larger retained metadata is accepted, debited, and never expands the witness operational bound', () => {
  const g = fixture(), large = g.putRaw(Buffer.alloc(1000001, 7)), seen: { sha: string; bound: number }[] = [];
  const b = g.behavior([large], (ref, bound) => { seen.push({ sha: ref.sha256, bound }); return g.reader(ref, bound); });
  assert.equal(b.artifactIndex.find(e => e.artifact.sha256 === large.sha256)?.bytes, 1000001);
  assert.equal(seen.find(e => e.sha === large.sha256)?.bound, developmentCapacityLimits.maxArtifactBytes);
  const bounds: number[] = [];
  collectDevelopmentEvidence(g.manifest(), g.records(), g.trust.behavior, (ref, bound) => { bounds.push(bound); return g.reader(ref, bound); }, g.now);
  assert(bounds.length > 0 && bounds.every(bound => bound <= 1000000));
  const target = g.observations.find(o => o.data.kind === 'opportunity')!; target.artifact = large;
  const failed = collectDevelopmentEvidence(g.manifest(), g.records(), g.trust.behavior, (ref, bound) => { if (ref.sha256 === large.sha256) assert.equal(bound, 1000000); return g.reader(ref, bound); }, g.now);
  assert(failed.findings.some(f => f.detail.includes('read bound')));
});

test('tail rejects cached metadata reused as physical payload, prompt, or settlement response', () => {
  for (const field of ['payload', 'prompt', 'response'] as const) {
    const g = fixture(), large = g.putRaw(Buffer.alloc(1000001, 4)), b = g.behavior([large]);
    const transition = { beforeDigest: null, state: { payload: field === 'payload' ? large : g.m.configurationArtifact, prompt: field === 'prompt' ? large : null }, settlement: field === 'response' ? { value: { response: large } } : null } as unknown as DevelopmentAccountingTransition;
    assert.throws(() => collectDevelopmentAccountingTail(identity(g.r), b, [transition], [], [], g.reader, g.m.limits), /Cached artifact exceeds caller bound/);
  }
});

test('tail binds exact original signed limits and rejects unsupported embedded profile before reads', () => {
  const g = fixture(), b = g.behavior(); let reads = 0;
  const reader = () => { reads++; throw new Error('read'); };
  assert.throws(() => collectDevelopmentAccountingTail(identity(g.r), b, [], [], [], reader, { ...g.m.limits, maxRecords: g.m.limits.maxRecords - 1 }), /changed original evidence allowance/);
  Object.assign(b.manifest.value, { capacityProfile: 'future' });
  assert.throws(() => collectDevelopmentAccountingTail(identity(g.r), b, [], [], [], reader, g.m.limits), /profile/);
  assert.equal(reads, 0);
});

test('actual T metadata serialization cannot exceed its original signed singleton or record limit', () => {
  const g = fixture(), size = Buffer.byteLength(canonicalJson(g.behavior()));
  g.m.limits.maxArtifactBytes = size + 1000; g.refresh();
  const b = g.behavior(), additional = Array.from({ length: 2048 }, (_, i) => g.putRaw(Buffer.from(`retained-tail-${i}`)));
  assert.throws(() => collectDevelopmentAccountingTail(identity(g.r), b, [], [], additional, g.reader, g.m.limits), /Tail metadata artifact allowance/);
  g.m.limits.maxArtifactBytes = developmentCapacityLimits.maxArtifactBytes;
  const count = b.observations.length + b.artifactIndex.length;
  g.m.limits.maxRecords = count; g.refresh();
  const bounded = g.behavior();
  assert.throws(() => collectDevelopmentAccountingTail(identity(g.r), bounded, [], [], additional.slice(0, 1), g.reader, g.m.limits), /Joined bounded record allowance/);
});

test('generic metadata reads receive the smaller exact signed ceiling before an owned copy', () => {
  const g = fixture({ maxRecords: 32768, maxArtifactBytes: 1200000, maxEvidenceBytes: 1073741824 }), large = g.putRaw(Buffer.alloc(1200001));
  let observed = 0;
  assert.throws(() => g.behavior([large], (ref, bound) => {
    if (ref.sha256 === large.sha256) { observed++; assert.equal(bound, 1200000); }
    return g.reader(ref, bound);
  }), /read bound/);
  assert.equal(observed, 1);
});

test('v2 B and final metadata singleton ceilings remain signed and aggregate copies stay charged', () => {
  const g = fixture(), b = g.behavior();
  const size = Buffer.byteLength(canonicalJson(b));
  g.m.limits.maxArtifactBytes = size - 1000; g.refresh();
  assert.throws(() => g.behavior(), /Behavior metadata artifact allowance/);
  g.m.limits.maxArtifactBytes = size + 500; g.refresh();
  const envelope = g.envelope();
  const final = prepareDevelopmentReviewEnvelope(envelope, g.trust, g.reader, g.now);
  assert(final.findings.some(f => f.detail.includes('Final envelope metadata artifact allowance')));
  const h = fixture(), original = h.envelope(), overhead = Buffer.byteLength(canonicalJson(original));
  const raw = original.behavior.value.artifactIndex.reduce((sum, entry) => sum + entry.bytes, 0);
  h.m.limits.maxArtifactBytes = overhead + 100; h.m.limits.maxEvidenceBytes = overhead + raw - 100; h.refresh();
  const smaller = h.envelope();
  let refusedRemainingBound = false;
  const result = prepareDevelopmentReviewEnvelope(smaller, h.trust, (ref, bound) => {
    if (h.artifacts.get(ref.sha256)!.byteLength > bound) refusedRemainingBound = true;
    return h.reader(ref, bound);
  }, h.now);
  assert(Buffer.byteLength(canonicalJson(smaller)) + smaller.behavior.value.artifactIndex.reduce((sum, entry) => sum + entry.bytes, 0) > h.m.limits.maxEvidenceBytes);
  assert.equal(refusedRemainingBound, true); assert.equal(result.status, 'failed');
});

test('a violating reader cannot force an oversized operational snapshot copy', t => {
  const g = fixture(), oversized = Buffer.alloc(1000001), from = Uint8Array.from; let copies = 0;
  t.mock.method(Uint8Array, 'from', ((...args: Parameters<typeof Uint8Array.from>) => { copies++; return from(...args); }) as typeof Uint8Array.from);
  const evidence = collectDevelopmentEvidence(g.manifest(), g.records(), g.trust.behavior, (_ref, bound) => { assert(bound <= 1000000); return oversized; }, g.now);
  assert(evidence.findings.some(f => f.detail.includes('Reader exceeded artifact allowance'))); assert.equal(copies, 0);
});

test('all index records consume the original signed v2 allowance', () => {
  const g = fixture(), b = g.behavior(), count = b.observations.length + b.artifactIndex.length;
  g.m.limits.maxRecords = count; g.refresh();
  const extra = g.putRaw(Buffer.from('additional retained metadata'));
  assert.throws(() => g.behavior([extra]), /record allowance/);
});
