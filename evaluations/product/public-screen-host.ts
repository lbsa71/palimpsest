import { existsSync, readFileSync, realpathSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson, digest, identity, invariant, type Authority, type ArtifactRef, type ResourceEnvelope, type CandidateManifest } from '../../packages/contracts/index.ts';
import { authenticate, inertSnapshot, verifyExperiment, type Experiment, type Signed } from '../qualification/manifest.ts';
import { checkTrust, observerImplementation, verifyInvokedHost, type QualificationTrust } from '../qualification/observer.ts';
import { QualificationStore } from '../qualification/store.ts';
import { verifyApplication } from '../../deployment/candidate.ts';
import { materializeConfiguration, type HostBindings } from '../../deployment/materialize.ts';
import { assertPrivateHostDirectory, readHostFile } from '../../deployment/host-policy.ts';
import { validateEnvelope, beneath, type ApplicationConfig, type ApplicationSecrets } from '../../deployment/config.ts';
import { hashBytes } from '../../packages/release/artifacts.ts';
import { AuthorityStore } from '../../packages/supervisor/authority.ts';
import { OperationalStore } from '../../packages/storage/index.ts';
import { ResourceLedger } from '../../packages/runtime/index.ts';
import { providerGateway } from '../../deployment/provider-gateway.ts';
import { assertResourceConfinement, initializeResourceDelegation } from '../../packages/supervisor/resource-limits.ts';
import { publicWorkload, runScreenCase, validateProbes, type PrivateScreenPacket, type ScreenCaseId, type ScreenOptions } from './screen.ts';
import { lifecycleWorkload, type LifecycleCase } from './lifecycle-fixtures.ts';
import { assertPrivateRoot } from './adapter.ts';
import { runLifecycleCase, type LifecycleLiveInvocation } from './lifecycle.ts';
import { admitCandidate, admissionPolicyIdentity, type AdmissionPolicy, type SignedEvaluation } from '../../packages/release/admission.ts';
import { contentAddressedEvidence } from '../../deployment/host-policy.ts';
import { screenFixture } from './screen-driver.ts';
import type { ReleaseProposal } from '../../packages/contracts/index.ts';

export const publicScreenCases = ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10', 'S11', 'S12'] as const;
export type PublicScreenCase = typeof publicScreenCases[number];
export const publicScreenDomain = 'aeon.public-screen.plan.v1';
export const syntheticCompositionDomain = 'aeon.public-screen.synthetic-composition.v1';
export const syntheticCompositionCases = ['S01', 'S08'] as const;
const syntheticSecrets = Object.freeze({ mistralApiKey: 'PUBLIC-fixture-no-provider', directToken: 'PUBLIC-fixture-no-listener' });
export const publicInterventions = Object.freeze({ S01: 'ordinary', S02: 'ordinary', S03: 'ordinary', S04: 'ordinary', S05: 'ordinary', S06: 'ordinary', S07: 'ordinary', S08: 'observed-checkpoint-dispatch-kill-reopen-correct', S09: 'ordinary-threshold60-retain20', S10: 'ordinary', S11: 'local-durable-lost-ack-reconcile', S12: 'admitted-prompt-successor-after-exit' });
export interface PublicCasePlan { caseId: PublicScreenCase; workloadDigest: string; intervention: string; attempts: Signed<Experiment>[]; successor?: { candidate: CandidateManifest; proposalDigest: string; configurationDigest: string } }
export interface PublicScreenPlan { version: 1; id: string; issuedAt: string; expiresAt: string; protocolDigest: string; observerArtifactDigest: string; claimStoreDigest: string; resources: ResourceEnvelope; maxPlanRecordBytes: number; maxPlanArtifactBytes: number; cases: PublicCasePlan[] }
const exact = (value: object, keys: string[]) => invariant(Object.keys(value).sort().join(',') === keys.sort().join(','), 'Exact public screen fields required');
export function verifyPublicScreenPlan(document: Signed<PublicScreenPlan>, trust: QualificationTrust, now = Date.now()): PublicScreenPlan {
  return verifyFixedPlan(document, trust, now, false);
}
export function verifySyntheticCompositionPlan(document: Signed<PublicScreenPlan>, trust: QualificationTrust, now = Date.now()): PublicScreenPlan {
  return verifyFixedPlan(document, trust, now, true);
}
function verifyFixedPlan(document: Signed<PublicScreenPlan>, trust: QualificationTrust, now: number, synthetic: boolean): PublicScreenPlan {
  const plan = authenticate(synthetic ? syntheticCompositionDomain : publicScreenDomain, document, trust.issuerKeys);
  exact(plan, ['version', 'id', 'issuedAt', 'expiresAt', 'protocolDigest', 'observerArtifactDigest', 'claimStoreDigest', 'resources', 'maxPlanRecordBytes', 'maxPlanArtifactBytes', 'cases']);
  invariant(plan.version === 1 && typeof plan.id === 'string' && plan.id.length > 0 && plan.id.length <= 256, 'Bounded public screen identity required'); validateEnvelope(plan.resources);
  invariant(Date.parse(plan.issuedAt) <= now && Date.parse(plan.expiresAt) > now && Date.parse(plan.expiresAt) - Date.parse(plan.issuedAt) <= plan.resources.maxElapsedMs, 'Public plan outside its original finite time window');
  for (const field of ['protocolDigest', 'observerArtifactDigest', 'claimStoreDigest'] as const) digest(plan[field], field);
  invariant(plan.protocolDigest === trust.protocolDigest && plan.observerArtifactDigest === trust.observerArtifact.sha256, 'Public plan differs from configured host observer/protocol');
  invariant(Number.isSafeInteger(plan.maxPlanRecordBytes) && plan.maxPlanRecordBytes > 0 && plan.maxPlanRecordBytes <= 8 * 1024 * 1024 && Number.isSafeInteger(plan.maxPlanArtifactBytes) && plan.maxPlanArtifactBytes > 0 && plan.maxPlanArtifactBytes <= 1_000_000 && plan.maxPlanArtifactBytes <= plan.maxPlanRecordBytes, 'Existing signed evidence ceilings required');
  invariant(Buffer.byteLength(canonicalJson(document)) <= plan.maxPlanRecordBytes, 'Signed plan record exceeds original metadata ceiling');
  const cases = synthetic ? syntheticCompositionCases : publicScreenCases;
  invariant(Array.isArray(plan.cases) && plan.cases.length === cases.length && new Set(plan.cases.map(c => c.caseId)).size === cases.length && plan.cases.every(c => (cases as readonly string[]).includes(c.caseId)), synthetic ? 'Exactly S01 and S08 synthetic composition cases required' : 'Exactly twelve declared public cases required');
  const ids = new Set<string>(), grants = new Set<string>(); const totals = { requests: 0, tokens: 0, costUsd: 0, concurrency: 0 };
  for (const item of plan.cases) {
    exact(item, ['caseId', 'workloadDigest', 'intervention', 'attempts', ...(item.successor !== undefined ? ['successor'] : [])]); digest(item.workloadDigest, 'public workload');
    invariant(item.intervention === publicInterventions[item.caseId] && Array.isArray(item.attempts) && item.attempts.length >= 1 && item.attempts.length <= 3, 'Fixed public intervention and at most three initial attempts required');
    invariant((item.caseId === 'S12') === (item.successor !== undefined), 'Only S12 requires its separately admitted successor');
    if (item.successor) { exact(item.successor, ['candidate', 'proposalDigest', 'configurationDigest']); digest(item.successor.proposalDigest, 'successor proposal'); digest(item.successor.configurationDigest, 'successor configuration'); }
    for (const signed of item.attempts) {
      const e = verifyExperiment(signed, trust.issuerKeys, now); checkTrust(e, trust);
      invariant(synthetic ? e.kind === 'integration' && trust.policy.kind === 'engineering' : e.kind === 'live-product' && trust.policy.kind === 'product', synthetic ? 'Synthetic composition requires integration authority and engineering policy' : 'Public live path requires externally issued live-product authority');
      if (synthetic) invariant(item.attempts.length === 1 && identity(e.resources) === identity(compositionEnvelope(item.caseId)), 'Synthetic composition retains its two fixed original engineering envelopes');
      invariant(!ids.has(e.id) && !grants.has(e.grantId), 'Repeated original case/attempt or grant'); ids.add(e.id); grants.add(e.grantId);
      invariant(e.issuedAt === plan.issuedAt && Date.parse(e.expiresAt) <= Date.parse(plan.expiresAt) && e.protocolDigest === plan.protocolDigest && e.observerArtifactDigest === plan.observerArtifactDigest, 'Attempt differs from predeclared simultaneous issue/time identities');
      totals.requests += e.resources.maxRequests; totals.tokens += e.resources.maxTokens; totals.costUsd += e.resources.maxCostUsd; totals.concurrency = Math.max(totals.concurrency, e.resources.maxConcurrency);
    }
  }
  invariant(totals.requests <= plan.resources.maxRequests && totals.tokens <= plan.resources.maxTokens && totals.costUsd <= plan.resources.maxCostUsd && totals.concurrency <= plan.resources.maxConcurrency, 'Declared attempts exceed original aggregate grant');
  return plan;
}
export interface PublicAttemptBinding { caseId: PublicScreenCase; attempt: 1 | 2 | 3; host: HostBindings; privateRoot: string; packetFile: string; authorityStore: AuthorityStore; authority: Authority; successor?: { proposalFile: string; signedFile: string; evidenceDirectory: string; policy: AdmissionPolicy } }
export interface PublicScreenHostOptions { plan: Signed<PublicScreenPlan>; trust: QualificationTrust; store: QualificationStore; bindings: PublicAttemptBinding[]; secrets: ApplicationSecrets }
function publicTask(caseId: PublicScreenCase) { return ['S08', 'S09', 'S11', 'S12'].includes(caseId) ? lifecycleWorkload(caseId as LifecycleCase) : publicWorkload(caseId as ScreenCaseId); }
export function publicWorkloadIdentity(caseId: PublicScreenCase) { return identity(publicTask(caseId)); }
function privateSecrets(secrets: ApplicationSecrets): ApplicationSecrets {
  const value = inertSnapshot(secrets); exact(value, ['mistralApiKey', 'directToken']);
  invariant(typeof value.mistralApiKey === 'string' && value.mistralApiKey.length > 0 && typeof value.directToken === 'string' && value.directToken.length > 0, 'Explicit protected host Mistral/direct secrets required'); return value;
}
function compositionEnvelope(caseId: PublicScreenCase): ResourceEnvelope { return caseId === 'S01' ? { maxRequests: 100, maxTokens: 120000, maxCostUsd: 0, maxElapsedMs: 60000, maxConcurrency: 2 } : { maxRequests: 180, maxTokens: 360000, maxCostUsd: 0, maxElapsedMs: 180000, maxConcurrency: 3 }; }
function checkConfiguration(caseId: PublicScreenCase, config: ApplicationConfig, e: Experiment, synthetic: boolean) {
  invariant(identity(JSON.parse(JSON.stringify(config))) === e.configurationDigest && identity(config.resources) === identity(e.resources) && identity(config.conversationResources) === identity(e.resources) && identity(config.scheduler.resources) === identity(e.resources), 'Actual configuration/profile/envelope differs from original grant');
  if (synthetic) invariant(config.model.id === 'public-screen-composition-fixture' && config.model.pricesPerMillion.input === 0 && config.model.pricesPerMillion.output === 0 && config.model.maxRequestsPerSlice === (caseId === 'S01' ? 32 : 64), 'Synthetic composition profile must remain the fixed zero-cost public fixture');
  else invariant((config.model.provider ?? 'mistral') === 'mistral' && !/fixture|latest/i.test(config.model.id) && config.model.pricesPerMillion.input > 0 && config.model.pricesPerMillion.output > 0, 'Explicit priced pinned carried Mistral profile required');
  invariant(config.resourceLimits && config.direct.host === '127.0.0.1' && config.direct.port === 0 && config.bootstrapInitiative === false && config.researchHosts.length === 0 && config.commands.length === 1 && config.commands[0] === '/runtime/node', 'Public case requires real kernel limits and isolated ordinary local surface');
  invariant(caseId === 'S11' ? config.slack?.teamId === 'LOCAL-T1' && config.slack.botUserId === 'BOT' && config.slack.channels.length === 1 && config.slack.channels[0]!.channel === 'LOCAL-C1' : !config.slack, 'External Slack unavailable; only fixed S11 local receiver configuration permitted');
}
function failureRecord(caseId: PublicScreenCase, attempt: number, signed: Signed<Experiment>, source: ArtifactRef, failure: string) {
  return { caseId, attempt, originalGrant: signed, actualSource: source, verdict: 'criterion-unmet', failure, requiredEvidence: 'unavailable', independent: false, admissionEligible: false };
}
/** No claims, kernel probe, application construction or gateway call occurs in this preparation. */
export function preparePublicScreen(options: PublicScreenHostOptions) {
  return prepareFixedScreen(options, false);
}
export function prepareSyntheticComposition(options: PublicScreenHostOptions) { return prepareFixedScreen(options, true); }
function prepareFixedScreen(options: PublicScreenHostOptions, synthetic: boolean) {
  exact(options, ['plan', 'trust', 'store', 'bindings', 'secrets']);
  const plan = verifyFixedPlan(options.plan, options.trust, Date.now(), synthetic), implementation = observerImplementation();
  invariant(identity(options.store.identity()) === plan.claimStoreDigest, 'Original host claim store was replaced or recreated');
  const planClaimsBytes = 2 * Buffer.byteLength(canonicalJson({ manifest: options.plan, claimedAt: new Date().toISOString() }));
  const requiredCapacity = plan.cases.flatMap(item => item.attempts).reduce((sum, attempt) => sum + attempt.value.maxEvidenceBytes, 0) + planClaimsBytes + implementation.bytes.length + plan.maxPlanRecordBytes;
  const usage = options.store.usage(), requiredEntries = 4 + plan.cases.flatMap(item => item.attempts).reduce((sum, attempt) => sum + 4 + Math.ceil(attempt.value.maxEvidenceBytes / Math.floor((attempt.value.maxArtifactBytes - 256) * 3 / 4)), 0);
  invariant(usage.usedBytes + requiredCapacity <= options.store.capacityBytes, 'Original private evidence capacity cannot retain every declared attempt and outer records');
  invariant(Number.isFinite(requiredEntries) && requiredEntries > 0 && usage.entryCount + requiredEntries < 4096, 'Original private evidence entry ceiling cannot retain every declared attempt');
  invariant(implementation.artifact.sha256 === plan.observerArtifactDigest, 'Actual observer implementation differs from issued identity');
  const secrets = privateSecrets(options.secrets);
  if (synthetic) invariant(identity(secrets) === identity(syntheticSecrets), 'Synthetic composition only accepts fixed manufactured secrets'); // private validation only; never included in the returned proposal
  invariant(options.bindings.length === plan.cases.reduce((n, c) => n + c.attempts.length, 0), 'Exact declared host binding count required');
  const prepared = plan.cases.flatMap(item => item.attempts.map((signed, index) => {
    const binding = options.bindings.find(b => b.caseId === item.caseId && b.attempt === index + 1); invariant(binding, 'Missing declared case/attempt host binding');
    exact(binding, ['caseId', 'attempt', 'host', 'privateRoot', 'packetFile', 'authorityStore', 'authority', ...(binding.successor ? ['successor'] : [])]);
    exact(binding.host, ['stateDirectory', 'workspaceDirectory', 'artifactStore', 'nodeBinary', 'cgroupRoot']);
    const e = verifyExperiment(signed, options.trust.issuerKeys); checkTrust(e, options.trust);
    const failureReserveBytes = Buffer.byteLength(canonicalJson(failureRecord(item.caseId, index + 1, signed, implementation.artifact, 'F'.repeat(65536))));
    invariant(failureReserveBytes <= e.maxArtifactBytes && failureReserveBytes < e.maxEvidenceBytes, 'Original evidence allowance cannot retain bounded failure receipt');
    invariant(item.workloadDigest === publicWorkloadIdentity(item.caseId) && options.trust.objectiveCases.get(item.caseId) === e.privatePacketDigest, 'Public workload/private evaluator packet differs from configured host identity');
    const { host, privateRoot, packetFile } = binding;
    assertPrivateHostDirectory(privateRoot); assertPrivateHostDirectory(host.stateDirectory); assertPrivateHostDirectory(host.workspaceDirectory);
    for (const root of [privateRoot, options.store.directory]) assertPrivateRoot(root, options.bindings.flatMap(b => [b.host.artifactStore, b.host.stateDirectory, b.host.workspaceDirectory]).concat('/usr'));
    invariant(realpathSync(packetFile) === packetFile && beneath(privateRoot, packetFile), 'Private evaluator input must remain outside all candidate mounts');
    const packet = readHostFile(packetFile, Math.min(65536, e.maxArtifactBytes)); const decoded = JSON.parse(packet.toString('utf8'));
    invariant(packet.equals(Buffer.from(canonicalJson(decoded))) && identity(decoded) === e.privatePacketDigest, 'Exact canonical private packet bytes required');
    if (['S08', 'S09', 'S11', 'S12', 'S07'].includes(item.caseId)) exact(decoded, []);
    else if (['S02', 'S03', 'S10'].includes(item.caseId)) { exact(decoded, ['probes']); validateProbes(item.caseId as ScreenCaseId, decoded as PrivateScreenPacket); }
    else { exact(decoded, ['expectedAnswer']); invariant(decoded.expectedAnswer !== undefined, 'External expected answer required'); }
    const candidate = verifyApplication(host.artifactStore, e.candidate.id, host.nodeBinary); invariant(identity(candidate.manifest) === identity(e.candidate), 'Actual candidate differs from issued candidate');
    verifyInvokedHost(candidate.files, implementation.bytes);
    for (const file of implementationValueFiles(implementation.bytes).filter(file => file.path.startsWith('evaluations/product/') || file.path.startsWith('evaluations/qualification/'))) invariant(candidate.files.some(f => f.path === file.path && f.sha256 === file.sha256), 'Actual product observer/process closure differs from frozen candidate');
    const config = materializeConfiguration(candidate, host); invariant(hashBytes(readFileSync(config.nodeBinary)) === hashBytes(readFileSync(process.execPath)), 'Actual observer runtime differs from issued runtime'); checkConfiguration(item.caseId, config, e, synthetic);
    binding.authorityStore.assert(binding.authority); invariant(binding.authorityStore.current()?.artifactId === candidate.manifest.id && binding.authority.controlRevision === candidate.manifest.controls, 'Original candidate authority unavailable');
    const authorityPath = join(host.stateDirectory, 'authority.sqlite'); invariant(existsSync(authorityPath), 'Actual application authority state is unavailable');
    const actualAuthority = new AuthorityStore(authorityPath);
    try { actualAuthority.assert(binding.authority); invariant(identity(actualAuthority.current()) === identity(binding.authorityStore.current()), 'Supplied authority handle differs from actual application authority'); } finally { actualAuthority.close(); }
    invariant(!existsSync(join(host.stateDirectory, 'operational.sqlite')), 'Attempt state already exists; original clock cannot be reset');
    let transition: LifecycleLiveInvocation['transition'] = null;
    invariant((item.caseId === 'S12') === !!binding.successor, 'Exact external successor binding required only for S12');
    if (binding.successor) {
      const proof = binding.successor;
      invariant(proof.policy.kind === 'product' && proof.policy.policyDigest === options.trust.policy.policyDigest && admissionPolicyIdentity(proof.policy) === admissionPolicyIdentity(options.trust.policy), 'S12 successor must use the exact accepted prior judging policy');
      for (const path of [proof.proposalFile, proof.signedFile, proof.evidenceDirectory]) { invariant(realpathSync(path) === path && beneath(privateRoot, path), 'Admission proof must remain inside external private root'); }
      const proposal = JSON.parse(readHostFile(proof.proposalFile, e.maxArtifactBytes).toString('utf8')) as ReleaseProposal;
      const signedEvidence = JSON.parse(readHostFile(proof.signedFile, e.maxArtifactBytes).toString('utf8')) as SignedEvaluation[];
      invariant(identity({ proposal, signed: signedEvidence }) === item.successor!.proposalDigest && identity(proposal.candidate) === identity(item.successor!.candidate), 'External admitted successor proof differs from declared plan');
      const admission = admitCandidate(host.artifactStore, proposal, binding.authority, proof.policy, signedEvidence, contentAddressedEvidence(proof.evidenceDirectory));
      const current = verifyApplication(host.artifactStore, admission.candidateId, host.nodeBinary);
      invariant(identity(current.manifest) === identity(item.successor!.candidate), 'Actually admitted successor differs from frozen plan'); verifyInvokedHost(current.files, implementation.bytes);
      for (const field of ['source', 'dependencies', 'configuration', 'controls', 'model'] as const) invariant(candidate.manifest[field] === current.manifest[field], 'S12 must be a complete prompt-only successor');
      invariant(candidate.manifest.prompts !== current.manifest.prompts, 'S12 owned prompt bytes did not change');
      const configCurrent = materializeConfiguration(current, host); invariant(identity(JSON.parse(JSON.stringify(configCurrent))) === item.successor!.configurationDigest, 'Actually loaded successor configuration differs from declared bytes');
      transition = { old: candidate, current, initialAuthority: binding.authority, admission, proposal, signed: signedEvidence, policy: { controlRevision: proof.policy.controlRevision, kind: proof.policy.kind, requiredCases: proof.policy.requiredCases, policyDigest: proof.policy.policyDigest }, configOld: config, configCurrent, artifactStore: host.artifactStore, evidenceDirectory: proof.evidenceDirectory };
    }
    const claimRecordBytes = Buffer.byteLength(canonicalJson({ manifest: { plan: options.plan, experiment: signed, caseId: item.caseId, attempt: index + 1 }, claimedAt: new Date().toISOString() }));
    const authorityBytes = Buffer.byteLength(canonicalJson(binding.authorityStore.history()));
    invariant(claimRecordBytes <= e.maxArtifactBytes && authorityBytes <= e.maxArtifactBytes && 2 * claimRecordBytes + packet.length + authorityBytes + failureReserveBytes < e.maxEvidenceBytes, 'Known original claims/packet/authority and failure reserve exceed signed evidence allowance before claim');
    const { successor: _privateProof, ...safeBinding } = binding;
    return { caseId: item.caseId, attempt: index + 1 as 1 | 2 | 3, signed, experiment: e, binding: safeBinding, config, packetDigest: identity(decoded), candidateManifest: candidate.manifest, transition, failureReserveBytes };
  }));
  invariant(new Set(prepared.map(p => p.config.stateDirectory)).size === prepared.length && new Set(prepared.map(p => p.config.workspaceDirectory)).size === prepared.length, 'Each initial attempt requires unique original state/workspace bindings');
  const mounts = prepared.flatMap(p => [p.config.stateDirectory, p.config.workspaceDirectory]);
  invariant(mounts.every((a, i) => mounts.every((b, j) => i === j || !beneath(a, b))), 'Attempt state/workspace mounts must be disjoint across cases');
  void secrets; return { plan, observerArtifact: implementation.artifact, prepared };
}
function implementationValueFiles(bytes: Buffer): { path: string; sha256: string }[] { return JSON.parse(bytes.toString('utf8')).files; }

const liveScreenOptions = new WeakMap<ScreenOptions, { grant: Experiment; configuration: string; synthetic: boolean; gateway: ScreenOptions['application']['performRequest'] }>();
const liveLifecycleOptions = new WeakMap<LifecycleLiveInvocation, { grant: Experiment; configuration: string; synthetic: boolean }>();
export function assertHostLifecycleInvocation(options: LifecycleLiveInvocation) {
  const bound = liveLifecycleOptions.get(options); invariant(bound, 'Live lifecycle closed: not authenticated by concrete host route');
  invariant(options.acquisitionKind === (bound.synthetic ? 'synthetic-host-composition' : 'live-public-screen') && identity(JSON.parse(JSON.stringify(options.configuration))) === bound.configuration && identity(options.originalGrant.value) === identity(bound.grant) && Date.now() >= Date.parse(bound.grant.issuedAt) && Date.now() < Date.parse(bound.grant.expiresAt), 'Lifecycle invocation differs from original authenticated grant');
}
/** Only the concrete authenticated host entry registers an invocation; caller booleans/seals cannot. */
export function assertHostScreenInvocation(options: ScreenOptions) {
  const bound = liveScreenOptions.get(options); invariant(bound, 'Live public screen unavailable until an independently qualified host grant route is bound; direct invocation is closed');
  invariant(options.mode === (bound.synthetic ? 'synthetic-host-composition' : 'live-public-screen') && !options.liveSeal && options.application.performRequest === bound.gateway && identity(JSON.parse(JSON.stringify(options.application.config))) === bound.configuration && Date.now() >= Date.parse(bound.grant.issuedAt) && Date.now() < Date.parse(bound.grant.expiresAt), 'Live invocation differs from original authenticated grant');
}
/** Fixed production gateway and body retention only; no caller fetch/transport option exists. */
export interface PublicAcquisitionEvidence { claimBytes: number; packetFile: string; packetSha256: string; privateRoot: string; authorityPath: string; caseId: PublicScreenCase; attempt: number; experimentId: string }
export interface PublicGatewayBounds { maxArtifactBytes: number; maxEvidenceBytes: number; grantId: string; auxiliary?: PublicAcquisitionEvidence }
function protectedBody(body: string, secrets: ApplicationSecrets) {
  const contains = (text: string) => Object.values(secrets).some(secret => secret && text.includes(secret));
  invariant(!contains(body), 'Provider body contains protected host secret; retention unavailable');
  let decoded: unknown; try { decoded = JSON.parse(body); } catch { return; }
  const protocol = decoded as { choices?: { message?: { tool_calls?: { function?: { arguments?: unknown } }[] } }[] };
  const pending = [decoded];
  // Ordinary Mistral tool arguments are a second JSON envelope. Decode exactly
  // that protocol field; other strings are inspected without arbitrary decoding.
  if (Array.isArray(protocol?.choices)) for (const choice of protocol.choices) if (Array.isArray(choice?.message?.tool_calls)) for (const call of choice.message.tool_calls) {
    if (typeof call?.function?.arguments === 'string') { try { pending.push(JSON.parse(call.function.arguments)); } catch { /* malformed arguments remain an ordinary provider failure */ } }
  }
  while (pending.length) {
    const value = pending.pop();
    if (typeof value === 'string') invariant(!contains(value), 'Provider body contains protected host secret; retention unavailable');
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { invariant(!contains(key), 'Provider body contains protected host secret; retention unavailable'); pending.push(child); }
  }
}
export function assertPublicAcquisitionAllowance(config: ApplicationConfig, bounds: PublicGatewayBounds) {
  const original = retainedOperationalEvidence(config.stateDirectory);
  const auxiliary = bounds.auxiliary ? acquisitionAuxiliary(bounds.auxiliary, bounds.maxArtifactBytes) : { bytes: 0 };
  invariant(original.bytes + auxiliary.bytes < bounds.maxEvidenceBytes && original.maxArtifactBytes <= bounds.maxArtifactBytes, 'Original retained evidence allowance/artifact ceiling exhausted before provider acquisition');
}
/** Fixed logical evidence operation, shared by production and permanently synthetic acquisition. */
export function retainPublicResponse(config: ApplicationConfig, secrets: ApplicationSecrets, bounds: PublicGatewayBounds, payload: string, response: { status: number; body: string }) {
  invariant(Buffer.byteLength(response.body) <= bounds.maxArtifactBytes, 'Required response exceeds original artifact ceiling');
    protectedBody(response.body, privateSecrets(secrets));
    const store = new OperationalStore({ filename: join(config.stateDirectory, 'operational.sqlite'), checkoutRoot: config.applicationRoot });
    try { store.transaction(() => {
      const key = identity(bounds.grantId), prior = store.get<{ limit: number; bytes: number }>('screen.public-response-retention', key);
      invariant(!prior || prior.value.limit === bounds.maxEvidenceBytes, 'Original raw-response retention limit changed');
      const bytes = (prior?.value.bytes ?? 0) + Buffer.byteLength(response.body); invariant(bytes <= bounds.maxEvidenceBytes, 'Signed raw-response retention allowance exhausted');
      const requestSha256 = hashBytes(Buffer.from(payload)), previous = store.get('screen.lifecycle-provider-responses', requestSha256);
      invariant(!previous, 'Duplicate provider payload cannot overwrite original raw response');
      const responseSha256 = hashBytes(Buffer.from(response.body));
      const counter = { limit: bounds.maxEvidenceBytes, bytes }, receipt = { requestSha256, response: { uri: `aeon:artifact:${responseSha256}`, sha256: responseSha256 }, httpStatus: response.status, recordedAt: new Date().toISOString(), actor: 'host-public-screen-response-retention' };
      // The writer transaction pins the committed snapshot used here. Include both
      // new document values and subtract the replaced counter before any write.
      const metadataBytes = Buffer.byteLength(canonicalJson(counter)) + Buffer.byteLength(canonicalJson(receipt)) - (prior ? Buffer.byteLength(canonicalJson(prior.value)) : 0);
      const knownAuxiliary = bounds.auxiliary ? acquisitionAuxiliary(bounds.auxiliary, bounds.maxArtifactBytes).bytes : 0;
      invariant(retainedOperationalEvidence(config.stateDirectory).bytes + knownAuxiliary + Buffer.byteLength(response.body) + metadataBytes <= bounds.maxEvidenceBytes, 'Original combined retained evidence allowance exhausted');
      store.put('screen.public-response-retention', key, counter, prior?.revision ?? null);
      invariant(identity(store.putArtifact(response.body)) === identity(receipt.response), 'Raw response identity changed');
      store.put('screen.lifecycle-provider-responses', requestSha256, receipt, null);
    }); } finally { store.close(); }
}
export function publicScreenGateway(config: ApplicationConfig, secrets: ApplicationSecrets, bounds: PublicGatewayBounds) {
  const protectedSecrets = privateSecrets(secrets);
  const gateway = providerGateway({ provider: 'mistral', apiKey: () => protectedSecrets.mistralApiKey!, maxResponseBytes: Math.min(bounds.maxArtifactBytes, 2_000_000) });
  return async (payload: string, signal: AbortSignal) => {
    assertPublicAcquisitionAllowance(config, bounds);
    const response = await gateway(payload, signal);
    retainPublicResponse(config, protectedSecrets, bounds, payload, response);
    return response;
  };
}
function fixedSyntheticScreen(config: ApplicationConfig, actorId: string, bounds: PublicGatewayBounds) {
  const fixture = screenFixture('S01', config.model.id, actorId);
  return async (payload: string, signal: AbortSignal) => {
    assertPublicAcquisitionAllowance(config, bounds);
    const response = await fixture(payload, signal); retainPublicResponse(config, syntheticSecrets, bounds, payload, response); return response;
  };
}
/** Exact report bytes are recoverable without exceeding the original artifact ceiling. */
export function retainPublicReport(store: QualificationStore, report: unknown, e: Pick<Experiment, 'maxArtifactBytes' | 'maxEvidenceBytes'>, alreadyRetainedBytes = 0): ArtifactRef {
  invariant(Number.isSafeInteger(alreadyRetainedBytes) && alreadyRetainedBytes >= 0 && alreadyRetainedBytes <= e.maxEvidenceBytes, 'Original retained evidence allowance exhausted');
  const bytes = Buffer.from(canonicalJson(report)), chunkBytes = Math.floor((e.maxArtifactBytes - 256) * 3 / 4); invariant(chunkBytes > 0, 'Artifact ceiling cannot retain public report');
  let retained = alreadyRetainedBytes; const values: { encoding: string; content: string }[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
    const part = { encoding: 'base64', content: bytes.subarray(offset, offset + chunkBytes).toString('base64') }, length = Buffer.byteLength(canonicalJson(part));
    retained += length; invariant(length <= e.maxArtifactBytes && retained <= e.maxEvidenceBytes, 'Required report exceeds original signed evidence allowance'); values.push(part);
  }
  const parts = values.map(value => { const sha256 = hashBytes(Buffer.from(canonicalJson(value))); return { uri: `sha256:${sha256}`, sha256 }; });
  const manifest = { kind: 'public-screen-report-chunks', bytes: bytes.length, sha256: hashBytes(bytes), parts };
  invariant(Buffer.byteLength(canonicalJson(manifest)) <= e.maxArtifactBytes && retained + Buffer.byteLength(canonicalJson(manifest)) <= e.maxEvidenceBytes, 'Report reference manifest exceeds original signed evidence allowance');
  for (const value of values) store.put(value); return store.put(manifest);
}
/** Logical retained content bytes, including actual artifacts and durable raw receipts. */
export function retainedOperationalEvidence(stateDirectory: string): { bytes: number; maxArtifactBytes: number } {
  const filename = join(stateDirectory, 'operational.sqlite'); if (!existsSync(filename)) return { bytes: 0, maxArtifactBytes: 0 };
  const database = new DatabaseSync(filename, { readOnly: true });
  try {
    database.exec('BEGIN');
    const artifacts = database.prepare('SELECT COALESCE(SUM(length(bytes)),0) AS bytes, COALESCE(MAX(length(bytes)),0) AS maximum FROM artifacts').get() as { bytes: number; maximum: number };
    const documents = database.prepare('SELECT COALESCE(SUM(length(CAST(value AS BLOB))),0) AS bytes FROM documents').get() as { bytes: number };
    const events = database.prepare('SELECT COALESCE(SUM(length(CAST(data AS BLOB))),0) AS bytes FROM events').get() as { bytes: number };
    database.exec('COMMIT'); return { bytes: artifacts.bytes + documents.bytes + events.bytes, maxArtifactBytes: artifacts.maximum };
  } finally { database.close(); }
}
function acquisitionAuxiliary(input: PublicAcquisitionEvidence, maximum: number) {
  invariant(existsSync(input.packetFile) && existsSync(input.authorityPath), 'Original private packet/authority evidence unavailable');
  invariant(hashBytes(readHostFile(input.packetFile, maximum)) === input.packetSha256, 'Original private packet bytes changed');
  const destination = join(input.privateRoot, `public-${identity(input.experimentId)}.json`);
  const paths = [input.packetFile, ...(['S08', 'S09', 'S11', 'S12'].includes(input.caseId) ? [destination, join(`${destination}.state`, 'original-attempt.json')] : [join(input.privateRoot, `screen-${input.caseId}-initial-${input.attempt}.json`)])];
  let bytes = input.claimBytes; const files: { path: string; bytes: number; sha256: string }[] = [];
  for (const path of paths) if (existsSync(path)) { const content = readHostFile(path, maximum); bytes += content.length; files.push({ path, bytes: content.length, sha256: hashBytes(content) }); }
  const authority = new AuthorityStore(input.authorityPath); let authorityBytes: number;
  try { authorityBytes = Buffer.byteLength(canonicalJson(authority.history())); } finally { authority.close(); }
  invariant(authorityBytes <= maximum, 'Required authority history exceeds original artifact ceiling'); bytes += authorityBytes;
  let receiverBytes = 0; const receiverPath = join(`${destination}.state`, 'local-receiver.sqlite');
  if (existsSync(receiverPath)) { const db = new DatabaseSync(receiverPath, { readOnly: true }); try { db.exec('BEGIN'); receiverBytes = Buffer.byteLength(canonicalJson({ deliveries: db.prepare('SELECT * FROM deliveries ORDER BY sequence').all(), calls: db.prepare('SELECT * FROM calls ORDER BY sequence').all() })); db.exec('COMMIT'); } finally { db.close(); } invariant(receiverBytes <= maximum, 'Required local receiver evidence exceeds original artifact ceiling'); bytes += receiverBytes; }
  return { bytes, files, authorityBytes, receiverBytes, claimBytes: input.claimBytes };
}
export async function runHostAuthorizedPublicScreen(options: PublicScreenHostOptions) {
  return runFixedScreen(options, false);
}
/** Permanently synthetic fixed integration route; no live grant or transport accepted. */
export async function runSyntheticPublicScreenComposition(options: PublicScreenHostOptions) { return runFixedScreen(options, true); }
async function runFixedScreen(options: PublicScreenHostOptions, synthetic: boolean) {
  const prepared = prepareFixedScreen(options, synthetic);
  const source = JSON.parse(observerImplementation().bytes.toString('utf8'));
  invariant(Buffer.byteLength(canonicalJson(source)) <= prepared.plan.maxPlanRecordBytes && Buffer.byteLength(canonicalJson(source)) <= prepared.plan.maxPlanArtifactBytes, 'Actual observer manifest exceeds declared metadata ceiling');
  invariant(options.store.put(source).sha256 === prepared.observerArtifact.sha256, 'Actual source artifact identity changed');
  options.store.claim(`${synthetic ? 'synthetic-composition' : 'public-screen'}:${prepared.plan.id}`, `${synthetic ? 'synthetic-composition-plan' : 'public-screen-plan'}:${prepared.plan.id}`, options.plan);
  const reports: { caseId: PublicScreenCase; attempt: number; report: ArtifactRef; verdict: string; failure: string | null }[] = [];
  for (const item of prepared.prepared) {
    // A later case retains its originally issued window, even after earlier work.
    let ref: ArtifactRef, verdict = 'criterion-unmet', failure: string | null = null;
    try {
      const e = verifyExperiment(item.signed, options.trust.issuerKeys); checkTrust(e, options.trust);
      invariant(identity(options.store.identity()) === prepared.plan.claimStoreDigest, 'Original claim store/capacity changed after preparation');
      invariant(Date.now() < Date.parse(prepared.plan.expiresAt), 'Original public plan expired before next attempt');
      invariant(observerImplementation().artifact.sha256 === prepared.observerArtifact.sha256, 'Original imported observer source changed before attempt');
      const candidate = verifyApplication(item.binding.host.artifactStore, e.candidate.id, item.binding.host.nodeBinary);
      invariant(identity(candidate.manifest) === identity(e.candidate) && !existsSync(join(item.config.stateDirectory, 'operational.sqlite')), 'Original candidate/state changed before attempt');
      const claim = { plan: options.plan, experiment: item.signed, caseId: item.caseId, attempt: item.attempt };
      options.store.claim(e.id, e.grantId, claim);
      const acquisitionEvidence: PublicAcquisitionEvidence = { claimBytes: 2 * Buffer.byteLength(canonicalJson({ manifest: claim, claimedAt: new Date().toISOString() })), packetFile: item.binding.packetFile, packetSha256: e.privatePacketDigest, privateRoot: item.binding.privateRoot, authorityPath: join(item.config.stateDirectory, 'authority.sqlite'), caseId: item.caseId, attempt: item.attempt, experimentId: e.id };
      await initializeResourceDelegation(item.config.resourceLimits!.cgroupRoot); assertResourceConfinement(item.config.workspaceDirectory, item.config.resourceLimits!);
      const state = new OperationalStore({ filename: join(item.config.stateDirectory, 'operational.sqlite'), checkoutRoot: item.config.applicationRoot });
      try { new ResourceLedger(state, { tokens: 0, costUsd: 0, elapsedMs: 0 }, () => Date.parse(e.issuedAt)).allocate('operating-envelope:v1', e.resources); } finally { state.close(); }
      let report: unknown;
      if (['S08', 'S09', 'S11', 'S12'].includes(item.caseId)) {
        const invocation: LifecycleLiveInvocation = { acquisitionKind: synthetic ? 'synthetic-host-composition' : 'live-public-screen', configuration: item.config, host: item.binding.host, secrets: privateSecrets(options.secrets), authority: item.binding.authority, authorityStore: item.binding.authorityStore, originalGrant: item.signed, transition: item.transition, acquisitionEvidenceBytes: e.maxEvidenceBytes - item.failureReserveBytes, acquisitionEvidence };
        liveLifecycleOptions.set(invocation, { grant: e, configuration: e.configurationDigest, synthetic });
        report = await runLifecycleCase(item.caseId as LifecycleCase, 'normal', join(item.binding.privateRoot, `public-${identity(e.id)}.json`), item.attempt, invocation);
      } else {
        const screenOptions: ScreenOptions = { application: { config: item.config, authorityStore: item.binding.authorityStore, authority: item.binding.authority, secrets: privateSecrets(options.secrets), performRequest: synthetic ? fixedSyntheticScreen(item.config, item.binding.authority.generation, { ...e, maxEvidenceBytes: e.maxEvidenceBytes - item.failureReserveBytes, auxiliary: acquisitionEvidence }) : publicScreenGateway(item.config, options.secrets, { ...e, maxEvidenceBytes: e.maxEvidenceBytes - item.failureReserveBytes, auxiliary: acquisitionEvidence }) }, caseId: item.caseId as ScreenCaseId, attempt: item.attempt, attemptId: e.id, mode: synthetic ? 'synthetic-host-composition' : 'live-public-screen', observer: { id: e.evaluatorId, evaluatorDigest: e.observerArtifactDigest, taskDigest: e.privatePacketDigest, privateRoot: item.binding.privateRoot }, manifest: { source: e.candidate.source, dependencies: e.candidate.dependencies, protocol: e.protocolDigest }, privatePacketPath: item.binding.packetFile, timeoutMs: Math.max(1, Date.parse(e.expiresAt) - Date.now()) };
        liveScreenOptions.set(screenOptions, { grant: e, configuration: e.configurationDigest, synthetic, gateway: screenOptions.application.performRequest }); report = await runScreenCase(screenOptions);
      }
      const result = report as { verdict: string; failure: string | null }; verdict = result.verdict; failure = result.failure;
      const retained = retainedOperationalEvidence(item.config.stateDirectory);
      const auxiliary = acquisitionAuxiliary(acquisitionEvidence, e.maxArtifactBytes);
      invariant(retained.maxArtifactBytes <= e.maxArtifactBytes, 'Required operational artifact exceeds original signed ceiling');
      const claimBytes = acquisitionEvidence.claimBytes;
      ref = retainPublicReport(options.store, JSON.parse(JSON.stringify({ originalGrant: item.signed, actualSource: prepared.observerArtifact, originalRetention: { operational: retained, auxiliary, claimBytes }, report })), e, retained.bytes + auxiliary.bytes + item.failureReserveBytes);
    } catch (error) {
      failure ??= error instanceof Error ? error.message : 'Public screen acquisition unavailable'; verdict = 'criterion-unmet';
      const failed = failureRecord(item.caseId, item.attempt, item.signed, prepared.observerArtifact, failure);
      invariant(Buffer.byteLength(canonicalJson(failed)) <= item.experiment.maxArtifactBytes && Buffer.byteLength(canonicalJson(failed)) <= item.experiment.maxEvidenceBytes, 'Original evidence ceiling cannot retain failure receipt');
      ref = options.store.put(failed);
    }
    reports.push({ caseId: item.caseId, attempt: item.attempt, report: ref, verdict, failure });
    if (synthetic && verdict !== 'case-pass') break;
  }
  const aggregate = { plan: options.plan, reports, independent: false, admissionEligible: false, evidenceKind: synthetic ? 'synthetic-host-composition' : 'host-authorized-public-screen', claims: { heldOut: false, Q3: 'unavailable', parity: 'unavailable', H1: 'unaccepted' } };
  invariant(Buffer.byteLength(canonicalJson(aggregate)) <= prepared.plan.maxPlanRecordBytes && Buffer.byteLength(canonicalJson(aggregate)) <= prepared.plan.maxPlanArtifactBytes, 'Aggregate reference record exceeds original metadata ceiling');
  return options.store.put(aggregate);
}
