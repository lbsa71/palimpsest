import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { canonicalJson, identity } from '../../packages/contracts/index.ts';
import { assessOffline, type OfflineObservation, type OfflinePlan, type ReviewerCase, type ReviewerInput } from './index.ts';
import { reviewOfflinePacket, type ReviewPacket } from './review-core.ts';

/** Independent synthetic provisioning; these are not the author's private physical packets. */
function packet(): ReviewerInput {
  const sha = identity('independent-governance-review'), artifact = { uri: `sha256:${sha}`, sha256: sha };
  const plan: OfflinePlan = { version: 2, runnerDigest: sha, cases: ['first', 'second'].map(id => ({
    id, kind: 'validator-string-length', inputs: [{ schema: { type: 'string', minLength: 2 }, value: 'review' }],
    expected: [true], timeoutMs: 50, maxOutputBytes: 512,
  })) };
  const x = { request: { requestId: 'independent-request', policyDigest: sha, candidate: { manifest: { id: sha } },
    proposal: { runId: 'independent-author', authority: { generation: 'old', epoch: 3, controlRevision: sha } } },
    evaluatorId: 'independent-evaluator', evaluatorArtifact: artifact, recoveryArtifact: artifact, offlineObservations: [] } as unknown as ReviewPacket;
  x.offlineObservations = plan.cases.map(c => {
    const id = `external-review:${x.request.requestId}:probe:${c.id}`;
    return { version: 1, requestId: x.request.requestId, candidateId: sha, policyDigest: sha, evaluatorDigest: sha,
      planDigest: identity(plan), runnerDigest: sha, caseId: c.id, inputDigest: identity(c.inputs), passed: true,
      command: { exitCode: 0, signal: null, stdout: '[true]', stderr: '', elapsedMs: 2 },
      physical: { id, reservationId: id, runId: x.request.proposal.runId, provider: 'external-offline-review', purpose: 'review',
        model: x.evaluatorId, promptManifestId: `reviewer-closure:${sha}`,
        requestDigest: identity({ request: x.request, operation: { id: c.id, digest: identity({ planDigest: identity(plan), case: c }) } }),
        status: 'succeeded', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 2 } },
    } satisfies OfflineObservation;
  });
  return { packet: x, plan, keyHex: '73'.repeat(32) };
}
const review = (input: ReviewerInput) => reviewOfflinePacket(input.packet, input.plan, Buffer.from(input.keyHex, 'hex'));
const caseFor = (input: ReviewerInput, verdict: 'pass' | 'fail'): ReviewerCase => ({ id: 'independent-review', kind: 'reviewer-behavior',
  inputs: [input], expected: [verdict], timeoutMs: 100, maxOutputBytes: 16384 });
const command = (output: unknown) => ({ exitCode: 0, signal: null, stdout: JSON.stringify(output), stderr: '', elapsedMs: 2 });

test('review audit: reordered complete observations retain case identity, negative evidence and exact HMAC', () => {
  const input = packet(), failed = input.packet.offlineObservations[1]!;
  failed.command.stdout = '[false]'; failed.passed = false;
  input.packet.offlineObservations.reverse();
  const response = review(input), evidence = response.result.receipt.evidence[0]!;
  assert.equal(evidence.verdict, 'fail');
  assert.deepEqual(evidence.caseResults.map(c => [c.id, c.status]), [['first', 'pass'], ['second', 'fail']]);
  const expectedHmac = createHmac('sha256', Buffer.from(input.keyHex, 'hex'))
    .update(canonicalJson({ evidence, policyDigest: input.packet.request.policyDigest })).digest('hex');
  assert.equal(response.result.proof.signed[0]!.authentication, expectedHmac);
  const artifacts = new Map(response.artifacts.map(blob => [blob.sha256, Buffer.from(blob.base64, 'base64').toString('utf8')]));
  for (const c of evidence.caseResults) {
    const original = input.packet.offlineObservations.find(o => o.caseId === c.id)!;
    assert.equal(c.observations.sha256, identity(original));
    assert.equal(artifacts.get(c.observations.sha256), canonicalJson(original));
  }
  assert.equal(assessOffline(caseFor(input, 'fail'), command([{ kind: 'result', response }])), true);
});

test('review audit: every physical identity and nonzero or invalid usage is an explicit refusal', () => {
  const mutators: ((o: OfflineObservation) => void)[] = [
    ...(['id', 'reservationId', 'runId', 'provider', 'model', 'promptManifestId', 'requestDigest'] as const)
      .map(field => (o: OfflineObservation) => { o.physical[field] = 'other'; }),
    o => { o.physical.purpose = 'reasoning'; },
    ...(['requests', 'inputTokens', 'outputTokens', 'costUsd'] as const)
      .map(field => (o: OfflineObservation) => { o.physical.usage[field] = field === 'requests' ? 2 : 1; }),
    o => { o.physical.usage.elapsedMs = -1; },
    o => { o.physical.usage.elapsedMs = Number.NaN; },
    o => { o.physical.status = 'failed'; },
    o => { o.physical.status = 'reserved'; },
    o => { o.physical.status = 'uncertain'; },
    o => { o.passed = false; },
  ];
  for (const mutate of mutators) {
    const input = packet(); mutate(input.packet.offlineObservations[0]!);
    assert.throws(() => review(input), { code: 'OFFLINE_REVIEW_REFUSED' });
  }
});

test('review audit: re-signed response substitutions cannot conceal altered observations, proof or artifact bytes', () => {
  const input = packet(), c = caseFor(input, 'pass');
  const mutators: ((response: ReturnType<typeof review>) => void)[] = [
    response => { response.result.proof.proposal.recoveryArtifact = { uri: 'sha256:other', sha256: 'other' }; },
    response => { response.result.proof.proposal.priorAuthority.epoch++; },
    response => { response.result.receipt.evidence[0]!.caseResults.reverse(); },
    response => { response.result.receipt.evidence[0]!.caseResults[0]!.interventions.push('hidden assistance'); },
    response => { response.result.receipt.evidence[0]!.caseResults[0]!.usage.elapsedMs++; },
    response => { response.artifacts.reverse(); },
    response => { response.artifacts.push(response.artifacts[0]!); },
    response => { response.artifacts[0]!.base64 = Buffer.from('same claimed hash, different bytes').toString('base64'); },
  ];
  for (const mutate of mutators) {
    const response = structuredClone(review(input)); mutate(response);
    const evidence = response.result.receipt.evidence[0]!;
    response.result.proof.signed = [{ evidence, authentication: createHmac('sha256', Buffer.from(input.keyHex, 'hex'))
      .update(canonicalJson({ evidence, policyDigest: input.packet.request.policyDigest })).digest('hex') }];
    assert.equal(assessOffline(c, command([{ kind: 'result', response }])), false);
  }
});

test('review audit: crash, timeout, signal and missing output cannot become an intended refusal', () => {
  const input = packet(); input.packet.offlineObservations = [];
  const c = { ...caseFor(input, 'pass'), expected: ['refuse'] } satisfies ReviewerCase;
  const refused = command([{ kind: 'refused' }]);
  assert.equal(assessOffline(c, refused), true);
  for (const changed of [command([{ kind: 'error' }]), command([]), command([{ kind: 'refused', reason: 'extra output' }]),
    { ...refused, exitCode: 1 }, { ...refused, signal: 'SIGTERM' as const }, { ...refused, stoppedFor: 'timeout' as const }]) {
    assert.equal(assessOffline(c, changed), false);
  }
});
