import type { ArtifactRef, CandidateManifest, MeasurementEnvelope } from '../packages/contracts/index.ts';
import { validateCandidate, validateEvaluation } from '../packages/contracts/index.ts';
import { digest } from './execution/screen.ts';
import type { MeasurementEnvelope as MechanicalReport } from './report.ts';

/** Host-side conversion only. This never signs or upgrades author-produced fixtures. */
export function mechanicalToContract(report: MechanicalReport, candidate: CandidateManifest, controlRevision: string, reportArtifact: ArtifactRef, evaluatorArtifact: ArtifactRef, observations: Record<string, ArtifactRef>): MeasurementEnvelope {
  validateCandidate(candidate);
  if (reportArtifact.sha256 !== digest(report)) throw new Error('Report artifact digest differs');
  if (candidate.source !== report.candidate.source || candidate.configuration !== report.candidate.configuration) throw new Error('Report and scripted candidate identities differ');
  if (evaluatorArtifact.sha256 !== report.evaluatorArtifact) throw new Error('Evaluator artifact digest differs');
  const evidence: MeasurementEnvelope['evidence'] = {
    id: `mechanical-${reportArtifact.sha256}`,
    candidateId: candidate.id,
    controlRevision,
    evaluatorId: report.evaluatorId,
    evaluatorArtifact,
    independent: false,
    verdict: report.verdict,
    artifact: reportArtifact,
    caseResults: report.caseResults.map(result => {
      const artifact = observations[result.id];
      if (!artifact || artifact.sha256 !== digest(result.observations)) throw new Error(`Missing or mismatched observation artifact ${result.id}`);
      return { id: result.id, status: result.status, observations: artifact, usage: { requests: 0, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: result.elapsedMs }, interventions: [] };
    }),
  };
  validateEvaluation(evidence);
  return { protocolDigest: report.protocol, workloadDigest: report.workload, evidenceKind: 'mechanical', comparisonMode: 'deterministic', evaluatorRole: 'author', evidence };
}
