import { canonicalJson, digest, identity, integer, invariant, validateCandidate, validateCapturedPrompt, validatePhysicalRequest, validateUsage, type ArtifactRef, type CandidateManifest, type PhysicalRequest, type PromptManifest, type ResourceEnvelope, type ResourceUsage } from '../../packages/contracts/index.ts';
import { validateEnvelope } from '../../deployment/config.ts';
import { validateModelProfile, type ModelProfile } from '../../deployment/model-grants.ts';
import { defaultArtifactLimits, hashBytes, type FrozenCandidate } from '../../packages/release/artifacts.ts';
import { authenticate, inertSnapshot, type Signed } from '../qualification/manifest.ts';
import type { Family } from './assess.ts';

export const domains = Object.freeze({ attempt: 'aeon.development.attempt.v1', observation: 'aeon.development.observation.v1', review: 'aeon.development.review.v1' });
export const families: readonly Family[] = ['transfer', 'belief-revision', 'inquiry', 'judgment'];
export const controlKinds = ['no-memory', 'no-standing-goals', 'scripted-praise', 'always-agree', 'always-oppose'] as const;
export const boundaries = ['restart', 'contextReduction', 'laterRetrieval', 'spontaneousInitiative', 'contradictoryFeedback', 'nonApplicableRule'] as const;
type Boundary = typeof boundaries[number];
type ControlKind = typeof controlKinds[number];
type Outcome = 'pass' | 'fail' | 'unavailable';
export interface Accounting {
  grantId: string; usage: ResourceUsage; chargedTokens: number; chargedCostUsd: number;
  requestIds: string[]; unknownRequestIds: string[];
}
export interface DevelopmentAttempt {
  version: 1; id: string; evidenceKind: 'synthetic' | 'live-development'; candidate: CandidateManifest;
  protocolDigest: string; acquisitionDigest: string; priorPolicyDigest: string;
  candidateArtifact: ArtifactRef; configurationArtifact: ArtifactRef; schedulerWindowMs: number; contextWindowTokens: number;
  grant: { id: string; issuedAt: string; expiresAt: string; resources: ResourceEnvelope; originalAccounting: Accounting };
  registeredAt: string; notBefore: string; deadlineAt: string; observerId: string;
  cycles: string[];
  opportunities: { id: string; family: Family; budgetDigest: string; interferenceIds: string[] }[];
  controls: { id: string; kind: ControlKind; budgetDigest: string; opportunityIds: string[] }[];
  boundaries: Boundary[];
  reviewers: { id: string; contextDigest: string }[];
  limits: { maxRecords: number; maxArtifactBytes: number; maxEvidenceBytes: number };
}
type ObservationData =
  | { kind: 'start' }
  | { kind: 'end'; accounting: Accounting }
  | { kind: 'cycle'; assignmentId: string; runId: string; selectionId: string }
  | { kind: 'learning'; opportunityId: string }
  | { kind: 'experience'; assignmentId: string; episodeId: string }
  | { kind: 'opportunity'; assignmentId: string; result: 'completed' | 'failed' | 'unavailable'; feedback: ArtifactRef; audienceBoundaryPreserved: boolean }
  | { kind: 'control'; assignmentId: string; result: 'completed' | 'failed' | 'unavailable' }
  | { kind: 'boundary'; boundary: Boundary; beforeState: ArtifactRef; afterState: ArtifactRef; openWorkIds: string[]; contextInputTokens: number }
  | { kind: 'request'; request: PhysicalRequest; ceiling: { tokens: number; costUsd: number; elapsedMs: number }; charged: { tokens: number; costUsd: number; elapsedMs: number }; payload: ArtifactRef; prompt: ArtifactRef | null }
  | { kind: 'intervention'; reason: string }
  | { kind: 'invariant-violation'; boundary: 'privacy' | 'authority' | 'effect'; reason: string };
export interface DevelopmentObservation {
  version: 1; id: string; attemptDigest: string; configurationDigest: string; candidateId: string;
  observedAt: string; artifact: ArtifactRef; data: ObservationData;
}
export interface DevelopmentReview {
  version: 1; attemptDigest: string; evidenceDigest: string; contextDigest: string; reviewedAt: string;
  opportunities: { id: string; outcome: Outcome; judgment: ArtifactRef }[];
  controls: { id: string; outcome: 'valid' | 'invalid' | 'unavailable'; judgment: ArtifactRef }[];
  boundaries: { id: Boundary; outcome: 'valid' | 'invalid' | 'unavailable'; judgment: ArtifactRef }[];
  overall: Outcome; judgment: ArtifactRef;
}
/** Accepted external host policy fixes eligibility, fresh contexts, and separation from authorship.
 * Key possession or a caller-filled independent boolean does not establish these facts. */
export interface DevelopmentTrust {
  acceptedAttemptDigest: string;
  issuers: ReadonlyMap<string, Uint8Array>;
  issuerPrincipals: ReadonlyMap<string, string>;
  observer: { id: string; principalId: string; independenceGroup: string; key: Uint8Array; artifactDigest: string };
  reviewers: ReadonlyMap<string, { key: Uint8Array; principalId: string; independenceGroup: string; contextDigest: string; provenanceDigest: string }>;
  excludedPrincipals: readonly string[];
  excludedIndependenceGroups: readonly string[];
}
/** Reader must enforce maxBytes BEFORE allocation/read (e.g. descriptor-pinned private artifacts).
 * Returned bytes are rehashed here. QualificationStore.readArtifact alone has a broader bound. */
export type BoundedArtifactReader = (artifact: ArtifactRef, maxBytes: number) => Uint8Array;
/** Qualified reader distinguishes unavailable original bytes from hash/shape failures. */
export class DevelopmentArtifactUnavailable extends Error { override name = 'DevelopmentArtifactUnavailable'; }
export interface Finding { status: 'failed' | 'unavailable'; code: string; detail: string }
export interface CollectedDevelopment {
  version: 1; kind: 'proposed-development-evidence'; evidenceKind: DevelopmentAttempt['evidenceKind'];
  manifest: Signed<DevelopmentAttempt>; observations: Signed<DevelopmentObservation>[];
  artifacts: { artifact: ArtifactRef; bytes: number }[]; findings: Finding[];
  trustProvenance: { issuerPrincipal: string; observer: { principalId: string; independenceGroup: string; artifactDigest: string }; reviewers: { id: string; principalId: string; independenceGroup: string; contextDigest: string; provenanceDigest: string }[] };
  originalAccounting: Accounting; finalAccounting: Accounting | null;
}
export interface ProposedDevelopment {
  kind: 'proposed-development-review'; evidence: CollectedDevelopment; evidenceDigest: string;
  reviews: Signed<DevelopmentReview>[]; findings: Finding[];
  status: 'mechanically-prepared' | 'failed' | 'unavailable'; automaticReleaseEligible: false; h1Eligible: false;
}
function exact(value: object, fields: string): void { invariant(Object.keys(value).sort().join(',') === fields.split(',').sort().join(','), `Exact fields required: ${fields}`); }
function id(value: unknown): asserts value is string { invariant(typeof value === 'string' && value.length > 0 && value.length <= 256, 'Bounded identity required'); }
function time(value: string): number { invariant(typeof value === 'string' && Number.isFinite(Date.parse(value)), 'Authenticated timestamp required'); return Date.parse(value); }
function unique(values: readonly string[]): void { values.forEach(id); invariant(new Set(values).size === values.length, 'Duplicate assignment or request identity'); }
function positive(value: number): void { integer(value, 'positive bound'); invariant(value > 0, 'Positive bound required'); }
function money(value: number): void { invariant(Number.isFinite(value) && value >= 0, 'Finite nonnegative charge required'); }
function accounting(a: Accounting): void {
  exact(a, 'grantId,usage,chargedTokens,chargedCostUsd,requestIds,unknownRequestIds'); id(a.grantId);
  exact(a.usage, 'requests,inputTokens,outputTokens,costUsd,elapsedMs'); validateUsage(a.usage);
  integer(a.chargedTokens, 'chargedTokens'); money(a.chargedCostUsd); unique(a.requestIds); unique(a.unknownRequestIds);
  invariant(a.requestIds.length === a.usage.requests && a.unknownRequestIds.every(n => a.requestIds.includes(n)), 'Cumulative request coverage mismatch');
  invariant(a.chargedTokens >= (a.usage.inputTokens ?? 0) + (a.usage.outputTokens ?? 0) && a.chargedCostUsd >= (a.usage.costUsd ?? 0), 'Conservative accounting understates known usage');
  invariant(a.unknownRequestIds.length > 0 || a.usage.inputTokens !== null && a.usage.outputTokens !== null && a.usage.costUsd !== null, 'Unknown usage needs original unresolved request identities');
}
function verifyAttempt(document: Signed<DevelopmentAttempt>, trust: DevelopmentTrust): DevelopmentAttempt {
  const m = authenticate(domains.attempt, document, trust.issuers);
  invariant(identity(m) === trust.acceptedAttemptDigest, 'Attempt lacks accepted external integrity disposition');
  exact(m, 'version,id,evidenceKind,candidate,protocolDigest,acquisitionDigest,priorPolicyDigest,candidateArtifact,configurationArtifact,schedulerWindowMs,contextWindowTokens,grant,registeredAt,notBefore,deadlineAt,observerId,cycles,opportunities,controls,boundaries,reviewers,limits');
  invariant(m.version === 1 && ['synthetic', 'live-development'].includes(m.evidenceKind), 'Unsupported development manifest'); id(m.id); validateCandidate(m.candidate);
  for (const n of ['protocolDigest', 'acquisitionDigest', 'priorPolicyDigest'] as const) digest(m[n]);
  positive(m.schedulerWindowMs); positive(m.contextWindowTokens); id(m.observerId);
  invariant(m.observerId === trust.observer.id, 'Unqualified observer'); digest(trust.observer.artifactDigest);
  id(trust.observer.principalId); id(trust.observer.independenceGroup); id(trust.issuerPrincipals.get(document.signer));
  exact(m.grant, 'id,issuedAt,expiresAt,resources,originalAccounting'); id(m.grant.id); validateEnvelope(m.grant.resources); accounting(m.grant.originalAccounting);
  invariant(m.grant.originalAccounting.grantId === m.grant.id, 'Original grant mismatch');
  invariant(time(m.grant.issuedAt) <= time(m.registeredAt) && time(m.registeredAt) <= time(m.notBefore) && time(m.notBefore) + 3 * m.schedulerWindowMs <= time(m.deadlineAt) && time(m.deadlineAt) <= time(m.grant.expiresAt) && time(m.grant.expiresAt) - time(m.grant.issuedAt) <= m.grant.resources.maxElapsedMs, 'Finite original preregistration/grant cannot cover developmental horizon');
  unique(m.cycles); invariant(m.cycles.length === 3, 'Exactly three preassigned cycles required');
  invariant(m.opportunities.length === 12, 'Exactly twelve preassigned opportunities required'); unique(m.opportunities.map(o => o.id));
  for (const o of m.opportunities) { exact(o, 'id,family,budgetDigest,interferenceIds'); invariant(families.includes(o.family), 'Unsupported opportunity'); digest(o.budgetDigest); unique(o.interferenceIds); invariant(o.family === 'transfer' ? o.interferenceIds.length === 3 : o.interferenceIds.length === 0, 'Three assigned unrelated experiences per transfer required'); }
  invariant(families.every(f => m.opportunities.filter(o => o.family === f).length === 3), 'Three opportunities in every family required');
  invariant(m.controls.length >= 5 && m.controls.length <= 36, 'Bounded preassigned controls required'); unique(m.controls.map(c => c.id));
  for (const c of m.controls) { exact(c, 'id,kind,budgetDigest,opportunityIds'); invariant(controlKinds.includes(c.kind), 'Unsupported control'); digest(c.budgetDigest); unique(c.opportunityIds); invariant(c.opportunityIds.length > 0 && c.opportunityIds.every(n => m.opportunities.some(o => o.id === n && o.budgetDigest === c.budgetDigest)), 'Controls must bind matched opportunity budgets'); }
  for (const k of controlKinds) invariant(m.controls.some(c => c.kind === k), `Missing preregistered control ${k}`);
  for (const k of ['no-memory', 'no-standing-goals']) invariant(m.opportunities.every(o => m.controls.some(c => c.kind === k && c.opportunityIds.includes(o.id))), `Missing matched ${k} assignment`);
  unique(m.boundaries); invariant(identity([...m.boundaries].sort()) === identity([...boundaries].sort()), 'All six boundaries required');
  invariant(m.reviewers.length === 2, 'Two preregistered reviewers required'); unique(m.reviewers.map(r => r.id));
  const principals: string[] = [], groups: string[] = [], reviewKeys: Uint8Array[] = [];
  for (const r of m.reviewers) {
    exact(r, 'id,contextDigest'); digest(r.contextDigest); const accepted = trust.reviewers.get(r.id); invariant(accepted && accepted.contextDigest === r.contextDigest, 'Reviewer lacks accepted fresh context provenance');
    id(accepted.principalId); id(accepted.independenceGroup); digest(accepted.provenanceDigest);
    invariant(![m.candidate.createdBy, trust.issuerPrincipals.get(document.signer), trust.observer.principalId, ...trust.excludedPrincipals].includes(accepted.principalId) && ![trust.observer.independenceGroup, ...trust.excludedIndependenceGroups].includes(accepted.independenceGroup), 'Reviewer is an excluded author/issuer/observer principal');
    invariant(![trust.observer.key, ...trust.issuers.values(), ...reviewKeys].some(key => Buffer.from(key).equals(Buffer.from(accepted.key))), 'Independent roles require separate accepted signing keys');
    principals.push(accepted.principalId); groups.push(accepted.independenceGroup); reviewKeys.push(accepted.key);
  }
  unique(principals); unique(groups);
  exact(m.limits, 'maxRecords,maxArtifactBytes,maxEvidenceBytes');
  for (const [n, cap] of [[m.limits.maxRecords, 512], [m.limits.maxArtifactBytes, 1_000_000], [m.limits.maxEvidenceBytes, 8 * 1024 * 1024]]) { positive(n!); invariant(n! <= cap!, 'Development evidence exceeds host ceiling'); }
  invariant(m.limits.maxArtifactBytes <= m.limits.maxEvidenceBytes, 'Artifact allowance exceeds total bound');
  return m;
}
function artifactReader(m: DevelopmentAttempt, reader: BoundedArtifactReader, artifacts: CollectedDevelopment['artifacts'], initialBytes: number) {
  let used = initialBytes; const seen = new Map<string, Uint8Array>();
  return (ref: ArtifactRef): Uint8Array => {
    exact(ref, 'uri,sha256'); digest(ref.sha256); invariant(ref.uri === `sha256:${ref.sha256}` || ref.uri === `aeon:artifact:${ref.sha256}` || ref.uri === `shell:tools:${ref.sha256}`, 'Retained content-addressed artifact required');
    const prior = seen.get(ref.uri); if (prior) return prior;
    const bound = Math.min(m.limits.maxArtifactBytes, m.limits.maxEvidenceBytes - used); invariant(bound > 0, 'Total evidence allowance exhausted');
    const bytes = Uint8Array.from(reader(ref, bound)); invariant(bytes.byteLength <= bound, 'Reader exceeded artifact allowance'); invariant(hashBytes(bytes) === ref.sha256, 'Retained artifact digest mismatch');
    used += bytes.byteLength; seen.set(ref.uri, bytes); artifacts.push({ artifact: ref, bytes: bytes.byteLength }); return bytes;
  };
}
function observation(o: DevelopmentObservation): void {
  exact(o, 'version,id,attemptDigest,configurationDigest,candidateId,observedAt,artifact,data'); invariant(o.version === 1, 'Unsupported observation'); id(o.id); time(o.observedAt);
  const d = o.data;
  switch (d.kind) {
    case 'start': exact(d, 'kind'); break;
    case 'end': exact(d, 'kind,accounting'); accounting(d.accounting); break;
    case 'cycle': exact(d, 'kind,assignmentId,runId,selectionId'); id(d.assignmentId); id(d.runId); id(d.selectionId); break;
    case 'experience': exact(d, 'kind,assignmentId,episodeId'); id(d.assignmentId); id(d.episodeId); break;
    case 'learning': exact(d, 'kind,opportunityId'); id(d.opportunityId); break;
    case 'opportunity': exact(d, 'kind,assignmentId,result,feedback,audienceBoundaryPreserved'); invariant(typeof d.audienceBoundaryPreserved === 'boolean', 'Explicit disclosure observation required'); invariant(['completed', 'failed', 'unavailable'].includes(d.result), 'Unsupported opportunity result'); id(d.assignmentId); break;
    case 'control': exact(d, 'kind,assignmentId,result'); invariant(['completed', 'failed', 'unavailable'].includes(d.result), 'Unsupported control result'); id(d.assignmentId); break;
    case 'boundary': exact(d, 'kind,boundary,beforeState,afterState,openWorkIds,contextInputTokens'); invariant(boundaries.includes(d.boundary), 'Unsupported boundary'); unique(d.openWorkIds); integer(d.contextInputTokens, 'contextInputTokens'); break;
    case 'request': exact(d, 'kind,request,ceiling,charged,payload,prompt'); validatePhysicalRequest(d.request); for (const charge of [d.ceiling, d.charged]) { exact(charge, 'tokens,costUsd,elapsedMs'); integer(charge.tokens, 'tokens'); money(charge.costUsd); money(charge.elapsedMs); } break;
    case 'intervention': exact(d, 'kind,reason'); id(d.reason); break;
    case 'invariant-violation': exact(d, 'kind,boundary,reason'); invariant(['privacy', 'authority', 'effect'].includes(d.boundary), 'Unsupported invariant violation'); id(d.reason); break;
    default: throw new Error('Unsupported development observation');
  }
}

/** Offline deterministic collection. Reject untrusted manifests before using their limits.
 * Invalid submitted records remain in the proposed evidence, with explicit failed findings. */
export function collectDevelopmentEvidence(manifest: Signed<DevelopmentAttempt>, observations: Signed<DevelopmentObservation>[], trust: DevelopmentTrust, reader: BoundedArtifactReader, now = Date.now()): CollectedDevelopment {
  manifest = inertSnapshot(manifest); observations = inertSnapshot(observations);
  const m = verifyAttempt(manifest, trust); invariant(observations.length <= m.limits.maxRecords, 'Too many developmental records');
  const bytes = Buffer.byteLength(canonicalJson({ manifest, observations })); invariant(bytes <= m.limits.maxEvidenceBytes, 'Submitted evidence exceeds byte allowance');
  const findings: Finding[] = [], artifacts: CollectedDevelopment['artifacts'] = [], read = artifactReader(m, reader, artifacts, bytes);
  const fail = (code: string, detail: string, status: Finding['status'] = 'failed') => findings.push({ code, detail, status });
  try {
    const frozen = JSON.parse(Buffer.from(read(m.candidateArtifact)).toString('utf8')) as FrozenCandidate;
    exact(frozen, 'manifest,files,inputs'); validateCandidate(frozen.manifest);
    invariant(identity(frozen.manifest) === identity(m.candidate) && Array.isArray(frozen.files) && frozen.files.length > 0 && frozen.files.length <= defaultArtifactLimits.maxFiles && identity(frozen.files) === m.candidate.source, 'Retained frozen source manifest mismatch');
    unique(frozen.files.map(f => f.path));
    for (const file of frozen.files) { exact(file, 'path,sha256,executable'); digest(file.sha256); invariant(typeof file.executable === 'boolean' && file.path.split('/').every(p => p.length > 0 && p !== '.' && p !== '..') && !file.path.includes('\\'), 'Invalid retained source inventory'); }
    exact(frozen.inputs, 'dependencies,prompts,model,configuration,controls,createdBy');
    for (const n of ['dependencies', 'prompts', 'model', 'configuration', 'controls'] as const) invariant(identity(frozen.inputs[n]) === m.candidate[n], `Retained frozen ${n} mismatch`);
    invariant(frozen.inputs.createdBy === m.candidate.createdBy, 'Retained source author changed');
  } catch (e) { fail('source', String(e), e instanceof DevelopmentArtifactUnavailable ? 'unavailable' : 'failed'); }
  let model: ModelProfile | undefined;
  try {
    const configuration = JSON.parse(Buffer.from(read(m.configurationArtifact)).toString('utf8')) as { scheduler: { windowMs: number }; model: ModelProfile };
    validateModelProfile(configuration.model);
    invariant(identity(configuration) === m.candidate.configuration && configuration.scheduler.windowMs === m.schedulerWindowMs && configuration.model.contextWindow === m.contextWindowTokens && identity(configuration.model) === m.candidate.model, 'Actual retained configuration/window/model changed');
    model = configuration.model;
  } catch (e) { fail('configuration', String(e), e instanceof DevelopmentArtifactUnavailable ? 'unavailable' : 'failed'); }
  const verified: DevelopmentObservation[] = [], seen = new Set<string>();
  for (const document of observations) {
    try {
      const o = authenticate(domains.observation, document, new Map([[trust.observer.id, trust.observer.key]])); observation(o);
      invariant(o.attemptDigest === identity(m) && o.configurationDigest === m.candidate.configuration && o.candidateId === m.candidate.id, 'Cross-attempt/source/configuration observation');
      invariant(time(o.observedAt) >= time(m.notBefore) && time(o.observedAt) <= time(m.deadlineAt) && time(o.observedAt) <= now, 'Observation outside original window/deadline');
      invariant(!seen.has(o.id), 'Duplicate observation identity'); seen.add(o.id); read(o.artifact);
      if (o.data.kind === 'opportunity') read(o.data.feedback);
      if (o.data.kind === 'boundary') { read(o.data.beforeState); read(o.data.afterState); }
      if (o.data.kind === 'request') {
        const d = o.data; invariant(d.payload.sha256 === d.request.requestDigest, 'Physical payload binding mismatch'); const payload = read(d.payload);
        if (d.request.provider === 'effect-receiver') invariant(d.prompt === null, 'Effect receivers have no model prompt');
        else {
          invariant(model && d.request.provider === (model.provider ?? 'mistral') && d.request.model === model.id && d.prompt !== null, 'Physical request changed configured provider/model or lacks captured prompt');
          const captured = JSON.parse(Buffer.from(read(d.prompt)).toString('utf8')) as { manifest: PromptManifest; artifact: ArtifactRef };
          exact(captured, 'manifest,artifact'); invariant(captured.manifest.id === d.request.promptManifestId && captured.artifact.sha256 === d.request.requestDigest, 'Captured prompt/request identity mismatch');
          validateCapturedPrompt(captured.manifest, Buffer.from(payload).toString('utf8')); read(captured.artifact); for (const fragment of captured.manifest.fragments) read(fragment.artifact);
        }
      }
      verified.push(o);
    } catch (e) { fail('record', String(e), e instanceof DevelopmentArtifactUnavailable ? 'unavailable' : 'failed'); }
  }
  const of = (kind: ObservationData['kind']) => verified.filter(o => o.data.kind === kind);
  const one = (items: DevelopmentObservation[], label: string) => { if (items.length !== 1) { fail('coverage', `Exactly one ${label} required`, items.length === 0 ? 'unavailable' : 'failed'); return undefined; } return items[0]; };
  const start = one(of('start'), 'authenticated start'), end = one(of('end'), 'authenticated end');
  if (start && end) {
    if (time(end.observedAt) - time(start.observedAt) < 3 * m.schedulerWindowMs) fail('horizon', 'Three actual scheduler windows required');
    for (const o of verified) if (time(o.observedAt) < time(start.observedAt) || time(o.observedAt) > time(end.observedAt)) fail('timeline', `${o.id}: outside authenticated start/end`);
  }
  const cycles = m.cycles.map(n => one(of('cycle').filter(o => o.data.kind === 'cycle' && o.data.assignmentId === n), `cycle ${n}`)).filter(o => o !== undefined).sort((a, b) => time(a.observedAt) - time(b.observedAt));
  if (new Set(cycles.map(o => o.data.kind === 'cycle' ? o.data.runId : '')).size !== cycles.length || new Set(cycles.map(o => o.data.kind === 'cycle' ? o.data.selectionId : '')).size !== cycles.length) fail('cycles', 'Cycle assignments reuse a run or scheduler selection');
  if (start && cycles.some((o, i) => time(o.observedAt) < time(start.observedAt) + m.schedulerWindowMs || i > 0 && time(o.observedAt) - time(cycles[i - 1]!.observedAt) < m.schedulerWindowMs)) fail('cycles', 'Three distinct cycles must span the actual windows');
  for (const n of m.boundaries) {
    const o = one(of('boundary').filter(o => o.data.kind === 'boundary' && o.data.boundary === n), `boundary ${n}`);
    if (o?.data.kind === 'boundary' && (n === 'restart' && o.data.openWorkIds.length === 0 || n === 'contextReduction' && o.data.contextInputTokens <= m.contextWindowTokens)) fail('boundary', `${n}: missing actual open work/context overflow`);
  }
  for (const c of m.controls) {
    const o = one(of('control').filter(o => o.data.kind === 'control' && o.data.assignmentId === c.id), `control ${c.id}`);
    if (o?.data.kind === 'control' && o.data.result !== 'completed') fail('control', `${c.id}: ${o.data.result} control retained`, o.data.result === 'unavailable' ? 'unavailable' : 'failed');
  }
  for (const p of m.opportunities) {
    const o = one(of('opportunity').filter(o => o.data.kind === 'opportunity' && o.data.assignmentId === p.id), `opportunity ${p.id}`);
    if (o?.data.kind === 'opportunity') {
      if (!o.data.audienceBoundaryPreserved) fail('disclosure', `${p.id}: observed audience violation`);
      if (o.data.result === 'unavailable') fail('opportunity', `${p.id}: unavailable outcome retained`, 'unavailable');
    }
    if (p.family !== 'transfer') continue;
    const learned = one(of('learning').filter(o => o.data.kind === 'learning' && o.data.opportunityId === p.id), `learning ${p.id}`);
    const experiences = p.interferenceIds.map(n => one(of('experience').filter(o => o.data.kind === 'experience' && o.data.assignmentId === n), `experience ${n}`));
    if (new Set(experiences.filter(e => e !== undefined).map(e => e.data.kind === 'experience' ? e.data.episodeId : '')).size !== experiences.filter(e => e !== undefined).length) fail('transfer', `${p.id}: interference assignments reuse an episode`);
    if (learned && o && (time(o.observedAt) - time(learned.observedAt) < m.schedulerWindowMs || experiences.some(e => !e || time(e.observedAt) <= time(learned.observedAt) || time(e.observedAt) >= time(o.observedAt)))) fail('transfer', `${p.id}: actual delay/intervening experiences missing`);
  }
  for (const o of verified) {
    const d = o.data;
    if (d.kind === 'invariant-violation') fail('invariant', `${d.boundary}: ${d.reason}`);
    if (d.kind === 'cycle' && !m.cycles.includes(d.assignmentId) || d.kind === 'opportunity' && !m.opportunities.some(p => p.id === d.assignmentId) || d.kind === 'control' && !m.controls.some(c => c.id === d.assignmentId) || d.kind === 'experience' && !m.opportunities.some(p => p.interferenceIds.includes(d.assignmentId)) || d.kind === 'learning' && !m.opportunities.some(p => p.family === 'transfer' && p.id === d.opportunityId)) fail('assignment', `${o.id}: unregistered assignment`);
  }
  const finalAccounting = end?.data.kind === 'end' ? end.data.accounting : null;
  try {
    invariant(start && end && finalAccounting, 'Missing final original-grant accounting');
    const original = m.grant.originalAccounting, requests = of('request').map(o => { invariant(o.data.kind === 'request', 'request'); return o.data; });
    const requestIds = [...original.requestIds], unknown = [...original.unknownRequestIds];
    let tokens = original.chargedTokens, cost = original.chargedCostUsd, input = original.usage.inputTokens, output = original.usage.outputTokens, actualCost = original.usage.costUsd;
    for (const r of requests) {
      invariant(!requestIds.includes(r.request.id), 'Duplicated original physical request'); requestIds.push(r.request.id);
      const usage = r.request.usage;
      invariant(r.charged.tokens >= (usage.inputTokens === null || usage.outputTokens === null ? r.ceiling.tokens : usage.inputTokens + usage.outputTokens) && r.charged.costUsd >= (usage.costUsd ?? r.ceiling.costUsd), 'Unknown physical usage lost conservative original reservation');
      if (usage.inputTokens === null || usage.outputTokens === null || usage.costUsd === null || ['reserved', 'dispatched', 'uncertain'].includes(r.request.status)) unknown.push(r.request.id);
      tokens += r.charged.tokens; cost += r.charged.costUsd;
      input = input === null || usage.inputTokens === null ? null : input + usage.inputTokens;
      output = output === null || usage.outputTokens === null ? null : output + usage.outputTokens;
      actualCost = actualCost === null || usage.costUsd === null ? null : actualCost + usage.costUsd;
    }
    invariant(finalAccounting.grantId === m.grant.id && identity([...requestIds].sort()) === identity([...finalAccounting.requestIds].sort()) && identity([...unknown].sort()) === identity([...finalAccounting.unknownRequestIds].sort()), 'Incomplete original cumulative request/uncertainty coverage');
    invariant(finalAccounting.usage.requests === requestIds.length && finalAccounting.usage.inputTokens === input && finalAccounting.usage.outputTokens === output && (actualCost === null ? finalAccounting.usage.costUsd === null : finalAccounting.usage.costUsd !== null && Math.abs(finalAccounting.usage.costUsd - actualCost) < 1e-9) && finalAccounting.chargedTokens === tokens && Math.abs(finalAccounting.chargedCostUsd - cost) < 1e-9, 'Original cumulative usage differs from retained physical charges');
    invariant(finalAccounting.usage.elapsedMs >= original.usage.elapsedMs + time(end.observedAt) - time(start.observedAt), 'Original elapsed usage reset');
    const limit = m.grant.resources;
    invariant(requestIds.length <= limit.maxRequests && tokens <= limit.maxTokens && cost <= limit.maxCostUsd && finalAccounting.usage.elapsedMs <= limit.maxElapsedMs, 'Original resource grant exceeded');
    if (unknown.length) fail('unknown-usage', 'Unknown usage/outcomes retained with conservative original charges', 'unavailable');
  } catch (e) { fail('accounting', String(e)); }
  const trustProvenance = { issuerPrincipal: trust.issuerPrincipals.get(manifest.signer)!, observer: { principalId: trust.observer.principalId, independenceGroup: trust.observer.independenceGroup, artifactDigest: trust.observer.artifactDigest }, reviewers: m.reviewers.map(r => { const accepted = trust.reviewers.get(r.id)!; return { id: r.id, principalId: accepted.principalId, independenceGroup: accepted.independenceGroup, contextDigest: accepted.contextDigest, provenanceDigest: accepted.provenanceDigest }; }) };
  return { version: 1, kind: 'proposed-development-evidence', evidenceKind: m.evidenceKind, manifest, observations, artifacts, findings, trustProvenance, originalAccounting: m.grant.originalAccounting, finalAccounting };
}

/** Collect first, give identity(evidence) and artifact access to the two accepted fresh reviewers,
 * then prepare using their separately signed dispositions. This never signs release evidence. */
export function prepareDevelopmentEvidence(manifest: Signed<DevelopmentAttempt>, observations: Signed<DevelopmentObservation>[], reviews: Signed<DevelopmentReview>[], trust: DevelopmentTrust, reader: BoundedArtifactReader, now = Date.now()): ProposedDevelopment {
  const evidence = collectDevelopmentEvidence(manifest, observations, trust, reader, now), m = evidence.manifest.value, evidenceDigest = identity(evidence);
  reviews = inertSnapshot(reviews); invariant(reviews.length <= 2, 'At most two fixed reviewer dispositions');
  const findings = [...evidence.findings];
  const fail = (code: string, detail: string, status: Finding['status'] = 'failed') => findings.push({ status, code, detail });
  const initialBytes = Buffer.byteLength(canonicalJson({ evidence, reviews })) + evidence.artifacts.reduce((n, a) => n + a.bytes, 0);
  invariant(initialBytes <= m.limits.maxEvidenceBytes, 'Review evidence exceeds original byte allowance');
  const read = artifactReader(m, reader, [], initialBytes), accepted = new Map<string, DevelopmentReview>();
  for (const document of reviews) {
    try {
      const role = trust.reviewers.get(document.signer); invariant(role && m.reviewers.some(r => r.id === document.signer), 'Unauthorized reviewer');
      const r = authenticate(domains.review, document, new Map([[document.signer, role.key]]));
      exact(r, 'version,attemptDigest,evidenceDigest,contextDigest,reviewedAt,opportunities,controls,boundaries,overall,judgment');
      invariant(r.version === 1 && r.attemptDigest === identity(m) && r.evidenceDigest === evidenceDigest && r.contextDigest === role.contextDigest, 'Review does not bind this exact attempt/evidence/fresh context');
      const end = evidence.observations.find(o => o.value.data.kind === 'end'); invariant(end && time(r.reviewedAt) >= time(end.value.observedAt) && time(r.reviewedAt) <= now, 'Review outside authenticated completion/fresh time');
      invariant(!accepted.has(document.signer), 'Duplicate reviewer disposition'); read(r.judgment);
      for (const [items, expected] of [[r.opportunities, m.opportunities.map(o => o.id)], [r.controls, m.controls.map(c => c.id)], [r.boundaries, m.boundaries]] as const) {
        invariant(items.length === expected.length, 'Incomplete reviewer case coverage'); unique(items.map(o => o.id)); invariant(identity(items.map(o => o.id).sort()) === identity([...expected].sort()), 'Review replaced assigned cases');
        for (const item of items) { exact(item, 'id,outcome,judgment'); invariant(['pass', 'fail', 'unavailable', 'valid', 'invalid'].includes(item.outcome), 'Missing qualitative disposition'); read(item.judgment); }
      }
      invariant(['pass', 'fail', 'unavailable'].includes(r.overall) && r.opportunities.every(o => ['pass', 'fail', 'unavailable'].includes(o.outcome)) && [...r.controls, ...r.boundaries].every(o => ['valid', 'invalid', 'unavailable'].includes(o.outcome)), 'Unsupported qualitative judgment');
      accepted.set(document.signer, r);
    } catch (e) { fail('review', String(e), e instanceof DevelopmentArtifactUnavailable ? 'unavailable' : 'failed'); }
  }
  if (accepted.size !== 2) fail('reviews', 'Two eligible independently authenticated fresh dispositions required', 'unavailable');
  if (accepted.size === 2) {
    const [a, b] = [...accepted.values()];
    const projection = (r: DevelopmentReview) => ({ overall: r.overall, opportunities: r.opportunities.map(({ id, outcome }) => ({ id, outcome })).sort((a, b) => a.id.localeCompare(b.id)), controls: r.controls.map(({ id, outcome }) => ({ id, outcome })).sort((a, b) => a.id.localeCompare(b.id)), boundaries: r.boundaries.map(({ id, outcome }) => ({ id, outcome })).sort((a, b) => a.id.localeCompare(b.id)) });
    const agree = identity(projection(a!)) === identity(projection(b!));
    if (!agree) fail('disagreement', 'Unresolved independent reviewer disagreement retained', 'unavailable');
    for (const r of agree ? [a!, b!] : []) {
      if (r.overall !== 'pass') fail('qualitative', `Reviewer overall ${r.overall}`, r.overall === 'unavailable' ? 'unavailable' : 'failed');
      for (const item of [...r.controls, ...r.boundaries]) if (item.outcome !== 'valid') fail('qualitative', `${item.id}: reviewer ${item.outcome}`, item.outcome === 'unavailable' ? 'unavailable' : 'failed');
      for (const item of r.opportunities) {
        const observation = evidence.observations.find(o => o.value.data.kind === 'opportunity' && o.value.data.assignmentId === item.id);
        if (item.outcome === 'pass' && observation?.value.data.kind === 'opportunity' && observation.value.data.result !== 'completed') fail('qualitative', `${item.id}: passing judgment contradicts failed/unavailable observation`);
        if (item.outcome === 'unavailable') fail('qualitative', `${item.id}: unavailable judgment retained`, 'unavailable');
      }
      for (const f of families) if (r.opportunities.filter(o => m.opportunities.some(p => p.id === o.id && p.family === f) && o.outcome === 'pass').length < 2) fail('family', `${f}: reviewer has fewer than two verified successes`);
    }
  }
  if (m.evidenceKind === 'synthetic') fail('synthetic', 'Synthetic fixture is permanently ineligible as live developmental evidence', 'unavailable');
  return { kind: 'proposed-development-review', evidence, evidenceDigest, reviews, findings, status: findings.some(f => f.status === 'failed') ? 'failed' : findings.length ? 'unavailable' : 'mechanically-prepared', automaticReleaseEligible: false, h1Eligible: false };
}
