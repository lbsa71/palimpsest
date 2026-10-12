import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, identity, type ArtifactRef } from '../../packages/contracts/index.ts';
import { hashBytes } from '../../packages/release/artifacts.ts';
import { signDocument } from '../qualification/manifest.ts';
import { syntheticWitnessFixture } from './witness-fixture.ts';
import { developmentCapacityLimits, developmentCapacityProfile, developmentOperationalArtifactBytes, domains, type DevelopmentAttempt, type DevelopmentAttemptV2 } from './witness.ts';
import { collectDevelopmentAccountingTail, collectDevelopmentBehavior, prepareDevelopmentReviewEnvelope, reviewEnvelopeDomains as d, type DevelopmentAccountingTransition, type DevelopmentEnvelopeTrust, type DevelopmentRegistration, type DevelopmentReviewEnvelope, type DevelopmentRoleBinding, type DevelopmentRequestState, type DevelopmentBehavior } from './review-envelope.ts';

/** Synthetic zero-request B setup; final probes add local reserved T records, never dispatch. */
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
  const candidate: DevelopmentRoleBinding = { id: 'candidate', kind: 'candidate', assignmentId: null, allocationId: 'candidate-allocation', configurationDigest: m.candidate.configuration, closureDigest: identity('capacity candidate'), profile: model, allowedEffects: ['evidence_read'], resources: m.grant.resources };
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

// Only setup is reused from the earlier review. These stimuli and predicates are held out.
const alias = (ref: ArtifactRef): ArtifactRef => ({ ...ref, uri: `aeon:artifact:${ref.sha256}` });
const bytes = (value: unknown) => Buffer.byteLength(canonicalJson(value));
function tail(g: ReturnType<typeof fixture>, b: DevelopmentBehavior, transitions: DevelopmentAccountingTransition[] = [], retained: ArtifactRef[] = [], reader = g.reader) {
  return collectDevelopmentAccountingTail(identity(g.r), b, transitions, [], retained, reader, g.m.limits);
}
function reserved(g: ReturnType<typeof fixture>, payload: ArtifactRef, fragment?: ArtifactRef): DevelopmentAccountingTransition {
  const role = g.r.roles.find(r => r.kind === 'reviewer')!, ceiling = { tokens: 20, costUsd: 0.1, elapsedMs: 1000 };
  const prompt = fragment ? g.put({ manifest: { id: 'heldout-prompt', requestDigest: payload.sha256, requestArtifact: payload, fragments: [{ id: 'heldout-fragment', owner: 'application', role: 'system', order: 0, artifact: fragment, scope: { kind: 'public' }, replaceable: true, derivedFrom: [] }] }, artifact: payload }) : null;
  const state: DevelopmentRequestState = {
    rootId: g.r.rootId, roleId: role.id, configurationDigest: role.configurationDigest, closureDigest: role.closureDigest,
    allocationPath: [g.r.rootId, role.allocationId, 'heldout-run'], observedAt: g.at(181),
    request: { id: 'heldout-request', runId: 'heldout-run', reservationId: 'heldout-reservation', purpose: 'review', provider: fragment ? role.profile!.provider! : 'effect-receiver', model: fragment ? role.profile!.id : 'evidence_read', promptManifestId: 'heldout-prompt', requestDigest: payload.sha256, status: 'reserved', usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 } },
    ceiling, charged: { ...ceiling }, payload, prompt,
  };
  return { beforeDigest: null, state, settlement: null };
}
function withTail(g: ReturnType<typeof fixture>, b: DevelopmentBehavior, transitions: DevelopmentAccountingTransition[]): DevelopmentReviewEnvelope {
  // Sign the exact submitted B/T directly: final validation must bound even T that its collector would refuse.
  const known = new Set(b.artifactIndex.map(e => e.artifact.sha256)), added = new Map<string, ArtifactRef>();
  for (const t of transitions) for (const ref of [t.state.payload, t.state.prompt]) if (ref && !known.has(ref.sha256)) added.set(ref.sha256, { ...ref, uri: `sha256:${ref.sha256}` });
  const artifactIndex = [...added.values()].map(artifact => ({ artifact, bytes: g.artifacts.get(artifact.sha256)!.byteLength })).sort((a, b) => a.artifact.sha256.localeCompare(b.artifact.sha256));
  return { version: 2, registration: g.registration(), behavior: signDocument(d.behavior, b, 'observer', g.keys.get('observer')!), reviews: [], accountingTail: signDocument(d.tail, { version: 2, registrationDigest: identity(g.r), behaviorDigest: identity(b), transitions, artifactIndex }, 'observer', g.keys.get('observer')!), closure: null };
}

// Fixture construction above is copied from the earlier H review; predicates below are new.
for (const fault of ['tail-signature', 'tail-registration', 'tail-behavior', 'reviewer-signature'] as const) test(`final admission authenticates ${fault} before larger B inventory reads`, () => {
  const g = fixture(), ref = g.putRaw(Buffer.alloc(1_000_001, 61)), envelope = g.envelope([ref]);
  if (fault === 'tail-signature') envelope.accountingTail.signature = 'invalid';
  if (fault === 'tail-registration' || fault === 'tail-behavior') {
    if (fault === 'tail-registration') envelope.accountingTail.value.registrationDigest = identity('foreign registration');
    else envelope.accountingTail.value.behaviorDigest = identity('foreign behavior');
    envelope.accountingTail = signDocument(d.tail, envelope.accountingTail.value, 'observer', g.keys.get('observer')!);
  }
  if (fault === 'reviewer-signature') {
    const signer = g.m.reviewers[0]!.id;
    const review = signDocument(d.review, { arbitrary: ref }, signer, g.keys.get(signer)!);
    review.signature = 'invalid';
    envelope.reviews.push(review as unknown as DevelopmentReviewEnvelope['reviews'][number]);
  }
  let reads = 0;
  const result = prepareDevelopmentReviewEnvelope(envelope, g.trust, (r, bound) => { if (r.sha256 === ref.sha256) reads++; return g.reader(r, bound); }, g.now);
  assert.equal(result.status, 'failed');
  assert(result.findings.some(f => f.code === 'envelope' && /signature|Tail changed/i.test(f.detail)), JSON.stringify(result.findings));
  assert.equal(reads, 0);
});

for (const site of ['payload', 'nested-fragment'] as const) test(`final ${site} reader over-return refuses before any oversized owned copy`, t => {
  const g = fixture(), ref = g.putRaw(Buffer.alloc(1_000_000, 62)), b = g.behavior([ref]);
  const transition = site === 'payload' ? reserved(g, alias(ref)) : reserved(g, g.m.configurationArtifact, alias(ref));
  const envelope = withTail(g, b, [transition]), returned = Buffer.alloc(1_000_001, 62), seen: number[] = [];
  const from = Uint8Array.from; let copies = 0;
  t.mock.method(Uint8Array, 'from', ((source: Uint8Array) => { if (source === returned) copies++; return Reflect.apply(from, Uint8Array, [source]); }) as typeof Uint8Array.from);
  const result = prepareDevelopmentReviewEnvelope(envelope, g.trust, (r, bound) => { if (r.sha256 === ref.sha256) { seen.push(bound); return returned; } return g.reader(r, bound); }, g.now);
  assert.equal(result.status, 'failed');
  assert(result.findings.some(f => f.code === 'envelope' && /pre-read bound/.test(f.detail)), JSON.stringify(result.findings));
  assert.deepEqual(seen, [1_000_000]); assert.equal(copies, 0);
});

test('final metadata-only positive remains available without a P1 original-access claim', () => {
  const g = fixture(), ref = g.putRaw(Buffer.alloc(1_000_001, 63)), envelope = g.envelope([ref, alias(ref)]), bounds: number[] = [];
  const result = prepareDevelopmentReviewEnvelope(envelope, g.trust, (r, bound) => { if (r.sha256 === ref.sha256) bounds.push(bound); return g.reader(r, bound); }, g.now);
  assert(!result.findings.some(f => f.code === 'envelope'), JSON.stringify(result.findings));
  assert(result.findings.some(f => f.code === 'closure')); assert.equal(result.automaticReleaseEligible, false);
  assert.deepEqual(bounds, [developmentCapacityLimits.maxArtifactBytes]);
  assert.equal(envelope.behavior.value.artifactIndex.filter(e => e.artifact.sha256 === ref.sha256).length, 1);
});
