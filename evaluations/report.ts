import type { CaseResult } from './execution/screen.ts';
import { digest } from './execution/screen.ts';

export interface MeasurementEnvelope {
  schema: 'aeon.evaluation.measurement.v1';
  protocol: string;
  workload: string;
  evaluatorArtifact: string;
  candidate: { source: string; dependencies: string | null; prompts: string | null; model: string | null; configuration: string };
  evaluatorId: string;
  independent: false;
  evidenceKind: 'mechanical';
  comparisonMode: 'deterministic';
  caseResults: CaseResult[];
  resources: { physicalModelRequests: 0; modelTokens: null; cost: null; interventions: 0; wallMs: number };
  verdict: 'pass' | 'fail';
  admission: 'ineligible';
  parity: 'unavailable';
  development: 'unavailable';
  limitations: string[];
}
export function mechanicalReport(input: Pick<MeasurementEnvelope, 'protocol' | 'workload' | 'evaluatorArtifact' | 'candidate' | 'evaluatorId'>, results: CaseResult[], wallMs: number): MeasurementEnvelope {
  const identities = [input.protocol, input.workload, input.evaluatorArtifact, input.candidate.source, input.candidate.configuration];
  if (identities.some(value => !/^[a-f0-9]{64}$/.test(value))) throw new Error('Evidence identities must be SHA256');
  if (!Number.isFinite(wallMs) || wallMs < 0) throw new Error('Invalid elapsed time');
  const expectedIds = Array.from({ length: 12 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`);
  const complete = results.length === 12 && expectedIds.every(id => results.filter(result => result.id === id).length === 1);
  return { ...input, schema: 'aeon.evaluation.measurement.v1', independent: false, evidenceKind: 'mechanical', comparisonMode: 'deterministic',
    caseResults: structuredClone(results), resources: { physicalModelRequests: 0, modelTokens: null, cost: null, interventions: 0, wallMs },
    verdict: complete && results.every(result => result.status === 'pass' && !result.failedChecks.length && result.actions <= 64) ? 'pass' : 'fail',
    admission: 'ineligible', parity: 'unavailable', development: 'unavailable',
    limitations: ['Scripted actor and synthetic tools establish harness mechanics only.', 'No product comparison, fresh independent acceptance, real elapsed development or H1 evidence.', `Observation content digest: ${digest(results)}`] };
}
