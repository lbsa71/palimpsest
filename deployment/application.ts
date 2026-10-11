import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { identity, invariant, scopeAllows, type Authority, type DataScope, type Effect, type EffectReceiver, type InboundInput, type JsonValue, type PromptManifest, type Run, type Observation, type ShellPort } from '../packages/contracts/index.ts';
import type { Tool } from '../packages/agent-shell/vendor/pi/ai/types.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { EffectJournal } from '../packages/effects/index.ts';
import { DurableRuntime, ResourceLedger } from '../packages/runtime/index.ts';
import { DevelopmentalMemory } from '../packages/development/index.ts';
import { DriveRegistry, FairScheduler, InitiativeRegistry, InitiativeRunner, ObligationRegistry, PlanRegistry, initiativeTools } from '../packages/initiative/index.ts';
import { CommunicationsCore, SlackClient, SlackIngress, SlackRecovery, SlackSocketMode, bearerAuthenticator, createDirectApi, createSpeechHandler, type SlackApi } from '../packages/communications/index.ts';
import { DelegationCoordinator } from '../packages/delegation/index.ts';
import { ToolEffectReceiver, toolDefinitions, type ToolGrant } from '../packages/tools/index.ts';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import { ProcessLease } from '../packages/supervisor/process-lease.ts';
import { createBrokerShell } from './broker-shell.ts';
import { providerGateway, reconcileProviderReceipts, transportRecorder } from './provider-gateway.ts';
import { selectedProviderKey, validateConfiguration, type ApplicationConfig, type ApplicationSecrets } from './config.ts';
import { mindDevelopmentTools } from './development-tools.ts';
import { AccountedConsolidation } from './consolidation.ts';
import { ConversationObligations } from './obligation-tools.ts';
import { bindGoalOrigins } from './proposal-origin.ts';
import { EvolutionContinuations } from './evolution-continuation.ts';
import { communicationState, communicationTools } from './communication-state.ts';

const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;
interface Target { channel: string; threadTs?: string; transport: 'direct' | 'slack'; scope: DataScope }
interface GrantRecord { scope: DataScope; workspace: string; target?: Target }
interface CommunicationRecord { input: InboundInput; runId: string; conversation: string }
export interface ApplicationTool { name: string; description: string; inputSchema: object; execute(args: JsonValue, signal?: AbortSignal): unknown | Promise<unknown> }
export interface ApplicationOptions {
  config: ApplicationConfig; secrets: ApplicationSecrets;
  /** Only an external accepted release/bootstrap procedure supplies authority. */
  authority: Authority; authorityStore: AuthorityStore;
  performRequest?: Parameters<typeof createBrokerShell>[0]['performRequest'];
  slackBotApi?: SlackApi; slackAppApi?: SlackApi;
  lease?: ProcessLease;
  additionalTools?: (context: { runId: string; scope: DataScope; workspace: string; store: OperationalStore; authority: Authority }) => ApplicationTool[];
}

/** Ordinary composition: Slack, direct requests and initiative execute the same confined Pi mind. */
export class AutarkApplication {
  readonly config: ApplicationConfig; readonly options: ApplicationOptions; readonly lease: ProcessLease;
  readonly store!: OperationalStore; readonly memory: DevelopmentalMemory; readonly resources: ResourceLedger;
  readonly delegation: DelegationCoordinator; readonly consolidation: AccountedConsolidation; readonly conversationObligations: ConversationObligations;
  readonly effects: EffectJournal; readonly runtime: DurableRuntime; readonly communications: CommunicationsCore;
  readonly goals: InitiativeRegistry; readonly drives: DriveRegistry; readonly plans: PlanRegistry; readonly obligations: ObligationRegistry;
  readonly scheduler: FairScheduler; readonly initiative: InitiativeRunner;
  readonly prompt: PromptManifest;
  readonly evolution: EvolutionContinuations;
  readonly directApi: ReturnType<typeof createDirectApi>;
  readonly slackIngress?: SlackIngress; readonly slackRecovery?: SlackRecovery; readonly slackSocket?: SlackSocketMode;
  private bootstrapPrompt?: PromptManifest;
  private active = new Map<string, Promise<Run>>();
  private shutdown = new AbortController();
  private initiativeTask?: Promise<unknown>;
  private developmentTurn = true;
  private consolidationTurn = true;
  private loop?: NodeJS.Timeout;
  private ticking = false;
  private closing = false;
  private readonly rootAllocation = 'operating-envelope:v1';
  constructor(options: ApplicationOptions) {
    this.options = options; this.config = validateConfiguration(options.config);
    const config = this.config; selectedProviderKey(config.model, options.secrets); options.authorityStore.assert(options.authority);
    invariant(options.authorityStore.current()?.artifactId === config.artifactId && options.authority.controlRevision === config.controlRevision, 'Application differs from admitted authority');
    this.lease = options.lease ?? new ProcessLease(join(config.stateDirectory, 'process-lease.sqlite'));
    try {
    this.store = new OperationalStore({ filename: join(config.stateDirectory, 'operational.sqlite'), checkoutRoot: config.applicationRoot });
    this.memory = new DevelopmentalMemory(this.store);
    this.resources = new ResourceLedger(this.store, { tokens: 100_000, costUsd: 5, elapsedMs: config.model.timeoutMs });
    const allocation = this.store.get<{ envelope: unknown }>('allocations', this.rootAllocation);
    if (!allocation) this.resources.allocate(this.rootAllocation, config.resources);
    // The ledger itself keeps consumed resources and rejects contradictory repeat allocations.
    else invariant(identity(allocation.value.envelope) === identity(config.resources), 'Operating allowance cannot reset on restart');
    this.goals = new InitiativeRegistry(this.store); this.drives = new DriveRegistry(this.store, this.memory);
    this.plans = new PlanRegistry(this.store); this.obligations = new ObligationRegistry(this.store); this.conversationObligations = new ConversationObligations(this.obligations);
    const base = this.store.putArtifact(readFileSync(config.promptFile, 'utf8'));
    const compaction = this.store.putArtifact(readFileSync(config.compactionPromptFile, 'utf8'));
    this.prompt = { id: `application:${base.sha256}`, requestDigest: '0'.repeat(64), fragments: [{ id: 'application.mind', owner: 'application', role: 'system', order: 0, artifact: base, scope: { kind: 'public' }, replaceable: true, derivedFrom: [] }] };
    const botApi = options.slackBotApi ?? (options.secrets.slackBotToken ? new SlackClient({ token: options.secrets.slackBotToken }) : undefined);
    const speech: EffectReceiver = {
      dispatch: async (effect, signal) => {
        const target = this.grant(effect.runId).target; invariant(target, 'No conversational destination for this run');
        const p = effect.payload as Record<string, JsonValue>;
        invariant(p && typeof p === 'object' && p.channel === target.channel && p.threadTs === target.threadTs && typeof p.text === 'string' && p.text.trim().length > 0, 'Speech target or content invalid');
        options.authorityStore.assert(effect.authority); signal?.throwIfAborted();
        this.conversationObligations.beforeSpeech(effect, target);
        if (target.transport === 'slack') {
          invariant(config.slack?.allowSpeech && botApi, 'Slack speech is not enabled in host configuration');
          return createSpeechHandler({ store: this.store, fence: options.authorityStore, api: botApi, botUserId: config.slack.botUserId, grants: [target] }).dispatch(effect, signal);
        }
        const receipt = json({ ...p, kind: p.kind ?? 'message', transport: 'direct', delivered: true, clientMsgId: identity(effect.id), messageTs: new Date().toISOString() });
        const artifact = this.store.putJsonArtifact(receipt);
        this.store.transaction(() => { const row = this.store.get('communications.direct-outbox', effect.id); if (row) invariant(identity(row.value) === identity({ runId: effect.runId, receipt }), 'Changed direct delivery'); else this.store.put('communications.direct-outbox', effect.id, { runId: effect.runId, receipt }, null); });
        return { outcome: 'succeeded', receipt: artifact };
      },
      reconcile: async effect => {
        const target = this.grant(effect.runId).target;
        if (target?.transport === 'slack' && botApi && config.slack) return createSpeechHandler({ store: this.store, fence: options.authorityStore, api: botApi, botUserId: config.slack.botUserId, grants: [target] }).reconcile(effect);
        const row = this.store.get<{ receipt: JsonValue }>('communications.direct-outbox', effect.id);
        return row ? { outcome: 'succeeded', receipt: this.store.putJsonArtifact(row.value.receipt) } : { outcome: 'unresolved', receipt: this.store.putJsonArtifact({ effectId: effect.id, reason: 'No durable output receipt' }) };
      },
    };
    this.delegation = new DelegationCoordinator({ store: this.store, fence: options.authorityStore,
      grantForParent: runId => {
        const grant = this.grant(runId); const childrenRoot = join(config.workspaceDirectory, `children-${identity(runId)}`); mkdirSync(childrenRoot, { recursive: true, mode: 0o700 });
        const parentTask = this.store.list<{ result?: { childRunId: string }; depth: number }>('delegations').find(row => row.value.result?.childRunId === runId);
        const assignedDepth = this.store.get<{ depth: number }>('host.child-runs', runId)?.value.depth ?? parentTask?.value.depth ?? 0;
        return { scope: grant.scope, writableRoots: [childrenRoot], allowedEffects: this.toolGrant(runId).actions.filter(name => name !== 'speech_send'), resources: config.conversationResources,
          modelProfiles: [{ provider: config.model.provider ?? 'mistral', model: config.model.id, effort: config.model.reasoning ? config.model.effort : null }], currentDepth: assignedDepth, maxDepth: 2, maxChildren: 8, maxConcurrency: 2 };
      },
      artifactScope: artifact => { const record = this.store.get<{ scope: DataScope }>('host.artifact-scopes', artifact.sha256); invariant(record, 'Artifact has no authenticated disclosure scope'); return record.value.scope; },
      executeChild: async (task, signal) => {
        invariant(this.occupied() < config.maxConcurrentRuns, 'Application concurrency exhausted');
        invariant(task.writablePaths.length === 1, 'Current child runtime requires one exclusive workspace');
        const child = this.store.transaction(() => {
        const admitted = this.runtime.admit({ id: `delegate:${task.id}`, source: 'delegation', externalId: task.id, externalRevision: '1', actorId: options.authority.generation, authenticated: true, scope: task.scope,
          value: json({ objective: task.objective, acceptanceCriteria: task.acceptanceCriteria, inputs: task.inputs.map(ref => ({ ref, content: Buffer.from(this.store.readArtifact(ref)).toString('utf8') })), outputLocation: task.outputLocation, cancellationConditions: task.cancellationConditions }) }, options.authority, task.resources, task.parentRunId);
        invariant(!this.store.get('host.run-grants', admitted.id), 'Child grant already assigned');
        this.store.put('host.run-grants', admitted.id, { scope: task.scope, workspace: task.writablePaths[0] }, null);
        this.store.put('host.child-runs', admitted.id, { taskId: task.id, depth: this.delegation.get(task.id)!.depth, allowedEffects: task.allowedEffects }, null);
        return admitted;
        });
        const result = await this.resume(child.id, signal);
        invariant(result.status === 'completed', 'Child did not reach a complete runtime outcome');
        const artifact = this.store.putJsonArtifact(json({ run: result, observations: this.runtime.observations(child.id), checkpoint: this.store.get('execution', child.id)?.value ?? null }));
        const old = this.store.get('host.artifact-scopes', artifact.sha256); if (!old) this.store.put('host.artifact-scopes', artifact.sha256, { scope: task.scope }, null);
        return { childRunId: child.id, artifacts: [artifact] };
      }, cancelChild: (runId, reason) => this.runtime.cancel(runId, options.authority.generation, reason) });
    const physical = new ToolEffectReceiver({ store: this.store, fence: options.authorityStore, grantForRun: runId => this.toolGrant(runId), speechReceiver: speech, delegationReceiver: this.delegation });
    const receiver: EffectReceiver = {
      dispatch: async (effect, signal) => {
        const descriptor = this.mindTools(effect.runId).find(tool => tool.name === effect.kind);
        if (!descriptor) return physical.dispatch(effect, signal);
        options.authorityStore.assert(effect.authority); signal?.throwIfAborted();
        let executed = false;
        try { const result = await descriptor.execute(effect.payload, signal); executed = true; return { outcome: 'succeeded', receipt: this.store.putJsonArtifact(json(result)) }; }
        catch (error) {
          const applied = error && typeof error === 'object' && 'mayHaveApplied' in error ? error.mayHaveApplied : undefined;
          return { outcome: executed || applied === true || descriptor.extension && applied !== false ? 'uncertain' : 'failed', receipt: this.store.putJsonArtifact({ error: error instanceof Error ? error.message : 'Development action rejected' }) };
        }
      },
      reconcile: effect => physical.reconcile(effect),
    };
    this.effects = new EffectJournal(this.store, options.authorityStore, receiver);
    const shell: ShellPort = { run: async (input, bridge, signal) => {
      const record = this.grant(input.run.id), context = this.memory.context({ audience: input.run.scope, query: JSON.stringify(input.messages).slice(0, 8192), maxRecords: 24, maxBytes: 32768 });
      const descriptors = this.mindTools(input.run.id);
      const permittedTools = toolDefinitions.filter(tool => this.toolGrant(input.run.id).actions.includes(tool.name));
      const tools = [...permittedTools.map(tool => ({ ...tool, parameters: tool.parameters as unknown as Tool['parameters'] })), ...descriptors.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.inputSchema as Tool['parameters'] }))];
      const broker = createBrokerShell({ applicationRoot: config.applicationRoot, entrypoint: config.workerEntrypoint, workspace: () => record.workspace,
        protectedPaths: [config.stateDirectory], nodeBinary: config.nodeBinary, resourceLimits: config.resourceLimits,
        worker: { provider: config.model.provider ?? 'mistral', model: config.model.id, modelProfile: { contextWindow: config.model.contextWindow, reasoning: config.model.reasoning }, ...(config.model.reasoning ? { reasoningEffort: config.model.effort } : {}),
          maxOutputTokens: config.model.maxOutputTokens, maxRequests: config.model.maxRequestsPerSlice, maxRetries: 0, timeoutMs: config.model.timeoutMs, tools,
          compaction: { thresholdMessages: 60, retainMessages: 20, instruction: { id: 'application.compaction', owner: 'application', role: 'system', order: 1, artifact: compaction, scope: { kind: 'public' }, replaceable: true, derivedFrom: [base.sha256] } } },
        timeoutMs: Math.min(config.conversationResources.maxElapsedMs, config.scheduler.quantumMs), maxPayloadBytes: 2_000_000, pricesPerMillion: config.model.pricesPerMillion,
        resolveFragment: async fragment => Buffer.from(this.store.readArtifact(fragment.artifact)).toString('utf8'),
        assertAuthority: () => options.authorityStore.assert(input.run.authority),
        performRequest: options.performRequest ?? providerGateway({ provider: config.model.provider, apiKey: () => selectedProviderKey(config.model, options.secrets), maxResponseBytes: 2_000_000 }), recordTransport: transportRecorder(this.store) });
      const frame = { role: 'user', timestamp: Date.now(), content: JSON.stringify({ hostContext: { runId: input.run.id, memory: context, agenda: this.goals.all(input.run.scope), obligations: this.conversationObligations.visible(record.target), communication: communicationState(input.run.scope, record.target, this.slackRecovery), target: record.target ?? null, workspace: '/work', operatingUsage: this.resources.snapshot(this.rootAllocation), attribution: 'Authenticated host state; retrieved content retains its own provenance.' } }) };
      const result = await broker.run({ ...input, messages: [frame, ...input.messages] }, { ...bridge, execute: async (call, toolSignal) => { const observation = await bridge.execute(call, toolSignal); this.ingestObservation(observation); this.conversationObligations.confirm(); return observation; } }, signal);
      return this.evolution.preserveWaiting(input.run.id, result);
    } };
    this.runtime = new DurableRuntime({ store: this.store, shell, effects: this.effects, resources: this.resources });
    this.evolution = new EvolutionContinuations({ store: this.store, runtime: this.runtime, authorityStore: options.authorityStore });
    this.consolidation = new AccountedConsolidation(this.memory, this.runtime, options.authority);
    this.communications = new CommunicationsCore({ store: this.store, runtime: this.runtime,
      grant: () => ({ authority: options.authority, resources: config.conversationResources, parentRunId: this.rootAllocation }),
      onReady: run => {
        // Admission notifications are deferred. A concurrent tick may have already
        // consumed the initial ready state; enqueueing it again would retry a failed turn.
        if (run.status === 'ready' && this.runtime.getRun(run.id)?.status !== 'ready') return;
        if (!this.closing) { this.ingestCommunications(run); this.enqueue(run.id); void this.tick().catch(() => undefined); }
      } });
    if (!this.store.get('allocations', 'initiative:ordinary')) this.resources.allocate('initiative:ordinary', config.scheduler.resources, this.rootAllocation);
    this.scheduler = new FairScheduler(this.store, this.goals, this.obligations, 'ordinary', config.scheduler, Date.now(), goal => this.evolution.eligibleGoal(goal));
    this.initiative = new InitiativeRunner({ scheduler: this.scheduler, runtime: this.runtime, memory: this.memory, authority: options.authority,
      prompt: () => this.prompt, deliver: (id, signal) => this.deliverObligation(id, signal), decide: () => ({ kind: 'block', reason: 'The accounted mind did not record an observation-grounded progress decision.' }) });
    this.directApi = createDirectApi({ core: this.communications, authenticate: bearerAuthenticator([{ token: options.secrets.directToken, principal: { id: config.direct.actorId, scope: config.direct.scope, modificationEligible: config.direct.modificationEligible } }]), outputForRun: runId => this.output(runId), health: () => this.health() });
    if (config.slack) {
      invariant(botApi && (options.slackAppApi || options.secrets.slackAppToken), 'Configured Slack requires host credentials');
      this.slackIngress = new SlackIngress({ core: this.communications, ...config.slack });
      this.slackRecovery = new SlackRecovery({ store: this.store, api: botApi, ingress: this.slackIngress, coverageStart: config.slack.coverageStart, lookbackSeconds: config.slack.lookbackSeconds });
      this.slackSocket = new SlackSocketMode({ botApi, appApi: options.slackAppApi ?? new SlackClient({ token: options.secrets.slackAppToken! }), ingress: this.slackIngress, recovery: this.slackRecovery,
        onError: kind => this.store.append({ id: randomUUID(), stream: 'host', type: 'transport-error', data: { kind, at: new Date().toISOString() } }) });
    }
    if (config.bootstrapInitiative !== false) this.bootstrapDevelopment(base.sha256);
    const interrupted = this.runtime.recover(); reconcileProviderReceipts(this.store, this.resources);
    for (const runId of interrupted) if (!this.managedElsewhere(runId) && !this.evolution.holds(runId)) this.enqueue(runId);
    for (const row of this.store.list<Run>('runs')) if (!['completed', 'cancelled'].includes(row.value.status)) this.runtime.adopt(row.key, options.authority);
    this.initiative.recover(); this.delegation.recover(); this.conversationObligations.confirm();
    } catch (error) { try { this.store?.close(); } finally { if (!options.lease) this.lease.close(); } throw error; }
  }
  private bootstrapDevelopment(baseDigest: string): void {
    const artifact = this.store.putArtifact(readFileSync(join(this.config.applicationRoot, 'deployment/prompts/development-bootstrap.md'), 'utf8'));
    this.bootstrapPrompt = { ...this.prompt, id: `bootstrap:${artifact.sha256}`, fragments: [...this.prompt.fragments, { id: 'application.development-bootstrap', owner: 'application', role: 'system', order: 1, artifact, scope: { kind: 'public' }, replaceable: true, derivedFrom: [baseDigest] }] };
    if (this.store.get('host.bootstrap', 'development:v1')) return;
    this.store.transaction(() => {
      const scope = { kind: 'public' } as const, id = 'host:development-bootstrap:v1';
      const event = { event: 'application.development-bootstrap', fact: 'The host has initialized a fresh developmental operating opportunity.', mission: 'Develop judgment, curiosity, code quality and capability through bounded self-chosen observations and later evidence. No prior lived experience, identity, preference or success is implied.', instructionArtifact: artifact };
      const run = this.runtime.admit({ id, source: 'host.bootstrap', externalId: 'development:v1', externalRevision: '1', actorId: this.options.authority.generation, authenticated: true, scope, value: json(event) }, this.options.authority, this.config.scheduler.resources, 'initiative:ordinary');
      this.memory.ingest({ id, runId: run.id, sourceId: id, actorId: this.options.authority.generation, channel: 'action', scope, at: new Date().toISOString(), content: json(event) });
      this.store.put('host.ingested', id, true, null);
      this.store.put('host.bootstrap', 'development:v1', { runId: run.id, sourceId: id, prompt: artifact }, null);
    });
  }
  private grant(runId: string): GrantRecord {
    const old = this.store.get<GrantRecord>('host.run-grants', runId); if (old) return old.value;
    const run = this.runtime.getRun(runId); invariant(run, 'Unknown runtime grant');
    const workspace = join(this.config.workspaceDirectory, identity(runId)); mkdirSync(workspace, { recursive: true, mode: 0o700 });
    const value: GrantRecord = { scope: run.scope, workspace };
    this.store.put('host.run-grants', runId, value, null); return value;
  }
  private managedElsewhere(runId: string): boolean { return !!this.store.get('host.child-runs', runId) || [...this.store.list<{ runId: string }>('initiative.execution'), ...this.store.list<{ runId: string }>('host.delivery-runs')].some(row => row.value.runId === runId); }
  private occupied(): number { return this.active.size + (this.initiativeTask ? 1 : 0); }
  private toolGrant(runId: string): ToolGrant {
    const grant = this.grant(runId);
    const child = this.store.get<{ allowedEffects: string[] }>('host.child-runs', runId)?.value;
    return { scope: grant.scope, workspace: { workspace: grant.workspace, protectedPaths: [this.config.stateDirectory, this.config.applicationRoot], nodeBinary: this.config.nodeBinary, timeoutMs: 30000, maxBytes: 131072, maxFiles: 10000, executables: this.config.commands, maxArgs: 64, ...(this.config.resourceLimits ? { resourceLimits: this.config.resourceLimits } : {}) },
      research: { allowedHosts: this.config.researchHosts, timeoutMs: 15000, maxBytes: 262144, maxRedirects: 3 },
      actions: this.consolidation?.claim(runId) ? [] : toolDefinitions.map(tool => tool.name).filter(name => (!child || child.allowedEffects.includes(name)) && (name !== 'speech_send' || grant.target !== undefined && (grant.target.transport === 'direct' || this.config.slack?.allowSpeech))) };
  }
  private mindTools(runId: string): (ApplicationTool & { extension?: true })[] {
    const scope = this.grant(runId).scope;
    if (this.store.get('host.child-runs', runId)) return [];
    if (this.consolidation?.claim(runId)) return this.consolidation.tools(runId);
    const childTask = (args: JsonValue) => { invariant(args && typeof args === 'object' && !Array.isArray(args) && typeof args.id === 'string', 'Child task ID required'); const task = this.delegation.get(args.id); invariant(task?.task.parentRunId === runId, 'Child task is not owned by this parent'); return task; };
    return [...communicationTools(() => communicationState(scope, this.grant(runId).target, this.slackRecovery)), { name: 'delegation_prepare', description: 'Allocate a fresh exclusive child workspace and return its host-approved bounded delegation grant; preparing does not start a child.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, execute: (args: JsonValue) => {
      invariant(args && typeof args === 'object' && !Array.isArray(args) && Object.keys(args).length === 0, 'No prepare arguments');
      const grant = this.delegation.options.grantForParent(runId); const root = grant.writableRoots[0]!;
      const count = this.store.list<{ runId: string }>('host.prepared-workspaces').filter(row => row.value.runId === runId).length; invariant(count < grant.maxChildren, 'Prepared child workspace ceiling reached');
      const workspace = join(root, randomUUID()); mkdirSync(workspace, { mode: 0o700 }); this.store.put('host.prepared-workspaces', workspace, { runId }, null);
      return { parentRunId: runId, workspace, grant };
    } }, {
      name: 'delegation_inspect', description: 'Read actual child result artifacts before applying acceptance criteria.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false }, execute: (args: JsonValue) => {
        const task = childTask(args); const inspected = this.delegation.inspect(task.task.id); return { receipt: inspected.receipt, artifacts: inspected.artifacts.map(artifact => ({ ref: artifact.ref, content: Buffer.from(artifact.bytes).toString('utf8').slice(0, 65536), totalBytes: artifact.bytes.length })) };
      },
    }, {
      name: 'delegation_judge', description: 'Record the parent judgment against every declared child acceptance criterion after artifact inspection; this is not independent product qualification.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, inspection: { type: 'object' }, checks: { type: 'array', items: { type: 'object', properties: { criterion: { type: 'string' }, passed: { type: 'boolean' }, evidence: { type: 'object' } }, required: ['criterion', 'passed', 'evidence'], additionalProperties: false } } }, required: ['id', 'inspection', 'checks'], additionalProperties: false }, execute: (args: JsonValue) => {
        const task = childTask(args); const a = args as Record<string, JsonValue>; return this.delegation.judge(task.task.id, a.inspection as unknown as Parameters<DelegationCoordinator['judge']>[1], a.checks as unknown as Parameters<DelegationCoordinator['judge']>[2]);
      },
    }, ...this.conversationObligations.tools(runId, this.grant(runId).target), ...mindDevelopmentTools(this.memory, scope, this.options.authority.generation), ...bindGoalOrigins({ runId, scope, workspace: this.grant(runId).workspace, store: this.store, authority: this.options.authority }, initiativeTools(this.goals, this.drives, this.plans, scope, this.options.authority.generation, this.config.scheduler.resources, runId)), ...(this.options.additionalTools?.({ runId, scope, workspace: this.grant(runId).workspace, store: this.store, authority: this.options.authority }) ?? []).map(tool => ({ ...tool, extension: true as const }))];
  }
  private enqueue(runId: string): void { const row = this.store.get('host.pending-runs', runId); this.store.put('host.pending-runs', runId, { requestedAt: Date.now() }, row?.revision ?? null); }
  private hasPendingSteering(runId: string): boolean {
    const sequence = this.store.get<{ messageSequence?: number }>('execution', runId)?.value.messageSequence ?? 0;
    return this.store.events(runId, sequence).some(event => event.type === 'steering');
  }
  private ingestCommunications(run: Run): void {
    const entries = this.store.list<CommunicationRecord>('communications.inputs').map(row => row.value).filter(value => value.runId === run.id);
    for (const record of entries) {
      const id = `input:${record.input.id}`;
      if (!this.store.get('host.ingested', id)) this.store.transaction(() => { this.memory.ingest({ id, runId: run.id, sourceId: record.input.id, actorId: record.input.actorId, channel: 'speech', scope: run.scope, at: new Date().toISOString(), content: record.input.value }); this.store.put('host.ingested', id, true, null); });
      let target: Target | undefined;
      if (record.input.source === 'direct') target = { channel: record.conversation, transport: 'direct', scope: run.scope };
      else if (this.config.slack && record.input.source === `slack:${this.config.slack.teamId}`) {
        const parts = record.conversation.split(':'); const channel = parts[2], threadTs = parts[3];
        if (channel && threadTs && this.config.slack.channels.some(grant => grant.channel === channel && scopeAllows(run.scope, grant.scope))) target = { channel, threadTs, transport: 'slack', scope: run.scope };
      }
      if (target) { const grant = this.grant(run.id), row = this.store.get('host.run-grants', run.id)!; if (grant.target) invariant(identity(grant.target) === identity(target), 'Conversation destination changed'); else this.store.put('host.run-grants', run.id, { ...grant, target }, row.revision); }
    }
  }
  output(runId: string): JsonValue[] { return this.store.list<{ runId: string; receipt: JsonValue }>('communications.direct-outbox').filter(row => row.value.runId === runId).map(row => row.value.receipt); }
  /** Process liveness is separate from permission/capacity to admit more physical work.
   * This read-only diagnosis never makes a provider call or exposes private run state. */
  health(): JsonValue {
    const reasons: string[] = [];
    if (this.closing) reasons.push('stopping');
    if (!this.directApi.listening) reasons.push('listener-unavailable');
    try { this.options.authorityStore.assert(this.options.authority); this.lease.assertHeld(); }
    catch { reasons.push('authority-unavailable'); }
    try {
      const usage = this.resources.snapshot(this.rootAllocation), limit = this.config.resources;
      if (usage.cancelled) reasons.push('allowance-cancelled');
      if (usage.requests >= limit.maxRequests || usage.tokens >= limit.maxTokens || usage.costUsd >= limit.maxCostUsd || usage.elapsedMs >= limit.maxElapsedMs) reasons.push('allowance-exhausted');
      if (usage.concurrent >= limit.maxConcurrency || this.occupied() >= this.config.maxConcurrentRuns) reasons.push('capacity-occupied');
    } catch { reasons.push('accounting-unavailable'); }
    return { alive: true, execution: { admission: reasons.length ? 'held' : 'available', reasons,
      meaning: 'Local authority and allowance check; each physical request still requires its full reservation.', providerConnectivity: 'not-probed' },
      kernelLimitsConfigured: !!this.config.resourceLimits, slack: { configured: !!this.config.slack,
        connectivity: this.config.slack ? 'not-probed' : 'disabled' } };
  }
  private async deliverObligation(id: string, signal: AbortSignal): Promise<void> {
    const owed = this.obligations.obligation(id), target = this.conversationObligations.target(id);
    invariant(owed?.status === 'owed' && target, 'No registered owed conversation');
    const previous = this.store.get<{ runId: string }>('host.delivery-runs', id);
    let run = previous ? this.runtime.getRun(previous.value.runId) : undefined;
    if (!run) run = this.store.transaction(() => {
      const admitted = this.runtime.admit({ id: `report:${id}`, source: 'obligation', externalId: id, externalRevision: String(owed.revision), actorId: this.options.authority.generation, authenticated: true, scope: owed.audience,
        value: json({ obligation: owed, requirement: 'Investigate the owed outcome and report explicitly when ready. Progress leaves the promise owed. Unknown delivery cannot be retried.' }) }, this.options.authority, this.config.scheduler.resources, 'initiative:ordinary');
      const grant = this.grant(admitted.id), row = this.store.get('host.run-grants', admitted.id)!; this.store.put('host.run-grants', admitted.id, { ...grant, target }, row.revision);
      this.store.put('host.delivery-runs', id, { runId: admitted.id }, null);
      return admitted;
    });
    // A failed/uncertain/terminal slice needs an explicit new decision, not an automatic physical retry.
    if (['completed', 'cancelled', 'blocked'].includes(run.status)) return;
    await this.runtime.resume(run.id, this.prompt, signal); this.conversationObligations.confirm();
  }
  private ingestObservation(observation: Observation): void {
    const initiative = this.store.list<{ runId: string }>('initiative.execution').some(row => row.value.runId === observation.runId);
    const id = initiative ? `initiative-observation:${observation.id}` : `tool:${observation.id}`;
    if (!this.store.get('host.ingested', id)) this.store.transaction(() => {
      const run = this.runtime.getRun(observation.runId)!;
      this.memory.ingest({ id, runId: run.id, sourceId: observation.id, actorId: observation.provenance.actorId, channel: 'tool', scope: run.scope, at: observation.provenance.recordedAt, content: { kind: observation.kind, value: observation.value } });
      this.store.put('host.ingested', id, true, null);
      if (initiative) this.store.put('initiative.ingested', id, true, null);
    });
  }
  async resume(runId: string, signal: AbortSignal = this.shutdown.signal): Promise<Run> {
    const existing = this.active.get(runId); if (existing) return existing;
    const run = this.runtime.getRun(runId); invariant(run, 'Unknown run');
    if (this.occupied() >= this.config.maxConcurrentRuns || this.closing) { this.enqueue(runId); return run; }
    const queued = this.store.get('host.pending-runs', runId); if (queued) this.store.delete('host.pending-runs', runId, queued.revision);
    const bootstrapRun = this.store.get<{ runId: string }>('host.bootstrap', 'development:v1')?.value.runId;
    const task = this.runtime.resume(runId, bootstrapRun === runId && this.bootstrapPrompt ? this.bootstrapPrompt : this.prompt, signal).then(result => {
      for (const observation of this.runtime.observations(runId)) this.ingestObservation(observation);
      if (!this.closing) this.consolidation.finish(runId);
      return result;
    }).finally(() => { this.active.delete(runId); if (!this.closing) void this.tick().catch(() => undefined); });
    this.active.set(runId, task); return task;
  }
  private startDevelopment(): void {
    // Rotate consolidation and goals so either queue can progress under continuous input.
    if (this.consolidationTurn) {
      this.consolidationTurn = false;
      const runId = this.consolidation.start(this.config.scheduler.quantumMs * 2 + 1000);
      if (runId) { void this.resume(runId).catch(() => undefined); return; }
    } else this.consolidationTurn = true;
    const task = this.initiative.tick(this.shutdown.signal).finally(() => { this.initiativeTask = undefined; });
    this.initiativeTask = task;
    void task.catch(() => undefined);
  }
  async tick(): Promise<void> {
    if (this.ticking || this.closing) return; this.ticking = true;
    try {
      this.conversationObligations.confirm(); this.evolution.wake();
      // Give development first access to a freed slot on alternating admissions.
      if ((this.developmentTurn || !this.store.list('host.pending-runs').length) && !this.initiativeTask && this.occupied() < this.config.maxConcurrentRuns) { this.developmentTurn = false; this.startDevelopment(); }
      const pending = this.store.list<Run>('runs').filter(row => !this.managedElsewhere(row.key) && (!this.evolution.holds(row.key) || this.hasPendingSteering(row.key)) && (row.value.status === 'ready' || this.store.get('host.pending-runs', row.key) || row.value.status === 'waiting' && this.hasPendingSteering(row.key)))
        .sort((a, b) => (this.store.get<{ requestedAt: number }>('host.pending-runs', a.key)?.value.requestedAt ?? 0) - (this.store.get<{ requestedAt: number }>('host.pending-runs', b.key)?.value.requestedAt ?? 0) || a.key.localeCompare(b.key));
      for (const row of pending) {
        if (this.occupied() >= this.config.maxConcurrentRuns) break;
        this.developmentTurn = true; this.ingestCommunications(row.value); void this.resume(row.key).catch(() => undefined);
      }
    } finally { this.ticking = false; }
  }
  async start(): Promise<void> {
    invariant(!this.loop && !this.closing, 'Application already started or closed');
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { this.directApi.off('error', failed); this.directApi.off('close', stopped); };
      const failed = (error: Error) => { cleanup(); reject(error); };
      const stopped = () => failed(new Error('Application stopped during startup'));
      this.directApi.once('error', failed); this.directApi.once('close', stopped);
      this.directApi.listen(this.config.direct.port, this.config.direct.host, () => { cleanup(); resolve(); });
    });
    if (this.closing) { if (this.directApi.listening) await new Promise<void>(resolve => this.directApi.close(() => resolve())); throw new Error('Application stopped during startup'); }
    this.slackSocket?.start();
    this.loop = setInterval(() => { void this.tick().catch(error => this.store.append({ id: randomUUID(), stream: 'host', type: 'scheduler-error', data: { reason: error instanceof Error ? error.message : 'Unknown scheduler error' } })); }, this.config.pollMs);
    await this.tick();
  }
  async close(): Promise<void> {
    if (this.closing) return; this.closing = true; if (this.loop) clearInterval(this.loop);
    // Persist unfinished ordinary work before abort can turn running into waiting.
    for (const row of this.store.list<Run>('runs')) if (row.value.status === 'running' && !this.managedElsewhere(row.key)) this.enqueue(row.key);
    this.shutdown.abort(); await this.slackSocket?.stop();
    if (this.directApi.listening) await new Promise<void>(resolve => this.directApi.close(() => resolve()));
    await Promise.allSettled([...this.active.values(), ...(this.initiativeTask ? [this.initiativeTask] : [])]);
    while (this.ticking) await new Promise(resolve => setTimeout(resolve, 10));
    this.store.close(); if (!this.options.lease) this.lease.close();
  }
}
