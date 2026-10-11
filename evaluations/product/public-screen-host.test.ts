import assert from 'node:assert/strict';
import test from 'node:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, candidateIdentity, identity, type ArtifactRef, type EvaluationEvidence, type PhysicalRequest, type ReleaseProposal } from '../../packages/contracts/index.ts';
import { admissionPolicyIdentity, signEvaluation } from '../../packages/release/admission.ts';
import { hashBytes } from '../../packages/release/artifacts.ts';
import { deploymentEntries, freezeApplication, type DeploymentInputs } from '../../deployment/candidate.ts';
import { materializeConfiguration } from '../../deployment/materialize.ts';
import { AuthorityStore } from '../../packages/supervisor/authority.ts';
import { OperationalStore } from '../../packages/storage/index.ts';
import { ResourceLedger } from '../../packages/runtime/index.ts';
import { QualificationStore } from '../qualification/store.ts';
import { signDocument, verifyExperiment, type Experiment, type Signed } from '../qualification/manifest.ts';
import { observerImplementation, type QualificationTrust } from '../qualification/observer.ts';
import { publicRehearsalPacket, runHostAuthorizedLiveCase } from './screen-driver.ts';
import { runScreenCase } from './screen.ts';
import { runLifecycleCase } from './lifecycle.ts';
import { publicInterventions, publicScreenCases, publicScreenDomain, syntheticCompositionDomain, verifySyntheticCompositionPlan, publicScreenGateway, publicWorkloadIdentity, preparePublicScreen, retainPublicReport, retainedOperationalEvidence, verifyPublicScreenPlan, type PublicScreenPlan, type PublicScreenHostOptions } from './public-screen-host.ts';

// Manufactured host keys and envelopes below verify offline mechanics only. No account,
// genuine issuer, kernel confinement, provider transport, process or application is used.
const key = Buffer.alloc(32, 111), reviewerKey = Buffer.alloc(32, 112), issuer = 'OFFLINE-only-issuer', evaluator = 'OFFLINE-only-observer', fixed = identity('OFFLINE-only');
const envelope = { maxRequests: 180, maxTokens: 360000, maxCostUsd: 2, maxElapsedMs: 900000, maxConcurrency: 3 };
function planFixture() {
  const base = { source: fixed, dependencies: fixed, prompts: fixed, model: fixed, configuration: fixed, controls: fixed, createdBy: 'OFFLINE-candidate-author' }, candidate = { ...base, id: candidateIdentity(base) };
  const policyBase = { kind: 'product' as const, controlRevision: fixed, requiredCases: ['OFFLINE-proof'], evaluatorKeys: new Map([[evaluator, reviewerKey]]), evaluatorArtifacts: new Map([[evaluator, fixed]]) };
  const trust: QualificationTrust = { issuerKeys: new Map([[issuer, key]]), observerArtifact: { uri: `sha256:${fixed}`, sha256: fixed }, policy: { ...policyBase, policyDigest: admissionPolicyIdentity(policyBase) }, protocolDigest: fixed, calibrationPlans: new Set([fixed]), objectiveCases: new Map() };
  const issuedAt = new Date(Date.now() - 1000).toISOString(), expiresAt = new Date(Date.parse(issuedAt) + 900000).toISOString();
  const experiment = (caseId: string): Experiment => ({ version: 1, id: `${caseId}-OFFLINE-initial1`, grantId: `${caseId}-OFFLINE-original-grant`, kind: 'live-product', candidate, configurationDigest: fixed, protocolDigest: fixed, calibrationPlanDigest: fixed, privatePacketDigest: fixed, observerArtifactDigest: fixed, evaluatorId: evaluator, priorPolicyDigest: trust.policy.policyDigest, resources: { ...envelope }, issuedAt, expiresAt, maxEvidenceBytes: 8 * 1024 * 1024, maxArtifactBytes: 1000000 });
  const plan: PublicScreenPlan = { version: 1, id: 'OFFLINE-twelve-case', issuedAt, expiresAt, protocolDigest: fixed, observerArtifactDigest: fixed, claimStoreDigest: fixed, resources: { ...envelope, maxRequests: envelope.maxRequests * 12, maxTokens: envelope.maxTokens * 12, maxCostUsd: envelope.maxCostUsd * 12 }, maxPlanRecordBytes: 8 * 1024 * 1024, maxPlanArtifactBytes: 1000000,
    cases: publicScreenCases.map(caseId => ({ caseId, workloadDigest: publicWorkloadIdentity(caseId), intervention: publicInterventions[caseId], attempts: [signDocument('aeon.qualification.experiment.v1', experiment(caseId), issuer, key)], ...(caseId === 'S12' ? { successor: { candidate, configurationDigest: fixed, proposalDigest: fixed } } : {}) })) };
  const sign = (value = plan) => signDocument(publicScreenDomain, value, issuer, key);
  const replace = (caseId: string, update: (e: Experiment) => void) => { const c = plan.cases.find(c => c.caseId === caseId)!; const e = structuredClone(c.attempts[0]!.value); update(e); c.attempts[0] = signDocument('aeon.qualification.experiment.v1', e, issuer, key); };
  return { plan, trust, sign, replace };
}
test('signed fixed twelve-case route has a passing offline authentication baseline and a declared simultaneous deadline', () => {
  const f = planFixture(); assert.equal(canonicalJson(verifyPublicScreenPlan(f.sign(), f.trust)), canonicalJson(f.plan));
  assert.deepEqual(f.plan.cases.map(c => c.caseId), publicScreenCases); assert.equal(f.plan.cases.every(c => c.attempts[0]!.value.issuedAt === f.plan.issuedAt), true);
  // The fifteen-minute maximum belongs to Experiment. The outer plan may be longer.
  f.plan.expiresAt = new Date(Date.parse(f.plan.issuedAt) + 1800000).toISOString(); f.plan.resources.maxElapsedMs = 1800000;
  assert.equal(canonicalJson(verifyPublicScreenPlan(f.sign(), f.trust)), canonicalJson(f.plan));
});
test('forged, changed, wrong-domain and executable grants refuse before callback access', () => {
  const f = planFixture(); assert.equal(canonicalJson(verifyPublicScreenPlan(f.sign(), f.trust)), canonicalJson(f.plan));
  const signed = f.sign(); signed.value.resources.maxCostUsd++; assert.throws(() => verifyPublicScreenPlan(signed, f.trust), /signature/);
  assert.throws(() => verifyPublicScreenPlan(signDocument('wrong-domain', f.plan, issuer, key), f.trust), /signature/);
  assert.throws(() => verifyPublicScreenPlan(f.sign(), { ...f.trust, issuerKeys: new Map() }), /Untrusted/);
  let accessed = 0; const getter = f.sign(); Object.defineProperty(getter.value, 'cases', { enumerable: true, get() { accessed++; throw Error('must never run'); } });
  assert.throws(() => verifyPublicScreenPlan(getter, f.trust), /accessors/); assert.equal(accessed, 0);
});
test('expired/future original windows and longer per-attempt allowances refuse without refresh', () => {
  for (const mutation of ['expired', 'future', 'attempt-expired', 'attempt-future', 'attempt-longer']) {
    const f = planFixture(); assert.equal(canonicalJson(verifyPublicScreenPlan(f.sign(), f.trust)), canonicalJson(f.plan));
    if (mutation === 'expired') f.plan.expiresAt = new Date(Date.now() - 1).toISOString();
    if (mutation === 'future') f.plan.issuedAt = new Date(Date.now() + 100000).toISOString();
    if (mutation === 'attempt-expired') f.replace('S09', e => { e.expiresAt = new Date(Date.now() - 1).toISOString(); });
    if (mutation === 'attempt-future') f.replace('S09', e => { e.issuedAt = new Date(Date.now() + 100000).toISOString(); });
    if (mutation === 'attempt-longer') f.replace('S09', e => { e.resources.maxElapsedMs = 900001; });
    assert.throws(() => verifyPublicScreenPlan(f.sign(), f.trust), /time window|fifteen-minute/, mutation);
  }
  const f = planFixture(), signed = f.plan.cases[8]!.attempts[0]!; assert.equal(canonicalJson(verifyExperiment(signed, f.trust.issuerKeys)), canonicalJson(signed.value));
  assert.throws(() => verifyExperiment(signed, f.trust.issuerKeys, Date.parse(signed.value.expiresAt)), /time window/);
  assert.equal(signed.value.issuedAt, f.plan.issuedAt, 'late launch never changes original issue time');
});
test('duplicate case, attempt identity, original grant and fourth initial attempt reject against a valid baseline', () => {
  for (const mutation of ['case', 'id', 'grant', 'four']) {
    const f = planFixture(); assert.equal(canonicalJson(verifyPublicScreenPlan(f.sign(), f.trust)), canonicalJson(f.plan));
    if (mutation === 'case') f.plan.cases[1]!.caseId = 'S01';
    if (mutation === 'id') f.replace('S02', e => { e.id = f.plan.cases[0]!.attempts[0]!.value.id; });
    if (mutation === 'grant') f.replace('S02', e => { e.grantId = f.plan.cases[0]!.attempts[0]!.value.grantId; });
    if (mutation === 'four') f.plan.cases[0]!.attempts = Array(4).fill(f.plan.cases[0]!.attempts[0]);
    assert.throws(() => verifyPublicScreenPlan(f.sign(), f.trust), /twelve|Repeated|three/, mutation);
  }
});
test('changed frozen profile controls, observer, protocol/calibration and total ceilings reject', () => {
  for (const mutation of ['observer', 'controls', 'calibration', 'protocol', 'total', 'kind', 'intervention', 'successor']) {
    const f = planFixture(); assert.equal(canonicalJson(verifyPublicScreenPlan(f.sign(), f.trust)), canonicalJson(f.plan));
    if (mutation === 'observer') f.replace('S01', e => { e.observerArtifactDigest = identity('wrong'); });
    if (mutation === 'controls') f.replace('S01', e => { const { id: _, ...base } = e.candidate; base.controls = identity('wrong'); e.candidate = { ...base, id: candidateIdentity(base) }; });
    if (mutation === 'calibration') f.replace('S01', e => { e.calibrationPlanDigest = identity('wrong'); });
    if (mutation === 'protocol') f.replace('S01', e => { e.protocolDigest = identity('wrong'); });
    if (mutation === 'total') f.plan.resources.maxTokens--;
    if (mutation === 'kind') f.replace('S01', e => { e.kind = 'integration'; });
    if (mutation === 'intervention') f.plan.cases[7]!.intervention = 'arbitrary-host-callback';
    if (mutation === 'successor') delete f.plan.cases[11]!.successor;
    assert.throws(() => verifyPublicScreenPlan(f.sign(), f.trust), /Observer|controls|trust|aggregate|live-product|intervention|successor/, mutation);
  }
});
test('direct live closures reject fixture and seal injection before looking at application inputs', async () => {
  let accessed = 0; const legacy = { get application() { accessed++; throw Error('never'); }, liveSeal: { grantId: 'fake' } };
  await assert.rejects(runHostAuthorizedLiveCase(legacy as any), /closed|fixture/);
  await assert.rejects(runScreenCase(Object.defineProperty({ mode: 'live-public-screen' }, 'application', Object.getOwnPropertyDescriptor(legacy, 'application')!) as any), /unavailable|closed/);
  await assert.rejects(runLifecycleCase('S08', 'normal', '/unused', 1, { get configuration() { accessed++; throw Error('never'); } } as any), /closed/);
  assert.equal(accessed, 0);
});
test('bounded retained report references recover exact bytes and reject oversize before writing any artifact', () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-public-report-')); const store = new QualificationStore(root);
  try {
    const report = { original: 'original grant retained', body: 'x'.repeat(5000) }, before = readdirSync(root).length;
    const ref = retainPublicReport(store, report, { maxArtifactBytes: 2000, maxEvidenceBytes: 10000 }), manifest = JSON.parse(store.readArtifact(ref).toString());
    assert.ok(manifest.parts.length > 1); const exact = Buffer.concat(manifest.parts.map((part: ArtifactRef) => Buffer.from(JSON.parse(store.readArtifact(part).toString()).content, 'base64')));
    assert.equal(exact.toString(), canonicalJson(report)); assert.equal(hashBytes(exact), manifest.sha256); assert.ok(readdirSync(root).length > before);
    const after = readdirSync(root).length;
    const rawState = join(root, 'raw'); mkdirSync(rawState, { mode: 0o700 }); const operating = new OperationalStore({ filename: join(rawState, 'operational.sqlite') });
    operating.putArtifact('raw'.repeat(1400)); operating.put('physical', 'known', { receipt: 'retained' }, null); operating.close();
    const acquired = retainedOperationalEvidence(rawState); assert.ok(acquired.bytes > 4200);
    assert.throws(() => retainPublicReport(store, report, { maxArtifactBytes: 2000, maxEvidenceBytes: 10000 }, acquired.bytes), /allowance/);
    assert.equal(readdirSync(root).length, after + 1, 'aggregate overflow emits no report artifacts');
    assert.throws(() => retainPublicReport(store, { body: 'x'.repeat(20000) }, { maxArtifactBytes: 2000, maxEvidenceBytes: 10000 }), /allowance/);
    assert.equal(readdirSync(root).length, after + 1, 'failed allowance check must not emit partial artifacts');
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
test('an original uncertain request remains held after reopening; expiry/exhaustion cannot buy a dispatch', () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-public-ledger-')), filename = join(root, 'state.sqlite'); let state = new OperationalStore({ filename });
  let now = Date.now(); const issued = now - 1000, resource = { ...envelope, maxRequests: 1, maxTokens: 17, maxCostUsd: 0.02 };
  const request: PhysicalRequest = { id: 'uncertain-original', runId: 'parent', purpose: 'reasoning', provider: 'mistral', model: 'OFFLINE-profile', promptManifestId: 'original-prompt', requestDigest: fixed, reservationId: 'original-reservation', status: 'reserved', usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 } };
  try {
    const ledger = new ResourceLedger(state, { tokens: 17, costUsd: 0.02, elapsedMs: 1000 }, () => issued); ledger.allocate('operating-envelope:v1', resource); ledger.allocate('parent', resource, 'operating-envelope:v1'); ledger.reserve(request); ledger.dispatched({ ...request, status: 'dispatched' }); ledger.settle({ ...request, status: 'uncertain' }); state.close(); state = new OperationalStore({ filename });
    const reopened = new ResourceLedger(state, { tokens: 17, costUsd: 0.02, elapsedMs: 1000 }, () => now), rows = canonicalJson(state.list('requests'));
    assert.equal(reopened.snapshot('parent').tokens, 17); assert.equal(reopened.snapshot('parent').costUsd, 0.02); assert.equal(reopened.snapshot('parent').concurrent, 1);
    assert.throws(() => reopened.allocate('operating-envelope:v1', resource), /already allocated/);
    assert.throws(() => reopened.reserve({ ...request, id: 'new' }), /exhausted/); now = issued + resource.maxElapsedMs + 1; assert.throws(() => reopened.reserve({ ...request, id: 'later' }), /exhausted/);
    assert.equal(canonicalJson(state.list('requests')), rows); assert.equal(state.get<any>('budgets', 'operating-envelope:v1')!.value.startedAt, issued);
  } finally { state.close(); rmSync(root, { recursive: true, force: true }); }
});

function materializedFixture() {
  const repository = dirname(dirname(dirname(fileURLToPath(import.meta.url)))), root = mkdtempSync(join(tmpdir(), 'aeon-public-preflight-'));
  const source = join(root, 'accepted-source'), artifacts = join(root, 'artifacts'), evidence = join(root, 'private-claims'), kernel = join(root, 'unused-cgroup');
  for (const directory of [source, artifacts, evidence, kernel]) mkdirSync(directory, { mode: 0o700 });
  for (const entry of deploymentEntries(repository)) if (existsSync(join(repository, entry))) { mkdirSync(dirname(join(source, entry)), { recursive: true, mode: 0o700 }); cpSync(realpathSync(join(repository, entry)), join(source, entry), { recursive: true }); }
  const implementation = observerImplementation(); const f = planFixture(); const store = new QualificationStore(evidence, 128 * 1024 * 1024); const authorities: AuthorityStore[] = [];
  const scope = { kind: 'restricted' as const, principals: ['OFFLINE-host'] };
  const configuration: DeploymentInputs['configuration'] = { model: { provider: 'mistral', id: 'public-test-pinned-20261011', contextWindow: 128000, reasoning: false, effort: 'none', maxOutputTokens: 256, maxRequestsPerSlice: 64, timeoutMs: 10000, pricesPerMillion: { input: 1, output: 2 } }, resources: envelope, conversationResources: envelope,
    scheduler: { windowMs: 900000, maxSlicesPerWindow: 1, maxLifetimeSlices: 1, quantumMs: 900000, idleRetryMs: 1000, maxStalls: 2, resources: envelope }, maxConcurrentRuns: 2, pollMs: 100, commands: ['/runtime/node'], researchHosts: [], bootstrapInitiative: false, direct: { host: '127.0.0.1', port: 0, actorId: 'OFFLINE-host', scope, modificationEligible: false },
    resourceLimits: { memoryBytes: 256 * 1024 * 1024, pids: 64, cpuQuotaMicros: 100000, cpuPeriodMicros: 100000, maxFileBytes: 16 * 1024 * 1024, maxOpenFiles: 128, workspaceBytes: 64 * 1024 * 1024, workspaceInodes: 4096 } };
  const inputs: DeploymentInputs = { configuration, createdBy: 'OFFLINE-candidate-author', prompts: { mind: 'PUBLIC old owned prompt, observed work.', compaction: 'Preserve the original attributed task.' }, runtime: { nodeVersion: process.version, nodeSha256: hashBytes(readFileSync(process.execPath)), platform: process.platform, arch: process.arch }, policy: { kind: 'OFFLINE authentication mechanics only' } };
  const old = freezeApplication(source, artifacts, inputs), current = freezeApplication(source, artifacts, { ...inputs, prompts: { ...inputs.prompts, mind: 'PUBLIC new owned prompt, observed work.' } });
  const local = freezeApplication(source, artifacts, { ...inputs, configuration: { ...configuration, slack: { teamId: 'LOCAL-T1', botUserId: 'BOT', channels: [{ channel: 'LOCAL-C1', scope }], eligibleHumanIds: ['LOCAL-HUMAN'], coverageStart: '1', lookbackSeconds: 60, allowSpeech: true } } });
  const fields = { ...f.trust.policy, controlRevision: old.manifest.controls, evaluatorArtifacts: new Map([[evaluator, implementation.artifact.sha256]]) }; f.trust.policy = { ...fields, policyDigest: admissionPolicyIdentity(fields) }; f.trust.observerArtifact = implementation.artifact;
  f.plan.observerArtifactDigest = implementation.artifact.sha256; f.plan.claimStoreDigest = identity(store.identity());
  const bindings: PublicScreenHostOptions['bindings'] = publicScreenCases.map((caseId, index) => {
    const privateRoot = join(root, `private-${caseId}`), stateDirectory = join(root, `state-${caseId}`), workspaceDirectory = join(root, `work-${caseId}`);
    for (const dir of [privateRoot, stateDirectory, workspaceDirectory]) mkdirSync(dir, { mode: 0o700 });
    const host = { artifactStore: artifacts, nodeBinary: process.execPath, stateDirectory, workspaceDirectory, cgroupRoot: kernel }, candidate = caseId === 'S11' ? local : old;
    const config = materializeConfiguration(candidate, host), authorityStore = new AuthorityStore(join(stateDirectory, 'authority.sqlite')); authorities.push(authorityStore);
    const authority = authorityStore.bootstrap('OFFLINE-old', candidate.manifest.controls, candidate.manifest.id), packet = ['S08', 'S09', 'S11', 'S12'].includes(caseId) ? {} : publicRehearsalPacket(caseId as Parameters<typeof publicRehearsalPacket>[0]), packetFile = join(privateRoot, 'packet.json');
    writeFileSync(packetFile, canonicalJson(packet), { mode: 0o600 }); (f.trust.objectiveCases as Map<string, string>).set(caseId, identity(packet));
    f.replace(caseId, e => { e.candidate = candidate.manifest; e.configurationDigest = identity(JSON.parse(JSON.stringify(config))); e.privatePacketDigest = identity(packet); e.observerArtifactDigest = implementation.artifact.sha256; e.priorPolicyDigest = f.trust.policy.policyDigest; });
    const binding: PublicScreenHostOptions['bindings'][number] = { caseId, attempt: 1, host, privateRoot, packetFile, authorityStore, authority };
    if (caseId === 'S12') {
      const proofDirectory = join(privateRoot, 'admission'); mkdirSync(proofDirectory, { mode: 0o700 });
      const blob = (text: string | Uint8Array): ArtifactRef => { const sha256 = hashBytes(text); writeFileSync(join(proofDirectory, sha256), text, { mode: 0o600 }); return { uri: `sha256:${sha256}`, sha256 }; };
      const evaluatorArtifact = blob(implementation.bytes), observations = blob('OFFLINE prior proof, never derived from public screen');
      const policy = f.trust.policy;
      const evidence: EvaluationEvidence = { id: 'OFFLINE-evidence', candidateId: current.manifest.id, controlRevision: authority.controlRevision, evaluatorId: evaluator, evaluatorArtifact, independent: true, verdict: 'pass', artifact: observations, caseResults: [{ id: 'OFFLINE-proof', status: 'pass', observations, usage: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 }, interventions: ['OFFLINE test proof only'] }] };
      const proposal: ReleaseProposal = { id: 'OFFLINE-prompt-successor', candidate: current.manifest, priorAuthority: authority, evidence: [evidence], recoveryArtifact: blob(canonicalJson(old)) }, signed = [signEvaluation(evidence, reviewerKey, policy.policyDigest)];
      const proposalFile = join(privateRoot, 'proposal.json'), signedFile = join(privateRoot, 'signed.json'); writeFileSync(proposalFile, canonicalJson(proposal), { mode: 0o600 }); writeFileSync(signedFile, canonicalJson(signed), { mode: 0o600 });
      binding.successor = { proposalFile, signedFile, policy, evidenceDirectory: proofDirectory };
      f.plan.cases[index]!.successor = { candidate: current.manifest, configurationDigest: identity(JSON.parse(JSON.stringify(materializeConfiguration(current, host)))), proposalDigest: identity({ proposal, signed }) };
    }
    return binding;
  });
  const options = (): PublicScreenHostOptions => ({ plan: f.sign(), trust: f.trust, store, bindings, secrets: { mistralApiKey: 'OFFLINE-not-a-provider-key', directToken: 'OFFLINE-no-service' } });
  return { ...f, root, store, bindings, options, close() { for (const authority of authorities) authority.close(); store.close(); rmSync(root, { recursive: true, force: true }); } };
}
test('actual frozen twelve-case preflight rejects causal source/profile/private-state/claim substitutions without kernel or provider access', async t => {
  const f = materializedFixture();
  try {
    f.store.put({ prior: 'occupied persistent evidence store, not a new state reset' });
    const baseline = preparePublicScreen(f.options()); assert.equal(baseline.prepared.length, 12); assert.ok(baseline.prepared[11]!.transition?.admission.kind === 'product');
    assert.equal(canonicalJson(JSON.parse(JSON.stringify(baseline))).includes('OFFLINE-not-a-provider-key'), false); assert.equal(existsSync(join(f.bindings[0]!.host.stateDirectory, 'operational.sqlite')), false);
    await t.test('substituted claim store rejects despite valid issuer and complete candidate', () => {
      const otherDir = join(f.root, 'replacement-claims'); mkdirSync(otherDir, { mode: 0o700 }); const other = new QualificationStore(otherDir);
      try { assert.throws(() => preparePublicScreen({ ...f.options(), store: other }), /claim store/); } finally { other.close(); }
    });
    await t.test('insufficient originally provisioned capacity rejects before a claim', () => {
      const path = join(f.root, 'small-claims'); mkdirSync(path, { mode: 0o700 }); const small = new QualificationStore(path); const original = f.plan.claimStoreDigest; f.plan.claimStoreDigest = identity(small.identity());
      try { assert.throws(() => preparePublicScreen({ ...f.options(), store: small }), /evidence capacity/); assert.equal(small.usedBytes, 0); } finally { f.plan.claimStoreDigest = original; small.close(); }
    });
    await t.test('near-limit occupied store refuses before consuming a plan or grant', () => {
      const files = Array.from({ length: 4085 }, (_, index) => { const bytes = Buffer.from(canonicalJson({ occupiedIndex: index })), file = join(f.store.directory, hashBytes(bytes)); writeFileSync(file, bytes, { mode: 0o600 }); return file; });
      const before = f.store.usage();
      try { assert.throws(() => preparePublicScreen(f.options()), /entry ceiling/); assert.deepEqual(f.store.usage(), before); } finally { for (const file of files) rmSync(file); }
    });
    await t.test('tiny signed evidence ceiling refuses before claim or application construction', () => {
      const original = f.plan.cases[0]!.attempts[0]!; f.replace('S01', e => { e.maxEvidenceBytes = 1000; e.maxArtifactBytes = 1000; });
      try { assert.throws(() => preparePublicScreen(f.options()), /bounded failure receipt/); } finally { f.plan.cases[0]!.attempts[0] = original; }
    });
    await t.test('individually affordable failure receipt cannot conceal combined original claim exhaustion', () => {
      const original = f.plan.cases[0]!.attempts[0]!, usage = f.store.usage();
      f.replace('S01', e => { e.maxEvidenceBytes = 80000; e.maxArtifactBytes = 80000; });
      try { assert.throws(() => preparePublicScreen(f.options()), /Known original claims/); assert.deepEqual(f.store.usage(), usage); } finally { f.plan.cases[0]!.attempts[0] = original; }
    });
    await t.test('recreated claim store rejects despite unchanged canonical path', () => {
      renameSync(f.store.directory, `${f.store.directory}-retained`); mkdirSync(f.store.directory, { mode: 0o700 }); const other = new QualificationStore(f.store.directory);
      try { assert.throws(() => preparePublicScreen({ ...f.options(), store: other }), /claim store/); } finally { other.close(); rmSync(f.store.directory, { recursive: true }); renameSync(`${f.store.directory}-retained`, f.store.directory); }
    });
    await t.test('unsupported caller gateway injection rejects at the exact host boundary', () => {
      assert.throws(() => preparePublicScreen({ ...f.options(), performRequest: () => { throw Error('never'); } } as any), /Exact/);
      assert.throws(() => preparePublicScreen({ ...f.options(), bindings: [{ ...f.bindings[0]!, application: {} }, ...f.bindings.slice(1)] } as any), /Exact/);
    });
    await t.test('reset original state is refused before ordinary application construction', () => {
      const filename = join(f.bindings[0]!.host.stateDirectory, 'operational.sqlite'); writeFileSync(filename, 'OFFLINE prior attempt');
      try { assert.throws(() => preparePublicScreen(f.options()), /state already exists/); } finally { rmSync(filename); }
    });
    await t.test('wrong original configuration and actual runtime binding reject a causal valid candidate', () => {
      const original = f.plan.cases[0]!.attempts[0]!; f.replace('S01', e => { e.configurationDigest = identity('different-profile'); });
      try { assert.throws(() => preparePublicScreen(f.options()), /configuration\/profile\/envelope/); } finally { f.plan.cases[0]!.attempts[0] = original; }
      const node = f.bindings[0]!.host.nodeBinary; f.bindings[0]!.host.nodeBinary = '/usr/bin/node';
      try { assert.throws(() => preparePublicScreen(f.options()), /runtime|Runtime|version|identity/); } finally { f.bindings[0]!.host.nodeBinary = node; }
    });
    await t.test('private file inside candidate workspace rejects before reading or admission', () => {
      const old = f.bindings[0]!.packetFile; f.bindings[0]!.packetFile = join(f.bindings[0]!.host.workspaceDirectory, 'packet.json'); writeFileSync(f.bindings[0]!.packetFile, readFileSync(old));
      try { assert.throws(() => preparePublicScreen(f.options()), /Private evaluator input/); } finally { rmSync(f.bindings[0]!.packetFile); f.bindings[0]!.packetFile = old; }
    });
    await t.test('wrong actual observer refuses even when re-signed under configured authentication keys', () => {
      const original = f.plan.observerArtifactDigest, artifact = f.trust.observerArtifact, policy = f.trust.policy;
      f.plan.observerArtifactDigest = fixed; f.trust.observerArtifact = { uri: `sha256:${fixed}`, sha256: fixed };
      const p = { ...policy, evaluatorArtifacts: new Map([[evaluator, fixed]]) }; f.trust.policy = { ...p, policyDigest: admissionPolicyIdentity(p) };
      const attempts = f.plan.cases.map(c => c.attempts[0]!); for (const item of f.plan.cases) f.replace(item.caseId, e => { e.observerArtifactDigest = fixed; e.priorPolicyDigest = f.trust.policy.policyDigest; });
      try { assert.throws(() => preparePublicScreen(f.options()), /Actual observer implementation/); } finally { f.plan.observerArtifactDigest = original; f.trust.observerArtifact = artifact; f.trust.policy = policy; f.plan.cases.forEach((c, i) => { c.attempts[0] = attempts[i]!; }); }
    });
    await t.test('replacement S12 judging policy rejects while accepted authority stays current', () => {
      const proof = f.bindings[11]!.successor!, original = proof.policy; const fields = { ...original, evaluatorKeys: new Map([[evaluator, Buffer.alloc(32, 113)]]) }; proof.policy = { ...fields, policyDigest: admissionPolicyIdentity(fields) };
      try { assert.throws(() => preparePublicScreen(f.options()), /exact accepted prior/); } finally { proof.policy = original; }
    });
    await t.test('prior external S12 admission tampering rejects without changing authority', () => {
      const proof = f.bindings[11]!.successor!, original = readFileSync(proof.signedFile), before = identity(f.bindings[11]!.authorityStore.current());
      const signed = JSON.parse(original.toString()); signed[0].authentication = fixed; writeFileSync(proof.signedFile, canonicalJson(signed));
      try { assert.throws(() => preparePublicScreen(f.options()), /proof differs/); assert.equal(identity(f.bindings[11]!.authorityStore.current()), before); } finally { writeFileSync(proof.signedFile, original); }
    });
    assert.equal(preparePublicScreen(f.options()).prepared.length, 12, 'all targeted mutations restored their positive baseline');
  } finally { f.close(); }
});
test('recreated claim-store directory and replays reject while pinned evidence survives rename', () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-public-store-')), path = join(root, 'original'); mkdirSync(path, { mode: 0o700 }); let store = new QualificationStore(path);
  try {
    const original = identity(store.identity()); store.claim('same-attempt', 'same-grant', { original: true });
    assert.throws(() => store.claim('same-attempt', 'same-grant', { reset: true }), /EEXIST/);
    renameSync(path, `${path}-retained`); mkdirSync(path, { mode: 0o700 }); const replacement = new QualificationStore(path);
    try { assert.notEqual(identity(replacement.identity()), original); assert.equal(identity(store.identity()), original); } finally { replacement.close(); }
    store.close(); store = new QualificationStore(`${path}-retained`); assert.throws(() => store.claim('same-attempt', 'same-grant', {}), /EEXIST/);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('separate synthetic composition signature and engineering grants can never enter the paid route', () => {
  const f = planFixture();
  f.plan.cases = f.plan.cases.filter(item => item.caseId === 'S01' || item.caseId === 'S08');
  f.trust.policy = { ...f.trust.policy, kind: 'engineering' };
  f.trust.policy.policyDigest = admissionPolicyIdentity(f.trust.policy);
  f.plan.resources = { maxRequests: 280, maxTokens: 480000, maxCostUsd: 0, maxElapsedMs: 180000, maxConcurrency: 3 };
  f.plan.expiresAt = new Date(Date.parse(f.plan.issuedAt) + 180000).toISOString();
  for (const caseId of ['S01', 'S08']) f.replace(caseId, e => {
    e.kind = 'integration'; e.priorPolicyDigest = f.trust.policy.policyDigest;
    e.resources = caseId === 'S01' ? { maxRequests: 100, maxTokens: 120000, maxCostUsd: 0, maxElapsedMs: 60000, maxConcurrency: 2 } : { maxRequests: 180, maxTokens: 360000, maxCostUsd: 0, maxElapsedMs: 180000, maxConcurrency: 3 };
    e.expiresAt = new Date(Date.parse(e.issuedAt) + e.resources.maxElapsedMs).toISOString();
  });
  const document = signDocument(syntheticCompositionDomain, f.plan, issuer, key);
  assert.equal(canonicalJson(verifySyntheticCompositionPlan(document, f.trust)), canonicalJson(f.plan));
  assert.throws(() => verifyPublicScreenPlan(document, f.trust), /signature/);
  assert.throws(() => verifySyntheticCompositionPlan(f.sign(), f.trust), /signature/);
  f.replace('S08', e => { e.kind = 'live-product'; });
  assert.throws(() => verifySyntheticCompositionPlan(signDocument(syntheticCompositionDomain, f.plan, issuer, key), f.trust), /integration/);
});

test('original claims, private packet and authority evidence refuse another acquisition before mocked fetch', async t => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-acquisition-known-')), stateDirectory = join(root, 'state'), privateRoot = join(root, 'private');
  mkdirSync(stateDirectory, { mode: 0o700 }); mkdirSync(privateRoot, { mode: 0o700 });
  const authorityPath = join(stateDirectory, 'authority.sqlite'), authority = new AuthorityStore(authorityPath);
  authority.bootstrap('offline', fixed, fixed); authority.close();
  const packetFile = join(privateRoot, 'packet.json'); writeFileSync(packetFile, 'P'.repeat(500), { mode: 0o600 });
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('OFFLINE harmless', { status: 200 }); });
  const configuration = { stateDirectory, applicationRoot: dirname(dirname(dirname(fileURLToPath(import.meta.url)))) } as any;
  const manufactured = { mistralApiKey: 'OFFLINE manufactured key', directToken: 'OFFLINE manufactured token' };
  const auxiliary = { claimBytes: 450, packetFile, packetSha256: hashBytes('P'.repeat(500)), privateRoot, authorityPath, caseId: 'S01' as const, attempt: 1, experimentId: 'offline' };
  try {
    const generous = publicScreenGateway(configuration, manufactured, { grantId: 'original', maxArtifactBytes: 2000, maxEvidenceBytes: 10000, auxiliary });
    await generous('offline-first', AbortSignal.timeout(1000)); assert.equal(calls, 1);
    const exhausted = publicScreenGateway(configuration, manufactured, { grantId: 'original', maxArtifactBytes: 2000, maxEvidenceBytes: 1000, auxiliary });
    await assert.rejects(exhausted('offline-next', AbortSignal.timeout(1000)), /allowance/); assert.equal(calls, 1);
    const before = retainedOperationalEvidence(stateDirectory);
    writeFileSync(packetFile, 'P'.repeat(2001), { mode: 0o600 });
    await assert.rejects(generous('offline-too-large', AbortSignal.timeout(1000)), /bound|size|limit|large/i); assert.equal(calls, 1);
    assert.deepEqual(retainedOperationalEvidence(stateDirectory), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
