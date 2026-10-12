import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { canonicalJson, digest, identity, invariant, validateScope, type ArtifactRef } from '../../packages/contracts/index.ts';
import type { AuthenticatedMessage } from '../../packages/communications/core/index.ts';
import { authenticate, inertSnapshot, type Signed } from '../qualification/manifest.ts';
import type { DocumentJournalOptions, PageCaptureBounds } from '../../packages/storage/index.ts';
import { collectDevelopmentEvidenceProjection, developmentCapacityProfile, developmentCapacityLimits, developmentOperationalArtifactBytes, verifyDevelopmentAttempt, type DevelopmentAttempt } from './witness.ts';
import { reviewEnvelopeDomains, type DevelopmentEnvelopeTrust, type DevelopmentRegistration } from './review-envelope.ts';
import { validateReviewAdmission, reviewAdmissionDigest, reviewAdmissionSources, developmentReviewReservation, type ReviewAdmission, type ReviewReservation, type ReviewAdmissionSource } from './review-reservation.ts';

import { reserveSourceAdmission, type RecorderSourceAdmission, type SourceAdmissionReservation } from './source-admission-reservation.ts';

export const evidenceRetentionDomain = 'aeon.development.evidence-retention.v1';
export const evidenceCustodianDomain = 'aeon.development.evidence-custodian.v1';
export const attemptUseDomain = 'aeon.development.attempt-use.v1';
export interface EvidenceRetentionGrant { version: 1; id: string; attemptDigest: string; sourceDigest: string; rawStoreDigest: string; custodianId: string; purpose: string; audiences: string[]; dataScope: 'complete-operational-role-sources'; retention: 'independent-indefinite'; withdrawal: 'stop-use-retain-originals' }
export interface EvidenceCustodianDisposition { version: 1; grantDigest: string; attemptDigest: string; custodianId: string; status: 'active' | 'withdrawn' | 'destruction-pending' }
export interface AttemptUseDisposition { version: 1; planDigest: string; attemptDigest: string; grantDigest: string | null; custodianId: string; status: 'withdrawn' | 'destruction-pending' | 'document-history-withdrawn' | 'document-history-corrupt-or-missing'; reasonCode: string; behaviorDigest: string | null; inventoryDigest: string; source: {roleId: string; journalDigest: string; cursor: number; withdrawalIdsDigest: string; withdrawalCount: number; artifact: ArtifactRef | null; retentionStatus: 'retained' | 'capacity-unavailable'} | null }
export const retentionSourceDigest = (p: DevelopmentAcquisitionPlan) => identity({originalStateFile: p.originalStateFile, roles: p.roles});
export const acquisitionPlanDomain = 'aeon.development.acquisition-plan.v1';
export interface AcquisitionAssignmentPacket { version: 1; assignments: { id: string; roleId: string; message: AuthenticatedMessage }[] }
export interface AcquisitionRolePlan {
  roleId: string; stateFile: string; workspace: string; configuration: ArtifactRef; closure: ArtifactRef; journal: DocumentJournalOptions | null;
  maxDrafts: number; maxPayloadBytes: number; maxPromptBytes: number; maxFragmentBytes: number; maxResponseBytes: number;
}
export interface AcquisitionPageLayout {
  kind: 'complete-pages-global-originals-v1'; page: PageCaptureBounds;
  maxManifestBytes: number; maxCaptureIndexBytes: number;
  referencedOriginalPool: {maxOriginals: number; maxBytes: number};
  sourcePool: {maxArtifacts: number; maxBytes: number};
  proofPool: {maxArtifacts: number; maxBytes: number; mandatoryArtifacts: number; mandatoryArtifactBytes:number};
  metadata: {behaviorBytes: number; finalBytes: number; ownerWithoutBehaviorBytes: number; ownerBytes: number};
}
export interface AcquisitionProtocol {
  nonRequestObservations: number; initialCaptures: number; cycleCaptures: number; boundaryCaptures: number;
  schedule: {roleId: string; assignmentId: string; phase: 'opportunity' | 'learning' | 'interference' | 'feedback' | 'script' | 'script-feedback'; ordinal: number}[];
}
export interface DevelopmentAcquisitionPlan {
  version: 1 | 2; captureLayout?: AcquisitionPageLayout; protocol?: AcquisitionProtocol; id: string; manifest: Signed<DevelopmentAttempt>; registration: Signed<DevelopmentRegistration>;
  assignmentPacket: ArtifactRef; originalStateFile: string;
  closures: { node: string; dependencies: string; prompts: string; tools: string; acquisition: string };
  rawStore: { directory: string; device: string; inode: string; uid: string; capacityBytes: number };
  roles: AcquisitionRolePlan[]; retention?: Signed<EvidenceRetentionGrant>;
  capacity: { captureBytes: number; maxSnapshots: number; maxSnapshotBytes: number; envelopeBytes: number; transitionBytes: number; failureBytes: number; inventoryEntryBytes: number; maxArtifacts: number; maxObservations: number };
}
export interface AcquisitionPlanTrust {
  reviewAdmission?: ReviewAdmission;
  retention?: { acceptedGrantDigest: string; issuers: ReadonlyMap<string, Uint8Array>; custodianSigner: string; custodianKey: Uint8Array };
  acceptedPlanDigest: string; issuers: ReadonlyMap<string, Uint8Array>; envelope: DevelopmentEnvelopeTrust;
}
export interface AcquisitionCapacity {
  sourceAdmission?: SourceAdmissionReservation;
  reviewAdmissionDigest?: string; reviewReservations?: ReviewReservation[]; reviewSources?: ReviewAdmissionSource[];
  draftBytes: number; responseBytes: number; metadataBytes: number; captureBytes: number; failureBytes: number;
  totalBytes: number; records: number; maxRequests: number;
  sourceArtifacts: number; sourceBytes: number; mandatoryObservations: number; mandatorySnapshots: number; observationBytes: number;
  behaviorBaseBytes: number; finalBaseBytes: number; ownerBaseBytes: number;
  terminalRawBytes: number; terminalOwnerBytes: number; dispositionOwnerBytes: number;
}
export interface AcquisitionRequestMetadata { behaviorBytes: number; finalBytes: number; ownerBytes: number }
/** Explicit private v2 wire; exact bounded UTF16 units survive NUL and lone surrogates. */
export function acquisitionTerminalRecord(planDigest: string, phase: string, pending: { artifact: ArtifactRef; bytes: number; pool: string; original?: ArtifactRef } | null, code: string, detail: string) {
  return { version: 2, planDigest, phase, pending, code: code.slice(0, 128), detail: { encoding: 'utf16le-base64', value: Buffer.from(detail.slice(0, 512), 'utf16le').toString('base64') } };
}
export class AcquisitionInfeasible extends Error { override name = 'AcquisitionInfeasible'; }
const exact = (value: object, keys: string) => invariant(Object.keys(value).sort().join(',') === keys.split(',').sort().join(','), 'Exact acquisition fields required');
const positive = (n: number, max: number) => invariant(Number.isSafeInteger(n) && n > 0 && n <= max, 'Finite acquisition bound required');
const path = (p: string) => invariant(isAbsolute(p) && resolve(p) === p && p !== '/', 'Canonical acquisition path required');
const time = (s: string) => { const n = Date.parse(s); invariant(Number.isFinite(n), 'Acquisition time required'); return n; };

/** Counts distinct worst-case streams; actual identical bytes may deduplicate, never erase a draft. */
export function acquisitionCapacity(p: DevelopmentAcquisitionPlan): AcquisitionCapacity {
  const c = p.capacity;
  const maxRequests = p.roles.reduce((n, r) => n + r.maxDrafts, 0);
  const draftBytes = p.roles.reduce((n, r) => n + r.maxDrafts * (r.maxPayloadBytes + r.maxPromptBytes + r.maxFragmentBytes), 0);
  const responseBytes = p.roles.reduce((n, r) => n + r.maxDrafts * r.maxResponseBytes, 0);
  const metadataBytes = c.envelopeBytes + maxRequests * 5 * c.transitionBytes + c.maxArtifacts * c.inventoryEntryBytes;
  const records = c.maxObservations + p.registration.value.originalRequests.length + maxRequests * 6 + c.maxArtifacts + p.manifest.value.reviewers.length;
  const totalBytes = draftBytes + responseBytes + metadataBytes + c.captureBytes + c.failureBytes;
  if (![maxRequests, draftBytes, responseBytes, metadataBytes, records, totalBytes].every(Number.isSafeInteger) || totalBytes > p.manifest.value.limits.maxEvidenceBytes || totalBytes > p.rawStore.capacityBytes || records > p.manifest.value.limits.maxRecords || maxRequests + p.manifest.value.grant.originalAccounting.requestIds.length > p.manifest.value.grant.resources.maxRequests)
    throw new AcquisitionInfeasible('Fixed acquisition bytes, records or original request allowance cannot cover the registered attempt');
  return { draftBytes, responseBytes, metadataBytes, captureBytes: c.captureBytes, failureBytes: c.failureBytes, totalBytes, records, maxRequests, sourceArtifacts: 0, sourceBytes: 0, mandatoryObservations: (p.protocol?.nonRequestObservations ?? 2) + p.roles.filter(rp => p.registration.value.roles.find(r => r.id === rp.roleId)?.kind !== 'reviewer').reduce((n, rp) => n + rp.maxDrafts, 0), mandatorySnapshots: 0, observationBytes: Math.max(c.transitionBytes, 2048), behaviorBaseBytes: 0, finalBaseBytes: 0, ownerBaseBytes: 0, terminalRawBytes: 0, terminalOwnerBytes: 0, dispositionOwnerBytes: 0 };
}

/** Raw signed B, inline owner B, and final envelope B are separate serialized copies. */
export function acquisitionMetadataUsage(p: DevelopmentAcquisitionPlan, c: AcquisitionCapacity, indexRecords: number, requests: readonly AcquisitionRequestMetadata[]) {
  const indexBytes = indexRecords * p.capacity.inventoryEntryBytes;
  const behaviorBytes = c.behaviorBaseBytes + indexBytes + requests.reduce((n, q) => n + q.behaviorBytes, 0);
  const finalBytes = behaviorBytes + c.finalBaseBytes + requests.reduce((n, q) => n + q.finalBytes, 0);
  const ownerBytes = c.ownerBaseBytes + indexBytes + requests.reduce((n, q) => n + q.ownerBytes, 0);
  return { behaviorBytes, finalBytes, ownerBytes, totalBytes: behaviorBytes * 2 + finalBytes + ownerBytes };
}

/** Fixed ordinary ingress only; no private checker expectations or targeted control actions. */
export function validateAssignmentPacket(value: unknown, registration: DevelopmentRegistration): AcquisitionAssignmentPacket {
  const packet = value as AcquisitionAssignmentPacket;
  exact(packet, 'version,assignments'); invariant(packet.version === 1 && Array.isArray(packet.assignments), 'Exact public assignment packet required');
  const seen = new Set<string>();
  const text = (s: unknown) => invariant(typeof s === 'string' && s.trim().length > 0 && s.length <= 4096, 'Bounded assignment identity required');
  for (const entry of packet.assignments) {
    exact(entry, 'id,roleId,message'); text(entry.id); text(entry.roleId);
    invariant(registration.roles.some(r => r.id === entry.roleId && ['candidate', 'control'].includes(r.kind)), 'Assignment requires registered behavioral role');
    const key = canonicalJson([entry.roleId, entry.id]); invariant(!seen.has(key), 'Duplicate role-local assignment'); seen.add(key);
    const m = entry.message; exact(m, 'source,externalId,revision,conversation,text,actor');
    for (const s of [m.source, m.externalId, m.revision, m.conversation]) text(s);
    invariant(typeof m.text === 'string', 'Assignment text required'); exact(m.actor, 'id,scope,modificationEligible'); text(m.actor.id);
    invariant(typeof m.actor.modificationEligible === 'boolean', 'Authenticated assignment principal required'); validateScope(m.actor.scope);
  }
  return inertSnapshot(packet);
}

/** No claim or dispatch occurs here. Accepted trust and exact original raw bytes are host inputs. */
export function verifyAcquisitionPlan(document: Signed<DevelopmentAcquisitionPlan>, trust: AcquisitionPlanTrust, reader: (ref: ArtifactRef, bound: number) => Uint8Array, now = Date.now(), sourceAdmission?: RecorderSourceAdmission): { plan: DevelopmentAcquisitionPlan; capacity: AcquisitionCapacity } {
  const p = authenticate(acquisitionPlanDomain, document, trust.issuers);
  exact(p, 'version,id,manifest,registration,assignmentPacket,originalStateFile,closures,rawStore,roles,capacity' + (p.retention ? ',retention' : '') + (p.version === 2 ? ',captureLayout,protocol' : ''));
  invariant([1, 2].includes(p.version) && typeof p.id === 'string' && p.id.length > 0 && p.id.length <= 256 && identity(p) === trust.acceptedPlanDigest, 'Unaccepted acquisition plan');
  const m = verifyDevelopmentAttempt(p.manifest, trust.envelope.behavior);
  invariant((p.version === 2) === (m.version === 2), 'Attempt and acquisition capacity profile versions differ');
  // The unchanged witness performs full adopted protocol/manifest/source/configuration checks.
  const profiles = new Map(p.registration.value.roles.map(r => [r.id, { configurationDigest: r.configurationDigest, model: r.profile }]));
  const evidence = collectDevelopmentEvidenceProjection(p.manifest, [], trust.envelope.behavior, reader, profiles, now).evidence;
  invariant(!evidence.findings.some(f => ['source', 'configuration'].includes(f.code)), 'Unavailable candidate/configuration source');
  const r = authenticate(reviewEnvelopeDomains.registration, p.registration, trust.envelope.behavior.issuers);
  exact(r, 'version,attemptDigest,rootId,rootCancelled,registeredAt,reviewDeadlineAt,observerClosureDigest,closureVerifierDigest,assignmentDigest,roles,originalRequests');
  invariant(r.version === 2 && identity(r) === trust.envelope.acceptedRegistrationDigest && r.attemptDigest === identity(m) && !r.rootCancelled, 'Original registration changed/cancelled');
  invariant(r.observerClosureDigest === trust.envelope.behavior.observer.artifactDigest && r.closureVerifierDigest === trust.envelope.closure.verifierDigest && r.registeredAt === m.registeredAt && time(r.registeredAt) <= now && now <= time(m.notBefore) && time(m.deadlineAt) <= time(r.reviewDeadlineAt) && time(r.reviewDeadlineAt) <= time(m.grant.expiresAt), 'Invalid preregistration clock/closure');
  invariant(r.roles.length === p.roles.length && r.roles.length <= 40 && new Set(r.roles.map(v => v.id)).size === r.roles.length && new Set(r.roles.map(v => v.allocationId)).size === r.roles.length, 'Exact role inventory required');
  invariant(new Set(p.roles.map(v => v.roleId)).size === r.roles.length && r.roles.every(v => p.roles.some(rp => rp.roleId === v.id)), 'Plan roles must be an exact registered permutation');
  invariant(r.roles.filter(v => v.kind === 'candidate').length === 1 && r.roles.filter(v => v.kind === 'reviewer').length === 2 && r.roles.filter(v => v.kind === 'control').length === m.controls.length, 'Adopted role coverage required');
  invariant(m.controls.every(v => r.roles.filter(x => x.kind === 'control' && x.assignmentId === v.id).length === 1) && m.reviewers.every(v => r.roles.filter(x => x.kind === 'reviewer' && x.assignmentId === v.id).length === 1), 'Unassigned control/reviewer');
  exact(p.closures, 'node,dependencies,prompts,tools,acquisition'); Object.values(p.closures).forEach(v => digest(v));
  invariant(p.closures.acquisition === m.acquisitionDigest && p.closures.dependencies === m.candidate.dependencies && p.closures.prompts === m.candidate.prompts, 'Acquisition closure changed');
  path(p.originalStateFile); exact(p.rawStore, 'directory,device,inode,uid,capacityBytes'); path(p.rawStore.directory);
  positive(p.rawStore.capacityBytes, p.version === 2 ? developmentCapacityLimits.maxEvidenceBytes : 256 * 1024 * 1024); for (const key of ['device', 'inode', 'uid'] as const) invariant(/^\d+$/.test(p.rawStore[key]), 'Pinned raw-store identity required');
  const read = (ref: ArtifactRef) => { digest(ref.sha256); invariant(ref.uri === `sha256:${ref.sha256}`, 'Retained plan raw bytes required'); const bytes = Uint8Array.from(reader(ref, m.limits.maxArtifactBytes)); invariant(bytes.byteLength <= m.limits.maxArtifactBytes && identity(JSON.parse(Buffer.from(bytes).toString('utf8'))) === ref.sha256, 'Exact canonical plan artifact required'); return JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown; };
  const rawPacket = read(p.assignmentPacket); invariant(identity(rawPacket) === r.assignmentDigest, 'Assignment packet changed');
  const packet = validateAssignmentPacket(rawPacket, r);
  const states = new Set<string>(), workspaces = new Set<string>();
  const candidate = r.roles.find(v => v.kind === 'candidate')!;
  invariant(candidate.configurationDigest === m.candidate.configuration && candidate.profile && identity(candidate.profile) === m.candidate.model && candidate.assignmentId === null, 'Candidate role changed');
  for (const rp of p.roles) {
    exact(rp, 'roleId,stateFile,workspace,configuration,closure,journal,maxDrafts,maxPayloadBytes,maxPromptBytes,maxFragmentBytes,maxResponseBytes');
    const role = r.roles.find(v => v.id === rp.roleId); invariant(role && trust.envelope.acceptedRoles.get(role.id) === identity(role), 'Unaccepted role');
    path(rp.stateFile); path(rp.workspace); invariant(!states.has(rp.stateFile) && !workspaces.has(rp.workspace), 'Role state/workspace must be isolated'); states.add(rp.stateFile); workspaces.add(rp.workspace);
    invariant((role.kind === 'candidate') === (rp.stateFile === p.originalStateFile), 'Only candidate owns original operational state');
    const configuration = read(rp.configuration) as { stateDirectory?: string; workspaceDirectory?: string; nodeBinary?: string; model?: unknown };
    invariant(identity(configuration) === role.configurationDigest && identity(read(rp.closure)) === role.closureDigest, 'Role loaded configuration/closure changed');
    if (m.evidenceKind === 'live-development') invariant(configuration.stateDirectory === dirname(rp.stateFile) && rp.stateFile === join(configuration.stateDirectory, 'operational.sqlite') && configuration.workspaceDirectory === rp.workspace && configuration.nodeBinary, 'Actual application state/workspace/runtime route changed');
    if (rp.journal) { exact(rp.journal, 'stream,hostId,maxAnchorDocuments,maxAnchorBytes'); invariant(rp.journal.stream.length > 0 && rp.journal.hostId.length > 0, 'Bound journal host identity required'); positive(rp.journal.maxAnchorDocuments, 512); positive(rp.journal.maxAnchorBytes, 1_048_576); }
    positive(rp.maxDrafts, role.resources.maxRequests);
    for (const n of [rp.maxPayloadBytes, rp.maxPromptBytes, rp.maxFragmentBytes, rp.maxResponseBytes]) positive(n, Math.min(m.limits.maxArtifactBytes, developmentOperationalArtifactBytes));
    // Concrete envelope equality, beyond caller budget digests; actual consumption is retained later.
    if (role.kind === 'control') invariant(identity(role.resources) === identity(candidate.resources), 'Control resource envelope is unmatched');
  }
  if (m.evidenceKind === 'live-development') {
    const paths = p.roles.flatMap(r => [dirname(r.stateFile), r.workspace]);
    const outside = (a: string, b: string) => { const p = relative(a, b); return p === '..' || p.startsWith(`..${sep}`) || isAbsolute(p); };
    invariant(paths.every((a, i) => paths.every((b, j) => i === j || (outside(a, b) && outside(b, a)))), 'Live role state/workspace directories must be disjoint');
  }
  verifyEvidenceRetention(p, trust);
  exact(p.capacity, 'captureBytes,maxSnapshots,maxSnapshotBytes,envelopeBytes,transitionBytes,failureBytes,inventoryEntryBytes,maxArtifacts,maxObservations');
  for (const key of ['captureBytes', 'envelopeBytes', 'failureBytes'] as const) positive(p.capacity[key], m.limits.maxEvidenceBytes);
  for (const key of ['maxSnapshotBytes', 'transitionBytes'] as const) positive(p.capacity[key], m.limits.maxArtifactBytes);
  positive(p.capacity.maxSnapshots, 512); positive(p.capacity.maxArtifacts, p.version === 2 ? developmentCapacityLimits.maxRecords : 2048); positive(p.capacity.inventoryEntryBytes, 4096); positive(p.capacity.maxObservations, 512);
  invariant(p.capacity.inventoryEntryBytes >= 256 && p.capacity.failureBytes >= 2048 && (p.version === 2 || p.capacity.maxSnapshots * p.capacity.maxSnapshotBytes <= p.capacity.captureBytes), 'Snapshot/index/failure capacity insufficient');
  if (p.version === 2) validatePagePlan(p, packet);
  const capacity = acquisitionCapacity(p);
  if (p.version === 2) {
    try {
      const admission = trust.reviewAdmission; invariant(admission, 'Externally accepted reviewer admission missing');
      validateReviewAdmission(admission, m, r, p.roles,trust.envelope.behavior.reviewers);
      invariant(admission.sessions.every(s=>s.plan.maxResponseBytes<=p.captureLayout!.proofPool.mandatoryArtifactBytes),'Required decoded review proof singleton cannot fit');
      capacity.reviewAdmissionDigest = reviewAdmissionDigest(admission);
      capacity.reviewSources = reviewAdmissionSources(admission, reader);
      capacity.reviewReservations = admission.sessions.map(session => developmentReviewReservation(session, p.roles.find(rp => rp.roleId === session.roleId)!, { manifest: m, registration: r, template: admission.template, instructionBytes: capacity.reviewSources!.map(i => ({ artifact: i.artifact, bytes: Buffer.from(i.contentBase64, 'base64') })) }));
    } catch (error) { throw new AcquisitionInfeasible(`Reviewer preclaim admission cannot fit: ${String(error instanceof Error ? error.message : error)}`); }
  }
  const retainedSources = new Set<string>(); let sourceBytes = 0;
  const countSources = (v: unknown): void => { if (!v || typeof v !== 'object') return; if ('uri' in v && 'sha256' in v) { const ref = v as ArtifactRef; if (!retainedSources.has(ref.sha256)) { retainedSources.add(ref.sha256); sourceBytes += reader(ref, m.limits.maxArtifactBytes).byteLength; } return; } Object.values(v).forEach(countSources); };
  countSources(p);
  for (const item of capacity.reviewSources ?? []) if (!retainedSources.has(item.artifact.sha256)) { retainedSources.add(item.artifact.sha256); sourceBytes += item.bytes; }
  capacity.sourceArtifacts = retainedSources.size; capacity.sourceBytes = sourceBytes;
  capacity.mandatorySnapshots = packet.assignments.length + r.roles.filter(role => role.kind !== 'reviewer').length + (p.protocol ? p.protocol.initialCaptures + p.protocol.cycleCaptures + p.protocol.boundaryCaptures : 1);
  if (p.capacity.maxSnapshots < capacity.mandatorySnapshots || p.capacity.maxObservations < capacity.mandatoryObservations || p.capacity.maxArtifacts < mandatoryAcquisitionSlots(p, capacity))
    throw new AcquisitionInfeasible('Mandatory source, assignment, observation, response and terminal artifact slots cannot fit');
  if (mandatoryAcquisitionCaptureBytes(p, capacity) > p.capacity.captureBytes)
    throw new AcquisitionInfeasible('Fixed source/snapshot/observation capture pool insufficient');
  // Source entries and finite role/assignment/request state must fit before the irreversible claim.
  const ownerMinimum = 2048 + Buffer.byteLength(canonicalJson(packet)) + capacity.sourceArtifacts * p.capacity.inventoryEntryBytes + packet.assignments.length * 256 + capacity.maxRequests * 1024;
  if (p.capacity.envelopeBytes < Buffer.byteLength(canonicalJson(document)) + ownerMinimum)
    throw new AcquisitionInfeasible('Signed plan and mandatory owner metadata/terminal headroom cannot fit');
  invariant(Buffer.byteLength(canonicalJson(document)) <= p.capacity.envelopeBytes, 'Signed plan metadata allowance insufficient');
  const size = (v: unknown) => Buffer.byteLength(canonicalJson(v)), zero = '0'.repeat(64), ref = { uri: `sha256:${zero}`, sha256: zero }, at = '9999-12-31T23:59:59.999Z';
  const terminalPending = { artifact: ref, bytes: m.limits.maxArtifactBytes, pool: 'metadata', ...(p.version === 2 ? {original: {uri:`aeon:artifact:${zero}`,sha256:zero}} : {}) }, terminalCode = '\u0000'.repeat(128), terminalDetail = '\u0000'.repeat(512);
  capacity.terminalRawBytes = size(acquisitionTerminalRecord(zero, 'acquiring', terminalPending, terminalCode, terminalDetail));
  capacity.terminalOwnerBytes = size({ failure: ref, phase: 'failed', findings: [{ status: 'unavailable', code: terminalCode, detail: terminalDetail }], inventory: [{ artifact: ref, bytes: capacity.terminalRawBytes, pool: 'failure', roleId: null, slot: 'failure' }] });
  if (capacity.terminalRawBytes > Math.min(p.capacity.failureBytes, m.limits.maxArtifactBytes))
    throw new AcquisitionInfeasible('Canonical terminal failure raw record cannot fit original reserve');
  // Scratch wire-size templates only: never signed, retained or presented as observed evidence.
  const wrap = (value: unknown, signer = m.observerId) => ({ value, signer, signature: zero });
  const accounting = { ...m.grant.originalAccounting, usage: { requests: Number.MAX_SAFE_INTEGER, inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: Number.MAX_SAFE_INTEGER, costUsd: Number.MAX_VALUE, elapsedMs: Number.MAX_SAFE_INTEGER }, chargedTokens: Number.MAX_SAFE_INTEGER, chargedCostUsd: Number.MAX_VALUE, chargedElapsedMs: Number.MAX_SAFE_INTEGER };
  const observation = (id: string, data: unknown) => wrap({ version: 1, id, attemptDigest: identity(m), configurationDigest: m.candidate.configuration, candidateId: m.candidate.id, observedAt: at, artifact: ref, data });
  const fixedObservations = size(observation('acquisition-start', { kind: 'start' })) + size(observation('acquisition-end', { kind: 'end', accounting }));
  capacity.behaviorBaseBytes = size(wrap({ version: 2, registrationDigest: identity(r), frozenAt: at, manifest: p.manifest, observations: [], requests: [], transitions: [], rootCancelled: false, evidence, artifactIndex: [] })) + 2 * fixedObservations + size(accounting) + 512 * capacity.mandatoryObservations + 1024;
  if(p.captureLayout) capacity.behaviorBaseBytes += 2*p.protocol!.nonRequestObservations*(capacity.observationBytes+size(observation('x',{kind:'start'})));
  const judgments = { version: 1, attemptDigest: zero, evidenceDigest: zero, contextDigest: zero, reviewedAt: at, opportunities: m.opportunities.map(o => ({ id: o.id, outcome: 'unavailable', judgment: ref })), controls: m.controls.map(o => ({ id: o.id, outcome: 'unavailable', judgment: ref })), boundaries: m.boundaries.map(id => ({ id, outcome: 'unavailable', judgment: ref })), overall: 'unavailable', judgment: ref };
  const worstId = '\u0000'.repeat(256), readBytes = size({ requestId: worstId, artifact: ref, localToolCallId: worstId, localRunId: worstId, stepId: worstId });
  const reviews = r.roles.filter(role => role.kind === 'reviewer').map(role => wrap({ version: 2, registrationDigest: zero, behaviorDigest: zero, roleId: role.id, review: wrap(judgments, role.assignmentId!), execution: wrap({ version: 2, registrationDigest: zero, behaviorDigest: zero, roleId: role.id, requestId: worstId, requestIdentityDigest: zero, settledStateDigest: zero, settlementDigest: zero, input: ref, response: ref, output: ref, derivedAt: at, evidenceReads: [], decoder: 'openai-responses-final.v1' }) }));
  const readAllowances = r.roles.filter(role => role.kind === 'reviewer').reduce((n, role) => n + Math.max(0, p.roles.find(rp => rp.roleId === role.id)!.maxDrafts - 1) * readBytes, 0);
  capacity.finalBaseBytes = size({ version: 2, registration: p.registration, reviews, accountingTail: wrap({ version: 2, registrationDigest: zero, behaviorDigest: zero, transitions: [], artifactIndex: [] }), closure: wrap({ version: 2, registrationDigest: zero, behaviorDigest: zero, tailDigest: zero, reviewDigests: [zero, zero], closedAt: at, rootCancelled: false, requestStates: r.originalRequests.map(q => ({ id: q.request.id, stateDigest: zero })), accounting }, trust.envelope.closure.id) }) + readAllowances + 32;
  const snapshotOwnerBytes = Math.max(...r.roles.map(role => size({ roleId: role.id, source: { pathIdentity: { device: '9'.repeat(20), inode: '9'.repeat(20) }, journalDigest: zero }, artifact: ref, cursor: Number.MAX_SAFE_INTEGER, snapshotDigest: zero, clock: { kind: 'synthetic', wallMs: Number.MAX_SAFE_INTEGER, monotonicMs: Number.MAX_VALUE, bootId: 'x'.repeat(128), processStart: 'x'.repeat(128) } })));
  capacity.dispositionOwnerBytes = Math.max(...r.roles.map(role => size(wrap({ version: 1, planDigest: zero, attemptDigest: zero, grantDigest: zero, custodianId: p.retention?.value.custodianId ?? m.observerId, status: 'document-history-corrupt-or-missing', reasonCode: '\u0000'.repeat(128), behaviorDigest: zero, inventoryDigest: zero, source: { roleId: role.id, journalDigest: zero, cursor: Number.MAX_SAFE_INTEGER, withdrawalIdsDigest: zero, withdrawalCount: Number.MAX_SAFE_INTEGER, artifact: ref, retentionStatus: 'capacity-unavailable' } })))) + 32;
  capacity.ownerBaseBytes = capacity.dispositionOwnerBytes + fixedObservations + p.capacity.maxSnapshots * (p.captureLayout?.maxCaptureIndexBytes ?? snapshotOwnerBytes) + capacity.maxRequests * 1024 + packet.assignments.reduce((n, a) => n + size({ roleId: a.roleId, id: a.id, runId: worstId }), 0) + capacity.terminalOwnerBytes + size(terminalPending) + 8192 + (p.captureLayout ? p.captureLayout.referencedOriginalPool.maxOriginals * 512 + p.captureLayout.proofPool.maxArtifacts*256 : 0);
  if (capacity.reviewReservations) {
    const extra = capacity.reviewReservations.reduce((n, q) => n + q.metadataBytes, 0);
    capacity.finalBaseBytes += capacity.reviewReservations.reduce((n, q) => n + q.bindingBytes + p.roles.find(rp => rp.roleId === q.roleId)!.maxDrafts * q.readEntryBytes, 0);
    capacity.ownerBaseBytes += extra + size({ reviewAdmissionDigest: capacity.reviewAdmissionDigest, reviewEntries: [], reviewReservations: capacity.reviewReservations });
  }
  if (sourceAdmission) {
    try { capacity.sourceAdmission = reserveSourceAdmission(p, sourceAdmission, reader); }
    catch(error) { throw new AcquisitionInfeasible(`Source admission preclaim cannot fit: ${String(error instanceof Error ? error.message : error)}`); }
    const admission = capacity.sourceAdmission;
    if(admission.observationBytes > capacity.observationBytes) throw new AcquisitionInfeasible('Source admission raw observation template exceeds unchanged singleton');
    capacity.ownerBaseBytes += admission.ownerBytes;
    // Existing nonrequest allowances cover each raw wrapper; account any larger signed wire in every B copy.
    const signedBase = size(observation('x',{kind:'start'}));
    capacity.behaviorBaseBytes += 2 * p.protocol!.nonRequestObservations * Math.max(0, admission.signedObservationBytes - signedBase);
  }
  const entryBytes = Math.max(...r.roles.map(role => size({ artifact: ref, bytes: m.limits.maxArtifactBytes, pool: 'response', roleId: role.id, slot: 'observation' })));
  const fullIndex = acquisitionMetadataUsage(p, capacity, p.capacity.maxArtifacts, []);
  const mandatoryIndex = mandatoryAcquisitionSlots(p, capacity);
  const metadata = acquisitionMetadataUsage(p, capacity, mandatoryIndex, []);
  if (entryBytes > p.capacity.inventoryEntryBytes || fullIndex.behaviorBytes > Math.min(p.captureLayout?.metadata.behaviorBytes ?? p.capacity.envelopeBytes, m.limits.maxArtifactBytes) || metadata.finalBytes > Math.min(p.captureLayout?.metadata.finalBytes ?? m.limits.maxArtifactBytes,m.limits.maxArtifactBytes) || metadata.totalBytes > capacity.metadataBytes)
    throw new AcquisitionInfeasible(`Complete signed B/index and final/owner serialized metadata cannot fit original reserve (B=${fullIndex.behaviorBytes}/${Math.min(p.capacity.envelopeBytes,m.limits.maxArtifactBytes)}, final=${metadata.finalBytes}/${m.limits.maxArtifactBytes}, total=${metadata.totalBytes}/${capacity.metadataBytes}, entry=${entryBytes}/${p.capacity.inventoryEntryBytes})`);
  if (p.captureLayout && (capacity.sourceArtifacts > p.captureLayout.sourcePool.maxArtifacts || sourceBytes > p.captureLayout.sourcePool.maxBytes || metadata.ownerBytes > p.captureLayout.metadata.ownerWithoutBehaviorBytes || metadata.ownerBytes + metadata.behaviorBytes > p.captureLayout.metadata.ownerBytes)) throw new AcquisitionInfeasible('Complete source and owner metadata profile cannot fit');
  return { plan: inertSnapshot(p), capacity };
}

/** Independently configured copy authority; never inferred from plan signature/audience access. */
export function verifyEvidenceRetention(p: DevelopmentAcquisitionPlan, trust: AcquisitionPlanTrust): void {
  if (!p.retention) { invariant(p.manifest.value.evidenceKind === 'synthetic', 'Independent evidence retention grant required before live claim'); return; }
  const t = trust.retention; invariant(t, 'Independent retention acceptance missing');
  const g = authenticate(evidenceRetentionDomain, p.retention, t.issuers);
  exact(g, 'version,id,attemptDigest,sourceDigest,rawStoreDigest,custodianId,purpose,audiences,dataScope,retention,withdrawal');
  invariant(g.version === 1 && identity(g) === t.acceptedGrantDigest && g.attemptDigest === identity(p.manifest.value) && g.sourceDigest === retentionSourceDigest(p) && g.rawStoreDigest === identity(p.rawStore), 'Independent retention grant source/attempt/store changed');
  for (const value of [g.id, g.custodianId, g.purpose, t.custodianSigner]) invariant(typeof value === 'string' && value.length > 0 && value.length <= 256, 'Bounded external retention identity required');
  invariant(Array.isArray(g.audiences) && g.audiences.length > 0 && g.audiences.length <= 64 && new Set(g.audiences).size === g.audiences.length && g.audiences.every(v => typeof v === 'string' && v.length > 0 && v.length <= 256), 'Explicit bounded retention audiences required');
  const recipients = [`principal:${p.manifest.value.observerId}`, ...p.registration.value.roles.filter(r => r.profile).map(r => `provider:${r.profile!.provider ?? 'mistral'}`), ...p.registration.value.roles.filter(r => r.kind === 'reviewer').map(r => `reviewer:${r.assignmentId}`)];
  invariant(recipients.every(id => g.audiences.includes(id)), 'Provider/reviewer/principal lacks independent retention audience authority');
  invariant(g.retention === 'independent-indefinite' && g.withdrawal === 'stop-use-retain-originals' && g.dataScope === 'complete-operational-role-sources', 'Unsupported evidence retention horizon/withdrawal/scope');
}

/** Declared no-reuse slots/bytes. Global pair accounting is additional to raw digest dedup. */
export function mandatoryAcquisitionSlots(p: DevelopmentAcquisitionPlan, c: AcquisitionCapacity): number {
  const l=p.captureLayout;
  return (l?.sourcePool.maxArtifacts ?? c.sourceArtifacts) + p.capacity.maxSnapshots * (l ? l.page.maxPages + 1 : 1) + (l?.referencedOriginalPool.maxOriginals ?? 0) + c.mandatoryObservations + c.maxRequests + 3 + (l?.proofPool.maxArtifacts ?? 0) + (c.reviewReservations?.reduce((n,q)=>n+q.draftSlots,0) ?? 0);
}
export function mandatoryAcquisitionCaptureBytes(p: DevelopmentAcquisitionPlan, c: AcquisitionCapacity): number {
  const l=p.captureLayout;
  return (l?.sourcePool.maxBytes ?? c.sourceBytes) + p.capacity.maxSnapshots * (l ? l.page.maxSerializedBytes+l.maxManifestBytes : p.capacity.maxSnapshotBytes) + (l?.referencedOriginalPool.maxBytes ?? 0) + c.mandatoryObservations*c.observationBytes + (l?.proofPool.maxBytes ?? 0);
}
function validatePagePlan(p: DevelopmentAcquisitionPlan, packet: AcquisitionAssignmentPacket): void {
  const l=p.captureLayout!, q=p.protocol!, m=p.manifest.value;
  invariant(m.version===2 && m.capacityProfile===developmentCapacityProfile && l && q, 'Explicit complete-page capacity profile required');
  exact(l,'kind,page,maxManifestBytes,maxCaptureIndexBytes,referencedOriginalPool,sourcePool,proofPool,metadata'); invariant(l.kind==='complete-pages-global-originals-v1','Unknown page layout');
  exact(l.page,'maxPageRows,maxPageBytes,maxPages,maxPhysicalRows,maxConservativeBytes,maxSerializedBytes,maxOperationalArtifacts,maxOperationalArtifactBytes,maxOperationalArtifactTotalBytes');
  const pageCeilings={maxPageRows:512,maxPageBytes:262144,maxPages:64,maxPhysicalRows:32768,maxConservativeBytes:16777216,maxSerializedBytes:4194304,maxOperationalArtifacts:2048,maxOperationalArtifactBytes:1000000,maxOperationalArtifactTotalBytes:16777216}; for(const key of Object.keys(pageCeilings) as (keyof PageCaptureBounds)[])positive(l.page[key],pageCeilings[key]);
  invariant(l.page.maxPhysicalRows<=l.page.maxPages*l.page.maxPageRows && l.page.maxConservativeBytes<=l.page.maxPages*l.page.maxPageBytes && l.page.maxSerializedBytes<=l.page.maxPages*l.page.maxPageBytes && l.page.maxOperationalArtifactBytes<=developmentOperationalArtifactBytes,'Page aggregate/singleton bounds differ');
  exact(l.referencedOriginalPool,'maxOriginals,maxBytes'); exact(l.sourcePool,'maxArtifacts,maxBytes'); exact(l.proofPool,'maxArtifacts,maxBytes,mandatoryArtifacts,mandatoryArtifactBytes'); exact(l.metadata,'behaviorBytes,finalBytes,ownerWithoutBehaviorBytes,ownerBytes');
  for(const pool of [l.referencedOriginalPool,l.sourcePool,l.proofPool,l.metadata]) for(const value of Object.values(pool)) positive(value,developmentCapacityLimits.maxEvidenceBytes);
  positive(l.maxManifestBytes,1048576);positive(l.maxCaptureIndexBytes,4096); invariant(p.capacity.maxSnapshotBytes===l.maxManifestBytes&&l.sourcePool.maxArtifacts<=32&&l.sourcePool.maxBytes<=1048576&&l.referencedOriginalPool.maxOriginals<=2048&&l.referencedOriginalPool.maxBytes<=16777216&&l.proofPool.maxArtifacts<=256&&l.proofPool.maxBytes<=16777216&&l.metadata.behaviorBytes<=16777216&&l.metadata.finalBytes<=25165824&&l.metadata.ownerWithoutBehaviorBytes<=25165824&&l.metadata.ownerBytes<=41943040,'Named complete-page profile bounds exceeded');
  invariant(l.proofPool.mandatoryArtifacts===202 && l.proofPool.mandatoryArtifactBytes<=developmentOperationalArtifactBytes && l.proofPool.mandatoryArtifacts*l.proofPool.mandatoryArtifactBytes<=l.proofPool.maxBytes && l.proofPool.mandatoryArtifacts<=l.proofPool.maxArtifacts && l.metadata.behaviorBytes<=m.limits.maxArtifactBytes && l.metadata.finalBytes<=m.limits.maxArtifactBytes && l.metadata.ownerBytes>=l.metadata.ownerWithoutBehaviorBytes+l.metadata.behaviorBytes && 2*l.metadata.behaviorBytes+l.metadata.finalBytes+l.metadata.ownerWithoutBehaviorBytes<=acquisitionCapacity(p).metadataBytes,'Explicit canonical copy ceilings cannot fit');
  exact(q,'nonRequestObservations,initialCaptures,cycleCaptures,boundaryCaptures,schedule');
  for(const v of [q.nonRequestObservations,q.initialCaptures,q.cycleCaptures,q.boundaryCaptures]) invariant(Number.isSafeInteger(v)&&v>=0&&v<=512,'Invalid protocol capture/observation bound');
  invariant(q.nonRequestObservations>=2 && q.initialCaptures>=p.registration.value.roles.filter(r=>r.kind!=='reviewer').length && q.schedule.length===packet.assignments.length,'Complete protocol inventory required');
  invariant(p.registration.value.roles.filter(r=>r.kind!=='reviewer').every(r=>p.roles.find(rp=>rp.roleId===r.id)!.journal!==null)&&p.registration.value.roles.filter(r=>r.kind!=='reviewer').length===6&&q.nonRequestObservations===40&&q.initialCaptures===6&&q.cycleCaptures===6&&q.boundaryCaptures===12&&q.schedule.length===126,'Complete adopted126/156 protocol required');
  for(const role of p.registration.value.roles.filter(r=>r.kind!=='reviewer')){const ablation=role.kind==='candidate'||m.controls.some(c=>c.id===role.assignmentId&&['no-memory','no-standing-goals'].includes(c.kind));const expected=ablation?{opportunity:12,learning:3,interference:9,feedback:12}:{script:3,'script-feedback':3};const entries=q.schedule.filter(a=>a.roleId===role.id);invariant(entries.length===Object.values(expected).reduce((n,v)=>n+v,0),'Role schedule is incomplete');for(const [phase,count]of Object.entries(expected)){const items=entries.filter(a=>a.phase===phase);invariant(items.length===count&&new Set(items.map(a=>a.ordinal)).size===count&&items.every(a=>a.ordinal>=0&&a.ordinal<count),'Role phase ordinal coverage incomplete');}}
  const ids=new Set<string>();for(const a of q.schedule){exact(a,'roleId,assignmentId,phase,ordinal'); const key=canonicalJson([a.roleId,a.assignmentId]);invariant(!ids.has(key)&&packet.assignments.some(x=>x.roleId===a.roleId&&x.id===a.assignmentId)&&['opportunity','learning','interference','feedback','script','script-feedback'].includes(a.phase)&&Number.isSafeInteger(a.ordinal)&&a.ordinal>=0,'Protocol schedule must exactly match ordinary packet');ids.add(key);}
}
