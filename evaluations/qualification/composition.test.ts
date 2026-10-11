import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { canonicalJson, identity } from '../../packages/contracts/index.ts';
import { AuthorityStore } from '../../packages/supervisor/authority.ts';
import { admissionPolicyIdentity } from '../../packages/release/admission.ts';
import { hashBytes } from '../../packages/release/artifacts.ts';
import { freezeApplication, type DeploymentInputs } from '../../deployment/candidate.ts';
import { materializeConfiguration, type HostBindings } from '../../deployment/materialize.ts';
import { rewriteSourceEntries } from '../../deployment/source-workspace.ts';
import { boundedCodingFixture } from '../product/fixture.ts';
import { QualificationStore } from './store.ts';
import { signDocument, type Experiment, type PrivatePacket } from './manifest.ts';
import { observeSynthetic, observerImplementation, toReleaseEvidence, type ObservationBundle, type QualificationTrust } from './observer.ts';

test('authenticated synthetic observer invokes actual confined application and private checks under the original finite ledger', { skip: process.env.AEON_QUALIFICATION_FIXTURE !== '1', timeout: 90000 }, async () => {
  const root = dirname(dirname(dirname(fileURLToPath(import.meta.url)))), temporary = mkdtempSync(join(tmpdir(), 'aeon-qualified-composition-'));
  const host: HostBindings = { stateDirectory: join(temporary, 'state'), workspaceDirectory: join(temporary, 'workspace'), artifactStore: join(temporary, 'artifacts'), nodeBinary: process.execPath };
  const privateRoot = join(temporary, 'private'), evidenceRoot = join(temporary, 'evidence'), source = join(temporary, 'accepted-source');
  for (const path of [host.stateDirectory, host.workspaceDirectory, host.artifactStore, privateRoot, evidenceRoot, source]) mkdirSync(path, { mode: 0o700 });
  const store = new QualificationStore(evidenceRoot), authorityStore = new AuthorityStore(join(host.stateDirectory, 'authority.sqlite'));
  try {
    for (const entry of rewriteSourceEntries) if (existsSync(join(root, entry))) { mkdirSync(dirname(join(source, entry)), { recursive: true }); cpSync(join(root, entry), join(source, entry), { recursive: true }); }
    cpSync(realpathSync(join(root, 'node_modules')), join(source, 'node_modules'), { recursive: true });
    const resources = { maxRequests: 64, maxTokens: 30000, maxCostUsd: 0, maxElapsedMs: 60000, maxConcurrency: 2 };
    const inputs: DeploymentInputs = { createdBy: 'synthetic-author', prompts: { mind: 'Inspect and repair actual work; communicate explicitly.', compaction: 'Preserve attributed evidence.' }, policy: { kind: 'engineering' },
      runtime: { nodeVersion: process.version, nodeSha256: hashBytes(readFileSync(process.execPath)), platform: process.platform, arch: process.arch },
      configuration: { model: { id: 'mistral-fixture-v2', contextWindow: 128000, reasoning: false, effort: 'none', maxOutputTokens: 1024, maxRequestsPerSlice: 12, timeoutMs: 10000, pricesPerMillion: { input: 0, output: 0 } }, resources, conversationResources: resources,
        scheduler: { windowMs: 60000, maxSlicesPerWindow: 1, maxLifetimeSlices: 1, quantumMs: 60000, idleRetryMs: 1000, maxStalls: 2, resources }, maxConcurrentRuns: 1, pollMs: 100, commands: ['/runtime/node'], researchHosts: [], bootstrapInitiative: false,
        direct: { host: '127.0.0.1', port: 0, actorId: 'evaluator', scope: { kind: 'restricted', principals: ['evaluator'] }, modificationEligible: false } } };
    const candidate = freezeApplication(source, host.artifactStore, inputs), config = materializeConfiguration(candidate, host);
    const authority = authorityStore.bootstrap('synthetic-evaluation', candidate.manifest.controls, candidate.manifest.id);
    const packet: PrivatePacket = { task: { id: 'private-sum-check', prompt: 'Create sum.mjs that prints the sum of two signed command-line integers, observe and repair failures, then verify and report.' }, claim: 'objective-artifact',
      checks: [{ id: 'hidden-positive', kind: 'node-command', path: 'sum.mjs', args: ['9999', '-8000'], expected: { stdout: '1999\n', exitCode: 0 }, timeoutMs: 2000 }, { id: 'hidden-negative', kind: 'node-command', path: 'sum.mjs', args: ['-13', '-7'], expected: { stdout: '-20\n', exitCode: 0 }, timeoutMs: 2000 }] };
    const packetFile = join(privateRoot, 'packet.json'); writeFileSync(packetFile, canonicalJson(packet), { mode: 0o600 });
    const implementation = observerImplementation(), issuerKey = Buffer.alloc(32, 51), evaluatorKey = Buffer.alloc(32, 52), protocolDigest = identity('synthetic-protocol'), calibrationPlanDigest = identity('synthetic-plan');
    const policyBase = { controlRevision: candidate.manifest.controls, requiredCases: [packet.task.id], evaluatorKeys: new Map([['synthetic-observer', evaluatorKey]]), evaluatorArtifacts: new Map([['synthetic-observer', implementation.artifact.sha256]]), kind: 'engineering' as const };
    const policy = { ...policyBase, policyDigest: admissionPolicyIdentity(policyBase) };
    const trust: QualificationTrust = { issuerKeys: new Map([['synthetic-issuer', issuerKey]]), policy, observerArtifact: implementation.artifact, objectiveCases: new Map([[packet.task.id, identity(packet)]]), protocolDigest, calibrationPlans: new Set([calibrationPlanDigest]) };
    const issued = Date.now() - 1000;
    const e: Experiment = { version: 1, id: 'synthetic-composition', grantId: 'one-original-synthetic-grant', kind: 'integration', candidate: candidate.manifest, configurationDigest: identity(JSON.parse(JSON.stringify(config))), protocolDigest, calibrationPlanDigest,
      privatePacketDigest: identity(packet), observerArtifactDigest: implementation.artifact.sha256, evaluatorId: 'synthetic-observer', priorPolicyDigest: policy.policyDigest, resources, issuedAt: new Date(issued).toISOString(), expiresAt: new Date(issued + resources.maxElapsedMs).toISOString(), maxEvidenceBytes: 8 * 1024 * 1024, maxArtifactBytes: 1_000_000 };
    let calls = 0; const transport = boundedCodingFixture();
    const options = { experiment: signDocument('aeon.qualification.experiment.v1', e, 'synthetic-issuer', issuerKey), trust, store, privateRoot, packetFile, host, authorityStore, authority, secrets: { mistralApiKey: 'fixture-not-a-provider-key', directToken: 'private-fixture-direct' } };
    const receipt = await observeSynthetic(options, async (payload, signal) => {
      calls++; assert.equal(payload.includes('hidden-positive'), false); assert.equal(payload.includes('9999'), false); assert.equal(payload.includes(privateRoot), false); signal.throwIfAborted(); return transport(payload);
    });
    const bundle = JSON.parse(store.readArtifact(receipt.bundle).toString('utf8')) as ObservationBundle;
    assert.equal(bundle.kind, 'integration'); assert.equal(bundle.failure, null); assert.equal(bundle.assessment?.quality, 3);
    assert.equal(calls, 7); assert.equal(bundle.commands.length, 2); assert.equal(bundle.ledger?.startedAt, issued); assert.deepEqual(bundle.ledger?.envelope, resources); assert.equal(bundle.ledger?.cancelled, true);
    assert.equal(bundle.ledger?.requests.filter(request => request.provider === 'qualification-command').length, 2);
    const original = JSON.parse(store.readArtifact(bundle.originalAdapterReport).toString('utf8'));
    assert.equal(original.independent, false); assert.equal(original.admissionEligible, false); assert.equal(original.evidenceKind, 'integration');
    assert.throws(() => toReleaseEvidence(receipt, trust, store), /Synthetic\/author/);
    await assert.rejects(observeSynthetic(options, async () => { throw Error('Replay must never dispatch'); }), /fresh state|EEXIST/);
    assert.equal(calls, 7);
  } finally { store.close(); authorityStore.close(); rmSync(temporary, { recursive: true, force: true }); }
});
