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

// Fixture scaffolding reuses the author's zero-request setup; predicates below are independent.
test('review: accepted digest cannot authorize a freshly signed different finite allowance', () => {
  const g = fixture(), original = g.manifest();
  g.m.limits.maxArtifactBytes--; const altered = g.manifest(); let reads = 0;
  assert.throws(() => collectDevelopmentBehavior(g.registration(), altered, g.records(), [], [], g.at(180), g.trust, () => { reads++; throw Error('reader entered'); }, g.now), /accepted|changed/i);
  assert.equal(reads, 0); assert.notEqual(original.signature, altered.signature);
});

test('review: metadata aliases debit one unique raw object while preserving canonical index', () => {
  const g = fixture(), ref = g.putRaw(Buffer.alloc(1000001, 9)); let reads = 0;
  const b = g.behavior([ref, { ...ref, uri: `aeon:artifact:${ref.sha256}` }, ref], (r, bound) => { if (r.sha256 === ref.sha256) reads++; return g.reader(r, bound); });
  assert.equal(reads, 1);
  assert.deepEqual(b.artifactIndex.filter(e => e.artifact.sha256 === ref.sha256), [{ artifact: ref, bytes: 1000001 }]);
});

for (const site of ['observation', 'feedback', 'before-state', 'candidate'] as const) test(`review: ${site} operational failure never re-enters reader with metadata allowance`, t => {
  const g = fixture(), ref = g.putRaw(Buffer.alloc(1000001, 3)), supplied: number[] = [];
  if (site === 'candidate') { g.m.candidateArtifact = ref; g.refresh(); }
  else if (site === 'before-state') {
    const o = g.observations.find(o => o.data.kind === 'boundary')!; assert(o.data.kind === 'boundary'); o.data.beforeState = ref;
  } else {
    const o = g.observations.find(o => o.data.kind === 'opportunity')!; assert(o.data.kind === 'opportunity');
    if (site === 'feedback') o.data.feedback = ref; else o.artifact = ref;
  }
  let b: ReturnType<typeof g.behavior> | undefined;
  try { b = g.behavior([], (r, bound) => { if (r.sha256 === ref.sha256) supplied.push(bound); return g.reader(r, bound); }); }
  catch (error) { assert.match(String(error), /read bound|artifact allowance|operational/i, 'collector refusal must identify the operational bound'); }
  if (b) {
    assert(b.evidence.findings.some(f => f.status === 'failed' && f.detail.includes('read bound')), 'the original operational rejection remains a failure');
    t.diagnostic(JSON.stringify({ site, suppliedBounds: supplied, retainedBytes: b.artifactIndex.find(e => e.artifact.sha256 === ref.sha256)?.bytes ?? 0 }));
  }
  assert(supplied.length > 0); assert(supplied.every(bound => bound <= 1000000), `operational reader bounds were ${supplied}`);
});

test('review: nested prompt fragment cannot acquire the cached metadata allowance through another URI', () => {
  const g = fixture(), large = g.putRaw(Buffer.alloc(1000001, 5)), b = g.behavior([large]);
  const prompt = g.putRaw(Buffer.from(canonicalJson({ manifest: { fragments: [{ artifact: { ...large, uri: `aeon:artifact:${large.sha256}` } }] } })));
  const transition = { beforeDigest: null, state: { payload: g.m.configurationArtifact, prompt }, settlement: null } as unknown as DevelopmentAccountingTransition;
  const supplied: number[] = [];
  assert.throws(() => collectDevelopmentAccountingTail(identity(g.r), b, [transition], [], [], (ref, bound) => {
    if (ref.sha256 === large.sha256) supplied.push(bound);
    return g.reader(ref, bound);
  }, g.m.limits), /read bound/);
  assert.deepEqual(supplied, [developmentOperationalArtifactBytes]);
});

for (const site of ['transition-payload', 'review-input'] as const) test(`review: tail classifies known ${site} before generic B inventory reads`, t => {
  const g = fixture(), large = g.putRaw(Buffer.alloc(1000001, 6)), b = g.behavior([large]), supplied: number[] = [];
  const alias = { ...large, uri: `aeon:artifact:${large.sha256}` };
  const transitions = site === 'transition-payload' ? [{ beforeDigest: null, state: { payload: alias, prompt: null }, settlement: null } as unknown as DevelopmentAccountingTransition] : [];
  const reviews = (site === 'review-input' ? [{ value: { execution: { value: { input: alias } } } }] : []) as unknown as Parameters<typeof collectDevelopmentAccountingTail>[3];
  assert.throws(() => collectDevelopmentAccountingTail(identity(g.r), b, transitions, reviews, [], (r, bound) => {
    if (r.sha256 === large.sha256) supplied.push(bound); return g.reader(r, bound);
  }, g.m.limits), /caller bound|read bound/);
  t.diagnostic(JSON.stringify({ site, suppliedBounds: supplied }));
  assert(supplied.every(bound => bound <= 1000000), `known operational tail reader bounds were ${supplied}`);
});

test('review: exact B aggregate includes canonical metadata and unique raw bytes, with no alias credit', () => {
  const g = fixture(), extra = g.putRaw(Buffer.alloc(2000, 17));
  g.m.limits.maxArtifactBytes = 200000; g.m.limits.maxEvidenceBytes = 500000; g.refresh();
  let b = g.behavior([extra]);
  g.m.limits.maxArtifactBytes = Buffer.byteLength(canonicalJson(b)) + 1000; g.refresh(); b = g.behavior([extra]);
  for (let i = 0; i < 4; i++) {
    g.m.limits.maxEvidenceBytes = Buffer.byteLength(canonicalJson(b)) + b.artifactIndex.reduce((n, e) => n + e.bytes, 0); g.refresh(); b = g.behavior([extra]);
  }
  const exact = Buffer.byteLength(canonicalJson(b)) + b.artifactIndex.reduce((n, e) => n + e.bytes, 0);
  assert.equal(exact, g.m.limits.maxEvidenceBytes);
  g.m.limits.maxEvidenceBytes--; g.refresh();
  assert.throws(() => g.behavior([extra]), /Behavior evidence allowance exceeded/);
});

test('review: exact joined record budget accepts equality and refuses one extra retained object', () => {
  const g = fixture(), original = g.behavior();
  g.m.limits.maxRecords = original.observations.length + original.artifactIndex.length; g.refresh();
  const b = g.behavior(), tail = collectDevelopmentAccountingTail(identity(g.r), b, [], [], [], g.reader, g.m.limits);
  assert.equal(tail.artifactIndex.length, 0);
  const extra = g.putRaw(Buffer.from('independent-extra'));
  assert.throws(() => collectDevelopmentAccountingTail(identity(g.r), b, [], [], [extra], g.reader, g.m.limits), /Joined bounded record allowance/);
});

test('review: lying metadata reader is refused before a returned array is copied', t => {
  const g = fixture(), ref = g.putRaw(Buffer.from('short')), returned = Buffer.alloc(1200001);
  g.m.limits.maxArtifactBytes = 1200000; g.refresh();
  const from = Uint8Array.from; let copiedOversize = false;
  t.mock.method(Uint8Array, 'from', ((source: Uint8Array) => { if (source === returned) copiedOversize = true; return Reflect.apply(from, Uint8Array, [source]); }) as typeof Uint8Array.from);
  assert.throws(() => g.behavior([ref], (r, bound) => r.sha256 === ref.sha256 ? returned : g.reader(r, bound)), /pre-read bound/);
  assert.equal(copiedOversize, false);
});
