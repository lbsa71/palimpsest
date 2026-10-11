import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalJson, identity, validateRelease, type Authority, type EvaluationEvidence, type ReleaseProposal } from '../contracts/index.ts';
import { verifyCandidate } from './artifacts.ts';

export interface SignedEvaluation { evidence: EvaluationEvidence; authentication: string }
export interface AdmissionPolicy {
  controlRevision: string;
  policyDigest: string;
  requiredCases: string[];
  evaluatorKeys: ReadonlyMap<string, Uint8Array>;
  evaluatorArtifacts: ReadonlyMap<string, string>;
  kind: 'engineering' | 'product';
}
export interface AdmissionReceipt { candidateId: string; priorAuthority: Authority; policyDigest: string; evidenceIds: string[]; controlChange: boolean; kind: AdmissionPolicy['kind'] }

export function admissionPolicyIdentity(policy: Omit<AdmissionPolicy, 'policyDigest'>): string {
  return identity({ controlRevision: policy.controlRevision, kind: policy.kind, requiredCases: [...policy.requiredCases].sort(),
    evaluatorArtifacts: [...policy.evaluatorArtifacts].sort(([a], [b]) => a.localeCompare(b)),
    evaluatorKeyDigests: [...policy.evaluatorKeys].map(([id, key]) => [id, createHash('sha256').update(key).digest('hex')]).sort(([a], [b]) => a!.localeCompare(b!)) });
}

function authentication(evidence: EvaluationEvidence, key: Uint8Array, policyDigest: string): string {
  if (key.byteLength < 32) throw new Error('Reviewer authentication key is too short');
  return createHmac('sha256', key).update(canonicalJson({ evidence, policyDigest })).digest('hex');
}
/** Invoked by the independent host evaluator; its secret is never present in a candidate workspace. */
export function signEvaluation(evidence: EvaluationEvidence, key: Uint8Array, policyDigest: string): SignedEvaluation {
  return { evidence, authentication: authentication(evidence, key, policyDigest) };
}

export function admitCandidate(storeRoot: string, proposal: ReleaseProposal, current: Authority,
  policy: AdmissionPolicy, signed: readonly SignedEvaluation[], readArtifact: (uri: string) => Uint8Array,
  change: 'ordinary' | 'control-upgrade' = 'ordinary'): AdmissionReceipt {
  if (policy.controlRevision !== current.controlRevision) throw new Error('Admission policy is not the current control revision');
  if (policy.policyDigest !== admissionPolicyIdentity(policy)) throw new Error('Admission requires the exact frozen policy digest');
  if (policy.requiredCases.length === 0 || new Set(policy.requiredCases).size !== policy.requiredCases.length) throw new Error('Required cases must be explicit and unique');
  const candidate = verifyCandidate(storeRoot, proposal.candidate.id);
  if (candidate.manifest.controls !== current.controlRevision && change !== 'control-upgrade') throw new Error('Control change requires a separately staged upgrade');
  if (identity(candidate.manifest) !== identity(proposal.candidate)) throw new Error('Proposed candidate differs from frozen candidate');
  validateRelease(proposal, current, [...policy.evaluatorKeys.keys()]);
  if (createHash('sha256').update(readArtifact(proposal.recoveryArtifact.uri)).digest('hex') !== proposal.recoveryArtifact.sha256) throw new Error('Recovery artifact changed');
  const found = new Set<string>();
  for (const evidence of proposal.evidence) {
    const record = signed.find(item => item.evidence.id === evidence.id);
    if (!record || identity(record.evidence) !== identity(evidence)) throw new Error('Missing independently authenticated evidence');
    const key = policy.evaluatorKeys.get(evidence.evaluatorId)!;
    const expected = Buffer.from(authentication(evidence, key, policy.policyDigest), 'hex');
    const actual = Buffer.from(record.authentication, 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Invalid reviewer authentication');
    if (policy.evaluatorArtifacts.get(evidence.evaluatorId) !== evidence.evaluatorArtifact.sha256) throw new Error('Unqualified evaluator artifact');
    for (const artifact of [evidence.evaluatorArtifact, evidence.artifact, ...evidence.caseResults.map(result => result.observations)]) {
      if (createHash('sha256').update(readArtifact(artifact.uri)).digest('hex') !== artifact.sha256) throw new Error('Evidence artifact changed');
    }
    evidence.caseResults.forEach(result => { if (result.status === 'pass') found.add(result.id); });
  }
  if (policy.requiredCases.some(id => !found.has(id))) throw new Error('Required evaluation cases missing');
  return { candidateId: candidate.manifest.id, priorAuthority: { ...current }, policyDigest: policy.policyDigest,
    evidenceIds: proposal.evidence.map(evidence => evidence.id), controlChange: candidate.manifest.controls !== current.controlRevision, kind: policy.kind };
}
