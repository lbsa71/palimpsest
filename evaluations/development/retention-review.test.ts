import test, { type TestContext } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OperationalStore } from '../../packages/storage/index.ts';
import { ResourceLedger } from '../../packages/runtime/resources/index.ts';
import { DevelopmentAccounting } from '../../deployment/development-accounting.ts';
import { QualificationStore } from '../qualification/store.ts';
import assert from 'node:assert/strict';
import { canonicalJson, identity, type ArtifactRef, type Effect, type PhysicalRequest, type ToolCall } from '../../packages/contracts/index.ts';
import { hashBytes } from '../../packages/release/artifacts.ts';
import { signDocument } from '../qualification/manifest.ts';
import { syntheticWitnessFixture } from './witness-fixture.ts';
import { collectDevelopmentEvidence, domains, type Accounting } from './witness.ts';
import { collectDevelopmentAccountingTail, collectDevelopmentBehavior, developmentRequestIdentity, developmentReviewInput, prepareDevelopmentReviewEnvelope, reviewEnvelopeDomains as d, type DevelopmentAccountingTransition, type DevelopmentClosure, type DevelopmentEnvelopeTrust, type DevelopmentReviewExecution, type DevelopmentModelJudgment, type DevelopmentRegistration, type DevelopmentRequestState, type DevelopmentReviewEnvelope, type DevelopmentRoleBinding, type DevelopmentSettlement } from './review-envelope.ts';

/** Positive wire builder adapted from retention.test.ts; independent frozen cases follow.
 * All keys, clocks and judgments are public synthetic fixtures. */
function fixture(unknown = false, control = false, roleConcurrency = 2, priorUnknown = false, effect = false, extras: { b?: string; t?: string } = {}, limits: Partial<ReturnType<typeof syntheticWitnessFixture>['m']['limits']> = {}) {
  const f = syntheticWitnessFixture(), transportKey = Buffer.alloc(32, 11), closureKey = Buffer.alloc(32, 12);
  f.m.limits.maxArtifactBytes = 200000; f.m.limits.maxRecords = 512; Object.assign(f.m.limits, limits); f.trust.acceptedAttemptDigest = identity(f.m); f.observations.forEach(o => o.attemptDigest = identity(f.m));
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
  const behaviorValue = collectDevelopmentBehavior(registration, manifest, f.records(), [s], behavioralTransitions, f.at(180), trust, f.reader, f.now, extras.b ? [f.put(extras.b)] : []);
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
  const tailValue = collectDevelopmentAccountingTail(identity(registered), behaviorValue, transitions, reviews, extras.t ? [f.put(extras.t)] : [], f.reader, f.m.limits);
  const latest = new Map([original, s].map(v => [v.request.id, v])); transitions.forEach(t => latest.set(t.state.request.id, t.state));
  const final: Accounting = { grantId: f.m.grant.id, usage: { requests: 4, inputTokens: 9, outputTokens: 5, costUsd: 0.32, elapsedMs: 200000 }, chargedTokens: 14, chargedCostUsd: 0.32, chargedElapsedMs: 4000, requestIds: [...latest.keys()], unknownRequestIds: [] };
  const closureValue: DevelopmentClosure = { version: 2, registrationDigest: identity(registered), behaviorDigest: identity(behaviorValue), tailDigest: identity(tailValue), reviewDigests: reviews.map(v => identity(v.value)), closedAt: f.at(195), rootCancelled: false, requestStates: [...latest].map(([id, value]) => ({ id, stateDigest: identity(value) })), accounting: final };
  const envelope: DevelopmentReviewEnvelope = { version: 2, registration, behavior, reviews, accountingTail: signDocument(d.tail, tailValue, 'observer', f.keys.get('observer')!), closure: signDocument(d.closure, closureValue, 'closure', closureKey) };
  const refreshTailIndex = () => {
    const oldTailDigest = identity(envelope.accountingTail.value), oldIndex = envelope.accountingTail.value.artifactIndex;
    const entries = new Map(oldIndex.map(e => [e.artifact.sha256, e]));
    const bDigests = new Set(envelope.behavior.value.artifactIndex.map(e => e.artifact.sha256));
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if ('uri' in value && 'sha256' in value) {
        const artifact = value as DevelopmentRequestState['payload'];
        if (!bDigests.has(artifact.sha256)) entries.set(artifact.sha256, { artifact: { uri: `sha256:${artifact.sha256}`, sha256: artifact.sha256 }, bytes: f.artifacts.get(artifact.sha256)?.byteLength ?? entries.get(artifact.sha256)?.bytes ?? 0 });
      } else Object.values(value).forEach(visit);
    };
    visit({ transitions: envelope.accountingTail.value.transitions, reviews: envelope.reviews });
    envelope.accountingTail.value.artifactIndex = [...entries.values()].filter(e => !bDigests.has(e.artifact.sha256)).sort((a,b) => a.artifact.sha256.localeCompare(b.artifact.sha256));
    if (envelope.closure?.value.tailDigest === oldTailDigest) envelope.closure.value.tailDigest = identity(envelope.accountingTail.value);
  };
  const resign = () => {
    refreshTailIndex();
    envelope.behavior = signDocument(d.behavior, envelope.behavior.value, 'observer', f.keys.get('observer')!);
    envelope.accountingTail = signDocument(d.tail, envelope.accountingTail.value, 'observer', f.keys.get('observer')!);
    if (envelope.closure) envelope.closure = signDocument(d.closure, envelope.closure.value, 'closure', closureKey);
  };
  resign();
  const prepare = () => prepareDevelopmentReviewEnvelope(envelope, trust, f.reader, f.now);
  return { f, registered, trust, s, original, envelope, get transitions() { return envelope.accountingTail.value.transitions; }, receipt, resign, prepare };
}

/** Sign exactly the submitted inventory, without repairing an adversarial mutation. */
function seal(g: ReturnType<typeof fixture>): void {
  g.envelope.behavior = signDocument(d.behavior, g.envelope.behavior.value, 'observer', g.f.keys.get('observer')!);
  g.envelope.accountingTail = signDocument(d.tail, g.envelope.accountingTail.value, 'observer', g.f.keys.get('observer')!);
  if (g.envelope.closure) {
    g.envelope.closure.value.tailDigest = identity(g.envelope.accountingTail.value);
    g.envelope.closure = signDocument(d.closure, g.envelope.closure.value, 'closure', Buffer.alloc(32, 12));
  }
}
function rejected(g: ReturnType<typeof fixture>, pattern: RegExp): void {
  const result = g.prepare(); assert.equal(result.status, 'failed');
  assert(result.findings.some(f => f.code === 'envelope' && pattern.test(f.detail)), JSON.stringify(result.findings));
}
function tailWith(g: ReturnType<typeof fixture>, refs: ArtifactRef[]) {
  return collectDevelopmentAccountingTail(identity(g.registered), g.envelope.behavior.value, g.transitions, g.envelope.reviews, refs, g.f.reader, g.f.m.limits);
}

/** Actual SQLite bridge retains the full ToolCall; the surrounding B/model response is synthetic. */
async function actualRead(t: TestContext) {
  const g = fixture(), directory = mkdtempSync(join(tmpdir(), 'retention-bridge-'));
  const originalStore = new OperationalStore({ filename: join(directory, 'original.sqlite') }), localStore = new OperationalStore({ filename: join(directory, 'reviewer.sqlite') });
  const rawDirectory = join(directory, 'raw'); mkdirSync(rawDirectory, { mode: 0o700 }); const raw = new QualificationStore(rawDirectory, 2_000_000);
  t.after(() => { localStore.close(); originalStore.close(); raw.close(); rmSync(directory, { recursive: true, force: true }); });
  let now = Date.parse(g.f.m.grant.issuedAt);
  const original = new ResourceLedger(originalStore, g.original.ceiling, () => now), resources = g.f.m.grant.resources;
  original.allocate(g.registered.rootId, resources);
  for (const role of g.registered.roles) original.allocate(role.allocationId, role.resources, g.registered.rootId);
  original.allocate(g.original.request.runId, resources, g.registered.roles[0]!.allocationId);
  const anchor = { ...g.original.request, status: 'reserved' as const, usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 } };
  original.reserve(anchor); original.dispatched({ ...anchor, status: 'dispatched' }); original.settle(g.original.request);
  now = Date.parse(g.envelope.behavior.value.frozenAt);
  originalStore.put('development.accounting.freeze', identity(g.registered), { frozenAt: g.envelope.behavior.value.frozenAt }, null);
  const role = g.registered.roles.find(r => r.id === 'reviewer:reviewer-a')!;
  const a = new DevelopmentAccounting({ localStore, original, localRootId: 'isolated', localDefaultCeiling: g.original.ceiling, registration: g.registered, acceptedRegistrationDigest: identity(g.registered), roleId: role.id, acceptedRoleDigest: identity(role), originalGrant: { resources, issuedAt: g.f.m.grant.issuedAt, expiresAt: g.f.m.grant.expiresAt }, behaviorWindow: { notBefore: g.f.m.notBefore, deadlineAt: g.f.m.deadlineAt }, actualConfigurationDigest: role.configurationDigest, actualClosureDigest: role.closureDigest, actualProfile: role.profile, rawStore: raw, transport: { id: 'transport', key: Buffer.alloc(32, 11) }, reserveEvidence() {}, maxResponseBytes: 10000 });
  a.resources.allocate('isolated', role.resources); a.resources.allocate('review', role.resources, 'isolated');
  const artifact = g.envelope.behavior.value.artifactIndex[0]!.artifact;
  const call: ToolCall = { id: 'read-actual', runId: 'review', stepId: 'actual-step', name: 'evidence_read', arguments: { artifact: { ...artifact } } };
  now = Date.parse(g.f.at(182.1)); a.captureTool(call);
  const q: PhysicalRequest = { id: `tool:${call.id}`, runId: call.runId, reservationId: `tool:${call.id}`, purpose: 'reasoning', provider: 'effect-receiver', model: call.name, promptManifestId: `tool:${call.id}`, requestDigest: identity(call), status: 'reserved', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } };
  a.resources.reserve(q); now = Date.parse(g.f.at(182.2)); a.resources.dispatched({ ...q, status: 'dispatched' });
  const localReceipt = localStore.putArtifact(g.f.reader(artifact, 10000));
  const receiver = a.wrapReceiver({ dispatch: async () => { now = Date.parse(g.f.at(182.3)); return { outcome: 'succeeded', receipt: localReceipt }; }, reconcile: async () => ({ outcome: 'unresolved', receipt: localReceipt }) });
  const effect: Effect = { id: q.id, runId: call.runId, stepId: call.stepId, kind: call.name, payload: call.arguments, scope: { kind: 'public' }, authority: { generation: 'synthetic', epoch: 1, controlRevision: 'synthetic' }, status: 'authorized', revision: 0 };
  await receiver.dispatch(effect, new AbortController().signal); a.resources.settle({ ...q, status: 'succeeded' });
  const events = a.transitions(), completed = events.at(-1)!;
  assert.equal(completed.state.request.id, a.requestId(q.id)); assert.equal(completed.state.request.reservationId, a.requestId(q.reservationId));
  assert.equal(completed.state.request.runId, a.runId(call.runId)); assert.equal(completed.state.request.promptManifestId, q.id);
  assert.equal(Buffer.from(raw.readArtifact(completed.state.payload, 10000)).toString(), canonicalJson(call));
  assert.equal(completed.settlement!.value.response!.sha256, artifact.sha256);
  for (const entry of events) g.f.artifacts.set(entry.state.payload.sha256, raw.readArtifact(entry.state.payload, 10000));
  // Same original child run as final review; retain exact synthetic model payload/response.
  const binding = g.envelope.reviews[0]!.value, x = binding.execution.value;
  let prior: DevelopmentRequestState | null = null;
  for (const event of g.transitions.filter(v => v.state.request.id === x.requestId)) {
    event.state.request.runId = a.runId(call.runId); event.state.allocationPath = [g.registered.rootId, role.allocationId, a.runId(call.runId)];
    event.beforeDigest = prior ? identity(prior) : null;
    if (event.settlement) event.settlement = g.receipt(event.state); prior = event.state;
  }
  g.transitions.splice(1, 0, ...events);
  x.evidenceReads = [{ requestId: completed.state.request.id, artifact, localToolCallId: call.id, localRunId: call.runId, stepId: call.stepId }];
  const modelCompleted = g.transitions.find(v => v.state.request.id === x.requestId && v.state.request.status === 'succeeded')!;
  x.requestIdentityDigest = developmentRequestIdentity(modelCompleted.state.request); x.settledStateDigest = identity(modelCompleted.state); x.settlementDigest = identity(modelCompleted.settlement!.value);
  refreshRead(g); return { g, call, a, events };
}
function refreshRead(g: ReturnType<typeof fixture>): void {
  const binding = g.envelope.reviews[0]!.value;
  binding.execution = signDocument(d.execution, binding.execution.value, 'observer', g.f.keys.get('observer')!);
  g.envelope.reviews[0] = signDocument(d.review, binding, binding.review.signer, g.f.keys.get(binding.review.signer)!);
  const c = g.envelope.closure!.value, latest = new Map([...g.registered.originalRequests, ...g.envelope.behavior.value.requests].map(s => [s.request.id, s]));
  g.transitions.forEach(e => latest.set(e.state.request.id, e.state)); const states = [...latest.values()];
  c.requestStates = states.map(s => ({ id: s.request.id, stateDigest: identity(s) })); c.reviewDigests = g.envelope.reviews.map(r => identity(r.value));
  c.tailDigest = identity(g.envelope.accountingTail.value);
  c.accounting = { grantId: g.f.m.grant.id, usage: { requests: states.length, inputTokens: states.reduce((n,s) => n + s.request.usage.inputTokens!, 0), outputTokens: states.reduce((n,s) => n + s.request.usage.outputTokens!, 0), costUsd: states.reduce((n,s) => n + s.request.usage.costUsd!, 0), elapsedMs: 200000 }, chargedTokens: states.reduce((n,s) => n + s.charged.tokens, 0), chargedCostUsd: states.reduce((n,s) => n + s.charged.costUsd, 0), chargedElapsedMs: states.reduce((n,s) => n + s.charged.elapsedMs, 0), requestIds: [...latest.keys()], unknownRequestIds: [] };
  g.resign();
}

function prepared(g: ReturnType<typeof fixture>): void {
  const result = g.prepare();
  assert.deepEqual(result.findings.map(f => f.code), ['synthetic'], JSON.stringify(result.findings));
  assert(result.finalAccounting); assert.equal(result.automaticReleaseEligible, false); assert.equal(result.h1Eligible, false);
}
function rewriteRead(g: ReturnType<typeof fixture>, mutate: (state: DevelopmentRequestState) => void, response?: ArtifactRef): void {
  const access = g.envelope.reviews[0]!.value.execution.value.evidenceReads[0]!;
  const events = g.transitions.filter(e => e.state.request.id === access.requestId);
  let previous: DevelopmentRequestState | null = null;
  for (const event of events) {
    mutate(event.state); event.beforeDigest = previous ? identity(previous) : null;
    if (event.settlement) {
      const receipt = g.receipt(event.state); receipt.value.response = response ?? access.artifact;
      event.settlement = signDocument(d.settlement, receipt.value, 'transport', Buffer.alloc(32, 11));
    }
    previous = event.state;
  }
  refreshRead(g);
}

test('independent raw-byte inventory survives collection unchanged and B remains frozen', () => {
  const g = fixture(), bytes = Uint8Array.from([0, 255, 1, 128, 10]), sha256 = hashBytes(bytes);
  const raw = { uri: `sha256:${sha256}`, sha256 }; g.f.artifacts.set(sha256, bytes);
  const b = g.envelope.behavior.value, before = canonicalJson(b);
  const tail = tailWith(g, [raw, raw, ...b.artifactIndex.map(e => e.artifact)]);
  assert.equal(tail.artifactIndex.filter(e => e.artifact.sha256 === sha256).length, 1);
  assert.equal(tail.artifactIndex.find(e => e.artifact.sha256 === sha256)!.bytes, bytes.length);
  g.envelope.accountingTail.value = tail; seal(g); prepared(g);
  assert.equal(canonicalJson(b), before); assert.deepEqual(g.f.reader(raw, bytes.length), bytes);
  g.f.artifacts.set(sha256, Uint8Array.from([0, 254, 1, 128, 10])); rejected(g, /digest mismatch/);
});
for (const phase of ['B', 'T'] as const) for (const fault of ['absent', 'duplicate', 'unsorted', 'extra-field', 'missing-size', 'negative', 'fractional', 'wrong-size', 'alias', 'mandatory-omission'] as const) {
  test(`independent ${phase} canonical inventory rejects ${fault}`, () => {
    const g = fixture(), value = phase === 'B' ? g.envelope.behavior.value : g.envelope.accountingTail.value;
    const index = value.artifactIndex;
    if (fault === 'absent') delete (value as Partial<typeof value>).artifactIndex;
    else if (fault === 'duplicate') index.splice(0, 0, structuredClone(index[0]!));
    else if (fault === 'unsorted') index.reverse();
    else if (fault === 'extra-field') Object.assign(index[0]!, { trusted: true });
    else if (fault === 'missing-size') delete (index[0] as Partial<typeof index[number]>).bytes;
    else if (fault === 'negative') index[0]!.bytes = -1;
    else if (fault === 'fractional') index[0]!.bytes = 0.5;
    else if (fault === 'wrong-size') index[0]!.bytes++;
    else if (fault === 'alias') index[0]!.artifact.uri = `aeon:artifact:${index[0]!.artifact.sha256}`;
    else value.artifactIndex = [];
    seal(g); assert.equal(g.prepare().status, 'failed', JSON.stringify(g.prepare().findings));
  });
}
for (const phase of ['B', 'T'] as const) test(`independent ${phase} missing retained rejected draft is unavailable`, () => {
  const text = `rejected ${phase} request bytes`, g = fixture(false, false, 2, false, false, phase === 'B' ? { b: text } : { t: text });
  g.f.artifacts.delete(g.f.put(text).sha256);
  const result = g.prepare(); assert.equal(result.status, 'unavailable');
  assert(result.findings.some(f => f.code === 'envelope' && /Missing synthetic artifact/.test(f.detail)));
});
test('independent boundary: self-signed inventory cannot reveal an unobserved omitted draft', () => {
  const g = fixture(false, false, 2, false, false, { t: 'unobserved private draft' }), ref = g.f.put('unobserved private draft');
  g.envelope.accountingTail.value.artifactIndex = g.envelope.accountingTail.value.artifactIndex.filter(e => e.artifact.sha256 !== ref.sha256);
  seal(g); prepared(g);
});
test('independent final envelope overhead shares exact original aggregate allowance', () => {
  const total = (g: ReturnType<typeof fixture>) => Buffer.byteLength(canonicalJson(g.envelope)) + [...g.envelope.behavior.value.artifactIndex, ...g.envelope.accountingTail.value.artifactIndex].reduce((n,e) => n + e.bytes, 0);
  let bound = total(fixture());
  for (let i = 0; i < 3; i++) bound = total(fixture(false, false, 2, false, false, {}, { maxEvidenceBytes: bound }));
  const exact = fixture(false, false, 2, false, false, {}, { maxEvidenceBytes: bound });
  assert.equal(total(exact), bound); prepared(exact);
  const below = fixture(false, false, 2, false, false, {}, { maxEvidenceBytes: bound - 1 });
  rejected(below, /bound|allowance/);
});
test('independent complete-envelope record limit accepts exact count and rejects one less', () => {
  const g = fixture(), b = g.envelope.behavior.value, t = g.envelope.accountingTail.value;
  const count = b.observations.length + g.registered.originalRequests.length + b.requests.length + b.transitions.length + b.artifactIndex.length + t.transitions.length + g.envelope.reviews.length + t.artifactIndex.length;
  prepared(fixture(false, false, 2, false, false, {}, { maxRecords: count }));
  assert.throws(() => fixture(false, false, 2, false, false, {}, { maxRecords: count - 1 }), /Joined bounded record allowance/);
  assert.throws(() => fixture(false, false, 2, false, false, {}, { maxRecords: 513 }), /host ceiling/);
});
test('independent original per-artifact limit bounds extra retained streams', () => {
  const g = fixture(), bytes = new Uint8Array(g.f.m.limits.maxArtifactBytes + 1), sha256 = hashBytes(bytes);
  g.f.artifacts.set(sha256, bytes);
  assert.throws(() => tailWith(g, [{ uri: `sha256:${sha256}`, sha256 }]), /read bound/);
});
test('independent prompt fragment cannot be omitted despite retaining its capture wrapper', () => {
  const g = fixture(), events = g.transitions.filter(t => t.state.request.id === g.envelope.reviews[0]!.value.execution.value.requestId);
  const capture = JSON.parse(Buffer.from(g.f.reader(events[0]!.state.prompt!, 200000)).toString());
  const fragment = g.f.put('independently retained reviewer-only fragment'); capture.manifest.fragments[0].artifact = fragment;
  const prompt = g.f.put(capture); let previous: DevelopmentRequestState | null = null;
  for (const event of events) { event.state.prompt = prompt; event.beforeDigest = previous ? identity(previous) : null; previous = event.state; }
  g.envelope.reviews[0]!.value.execution.value.settledStateDigest = identity(events.at(-1)!.state);
  g.envelope.accountingTail.value = tailWith(g, []); refreshRead(g); prepared(g);
  g.envelope.accountingTail.value.artifactIndex = g.envelope.accountingTail.value.artifactIndex.filter(e => e.artifact.sha256 !== fragment.sha256);
  seal(g); rejected(g, /retained T artifact index/);
});
test('independent actual SQLite read binds canonical payload and succeeded receipt before final dispatch', async t => {
  const { g } = await actualRead(t); prepared(g); assert.equal(g.prepare().finalAccounting!.usage.requests, 5);
});
for (const fault of ['missing-step', 'extra-metadata', 'reservation', 'prompt-id', 'purpose', 'root', 'role', 'noncanonical-payload', 'receipt-alias', 'receipt-other-bytes'] as const) test(`independent actual read rejects ${fault}`, async t => {
  const { g, call } = await actualRead(t), access = g.envelope.reviews[0]!.value.execution.value.evidenceReads[0]!;
  if (fault === 'missing-step') { delete (access as Partial<typeof access>).stepId; refreshRead(g); }
  else if (fault === 'extra-metadata') { Object.assign(access, { audience: 'foreign' }); refreshRead(g); }
  else if (fault === 'noncanonical-payload') {
    const bytes = Buffer.from(JSON.stringify(call, null, 2)), sha256 = hashBytes(bytes); g.f.artifacts.set(sha256, bytes);
    rewriteRead(g, s => { s.payload = { uri: `sha256:${sha256}`, sha256 }; s.request.requestDigest = sha256; });
  } else if (fault === 'receipt-alias') rewriteRead(g, () => {}, { ...access.artifact, uri: `aeon:artifact:${access.artifact.sha256}` });
  else if (fault === 'receipt-other-bytes') rewriteRead(g, () => {}, g.f.put('substituted receipt'));
  else rewriteRead(g, s => {
    if (fault === 'reservation') s.request.reservationId = 'wrong-reservation';
    else if (fault === 'prompt-id') s.request.promptManifestId = 'wrong-prompt';
    else if (fault === 'purpose') s.request.purpose = 'review';
    else if (fault === 'root') s.rootId = 'another-root';
    else if (fault === 'role') s.roleId = 'reviewer:reviewer-b';
  });
  assert.equal(g.prepare().status, 'failed', JSON.stringify(g.prepare().findings));
});
test('independent already observed read cannot evade validation by dropping all execution metadata', async t => {
  const { g } = await actualRead(t);
  rewriteRead(g, s => { s.request.reservationId = 'forged-reservation'; });
  g.envelope.reviews[0]!.value.execution.value.evidenceReads = []; refreshRead(g);
  assert.equal(g.prepare().status, 'failed', 'Observed evidence_read must remain subject to actual ToolCall mapping checks');
});
