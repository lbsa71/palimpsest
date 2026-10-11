import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { identity, invariant, scopeAllows, type Authority, type DataScope, type Effect, type EffectReceiver, type InboundInput, type JsonValue, type PromptManifest, type Run, type ShellPort } from '../packages/contracts/index.ts';
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
import { mistralGateway, reconcileProviderReceipts, transportRecorder } from './provider-gateway.ts';
import { validateConfiguration, type ApplicationConfig, type ApplicationSecrets } from './config.ts';
import { mindDevelopmentTools } from './development-tools.ts';

const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;
interface Target { channel: string; threadTs?: string; transport: 'direct' | 'slack'; scope: DataScope }
interface GrantRecord { scope: DataScope; workspace: string; target?: Target }
interface CommunicationRecord { input: InboundInput; runId: string; conversation: string }
export interface ApplicationOptions {
  config: ApplicationConfig; secrets: ApplicationSecrets;
  /** Only an external accepted release/bootstrap procedure supplies authority. */
  authority: Authority; authorityStore: AuthorityStore;
  performRequest?: Parameters<typeof createBrokerShell>[0]['performRequest'];
  slackBotApi?: SlackApi; slackAppApi?: SlackApi;
  lease?: ProcessLease;
}

/** Ordinary composition: Slack, direct requests and initiative execute the same confined Pi mind. */
export class AutarkApplication {
  readonly config: ApplicationConfig; readonly options: ApplicationOptions; readonly lease: ProcessLease;
  readonly store!: OperationalStore; readonly memory: DevelopmentalMemory; readonly resources: ResourceLedger;
  readonly delegation: DelegationCoordinator;
  readonly effects: EffectJournal; readonly runtime: DurableRuntime; readonly communications: CommunicationsCore;
  readonly goals: InitiativeRegistry; readonly drives: DriveRegistry; readonly plans: PlanRegistry; readonly obligations: ObligationRegistry;
  readonly scheduler: FairScheduler; readonly initiative: InitiativeRunner;
  readonly prompt: PromptManifest;
  readonly directApi: ReturnType<typeof createDirectApi>;
  readonly slackIngress?: SlackIngress; readonly slackRecovery?: SlackRecovery; readonly slackSocket?: SlackSocketMode;
  private active = new Map<string, Promise<Run>>();
  private shutdown = new AbortController();
  private loop?: NodeJS.Timeout;
  private ticking = false;
  private closing = false;
  private readonly rootAllocation = 'operating-envelope:v1';
  constructor(options: ApplicationOptions) {
    this.options = options; this.config = validateConfiguration(options.config);
    const config = this.config; options.authorityStore.assert(options.authority);
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
    this.plans = new PlanRegistry(this.store); this.obligations = new ObligationRegistry(this.store);
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
          modelProfiles: [{ provider: 'mistral', model: config.model.id, effort: config.model.reasoning ? config.model.effort : null }], currentDepth: assignedDepth, maxDepth: 2, maxChildren: 8, maxConcurrency: 2 };
      },
      artifactScope: artifact => { const record = this.store.get<{ scope: DataScope }>('host.artifact-scopes', artifact.sha256); invariant(record, 'Artifact has no authenticated disclosure scope'); return record.value.scope; },
      executeChild: async (task, signal) => {
        invariant(task.writablePaths.length === 1, 'Current child runtime requires one exclusive workspace');
        const child = this.runtime.admit({ id: `delegate:${task.id}`, source: 'delegation', externalId: task.id, externalRevision: '1', actorId: options.authority.generation, authenticated: true, scope: task.scope,
          value: json({ objective: task.objective, acceptanceCriteria: task.acceptanceCriteria, inputs: task.inputs.map(ref => ({ ref, content: Buffer.from(this.store.readArtifact(ref)).toString('utf8') })), outputLocation: task.outputLocation, cancellationConditions: task.cancellationConditions }) }, options.authority, task.resources, task.parentRunId);
        invariant(!this.store.get('host.run-grants', child.id), 'Child grant already assigned');
        this.store.put('host.run-grants', child.id, { scope: task.scope, workspace: task.writablePaths[0] }, null);
        this.store.put('host.child-runs', child.id, { taskId: task.id, depth: this.delegation.get(task.id)!.depth, allowedEffects: task.allowedEffects }, null);
        const result = await this.runtime.resume(child.id, this.prompt, signal);
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
        try { return { outcome: 'succeeded', receipt: this.store.putJsonArtifact(json(descriptor.execute(effect.payload))) }; }
        catch (error) { return { outcome: 'failed', receipt: this.store.putJsonArtifact({ error: error instanceof Error ? error.message : 'Development action rejected' }) }; }
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
        protectedPaths: [config.stateDirectory], nodeBinary: config.nodeBinary,
        worker: { model: config.model.id, modelProfile: { contextWindow: config.model.contextWindow, reasoning: config.model.reasoning }, ...(config.model.reasoning ? { reasoningEffort: config.model.effort } : {}),
          maxOutputTokens: config.model.maxOutputTokens, maxRequests: config.model.maxRequestsPerSlice, maxRetries: 0, timeoutMs: config.model.timeoutMs, tools,
          compaction: { thresholdMessages: 60, retainMessages: 20, instruction: { id: 'application.compaction', owner: 'application', role: 'system', order: 1, artifact: compaction, scope: { kind: 'public' }, replaceable: true, derivedFrom: [base.sha256] } } },
        timeoutMs: Math.min(config.conversationResources.maxElapsedMs, config.scheduler.quantumMs), maxPayloadBytes: 2_000_000, pricesPerMillion: config.model.pricesPerMillion,
        resolveFragment: async fragment => Buffer.from(this.store.readArtifact(fragment.artifact)).toString('utf8'),
        assertAuthority: () => options.authorityStore.assert(input.run.authority),
        performRequest: options.performRequest ?? mistralGateway({ apiKey: () => options.secrets.mistralApiKey, maxResponseBytes: 2_000_000 }), recordTransport: transportRecorder(this.store) });
      const frame = { role: 'user', timestamp: Date.now(), content: JSON.stringify({ hostContext: { runId: input.run.id, memory: context, agenda: this.goals.all(input.run.scope), target: record.target ?? null, workspace: '/work', operatingUsage: this.resources.snapshot(this.rootAllocation), attribution: 'Authenticated host state; retrieved content retains its own provenance.' } }) };
      return broker.run({ ...input, messages: [frame, ...input.messages] }, bridge, signal);
    } };
    this.runtime = new DurableRuntime({ store: this.store, shell, effects: this.effects, resources: this.resources });
    this.communications = new CommunicationsCore({ store: this.store, runtime: this.runtime,
      grant: () => ({ authority: options.authority, resources: config.conversationResources, parentRunId: this.rootAllocation }),
      onReady: run => { if (!this.closing) { this.ingestCommunications(run); this.enqueue(run.id); void this.resume(run.id).catch(() => undefined); } } });
    if (!this.store.get('allocations', 'initiative:ordinary')) this.resources.allocate('initiative:ordinary', config.scheduler.resources, this.rootAllocation);
    this.scheduler = new FairScheduler(this.store, this.goals, this.obligations, 'ordinary', config.scheduler, Date.now());
    this.initiative = new InitiativeRunner({ scheduler: this.scheduler, runtime: this.runtime, memory: this.memory, authority: options.authority,
      prompt: () => this.prompt, decide: () => ({ kind: 'block', reason: 'The accounted mind did not record an observation-grounded progress decision.' }) });
    this.directApi = createDirectApi({ core: this.communications, authenticate: bearerAuthenticator([{ token: options.secrets.directToken, principal: { id: config.direct.actorId, scope: config.direct.scope, modificationEligible: config.direct.modificationEligible } }]), outputForRun: runId => this.output(runId) });
    if (config.slack) {
      invariant(botApi && (options.slackAppApi || options.secrets.slackAppToken), 'Configured Slack requires host credentials');
      this.slackIngress = new SlackIngress({ core: this.communications, ...config.slack });
      this.slackRecovery = new SlackRecovery({ store: this.store, api: botApi, ingress: this.slackIngress, coverageStart: config.slack.coverageStart, lookbackSeconds: config.slack.lookbackSeconds });
      this.slackSocket = new SlackSocketMode({ botApi, appApi: options.slackAppApi ?? new SlackClient({ token: options.secrets.slackAppToken! }), ingress: this.slackIngress, recovery: this.slackRecovery,
        onError: kind => this.store.append({ id: randomUUID(), stream: 'host', type: 'transport-error', data: { kind, at: new Date().toISOString() } }) });
    }
    const interrupted = this.runtime.recover(); reconcileProviderReceipts(this.store, this.resources);
    for (const runId of interrupted) this.enqueue(runId);
    for (const row of this.store.list<Run>('runs')) if (!['completed', 'cancelled'].includes(row.value.status)) this.runtime.adopt(row.key, options.authority);
    this.initiative.recover(); this.delegation.recover();
    } catch (error) { try { this.store?.close(); } finally { if (!options.lease) this.lease.close(); } throw error; }
  }
  private grant(runId: string): GrantRecord {
    const old = this.store.get<GrantRecord>('host.run-grants', runId); if (old) return old.value;
    const run = this.runtime.getRun(runId); invariant(run, 'Unknown runtime grant');
    const workspace = join(this.config.workspaceDirectory, identity(runId)); mkdirSync(workspace, { recursive: true, mode: 0o700 });
    const value: GrantRecord = { scope: run.scope, workspace };
    this.store.put('host.run-grants', runId, value, null); return value;
  }
  private toolGrant(runId: string): ToolGrant {
    const grant = this.grant(runId);
    const child = this.store.get<{ allowedEffects: string[] }>('host.child-runs', runId)?.value;
    return { scope: grant.scope, workspace: { workspace: grant.workspace, protectedPaths: [this.config.stateDirectory, this.config.applicationRoot], nodeBinary: this.config.nodeBinary, timeoutMs: 30000, maxBytes: 131072, maxFiles: 10000, executables: this.config.commands, maxArgs: 64 },
      research: { allowedHosts: this.config.researchHosts, timeoutMs: 15000, maxBytes: 262144, maxRedirects: 3 },
      actions: toolDefinitions.map(tool => tool.name).filter(name => (!child || child.allowedEffects.includes(name)) && (name !== 'speech_send' || grant.target !== undefined && (grant.target.transport === 'direct' || this.config.slack?.allowSpeech))) };
  }
  private mindTools(runId: string) {
    const scope = this.grant(runId).scope;
    if (this.store.get('host.child-runs', runId)) return [];
    const childTask = (args: JsonValue) => { invariant(args && typeof args === 'object' && !Array.isArray(args) && typeof args.id === 'string', 'Child task ID required'); const task = this.delegation.get(args.id); invariant(task?.task.parentRunId === runId, 'Child task is not owned by this parent'); return task; };
    return [{ name: 'delegation_prepare', description: 'Allocate a fresh exclusive child workspace and return its host-approved bounded delegation grant; preparing does not start a child.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, execute: (args: JsonValue) => {
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
    }, ...mindDevelopmentTools(this.memory, scope, this.options.authority.generation), ...initiativeTools(this.goals, this.drives, this.plans, scope, this.options.authority.generation, this.config.scheduler.resources)];
  }
  private enqueue(runId: string): void { const row = this.store.get('host.pending-runs', runId); this.store.put('host.pending-runs', runId, { requestedAt: Date.now() }, row?.revision ?? null); }
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
  async resume(runId: string): Promise<Run> {
    const existing = this.active.get(runId); if (existing) return existing;
    const run = this.runtime.getRun(runId); invariant(run, 'Unknown run');
    if (this.active.size >= this.config.maxConcurrentRuns || this.closing) return run;
    const queued = this.store.get('host.pending-runs', runId); if (queued) this.store.delete('host.pending-runs', runId, queued.revision);
    const task = this.runtime.resume(runId, this.prompt, this.shutdown.signal).then(result => {
      for (const observation of this.runtime.observations(runId)) {
        const id = `tool:${observation.id}`;
        if (!this.store.get('host.ingested', id)) this.store.transaction(() => { this.memory.ingest({ id, runId, sourceId: observation.id, actorId: observation.provenance.actorId, channel: 'tool', scope: result.scope, at: observation.provenance.recordedAt, content: { kind: observation.kind, value: observation.value } }); this.store.put('host.ingested', id, true, null); });
      }
      return result;
    }).finally(() => this.active.delete(runId));
    this.active.set(runId, task); return task;
  }
  async tick(): Promise<void> {
    if (this.ticking || this.closing) return; this.ticking = true;
    try {
      for (const row of this.store.list<Run>('runs')) {
        if (this.active.size >= this.config.maxConcurrentRuns) break;
        // Ready admissions are automatic; failed/blocked continuations require reconciliation or an explicit decision.
        if (row.value.status === 'ready' || this.store.get('host.pending-runs', row.key)) { this.ingestCommunications(row.value); void this.resume(row.key).catch(() => undefined); }
      }
      if (this.active.size < this.config.maxConcurrentRuns) await this.initiative.tick(this.shutdown.signal);
    } finally { this.ticking = false; }
  }
  async start(): Promise<void> {
    invariant(!this.loop && !this.closing, 'Application already started or closed');
    await new Promise<void>((resolve, reject) => { this.directApi.once('error', reject); this.directApi.listen(this.config.direct.port, this.config.direct.host, () => { this.directApi.off('error', reject); resolve(); }); });
    this.slackSocket?.start();
    this.loop = setInterval(() => { void this.tick().catch(error => this.store.append({ id: randomUUID(), stream: 'host', type: 'scheduler-error', data: { reason: error instanceof Error ? error.message : 'Unknown scheduler error' } })); }, this.config.pollMs);
    await this.tick();
  }
  async close(): Promise<void> {
    if (this.closing) return; this.closing = true; if (this.loop) clearInterval(this.loop);
    this.shutdown.abort(); await this.slackSocket?.stop();
    if (this.directApi.listening) await new Promise<void>(resolve => this.directApi.close(() => resolve()));
    await Promise.allSettled([...this.active.values()]);
    while (this.ticking) await new Promise(resolve => setTimeout(resolve, 10));
    this.store.close(); if (!this.options.lease) this.lease.close();
  }
}
