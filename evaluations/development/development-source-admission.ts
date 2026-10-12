import { canonicalJson, digest, identity, invariant, validateMemory, type ArtifactRef, type Observation } from '../../packages/contracts/index.ts';
import type { Document, JournalRef } from '../../packages/storage/index.ts';
import type { MemoryEntry } from '../../packages/development/index.ts';
import { hashBytes } from '../../packages/release/artifacts.ts';
import { authenticate, inertSnapshot, type Signed } from '../qualification/manifest.ts';
import type { AcquisitionAssignmentPacket, DevelopmentAcquisitionPlan } from './acquisition-plan.ts';
import { projectDevelopmentPageSources, type DevelopmentPageSourceInput, type DevelopmentAssignmentSource, type DevelopmentCycleSource, type DevelopmentEventPosition } from './development-observer.ts';
import { developmentOperationalArtifactBytes, type DevelopmentObservation } from './witness.ts';

export const developmentSourceCheckDomain = 'aeon.development.source-check.v1';
export const developmentSourceExtractionId = 'runtime-result-observations-v1';
export interface SourceAdmissionPolicy {
  version: 1; planDigest: string; workload: ArtifactRef | null; checkerId: string | null;
  checkerSourceDigest: string | null; extractorSourceDigest: string | null; rubricDigest: string | null;
  qualification: ArtifactRef | null; clockQualification: ArtifactRef | null;
  bounds: { maxMetadataRecords: number; maxMetadataBytes: number; maxProofBytes: number; maxCheckerBytes: number };
  adaptationOrdinals: { policy: number; workload: number | null; qualification: number | null; clockQualification: number | null;
    learningChecks: { opportunityId: string; ordinal: number }[];
    scriptChecks: { controlId: string; assignmentId: string; ordinal: number }[] };
}
export interface SourceAdmissionTrust {
  acceptedPolicyDigest: string; acceptedQualificationDigest: string | null;
  checker: { id: string; key: Uint8Array; principalId: string; independenceGroup: string } | null;
  acceptedClockQualificationDigest: string | null;
}
export interface DevelopmentWorkload {
  version: 1; scheduleDigest: string; assignmentDigest: string;
  opportunities: { id: string; family: string; roles: { roleId: string; assignmentId: string; learningAssignmentId: string | null; interferenceAssignmentIds: string[]; feedbackAssignmentId: string }[] }[];
  scripts: { controlId: string; roleId: string; cases: { assignmentId: string; feedbackAssignmentId: string }[] }[];
  extractionId: string; rubricId: string; matching: { mediators: string[]; workspaces: string[] };
}
export interface DevelopmentSourceCheck {
  version: 1; planDigest: string; policyDigest: string; roleId: string; opportunityId: string; assignmentIds: string[];
  sourceDigest: string; checkerSourceDigest: string; extractorSourceDigest: string; rubricDigest: string;
  output: ArtifactRef; feedback: ArtifactRef; acquisition: 'completed' | 'failed' | 'unavailable';
  behavior: 'pass' | 'fail' | 'unavailable'; disclosure: 'preserved' | 'violated' | 'unavailable'; matching: 'valid' | 'invalid' | 'unavailable';
  judgments: ArtifactRef[]; checkedAt: string;
}
export interface CaptureBracket { roleId: string; before: ArtifactRef; after: ArtifactRef }
export interface AssignmentSelector extends CaptureBracket { assignmentId: string }
export interface OpportunitySelector extends AssignmentSelector { opportunityId: string; related: AssignmentSelector[] }
export interface SourceInterval { lowerWallMs: number; upperWallMs: number; clockKind: 'host' | 'synthetic'; temporalEligibility: 'synthetic' | 'qualified' | 'unavailable' }
interface CommonProof<K extends string, S> {
  version: 1; kind: K; planDigest: string; policyDigest: string; roleId: string; subjectId: string;
  captures: ArtifactRef[]; interval: SourceInterval; source: S; checks: ArtifactRef[];
}
interface SourceBinding { configurationDigest: string; assignmentPacket: ArtifactRef }
export type DevelopmentAssignmentProof = CommonProof<'assignment', SourceBinding & { assignment: DevelopmentAssignmentSource }> & { output: ArtifactRef | null; input: ArtifactRef; acquisition: DevelopmentSourceCheck['acquisition'] };
export type DevelopmentCycleProof = CommonProof<'cycle', SourceBinding & { cycle: DevelopmentCycleSource }> & { origin: 'request' | 'unknown'; autonomy: 'unavailable' };
export type DevelopmentExperienceProof = CommonProof<'experience', SourceBinding & { assignment: DevelopmentAssignmentSource; episode: JournalRef; ingested: JournalRef; creation: DevelopmentEventPosition }> & { episodeId: string };
export type DevelopmentLearningProof = CommonProof<'learning', SourceBinding & { assignment: DevelopmentAssignmentProof }> & Pick<DevelopmentSourceCheck, 'acquisition' | 'behavior' | 'disclosure' | 'matching'> & { check: Signed<DevelopmentSourceCheck> };
export type DevelopmentOpportunityProof = CommonProof<'opportunity', SourceBinding & { assignment: DevelopmentAssignmentProof; related: DevelopmentAssignmentProof[] }> & Pick<DevelopmentSourceCheck, 'output' | 'feedback' | 'acquisition' | 'behavior' | 'disclosure' | 'matching'> & { check: Signed<DevelopmentSourceCheck> };
export type DevelopmentSourceAdmissionProof = DevelopmentAssignmentProof | DevelopmentCycleProof | DevelopmentExperienceProof | DevelopmentLearningProof | DevelopmentOpportunityProof;
export type SourceAdmissionResult<T> = { status: 'derived'; proof: T } | { status: 'failed' | 'unavailable'; code: string };
/** Host integration facts only. Supplying this context confers no recorder or signing authority. */
export interface SourceAdmissionContext {
  plan: DevelopmentAcquisitionPlan; policy: SourceAdmissionPolicy; trust: SourceAdmissionTrust;
  readArtifact(ref: ArtifactRef, maxBytes: number): Uint8Array;
}
export interface DevelopmentCheckInput {
  kind: 'unsigned-check-input'; evidence: Uint8Array; sourceDigest: string; roleId: string; subjectId: string;
  assignmentIds: string[]; output: ArtifactRef; feedback: ArtifactRef; interval: SourceInterval;
}
export interface SourceCheckBinding {
  roleId: string; subjectId: string; assignmentIds: string[]; sourceDigest: string; output: ArtifactRef; feedback: ArtifactRef;
  acquisition: DevelopmentSourceCheck['acquisition']; completeAt: number; hostNow: number;
  judgmentSlots: ArtifactRef[];
}
const exact = (v: object, keys: string) => invariant(v !== null && typeof v === 'object' && Object.keys(v).sort().join(',') === keys.split(',').sort().join(','), 'Unexpected source-admission fields');
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const id = (s: unknown) => invariant(typeof s === 'string' && s.trim().length > 0 && s.length <= 256, 'Bounded source identity required');
const positive = (n: number) => invariant(Number.isSafeInteger(n) && n > 0, 'Positive safe source bound required');
const time = (s: string) => { const n = Date.parse(s); invariant(Number.isFinite(n), 'Source timestamp required'); return n; };
const ref = (r: ArtifactRef) => { exact(r, 'uri,sha256'); digest(r.sha256); invariant(r.uri === `sha256:${r.sha256}`, 'Retained content reference required'); };
const bytes = (v: unknown) => Buffer.from(canonicalJson(v));
const reference = (b: Uint8Array): ArtifactRef => { const sha256 = hashBytes(b); return { uri: `sha256:${sha256}`, sha256 }; };
function read(c: SourceAdmissionContext, r: ArtifactRef, limit: number): Uint8Array { ref(r); positive(limit); const b = Uint8Array.from(c.readArtifact(inertSnapshot(r), limit)); invariant(b.byteLength <= limit && hashBytes(b) === r.sha256, 'Retained source bytes differ or exceed bound'); return b; }
function json<T>(c: SourceAdmissionContext, r: ArtifactRef, limit: number): T { const b = read(c, r, limit), v = JSON.parse(Buffer.from(b).toString()) as T; invariant(Buffer.from(b).equals(bytes(v)), 'Canonical retained source required'); return inertSnapshot(v); }
function guarded<T>(f: () => T): SourceAdmissionResult<T> { try { return { status: 'derived', proof: f() }; } catch (e) { return { status: e instanceof Unavailable ? 'unavailable' : 'failed', code: String(e instanceof Error ? e.message : e).slice(0, 256) }; } }
class Unavailable extends Error {}
function required<T>(v: T | null | undefined, message: string): T { if (v === null || v === undefined) throw new Unavailable(message); return v; }
function detachContext(c: SourceAdmissionContext): SourceAdmissionContext {
  return { plan: inertSnapshot(c.plan), policy: inertSnapshot(c.policy), trust: { acceptedPolicyDigest: c.trust.acceptedPolicyDigest, acceptedQualificationDigest: c.trust.acceptedQualificationDigest, acceptedClockQualificationDigest: c.trust.acceptedClockQualificationDigest, checker: c.trust.checker ? { ...inertSnapshot({ id: c.trust.checker.id, principalId: c.trust.checker.principalId, independenceGroup: c.trust.checker.independenceGroup }), key: Uint8Array.from(c.trust.checker.key) } : null }, readArtifact: c.readArtifact };
}
/** Validates the detached host policy. It neither claims capacity nor authenticates a plan. */
export function validateSourceAdmissionPolicy(context: SourceAdmissionContext): SourceAdmissionPolicy {
  const c = detachContext(context), p = c.policy, plan = c.plan;
  exact(p, 'version,planDigest,workload,checkerId,checkerSourceDigest,extractorSourceDigest,rubricDigest,qualification,clockQualification,bounds,adaptationOrdinals');
  invariant(p.version === 1 && p.planDigest === identity(plan) && identity(p) === c.trust.acceptedPolicyDigest, 'Pinned policy/plan identity differs');
  const layout = required(plan.captureLayout, 'Complete paged plan required');
  exact(p.bounds, 'maxMetadataRecords,maxMetadataBytes,maxProofBytes,maxCheckerBytes'); Object.values(p.bounds).forEach(positive);
  invariant(p.bounds.maxProofBytes <= layout.proofPool.mandatoryArtifactBytes && p.bounds.maxCheckerBytes <= p.bounds.maxProofBytes, 'Proof/checker bound exceeds mandatory ceiling');
  exact(p.adaptationOrdinals, 'policy,workload,qualification,clockQualification,learningChecks,scriptChecks');
  const a = p.adaptationOrdinals, ordinals = [a.policy];
  for (const k of ['workload', 'qualification', 'clockQualification'] as const) { invariant((p[k] === null) === (a[k] === null), 'Artifact/ordinal null mismatch'); if (p[k]) { ref(p[k]!); ordinals.push(a[k]!); } }
  invariant(Array.isArray(a.learningChecks) && a.learningChecks.length <= 3 && Array.isArray(a.scriptChecks) && a.scriptChecks.length <= 9, 'Bounded receipt import slots required');
  for (const x of a.learningChecks) { exact(x, 'opportunityId,ordinal'); invariant(plan.manifest.value.opportunities.some(o => o.family === 'transfer' && o.id === x.opportunityId), 'Unknown learning import'); ordinals.push(x.ordinal); }
  for (const x of a.scriptChecks) { exact(x, 'controlId,assignmentId,ordinal'); id(x.assignmentId); invariant(plan.manifest.value.controls.some(o => !['no-memory', 'no-standing-goals'].includes(o.kind) && o.id === x.controlId), 'Unknown script import'); ordinals.push(x.ordinal); }
  invariant(ordinals.every(n => Number.isSafeInteger(n) && n >= 0 && n < 54) && new Set(ordinals).size === ordinals.length && ordinals.length <= layout.proofPool.maxArtifacts - layout.proofPool.mandatoryArtifacts, 'Optional ordinal collision/headroom exhausted');
  const semantic = [p.workload, p.checkerId, p.checkerSourceDigest, p.extractorSourceDigest, p.rubricDigest, p.qualification];
  invariant(semantic.every(v => v === null) || semantic.every(v => v !== null), 'Semantic policy must be complete or mechanical-only');
  if (p.workload === null) invariant(c.trust.checker === null && c.trust.acceptedQualificationDigest === null && a.learningChecks.length === 0 && a.scriptChecks.length === 0, 'Mechanical policy cannot carry semantic authority');
  else {
    id(p.checkerId); for (const d of [p.checkerSourceDigest, p.extractorSourceDigest, p.rubricDigest]) digest(d!);
    invariant(a.learningChecks.length === 3 && a.scriptChecks.length === 9 && new Set(a.learningChecks.map(x => x.opportunityId)).size === 3 && new Set(a.scriptChecks.map(x => canonicalJson([x.controlId, x.assignmentId]))).size === 9, 'Full receipt mapping required');
    validateDevelopmentWorkload(c);
  }
  invariant((p.clockQualification === null) === (c.trust.acceptedClockQualificationDigest === null), 'Clock trust null mismatch');
  if (p.clockQualification) {
    invariant(p.clockQualification.sha256 === c.trust.acceptedClockQualificationDigest, 'Clock qualification is not pinned');
    const q = json<{ version: number; sensorDigest: string; disposition: string }>(c, p.clockQualification, p.bounds.maxProofBytes);
    exact(q, 'version,sensorDigest,disposition'); digest(q.sensorDigest); invariant(q.version === 1 && q.disposition === 'accepted', 'Clock qualification unavailable');
  }
  return inertSnapshot(p);
}
export function validateDevelopmentWorkload(context: SourceAdmissionContext): DevelopmentWorkload {
  const c = detachContext(context), p = c.policy, plan = c.plan, r = plan.registration.value, m = plan.manifest.value;
  const w = json<DevelopmentWorkload>(c, required(p.workload, 'Workload qualification unavailable'), p.bounds.maxProofBytes);
  exact(w, 'version,scheduleDigest,assignmentDigest,opportunities,scripts,extractionId,rubricId,matching');
  invariant(w.version === 1 && w.scheduleDigest === identity(required(plan.protocol, 'Protocol required').schedule) && w.assignmentDigest === r.assignmentDigest && w.extractionId === developmentSourceExtractionId, 'Workload/schedule/extraction binding differs'); id(w.rubricId);
  exact(w.matching, 'mediators,workspaces'); for (const list of [w.matching.mediators, w.matching.workspaces]) { invariant(Array.isArray(list) && list.length <= 32 && new Set(list).size === list.length, 'Bounded explicit matching specification required'); list.forEach(id); }
  const packet = json<AcquisitionAssignmentPacket>(c, plan.assignmentPacket, Math.min(plan.manifest.value.limits.maxArtifactBytes, required(plan.captureLayout, 'Paged source layout required').sourcePool.maxBytes));
  invariant(identity(packet) === w.assignmentDigest, 'Workload packet digest differs');
  const seen = new Set<string>();
  const use = (roleId: string, assignmentId: string, phase: string, ordinal: number) => {
    id(roleId); id(assignmentId); const k = canonicalJson([roleId, assignmentId]);
    invariant(packet.assignments.some(a => a.roleId === roleId && a.id === assignmentId) && plan.protocol!.schedule.some(a => a.roleId === roleId && a.assignmentId === assignmentId && a.phase === phase && a.ordinal === ordinal), 'Mapped assignment/phase/ordinal differs'); seen.add(k);
  };
  const behavioral = r.roles.filter(x => x.kind !== 'reviewer'), ablations = behavioral.filter(x => x.kind === 'candidate' || m.controls.some(a => a.id === x.assignmentId && ['no-memory', 'no-standing-goals'].includes(a.kind)));
  invariant(Array.isArray(w.opportunities) && w.opportunities.length === m.opportunities.length && Array.isArray(w.scripts) && w.scripts.length === 3, 'Complete workload required');
  for (const [i, o] of w.opportunities.entries()) {
    exact(o, 'id,family,roles'); invariant(o.id === m.opportunities[i]!.id && o.family === m.opportunities[i]!.family && o.roles.length === ablations.length, 'Manifest opportunity mapping differs');
    for (const [j, x] of o.roles.entries()) {
      exact(x, 'roleId,assignmentId,learningAssignmentId,interferenceAssignmentIds,feedbackAssignmentId'); invariant(x.roleId === ablations[j]!.id, 'Registered role order differs');
      use(x.roleId, x.assignmentId, 'opportunity', i); use(x.roleId, x.feedbackAssignmentId, 'feedback', i);
      const transfers = m.opportunities.filter(v => v.family === 'transfer'), t = transfers.findIndex(v => v.id === o.id);
      invariant((t < 0) === (x.learningAssignmentId === null) && x.interferenceAssignmentIds.length === m.opportunities[i]!.interferenceIds.length && new Set(x.interferenceAssignmentIds).size === x.interferenceAssignmentIds.length, 'Learning/interference mapping differs');
      if (t >= 0) { use(x.roleId, x.learningAssignmentId!, 'learning', t); x.interferenceAssignmentIds.forEach((v, k) => { const interference = [...new Set(transfers.flatMap(v => v.interferenceIds))]; use(x.roleId, v, 'interference', interference.indexOf(m.opportunities[i]!.interferenceIds[k]!)); }); }
    }
  }
  const scriptRoles = behavioral.filter(x => !ablations.includes(x));
  for (const [i, s] of w.scripts.entries()) { exact(s, 'controlId,roleId,cases'); invariant(s.roleId === scriptRoles[i]?.id && s.controlId === scriptRoles[i]?.assignmentId && s.cases.length === 3, 'Script/control mapping differs'); for (const [j, a] of s.cases.entries()) { exact(a, 'assignmentId,feedbackAssignmentId'); use(s.roleId, a.assignmentId, 'script', j); use(s.roleId, a.feedbackAssignmentId, 'script-feedback', j); invariant(p.adaptationOrdinals.scriptChecks.some(x => x.controlId === s.controlId && x.assignmentId === a.assignmentId), 'Script checker import not reserved'); } }
  invariant(seen.size === plan.protocol!.schedule.length && plan.protocol!.schedule.every(a => seen.has(canonicalJson([a.roleId, a.assignmentId]))), 'Workload omitted scheduled exposure');
  for (const role of behavioral) { const rp = required(plan.roles.find(x => x.roleId === role.id), 'Role plan required'), config = json<{ developmentControl?: { workloadDigest?: string } }>(c, rp.configuration, Math.min(m.limits.maxArtifactBytes, required(plan.captureLayout, 'Paged source layout required').sourcePool.maxBytes)); invariant(rp.configuration.sha256 === role.configurationDigest && config.developmentControl?.workloadDigest === p.workload!.sha256, 'Role workload configuration differs'); }
  return w;
}
function qualify(c: SourceAdmissionContext): void {
  const p = c.policy, checker = required(c.trust.checker, 'Checker qualification unavailable'), certificate = required(p.qualification, 'Checker qualification unavailable');
  invariant(certificate.sha256 === c.trust.acceptedQualificationDigest && checker.id === p.checkerId && checker.key.byteLength >= 32, 'Pinned checker qualification differs'); id(checker.principalId); id(checker.independenceGroup);
  const q = json<{ version: number; checkerId: string; checkerSourceDigest: string; extractorSourceDigest: string; rubricDigest: string; workloadDigest: string; principalId: string; independenceGroup: string; disposition: string }>(c, certificate, p.bounds.maxProofBytes);
  exact(q, 'version,checkerId,checkerSourceDigest,extractorSourceDigest,rubricDigest,workloadDigest,principalId,independenceGroup,disposition');
  invariant(q.version === 1 && q.disposition === 'accepted' && q.checkerId === checker.id && q.principalId === checker.principalId && q.independenceGroup === checker.independenceGroup && q.checkerSourceDigest === p.checkerSourceDigest && q.extractorSourceDigest === p.extractorSourceDigest && q.rubricDigest === p.rubricDigest && q.workloadDigest === p.workload?.sha256, 'Public qualification bindings differ');
}
function detachedSource(input: DevelopmentPageSourceInput): DevelopmentPageSourceInput {
  const d = Object.getOwnPropertyDescriptors(input), facts: Record<string, unknown> = {};
  for (const k of ['before', 'after', 'current', 'assignmentPacket', 'roleId', 'configurationDigest', 'pathIdentity', 'journal', 'bounds', 'metadataBounds']) { const descriptor = d[k]; invariant(descriptor && 'value' in descriptor, 'Source input accessors forbidden'); facts[k] = descriptor.value; }
  for (const k of ['readArtifact', 'openAcquiredCapture']) invariant(d[k] && 'value' in d[k]! && typeof d[k]!.value === 'function', 'Bounded synchronous source reader required');
  return { ...inertSnapshot(facts), readArtifact: d.readArtifact!.value, openAcquiredCapture: d.openAcquiredCapture!.value } as DevelopmentPageSourceInput;
}
function finalUse(input: DevelopmentPageSourceInput): void { for (const r of [input.before, input.after, input.current]) input.openAcquiredCapture(r).assertUsableNow(); }
function projection(c: SourceAdmissionContext, original: DevelopmentPageSourceInput) {
  validateSourceAdmissionPolicy(c);
  const selector = inertSnapshot({ before: original.before, after: original.after, current: original.current, roleId: original.roleId, configurationDigest: original.configurationDigest, pathIdentity: original.pathIdentity, journal: original.journal, bounds: original.bounds, assignmentPacket: original.assignmentPacket, metadataBounds: original.metadataBounds });
  invariant(equal(selector.metadataBounds, { maxRecords: c.policy.bounds.maxMetadataRecords, maxBytes: c.policy.bounds.maxMetadataBytes }) && selector.bounds.maxProofBytes <= c.policy.bounds.maxProofBytes && equal(selector.assignmentPacket, c.plan.assignmentPacket), 'Host source bounds/packet differs');
  const role = c.plan.registration.value.roles.find(r => r.id === selector.roleId); invariant(role && role.kind !== 'reviewer' && role.configurationDigest === selector.configurationDigest, 'Source role/configuration differs');
  const input = { ...selector, readArtifact: original.readArtifact, openAcquiredCapture: original.openAcquiredCapture };
  const p = projectDevelopmentPageSources(input); required(p.interval, 'Source clock unavailable');
  if (p.unavailable.some(x => x.subject === 'source')) throw new Unavailable(p.unavailable.find(x => x.subject === 'source')!.reason);
  finalUse(input); return { input, p };
}
function interval(c: SourceAdmissionContext, input: DevelopmentPageSourceInput): SourceInterval {
  const a = inertSnapshot(input.openAcquiredCapture(input.before).manifest.clock), b = inertSnapshot(input.openAcquiredCapture(input.after).manifest.clock);
  invariant(a.kind === b.kind && a.bootId === b.bootId && a.processStart === b.processStart && b.wallMs >= a.wallMs && b.monotonicMs >= a.monotonicMs && Math.abs((b.wallMs - a.wallMs) - (b.monotonicMs - a.monotonicMs)) <= 1000, 'Source clock/process/drift differs');
  return { lowerWallMs: a.wallMs, upperWallMs: b.wallMs, clockKind: b.kind, temporalEligibility: b.kind === 'synthetic' ? 'synthetic' : c.policy.clockQualification && c.trust.acceptedClockQualificationDigest === c.policy.clockQualification.sha256 ? 'qualified' : 'unavailable' };
}
function common<K extends string, S>(c: SourceAdmissionContext, input: DevelopmentPageSourceInput, kind: K, subjectId: string, source: S): CommonProof<K, S> {
  id(subjectId); invariant(`source:${kind}:${input.roleId}:${subjectId}`.length <= 256, 'Observation identity exceeds witness limit');
  return { version: 1, kind, planDigest: c.policy.planDigest, policyDigest: c.trust.acceptedPolicyDigest, roleId: input.roleId, subjectId, captures: [inertSnapshot(input.before), inertSnapshot(input.after)], interval: interval(c, input), source, checks: [] };
}
function committedVersion(input: DevelopmentPageSourceInput, r: JournalRef): Document {
  const reader = input.openAcquiredCapture(input.after); reader.assertUsableNow(); const v = inertSnapshot(reader.resolveJournalVersion(r.versionId)); invariant(equal(v.ref, r) && v.document.revision === r.revision && identity(v.document) === r.sha256, 'Exact source version differs'); reader.assertUsableNow(); return v.document;
}
function assignmentOutput(input: DevelopmentPageSourceInput, a: DevelopmentAssignmentSource): Uint8Array | null {
  if (!a.result) return null;
  const producer = committedVersion(input, a.result.origin.execution).value as unknown as { lastResult: { status: string; observations: Observation[] } };
  invariant(producer.lastResult?.status === a.result.status && equal(producer.lastResult.observations.map(o => o.id), a.result.observationIds), 'Exact result-producing extraction differs');
  const observations: Observation[] = []; let charged = bytes({ status: a.result.status, observations: [] }).byteLength;
  invariant(a.result.observationIds.length <= input.bounds.maxRows, 'Result extraction row bound exceeded');
  for (const o of producer.lastResult.observations) {
    invariant(o.runId === a.runId, 'Result observation run differs');
    const refs = a.proof.versions.filter(v => v.namespace === 'observations' && v.key === o.id);
    invariant(refs.some(r => equal(committedVersion(input, r).value, o)), 'Exact result observation source unavailable');
    const charge = bytes(o).byteLength + (observations.length ? 1 : 0);
    invariant(charge <= input.bounds.maxArtifactBytes - charged, 'Result extraction byte bound exceeded'); charged += charge; observations.push(o);
  }
  const output = bytes({ status: a.result.status, observations }); invariant(output.byteLength === charged, 'Exact extraction accounting differs'); return output;
}
function assignment(c: SourceAdmissionContext, input: DevelopmentPageSourceInput, assignmentId: string): DevelopmentAssignmentProof {
  input = detachedSource(input); const { p } = projection(c, input), a = required(p.assignments.find(a => a.assignmentId === assignmentId), 'Registered new assignment source unavailable');
  const extracted = assignmentOutput(input, a), output = extracted ? reference(extracted) : null;
  const acquisition = a.result?.status === 'completed' ? 'completed' : a.result ? 'failed' : 'unavailable';
  const proof: DevelopmentAssignmentProof = { ...common(c, input, 'assignment', assignmentId, { configurationDigest: input.configurationDigest, assignmentPacket: input.assignmentPacket, assignment: a }), input: reference(bytes({ input: a.input })), output, acquisition };
  encodeDevelopmentSourceProof(proof, c.policy.bounds.maxProofBytes); finalUse(input); return inertSnapshot(proof);
}
export function deriveDevelopmentAssignment(context: SourceAdmissionContext, input: DevelopmentPageSourceInput, assignmentId: string): SourceAdmissionResult<DevelopmentAssignmentProof> { return guarded(() => assignment(detachContext(context), input, assignmentId)); }
/** Fresh extracted bytes for typed output/feedback retention; never an attestation. */
export function extractDevelopmentAssignmentArtifacts(context: SourceAdmissionContext, input: DevelopmentPageSourceInput, assignmentId: string): SourceAdmissionResult<{ input: Uint8Array; output: Uint8Array | null }> {
  return guarded(() => { input = detachedSource(input); const c = detachContext(context), a = assignment(c, input, assignmentId);
    const output = assignmentOutput(input, a.source.assignment), ingress = bytes({ input: a.source.assignment.input }); invariant(ingress.byteLength <= input.bounds.maxArtifactBytes, 'Input extraction byte bound exceeded');
    invariant(equal(reference(ingress), a.input) && (output === null ? a.output === null : equal(reference(output), a.output)), 'Fresh extraction differs'); finalUse(input); return { input: Uint8Array.from(ingress), output: output === null ? null : Uint8Array.from(output) }; });
}
export function deriveDevelopmentCycle(context: SourceAdmissionContext, input: DevelopmentPageSourceInput, cycleId: string, selectionId: string): SourceAdmissionResult<DevelopmentCycleProof> {
  return guarded(() => { input = detachedSource(input); const c = detachContext(context), { p } = projection(c, input); invariant(c.plan.manifest.value.cycles.includes(cycleId) && c.plan.registration.value.roles.find(r => r.id === input.roleId)?.kind === 'candidate', 'Unregistered candidate cycle');
    const cycle = required(p.cycles.find(x => x.selection.id === selectionId), 'New selection unavailable'); required(cycle.result, 'New selection result unavailable'); invariant(cycle.result!.status === 'completed' || cycle.result!.status === 'checkpointed', 'Selection outcome failed');
    const proof: DevelopmentCycleProof = { ...common(c, input, 'cycle', cycleId, { configurationDigest: input.configurationDigest, assignmentPacket: input.assignmentPacket, cycle }), origin: cycle.origin, autonomy: 'unavailable' };
    encodeDevelopmentSourceProof(proof, c.policy.bounds.maxProofBytes); finalUse(input); return inertSnapshot(proof); });
}
function mutations(input: DevelopmentPageSourceInput): { event: DevelopmentEventPosition; before: JournalRef | null; after: JournalRef | null }[] {
  const reader = input.openAcquiredCapture(input.after), rows: { event: DevelopmentEventPosition; before: JournalRef | null; after: JournalRef | null }[] = [];
  const before = input.openAcquiredCapture(input.before).manifest.cut.lastSequence; let n = 0, size = 0;
  reader.forEachEvent(event => { if (event.sequence <= before || event.type !== 'document-mutation') return; const e = inertSnapshot(event), d = e.data as unknown as { before: JournalRef | null; after: JournalRef | null }; const row = { event: { id: e.id, sequence: e.sequence, stream: e.stream, type: e.type }, before: d.before, after: d.after }; n++; size += bytes(row).byteLength; invariant(n <= input.metadataBounds.maxRecords && size <= input.metadataBounds.maxBytes, 'Episode metadata bound exceeded'); rows.push(row); });
  reader.assertUsableNow(); return rows;
}
export function deriveDevelopmentExperience(context: SourceAdmissionContext, input: DevelopmentPageSourceInput, assignmentId: string, interferenceId: string): SourceAdmissionResult<DevelopmentExperienceProof> {
  return guarded(() => { input = detachedSource(input); const c = detachContext(context), w = validateDevelopmentWorkload(c), a = assignment(c, input, assignmentId), opportunities = c.plan.manifest.value.opportunities;
    invariant(c.plan.registration.value.roles.find(x => x.id === input.roleId)?.kind === 'candidate' && w.opportunities.some(o => { const i = opportunities.find(x => x.id === o.id)!.interferenceIds.indexOf(interferenceId); return i >= 0 && o.roles.some(r => r.roleId === input.roleId && r.interferenceAssignmentIds[i] === assignmentId); }), 'Unregistered candidate interference delivery');
    const episodeId = `input:${a.source.assignment.input.id}`, rows = mutations(input), episode = required(rows.find(x => x.before === null && x.after?.namespace === 'development.memories' && x.after.key === episodeId && x.after.revision === 1 && x.event.sequence > a.source.assignment.ingress.sequence), 'New attributed episode unavailable');
    const ingested = required(rows.find(x => x.before === null && x.after?.namespace === 'host.ingested' && x.after.key === episodeId && x.after.revision === 1 && x.event.sequence > episode.event.sequence), 'Host ingestion marker unavailable');
    const entry = committedVersion(input, episode.after!).value as unknown as MemoryEntry, record = entry.record, source = a.source.assignment.input;
    validateMemory(record); invariant(record.id === episodeId && record.revision === 1 && record.kind === 'episode' && record.status === 'active' && equal(record.scope, source.scope) && record.provenance.derivation === 'observed' && equal(record.provenance.sourceIds, [source.id]) && record.provenance.actorId === source.actorId && equal(record.content, { runId: a.source.assignment.runId, channel: 'speech', attributedContent: source.value, epistemicStatus: 'attributed-observation' }) && committedVersion(input, ingested.after!).value === true, 'Episode attribution/ingestion differs');
    const proof: DevelopmentExperienceProof = { ...common(c, input, 'experience', interferenceId, { configurationDigest: input.configurationDigest, assignmentPacket: input.assignmentPacket, assignment: a.source.assignment, episode: episode.after!, ingested: ingested.after!, creation: episode.event }), episodeId };
    encodeDevelopmentSourceProof(proof, c.policy.bounds.maxProofBytes); finalUse(input); return inertSnapshot(proof); });
}
function mapped(c: SourceAdmissionContext, roleId: string, opportunityId: string) { const w = validateDevelopmentWorkload(c), o = required(w.opportunities.find(o => o.id === opportunityId), 'Opportunity unavailable'); return required(o.roles.find(x => x.roleId === roleId), 'Opportunity role unavailable'); }
function checkedInput(c: SourceAdmissionContext, subjectId: string, a: DevelopmentAssignmentProof, related: DevelopmentAssignmentProof[], feedback: ArtifactRef): DevelopmentCheckInput {
  const evidence = bytes({ version: 1, kind: 'unsigned-check-evidence', planDigest: c.policy.planDigest, policyDigest: c.trust.acceptedPolicyDigest, roleId: a.roleId, subjectId, assignment: a, related });
  invariant(evidence.byteLength <= c.policy.bounds.maxProofBytes, 'Check input proof byte bound exceeded');
  return { kind: 'unsigned-check-input', evidence: Uint8Array.from(evidence), sourceDigest: hashBytes(evidence), roleId: a.roleId, subjectId, assignmentIds: [a.subjectId, ...related.map(x => x.subjectId)], output: required(a.output, 'Actual task output unavailable'), feedback, interval: a.interval };
}
export function inspectDevelopmentLearning(context: SourceAdmissionContext, input: DevelopmentPageSourceInput, assignmentId: string, opportunityId: string): SourceAdmissionResult<DevelopmentCheckInput> {
  return guarded(() => { input = detachedSource(input); const c = detachContext(context), map = mapped(c, input.roleId, opportunityId); invariant(map.learningAssignmentId === assignmentId, 'Learning delivery differs'); const a = assignment(c, input, assignmentId), out = checkedInput(c, opportunityId, a, [], a.input); finalUse(input); return out; });
}
function opportunitySources(c: SourceAdmissionContext, input: DevelopmentPageSourceInput, selector: OpportunitySelector, sources: DevelopmentPageSourceInput[]) {
  input = detachedSource(input); sources = sources.map(detachedSource); selector = inertSnapshot(selector); invariant(selector.roleId === input.roleId && equal(selector.before, input.before) && equal(selector.after, input.after), 'Opportunity bracket differs');
  const map = mapped(c, input.roleId, selector.opportunityId); invariant(map.assignmentId === selector.assignmentId, 'Opportunity assignment differs');
  const expected = [...(map.learningAssignmentId ? [map.learningAssignmentId] : []), ...map.interferenceAssignmentIds, map.feedbackAssignmentId];
  invariant(selector.related.length === expected.length && sources.length === expected.length && selector.related.every((x, i) => x.roleId === input.roleId && x.assignmentId === expected[i] && sources[i]!.roleId === x.roleId && equal(sources[i]!.before, x.before) && equal(sources[i]!.after, x.after)), 'Exact related exposure set/brackets required');
  const a = assignment(c, input, selector.assignmentId), related = sources.map((s, i) => assignment(c, s, expected[i]!)), feedback = related.at(-1)!.input;
  const checkInput = checkedInput(c, selector.opportunityId, a, related, feedback); finalUse(input); sources.forEach(finalUse); return { a, related, checkInput };
}
export function inspectDevelopmentOpportunity(context: SourceAdmissionContext, input: DevelopmentPageSourceInput, selector: OpportunitySelector, related: DevelopmentPageSourceInput[]): SourceAdmissionResult<DevelopmentCheckInput> { return guarded(() => opportunitySources(detachContext(context), input, selector, related).checkInput); }
/** Authenticating a checker record confers no observation, signing or release authority. */
export function verifyDevelopmentSourceCheck(context: SourceAdmissionContext, receipt: ArtifactRef, binding: SourceCheckBinding): SourceAdmissionResult<Signed<DevelopmentSourceCheck>> {
  return guarded(() => { const c = detachContext(context); validateSourceAdmissionPolicy(c); qualify(c); const b = inertSnapshot(binding), workload = validateDevelopmentWorkload(c);
    const opportunity = workload.opportunities.find(o => o.id === b.subjectId)?.roles.find(r => r.roleId === b.roleId);
    const script = workload.scripts.find(s => s.roleId === b.roleId)?.cases.find(a => a.assignmentId === b.subjectId);
    invariant(opportunity ? equal(b.assignmentIds, [opportunity.assignmentId, ...(opportunity.learningAssignmentId ? [opportunity.learningAssignmentId] : []), ...opportunity.interferenceAssignmentIds, opportunity.feedbackAssignmentId]) || (opportunity.learningAssignmentId !== null && equal(b.assignmentIds, [opportunity.learningAssignmentId])) : script !== undefined && equal(b.assignmentIds, [script.assignmentId, script.feedbackAssignmentId]), 'Checker subject is not the exact registered delivery set');
    const document = json<Signed<DevelopmentSourceCheck>>(c, receipt, c.policy.bounds.maxCheckerBytes), checker = c.trust.checker!;
    const v = authenticate(developmentSourceCheckDomain, document, new Map([[checker.id, checker.key]]));
    exact(v, 'version,planDigest,policyDigest,roleId,opportunityId,assignmentIds,sourceDigest,checkerSourceDigest,extractorSourceDigest,rubricDigest,output,feedback,acquisition,behavior,disclosure,matching,judgments,checkedAt');
    invariant(v.version === 1 && v.planDigest === c.policy.planDigest && v.policyDigest === c.trust.acceptedPolicyDigest && v.roleId === b.roleId && v.opportunityId === b.subjectId && equal(v.assignmentIds, b.assignmentIds) && v.sourceDigest === b.sourceDigest && v.checkerSourceDigest === c.policy.checkerSourceDigest && v.extractorSourceDigest === c.policy.extractorSourceDigest && v.rubricDigest === c.policy.rubricDigest && equal(v.output, b.output) && equal(v.feedback, b.feedback), 'Checker/source/subject commitment differs');
    v.assignmentIds.forEach(id); invariant(new Set(v.assignmentIds).size === v.assignmentIds.length && v.assignmentIds.length <= 6, 'Bounded unique checked assignments required');
    invariant(['completed', 'failed', 'unavailable'].includes(v.acquisition) && ['pass', 'fail', 'unavailable'].includes(v.behavior) && ['preserved', 'violated', 'unavailable'].includes(v.disclosure) && ['valid', 'invalid', 'unavailable'].includes(v.matching), 'Explicit checker dispositions required');
    invariant(v.acquisition !== 'completed' || b.acquisition === 'completed', 'Checker cannot complete missing source work');
    const checked = time(v.checkedAt), m = c.plan.manifest.value; invariant(Number.isFinite(b.completeAt) && Number.isFinite(b.hostNow) && checked >= b.completeAt && checked <= b.hostNow && checked >= time(m.notBefore) && checked <= time(m.deadlineAt), 'Check outside behavioral source/window');
    invariant(Array.isArray(v.judgments) && v.judgments.length <= 38 && new Set(v.judgments.map(x => x.sha256)).size === v.judgments.length && v.judgments.every(x => b.judgmentSlots.some(r => equal(x, r))), 'Unreserved checker judgment');
    for (const r of [v.output, v.feedback]) read(c, r, Math.min(c.plan.manifest.value.limits.maxArtifactBytes, developmentOperationalArtifactBytes));
    for (const r of v.judgments) read(c, r, c.policy.bounds.maxProofBytes);
    return inertSnapshot(document); });
}
function checked<T>(result: SourceAdmissionResult<T>): T { if (result.status === 'derived') return result.proof; if (result.status === 'unavailable') throw new Unavailable(result.code); throw Error(result.code); }
function checkBinding(i: DevelopmentCheckInput, acquisition: DevelopmentSourceCheck['acquisition'], completeAt: number, hostNow: number, judgmentSlots: ArtifactRef[]): SourceCheckBinding { return { roleId: i.roleId, subjectId: i.subjectId, assignmentIds: i.assignmentIds, sourceDigest: i.sourceDigest, output: i.output, feedback: i.feedback, acquisition, completeAt, hostNow, judgmentSlots }; }
function axes(v: Pick<DevelopmentSourceCheck, 'acquisition' | 'behavior' | 'disclosure' | 'matching'>) { return { acquisition: v.acquisition, behavior: v.behavior, disclosure: v.disclosure, matching: v.matching }; }
export function deriveDevelopmentLearning(context: SourceAdmissionContext, input: DevelopmentPageSourceInput, assignmentId: string, opportunityId: string, receipt: ArtifactRef, hostNow: number, judgmentSlots: ArtifactRef[] = []): SourceAdmissionResult<DevelopmentLearningProof> {
  return guarded(() => { input = detachedSource(input); const c = detachContext(context), a = assignment(c, input, assignmentId), checkInput = checked(inspectDevelopmentLearning(c, input, assignmentId, opportunityId));
    const check = checked(verifyDevelopmentSourceCheck(c, receipt, checkBinding(checkInput, a.acquisition, a.interval.upperWallMs, hostNow, judgmentSlots)));
    const proof: DevelopmentLearningProof = { ...common(c, input, 'learning', opportunityId, { configurationDigest: input.configurationDigest, assignmentPacket: input.assignmentPacket, assignment: a }), checks: [inertSnapshot(receipt)], check, ...axes(check.value) };
    encodeDevelopmentSourceProof(proof, c.policy.bounds.maxProofBytes); finalUse(input); return inertSnapshot(proof); });
}
export function deriveDevelopmentOpportunity(context: SourceAdmissionContext, input: DevelopmentPageSourceInput, selector: OpportunitySelector, relatedInputs: DevelopmentPageSourceInput[], receipt: ArtifactRef, hostNow: number, judgmentSlots: ArtifactRef[] = []): SourceAdmissionResult<DevelopmentOpportunityProof> {
  return guarded(() => { input = detachedSource(input); relatedInputs = relatedInputs.map(detachedSource); const c = detachContext(context), { a, related, checkInput } = opportunitySources(c, input, selector, relatedInputs), acquisition = [a, ...related].some(x => x.acquisition === 'unavailable') ? 'unavailable' : [a, ...related].some(x => x.acquisition === 'failed') ? 'failed' : 'completed';
    const check = checked(verifyDevelopmentSourceCheck(c, receipt, checkBinding(checkInput, acquisition, Math.max(a.interval.upperWallMs, ...related.map(x => x.interval.upperWallMs)), hostNow, judgmentSlots)));
    const proof: DevelopmentOpportunityProof = { ...common(c, input, 'opportunity', selector.opportunityId, { configurationDigest: input.configurationDigest, assignmentPacket: input.assignmentPacket, assignment: a, related }), checks: [inertSnapshot(receipt)], check, output: checkInput.output, feedback: checkInput.feedback, ...axes(check.value) };
    encodeDevelopmentSourceProof(proof, c.policy.bounds.maxProofBytes); finalUse(input); relatedInputs.forEach(finalUse); return inertSnapshot(proof); });
}
function eligible(interval: SourceInterval): void { invariant(Number.isFinite(interval.lowerWallMs) && Number.isFinite(interval.upperWallMs) && interval.lowerWallMs <= interval.upperWallMs, 'Invalid source interval'); if (interval.temporalEligibility === 'unavailable') throw new Unavailable('Host temporal qualification unavailable'); invariant(interval.clockKind === 'synthetic' ? interval.temporalEligibility === 'synthetic' : interval.temporalEligibility === 'qualified', 'Clock eligibility differs'); }
export function validateDevelopmentCycleIntervals(proofs: DevelopmentCycleProof[], cycles: string[], actualStart: number, currentEnd: number, windowMs: number): SourceAdmissionResult<string[]> {
  return guarded(() => { proofs = inertSnapshot(proofs); positive(windowMs); invariant(Number.isFinite(actualStart) && Number.isFinite(currentEnd) && currentEnd - actualStart >= 3 * windowMs && cycles.length === 3 && proofs.length === 3 && equal(proofs.map(p => p.subjectId), cycles), 'Three registered cycle intervals required');
    invariant(new Set(proofs.map(x => x.source.cycle.runId)).size === 3 && new Set(proofs.map(x => x.source.cycle.selection.id)).size === 3 && proofs.every(p => p.roleId === proofs[0]!.roleId && p.planDigest === proofs[0]!.planDigest && p.policyDigest === proofs[0]!.policyDigest), 'Cycle run/selection/binding reused');
    return proofs.map((p, i) => { eligible(p.interval); invariant(p.interval.lowerWallMs - (i ? proofs[i - 1]!.interval.upperWallMs : actualStart) >= windowMs && p.interval.upperWallMs <= currentEnd, 'Conservative cycle interval separation failed'); return new Date(p.interval.upperWallMs).toISOString(); }); });
}
export function validateDevelopmentTransferIntervals(learning: DevelopmentLearningProof, experiences: DevelopmentExperienceProof[], transfer: DevelopmentOpportunityProof, interferenceIds: string[], windowMs: number): SourceAdmissionResult<string> {
  return guarded(() => { learning = inertSnapshot(learning); experiences = inertSnapshot(experiences); transfer = inertSnapshot(transfer); positive(windowMs);
    invariant(learning.subjectId === transfer.subjectId && equal(experiences.map(x => x.subjectId), interferenceIds) && experiences.length === 3 && new Set(experiences.map(x => x.episodeId)).size === 3 && [transfer, ...experiences].every(x => x.roleId === learning.roleId && x.planDigest === learning.planDigest && x.policyDigest === learning.policyDigest), 'Transfer source/episode coverage differs');
    if (!(learning.acquisition === 'completed' && learning.behavior === 'pass' && learning.disclosure === 'preserved' && learning.matching === 'valid')) throw new Unavailable('Initial learning not qualified successful');
    [learning, transfer, ...experiences].forEach(x => eligible(x.interval)); invariant(transfer.interval.lowerWallMs - learning.interval.upperWallMs >= windowMs && experiences.every(x => x.interval.lowerWallMs > learning.interval.upperWallMs && x.interval.upperWallMs < transfer.interval.lowerWallMs), 'Conservative transfer interval separation failed'); return new Date(transfer.interval.upperWallMs).toISOString(); });
}
/** Canonical proof serializer validates exact discriminants and bound; it does not certify sourced truth. */
export function encodeDevelopmentSourceProof(value: DevelopmentSourceAdmissionProof, maxBytes: number): Uint8Array {
  const p = inertSnapshot(value); positive(maxBytes); const extra = p.kind === 'assignment' ? 'output,input,acquisition' : p.kind === 'cycle' ? 'origin,autonomy' : p.kind === 'experience' ? 'episodeId' : p.kind === 'learning' ? 'check,acquisition,behavior,disclosure,matching' : p.kind === 'opportunity' ? 'check,output,feedback,acquisition,behavior,disclosure,matching' : '';
  invariant(extra !== '' && p.version === 1, 'Unsupported proof kind'); exact(p, `version,kind,planDigest,policyDigest,roleId,subjectId,captures,interval,source,checks,${extra}`); digest(p.planDigest); digest(p.policyDigest); id(p.roleId); id(p.subjectId); p.captures.forEach(ref); p.checks.forEach(ref);
  exact(p.interval, 'lowerWallMs,upperWallMs,clockKind,temporalEligibility'); invariant(Number.isFinite(p.interval.lowerWallMs) && Number.isFinite(p.interval.upperWallMs) && p.interval.lowerWallMs <= p.interval.upperWallMs && ['host', 'synthetic'].includes(p.interval.clockKind) && ['synthetic', 'qualified', 'unavailable'].includes(p.interval.temporalEligibility), 'Exact source interval required');
  invariant(p.captures.length === 2 && (p.kind === 'learning' || p.kind === 'opportunity' ? p.checks.length === 1 : p.checks.length === 0), 'Exact proof capture/check count required');
  exact(p.source, 'configurationDigest,assignmentPacket,' + (p.kind === 'cycle' ? 'cycle' : p.kind === 'experience' ? 'assignment,episode,ingested,creation' : p.kind === 'opportunity' ? 'assignment,related' : 'assignment')); digest(p.source.configurationDigest); ref(p.source.assignmentPacket);
  if (p.kind === 'cycle') invariant(['request', 'unknown'].includes(p.origin) && p.origin === p.source.cycle.origin && p.autonomy === 'unavailable', 'No fabricated autonomous origin');
  if (p.kind === 'assignment') { ref(p.input); if (p.output) ref(p.output); invariant(['completed', 'failed', 'unavailable'].includes(p.acquisition), 'Explicit assignment acquisition required'); }
  if (p.kind === 'experience') id(p.episodeId);
  if (p.kind === 'learning' || p.kind === 'opportunity') invariant(equal(axes(p.check.value), axes(p)), 'Inline checker axes differ');
  const result = bytes(p); invariant(result.byteLength <= maxBytes, 'Proof byte bound exceeded'); return Uint8Array.from(result);
}
export function developmentProofSlot(plan: DevelopmentAcquisitionPlan, kind: 'cycle' | 'experience' | 'learning' | 'task-output' | 'feedback' | 'checker', roleId: string, subjectId: string): { kind: string; ordinal: number } {
  plan = inertSnapshot(plan); const m = plan.manifest.value, roles = plan.registration.value.roles.filter(r => r.kind === 'candidate' || m.controls.some(c => c.id === r.assignmentId && ['no-memory', 'no-standing-goals'].includes(c.kind))), candidate = roles.find(r => r.kind === 'candidate'); let ordinal = -1;
  if (['cycle', 'experience', 'learning'].includes(kind)) { invariant(roleId === candidate?.id, 'Candidate proof slot required'); ordinal = kind === 'cycle' ? m.cycles.indexOf(subjectId) : kind === 'learning' ? m.opportunities.filter(x => x.family === 'transfer').findIndex(x => x.id === subjectId) : [...new Set(m.opportunities.flatMap(x => x.interferenceIds))].indexOf(subjectId); }
  else { const role = roles.findIndex(x => x.id === roleId), opportunity = m.opportunities.findIndex(x => x.id === subjectId); if (role >= 0 && opportunity >= 0) ordinal = role * m.opportunities.length + opportunity; }
  invariant(ordinal >= 0 && ordinal < ({ cycle: 3, experience: 9, learning: 3, 'task-output': 36, feedback: 36, checker: 36 }[kind]), 'Unregistered typed proof slot'); return { kind, ordinal };
}
/** Convert only expressible outcomes. Unknown disclosure/failed initial learning remains unavailable. */
export function developmentSourceObservationData(proof: DevelopmentSourceAdmissionProof): SourceAdmissionResult<DevelopmentObservation['data']> {
  return guarded(() => { const p = inertSnapshot(proof); switch (p.kind) {
    case 'assignment': throw new Unavailable('Assignment has no observation variant');
    case 'cycle': eligible(p.interval); return { kind: 'cycle', assignmentId: p.subjectId, runId: p.source.cycle.runId, selectionId: p.source.cycle.selection.id };
    case 'experience': eligible(p.interval); return { kind: 'experience', assignmentId: p.subjectId, episodeId: p.episodeId };
    case 'learning': eligible(p.interval); if (!(p.acquisition === 'completed' && p.behavior === 'pass' && p.disclosure === 'preserved' && p.matching === 'valid')) throw new Unavailable('Initial learning not qualified successful'); return { kind: 'learning', opportunityId: p.subjectId };
    case 'opportunity': eligible(p.interval); if (p.disclosure === 'unavailable') throw new Unavailable('Disclosure qualification unavailable'); return { kind: 'opportunity', assignmentId: p.subjectId, result: p.acquisition, feedback: p.feedback, audienceBoundaryPreserved: p.disclosure === 'preserved' };
  } });
}
