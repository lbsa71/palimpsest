import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { canonicalJson, identity, invariant, type ArtifactRef, type DataScope, type Effect, type EffectReceiver, type InboundInput, type JsonValue, type Observation, type ShellPort } from '../packages/contracts/index.ts';
import { OperationalStore, type DevelopmentSnapshot } from '../packages/storage/index.ts';
import { DevelopmentalMemory, type ContextRequest, type DevelopmentContext } from '../packages/development/index.ts';
import { DevelopmentAccounting } from './development-accounting.ts';
import type { ApplicationConfig } from './config.ts';

export type DevelopmentControlKind = 'ordinary' | 'no-memory' | 'no-standing-goals' | 'scripted-praise' | 'always-agree' | 'always-oppose';
export interface DevelopmentControlConfig { version: 1; kind: DevelopmentControlKind; assignmentId: string | null; workloadDigest: string }
const namespace = 'host.development-control', key = 'mode';
const scripted = new Set<DevelopmentControlKind>(['scripted-praise', 'always-agree', 'always-oppose']);
const memoryTools = new Set(['memory_retrieve', 'memory_schedule_consolidation', 'memory_derive', 'self_adopt', 'memory_forget', 'memory_consolidation_complete']);
const standingNamespaces = ['initiative.goals', 'initiative.goal-history', 'initiative.goal-provenance', 'initiative.drives', 'initiative.drive-history', 'initiative.opportunities', 'initiative.plans', 'initiative.execution', 'host.bootstrap'];
const extensionNamespaces = ['host.evolution-continuations', 'host.evolution-jobs', 'host.evolution-acknowledgments', 'host.evolution-recovered-waits', 'host.control-continuations', 'host.control-author-watches', 'host.control-acknowledgments'];
const setupNamespaces = new Set(['allocations', 'budgets', 'system.document-journal']);
const prepared = new WeakMap<object, { store: OperationalStore; configDigest: string; snapshot: DevelopmentSnapshot | null; workspace: { path: string; sha256: string; bytes: number }[]; prior: Seal | null }>();
const json = (value: unknown): JsonValue => JSON.parse(canonicalJson(value)) as JsonValue;
function freeze<T>(value: T): T { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
export function validateDevelopmentControl(value: DevelopmentControlConfig): void {
  invariant(value && Object.keys(value).sort().join(',') === 'assignmentId,kind,version,workloadDigest' && value.version === 1, 'Exact development control v1 required');
  invariant(['ordinary', 'no-memory', 'no-standing-goals', 'scripted-praise', 'always-agree', 'always-oppose'].includes(value.kind), 'Invalid development control kind');
  invariant(value.kind === 'ordinary' ? value.assignmentId === null : typeof value.assignmentId === 'string' && value.assignmentId.trim().length > 0, 'Invalid control assignment');
  invariant(typeof value.workloadDigest === 'string' && /^[a-f0-9]{64}$/.test(value.workloadDigest), 'Public workload digest required');
}
interface Seal { version: 1; mode: DevelopmentControlConfig | null; configurationDigest: string | null; closureDigest: string | null; roleId: string | null; roleDigest: string | null; registrationDigest: string | null; attemptDigest: string | null; originalRoot: JsonValue | null; grantBinding: JsonValue | null; source: string; originalSource: string | null; journal: JsonValue; initial: ArtifactRef | null }
function assertStore(store: OperationalStore): void {
  invariant(Object.getPrototypeOf(store) === OperationalStore.prototype && Object.getOwnPropertyNames(store).every(name => ['filename', 'db', 'depth', 'journalOption', 'observedJournal', 'developmentFence'].includes(name)), 'Exact operational Store without extensions required');
}
function sourceSnapshot(store: OperationalStore): DevelopmentSnapshot { return store.captureDevelopmentSnapshot({ maxRows: 512, maxBytes: 1_048_576 }); }
function fresh(snapshot: DevelopmentSnapshot, afterBridge: boolean): void {
  const allowed = new Set(setupNamespaces); if (afterBridge) { allowed.add('development.accounting.bindings'); allowed.add('development.accounting.local'); }
  invariant(snapshot.documents.every(row => allowed.has(row.namespace)), 'Evaluation role requires fresh operational state');
  invariant(snapshot.events.every(event => {
    if (event.type === 'document-journal-anchor') return true;
    if (event.type !== 'document-mutation') return false;
    const data = event.data as Record<string, JsonValue>; return typeof data.namespace === 'string' && allowed.has(data.namespace);
  }), 'Evaluation role contains prior operational events');
  invariant(snapshot.journalPayloads.every(payload => allowed.has(payload.ref.namespace)), 'Evaluation role contains prior journal content');
}
function workspaceInventory(root: string): { path: string; sha256: string; bytes: number }[] {
  const rows: { path: string; sha256: string; bytes: number }[] = []; let total = 0, entries = 0;
  const visit = (directory: string, relative: string): void => { for (const name of readdirSync(directory).sort()) {
    invariant(++entries <= 256, 'Evaluation fixture entry inventory exceeds bound');
    const path = join(directory, name), label = relative ? `${relative}/${name}` : name, stat = lstatSync(path);
    invariant(!stat.isSymbolicLink() && (stat.isFile() || stat.isDirectory()), 'Evaluation fixture contains unsupported file');
    if (stat.isDirectory()) visit(path, label); else { total += stat.size; invariant(rows.length < 256 && total <= 1_048_576, 'Evaluation fixture inventory exceeds bound'); rows.push({ path: label, bytes: stat.size, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }); }
  } }; visit(root, ''); return rows;
}
/** Host-only token minted before an accounting factory can mutate setup documents. */
export function prepareDevelopmentControl(config: ApplicationConfig, store: OperationalStore): object {
  assertStore(store);
  if (config.developmentControl) validateDevelopmentControl(config.developmentControl);
  const prior = store.get<Seal>(namespace, key);
  const anchors = store.events('development-control').filter(event => event.type === 'mode-sealed');
  invariant(Boolean(prior) === Boolean(anchors.length) && anchors.length <= 1 && (!prior || prior.revision === 1 && identity(prior.value) === identity(anchors[0]!.data)), 'Development mode seal missing or changed');
  if (prior) invariant(identity(prior.value.mode) === identity(config.developmentControl ?? null), 'Development mode cannot change on reopen');
  let snapshot: DevelopmentSnapshot | null = null;
  if (config.developmentControl && !prior) { invariant(!store.hasArtifacts(), 'Evaluation role contains prior operational artifacts'); snapshot = sourceSnapshot(store); fresh(snapshot, false); }
  const token = Object.freeze({}); prepared.set(token, { store, configDigest: identity(config), snapshot, workspace: config.developmentControl && !prior ? workspaceInventory(config.workspaceDirectory) : [], prior: prior?.value ?? null }); return token;
}
function originalRoot(accounting: DevelopmentAccounting): JsonValue {
  const rootId = accounting.registration.rootId, store = accounting.originalResources.store;
  const root = store.get<{ rootId: string; parentRunId?: string; envelope: JsonValue; startedAt: number }>('allocations', rootId)?.value;
  const budget = store.get<{ envelope: JsonValue; startedAt: number }>('budgets', rootId)?.value;
  invariant(root && budget, 'Original root missing');
  return json({ rootId: root.rootId, parentRunId: root.parentRunId ?? null, envelope: root.envelope, startedAt: root.startedAt, budgetEnvelope: budget.envelope, budgetStartedAt: budget.startedAt });
}
export class BoundDevelopmentControl {
  readonly kind: DevelopmentControlKind; readonly assignmentId: string | null; readonly modeSeal: ArtifactRef;
  readonly #store: OperationalStore; readonly #config: ApplicationConfig; readonly #accounting: DevelopmentAccounting | undefined; readonly #seal: Seal;
  private constructor(config: ApplicationConfig, store: OperationalStore, accounting: DevelopmentAccounting | undefined, seal: Seal) {
    this.#config = freeze(structuredClone(config)); this.#store = store; this.#accounting = accounting; this.#seal = freeze(structuredClone(seal));
    this.kind = config.developmentControl?.kind ?? 'ordinary'; this.assignmentId = config.developmentControl?.assignmentId ?? null; this.modeSeal = freeze(store.putJsonArtifact(json(seal))); Object.freeze(this);
  }
  static bind(config: ApplicationConfig, store: OperationalStore, accounting: DevelopmentAccounting | undefined, token: object): BoundDevelopmentControl {
    assertStore(store);
    const pre = prepared.get(token); invariant(pre && pre.store === store && pre.configDigest === identity(config), 'Missing actual pre-accounting freshness token'); prepared.delete(token);
    invariant(!config.developmentControl || accounting instanceof DevelopmentAccounting && Object.getPrototypeOf(accounting) === DevelopmentAccounting.prototype && accounting.resources.store === store, 'Evaluation control requires actual local accounting bridge');
    invariant(config.developmentControl || !accounting, 'Evaluation accounting requires explicit ordinary/control mode');
    if (accounting) {
      accounting.assertApplication(config);
      invariant(accounting.role.kind === (config.developmentControl!.kind === 'ordinary' ? 'candidate' : 'control') && accounting.role.assignmentId === config.developmentControl!.assignmentId, 'Actual control mode/role/assignment differs');
      if (scripted.has(config.developmentControl!.kind)) invariant(identity(accounting.role.allowedEffects) === identity(['development_control_emit']), 'Script requires exactly one registered local effect');
      if (!pre.prior) {
        invariant(accounting.registration.originalRequests.length === 0, 'First matched profile cannot import physical history');
        invariant(!store.hasArtifacts(), 'Accounting setup added operational artifacts before control seal');
        const post = sourceSnapshot(store); fresh(post, true);
        const shared = accounting.originalResources.store === store;
        const expectedAllocations = shared ? new Set([accounting.registration.rootId, ...accounting.registration.roles.map(role => role.allocationId)]) : new Set<string>();
        invariant(post.documents.filter(row => row.namespace === 'allocations').length === expectedAllocations.size && store.list('allocations').every(row => expectedAllocations.has(row.key)), 'Unexpected fresh allocation inventory');
        invariant(store.list('budgets').length === (shared ? 1 : 0) && store.list('budgets').every(row => row.key === accounting.registration.rootId), 'Unexpected fresh budget inventory');
        invariant(store.list('development.accounting.local').length === 1 && store.get<{ registrationDigest: string; roleId: string }>('development.accounting.local', 'binding')?.value.registrationDigest === accounting.registrationDigest && store.get<{ roleId: string }>('development.accounting.local', 'binding')?.value.roleId === accounting.role.id, 'Changed local accounting setup');
        invariant(store.list('development.accounting.bindings').length === (shared ? 1 : 0), 'Unexpected accounting setup inventory');
      }
    }
    const initial = pre.snapshot ? store.putJsonArtifact(json({ snapshot: pre.snapshot, workspace: pre.workspace, fixtureMatching: 'OD1 separately checks preregistered public fixture identity' })) : null;
    const seal: Seal = { version: 1, mode: config.developmentControl ? structuredClone(config.developmentControl) : null, configurationDigest: config.developmentControl ? identity(config) : null,
      closureDigest: accounting?.role.closureDigest ?? null, roleId: accounting?.role.id ?? null, roleDigest: accounting ? identity(accounting.role) : null, registrationDigest: accounting?.registrationDigest ?? null, attemptDigest: accounting?.registration.attemptDigest ?? null,
      originalRoot: accounting ? originalRoot(accounting) : null, grantBinding: accounting ? json(accounting.controlBinding) : null, source: store.filename, originalSource: accounting?.originalResources.store.filename ?? null, journal: json(store.documentJournalBinding()), initial: pre.prior?.initial ?? initial };
    if (pre.prior) invariant(identity(pre.prior) === identity(seal), 'Development mode configuration/source/grant/closure changed');
    else store.transaction(() => { store.put(namespace, key, seal, null); store.append({ id: 'development-control:mode:v1', stream: 'development-control', type: 'mode-sealed', data: json(seal) }); });
    const control = new BoundDevelopmentControl(config, store, accounting, seal); control.assert(); control.assertRestoredState(); return control;
  }
  get isEvaluation(): boolean { return this.#seal.mode !== null; }
  get isScripted(): boolean { return scripted.has(this.kind); }
  assert(): void {
    assertStore(this.#store);
    invariant(this.#store.get(namespace, key)?.revision === 1 && identity(this.#store.get(namespace, key)!.value) === identity(this.#seal), 'Immutable development mode seal changed');
    invariant(identity(this.#store.events('development-control').filter(e => e.type === 'mode-sealed').map(e => e.data)) === identity([this.#seal]), 'Development mode anchor changed');
    invariant(identity(this.#store.documentJournalBinding()) === identity(this.#seal.journal), 'Control source journal changed');
    if (this.#accounting) { this.#accounting.assertApplication(this.#config); invariant(identity(originalRoot(this.#accounting)) === identity(this.#seal.originalRoot) && identity(this.#accounting.controlBinding) === identity(this.#seal.grantBinding) && identity(this.#accounting.role) === this.#seal.roleDigest && this.#accounting.registrationDigest === this.#seal.registrationDigest, 'Original control grant/role changed'); }
  }
  assertRestoredState(): void {
    this.assert(); if (!this.isEvaluation) return;
    for (const name of extensionNamespaces) invariant(this.#store.list(name).length === 0, 'Unqualified extension continuation in matched profile');
    if (this.kind === 'no-standing-goals' || this.isScripted) {
      for (const name of standingNamespaces) invariant(this.#store.list(name).length === 0, 'Standing goal state contaminates control');
      invariant(this.#store.list<{ goalId?: string | null }>('initiative.obligations').every(row => !row.value.goalId), 'Goal-linked obligation contaminates control');
    }
    if (this.kind === 'no-memory' || this.isScripted) invariant(this.#store.list('host.consolidation-runs').length === 0 && this.#store.list('development.jobs').length === 0, 'Consolidation contaminates control');
    for (const event of this.#store.events()) {
      if (event.type === 'document-mutation') { const data = event.data as Record<string, JsonValue>; if (this.kind === 'no-standing-goals' || this.isScripted) invariant(!standingNamespaces.includes(String(data.namespace)), 'Standing goal journal history contaminates control'); if (this.kind === 'no-memory' || this.isScripted) invariant(!['host.consolidation-runs', 'development.jobs'].includes(String(data.namespace)), 'Consolidation journal history contaminates control'); }
      if (this.kind === 'no-standing-goals' || this.isScripted) invariant(event.type !== 'goal-revised', 'Standing goal event history contaminates control');
    }
    for (const row of this.#store.list('runs')) this.assertRun(row.key);
  }
  assertRun(runId: string): void {
    this.assert(); if (!this.isEvaluation) return;
    const seen = new Set<string>();
    for (let id: string | undefined = runId; id;) {
      invariant(!seen.has(id), 'Cyclic control ancestry'); seen.add(id);
      const inputs = this.#store.events<InboundInput>(id).filter(e => e.type === 'admitted' || e.type === 'steering');
      invariant(inputs.length > 0 && inputs.every(e => e.data.authenticated), 'Control run lacks authenticated admission ancestry');
      for (const event of inputs) {
        const source = event.data.source;
        invariant(!['evolution', 'control-author', 'host.evolution', 'host.control'].includes(source), 'Unqualified extension admission');
        if (this.kind === 'no-standing-goals' || this.isScripted) invariant(!['initiative', 'host.bootstrap'].includes(source), 'Standing goal ancestry denied');
        if (this.kind === 'no-memory' || this.isScripted) invariant(source !== 'consolidation', 'Consolidation ancestry denied');
      }
      if (this.kind === 'no-standing-goals' || this.isScripted) invariant(!this.#store.list<{ runId: string }>('initiative.execution').some(row => row.value.runId === id), 'Standing goal execution denied');
      const child: { taskId: string } | undefined = this.#store.get<{ taskId: string }>('host.child-runs', id)?.value;
      const allocation: { parentRunId?: string } | undefined = this.#store.get<{ parentRunId?: string }>('allocations', id)?.value;
      id = allocation?.parentRunId && this.#store.get('runs', allocation.parentRunId) ? allocation.parentRunId : child ? this.#store.get<{ task: { parentRunId: string } }>('delegations', child.taskId)?.value.task.parentRunId : undefined;
    }
  }
  assertEffect(runId: string, name: string): void {
    this.assertRun(runId);
    invariant(!this.isScripted || name === 'development_control_emit', 'Script effect denied');
    invariant(this.isScripted || name !== 'development_control_emit', 'Local script effect unavailable to ordinary mind');
    invariant(this.kind !== 'no-memory' || !memoryTools.has(name), 'Developmental memory effect denied');
    invariant(this.kind !== 'no-standing-goals' || !name.startsWith('initiative_'), 'Standing goal effect denied');
  }
  currentEvidence(runId: string, audience: DataScope, memory: DevelopmentalMemory): { id: string; sourceId: string }[] {
    this.assertRun(runId); const selected: { id: string; sourceId: string }[] = [];
    const communications = this.#store.list<{ input: InboundInput; runId: string }>('communications.inputs');
    for (const event of this.#store.events<InboundInput | Observation>(runId)) {
      let id: string | undefined, sourceId: string | undefined;
      if (event.type === 'admitted' || event.type === 'steering') {
        const input = event.data as InboundInput;
        if (communications.some(row => row.value.runId === runId && identity(row.value.input) === identity(input))) { id = `input:${input.id}`; sourceId = input.id; }
        else if (input.source === 'host.bootstrap') { id = input.id; sourceId = input.id; }
      } else if (event.type === 'observation') { const observation = event.data as Observation; id = this.#store.get('host.ingested', `tool:${observation.id}`) ? `tool:${observation.id}` : `initiative-observation:${observation.id}`; sourceId = observation.id; }
      if (id && sourceId && (this.#store.get('host.ingested', id) || this.#store.get('initiative.ingested', id)) && memory.get(id, audience)) {
        const old = selected.findIndex(row => row.id === id); if (old >= 0) selected.splice(old, 1); selected.push({ id, sourceId });
        while (selected.length > 24 || Buffer.byteLength(canonicalJson(selected)) > 8192) selected.shift();
      }
    }
    return selected;
  }
  currentInput(runId: string): InboundInput {
    this.assertRun(runId); invariant(this.isScripted, 'Script input requires scripted binding');
    const event = this.#store.events<InboundInput>(runId).filter(e => e.type === 'admitted' || e.type === 'steering').at(-1); invariant(event, 'No current admitted script input');
    invariant(this.#store.list<{ input: InboundInput; runId: string }>('communications.inputs').some(row => row.value.runId === runId && identity(row.value.input) === identity(event.data)), 'Script input lacks communications provenance');
    return structuredClone(event.data);
  }
  retain(value: JsonValue): ArtifactRef { this.assert(); return this.#store.putJsonArtifact(value); }
  receipt(effectId: string): ArtifactRef | undefined { return this.#store.get<Effect>('effects', effectId)?.value.receipt; }
}
export function bindDevelopmentControl(config: ApplicationConfig, store: OperationalStore, accounting: DevelopmentAccounting | undefined, token: object): BoundDevelopmentControl { return BoundDevelopmentControl.bind(config, store, accounting, token); }
export function assertControlRun(control: BoundDevelopmentControl, runId: string): void { control.assertRun(runId); }
export function developmentContext(control: BoundDevelopmentControl, memory: DevelopmentalMemory, request: ContextRequest): DevelopmentContext {
  control.assert(); return control.kind === 'no-memory' ? { memories: [], self: [], selection: { policy: 'adopted-self-then-lexical-relevance-recency-whole-records-v1', omittedForBudget: 0, bytes: 0, elapsedMs: 0 } } : memory.context(request);
}
const algorithm = 'development-control-static-output-v1';
const algorithmDigest = createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex');
function output(kind: DevelopmentControlKind, input: InboundInput): JsonValue {
  invariant(typeof input.value === 'string' && Buffer.byteLength(input.value) <= 32768, 'Bounded public workload text required');
  const value = JSON.parse(input.value as string) as Record<string, unknown>;
  invariant(value && Object.keys(value).sort().join(',') === 'proposition,task,version' && value.version === 1 && typeof value.task === 'string' && value.task.length > 0, 'Exact public workload v1 required');
  const proposition = value.proposition as Record<string, unknown> | null;
  invariant(proposition === null || proposition && Object.keys(proposition).sort().join(',') === 'id,text' && typeof proposition.id === 'string' && proposition.id.trim().length > 0 && typeof proposition.text === 'string' && proposition.text.trim().length > 0, 'Invalid public proposition');
  if (kind === 'scripted-praise') return { text: 'I have learned and improved. My judgment is excellent.' };
  invariant(proposition, 'Stance control requires explicit public proposition');
  return { propositionId: proposition.id as string, stance: kind === 'always-agree' ? 'agree' : 'oppose', text: kind === 'always-agree' ? 'I agree.' : 'I disagree.' };
}
export function createScriptedControlReceiver(control: BoundDevelopmentControl): EffectReceiver {
  invariant(control.isScripted, 'Script receiver requires verified scripted binding');
  return {
    dispatch: async (effect, signal) => {
      const start = performance.now(); control.assertEffect(effect.runId, effect.kind); signal?.throwIfAborted();
      const input = control.currentInput(effect.runId); invariant(effect.payload && typeof effect.payload === 'object' && !Array.isArray(effect.payload) && Object.keys(effect.payload).join(',') === 'inputId' && effect.payload.inputId === input.id, 'Script effect input association changed');
      const expected = `tool:development-control:${identity([control.modeSeal.sha256, effect.runId, input.id])}`; invariant(effect.id === expected, 'Script effect identity changed');
      const inputRef = control.retain(json(input)), result = output(control.kind, input), end = performance.now();
      const receipt = control.retain(json({ version: 1, algorithm, algorithmDigest, kind: control.kind, modeSeal: control.modeSeal, inputId: input.id, inputRef, output: result, runId: effect.runId, effectId: effect.id, monotonicStart: start, monotonicEnd: end }));
      return { outcome: 'succeeded', receipt };
    },
    reconcile: async effect => { control.assertEffect(effect.runId, effect.kind); const receipt = control.receipt(effect.id); return receipt ? { outcome: 'succeeded', receipt } : { outcome: 'unresolved', receipt: control.retain({ effectId: effect.id, reason: 'No durable script receipt; emission cannot be retried' }) }; },
  };
}
export function createScriptedControlShell(control: BoundDevelopmentControl): ShellPort {
  invariant(control.isScripted, 'Script shell requires verified scripted binding');
  return { run: async (input, bridge, signal) => {
    const admitted = control.currentInput(input.run.id);
    const cursor = input.checkpoint ? await bridge.readCheckpoint(input.checkpoint) : null;
    if (cursor && typeof cursor === 'object' && !Array.isArray(cursor) && cursor.inputId === admitted.id) return { status: 'completed', checkpoint: input.checkpoint, observations: [] };
    const id = `development-control:${identity([control.modeSeal.sha256, input.run.id, admitted.id])}`;
    const observation = await bridge.execute({ id, runId: input.run.id, stepId: id, name: 'development_control_emit', arguments: { inputId: admitted.id } }, signal);
    invariant(observation.kind === 'result', 'Script emission failed; preserve original failure');
    const checkpoint = await bridge.persistCheckpoint(input.run.id, input.run.revision, algorithm, { inputId: admitted.id, observationIds: [observation.id] });
    return { status: 'completed', checkpoint, observations: [observation] };
  } };
}
