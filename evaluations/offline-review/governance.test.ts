import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { canonicalJson, identity, validateCandidate, validateEvaluation, validatePhysicalRequest } from '../../packages/contracts/index.ts';
import { assessOffline, parseOfflinePlan, type OfflineObservation, type OfflinePlan, type ReviewerCase, type ReviewerInput } from './index.ts';
import { reviewOfflinePacket, type ReviewPacket } from './review-core.ts';

/** Test provisioning only; removed from physical candidate input before its source freeze. */
export function governanceCase(): ReviewerCase {
  const sha = identity('synthetic'), artifact = { uri: `sha256:${sha}`, sha256: sha };
  const fields = { source: sha, dependencies: sha, prompts: sha, model: sha, configuration: sha, controls: sha, createdBy: 'synthetic-author' };
  const manifest = { id: identity(fields), ...fields };
  validateCandidate(manifest);
  const plan: OfflinePlan = { version: 2, runnerDigest: sha, cases: [{ id: 'synthetic-string', kind: 'validator-string-length', inputs: [{ schema: { type: 'string', maxLength: 1 }, value: '🚀' }], expected: [true], timeoutMs: 100, maxOutputBytes: 128 }] };
  // Only reviewer-used request fields are needed; no real application artifact or live request exists here.
  const packet = { request: { requestId: 'synthetic-review', policyDigest: sha, candidate: { manifest },
    proposal: { runId: 'synthetic-author', authority: { generation: 'synthetic', epoch: 1, controlRevision: sha } } },
    evaluatorId: 'synthetic-judge', evaluatorArtifact: artifact, recoveryArtifact: artifact, offlineObservations: [] } as unknown as ReviewPacket;
  const c = plan.cases[0]!, id = `external-review:${packet.request.requestId}:probe:${c.id}`;
  const observation: OfflineObservation = { version: 1, requestId: packet.request.requestId, candidateId: manifest.id,
    policyDigest: sha, evaluatorDigest: sha, planDigest: identity(plan), runnerDigest: sha, caseId: c.id, inputDigest: identity(c.inputs), passed: true,
    command: { exitCode: 0, signal: null, stdout: '[true]', stderr: '', elapsedMs: 1 },
    physical: { id, reservationId: id, runId: 'synthetic-author', purpose: 'review', provider: 'external-offline-review', model: packet.evaluatorId,
      promptManifestId: `reviewer-closure:${sha}`, requestDigest: identity({ request: packet.request, operation: { id: c.id, digest: identity({ planDigest: identity(plan), case: c }) } }),
      status: 'succeeded', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 1 } } };
  validatePhysicalRequest(observation.physical); packet.offlineObservations.push(observation);
  const base: ReviewerInput = { packet, plan, keyHex: randomBytes(32).toString('hex') };
  const inputs: ReviewerInput[] = [], expected: ReviewerCase['expected'] = [];
  const add = (outcome: 'pass' | 'fail' | 'refuse', mutate: (p: ReviewerInput) => void = () => {}) => { const copy = structuredClone(base); mutate(copy); inputs.push(copy); expected.push(outcome); };
  add('pass');
  add('fail', p => { const o = p.packet.offlineObservations[0]!; o.command.stdout = '[false]'; o.passed = false; });
  add('fail', p => { const o = p.packet.offlineObservations[0]!; o.command.exitCode = 1; o.passed = false; });
  for (const field of ['requestId', 'candidateId', 'policyDigest', 'evaluatorDigest', 'planDigest', 'runnerDigest', 'inputDigest'] as const)
    add('refuse', p => { p.packet.offlineObservations[0]![field] = identity('mismatch'); });
  add('refuse', p => { p.packet.offlineObservations = []; });
  add('refuse', p => { p.plan.cases.push({ ...p.plan.cases[0]!, id: 'second' }); p.packet.offlineObservations.push(structuredClone(p.packet.offlineObservations[0]!)); });
  add('refuse', p => { p.packet.offlineObservations[0]!.command.stdout = '[false]'; });
  add('refuse', p => { p.packet.offlineObservations[0]!.physical.status = 'uncertain'; });
  add('refuse', p => { p.packet.offlineObservations[0]!.physical.runId = 'wrong-author'; });
  add('refuse', p => { p.packet.offlineObservations[0]!.physical.requestDigest = identity('wrong-receipt'); });
  add('refuse', p => { p.packet.offlineObservations[0]!.physical.usage.requests = 0; });
  return { id: 'concrete-reviewer', kind: 'reviewer-behavior', inputs, expected, timeoutMs: 3000, maxOutputBytes: 32768 };
}
const run = (c: ReviewerCase) => c.inputs.map(input => {
  try { return { kind: 'result', response: reviewOfflinePacket(input.packet, input.plan, Buffer.from(input.keyHex, 'hex')) }; }
  catch { return { kind: 'refused' }; }
});
const command = (output: unknown) => ({ exitCode: 0, signal: null, stdout: JSON.stringify(output), stderr: '', elapsedMs: 1 });

test('concrete reviewer returns authenticated success and real negative evidence, and refuses exact invalid packets', () => {
  const c = governanceCase(), output = run(c);
  assert.deepEqual(output.map(r => r.kind === 'refused' ? 'refuse' : r.response!.result.receipt.evidence[0]!.verdict), c.expected);
  for (const result of output) if (result.kind === 'result') validateEvaluation(result.response!.result.receipt.evidence[0]!);
  assert.equal(assessOffline(c, command(output)), true);
  const plan: OfflinePlan = { version: 2, runnerDigest: identity('old-runner'), cases: [c] };
  assert.deepEqual(parseOfflinePlan(Buffer.from(canonicalJson(plan))), plan);
});

test('independent raw response assessment rejects forged binding, artifact, authentication and verdict', () => {
  const c = governanceCase();
  for (const mutate of [
    (r: any) => r.result.receipt.policyDigest = identity('forged'),
    (r: any) => r.result.receipt.candidateId = identity('forged'),
    (r: any) => r.result.receipt.evidence[0].verdict = 'fail',
    (r: any) => r.result.proof.signed[0].authentication = '0'.repeat(64),
    (r: any) => r.artifacts[0].base64 = Buffer.from('tampered').toString('base64'),
    (r: any) => r.result.receipt.evidence[0].caseResults[0].usage.requests = 0,
  ]) {
    const output = run(c); mutate(output[0]!.response); assert.equal(assessOffline(c, command(output)), false);
  }
  assert.equal(assessOffline(c, command(c.inputs.map(() => ({ kind: 'refused' })))), false, 'Always refusing is not competence');
  const accepts = run(c); for (let i = 0; i < accepts.length; i++) accepts[i] = accepts[0]!;
  assert.equal(assessOffline(c, command(accepts)), false, 'Always accepting is not competence');
  assert.equal(assessOffline(c, { ...command(run(c)), exitCode: 1 }), false);
  assert.equal(assessOffline(c, { ...command(run(c)), stoppedFor: 'timeout' }), false);
  assert.equal(assessOffline(c, command([{ kind: 'refused' }])), false, 'Missing results cannot be refusals');
});

test('governance plan retains bounds, inert fields and nonrecursive packet provisioning', () => {
  const plan: OfflinePlan = { version: 2, runnerDigest: identity('old-runner'), cases: [governanceCase()] };
  for (const mutate of [
    (p: any) => p.version = 1,
    (p: any) => p.cases[0].inputs[0].keyHex = 'authority-file',
    (p: any) => p.cases[0].inputs[0].plan.cases[0].kind = 'reviewer-behavior',
    (p: any) => p.cases[0].inputs[0].executable = '/bin/sh',
    (p: any) => p.cases[0].expected[0] = true,
    (p: any) => p.cases[0].maxOutputBytes = 65537,
  ]) { const copy = structuredClone(plan); mutate(copy); assert.throws(() => parseOfflinePlan(Buffer.from(canonicalJson(copy)))); }
});
