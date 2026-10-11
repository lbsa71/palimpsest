import { createHash } from 'node:crypto';
import { digest, identity, integer, invariant, nonempty, validateArtifact, validateAuthority, validateScope, validateUsage } from '../common.ts';
import type { ArtifactRef, Authority, DataScope, ResourceEnvelope, ResourceUsage } from '../common.ts';

export interface Capability { id: string; principalId: string; actions: string[]; scope: DataScope; resources: ResourceEnvelope; authority: Authority; expiresAt: string }
export interface PromptFragment { id: string; owner: 'application' | 'self' | 'shell' | 'tool' | 'account' | 'external'; role: 'system' | 'developer' | 'user' | 'tool'; order: number; artifact: ArtifactRef; scope: DataScope; replaceable: boolean; derivedFrom: string[] }
/** requestDigest binds exact emitted payload bytes; fragment artifacts alone are insufficient. */
export interface PromptManifest { id: string; fragments: PromptFragment[]; requestDigest: string; requestArtifact?: ArtifactRef }
export type RequestPurpose = 'reasoning' | 'compaction' | 'review' | 'delegation' | 'embedding';
export interface PhysicalRequest { id: string; runId: string; parentRequestId?: string; purpose: RequestPurpose; provider: string; model: string; promptManifestId: string; requestDigest: string; reservationId: string; status: 'reserved' | 'dispatched' | 'succeeded' | 'failed' | 'uncertain'; usage: ResourceUsage }
export interface CandidateManifest { id: string; source: string; dependencies: string; prompts: string; model: string; configuration: string; controls: string; createdBy: string }
export type CaseStatus = 'pass' | 'fail' | 'unavailable' | 'invalid';
export interface EvaluationCase { id: string; status: CaseStatus; observations: ArtifactRef; usage: ResourceUsage; interventions: string[] }
export interface EvaluationEvidence { id: string; candidateId: string; controlRevision: string; evaluatorId: string; evaluatorArtifact: ArtifactRef; independent: boolean; verdict: 'pass' | 'fail' | 'inconclusive'; artifact: ArtifactRef; caseResults: EvaluationCase[] }
export interface MeasurementEnvelope { protocolDigest: string; workloadDigest: string; evidenceKind: 'mechanical' | 'integration' | 'live-product' | 'live-development'; comparisonMode: 'deterministic' | 'same-model' | 'best-system'; evaluatorRole: 'author' | 'independent'; evidence: EvaluationEvidence }
export interface ReleaseProposal { id: string; candidate: CandidateManifest; priorAuthority: Authority; evidence: EvaluationEvidence[]; recoveryArtifact: ArtifactRef }
export interface RecoveryState { stateRoot: string; latestEventRevision: number; uncertainEffectIds: string[]; obligationIds: string[]; authority: Authority }
export function candidateIdentity(candidate: Omit<CandidateManifest, 'id'>): string { return identity(candidate); }
export function validateCandidate(candidate: CandidateManifest): void {
  for (const key of ['source', 'dependencies', 'prompts', 'model', 'configuration', 'controls'] as const) digest(candidate[key], key);
  nonempty(candidate.createdBy, 'createdBy'); const { id, ...manifest } = candidate; invariant(id === candidateIdentity(manifest), 'candidate identity does not match immutable manifest');
}
export function validatePromptManifest(manifest: PromptManifest): void {
  nonempty(manifest.id, 'manifest.id'); digest(manifest.requestDigest, 'requestDigest'); const ids = new Set<string>(); const orders = new Set<number>();
  for (const fragment of manifest.fragments) { invariant(['application', 'self', 'shell', 'tool', 'account', 'external'].includes(fragment.owner), 'invalid instruction owner'); invariant(['system', 'developer', 'user', 'tool'].includes(fragment.role), 'invalid instruction role'); nonempty(fragment.id, 'fragment.id'); invariant(!ids.has(fragment.id), 'duplicate fragment'); ids.add(fragment.id); integer(fragment.order, 'fragment.order'); invariant(!orders.has(fragment.order), 'ambiguous fragment ordering'); orders.add(fragment.order); validateArtifact(fragment.artifact); validateScope(fragment.scope); invariant(typeof fragment.replaceable === 'boolean', 'replaceable must be explicit'); if (fragment.owner !== 'external') invariant(fragment.replaceable, 'unreplaceable application-side instruction'); }
  if (manifest.requestArtifact) { validateArtifact(manifest.requestArtifact); invariant(manifest.requestArtifact.sha256 === manifest.requestDigest, 'request artifact mismatch'); }
}
export function validateCapturedPrompt(manifest: PromptManifest, serializedPayload: string): void {
  validatePromptManifest(manifest);
  invariant(createHash('sha256').update(serializedPayload).digest('hex') === manifest.requestDigest, 'emitted payload does not match prompt manifest');
}
export function validatePhysicalRequest(request: PhysicalRequest): void {
  for (const key of ['id', 'runId', 'provider', 'model', 'promptManifestId', 'reservationId'] as const) nonempty(request[key], key);
  if (request.parentRequestId !== undefined) { nonempty(request.parentRequestId, 'parentRequestId'); invariant(request.parentRequestId !== request.id, 'request is its own parent'); }
  digest(request.requestDigest, 'requestDigest');
  invariant(['reasoning', 'compaction', 'review', 'delegation', 'embedding'].includes(request.purpose), 'invalid request purpose');
  invariant(['reserved', 'dispatched', 'succeeded', 'failed', 'uncertain'].includes(request.status), 'invalid request status'); validateUsage(request.usage); invariant(request.usage.requests === 1, 'each physical request has its own accounting record');
}
export function validateEvaluation(evidence: EvaluationEvidence): void {
  nonempty(evidence.id, 'evidence.id'); digest(evidence.candidateId, 'candidateId'); nonempty(evidence.controlRevision, 'controlRevision'); nonempty(evidence.evaluatorId, 'evaluatorId'); validateArtifact(evidence.evaluatorArtifact); validateArtifact(evidence.artifact);
  invariant(typeof evidence.independent === 'boolean', 'independence must be explicit'); invariant(['pass', 'fail', 'inconclusive'].includes(evidence.verdict), 'invalid verdict');
  const ids = new Set<string>();
  for (const result of evidence.caseResults) { nonempty(result.id, 'case.id'); invariant(!ids.has(result.id), 'duplicate evaluation case'); ids.add(result.id); invariant(['pass', 'fail', 'unavailable', 'invalid'].includes(result.status), 'invalid case status'); validateArtifact(result.observations); validateUsage(result.usage); result.interventions.forEach(i => nonempty(i, 'intervention')); }
  if (evidence.verdict === 'pass') invariant(evidence.caseResults.length > 0 && evidence.caseResults.every(c => c.status === 'pass'), 'unavailable, invalid, failed or absent cases cannot pass');
}
/** Structural admission only. Trusted producer authentication and complete required-case policy are L09 responsibilities. */
export function validateRelease(proposal: ReleaseProposal, current: Authority, trustedEvaluatorIds: readonly string[]): void {
  validateCandidate(proposal.candidate); validateAuthority(current); validateAuthority(proposal.priorAuthority); validateArtifact(proposal.recoveryArtifact);
  invariant(identity(proposal.priorAuthority) === identity(current), 'release targets stale authority'); invariant(proposal.evidence.length > 0, 'release needs independent evidence');
  for (const evidence of proposal.evidence) {
    validateEvaluation(evidence); invariant(evidence.candidateId === proposal.candidate.id, 'evidence belongs to another candidate'); invariant(evidence.controlRevision === current.controlRevision, 'candidate cannot replace its judging controls'); invariant(evidence.independent && evidence.evaluatorId !== proposal.candidate.createdBy && trustedEvaluatorIds.includes(evidence.evaluatorId), 'untrusted or self evaluation'); invariant(evidence.verdict === 'pass', 'release requires passing evidence');
  }
}
