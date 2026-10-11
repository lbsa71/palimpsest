import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, chmodSync, writeFileSync, symlinkSync, linkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonicalJson, identity, candidateIdentity } from '../../packages/contracts/index.ts';
import { admissionPolicyIdentity, type AdmissionPolicy } from '../../packages/release/admission.ts';
import { authenticate, signDocument, verifyExperiment, verifyPacket, type Experiment, type PrivatePacket } from './manifest.ts';
import { QualificationStore } from './store.ts';
import { assessObjectiveArtifacts, observeLive, readObjectiveArtifact, recordSynthetic, retainDevelopmentWitness, toReleaseEvidence, verifyInvokedHost, type LiveOptions, type QualificationTrust } from './observer.ts';

const key = Buffer.alloc(32, 11), evaluatorKey = Buffer.alloc(32, 12), hash = identity('fixed');
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aeon-qualification-')), directory = join(root, 'private'); mkdirSync(directory, { mode: 0o700 });
  const store = new QualificationStore(directory);
  const candidateBase = { source: hash, dependencies: hash, prompts: hash, model: hash, configuration: hash, controls: hash, createdBy: 'candidate-author' };
  const candidate = { ...candidateBase, id: candidateIdentity(candidateBase) };
  const packet: PrivatePacket = { task: { id: 'objective-1', prompt: 'Write a verified result artifact.' }, claim: 'objective-artifact', checks: [{ id: 'json-result', kind: 'file-json', path: 'result.json', expected: { value: 42 } }] };
  const policyBase = { controlRevision: hash, requiredCases: [packet.task.id], evaluatorKeys: new Map([['outside-reviewer', evaluatorKey]]), evaluatorArtifacts: new Map([['outside-reviewer', hash]]), kind: 'product' as const };
  const policy: AdmissionPolicy = { ...policyBase, policyDigest: admissionPolicyIdentity(policyBase) };
  const now = Date.now();
  const experiment: Experiment = { version: 1, id: 'attempt-1', grantId: 'original-grant', kind: 'integration', candidate, configurationDigest: hash, protocolDigest: hash, calibrationPlanDigest: hash, privatePacketDigest: identity(packet), observerArtifactDigest: hash, evaluatorId: 'outside-reviewer', priorPolicyDigest: policy.policyDigest,
    resources: { maxRequests: 8, maxTokens: 1000, maxCostUsd: 1, maxElapsedMs: 60000, maxConcurrency: 1 }, issuedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 59000).toISOString(), maxEvidenceBytes: 100000, maxArtifactBytes: 10000 };
  const trust: QualificationTrust = { issuerKeys: new Map([['grant-issuer', key]]), policy, observerArtifact: { uri: `sha256:${hash}`, sha256: hash }, objectiveCases: new Map([[packet.task.id, identity(packet)]]), protocolDigest: hash, calibrationPlans: new Set([hash]) };
  const signed = () => signDocument('aeon.qualification.experiment.v1', experiment, 'grant-issuer', key);
  return { root, directory, store, candidate, packet, experiment, trust, signed, close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}
test('manifest requires exact external issuer, signature domain, immutable candidate and finite original grant', () => {
  const f = fixture(); try {
    assert.deepEqual(verifyExperiment(f.signed(), f.trust.issuerKeys), f.experiment);
    const changed = f.signed(); changed.value.resources.maxCostUsd = 100;
    assert.throws(() => verifyExperiment(changed, f.trust.issuerKeys), /signature/);
    assert.throws(() => verifyExperiment(f.signed(), new Map()), /Untrusted/);
    assert.throws(() => authenticate('different-domain', f.signed(), f.trust.issuerKeys), /signature/);
    f.experiment.resources.maxElapsedMs = 900001;
    assert.throws(() => verifyExperiment(f.signed(), f.trust.issuerKeys), /fifteen-minute/);
  } finally { f.close(); }
});
test('expired and future-issued grants fail even with authentic signatures', () => {
  const f = fixture(); try {
    f.experiment.expiresAt = new Date(Date.now() - 1).toISOString();
    assert.throws(() => verifyExperiment(f.signed(), f.trust.issuerKeys), /time window/);
    f.experiment.issuedAt = new Date(Date.now() + 2000).toISOString(); f.experiment.expiresAt = new Date(Date.now() + 60000).toISOString();
    assert.throws(() => verifyExperiment(f.signed(), f.trust.issuerKeys), /time window/);
  } finally { f.close(); }
});
test('authentication rejects getters, proxies, sparse and hidden data before any accessor executes', () => {
  const f = fixture(); try {
    let reads = 0;
    const document = f.signed(); Object.defineProperty(document.value.resources, 'maxCostUsd', { enumerable: true, get() { reads++; return reads === 1 ? 1 : 100; } });
    assert.throws(() => verifyExperiment(document, f.trust.issuerKeys), /accessors/); assert.equal(reads, 0);
    assert.throws(() => verifyExperiment(new Proxy(f.signed(), {}), f.trust.issuerKeys), /inert/);
    const hidden = f.signed(); Object.defineProperty(hidden.value, 'hidden', { value: 1, enumerable: false });
    assert.throws(() => verifyExperiment(hidden, f.trust.issuerKeys), /hidden/);
    assert.throws(() => signDocument('test', new Array(2), 'issuer', key), /dense/);
    const stable = f.signed(); f.experiment.resources.maxCostUsd = 500;
    assert.equal(verifyExperiment(stable, f.trust.issuerKeys).resources.maxCostUsd, 1, 'Signed value is detached from caller mutation');
  } finally { f.close(); }
});
test('live entry rejects invalid authorization before host reads, observer inventory or dispatch', async () => {
  const f = fixture(); try {
    let reached = false; const signed = f.signed(); signed.signature = '0'.repeat(64);
    const options = { experiment: signed, trust: f.trust, store: f.store, get host() { reached = true; throw Error('Must not reach host'); } } as unknown as LiveOptions;
    await assert.rejects(observeLive(options), /signature/); assert.equal(reached, false);
    options.experiment = f.signed(); await assert.rejects(observeLive(options), /Live observation/); assert.equal(reached, false);
  } finally { f.close(); }
});
test('one-use claim and original grant persist across close/reopen; changed attempt cannot reset allowance', () => {
  const f = fixture(); f.store.claim('first', 'same-grant', f.signed()); f.store.close();
  const reopened = new QualificationStore(f.directory);
  try { assert.throws(() => reopened.claim('second', 'same-grant', f.signed()), /EEXIST/); assert.throws(() => reopened.claim('first', 'new-grant', f.signed()), /EEXIST/); }
  finally { reopened.close(); rmSync(f.root, { recursive: true, force: true }); }
});
test('private store excludes concurrent writers and symlinked or non-private directories', () => {
  const f = fixture(); try {
    assert.throws(() => new QualificationStore(f.directory), /lease/);
    symlinkSync(f.directory, join(f.root, 'linked'));
    assert.throws(() => new QualificationStore(join(f.root, 'linked')));
    mkdirSync(join(f.root, 'open'), { mode: 0o755 });
    assert.throws(() => new QualificationStore(join(f.root, 'open')), /owner-only/);
  } finally { f.close(); }
});
test('content-addressed evidence is write-once, bounded and corruption detected', () => {
  const f = fixture(); try {
    const ref = f.store.put({ retained: 'original' }); assert.deepEqual(f.store.put({ retained: 'original' }), ref);
    const file = join(f.directory, ref.sha256); chmodSync(file, 0o600); writeFileSync(file, '{"retained":"changed"}');
    assert.throws(() => f.store.readArtifact(ref), /corrupted/);
    assert.throws(() => f.store.put({ retained: 'original' }), /changed/);
  } finally { f.close(); }
  const root = mkdtempSync(join(tmpdir(), 'aeon-capacity-')); const store = new QualificationStore(root, 16);
  try { assert.throws(() => store.put({ value: 'too large to fit in the private store' }), /capacity/); }
  finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
test('private packet rejects digest changes, traversal, unsupported claims and unbounded checker execution', () => {
  const f = fixture(); try {
    const encode = () => Buffer.from(canonicalJson(f.packet));
    assert.deepEqual(verifyPacket(encode(), f.experiment), f.packet);
    f.packet.checks[0]!.path = '../private'; f.experiment.privatePacketDigest = identity(f.packet);
    assert.throws(() => verifyPacket(encode(), f.experiment), /Relative artifact/);
    const unsupported = { ...f.packet, claim: 'personality' }; f.experiment.privatePacketDigest = identity(unsupported);
    assert.throws(() => verifyPacket(Buffer.from(canonicalJson(unsupported)), f.experiment), /Subjective/);
    f.packet.checks = [{ id: 'execute', kind: 'node-command', path: 'main.mjs', args: [], expected: { stdout: 'ok', exitCode: 0 }, timeoutMs: 2001 }]; f.experiment.privatePacketDigest = identity(f.packet);
    assert.throws(() => verifyPacket(encode(), f.experiment), /Finite private command/);
  } finally { f.close(); }
});
test('private outcome checks read observed artifacts and command receipts; prose cannot satisfy missing or timed-out work', () => {
  const f = fixture(); try {
    const readArtifact = () => '{"value":42}'; const retained: string[] = [];
    assert.equal(assessObjectiveArtifacts(f.packet, { readArtifact }, new Map(), 1000, (_, content) => retained.push(content)).quality, 3);
    assert.equal(retained.length, 1);
    assert.equal(assessObjectiveArtifacts(f.packet, { readArtifact: () => 'I completed it' }, new Map(), 1000, () => undefined).quality, 0);
    assert.equal(assessObjectiveArtifacts(f.packet, { readArtifact }, new Map(), 4, () => undefined).quality, 0);
    f.packet.checks = [{ id: 'run', kind: 'node-command', path: 'main.mjs', args: [], expected: { stdout: '42\n', exitCode: 0 }, timeoutMs: 2000 }];
    const receipt = { exitCode: 0, signal: null, stdout: '42\n', stderr: '', elapsedMs: 10 };
    assert.equal(assessObjectiveArtifacts(f.packet, { readArtifact: () => 'code' }, new Map([['run', receipt]]), 100, () => undefined).quality, 3);
    assert.equal(assessObjectiveArtifacts(f.packet, { readArtifact: () => 'code' }, new Map([['run', { ...receipt, stoppedFor: 'timeout' as const }]]), 100, () => undefined).quality, 0);
    assert.equal(assessObjectiveArtifacts(f.packet, { readArtifact: () => 'code' }, new Map(), 100, () => undefined).quality, 0);
  } finally { f.close(); }
});
test('actual imported host bytes must match the claimed candidate; worker image alone is insufficient', () => {
  const files = [{ path: 'deployment/application.ts', sha256: hash, executable: false }, { path: 'packages/runtime/index.ts', sha256: hash, executable: false }];
  verifyInvokedHost(files, Buffer.from(canonicalJson({ files })));
  assert.throws(() => verifyInvokedHost([{ ...files[0]!, sha256: identity('changed') }, files[1]!], Buffer.from(canonicalJson({ files }))), /Imported host/);
  assert.throws(() => verifyInvokedHost([files[0]!], Buffer.from(canonicalJson({ files }))), /Imported host/);
});
test('private artifact reader refuses links, traversal and oversized candidate files', () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-objective-read-'));
  try {
    writeFileSync(join(root, 'result'), '42'); assert.equal(readObjectiveArtifact(root, 'result', 10), '42');
    symlinkSync(join(root, 'result'), join(root, 'symlink')); assert.throws(() => readObjectiveArtifact(root, 'symlink', 10));
    linkSync(join(root, 'result'), join(root, 'hardlink')); assert.throws(() => readObjectiveArtifact(root, 'hardlink', 10), /unlinked/);
    assert.throws(() => readObjectiveArtifact(root, '../outside', 10), /Relative/);
    writeFileSync(join(root, 'large'), '123456789'); assert.throws(() => readObjectiveArtifact(root, 'large', 5), /bounded/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('authentic signature never upgrades synthetic or author-supplied reports into live admission', () => {
  const f = fixture(); try {
    const record = recordSynthetic(f.signed(), f.trust, f.store, { independent: true, admissionEligible: true, verdict: 'case-pass', evidenceKind: 'live-product' });
    assert.throws(() => toReleaseEvidence(record, f.trust, f.store), /Synthetic\/author/);
    const changed = structuredClone(record); changed.authentication.value.kind = 'live-product';
    assert.throws(() => toReleaseEvidence(changed, f.trust, f.store), /signature/);
    assert.throws(() => recordSynthetic(f.signed(), f.trust, f.store, {}), /EEXIST/);
  } finally { f.close(); }
});
test('changed prior policy, case trust or missing calibrated plan fails before invocation', () => {
  const f = fixture(); try {
    f.trust.calibrationPlans = new Set();
    assert.throws(() => recordSynthetic(f.signed(), f.trust, f.store, {}), /calibration trust/);
    f.trust.calibrationPlans = new Set([hash]); f.experiment.priorPolicyDigest = identity('different-policy');
    assert.throws(() => recordSynthetic(f.signed(), f.trust, f.store, {}), /prior judging controls/);
  } finally { f.close(); }
});
test('authenticated external development events remain unqualified and require retained state evidence', () => {
  const f = fixture(); try {
    const eventArtifact = f.store.put({ hostObserved: 'restart', state: 'same-current-state' });
    const witness = { experimentDigest: identity(f.experiment), boundary: 'restart' as const, observedAt: new Date().toISOString(), stateDigest: identity('same-current-state'), eventArtifact };
    const signed = signDocument('aeon.qualification.development-witness.v1', witness, 'outside-clock-observer', key);
    assert.equal(retainDevelopmentWitness(signed, new Map([['outside-clock-observer', key]]), f.store).status, 'externally-witnessed-unqualified');
    assert.throws(() => retainDevelopmentWitness(signed, new Map(), f.store), /Untrusted/);
    const future = signDocument('aeon.qualification.development-witness.v1', { ...witness, observedAt: new Date(Date.now() + 100000).toISOString() }, 'outside-clock-observer', key);
    assert.throws(() => retainDevelopmentWitness(future, new Map([['outside-clock-observer', key]]), f.store), /Invalid external/);
  } finally { f.close(); }
});
