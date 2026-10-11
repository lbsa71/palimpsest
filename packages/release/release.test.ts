import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chmodSync, linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { identity, type ArtifactRef, type EvaluationEvidence, type ReleaseProposal } from '../contracts/index.ts';
import { freezeCandidate, hashBytes, verifyCandidate } from './artifacts.ts';
import { admissionPolicyIdentity, admitCandidate, signEvaluation, type AdmissionPolicy } from './admission.ts';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aeon-release-'));
  const source = join(root, 'source'); const store = join(root, 'store');
  mkdirSync(source); writeFileSync(join(source, 'main.ts'), 'export const behavior = 1;');
  const controls = { version: 1, minimumCases: ['observed-result'] };
  const candidate = freezeCandidate(source, store, ['main.ts'], { dependencies: {}, prompts: {},
    model: { provider: 'fixture' }, configuration: {}, controls, createdBy: 'candidate-author' });
  const authority = { generation: 'incumbent', epoch: 1, controlRevision: identity(controls) };
  const artifacts = new Map<string, Uint8Array>();
  const artifact = (name: string, content: string): ArtifactRef => {
    const bytes = Buffer.from(content); artifacts.set(name, bytes); return { uri: name, sha256: hashBytes(bytes) };
  };
  const evaluator = artifact('fixture:evaluator', 'frozen independent evaluator');
  const evidence: EvaluationEvidence = { id: 'evidence-one', candidateId: candidate.manifest.id,
    controlRevision: authority.controlRevision, evaluatorId: 'independent-reviewer', evaluatorArtifact: evaluator,
    independent: true, verdict: 'pass', artifact: artifact('fixture:report', 'observed behavior in disposable test'),
    caseResults: [{ id: 'observed-result', status: 'pass', observations: artifact('fixture:observation', 'actual fixture receipt'),
      usage: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 1 }, interventions: [] }] };
  const key = randomBytes(32);
  const policyFields = { controlRevision: authority.controlRevision, requiredCases: ['observed-result'],
    evaluatorKeys: new Map([['independent-reviewer', key]]), evaluatorArtifacts: new Map([['independent-reviewer', evaluator.sha256]]), kind: 'engineering' as const };
  const policy: AdmissionPolicy = { ...policyFields, policyDigest: admissionPolicyIdentity(policyFields) };
  const signed = signEvaluation(evidence, key, policy.policyDigest);
  const proposal: ReleaseProposal = { id: 'proposal', candidate: candidate.manifest, priorAuthority: authority,
    evidence: [evidence], recoveryArtifact: artifact('fixture:rescue', 'retained recovery code') };
  const read = (uri: string) => { const bytes = artifacts.get(uri); if (!bytes) throw new Error('No such artifact'); return bytes; };
  return { root, source, store, candidate, authority, artifacts, evidence, key, policy, signed, proposal, read };
}

test('artifact identity survives source edits while frozen payload tampering invalidates admission', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.source, 'main.ts'), 'source has moved on');
    assert.equal(verifyCandidate(f.store, f.candidate.manifest.id).manifest.id, f.candidate.manifest.id);
    const admitted = admitCandidate(f.store, f.proposal, f.authority, f.policy, [f.signed], f.read);
    assert.equal(admitted.kind, 'engineering');
    const frozen = join(f.store, f.candidate.manifest.id, 'payload', 'main.ts');
    chmodSync(frozen, 0o600); writeFileSync(frozen, 'tampered');
    assert.throws(() => admitCandidate(f.store, f.proposal, f.authority, f.policy, [f.signed], f.read), /payload changed/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('self-report, forged authentication, changed evidence and stale authority cannot admit', () => {
  const f = fixture();
  try {
    assert.throws(() => admitCandidate(f.store, f.proposal, f.authority, f.policy, [], f.read), /authenticated evidence/);
    assert.throws(() => admitCandidate(f.store, f.proposal, f.authority, f.policy,
      [{ ...f.signed, authentication: '0'.repeat(64) }], f.read), /authentication/);
    assert.throws(() => admitCandidate(f.store, { ...f.proposal, evidence: [{ ...f.evidence, evaluatorId: 'candidate-author' }] },
      f.authority, f.policy, [f.signed], f.read), /self evaluation/);
    assert.throws(() => admitCandidate(f.store, f.proposal, { ...f.authority, epoch: 2 }, f.policy, [f.signed], f.read), /stale authority/);
    f.artifacts.set('fixture:observation', Buffer.from('replaced after review'));
    assert.throws(() => admitCandidate(f.store, f.proposal, f.authority, f.policy, [f.signed], f.read), /artifact changed/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('the candidate cannot replace controls judging the same transaction', () => {
  const f = fixture();
  try {
    const successor = freezeCandidate(f.source, f.store, ['main.ts'], { ...f.candidate.inputs, controls: { version: 2 } });
    const evidence = { ...f.evidence, candidateId: successor.manifest.id };
    const proposal = { ...f.proposal, candidate: successor.manifest, evidence: [evidence] };
    const signed = signEvaluation(evidence, f.key, f.policy.policyDigest);
    assert.throws(() => admitCandidate(f.store, proposal, f.authority, f.policy, [signed], f.read), /separately staged/);
    assert.equal(admitCandidate(f.store, proposal, f.authority, f.policy, [signed], f.read, 'control-upgrade').controlChange, true);
    const ownJudgment = { ...evidence, controlRevision: successor.manifest.controls };
    assert.throws(() => admitCandidate(f.store, { ...proposal, evidence: [ownJudgment] }, f.authority, f.policy,
      [signEvaluation(ownJudgment, f.key, f.policy.policyDigest)], f.read, 'control-upgrade'), /judging controls/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('frozen required cases cannot silently change and recovery bytes must be retained', () => {
  const f = fixture();
  try {
    assert.throws(() => admitCandidate(f.store, f.proposal, f.authority, { ...f.policy, requiredCases: [] }, [f.signed], f.read), /frozen policy/);
    const more = { ...f.policy, requiredCases: ['observed-result', 'another-case'] };
    const policy = { ...more, policyDigest: admissionPolicyIdentity(more) };
    assert.throws(() => admitCandidate(f.store, f.proposal, f.authority, policy,
      [signEvaluation(f.evidence, f.key, policy.policyDigest)], f.read), /cases missing/);
    f.artifacts.set('fixture:rescue', Buffer.from('broken recovery'));
    assert.throws(() => admitCandidate(f.store, f.proposal, f.authority, f.policy, [f.signed], f.read), /Recovery artifact/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('hardlinks and escaping paths cannot smuggle mutable external files into a candidate', () => {
  const f = fixture();
  try {
    linkSync(join(f.source, 'main.ts'), join(f.source, 'alias.ts'));
    assert.throws(() => freezeCandidate(f.source, f.store, ['alias.ts'], f.candidate.inputs), /unlinked files/);
    assert.throws(() => freezeCandidate(f.source, f.store, ['../source/main.ts'], f.candidate.inputs), /normalized relative/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('explicit nested entries cannot freeze bytes through a symlinked parent outside the source', () => {
  const f = fixture();
  try {
    const outside = join(f.root, 'host-private'); mkdirSync(outside);
    writeFileSync(join(outside, 'secret'), 'host-private bytes must not enter candidate artifacts');
    symlinkSync(outside, join(f.source, 'alias'));
    assert.throws(() => freezeCandidate(f.source, f.store, ['alias/secret'], f.candidate.inputs), /symlink|directory/i);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
