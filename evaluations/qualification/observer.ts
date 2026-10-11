import { closeSync, constants, existsSync, fstatSync, openSync, readFileSync, readSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, identity, invariant, validateEvaluation, validatePhysicalRequest, type ArtifactRef, type Authority, type EvaluationEvidence, type PhysicalRequest, type ResourceUsage } from '../../packages/contracts/index.ts';
import { inventoryCandidateSource, hashBytes } from '../../packages/release/artifacts.ts';
import { admissionPolicyIdentity, signEvaluation, type AdmissionPolicy, type SignedEvaluation } from '../../packages/release/admission.ts';
import { OperationalStore } from '../../packages/storage/index.ts';
import { ResourceLedger } from '../../packages/runtime/index.ts';
import type { AuthorityStore } from '../../packages/supervisor/authority.ts';
import { runConfined, type CommandReceipt } from '../../packages/supervisor/confinement.ts';
import { assertPrivateHostDirectory, readHostFile } from '../../deployment/host-policy.ts';
import { verifyApplication } from '../../deployment/candidate.ts';
import { materializeConfiguration, type HostBindings } from '../../deployment/materialize.ts';
import type { ApplicationSecrets } from '../../deployment/config.ts';
import type { ApplicationOptions } from '../../deployment/application.ts';
import { assertPrivateRoot, runApplicationCase, type CaseObservation, type EvaluationResult } from '../product/adapter.ts';
import { authenticate, inertSnapshot, signDocument, verifyExperiment, verifyPacket, type Experiment, type PrivatePacket, type Signed } from './manifest.ts';
import { QualificationStore } from './store.ts';

const ownRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export interface QualificationTrust {
  /** Configured outside candidate source/state. No key or profile is inferred from a signature. */
  issuerKeys: ReadonlyMap<string, Uint8Array>;
  policy: AdmissionPolicy;
  observerArtifact: ArtifactRef;
  /** External qualification identifies specific objective cases and private packet bytes. */
  objectiveCases: ReadonlyMap<string, string>;
  protocolDigest: string;
  calibrationPlans: ReadonlySet<string>;
}
export interface ObservationBundle {
  version: 1; experiment: Signed<Experiment>; kind: Experiment['kind'];
  startedAt: string; endedAt: string; observerArtifact: ArtifactRef;
  configurationJson: string | null;
  originalAdapterReport: ArtifactRef; observation: ArtifactRef; privatePacket: ArtifactRef;
  artifacts: { path: string; artifact: ArtifactRef }[];
  commands: { id: string; requestId: string; artifact: ArtifactRef }[];
  assessment: EvaluationResult | null; failure: string | null;
  ledger: { envelope: unknown; startedAt: number; requests: PhysicalRequest[]; cancelled: boolean } | null;
}
export interface ObserverReceipt { bundle: ArtifactRef; authentication: Signed<{ bundle: ArtifactRef; kind: Experiment['kind']; experimentDigest: string }> }

/** Pins actual imported source closure, data prompts and runtime; no caller-supplied implementation digest. */
export function observerImplementation(): { artifact: ArtifactRef; bytes: Buffer } {
  const files = inventoryCandidateSource(ownRoot, ['packages', 'deployment', 'evaluations/product', 'evaluations/qualification', 'package.json', 'package-lock.json']);
  const bytes = Buffer.from(canonicalJson({ version: 1, files, node: hashBytes(readFileSync(process.execPath)), nodeVersion: process.version }));
  const sha256 = hashBytes(bytes); return { artifact: { uri: `sha256:${sha256}`, sha256 }, bytes };
}
/** The adapter imports host code in this process. A candidate image alone cannot authenticate those imports. */
export function verifyInvokedHost(candidateFiles: { path: string; sha256: string; executable: boolean }[], implementationBytes: Uint8Array): void {
  const actual = JSON.parse(Buffer.from(implementationBytes).toString('utf8')) as { files: { path: string; sha256: string; executable: boolean }[] };
  const hostFile = (path: string) => path.startsWith('packages/') || path.startsWith('deployment/') || ['package.json', 'package-lock.json'].includes(path);
  invariant(identity(actual.files.filter(file => hostFile(file.path))) === identity(candidateFiles.filter(file => hostFile(file.path))), 'Imported host/application closure differs from frozen candidate; changed-host qualification needs a separate frozen-service observer');
}
export function checkTrust(e: Experiment, trust: QualificationTrust): void {
  invariant(trust.policy.policyDigest === admissionPolicyIdentity(trust.policy) && e.priorPolicyDigest === trust.policy.policyDigest && e.candidate.controls === trust.policy.controlRevision, 'Experiment differs from accepted prior judging controls');
  invariant(trust.policy.evaluatorArtifacts.get(e.evaluatorId) === trust.observerArtifact.sha256 && e.observerArtifactDigest === trust.observerArtifact.sha256 && trust.policy.evaluatorKeys.has(e.evaluatorId), 'Observer is not the externally qualified evaluator');
  invariant(e.evaluatorId !== e.candidate.createdBy && trust.protocolDigest === e.protocolDigest && trust.calibrationPlans.has(e.calibrationPlanDigest), 'Independent observer/protocol/calibration trust missing');
}
function seal(store: QualificationStore, bundle: ObservationBundle, trust: QualificationTrust): ObserverReceipt {
  invariant(Buffer.byteLength(canonicalJson(bundle)) <= bundle.experiment.value.maxEvidenceBytes, 'Observation bundle exceeds signed byte ceiling');
  const ref = store.put(bundle), e = bundle.experiment.value;
  return { bundle: ref, authentication: signDocument('aeon.qualification.observation.v1', { bundle: ref, kind: bundle.kind, experimentDigest: identity(e) }, e.evaluatorId, trust.policy.evaluatorKeys.get(e.evaluatorId)!) };
}
/** Never follow a candidate symlink or hardlink when retaining evaluator inputs. */
export function readObjectiveArtifact(workspace: string, path: string, maxBytes: number): string {
  invariant(path.length > 0 && path.split('/').every(part => part && part !== '.' && part !== '..') && !path.includes('\\'), 'Relative objective artifact required');
  invariant(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 1_000_000, 'Finite objective artifact limit required');
  let fd = openSync(workspace, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const parts = path.split('/');
    for (let i = 0; i < parts.length; i++) { const next = openSync(`/proc/self/fd/${fd}/${parts[i]}`, constants.O_RDONLY | constants.O_NOFOLLOW | (i < parts.length - 1 ? constants.O_DIRECTORY : constants.O_NONBLOCK)); closeSync(fd); fd = next; }
    const before = fstatSync(fd, { bigint: true }); invariant(before.isFile() && before.nlink === 1n && before.size <= BigInt(maxBytes), 'Objective artifact must be a bounded unlinked regular file');
    const bytes = Buffer.alloc(Number(before.size)); let offset = 0;
    while (offset < bytes.length) { const count = readSync(fd, bytes, offset, bytes.length - offset, offset); invariant(count > 0, 'Objective artifact changed'); offset += count; }
    const after = fstatSync(fd, { bigint: true });
    invariant(readSync(fd, Buffer.alloc(1), 0, 1, bytes.length) === 0 && before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs && after.nlink === 1n, 'Objective artifact changed');
    const text = bytes.toString('utf8'); invariant(Buffer.from(text).equals(bytes), 'Objective artifact must be UTF-8 text'); return text;
  } finally { closeSync(fd); }
}
export function assessObjectiveArtifacts(packet: PrivatePacket, observation: Pick<CaseObservation, 'readArtifact'>, commands: ReadonlyMap<string, CommandReceipt>, limit: number, retain: (path: string, content: string) => void): EvaluationResult {
  let bytes = 0;
  const checks = packet.checks.map(check => {
    try {
      const content = observation.readArtifact(check.path); bytes += Buffer.byteLength(content);
      invariant(Buffer.byteLength(content) <= limit && bytes <= limit, 'Objective artifact bytes exceed allowance');
      retain(check.path, content);
      const command = commands.get(check.id);
      const passed = check.kind === 'file-equals' ? content === check.expected : check.kind === 'file-json' ? canonicalJson(JSON.parse(content)) === canonicalJson(check.expected) : command !== undefined && !command.stoppedFor && command.exitCode === check.expected.exitCode && command.stdout === check.expected.stdout;
      return { id: check.id, passed, evidence: identity({ path: check.path, contentSha256: hashBytes(content), expectedDigest: identity(check.expected), command: command ?? null }) };
    } catch (error) { return { id: check.id, passed: false, evidence: identity({ path: check.path, failure: error instanceof Error ? error.message : 'Artifact check unavailable' }) }; }
  });
  return { quality: checks.every(c => c.passed) ? 3 : 0, checks };
}
export interface LiveOptions {
  experiment: Signed<Experiment>; trust: QualificationTrust; store: QualificationStore;
  packetFile: string; privateRoot: string; host: HostBindings;
  authorityStore: AuthorityStore; authority: Authority; secrets: ApplicationSecrets;
}
/** Host entrypoint. No caller-provided transport, evaluator callback or candidate JS executes on the host. */
export async function observeLive(options: LiveOptions): Promise<ObserverReceipt> {
  return observeApplication(options);
}
/** Same frozen candidate/host ledger path, explicitly synthetic and permanently ineligible. */
export async function observeSynthetic(options: LiveOptions, performRequest: NonNullable<ApplicationOptions['performRequest']>): Promise<ObserverReceipt> {
  invariant(typeof performRequest === 'function', 'Explicit synthetic provider required');
  return observeApplication(options, performRequest);
}
async function observeApplication(options: LiveOptions, performRequest?: NonNullable<ApplicationOptions['performRequest']>): Promise<ObserverReceipt> {
  const { trust, store } = options;
  const signedExperiment = inertSnapshot(options.experiment);
  const e = verifyExperiment(signedExperiment, trust.issuerKeys); checkTrust(e, trust);
  invariant(performRequest ? e.kind === 'integration' : e.kind === 'live-product' && trust.policy.kind === 'product', 'Live observation requires an external product experiment; synthetic transport requires integration');
  const implementation = observerImplementation();
  invariant(implementation.artifact.sha256 === trust.observerArtifact.sha256, 'Executing observer implementation differs from qualified bytes');
  assertPrivateHostDirectory(options.privateRoot);
  assertPrivateRoot(options.privateRoot, [options.host.artifactStore, options.host.workspaceDirectory, options.host.stateDirectory, '/usr']);
  assertPrivateRoot(store.directory, [options.host.artifactStore, options.host.workspaceDirectory, options.host.stateDirectory, '/usr']);
  invariant(realpathSync(options.packetFile).startsWith(`${realpathSync(options.privateRoot)}/`), 'Private packet must remain in private root');
  const packetBytes = readHostFile(options.packetFile, e.maxEvidenceBytes), packet = verifyPacket(packetBytes, e);
  invariant(trust.objectiveCases.get(packet.task.id) === e.privatePacketDigest, 'Private objective case is not externally qualified');
  const candidate = verifyApplication(options.host.artifactStore, e.candidate.id, options.host.nodeBinary);
  invariant(identity(candidate.manifest) === identity(e.candidate), 'Frozen candidate differs from experiment');
  verifyInvokedHost(candidate.files, implementation.bytes);
  const config = materializeConfiguration(candidate, options.host);
  invariant(hashBytes(readFileSync(config.nodeBinary)) === hashBytes(readFileSync(process.execPath)), 'Actual observer/application runtime differs from candidate runtime');
  const configurationJson = JSON.stringify(config);
  invariant(identity(JSON.parse(configurationJson)) === e.configurationDigest && identity(config.resources) === identity(e.resources), 'Actual configuration/operating ledger differs from signed grant');
  invariant((performRequest || config.resourceLimits) && !config.slack && config.direct.port === 0 && config.bootstrapInitiative === false, 'Qualified case needs kernel enforcement, isolated direct surface and no unrelated developmental dispatch');
  options.authorityStore.assert(options.authority);
  invariant(options.authority.controlRevision === e.candidate.controls && options.authorityStore.current()?.artifactId === e.candidate.id, 'Qualification invocation lacks exact host-issued candidate authority');
  const filename = join(config.stateDirectory, 'operational.sqlite');
  invariant(!existsSync(filename), 'Qualification needs fresh state; original grant cannot be reset or resumed');
  store.claim(e.id, e.grantId, signedExperiment);
  const startedAt = new Date().toISOString(), artifacts: ObservationBundle['artifacts'] = [], commands: ObservationBundle['commands'] = [];
  let written = 0;
  const retain = (value: unknown): ArtifactRef => { const length = Buffer.byteLength(canonicalJson(value)); written += length; invariant(written <= e.maxEvidenceBytes, 'Experiment evidence allowance exhausted'); return store.put(value); };
  const implementationValue = JSON.parse(implementation.bytes.toString('utf8'));
  const observerArtifact = store.put(implementationValue);
  const privatePacket = retain(packet);
  let report: Awaited<ReturnType<typeof runApplicationCase>> | null = null, observation: unknown = null, assessment: EvaluationResult | null = null, failure: string | null = null;
  let ledger: ObservationBundle['ledger'] = null;
  try {
    // Allocate at the signed original start, not at process restart or first request.
    const initial = new OperationalStore({ filename, checkoutRoot: config.applicationRoot });
    try { new ResourceLedger(initial, { tokens: 0, costUsd: 0, elapsedMs: 0 }, () => Date.parse(e.issuedAt)).allocate('operating-envelope:v1', e.resources); }
    finally { initial.close(); }
    const remaining = Math.min(Date.parse(e.expiresAt) - Date.now(), e.resources.maxElapsedMs);
    invariant(remaining > 0, 'Original grant expired before invocation');
    report = await runApplicationCase({ application: { config, secrets: options.secrets, authority: options.authority, authorityStore: options.authorityStore, ...(performRequest ? { performRequest } : {}) },
      task: packet.task, mode: e.kind, observer: { id: e.evaluatorId, privateRoot: options.privateRoot, evaluatorDigest: e.observerArtifactDigest, taskDigest: e.privatePacketDigest },
      manifest: { source: e.candidate.source, dependencies: e.candidate.dependencies, protocol: e.protocolDigest }, timeoutMs: remaining,
      ...(e.kind === 'live-product' ? { liveSeal: { grantId: e.grantId, calibrationDigest: e.calibrationPlanDigest, isolationReceipt: identity(config.resourceLimits) } } : {}),
      evaluate: async value => {
        const { readArtifact: _reader, ...actual } = value; observation = actual;
        const safeObservation = { readArtifact: (path: string) => readObjectiveArtifact(value.workspace, path, e.maxArtifactBytes) };
        const commandResults = new Map<string, CommandReceipt>();
        const state = new OperationalStore({ filename, checkoutRoot: config.applicationRoot });
        const resources = new ResourceLedger(state, { tokens: 0, costUsd: 0, elapsedMs: 0 });
        try {
          const runId = `qualification-checks:${e.id}`;
          resources.allocate(runId, e.resources, 'operating-envelope:v1');
          for (const check of packet.checks) if (check.kind === 'node-command') {
            options.authorityStore.assert(options.authority);
            const requestId = `${runId}:${check.id}`;
            let request: PhysicalRequest = { id: requestId, runId, purpose: 'review', provider: 'qualification-command', model: 'none', promptManifestId: `private-check:${e.privatePacketDigest}`, requestDigest: identity(check), reservationId: requestId, status: 'reserved', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: check.timeoutMs } };
            resources.reserve(request);
            request = { ...request, status: 'dispatched' }; resources.dispatched(request);
            const started = performance.now();
            try {
              const sourceBefore = safeObservation.readArtifact(check.path);
              const result = await runConfined({ workspace: value.workspace, protectedPaths: [options.privateRoot, store.directory, config.stateDirectory, config.applicationRoot], nodeBinary: config.nodeBinary, executable: '/runtime/node', args: [check.path, ...check.args], timeoutMs: check.timeoutMs, maxOutputBytes: 65536, resourceLimits: config.resourceLimits, signal: AbortSignal.timeout(Math.max(1, Date.parse(e.expiresAt) - Date.now())) });
              resources.settle({ ...request, status: 'succeeded', usage: { ...request.usage, elapsedMs: performance.now() - started } });
              const recorded = JSON.parse(JSON.stringify(result)) as CommandReceipt;
              commands.push({ id: check.id, requestId, artifact: retain(recorded) }); commandResults.set(check.id, recorded);
              invariant(safeObservation.readArtifact(check.path) === sourceBefore, 'Candidate changed its tested source during private verification');
            } catch (error) {
              if (resources.request(requestId)?.status === 'dispatched') resources.settle({ ...request, status: 'uncertain', usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: performance.now() - started } }); throw error;
            }
          }
        } finally { state.close(); }
        assessment = assessObjectiveArtifacts(packet, safeObservation, commandResults, e.maxArtifactBytes, (path, content) => { artifacts.push({ path, artifact: retain({ content }) }); });
        return assessment;
      } });
    failure = report.failure;
    observation ??= report.observation;
  } catch (error) { failure = error instanceof Error ? error.message : 'Qualification invocation failed'; }
  finally {
    if (existsSync(filename)) {
      const state = new OperationalStore({ filename, checkoutRoot: config.applicationRoot });
      try {
        const allocation = state.get<{ envelope: unknown; startedAt: number }>('allocations', 'operating-envelope:v1');
        if (allocation) {
          new ResourceLedger(state, { tokens: 0, costUsd: 0, elapsedMs: 0 }).cancel('operating-envelope:v1');
          ledger = { envelope: allocation.value.envelope, startedAt: allocation.value.startedAt, requests: state.list<{ request: PhysicalRequest }>('requests').map(row => row.value.request), cancelled: true };
        }
      } finally { state.close(); }
    }
  }
  const endedAt = new Date().toISOString();
  if (Date.parse(endedAt) > Date.parse(e.expiresAt)) failure ??= 'Original experiment deadline exceeded';
  return seal(store, { version: 1, experiment: signedExperiment, kind: e.kind, startedAt, endedAt, observerArtifact, configurationJson,
    originalAdapterReport: retain(JSON.parse(JSON.stringify(report))), observation: retain(JSON.parse(JSON.stringify(observation))), privatePacket, artifacts, commands, assessment, failure, ledger }, trust);
}

/** Engineering input has a separate entry and permanently synthetic provenance. It grants no execution. */
export function recordSynthetic(experiment: Signed<Experiment>, trust: QualificationTrust, store: QualificationStore, originalReport: unknown): ObserverReceipt {
  experiment = inertSnapshot(experiment); originalReport = inertSnapshot(originalReport);
  const e = verifyExperiment(experiment, trust.issuerKeys); checkTrust(e, trust); invariant(e.kind === 'integration', 'Synthetic records cannot use a live manifest');
  store.claim(e.id, e.grantId, experiment);
  const now = new Date().toISOString(), absent = store.put(null);
  return seal(store, { version: 1, experiment, kind: 'integration', startedAt: now, endedAt: now, observerArtifact: trust.observerArtifact, configurationJson: null,
    originalAdapterReport: store.put(originalReport), observation: absent, privatePacket: absent, artifacts: [], commands: [], assessment: null, failure: 'Synthetic observation is ineligible for live qualification', ledger: null }, trust);
}

/** Conversion of this observer's live objective evidence only. No parity, subjective or H1 promotion. */
export function toReleaseEvidence(receipt: ObserverReceipt, trust: QualificationTrust, store: QualificationStore): SignedEvaluation {
  receipt = inertSnapshot(receipt);
  const auth = authenticate('aeon.qualification.observation.v1', receipt.authentication, trust.policy.evaluatorKeys);
  invariant(identity(auth.bundle) === identity(receipt.bundle), 'Observation receipt binding changed');
  const bundle = JSON.parse(store.readArtifact(receipt.bundle).toString('utf8')) as ObservationBundle;
  const e = verifyExperiment(bundle.experiment, trust.issuerKeys, Date.parse(bundle.startedAt)); checkTrust(e, trust);
  invariant(auth.experimentDigest === identity(e) && receipt.authentication.signer === e.evaluatorId, 'Observation experiment/signer mismatch');
  invariant(bundle.kind === 'live-product' && e.kind === 'live-product' && auth.kind === 'live-product' && trust.policy.kind === 'product', 'Synthetic/author evidence cannot become live admission evidence');
  invariant(!bundle.failure && bundle.assessment?.quality === 3 && bundle.assessment.checks.length > 0 && bundle.assessment.checks.every(check => check.passed), 'Unavailable or failed evidence cannot pass');
  invariant(bundle.observerArtifact.sha256 === trust.observerArtifact.sha256, 'Observer implementation artifact changed');
  store.readArtifact(bundle.observerArtifact);
  const packet = verifyPacket(store.readArtifact(bundle.privatePacket), e);
  invariant(trust.objectiveCases.get(packet.task.id) === e.privatePacketDigest && trust.policy.requiredCases.includes(packet.task.id), 'Objective case lacks prior-policy qualification');
  const report = JSON.parse(store.readArtifact(bundle.originalAdapterReport).toString('utf8')) as Awaited<ReturnType<typeof runApplicationCase>>;
  invariant(report?.independent === false && report.admissionEligible === false && report.evidenceKind === 'live-product' && report.transportFixtures === null && report.verdict === 'case-pass', 'Original author adapter provenance/result changed');
  invariant(bundle.configurationJson && identity(JSON.parse(bundle.configurationJson)) === e.configurationDigest, 'Exact invoked configuration differs from canonical grant');
  invariant(report.taskId === packet.task.id && report.observerId === e.evaluatorId && report.identities.source === e.candidate.source && report.identities.dependencies === e.candidate.dependencies && report.identities.protocol === e.protocolDigest && report.identities.configuration === hashBytes(bundle.configurationJson) && report.identities.evaluator === e.observerArtifactDigest && report.identities.task === e.privatePacketDigest && identity(report.candidateModel) === e.candidate.model, 'Adapter invocation does not bind the experiment');
  invariant(report.observation?.status === 'completed' && report.observation.physicalRequests.some(r => r.provider !== 'effect-receiver'), 'Live physical invocation is missing');
  invariant(bundle.ledger?.cancelled && identity(bundle.ledger.envelope) === identity(e.resources) && bundle.ledger.startedAt === Date.parse(e.issuedAt), 'Actual ledger does not preserve original finite grant');
  invariant(Date.parse(bundle.startedAt) >= Date.parse(e.issuedAt) && Date.parse(bundle.endedAt) <= Date.parse(e.expiresAt) && Date.parse(bundle.endedAt) >= Date.parse(bundle.startedAt), 'Observation outside original grant');
  const requests = bundle.ledger.requests;
  invariant(bundle.commands.every(c => requests.some(r => r.id === c.requestId)) && requests.filter(r => r.provider === 'qualification-command').length === bundle.commands.length, 'Verifier request inventory lacks exact receipts');
  invariant(requests.length > 0 && new Set(requests.map(r => r.id)).size === requests.length && identity(requests.filter(r => r.provider !== 'qualification-command')) === identity(report.observation.physicalRequests), 'Observed physical request inventory differs from actual ledger');
  requests.forEach(validatePhysicalRequest);
  invariant(requests.every(r => ['succeeded', 'failed'].includes(r.status) && r.usage.inputTokens !== null && r.usage.outputTokens !== null && r.usage.costUsd !== null), 'Unknown physical outcomes cannot qualify');
  const artifactMap = new Map(bundle.artifacts.map(item => [item.path, JSON.parse(store.readArtifact(item.artifact).toString('utf8')).content as string]));
  invariant(bundle.commands.length === packet.checks.filter(c => c.kind === 'node-command').length && new Set(bundle.commands.map(c => c.id)).size === bundle.commands.length, 'Private command evidence incomplete');
  const commandResults = new Map(bundle.commands.map(command => {
    const check = packet.checks.find(c => c.id === command.id), request = requests.find(r => r.id === command.requestId);
    invariant(check?.kind === 'node-command' && request?.provider === 'qualification-command' && request.requestDigest === identity(check), 'Private command receipt differs from actual dispatch');
    return [command.id, JSON.parse(store.readArtifact(command.artifact).toString('utf8')) as CommandReceipt] as const;
  }));
  const assessment = assessObjectiveArtifacts(packet, { readArtifact: path => { const text = artifactMap.get(path); invariant(text !== undefined, 'Retained objective artifact missing'); return text; } }, commandResults, e.maxArtifactBytes, () => undefined);
  invariant(assessment.quality === 3 && identity(assessment) === identity(bundle.assessment) && identity(report.assessment) === identity(assessment), 'Retained private outcome verification differs');
  // Match the operating ledger: parallel work consumes aggregate physical time too.
  const elapsedMs = Math.max(Date.parse(bundle.endedAt) - Date.parse(e.issuedAt), requests.reduce((sum, r) => sum + r.usage.elapsedMs, 0));
  const usage: ResourceUsage = { requests: requests.length, inputTokens: requests.reduce((sum, r) => sum + r.usage.inputTokens!, 0), outputTokens: requests.reduce((sum, r) => sum + r.usage.outputTokens!, 0), costUsd: requests.reduce((sum, r) => sum + r.usage.costUsd!, 0), elapsedMs };
  invariant(usage.requests <= e.resources.maxRequests && usage.inputTokens! + usage.outputTokens! <= e.resources.maxTokens && usage.costUsd! <= e.resources.maxCostUsd && usage.elapsedMs <= e.resources.maxElapsedMs, 'Measured original grant exceeded');
  const evidence: EvaluationEvidence = { id: `qualified-objective:${receipt.bundle.sha256}`, candidateId: e.candidate.id, controlRevision: trust.policy.controlRevision, evaluatorId: e.evaluatorId, evaluatorArtifact: bundle.observerArtifact, independent: true, verdict: 'pass', artifact: receipt.bundle,
    caseResults: [{ id: packet.task.id, status: 'pass', observations: bundle.observation, usage, interventions: [] }] };
  invariant(identity(JSON.parse(store.readArtifact(bundle.observation).toString('utf8'))) === identity(report.observation), 'Retained observation differs from actual adapter observation');
  validateEvaluation(evidence);
  return signEvaluation(evidence, trust.policy.evaluatorKeys.get(e.evaluatorId)!, trust.policy.policyDigest);
}

export interface DevelopmentWitness { experimentDigest: string; boundary: 'restart' | 'context-reduction' | 'later-retrieval' | 'autonomous-cycle'; observedAt: string; stateDigest: string; eventArtifact: ArtifactRef }
/** Authentication preserves an external witness; it is not proof of elapsed development or judgment. */
export function retainDevelopmentWitness(document: Signed<DevelopmentWitness>, keys: ReadonlyMap<string, Uint8Array>, store: QualificationStore): { status: 'externally-witnessed-unqualified'; artifact: ArtifactRef } {
  const witness = authenticate('aeon.qualification.development-witness.v1', document, keys);
  invariant(['restart', 'context-reduction', 'later-retrieval', 'autonomous-cycle'].includes(witness.boundary) && Number.isFinite(Date.parse(witness.observedAt)) && Date.parse(witness.observedAt) <= Date.now(), 'Invalid external boundary witness');
  invariant(/^[a-f0-9]{64}$/.test(witness.experimentDigest) && /^[a-f0-9]{64}$/.test(witness.stateDigest), 'Exact witness state/experiment required');
  store.readArtifact(witness.eventArtifact);
  return { status: 'externally-witnessed-unqualified', artifact: store.put(document) };
}
