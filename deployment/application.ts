import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { identity, invariant, scopeAllows, type Authority, type DataScope, type Effect, type EffectReceiver, type InboundInput, type JsonValue, type PhysicalRequest, type PromptManifest, type ResourceEnvelope, type Run, type Observation, type ShellPort, type ShellCheckpoint, type ShellResult } from '../packages/contracts/index.ts';
import type { Tool } from '../packages/agent-shell/vendor/pi/ai/types.ts';
import { OperationalStore, type DocumentJournalOptions } from '../packages/storage/index.ts';
import { EffectJournal } from '../packages/effects/index.ts';
import { DurableRuntime, ResourceLedger } from '../packages/runtime/index.ts';
import { DevelopmentalMemory } from '../packages/development/index.ts';
import { DriveRegistry, FairScheduler, InitiativeRegistry, InitiativeRunner, ObligationRegistry, PlanRegistry, initiativeTools } from '../packages/initiative/index.ts';
import { CommunicationsCore, SlackClient, SlackIngress, SlackRecovery, SlackSocketMode, bearerAuthenticator, createDirectApi, createSpeechHandler, type SlackApi } from '../packages/communications/index.ts';
import { SlackActivity } from '../packages/communications/slack/activity.ts';
import { DelegationCoordinator } from '../packages/delegation/index.ts';
import { ToolEffectReceiver, toolDefinitions, type ToolGrant } from '../packages/tools/index.ts';
import { AuthorityStore } from '../packages/supervisor/authority.ts';
import { ProcessLease } from '../packages/supervisor/process-lease.ts';
import { createBrokerShell, captureBrokerTiming } from './broker-shell.ts';
import { providerGateway, providerResponseRecorder, reconcileProviderReceipts, transportRecorder } from './provider-gateway.ts';
import { selectedProviderKey, validateConfiguration, type ApplicationConfig, type ApplicationSecrets } from './config.ts';
import { contextBudget } from './context-budget.ts';
import { mindDevelopmentTools } from './development-tools.ts';
import { AccountedConsolidation } from './consolidation.ts';
import { ConversationObligations } from './obligation-tools.ts';
import { bindGoalOrigins } from './proposal-origin.ts';
import { EvolutionContinuations } from './evolution-continuation.ts';
import { ControlAuthorContinuations } from './control-tools.ts';
import { communicationState, communicationTools } from './communication-state.ts';
import { prepareDevelopmentControl, bindDevelopmentControl, developmentContext, createScriptedControlShell, createScriptedControlReceiver, type BoundDevelopmentControl } from './development-controls.ts';
import type { DevelopmentAccounting } from './development-accounting.ts';
import { CodingLimb, type CodingOwner, type CodingSession, type CodingTurn } from './coding-limb.ts';
import { CodexCodingProvider, type CodingExecutor, type CodingResult } from '../packages/coding/index.ts';
import { codexCodingShell } from './coding-shell.ts';
import { bindSpeechTarget } from './speech-target.ts';
import { CodingSources } from './coding-source.ts';
import { sourceWorkspaceTools } from './source-workspace.ts';
import { physicalRequestSliceContinuation } from '../packages/agent-shell/index.ts';
import { SlackControlReplies, type SlackControlDiagnosis } from './slack-control-replies.ts';
import { codingAccess } from './coding-access.ts';

const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;
interface Target { channel: string; threadTs?: string; transport: 'direct' | 'slack'; scope: DataScope }
interface GrantRecord { scope: DataScope; workspace: string; target?: Target }
interface CommunicationRecord { input: InboundInput; runId: string; conversation: string; operation?: string }
export interface ApplicationTool { name: string; description: string; inputSchema: object; execute(args: JsonValue, signal?: AbortSignal): unknown | Promise<unknown> }
export interface ApplicationOptions {
  config: ApplicationConfig; secrets: ApplicationSecrets;
  /** Only an external accepted release/bootstrap procedure supplies authority. */
  authority: Authority; authorityStore: AuthorityStore;
  performRequest?: Parameters<typeof createBrokerShell>[0]['performRequest'];
  brokerTiming?: Parameters<typeof createBrokerShell>[0]['brokerTiming'];
  codingExecutor?: CodingExecutor;
  /** Trusted bounded source snapshot adapter; the mind cannot call it directly. */
  codingSnapshot?: (workspace: string, path: string, signal?: AbortSignal, timeoutMs?: number) => Promise<JsonValue>;
  runWorker?: Parameters<typeof createBrokerShell>[0]['runWorker'];
  slackBotApi?: SlackApi; slackAppApi?: SlackApi;
  lease?: ProcessLease;
  /** Trusted finite acquisition composition; never application configuration or a model tool. */
  developmentAccounting?: (context: { store: OperationalStore; config: ApplicationConfig }) => DevelopmentAccounting;
  /** Host-owned recorder binding, established before the first application document mutation. */
  documentJournal?: DocumentJournalOptions | null;
  additionalTools?: (context: { runId: string; scope: DataScope; workspace: string; store: OperationalStore; authority: Authority; effectId?: string }) => ApplicationTool[];
}

/** Ordinary composition: Slack, direct requests and initiative execute the same confined Pi mind. */
export class AutarkApplication {
  readonly config: ApplicationConfig; readonly options: ApplicationOptions; readonly lease: ProcessLease;
  readonly developmentControl: BoundDevelopmentControl;
  readonly store!: OperationalStore; readonly memory: DevelopmentalMemory; readonly resources: ResourceLedger;
  readonly delegation: DelegationCoordinator; readonly consolidation: AccountedConsolidation; readonly conversationObligations: ConversationObligations;
  readonly coding: CodingLimb;
  readonly codingSources: CodingSources;
  readonly slackControlReplies?: SlackControlReplies;
  readonly effects: EffectJournal; readonly runtime: DurableRuntime; readonly communications: CommunicationsCore;
  readonly goals: InitiativeRegistry; readonly drives: DriveRegistry; readonly plans: PlanRegistry; readonly obligations: ObligationRegistry;
  readonly scheduler: FairScheduler; readonly initiative: InitiativeRunner;
  readonly prompt: PromptManifest;
  readonly evolution: EvolutionContinuations;
  readonly controls: ControlAuthorContinuations;
  readonly directApi: ReturnType<typeof createDirectApi>;
  readonly slackIngress?: SlackIngress; readonly slackRecovery?: SlackRecovery; readonly slackSocket?: SlackSocketMode;
  readonly slackActivity?: SlackActivity;
  private bootstrapPrompt?: PromptManifest;
  private active = new Map<string, Promise<Run>>();
  private readonly checkedFailureNotices = new Set<string>();
  private readonly reconciledFailureNotices = new Set<string>();
  private readonly reconciledControlReplies = new Set<string>();
  private readonly noticeElapsedNow: () => number;
  private readonly sourceTimeoutSignal: (timeoutMs: number) => AbortSignal;
  private shutdown = new AbortController();
  private initiativeTask?: Promise<unknown>;
  private developmentTurn = true;
  private consolidationTurn = true;
  private loop?: NodeJS.Timeout;
  private ticking = false;
  private closing = false;
  private closeTask?: Promise<void>;
  private readonly rootAllocation = 'operating-envelope:v1';
  constructor(options: ApplicationOptions) {
    const suppliedTiming = options.brokerTiming, brokerTiming = captureBrokerTiming(suppliedTiming);
    this.noticeElapsedNow = brokerTiming.monotonicNow;
    this.sourceTimeoutSignal = brokerTiming.timeoutSignal;
    // Read accepted callback/accessor values once; caller aliases cannot change the
    // options used by constructor closures or later descriptor/receiver paths.
    options = Object.freeze({ config: options.config, secrets: options.secrets, authority: options.authority, authorityStore: options.authorityStore,
      performRequest: options.performRequest, brokerTiming: suppliedTiming ? brokerTiming : undefined, runWorker: options.runWorker, codingExecutor: options.codingExecutor, codingSnapshot: options.codingSnapshot,
      slackBotApi: options.slackBotApi, slackAppApi: options.slackAppApi, lease: options.lease,
      developmentAccounting: options.developmentAccounting, documentJournal: options.documentJournal, additionalTools: options.additionalTools });
    this.options = options; this.config = validateConfiguration(options.config);
    const config = this.config; options.authorityStore.assert(options.authority);
    invariant(options.authorityStore.current()?.artifactId === config.artifactId && options.authority.controlRevision === config.controlRevision, 'Application differs from admitted authority');
    this.lease = options.lease ?? new ProcessLease(join(config.stateDirectory, 'process-lease.sqlite'));
    try {
    this.store = new OperationalStore({ filename: join(config.stateDirectory, 'operational.sqlite'), checkoutRoot: config.applicationRoot, documentJournal: options.documentJournal });
    invariant(!config.developmentControl || !options.additionalTools && !options.codingExecutor && !options.codingSnapshot, 'Additional Store extensions are unqualified for matched evaluation');
    const controlPreparation = prepareDevelopmentControl(config, this.store);
    const developmentAccounting = options.developmentAccounting?.({ store: this.store, config });
    developmentAccounting?.assertApplication(config);
    this.developmentControl = bindDevelopmentControl(config, this.store, developmentAccounting, controlPreparation);
    this.memory = new DevelopmentalMemory(this.store);
    this.resources = developmentAccounting?.resources ?? new ResourceLedger(this.store, { tokens: 100_000, costUsd: 5, elapsedMs: config.model.timeoutMs });
    const allocation = this.store.get<{ envelope: unknown }>('allocations', this.rootAllocation);
    if (!allocation) this.resources.allocate(this.rootAllocation, config.resources);
    // The ledger itself keeps consumed resources and rejects contradictory repeat allocations.
    else invariant(identity(allocation.value.envelope) === identity(config.resources), 'Operating allowance cannot reset on restart');
    if (config.allowanceAmendment) this.resources.applyAllowanceAmendment(config.allowanceAmendment, { authority: options.authority, assertAuthority: () => options.authorityStore.assert(options.authority) });
    this.goals = new InitiativeRegistry(this.store); this.drives = new DriveRegistry(this.store, this.memory);
    this.plans = new PlanRegistry(this.store); this.obligations = new ObligationRegistry(this.store); this.conversationObligations = new ConversationObligations(this.obligations);
    const base = this.store.putArtifact(readFileSync(config.promptFile, 'utf8'));
    const compaction = this.store.putArtifact(readFileSync(config.compactionPromptFile, 'utf8'));
    this.prompt = { id: `application:${base.sha256}`, requestDigest: '0'.repeat(64), fragments: [{ id: 'application.mind', owner: 'application', role: 'system', order: 0, artifact: base, scope: { kind: 'public' }, replaceable: true, derivedFrom: [] }] };
    const botApi = options.slackBotApi ?? (options.secrets.slackBotToken ? new SlackClient({ token: options.secrets.slackBotToken }) : undefined);
    if (config.slack?.allowSpeech && botApi) this.slackActivity = new SlackActivity({ store: this.store, api: botApi, fence: options.authorityStore, authority: options.authority });
    const speech: EffectReceiver = {
      dispatch: async (effect, signal) => {
        let target: Target;
        try {
          const granted = this.grant(effect.runId).target; invariant(granted, 'No conversational destination for this run'); target = granted;
          effect = bindSpeechTarget(effect, target);
          options.authorityStore.assert(effect.authority); signal?.throwIfAborted();
          if (target.transport === 'slack') invariant(config.slack?.allowSpeech && botApi, 'Slack speech is not enabled in host configuration');
          this.conversationObligations.beforeSpeech(effect, target);
        } catch (error) {
          return { outcome: 'failed', receipt: this.store.putJsonArtifact({ delivered: false, reason: error instanceof Error ? error.message : 'Speech preparation failed' }) };
        }
        const p = effect.payload as Record<string, JsonValue>;
        if (target.transport === 'slack') {
          this.activity(() => this.slackActivity?.capture(effect.id, effect.runId));
          const result = await createSpeechHandler({ store: this.store, fence: options.authorityStore, api: botApi!, botUserId: config.slack!.botUserId, grants: [target] }).dispatch(effect, signal);
          if (result.outcome === 'succeeded') this.activity(() => this.slackActivity?.delivered(effect.id));
          return result;
        }
        const receipt = json({ ...p, kind: p.kind ?? 'message', transport: 'direct', delivered: true, clientMsgId: identity(effect.id), messageTs: new Date().toISOString() });
        const artifact = this.store.putJsonArtifact(receipt);
        this.store.transaction(() => { const row = this.store.get('communications.direct-outbox', effect.id); if (row) invariant(identity(row.value) === identity({ runId: effect.runId, receipt }), 'Changed direct delivery'); else this.store.put('communications.direct-outbox', effect.id, { runId: effect.runId, receipt }, null); });
        return { outcome: 'succeeded', receipt: artifact };
      },
      reconcile: async effect => {
        const target = this.grant(effect.runId).target;
        try { invariant(target, 'No conversational destination for this run'); effect = bindSpeechTarget(effect, target); }
        catch { return { outcome: 'unresolved', receipt: this.store.putJsonArtifact({ effectId: effect.id, reason: 'Speech destination cannot be verified' }) }; }
        if (target?.transport === 'slack' && botApi && config.slack) {
          const result = await createSpeechHandler({ store: this.store, fence: options.authorityStore, api: botApi, botUserId: config.slack.botUserId, grants: [target] }).reconcile(effect);
          if (result.outcome === 'succeeded') this.activity(() => this.slackActivity?.delivered(effect.id));
          return result;
        }
        const row = this.store.get<{ receipt: JsonValue }>('communications.direct-outbox', effect.id);
        return row ? { outcome: 'succeeded', receipt: this.store.putJsonArtifact(row.value.receipt) } : { outcome: 'unresolved', receipt: this.store.putJsonArtifact({ effectId: effect.id, reason: 'No durable output receipt' }) };
      },
    };
    this.delegation = new DelegationCoordinator({ store: this.store, fence: options.authorityStore,
      grantForParent: runId => {
        const grant = this.grant(runId); const childrenRoot = join(config.workspaceDirectory, `children-${identity(runId)}`); mkdirSync(childrenRoot, { recursive: true, mode: 0o700 });
        const parentTask = this.store.list<{ result?: { childRunId: string }; depth: number }>('delegations').find(row => row.value.result?.childRunId === runId);
        const assignedDepth = this.store.get<{ depth: number }>('host.child-runs', runId)?.value.depth ?? parentTask?.value.depth ?? 0;
        const allocations = this.delegationAllocations(runId), resources = { ...allocations[0]!.envelope };
        for (const allocation of allocations) for (const key of Object.keys(resources) as (keyof ResourceEnvelope)[]) resources[key] = Math.min(resources[key], allocation.envelope[key]);
        const parentChild = this.store.get<{ taskId: string }>('host.child-runs', runId)?.value;
        const maxDepth = parentChild ? Math.min(2, this.delegation.get(parentChild.taskId)!.task.maxDepth) : 2;
        // The waiting parent occupies a run slot and its delegation receiver a physical slot.
        return { scope: grant.scope, writableRoots: [childrenRoot], allowedEffects: this.toolGrant(runId).actions.filter(name => name !== 'speech_send'), resources,
          modelProfiles: [{ provider: config.model.provider ?? 'mistral', model: config.model.id, effort: config.model.reasoning ? config.model.effort : null }], currentDepth: assignedDepth, maxDepth, maxChildren: 8, maxConcurrency: Math.min(2, config.maxConcurrentRuns - 1, resources.maxConcurrency - 1) };
      },
      validateAdmission: tasks => {
        invariant(this.occupied() + tasks.length <= config.maxConcurrentRuns, 'Application concurrency exhausted');
        for (const task of tasks) {
          invariant(task.writablePaths.length === 1, 'Current child runtime requires one exclusive workspace');
          invariant(this.store.get<{ runId: string }>('host.prepared-workspaces', task.writablePaths[0]!)?.value.runId === task.parentRunId, 'Child workspace was not prepared by this parent');
        }
        for (const allocation of this.delegationAllocations(tasks[0]!.parentRunId)) {
          const ids = new Set([allocation.runId, ...this.resources.descendants(allocation.runId)]);
          const concurrent = this.store.list<{ request: { runId: string } }>('requests').filter(row => ids.has(row.value.request.runId) && this.resources.holdsConcurrency(row.key)).length;
          invariant(!allocation.cancelled && concurrent + tasks.length <= allocation.envelope.maxConcurrency, 'Ancestor delegation concurrency exhausted or cancelled');
        }
      },
      artifactScope: artifact => { const record = this.store.get<{ scope: DataScope }>('host.artifact-scopes', artifact.sha256); invariant(record, 'Artifact has no authenticated disclosure scope'); return record.value.scope; },
      executeChild: async (task, signal) => {
        invariant(this.occupied() < config.maxConcurrentRuns, 'Application concurrency exhausted');
        invariant(task.writablePaths.length === 1, 'Current child runtime requires one exclusive workspace');
        invariant(this.store.get<{ runId: string }>('host.prepared-workspaces', task.writablePaths[0]!)?.value.runId === task.parentRunId, 'Child workspace was not prepared by this parent');
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
    const scriptReceiver = this.developmentControl.isScripted ? createScriptedControlReceiver(this.developmentControl) : undefined;
    const receiver: EffectReceiver = {
      dispatch: async (effect, signal) => {
        if (effect.id.startsWith('host:slack-control:')) {
          let plan: import('./slack-control-replies.ts').SlackControlReply;
          try {
            plan = this.controlReplyPlan(effect); options.authorityStore.assert(effect.authority); signal?.throwIfAborted();
          } catch (error) {
            return { outcome: 'failed', receipt: this.store.putJsonArtifact({ delivered: false, reason: error instanceof Error ? error.message : 'Host control speech unavailable' }) };
          }
          return createSpeechHandler({ store: this.store, fence: options.authorityStore, api: botApi!, botUserId: config.slack!.botUserId, grants: [plan.target] }).dispatch({ ...effect, kind: 'speech.send' }, signal);
        }
        try { this.developmentControl.assertEffect(effect.runId, effect.kind); } catch (error) { return { outcome: 'failed', receipt: this.store.putJsonArtifact({ error: error instanceof Error ? error.message : 'Control action denied' }) }; }
        if (scriptReceiver) return scriptReceiver.dispatch(effect, signal);
        const descriptor = this.mindTools(effect.runId, effect.id).find(tool => tool.name === effect.kind);
        if (!descriptor) return physical.dispatch(effect, signal);
        options.authorityStore.assert(effect.authority); signal?.throwIfAborted();
        let executed = false;
        try { const result = await descriptor.execute(effect.payload, signal); executed = true; return { outcome: 'succeeded', receipt: this.store.putJsonArtifact(json(result)) }; }
        catch (error) {
          const applied = error && typeof error === 'object' && 'mayHaveApplied' in error ? error.mayHaveApplied : undefined;
          return { outcome: executed || applied === true || descriptor.extension && applied !== false ? 'uncertain' : 'failed', receipt: this.store.putJsonArtifact({ error: error instanceof Error ? error.message : 'Development action rejected' }) };
        }
      },
      reconcile: effect => {
        if (effect.id.startsWith('host:slack-control:')) {
          const plan = this.controlReplyPlan(effect); options.authorityStore.assert(options.authority);
          return createSpeechHandler({ store: this.store, fence: options.authorityStore, api: botApi!, botUserId: config.slack!.botUserId, grants: [plan.target] }).reconcile({ ...effect, kind: 'speech.send' });
        }
        this.developmentControl.assertEffect(effect.runId, effect.kind); return scriptReceiver ? scriptReceiver.reconcile(effect) : physical.reconcile(effect);
      },
    };
    this.effects = new EffectJournal(this.store, options.authorityStore, developmentAccounting?.wrapReceiver(receiver) ?? receiver);
    const codingTimeout = Math.min(config.coding?.timeoutMs ?? 900000, config.conversationResources.maxElapsedMs);
    const codingProvider = new CodexCodingProvider({ execute: options.codingExecutor ?? (async () => { throw new Error('Codex CLI host binding unavailable: configure codexBinary and a dedicated authenticated codexHome'); }), timeoutMs: codingTimeout, maxOutputBytes: config.coding?.maxOutputBytes ?? 2000000, ...(config.coding?.model ? { model: config.coding.model } : {}) });
    const codingShell = codexCodingShell({ provider: codingProvider, store: this.store, session: () => this.coding.session()!,
      turn: runId => { const record = this.store.get<{ turn: CodingTurn }>('host.coding-runs', runId); invariant(record, 'Coding turn unavailable'); return record.value.turn; }, timeoutMs: codingTimeout, model: config.coding?.model, executionBudget: runId => this.codingBudget(runId, codingTimeout),
      onProcessStopped: requestId => this.resources.releaseConcurrency(requestId, { kind: 'transport-terminal', reason: 'Bounded Codex process returned after host cleanup' }) });
    const shell: ShellPort = { run: async (input, bridge, signal) => {
      const codingRun = this.store.get<{ turn: CodingTurn; provider: string }>('host.coding-runs', input.run.id)?.value;
      if (codingRun?.provider === 'codex') return codingShell.run(input, bridge, signal);
      this.developmentControl.assertRun(input.run.id);
      const record = this.grant(input.run.id), context = developmentContext(this.developmentControl, this.memory, { audience: input.run.scope, query: JSON.stringify(input.messages).slice(0, 8192), maxRecords: 24, maxBytes: 8192 });
      const descriptors = this.mindTools(input.run.id);
      const permittedTools = toolDefinitions.filter(tool => this.toolGrant(input.run.id).actions.includes(tool.name));
      const tools = [...permittedTools.map(tool => ({ ...tool, parameters: tool.parameters as unknown as Tool['parameters'] })), ...descriptors.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.inputSchema as Tool['parameters'] }))];
      const broker = createBrokerShell({ applicationRoot: config.applicationRoot, entrypoint: config.workerEntrypoint, workspace: () => record.workspace,
        brokerTiming, runWorker: options.runWorker,
        protectedPaths: [config.stateDirectory], nodeBinary: config.nodeBinary, resourceLimits: config.resourceLimits,
        worker: { provider: config.model.provider ?? 'mistral', model: config.model.id, modelProfile: { contextWindow: config.model.contextWindow, reasoning: config.model.reasoning }, ...(config.model.reasoning ? { reasoningEffort: config.model.effort } : {}),
          maxOutputTokens: config.model.maxOutputTokens, maxRequests: config.model.maxRequestsPerSlice, maxRetries: 0, timeoutMs: config.model.timeoutMs, tools,
          compaction: { ...contextBudget(config), instruction: { id: 'application.compaction', owner: 'application', role: 'system', order: 1, artifact: compaction, scope: { kind: 'public' }, replaceable: true, derivedFrom: [base.sha256] } } },
        timeoutMs: codingRun ? codingTimeout : Math.min(config.conversationResources.maxElapsedMs, record.target && config.conversationTimeoutMs ? config.conversationTimeoutMs : config.scheduler.quantumMs), maxPayloadBytes: 2_000_000, maxResponseBytes: developmentAccounting?.maxResponseBytes, pricesPerMillion: config.model.pricesPerMillion,
        resolveFragment: async fragment => Buffer.from(this.store.readArtifact(fragment.artifact)).toString('utf8'),
        retainToolInstructions: source => this.store.putArtifact(source),
        assertAuthority: () => options.authorityStore.assert(input.run.authority),
        performRequest: options.performRequest ?? providerGateway({ provider: config.model.provider, apiKey: () => selectedProviderKey(config.model, options.secrets), maxResponseBytes: developmentAccounting?.maxResponseBytes ?? 2_000_000 }),
        recordResponse: developmentAccounting ? (id, response) => developmentAccounting.recordResponse(id, response) : providerResponseRecorder({ store: this.store, ledger: this.resources, runId: input.run.id, scope: input.run.scope, maxBytes: 2_000_000 }),
        beforeRequest: developmentAccounting ? id => developmentAccounting.assertEntry(id) : undefined,
        onTransportFinished: requestId => this.resources.releaseConcurrency(requestId, { kind: 'transport-terminal', reason: 'Host provider transport completed or aborted and local settlement finished' }),
        recordTransport: receipt => { developmentAccounting?.recordTransport(receipt); transportRecorder(this.store)(receipt); } });
      const frame = { role: 'user', timestamp: Date.now(), content: JSON.stringify({ hostContext: { runId: input.run.id, memory: context, agenda: this.developmentControl.kind === 'no-standing-goals' ? [] : this.goals.all(input.run.scope), ...(this.developmentControl.isEvaluation ? { currentEvidence: this.developmentControl.currentEvidence(input.run.id, input.run.scope, this.memory) } : {}), obligations: this.conversationObligations.visible(record.target), communication: communicationState(input.run.scope, record.target, this.slackRecovery), target: record.target ?? null, workspace: '/work', operatingUsage: this.resources.snapshot(this.rootAllocation), attribution: 'Authenticated host state; retrieved content retains its own provenance.' } }) };
      let messages = codingRun ? input.messages : [frame, ...input.messages];
      if (codingRun?.provider === 'pi' && !input.checkpoint) {
        const session = this.coding.session()!, context = this.store.get<{ sessionId: string; scope: DataScope; checkpoint: ShellCheckpoint }>('host.pi-coding-context', session.id)?.value;
        if (context) {
          invariant(context.sessionId === session.id && identity(context.scope) === identity(session.scope), 'Pi coding context audience changed');
          const retained = this.store.readJsonArtifact<{ messages: JsonValue[]; status?: string; failure?: unknown }>(context.checkpoint.artifact);
          invariant(Array.isArray(retained.messages) && retained.status === 'completed' && !retained.failure, 'Pi coding context must be a known completed transcript');
          messages = [...retained.messages, ...messages];
        }
      }
      const result = await broker.run({ ...input, messages }, { ...bridge, execute: async (call, toolSignal) => { const observation = await bridge.execute(call, toolSignal); this.ingestObservation(observation); this.conversationObligations.confirm(); return observation; } }, signal);
      if (codingRun) return result.status === 'completed' ? { ...result, status: 'checkpointed' } : result;
      return this.coding.preserveWaiting(input.run.id, this.controls.preserveWaiting(input.run.id, this.evolution.preserveWaiting(input.run.id, result)));
    } };
    this.runtime = new DurableRuntime({ store: this.store, shell: developmentAccounting?.wrapShell(this.developmentControl.isScripted ? createScriptedControlShell(this.developmentControl) : shell) ?? shell, effects: this.effects, resources: this.resources,
      canResume: run => { this.developmentControl.assertRun(run.id); this.developmentControl.assertRestoredState(); return this.controls.eligibleRun(run.id, this.hasPendingSteering(run.id)); } });
    this.coding = new CodingLimb({ store: this.store, runtime: this.runtime, provider: config.coding?.provider ?? 'codex', onWake: runId => {
      const execution = this.store.list<{ runId: string }>('initiative.execution').find(row => row.value.runId === runId);
      const goal = execution ? this.goals.goal(execution.key) : undefined;
      if (goal && ['waiting', 'blocked'].includes(goal.status)) this.goals.revise(goal.id, goal.revision, { status: 'ready' }, 'External coding result is ready for inspection');
    }, now: () => this.runtime.now(), assertAuthority: authority => options.authorityStore.assert(authority), execute: (session, turn, signal) => this.executeCoding(session, turn, signal) });
    this.codingSources = new CodingSources({ store: this.store, snapshot: options.codingSnapshot ?? (async (workspace, path, signal, timeoutMs) => {
      invariant(realpathSync(workspace) === workspace, 'Canonical coding workspace required');
      const directory = join(workspace, 'repositories');
      try { mkdirSync(directory, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      invariant(lstatSync(directory).isDirectory() && realpathSync(directory) === directory, 'Coding repository directory must not be a link');
      const destination = join(workspace, path); mkdirSync(destination, { mode: 0o700 });
      return sourceWorkspaceTools({ applicationRoot: config.applicationRoot, workspace: destination, protectedPaths: [config.stateDirectory], nodeBinary: config.nodeBinary,
        maxFiles: 10000, maxBytes: 50_000_000, timeoutMs: timeoutMs ?? 30000, resourceLimits: config.resourceLimits })[0]!.execute({}, signal);
    }) });
    this.evolution = new EvolutionContinuations({ store: this.store, runtime: this.runtime, authorityStore: options.authorityStore });
    this.controls = new ControlAuthorContinuations({ store: this.store, runtime: this.runtime, authorityStore: options.authorityStore });
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
    this.scheduler = new FairScheduler(this.store, this.goals, this.obligations, 'ordinary', config.scheduler, Date.now(), goal => this.developmentControl.kind !== 'no-standing-goals' && !this.developmentControl.isScripted && this.evolution.eligibleGoal(goal) && this.controls.eligibleGoal(goal));
    this.initiative = new InitiativeRunner({ scheduler: this.scheduler, runtime: this.runtime, memory: this.memory, authority: options.authority,
      context: request => developmentContext(this.developmentControl, this.memory, request),
      prompt: () => this.prompt, deliver: (id, signal) => this.deliverObligation(id, signal), decide: () => ({ kind: 'block', reason: 'The accounted mind did not record an observation-grounded progress decision.' }) });
    this.directApi = createDirectApi({ core: this.communications, authenticate: bearerAuthenticator([{ token: options.secrets.directToken, principal: { id: config.direct.actorId, scope: config.direct.scope, modificationEligible: config.direct.modificationEligible } }]), outputForRun: runId => this.output(runId), health: () => this.health() });
    if (config.slack) {
      invariant(botApi && (options.slackAppApi || options.secrets.slackAppToken), 'Configured Slack requires host credentials');
      this.slackIngress = new SlackIngress({ core: this.communications, ...config.slack });
      this.slackControlReplies = new SlackControlReplies({ store: this.store, teamId: config.slack.teamId, botUserId: config.slack.botUserId, accountingRunId: this.rootAllocation,
        getRun: id => this.runtime.getRun(id), getEffect: id => this.effects.get(id),
        targetForRun: id => { const target = this.store.get<GrantRecord>('host.run-grants', id)?.value.target; return target?.transport === 'slack' && target.threadTs ? { ...target, threadTs: target.threadTs, transport: 'slack' as const } : undefined; },
        diagnose: run => this.conversationDiagnosis(run) });
      this.slackRecovery = new SlackRecovery({ store: this.store, api: botApi, ingress: this.slackIngress, coverageStart: config.slack.coverageStart, lookbackSeconds: config.slack.lookbackSeconds });
      this.slackSocket = new SlackSocketMode({ botApi, appApi: options.slackAppApi ?? new SlackClient({ token: options.secrets.slackAppToken! }), ingress: this.slackIngress, recovery: this.slackRecovery,
        onError: kind => this.store.append({ id: randomUUID(), stream: 'host', type: 'transport-error', data: { kind, at: new Date().toISOString() } }) });
    }
    if (config.bootstrapInitiative !== false && this.developmentControl.kind !== 'no-standing-goals' && !this.developmentControl.isScripted) this.bootstrapDevelopment(base.sha256);
    const interrupted = this.runtime.recover(); reconcileProviderReceipts(this.store, this.resources);
    // Production composition acquires the exclusive process lease and drains old
    // command cgroups before constructing the application. Financial uncertainty
    // remains intact; the preceding host can no longer occupy execution slots.
    this.lease.assertHeld();
    for (const row of this.store.list<{ request: PhysicalRequest }>('requests')) if (this.resources.holdsConcurrency(row.key))
      this.resources.releaseConcurrency(row.key, { kind: 'host-recovery', reason: `Exclusive host recovery under generation ${options.authority.generation} epoch ${options.authority.epoch}` });
    for (const runId of interrupted) if (!this.managedElsewhere(runId) && !this.evolution.holds(runId)) this.enqueue(runId);
    for (const row of this.store.list<Run>('runs')) if (!['completed', 'cancelled'].includes(row.value.status)) this.runtime.adopt(row.key, options.authority);
    for (const row of this.store.list<Run>('runs')) if (row.value.status === 'waiting' && !this.managedElsewhere(row.key) && this.hasSliceContinuation(row.key)) this.enqueue(row.key);
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
  private managedElsewhere(runId: string): boolean { return !!this.store.get('host.child-runs', runId) || !!this.store.get('host.coding-runs', runId) || [...this.store.list<{ runId: string }>('initiative.execution'), ...this.store.list<{ runId: string }>('host.delivery-runs')].some(row => row.value.runId === runId); }
  private delegationAllocations(runId: string): { runId: string; envelope: ResourceEnvelope; cancelled: boolean }[] {
    const allocations: { runId: string; envelope: ResourceEnvelope; cancelled: boolean }[] = [];
    for (let id: string | undefined = runId; id;) {
      invariant(!allocations.some(allocation => allocation.runId === id), 'Cyclic delegation allocation');
      const allocation: { envelope: ResourceEnvelope; parentRunId?: string; cancelled: boolean } | undefined = this.store.get<{ envelope: ResourceEnvelope; parentRunId?: string; cancelled: boolean }>('allocations', id)?.value;
      invariant(allocation, 'Missing parent delegation allocation');
      allocations.push({ runId: id, envelope: allocation.envelope, cancelled: allocation.cancelled }); id = allocation.parentRunId;
    }
    return allocations;
  }
  private occupied(): number { return this.active.size + (this.initiativeTask ? 1 : 0) + (this.coding?.busy ? 1 : 0); }
  private coordinatedWorkspace(runId: string): { workspace: string; locked: boolean } {
    const grant = this.grant(runId), session = this.coding.session();
    const turns = this.store.list<CodingTurn>('host.coding-turns').map(row => row.value).sort((a, b) => b.sequence - a.sequence);
    const visible = session && identity(session.scope) === identity(grant.scope) && (grant.scope.kind === 'restricted' || session.owner === identity({ scope: grant.scope, conversation: grant.target ?? runId }));
    const turn = turns.find(item => item.runId === runId) ?? (visible ? turns[0] : undefined);
    return { workspace: session && turn ? turn.source ? join(session.workspace, turn.source.path) : session.workspace : grant.workspace,
      locked: this.coding.workspaceLocked(grant.workspace) || !!session && this.coding.workspaceLocked(session.workspace) && identity(session.scope) === identity(grant.scope) };
  }
  private toolGrant(runId: string): ToolGrant {
    const grant = this.grant(runId);
    if (this.developmentControl.isScripted) return { scope: grant.scope, workspace: { workspace: grant.workspace, protectedPaths: [this.config.stateDirectory, this.config.applicationRoot], nodeBinary: this.config.nodeBinary, timeoutMs: 30000, maxBytes: 131072, maxFiles: 10000, executables: [], maxArgs: 64 }, research: { allowedHosts: [], timeoutMs: 15000, maxBytes: 262144, maxRedirects: 0 }, actions: ['development_control_emit'] };
    const child = this.store.get<{ allowedEffects: string[] }>('host.child-runs', runId)?.value;
    const coding = this.store.get<{ turn: CodingTurn }>('host.coding-runs', runId)?.value;
    return { scope: grant.scope, workspace: { workspace: grant.workspace, protectedPaths: [this.config.stateDirectory, this.config.applicationRoot], nodeBinary: this.config.nodeBinary, timeoutMs: 30000, maxBytes: 131072, maxFiles: 10000, executables: this.config.commands, maxArgs: 64, ...(this.config.resourceLimits ? { resourceLimits: this.config.resourceLimits } : {}) },
      research: { allowedHosts: this.config.researchHosts, timeoutMs: 15000, maxBytes: 262144, maxRedirects: 3 },
      actions: this.consolidation?.claim(runId) ? [] : toolDefinitions.map(tool => tool.name).filter(name => codingAccess(name, coding ? coding.turn.mode ?? 'inspect' : undefined) && (!child || child.allowedEffects.includes(name)) && (child || !this.coding?.workspaceLocked(grant.workspace) || ['workspace_read', 'workspace_search', 'workspace_discover', 'workspace_diff', 'research_fetch', 'speech_send'].includes(name)) && (name !== 'speech_send' || grant.target !== undefined && (grant.target.transport === 'direct' || this.config.slack?.allowSpeech))) };
  }
  private mindTools(runId: string, effectId?: string): (ApplicationTool & { extension?: true })[] {
    this.developmentControl.assertRun(runId);
    if (this.developmentControl.isScripted) return [];
    const scope = this.grant(runId).scope;
    if (this.store.get('host.child-runs', runId)) return [];
    if (this.consolidation?.claim(runId)) return this.consolidation.tools(runId);
    const coordinated = this.coordinatedWorkspace(runId);
    const childTask = (args: JsonValue) => { invariant(args && typeof args === 'object' && !Array.isArray(args) && typeof args.id === 'string', 'Child task ID required'); const task = this.delegation.get(args.id); invariant(task?.task.parentRunId === runId, 'Child task is not owned by this parent'); return task; };
    return [...(this.developmentControl.isEvaluation ? [] : this.codingTools(runId, effectId)), ...communicationTools(() => communicationState(scope, this.grant(runId).target, this.slackRecovery)), { name: 'delegation_prepare', description: 'Allocate a fresh exclusive child workspace and return its host-approved bounded delegation grant; preparing does not start a child.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, execute: (args: JsonValue) => {
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
    }, ...this.conversationObligations.tools(runId, this.grant(runId).target), ...(this.developmentControl.kind === 'no-memory' ? [] : mindDevelopmentTools(this.memory, scope, this.options.authority.generation)), ...(this.developmentControl.kind === 'no-standing-goals' ? [] : bindGoalOrigins({ runId, scope, workspace: this.grant(runId).workspace, store: this.store, authority: this.options.authority }, initiativeTools(this.goals, this.drives, this.plans, scope, this.options.authority.generation, this.config.scheduler.resources, runId))), ...(coordinated.locked ? [] : this.options.additionalTools?.({ runId, scope, workspace: coordinated.workspace, store: this.store, authority: this.options.authority, ...(effectId ? { effectId } : {}) }) ?? []).filter(tool => codingAccess(tool.name)).map(tool => ({ ...tool, extension: true as const }))];
  }
  private codingBudget(runId: string, maximumMs: number): { timeoutMs: number; reservationElapsedMs: number; maxTokens: number } {
    // Whole-CLI aggregate reservations differ from the mind's single HTTP request.
    // Root usage conservatively bounds each ancestor; leave time for process drain and the result reply.
    const used = this.resources.snapshot(runId);
    invariant(!used.cancelled, 'Coding allowance is cancelled');
    let remainingMs = Infinity, remainingTokens = 1000000;
    for (const allocation of this.delegationAllocations(runId)) {
      const envelope = this.resources.effectiveEnvelope(allocation.runId);
      remainingMs = Math.min(remainingMs, envelope.maxElapsedMs - used.elapsedMs);
      if (envelope.maxTokens !== null) remainingTokens = Math.min(remainingTokens, envelope.maxTokens - used.tokens);
    }
    const timeoutMs = Math.min(maximumMs, Math.floor((remainingMs - 7000) * 0.8));
    invariant(timeoutMs > 0 && remainingTokens > 0, 'Coding allowance exhausted');
    return { timeoutMs, reservationElapsedMs: timeoutMs + 5000, maxTokens: Math.floor(remainingTokens) };
  }
  private codingOwner(runId: string): CodingOwner {
    const grant = this.grant(runId), run = this.runtime.getRun(runId); invariant(run, 'Unknown coding owner');
    const session = this.coding.session(), sameAudience = session && grant.scope.kind === 'restricted' && identity(session.scope) === identity(grant.scope);
    return { key: identity({ scope: grant.scope, conversation: grant.target ?? runId }), runId, workspace: sameAudience ? session.workspace : grant.workspace, scope: grant.scope, authority: run.authority };
  }
  private codingTools(runId: string, effectId?: string): ApplicationTool[] {
    const object = (args: JsonValue, keys: string[]): Record<string, JsonValue> => { invariant(args && typeof args === 'object' && !Array.isArray(args) && Object.keys(args).every(key => keys.includes(key)), 'Invalid coding arguments'); return args; };
    return [{ name: 'code', description: 'Ask the one external coding agent any repository/code question or implementation task. Defaults: mode=inspect (enforced read-only), target=source (host prepares accepted repository). Use mode=edit for requested changes; target=workspace for existing scratch files. Returns promptly; results wake this run. Follow-ups reuse the same native session. It cannot speak for you or release changes.',
      inputSchema: { type: 'object', properties: { message: { type: 'string' }, sessionId: { type: 'string' }, mode: { type: 'string', enum: ['inspect', 'edit'] }, target: { type: 'string', enum: ['source', 'workspace'] } }, required: ['message'], additionalProperties: false }, execute: async (args, signal) => {
        const value = object(args, ['message', 'sessionId', 'mode', 'target']); invariant(effectId && typeof value.message === 'string' && value.message.trim() && Buffer.byteLength(value.message) <= 32768 && (value.sessionId === undefined || typeof value.sessionId === 'string'), 'Coding message and durable effect identity required');
        const mode = value.mode ?? 'inspect', target = value.target ?? 'source';
        invariant(mode === 'inspect' || mode === 'edit', 'Coding mode must be inspect or edit'); invariant(target === 'source' || target === 'workspace', 'Coding target must be source or workspace');
        invariant((this.config.coding?.provider ?? 'codex') !== 'codex' || this.options.codingExecutor, 'Codex CLI is the default coding provider; configure host codexBinary and a dedicated authenticated codexHome before coding');
        const owner = this.codingOwner(runId), session = this.coding.bind(owner, effectId);
        invariant(value.sessionId === undefined || value.sessionId === session.id, 'Follow-up must address the existing coding session');
        signal?.throwIfAborted();
        return this.coding.submit(owner, effectId, value.message, value.sessionId, { mode, target });
      } }, { name: 'code_status', description: 'Inspect the coding session response and actual command/edit events. Events are paginated; the full result artifact retains raw stdout/stderr. Agent claims require inspection.',
      inputSchema: { type: 'object', properties: { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, additionalProperties: false }, execute: args => { const value = object(args, ['offset', 'limit']); return this.coding.status(this.codingOwner(runId), value.offset as number | undefined, value.limit as number | undefined); } },
      { name: 'code_cancel', description: 'Stop the current coding turn while retaining its session and partial evidence. Cancellation is not an undo of edits.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, execute: args => { object(args, []); return this.coding.cancel(this.codingOwner(runId)); } }];
  }
  private async executeCoding(session: CodingSession, turn: CodingTurn, signal: AbortSignal): Promise<CodingResult> {
    const config = this.config;
    this.options.authorityStore.assert(turn.authority);
    let child: Run | undefined;
    const value = json({ message: turn.message, mode: turn.mode ?? 'inspect', source: turn.source ?? null, role: 'external coding limb', sessionId: session.id });
    const inbound = { id: turn.id, source: 'host.coding-message', externalId: turn.id, externalRevision: '1', actorId: turn.authority.generation, authenticated: true, scope: session.scope, value };
    if (!child) {
      child = this.store.transaction(() => {
        const resources = { ...config.conversationResources };
        for (const allocation of this.delegationAllocations(turn.runId)) for (const key of Object.keys(resources) as (keyof ResourceEnvelope)[]) resources[key] = Math.min(resources[key], allocation.envelope[key]);
        const run = this.runtime.admit(inbound, turn.authority, resources, turn.runId);
        this.store.put('host.run-grants', run.id, { scope: session.scope, workspace: session.workspace }, null);
        this.store.put('host.child-runs', run.id, { taskId: session.id, depth: 1, allowedEffects: toolDefinitions.map(tool => tool.name).filter(name => name.startsWith('workspace_') || ['command_run', 'research_fetch'].includes(name)) }, null);
        if (!session.childRunId) this.coding.updateSession({ childRunId: run.id }); return run;
      });
    } else this.runtime.steer(child.id, inbound);
    // Source preparation shares the single coding turn's exclusive workspace and
    // current caller allowance; it cannot race an active native edit or hold up
    // the mind's enqueue acknowledgement.
    if (turn.target === 'source' && !turn.source) {
      try {
        let source = this.codingSources.prepared(session.workspace, this.config.artifactId);
        if (!source) {
          const budget = this.codingBudget(child.id, 30000), id = `coding-source:${turn.id}`;
          const payload = { candidateId: this.config.artifactId, workspace: session.workspace, timeoutMs: budget.timeoutMs };
          const request: PhysicalRequest = { id, runId: child.id, purpose: 'delegation', provider: 'host-source', model: 'source_snapshot', promptManifestId: id,
            requestDigest: identity(payload), reservationId: id, status: 'reserved', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: budget.reservationElapsedMs } };
          this.options.authorityStore.assert(turn.authority); signal.throwIfAborted();
          this.store.transaction(() => { this.resources.reserve(request); this.resources.dispatched({ ...request, status: 'dispatched' }); });
          const started = this.noticeElapsedNow();
          try {
            const deadline = AbortSignal.any([signal, this.sourceTimeoutSignal(budget.timeoutMs)]);
            this.store.put('host.coding-source-invocations', id, json(payload), null);
            source = await this.codingSources.prepare(session.workspace, this.config.artifactId, deadline, budget.timeoutMs);
            this.resources.settle({ ...request, status: 'succeeded', usage: { ...request.usage, elapsedMs: Math.max(0, this.noticeElapsedNow() - started) } });
          } catch (error) {
            this.resources.settle({ ...request, status: 'uncertain', usage: { ...request.usage, elapsedMs: Math.max(0, this.noticeElapsedNow() - started) } });
            throw error;
          }
        }
        const queued = this.store.get<CodingTurn>('host.coding-turns', turn.id)!;
        this.store.put('host.coding-turns', turn.id, { ...queued.value, source }, queued.revision);
        turn = { ...turn, source };
      } catch (error) {
        this.runtime.cancel(child.id, turn.authority.generation, 'Source preparation stopped before coding execution');
        throw error;
      }
    }
    const record = this.store.get('host.coding-runs', child.id);
    this.store.put('host.coding-runs', child.id, { turn, provider: session.provider }, record?.revision ?? null);
    const instruction = this.store.putArtifact(`You are an external coding limb working on the supplied finite task in this workspace. You are not the continuing mind and do not speak to its user. Current mode: ${turn.mode ?? 'inspect'}. ${turn.mode === 'edit' ? 'Make the requested changes and run relevant checks.' : 'Inspect and explain code; do not change files or run arbitrary commands.'} ${turn.source ? `Accepted source is at /work/${turn.source.path}, candidate ${turn.source.candidateId}.` : ''} Report file/line references, actual command results or a concise clarification question. Do not create agents, invoke another agent CLI, release changes, or alter your instructions. Follow-up messages continue this same session.`);
    const prompt: PromptManifest = { id: `coding-limb:${instruction.sha256}`, requestDigest: '0'.repeat(64), fragments: [{ id: 'coding.limb', owner: 'application', role: 'system', order: 0, artifact: instruction, scope: { kind: 'public' }, replaceable: true, derivedFrom: [] }] };
    let result = await this.runtime.resume(child.id, prompt, signal);
    while (session.provider === 'pi' && result.status === 'waiting' && !signal.aborted && this.hasSliceContinuation(child.id)) result = await this.runtime.resume(child.id, prompt, signal);
    const saved = this.store.get<{ artifact: import('../packages/contracts/index.ts').ArtifactRef }>('host.coding-results', turn.id)?.value;
    if (saved) return this.store.readJsonArtifact<CodingResult>(saved.artifact);
    const execution = this.store.get<{ failure?: string; checkpoint?: ShellCheckpoint }>('execution', child.id)?.value;
    if (session.provider === 'codex') throw new Error(execution?.failure ?? `Coding invocation ended ${result.status} without a retained result`);
    const checkpoint = execution?.checkpoint ? this.store.readJsonArtifact<{ messages?: JsonValue[]; status?: string; failure?: { reason: string } }>(execution.checkpoint.artifact) : undefined;
    const uncertain = this.effects.unresolved(child.id).length > 0 || this.store.list<{ request: PhysicalRequest }>('requests').some(row => row.value.request.runId === child.id && ['dispatched', 'uncertain'].includes(row.value.request.status));
    if (execution?.checkpoint && checkpoint?.status === 'completed' && !uncertain) {
      const context = this.store.get('host.pi-coding-context', session.id);
      this.store.put('host.pi-coding-context', session.id, json({ sessionId: session.id, scope: session.scope, checkpoint: execution.checkpoint }), context?.revision ?? null);
    }
    const events = this.runtime.observations(child.id).map(observation => json(observation));
    const messages = checkpoint?.messages ?? [];
    const last = [...messages].reverse().find(message => message && typeof message === 'object' && !Array.isArray(message) && message.role === 'assistant') as { content?: { text?: string }[] } | undefined;
    return { provider: 'pi', sessionId: session.nativeSessionId ?? child.id, mode: turn.mode ?? 'inspect', status: uncertain ? 'uncertain' : signal.aborted ? 'cancelled' : checkpoint?.status === 'completed' ? 'completed' : 'failed',
      summary: execution?.failure ?? checkpoint?.failure?.reason ?? last?.content?.map(content => content.text ?? '').join('') ?? 'No coding reply', events, stdout: JSON.stringify(messages), stderr: execution?.failure ?? '', exitCode: null, elapsedMs: 0,
      usage: { inputTokens: null, outputTokens: null, cachedInputTokens: null, costUsd: null, physicalRequests: null } };
  }
  private enqueue(runId: string): void { this.developmentControl.assertRun(runId); const row = this.store.get('host.pending-runs', runId); this.store.put('host.pending-runs', runId, { requestedAt: Date.now() }, row?.revision ?? null); }
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
      if (target) {
        const grant = this.grant(run.id), row = this.store.get('host.run-grants', run.id)!, session = this.coding?.session();
        if (grant.target) invariant(identity(grant.target) === identity(target), 'Conversation destination changed');
        const workspace = session?.owner === identity({ scope: grant.scope, conversation: target }) && identity(session.scope) === identity(grant.scope) ? session.workspace : grant.workspace;
        if (!grant.target || workspace !== grant.workspace) this.store.put('host.run-grants', run.id, { ...grant, target, workspace }, row.revision);
      }
      if (target?.transport === 'slack' && record.input.authenticated && record.operation && JSON.parse(record.operation).control === null) {
        const [channel, timestamp] = record.input.externalId.split(':');
        if (channel === target.channel && timestamp) this.activity(() => this.slackActivity?.observe(run.id, channel, timestamp));
      }
    }
  }
  private activity(operation: () => unknown): void {
    try { operation(); } catch {
      // The deterministic indicator is supplementary; intake and speech retain their own outcomes.
      try { this.store.put('communications.slack.activity-status', 'storage', { error: 'activity_state_unavailable' }, this.store.get('communications.slack.activity-status', 'storage')?.revision ?? null); } catch {}
    }
  }
  private hasSliceContinuation(runId: string): boolean {
    const state = this.store.get<{ failure?: string; failedAttempt?: number; checkpoint?: ShellCheckpoint; lastResult?: ShellResult }>('execution', runId)?.value;
    if (state?.failure || state?.failedAttempt !== undefined || state?.lastResult?.status !== 'checkpointed' || !state.checkpoint || state.lastResult.checkpoint?.artifact.sha256 !== state.checkpoint.artifact.sha256) return false;
    try { return !!physicalRequestSliceContinuation(this.store.readJsonArtifact(state.checkpoint.artifact)); } catch { return false; }
  }
  private conversationDiagnosis(run: Run): SlackControlDiagnosis | undefined {
    if (this.store.list<{ runId: string }>('execution.capacity-waits').some(row => row.value.runId === run.id)) return 'capacity-wait';
    if (this.coding.holds(run.id)) return 'coding-running';
    if (this.effects.unresolved(run.id).length) return 'uncertain-effect';
    const state = this.store.get<{ failure?: string; checkpoint?: ShellCheckpoint }>('execution', run.id)?.value;
    if (state?.failure === 'Worker deadline exceeded') return 'time-limit';
    if (this.hasSliceContinuation(run.id)) return 'slice-limit';
    if (state?.checkpoint) try {
      const snapshot = this.store.readJsonArtifact<{ failure?: { stage?: string; reason?: string } }>(state.checkpoint.artifact);
      if (snapshot.failure?.reason === 'Physical request budget exhausted') return 'slice-limit';
      const stages: Record<string, SlackControlDiagnosis> = { model: 'model-step', tool: 'tool-step', recovery: 'recovery-step', compaction: 'compaction-step' };
      if (snapshot.failure?.stage && Object.hasOwn(stages, snapshot.failure.stage)) return stages[snapshot.failure.stage];
    } catch { /* Status remains useful when an old checkpoint is unavailable. */ }
    return undefined;
  }
  private controlReplyPlan(effect: Effect): import('./slack-control-replies.ts').SlackControlReply {
    const plan = this.store.get<import('./slack-control-replies.ts').SlackControlReply>('host.slack-control-replies', effect.id)?.value;
    invariant(this.config.slack?.allowSpeech && plan && plan.id === effect.id && /^host:slack-control:[a-f0-9]{64}$/.test(effect.id)
      && plan.id === `host:slack-control:${plan.inputId}` && effect.runId === this.rootAllocation && effect.stepId === effect.id
      && effect.kind === 'speech_send' && effect.reservationId === effect.id && identity(effect.payload) === identity(plan.payload)
      && identity(effect.scope) === identity(plan.target.scope), 'Host control reply has no trusted intent');
    const target = this.store.get<GrantRecord>('host.run-grants', plan.runId)?.value.target, run = this.runtime.getRun(plan.runId);
    invariant(run && target?.transport === 'slack' && identity(target) === identity(plan.target)
      && scopeAllows(run.scope, target.scope), 'Host control reply audience or destination changed');
    const request = this.resources.request(effect.id);
    invariant(request && request.runId === this.rootAllocation && request.reservationId === effect.id && request.requestDigest === identity(plan.payload)
      && request.provider === 'effect-receiver' && request.model === 'speech_send' && request.promptManifestId === effect.id, 'Host control reply accounting changed');
    return plan;
  }
  private async notifySlackControls(): Promise<void> {
    if (!this.slackControlReplies || !this.config.slack?.allowSpeech) return;
    for (const plan of this.slackControlReplies.prepare()) {
      if (this.closing) return;
      try {
        const action = this.slackControlReplies.nextAction(plan);
        if (action === 'reconcile') {
          if (this.reconciledControlReplies.has(plan.id)) continue;
          this.reconciledControlReplies.add(plan.id);
          const effect = await this.effects.reconcile(plan.id, this.options.authority), request = this.resources.request(plan.id);
          if (request && ['dispatched', 'uncertain'].includes(request.status) && ['succeeded', 'failed'].includes(effect.status))
            this.resources.settle({ ...request, status: effect.status === 'succeeded' ? 'succeeded' : 'failed' });
          continue;
        }
        if (action !== 'dispatch') continue;
        this.store.transaction(() => {
          this.options.authorityStore.assert(this.options.authority);
          if (!this.effects.get(plan.id)) {
            // Deterministic host acknowledgements use the existing root allowance;
            // even a cancelled conversation can receive its status without reviving it.
            const request: PhysicalRequest = { id: plan.id, runId: this.rootAllocation, purpose: 'reasoning', provider: 'effect-receiver', model: 'speech_send',
              promptManifestId: plan.id, requestDigest: identity(plan.payload), reservationId: plan.id, status: 'reserved', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } };
            this.resources.reserve(request);
            this.effects.create({ id: plan.id, runId: this.rootAllocation, stepId: plan.id, kind: 'speech_send', payload: plan.payload, scope: plan.target.scope, authority: this.options.authority, status: 'pending', revision: 0 });
            this.effects.authorize(plan.id, plan.id, this.options.authority);
          } else {
            this.effects.adoptUndispatched(this.rootAllocation, this.options.authority, [plan.id]);
            if (this.effects.get(plan.id)?.status === 'pending') {
              if (!this.resources.request(plan.id)) this.resources.reserve({ id: plan.id, runId: this.rootAllocation, purpose: 'reasoning', provider: 'effect-receiver', model: 'speech_send',
                promptManifestId: plan.id, requestDigest: identity(plan.payload), reservationId: plan.id, status: 'reserved', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } });
              this.effects.authorize(plan.id, plan.id, this.options.authority);
            }
          }
        });
        const request = this.resources.request(plan.id)!, started = this.noticeElapsedNow();
        const effect = await this.effects.dispatch(plan.id, this.options.authority, this.shutdown.signal, () => this.resources.dispatched({ ...request, status: 'dispatched' }));
        this.resources.settle({ ...request, status: effect.status === 'succeeded' ? 'succeeded' : effect.status === 'failed' ? 'failed' : 'uncertain', usage: { ...request.usage, elapsedMs: Math.max(0, this.noticeElapsedNow() - started) } });
      } catch {
        const row = this.store.get('host.slack-control-reply-status', plan.id);
        this.store.put('host.slack-control-reply-status', plan.id, { status: 'pending', runId: plan.runId }, row?.revision ?? null);
      }
    }
  }
  /** A host interruption is speech, never a new inference attempt or a grant reset. */
  private async notifyConversationFailures(): Promise<void> {
    const ids = new Set(this.store.list<Effect>('effects').filter(row => row.key.startsWith('host:deadline:') || row.key.startsWith('host:blocked:')).map(row => row.key));
    for (const { value: run } of this.store.list<Run>('runs')) {
      if (!['waiting', 'blocked'].includes(run.status) || this.managedElsewhere(run.id) || this.hasPendingSteering(run.id) || this.evolution.holds(run.id) || this.coding.holds(run.id) || !this.controls.eligibleRun(run.id, false)) continue;
      const state = this.store.get<{ failure?: string; failedAttempt?: number; checkpoint?: ShellCheckpoint; lastResult?: ShellResult; messageSequence?: number }>('execution', run.id)?.value;
      let id: string, text: string;
      if (run.status === 'waiting' && state?.failure === 'Worker deadline exceeded') {
        // Legacy stranded attempts retain a checkpoint identity across authority adoption.
        id = `host:deadline:${identity({ runId: run.id, attempt: state.failedAttempt ?? { checkpoint: state.checkpoint ?? null, messageSequence: state.messageSequence ?? 0 } })}`;
        text = '[Host status] This turn stopped because its execution time limit was reached. No automatic retry has been started. Your message and recorded work are retained.';
      } else if (run.status === 'blocked' && state?.lastResult?.status === 'blocked' && state.checkpoint && state.lastResult.checkpoint?.artifact.sha256 === state.checkpoint.artifact.sha256) {
        let snapshot: { status?: string; failure?: { stage?: string; reason?: string } };
        try { snapshot = this.store.readJsonArtifact(state.checkpoint.artifact); } catch { continue; }
        if (snapshot.status !== 'blocked' || typeof snapshot.failure?.reason !== 'string') continue;
        const stages: Record<string, string> = { model: 'model request', tool: 'tool execution', recovery: 'checkpoint recovery', compaction: 'context compaction' };
        const name = snapshot.failure.stage ?? ''; if (!Object.hasOwn(stages, name)) continue;
        const stage = stages[name];
        // Publish a fixed stage description, never private provider diagnostics or context.
        id = `host:blocked:${identity({ runId: run.id, checkpoint: state.checkpoint.artifact.sha256, messageSequence: state.messageSequence ?? 0 })}`;
        text = snapshot.failure.reason === 'Physical request budget exhausted'
          ? '[Host status] This earlier turn reached its finite model request allowance. Its checkpoint and work are retained; no failed request has been retried.'
          : `[Host status] This turn stopped at the ${stage} step. No automatic retry has been started. Your message and recorded work are retained.`;
      } else continue;
      const target = this.store.get<GrantRecord>('host.run-grants', run.id)?.value.target;
      if (!target || target.transport === 'slack' && !this.config.slack?.allowSpeech) continue;
      ids.add(id);
      if (this.checkedFailureNotices.has(id) || this.effects.get(id)) continue;
      this.checkedFailureNotices.add(id);
      const payload = { channel: target.channel, ...(target.threadTs ? { threadTs: target.threadTs } : {}), kind: 'message', text };
      const request: PhysicalRequest = { id, runId: run.id, purpose: 'reasoning', provider: 'effect-receiver', model: 'speech_send', promptManifestId: id, requestDigest: identity(payload), reservationId: id, status: 'reserved', usage: { requests: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0 } };
      try {
        this.store.transaction(() => {
          this.options.authorityStore.assert(run.authority);
          this.resources.reserve(request);
          this.effects.create({ id, runId: run.id, stepId: id, kind: 'speech_send', payload, scope: run.scope, authority: run.authority, status: 'pending', revision: 0 });
          this.effects.authorize(id, id, run.authority);
        });
        this.checkedFailureNotices.delete(id); // Process the committed intent below.
      } catch { this.store.put('host.failure-notice-status', id, { runId: run.id, status: 'not_authorized' }, this.store.get('host.failure-notice-status', id)?.revision ?? null); }
    }
    for (const id of ids) {
      if (this.closing) continue;
      let effect = this.effects.get(id); if (!effect) continue;
      if (this.checkedFailureNotices.has(id) && (effect.status !== 'uncertain' || this.reconciledFailureNotices.has(id))) continue;
      this.checkedFailureNotices.add(id);
      try {
        if (effect.status === 'authorized') {
          const run = this.runtime.getRun(effect.runId);
          if (!run || this.hasPendingSteering(effect.runId) || this.managedElsewhere(run.id) || this.evolution.holds(run.id) || this.coding.holds(run.id) || !this.controls.eligibleRun(run.id, false)) continue;
          if (id.startsWith('host:deadline:') && run.status !== 'waiting') continue;
          if (id.startsWith('host:blocked:')) {
            const current = this.store.get<{ checkpoint?: ShellCheckpoint; messageSequence?: number }>('execution', run.id)?.value;
            if (run.status !== 'blocked' || !current?.checkpoint || id !== `host:blocked:${identity({ runId: run.id, checkpoint: current.checkpoint.artifact.sha256, messageSequence: current.messageSequence ?? 0 })}`) continue;
          }
          const request = this.resources.request(id)!;
          const started = this.noticeElapsedNow();
          effect = await this.effects.dispatch(id, run.authority, this.shutdown.signal, () => this.resources.dispatched({ ...request, status: 'dispatched' }));
          this.resources.settle({ ...request, status: effect.status === 'succeeded' ? 'succeeded' : effect.status === 'failed' ? 'failed' : 'uncertain', usage: { ...request.usage, elapsedMs: Math.max(0, this.noticeElapsedNow() - started) } });
        } else {
          // One bounded history reconciliation per host lifetime. Unknown delivery is
          // retained; never send another message just because its receipt was lost.
          if (effect.status === 'uncertain') { this.reconciledFailureNotices.add(id); effect = await this.effects.reconcile(id, this.options.authority); }
          const request = this.resources.request(id);
          if (request && ['dispatched', 'uncertain'].includes(request.status) && ['succeeded', 'failed'].includes(effect.status)) this.resources.settle({ ...request, status: effect.status === 'succeeded' ? 'succeeded' : 'failed' });
        }
      } catch { this.store.put('host.failure-notice-status', id, { runId: effect.runId, status: 'receipt_pending' }, this.store.get('host.failure-notice-status', id)?.revision ?? null); }
    }
  }
  output(runId: string): JsonValue[] { return this.store.list<{ runId: string; receipt: JsonValue }>('communications.direct-outbox').filter(row => row.value.runId === runId).map(row => row.value.receipt); }
  private providerAvailable(): boolean {
    if (this.developmentControl.isScripted) { this.developmentControl.assert(); return true; }
    try { selectedProviderKey(this.config.model, this.options.secrets); return true; } catch { return false; }
  }
  /** Process liveness is separate from permission/capacity to admit more physical work.
   * This read-only diagnosis never makes a provider call or exposes private run state. */
  health(): JsonValue {
    const reasons: string[] = [];
    if (this.closing) reasons.push('stopping');
    if (!this.directApi.listening) reasons.push('listener-unavailable');
    if (!this.providerAvailable()) reasons.push('provider-credential-unavailable');
    try { this.options.authorityStore.assert(this.options.authority); this.lease.assertHeld(); }
    catch { reasons.push('authority-unavailable'); }
    try {
      const usage = this.resources.snapshot(this.rootAllocation), limit = this.resources.effectiveEnvelope(this.rootAllocation);
      if (usage.cancelled) reasons.push('allowance-cancelled');
      if (limit.maxRequests !== null && usage.requests >= limit.maxRequests || limit.maxTokens !== null && usage.tokens >= limit.maxTokens || limit.maxCostUsd !== null && usage.costUsd >= limit.maxCostUsd || usage.elapsedMs >= limit.maxElapsedMs) reasons.push('allowance-exhausted');
      if (usage.concurrent >= limit.maxConcurrency || this.occupied() >= this.config.maxConcurrentRuns) reasons.push('capacity-occupied');
    } catch { reasons.push('accounting-unavailable'); }
    return { alive: true, execution: { admission: reasons.length ? 'held' : 'available', reasons,
      queued: this.store.list('host.pending-runs').length + this.store.list('execution.capacity-waits').length,
      meaning: 'Local authority and allowance check; each physical request still requires its full reservation.', providerConnectivity: 'not-probed' },
      kernelLimitsConfigured: !!this.config.resourceLimits, slack: { configured: !!this.config.slack,
        connectivity: this.config.slack ? 'not-probed' : 'disabled', ...(this.slackActivity ? { activity: this.slackActivity.diagnosis() } : {}) } };
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
    this.developmentControl.assertRun(runId);
    const existing = this.active.get(runId); if (existing) return existing;
    const run = this.runtime.getRun(runId); invariant(run, 'Unknown run');
    this.ingestCommunications(run);
    if (!this.controls.eligibleRun(runId, this.hasPendingSteering(runId))) return run;
    if (!this.providerAvailable()) { if (!['completed', 'cancelled'].includes(run.status)) this.enqueue(runId); return run; }
    if (this.occupied() >= this.config.maxConcurrentRuns || this.closing) { this.enqueue(runId); return run; }
    const queued = this.store.get('host.pending-runs', runId); if (queued) this.store.delete('host.pending-runs', runId, queued.revision);
    const bootstrapRun = this.store.get<{ runId: string }>('host.bootstrap', 'development:v1')?.value.runId;
    const task = this.runtime.resume(runId, bootstrapRun === runId && this.bootstrapPrompt ? this.bootstrapPrompt : this.prompt, signal).then(result => {
      for (const observation of this.runtime.observations(runId)) this.ingestObservation(observation);
      if (!this.closing) this.consolidation.finish(runId);
      if (!this.closing && !signal.aborted && result.status === 'waiting' && !this.managedElsewhere(runId) && this.hasSliceContinuation(runId)) this.enqueue(runId);
      return result;
    }).finally(() => { this.active.delete(runId); if (!this.closing) void this.tick().catch(() => undefined); });
    this.active.set(runId, task); return task;
  }
  private startDevelopment(): void {
    // Rotate consolidation and goals so either queue can progress under continuous input.
    if (this.developmentControl.kind !== 'no-memory' && this.consolidationTurn) {
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
      this.developmentControl.assertRestoredState();
      this.conversationObligations.confirm(); this.evolution.reconcileAcknowledgments(); this.evolution.wake(); this.controls.reconcileAcknowledgments(); this.controls.wake();
      this.coding.tick(this.occupied() < this.config.maxConcurrentRuns); this.coding.wake();
      this.activity(() => this.slackActivity?.tick());
      await this.notifySlackControls();
      await this.notifyConversationFailures();
      // Offline recovery retains intake and known local reconciliation. Missing credentials
      // must not consume scheduler slices or physical reservations on repeated polling.
      if (!this.providerAvailable()) return;
      // Give development first access to a freed slot on alternating admissions.
      if ((this.developmentTurn || !this.store.list('host.pending-runs').length) && !this.initiativeTask && this.occupied() < this.config.maxConcurrentRuns && !this.developmentControl.isScripted) { this.developmentTurn = false; this.startDevelopment(); }
      const pending = this.store.list<Run>('runs').filter(row => !this.managedElsewhere(row.key) && (!this.evolution.holds(row.key) || this.hasPendingSteering(row.key)) && (!this.coding.holds(row.key) || this.hasPendingSteering(row.key)) && this.controls.eligibleRun(row.key, this.hasPendingSteering(row.key)) && (row.value.status === 'ready' || this.store.get('host.pending-runs', row.key) || row.value.status === 'waiting' && this.hasPendingSteering(row.key)))
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
    this.activity(() => this.slackActivity?.start()); this.slackSocket?.start();
    this.loop = setInterval(() => { void this.tick().catch(error => this.store.append({ id: randomUUID(), stream: 'host', type: 'scheduler-error', data: { reason: error instanceof Error ? error.message : 'Unknown scheduler error' } })); }, this.config.pollMs);
    await this.tick();
  }
  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    this.closing = true; if (this.loop) clearInterval(this.loop);
    // Install one completion before any shutdown callback can reenter close().
    this.closeTask = Promise.resolve().then(async () => {
      const errors: unknown[] = [];
      // Persist unfinished ordinary work before abort can turn running into waiting.
      try {
        for (const row of this.store.list<Run>('runs')) {
          try { if (row.value.status === 'running' && !this.managedElsewhere(row.key)) this.enqueue(row.key); }
          catch (error) { errors.push(error); }
        }
      } catch (error) { errors.push(error); }
      try { this.shutdown.abort(); } catch (error) { errors.push(error); }
      try { await this.coding.close(); } catch (error) { errors.push(error); }
      try { await this.slackSocket?.stop(); } catch (error) { errors.push(error); }
      try { await this.slackActivity?.close(); } catch (error) { errors.push(error); }
      try {
        if (this.directApi.listening) await new Promise<void>((resolve, reject) => this.directApi.close(error => error ? reject(error) : resolve()));
      } catch (error) { errors.push(error); }
      await Promise.allSettled([...this.active.values(), ...(this.initiativeTask ? [this.initiativeTask] : [])]);
      while (this.ticking) await new Promise(resolve => setTimeout(resolve, 10));
      // Failure is not a drained-ingress/recovery claim. Keep ownership for explicit
      // host resolution, including a live Store for any late transport callback.
      if (errors.length) throw new AggregateError(errors, 'Application shutdown failed; Store and lease retained');
      this.store.close(); if (!this.options.lease) this.lease.close();
    });
    return this.closeTask;
  }
}
