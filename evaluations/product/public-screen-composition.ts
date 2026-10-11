import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalJson, identity, invariant, type ResourceEnvelope } from '../../packages/contracts/index.ts';
import { deploymentEntries, freezeApplication, type DeploymentInputs } from '../../deployment/candidate.ts';
import { readHostFile, assertPrivateHostDirectory } from '../../deployment/host-policy.ts';
import { materializeConfiguration } from '../../deployment/materialize.ts';
import { hashBytes } from '../../packages/release/artifacts.ts';
import { admissionPolicyIdentity } from '../../packages/release/admission.ts';
import { AuthorityStore } from '../../packages/supervisor/authority.ts';
import { QualificationStore } from '../qualification/store.ts';
import { observerImplementation, type QualificationTrust } from '../qualification/observer.ts';
import { signDocument, type Experiment } from '../qualification/manifest.ts';
import { oldPrompt, compactionPrompt } from './lifecycle-fixtures.ts';
import { publicRehearsalPacket } from './screen-driver.ts';
import { publicInterventions, publicWorkloadIdentity, syntheticCompositionCases, syntheticCompositionDomain, runSyntheticPublicScreenComposition, type PublicScreenHostOptions, type PublicScreenPlan } from './public-screen-host.ts';

const repository = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const envelopes: Record<'S01' | 'S08', ResourceEnvelope> = {
  S01: { maxRequests: 100, maxTokens: 120000, maxCostUsd: 0, maxElapsedMs: 60000, maxConcurrency: 2 },
  S08: { maxRequests: 180, maxTokens: 360000, maxCostUsd: 0, maxElapsedMs: 180000, maxConcurrency: 3 },
};
/** Fixed two-case public fixture. No real credential, caller transport or live grant can be supplied. */
export interface CompositionHostResources { cgroupRoot: string; workspaceDirectories: { S01: string; S08: string } }
export function prepareCompositionFixture(destination: string, hostResources: CompositionHostResources) {
  invariant(Object.keys(hostResources).sort().join(',') === 'cgroupRoot,workspaceDirectories' && Object.keys(hostResources.workspaceDirectories).sort().join(',') === 'S01,S08', 'Exact preprovisioned two-case host resources required');
  for (const path of [hostResources.cgroupRoot, ...Object.values(hostResources.workspaceDirectories)]) invariant(resolve(path) === path && realpathSync(path) === path, 'Canonical existing resource bindings required');
  for (const path of Object.values(hostResources.workspaceDirectories)) assertPrivateHostDirectory(path);
  invariant(destination === resolve(destination) && !existsSync(destination), 'Absolute new immutable composition destination required');
  invariant(execFileSync('git', ['status', '--porcelain'], { cwd: repository, encoding: 'utf8' }).trim() === '', 'Composition requires a clean source freeze including documentation');
  mkdirSync(destination, { mode: 0o700 });
  const source = join(destination, 'frozen-source'), artifacts = join(destination, 'accepted-artifacts'), claims = join(destination, 'private-claims');
  for (const path of [source, artifacts, claims]) mkdirSync(path, { mode: 0o700 });
  for (const entry of deploymentEntries(repository)) if (existsSync(join(repository, entry))) {
    mkdirSync(dirname(join(source, entry)), { recursive: true, mode: 0o700 }); cpSync(realpathSync(join(repository, entry)), join(source, entry), { recursive: true });
  }
  const store = new QualificationStore(claims, 64 * 1024 * 1024), authorities: AuthorityStore[] = [];
  try {
    const implementation = observerImplementation(), fixed = identity('PUBLIC fixed synthetic composition only'), issuer = 'PUBLIC-synthetic-issuer', evaluator = 'PUBLIC-synthetic-observer';
    // Explicitly manufactured keys authorize engineering fixtures only.
    const issuerKey = Buffer.alloc(32, 151), evaluatorKey = Buffer.alloc(32, 152), scope = { kind: 'restricted' as const, principals: ['PUBLIC-evaluator'] };
    const materialized = syntheticCompositionCases.map(caseId => {
      const resources = envelopes[caseId];
      const configuration: DeploymentInputs['configuration'] = {
        model: { provider: 'mistral', id: 'public-screen-composition-fixture', contextWindow: 128000, reasoning: false, effort: 'none', maxOutputTokens: 256, maxRequestsPerSlice: caseId === 'S01' ? 32 : 64, timeoutMs: 10000, pricesPerMillion: { input: 0, output: 0 } },
        resources, conversationResources: resources, scheduler: { windowMs: resources.maxElapsedMs, maxSlicesPerWindow: 1, maxLifetimeSlices: 1, quantumMs: resources.maxElapsedMs, idleRetryMs: 1000, maxStalls: 2, resources },
        maxConcurrentRuns: caseId === 'S01' ? 1 : 2, pollMs: 100, commands: ['/runtime/node'], researchHosts: [], bootstrapInitiative: false,
        direct: { host: '127.0.0.1', port: 0, actorId: 'PUBLIC-evaluator', scope, modificationEligible: false },
        resourceLimits: { memoryBytes: 256 * 1024 * 1024, pids: 64, cpuQuotaMicros: 100000, cpuPeriodMicros: 100000, maxFileBytes: 16 * 1024 * 1024, maxOpenFiles: 128, workspaceBytes: 64 * 1024 * 1024, workspaceInodes: 4096 },
      };
      const candidate = freezeApplication(source, artifacts, { configuration, createdBy: 'PUBLIC-synthetic-author', prompts: { mind: oldPrompt, compaction: compactionPrompt }, runtime: { nodeVersion: process.version, nodeSha256: hashBytes(readFileSync(process.execPath)), platform: process.platform, arch: process.arch }, policy: { kind: 'PUBLIC permanently synthetic engineering fixture' } });
      const privateRoot = join(destination, `private-${caseId}`), stateDirectory = join(destination, `original-state-${caseId}`), workspaceDirectory = hostResources.workspaceDirectories[caseId];
      for (const path of [privateRoot, stateDirectory]) mkdirSync(path, { mode: 0o700 });
      const host = { artifactStore: artifacts, nodeBinary: realpathSync(process.execPath), stateDirectory, workspaceDirectory, cgroupRoot: hostResources.cgroupRoot }, config = materializeConfiguration(candidate, host);
      const authorityStore = new AuthorityStore(join(stateDirectory, 'authority.sqlite')); authorities.push(authorityStore);
      const authority = authorityStore.bootstrap(`PUBLIC-${caseId}-initial`, candidate.manifest.controls, candidate.manifest.id);
      const packet = caseId === 'S01' ? publicRehearsalPacket('S01') : {}, packetFile = join(privateRoot, 'public-rehearsal-packet.json');
      writeFileSync(packetFile, canonicalJson(packet), { mode: 0o600, flag: 'wx' });
      return { caseId, candidate, config, packet, binding: { caseId, attempt: 1 as const, host, privateRoot, packetFile, authorityStore, authority } };
    });
    invariant(materialized[0]!.candidate.manifest.controls === materialized[1]!.candidate.manifest.controls, 'Fixed fixture source controls changed between cases');
    const policyBase = { kind: 'engineering' as const, controlRevision: materialized[0]!.candidate.manifest.controls, requiredCases: ['PUBLIC-synthetic-mechanics'], evaluatorKeys: new Map([[evaluator, evaluatorKey]]), evaluatorArtifacts: new Map([[evaluator, implementation.artifact.sha256]]) };
    const trust: QualificationTrust = { issuerKeys: new Map([[issuer, issuerKey]]), observerArtifact: implementation.artifact, policy: { ...policyBase, policyDigest: admissionPolicyIdentity(policyBase) }, protocolDigest: fixed, calibrationPlans: new Set([fixed]), objectiveCases: new Map(materialized.map(item => [item.caseId, identity(item.packet)])) };
    // Issue once only after source/materialization setup. Both original windows
    // remain fixed through sequential preparation, claims, restart and capture.
    const issuedAt = new Date().toISOString(), plan: PublicScreenPlan = { version: 1, id: 'PUBLIC-S01-S08-initial1', issuedAt, expiresAt: new Date(Date.parse(issuedAt) + 180000).toISOString(), protocolDigest: fixed, observerArtifactDigest: implementation.artifact.sha256, claimStoreDigest: identity(store.identity()), resources: { maxRequests: 280, maxTokens: 480000, maxCostUsd: 0, maxElapsedMs: 180000, maxConcurrency: 3 }, maxPlanRecordBytes: 8 * 1024 * 1024, maxPlanArtifactBytes: 1000000, cases: [] };
    for (const item of materialized) {
      const experiment: Experiment = { version: 1, id: `PUBLIC-${item.caseId}-initial1`, grantId: `PUBLIC-${item.caseId}-original-grant`, kind: 'integration', candidate: item.candidate.manifest, configurationDigest: identity(JSON.parse(JSON.stringify(item.config))), protocolDigest: fixed, calibrationPlanDigest: fixed, privatePacketDigest: identity(item.packet), observerArtifactDigest: implementation.artifact.sha256, evaluatorId: evaluator, priorPolicyDigest: trust.policy.policyDigest, resources: envelopes[item.caseId], issuedAt, expiresAt: new Date(Date.parse(issuedAt) + envelopes[item.caseId].maxElapsedMs).toISOString(), maxEvidenceBytes: 8 * 1024 * 1024, maxArtifactBytes: 1000000 };
      plan.cases.push({ caseId: item.caseId, workloadDigest: publicWorkloadIdentity(item.caseId), intervention: publicInterventions[item.caseId], attempts: [signDocument('aeon.qualification.experiment.v1', experiment, issuer, issuerKey)] });
    }
    const signed = signDocument(syntheticCompositionDomain, plan, issuer, issuerKey);
    const receipt = { kind: 'permanently-synthetic-host-composition', cleanRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(), sourceManifest: implementation.artifact, driverSha256: hashBytes(readFileSync(fileURLToPath(import.meta.url))), nodeSha256: hashBytes(readFileSync(process.execPath)), plan: signed, originalClaimStore: store.identity(), capacityBytes: store.capacityBytes, originalEnvelopes: envelopes, source, artifacts, controls: trust.policy.controlRevision, noPaidRequests: true, admissionEligible: false };
    writeFileSync(join(destination, 'composition-plan.json'), `${canonicalJson(receipt)}\n`, { mode: 0o600, flag: 'wx' });
    const options: PublicScreenHostOptions = { plan: signed, trust, store, bindings: materialized.map(item => item.binding), secrets: { mistralApiKey: 'PUBLIC-fixture-no-provider', directToken: 'PUBLIC-fixture-no-listener' } };
    return { options, close: () => { for (const authority of authorities) authority.close(); store.close(); } };
  } catch (error) { for (const authority of authorities) authority.close(); store.close(); throw error; }
}
async function main() {
  invariant(process.argv.length === 5 && process.argv[2] === '--synthetic', 'Only explicit permanently synthetic composition command supported');
  const resources = JSON.parse(readHostFile(process.argv[4]!, 65536).toString('utf8')) as CompositionHostResources;
  const fixture = prepareCompositionFixture(process.argv[3]!, resources);
  try {
    const reference = await runSyntheticPublicScreenComposition(fixture.options), aggregate = JSON.parse(fixture.options.store.readArtifact(reference).toString());
    writeFileSync(join(process.argv[3]!, 'composition-result.json'), `${canonicalJson({ reference, aggregate })}\n`, { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ destination: process.argv[3], reference, reports: aggregate.reports.map((item: any) => ({ caseId: item.caseId, verdict: item.verdict, failure: item.failure })), kind: aggregate.evidenceKind }));
    if (aggregate.reports.length !== 2 || aggregate.reports.some((item: any) => item.verdict !== 'case-pass')) process.exitCode = 1;
  } finally { fixture.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
