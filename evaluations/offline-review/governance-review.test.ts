import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { canonicalJson, identity } from '../../packages/contracts/index.ts';
import { assessOffline, loadOfflinePlan, offlineAdapterDigest, offlinePlanMount, offlineRunnerDigest, parseOfflinePlan, type OfflineObservation, type OfflinePlan, type ReviewerCase, type ReviewerInput } from './index.ts';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ReviewerFile } from '../../deployment/evaluation-dispatch.ts';
import { hashBytes } from '../../packages/release/artifacts.ts';
import type { FrozenCandidate } from '../../packages/release/artifacts.ts';
import { admissionPolicyIdentity, type AdmissionPolicy } from '../../packages/release/admission.ts';
import { policyDescriptor } from '../../packages/release/controller.ts';
import { reviewerDescriptor } from '../../deployment/evaluation-dispatch.ts';
import { type GovernanceProposal, type PublicPolicy, sourceReviewer } from '../../deployment/reviewer-registry.ts';
import { reviewerAdapterSource, reviewerCoreSource, verifyReviewerSelection } from './selection.ts';
import type { EvaluationRequest } from '../../deployment/evolution-tools.ts';
import type { ReviewResponse } from '../../deployment/evaluation-dispatch.ts';
import type { PhysicalRequest } from '../../packages/contracts/index.ts';
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
  adapterDigest: offlineAdapterDigest(), inputs: [input], expected: [verdict], timeoutMs: 100, maxOutputBytes: 16384 });
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

test('review audit: old plan rejects an independently changed adapter identity before any candidate import', () => {
  const directory = mkdtempSync(join(tmpdir(), 'governance-review-adapter-'));
  try {
    const c = caseFor(packet(), 'pass');
    const plan: OfflinePlan = { version: 2, runnerDigest: offlineRunnerDigest(), cases: [c] };
    const path = join(directory, 'plan.json');
    const config = (text: string) => {
      writeFileSync(path, text, { mode: 0o600 });
      return { files: [{ path, mount: offlinePlanMount, sha256: hashBytes(text) }] } as ReviewerFile;
    };
    assert.equal(loadOfflinePlan(config(canonicalJson(plan)))!.plan.cases[0]!.kind, 'reviewer-behavior');
    c.adapterDigest = identity('independently changed CLI adapter');
    assert.throws(() => loadOfflinePlan(config(canonicalJson(plan))), /exact prior CLI adapter/);
    const missing = JSON.parse(canonicalJson(plan)); delete missing.cases[0].adapterDigest;
    assert.throws(() => parseOfflinePlan(Buffer.from(canonicalJson(missing))), /Exact offline plan fields/);
    const legacy = { ...plan, version: 1 };
    assert.throws(() => parseOfflinePlan(Buffer.from(canonicalJson(legacy))), /Supported offline plan/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

function selectionFixture() {
  const adapterDigest = offlineAdapterDigest(), oldCore = identity('old core'), nextCore = identity('independent next core');
  const prior = { evaluatorId: 'selection-evaluator', executable: '/reviewer/node', args: ['--max-old-space-size=64', '/reviewer/reviewer.mjs'],
    files: [
      { mount: '/reviewer/node', sha256: identity('node') },
      { mount: '/reviewer/reviewer.mjs', sha256: adapterDigest },
      { mount: '/reviewer/review-core.ts', sha256: oldCore },
      { mount: '/reviewer/offline-plan.json', sha256: identity('private prior plan') },
      { mount: '/lib64/libc.so', sha256: identity('library') },
    ].map(file => ({ ...file, path: `/synthetic/${file.sha256}` })),
  } as ReviewerFile;
  const fields = { controlRevision: identity('prior controls'), evaluatorKeys: new Map([[prior.evaluatorId, Buffer.alloc(32, 17)]]),
    evaluatorArtifacts: new Map([[prior.evaluatorId, hashBytes(reviewerDescriptor(prior))]]), requiredCases: ['review-selection'], kind: 'engineering' as const };
  const policy: AdmissionPolicy = { ...fields, policyDigest: admissionPolicyIdentity(fields) };
  const reviewer = { evaluatorId: prior.evaluatorId, executable: prior.executable, args: [...prior.args], files: prior.files.map(({ mount, sha256 }) =>
    mount === '/reviewer/review-core.ts' ? { mount, sha256: nextCore, source: reviewerCoreSource } : { mount, sha256, inherit: true as const }) };
  const selectedDigest = hashBytes(reviewerDescriptor({ ...prior, ...reviewer, files: reviewer.files.map(file => ({ ...file, path: '' })) }));
  const proposal: GovernanceProposal = { version: 1, reviewer, policy: policyDescriptor({ ...policy,
    evaluatorArtifacts: new Map([[prior.evaluatorId, selectedDigest]]) }) as unknown as PublicPolicy };
  const files = [{ path: reviewerCoreSource, sha256: nextCore }, { path: reviewerAdapterSource, sha256: adapterDigest }];
  const candidate = { files, inputs: { controls: { policy: structuredClone(proposal.policy), files: structuredClone(files) } } } as unknown as FrozenCandidate;
  return { adapterDigest, prior, policy, proposal, candidate };
}

test('review audit: exact proposed selection rejects remapping, extra dependencies and policy substitutions', () => {
  const allowed = selectionFixture();
  allowed.proposal.reviewer!.files.reverse();
  assert.deepEqual(verifyReviewerSelection(allowed.candidate, allowed.proposal, allowed.prior, allowed.policy, allowed.adapterDigest), allowed.proposal.reviewer);
  const mutators: ((f: ReturnType<typeof selectionFixture>) => void)[] = [
    f => { delete f.proposal.reviewer; },
    f => { f.proposal.reviewer!.args.unshift('--eval=process.exit(0)'); },
    f => { f.proposal.reviewer!.executable = '/reviewer/reviewer.mjs'; },
    f => { f.proposal.reviewer!.files.find(file => 'source' in file)!.sha256 = identity('other implementation'); },
    f => { const core = f.proposal.reviewer!.files.find(file => 'source' in file)!; if ('source' in core) core.source = 'deployment/untested-core.ts'; },
    f => { f.proposal.reviewer!.files.find(file => 'source' in file)!.mount = '/reviewer/alternate-core.ts'; },
    f => { f.proposal.reviewer!.files.push({ mount: '/reviewer/extra.mjs', source: 'deployment/extra.mjs', sha256: identity('extra') }); },
    f => { f.proposal.reviewer!.files.pop(); },
    f => { f.proposal.reviewer!.files.find(file => file.mount === '/reviewer/offline-plan.json')!.sha256 = identity('weakened plan'); },
    f => { f.proposal.policy.requiredCases = ['weakened-case']; },
    f => { f.proposal.policy.evaluatorArtifacts[0]![1] = identity('unrelated descriptor'); },
    f => { (f.candidate.inputs.controls as unknown as { policy: unknown }).policy = policyDescriptor(f.policy); },
    f => { f.candidate.files.find(file => file.path === reviewerAdapterSource)!.sha256 = identity('changed adapter'); },
    f => { (f.candidate.inputs.controls as unknown as { files: unknown[] }).files = []; },
  ];
  for (const mutate of mutators) {
    const f = selectionFixture(); mutate(f);
    assert.throws(() => verifyReviewerSelection(f.candidate, f.proposal, f.prior, f.policy, f.adapterDigest));
  }
});

test('review audit: new source eligibility is limited to the concrete control-owned core', () => {
  const f = selectionFixture();
  assert.deepEqual(sourceReviewer(f.proposal.reviewer), f.proposal.reviewer);
  for (const path of ['evaluations/offline-review/reviewer.mjs', 'evaluations/offline-review/selection.ts',
    'evaluations/offline-review/../review-core.ts', 'evaluations/offline-review/review-core.test.ts', 'packages/release/admission.ts']) {
    const next = structuredClone(f.proposal.reviewer!);
    const core = next.files.find(file => 'source' in file)!; if ('source' in core) core.source = path;
    assert.throws(() => sourceReviewer(next), /control-owned/);
  }
});

// Optional read-only reinspection of a completed author witness. This launches no candidate.
const retained = process.env.AEON_GOVERNANCE_REVIEW_AUDIT_DIR;
if (retained) test('review audit: retained physical responses, artifacts, selected bytes and original lineage agree', () => {
  const read = <T>(name: string): T => JSON.parse(readFileSync(join(retained, name), 'utf8')) as T;
  const planBytes = readFileSync(join(retained, 'old-private-plan.json')), plan = parseOfflinePlan(planBytes);
  assert.equal(plan.cases.length, 1);
  const c = plan.cases[0]!; assert.equal(c.kind, 'reviewer-behavior');
  const descriptor = read<Parameters<typeof reviewerDescriptor>[0]>('old-reviewer-descriptor.json');
  const descriptorDigest = hashBytes(reviewerDescriptor(descriptor));
  const expected = ['always-accepting', 'always-refusing', 'good-private-isolation', 'ignores-request-binding', 'promotes-failed-command', 'undeclared-dependency'];
  assert.deepEqual(readdirSync(retained).filter(name => name.endsWith('-response.json')).map(name => name.slice(0, -14)).sort(), expected);
  const allocations = read<{ child: { rootId: string; parentRunId: string; envelope: { maxConcurrency: number } }; parent: { rootId: string; envelope: { maxConcurrency: number } } }>('original-allocations.json');
  assert.equal(allocations.child.rootId, allocations.parent.rootId);
  assert.equal(allocations.child.parentRunId, allocations.parent.rootId);
  assert.equal(allocations.child.envelope.maxConcurrency, 1); assert.equal(allocations.parent.envelope.maxConcurrency, 1);
  let largestLedger = 0;
  for (const name of expected) {
    const request = read<EvaluationRequest>(`${name}-request.json`), response = read<ReviewResponse>(`${name}-response.json`);
    const sources = read<{ core: string; adapter: string }>(`${name}-candidate-sources.json`);
    const proposal = read<GovernanceProposal>(`${name}-proposal.json`);
    const blobs = new Map(response.artifacts.map(blob => {
      const bytes = Buffer.from(blob.base64, 'base64');
      assert.equal(bytes.toString('base64'), blob.base64); assert.equal(hashBytes(bytes), blob.sha256);
      return [blob.sha256, bytes] as const;
    }));
    const evidence = response.result.receipt.evidence[0]!;
    const observation = JSON.parse(blobs.get(evidence.caseResults[0]!.observations.sha256)!.toString('utf8')) as OfflineObservation;
    const passed = name === 'good-private-isolation';
    assert.equal(assessOffline(c, observation.command), passed);
    assert.equal(evidence.verdict, passed ? 'pass' : 'fail'); assert.equal(observation.passed, passed);
    assert.equal(observation.requestId, request.requestId); assert.equal(observation.candidateId, request.candidate.manifest.id);
    assert.equal(observation.evaluatorDigest, descriptorDigest); assert.equal(observation.planDigest, hashBytes(planBytes));
    assert.equal(observation.runnerDigest, plan.runnerDigest); assert.equal(observation.inputDigest, identity(c.inputs));
    assert.deepEqual(response.result.proof.proposal.candidate, request.candidate.manifest);
    assert.deepEqual(response.result.proof.signed[0]!.evidence, evidence);
    assert.equal(hashBytes(sources.core), request.candidate.files.find(file => file.path === reviewerCoreSource)!.sha256);
    assert.equal(hashBytes(sources.adapter), (c as ReviewerCase).adapterDigest);
    assert.equal(hashBytes(canonicalJson(proposal)), request.candidate.files.find(file => file.path === 'deployment/governance-proposal.json')!.sha256);
    const selected = proposal.reviewer!;
    assert.equal(selected.files.find(file => file.mount === '/reviewer/review-core.ts')!.sha256, hashBytes(sources.core));
    const selectedDigest = hashBytes(reviewerDescriptor({ ...descriptor, ...selected, files: selected.files.map(file => ({ ...file, path: '' })) }));
    assert.equal(new Map(proposal.policy.evaluatorArtifacts).get(evidence.evaluatorId), selectedDigest);
    const ledger = read<{ value: { rootId: string; request: PhysicalRequest; charged: { tokens: number; costUsd: number; elapsedMs: number } } }[]>(`${name}-physical-ledger.json`);
    largestLedger = Math.max(largestLedger, ledger.length);
    const physical = ledger.map(row => row.value.request);
    assert.equal(new Set(physical.map(value => value.id)).size, physical.length);
    for (const { value } of ledger) {
      assert.equal(value.rootId, allocations.parent.rootId); assert.equal(value.request.runId, request.proposal.runId);
      assert.equal(value.request.status, 'succeeded'); assert.equal(value.request.provider, 'external-offline-review');
      assert.equal(value.request.promptManifestId, `reviewer-closure:${descriptorDigest}`);
      assert.equal(value.request.usage.requests, 1); assert.equal(value.charged.tokens, 0); assert.equal(value.charged.costUsd, 0);
    }
    assert.deepEqual(physical.find(value => value.id === observation.physical.id), observation.physical);
    assert.equal(observation.physical.requestDigest, identity({ request, operation: { id: c.id, digest: identity({ planDigest: hashBytes(planBytes), case: c }) } }));
    assert.equal(physical.find(value => value.id === `external-review:${request.requestId}`)!.requestDigest, identity(request));
    if (passed) {
      assert.deepEqual(read('good-private-isolation-selected-descriptor.json'), JSON.parse(reviewerDescriptor({ ...descriptor, ...selected, files: selected.files.map(file => ({ ...file, path: '' })) })));
      const admission = read<{ candidateId: string; controlChange: boolean }>('good-private-isolation-admission.json');
      assert.equal(admission.candidateId, request.candidate.manifest.id); assert.equal(admission.controlChange, true);
    }
  }
  assert.equal(largestLedger, expected.length * 2);
  const refused = read<{ physicalRequests: number; reason: string }>('changed-entrypoint-refusal.json');
  assert.equal(refused.physicalRequests, 2); assert.match(refused.reason, /unchanged prior CLI adapter/);
});
