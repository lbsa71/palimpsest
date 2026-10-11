import { canonicalJson, digest, identity, integer, invariant, validateCapturedPrompt, validatePhysicalRequest, validateUsage, type ArtifactRef, type PhysicalRequest, type PromptManifest, type ResourceEnvelope, type ResourceUsage } from '../../packages/contracts/index.ts';
import { validateEnvelope } from '../../deployment/config.ts';
import { validateModelProfile, type ModelProfile } from '../../deployment/model-grants.ts';
import { hashBytes } from '../../packages/release/artifacts.ts';
import { authenticate, inertSnapshot, type Signed } from '../qualification/manifest.ts';
import { collectDevelopmentEvidenceProjection, prepareDevelopmentEvidenceProjection, DevelopmentArtifactUnavailable, type Accounting, type BoundedArtifactReader, type CollectedDevelopment, type DevelopmentAttempt, type DevelopmentObservation, type DevelopmentReview, type DevelopmentTrust, type Finding, type ProposedDevelopment } from './witness.ts';

export const reviewEnvelopeDomains = Object.freeze({
  registration: 'aeon.development.registration.v2', behavior: 'aeon.development.behavior.v2',
  review: 'aeon.development.review-binding.v2', tail: 'aeon.development.accounting-tail.v2',
  closure: 'aeon.development.closure.v2', settlement: 'aeon.development.settlement.v2', execution: 'aeon.development.review-execution.v2',
});
export interface DevelopmentRoleBinding {
  id: string; kind: 'candidate' | 'control' | 'reviewer' | 'observer'; assignmentId: string | null;
  allocationId: string; configurationDigest: string; closureDigest: string;
  profile: ModelProfile | null; allowedEffects: string[]; resources: ResourceEnvelope;
}
export interface DevelopmentRequestState {
  rootId: string; roleId: string; configurationDigest: string; closureDigest: string;
  allocationPath: string[]; observedAt: string; request: PhysicalRequest;
  ceiling: { tokens: number; costUsd: number; elapsedMs: number };
  charged: { tokens: number; costUsd: number; elapsedMs: number };
  payload: ArtifactRef; prompt: ArtifactRef | null;
}
export interface DevelopmentRegistration {
  version: 2; attemptDigest: string; rootId: string; rootCancelled: boolean; registeredAt: string; reviewDeadlineAt: string;
  observerClosureDigest: string; closureVerifierDigest: string; assignmentDigest: string;
  roles: DevelopmentRoleBinding[]; originalRequests: DevelopmentRequestState[];
}
/** Signed original bytes plus an explicitly derived behavioral view. No v1 wire reinterpretation. */
export interface DevelopmentBehavior {
  version: 2; registrationDigest: string; frozenAt: string;
  manifest: Signed<DevelopmentAttempt>; observations: Signed<DevelopmentObservation>[];
  requests: DevelopmentRequestState[]; transitions: DevelopmentAccountingTransition[]; rootCancelled: boolean; evidence: CollectedDevelopment;
  artifactIndex: { artifact: ArtifactRef; bytes: number }[];
}
export interface DevelopmentReviewBinding {
  version: 2; registrationDigest: string; behaviorDigest: string; roleId: string;
  review: Signed<DevelopmentReview>; execution: Signed<DevelopmentReviewExecution>;
}
/** Qualified host derivation of a model judgment, never a caller-filled execution assertion. */
export interface DevelopmentReviewExecution {
  version: 2; registrationDigest: string; behaviorDigest: string; roleId: string;
  requestId: string; requestIdentityDigest: string; settledStateDigest: string; settlementDigest: string;
  input: ArtifactRef; response: ArtifactRef; output: ArtifactRef; derivedAt: string;
  evidenceReads: { requestId: string; artifact: ArtifactRef }[];
  decoder: 'mistral-chat-final.v1' | 'openai-responses-final.v1';
}
export interface DevelopmentReviewInput {
  version: 2; registrationDigest: string; behaviorDigest: string; roleId: string; behavior: DevelopmentBehavior;
}
export interface DevelopmentModelJudgment {
  opportunities: { id: string; outcome: 'pass' | 'fail' | 'unavailable'; reason: string }[];
  controls: { id: string; outcome: 'valid' | 'invalid' | 'unavailable'; reason: string }[];
  boundaries: { id: string; outcome: 'valid' | 'invalid' | 'unavailable'; reason: string }[];
  overall: 'pass' | 'fail' | 'unavailable'; reason: string;
}
/** Host transport attestation, never candidate/reviewer-reported usage. */
export interface DevelopmentSettlement {
  version: 2; registrationDigest: string; requestIdentityDigest: string; observedAt: string;
  dispatched: boolean; status: 'succeeded' | 'failed' | 'uncertain'; usage: ResourceUsage;
  response: ArtifactRef | null;
}
export interface DevelopmentAccountingTransition {
  beforeDigest: string | null; state: DevelopmentRequestState;
  settlement: Signed<DevelopmentSettlement> | null;
}
export interface DevelopmentAccountingTail {
  version: 2; registrationDigest: string; behaviorDigest: string;
  transitions: DevelopmentAccountingTransition[];
}
export interface DevelopmentClosure {
  version: 2; registrationDigest: string; behaviorDigest: string; tailDigest: string;
  reviewDigests: string[]; closedAt: string; rootCancelled: boolean;
  requestStates: { id: string; stateDigest: string }[]; accounting: Accounting;
}
/** Accepted external configuration; these digests are not supplied by the candidate. */
export interface DevelopmentEnvelopeTrust {
  acceptedRegistrationDigest: string; behavior: DevelopmentTrust;
  acceptedRoles: ReadonlyMap<string, string>;
  closure: { id: string; key: Uint8Array; verifierDigest: string };
  transports: ReadonlyMap<string, Uint8Array>;
}
export interface DevelopmentReviewEnvelope {
  version: 2; registration: Signed<DevelopmentRegistration>; behavior: Signed<DevelopmentBehavior>;
  reviews: Signed<DevelopmentReviewBinding>[]; accountingTail: Signed<DevelopmentAccountingTail>;
  closure: Signed<DevelopmentClosure> | null;
}
export interface ProposedDevelopmentEnvelope {
  kind: 'proposed-development-review-envelope'; version: 2; envelope: DevelopmentReviewEnvelope;
  behaviorDigest: string; behavioralReview: ProposedDevelopment | null; finalAccounting: Accounting | null;
  findings: Finding[]; status: ProposedDevelopment['status'];
  automaticReleaseEligible: false; h1Eligible: false;
}
export type DevelopmentEnvelopeReader = BoundedArtifactReader;

function exact(value: object, fields: string): void { invariant(Object.keys(value).sort().join(',') === fields.split(',').sort().join(','), `Exact v2 fields required: ${fields}`); }
function id(value: unknown): asserts value is string { invariant(typeof value === 'string' && value.length > 0 && value.length <= 256, 'Bounded v2 identity required'); }
function at(value: string): number { invariant(typeof value === 'string' && Number.isFinite(Date.parse(value)), 'Authenticated v2 timestamp required'); return Date.parse(value); }
function unique(values: readonly string[]): void { values.forEach(id); invariant(new Set(values).size === values.length, 'Duplicate physical/role identity'); }
function equal(a: unknown, b: unknown, message: string): void { invariant(identity(a) === identity(b), message); }
function charge(c: DevelopmentRequestState['charged']): void { exact(c, 'tokens,costUsd,elapsedMs'); integer(c.tokens, 'tokens'); for (const v of [c.costUsd, c.elapsedMs]) invariant(Number.isFinite(v) && v >= 0, 'Invalid physical charge'); }
function refs(value: unknown, visit: (ref: ArtifactRef) => void): void {
  if (!value || typeof value !== 'object') return;
  if ('uri' in value && 'sha256' in value) { visit(value as ArtifactRef); return; }
  for (const child of Object.values(value)) refs(child, visit);
}
/** One content digest counts once across aliases; every encountered URI is validated. */
function retained(reader: BoundedArtifactReader, limits: DevelopmentAttempt['limits'], overhead = 0) {
  let total = overhead; const bytes = new Map<string, Uint8Array>();
  invariant(total <= limits.maxEvidenceBytes, 'Aggregate envelope overhead exceeds evidence allowance');
  const read = (ref: ArtifactRef, callerBound = limits.maxArtifactBytes) => {
    exact(ref, 'uri,sha256'); digest(ref.sha256);
    invariant([`sha256:${ref.sha256}`, `aeon:artifact:${ref.sha256}`, `shell:tools:${ref.sha256}`].includes(ref.uri), 'Content-addressed retained bytes required');
    const prior = bytes.get(ref.sha256); if (prior) { invariant(prior.byteLength <= callerBound, 'Cached artifact exceeds caller bound'); return prior; }
    const bound = Math.min(callerBound, limits.maxArtifactBytes, limits.maxEvidenceBytes - total);
    invariant(bound > 0, 'Aggregate evidence allowance exhausted');
    const data = Uint8Array.from(reader(ref, bound)); invariant(data.byteLength <= bound, 'Reader exceeded v2 pre-read bound'); equal(hashBytes(data), ref.sha256, 'Retained artifact digest mismatch');
    total += data.byteLength; bytes.set(ref.sha256, data); return data;
  };
  return { read, scan: (value: unknown) => refs(value, read), index: () => [...bytes].map(([sha256, data]) => ({ artifact: { uri: `sha256:${sha256}`, sha256 }, bytes: data.byteLength })).sort((a, b) => a.artifact.sha256.localeCompare(b.artifact.sha256)) };
}
/** Identity excludes only mutable status and usage, exactly as ResourceLedger.sameRequest. */
export function developmentRequestIdentity(request: PhysicalRequest): string { const { status, usage, ...immutable } = request; return identity(immutable); }

function registration(document: Signed<DevelopmentRegistration>, manifest: Signed<DevelopmentAttempt>, trust: DevelopmentEnvelopeTrust, now: number) {
  const r = authenticate(reviewEnvelopeDomains.registration, document, trust.behavior.issuers), m = manifest.value;
  exact(r, 'version,attemptDigest,rootId,rootCancelled,registeredAt,reviewDeadlineAt,observerClosureDigest,closureVerifierDigest,assignmentDigest,roles,originalRequests');
  invariant(typeof r.rootCancelled === 'boolean', 'Explicit original cancellation anchor required');
  invariant(r.rootCancelled || !r.originalRequests.some(overrun), 'Original cancellation anchor erases known physical overrun');
  invariant(r.version === 2 && identity(r) === trust.acceptedRegistrationDigest && r.attemptDigest === identity(m) && identity(m) === trust.behavior.acceptedAttemptDigest, 'Unaccepted or changed registration/attempt'); id(r.rootId);
  for (const v of [r.observerClosureDigest, r.closureVerifierDigest, r.assignmentDigest]) digest(v);
  invariant(r.observerClosureDigest === trust.behavior.observer.artifactDigest && r.closureVerifierDigest === trust.closure.verifierDigest, 'Unqualified observer/closure verifier');
  invariant(at(r.registeredAt) === at(m.registeredAt) && at(r.registeredAt) <= now && at(m.deadlineAt) <= at(r.reviewDeadlineAt) && at(r.reviewDeadlineAt) <= at(m.grant.expiresAt), 'Registration/review deadline exceeds original grant');
  invariant(r.roles.length >= 1 && r.roles.length <= 40, 'Bounded role inventory required'); unique(r.roles.map(role => role.id)); unique(r.roles.map(role => role.allocationId));
  const roles = new Map(r.roles.map(role => [role.id, role]));
  for (const role of r.roles) {
    exact(role, 'id,kind,assignmentId,allocationId,configurationDigest,closureDigest,profile,allowedEffects,resources'); id(role.allocationId); digest(role.configurationDigest); digest(role.closureDigest); validateEnvelope(role.resources); unique(role.allowedEffects);
    invariant(trust.acceptedRoles.get(role.id) === identity(role), 'Unqualified role/config/profile binding');
    invariant(['candidate', 'control', 'reviewer', 'observer'].includes(role.kind), 'Unknown execution role');
    if (role.profile) validateModelProfile(role.profile);
    for (const key of Object.keys(role.resources) as (keyof ResourceEnvelope)[]) invariant(role.resources[key] <= m.grant.resources[key], 'Role sublimit exceeds original grant');
    if (role.kind === 'candidate') invariant(role.assignmentId === null && role.configurationDigest === m.candidate.configuration && role.profile && identity(role.profile) === m.candidate.model, 'Candidate configured profile changed');
    else if (role.kind === 'control') invariant(m.controls.some(c => c.id === role.assignmentId), 'Foreign control role');
    else if (role.kind === 'reviewer') invariant(m.reviewers.some(v => v.id === role.assignmentId) && role.profile, 'Unassigned reviewer role');
    else invariant(role.assignmentId === null, 'Observer cannot inherit candidate assignment');
  }
  invariant(r.roles.filter(role => role.kind === 'candidate').length === 1 && r.roles.filter(role => role.kind === 'observer').length <= 1, 'Exact candidate/observer role coverage required');
  for (const [kind, ids] of [['control', m.controls.map(c => c.id)], ['reviewer', m.reviewers.map(v => v.id)]] as const) {
    equal(r.roles.filter(role => role.kind === kind).map(role => role.assignmentId).sort(), [...ids].sort(), 'Exact assigned role coverage required');
  }
  unique(r.originalRequests.map(s => s.request.id));
  return { r, m, roles };
}
function state(s: DevelopmentRequestState, r: DevelopmentRegistration, roles: ReadonlyMap<string, DevelopmentRoleBinding>, read: BoundedArtifactReader, release = false): DevelopmentRoleBinding {
  exact(s, 'rootId,roleId,configurationDigest,closureDigest,allocationPath,observedAt,request,ceiling,charged,payload,prompt');
  invariant(s.rootId === r.rootId, 'Foreign original resource root'); const role = roles.get(s.roleId); invariant(role, 'Unknown execution role');
  invariant(s.configurationDigest === role.configurationDigest && s.closureDigest === role.closureDigest, 'Actual role configuration/closure changed');
  unique(s.allocationPath); invariant(s.allocationPath.length >= 2 && s.allocationPath.length <= 32 && s.allocationPath[0] === r.rootId && s.allocationPath.includes(role.allocationId) && s.allocationPath.at(-1) === s.request.runId, 'Missing original-root role lineage');
  at(s.observedAt); validatePhysicalRequest(s.request); charge(s.ceiling); charge(s.charged);
  invariant(s.payload.sha256 === s.request.requestDigest, 'Exact physical payload binding required'); const payload = read(s.payload, 1_000_000);
  if (s.request.provider === 'effect-receiver') invariant(role.allowedEffects.includes(s.request.model) && s.prompt === null, 'Unregistered effect or forged model prompt');
  else {
    invariant(role.profile && s.request.provider === (role.profile.provider ?? 'mistral') && s.request.model === role.profile.id && s.prompt, 'Request changed role provider/model');
    const captured = JSON.parse(Buffer.from(read(s.prompt, 1_000_000)).toString('utf8')) as { manifest: PromptManifest; artifact: ArtifactRef };
    exact(captured, 'manifest,artifact'); invariant(captured.manifest.id === s.request.promptManifestId && captured.artifact.sha256 === s.request.requestDigest, 'Captured prompt/request identity mismatch');
    validateCapturedPrompt(captured.manifest, Buffer.from(payload).toString('utf8')); read(captured.artifact, 1_000_000); for (const f of captured.manifest.fragments) read(f.artifact, 1_000_000);
  }
  const q = s.request, u = q.usage, pending = ['reserved', 'dispatched'].includes(q.status);
  const expected = release ? { tokens: 0, costUsd: 0, elapsedMs: 0 } : pending ? s.ceiling : { tokens: u.inputTokens === null || u.outputTokens === null ? s.ceiling.tokens : u.inputTokens + u.outputTokens, costUsd: u.costUsd ?? s.ceiling.costUsd, elapsedMs: q.status === 'uncertain' ? Math.max(u.elapsedMs, s.ceiling.elapsedMs) : u.elapsedMs };
  equal(s.charged, expected, 'Physical charges differ from existing ledger semantics');
  return role;
}
function sum(states: readonly DevelopmentRequestState[], grantId: string, elapsedMs: number): Accounting {
  const usage: ResourceUsage = { requests: states.length, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs };
  for (const s of states) for (const field of ['inputTokens', 'outputTokens', 'costUsd'] as const) usage[field] = usage[field] === null || s.request.usage[field] === null ? null : usage[field] + s.request.usage[field];
  return { grantId, usage, chargedTokens: states.reduce((n, s) => n + s.charged.tokens, 0), chargedCostUsd: states.reduce((n, s) => n + s.charged.costUsd, 0), chargedElapsedMs: states.reduce((n, s) => n + s.charged.elapsedMs, 0), requestIds: states.map(s => s.request.id), unknownRequestIds: states.filter(s => ['reserved', 'dispatched', 'uncertain'].includes(s.request.status) || ['inputTokens', 'outputTokens', 'costUsd'].some(key => s.request.usage[key as 'inputTokens'] === null)).map(s => s.request.id) };
}
function accounting(actual: Accounting, states: readonly DevelopmentRequestState[], m: DevelopmentAttempt, time: string): void {
  exact(actual, 'grantId,usage,chargedTokens,chargedCostUsd,chargedElapsedMs,requestIds,unknownRequestIds'); exact(actual.usage, 'requests,inputTokens,outputTokens,costUsd,elapsedMs'); validateUsage(actual.usage); unique(actual.requestIds); unique(actual.unknownRequestIds);
  const expected = sum(states, m.grant.id, actual.usage.elapsedMs);
  for (const field of ['grantId', 'chargedTokens', 'chargedElapsedMs'] as const) equal(actual[field], expected[field], 'Original accounting differs from latest physical states');
  for (const field of ['requestIds', 'unknownRequestIds'] as const) equal([...actual[field]].sort(), [...expected[field]].sort(), 'Incomplete original physical request/unknown inventory');
  for (const field of ['requests', 'inputTokens', 'outputTokens'] as const) equal(actual.usage[field], expected.usage[field], 'Raw usage or null uncertainty changed');
  invariant(Math.abs(actual.chargedCostUsd - expected.chargedCostUsd) < 1e-9 && (expected.usage.costUsd === null ? actual.usage.costUsd === null : actual.usage.costUsd !== null && Math.abs(actual.usage.costUsd - expected.usage.costUsd) < 1e-9), 'Forged original cost settlement');
  invariant(actual.usage.elapsedMs >= expected.chargedElapsedMs && actual.usage.elapsedMs >= at(time) - at(m.grant.issuedAt), 'Original grant lifetime/physical elapsed erased');
  invariant(actual.usage.requests <= m.grant.resources.maxRequests && actual.chargedTokens <= m.grant.resources.maxTokens && actual.chargedCostUsd <= m.grant.resources.maxCostUsd && actual.usage.elapsedMs <= m.grant.resources.maxElapsedMs, 'Original grant exceeded');
}
function profiles(states: readonly DevelopmentRequestState[], roles: ReadonlyMap<string, DevelopmentRoleBinding>) { return new Map(states.map(s => [s.request.id, { configurationDigest: s.configurationDigest, model: roles.get(s.roleId)!.profile }])); }

function budgets(states: readonly DevelopmentRequestState[], roles: ReadonlyMap<string, DevelopmentRoleBinding>, m: DevelopmentAttempt): void {
  const check = (items: readonly DevelopmentRequestState[], limit: ResourceEnvelope) => {
    const used = sum(items, m.grant.id, 0), concurrent = items.filter(s => ['reserved', 'dispatched', 'uncertain'].includes(s.request.status)).length;
    invariant(used.usage.requests <= limit.maxRequests && used.chargedTokens <= limit.maxTokens && used.chargedCostUsd <= limit.maxCostUsd && used.chargedElapsedMs <= limit.maxElapsedMs && concurrent <= limit.maxConcurrency, 'Observable original/role budget or concurrency exceeded');
  };
  check(states, m.grant.resources);
  for (const role of roles.values()) check(states.filter(s => s.roleId === role.id), role.resources);
}
function overrun(s: DevelopmentRequestState): boolean { return s.charged.tokens > s.ceiling.tokens || s.charged.costUsd > s.ceiling.costUsd || s.charged.elapsedMs > s.ceiling.elapsedMs; }
function replay(transitions: readonly DevelopmentAccountingTransition[], initial: readonly DevelopmentRequestState[], initialCancelled: boolean, phase: 'behavior' | 'review', startAt: string, endAt: string, r: DevelopmentRegistration, m: DevelopmentAttempt, roles: ReadonlyMap<string, DevelopmentRoleBinding>, trust: DevelopmentEnvelopeTrust, read: BoundedArtifactReader) {
  const latest = new Map(initial.map(s => [s.request.id, s])); let previousTime = at(startAt), rootCancelled = initialCancelled || initial.some(overrun);
  budgets([...latest.values()], roles, m);
    for (const event of transitions) {
      exact(event, 'beforeDigest,state,settlement'); const s = event.state, prior = latest.get(s.request.id), role = roles.get(s.roleId); invariant(role, 'Foreign tail role');
      invariant(at(s.observedAt) >= previousTime && at(s.observedAt) <= at(endAt), 'Tail ordering/deadline changed'); previousTime = at(s.observedAt);
      invariant(at(s.observedAt) >= at(m.grant.issuedAt), 'Physical transition precedes original grant');
      if (phase === 'behavior' && role.kind !== 'observer') invariant(at(s.observedAt) >= at(m.notBefore), 'Candidate/control transition before behavior start');
      if (!prior) {
        invariant(!rootCancelled, 'Cancelled original root cannot reserve new work');
        const elapsed = Math.max(at(s.observedAt) - at(m.grant.issuedAt), [...latest.values()].reduce((n, item) => n + item.charged.elapsedMs, 0));
        invariant(elapsed + s.ceiling.elapsedMs <= m.grant.resources.maxElapsedMs, 'Original wall lifetime plus new elapsed reservation exceeds grant');
        invariant(event.beforeDigest === null && s.request.status === 'reserved' && (phase === 'review' ? ['reviewer', 'observer'].includes(role.kind) : role.kind !== 'reviewer') && event.settlement === null, 'Duplicate/unregistered post-freeze physical request');
      } else {
        invariant(event.beforeDigest === identity(prior), 'Missing exact authenticated request transition');
        const immutable = (v: DevelopmentRequestState) => ({ ...v, observedAt: '', request: developmentRequestIdentity(v.request), charged: null }); equal(immutable(prior), immutable(s), 'Transition changed immutable physical request/role/root');
        invariant((prior.request.status === 'reserved' && ['dispatched', 'failed'].includes(s.request.status)) || (['dispatched', 'uncertain'].includes(prior.request.status) && ['succeeded', 'failed', 'uncertain'].includes(s.request.status)), 'Settled request mutation or unauthorized replay');
        if (s.request.status === 'dispatched') {
          invariant(!rootCancelled, 'Cancelled original root cannot dispatch reserved work');
          invariant(Math.max(at(s.observedAt) - at(m.grant.issuedAt), [...latest.values()].reduce((n, item) => n + item.charged.elapsedMs, 0)) <= m.grant.resources.maxElapsedMs, 'Original root expired before dispatch');
          invariant((phase === 'review' ? ['reviewer', 'observer'].includes(role.kind) : role.kind !== 'reviewer'), 'Candidate/control dispatch continued after B');
        }
      }
      let release = false;
      if (event.settlement) {
        const receipt = authenticate(reviewEnvelopeDomains.settlement, event.settlement, trust.transports); exact(receipt, 'version,registrationDigest,requestIdentityDigest,observedAt,dispatched,status,usage,response'); validateUsage(receipt.usage);
        invariant(receipt.version === 2 && receipt.registrationDigest === identity(r) && receipt.requestIdentityDigest === developmentRequestIdentity(s.request) && receipt.status === s.request.status && at(receipt.observedAt) >= (prior ? at(prior.observedAt) : at(startAt)) && at(receipt.observedAt) <= at(s.observedAt), 'Forged/substituted transport settlement');
        equal(receipt.usage, s.request.usage, 'Settlement usage changed');
        release = prior?.request.status === 'reserved' && receipt.status === 'failed' && receipt.dispatched === false;
        invariant(release || receipt.dispatched === true && prior && ['dispatched', 'uncertain'].includes(prior.request.status), 'Settlement forged dispatch ordering');
        if (receipt.status === 'succeeded') invariant(receipt.response, 'Successful settlement lacks retained response bytes');
        if (release) invariant(receipt.usage.inputTokens === 0 && receipt.usage.outputTokens === 0 && receipt.usage.costUsd === 0 && receipt.usage.elapsedMs === 0, 'Unlaunched release claims physical usage');
        if (receipt.response) read(receipt.response, m.limits.maxArtifactBytes);
      } else if (prior) {
        if (s.request.status === 'dispatched') equal(s.request.usage, prior.request.usage, 'Dispatch forged raw provider usage');
        else invariant(s.request.status === 'uncertain' && ['inputTokens', 'outputTokens', 'costUsd'].every(k => s.request.usage[k as 'inputTokens'] === null) && s.request.usage.elapsedMs >= prior.request.usage.elapsedMs, 'Settlement requires authenticated transport receipt');
      }
      state(s, r, roles, read, release); latest.set(s.request.id, s); rootCancelled ||= overrun(s); budgets([...latest.values()], roles, m);
      if (s.request.parentRequestId) invariant(latest.has(s.request.parentRequestId), 'Foreign/missing parent physical request');
    }
  return { latest, previousTime, rootCancelled };
}

/** Host collector returns an unsigned B; the qualified observer signs these exact bytes. */
export function collectDevelopmentBehavior(document: Signed<DevelopmentRegistration>, manifest: Signed<DevelopmentAttempt>, observations: Signed<DevelopmentObservation>[], requests: DevelopmentRequestState[], transitions: DevelopmentAccountingTransition[], frozenAt: string, trust: DevelopmentEnvelopeTrust, reader: BoundedArtifactReader, now = Date.now()): DevelopmentBehavior {
  const input = inertSnapshot({ document, manifest, observations, requests, transitions, frozenAt });
  const { r, m, roles } = registration(input.document, input.manifest, trust, now), storage = retained(reader, m.limits);
  unique([...r.originalRequests, ...input.requests].map(s => s.request.id));
  invariant(input.observations.length + r.originalRequests.length + input.requests.length + input.transitions.length <= m.limits.maxRecords, 'Behavior record allowance exceeded');
  for (const s of r.originalRequests) { state(s, r, roles, storage.read); invariant(at(s.observedAt) >= at(m.grant.issuedAt) && at(s.observedAt) <= at(r.registeredAt), 'Original inventory outside original clock anchor'); }
  accounting(m.grant.originalAccounting, r.originalRequests, m, m.registeredAt);
  for (const s of input.requests) { const role = state(s, r, roles, storage.read); invariant(role.kind !== 'reviewer' && at(s.observedAt) <= at(input.frozenAt), 'Reviewer work or late request inside B'); }
  const history = replay(input.transitions, r.originalRequests, r.rootCancelled, 'behavior', r.registeredAt, input.frozenAt, r, m, roles, trust, storage.read);
  equal([...history.latest.values()].sort((a, b) => a.request.id.localeCompare(b.request.id)), [...r.originalRequests, ...input.requests].sort((a, b) => a.request.id.localeCompare(b.request.id)), 'Missing/incomplete behavioral physical transition history');
  const recorded = input.observations.filter(o => o.value.data.kind === 'request');
  equal(recorded.map(o => o.value.data.kind === 'request' ? o.value.data.request.id : '').sort(), input.requests.map(s => s.request.id).sort(), 'Behavior physical request inventory omitted or duplicated');
  for (const o of recorded) {
    const d = o.value.data; invariant(d.kind === 'request', 'Expected request'); const s = input.requests.find(s => s.request.id === d.request.id)!;
    equal({ request: d.request, ceiling: d.ceiling, charged: d.charged, payload: d.payload, prompt: d.prompt }, { request: s.request, ceiling: s.ceiling, charged: s.charged, payload: s.payload, prompt: s.prompt }, 'Behavior request bytes/state changed');
    invariant(o.value.configurationDigest === s.configurationDigest && at(o.value.observedAt) === at(s.observedAt), 'Original observed role configuration/time mismatch');
  }
  const evidence = collectDevelopmentEvidenceProjection(input.manifest, input.observations, trust.behavior, storage.read, profiles(input.requests, roles), now).evidence;
  const end = input.observations.filter(o => o.value.data.kind === 'end'); invariant(end.length === 1 && at(end[0]!.value.observedAt) === at(input.frozenAt) && at(input.frozenAt) <= at(m.deadlineAt), 'B freeze must equal original behavioral stopping point');
  invariant(evidence.finalAccounting, 'Missing freeze-time A0'); accounting(evidence.finalAccounting, [...r.originalRequests, ...input.requests], m, input.frozenAt);
  storage.scan({ manifest: input.manifest, observations: input.observations, requests: input.requests, transitions: input.transitions, originalRequests: r.originalRequests });
  const behavior: DevelopmentBehavior = { version: 2, registrationDigest: identity(r), frozenAt: input.frozenAt, manifest: input.manifest, observations: input.observations, requests: input.requests, transitions: input.transitions, rootCancelled: history.rootCancelled, evidence, artifactIndex: storage.index() };
  invariant(Buffer.byteLength(canonicalJson(behavior)) + behavior.artifactIndex.reduce((n, a) => n + a.bytes, 0) <= m.limits.maxEvidenceBytes, 'Behavior evidence allowance exceeded');
  return behavior;
}

/** Offline deterministic join; semantic judgments still come only from the frozen witness rules. */
export function prepareDevelopmentReviewEnvelope(input: DevelopmentReviewEnvelope, trust: DevelopmentEnvelopeTrust, reader: BoundedArtifactReader, now = Date.now()): ProposedDevelopmentEnvelope {
  const envelope = inertSnapshot(input), findings: Finding[] = []; let behavioralReview: ProposedDevelopment | null = null, finalAccounting: Accounting | null = null;
  const fail = (code: string, error: unknown) => findings.push({ code, status: error instanceof DevelopmentArtifactUnavailable ? 'unavailable' as const : 'failed' as const, detail: String(error) });
  try {
    exact(envelope, 'version,registration,behavior,reviews,accountingTail,closure'); invariant(envelope.version === 2, 'Unsupported envelope version');
    const observer = new Map([[trust.behavior.observer.id, trust.behavior.observer.key]]);
    const b = authenticate(reviewEnvelopeDomains.behavior, envelope.behavior, observer); exact(b, 'version,registrationDigest,frozenAt,manifest,observations,requests,transitions,rootCancelled,evidence,artifactIndex'); invariant(b.version === 2, 'Unsupported B version');
    const { r, m, roles } = registration(envelope.registration, b.manifest, trust, now);
    const storage = retained(reader, m.limits, Buffer.byteLength(canonicalJson(envelope)));
    const collected = collectDevelopmentBehavior(envelope.registration, b.manifest, b.observations, b.requests, b.transitions, b.frozenAt, trust, storage.read, now); equal(b, collected, 'Changed immutable B/evidence/artifact index');
    const behaviorDigest = identity(b), reviews: Signed<DevelopmentReview>[] = []; invariant(envelope.reviews.length <= 2, 'At most two independent review bindings'); unique(envelope.reviews.map(v => v.signer));
    for (const signed of envelope.reviews) {
      const reviewer = trust.behavior.reviewers.get(signed.signer); invariant(reviewer, 'Unqualified reviewer'); const v = authenticate(reviewEnvelopeDomains.review, signed, new Map([[signed.signer, reviewer.key]]));
      exact(v, 'version,registrationDigest,behaviorDigest,roleId,review,execution'); const role = roles.get(v.roleId);
      invariant(v.version === 2 && v.registrationDigest === identity(r) && v.behaviorDigest === behaviorDigest && role?.kind === 'reviewer' && role.assignmentId === signed.signer && v.review.signer === signed.signer, 'Review changed B/assigned role');
      invariant(at(v.review.value.reviewedAt) >= at(b.frozenAt) && at(v.review.value.reviewedAt) <= at(r.reviewDeadlineAt) && at(v.review.value.reviewedAt) <= now, 'Review outside original completion deadline'); reviews.push(v.review);
    }
    behavioralReview = prepareDevelopmentEvidenceProjection(b.manifest, b.observations, reviews, trust.behavior, storage.read, profiles(b.requests, roles), now).result;
    findings.push(...behavioralReview.findings);
    const tail = authenticate(reviewEnvelopeDomains.tail, envelope.accountingTail, observer); exact(tail, 'version,registrationDigest,behaviorDigest,transitions');
    invariant(tail.version === 2 && tail.registrationDigest === identity(r) && tail.behaviorDigest === behaviorDigest, 'Tail changed registration/B');
    invariant(b.observations.length + r.originalRequests.length + b.requests.length + b.transitions.length + tail.transitions.length + envelope.reviews.length <= m.limits.maxRecords, 'Joined bounded record allowance exceeded');
    const { latest, previousTime, rootCancelled } = replay(tail.transitions, [...r.originalRequests, ...b.requests], b.rootCancelled, 'review', b.frozenAt, r.reviewDeadlineAt, r, m, roles, trust, storage.read);
    storage.scan(envelope);
    if (!envelope.closure) findings.push({ code: 'closure', status: 'unavailable', detail: 'Missing final original-grant closure' });
    else {
      const c = authenticate(reviewEnvelopeDomains.closure, envelope.closure, new Map([[trust.closure.id, trust.closure.key]])); exact(c, 'version,registrationDigest,behaviorDigest,tailDigest,reviewDigests,closedAt,rootCancelled,requestStates,accounting');
      invariant(typeof c.rootCancelled === 'boolean' && c.rootCancelled === rootCancelled, 'Closure erased original root cancellation');
      invariant(c.version === 2 && c.registrationDigest === identity(r) && c.behaviorDigest === behaviorDigest && c.tailDigest === identity(tail), 'Closure changed B/T/registration');
      equal([...c.reviewDigests].sort(), envelope.reviews.map(v => identity(v.value)).sort(), 'Closure omits/changes independent judgments');
      invariant(at(c.closedAt) >= previousTime && envelope.reviews.every(v => at(v.value.review.value.reviewedAt) <= at(c.closedAt)) && at(c.closedAt) <= at(r.reviewDeadlineAt) && at(c.closedAt) <= at(m.grant.expiresAt) && at(c.closedAt) <= now, 'Closure after original expiry or before charged work');
      unique(c.requestStates.map(v => v.id)); for (const v of c.requestStates) { exact(v, 'id,stateDigest'); digest(v.stateDigest); }
      equal([...c.requestStates].sort((a, b) => a.id.localeCompare(b.id)), [...latest].map(([id, s]) => ({ id, stateDigest: identity(s) })).sort((a, b) => a.id.localeCompare(b.id)), 'Closure physical inventory omitted tail retry/state');
      const states = [...latest.values()]; accounting(c.accounting, states, m, c.closedAt);
      for (const role of roles.values()) {
        const used = sum(states.filter(s => s.roleId === role.id), m.grant.id, 0), limit = role.resources;
        invariant(used.usage.requests <= limit.maxRequests && used.chargedTokens <= limit.maxTokens && used.chargedCostUsd <= limit.maxCostUsd && used.chargedElapsedMs <= limit.maxElapsedMs, 'Registered role sublimit exceeded');
      }
      if (c.accounting.unknownRequestIds.length) findings.push({ code: 'unknown-tail', status: 'unavailable', detail: 'Original unresolved physical charges/outcomes remain' });
      finalAccounting = c.accounting;
    }
  } catch (error) { fail('envelope', error); }
  return { kind: 'proposed-development-review-envelope', version: 2, envelope, behaviorDigest: identity(envelope.behavior.value), behavioralReview, finalAccounting, findings, status: findings.some(f => f.status === 'failed') ? 'failed' : findings.length ? 'unavailable' : 'mechanically-prepared', automaticReleaseEligible: false, h1Eligible: false };
}
