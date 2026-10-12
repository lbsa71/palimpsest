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
import { collectDevelopmentAccountingTail, collectDevelopmentBehavior, developmentRequestIdentity, developmentReviewInput, prepareDevelopmentReviewEnvelope, reviewEnvelopeDomains as d, type DevelopmentAccountingTransition, type DevelopmentClosure, type DevelopmentEnvelopeTrust, type BoundedDevelopmentReviewExecution, type DevelopmentModelJudgment, type DevelopmentRegistration, type DevelopmentRequestState, type DevelopmentReviewEnvelope, type DevelopmentRoleBinding, type DevelopmentSettlement, type DevelopmentBehavior } from './review-envelope.ts';

import { developmentCapacityProfile } from './witness.ts';
import { projectDevelopmentReviewRead, boundedDevelopmentReviewInput, developmentReviewCollections, type ReviewSelector, type ReviewCursor, type BoundedReadReceipt, type BoundedReadArguments } from './review-projection.ts';

/** Positive envelope builder adapted from unchanged retention.test.ts; all judgments are synthetic. */
function fixture(unknown = false, control = false, roleConcurrency = 2, priorUnknown = false, effect = false, extras: { b?: string; t?: string } = {}) {
  const f = syntheticWitnessFixture(), transportKey = Buffer.alloc(32, 11), closureKey = Buffer.alloc(32, 12);
  Object.assign(f.m, { version: 2, capacityProfile: developmentCapacityProfile }); f.m.limits.maxArtifactBytes = 200000; f.m.limits.maxRecords = 512; f.trust.acceptedAttemptDigest = identity(f.m); f.observations.forEach(o => o.attemptDigest = identity(f.m));
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
    const execution = signDocument<BoundedDevelopmentReviewExecution>(d.execution, { version: 2, registrationDigest: identity(registered), behaviorDigest: identity(behaviorValue), roleId: `reviewer:${inner.signer}`, requestId: completed.state.request.id, requestIdentityDigest: developmentRequestIdentity(completed.state.request), settledStateDigest: identity(completed.state), settlementDigest: identity(completed.settlement!.value), input: f.put(developmentReviewInput(behaviorValue, `reviewer:${inner.signer}`)), response, output: { uri: `sha256:${outputDigest}`, sha256: outputDigest }, derivedAt: inner.value.reviewedAt, inputMode: 'bounded-sections-v1', decoder: 'mistral-chat-final.v1', evidenceReads: [] }, 'observer', f.keys.get('observer')!);
    return signDocument(d.review, { version: 2 as const, registrationDigest: identity(registered), behaviorDigest: identity(behaviorValue), roleId: `reviewer:${inner.signer}`, review: inner, execution }, inner.signer, f.keys.get(inner.signer)!);
  });
  const tailValue = collectDevelopmentAccountingTail(identity(registered), behaviorValue, transitions, reviews, extras.t ? [f.put(extras.t)] : [], f.reader, f.m.limits);
  const latest = new Map([original, s].map(v => [v.request.id, v])); transitions.forEach(t => latest.set(t.state.request.id, t.state));
  const final: Accounting = { grantId: f.m.grant.id, usage: { requests: 4, inputTokens: 9, outputTokens: 5, costUsd: 0.32, elapsedMs: 200000 }, chargedTokens: 14, chargedCostUsd: 0.32, chargedElapsedMs: 4000, requestIds: [...latest.keys()], unknownRequestIds: [] };
  const closureValue: DevelopmentClosure = { version: 2, registrationDigest: identity(registered), behaviorDigest: identity(behaviorValue), tailDigest: identity(tailValue), reviewDigests: reviews.map(v => identity(v.value)), closedAt: f.at(195), rootCancelled: false, requestStates: [...latest].map(([id, value]) => ({ id, stateDigest: identity(value) })), accounting: final };
  const envelope: DevelopmentReviewEnvelope<BoundedDevelopmentReviewExecution> = { version: 2, registration, behavior, reviews, accountingTail: signDocument(d.tail, tailValue, 'observer', f.keys.get('observer')!), closure: signDocument(d.closure, closureValue, 'closure', closureKey) };
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

/** Actual SQLite bridge retains the full ToolCall; the surrounding B/model response is synthetic. */
async function actualRead(t: TestContext, original = false) {
  const g = fixture(), directory = mkdtempSync(join(tmpdir(), 'retention-bridge-'));
  const originalStore = new OperationalStore({ filename: join(directory, 'original.sqlite') }), localStore = new OperationalStore({ filename: join(directory, 'reviewer.sqlite') });
  const rawDirectory = join(directory, 'raw'); mkdirSync(rawDirectory, { mode: 0o700 }); const raw = new QualificationStore(rawDirectory, 2_000_000);
  t.after(() => { localStore.close(); originalStore.close(); raw.close(); rmSync(directory, { recursive: true, force: true }); });
  let now = Date.parse(g.f.m.grant.issuedAt);
  const originalLedger = new ResourceLedger(originalStore, g.original.ceiling, () => now), resources = g.f.m.grant.resources;
  originalLedger.allocate(g.registered.rootId, resources);
  for (const role of g.registered.roles) originalLedger.allocate(role.allocationId, role.resources, g.registered.rootId);
  originalLedger.allocate(g.original.request.runId, resources, g.registered.roles[0]!.allocationId);
  const anchor = { ...g.original.request, status: 'reserved' as const, usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 } };
  originalLedger.reserve(anchor); originalLedger.dispatched({ ...anchor, status: 'dispatched' }); originalLedger.settle(g.original.request);
  now = Date.parse(g.envelope.behavior.value.frozenAt);
  originalStore.put('development.accounting.freeze', identity(g.registered), { frozenAt: g.envelope.behavior.value.frozenAt }, null);
  const role = g.registered.roles.find(r => r.id === 'reviewer:reviewer-a')!;
  const a = new DevelopmentAccounting({ localStore, original: originalLedger, localRootId: 'isolated', localDefaultCeiling: g.original.ceiling, registration: g.registered, acceptedRegistrationDigest: identity(g.registered), roleId: role.id, acceptedRoleDigest: identity(role), originalGrant: { resources, issuedAt: g.f.m.grant.issuedAt, expiresAt: g.f.m.grant.expiresAt }, behaviorWindow: { notBefore: g.f.m.notBefore, deadlineAt: g.f.m.deadlineAt }, actualConfigurationDigest: role.configurationDigest, actualClosureDigest: role.closureDigest, actualProfile: role.profile, rawStore: raw, transport: { id: 'transport', key: Buffer.alloc(32, 11) }, reserveEvidence() {}, maxResponseBytes: 10000 });
  a.resources.allocate('isolated', role.resources); a.resources.allocate('review', role.resources, 'isolated');
  const artifact = g.envelope.behavior.value.artifactIndex[0]!.artifact;
  const args: BoundedReadArguments = { version: 1, behaviorDigest: identity(g.envelope.behavior.value), selector: original ? { kind: 'original', artifact } : { kind: 'observation', id: 'transfer-2' }, cursor: { index: 0, offset: 0 } };
  const projection = projectDevelopmentReviewRead(g.envelope.behavior.value, args, g.f.reader, { maxReceiptBytes: 2048, remainingReadBytes: 1_002_048 });
  g.f.artifacts.set(projection.artifact.sha256, projection.bytes);
  const call: ToolCall = { id: 'read-actual', runId: 'review', stepId: 'actual-step', name: 'evidence_read', arguments: JSON.parse(canonicalJson(args)) };
  now = Date.parse(g.f.at(182.1)); a.captureTool(call);
  const q: PhysicalRequest = { id: `tool:${call.id}`, runId: call.runId, reservationId: `tool:${call.id}`, purpose: 'reasoning', provider: 'effect-receiver', model: call.name, promptManifestId: `tool:${call.id}`, requestDigest: identity(call), status: 'reserved', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } };
  a.resources.reserve(q); now = Date.parse(g.f.at(182.2)); a.resources.dispatched({ ...q, status: 'dispatched' });
  const localReceipt = localStore.putArtifact(projection.bytes);
  const receiver = a.wrapReceiver({ dispatch: async () => { now = Date.parse(g.f.at(182.3)); return { outcome: 'succeeded', receipt: localReceipt }; }, reconcile: async () => ({ outcome: 'unresolved', receipt: localReceipt }) });
  const effect: Effect = { id: q.id, runId: call.runId, stepId: call.stepId, kind: call.name, payload: call.arguments, scope: { kind: 'public' }, authority: { generation: 'synthetic', epoch: 1, controlRevision: 'synthetic' }, status: 'authorized', revision: 0 };
  await receiver.dispatch(effect, new AbortController().signal); a.resources.settle({ ...q, status: 'succeeded' });
  const events = a.transitions(), completed = events.at(-1)!;
  assert.equal(completed.state.request.id, a.requestId(q.id)); assert.equal(completed.state.request.reservationId, a.requestId(q.reservationId));
  assert.equal(completed.state.request.runId, a.runId(call.runId)); assert.equal(completed.state.request.promptManifestId, q.id);
  assert.equal(Buffer.from(raw.readArtifact(completed.state.payload, 10000)).toString(), canonicalJson(call));
  assert.equal(completed.settlement!.value.response!.sha256, projection.artifact.sha256);
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
  x.evidenceReads = [{ requestId: completed.state.request.id, selector: args.selector, cursor: args.cursor, receipt: projection.artifact, localToolCallId: call.id, localRunId: call.runId, stepId: call.stepId }];
  const modelCompleted = g.transitions.find(v => v.state.request.id === x.requestId && v.state.request.status === 'succeeded')!;
  x.requestIdentityDigest = developmentRequestIdentity(modelCompleted.state.request); x.settledStateDigest = identity(modelCompleted.state); x.settlementDigest = identity(modelCompleted.settlement!.value);
  refreshRead(g); return { g, call, a, events, projection };
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

// The signed/SQLite fixture above is reused without changing production behavior.
// New helper fixtures and all following stimuli/predicates are independent.
function helperFixture() {
  const f = syntheticWitnessFixture();
  Object.assign(f.m, { version: 2, capacityProfile: developmentCapacityProfile });
  f.m.limits = { maxRecords: 32768, maxArtifactBytes: 4_000_000, maxEvidenceBytes: 8_000_000 };
  f.trust.acceptedAttemptDigest = identity(f.m); f.observations.forEach(o => o.attemptDigest = identity(f.m));
  const b: DevelopmentBehavior = { version: 2, registrationDigest: identity('review registration'), frozenAt: f.at(180), manifest: f.manifest(), observations: f.records(), requests: [], transitions: [], rootCancelled: false, evidence: collectDevelopmentEvidence(f.manifest(), f.records(), f.trust, f.reader, f.now), artifactIndex: [] };
  const put = (data: Uint8Array): ArtifactRef => { const sha256 = hashBytes(data), artifact = { uri: `sha256:${sha256}`, sha256 }; f.artifacts.set(sha256, data); b.artifactIndex.push({ artifact: structuredClone(artifact), bytes: data.byteLength }); b.artifactIndex.sort((a,c) => a.artifact.sha256.localeCompare(c.artifact.sha256)); return artifact; };
  const args = (selector: ReviewSelector, cursor: ReviewCursor = { index: 0, offset: 0 }): BoundedReadArguments => ({ version: 1, behaviorDigest: identity(b), selector: structuredClone(selector), cursor: structuredClone(cursor) });
  const read = (a: BoundedReadArguments, reader = f.reader, remainingReadBytes = 1_002_048) => projectDevelopmentReviewRead(b, a, reader, { maxReceiptBytes: 2048, remainingReadBytes });
  const gather = (selector: ReviewSelector) => {
    let cursor: ReviewCursor | null = { index: 0, offset: 0 }, pages = 0, debit = 0; const fragments = new Map<number, Buffer[]>(), sizes = new Map<number, number>();
    do {
      const a = args(selector, cursor!), result = read(a), page: BoundedReadReceipt = JSON.parse(Buffer.from(result.bytes).toString());
      assert.equal(Buffer.from(result.bytes).toString(), canonicalJson(page)); assert(result.bytes.length <= 2048); assert.equal(hashBytes(result.bytes), result.artifact.sha256);
      assert.deepEqual(page.cursor, cursor); assert.deepEqual(page.selector, selector); assert.equal(page.behaviorDigest, identity(b));
      for (const record of page.records) {
        const parts = fragments.get(record.index) ?? [];
        assert.equal(record.offset, parts.reduce((n,p) => n + p.length, 0));
        parts.push(Buffer.from(record.content, record.encoding === 'base64' ? 'base64' : 'utf8')); fragments.set(record.index, parts); sizes.set(record.index, record.bytes);
      }
      assert.notDeepEqual(page.next, cursor); cursor = page.next; debit += result.debitBytes; assert(++pages < 1000, 'Pagination must terminate in this bounded fixture');
    } while (cursor);
    return { pages, debit, records: [...fragments].map(([i,p]) => { const bytes = Buffer.concat(p); assert.equal(bytes.length, sizes.get(i)); return bytes; }) };
  };
  return { f, b, put, args, read, gather };
}

test('independent lossless pagination covers multibyte boundaries, invalid UTF-8, empty originals and replay debits', () => {
  for (const source of [Buffer.from('\ufeff𐐷é\u0000"\\'.repeat(600)), Buffer.from([0xf0,0x90,0x80,0x41,...Array(4000).fill(0xff)]), Buffer.alloc(0)]) {
    const h = helperFixture(), artifact = h.put(source), seen: number[] = [];
    const a = h.args({kind:'original',artifact});
    const first = h.read(a, (ref,bound) => { seen.push(bound); return h.f.reader(ref,bound); });
    const again = h.read(a, (ref,bound) => { seen.push(bound); return h.f.reader(ref,bound); });
    assert.deepEqual(first, again); assert.deepEqual(seen, [Math.max(1,source.length),Math.max(1,source.length)]);
    assert.equal(first.debitBytes, source.length + first.bytes.length);
    assert.deepEqual(h.gather({kind:'original',artifact}).records, [source]);
  }
});

test('global negatives and null accounting reconstruct from collections despite favorable case views', () => {
  const h = helperFixture();
  h.b.evidence.findings = [{ code:'global-denial',status:'failed',detail:'"😀\u0000'.repeat(1200) },{code:'missing',status:'unavailable',detail:'withheld source'}];
  h.b.evidence.finalAccounting = null;
  const compact = boundedDevelopmentReviewInput(h.b,'reviewer'), all = new Map(developmentReviewCollections.map(name => [name, h.gather({kind:'collection',name}).records.map(b => JSON.parse(b.toString()).value)]));
  const one = (name: typeof developmentReviewCollections[number]) => all.get(name)![0];
  const reconstructed = { ...one('behaviorHeader'), manifest:one('manifest'), observations:all.get('observations'), requests:all.get('requests'), transitions:all.get('transitions'), evidence:{...one('evidenceHeader'),manifest:one('evidenceManifest'),observations:all.get('evidenceObservations'),artifacts:all.get('evidenceArtifacts'),findings:all.get('findings')},artifactIndex:all.get('artifactIndex') };
  assert.equal(canonicalJson(reconstructed), canonicalJson(h.b));
  assert.equal(compact.behaviorDigest, identity(h.b));
  assert.equal(compact.collections.find(c => c.name === 'findings')!.records, 2);
  assert(Buffer.byteLength(canonicalJson(compact)) < 2048);
  const cases = h.gather({kind:'case',caseKind:'opportunity',id:'transfer-2'}).records.map(b => JSON.parse(b.toString()));
  assert(cases.some(r => r.value.value?.data.result === 'failed')); assert(!cases.some(r => r.value.code === 'global-denial'));
});

test('adversarial cursors and exact foreign-original aliases refuse without reader entry where decidable', () => {
  const h = helperFixture(), artifact = h.put(Buffer.from('😀ab')), seen: number[] = [];
  const reader = (ref:ArtifactRef,bound:number) => { seen.push(bound); return h.f.reader(ref,bound); };
  for (const cursor of [{index:-1,offset:0},{index:0,offset:-1},{index:0,offset:0.5},{index:NaN,offset:0},{index:0,offset:Infinity},{index:0,offset:6},{index:1,offset:0}]) assert.throws(() => h.read(h.args({kind:'original',artifact},cursor),reader));
  assert.throws(() => h.read(h.args({kind:'original',artifact:{...artifact,uri:`aeon:artifact:${artifact.sha256}`}}),reader),/membership/);
  assert.equal(seen.length,0);
  for (const offset of [1,2,3]) assert.throws(() => h.read(h.args({kind:'original',artifact},{index:0,offset}),reader),/code point/);
  assert.deepEqual(seen,[6,6,6]);
  assert.equal(JSON.parse(Buffer.from(h.read(h.args({kind:'original',artifact},{index:0,offset:4})).bytes).toString()).records[0].content,'ab');
});

test('original one-over return refuses before byte-copy or fragment creation, and exact budget equality succeeds', t => {
  const h = helperFixture(), source = Buffer.from('canonical'), artifact = h.put(source), returned = Buffer.alloc(source.length + 1), a = h.args({kind:'original',artifact});
  const from = Buffer.from; let copied = false;
  t.mock.method(Buffer, 'from', ((...values: unknown[]) => { if (values[0] === returned || values[0] === returned.buffer) copied = true; return Reflect.apply(from, Buffer, values); }) as typeof Buffer.from);
  assert.throws(() => h.read(a, (ref,bound) => { assert.equal(bound,source.length); assert.deepEqual(ref,artifact); return returned; }), /length\/digest/);
  assert.equal(copied,false);
  let calls = 0; const reader = (ref:ArtifactRef,bound:number) => { calls++; return h.f.reader(ref,bound); };
  const result = h.read(a,reader,2048+source.length); assert.equal(result.debitBytes,result.bytes.length+source.length);
  assert.throws(() => h.read(a,reader,2048+source.length-1),/budget/); assert.equal(calls,1);
});

// A supplied reader is an existing public callback, not an invented object/getter framework.
// It may not turn a validated exact original into an unindexed original by mutating its argument.
test('reader argument mutation cannot substitute an unindexed source under the accepted B digest', t => {
  const h = helperFixture(), artifact = h.put(Buffer.from('actual')), forged = Buffer.from('forged'), a = h.args({kind:'original',artifact}), initial = structuredClone(a), beforeB = identity(h.b);
  assert.equal(JSON.parse(Buffer.from(h.read(initial).bytes).toString()).records[0].content, 'actual');
  let result: ReturnType<typeof projectDevelopmentReviewRead>;
  try { result = h.read(a, (ref,_bound) => { ref.sha256=hashBytes(forged); ref.uri=`sha256:${ref.sha256}`; return forged; }); }
  catch { assert.equal(identity(h.b),beforeB); return; }
  const page:BoundedReadReceipt=JSON.parse(Buffer.from(result.bytes).toString());
  t.diagnostic(JSON.stringify({original:artifact.sha256,returnedSelector:page.selector,record:page.records[0]?.content,unchangedB:identity(h.b)===beforeB}));
  assert.equal(identity(h.b),beforeB);
  assert.deepEqual(page.selector,initial.selector,'Returned source must retain pre-callback exact B membership');
  assert.equal(page.records[0]!.content,'actual');
});

test('reader callback cannot replace checked cursor and silently omit a source prefix', t => {
  const h = helperFixture(), artifact=h.put(Buffer.from('negative outcome')), a=h.args({kind:'original',artifact}), initial=structuredClone(a);
  assert.equal(JSON.parse(Buffer.from(h.read(initial).bytes).toString()).records[0].content, 'negative outcome');
  let result:ReturnType<typeof projectDevelopmentReviewRead>;
  try { result=h.read(a,(ref,bound)=>{a.cursor.offset=9;return h.f.reader(ref,bound);}); } catch { return; }
  const page:BoundedReadReceipt=JSON.parse(Buffer.from(result.bytes).toString());
  t.diagnostic(JSON.stringify({requested:initial.cursor,returned:page.cursor,content:page.records[0]?.content}));
  assert.deepEqual(page.cursor,initial.cursor,'Receipt must bind the cursor checked before callback');
  assert.equal(page.records[0]!.content,'negative outcome');
});

test('unrelated B metadata mutation requires no whole-B copy for fixed original membership', t => {
  const h=helperFixture(),artifact=h.put(Buffer.from('source')),a=h.args({kind:'original',artifact}),oldDigest=a.behaviorDigest;
  let result:ReturnType<typeof projectDevelopmentReviewRead>;
  try { result=h.read(a,(ref,bound)=>{h.b.rootCancelled=true;return h.f.reader(ref,bound);}); } catch { return; }
  const page:BoundedReadReceipt=JSON.parse(Buffer.from(result.bytes).toString());
  // Original-only release can safely use captured scalar facts; it need not recopy all B.
  // A changed root flag does not alter source bytes, so this is a positive no-whole-B-copy control.
  assert.equal(page.behaviorDigest,oldDigest);assert.equal(page.records[0]!.content,'source');assert.notEqual(identity(h.b),oldDigest);
  t.diagnostic('No whole-B defensive copy required for an original whose checked membership and content remain fixed');
});

test('actual signed original read reaches final verification with exact receipt and complete charge inventory', async t => {
  const {g,projection}=await actualRead(t,true), result=g.prepare();
  assert.deepEqual(result.findings.map(v=>v.code),['synthetic'],JSON.stringify(result.findings));assert.equal(result.finalAccounting!.usage.requests,5);assert(projection.debitBytes>projection.bytes.length);
});

for (const fault of ['receipt-offset','receipt-length','receipt-body-digest','unsigned-read-entry'] as const) test(`signed final rederivation rejects independently aligned ${fault}`, async t => {
  const {g}=await actualRead(t,true),binding=g.envelope.reviews[0]!.value,x=binding.execution.value,access=x.evidenceReads[0]!;
  assert.deepEqual(g.prepare().findings.map(v=>v.code),['synthetic']);
  const page:BoundedReadReceipt=JSON.parse(Buffer.from(g.f.reader(access.receipt,2048)).toString());
  if(fault==='receipt-offset')page.records[0]!.offset++;
  if(fault==='receipt-length')page.records[0]!.bytes++;
  if(fault==='receipt-body-digest')page.behaviorDigest=identity('other behavior');
  if(fault==='unsigned-read-entry')access.stepId='another-step';
  else {
    access.receipt=g.f.put(page);
    const completed=g.transitions.find(v=>v.state.request.id===access.requestId&&v.state.request.status==='succeeded')!;
    completed.settlement!.value.response=access.receipt;
    completed.settlement=signDocument(d.settlement,completed.settlement!.value,'transport',Buffer.alloc(32,11));
  }
  refreshRead(g);
  const result=g.prepare(); assert.equal(result.status,'failed');
  assert(result.findings.some(v=>v.code==='envelope'&&/derived receipt|ToolCall identity/.test(v.detail)),JSON.stringify(result.findings));
});
