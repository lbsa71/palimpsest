import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { freezeApplication, deploymentEntries, verifyApplication, type DeploymentInputs } from '../../deployment/candidate.ts';
import { materializeConfiguration } from '../../deployment/materialize.ts';
import type { ApplicationConfig } from '../../deployment/config.ts';
import { identity, invariant, type Authority, type ArtifactRef, type EvaluationEvidence, type ReleaseProposal } from '../../packages/contracts/index.ts';
import { admitCandidate, admissionPolicyIdentity, signEvaluation, type AdmissionPolicy } from '../../packages/release/admission.ts';
import { policyDescriptor } from '../../packages/release/controller.ts';
import { hashBytes } from '../../packages/release/artifacts.ts';
import { ResourceLedger } from '../../packages/runtime/index.ts';
import { OperationalStore } from '../../packages/storage/index.ts';
import { AuthorityStore } from '../../packages/supervisor/authority.ts';
import { artifactReader, hash } from './adapter.ts';
import { fixtureConfiguration } from './fixture.ts';
import { configureLifecycle, currentPrompt, oldPrompt, compactionPrompt, lifecycleCases, lifecycleEnvelope, lifecycleWorkload, type LifecycleCase, type LifecycleControl } from './lifecycle-fixtures.ts';

const repository = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const lifecycleVersion = 'A1-L02-L08-public-lifecycle-engineering-v1';
export const lifecycleControlChecks = Object.freeze({ 'no-process-restart': 'actual-stopped-process-reopened', 'short-history': 'ordinary-threshold-compaction-manifest', 'duplicate-delivery': 'exactly-one-real-delivery-no-replay', 'retained-old-profile': 'current-owned-layer-across-resumed-plain-child' });
const namespaces = ['allocations', 'budgets', 'requests', 'runs', 'execution', 'observations', 'effects', 'prompts', 'host-transport', 'host.run-grants', 'host.child-runs', 'delegations', 'communications.direct-outbox', 'screen.lifecycle-attempts', 'screen.lifecycle-reconciliation', 'screen.lifecycle-provider-responses'] as const;
type Rows = { key: string; revision: number; value: any }[];
export interface Snapshot { at: string; documents: Record<string, Rows>; events: any[]; artifacts: { ref: ArtifactRef; bytes: number; content: string }[]; files: Record<string, Record<string, string>>; ledger: ReturnType<ResourceLedger['snapshot']>; hostObservation?: { readerProcess: ProcessIdentity | null; servingProcess: ProcessIdentity | null; authority: any } }
export interface ProcessIdentity { pid: number; start: string; state: string }
export interface ProcessReceipt { identity: ProcessIdentity; artifactId: string; spawnedAt: string; ready: any; descendantsAtStop: ProcessIdentity[]; requestedStop: 'SIGKILL' | 'graceful' | null; exitedAt: string | null; exitCode: number | null; exitSignal: string | null; predecessorGone: boolean; stderr: string }
export interface LifecycleWitness { caseId: LifecycleCase; runId: string; initial: Snapshot; boundary: Snapshot | null; final: Snapshot; processes: ProcessReceipt[]; receiver: { deliveries: any[]; calls: any[] } | null; transition: any; plainOldRun: string | null; plainCurrentRun: string | null }
export function processIdentity(pid: number): ProcessIdentity | null {
  try { const stat = readFileSync(`/proc/${pid}/stat`, 'utf8'), fields = stat.slice(stat.lastIndexOf(')') + 2).split(' '); return { pid, start: fields[19]!, state: fields[0]! }; } catch { return null; }
}
function processTree(parent: number): ProcessIdentity[] {
  const rows = readdirSync('/proc').filter(name => /^\d+$/.test(name)).flatMap(name => { try { const stat = readFileSync(`/proc/${name}/stat`, 'utf8'), fields = stat.slice(stat.lastIndexOf(')') + 2).split(' '); return [{ pid: Number(name), state: fields[0]!, start: fields[19]!, parent: Number(fields[1]) }]; } catch { return []; } });
  const children = (pid: number): typeof rows => rows.filter(row => row.parent === pid).flatMap(row => [row, ...children(row.pid)]);
  return children(parent).map(({ parent: _, ...row }) => row);
}
function gone(value: ProcessIdentity) { const current = processIdentity(value.pid); return !current || current.start !== value.start || ['Z', 'X'].includes(current.state); }
export function captureLifecycle(stateDirectory: string, servingPid?: number): Snapshot {
  const state = new OperationalStore({ filename: join(stateDirectory, 'operational.sqlite') });
  try {
    const documents = Object.fromEntries(namespaces.map(namespace => [namespace, state.list(namespace)])) as Record<string, Rows>;
    const events = state.events(); invariant(events.length <= 2000 && documents.requests!.length <= 180 && documents.runs!.length <= 8, 'Lifecycle record bounds exceeded');
    const artifacts = new Map<string, Snapshot['artifacts'][number]>(); let artifactBytes = 0;
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if ('uri' in value && 'sha256' in value && typeof value.uri === 'string' && value.uri.startsWith('aeon:artifact:')) {
        const ref = value as ArtifactRef; if (artifacts.has(ref.sha256)) return;
        const bytes = state.readArtifact(ref); invariant(bytes.length <= 2_000_000 && artifacts.size < 512, 'Lifecycle artifact bound exceeded'); artifactBytes += bytes.length; invariant(artifactBytes <= 24_000_000, 'Lifecycle cumulative artifact bound exceeded');
        const retained = { ref, bytes: bytes.length, content: Buffer.from(bytes).toString('utf8') }; artifacts.set(ref.sha256, retained);
        let decoded: unknown; try { decoded = JSON.parse(retained.content); } catch { /* Non-JSON artifacts remain exact retained bytes. */ }
        visit(decoded);
      } else for (const child of Object.values(value)) visit(child);
    };
    visit(documents); visit(events);
    const files: Snapshot['files'] = {};
    for (const row of documents['host.run-grants']!) {
      files[row.key] = {}; for (const name of ['state.json', 'answer.json', 'child.json']) { try { files[row.key]![name] = artifactReader(row.value.workspace)(name); } catch { /* Unsafe/missing output cannot satisfy a check. */ } }
    }
    const ledger = new ResourceLedger(state, { tokens: 0, costUsd: 0, elapsedMs: 0 }).snapshot('operating-envelope:v1');
    let authority = null; if (existsSync(join(stateDirectory, 'authority.sqlite'))) { const store = new AuthorityStore(join(stateDirectory, 'authority.sqlite')); try { authority = store.current() ?? null; } finally { store.close(); } }
    const hostObservation = { readerProcess: processIdentity(process.pid), servingProcess: servingPid ? processIdentity(servingPid) : null, authority };
    const snapshot = { at: new Date().toISOString(), documents, events, artifacts: [...artifacts.values()], files, ledger, hostObservation };
    invariant(Buffer.byteLength(JSON.stringify(snapshot)) <= 32_000_000, 'Lifecycle snapshot byte bound exceeded'); return snapshot;
  } finally { state.close(); }
}
function value(snapshot: Snapshot, namespace: string, key: string) { return snapshot.documents[namespace]?.find(row => row.key === key)?.value; }
function artifact(snapshot: Snapshot, ref: ArtifactRef | undefined) { return ref && snapshot.artifacts.find(item => item.ref.sha256 === ref.sha256)?.content; }
function jsonArtifact(snapshot: Snapshot, ref: ArtifactRef | undefined) { const bytes = artifact(snapshot, ref); if (!bytes) return null; try { return JSON.parse(bytes); } catch { return null; } }
function checkpoint(snapshot: Snapshot, runId: string) { return value(snapshot, 'execution', runId)?.checkpoint; }
function authorityGrant(state: any) { return state ? { epoch: state.epoch, generation: state.generation, controlRevision: state.controlRevision } : null; }
function requests(snapshot: Snapshot) { return snapshot.documents.requests!.map(row => row.value); }
function successfulEffects(snapshot: Snapshot, runId: string, kind: string) { return snapshot.documents.effects!.map(row => row.value).filter(effect => effect.runId === runId && effect.kind === kind && effect.status === 'succeeded'); }
function hasRead(snapshot: Snapshot, runId: string, path: string, content: string) { return successfulEffects(snapshot, runId, 'workspace_read').some(effect => effect.payload.path === path && jsonArtifact(snapshot, effect.receipt)?.content === content); }
function toolObservation(snapshot: Snapshot, effect: any) { const observed = value(snapshot, 'observations', effect?.id); return observed?.runId === effect?.runId && observed?.kind === 'result' && identity(observed.value) === identity(jsonArtifact(snapshot, effect?.receipt)) ? observed : null; }
function observationSequence(snapshot: Snapshot, effect: any) { return snapshot.events.find(event => event.stream === effect?.runId && event.type === 'observation' && event.data.id === effect?.id && toolObservation(snapshot, effect) && identity(event.data) === identity(toolObservation(snapshot, effect)))?.sequence ?? -1; }
function payloads(snapshot: Snapshot) {
  return requests(snapshot).filter(row => !['effect-receiver', 'local-reconciliation'].includes(row.request.provider)).map(row => { const prompt = value(snapshot, 'prompts', row.request.promptManifestId); return { request: row.request, reservation: row, prompt, payload: jsonArtifact(snapshot, prompt?.artifact) }; });
}
/** Pure assessment consumes only retained real state/process/artifact observations. Fixture text is no evidence. */
export function assessLifecycle(witness: LifecycleWitness) {
  const { caseId, initial, final, boundary, runId } = witness; const checks: { id: string; passed: boolean; evidence: string }[] = [];
  const check = (id: string, passed: boolean, evidence: unknown) => checks.push({ id, passed: !!passed, evidence: identity(JSON.parse(JSON.stringify(evidence ?? null))) });
  const root = 'operating-envelope:v1', originalBudget = value(initial, 'budgets', root), budget = value(final, 'budgets', root), originalAllocation = value(initial, 'allocations', root), allocation = value(final, 'allocations', root);
  const snapshots = [initial, boundary, final].filter((snapshot): snapshot is Snapshot => !!snapshot);
  const unchanged = (earlier: Snapshot, later: Snapshot, namespace: string) => (earlier.documents[namespace] ?? []).every(row => identity(row.value) === identity(value(later, namespace, row.key) ?? null));
  const continuity = snapshots.every(snapshot => identity(value(snapshot, 'budgets', root) ?? null) === identity(originalBudget ?? null) && identity(value(snapshot, 'allocations', root) ?? null) === identity(originalAllocation ?? null)) && snapshots.every(snapshot => ['allocations', 'budgets', 'host.run-grants'].every(namespace => unchanged(snapshot, final, namespace))) && !!value(final, 'host.run-grants', runId) && !!initial.hostObservation?.readerProcess?.start && snapshots.every(snapshot => snapshot.hostObservation?.readerProcess?.pid === initial.hostObservation?.readerProcess?.pid && snapshot.hostObservation?.readerProcess?.start === initial.hostObservation?.readerProcess?.start) && final.documents.allocations!.every(row => row.value.rootId === root && Object.entries(lifecycleEnvelope).every(([key, ceiling]) => Number.isFinite(row.value.envelope[key]) && row.value.envelope[key] <= ceiling));
  check('original-grant-clock-retained', !!originalBudget && continuity && identity(originalBudget) === identity(budget ?? null) && identity(originalAllocation) === identity(allocation ?? null) && identity(budget?.envelope ?? null) === identity(lifecycleEnvelope) && !budget?.cancelled && Date.parse(final.at) - budget.startedAt <= lifecycleEnvelope.maxElapsedMs, { originalBudget, budget, originalAllocation, allocation, checkpoints: snapshots.map(snapshot => ({ allocations: snapshot.documents.allocations, budgets: snapshot.documents.budgets, grants: snapshot.documents['host.run-grants'], hostObservation: snapshot.hostObservation })) });
  const records = requests(final), usage = final.ledger;
  check('shared-physical-ledger-bounded', records.length > 0 && records.every(row => row.rootId === root && value(final, 'allocations', row.request.runId)?.rootId === root && row.charged.tokens >= 0 && row.charged.costUsd >= 0 && row.charged.elapsedMs >= 0) && usage.requests === records.length && usage.tokens === records.reduce((sum, row) => sum + row.charged.tokens, 0) && usage.requests <= lifecycleEnvelope.maxRequests && usage.tokens <= lifecycleEnvelope.maxTokens && usage.costUsd <= lifecycleEnvelope.maxCostUsd && usage.elapsedMs <= lifecycleEnvelope.maxElapsedMs && !usage.cancelled, { usage, records });
  check('all-effects-have-original-physical-receipts', final.documents.effects!.every(row => { const reservation = value(final, 'requests', row.value.reservationId ?? row.key); return reservation?.request.provider === 'effect-receiver' && reservation.request.runId === row.value.runId && reservation.request.id === row.value.id && reservation.rootId === root; }), { effects: final.documents.effects, records });
  check('actual-completed-run', value(final, 'runs', runId)?.status === 'completed', { run: value(final, 'runs', runId), execution: value(final, 'execution', runId) });
  const delivered = successfulEffects(final, runId, 'speech_send').filter(effect => { const receipt = jsonArtifact(final, effect.receipt); return receipt?.delivered === true && (caseId === 'S11' ? witness.receiver?.deliveries.some(row => row.client_id === receipt.clientMsgId) : identity(value(final, 'communications.direct-outbox', effect.id)?.receipt ?? null) === identity(receipt)); });
  check('explicit-real-delivered-output', delivered.length > 0, delivered);
  const artifactsBound = [initial, boundary, final].filter((snapshot): snapshot is Snapshot => !!snapshot).every(snapshot => snapshot.artifacts.every(item => Buffer.byteLength(item.content) === item.bytes && hash(item.content) === item.ref.sha256));
  check('retained-artifact-bytes-authentic', artifactsBound, [initial, boundary, final].map(snapshot => snapshot?.artifacts.map(item => item.ref) ?? []));
  const physicalPayloads = payloads(final);
  check('physical-payload-and-transport-bound', physicalPayloads.length > 0 && physicalPayloads.every(row => { const transport = value(final, 'host-transport', row.request.id), response = value(final, 'screen.lifecycle-provider-responses', row.request.requestDigest); return row.prompt?.artifact.sha256 === row.request.requestDigest && row.prompt.manifest.requestDigest === row.request.requestDigest && !!row.payload && transport?.requestId === row.request.id && transport?.dispatched === true && (row.request.status !== 'succeeded' || response?.response.sha256 === transport.responseDigest && !!jsonArtifact(final, response.response)); }), physicalPayloads);
  if (caseId === 'S08' || caseId === 'S12') {
    const [old, current] = witness.processes;
    check('actual-stopped-process-reopened', witness.processes.length === 2 && !!old?.exitedAt && old.predecessorGone && old.requestedStop === 'SIGKILL' && old.exitSignal === 'SIGKILL' && !!current && (old.identity.pid !== current.identity.pid || old.identity.start !== current.identity.start) && Date.parse(old.exitedAt) <= Date.parse(current.spawnedAt) && old.descendantsAtStop.every(goneIdentity => !!goneIdentity.start) && boundary?.hostObservation?.servingProcess?.pid === old.identity.pid && boundary.hostObservation.servingProcess.start === old.identity.start && identity(authorityGrant(initial.hostObservation?.authority)) === identity(old.ready.authority ?? null) && identity(authorityGrant(boundary.hostObservation.authority)) === identity(old.ready.authority ?? null) && boundary.hostObservation.authority.artifactId === old.ready.artifactId && identity(authorityGrant(final.hostObservation?.authority)) === identity(current.ready.authority ?? null) && final.hostObservation?.authority.artifactId === current.ready.artifactId && identity(value(boundary!, 'runs', runId)?.authority ?? null) === identity(old.ready.authority ?? null) && identity(value(final, 'runs', runId)?.authority ?? null) === identity(current.ready.authority ?? null), witness.processes);
    const prior = boundary && checkpoint(boundary, runId), retained = checkpoint(final, runId);
    const read4 = boundary ? successfulEffects(boundary, runId, 'workspace_read').find(effect => effect.payload.path === 'state.json' && jsonArtifact(boundary, effect.receipt)?.content === '{"value":4}\n' && jsonArtifact(boundary, effect.receipt)?.sha256 === hash('{"value":4}\n') && toolObservation(boundary, effect)) : null;
    const readSequence = boundary && read4 ? observationSequence(boundary, read4) : -1;
    const checkpointSequence = boundary?.events.findLast(event => event.stream === runId && event.type === 'checkpoint' && event.data.artifact.sha256 === prior?.artifact.sha256)?.sequence ?? -1;
    const correction = final.events.find(event => event.stream === runId && event.type === 'steering' && event.data.authenticated && JSON.stringify(event.data.value).includes('value9') && event.sequence > checkpointSequence);
    check('checkpoint-and-authenticated-correction-retained', !!prior && !!read4 && readSequence >= 0 && checkpointSequence > readSequence && prior.observationIds.includes(read4.id) && prior.observationIds.every((id: string) => retained?.observationIds.includes(id) && value(boundary!, 'observations', id)?.runId === runId && identity(value(boundary!, 'observations', id)) === identity(value(final, 'observations', id) ?? null)) && !!correction, { prior, retained, read4, readSequence, checkpointSequence, correction });
    const dispatched = boundary ? requests(boundary).filter(row => row.request.status === 'dispatched') : [];
    check('original-unknown-request-charge-retained', dispatched.length === 1 && dispatched.every(row => { const original = value(final, 'requests', row.request.id); return original?.request.status === 'uncertain' && identity(original.ceiling) === identity(row.ceiling) && original.charged.tokens >= row.charged.tokens && original.charged.elapsedMs >= row.charged.elapsedMs && !value(final, 'host-transport', row.request.id)?.responseDigest; }), { dispatched, unknown: records.filter(row => row.request.status === 'uncertain') });
    const write9 = successfulEffects(final, runId, 'workspace_write').find(effect => effect.payload.path === 'state.json' && effect.payload.content === '{"value":9}\n' && effect.payload.expectedSha256 === jsonArtifact(boundary!, read4?.receipt)?.sha256 && toolObservation(final, effect) && observationSequence(final, effect) > (correction?.sequence ?? Infinity));
    const read9 = successfulEffects(final, runId, 'workspace_read').find(effect => effect.payload.path === 'state.json' && jsonArtifact(final, effect.receipt)?.content === '{"value":9}\n' && toolObservation(final, effect) && observationSequence(final, effect) > (write9 ? observationSequence(final, write9) : Infinity));
    check('real-corrected-artifact-readback', !!read4 && !!write9 && !!read9 && final.files[runId]?.['state.json'] === '{"value":9}\n', { files: final.files[runId], read4, write9, read9 });
  }
  if (caseId === 'S09') {
    const physical = payloads(final), compact = physical.filter(row => row.request.purpose === 'compaction'); const saved = jsonArtifact(final, checkpoint(final, runId)?.artifact);
    const prefixes = compact.map(row => { try { return JSON.parse(row.payload.messages.find((message: any) => message.role === 'user').content); } catch { return []; } });
    const responseRecord = compact[0] && value(final, 'screen.lifecycle-provider-responses', compact[0].request.requestDigest), response = jsonArtifact(final, responseRecord?.response), summary = response?.choices?.[0]?.message?.content;
    const source = saved?.compactions?.find((item: any) => item.sourceDigest === identity(prefixes[0] ?? []));
    check('ordinary-threshold-compaction-manifest', compact.length === 1 && compact[0]!.request.status === 'succeeded' && compact[0]!.prompt.manifest.fragments.some((fragment: any) => fragment.id === 'application.compaction' && artifact(final, fragment.artifact) === compactionPrompt) && compact[0]!.prompt.manifest.fragments.some((fragment: any) => fragment.id === 'shell.tools' && artifact(final, fragment.artifact) === '[]') && (compact[0]!.payload.tools ?? []).length === 0 && prefixes[0]!.length + 20 > 60 && typeof summary === 'string' && source?.summary.content.some((block: any) => block.type === 'text' && block.text === summary) && responseRecord?.response.sha256 === value(final, 'host-transport', compact[0]!.request.id)?.responseDigest, { compact, responseRecord, response, compactions: saved?.compactions, prefixMessages: prefixes.map(prefix => prefix.length) });
    const continued = physical.filter(row => row.request.purpose === 'reasoning' && row.payload?.messages?.some((message: any) => message.role === 'user' && message.content === summary) && Date.parse(value(final, 'screen.lifecycle-provider-responses', row.request.requestDigest)?.recordedAt ?? '') >= Date.parse(responseRecord?.recordedAt ?? ''));
    check('context-reclaimed-with-original-constraint', typeof summary === 'string' && summary.includes('indigo') && continued.length > 0 && continued.some(row => row.payload.messages.length <= 25 && row.payload.messages.length < (prefixes[0]?.length ?? 0) + 20) && successfulEffects(final, runId, 'workspace_read').filter(effect => effect.payload.path.startsWith('notes/')).length >= 31 && final.files[runId]?.['answer.json'] === '{"origin":"indigo","notes":32}\n' && hasRead(final, runId, 'answer.json', '{"origin":"indigo","notes":32}\n'), { continued: continued.map(row => ({ request: row.request, messages: row.payload.messages.length })), sourceMessages: (prefixes[0]?.length ?? 0) + 20, files: final.files[runId] });
  }
  if (caseId === 'S11') {
    const effects = final.documents.effects!.map(row => row.value).filter(effect => effect.runId === runId && effect.kind === 'speech_send'), uncertain = boundary?.documents.effects?.map(row => row.value).filter(effect => effect.runId === runId && effect.status === 'uncertain') ?? [];
    const reconciliation = final.documents['screen.lifecycle-reconciliation']!.map(row => row.value), deliveries = witness.receiver?.deliveries ?? [], calls = witness.receiver?.calls ?? [];
    check('durable-local-lost-reply-reconciled', uncertain.length === 1 && value(boundary!, 'runs', runId)?.status === 'blocked' && reconciliation.length === 1 && reconciliation[0].before.id === uncertain[0].id && reconciliation[0].reconciled.status === 'succeeded' && reconciliation[0].actor === 'host-evaluator' && reconciliation[0].physicalRequest?.status === 'succeeded' && value(final, 'requests', reconciliation[0].physicalRequest?.id)?.rootId === root && deliveries.some(row => row.client_id === jsonArtifact(final, reconciliation[0].reconciled.receipt)?.clientMsgId) && calls.some(row => row.method === 'conversations.replies'), { uncertain, reconciliation, deliveries, calls });
    check('exactly-one-real-delivery-no-replay', deliveries.length === 1 && effects.length === 1 && effects[0]?.status === 'succeeded' && calls.filter(row => row.method === 'chat.postMessage').length === 1 && calls.every(row => ['chat.postMessage', 'conversations.history', 'conversations.replies'].includes(row.method)) && records.some(row => row.request.id === effects[0]?.id && row.request.status === 'uncertain'), { effects, deliveries, calls, records });
  }
  if (caseId === 'S12') {
    const transition = witness.transition, oldIds = new Set(boundary ? requests(boundary).map(row => row.request.id) : []), after = payloads(final).filter(row => !oldIds.has(row.request.id)), delegates = final.documents.delegations!.map(row => row.value).filter(row => row.task.parentRunId === runId), childId = delegates[0]?.result?.childRunId;
    check('actual-admitted-prompt-only-successor-loaded', !!transition && transition.admission.kind === 'engineering' && transition.admission.candidateId === transition.current.manifest.id && transition.old.manifest.id !== transition.current.manifest.id && ['source', 'dependencies', 'controls', 'configuration', 'model'].every(key => transition.old.manifest[key] === transition.current.manifest[key]) && transition.old.manifest.prompts !== transition.current.manifest.prompts && transition.verifiedAfter.old === identity(transition.old) && transition.verifiedAfter.current === identity(transition.current) && witness.processes[1]?.ready.artifactId === transition.current.manifest.id && value(final, 'runs', runId)?.authority.epoch === transition.activated?.epoch && transition.activated?.epoch > transition.initialAuthority.epoch, transition);
    const currentSystem = (row: ReturnType<typeof payloads>[number]) => row.payload?.messages[0]?.role === 'system' && row.payload.messages[0].content === currentPrompt && row.payload.messages.filter((message: any) => ['system', 'developer'].includes(message.role)).length === 1 && row.prompt.manifest.fragments.filter((fragment: any) => ['system', 'developer'].includes(fragment.role)).length === 1 && row.prompt.manifest.fragments.some((fragment: any) => fragment.id === 'application.mind' && fragment.role === 'system' && artifact(final, fragment.artifact) === currentPrompt);
    check('current-owned-layer-across-resumed-plain-child', after.length > 0 && after.every(currentSystem) && [runId, witness.plainCurrentRun, childId].every(id => typeof id === 'string' && after.some(row => row.request.runId === id)) && !!witness.plainOldRun && payloads(final).some(row => row.request.runId === witness.plainOldRun && row.payload.messages[0].content === oldPrompt), { after, oldPlain: witness.plainOldRun, currentPlain: witness.plainCurrentRun, childId });
    const inspected = successfulEffects(final, runId, 'delegation_inspect'), judged = successfulEffects(final, runId, 'delegation_judge');
    check('real-current-child-inspected-accepted-integrated', delegates.length === 1 && delegates[0].status === 'accepted' && !!delegates[0].inspection && inspected.some(effect => effect.payload.id === delegates[0].task.id) && judged.some(effect => effect.payload.id === delegates[0].task.id) && value(final, 'runs', childId)?.status === 'completed' && value(final, 'allocations', childId)?.parentRunId === runId && final.files[childId]?.['child.json'] === final.files[runId]?.['answer.json'] && final.files[runId]?.['answer.json'] === '{"value":9,"source":"actual-child"}\n', { delegates, inspected, judged, files: final.files });
  }
  return { quality: checks.every(check => check.passed) ? 3 : 0, checks };
}

async function until<T>(read: () => T, accept: (value: T) => boolean, deadline: number, label: string): Promise<T> {
  for (;;) { const result = read(); if (accept(result)) return result; invariant(Date.now() < deadline, `Original lifecycle deadline reached: ${label}`); await new Promise(resolve => setTimeout(resolve, 20)); }
}
class ApplicationProcess {
  readonly child: ChildProcess; readonly messages: any[] = []; readonly receipt: ProcessReceipt; counter = 0;
  constructor(entrypoint: string, bootPath: string, artifactId: string) {
    const spawnedAt = new Date().toISOString(); this.child = spawn(process.execPath, [entrypoint, bootPath], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    const observed = processIdentity(this.child.pid!); invariant(observed, 'Actual spawned process identity unavailable');
    this.receipt = { identity: observed, artifactId, spawnedAt, ready: null, descendantsAtStop: [], requestedStop: null, exitedAt: null, exitCode: null, exitSignal: null, predecessorGone: false, stderr: '' };
    this.child.on('message', message => this.messages.push(message)); this.child.stderr!.on('data', data => { this.receipt.stderr += String(data); invariant(Buffer.byteLength(this.receipt.stderr) <= 65536, 'Bounded child stderr exceeded'); });
    this.child.on('exit', (code, signal) => { this.receipt.exitedAt = new Date().toISOString(); this.receipt.exitCode = code; this.receipt.exitSignal = signal; });
  }
  async wait(type: string, deadline: number, id?: number): Promise<any> { return until<any>(() => { const failed = this.messages.find(message => ['fatal', 'error'].includes(message.type)); if (failed) throw new Error(failed.failure); if (this.receipt.exitedAt && type !== 'reply') throw new Error(`Application child exited: ${this.receipt.stderr}`); return this.messages.find(message => message.type === type && (id === undefined || message.id === id)); }, Boolean, deadline, type); }
  async ready(deadline: number) { this.receipt.ready = await this.wait('ready', deadline); return this.receipt.ready; }
  async command(type: 'start' | 'correct' | 'reconcile' | 'stop', deadline: number, externalId?: string) { const id = ++this.counter; this.child.send({ type, id, externalId }); return this.wait('reply', deadline, id); }
  async stop(kind: 'SIGKILL' | 'graceful', deadline: number) {
    this.receipt.descendantsAtStop = processTree(this.receipt.identity.pid); this.receipt.requestedStop = kind;
    if (!this.receipt.exitedAt) { if (kind === 'SIGKILL') this.child.kill('SIGKILL'); else await this.command('stop', deadline); }
    await until(() => !!this.receipt.exitedAt && gone(this.receipt.identity) && this.receipt.descendantsAtStop.every(gone), Boolean, deadline, 'observed predecessor/descendant exit'); this.receipt.predecessorGone = true;
  }
}
function logical(config: ApplicationConfig): DeploymentInputs['configuration'] {
  const { stateDirectory: _, workspaceDirectory: _w, applicationRoot: _a, nodeBinary: _n, workerEntrypoint: _e, artifactId: _i, controlRevision: _c, promptFile: _p, compactionPromptFile: _q, resourceLimits: _r, ...result } = config; return result;
}
function sourceManifest() {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: repository, encoding: 'utf8' }).split('\0').filter(path => /^(packages|deployment)\//.test(path) || ['package.json', 'package-lock.json', 'tsconfig.json'].includes(path)).map(path => ({ path, sha256: hash(readFileSync(join(repository, path), 'utf8')) }));
  return { files, sha256: identity(files) };
}
export function freezeLifecyclePromptPair(root: string, config: ApplicationConfig, authorityStore: AuthorityStore) {
  const source = join(root, 'frozen-source'), artifactStore = join(root, 'artifacts'), evidenceDirectory = join(root, 'admission'); mkdirSync(source); mkdirSync(artifactStore); mkdirSync(evidenceDirectory);
  // Explicit bounded rewrite and check/build closure only; no history or entire installation copy.
  for (const entry of deploymentEntries(repository)) if (existsSync(join(repository, entry))) { mkdirSync(dirname(join(source, entry)), { recursive: true }); cpSync(realpathSync(join(repository, entry)), join(source, entry), { recursive: true }); }
  const blob = (bytes: string | Uint8Array): ArtifactRef => { const sha256 = hashBytes(bytes); writeFileSync(join(evidenceDirectory, sha256), bytes, { flag: 'wx', mode: 0o600 }); return { uri: `sha256:${sha256}`, sha256 }; };
  const key = randomBytes(32); writeFileSync(join(evidenceDirectory, 'fixture-signing-key'), key, { mode: 0o600, flag: 'wx' });
  const evaluator = blob('PUBLIC synthetic engineering admission-mechanics host judgment. No independent product qualification, live grant or provider judgment.');
  const fields = { kind: 'engineering' as const, requiredCases: ['declared-prompt-profile'], evaluatorKeys: new Map([['PUBLIC-engineering-host-judgment', key]]), evaluatorArtifacts: new Map([['PUBLIC-engineering-host-judgment', evaluator.sha256]]) };
  const inputs: DeploymentInputs = { configuration: logical(config), prompts: { mind: oldPrompt, compaction: compactionPrompt }, runtime: { nodeVersion: process.version, nodeSha256: hashBytes(readFileSync(process.execPath)), platform: process.platform, arch: process.arch }, policy: policyDescriptor(fields), createdBy: 'PUBLIC-lifecycle-fixture-author' };
  const old = freezeApplication(source, artifactStore, inputs), current = freezeApplication(source, artifactStore, { ...inputs, prompts: { ...inputs.prompts, mind: currentPrompt } });
  verifyApplication(artifactStore, old.manifest.id, process.execPath); verifyApplication(artifactStore, current.manifest.id, process.execPath);
  const initialAuthority = authorityStore.bootstrap('PUBLIC-old-profile', old.manifest.controls, old.manifest.id), policyFields = { ...fields, controlRevision: old.manifest.controls }, policy: AdmissionPolicy = { ...policyFields, policyDigest: admissionPolicyIdentity(policyFields) };
  const observation = blob('Synthetic host declares separately frozen CURRENT_PROFILE_INDIGO prompt experiment. Actual runtime transition observations follow under original ledger.');
  const evidence: EvaluationEvidence = { id: 'PUBLIC-prompt-admission', candidateId: current.manifest.id, controlRevision: initialAuthority.controlRevision, evaluatorId: 'PUBLIC-engineering-host-judgment', evaluatorArtifact: evaluator, independent: true, verdict: 'pass', artifact: observation, caseResults: [{ id: 'declared-prompt-profile', status: 'pass', observations: observation, usage: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 }, interventions: ['Explicit synthetic host judgment; actual lifecycle observations are separately measured.'] }] };
  const proposal: ReleaseProposal = { id: 'PUBLIC-prompt-successor-proposal', candidate: current.manifest, priorAuthority: initialAuthority, evidence: [evidence], recoveryArtifact: blob(JSON.stringify(old)) }, signed = [signEvaluation(evidence, key, policy.policyDigest)];
  const admission = admitCandidate(artifactStore, proposal, initialAuthority, policy, signed, uri => readFileSync(join(evidenceDirectory, uri.slice('sha256:'.length))));
  const host = { stateDirectory: config.stateDirectory, workspaceDirectory: config.workspaceDirectory, artifactStore, nodeBinary: process.execPath };
  return { old, current, initialAuthority, admission, proposal, signed, policy: { controlRevision: policy.controlRevision, kind: policy.kind, requiredCases: policy.requiredCases, policyDigest: policy.policyDigest, evaluatorArtifact: evaluator, fixtureKeyDigest: hashBytes(key) }, configOld: materializeConfiguration(old, host), configCurrent: materializeConfiguration(current, host), artifactStore, evidenceDirectory };
}
export function validateLifecyclePlan(plan: { caseId: LifecycleCase; control: LifecycleControl; initialAttempts: number }[]) {
  const controls: Record<LifecycleCase, LifecycleControl> = { S08: 'no-process-restart', S09: 'short-history', S11: 'duplicate-delivery', S12: 'retained-old-profile' };
  invariant(plan.length === 8 && lifecycleCases.every(caseId => plan.filter(row => row.caseId === caseId && row.control === 'normal').length === 1 && plan.filter(row => row.caseId === caseId && row.control === controls[caseId]).length === 1) && plan.every(row => [1, 2, 3].includes(row.initialAttempts)), 'Freeze four positive cases and four fixed negatives, at most three initial attempts');
  return Object.freeze(plan.map(row => Object.freeze({ ...row })));
}
export async function runLifecycleCase(caseId: LifecycleCase, control: LifecycleControl, destination: string, attempt: 1 | 2 | 3 = 1) {
  invariant(lifecycleCases.includes(caseId) && [1, 2, 3].includes(attempt) && destination === resolve(destination), 'Fixed case, attempt and absolute new report path required');
  const controls: Record<LifecycleCase, LifecycleControl> = { S08: 'no-process-restart', S09: 'short-history', S11: 'duplicate-delivery', S12: 'retained-old-profile' }; invariant(control === 'normal' || control === controls[caseId], 'Undeclared lifecycle control');
  invariant(!existsSync(destination), 'Retained report cannot reset/replay'); const root = `${destination}.state`; mkdirSync(root, { mode: 0o700 });
  const attemptId = `${caseId}-${control}-initial-${attempt}`, configuration = configureLifecycle(fixtureConfiguration(root, repository));
  writeFileSync(configuration.promptFile, oldPrompt); writeFileSync(configuration.compactionPromptFile, compactionPrompt);
  if (caseId === 'S11') configuration.slack = { teamId: 'LOCAL-T1', botUserId: 'BOT', channels: [{ channel: 'LOCAL-C1', scope: configuration.direct.scope }], eligibleHumanIds: ['LOCAL-HUMAN'], coverageStart: '1', lookbackSeconds: 60, allowSpeech: true };
  const receipt = { schema: lifecycleVersion, caseId, control, attempt, attemptId, engineeringOnly: true, frozenAt: new Date().toISOString(), envelope: lifecycleEnvelope, configuration, sourceManifest: sourceManifest(), sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(), driver: hash(readFileSync(new URL(import.meta.url), 'utf8')), child: hash(readFileSync(new URL('./lifecycle-child.ts', import.meta.url), 'utf8')), fixtures: hash(readFileSync(new URL('./lifecycle-fixtures.ts', import.meta.url), 'utf8')), workload: identity(lifecycleWorkload(caseId)), nodeSha256: hashBytes(readFileSync(process.execPath)) };
  const attemptPath = join(root, 'original-attempt.json'); writeFileSync(attemptPath, JSON.stringify(receipt), { mode: 0o600, flag: 'wx' });
  const authorityStore = new AuthorityStore(join(configuration.stateDirectory, 'authority.sqlite')); let authority: Authority; let transition: ReturnType<typeof freezeLifecyclePromptPair> | null = null;
  let witness: LifecycleWitness | null = null, failure: string | null = null, initial: Snapshot | null = null, boundary: Snapshot | null = null, final: Snapshot | null = null, runId = '', plainOldRun: string | null = null, plainCurrentRun: string | null = null;
  const processes: ApplicationProcess[] = []; let active: ApplicationProcess | null = null; const start = performance.now(); let deadline = Date.now() + lifecycleEnvelope.maxElapsedMs;
  const receiverPath = join(root, 'local-receiver.sqlite'); let reconciliation: any = null;
  const open = async (config: ApplicationConfig, phase: 0 | 1) => {
    const bootPath = join(root, `boot-${processes.length}.json`); writeFileSync(bootPath, JSON.stringify({ config, authority, caseId, control, phase, receiverPath, attemptId }), { flag: 'wx', mode: 0o600 });
    const process = new ApplicationProcess(join(config.applicationRoot, 'evaluations/product/lifecycle-child.ts'), bootPath, config.artifactId); processes.push(process); active = process; await process.ready(deadline); return process;
  };
  const terminal = async (id: string, status?: string) => until(() => { const store = new OperationalStore({ filename: join(configuration.stateDirectory, 'operational.sqlite') }); try { return store.get<any>('runs', id)?.value; } finally { store.close(); } }, run => !!run && (status ? run.status === status : ['completed', 'waiting', 'blocked', 'cancelled'].includes(run.status)), deadline, `terminal ${id}`);
  try {
    if (caseId === 'S12') { transition = freezeLifecyclePromptPair(root, configuration, authorityStore); authority = transition.initialAuthority; } else authority = authorityStore.bootstrap('PUBLIC-lifecycle-fixture', configuration.controlRevision, configuration.artifactId);
    const firstConfig = transition?.configOld ?? configuration, first = await open(firstConfig, 0); initial = captureLifecycle(configuration.stateDirectory, first.receipt.identity.pid);
    // Original application clock starts after frozen host preparation and is never changed afterward.
    deadline = value(initial, 'budgets', 'operating-envelope:v1').startedAt + lifecycleEnvelope.maxElapsedMs;
    if (caseId === 'S12') { plainOldRun = (await first.command('start', deadline, `${attemptId}-plain-old`)).runId; await terminal(plainOldRun!); }
    runId = (await first.command('start', deadline, attemptId)).runId;
    if (caseId === 'S08' || caseId === 'S12') {
      await first.wait('boundary', deadline); boundary = captureLifecycle(configuration.stateDirectory, first.receipt.identity.pid);
      if (control === 'no-process-restart') await first.command('correct', deadline, attemptId);
      else {
        await first.stop('SIGKILL', deadline); active = null;
        if (transition && control !== 'retained-old-profile') { const withdrawn = authorityStore.withdraw(authority); authority = authorityStore.activate(withdrawn, 'PUBLIC-current-profile', transition.current.manifest.controls, transition.current.manifest.id); }
        const successor = await open(transition && control !== 'retained-old-profile' ? transition.configCurrent : firstConfig, 1); await successor.command('correct', deadline, attemptId);
      }
      await terminal(runId);
      if (caseId === 'S12') { plainCurrentRun = (await active!.command('start', deadline, `${attemptId}-plain-current`)).runId; await terminal(plainCurrentRun!); }
    } else if (caseId === 'S11') {
      await terminal(runId, 'blocked'); boundary = captureLifecycle(configuration.stateDirectory, first.receipt.identity.pid); reconciliation = await first.command('reconcile', deadline); await terminal(runId);
    } else await terminal(runId);
    await active!.stop('graceful', deadline); active = null;
  } catch (error) { failure = error instanceof Error ? error.stack ?? error.message : String(error); }
  finally {
    const remaining = processes.find(process => !process.receipt.exitedAt);
    if (remaining) { try { await remaining.stop('SIGKILL', Math.max(deadline, Date.now() + 3000)); } catch (error) { failure ??= String(error); } }
    try { if (initial) final = captureLifecycle(configuration.stateDirectory); } catch (error) { failure ??= String(error); }
  }
  let retainedTransition: any = null;
  try {
    if (transition) retainedTransition = { ...transition, activated: authorityStore.current()?.generation === 'PUBLIC-current-profile' ? authorityStore.current() : null, verifiedAfter: { old: identity(verifyApplication(transition.artifactStore, transition.old.manifest.id, process.execPath)), current: identity(verifyApplication(transition.artifactStore, transition.current.manifest.id, process.execPath)) }, authorityHistory: authorityStore.history() };
  } catch (error) { failure ??= String(error); }
  let receiver: LifecycleWitness['receiver'] = null;
  if (existsSync(receiverPath)) { const db = new DatabaseSync(receiverPath); try { receiver = { deliveries: db.prepare('SELECT * FROM deliveries ORDER BY sequence').all(), calls: db.prepare('SELECT * FROM calls ORDER BY sequence').all() }; } finally { db.close(); } }
  if (initial && final && runId) witness = { caseId, runId, initial, boundary, final, processes: processes.map(process => process.receipt), receiver, transition: retainedTransition, plainOldRun, plainCurrentRun };
  if (sourceManifest().sha256 !== receipt.sourceManifest.sha256) failure ??= 'Original runtime/application source changed during finite execution';
  const assessment = witness ? assessLifecycle(witness) : null; authorityStore.close();
  const negativeCheck = control === 'normal' ? null : lifecycleControlChecks[control];
  const controlValidation = negativeCheck ? { requiredRejectedCheck: negativeCheck, rejected: assessment?.checks.find(check => check.id === negativeCheck)?.passed === false } : null;
  const report = { schema: lifecycleVersion, mode: 'synthetic-ordinary-application', evidenceKind: 'public-engineering-fixture', caseId, control, attempt, attemptId, verdict: !failure && assessment?.quality === 3 ? 'case-pass' : 'criterion-unmet', failure, assessment, witness, reconciliation, controlValidation, originalAttempt: { path: attemptPath, content: readFileSync(attemptPath, 'utf8'), sha256: hash(readFileSync(attemptPath, 'utf8')) }, retainedState: root, wallMs: performance.now() - start, claims: { liveCompetence: 'unavailable', heldOut: false, Q3: 'unavailable', parity: 'unavailable', H1: 'unaccepted', admissionEligible: false }, limitations: ['Public deterministic provider responses with real ordinary application, tools, process lifecycle and ledger.', 'Host explicitly performs declared restart/reconciliation/admission interventions; not autonomous model lifecycle competence.', 'Original unknown costs/tokens remain unknown and original charges stay reserved; fixture usage is not billed usage.', 'Engineering admission judgment is synthetic author-operated mechanics, not independent product qualification.'] };
  let bytes = JSON.stringify(report, null, 2);
  if (Buffer.byteLength(bytes) > 64_000_000) { report.failure ??= 'Combined lifecycle report bound exceeded; full witness unavailable, raw state retained'; report.verdict = 'criterion-unmet'; report.witness = null; report.assessment = null; if (report.controlValidation) report.controlValidation.rejected = false; bytes = JSON.stringify(report, null, 2); }
  writeFileSync(destination, `${bytes}\n`, { mode: 0o600, flag: 'wx' }); return report;
}
export async function runLifecycleScreen(directory: string) {
  invariant(directory === resolve(directory) && existsSync(directory), 'Existing absolute external report directory required');
  const controls: Record<LifecycleCase, LifecycleControl> = { S08: 'no-process-restart', S09: 'short-history', S11: 'duplicate-delivery', S12: 'retained-old-profile' };
  const plan = validateLifecyclePlan(lifecycleCases.flatMap(caseId => [{ caseId, control: 'normal' as const, initialAttempts: 1 }, { caseId, control: controls[caseId], initialAttempts: 1 }]));
  writeFileSync(join(directory, 'frozen-plan.json'), JSON.stringify({ schema: lifecycleVersion, plan, envelope: lifecycleEnvelope, thresholdMessages: 60, retainMessages: 20, driver: hash(readFileSync(new URL(import.meta.url), 'utf8')), frozenAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
  const reports = []; for (const task of plan) reports.push(await runLifecycleCase(task.caseId, task.control, join(directory, `${task.caseId}-${task.control}-attempt1.json`)));
  const aggregate = { schema: lifecycleVersion, plan, reports: reports.map(report => ({ caseId: report.caseId, control: report.control, verdict: report.verdict, failure: report.failure, assessment: report.assessment, controlValidation: report.controlValidation })), verdict: reports.every(report => !report.failure && (report.control === 'normal' ? report.verdict === 'case-pass' : report.verdict === 'criterion-unmet' && report.controlValidation?.rejected)) ? 'synthetic-mechanics-pass' : 'criterion-unmet', claims: { Q3: 'unavailable', parity: 'unavailable', H1: 'unaccepted', liveCompetence: 'unavailable' } };
  writeFileSync(join(directory, 'aggregate.json'), JSON.stringify(aggregate, null, 2), { flag: 'wx', mode: 0o600 }); return aggregate;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, destination] = process.argv.slice(2); invariant(mode === '--synthetic' && destination, 'Usage: node lifecycle.ts --synthetic ABSOLUTE-NEW-REPORT-DIRECTORY'); const result = await runLifecycleScreen(destination); if (result.verdict !== 'synthetic-mechanics-pass') process.exitCode = 1;
}
