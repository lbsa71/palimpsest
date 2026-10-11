import { closeSync, constants, fstatSync, mkdirSync, mkdtempSync, openSync, opendirSync, readFileSync, readSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { assertAuthority, canonicalJson, identity, invariant, validateEvaluation, type Authority, type DataScope, type EvaluationEvidence, type Goal, type InboundInput, type JsonValue, type Run } from '../packages/contracts/index.ts';
import { DevelopmentalMemory } from '../packages/development/index.ts';
import { hashBytes, type FrozenCandidate } from '../packages/release/artifacts.ts';
import { ChangeProposals, type ChangeProvenance, type ChangeRecord } from '../packages/release/proposals.ts';
import type { OperationalStore } from '../packages/storage/index.ts';
import type { ApplicationTool } from './application.ts';
import { freezeApplication, verifyApplication, type DeploymentInputs } from './candidate.ts';
import { rewriteSourceEntries } from './source-workspace.ts';
import { isHumanInput } from './input-origin.ts';

export interface EvolutionContext { runId: string; scope: DataScope; workspace: string; store: OperationalStore; authority: Authority }
/** Issued by accepted host bootstrap or a host wrapper observing genuinely autonomous goal creation, never from Goal.origin alone. */
export interface IndependentSelfOrigin { goalId: string; goalDefinition: string; basis: 'accepted-bootstrap' | 'independent-initiative'; originRunId?: string }
export function goalDefinitionIdentity(goal: Goal): string { return identity({ id: goal.id, origin: goal.origin, purpose: goal.purpose, scope: goal.scope, successCriteria: goal.successCriteria }); }
export interface EvaluationRequest { requestId: string; proposal: ChangeRecord; candidate: FrozenCandidate; policyDigest: string }
export interface EvaluationReceipt { requestId: string; candidateId: string; policyDigest: string; evidence: EvaluationEvidence[]; receipt: JsonValue }
export interface SubmissionRequest extends EvaluationRequest { evaluation: EvaluationReceipt }
export interface SubmissionReceipt { requestId: string; candidateId: string; status: 'admitted' | 'staged' | 'rejected'; receipt: JsonValue }
export interface EvolutionOptions {
  /** All options are host-installed, never supplied by a model tool argument. */
  artifactStore: string; acceptedCandidateId: string; nodeBinary: string; policyDigest: string;
  maxFiles: number; maxBytes: number; eligibleHumanAuthors: ReadonlySet<string>; allowedModelIds: ReadonlySet<string>;
  assertAuthority(authority: Authority): void;
  /** A trusted origin claim must match the admitted/steering input and, for self, the host initiative execution. */
  provenanceForRun(context: EvolutionContext): ChangeProvenance;
  /** These callbacks must enforce frozen external policy and idempotently reconcile requestId; no author credentials enter the workspace. */
  requestEvaluation(request: EvaluationRequest, signal?: AbortSignal): Promise<EvaluationReceipt>;
  submitRelease(request: SubmissionRequest, signal?: AbortSignal): Promise<SubmissionReceipt>;
}
const string = { type: 'string', minLength: 1, maxLength: 8192 };
function schema(properties: object, required: string[]): object { return { type: 'object', properties, required, additionalProperties: false }; }
function object(value: JsonValue, keys: string[]): Record<string, JsonValue> { invariant(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key)), 'Invalid evolution arguments'); return value; }
function text(value: JsonValue | undefined): string { invariant(typeof value === 'string' && value.trim().length > 0 && value.length <= 8192, 'Bounded nonempty text required'); return value; }
function strings(value: JsonValue | undefined, allowEmpty = false): string[] { invariant(Array.isArray(value) && value.length <= 32 && (allowEmpty || value.length > 0) && new Set(value).size === value.length, 'Unique bounded sources/criteria required'); return value.map(text); }
function outside(parent: string, child: string): boolean { const path = relative(parent, child); return path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path); }
/** Open every absolute ancestor through an already pinned descriptor; no symlink can be followed. */
function directory(path: string): number {
  invariant(isAbsolute(path) && !path.split('/').includes('..'), 'Canonical absolute host/workspace paths required');
  let fd = openSync('/', constants.O_RDONLY | constants.O_DIRECTORY);
  try { for (const part of path.split('/').filter(Boolean)) { const next = openSync(`/proc/self/fd/${fd}/${part}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); closeSync(fd); fd = next; } return fd; }
  catch (error) { closeSync(fd); throw error; }
}
function names(fd: number, max: number): string[] {
  const dir = opendirSync(`/proc/self/fd/${fd}`), result: string[] = [];
  try { let entry; while ((entry = dir.readSync())) { invariant(result.length < max, 'Directory exceeds candidate entry bounds'); result.push(entry.name); } return result; }
  finally { dir.closeSync(); }
}
interface SnapshotFile { path: string; sha256: string; executable: boolean }
interface Snapshot { files: SnapshotFile[]; bytes: number; entries: number }
/** A bounded, descriptor-pinned copy plus a second bounded inventory rejects changing content, hardlinks and special files. */
function snapshot(source: string, target: string, entries: readonly string[], limits: Pick<EvolutionOptions, 'maxFiles' | 'maxBytes'>, expected?: readonly SnapshotFile[]): Snapshot {
  const root = directory(source);
  const scan = (copy: boolean): Snapshot => {
    let count = 0, bytes = 0, visited = 0; const files: SnapshotFile[] = [];
    const visit = (parent: number, name: string, path: string): void => {
      invariant(++visited <= limits.maxFiles && path.split('/').length <= 64, 'Candidate exceeds entry/depth bounds');
      const fd = openSync(`/proc/self/fd/${parent}/${name}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const before = fstatSync(fd);
        if (before.isDirectory()) { for (const child of names(fd, limits.maxFiles - visited)) visit(fd, child, `${path}/${child}`); return; }
        invariant(before.isFile() && before.nlink === 1, 'Candidate requires regular singly linked files');
        invariant(++count <= limits.maxFiles && before.size <= limits.maxBytes - bytes, 'Candidate exceeds file/byte bounds');
        const buffer = Buffer.alloc(before.size); let offset = 0;
        while (offset < buffer.length) { const read = readSync(fd, buffer, offset, buffer.length - offset, offset); invariant(read > 0, 'Source changed during snapshot'); offset += read; }
        const extra = Buffer.alloc(1); invariant(readSync(fd, extra, 0, 1, offset) === 0, 'Source grew during snapshot');
        const after = fstatSync(fd); invariant(before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && after.nlink === 1, 'Source changed during snapshot');
        bytes += buffer.length; const file = { path, sha256: hashBytes(buffer), executable: !!(before.mode & 0o111) }; files.push(file);
        if (copy) { const destination = join(target, path); mkdirSync(dirname(destination), { recursive: true, mode: 0o700 }); writeFileSync(destination, buffer, { flag: 'wx', mode: file.executable ? 0o700 : 0o600 }); }
      } finally { closeSync(fd); }
    };
    for (const entry of entries) {
      invariant(entry && !isAbsolute(entry) && entry.split('/').every(part => part && part !== '.' && part !== '..'), 'Invalid host snapshot entry');
      const parts = entry.split('/'); let parent = root; const parents: number[] = [];
      try { for (const part of parts.slice(0, -1)) { parent = openSync(`/proc/self/fd/${parent}/${part}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); parents.push(parent); } visit(parent, parts.at(-1)!, entry); }
      finally { parents.reverse().forEach(closeSync); }
    }
    return { files: files.sort((a, b) => a.path.localeCompare(b.path, 'en')), bytes, entries: visited };
  };
  try { const first = scan(true); invariant(identity(first) === identity(scan(false)), 'Workspace changed while being frozen'); if (expected) invariant(identity(first.files) === identity(expected), 'Accepted toolchain changed'); return first; }
  finally { closeSync(root); }
}

function provenance(context: EvolutionContext, options: EvolutionOptions): ChangeProvenance {
  const bound = options.provenanceForRun(context);
  const inputs = context.store.events<InboundInput>(context.runId).filter(event => ['admitted', 'steering'].includes(event.type)).map(event => event.data);
  const input = inputs.find(input => input.id === bound.inputId);
  invariant(input?.authenticated && input.actorId === bound.actorId && identity(input.scope) === identity(context.scope), 'Proposal requires host-authenticated run provenance');
  if (bound.kind === 'human') invariant(isHumanInput(input) && options.eligibleHumanAuthors.has(input.actorId) && inputs.filter(isHumanInput).every(input => input.authenticated && options.eligibleHumanAuthors.has(input.actorId)), 'Human modification author is not configured eligible');
  else {
    // An adopted run retains its original authenticated actor while the serving grant changes.
    invariant(input.source === 'initiative' && input.externalId === bound.goalId && !inputs.some(isHumanInput), 'Self proposal cannot relabel a human request or steering input');
    const execution = context.store.get<{ runId: string }>('initiative.execution', bound.goalId)?.value;
    const goal = context.store.get<Goal>('initiative.goals', bound.goalId)?.value;
    invariant(execution?.runId === context.runId && goal?.origin.kind === 'self' && ['ready', 'running', 'waiting'].includes(goal.status) && identity(goal.scope) === identity(context.scope), 'Self proposal requires its independently originated finite initiative goal');
    const origin = context.store.get<IndependentSelfOrigin>('host.release-self-origins', bound.goalId)?.value;
    invariant(origin?.goalId === bound.goalId && origin.goalDefinition === goalDefinitionIdentity(goal) && ['accepted-bootstrap', 'independent-initiative'].includes(origin.basis), 'Self proposal needs a trusted independent goal-origin attestation; goal body origin is insufficient');
    if (origin.basis === 'independent-initiative') {
      invariant(origin.originRunId, 'Independent origin run required');
      const originalInputs = context.store.events<InboundInput>(origin.originRunId).filter(event => ['admitted', 'steering'].includes(event.type)).map(event => event.data);
      invariant(originalInputs.some(input => input.authenticated && input.source === 'initiative') && !originalInputs.some(isHumanInput), 'Human originating run cannot supply independent goal provenance');
    }
  }
  return structuredClone(bound);
}

function frozenInputs(staging: string, accepted: FrozenCandidate, options: EvolutionOptions, createdBy: string): DeploymentInputs {
  const configuration = structuredClone(accepted.inputs.configuration) as unknown as DeploymentInputs['configuration'];
  // Optional source-owned settings contain actual proposed model/configuration, never host paths or policy.
  const deployment = directory(join(staging, 'deployment')); let deploymentNames: string[]; try { deploymentNames = names(deployment, options.maxFiles); } finally { closeSync(deployment); }
  if (deploymentNames.includes('candidate-settings.json')) {
    const settings = JSON.parse(readFileSync(join(staging, 'deployment/candidate-settings.json'), 'utf8')) as JsonValue;
    const parsed = object(settings, ['configuration']); invariant(parsed.configuration && typeof parsed.configuration === 'object' && !Array.isArray(parsed.configuration), 'Candidate configuration required');
    const proposed = parsed.configuration as unknown as DeploymentInputs['configuration'];
    const { model: priorModel, pollMs: priorPoll, ...priorGrants } = configuration;
    const { model: nextModel, pollMs: nextPoll, ...nextGrants } = proposed;
    invariant(identity(priorGrants) === identity(nextGrants), 'Candidate settings cannot alter host grants, policy or resource allowances');
    invariant(options.allowedModelIds.has(nextModel?.id) && Number.isSafeInteger(nextPoll) && nextPoll >= 100, 'Unqualified model or polling configuration');
    invariant(typeof nextModel.reasoning === 'boolean' && ['none', 'high'].includes(nextModel.effort) && (nextModel.effort !== 'high' || nextModel.reasoning), 'Invalid proposed model profile');
    for (const field of ['contextWindow', 'maxOutputTokens', 'maxRequestsPerSlice', 'timeoutMs'] as const) invariant(Number.isSafeInteger(nextModel[field]) && nextModel[field] > 0 && nextModel[field] <= priorModel[field], 'Candidate model exceeds accepted request bounds');
    invariant(identity(Object.keys(nextModel).sort()) === identity(Object.keys(priorModel).sort()) && identity(nextModel.pricesPerMillion) === identity(priorModel.pricesPerMillion), 'Model descriptor/host prices changed');
    Object.assign(configuration, proposed);
  }
  const controls = accepted.inputs.controls as unknown as { runtime: DeploymentInputs['runtime']; policy: JsonValue };
  return { configuration, prompts: { mind: readFileSync(join(staging, 'deployment/prompts/mind.md'), 'utf8'), compaction: readFileSync(join(staging, 'deployment/prompts/compaction.md'), 'utf8') }, runtime: controls.runtime, policy: controls.policy, createdBy };
}

/** Install through ApplicationOptions.additionalTools. Author workspaces never receive store paths, policy keys or activation authority. */
export function evolutionTools(context: EvolutionContext, options: EvolutionOptions): ApplicationTool[] {
  const bound = { ...context, scope: structuredClone(context.scope), authority: structuredClone(context.authority) };
  const proposals = new ChangeProposals(bound.store, bound.runId, bound.scope);
  const allowed = (signal?: AbortSignal): void => {
    options.assertAuthority(bound.authority); signal?.throwIfAborted();
    const run = bound.store.get<Run>('runs', bound.runId)?.value;
    invariant(run && !['cancelled', 'completed'].includes(run.status) && identity(run.scope) === identity(bound.scope), 'Run no longer authorized'); assertAuthority(run.authority, bound.authority);
  };
  const idArgs = (args: JsonValue): string => text(object(args, ['changeId']).changeId);
  const requestId = (proposal: ChangeRecord, action: string): string => {
    invariant(proposal.candidate, 'Candidate has not been frozen');
    invariant(proposal.judgingPolicyDigest === options.policyDigest, 'Frozen judging policy changed; reconcile using the original host policy');
    return identity({ change: proposals.key(proposal.id), candidate: proposal.candidate.id, action, policy: proposal.judgingPolicyDigest });
  };
  const validateReceipt = (receipt: EvaluationReceipt, proposal: ChangeRecord): void => {
    invariant(receipt.requestId === requestId(proposal, 'evaluate') && receipt.candidateId === proposal.candidate!.id && receipt.policyDigest === proposal.judgingPolicyDigest && receipt.evidence.length > 0, 'External evaluator returned a mismatched receipt');
    receipt.evidence.forEach(evidence => { validateEvaluation(evidence); invariant(evidence.candidateId === receipt.candidateId && evidence.controlRevision === proposal.authority.controlRevision && evidence.independent && evidence.evaluatorId !== proposal.candidate!.createdBy, 'Author/self or mismatched evaluator evidence rejected'); });
  };
  const request = (proposal: ChangeRecord, action: string): EvaluationRequest => {
    invariant(proposal.candidate, 'Candidate has not been frozen'); assertAuthority(proposal.authority, bound.authority);
    const id = requestId(proposal, action);
    invariant(identity(provenance(bound, options)) === identity(proposal.provenance), 'Proposal trusted provenance changed');
    const candidate = verifyApplication(options.artifactStore, proposal.candidate.id, options.nodeBinary);
    invariant(identity(candidate.manifest) === identity(proposal.candidate), 'Proposal manifest changed');
    const { evaluation, submission, ...frozenProposal } = proposal;
    return { requestId: id, proposal: { ...frozenProposal, state: 'frozen' }, candidate, policyDigest: proposal.judgingPolicyDigest! };
  };
  return [{ name: 'change_propose', description: 'Record a justified finite source change proposal with visible experience evidence. Origin and human eligibility come from authenticated host provenance; workspace edits confer no production authority.',
    inputSchema: schema({ changeId: string, justification: string, objective: string, successCriteria: { type: 'array', items: string, minItems: 1, maxItems: 32 }, experienceIds: { type: 'array', items: string, maxItems: 32 } }, ['changeId', 'justification', 'objective', 'successCriteria', 'experienceIds']),
    execute(args, signal) {
      allowed(signal); const a = object(args, ['changeId', 'justification', 'objective', 'successCriteria', 'experienceIds']); const origin = provenance(bound, options);
      const sources = strings(a.experienceIds, origin.kind === 'human'); const memory = new DevelopmentalMemory(bound.store);
      const experience = sources.map(id => { const record = memory.get(id, bound.scope); invariant(record, 'Experience unavailable to proposal scope'); return record; });
      return proposals.create({ id: text(a.changeId), runId: bound.runId, scope: bound.scope, authority: bound.authority, provenance: origin, justification: text(a.justification), goal: { objective: text(a.objective), successCriteria: strings(a.successCriteria) }, experience: proposals.artifact(experience), state: 'proposed' });
    },
  }, { name: 'candidate_freeze', description: 'Freeze this proposal’s source workspace and accepted compiler closure into a host-private immutable whole-application candidate. Actual prompt and proposed model/configuration bytes bind the manifest; no release is activated.', inputSchema: schema({ changeId: string }, ['changeId']),
    execute(args, signal) {
      allowed(signal); const id = idArgs(args), proposal = proposals.get(id); assertAuthority(proposal.authority, bound.authority);
      invariant(identity(provenance(bound, options)) === identity(proposal.provenance), 'Proposal trusted provenance changed');
      if (proposal.candidate) { request(proposal, 'verify'); return proposal; }
      invariant(proposal.state === 'proposed', 'Proposal cannot be frozen in this state');
      invariant(Number.isSafeInteger(options.maxFiles) && options.maxFiles > 0 && Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0, 'Finite snapshot bounds required');
      mkdirSync(options.artifactStore, { recursive: true, mode: 0o700 }); const store = realpathSync(options.artifactStore), workspace = realpathSync(bound.workspace);
      const fd = directory(options.artifactStore); closeSync(fd); invariant(outside(workspace, store) && outside(store, workspace) && outside(workspace, bound.store.filename), 'Host artifacts/state must be outside candidate workspace');
      const accepted = verifyApplication(store, options.acceptedCandidateId, options.nodeBinary); const acceptedRoot = join(store, accepted.manifest.id, 'payload');
      const staging = mkdtempSync(join(store, '.evolution-'));
      try {
        // Only explicit source roots are eligible; model-added node_modules and dist are ignored.
        const root = directory(bound.workspace); let rootNames: string[]; try { rootNames = names(root, options.maxFiles); } finally { closeSync(root); }
        const entries = rewriteSourceEntries.filter(entry => rootNames.includes(entry.split('/')[0]!));
        const source = snapshot(bound.workspace, staging, entries, options);
        const toolchain = accepted.files.filter(file => file.path.startsWith('node_modules/'));
        snapshot(acceptedRoot, staging, ['node_modules'], { maxFiles: options.maxFiles - source.entries, maxBytes: options.maxBytes - source.bytes }, toolchain);
        const inputs = frozenInputs(staging, accepted, options, bound.authority.generation);
        const candidate = freezeApplication(staging, store, inputs); allowed(signal);
        return proposals.transition(id, 'proposed', 'frozen', { candidate: candidate.manifest, judgingPolicyDigest: options.policyDigest });
      } finally { rmSync(staging, { recursive: true, force: true }); }
    },
  }, { name: 'candidate_evaluate', description: 'Request evaluation of the exact frozen candidate from the external host evaluator under previously accepted frozen policy. Author tests and model text cannot supply independent evidence.', inputSchema: schema({ changeId: string }, ['changeId']),
    async execute(args, signal) {
      allowed(signal); const id = idArgs(args), proposal = proposals.get(id);
      if (proposal.evaluation) return proposal;
      invariant(['frozen', 'evaluation-dispatched'].includes(proposal.state), 'Freeze before external evaluation');
      const req = request(proposal, 'evaluate'); if (proposal.state === 'frozen') proposals.transition(id, 'frozen', 'evaluation-dispatched');
      try {
        const receipt = await options.requestEvaluation(req, signal);
        validateReceipt(receipt, proposal);
        allowed(signal); return proposals.transition(id, 'evaluation-dispatched', 'evaluated', { evaluation: proposals.artifact(receipt) });
      } catch (cause) { throw Object.assign(new Error(`External evaluation unresolved; reconcile durable request ID: ${cause instanceof Error ? cause.message : 'invalid host result'}`, { cause }), { mayHaveApplied: true }); }
    },
  }, { name: 'release_submit', description: 'Submit this exact candidate and externally issued evaluation receipt to the admitted host release controller. The host decides rejection, ordinary admission or separately staged control upgrade; this tool grants no new authority.', inputSchema: schema({ changeId: string }, ['changeId']),
    async execute(args, signal) {
      allowed(signal); const id = idArgs(args), proposal = proposals.get(id); if (proposal.submission) return proposal;
      invariant(proposal.evaluation && ['evaluated', 'submission-dispatched'].includes(proposal.state), 'External evaluation required before submission');
      const evaluation = bound.store.readJsonArtifact<EvaluationReceipt>(proposal.evaluation);
      validateReceipt(evaluation, proposal);
      invariant(evaluation.evidence.every(evidence => evidence.verdict === 'pass'), 'Failed or inconclusive evaluation cannot be submitted');
      const req: SubmissionRequest = { ...request(proposal, 'submit'), evaluation }; if (proposal.state === 'evaluated') proposals.transition(id, 'evaluated', 'submission-dispatched');
      try {
        const receipt = await options.submitRelease(req, signal);
        invariant(receipt.requestId === req.requestId && receipt.candidateId === req.candidate.manifest.id && ['admitted', 'staged', 'rejected'].includes(receipt.status), 'Host returned a mismatched release receipt');
        // Transfer may withdraw this run's authority; retain the trusted receipt even after withdrawal.
        return proposals.transition(id, 'submission-dispatched', 'submitted', { submission: proposals.artifact(receipt) });
      } catch (cause) { throw Object.assign(new Error(`Release submission unresolved; reconcile durable host request ID: ${cause instanceof Error ? cause.message : 'invalid host result'}`, { cause }), { mayHaveApplied: true }); }
    },
  }, { name: 'change_status', description: 'Read this run’s durable change proposal, immutable candidate, and host evaluation/submission receipts, including unresolved dispatched operations.', inputSchema: schema({ changeId: string }, ['changeId']),
    execute(args, signal) { allowed(signal); const proposal = proposals.get(idArgs(args)); return { proposal, evaluation: proposal.evaluation ? bound.store.readJsonArtifact(proposal.evaluation) : null, submission: proposal.submission ? bound.store.readJsonArtifact(proposal.submission) : null }; },
  }];
}
