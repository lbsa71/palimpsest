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

for (const site of ['configuration', 'after-state', 'request-payload'] as const) test(`heldout: known B ${site} is classified before B metadata inventory in T`, () => {
  const g = fixture(), large = g.putRaw(Buffer.alloc(1000001, 27)), b = g.behavior([large]), bounds: number[] = [];
  if (site === 'configuration') b.manifest.value.configurationArtifact = alias(large);
  else if (site === 'after-state') { const o = b.observations.find(o => o.value.data.kind === 'boundary')!; assert(o.value.data.kind === 'boundary'); o.value.data.afterState = alias(large); }
  else b.requests.push(reserved(g, alias(large)).state);
  assert.throws(() => tail(g, b, [], [], (ref, bound) => { if (ref.sha256 === large.sha256) bounds.push(bound); return g.reader(ref, bound); }), /read bound/);
  assert.deepEqual(bounds, [1000000]);
});

for (const site of ['B-request', 'B-transition', 'T-transition'] as const) test(`heldout: ${site} captured nested alias is classified before generic inventory`, () => {
  const g = fixture(), large = g.putRaw(Buffer.alloc(1000001, 28)), b = g.behavior([large]), bounds: number[] = [];
  const t = reserved(g, g.m.configurationArtifact, alias(large));
  if (site === 'B-request') b.requests.push(t.state);
  if (site === 'B-transition') b.transitions.push(t);
  assert.throws(() => tail(g, b, site === 'T-transition' ? [t] : [], [], (ref, bound) => { if (ref.sha256 === large.sha256) bounds.push(bound); return g.reader(ref, bound); }), /read bound/);
  assert.deepEqual(bounds, [1000000]);
});

test('heldout: metadata-only B and T objects remain larger, canonical, unique, and readable in final envelope', () => {
  const g = fixture(), first = g.putRaw(Buffer.alloc(1000001, 30)), second = g.putRaw(Buffer.alloc(1000002, 31));
  const b = g.behavior([alias(first), first]), t = tail(g, b, [], [alias(first), second, alias(second)]);
  assert.equal(b.artifactIndex.filter(e => e.artifact.sha256 === first.sha256).length, 1);
  assert.deepEqual(t.artifactIndex, [{ artifact: second, bytes: 1000002 }]);
  const envelope = withTail(g, b, []); envelope.accountingTail = signDocument(d.tail, t, 'observer', g.keys.get('observer')!);
  const seen = new Map<string, number[]>();
  const result = prepareDevelopmentReviewEnvelope(envelope, g.trust, (ref, bound) => { if ([first.sha256, second.sha256].includes(ref.sha256)) seen.set(ref.sha256, [...seen.get(ref.sha256) ?? [], bound]); return g.reader(ref, bound); }, g.now);
  assert.equal(result.findings.some(f => f.code === 'envelope'), false, JSON.stringify(result.findings));
  assert.deepEqual(seen.get(first.sha256), [developmentCapacityLimits.maxArtifactBytes]);
  assert.deepEqual(seen.get(second.sha256), [developmentCapacityLimits.maxArtifactBytes]);
  assert.equal(result.automaticReleaseEligible, false);
});

test('heldout: tail operational reader over-return is rejected before owned copy', t => {
  const g = fixture(), ref = g.putRaw(Buffer.from('heldout-short')), b = g.behavior(), returned = Buffer.alloc(1000001), from = Uint8Array.from; let copied = false;
  t.mock.method(Uint8Array, 'from', ((source: Uint8Array) => { if (source === returned) copied = true; return Reflect.apply(from, Uint8Array, [source]); }) as typeof Uint8Array.from);
  assert.throws(() => tail(g, b, [reserved(g, ref)], [], (r, bound) => { if (r.sha256 === ref.sha256) { assert.equal(bound, 1000000); return returned; } return g.reader(r, bound); }), /pre-read bound/);
  assert.equal(copied, false);
});

test('heldout: operational tail uses the smaller original signed singleton ceiling', () => {
  const g = fixture({ ...developmentCapacityLimits, maxArtifactBytes: 900000 }), ref = g.putRaw(Buffer.alloc(900001, 32)), b = g.behavior(), bounds: number[] = [];
  assert.throws(() => tail(g, b, [reserved(g, ref)], [], (r, bound) => { if (r.sha256 === ref.sha256) bounds.push(bound); return g.reader(r, bound); }), /read bound/);
  assert.deepEqual(bounds, [900000]);
});

test('heldout: tail exact aggregate counts canonical T and unique B/T raw bytes', () => {
  const g = fixture({ maxRecords: 32768, maxArtifactBytes: 120000, maxEvidenceBytes: 500000 });
  const extra = g.putRaw(Buffer.alloc(150000, 33));
  // A smaller signed singleton is needed than the total; split the extra bytes into two unique objects.
  const a = g.putRaw(g.artifacts.get(extra.sha256)!.slice(0, 75000)), z = g.putRaw(Buffer.alloc(75000, 34));
  let b = g.behavior(), t = tail(g, b, [], [a, alias(a), z]);
  const used = () => bytes(t) + [...b.artifactIndex, ...t.artifactIndex].reduce((n, e) => n + e.bytes, 0);
  for (let i = 0; i < 4; i++) { g.m.limits.maxEvidenceBytes = used(); g.refresh(); b = g.behavior(); t = tail(g, b, [], [a, alias(a), z]); }
  assert.equal(used(), g.m.limits.maxEvidenceBytes);
  g.m.limits.maxEvidenceBytes--; g.refresh(); b = g.behavior();
  assert.throws(() => tail(g, b, [], [a, alias(a), z]), /Tail evidence allowance exceeded/);
});

for (const site of ['payload', 'nested-fragment'] as const) {
  test(`heldout: final ${site} equality at 1M reaches T verification after B metadata retention`, () => {
    const g = fixture(), ref = g.putRaw(Buffer.alloc(1000000, 35)), b = g.behavior([ref]);
    const t = site === 'payload' ? reserved(g, alias(ref)) : reserved(g, g.m.configurationArtifact, alias(ref));
    const result = prepareDevelopmentReviewEnvelope(withTail(g, b, [t]), g.trust, g.reader, g.now);
    assert.equal(result.findings.some(f => f.code === 'envelope'), false, JSON.stringify(result.findings));
    assert.equal(result.findings.some(f => f.code === 'closure'), true);
  });
  test(`heldout: final known T ${site} cannot first load from B inventory at metadata bound`, t => {
    const g = fixture(), ref = g.putRaw(Buffer.alloc(1000001, 36)), b = g.behavior([ref]), bounds: number[] = [];
    const transition = site === 'payload' ? reserved(g, alias(ref)) : reserved(g, g.m.configurationArtifact, alias(ref));
    const returned = g.artifacts.get(ref.sha256)!, from = Uint8Array.from; let oversizedCopies = 0;
    t.mock.method(Uint8Array, 'from', ((source: Uint8Array) => { if (source.byteLength === returned.byteLength && hashBytes(source) === ref.sha256) oversizedCopies++; return Reflect.apply(from, Uint8Array, [source]); }) as typeof Uint8Array.from);
    const result = prepareDevelopmentReviewEnvelope(withTail(g, b, [transition]), g.trust, (r, bound) => { if (r.sha256 === ref.sha256) bounds.push(bound); return g.reader(r, bound); }, g.now);
    assert.equal(result.status, 'failed');
    assert(result.findings.some(f => f.code === 'envelope' && /caller bound|read bound/.test(f.detail)), JSON.stringify(result.findings));
    t.diagnostic(JSON.stringify({ site, bounds, oversizedCopies, refusal: result.findings.find(f => f.code === 'envelope')?.detail }));
    assert(bounds.length > 0);
    assert(bounds.every(bound => bound <= developmentOperationalArtifactBytes), `known final operational ref read with ${bounds}`);
  });
}
