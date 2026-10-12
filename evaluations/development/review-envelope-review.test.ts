import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, identity, type PhysicalRequest } from '../../packages/contracts/index.ts';
import { hashBytes } from '../../packages/release/artifacts.ts';
import { signDocument } from '../qualification/manifest.ts';
import { syntheticWitnessFixture } from './witness-fixture.ts';
import { collectDevelopmentEvidence, domains, type Accounting } from './witness.ts';
import { collectDevelopmentBehavior, developmentRequestIdentity, developmentReviewInput, prepareDevelopmentReviewEnvelope, reviewEnvelopeDomains as d, type DevelopmentAccountingTransition, type DevelopmentClosure, type DevelopmentEnvelopeTrust, type DevelopmentReviewExecution, type DevelopmentModelJudgment, type DevelopmentRegistration, type DevelopmentRequestState, type DevelopmentReviewEnvelope, type DevelopmentRoleBinding, type DevelopmentSettlement } from './review-envelope.ts';

/** Positive wire constructor adapted from the exclusive author repair; historical
 * negative predicates below remain reviewer-owned. Public fixture keys are synthetic. */
function fixture(unknown = false, control = false, roleConcurrency = 2, priorUnknown = false, effect = false, limits: Partial<ReturnType<typeof syntheticWitnessFixture>['m']['limits']> = {}) {
  const f = syntheticWitnessFixture(), transportKey = Buffer.alloc(32, 11), closureKey = Buffer.alloc(32, 12);
  f.m.limits.maxArtifactBytes = 200000; Object.assign(f.m.limits, limits); f.trust.acceptedAttemptDigest = identity(f.m); f.observations.forEach(o => o.attemptDigest = identity(f.m));
  const responses = new Map<string, DevelopmentRequestState['payload']>();
  const observed = f.observations.find(o => o.data.kind === 'request')!, end = f.observations.find(o => o.data.kind === 'end')!;
  assert(observed.data.kind === 'request' && end.data.kind === 'end');
  if (unknown) {
    observed.data.request.status = 'uncertain'; observed.data.request.usage = { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 1000 }; observed.data.charged = { ...observed.data.ceiling };
    end.data.accounting = { grantId: f.m.grant.id, usage: { requests: 2, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 185000 }, chargedTokens: 103, chargedCostUsd: 1.1, chargedElapsedMs: 6000, requestIds: ['prior-physical', 'physical-1'], unknownRequestIds: ['physical-1'] };
  }
  if (effect) { observed.data.request.provider = 'effect-receiver'; observed.data.request.model = 'workspace_write'; observed.data.prompt = null; }
  const candidate: DevelopmentRoleBinding = { id: 'candidate', kind: 'candidate', assignmentId: null, allocationId: 'candidate-allocation', configurationDigest: f.m.candidate.configuration, closureDigest: identity('candidate executable'), profile: f.m.candidate.model ? JSON.parse(Buffer.from(f.reader(f.m.configurationArtifact, 10000)).toString('utf8')).model : null, allowedEffects: ['workspace_write', 'evidence_read'], resources: { ...f.m.grant.resources, maxConcurrency: roleConcurrency } };
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
  const registered: DevelopmentRegistration = { version: 2, attemptDigest: identity(f.m), rootId: 'original-root', rootCancelled: false, registeredAt: f.m.registeredAt, reviewDeadlineAt: f.at(250), observerClosureDigest: f.trust.observer.artifactDigest, closureVerifierDigest: identity('externally qualified closure verifier'), assignmentDigest: identity('private external assignment packet'), roles, originalRequests: [original] };
  const trust: DevelopmentEnvelopeTrust = { acceptedRegistrationDigest: identity(registered), behavior: f.trust, acceptedRoles: new Map(roles.map(r => [r.id, identity(r)])), closure: { id: 'closure', key: closureKey, verifierDigest: registered.closureVerifierDigest }, transports: new Map([['transport', transportKey]]) };
  const receipt = (s: DevelopmentRequestState, dispatched = true) => signDocument<DevelopmentSettlement>(d.settlement, { version: 2, registrationDigest: identity(registered), requestIdentityDigest: developmentRequestIdentity(s.request), observedAt: s.observedAt, dispatched, status: s.request.status as DevelopmentSettlement['status'], usage: s.request.usage, response: s.request.status === 'succeeded' ? responses.get(s.request.id) ?? f.put({ synthetic: true, request: s.request.id, usage: s.request.usage }) : null }, 'transport', transportKey);
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
  const innerReviews = f.reviews().map(v => {
    v.value.evidenceDigest = identity(behaviorValue.evidence);
    return signDocument(domains.review, v.value, v.signer, f.keys.get(v.signer)!);
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
    const input = f.put(developmentReviewInput(behaviorValue, reviewer.id));
    const payload = f.put({ model: reviewer.profile!.id, messages: [{ role: 'user', content: Buffer.from(f.reader(input, 200000)).toString('utf8') }] });
    const request: PhysicalRequest = { id: `review-physical-${i}`, runId: `review-run-${i}`, reservationId: `review-reservation-${i}`, purpose: 'review', provider: reviewer.profile!.provider!, model: reviewer.profile!.id, promptManifestId: `review-prompt-${i}`, requestDigest: payload.sha256, status: 'succeeded', usage: { requests: 1, inputTokens: 2, outputTokens: 1, costUsd: 0.01, elapsedMs: 1000 } };
    const settled: DevelopmentRequestState = { rootId: registered.rootId, roleId: reviewer.id, configurationDigest: reviewer.configurationDigest, closureDigest: reviewer.closureDigest, allocationPath: [registered.rootId, reviewer.allocationId, request.runId], observedAt: f.at(184 + i * 4), request, ceiling: { tokens: 100, costUsd: 1, elapsedMs: 5000 }, charged: { tokens: 3, costUsd: 0.01, elapsedMs: 1000 }, payload, prompt: promptFor(request, payload) };
    const inner = innerReviews[i]!.value;
    const reason = (artifact: DevelopmentRequestState['payload']) => Buffer.from(f.reader(artifact, 200000)).toString('utf8');
    const output: DevelopmentModelJudgment = { opportunities: inner.opportunities.map(v => ({ id: v.id, outcome: v.outcome, reason: reason(v.judgment) })), controls: inner.controls.map(v => ({ id: v.id, outcome: v.outcome, reason: reason(v.judgment) })), boundaries: inner.boundaries.map(v => ({ id: v.id, outcome: v.outcome, reason: reason(v.judgment) })), overall: inner.overall, reason: reason(inner.judgment) };
    responses.set(request.id, f.put({ model: reviewer.profile!.id, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(output) } }] }));
    transitions.push(...history(settled, 182 + i * 4));
  }
  const reviews = innerReviews.map((inner, i) => {
    const completed = transitions.find(t => t.state.request.id === `review-physical-${i}` && t.state.request.status === 'succeeded')!;
    const response = completed.settlement!.value.response!;
    const raw = JSON.parse(Buffer.from(f.reader(response, 200000)).toString('utf8'));
    const text = raw.choices[0].message.content;
    const outputBytes = Buffer.from(text);
    // f.put canonicalizes JSON; extracted model text is retained as exact UTF-8 bytes instead.
    const outputDigest = hashBytes(outputBytes); f.artifacts.set(outputDigest, outputBytes);
    const execution = signDocument<DevelopmentReviewExecution>(d.execution, { version: 2, registrationDigest: identity(registered), behaviorDigest: identity(behaviorValue), roleId: `reviewer:${inner.signer}`, requestId: completed.state.request.id, requestIdentityDigest: developmentRequestIdentity(completed.state.request), settledStateDigest: identity(completed.state), settlementDigest: identity(completed.settlement!.value), input: f.put(developmentReviewInput(behaviorValue, `reviewer:${inner.signer}`)), response, output: { uri: `sha256:${outputDigest}`, sha256: outputDigest }, derivedAt: inner.value.reviewedAt, decoder: 'mistral-chat-final.v1', evidenceReads: [] }, 'observer', f.keys.get('observer')!);
    return signDocument(d.review, { version: 2 as const, registrationDigest: identity(registered), behaviorDigest: identity(behaviorValue), roleId: `reviewer:${inner.signer}`, review: inner, execution }, inner.signer, f.keys.get(inner.signer)!);
  });
  const tailValue = { version: 2 as const, registrationDigest: identity(registered), behaviorDigest: identity(behaviorValue), transitions };
  const latest = new Map([original, s].map(v => [v.request.id, v])); transitions.forEach(t => latest.set(t.state.request.id, t.state));
  const final: Accounting = { grantId: f.m.grant.id, usage: { requests: 4, inputTokens: 9, outputTokens: 5, costUsd: 0.32, elapsedMs: 200000 }, chargedTokens: 14, chargedCostUsd: 0.32, chargedElapsedMs: 4000, requestIds: [...latest.keys()], unknownRequestIds: [] };
  const closureValue: DevelopmentClosure = { version: 2, registrationDigest: identity(registered), behaviorDigest: identity(behaviorValue), tailDigest: identity(tailValue), reviewDigests: reviews.map(v => identity(v.value)), closedAt: f.at(195), rootCancelled: false, requestStates: [...latest].map(([id, value]) => ({ id, stateDigest: identity(value) })), accounting: final };
  const envelope: DevelopmentReviewEnvelope = { version: 2, registration, behavior, reviews, accountingTail: signDocument(d.tail, tailValue, 'observer', f.keys.get('observer')!), closure: signDocument(d.closure, closureValue, 'closure', closureKey) };
  const resign = () => {
    envelope.behavior = signDocument(d.behavior, envelope.behavior.value, 'observer', f.keys.get('observer')!);
    envelope.accountingTail = signDocument(d.tail, envelope.accountingTail.value, 'observer', f.keys.get('observer')!);
    if (envelope.closure) envelope.closure = signDocument(d.closure, envelope.closure.value, 'closure', closureKey);
  };
  const prepare = () => prepareDevelopmentReviewEnvelope(envelope, trust, f.reader, f.now);
  return { f, registered, trust, s, original, envelope, get transitions() { return envelope.accountingTail.value.transitions; }, receipt, resign, prepare };
}

/** Recompute only the mechanically claimed closure after adversarial signed history changes. */
function closeCurrent(g: ReturnType<typeof fixture>): void {
  const latest = new Map([...g.envelope.registration.value.originalRequests, ...g.envelope.behavior.value.requests].map(s => [s.request.id, s]));
  for (const t of g.transitions) latest.set(t.state.request.id, t.state);
  const values = [...latest.values()], c = g.envelope.closure!.value;
  c.rootCancelled = g.envelope.behavior.value.rootCancelled || [...values, ...g.transitions.map(t => t.state)].some(s => s.charged.tokens > s.ceiling.tokens || s.charged.costUsd > s.ceiling.costUsd || s.charged.elapsedMs > s.ceiling.elapsedMs);
  c.tailDigest = identity(g.envelope.accountingTail.value);
  c.reviewDigests = g.envelope.reviews.map(r => identity(r.value));
  c.requestStates = values.map(s => ({ id: s.request.id, stateDigest: identity(s) }));
  c.accounting = { grantId: g.f.m.grant.id, usage: { requests: values.length, inputTokens: values.reduce((n,s) => n + s.request.usage.inputTokens!, 0), outputTokens: values.reduce((n,s) => n + s.request.usage.outputTokens!, 0), costUsd: values.reduce((n,s) => n + s.request.usage.costUsd!, 0), elapsedMs: 200000 }, chargedTokens: values.reduce((n,s) => n + s.charged.tokens, 0), chargedCostUsd: values.reduce((n,s) => n + s.charged.costUsd, 0), chargedElapsedMs: values.reduce((n,s) => n + s.charged.elapsedMs, 0), requestIds: [...latest.keys()], unknownRequestIds: [] };
  g.resign();
}
function rebuildTailLinks(g: ReturnType<typeof fixture>): void {
  const prior = new Map<string, DevelopmentRequestState>();
  for (const t of g.transitions) {
    t.beforeDigest = prior.has(t.state.request.id) ? identity(prior.get(t.state.request.id)) : null;
    if (t.settlement) t.settlement = g.receipt(t.state);
    prior.set(t.state.request.id, t.state);
  }
  for (let i = 0; i < g.envelope.reviews.length; i++) refreshExecution(g, i);
  closeCurrent(g);
}
/** Refresh new causal pins after legitimate fixture state changes, never model contents/time. */
function refreshExecution(g: ReturnType<typeof fixture>, i: number): void {
  const binding = g.envelope.reviews[i]!.value, x = binding.execution.value;
  const completed = g.transitions.find(t => t.state.request.id === x.requestId && t.state.request.status === 'succeeded');
  if (!completed?.settlement) return;
  x.requestIdentityDigest = developmentRequestIdentity(completed.state.request);
  x.settledStateDigest = identity(completed.state); x.settlementDigest = identity(completed.settlement.value);
  binding.execution = signDocument(d.execution, x, 'observer', g.f.keys.get('observer')!);
  g.envelope.reviews[i] = signDocument(d.review, binding, binding.review.signer, g.f.keys.get(binding.review.signer)!);
}
function requireBlocked(g: ReturnType<typeof fixture>, reason: string): void {
  const result = g.prepare();
  assert(result.findings.some(f => f.code !== 'synthetic'), `${reason}; actual findings: ${JSON.stringify(result.findings)}`);
}
test('review baseline retains only permanent synthetic unavailability', () => {
  const g = fixture(), result = g.prepare();
  assert.deepEqual(result.findings.map(f => f.code), ['synthetic']);
  assert.equal(result.automaticReleaseEligible, false); assert.equal(result.h1Eligible, false);
});
test('review R1: two signed model judgments cannot survive deletion of all reviewer work and matching totals', () => {
  const g = fixture(); g.envelope.accountingTail.value.transitions = []; closeCurrent(g);
  requireBlocked(g, 'Two model judgments have no original-root reviewer execution');
});
test('review R1: reviewer judgment cannot predate its own reserved model request', () => {
  const g = fixture(), signed = g.envelope.reviews[0]!;
  signed.value.review.value.reviewedAt = g.f.at(181);
  // Keep the mandatory new derivation pin consistent, so failure proves causal timing.
  signed.value.execution.value.derivedAt = g.f.at(181);
  signed.value.execution = signDocument(d.execution, signed.value.execution.value, 'observer', g.f.keys.get('observer')!);
  signed.value.review = signDocument(domains.review, signed.value.review.value, signed.signer, g.f.keys.get(signed.signer)!);
  g.envelope.reviews[0] = signDocument(d.review, signed.value, signed.signer, g.f.keys.get(signed.signer)!);
  closeCurrent(g); requireBlocked(g, 'Review at 181 seconds precedes its first reservation at 182');
});
test('review R2: reserve must cover original wall lifetime plus the new elapsed reservation', () => {
  const g = fixture();
  for (const t of g.transitions.slice(0, 3)) {
    t.state.ceiling.elapsedMs = 500000;
    if (['reserved', 'dispatched'].includes(t.state.request.status)) t.state.charged.elapsedMs = 500000;
  }
  rebuildTailLinks(g);
  requireBlocked(g, 'Original elapsed at reserve 187000 + ceiling 500000 exceeds 600000');
});
test('review R3: exceeding a physical ceiling cancels later original-root dispatch', () => {
  const g = fixture(), settled = g.transitions[2]!.state;
  settled.request.usage.inputTokens = 200; settled.charged.tokens = 201;
  rebuildTailLinks(g);
  requireBlocked(g, '201 tokens exceeds reserved 100 and ResourceLedger cancels root before reviewer B dispatch');
});
test('review: per-artifact bound includes raw responses from failed reviewer drafts', () => {
  const g = fixture(), event = g.transitions[2]!;
  event.state.request.status = 'failed';
  const receipt = g.receipt(event.state);
  receipt.value.response = g.f.put({ rejectedDraft: 'x'.repeat(g.f.m.limits.maxArtifactBytes) });
  event.settlement = signDocument(d.settlement, receipt.value, 'transport', Buffer.alloc(32, 11));
  closeCurrent(g);
  assert(g.prepare().findings.some(f => f.code === 'envelope' && /bound/.test(f.detail)));
});
test('review: behavior and review records share one preregistered count allowance', () => {
  const g = fixture(), b = g.envelope.behavior.value;
  const total = b.observations.length + g.registered.originalRequests.length + b.requests.length + b.transitions.length + g.transitions.length + g.envelope.reviews.length;
  const h = fixture(false, false, 2, false, false, { maxRecords: total - 1 });
  assert(h.prepare().findings.some(f => f.code === 'envelope' && /record allowance/.test(f.detail)));
});
test('review: signed envelope overhead and raw artifacts share the evidence byte allowance', () => {
  const g = fixture(), overhead = Buffer.byteLength(canonicalJson(g.envelope));
  // Full-B input is mandatory after repair: keep each artifact individually feasible.
  const artifactBound = Math.max(...[...g.f.artifacts.values()].map(bytes => bytes.byteLength)) + 1000;
  const h = fixture(false, false, 2, false, false, { maxArtifactBytes: artifactBound, maxEvidenceBytes: Math.max(overhead + 10, artifactBound) });
  assert(h.prepare().findings.some(f => f.code === 'envelope' && /bound|allowance/.test(f.detail)));
});
test('review: wrong raw transport response bytes fail even when final accounting remains exact', () => {
  const g = fixture(), response = g.transitions[2]!.settlement!.value.response!;
  g.f.artifacts.set(response.sha256, Buffer.from('tampered response'));
  assert(g.prepare().findings.some(f => f.code === 'envelope' && /digest mismatch/.test(f.detail)));
});
test('review: caller-supplied identities cannot collapse two accepted reviewers into one principal', () => {
  const g = fixture();
  g.trust.behavior.reviewers = new Map([...g.trust.behavior.reviewers].map(([id, r]) => [id, { ...r, principalId: 'same-principal' }]));
  assert(g.prepare().findings.some(f => f.code === 'envelope' && /Duplicate/.test(f.detail)));
});
test('review: each reviewer must sign the identical frozen B', () => {
  const g = fixture(), signed = g.envelope.reviews[1]!;
  signed.value.behaviorDigest = identity('different retained behavioral bundle');
  g.envelope.reviews[1] = signDocument(d.review, signed.value, signed.signer, g.f.keys.get(signed.signer)!);
  closeCurrent(g);
  assert(g.prepare().findings.some(f => f.code === 'envelope' && /changed B/.test(f.detail)));
});
test('review: preattempt anchors must stay unchanged through B and may reconcile only in T', () => {
  const g = fixture(false, false, 2, true), b = g.envelope.behavior.value;
  const reconciliation = structuredClone(g.transitions[0]!);
  reconciliation.state.observedAt = g.f.at(170); reconciliation.settlement = g.receipt(reconciliation.state);
  assert.throws(() => collectDevelopmentBehavior(g.envelope.registration, b.manifest, b.observations, b.requests, [...b.transitions, reconciliation], b.frozenAt, g.trust, g.f.reader, g.f.now), /behavioral physical transition history/);
  const accepted = g.prepare();
  assert.deepEqual(accepted.findings.map(f => f.code), ['unknown-usage', 'synthetic']);
  assert.deepEqual(accepted.finalAccounting!.unknownRequestIds, []);
});
test('review R3: root overrun also blocks dispatch of another already reserved request', () => {
  const g = fixture(), [ar, ad, as, br, bd, bs] = g.transitions;
  br!.state.observedAt = g.f.at(183.5);
  as!.state.request.usage.inputTokens = 200; as!.state.charged.tokens = 201;
  g.envelope.accountingTail.value.transitions = [ar!, ad!, br!, as!, bd!, bs!];
  rebuildTailLinks(g);
  requireBlocked(g, 'Reviewer B was reserved before overrun but cannot dispatch afterward');
});
test('review: physical overrun retains accounting and permits settlement of other work already dispatched', () => {
  const g = fixture(), [ar, ad, as, br, bd, bs] = g.transitions;
  br!.state.observedAt = g.f.at(183.25); bd!.state.observedAt = g.f.at(183.5);
  as!.state.request.usage.inputTokens = 200; as!.state.charged.tokens = 201;
  g.envelope.accountingTail.value.transitions = [ar!, ad!, br!, bd!, as!, bs!];
  rebuildTailLinks(g);
  const result = g.prepare();
  assert.deepEqual(result.findings.map(f => f.code), ['synthetic']);
  assert.equal(result.finalAccounting!.chargedTokens, 212);
  assert.equal(result.automaticReleaseEligible, false); assert.equal(result.h1Eligible, false);
});
/** Mutate actual model wire bytes while retaining authentic, internally consistent fixture pins. */
function replaceModelPayload(g: ReturnType<typeof fixture>, value: unknown): void {
  const payload = g.f.put(value), requestId = g.envelope.reviews[0]!.value.execution.value.requestId;
  for (const t of g.transitions.filter(t => t.state.request.id === requestId)) {
    const captured = JSON.parse(Buffer.from(g.f.reader(t.state.prompt!, 200000)).toString('utf8'));
    captured.manifest.requestDigest = payload.sha256; captured.manifest.requestArtifact = payload; captured.artifact = payload;
    t.state.payload = payload; t.state.prompt = g.f.put(captured); t.state.request.requestDigest = payload.sha256;
  }
  rebuildTailLinks(g);
}
function replaceModelResponse(g: ReturnType<typeof fixture>, raw: unknown, extracted: string): void {
  const binding = g.envelope.reviews[0]!.value, x = binding.execution.value;
  const completed = g.transitions.find(t => t.state.request.id === x.requestId && t.state.request.status === 'succeeded')!;
  const response = g.f.put(raw), bytes = Buffer.from(extracted), sha256 = hashBytes(bytes); g.f.artifacts.set(sha256, bytes);
  completed.settlement!.value.response = response;
  completed.settlement = signDocument(d.settlement, completed.settlement!.value, 'transport', Buffer.alloc(32, 11));
  x.response = response; x.output = { uri: `sha256:${sha256}`, sha256 };
  refreshExecution(g, 0); closeCurrent(g);
}
for (const kind of ['substring', 'assistant-role'] as const) test(`review repaired R1: ${kind} inclusion cannot substitute for exact user input B`, () => {
  const g = fixture(), x = g.envelope.reviews[0]!.value.execution.value;
  const input = Buffer.from(g.f.reader(x.input, 200000)).toString('utf8');
  const role = g.registered.roles.find(r => r.id === x.roleId)!;
  replaceModelPayload(g, { model: role.profile!.id, messages: [{ role: kind === 'assistant-role' ? 'assistant' : 'user', content: kind === 'substring' ? `ignored prefix ${input} ignored suffix` : input }] });
  const result = g.prepare();
  assert(result.findings.some(f => f.code === 'envelope' && /exact frozen B input/.test(f.detail)), JSON.stringify(result.findings));
});
test('review repaired R1: authentic raw output reasons must derive the signed judgment artifacts', () => {
  const g = fixture(), x = g.envelope.reviews[0]!.value.execution.value;
  const raw = JSON.parse(Buffer.from(g.f.reader(x.response, 200000)).toString('utf8'));
  const model = JSON.parse(raw.choices[0].message.content); model.opportunities[0].reason = 'Different actual model rationale';
  const text = JSON.stringify(model); raw.choices[0].message.content = text;
  replaceModelResponse(g, raw, text);
  assert(g.prepare().findings.some(f => f.code === 'envelope' && /actual model reason bytes/.test(f.detail)));
});
test('review repaired R1: a tool continuation containing valid judgment JSON remains nonfinal', () => {
  const g = fixture(), x = g.envelope.reviews[0]!.value.execution.value;
  const raw = JSON.parse(Buffer.from(g.f.reader(x.response, 200000)).toString('utf8'));
  raw.choices[0].finish_reason = 'tool_calls';
  replaceModelResponse(g, raw, raw.choices[0].message.content);
  assert(g.prepare().findings.some(f => f.code === 'envelope' && /Incomplete\/tool/.test(f.detail)));
});
function addEvidenceRead(g: ReturnType<typeof fixture>, afterDispatch: boolean): void {
  const binding = g.envelope.reviews[0]!.value, x = binding.execution.value;
  const original = g.transitions[0]!.state, artifact = g.envelope.behavior.value.artifactIndex[0]!.artifact;
  const payload = g.f.put({ artifact });
  const request: PhysicalRequest = { ...original.request, id: 'evidence-read-A', runId: 'evidence-read-run', reservationId: 'evidence-read-reservation', provider: 'effect-receiver', model: 'evidence_read', requestDigest: payload.sha256, status: 'reserved', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } };
  const reserved: DevelopmentRequestState = { ...original, request, payload, prompt: null, allocationPath: [original.rootId, original.allocationPath[1]!, request.runId], observedAt: g.f.at(afterDispatch ? 183 : 182.1), ceiling: { tokens: 0, costUsd: 0, elapsedMs: 1 }, charged: { tokens: 0, costUsd: 0, elapsedMs: 1 } };
  const dispatched: DevelopmentRequestState = { ...reserved, observedAt: g.f.at(afterDispatch ? 183 : 182.2), request: { ...request, status: 'dispatched' } };
  const completed: DevelopmentRequestState = { ...dispatched, observedAt: g.f.at(afterDispatch ? 183 : 182.3), request: { ...request, status: 'succeeded', usage: { ...request.usage, elapsedMs: 1 } } };
  const receipt = g.receipt(completed); receipt.value.response = artifact;
  const events: DevelopmentAccountingTransition[] = [{ beforeDigest: null, state: reserved, settlement: null }, { beforeDigest: identity(reserved), state: dispatched, settlement: null }, { beforeDigest: identity(dispatched), state: completed, settlement: signDocument(d.settlement, receipt.value, 'transport', Buffer.alloc(32, 11)) }];
  g.transitions.splice(afterDispatch ? 2 : 1, 0, ...events);
  x.evidenceReads = [{ requestId: request.id, artifact }]; refreshExecution(g, 0); closeCurrent(g);
}
test('review repaired R1: an authorized B artifact read before deriving dispatch remains accounted', () => {
  const g = fixture(); addEvidenceRead(g, false); const result = g.prepare();
  assert.deepEqual(result.findings.map(f => f.code), ['synthetic']);
  assert.equal(result.finalAccounting!.usage.requests, 5); assert.equal(result.finalAccounting!.chargedElapsedMs, 4001);
});
test('review repaired R1: equal timestamps cannot make an evidence read after model dispatch causally prior', () => {
  const g = fixture(); addEvidenceRead(g, true);
  requireBlocked(g, 'Evidence read occurs later in authenticated T than deriving model dispatch, despite identical clock timestamp');
});
test('review: manual cancellation in T is explicitly unsupported and retains submitted charges', () => {
  const g = fixture(); g.envelope.closure!.value.rootCancelled = true; g.resign();
  const result = g.prepare();
  assert(result.findings.some(f => f.code === 'envelope' && /cancellation/.test(f.detail)));
  assert.equal(result.finalAccounting, null);
  assert.equal(result.envelope.closure!.value.rootCancelled, true);
  assert.equal(result.envelope.closure!.value.accounting.chargedTokens, 14);
  assert.equal(result.envelope.accountingTail.value.transitions.length, 6);
  assert.equal(result.automaticReleaseEligible, false); assert.equal(result.h1Eligible, false);
});
test('review repaired R3: later reconciliation lowers charges without erasing cancellation', () => {
  const g = fixture(), [ar, ad, as, br, bd, bs] = g.transitions;
  br!.state.observedAt = g.f.at(183.25); bd!.state.observedAt = g.f.at(183.5);
  const uncertain = structuredClone(as!);
  uncertain.state.request.status = 'uncertain'; uncertain.state.request.usage.inputTokens = 200;
  uncertain.state.charged.tokens = 201; uncertain.state.charged.elapsedMs = uncertain.state.ceiling.elapsedMs;
  as!.state.observedAt = g.f.at(185);
  g.envelope.accountingTail.value.transitions = [ar!, ad!, br!, bd!, uncertain, as!, bs!];
  rebuildTailLinks(g);
  const result = g.prepare();
  assert.deepEqual(result.findings.map(f => f.code), ['synthetic']);
  assert.equal(result.finalAccounting!.chargedTokens, 14);
  assert.equal(result.envelope.closure!.value.rootCancelled, true);
  g.envelope.closure!.value.rootCancelled = false; g.resign();
  assert(g.prepare().findings.some(f => f.code === 'envelope' && /cancellation/.test(f.detail)));
});
