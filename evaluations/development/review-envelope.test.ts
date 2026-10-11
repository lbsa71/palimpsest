import test from 'node:test';
import assert from 'node:assert/strict';
import { identity, type PhysicalRequest } from '../../packages/contracts/index.ts';
import { signDocument } from '../qualification/manifest.ts';
import { syntheticWitnessFixture } from './witness-fixture.ts';
import { collectDevelopmentEvidence, domains, type Accounting } from './witness.ts';
import { collectDevelopmentBehavior, developmentRequestIdentity, prepareDevelopmentReviewEnvelope, reviewEnvelopeDomains as d, type DevelopmentAccountingTransition, type DevelopmentClosure, type DevelopmentEnvelopeTrust, type DevelopmentRegistration, type DevelopmentRequestState, type DevelopmentReviewEnvelope, type DevelopmentRoleBinding, type DevelopmentSettlement } from './review-envelope.ts';

/** All keys, transport attestations, clocks and judgments are deterministic synthetic fixtures. */
function fixture(unknown = false, control = false, roleConcurrency = 2, priorUnknown = false, effect = false) {
  const f = syntheticWitnessFixture(), transportKey = Buffer.alloc(32, 11), closureKey = Buffer.alloc(32, 12);
  const observed = f.observations.find(o => o.data.kind === 'request')!, end = f.observations.find(o => o.data.kind === 'end')!;
  assert(observed.data.kind === 'request' && end.data.kind === 'end');
  if (unknown) {
    observed.data.request.status = 'uncertain'; observed.data.request.usage = { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 1000 }; observed.data.charged = { ...observed.data.ceiling };
    end.data.accounting = { grantId: f.m.grant.id, usage: { requests: 2, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 185000 }, chargedTokens: 103, chargedCostUsd: 1.1, chargedElapsedMs: 6000, requestIds: ['prior-physical', 'physical-1'], unknownRequestIds: ['physical-1'] };
  }
  if (effect) { observed.data.request.provider = 'effect-receiver'; observed.data.request.model = 'workspace_write'; observed.data.prompt = null; }
  const candidate: DevelopmentRoleBinding = { id: 'candidate', kind: 'candidate', assignmentId: null, allocationId: 'candidate-allocation', configurationDigest: f.m.candidate.configuration, closureDigest: identity('candidate executable'), profile: f.m.candidate.model ? JSON.parse(Buffer.from(f.reader(f.m.configurationArtifact, 10000)).toString('utf8')).model : null, allowedEffects: ['workspace_write'], resources: { ...f.m.grant.resources, maxConcurrency: roleConcurrency } };
  const roles: DevelopmentRoleBinding[] = [candidate, ...f.m.controls.map(c => ({ ...candidate, id: `control:${c.id}`, kind: 'control' as const, assignmentId: c.id, allocationId: `control-allocation:${c.id}`, configurationDigest: identity(`actual control ${c.id}`), closureDigest: identity(`control executable ${c.id}`) })), ...f.m.reviewers.map(v => ({ ...candidate, id: `reviewer:${v.id}`, kind: 'reviewer' as const, assignmentId: v.id, allocationId: `review-allocation:${v.id}`, configurationDigest: identity(`review configuration ${v.id}`), closureDigest: identity(`review executable ${v.id}`), profile: { ...candidate.profile!, id: `review-model:${v.id}` } }))];
  const promptFor = (request: PhysicalRequest, payload: DevelopmentRequestState['payload']) => {
    assert(observed.data.kind === 'request');
    const captured = observed.data.prompt ? JSON.parse(Buffer.from(f.reader(observed.data.prompt, 10000)).toString('utf8')) : { manifest: { fragments: [] } };
    return f.put({ manifest: { ...captured.manifest, id: request.promptManifestId, requestDigest: payload.sha256, requestArtifact: payload }, artifact: payload });
  };
  const priorPayload = f.put({ synthetic: true, prior: 'raw original request' });
  const priorRequest: PhysicalRequest = { ...observed.data.request, provider: 'mistral', model: candidate.profile!.id, id: 'prior-physical', runId: 'prior-run', reservationId: 'prior-reservation', promptManifestId: 'prior-prompt', requestDigest: priorPayload.sha256, status: 'succeeded', usage: { requests: 1, inputTokens: 2, outputTokens: 1, costUsd: 0.1, elapsedMs: 1000 } };
  const original: DevelopmentRequestState = { rootId: 'original-root', roleId: candidate.id, configurationDigest: candidate.configurationDigest, closureDigest: candidate.closureDigest, allocationPath: ['original-root', candidate.allocationId, priorRequest.runId], observedAt: f.at(-3), request: priorRequest, ceiling: { tokens: 100, costUsd: 1, elapsedMs: 5000 }, charged: { tokens: 3, costUsd: 0.1, elapsedMs: 1000 }, payload: priorPayload, prompt: promptFor(priorRequest, priorPayload) };
  if (priorUnknown) {
    original.request.status = 'uncertain'; original.request.usage = { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 1000 }; original.charged = { ...original.ceiling };
    f.m.grant.originalAccounting = { grantId: f.m.grant.id, usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 5000 }, chargedTokens: 100, chargedCostUsd: 1, chargedElapsedMs: 5000, requestIds: ['prior-physical'], unknownRequestIds: ['prior-physical'] };
    end.data.accounting = { grantId: f.m.grant.id, usage: { requests: 2, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 185000 }, chargedTokens: 105, chargedCostUsd: 1.2, chargedElapsedMs: 6000, requestIds: ['prior-physical', 'physical-1'], unknownRequestIds: ['prior-physical'] };
    f.trust.acceptedAttemptDigest = identity(f.m); f.observations.forEach(o => o.attemptDigest = identity(f.m));
  }
  const registered: DevelopmentRegistration = { version: 2, attemptDigest: identity(f.m), rootId: 'original-root', registeredAt: f.m.registeredAt, reviewDeadlineAt: f.at(250), observerClosureDigest: f.trust.observer.artifactDigest, closureVerifierDigest: identity('externally qualified closure verifier'), assignmentDigest: identity('private external assignment packet'), roles, originalRequests: [original] };
  const trust: DevelopmentEnvelopeTrust = { acceptedRegistrationDigest: identity(registered), behavior: f.trust, acceptedRoles: new Map(roles.map(r => [r.id, identity(r)])), closure: { id: 'closure', key: closureKey, verifierDigest: registered.closureVerifierDigest }, transports: new Map([['transport', transportKey]]) };
  const receipt = (s: DevelopmentRequestState, dispatched = true) => signDocument<DevelopmentSettlement>(d.settlement, { version: 2, registrationDigest: identity(registered), requestIdentityDigest: developmentRequestIdentity(s.request), observedAt: s.observedAt, dispatched, status: s.request.status as DevelopmentSettlement['status'], usage: s.request.usage, response: s.request.status === 'succeeded' ? f.put({ synthetic: true, request: s.request.id, usage: s.request.usage }) : null }, 'transport', transportKey);
  const role = control ? roles.find(r => r.kind === 'control')! : candidate;
  if (control) observed.configurationDigest = role.configurationDigest;
  const s: DevelopmentRequestState = { rootId: registered.rootId, roleId: role.id, configurationDigest: role.configurationDigest, closureDigest: role.closureDigest, allocationPath: [registered.rootId, role.allocationId, observed.data.request.runId], observedAt: observed.observedAt, request: { ...observed.data.request }, ceiling: { ...observed.data.ceiling }, charged: { ...observed.data.charged }, payload: observed.data.payload, prompt: observed.data.prompt };
  const history = (settled: DevelopmentRequestState, start: number): DevelopmentAccountingTransition[] => {
    const reserved: DevelopmentRequestState = { ...settled, observedAt: f.at(start), request: { ...settled.request, status: 'reserved', usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 } }, charged: { ...settled.ceiling } };
    const dispatched: DevelopmentRequestState = { ...reserved, observedAt: f.at(start + 1), request: { ...reserved.request, usage: { ...reserved.request.usage }, status: 'dispatched' } };
    return [{ beforeDigest: null, state: reserved, settlement: null }, { beforeDigest: identity(reserved), state: dispatched, settlement: null }, { beforeDigest: identity(dispatched), state: settled, settlement: receipt(settled) }];
  };
  const behavioralTransitions = history(s, 90);
  const manifest = f.manifest(), registration = signDocument(d.registration, registered, 'issuer', f.keys.get('issuer')!);
  const behaviorValue = collectDevelopmentBehavior(registration, manifest, f.records(), [s], behavioralTransitions, f.at(180), trust, f.reader, f.now);
  const behavior = signDocument(d.behavior, behaviorValue, 'observer', f.keys.get('observer')!);
  const reviews = f.reviews().map(v => {
    v.value.evidenceDigest = identity(behaviorValue.evidence);
    const inner = signDocument(domains.review, v.value, v.signer, f.keys.get(v.signer)!);
    return signDocument(d.review, { version: 2 as const, registrationDigest: identity(registered), behaviorDigest: identity(behaviorValue), roleId: `reviewer:${v.signer}`, review: inner }, v.signer, f.keys.get(v.signer)!);
  });
  const transitions: DevelopmentAccountingTransition[] = [];
  if (priorUnknown) {
    const settled = { ...original, observedAt: f.at(181), request: { ...original.request, status: 'succeeded' as const, usage: { requests: 1, inputTokens: 2, outputTokens: 1, costUsd: 0.1, elapsedMs: 1000 } }, charged: { tokens: 3, costUsd: 0.1, elapsedMs: 1000 } };
    transitions.push({ beforeDigest: identity(original), state: settled, settlement: receipt(settled) });
  }
  if (unknown) {
    const settled = { ...s, observedAt: f.at(181), request: { ...s.request, status: 'succeeded' as const, usage: { requests: 1, inputTokens: 3, outputTokens: 2, costUsd: 0.2, elapsedMs: 1000 } }, charged: { tokens: 5, costUsd: 0.2, elapsedMs: 1000 } };
    transitions.push({ beforeDigest: identity(s), state: settled, settlement: receipt(settled) });
  }
  for (const [i, reviewer] of roles.filter(r => r.kind === 'reviewer').entries()) {
    const payload = f.put({ synthetic: true, review: reviewer.id, behaviorDigest: identity(behaviorValue) });
    const request: PhysicalRequest = { id: `review-physical-${i}`, runId: `review-run-${i}`, reservationId: `review-reservation-${i}`, purpose: 'review', provider: reviewer.profile!.provider!, model: reviewer.profile!.id, promptManifestId: `review-prompt-${i}`, requestDigest: payload.sha256, status: 'succeeded', usage: { requests: 1, inputTokens: 2, outputTokens: 1, costUsd: 0.01, elapsedMs: 1000 } };
    const settled: DevelopmentRequestState = { rootId: registered.rootId, roleId: reviewer.id, configurationDigest: reviewer.configurationDigest, closureDigest: reviewer.closureDigest, allocationPath: [registered.rootId, reviewer.allocationId, request.runId], observedAt: f.at(184 + i * 4), request, ceiling: { tokens: 100, costUsd: 1, elapsedMs: 5000 }, charged: { tokens: 3, costUsd: 0.01, elapsedMs: 1000 }, payload, prompt: promptFor(request, payload) };
    transitions.push(...history(settled, 182 + i * 4));
  }
  const tailValue = { version: 2 as const, registrationDigest: identity(registered), behaviorDigest: identity(behaviorValue), transitions };
  const latest = new Map([original, s].map(v => [v.request.id, v])); transitions.forEach(t => latest.set(t.state.request.id, t.state));
  const final: Accounting = { grantId: f.m.grant.id, usage: { requests: 4, inputTokens: 9, outputTokens: 5, costUsd: 0.32, elapsedMs: 200000 }, chargedTokens: 14, chargedCostUsd: 0.32, chargedElapsedMs: 4000, requestIds: [...latest.keys()], unknownRequestIds: [] };
  const closureValue: DevelopmentClosure = { version: 2, registrationDigest: identity(registered), behaviorDigest: identity(behaviorValue), tailDigest: identity(tailValue), reviewDigests: reviews.map(v => identity(v.value)), closedAt: f.at(195), requestStates: [...latest].map(([id, value]) => ({ id, stateDigest: identity(value) })), accounting: final };
  const envelope: DevelopmentReviewEnvelope = { version: 2, registration, behavior, reviews, accountingTail: signDocument(d.tail, tailValue, 'observer', f.keys.get('observer')!), closure: signDocument(d.closure, closureValue, 'closure', closureKey) };
  const resign = () => {
    envelope.behavior = signDocument(d.behavior, envelope.behavior.value, 'observer', f.keys.get('observer')!);
    envelope.accountingTail = signDocument(d.tail, envelope.accountingTail.value, 'observer', f.keys.get('observer')!);
    if (envelope.closure) envelope.closure = signDocument(d.closure, envelope.closure.value, 'closure', closureKey);
  };
  const prepare = () => prepareDevelopmentReviewEnvelope(envelope, trust, f.reader, f.now);
  return { f, registered, trust, s, original, envelope, get transitions() { return envelope.accountingTail.value.transitions; }, receipt, resign, prepare };
}

test('complete synthetic B/T/C preserves negative opportunities, exact charges and no admission authority', () => {
  const g = fixture(), result = g.prepare();
  assert.equal(result.status, 'unavailable'); assert.deepEqual(result.findings.map(f => f.code), ['synthetic']);
  assert.equal(result.finalAccounting?.chargedTokens, 14); assert.equal(result.finalAccounting?.usage.requests, 4);
  assert.equal(result.behavioralReview?.reviews[0]!.value.opportunities.filter(v => v.outcome === 'fail').length, 4);
  assert.equal(result.automaticReleaseEligible, false); assert.equal(result.h1Eligible, false);
});
test('authenticated original unknown settles after freeze without erasing B or its uncertainty', () => {
  const g = fixture(true), frozen = identity(g.envelope.behavior.value), result = g.prepare();
  assert.equal(result.status, 'unavailable'); assert.deepEqual(result.findings.map(f => f.code), ['unknown-usage', 'synthetic']);
  assert.equal(result.finalAccounting?.chargedTokens, 14); assert.deepEqual(result.finalAccounting?.unknownRequestIds, []);
  assert.equal(g.envelope.behavior.value.evidence.finalAccounting?.chargedTokens, 103); assert.equal(identity(g.envelope.behavior.value), frozen);
});
test('pre-attempt unknown inventory can settle exactly once in T while preserving the original accounting anchor', () => {
  const g = fixture(false, false, 2, true), result = g.prepare();
  assert.equal(result.status, 'unavailable'); assert.deepEqual(result.findings.map(f => f.code), ['unknown-usage', 'synthetic']);
  assert.equal(result.finalAccounting?.chargedTokens, 14); assert.equal(g.envelope.behavior.value.evidence.originalAccounting.chargedTokens, 100);
  assert.deepEqual(g.envelope.behavior.value.evidence.originalAccounting.unknownRequestIds, ['prior-physical']);
});
test('registered effects count as original physical requests with no model prompt', () => {
  const g = fixture(false, true, 2, false, true), result = g.prepare();
  assert.deepEqual(result.findings.map(f => f.code), ['synthetic']); assert.equal(result.finalAccounting?.usage.requests, 4);
  assert.equal(result.envelope.behavior.value.requests[0]!.request.provider, 'effect-receiver');
  g.envelope.behavior.value.requests[0]!.request.model = 'undeclared-effect'; g.resign(); assert.equal(g.prepare().status, 'failed');
});
test('actual control configuration is retained in explicitly derived v2 evidence; v1 remains fixed', () => {
  const g = fixture(false, true); assert.deepEqual(g.prepare().findings.map(f => f.code), ['synthetic']);
  const v1 = collectDevelopmentEvidence(g.f.manifest(), g.f.records(), g.f.trust, g.f.reader, g.f.now);
  assert(v1.findings.some(v => v.code === 'record' && v.detail.includes('configuration')));
  const h = syntheticWitnessFixture(), request = h.observations.find(o => o.data.kind === 'request')!; assert(request.data.kind === 'request'); request.data.request.model = 'alternate';
  assert(h.prepare().findings.some(v => v.detail.includes('configured provider/model')));
});
for (const [name, mutate, detail] of [
  ['omitted post-freeze retry', (g: ReturnType<typeof fixture>) => { g.envelope.accountingTail.value.transitions.splice(3, 3); g.envelope.closure!.value.tailDigest = identity(g.envelope.accountingTail.value); }, 'inventory'],
  ['changed reviewer model', (g: ReturnType<typeof fixture>) => { g.transitions[0]!.state.request.model = 'substituted-reviewer'; }, 'provider/model'],
  ['changed B', (g: ReturnType<typeof fixture>) => { g.envelope.behavior.value.evidence.findings.push({ code: 'invented', status: 'unavailable', detail: 'changed' }); }, 'immutable B'],
  ['duplicate physical identity', (g: ReturnType<typeof fixture>) => { g.transitions.splice(1, 0, structuredClone(g.transitions[0]!)); }, 'transition'],
  ['foreign root', (g: ReturnType<typeof fixture>) => { g.transitions[0]!.state.rootId = 'foreign-root'; }, 'Foreign original'],
  ['forged settlement', (g: ReturnType<typeof fixture>) => { g.transitions[2]!.settlement!.signature = '0'.repeat(64); }, 'signature'],
  ['closure after expiry', (g: ReturnType<typeof fixture>) => { g.envelope.closure!.value.closedAt = g.f.at(301); }, 'expiry'],
  ['unknown erasure without exact transition', (g: ReturnType<typeof fixture>) => { g.transitions[0]!.beforeDigest = identity('invented prior state'); }, 'transition'],
  ['unqualified role', (g: ReturnType<typeof fixture>) => { g.trust.acceptedRoles = new Map([...g.trust.acceptedRoles].filter(([id]) => id !== 'reviewer:reviewer-a'));  }, 'Unqualified role'],
  ['wrong lineage', (g: ReturnType<typeof fixture>) => { g.transitions[0]!.state.allocationPath = ['original-root', 'wrong-role-allocation', 'review-run-0']; }, 'lineage'],
  ['settled replay', (g: ReturnType<typeof fixture>) => { const prior = g.transitions[2]!.state; g.transitions.splice(3, 0, { beforeDigest: identity(prior), state: { ...prior, observedAt: g.f.at(185), request: { ...prior.request, status: 'dispatched' } }, settlement: null }); }, 'replay'],
  ['missing behavioral history', (g: ReturnType<typeof fixture>) => { g.envelope.behavior.value.transitions = []; }, 'history'],
  ['forged raw usage at dispatch', (g: ReturnType<typeof fixture>) => { g.transitions[1]!.state.request.usage.inputTokens = 1; }, 'raw provider usage'],
  ['wrong transport request', (g: ReturnType<typeof fixture>) => { const v = g.transitions[2]!.settlement!.value; v.requestIdentityDigest = identity('different request'); g.transitions[2]!.settlement = signDocument(d.settlement, v, 'transport', Buffer.alloc(32, 11)); }, 'transport settlement'],
  ['elapsed lifetime erasure', (g: ReturnType<typeof fixture>) => { g.envelope.closure!.value.accounting.usage.elapsedMs = 4000; }, 'lifetime'],
  ['unknown raw token invention', (g: ReturnType<typeof fixture>) => { g.envelope.closure!.value.accounting.usage.inputTokens = 1; }, 'Raw usage'],
  ['candidate dispatch after B', (g: ReturnType<typeof fixture>) => { const prior = g.original; const state = { ...prior, observedAt: g.f.at(185), request: { ...prior.request, id: 'extra-candidate', status: 'reserved' as const, usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 } }, charged: { ...prior.ceiling } }; g.transitions.splice(3, 0, { beforeDigest: null, state, settlement: null }); }, 'post-freeze'],
] as const) test(`${name} causally blocks the joined envelope`, () => {
  const g = fixture(name.includes('unknown erasure')); mutate(g); g.resign(); const result = g.prepare();
  assert.equal(result.status, 'failed'); assert(result.findings.some(f => f.detail.includes(detail)), JSON.stringify(result.findings));
});
test('unknown final outcome and missing closure stay retainable and unavailable', () => {
  const g = fixture(); g.envelope.closure = null; const result = g.prepare(); assert.equal(result.status, 'unavailable'); assert(result.findings.some(f => f.code === 'closure'));
});
test('trusted never-dispatched failure retains reservation history and releases only proven unspent charges', () => {
  const g = fixture(), reserved = g.transitions[3]!.state;
  const failed: DevelopmentRequestState = { ...reserved, observedAt: g.f.at(187), request: { ...reserved.request, status: 'failed', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } }, charged: { tokens: 0, costUsd: 0, elapsedMs: 0 } };
  g.transitions.splice(4, 2, { beforeDigest: identity(reserved), state: failed, settlement: g.receipt(failed, false) });
  const c = g.envelope.closure!.value; c.tailDigest = identity(g.envelope.accountingTail.value);
  c.requestStates.find(v => v.id === failed.request.id)!.stateDigest = identity(failed);
  c.accounting.chargedTokens -= 3; c.accounting.chargedCostUsd -= 0.01; c.accounting.chargedElapsedMs -= 1000;
  c.accounting.usage.inputTokens! -= 2; c.accounting.usage.outputTokens! -= 1; c.accounting.usage.costUsd! -= 0.01;
  g.resign(); assert.deepEqual(g.prepare().findings.map(v => v.code), ['synthetic']);
  const forged = g.transitions[4]!.settlement!.value; forged.dispatched = true;
  g.transitions[4]!.settlement = signDocument(d.settlement, forged, 'transport', Buffer.alloc(32, 11)); g.resign(); assert.equal(g.prepare().status, 'failed');
});
test('material reviewer disagreement remains unavailable and preserves both original dispositions', () => {
  const g = fixture(), v = g.envelope.reviews[1]!.value; v.review.value.opportunities[0]!.outcome = 'fail';
  v.review = signDocument(domains.review, v.review.value, 'reviewer-b', g.f.keys.get('reviewer-b')!);
  g.envelope.reviews[1] = signDocument(d.review, v, 'reviewer-b', g.f.keys.get('reviewer-b')!);
  g.envelope.closure!.value.reviewDigests = g.envelope.reviews.map(v => identity(v.value)); g.resign();
  const result = g.prepare(); assert.equal(result.status, 'unavailable'); assert(result.findings.some(f => f.code === 'disagreement'));
  assert.equal(result.behavioralReview?.reviews[1]!.value.opportunities[0]!.outcome, 'fail');
});
test('aggregate canonical envelope overhead and raw artifacts share original evidence allowance', () => {
  const g = fixture(); g.f.m.limits.maxEvidenceBytes = 10000; g.f.m.limits.maxArtifactBytes = 10000; g.f.trust.acceptedAttemptDigest = identity(g.f.m);
  g.registered.attemptDigest = identity(g.f.m); g.trust.acceptedRegistrationDigest = identity(g.registered);
  g.envelope.registration = signDocument(d.registration, g.registered, 'issuer', g.f.keys.get('issuer')!);
  g.envelope.behavior.value.manifest = g.f.manifest(); g.resign(); assert(g.prepare().findings.some(f => f.detail.includes('overhead')));
});
test('missing raw response bytes cannot delete an authenticated physical request', () => {
  const g = fixture(); g.f.artifacts.delete(g.transitions[2]!.settlement!.value.response!.sha256); const result = g.prepare();
  assert.equal(result.status, 'unavailable'); assert(result.findings.some(f => f.status === 'unavailable')); assert.equal(result.envelope.accountingTail.value.transitions.length, 6);
});
test('original and role concurrency are checked over complete transition history', () => {
  for (const [roleConcurrency, count] of [[1, 1], [2, 2]]) {
    const g = fixture(false, false, roleConcurrency), first = g.transitions[0]!;
    for (let i = 0; i < count!; i++) {
      const duplicate = structuredClone(first); duplicate.state.request.id = `concurrent-extra-${i}`;
      g.transitions.splice(1, 0, duplicate);
    }
    g.resign(); const result = g.prepare(); assert(result.findings.some(f => f.detail.includes('concurrency')), JSON.stringify(result.findings));
  }
});
test('signed getters are rejected before execution', () => {
  const g = fixture(); let called = false; Object.defineProperty(g.envelope.behavior.value, 'unexpected', { enumerable: true, get() { called = true; return 'host'; } });
  assert.throws(() => g.prepare(), /accessors/); assert.equal(called, false);
});
