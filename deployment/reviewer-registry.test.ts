import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { identity, type EvaluationEvidence, type JsonValue } from '../packages/contracts/index.ts';
import { admitCandidate, admissionPolicyIdentity, signEvaluation } from '../packages/release/admission.ts';
import { freezeCandidate, hashBytes, inventoryCandidateSource } from '../packages/release/artifacts.ts';
import { policyDescriptor } from '../packages/release/controller.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { reviewerDescriptor, type ReviewerFile } from './evaluation-dispatch.ts';
import { DerivedPolicyRegistry } from './policy-registry.ts';
import { governanceProposalPath, ReviewerRegistry, sourceReviewer, validateReviewerMetadata, type GovernanceProposal, type PublicPolicy, type SourceReviewer } from './reviewer-registry.ts';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aeon-reviewer-registry-'));
  const host = { stateDirectory: join(root, 'state'), workspaceDirectory: join(root, 'workspace'), artifactStore: join(root, 'artifacts'), nodeBinary: process.execPath };
  const privateRoot = join(root, 'private'); mkdirSync(privateRoot, { mode: 0o700 });
  const key = Buffer.alloc(32, 17), keyFile = join(privateRoot, 'key'); writeFileSync(keyFile, key, { mode: 0o600 });
  const original = [['/reviewer/node', 'unchanged immutable runtime'], ['/reviewer/check.mjs', 'console.log("original judge");']] as const;
  const files = original.map(([mount, bytes], i) => { const path = join(privateRoot, `file-${i}`); writeFileSync(path, bytes, { mode: 0o500 }); return { path, mount, sha256: hashBytes(bytes) }; });
  const configuredReviewer: ReviewerFile = { evaluatorId: 'reviewer', executable: '/reviewer/node', args: ['/reviewer/check.mjs'], files, keyFile, pollMs: 10, maxElapsedMs: 1000, maxOutputBytes: 65536, maxClosureBytes: 65536, memoryBytes: 64 * 1024 * 1024 };
  const fields = { controlRevision: identity('accepted-controls'), kind: 'engineering' as const, requiredCases: ['old-case'], evaluatorKeys: new Map([['reviewer', key]]), evaluatorArtifacts: new Map([['reviewer', hashBytes(reviewerDescriptor(configuredReviewer))]]) };
  const policy = { ...fields, policyDigest: admissionPolicyIdentity(fields) };
  const filename = join(host.stateDirectory, 'state.sqlite'); let store = new OperationalStore({ filename });
  const options = { host, directory: join(privateRoot, 'sealed'), configuredReviewer };
  let reviewers = new ReviewerRegistry({ ...options, store });
  const configured = (digest: string) => { assert.equal(digest, policy.policyDigest); return policy; };
  let policies = new DerivedPolicyRegistry(store, configured, (...args) => reviewers.prepare(...args));
  let sequence = 0;
  const changed = (code = 'console.log("future judge v2");'): GovernanceProposal => {
    const reviewer: SourceReviewer = { evaluatorId: 'reviewer', executable: '/reviewer/node', args: ['/reviewer/check.mjs'], files: [{ mount: files[0]!.mount, sha256: files[0]!.sha256, inherit: true }, { mount: '/reviewer/check.mjs', sha256: hashBytes(code), source: 'deployment/reviewer.mjs' }] };
    return { version: 1, policy: { ...policyDescriptor(policy) as unknown as PublicPolicy, requiredCases: ['future-case'], evaluatorArtifacts: [['reviewer', hashBytes(reviewerDescriptor({ ...configuredReviewer, ...reviewer, files: reviewer.files.map(file => ({ ...file, path: 'unused' })) }))]] }, reviewer };
  };
  const candidate = (proposal: GovernanceProposal | undefined, code = 'console.log("future judge v2");', policyValue: JsonValue = proposal?.policy as unknown as JsonValue ?? policyDescriptor(policy)) => {
    const source = join(root, `source-${++sequence}`); mkdirSync(join(source, 'deployment'), { recursive: true });
    writeFileSync(join(source, 'deployment/reviewer.mjs'), code);
    if (proposal) writeFileSync(join(source, governanceProposalPath), JSON.stringify(proposal));
    const controls = { files: inventoryCandidateSource(source, ['deployment']).map(({ path, sha256 }) => ({ path, sha256 })), policy: policyValue };
    return freezeCandidate(source, host.artifactStore, ['deployment'], { dependencies: {}, prompts: {}, model: {}, configuration: {}, controls: controls as JsonValue, createdBy: 'candidate-author' });
  };
  return { root, host, privateRoot, keyFile, policy, configuredReviewer, files, changed, candidate,
    get store() { return store; }, get reviewers() { return reviewers; }, get policies() { return policies; },
    reopen() { store.close(); store = new OperationalStore({ filename }); reviewers = new ReviewerRegistry({ ...options, store }); policies = new DerivedPolicyRegistry(store, configured, (...args) => reviewers.prepare(...args)); },
    close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('changed cases and actual reviewer bytes bind future policy durably while the original judge remains unchanged', () => {
  const f = fixture();
  try {
    const original = f.reviewers.get(f.policy), candidate = f.candidate(f.changed());
    const next = f.policies.prepare(f.policy.policyDigest, candidate);
    assert.deepEqual(next.requiredCases, ['future-case']); assert.notEqual(next.evaluatorArtifacts.get('reviewer'), f.policy.evaluatorArtifacts.get('reviewer'));
    const nextReviewer = f.reviewers.get(next);
    assert.equal(readFileSync(nextReviewer.files.find(file => file.mount === '/reviewer/check.mjs')!.path, 'utf8'), 'console.log("future judge v2");');
    assert.equal(nextReviewer.keyFile, f.keyFile); assert.equal(nextReviewer.maxElapsedMs, original.maxElapsedMs);
    assert.deepEqual(f.reviewers.get(f.policy), original, 'Preparation never changes the judge selected by the original admission/probation policy');
    const publicValue = f.reviewers.publicDescriptor(next);
    assert.deepEqual(validateReviewerMetadata(publicValue), publicValue);
    assert.throws(() => validateReviewerMetadata({ ...publicValue, keyFile: f.keyFile }), /Exact public/);
    assert.throws(() => validateReviewerMetadata({ ...publicValue, bounds: { ...publicValue.bounds, maxElapsedMs: 60001 } }), /Finite existing/);
    assert.throws(() => validateReviewerMetadata({ ...publicValue, reviewer: { ...publicValue.reviewer, args: ['different-code'] } }), /differs from policy artifact/);
    assert.ok(!JSON.stringify(publicValue).includes(f.privateRoot)); assert.ok(!JSON.stringify(publicValue).includes('keyFile'));
    f.reopen(); assert.deepEqual(f.reviewers.get(f.policies.get(next.policyDigest)), nextReviewer);
    const following = f.policies.prepare(next.policyDigest, f.candidate(undefined, 'another control source', policyDescriptor(next)));
    assert.deepEqual(f.reviewers.get(following).files, nextReviewer.files, 'Unchanged judging rules inherit the accepted pinned reviewer');
    assert.equal(f.policies.prepare(f.policy.policyDigest, candidate).policyDigest, next.policyDigest, 'Reconciliation remains idempotent');
  } finally { f.close(); }
});

test('a prepared future reviewer cannot grade its own control change under the original policy', () => {
  const f = fixture();
  try {
    const candidate = f.candidate(f.changed()), next = f.policies.prepare(f.policy.policyDigest, candidate);
    const authority = { generation: 'serving-incumbent', epoch: 1, controlRevision: f.policy.controlRevision };
    const observations = f.store.putArtifact('Mechanical policy-binding evidence only.'), recovery = f.store.putArtifact('retained independent rescue');
    const oldArtifact = f.store.putArtifact(reviewerDescriptor(f.configuredReviewer)), futureArtifact = f.store.putArtifact(reviewerDescriptor(f.reviewers.get(next)));
    const evidence: EvaluationEvidence = { id: 'old-policy-review', candidateId: candidate.manifest.id, controlRevision: authority.controlRevision, evaluatorId: 'reviewer', evaluatorArtifact: oldArtifact, independent: true, verdict: 'pass', artifact: observations,
      caseResults: [{ id: 'old-case', status: 'pass', observations, usage: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 }, interventions: ['Deterministic engineering fixture.'] }] };
    const proposal = { id: 'candidate-change', candidate: candidate.manifest, priorAuthority: authority, evidence: [evidence], recoveryArtifact: recovery };
    const key = f.policy.evaluatorKeys.get('reviewer')!, read = (uri: string) => f.store.readArtifact({ uri, sha256: uri.split(':').at(-1)! });
    assert.equal(admitCandidate(f.host.artifactStore, proposal, authority, f.policy, [signEvaluation(evidence, key, f.policy.policyDigest)], read, 'control-upgrade').policyDigest, f.policy.policyDigest);
    const selfJudged = { ...evidence, evaluatorArtifact: futureArtifact };
    assert.throws(() => admitCandidate(f.host.artifactStore, { ...proposal, evidence: [selfJudged] }, authority, f.policy, [signEvaluation(selfJudged, key, next.policyDigest)], read, 'control-upgrade'), /Invalid reviewer authentication/);
    assert.throws(() => admitCandidate(f.host.artifactStore, { ...proposal, evidence: [selfJudged] }, authority, f.policy, [signEvaluation(selfJudged, key, f.policy.policyDigest)], read, 'control-upgrade'), /Unqualified evaluator artifact/);
    assert.throws(() => admitCandidate(f.host.artifactStore, proposal, authority, next, [signEvaluation(evidence, key, next.policyDigest)], read, 'control-upgrade'), /not the current control revision/);
  } finally { f.close(); }
});

test('case-only policy proposals reuse the pinned reviewer and retain the original private key authority', () => {
  const f = fixture();
  try {
    const proposal: GovernanceProposal = { version: 1, policy: { ...policyDescriptor(f.policy) as unknown as PublicPolicy, requiredCases: ['additional-case', 'old-case'] } };
    const next = f.policies.prepare(f.policy.policyDigest, f.candidate(proposal));
    assert.equal(reviewerDescriptor(f.reviewers.get(next)), reviewerDescriptor(f.configuredReviewer));
    assert.deepEqual(next.requiredCases, ['additional-case', 'old-case']);
    const row = f.store.get<any>('host.derived-policies', next.policyDigest)!;
    f.store.put('host.derived-policies', next.policyDigest, { ...row.value, descriptor: { ...row.value.descriptor, requiredCases: ['forged'] } }, row.revision);
    assert.throws(() => f.policies.get(next.policyDigest), /Exact host policy identity/);
  } finally { f.close(); }
});

test('foreign keys, undeclared paths, inherited substitution, descriptor mismatch and candidate tampering fail before registration', () => {
  const f = fixture();
  try {
    const foreign = f.changed(); foreign.policy.evaluatorKeyDigests[0]![1] = identity('foreign-key');
    assert.throws(() => f.policies.prepare(f.policy.policyDigest, f.candidate(foreign)), /signing-key authority/);
    const path = f.changed(); (path.reviewer!.files[1] as { source: string }).source = 'deployment/../../key';
    assert.throws(() => f.policies.prepare(f.policy.policyDigest, f.candidate(path)), /control-owned deployment/);
    const inherited = f.changed(); inherited.reviewer!.files[0]!.sha256 = identity('foreign-runtime');
    assert.throws(() => f.policies.prepare(f.policy.policyDigest, f.candidate(inherited)), /inherited mount differs/);
    const mismatch = f.changed(); mismatch.policy.evaluatorArtifacts[0]![1] = identity('self-asserted-evaluator');
    assert.throws(() => f.policies.prepare(f.policy.policyDigest, f.candidate(mismatch)), /closure differs/);
    const substituted = f.changed(); substituted.reviewer!.evaluatorId = 'candidate-author';
    assert.throws(() => f.policies.prepare(f.policy.policyDigest, f.candidate(substituted)), /signing identity/);
    const tampered = f.candidate(f.changed()), file = join(f.host.artifactStore, tampered.manifest.id, 'payload/deployment/reviewer.mjs');
    chmodSync(file, 0o600); writeFileSync(file, 'tampered after freeze');
    assert.throws(() => f.policies.prepare(f.policy.policyDigest, tampered), /changed|differs|identity/i);
    assert.equal(f.store.list('host.derived-reviewers').length, 0); assert.equal(f.store.list('host.derived-policies').length, 0);
  } finally { f.close(); }
});

test('sealed-file and stored-private-authority tampering fail closed; unavailable evaluator does not prevent registry construction', () => {
  const f = fixture();
  try {
    const next = f.policies.prepare(f.policy.policyDigest, f.candidate(f.changed()));
    const reviewer = f.reviewers.get(next), row = f.store.get<any>('host.derived-reviewers', next.policyDigest)!;
    f.store.put('host.derived-reviewers', next.policyDigest, { ...row.value, reviewer: { ...row.value.reviewer, keyFile: join(f.privateRoot, 'substitute') } }, row.revision);
    assert.throws(() => f.reviewers.get(next), /private authority/);
    const changed = f.store.get<any>('host.derived-reviewers', next.policyDigest)!; f.store.put('host.derived-reviewers', next.policyDigest, row.value, changed.revision);
    const file = reviewer.files.find(file => file.mount === '/reviewer/check.mjs')!.path;
    chmodSync(file, 0o600); writeFileSync(file, 'modified sealed code');
    assert.throws(() => f.reviewers.get(next), /closure changed/);
    rmSync(f.keyFile); f.reopen(); assert.ok(f.reviewers, 'Constructing offline host registries never loads the missing evaluator/key');
    assert.throws(() => f.reviewers.get(next), /ENOENT/);
  } finally { f.close(); }
});

test('source reviewer cannot add private paths, executable mounts or resource grants', () => {
  const f = fixture();
  try {
    const reviewer = f.changed().reviewer!;
    assert.throws(() => sourceReviewer({ ...reviewer, keyFile: f.keyFile }), /Exact public/);
    assert.throws(() => sourceReviewer({ ...reviewer, memoryBytes: 1e12 }), /Exact public/);
    assert.throws(() => sourceReviewer({ ...reviewer, executable: '/bin/sh' }), /Declared reviewer executable/);
    assert.throws(() => sourceReviewer({ ...reviewer, files: [{ mount: '/etc/passwd', sha256: identity('x'), inherit: true }] }), /mount and hash/);
    assert.throws(() => sourceReviewer({ ...reviewer, files: [{ mount: '/reviewer/check', sha256: identity('x'), source: 'deployment/check.test.ts' }] }), /control-owned/);
  } finally { f.close(); }
});
