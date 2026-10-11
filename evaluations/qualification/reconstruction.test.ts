import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { candidateIdentity, identity, type PhysicalRequest } from '../../packages/contracts/index.ts';
import { admissionPolicyIdentity, type AdmissionPolicy } from '../../packages/release/admission.ts';
import { hashBytes } from '../../packages/release/artifacts.ts';
import { signDocument, type Experiment, type PrivatePacket } from './manifest.ts';
import { QualificationStore } from './store.ts';
import { assessObjectiveArtifacts, toReleaseEvidence, type ObservationBundle, type QualificationTrust } from './observer.ts';

/** Test-key reconstruction fixtures are deliberately authored records, never live evidence.
 * This exercises the consumer after authentication without invoking a provider or worker. */
function fixture(physicalElapsed: number[], wallMs: number, unknown = false) {
  const root = mkdtempSync(join(tmpdir(), 'aeon-qualification-reconstruction-')), store = new QualificationStore(root);
  const key = Buffer.alloc(32, 71), hash = identity('reconstruction-fixture'), model = { id: 'fixture-model' };
  const candidateBase = { source: hash, dependencies: hash, prompts: hash, model: identity(model), configuration: hash, controls: hash, createdBy: 'fixture-author' };
  const candidate = { ...candidateBase, id: candidateIdentity(candidateBase) };
  const observerArtifact = store.put({ fixtureOnly: true });
  const packet: PrivatePacket = { task: { id: 'fixture-objective', prompt: 'Write an answer.' }, claim: 'objective-artifact', checks: [{ id: 'exact-file', kind: 'file-equals', path: 'result', expected: '42' }] };
  const policyBase = { controlRevision: hash, requiredCases: [packet.task.id], evaluatorKeys: new Map([['fixture-reviewer', key]]), evaluatorArtifacts: new Map([['fixture-reviewer', observerArtifact.sha256]]), kind: 'product' as const };
  const policy: AdmissionPolicy = { ...policyBase, policyDigest: admissionPolicyIdentity(policyBase) };
  const trust: QualificationTrust = { issuerKeys: new Map([['fixture-issuer', key]]), policy, observerArtifact, objectiveCases: new Map([[packet.task.id, identity(packet)]]), protocolDigest: hash, calibrationPlans: new Set([hash]) };
  const ended = Date.now(), issued = ended - wallMs, issuedAt = new Date(issued).toISOString();
  const experiment: Experiment = { version: 1, id: 'reconstruction', grantId: 'reconstruction-grant', kind: 'live-product', candidate, configurationDigest: identity({}), protocolDigest: hash, calibrationPlanDigest: hash, privatePacketDigest: identity(packet), observerArtifactDigest: observerArtifact.sha256, evaluatorId: 'fixture-reviewer', priorPolicyDigest: policy.policyDigest,
    resources: { maxRequests: 8, maxTokens: 1000, maxCostUsd: 1, maxElapsedMs: 60000, maxConcurrency: 2 }, issuedAt, expiresAt: new Date(issued + 60000).toISOString(), maxEvidenceBytes: 100000, maxArtifactBytes: 10000 };
  const requests: PhysicalRequest[] = physicalElapsed.map((elapsedMs, index) => ({ id: `physical-${index}`, runId: 'fixture-run', purpose: 'reasoning', provider: 'fixture-provider', model: 'fixture-model', promptManifestId: 'fixture-prompt', requestDigest: hash, reservationId: `physical-${index}`, status: unknown ? 'uncertain' : 'succeeded', usage: { requests: 1, inputTokens: unknown ? null : 1, outputTokens: unknown ? null : 1, costUsd: unknown ? null : 0, elapsedMs } }));
  const assessment = assessObjectiveArtifacts(packet, { readArtifact: () => '42' }, new Map(), 10000, () => undefined);
  const observation = { status: 'completed', physicalRequests: requests };
  const report = { independent: false, admissionEligible: false, evidenceKind: 'live-product', transportFixtures: null, verdict: 'case-pass', taskId: packet.task.id, observerId: experiment.evaluatorId,
    identities: { source: hash, dependencies: hash, protocol: hash, configuration: hashBytes('{}'), evaluator: observerArtifact.sha256, task: identity(packet) }, candidateModel: model, observation, assessment };
  const bundle: ObservationBundle = { version: 1, experiment: signDocument('aeon.qualification.experiment.v1', experiment, 'fixture-issuer', key), kind: 'live-product', startedAt: issuedAt, endedAt: new Date(ended).toISOString(), observerArtifact, configurationJson: '{}', originalAdapterReport: store.put(report), observation: store.put(observation), privatePacket: store.put(packet), artifacts: [{ path: 'result', artifact: store.put({ content: '42' }) }], commands: [], assessment, failure: null,
    ledger: { envelope: experiment.resources, startedAt: issued, requests, cancelled: true } };
  return { bundle, convert() {
    const ref = store.put(bundle);
    const receipt = { bundle: ref, authentication: signDocument('aeon.qualification.observation.v1', { bundle: ref, kind: bundle.kind, experimentDigest: identity(experiment) }, experiment.evaluatorId, key) };
    return toReleaseEvidence(receipt, trust, store);
  }, close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('authenticated reconstruction preserves both aggregate physical time and original wall time', () => {
  for (const [physical, wall, expected] of [[[20000, 20000], 25000, 40000], [[10000, 10000], 40000, 40000]] as const) {
    const f = fixture([...physical], wall);
    try { assert.equal(f.convert().evidence.caseResults[0]!.usage.elapsedMs, expected); }
    finally { f.close(); }
  }
});
test('authenticated reconstruction rejects aggregate physical elapsed exceeding the original grant', () => {
  const f = fixture([40000, 40000], 40000);
  try { assert.throws(() => f.convert(), /Measured original grant exceeded/); }
  finally { f.close(); }
});
test('authenticated reconstruction rejects unknown physical outcomes despite passing objective artifacts', () => {
  const f = fixture([1000], 2000, true);
  try { assert.throws(() => f.convert(), /Unknown physical outcomes/); }
  finally { f.close(); }
});
test('authenticated reconstruction rejects failed observations and expiry beyond the original grant', () => {
  const failed = fixture([1000], 2000);
  try { failed.bundle.failure = 'Observer interrupted'; assert.throws(() => failed.convert(), /Unavailable or failed/); }
  finally { failed.close(); }
  const expired = fixture([1000], 2000);
  try { expired.bundle.endedAt = new Date(Date.parse(expired.bundle.experiment.value.expiresAt) + 1).toISOString(); assert.throws(() => expired.convert(), /outside original grant/); }
  finally { expired.close(); }
});
