import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, identity, invariant, validateEvaluation, type ArtifactRef, type EvaluationEvidence, type JsonValue, type PhysicalRequest, type ResourceUsage } from '../packages/contracts/index.ts';
import { admissionPolicyIdentity, signEvaluation, type AdmissionPolicy } from '../packages/release/admission.ts';
import { hashBytes, type FrozenCandidate } from '../packages/release/artifacts.ts';
import { runConfined, type CommandReceipt, type ConfinedCommand } from '../packages/supervisor/confinement.ts';
import { candidateNodeBinary, verifyApplication } from './candidate.ts';
import { reviewerDescriptor, type ReviewerFile, type ReviewResponse } from './evaluation-dispatch.ts';
import { accountedReview, assertReviewLineage, reviewOperationId, type ReviewResourceOptions } from './evaluation-resources.ts';
import type { EvaluationRequest } from './evolution-tools.ts';
import { readHostFile } from './host-policy.ts';
import { hostResourceLedger } from './host-resources.ts';
import { materializeConfiguration, type HostBindings } from './materialize.ts';
import { validateModelProfile, type ModelProfile } from './model-grants.ts';

export const engineeringPlanMount = '/reviewer/engineering-plan.json';
export const engineeringCases = ['engineering-build', 'independent-source-review'] as const;
const ownRoot = dirname(dirname(fileURLToPath(import.meta.url)));
export interface EngineeringExecutionControls { candidateId: string; controls: string; source: string }
/** The executing accepted host, rather than a candidate's proposed implementation,
 * supplies the reviewer machinery. Independently accepted control succession may
 * replace it without changing the inherited sealed review plan. */
export function assertEngineeringExecutionControls(host: HostBindings, controlRevision: string): EngineeringExecutionControls {
  const root = realpathSync(ownRoot), store = realpathSync(host.artifactStore), id = basename(dirname(root));
  invariant(root === ownRoot && /^[a-f0-9]{64}$/.test(id) && root === join(store, id, 'payload'),
    'Engineering review must execute from an exact frozen host payload');
  const frozen = verifyApplication(store, id, host.nodeBinary);
  invariant(frozen.manifest.controls === controlRevision, 'Executing engineering host differs from the prior accepted controls');
  const runtime = (frozen.inputs.controls as unknown as { runtime: { nodeSha256: string; nodeVersion: string; platform: string; arch: string } }).runtime;
  invariant(runtime.nodeSha256 === hashBytes(readFileSync(process.execPath)) && runtime.nodeVersion === process.version &&
    runtime.platform === process.platform && runtime.arch === process.arch, 'Engineering reviewer running runtime differs from its accepted closure');
  return { candidateId: frozen.manifest.id, controls: frozen.manifest.controls, source: frozen.manifest.source };
}
export interface EngineeringReviewEnvironment {
  readHostFile(path: string, maxBytes: number): Buffer;
  instructions(): string;
  assertExecutionControls(host: HostBindings, controlRevision: string): EngineeringExecutionControls;
  verifyApplication: typeof verifyApplication;
  resourceLimits: (candidate: FrozenCandidate, host: HostBindings) => ReturnType<typeof materializeConfiguration>['resourceLimits'];
  makeWorkspace(root: string): string;
  copySource(source: string, workspace: string): void;
  removeWorkspace(workspace: string): void;
}
/** Production composition; tests can replace every filesystem/command boundary. */
export function nodeEngineeringReviewEnvironment(): EngineeringReviewEnvironment {
  return { readHostFile, instructions: () => readFileSync(join(ownRoot, 'evaluations/engineering-review/instructions.md'), 'utf8'),
    assertExecutionControls: assertEngineeringExecutionControls, verifyApplication, resourceLimits: (candidate, host) => materializeConfiguration(candidate, host).resourceLimits,
    makeWorkspace: root => mkdtempSync(join(root, 'engineering-build-')),
    copySource: (source, workspace) => cpSync(source, workspace, { recursive: true, errorOnExist: true, force: false }),
    removeWorkspace: workspace => rmSync(workspace, { recursive: true, force: true }) };
}
export interface EngineeringPlan {
  version: 1; model: ModelProfile; instructions: string;
  maxChangedFiles: number; maxDiffBytes: number; maxResponseBytes: number; buildTimeoutMs: number;
}
export function createEngineeringPlan(model: ModelProfile, environment = nodeEngineeringReviewEnvironment()): EngineeringPlan {
  const plan: EngineeringPlan = { version: 1, model: structuredClone(model),
    instructions: environment.instructions(),
    maxChangedFiles: 32, maxDiffBytes: 196608, maxResponseBytes: 65536, buildTimeoutMs: 30000 };
  return parseEngineeringPlan(Buffer.from(canonicalJson(plan)));
}
const exact = (value: unknown, fields: string[]) => invariant(value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...fields].sort().join(','), 'Exact engineering reviewer fields required');
export function parseEngineeringPlan(bytes: Uint8Array): EngineeringPlan {
  invariant(bytes.byteLength <= 65536, 'Engineering plan exceeds byte bound');
  const text = Buffer.from(bytes).toString('utf8'), plan = JSON.parse(text) as EngineeringPlan;
  invariant(canonicalJson(plan) === text, 'Canonical inert engineering plan required');
  exact(plan, ['version', 'model', 'instructions', 'maxChangedFiles', 'maxDiffBytes', 'maxResponseBytes', 'buildTimeoutMs']);
  invariant(plan.version === 1, 'Supported engineering plan required');
  validateModelProfile(plan.model);
  invariant((plan.model.provider ?? 'mistral') === 'mistral' && plan.model.timeoutMs <= 60000 && plan.model.maxOutputTokens <= 8192,
    'Bounded fixed Mistral engineering reviewer profile required');
  invariant(typeof plan.instructions === 'string' && plan.instructions.length > 0 && Buffer.byteLength(plan.instructions) <= 16384, 'Bounded independent review instructions required');
  for (const [field, max] of [['maxChangedFiles', 64], ['maxDiffBytes', 524288], ['maxResponseBytes', 262144], ['buildTimeoutMs', 60000]] as const)
    invariant(Number.isSafeInteger(plan[field]) && plan[field] > 0 && plan[field] <= max, 'Finite engineering review bounds required');
  return plan;
}
export function loadEngineeringPlan(config: ReviewerFile, environment = nodeEngineeringReviewEnvironment()): { plan: EngineeringPlan; digest: string } | undefined {
  const file = config.files.find(file => file.mount === engineeringPlanMount); if (!file) return undefined;
  const bytes = environment.readHostFile(file.path, 65536); invariant(hashBytes(bytes) === file.sha256, 'Engineering plan differs from accepted reviewer closure');
  const plan = parseEngineeringPlan(bytes);
  return { plan, digest: file.sha256 };
}
export interface EngineeringReviewOptions extends ReviewResourceOptions {
  prepared?: boolean;
  environment?: EngineeringReviewEnvironment;
  performRequest(payload: string, signal: AbortSignal): Promise<{ status: number; body: string }>;
  timeoutSignal(timeoutMs: number): AbortSignal;
  runCommand?: (command: ConfinedCommand) => Promise<CommandReceipt>;
}
interface SourceChange { path: string; before: string | null; after: string | null; beforeSha256: string | null; afterSha256: string | null;
  beforeExecutable: boolean | null; afterExecutable: boolean | null }
interface InputChange { field: 'configuration' | 'prompts' | 'model' | 'dependencies' | 'controls'; path: string;
  beforePresent: boolean; afterPresent: boolean; before: JsonValue; after: JsonValue;
  arraySplice?: { index: number; beforeLength: number; afterLength: number } }
function sourceChanges(host: HostBindings, accepted: FrozenCandidate, candidate: FrozenCandidate, plan: EngineeringPlan, environment: EngineeringReviewEnvironment): { changes: SourceChange[]; inputChanges: InputChange[] } {
  const before = new Map(accepted.files.map(file => [file.path, file])), after = new Map(candidate.files.map(file => [file.path, file]));
  const paths = [...new Set([...before.keys(), ...after.keys()])].filter(path =>
    before.get(path)?.sha256 !== after.get(path)?.sha256 || before.get(path)?.executable !== after.get(path)?.executable).sort();
  const inputChanges: InputChange[] = []; let bytes = 2;
  const record = (change: InputChange): void => { bytes += Buffer.byteLength(canonicalJson(change)) + 1;
    invariant(bytes <= plan.maxDiffBytes, 'Exact deployment input changes exceed the source review byte bound'); inputChanges.push(change); };
  const pointer = (key: string) => key.replaceAll('~', '~0').replaceAll('/', '~1');
  const object = (value: JsonValue): value is { [key: string]: JsonValue } => value !== null && typeof value === 'object' && !Array.isArray(value);
  const difference = (field: InputChange['field'], path: string, before: JsonValue, after: JsonValue, beforePresent = true, afterPresent = true): void => {
    if (beforePresent && afterPresent && identity(before) === identity(after)) return;
    if (beforePresent && afterPresent && object(before) && object(after)) {
      for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort())
        difference(field, `${path}/${pointer(key)}`, Object.hasOwn(before, key) ? before[key]! : null, Object.hasOwn(after, key) ? after[key]! : null,
          Object.hasOwn(before, key), Object.hasOwn(after, key));
      return;
    }
    if (beforePresent && afterPresent && Array.isArray(before) && Array.isArray(after)) {
      if (before.length !== after.length) {
        let prefix = 0, suffix = 0;
        while (prefix < Math.min(before.length, after.length) && identity(before[prefix]!) === identity(after[prefix]!)) prefix++;
        while (suffix < Math.min(before.length, after.length) - prefix && identity(before[before.length - 1 - suffix]!) === identity(after[after.length - 1 - suffix]!)) suffix++;
        record({ field, path, beforePresent, afterPresent, before: before.slice(prefix, before.length - suffix), after: after.slice(prefix, after.length - suffix),
          arraySplice: { index: prefix, beforeLength: before.length, afterLength: after.length } });
        return;
      }
      for (let index = 0; index < Math.max(before.length, after.length); index++)
        difference(field, `${path}/${index}`, index < before.length ? before[index]! : null, index < after.length ? after[index]! : null,
          index < before.length, index < after.length);
      return;
    }
    record({ field, path, beforePresent, afterPresent, before, after });
  };
  for (const field of ['configuration', 'prompts', 'model', 'dependencies', 'controls'] as const)
    difference(field, `/${field}`, accepted.inputs[field], candidate.inputs[field]);
  invariant(paths.length <= plan.maxChangedFiles && (paths.length > 0 || inputChanges.length > 0), 'Source review refuses an empty or oversized change set');
  const read = (id: string, path: string, digest?: string): string | null => {
    if (!digest) return null;
    const content = environment.readHostFile(join(host.artifactStore, id, 'payload', path), plan.maxDiffBytes - bytes);
    bytes += content.length; invariant(bytes <= plan.maxDiffBytes && hashBytes(content) === digest, 'Exact complete bounded source diff required');
    invariant(!content.includes(0), 'Source review refuses changed binary files');
    return new TextDecoder('utf-8', { fatal: true }).decode(content);
  };
  const changes = paths.map(path => ({ path, before: read(accepted.manifest.id, path, before.get(path)?.sha256), after: read(candidate.manifest.id, path, after.get(path)?.sha256),
    beforeSha256: before.get(path)?.sha256 ?? null, afterSha256: after.get(path)?.sha256 ?? null,
    beforeExecutable: before.get(path)?.executable ?? null, afterExecutable: after.get(path)?.executable ?? null }));
  invariant(Buffer.byteLength(canonicalJson({ changes, inputChanges })) <= plan.maxDiffBytes, 'Exact source and deployment input changes exceed the shared review byte bound');
  return { changes, inputChanges };
}
interface SourceVerdict { requestId: string; candidateId: string; policyDigest: string; verdict: 'pass' | 'fail' | 'refuse'; reason: string; findings: string[] }
function sourceVerdict(value: unknown, request: EvaluationRequest): SourceVerdict {
  exact(value, ['requestId', 'candidateId', 'policyDigest', 'verdict', 'reason', 'findings']); const verdict = value as SourceVerdict;
  invariant(verdict.requestId === request.requestId && verdict.candidateId === request.candidate.manifest.id && verdict.policyDigest === request.policyDigest,
    'Independent review response belongs to another request, policy or candidate');
  invariant(['pass', 'fail', 'refuse'].includes(verdict.verdict) && typeof verdict.reason === 'string' && verdict.reason.trim().length > 0 && verdict.reason.length <= 16384 &&
    Array.isArray(verdict.findings) && verdict.findings.length <= 32 && verdict.findings.every(f => typeof f === 'string' && f.trim().length > 0 && f.length <= 8192) &&
    (verdict.verdict !== 'pass' || verdict.findings.length === 0), 'Complete defensible independent review verdict required'); return verdict;
}

/** Accepted host code reviews inert exact source. Only the sibling compiler sees candidate files;
 * neither candidate commands nor candidate imports run in the signer/provider process. */
export async function runEngineeringReview(config: ReviewerFile, host: HostBindings, request: EvaluationRequest,
  policy: AdmissionPolicy, acceptedCandidateId: string, options: EngineeringReviewOptions): Promise<ReviewResponse> {
  const environment = options.environment ?? nodeEngineeringReviewEnvironment();
  const loaded = loadEngineeringPlan(config, environment); invariant(loaded, 'Accepted engineering review plan unavailable');
  const { plan } = loaded, descriptor = Buffer.from(reviewerDescriptor(config)), descriptorDigest = hashBytes(descriptor);
  invariant(policy.kind === 'engineering' && identity([...policy.requiredCases].sort()) === identity([...engineeringCases].sort()), 'Engineering reviewer cannot qualify other or product cases');
  invariant(policy.policyDigest === request.policyDigest && admissionPolicyIdentity(policy) === request.policyDigest && policy.controlRevision === request.proposal.authority.controlRevision &&
    policy.evaluatorArtifacts.get(config.evaluatorId) === descriptorDigest && options.evaluatorDigest === descriptorDigest && options.evaluatorId === config.evaluatorId && options.request === request,
    'Engineering review requires the exact prior policy and resource context');
  const execution = environment.assertExecutionControls(host, policy.controlRevision);
  const assertExecution = () => invariant(identity(environment.assertExecutionControls(host, policy.controlRevision)) === identity(execution),
    'Accepted engineering execution identity changed during review');
  let closureBytes = 0;
  for (const file of config.files) { const bytes = environment.readHostFile(file.path, config.maxClosureBytes - closureBytes); closureBytes += bytes.length;
    invariant(hashBytes(bytes) === file.sha256, 'Engineering reviewer closure changed'); }
  const key = environment.readHostFile(config.keyFile, 65536); invariant(hashBytes(key) === hashBytes(policy.evaluatorKeys.get(config.evaluatorId) ?? new Uint8Array()), 'Engineering reviewer key differs from prior policy');
  invariant(config.evaluatorId !== request.proposal.authority.generation && config.evaluatorId !== request.candidate.manifest.createdBy, 'Author cannot independently review itself');
  const candidate = environment.verifyApplication(host.artifactStore, request.candidate.manifest.id, host.nodeBinary), accepted = environment.verifyApplication(host.artifactStore, acceptedCandidateId, host.nodeBinary);
  invariant(identity(candidate) === identity(request.candidate), 'Engineering request differs from exact frozen candidate');
  const authority = options.physicalAuthority ?? request.proposal.authority;
  const live = () => { options.signal?.throwIfAborted(); options.assertAuthority(authority); assertReviewLineage(options.store, request, options.now, authority, options.resourceLedger); };
  live();
  const artifacts = new Map<string, Buffer>();
  const artifact = (value: string | Uint8Array | object): ArtifactRef => { const bytes = typeof value === 'string' ? Buffer.from(value) : value instanceof Uint8Array ? Buffer.from(value) : Buffer.from(canonicalJson(value));
    const sha256 = hashBytes(bytes); artifacts.set(sha256, bytes); return { uri: `sha256:${sha256}`, sha256 }; };
  artifact(descriptor);
  let changes: SourceChange[] = [], inputChanges: InputChange[] = [], refusal: string | undefined;
  try { ({ changes, inputChanges } = sourceChanges(host, accepted, candidate, plan, environment)); } catch (error) { refusal = error instanceof Error ? error.message : String(error); }
  const workspace = environment.makeWorkspace(host.workspaceDirectory);
  let command: CommandReceipt;
  try {
    environment.copySource(join(host.artifactStore, candidate.manifest.id, 'payload'), workspace);
    command = await accountedReview(options, async gate => {
      let pending: Promise<CommandReceipt> | undefined;
      gate.dispatch(() => { assertExecution(); pending = (options.runCommand ?? runConfined)({ workspace,
        applicationRoot: join(host.artifactStore, accepted.manifest.id, 'payload'), nodeBinary: candidateNodeBinary(accepted, host.artifactStore, host.nodeBinary),
        protectedPaths: [host.stateDirectory, config.keyFile, ...config.files.map(file => file.path)], executable: '/runtime/node',
        args: ['/app/node_modules/typescript/bin/tsc', '--project', '/work/tsconfig.json', '--typeRoots', '/app/node_modules/@types', '--noEmit'],
        timeoutMs: Math.min(plan.buildTimeoutMs, config.maxElapsedMs), maxOutputBytes: Math.min(config.maxOutputBytes, 262144), signal: gate.signal,
        resourceLimits: environment.resourceLimits(accepted, host) }); });
      invariant(pending, 'Engineering compiler was not physically dispatched'); return pending;
    });
  } finally { environment.removeWorkspace(workspace); }
  command = JSON.parse(JSON.stringify(command)) as CommandReceipt;
  // Accepted compiler bytes are mounted read-only separately from the candidate source copy.
  const buildPhysical = hostResourceLedger(options.store, { tokens: 0, costUsd: 0, elapsedMs: 0 }, options).request(reviewOperationId(options));
  invariant(buildPhysical?.status === 'succeeded', 'Original engineering compiler receipt unavailable');
  const buildPassed = command.exitCode === 0 && command.signal === null && command.stoppedFor === undefined;
  const buildObservation = artifact({ requestId: request.requestId, candidateId: candidate.manifest.id, policyDigest: policy.policyDigest,
    planDigest: loaded.digest, execution, command: JSON.parse(JSON.stringify(command)), physical: buildPhysical });
  let verdict: SourceVerdict = { requestId: request.requestId, candidateId: candidate.manifest.id, policyDigest: policy.policyDigest, verdict: 'refuse',
    reason: refusal ?? 'The accepted compiler failed; independent source review was not requested.', findings: [] };
  let modelUsage: ResourceUsage = { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 }, sourceObservation: ArtifactRef;
  if (buildPassed && !refusal) {
    const input = { requestId: request.requestId, candidateId: candidate.manifest.id, policyDigest: policy.policyDigest, acceptedCandidateId,
      proposal: request.proposal, changes, inputChanges, engineeringEvidence: { command, physical: buildPhysical }, qualification: 'Bounded engineering/source review; no product or H1 qualification.' };
    const payload = JSON.stringify({ model: plan.model.id, messages: [{ role: 'system', content: plan.instructions }, { role: 'user', content: canonicalJson(input) }],
      max_tokens: plan.model.maxOutputTokens, temperature: 0, ...(plan.model.reasoning ? { reasoning_effort: plan.model.effort } : {}) });
    const inputTokens = Buffer.byteLength(payload), outputTokens = plan.model.maxOutputTokens;
    invariant(inputTokens + outputTokens <= plan.model.contextWindow, 'Independent review input exceeds conservatively bounded model context');
    const maxCost = (inputTokens * plan.model.pricesPerMillion.input + outputTokens * plan.model.pricesPerMillion.output) / 1_000_000;
    const ledger = hostResourceLedger(options.store, { tokens: inputTokens + outputTokens, costUsd: maxCost, elapsedMs: plan.model.timeoutMs }, options), now = options.now ?? ledger.now;
    const promptArtifact = options.store.putArtifact(payload), id = `engineering-model:${request.requestId}`;
    const physical: PhysicalRequest = { id, runId: request.proposal.runId, purpose: 'review', provider: 'mistral', model: plan.model.id,
      promptManifestId: `engineering-review:${loaded.digest}`, requestDigest: promptArtifact.sha256, reservationId: id, status: 'reserved',
      usage: { requests: 1, inputTokens, outputTokens, costUsd: maxCost, elapsedMs: plan.model.timeoutMs } };
    let dispatched = false, terminal = false, settled = false, received: { status: number; body: string } | undefined; const started = now();
    let trustedUsage: ResourceUsage | undefined;
    const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), options.timeoutSignal(plan.model.timeoutMs)]);
    options.store.put('host.engineering-prompts', id, { requestId: request.requestId, prompt: promptArtifact, scope: request.proposal.scope, model: plan.model }, null);
    try {
      let pending: ReturnType<EngineeringReviewOptions['performRequest']> | undefined;
      options.dispatchAuthority(authority, () => options.store.transaction(() => { live(); signal.throwIfAborted(); ledger.reserve(physical); }));
      // Commit uncertain financial exposure before the authority-locked transport launch.
      ledger.dispatched({ ...physical, status: 'dispatched' }); dispatched = true;
      options.dispatchAuthority(authority, () => options.store.transaction(() => { live(); signal.throwIfAborted(); assertExecution(); pending = options.performRequest(payload, signal); }));
      invariant(pending, 'Independent source review was not physically dispatched');
      try { received = await pending; } finally { terminal = true; }
      const responseArtifact = options.store.putArtifact(received.body);
      options.store.put('host.engineering-responses', id, { requestId: request.requestId, httpStatus: received.status, response: responseArtifact, scope: request.proposal.scope }, null);
      invariant(Buffer.byteLength(received.body) <= plan.maxResponseBytes, 'Independent review response exceeds accepted bound');
      const body = JSON.parse(received.body);
      invariant(received.status >= 200 && received.status < 300 && body.model === plan.model.id &&
        (body.usage?.service_tier === undefined || body.usage.service_tier === 'standard'), 'Unknown HTTP/model/tier outcome in independent review');
      const promptTokens = body.usage?.prompt_tokens, completionTokens = body.usage?.completion_tokens;
      const known = Number.isSafeInteger(promptTokens) && promptTokens >= 0 && Number.isSafeInteger(completionTokens) && completionTokens >= 0;
      modelUsage = { requests: 1, inputTokens: known ? promptTokens : null, outputTokens: known ? completionTokens : null,
        costUsd: known ? (promptTokens * plan.model.pricesPerMillion.input + completionTokens * plan.model.pricesPerMillion.output) / 1_000_000 : null,
        elapsedMs: Math.max(0, now() - started) };
      trustedUsage = modelUsage;
      invariant(body.choices?.length === 1 && body.choices[0].finish_reason === 'stop' && typeof body.choices[0].message?.content === 'string', 'Independent reviewer did not finish a complete verdict');
      verdict = sourceVerdict(JSON.parse(body.choices[0].message.content), request);
      ledger.settle({ ...physical, status: 'succeeded', usage: modelUsage }); settled = true; live(); signal.throwIfAborted();
      sourceObservation = artifact({ requestId: request.requestId, candidateId: candidate.manifest.id, policyDigest: policy.policyDigest,
        prompt: artifact(payload), response: artifact(received.body), verdict, physical: ledger.request(id) });
    } catch (error) {
      if (!settled && ledger.request(id)) ledger.settle({ ...physical, status: dispatched ? 'uncertain' : 'failed',
        usage: trustedUsage ?? (dispatched ? { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: Math.max(plan.model.timeoutMs, now() - started) } : { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 }) });
      throw error;
    } finally { if (dispatched && terminal) ledger.releaseConcurrency(id, { kind: 'transport-terminal', reason: 'Independent reviewer transport returned; no provider process remains active' }); }
  } else sourceObservation = artifact({ requestId: request.requestId, candidateId: candidate.manifest.id, policyDigest: policy.policyDigest, verdict, modelRequested: false });
  live(); invariant(identity(loadEngineeringPlan(config, environment)) === identity(loaded), 'Accepted engineering plan changed during review');
  const evidence: EvaluationEvidence = { id: `engineering:${request.requestId}`, candidateId: candidate.manifest.id, controlRevision: policy.controlRevision,
    evaluatorId: config.evaluatorId, evaluatorArtifact: artifact(descriptor), independent: true,
    verdict: !buildPassed || verdict.verdict === 'fail' ? 'fail' : verdict.verdict === 'pass' ? 'pass' : 'inconclusive',
    artifact: artifact({ requestId: request.requestId, candidateId: candidate.manifest.id, policyDigest: policy.policyDigest, planDigest: loaded.digest,
      execution, changedFiles: changes.map(change => change.path), changedInputs: [...new Set(inputChanges.map(change => change.field))], build: buildObservation, sourceReview: sourceObservation, verdict }),
    caseResults: [{ id: engineeringCases[0], status: buildPassed ? 'pass' : 'fail', observations: buildObservation, usage: buildPhysical.usage,
      interventions: ['Accepted compiler in a sibling namespace; candidate has no reviewer key or provider credentials.'] },
    { id: engineeringCases[1], status: verdict.verdict === 'pass' ? 'pass' : verdict.verdict === 'fail' ? 'fail' : 'unavailable', observations: sourceObservation, usage: modelUsage,
      interventions: ['Fresh independent model context reviews exact source; bounded engineering evidence only, no product/H1 qualification.'] }] };
  validateEvaluation(evidence);
  const recovery = artifact(environment.readHostFile(join(host.artifactStore, acceptedCandidateId, 'candidate.json'), config.maxOutputBytes));
  const receipt = { requestId: request.requestId, candidateId: candidate.manifest.id, policyDigest: policy.policyDigest, evidence: [evidence], receipt: { kind: 'engineering-source-review', verdict: verdict.verdict } };
  invariant([...artifacts.values()].reduce((sum, bytes) => sum + bytes.length, 0) <= config.maxOutputBytes, 'Engineering review evidence exceeds output bound');
  let signed: ReturnType<typeof signEvaluation> | undefined;
  options.dispatchAuthority(authority, () => { live(); assertExecution(); signed = signEvaluation(evidence, key, policy.policyDigest); });
  invariant(signed, 'Live authority must issue the independent review signature');
  const proof = { proposal: { id: request.requestId, candidate: candidate.manifest, priorAuthority: request.proposal.authority, evidence: [evidence], recoveryArtifact: recovery }, signed: [signed] };
  return { result: { receipt, proof }, artifacts: [...artifacts].map(([sha256, bytes]) => ({ sha256, base64: bytes.toString('base64') })) };
}
