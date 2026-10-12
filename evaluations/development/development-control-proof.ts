import { types } from 'node:util';
import { canonicalJson, identity, invariant, validatePhysicalRequest, digest, type ArtifactRef, type Effect, type InboundInput, type Observation, type PhysicalRequest, type ResourceEnvelope } from '../../packages/contracts/index.ts';
import type { JournalRef, PhysicalDocumentRow, StoredEvent } from '../../packages/storage/index.ts';
import { developmentControlAlgorithm, developmentControlAlgorithmDigest, developmentControlOutput, validateDevelopmentControl, type DevelopmentControlConfig } from '../../deployment/development-controls.ts';
import { inertSnapshot, type Signed } from '../qualification/manifest.ts';
import { hashBytes } from '../../packages/release/artifacts.ts';
import { projectDevelopmentPageSources, type DevelopmentPageSourceInput, type DevelopmentEventPosition } from './development-observer.ts';
import { developmentRequestIdentity, type DevelopmentAccountingTransition, type DevelopmentRoleBinding } from './review-envelope.ts';
import { deriveDevelopmentAssignment, deriveDevelopmentOpportunity, encodeDevelopmentSourceProof, validateSourceAdmissionPolicy, validateDevelopmentWorkload, verifyDevelopmentSourceCheck, type DevelopmentAssignmentProof, type DevelopmentCheckInput, type DevelopmentSourceCheck, type SourceAdmissionContext, type SourceAdmissionResult, type SourceInterval } from './development-source-admission.ts';

export interface DevelopmentControlSources {
  controlId: string; role: DevelopmentPageSourceInput; original: DevelopmentPageSourceInput;
  assignments: { assignmentId: string; source: DevelopmentPageSourceInput }[];
  opportunities: { opportunityId: string; checker: ArtifactRef; proof: ArtifactRef }[];
  scripts: { assignmentId: string; checker: ArtifactRef }[];
  hostNow: number; judgmentSlots: ArtifactRef[];
}
interface ControlGrantBinding { originalGrant: { resources: ResourceEnvelope; issuedAt: string; expiresAt: string }; behaviorWindow: { notBefore: string; deadlineAt: string }; localRootId: string }
interface ScriptExecution { assignmentId: string; effectId: string; effect: JournalRef; observation: JournalRef; receipt: ArtifactRef; input: ArtifactRef; requestId: string }
interface Execution { opportunityId: string; assignmentIds: string[]; runIds: string[]; inputRefs: ArtifactRef[]; outputRefs: ArtifactRef[]; requestIds: string[]; checkerRef: ArtifactRef }
export interface DevelopmentControlProof {
  version: 1; kind: 'control'; planDigest: string; policyDigest: string; roleId: string; subjectId: string;
  controlId: string; configurationDigest: string; modeSeal: ArtifactRef; workloadContract: ArtifactRef;
  captures: ArtifactRef[]; interval: SourceInterval; checks: ArtifactRef[];
  source: { initialSeal: JournalRef; finalSeal: JournalRef; sealEvent: DevelopmentEventPosition;
    role: DevelopmentRoleBinding; registrationDigest: string; grantBinding: ControlGrantBinding;
    transitions: { event: DevelopmentEventPosition; digest: string }[];
    opportunities: ArtifactRef[]; scripts: ScriptExecution[]; scriptChecks: Signed<DevelopmentSourceCheck>[];
    findings: string[] };
  executions: Execution[]; acquisition: DevelopmentSourceCheck['acquisition'];
  behavior: DevelopmentSourceCheck['behavior']; validity: 'unavailable';
}
class Unavailable extends Error {}
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const bytes = (v: unknown) => Buffer.from(canonicalJson(v));
const reference = (v: unknown): ArtifactRef => { const sha256 = hashBytes(bytes(v)); return { uri: `sha256:${sha256}`, sha256 }; };
const position = (e: StoredEvent): DevelopmentEventPosition => ({ id: e.id, sequence: e.sequence, stream: e.stream, type: e.type });
const exact = (v: object, keys: string) => invariant(v && typeof v === 'object' && Object.keys(v).sort().join(',') === keys.split(',').sort().join(','), 'Exact control fields required');
const required = <T>(v: T | undefined | null, message: string): T => { if (v === null || v === undefined) throw new Unavailable(message); return v; };
function take<T>(r: SourceAdmissionResult<T>): T { if (r.status === 'derived') return r.proof; if (r.status === 'unavailable') throw new Unavailable(r.code); throw Error(r.code); }
function guarded<T>(fn: () => T): SourceAdmissionResult<T> { try { return { status: 'derived', proof: fn() }; } catch (e) { return { status: e instanceof Unavailable ? 'unavailable' : 'failed', code: String(e instanceof Error ? e.message : e).slice(0, 256) }; } }
function read(c: SourceAdmissionContext, r: ArtifactRef, bound = c.plan.manifest.value.limits.maxArtifactBytes): Buffer {
  exact(r, 'uri,sha256'); invariant(r.uri === `sha256:${r.sha256}` && /^[a-f0-9]{64}$/.test(r.sha256), 'Retained control reference required');
  const b = Buffer.from(c.readArtifact(inertSnapshot(r), bound)); invariant(b.length <= bound && hashBytes(b) === r.sha256, 'Control artifact digest/byte bound differs'); return b;
}
function json<T>(c: SourceAdmissionContext, r: ArtifactRef, bound?: number): T { const b = read(c, r, bound), v = JSON.parse(b.toString()) as T; invariant(b.equals(bytes(v)), 'Canonical control artifact required'); return inertSnapshot(v); }
function dataFields(value: unknown): Record<string, unknown> {
  invariant(value && typeof value === 'object' && !types.isProxy(value), 'Inert control record required');
  invariant(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, 'Plain control record required');
  const descriptors = Object.getOwnPropertyDescriptors(value), out: Record<string, unknown> = Object.create(null);
  invariant(Reflect.ownKeys(descriptors).every(k => typeof k === 'string'), 'Control symbols forbidden');
  for (const [name, descriptor] of Object.entries(descriptors)) { invariant('value' in descriptor && descriptor.enumerable, 'Control accessors/hidden properties forbidden'); out[name] = descriptor.value; }
  return out;
}
function dataArray(value: unknown): unknown[] {
  invariant(value && typeof value === 'object' && !types.isProxy(value) && Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype, 'Dense plain control array required');
  const d = Object.getOwnPropertyDescriptors(value) as unknown as Record<string, PropertyDescriptor>, length = d.length?.value;
  invariant(Number.isSafeInteger(length) && length >= 0 && length <= 126 && Reflect.ownKeys(d).length === length + 1, 'Dense bounded control array required');
  const out: unknown[] = []; for (let n = 0; n < length; n++) { const descriptor = d[n]; invariant(descriptor && 'value' in descriptor && descriptor.enumerable, 'Control array accessors forbidden'); out.push(descriptor.value); } return out;
}
function detachContext(value: SourceAdmissionContext): SourceAdmissionContext {
  const fields = dataFields(value); exact(fields, 'plan,policy,trust,readArtifact'); const readArtifact = fields.readArtifact; invariant(typeof readArtifact === 'function' && !types.isProxy(readArtifact), 'Pinned nonproxy bounded control artifact reader required'); delete fields.readArtifact;
  const trust = dataFields(fields.trust); exact(trust, 'acceptedPolicyDigest,acceptedQualificationDigest,acceptedClockQualificationDigest,checker'); delete fields.trust; const checkerValue = trust.checker; delete trust.checker;
  let checker: SourceAdmissionContext['trust']['checker'] = null;
  if (checkerValue !== null) { const fields = dataFields(checkerValue); exact(fields, 'id,key,principalId,independenceGroup'); const key = fields.key; delete fields.key;
    invariant(key && typeof key === 'object' && !types.isProxy(key) && types.isUint8Array(key) && (Object.getPrototypeOf(key) === Uint8Array.prototype || Object.getPrototypeOf(key) === Buffer.prototype), 'Native pinned checker key required');
    invariant(Reflect.ownKeys(key).every(k => typeof k === 'string' && /^(0|[1-9][0-9]*)$/.test(k)), 'Checker key extensions forbidden');
    const nativeLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!.call(key) as number;
    const copy = new Uint8Array(nativeLength); Uint8Array.prototype.set.call(copy, key); checker = { ...inertSnapshot(fields), key: copy } as SourceAdmissionContext['trust']['checker'];
  }
  return { ...inertSnapshot(fields), trust: { ...inertSnapshot(trust), checker }, readArtifact: (ref: ArtifactRef, max: number) => Reflect.apply(readArtifact, undefined, [inertSnapshot(ref), max]) } as SourceAdmissionContext;
}
function detachInput(value: DevelopmentPageSourceInput): DevelopmentPageSourceInput {
  const fields = dataFields(value); exact(fields, 'before,after,current,assignmentPacket,roleId,configurationDigest,pathIdentity,journal,bounds,metadataBounds,readArtifact,openAcquiredCapture'); const readArtifact = fields.readArtifact, openAcquiredCapture = fields.openAcquiredCapture; delete fields.readArtifact; delete fields.openAcquiredCapture;
  invariant(typeof readArtifact === 'function' && !types.isProxy(readArtifact) && typeof openAcquiredCapture === 'function' && !types.isProxy(openAcquiredCapture), 'Pinned nonproxy synchronous control source readers required');
  return { ...inertSnapshot(fields), readArtifact: (ref: ArtifactRef, max: number) => Reflect.apply(readArtifact, undefined, [inertSnapshot(ref), max]), openAcquiredCapture: (ref: ArtifactRef) => Reflect.apply(openAcquiredCapture, undefined, [inertSnapshot(ref)]) } as DevelopmentPageSourceInput;
}
function detached(context: SourceAdmissionContext, value: DevelopmentControlSources) {
  const fields = dataFields(value); exact(fields, 'controlId,role,original,assignments,opportunities,scripts,hostNow,judgmentSlots');
  const role = detachInput(fields.role as DevelopmentPageSourceInput), original = detachInput(fields.original as DevelopmentPageSourceInput), assignments = dataArray(fields.assignments).map(value => { const a = dataFields(value); exact(a, 'assignmentId,source'); return { assignmentId: inertSnapshot(a.assignmentId) as string, source: detachInput(a.source as DevelopmentPageSourceInput) }; });
  delete fields.role; delete fields.original; delete fields.assignments;
  const s = { ...inertSnapshot(fields), role, original, assignments } as DevelopmentControlSources, c = detachContext(context);
  invariant(s.assignments.length <= 126 && s.opportunities.length <= 12 && s.scripts.length <= 3 && s.judgmentSlots.length <= 38 && Number.isFinite(s.hostNow), 'Bounded control selectors required');
  return { c, s };
}
function finalUse(s: DevelopmentControlSources): void { for (const i of [s.role, s.original, ...s.assignments.map(a => a.source)]) for (const r of [i.before, i.after, i.current]) i.openAcquiredCapture(r).assertUsableNow(); }
function sourceInventory(c: SourceAdmissionContext, input: DevelopmentPageSourceInput) {
  invariant(equal(input.metadataBounds, { maxRecords: c.policy.bounds.maxMetadataRecords, maxBytes: c.policy.bounds.maxMetadataBytes }) && input.bounds.maxProofBytes <= c.policy.bounds.maxProofBytes && equal(input.assignmentPacket, c.plan.assignmentPacket), 'Control source bounds/packet differ');
  const p = projectDevelopmentPageSources({ ...input, after: input.before, current: input.after });
  const tail = projectDevelopmentPageSources({ ...input, before: input.after, after: input.after });
  if (tail.unavailable.some(x => x.subject === 'source')) throw new Unavailable(tail.unavailable.find(x => x.subject === 'source')!.reason);
  if (p.unavailable.some(x => x.subject === 'source')) throw new Unavailable(p.unavailable.find(x => x.subject === 'source')!.reason); required(p.interval, 'Control capture interval unavailable');
  const reader = input.openAcquiredCapture(input.current), events: StoredEvent[] = [], rows: PhysicalDocumentRow[] = []; let count = 0, size = 0;
  const charge = (v: unknown) => { count++; size += bytes(v).length; invariant(count <= input.metadataBounds.maxRecords && size <= input.metadataBounds.maxBytes, 'Control metadata bound exceeded'); };
  reader.forEachEvent(e => { const v = inertSnapshot(e); charge(v); events.push(v); }); reader.forEachCurrentDocument(r => { const v = inertSnapshot(r); charge(v); rows.push(v); }); reader.assertUsableNow();
  const version = (r: JournalRef) => { const v = inertSnapshot(reader.resolveJournalVersion(r.versionId)); invariant(equal(v.ref, r) && v.document.revision === r.revision && identity(v.document) === r.sha256, 'Control exact journal version differs'); reader.assertUsableNow(); return v.document; };
  return { p, reader, events, rows, version };
}
interface Seal { version: 1; mode: DevelopmentControlConfig; configurationDigest: string; closureDigest: string; roleId: string; roleDigest: string; registrationDigest: string; attemptDigest: string; originalRoot: { rootId: string; parentRunId: string | null; envelope: ResourceEnvelope; startedAt: number; budgetEnvelope: ResourceEnvelope; budgetStartedAt: number }; grantBinding: ControlGrantBinding; source: string; originalSource: string; journal: unknown; initial: ArtifactRef }
function prepare(c: SourceAdmissionContext, s: DevelopmentControlSources) {
  validateSourceAdmissionPolicy(c); const workload = validateDevelopmentWorkload(c), registration = c.plan.registration.value, manifest = c.plan.manifest.value;
  const control = required(manifest.controls.find(x => x.id === s.controlId), 'Unknown control'), role = required(registration.roles.find(x => x.assignmentId === control.id), 'Control role unavailable');
  invariant(role.kind === 'control' && role.id === s.role.roleId && role.configurationDigest === s.role.configurationDigest, 'Control role/configuration differs');
  const rolePlan = required(c.plan.roles.find(x => x.roleId === role.id), 'Control role plan missing'), configuration = json<{ developmentControl: DevelopmentControlConfig; model: unknown; resources: unknown; conversationResources: unknown }>(c, rolePlan.configuration);
  validateDevelopmentControl(configuration.developmentControl); invariant(identity(configuration) === role.configurationDigest && configuration.developmentControl.kind === control.kind && configuration.developmentControl.assignmentId === control.id && configuration.developmentControl.workloadDigest === c.policy.workload!.sha256, 'Control configuration/mode/workload differs');
  const candidate = required(registration.roles.find(x => x.kind === 'candidate'), 'Candidate role unavailable'), cp = required(c.plan.roles.find(x => x.roleId === candidate.id), 'Candidate role plan unavailable'), cc = json<typeof configuration>(c, cp.configuration);
  invariant(equal(role.resources, candidate.resources) && equal(role.profile, candidate.profile) && equal(configuration.model, cc.model) && equal(configuration.resources, cc.resources) && equal(configuration.conversationResources, cc.conversationResources), 'Matched role envelope/model/context differs');
  invariant(s.original.roleId === candidate.id && s.original.configurationDigest === candidate.configurationDigest, 'Original accounting source role differs');
  const local = sourceInventory(c, s.role), original = sourceInventory(c, s.original), before = s.role.openAcquiredCapture(s.role.before), seals = local.events.filter(e => e.stream === 'development-control' && e.type === 'mode-sealed');
  invariant(seals.length === 1, 'Exactly one source mode seal required'); const sealEvent = seals[0]!, seal = inertSnapshot(sealEvent.data) as unknown as Seal;
  exact(seal, 'version,mode,configurationDigest,closureDigest,roleId,roleDigest,registrationDigest,attemptDigest,originalRoot,grantBinding,source,originalSource,journal,initial');
  invariant(seal.version === 1 && equal(seal.mode, configuration.developmentControl) && seal.configurationDigest === role.configurationDigest && seal.closureDigest === role.closureDigest && seal.roleId === role.id && seal.roleDigest === identity(role) && seal.registrationDigest === identity(registration) && seal.attemptDigest === registration.attemptDigest && equal(seal.journal, s.role.journal) && seal.source === rolePlan.stateFile && seal.originalSource === c.plan.originalStateFile, 'Captured mode/role/source binding differs');
  invariant(sealEvent.sequence <= before.manifest.cut.lastSequence, 'Initial control capture must precede behavioral ingress');
  const mutations = local.events.filter(e => e.type === 'document-mutation').map(e => ({ event: e, data: e.data as unknown as { namespace: string; key: string; before: JournalRef | null; after: JournalRef | null } }));
  const modes = mutations.filter(x => x.data.namespace === 'host.development-control' && x.data.key === 'mode'); invariant(modes.length === 1 && modes[0]!.data.before === null && modes[0]!.data.after?.revision === 1, 'Mode seal history changed');
  const sealRef = modes[0]!.data.after!; invariant(equal(local.version(sealRef).value, seal), 'Mode seal document/event differ');
  for (const ref of [s.role.before, s.role.after, s.role.current]) { let row: PhysicalDocumentRow | undefined; const reader = s.role.openAcquiredCapture(ref); reader.forEachCurrentDocument(r => { if (r.namespace === 'host.development-control' && r.key === 'mode') row = inertSnapshot(r); }); invariant(row?.revision === 1 && equal(row.value, seal), 'Initial/final mode seal differs'); reader.assertUsableNow(); }
  const root = original.rows.find(x => x.namespace === 'allocations' && x.key === registration.rootId)?.value as unknown as { rootId: string; parentRunId?: string; envelope: unknown; startedAt: number } | undefined;
  const budget = original.rows.find(x => x.namespace === 'budgets' && x.key === registration.rootId)?.value as unknown as { envelope: unknown; startedAt: number } | undefined;
  required(root, 'Original allocation unavailable'); required(budget, 'Original budget unavailable');
  invariant(equal(seal.originalRoot, { rootId: root!.rootId, parentRunId: root!.parentRunId ?? null, envelope: root!.envelope, startedAt: root!.startedAt, budgetEnvelope: budget!.envelope, budgetStartedAt: budget!.startedAt }), 'Original root changed');
  const grant = manifest.grant;
  const roleAllocation = required(original.rows.find(x => x.namespace === 'allocations' && x.key === role.allocationId), 'Original role allocation unavailable').value as unknown as { rootId: string; parentRunId: string; envelope: unknown };
  invariant(roleAllocation.rootId === registration.rootId && roleAllocation.parentRunId === registration.rootId && equal(roleAllocation.envelope, role.resources) && equal(root!.envelope, grant.resources) && root!.startedAt === Date.parse(grant.issuedAt), 'Original actual role/root envelope differs');
  invariant(equal(seal.grantBinding, { originalGrant: { resources: grant.resources, issuedAt: grant.issuedAt, expiresAt: grant.expiresAt }, behaviorWindow: { notBefore: manifest.notBefore, deadlineAt: manifest.deadlineAt }, localRootId: 'operating-envelope:v1' }), 'Original grant/window changed');
  invariant(!original.rows.some(x => x.namespace === 'budgets' && x.key === registration.rootId && (x.value as unknown as { cancelled?: boolean }).cancelled), 'Original root cancelled');
  for (const m of mutations) { const n = m.data.namespace; if (['no-standing-goals', 'scripted-praise', 'always-agree', 'always-oppose'].includes(control.kind)) invariant(!['initiative.goals', 'initiative.goal-history', 'initiative.goal-provenance', 'initiative.drives', 'initiative.drive-history', 'initiative.opportunities', 'initiative.plans', 'initiative.execution', 'host.bootstrap'].includes(n), 'Standing-goal history contaminates control'); if (control.kind === 'no-memory' || !['no-standing-goals'].includes(control.kind)) invariant(!['host.consolidation-runs', 'development.jobs'].includes(n), 'Consolidation history contaminates control'); }
  const scripted = ['scripted-praise', 'always-agree', 'always-oppose'].includes(control.kind);
  for (const event of local.events) {
    if (event.type === 'goal-revised' && (scripted || control.kind === 'no-standing-goals')) throw Error('Standing-goal event contaminates control');
    if (event.type === 'admitted' || event.type === 'steering') { const input = event.data as unknown as InboundInput; if (scripted || control.kind === 'no-standing-goals') invariant(!['initiative', 'host.bootstrap'].includes(input.source), 'Standing-goal admission ancestry contaminates control'); if (scripted || control.kind === 'no-memory') invariant(input.source !== 'consolidation', 'Consolidation admission contaminates control'); }
  }
  if (scripted || control.kind === 'no-standing-goals') for (const row of local.rows.filter(x => x.namespace === 'initiative.obligations')) invariant(!(row.value as unknown as { goalId?: string }).goalId, 'Goal-linked obligation contaminates control');
  for (const m of mutations) invariant(!['host.evolution-continuations', 'host.evolution-jobs', 'host.evolution-acknowledgments', 'host.evolution-recovered-waits', 'host.control-continuations', 'host.control-author-watches', 'host.control-acknowledgments'].includes(m.data.namespace), 'Unqualified extension history contaminates matched profile');
  const expected = c.plan.protocol!.schedule.filter(x => x.roleId === role.id).map(x => x.assignmentId); invariant(equal(s.assignments.map(x => x.assignmentId), expected) && new Set(expected).size === expected.length, 'Complete ordered role assignment coverage required');
  const assignments = new Map(s.assignments.map(a => { invariant(a.source.roleId === role.id && a.source.configurationDigest === role.configurationDigest && equal(a.source.current, s.role.current) && equal(a.source.pathIdentity, s.role.pathIdentity) && equal(a.source.journal, s.role.journal), 'Assignment capture role/source differs'); const proof = take(deriveDevelopmentAssignment(c, a.source, a.assignmentId)); invariant(proof.source.assignment.ingress.sequence > before.manifest.cut.lastSequence, 'Control ingress predates initial mode capture'); return [a.assignmentId, proof] as const; }));
  const transitions = original.events.filter(e => e.type === 'physical-transition' && (e.data as unknown as DevelopmentAccountingTransition).state.roleId === role.id).map(event => ({ event, value: event.data as unknown as DevelopmentAccountingTransition }));
  const localRequests = local.rows.filter(x => x.namespace === 'requests').map(x => (x.value as unknown as { request: PhysicalRequest }).request); localRequests.forEach(validatePhysicalRequest);
  const requestId = (localId: string) => `development-request:${identity([identity(registration), role.id, localId])}`;
  const requestIds = localRequests.map(q => requestId(q.id)); invariant(new Set(requestIds).size === requestIds.length && equal([...new Set(transitions.map(t => t.value.state.request.id))].sort(), [...requestIds].sort()), 'Complete original/local request inventory differs');
  for (const q of localRequests) { const history = transitions.filter(x => x.value.state.request.id === requestId(q.id)), expectedRun = `development-run:${identity([identity(registration), role.id, q.runId])}`; invariant(history.length >= 2 && history[0]!.value.beforeDigest === null && history[0]!.value.state.request.status === 'reserved' && history[1]!.value.state.request.status === 'dispatched', 'Original reservation/dispatch missing');
    const mapped = { ...q, id: requestId(q.id), runId: expectedRun, reservationId: requestId(q.reservationId), ...(q.parentRequestId ? { parentRequestId: requestId(q.parentRequestId) } : {}) }; invariant(developmentRequestIdentity(mapped) === developmentRequestIdentity(history[0]!.value.state.request), 'Local/original immutable request identity differs');
    history.forEach((t, i) => { const state = t.value.state; validatePhysicalRequest(state.request); invariant(state.rootId === registration.rootId && state.configurationDigest === role.configurationDigest && state.closureDigest === role.closureDigest && state.allocationPath.includes(role.allocationId) && state.request.runId === expectedRun && developmentRequestIdentity(state.request) === developmentRequestIdentity(history[0]!.value.state.request) && (i === 0 || t.value.beforeDigest === identity(history[i - 1]!.value.state)), 'Original transition role/lineage changed'); });
    const latest = history.at(-1)!.value;
    const actual = required(original.rows.find(x => x.namespace === 'requests' && x.key === requestId(q.id)), 'Original physical inventory missing').value as unknown as { request: PhysicalRequest };
    const retainedState = required(original.rows.find(x => x.namespace === 'development.accounting.latest' && x.key === requestId(q.id)), 'Original bridge latest state missing').value;
    invariant(equal(actual.request, latest.state.request) && equal(retainedState, latest.state), 'Original physical/bridge latest inventory differs');
    invariant(latest.state.request.status === q.status && equal(latest.state.request.usage, q.usage), 'Original/local settlement differs');
    if (['reserved', 'dispatched', 'uncertain'].includes(q.status)) throw new Unavailable('Control physical settlement unavailable');
  }
  const start = before.manifest.clock, end = s.role.openAcquiredCapture(s.role.after).manifest.clock;
  const interval: SourceInterval = { lowerWallMs: start.wallMs, upperWallMs: end.wallMs, clockKind: end.kind, temporalEligibility: end.kind === 'synthetic' ? 'synthetic' : c.policy.clockQualification ? 'qualified' : 'unavailable' };
  return { control, role, workload, local, original, assignments, transitions, localRequests, requestId, seal, sealRef, sealEvent, interval };
}
function scriptExecution(c: SourceAdmissionContext, s: DevelopmentControlSources, p: ReturnType<typeof prepare>, a: DevelopmentAssignmentProof): ScriptExecution {
  invariant(['scripted-praise', 'always-agree', 'always-oppose'].includes(p.control.kind), 'Scripted kind required before static output computation');
  const input = a.source.assignment.input, runId = a.source.assignment.runId, mode = { ...reference(p.seal), uri: `aeon:artifact:${identity(p.seal)}` }, id = `tool:development-control:${identity([mode.sha256, runId, input.id])}`;
  const versions = a.source.assignment.proof.versions, effectEvent = required(p.local.events.findLast(e => e.type === 'document-mutation' && e.sequence <= (a.source.assignment.result?.origin.disposition.sequence ?? 0) && (e.data as unknown as { namespace: string; key: string }).namespace === 'effects' && (e.data as unknown as { key: string }).key === id), 'Script effect source unavailable'), effectRef = required((effectEvent.data as unknown as { after: JournalRef | null }).after, 'Script effect version unavailable'), effect = p.local.version(effectRef).value as unknown as Effect;
  invariant(effect.id === id && effect.runId === runId && effect.kind === 'development_control_emit' && equal(effect.payload, { inputId: input.id }), 'Stable script effect/input identity differs');
  if (effect.status !== 'succeeded' || !effect.receipt) throw new Unavailable('Script effect is unresolved or incomplete');
  const operationalJson = <T>(ref: ArtifactRef): T => { const bound = c.plan.manifest.value.limits.maxArtifactBytes, b = p.local.reader.resolve(ref, bound); invariant(b.byteLength <= bound && hashBytes(b) === ref.sha256, 'Script captured operational digest/byte bound differs'); const v = JSON.parse(Buffer.from(b).toString()) as T; invariant(Buffer.from(b).equals(bytes(v)), 'Script canonical operational bytes required'); return inertSnapshot(v); };
  const receipt = operationalJson<{ version: number; algorithm: string; algorithmDigest: string; kind: string; modeSeal: ArtifactRef; inputId: string; inputRef: ArtifactRef; output: unknown; runId: string; effectId: string; monotonicStart: number; monotonicEnd: number }>(effect.receipt);
  exact(receipt, 'version,algorithm,algorithmDigest,kind,modeSeal,inputId,inputRef,output,runId,effectId,monotonicStart,monotonicEnd');
  invariant(receipt.version === 1 && receipt.algorithm === developmentControlAlgorithm && receipt.algorithmDigest === developmentControlAlgorithmDigest && receipt.kind === p.control.kind && equal(receipt.modeSeal, mode) && receipt.inputId === input.id && receipt.runId === runId && receipt.effectId === id && equal(operationalJson<InboundInput>(receipt.inputRef), input) && equal(receipt.output, developmentControlOutput(p.control.kind, input)) && Number.isFinite(receipt.monotonicStart) && receipt.monotonicStart >= 0 && Number.isFinite(receipt.monotonicEnd) && receipt.monotonicEnd >= receipt.monotonicStart, 'Script algorithm/receipt/input/output differs');
  const observation = required(versions.findLast(x => x.namespace === 'observations' && a.source.assignment.result?.observationIds.includes(x.key)), 'Script result observation unavailable'), value = p.local.version(observation).value as unknown as Observation;
  invariant(value.kind === 'result' && value.runId === runId && equal(value.value, receipt), 'Script result observation/receipt differs');
  const request = required(p.localRequests.find(x => x.id === id), 'Script physical request unavailable'), history = p.transitions.filter(x => x.value.state.request.id === p.requestId(id)), settled = history.at(-1)!.value;
  invariant(request.provider === 'effect-receiver' && request.model === 'development_control_emit', 'Script physical provider differs');
  if (request.status !== 'succeeded' || !settled.settlement) throw new Unavailable('Script settlement unknown');
  const settlement = settled.settlement.value; invariant(settlement.registrationDigest === identity(c.plan.registration.value) && settlement.requestIdentityDigest === developmentRequestIdentity(settled.state.request) && settlement.dispatched && settlement.status === 'succeeded' && equal(settlement.usage, request.usage) && settlement.response?.sha256 === effect.receipt.sha256 && equal(json(c, settlement.response), receipt) && request.usage.requests === 1 && request.usage.inputTokens === 0 && request.usage.outputTokens === 0 && request.usage.costUsd === 0 && Number.isFinite(request.usage.elapsedMs) && request.usage.elapsedMs >= 0, 'Script accounted settlement/usage/response differs');
  return { assignmentId: a.subjectId, effectId: id, effect: effectRef, observation, receipt: effect.receipt, input: receipt.inputRef, requestId: p.requestId(id) };
}
function caseInput(c: SourceAdmissionContext, s: DevelopmentControlSources, p: ReturnType<typeof prepare>, assignmentId: string) {
  const script = required(p.workload.scripts.find(x => x.controlId === p.control.id), 'Script mapping unavailable'), entry = required(script.cases.find(x => x.assignmentId === assignmentId), 'Script case unregistered');
  const a = required(p.assignments.get(entry.assignmentId), 'Script task assignment unavailable'), feedback = required(p.assignments.get(entry.feedbackAssignmentId), 'Script feedback assignment unavailable');
  const executions = [scriptExecution(c, s, p, a), scriptExecution(c, s, p, feedback)];
  const evidence = bytes({ version: 1, kind: 'unsigned-script-check-evidence', planDigest: c.policy.planDigest, policyDigest: c.trust.acceptedPolicyDigest, roleId: p.role.id, subjectId: assignmentId, assignment: a, feedback, executions });
  invariant(evidence.length <= c.policy.bounds.maxProofBytes, 'Script check input byte bound exceeded');
  const output = required(a.output, 'Script output unavailable'); read(c, output); read(c, feedback.input);
  const result: DevelopmentCheckInput = { kind: 'unsigned-check-input', evidence: Uint8Array.from(evidence), sourceDigest: hashBytes(evidence), roleId: p.role.id, subjectId: assignmentId, assignmentIds: [assignmentId, entry.feedbackAssignmentId], output, feedback: feedback.input, interval: { ...a.interval, upperWallMs: Math.max(a.interval.upperWallMs, feedback.interval.upperWallMs) } };
  return { result, executions, a, feedback };
}
/** Bounded unsigned evidence for an external checker; no checker execution or attestation. */
export function inspectDevelopmentControlCase(context: SourceAdmissionContext, sources: DevelopmentControlSources, assignmentId: string): SourceAdmissionResult<DevelopmentCheckInput> {
  return guarded(() => { const { c, s } = detached(context, sources), p = prepare(c, s); invariant(p.localRequests.every(q => q.provider === 'effect-receiver' && q.model === 'development_control_emit'), 'Script model/arbitrary effect request denied'); const out = caseInput(c, s, p, assignmentId).result; finalUse(s); return out; });
}
/** Recomputes all selected captured sources. Results remain unsigned and validity unavailable. */
export function deriveDevelopmentControlProof(context: SourceAdmissionContext, sources: DevelopmentControlSources): SourceAdmissionResult<DevelopmentControlProof> {
  return guarded(() => { const { c, s } = detached(context, sources);
    const expected = required(c.plan.manifest.value.controls.find(x => x.id === s.controlId), 'Unknown control');
    if (['no-memory', 'no-standing-goals'].includes(expected.kind)) invariant(s.scripts.length === 0 && equal(s.opportunities.map(x => x.opportunityId), expected.opportunityIds) && expected.opportunityIds.length === 12, 'All twelve ablation opportunities required');
    const p = prepare(c, s), checks: ArtifactRef[] = [], executions: Execution[] = [], scripts: ScriptExecution[] = [], scriptChecks: Signed<DevelopmentSourceCheck>[] = [], opportunityRefs: ArtifactRef[] = [], outcomes: DevelopmentSourceCheck[] = [];
    if (['no-memory', 'no-standing-goals'].includes(p.control.kind)) {
      invariant(s.scripts.length === 0 && equal(s.opportunities.map(x => x.opportunityId), p.control.opportunityIds) && p.control.opportunityIds.length === 12 && equal(p.control.opportunityIds, c.plan.manifest.value.opportunities.map(x => x.id)), 'All twelve ablation opportunities required');
      for (const entry of s.opportunities) { exact(entry, 'opportunityId,checker,proof'); const map = required(p.workload.opportunities.find(x => x.id === entry.opportunityId)?.roles.find(x => x.roleId === p.role.id), 'Ablation exposure mapping unavailable');
        const source = (id: string) => required(s.assignments.find(x => x.assignmentId === id), 'Mapped ablation assignment unavailable').source, relatedIds = [...(map.learningAssignmentId ? [map.learningAssignmentId] : []), ...map.interferenceAssignmentIds, map.feedbackAssignmentId], input = source(map.assignmentId), related = relatedIds.map(source);
        const proof = take(deriveDevelopmentOpportunity(c, input, { roleId: p.role.id, assignmentId: map.assignmentId, opportunityId: entry.opportunityId, before: input.before, after: input.after, related: relatedIds.map((id, i) => ({ roleId: p.role.id, assignmentId: id, before: related[i]!.before, after: related[i]!.after })) }, related, entry.checker, s.hostNow, s.judgmentSlots));
        invariant(read(c, entry.proof, c.policy.bounds.maxProofBytes).equals(Buffer.from(encodeDevelopmentSourceProof(proof, c.policy.bounds.maxProofBytes))), 'Retained ablation proof differs from fresh derivation'); outcomes.push(proof.check.value); checks.push(entry.checker); opportunityRefs.push(entry.proof);
        const all = [proof.source.assignment, ...proof.source.related]; executions.push({ opportunityId: entry.opportunityId, assignmentIds: all.map(x => x.subjectId), runIds: [...new Set(all.map(x => x.source.assignment.runId))], inputRefs: all.map(x => x.input), outputRefs: all.flatMap(x => x.output ? [x.output] : []), requestIds: p.localRequests.filter(q => all.some(x => x.source.assignment.runId === q.runId)).map(q => p.requestId(q.id)), checkerRef: entry.checker });
      }
      for (const t of p.transitions) { const q = t.value.state.request; if (q.provider === 'effect-receiver') continue; const payload = JSON.parse(read(c, t.value.state.payload).toString()) as { messages?: { role?: string; content?: unknown }[]; tools?: { function?: { name?: string } }[] }; const frames = (payload.messages ?? []).flatMap(m => { if (typeof m.content !== 'string') return []; try { const v = JSON.parse(m.content); return v?.hostContext ? [v.hostContext] : []; } catch { return []; } });
        invariant(frames.length > 0, 'Captured effective host context unavailable');
        for (const f of frames) { if (p.control.kind === 'no-memory') invariant(f.memory && equal(f.memory.memories, []) && equal(f.memory.self, []), 'No-memory effective payload contains developmental context'); else invariant(equal(f.agenda, []), 'No-standing-goals effective payload contains agenda'); }
        const names = (payload.tools ?? []).map(x => x.function?.name); invariant(p.control.kind === 'no-memory' ? !names.some(x => x && ['memory_retrieve', 'memory_schedule_consolidation', 'memory_derive', 'self_adopt', 'memory_forget', 'memory_consolidation_complete'].includes(x)) : !names.some(x => x?.startsWith('initiative_')), 'Ablation effective tools differ');
      }
    } else {
      invariant(s.opportunities.length === 0, 'Script cannot import ablation proofs'); const mapped = required(p.workload.scripts.find(x => x.controlId === p.control.id && x.roleId === p.role.id), 'Script mapping unavailable'); invariant(equal(s.scripts.map(x => x.assignmentId), mapped.cases.map(x => x.assignmentId)), 'Complete ordered script checks required');
      invariant(p.localRequests.every(q => q.provider === 'effect-receiver' && q.model === 'development_control_emit'), 'Script model/arbitrary effect request denied');
      for (const entry of s.scripts) { exact(entry, 'assignmentId,checker'); const i = caseInput(c, s, p, entry.assignmentId), acquisition = [i.a, i.feedback].some(x => x.acquisition !== 'completed') ? 'unavailable' : 'completed';
        const check = take(verifyDevelopmentSourceCheck(c, entry.checker, { roleId: p.role.id, subjectId: entry.assignmentId, assignmentIds: i.result.assignmentIds, sourceDigest: i.result.sourceDigest, output: i.result.output, feedback: i.result.feedback, acquisition, completeAt: i.result.interval.upperWallMs, hostNow: s.hostNow, judgmentSlots: s.judgmentSlots }));
        outcomes.push(check.value); checks.push(entry.checker); scriptChecks.push(check); scripts.push(...i.executions); executions.push({ opportunityId: entry.assignmentId, assignmentIds: i.result.assignmentIds, runIds: [...new Set([i.a.source.assignment.runId, i.feedback.source.assignment.runId])], inputRefs: [i.a.input, i.feedback.input], outputRefs: [i.result.output, required(i.feedback.output, 'Script feedback output unavailable')], requestIds: i.executions.map(x => x.requestId), checkerRef: entry.checker });
      }
      invariant(equal([...new Set(scripts.map(x => x.requestId))].sort(), p.localRequests.map(x => p.requestId(x.id)).sort()), 'Script execution/request inventory incomplete');
    }
    const captures = [...new Map([s.role, s.original, ...s.assignments.map(a => a.source)].flatMap(i => [i.before, i.after, i.current]).map(r => [r.sha256, r])).values()];
    const proof: DevelopmentControlProof = { version: 1, kind: 'control', planDigest: c.policy.planDigest, policyDigest: c.trust.acceptedPolicyDigest, roleId: p.role.id, subjectId: s.controlId, controlId: s.controlId, configurationDigest: p.role.configurationDigest, modeSeal: { ...reference(p.seal), uri: `aeon:artifact:${identity(p.seal)}` }, workloadContract: c.policy.workload!, captures, interval: p.interval, checks,
      source: { initialSeal: p.sealRef, finalSeal: p.sealRef, sealEvent: position(p.sealEvent), role: p.role, registrationDigest: identity(c.plan.registration.value), grantBinding: p.seal.grantBinding, transitions: p.transitions.map(t => ({ event: position(t.event), digest: identity(t.value) })), opportunities: opportunityRefs, scripts, scriptChecks, findings: ['unsigned-source-evidence', 'independent-control-validity-unavailable', 'operational-mediator-semantics-require-independent-qualification', 'synthetic-checker-trust-does-not-qualify-competence'] }, executions,
      acquisition: outcomes.some(x => x.acquisition === 'unavailable') ? 'unavailable' : outcomes.some(x => x.acquisition === 'failed') ? 'failed' : 'completed', behavior: outcomes.some(x => x.behavior === 'unavailable') ? 'unavailable' : outcomes.some(x => x.behavior === 'fail') ? 'fail' : 'pass', validity: 'unavailable' };
    encodeDevelopmentControlProof(proof, c.policy.bounds.maxProofBytes); finalUse(s); return inertSnapshot(proof);
  });
}
/** Serialization alone never establishes source truth or recorder admission. */
export function encodeDevelopmentControlProof(proof: DevelopmentControlProof, maxBytes: number): Uint8Array {
  const p = inertSnapshot(proof); exact(p, 'version,kind,planDigest,policyDigest,roleId,subjectId,controlId,configurationDigest,modeSeal,workloadContract,captures,interval,checks,source,executions,acquisition,behavior,validity'); invariant(p.version === 1 && p.kind === 'control' && p.validity === 'unavailable' && p.subjectId === p.controlId && Number.isSafeInteger(maxBytes) && maxBytes > 0, 'Unsigned bounded control proof required'); for (const d of [p.planDigest, p.policyDigest, p.configurationDigest]) digest(d);
  invariant(typeof p.roleId === 'string' && p.roleId.length > 0 && p.roleId.length <= 256 && typeof p.controlId === 'string' && p.controlId.length > 0 && `source:control:${p.roleId}:${p.controlId}`.length <= 256, 'Bounded control identity required');
  exact(p.interval, 'lowerWallMs,upperWallMs,clockKind,temporalEligibility'); invariant(Number.isFinite(p.interval.lowerWallMs) && Number.isFinite(p.interval.upperWallMs) && p.interval.lowerWallMs <= p.interval.upperWallMs && ['host', 'synthetic'].includes(p.interval.clockKind) && ['synthetic', 'qualified', 'unavailable'].includes(p.interval.temporalEligibility), 'Exact control interval required');
  exact(p.source, 'initialSeal,finalSeal,sealEvent,role,registrationDigest,grantBinding,transitions,opportunities,scripts,scriptChecks,findings'); digest(p.source.registrationDigest);
  invariant(p.executions.length > 0 && p.executions.length <= 12 && p.checks.length === p.executions.length && p.source.opportunities.length <= 12 && p.source.scripts.length <= 6 && p.source.scriptChecks.length <= 3 && p.captures.length <= 384 && new Set(p.captures.map(r => r.sha256)).size === p.captures.length, 'Bounded complete control wire required');
  invariant(['completed', 'failed', 'unavailable'].includes(p.acquisition) && ['pass', 'fail', 'unavailable'].includes(p.behavior), 'Explicit control axes required');
  for (const execution of p.executions) { exact(execution, 'opportunityId,assignmentIds,runIds,inputRefs,outputRefs,requestIds,checkerRef'); invariant(execution.assignmentIds.length > 0 && execution.assignmentIds.length <= 6 && execution.inputRefs.length === execution.assignmentIds.length && execution.outputRefs.length <= execution.assignmentIds.length, 'Exact control execution denominator required'); }
  const out = bytes(p); invariant(out.length <= maxBytes, `Control proof byte bound exceeded: ${out.length} > ${maxBytes}`); return Uint8Array.from(out);
}
