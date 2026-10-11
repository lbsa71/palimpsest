/** Pure concrete reviewer. Its CLI and every runtime dependency are old-policy descriptor bytes. */
import { createHash, createHmac } from 'node:crypto';
import type { ArtifactRef } from '../../packages/contracts/index.ts';
import type { EvaluationRequest } from '../../deployment/evolution-tools.ts';
import type { ReviewResponse } from '../../deployment/evaluation-dispatch.ts';
import type { OfflineCase, OfflineObservation, OfflinePlan, ReviewerInput } from './index.ts';

export interface ReviewPacket {
  request: EvaluationRequest; evaluatorId: string; evaluatorArtifact: ArtifactRef;
  recoveryArtifact: ArtifactRef; offlineObservations: OfflineObservation[];
}
const sort = (value: unknown): unknown => Array.isArray(value) ? value.map(sort) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort((value as Record<string, unknown>)[key])])) : value;
export const canonical = (value: unknown): string => JSON.stringify(sort(value));
export const digest = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);
const requireThat: (condition: unknown, message: string) => asserts condition = (condition, message) => { if (!condition) throw Error(message); };

/** Check raw returned evidence independently of the candidate's decision code. */
function matchesResponse(input: ReviewerInput, raw: unknown, verdict: 'pass' | 'fail'): boolean {
  try {
    const response = raw as ReviewResponse, x = input.packet, r = x.request;
    const { receipt, proof } = response.result, [evidence] = receipt.evidence;
    if (!evidence || receipt.evidence.length !== 1 || proof.signed.length !== 1) return false;
    const results = input.plan.cases.map(c => {
      const observation = x.offlineObservations.find(o => o.caseId === c.id)!;
      const sha256 = digest(observation);
      return { id: c.id, status: commandPassed(c, observation.command) ? 'pass' : 'fail',
        observations: { uri: `sha256:${sha256}`, sha256 }, usage: observation.physical.usage, interventions: [] };
    });
    const observationDigests = input.plan.cases.map(c => digest(x.offlineObservations.find(o => o.caseId === c.id)));
    const summary = { version: 1, requestId: r.requestId, candidateId: r.candidate.manifest.id, planDigest: digest(input.plan), observations: observationDigests };
    const summaryDigest = digest(summary);
    if (!same(evidence, { id: 'offline:' + r.requestId, candidateId: r.candidate.manifest.id,
      controlRevision: r.proposal.authority.controlRevision, evaluatorId: x.evaluatorId, evaluatorArtifact: x.evaluatorArtifact,
      independent: true, verdict, artifact: { uri: `sha256:${summaryDigest}`, sha256: summaryDigest }, caseResults: results })) return false;
    if (!same(receipt, { requestId: r.requestId, candidateId: r.candidate.manifest.id, policyDigest: r.policyDigest,
      evidence: [evidence], receipt: { offlinePlan: digest(input.plan) } })) return false;
    if (!same(proof.proposal, { id: r.requestId, candidate: r.candidate.manifest, priorAuthority: r.proposal.authority,
      evidence: [evidence], recoveryArtifact: x.recoveryArtifact })) return false;
    const authentication = createHmac('sha256', Buffer.from(input.keyHex, 'hex')).update(canonical({ evidence, policyDigest: r.policyDigest })).digest('hex');
    if (!same(proof.signed, [{ evidence, authentication }])) return false;
    const expectedBytes = [...input.plan.cases.map(c => canonical(x.offlineObservations.find(o => o.caseId === c.id))), canonical(summary)];
    if (!same(response.artifacts, expectedBytes.map(text => { const bytes = Buffer.from(text); return { sha256: hash(bytes), base64: bytes.toString('base64') }; }))) return false;
    return same(Object.keys(response).sort(), ['artifacts', 'result']) && same(Object.keys(response.result).sort(), ['proof', 'receipt']);
  } catch { return false; }
}

export function assessCaseOutput(c: OfflineCase, output: unknown): boolean {
  if (c.kind === 'validator-string-length') return same(output, c.expected);
  if (!Array.isArray(output) || output.length !== c.inputs.length) return false;
  return output.every((raw, index) => {
    const expected = c.expected[index]!;
    if (expected === 'refuse') return same(raw, { kind: 'refused' });
    return raw && same(Object.keys(raw).sort(), ['kind', 'response']) && raw.kind === 'result' && matchesResponse(c.inputs[index]!, raw.response, expected);
  });
}
export function commandPassed(c: OfflineCase, command: OfflineObservation['command']): boolean {
  if (command.exitCode !== 0 || command.signal || command.stoppedFor) return false;
  try { return assessCaseOutput(c, JSON.parse(command.stdout)); } catch { return false; }
}

/** The function probed in the candidate is exactly the function used by the sealed CLI. */
export function reviewOfflinePacket(x: ReviewPacket, plan: OfflinePlan, key: Uint8Array): ReviewResponse {
  const r = x.request;
  requireThat(x.offlineObservations?.length === plan.cases.length && new Set(x.offlineObservations.map(o => o.caseId)).size === plan.cases.length, 'Missing or duplicate original offline observations');
  const artifacts: ReviewResponse['artifacts'] = [], results = [];
  for (const c of plan.cases) {
    const observation = x.offlineObservations.find(o => o.caseId === c.id);
    requireThat(observation && observation.requestId === r.requestId && observation.candidateId === r.candidate.manifest.id && observation.policyDigest === r.policyDigest && observation.evaluatorDigest === x.evaluatorArtifact.sha256 && observation.planDigest === digest(plan) && observation.runnerDigest === plan.runnerDigest && observation.inputDigest === digest(c.inputs), 'Offline observation binding mismatch');
    const physical = observation.physical, physicalId = `external-review:${r.requestId}:probe:${c.id}`;
    requireThat(physical.id === physicalId && physical.reservationId === physicalId && physical.runId === r.proposal.runId && physical.provider === 'external-offline-review' && physical.purpose === 'review' && physical.model === x.evaluatorId && physical.promptManifestId === `reviewer-closure:${x.evaluatorArtifact.sha256}` && physical.requestDigest === digest({ request: r, operation: { id: c.id, digest: digest({ planDigest: digest(plan), case: c }) } }), 'Original offline physical binding mismatch');
    requireThat(physical.usage.requests === 1 && physical.usage.inputTokens === 0 && physical.usage.outputTokens === 0 && physical.usage.costUsd === 0 && Number.isFinite(physical.usage.elapsedMs) && physical.usage.elapsedMs >= 0, 'Invalid offline physical usage');
    const passed = commandPassed(c, observation.command);
    requireThat(passed === observation.passed && observation.physical.status === 'succeeded', 'Original offline assessment mismatch');
    const bytes = Buffer.from(canonical(observation)), sha256 = hash(bytes), artifact = { uri: 'sha256:' + sha256, sha256 };
    artifacts.push({ sha256, base64: bytes.toString('base64') });
    results.push({ id: c.id, status: passed ? 'pass' as const : 'fail' as const, observations: artifact, usage: observation.physical.usage, interventions: [] });
  }
  const summary = Buffer.from(canonical({ version: 1, requestId: r.requestId, candidateId: r.candidate.manifest.id, planDigest: digest(plan), observations: artifacts.map(a => a.sha256) }));
  const sha256 = hash(summary); artifacts.push({ sha256, base64: summary.toString('base64') });
  const evidence = { id: 'offline:' + r.requestId, candidateId: r.candidate.manifest.id, controlRevision: r.proposal.authority.controlRevision,
    evaluatorId: x.evaluatorId, evaluatorArtifact: x.evaluatorArtifact, independent: true, verdict: results.every(c => c.status === 'pass') ? 'pass' as const : 'fail' as const,
    artifact: { uri: 'sha256:' + sha256, sha256 }, caseResults: results };
  const authentication = createHmac('sha256', key).update(canonical({ evidence, policyDigest: r.policyDigest })).digest('hex');
  return { result: { receipt: { requestId: r.requestId, candidateId: r.candidate.manifest.id, policyDigest: r.policyDigest, evidence: [evidence], receipt: { offlinePlan: digest(plan) } },
    proof: { proposal: { id: r.requestId, candidate: r.candidate.manifest, priorAuthority: r.proposal.authority, evidence: [evidence], recoveryArtifact: x.recoveryArtifact }, signed: [{ evidence, authentication }] } }, artifacts };
}
