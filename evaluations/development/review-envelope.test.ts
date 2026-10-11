import test from 'node:test';
import assert from 'node:assert/strict';
import { identity, type PhysicalRequest } from '../../packages/contracts/index.ts';
import { hashBytes } from '../../packages/release/artifacts.ts';
import { signDocument } from '../qualification/manifest.ts';
import { syntheticWitnessFixture } from './witness-fixture.ts';
import { collectDevelopmentEvidence, domains, type Accounting } from './witness.ts';
import { collectDevelopmentBehavior, developmentRequestIdentity, developmentReviewInput, prepareDevelopmentReviewEnvelope, reviewEnvelopeDomains as d, type DevelopmentAccountingTransition, type DevelopmentClosure, type DevelopmentEnvelopeTrust, type DevelopmentReviewExecution, type DevelopmentModelJudgment, type DevelopmentRegistration, type DevelopmentRequestState, type DevelopmentReviewEnvelope, type DevelopmentRoleBinding, type DevelopmentSettlement } from './review-envelope.ts';

/** All keys, transport attestations, clocks and judgments are deterministic synthetic fixtures. */
function fixture(unknown = false, control = false, roleConcurrency = 2, priorUnknown = false, effect = false) {
  const f = syntheticWitnessFixture(), transportKey = Buffer.alloc(32, 11), closureKey = Buffer.alloc(32, 12);
  f.m.limits.maxArtifactBytes = 200000; f.trust.acceptedAttemptDigest = identity(f.m); f.observations.forEach(o => o.attemptDigest = identity(f.m));
  const responses = new Map<string, DevelopmentRequestState['payload']>();
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

/** Author-only fixture maintenance for legitimately changed model replies and trusted settlement rows. */
function syncModelExecution(g: ReturnType<typeof fixture>, index: number): void {
  const binding = g.envelope.reviews[index]!.value, role = g.registered.roles.find(v => v.id === binding.roleId)!;
  const r = binding.review.value, reason = (artifact: DevelopmentRequestState['payload']) => Buffer.from(g.f.reader(artifact, 200000)).toString('utf8');
  const output: DevelopmentModelJudgment = { opportunities: r.opportunities.map(v => ({ id: v.id, outcome: v.outcome, reason: reason(v.judgment) })), controls: r.controls.map(v => ({ id: v.id, outcome: v.outcome, reason: reason(v.judgment) })), boundaries: r.boundaries.map(v => ({ id: v.id, outcome: v.outcome, reason: reason(v.judgment) })), overall: r.overall, reason: reason(r.judgment) };
  const text = JSON.stringify(output), bytes = Buffer.from(text), sha256 = hashBytes(bytes); g.f.artifacts.set(sha256, bytes);
  const response = g.f.put({ model: role.profile!.id, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: text } }] });
  const completed = g.transitions.find(t => t.state.request.id === binding.execution.value.requestId && t.state.request.status === 'succeeded')!;
  const receipt = g.receipt(completed.state); receipt.value.response = response;
  completed.settlement = signDocument(d.settlement, receipt.value, 'transport', Buffer.alloc(32, 11));
  const x = binding.execution.value; x.response = response; x.output = { uri: `sha256:${sha256}`, sha256 }; x.derivedAt = r.reviewedAt;
  x.settledStateDigest = identity(completed.state); x.settlementDigest = identity(completed.settlement.value);
  binding.execution = signDocument(d.execution, x, 'observer', g.f.keys.get('observer')!);
  g.envelope.reviews[index] = signDocument(d.review, binding, binding.review.signer, g.f.keys.get(binding.review.signer)!);
}
function closeCurrent(g: ReturnType<typeof fixture>): void {
  const latest = new Map([...g.registered.originalRequests, ...g.envelope.behavior.value.requests].map(s => [s.request.id, s]));
  g.transitions.forEach(t => latest.set(t.state.request.id, t.state)); const states = [...latest.values()], c = g.envelope.closure!.value;
  c.rootCancelled = g.envelope.behavior.value.rootCancelled || [...states, ...g.transitions.map(t => t.state)].some(s => s.charged.tokens > s.ceiling.tokens || s.charged.costUsd > s.ceiling.costUsd || s.charged.elapsedMs > s.ceiling.elapsedMs);
  c.tailDigest = identity(g.envelope.accountingTail.value); c.reviewDigests = g.envelope.reviews.map(v => identity(v.value));
  c.requestStates = states.map(s => ({ id: s.request.id, stateDigest: identity(s) }));
  const sum = (field: 'inputTokens' | 'outputTokens' | 'costUsd') => states.some(s => s.request.usage[field] === null) ? null : states.reduce((n, s) => n + s.request.usage[field]!, 0);
  c.accounting = { grantId: g.f.m.grant.id, usage: { requests: states.length, inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), costUsd: sum('costUsd'), elapsedMs: 200000 }, chargedTokens: states.reduce((n,s) => n+s.charged.tokens, 0), chargedCostUsd: states.reduce((n,s) => n+s.charged.costUsd, 0), chargedElapsedMs: states.reduce((n,s) => n+s.charged.elapsedMs, 0), requestIds: [...latest.keys()], unknownRequestIds: states.filter(s => ['reserved','dispatched','uncertain'].includes(s.request.status) || ['inputTokens','outputTokens','costUsd'].some(k => s.request.usage[k as 'inputTokens'] === null)).map(s=>s.request.id) }; g.resign();
}
function rebuildTail(g: ReturnType<typeof fixture>): void {
  const states = new Map([...g.registered.originalRequests, ...g.envelope.behavior.value.requests].map(s => [s.request.id, s]));
  for (const t of g.transitions) { t.beforeDigest = states.has(t.state.request.id) ? identity(states.get(t.state.request.id)) : null; if (t.settlement) t.settlement = g.receipt(t.state); states.set(t.state.request.id, t.state); }
  for (let i=0; i<g.envelope.reviews.length; i++) if (g.transitions.some(t => t.state.request.id === g.envelope.reviews[i]!.value.execution.value.requestId && t.state.request.status === 'succeeded')) syncModelExecution(g,i);
  closeCurrent(g);
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
  ['omitted post-freeze retry', (g: ReturnType<typeof fixture>) => { g.envelope.accountingTail.value.transitions.splice(3, 3); g.envelope.closure!.value.tailDigest = identity(g.envelope.accountingTail.value); }, 'model execution'],
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
  const g = fixture(), reserved: DevelopmentRequestState = { ...g.transitions[3]!.state, observedAt: g.f.at(191), request: { ...g.transitions[3]!.state.request, id: 'unused-review-request' } };
  const failed: DevelopmentRequestState = { ...reserved, observedAt: g.f.at(192), request: { ...reserved.request, status: 'failed', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } }, charged: { tokens: 0, costUsd: 0, elapsedMs: 0 } };
  g.transitions.push({ beforeDigest: null, state: reserved, settlement: null }, { beforeDigest: identity(reserved), state: failed, settlement: g.receipt(failed, false) });
  const c = g.envelope.closure!.value; c.tailDigest = identity(g.envelope.accountingTail.value);
  c.requestStates.push({ id: failed.request.id, stateDigest: identity(failed) }); c.accounting.usage.requests++; c.accounting.requestIds.push(failed.request.id);
  g.resign(); assert.deepEqual(g.prepare().findings.map(v => v.code), ['synthetic']);
  const forged = g.transitions.at(-1)!.settlement!.value; forged.dispatched = true;
  g.transitions.at(-1)!.settlement = signDocument(d.settlement, forged, 'transport', Buffer.alloc(32, 11)); g.resign(); assert.equal(g.prepare().status, 'failed');
});
test('material reviewer disagreement remains unavailable and preserves both original dispositions', () => {
  const g = fixture(), v = g.envelope.reviews[1]!.value; v.review.value.opportunities[0]!.outcome = 'fail';
  v.review = signDocument(domains.review, v.review.value, 'reviewer-b', g.f.keys.get('reviewer-b')!);
  g.envelope.reviews[1] = signDocument(d.review, v, 'reviewer-b', g.f.keys.get('reviewer-b')!);
  syncModelExecution(g, 1);
  closeCurrent(g);
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
test('repair R1: deleting all reviewer work and recomputing closure cannot retain model judgments', () => {
  const g = fixture(); g.envelope.accountingTail.value.transitions = []; closeCurrent(g);
  const result = g.prepare(); assert.equal(result.status, 'failed'); assert(result.findings.some(v => v.detail.includes('model execution')));
});
test('repair R1: observer-signed derivation and reviewer judgment cannot precede actual model settlement', () => {
  const g = fixture(), binding = g.envelope.reviews[0]!.value;
  binding.review.value.reviewedAt = g.f.at(181); binding.review = signDocument(domains.review, binding.review.value, 'reviewer-a', g.f.keys.get('reviewer-a')!);
  binding.execution.value.derivedAt = g.f.at(181); binding.execution = signDocument(d.execution, binding.execution.value, 'observer', g.f.keys.get('observer')!);
  g.envelope.reviews[0] = signDocument(d.review, binding, 'reviewer-a', g.f.keys.get('reviewer-a')!); closeCurrent(g);
  assert(g.prepare().findings.some(v => v.detail.includes('predates completed model')));
});
test('repair R1: favorable signed judgment cannot replace the exact raw model answer', () => {
  const g = fixture(), binding = g.envelope.reviews[0]!.value;
  binding.review.value.opportunities[0]!.outcome = 'fail'; binding.review = signDocument(domains.review, binding.review.value, 'reviewer-a', g.f.keys.get('reviewer-a')!);
  g.envelope.reviews[0] = signDocument(d.review, binding, 'reviewer-a', g.f.keys.get('reviewer-a')!); closeCurrent(g);
  assert(g.prepare().findings.some(v => v.detail.includes('changed model output')));
});
test('repair R2: original wall elapsed plus new reservation matches actual ledger rejection', () => {
  const g = fixture(); for (const t of g.transitions.slice(0,3)) { t.state.ceiling.elapsedMs = 500000; if (['reserved','dispatched'].includes(t.state.request.status)) t.state.charged.elapsedMs = 500000; }
  rebuildTail(g); assert(g.prepare().findings.some(v => v.detail.includes('wall lifetime plus new elapsed')));
});
test('repair R3: physical token/cost/elapsed overrun blocks later reserve and already-reserved dispatch', () => {
  for (const kind of ['tokens','cost','elapsed'] as const) for (const alreadyReserved of [false,true]) {
    const g = fixture(), [ar,ad,as,br,bd,bs] = g.transitions;
    if (kind === 'tokens') { as!.state.request.usage.inputTokens = 200; as!.state.charged.tokens = 201; }
    else if (kind === 'cost') { as!.state.request.usage.costUsd = 1.2; as!.state.charged.costUsd = 1.2; }
    else { as!.state.request.usage.elapsedMs = 6000; as!.state.charged.elapsedMs = 6000; }
    if (alreadyReserved) { br!.state.observedAt = g.f.at(183.5); g.envelope.accountingTail.value.transitions = [ar!,ad!,br!,as!,bd!,bs!]; }
    rebuildTail(g); const result = g.prepare(); assert.equal(result.status, 'failed'); assert(result.findings.some(v => v.detail.includes(alreadyReserved ? 'cannot dispatch reserved' : 'cannot reserve new')), JSON.stringify(result.findings));
  }
});
test('repair R3: overrun preserves all charges and permits settlement of already dispatched work', () => {
  const g = fixture(), [ar,ad,as,br,bd,bs] = g.transitions;
  br!.state.observedAt = g.f.at(183.25); bd!.state.observedAt = g.f.at(183.5); as!.state.request.usage.inputTokens = 200; as!.state.charged.tokens = 201;
  g.envelope.accountingTail.value.transitions = [ar!,ad!,br!,bd!,as!,bs!]; rebuildTail(g);
  const result = g.prepare(); assert.deepEqual(result.findings.map(v=>v.code), ['synthetic']); assert.equal(result.finalAccounting?.chargedTokens,212); assert.equal(result.envelope.closure!.value.rootCancelled,true);
});
test('repair R3: known original physical overrun cannot be disguised as an uncancelled anchor', () => {
  const g = fixture(), registration = g.envelope.registration.value;
  registration.originalRequests[0]!.charged.tokens = 101; g.trust.acceptedRegistrationDigest = identity(registration);
  g.envelope.registration = signDocument(d.registration, registration, 'issuer',g.f.keys.get('issuer')!);
  assert(g.prepare().findings.some(v=>v.detail.includes('anchor erases known physical overrun')));
});
test('repair R3: cancellation stays latched after uncertain overrun reconciles to smaller actual charges', () => {
  const g = fixture(), [ar,ad,as,br,bd,bs] = g.transitions, final = structuredClone(as!);
  br!.state.observedAt = g.f.at(183.25); bd!.state.observedAt = g.f.at(183.5);
  as!.state.request.status = 'uncertain'; as!.state.request.usage.inputTokens = 200;
  as!.state.charged = { tokens:201, costUsd:0.01, elapsedMs:5000 };
  final.state.observedAt = g.f.at(185);
  g.envelope.accountingTail.value.transitions = [ar!,ad!,br!,bd!,as!,final,bs!]; rebuildTail(g);
  const result = g.prepare(); assert.deepEqual(result.findings.map(v=>v.code), ['synthetic']); assert.equal(result.finalAccounting?.chargedTokens,14); assert.equal(g.envelope.closure!.value.rootCancelled,true);
  g.envelope.closure!.value.rootCancelled=false; g.resign(); assert(g.prepare().findings.some(v=>v.detail.includes('erased original root cancellation')));
});
