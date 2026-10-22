import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson, identity, invariant, scopeAllows, validateCapturedPrompt, type ArtifactRef, type Authority, type JsonValue, type Observation, type PhysicalRequest, type Run, type ShellCheckpoint, type ToolCall } from '../packages/contracts/index.ts';
import type { OperationalStore } from '../packages/storage/index.ts';
import { awaitCapacity } from '../packages/runtime/execution/capacity.ts';
import { DevelopmentalMemory } from '../packages/development/index.ts';
import { runWorker } from '../packages/supervisor/worker-process.ts';
import { createGenerationMind, type GenerationCall, type GenerationMindPorts, type GenerationResult, type LoadedGeneration } from './generation-mind.ts';
import { candidateNodeBinary, verifyApplication } from './candidate.ts';
import type { HostBindings } from './materialize.ts';
import { hostResourceLedger, type HostResourceOptions } from './host-resources.ts';
import { captureBrokerTiming, type BrokerTiming } from './broker-shell.ts';
import { providerResponseRecorder, transportRecorder } from './provider-gateway.ts';
import { SuccessionDialogue, type DialogueTurn, type SuccessionBinding } from './succession-dialogue.ts';
import { enqueueSuccessionProbe, readSuccessionProbe } from './succession-probe.ts';

const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;
interface RoleSession { bindingDigest: string; candidateId: string; runId: string; checkpoint?: ShellCheckpoint; seed?: ArtifactRef; }
export interface SuccessionHostEnvironment {
  loadCandidate(id: string): LoadedGeneration;
  workspace(id: string): string;
  continuity(binding: Omit<SuccessionBinding, 'context'>, store: OperationalStore): JsonValue;
  validateContext(binding: SuccessionBinding, store: OperationalStore): void;
  runWorker: GenerationMindPorts['runWorker']; timing: BrokerTiming;
  wait(milliseconds: number, signal?: AbortSignal): Promise<void>;
}
export function nodeSuccessionHostEnvironment(host: HostBindings, wallClock: () => number = Date.now): SuccessionHostEnvironment {
  return {
    loadCandidate(id) { const candidate = verifyApplication(host.artifactStore, id, host.nodeBinary); return { candidate,
      applicationRoot: join(host.artifactStore, id, 'payload'), nodeBinary: candidateNodeBinary(candidate, host.artifactStore, host.nodeBinary) }; },
    workspace(id) { const path = join(host.workspaceDirectory, `succession-${identity(id)}`); mkdirSync(path, { recursive: true, mode: 0o700 }); return path; },
    continuity(binding, store) {
      const parent = store.get<Run>('runs', binding.runId)?.value;
      invariant(parent && identity(parent.scope) === identity(binding.scope), 'Continuity audience differs from caller');
      const checkpoint = store.get<{ checkpoint?: ShellCheckpoint }>('execution', binding.runId)?.value.checkpoint;
      invariant(checkpoint && checkpoint.runId === binding.runId, 'Incumbent needs its own actual settled conversation checkpoint');
      const content = store.readJsonArtifact<Record<string, JsonValue>>(checkpoint.artifact);
      invariant(content.status === 'completed' && content.failure === undefined && Array.isArray(content.messages), 'Incumbent conversation is not at a safe completed boundary');
      invariant(Buffer.byteLength(canonicalJson(content)) <= 1_000_000, 'Incumbent continuity exceeds the declared protocol envelope');
      const service = new DevelopmentalMemory(store, () => new Date(wallClock()).toISOString());
      const entries = store.list<{ record: import('../packages/contracts/index.ts').MemoryRecord }>('development.memories');
      const facets = store.list<{ id: string; scope: import('../packages/contracts/index.ts').DataScope; status: string; memoryIds: string[] }>('development.self');
      const known = new Set([...entries.map(entry => entry.key), ...facets.map(entry => entry.key)]), referenced = new Set<string>();
      const visit = (value: unknown, depth = 0): void => {
        invariant(depth < 96, 'Continuity dependency nesting exceeds bound');
        if (typeof value === 'string') { if (known.has(value)) referenced.add(value); let parsed: unknown; try { parsed = JSON.parse(value); } catch { return; } if (parsed !== value) visit(parsed, depth + 1); }
        else if (Array.isArray(value)) value.forEach(item => visit(item, depth + 1));
        else if (value && typeof value === 'object') Object.values(value).forEach(item => visit(item, depth + 1));
      };
      visit(content.messages);
      for (const id of referenced) {
        if (entries.some(entry => entry.key === id)) invariant(service.get(id, binding.scope), 'Original conversation references withdrawn, expired or unauthorized memory');
        const facet = facets.find(entry => entry.key === id)?.value;
        if (facet) invariant(facet.status === 'active' && scopeAllows(facet.scope, binding.scope) && facet.memoryIds.every(source => service.get(source, binding.scope)), 'Original conversation references withdrawn or unauthorized self facet');
      }
      // Conservatively fence ALL existing audience-visible memory, including records omitted
      // by retrieval budgets and records embedded in older native conversation/tool results.
      const privacyManifest = entries.filter(entry => scopeAllows(entry.value.record.scope, binding.scope)).map(entry => ({ id: entry.key, digest: identity(entry.value), accessible: !!service.get(entry.key, binding.scope) }));
      const selfManifest = facets.filter(entry => scopeAllows(entry.value.scope, binding.scope)).map(entry => ({ id: entry.key, digest: identity(entry.value) }));
      const memory = service.context({ audience: binding.scope, query: binding.objective, maxRecords: 24, maxBytes: 16384 });
      return json({ scope: binding.scope, sourceRunId: binding.runId, sourceCheckpoint: checkpoint, conversation: content.messages,
        memory, privacyManifest, selfManifest, referencedIds: [...referenced].filter(id => entries.some(entry => entry.key === id)), inputCut: identity(store.events(binding.runId).filter(event => ['admitted', 'steering', 'cancelled'].includes(event.type))), objective: binding.objective, criteria: binding.criteria,
        provenance: 'Authenticated incumbent conversation and audience-filtered memory; no live state handles or production authority.' });
    },
    validateContext(binding, store) {
      const captured = store.readJsonArtifact<{ sourceRunId: string; scope: JsonValue; sourceCheckpoint: ShellCheckpoint; inputCut: string; selfManifest: { id: string; digest: string }[]; referencedIds: string[]; privacyManifest: { id: string; digest: string; accessible: boolean }[]; memory: { memories: { id: string }[]; self: { id: string }[] } }>(binding.context);
      invariant(captured.sourceRunId === binding.runId && identity(captured.scope) === identity(binding.scope), 'Continuity audience changed');
      // Re-read the original source: withdrawal/scrubbing must invalidate copied context.
      store.readArtifact(captured.sourceCheckpoint.artifact);
      invariant(captured.inputCut === identity(store.events(binding.runId).filter(event => ['admitted', 'steering', 'cancelled'].includes(event.type))), 'New input/cancellation requires fresh incumbent review before cutover');
      const memory = new DevelopmentalMemory(store, () => new Date(wallClock()).toISOString());
      invariant(Array.isArray(captured.privacyManifest), 'Missing original continuity privacy manifest');
      for (const item of captured.selfManifest) invariant(identity(store.get('development.self', item.id)?.value ?? null) === item.digest, 'Original checkpoint self facet changed or was withdrawn');
      for (const id of captured.referencedIds) invariant(memory.get(id, binding.scope), 'Original checkpoint memory expired or became unauthorized');
      for (const item of captured.privacyManifest) {
        invariant(identity(store.get('development.memories', item.id)?.value ?? null) === item.digest, 'Original checkpoint memory changed or was withdrawn');
        if (item.accessible) invariant(memory.get(item.id, binding.scope), 'Original checkpoint memory expired or became unauthorized');
      }
      for (const record of captured.memory.memories) invariant(identity(memory.get(record.id, binding.scope) ?? null) === identity(record), 'Captured memory expired, changed scope or was withdrawn');
      for (const facet of captured.memory.self) invariant(identity(store.get('development.self', facet.id)?.value ?? null) === identity(facet), 'Captured self facet changed or was withdrawn');
    }, runWorker, timing: captureBrokerTiming(),
    wait(ms, signal) { return new Promise((resolve, reject) => { signal?.throwIfAborted(); const timer = setTimeout(done, ms);
      function done() { signal?.removeEventListener('abort', abort); resolve(); }
      function abort() { clearTimeout(timer); reject(signal?.reason); }
      signal?.addEventListener('abort', abort, { once: true }); }); },
  };
}
export interface SuccessionHostOptions extends HostResourceOptions {
  now(): number;
  store: OperationalStore; host: HostBindings; environment: SuccessionHostEnvironment;
  current(): { candidateId: string; authority: Authority; phase: string };
  assertAuthority(authority: Authority): void;
  dispatchAuthority<T>(authority: Authority, operation: () => T): T;
  resourceLimits?: Parameters<typeof createGenerationMind>[0]['resourceLimits'];
  performRequest(payload: string, signal: AbortSignal, call?: GenerationCall): Promise<{ status: number; body: string }>;
}
/** Accepted-host composition for two isolated cognitive roles and the actual serving probe.
 * Logical generation identity is separate from CURRENT physical dispatch authority. */
export class SuccessionHost {
  readonly options: SuccessionHostOptions; readonly dialogue: SuccessionDialogue;
  private active = new Map<string, { binding: SuccessionBinding; turn: DialogueTurn; call: GenerationCall }>();
  private readonly abort = new AbortController();
  close(): void { this.abort.abort(new Error('Supervisor succession shutdown')); }
  private signal(signal?: AbortSignal): AbortSignal { return signal ? AbortSignal.any([signal, this.abort.signal]) : this.abort.signal; }
  private readonly execute: ReturnType<typeof createGenerationMind>;
  constructor(selected: SuccessionHostOptions) {
    const options = this.options = Object.freeze({ ...selected, environment: Object.freeze({ ...selected.environment }) });
    const { store, environment } = options;
    const check = (call: GenerationCall) => {
      const active = this.active.get(call.turnId); invariant(active && identity(active.call) === identity(call), 'Generation call lacks its authenticated host session');
      this.assertBinding(active.binding, call.role === 'observer' ? 'observe' : 'interview');
      invariant(call.candidateId === (call.role === 'successor' ? active.binding.candidateId : active.binding.incumbentId), 'Wrong frozen generation');
    };
    this.execute = createGenerationMind({ resourceLimits: options.resourceLimits, protectedPaths: [options.host.stateDirectory, ...(options.host.codexHome ? [options.host.codexHome] : [])],
      timeoutMs: 90000, maxPayloadBytes: 2_000_000, maxResponseBytes: 2_000_000, maxMailboxBytes: 16384, maxMailboxEvents: 1 }, {
      loadCandidate: environment.loadCandidate, assertCall: check, workspace: call => environment.workspace(call.sessionId),
      bridge: call => this.bridge(call), assertMailboxSource: (call, tool) => this.assertMailboxSource(call, tool),
      appendMailbox: async (call, tool, event) => {
        check(call); const active = this.active.get(call.turnId)!; this.assertMailboxSource(call, tool);
        const observation: Observation = { id: `generation-mailbox:${tool.id}`, runId: call.input.run.id, stepId: tool.stepId, sourceId: tool.id, kind: 'result',
          value: json({ recorded: true, operationId: active.binding.id, turnId: call.turnId, role: call.role, event }),
          provenance: { actorId: `generation:${call.candidateId}:${call.sessionId}`, sourceIds: [call.turnId], recordedAt: new Date(this.now()).toISOString(), derivation: 'observed' } };
        const old = store.get('host.generation-mailbox', observation.id);
        if (old) {
          const retained = old.value as unknown as Observation;
          invariant(retained.runId === observation.runId && retained.stepId === observation.stepId && retained.sourceId === observation.sourceId && identity(retained.value) === identity(observation.value) && retained.provenance.actorId === observation.provenance.actorId, 'Mailbox event identity changed');
          return retained;
        }
        store.put('host.generation-mailbox', observation.id, observation, null); return observation;
      }, retainArtifact: source => store.putArtifact(source), readArtifact: ref => Buffer.from(store.readArtifact(ref)).toString('utf8'),
      performRequest: (call, payload, signal) => { check(call); let pending: Promise<{ status: number; body: string }> | undefined;
        options.dispatchAuthority(options.current().authority, () => { pending = options.performRequest(payload, signal, call); });
        invariant(pending, 'Generation transport did not dispatch'); return pending; },
      recordResponse: (call, id, response) => {
        const ledger = this.ledger(); providerResponseRecorder({ store, ledger, runId: call.input.run.id, scope: call.input.run.scope, maxBytes: 2_000_000 })(id, response);
        const prior = store.get('host.generation-responses', id); const value = { turnId: call.turnId, sessionId: call.sessionId, runId: call.input.run.id };
        invariant(!prior || identity(prior.value) === identity(value), 'Generation response reassigned'); if (!prior) store.put('host.generation-responses', id, value, null);
      }, recordTransport: (_call, receipt) => transportRecorder(store)(receipt),
      onTransportFinished: (call, id) => { invariant(this.ledger().request(id)?.runId === call.input.run.id, 'Foreign generation cleanup'); this.ledger().releaseConcurrency(id, { kind: 'transport-terminal', reason: 'Supervised generation transport completed and settled' }); },
      runWorker: environment.runWorker, brokerTiming: environment.timing,
    });
    this.dialogue = new SuccessionDialogue({ store, assertBinding: (binding, phase) => this.assertBinding(binding, phase),
      turn: (binding, turn, signal) => this.turn(binding, turn, signal), probe: (binding, question, signal) => this.probe(binding, question, signal) });
  }
  private now(): number { return this.options.now(); }
  private ledger() { return hostResourceLedger(this.options.store, { tokens: 0, costUsd: 0, elapsedMs: 0 }, this.options); }
  private assertBinding(binding: SuccessionBinding, phase: 'interview' | 'observe' | 'retire'): void {
    const { store } = this.options, current = this.options.current(); this.options.assertAuthority(current.authority);
    const parent = store.get<Run>('runs', binding.runId)?.value;
    invariant(parent && parent.status !== 'cancelled' && identity(parent.scope) === identity(binding.scope) && !this.ledger().snapshot(binding.runId).cancelled, 'Succession parent cancelled or outside audience');
    if (phase === 'interview') invariant(current.candidateId === binding.incumbentId && identity(current.authority) === identity(binding.authority) && current.phase === 'accepted', 'Incumbent interview has stale serving authority');
    else invariant(current.candidateId === binding.candidateId && (phase === 'retire' ? current.phase === 'accepted' : current.phase === 'probation'), 'Observer targets another serving successor');
    this.options.environment.validateContext(binding, store);
    for (const exposed of store.list<{ operationId: string; bindingDigest: string; context: ArtifactRef }>('host.succession-exposed-contexts').filter(row => row.value.operationId === binding.id)) {
      invariant(exposed.value.bindingDigest === identity(binding), 'Exposed continuity was rebound');
      this.options.environment.validateContext({ ...binding, context: exposed.value.context }, store);
    }
    const context = store.readJsonArtifact<{ scope: JsonValue; sourceRunId: string }>(binding.context);
    invariant(identity(context.scope) === identity(binding.scope) && context.sourceRunId === binding.runId, 'Succession continuity provenance changed');
  }
  capture(binding: Omit<SuccessionBinding, 'context'>): SuccessionBinding {
    // The retained mailbox proof currently supports the accepted Mistral mind format.
    // Refuse other cognition profiles before any role dispatch instead of spending
    // on a response whose native tool evidence this protocol cannot yet qualify.
    for (const id of [binding.incumbentId, binding.candidateId]) {
      const config = this.options.environment.loadCandidate(id).candidate.inputs.configuration as unknown as { model: { provider?: string } };
      invariant((config.model.provider ?? 'mistral') === 'mistral', 'Succession cognition provider unsupported; no generation model dispatched');
    }
    const content = this.options.environment.continuity(binding, this.options.store);
    return { ...binding, context: this.options.store.putJsonArtifact(content) };
  }
  private session(binding: SuccessionBinding, successor: boolean): { id: string; session: RoleSession; run: Run } {
    const { store } = this.options, id = `generation:${identity({ operationId: binding.id, role: successor ? 'successor' : 'incumbent' })}`;
    let row = store.get<RoleSession>('host.generation-sessions', id);
    if (!row) store.transaction(() => {
      const runId = `run:${id}`, candidateId = successor ? binding.candidateId : binding.incumbentId;
      const parent = store.get<{ envelope: import('../packages/contracts/index.ts').ResourceEnvelope }>('allocations', binding.runId);
      invariant(parent, 'Original succession parent allocation required'); this.ledger().allocate(runId, parent.value.envelope, binding.runId);
      const run: Run = { id: runId, authority: this.options.current().authority, scope: binding.scope, revision: 0, status: 'waiting' };
      store.put('runs', runId, run, null); store.put('host.child-runs', runId, { taskId: id, depth: 1, allowedEffects: [] }, null);
      const session: RoleSession = { bindingDigest: identity(binding), candidateId, runId };
      if (!successor) {
        const context = store.readJsonArtifact<{ sourceCheckpoint: ShellCheckpoint }>(binding.context);
        const original = store.readJsonArtifact<Record<string, JsonValue>>(context.sourceCheckpoint.artifact);
        invariant(original.status === 'completed' && original.failure === undefined, 'Unsafe incumbent native checkpoint');
        session.seed = context.sourceCheckpoint.artifact;
        session.checkpoint = { ...context.sourceCheckpoint, runId, revision: run.revision };
      }
      store.put('host.generation-sessions', id, session, null); row = store.get<RoleSession>('host.generation-sessions', id);
    });
    const session = row!.value; invariant(session.bindingDigest === identity(binding), 'Generation session rebound');
    const run = store.get<Run>('runs', session.runId)!.value;
    return { id, session, run };
  }
  private async turn(binding: SuccessionBinding, turn: DialogueTurn, signal?: AbortSignal) {
    signal = this.signal(signal); signal.throwIfAborted();
    const { store } = this.options, { id, session, run } = this.session(binding, turn.role === 'successor');
    const context = store.readJsonArtifact<Record<string, JsonValue>>(binding.context), record = this.dialogue.status(binding.id)!;
    const priorContext = store.get<{ operationId: string; bindingDigest: string; context: ArtifactRef }>('host.succession-exposed-contexts', turn.id);
    let catchUp: JsonValue;
    if (priorContext) {
      invariant(priorContext.value.operationId === binding.id && priorContext.value.bindingDigest === identity(binding), 'Exposed turn continuity was rebound');
      this.options.environment.validateContext({ ...binding, context: priorContext.value.context }, store);
      catchUp = store.readJsonArtifact(priorContext.value.context);
    } else {
      catchUp = this.options.environment.continuity(binding, store);
      const contexts = store.list<{ operationId: string }>('host.succession-exposed-contexts').filter(row => row.value.operationId === binding.id);
      invariant(contexts.length < 64, 'Succession continuity exposure bound reached');
      store.put('host.succession-exposed-contexts', turn.id, { operationId: binding.id, bindingDigest: identity(binding), context: store.putJsonArtifact(catchUp) }, null);
    }
    const checkpoint = session.checkpoint ? { ...session.checkpoint, revision: run.revision } : undefined;
    // Privacy manifests and input cuts are host validation indexes, not mind
    // evidence. Keep the complete captured artifacts and fences above. The
    // incumbent already has its actual conversation in its native checkpoint;
    // the successor receives that conversation once in the attested evidence.
    const visible = (value: JsonValue, conversation: boolean): JsonValue => {
      const captured = value as Record<string, JsonValue>;
      return json({ scope: captured.scope, sourceRunId: captured.sourceRunId, memory: captured.memory,
        provenance: captured.provenance, ...(conversation ? { conversation: captured.conversation } : {}) });
    };
    const call: GenerationCall = { sessionId: id, turnId: turn.id, role: turn.role, candidateId: session.candidateId,
      input: { run, ...(checkpoint ? { checkpoint } : {}), messages: [
        json({ role: 'user', timestamp: this.now(), content: canonicalJson(json({ continuity: visible(context, turn.role === 'successor'),
          ...(identity(context) === identity(catchUp) ? {} : { catchUp: visible(catchUp, false) }) })) }),
        json({ role: 'user', timestamp: this.now(), content: canonicalJson(json({
          transcript: record.turns.filter(item => item.status === 'completed'), request: turn.message, phase: turn.phase })) }),
      ] } };
    this.active.set(turn.id, { binding, turn, call });
    let result: GenerationResult;
    try { result = await this.execute(call, signal); } finally { this.active.delete(turn.id); }
    invariant(result.shell.status === 'completed' && result.mailbox.length === 1 && result.shell.checkpoint, 'Generation did not complete its own actual mailbox answer');
    const event = result.mailbox[0]!;
    const evidence = store.putJsonArtifact(json({ bindingDigest: identity(binding), turnId: turn.id, role: turn.role, candidateId: call.candidateId,
      sessionId: id, event, checkpoint: result.shell.checkpoint, result }));
    return { event, evidence };
  }
  private bridge(call: GenerationCall): ReturnType<GenerationMindPorts['bridge']> {
    const { store } = this.options, ledger = this.ledger();
    const valid = (request: PhysicalRequest) => { const active = this.active.get(call.turnId); invariant(active, 'Generation turn is no longer live'); this.assertBinding(active.binding, call.role === 'observer' ? 'observe' : 'interview'); invariant(request.runId === call.input.run.id && store.get<{ manifest: { requestDigest: string } }>('prompts', request.promptManifestId)?.value.manifest.requestDigest === request.requestDigest, 'Generation physical request lacks its captured payload'); };
    const capacity = async (request: PhysicalRequest, phase: 'reserve' | 'dispatch', attempt: () => void, signal?: AbortSignal) => {
      try { await awaitCapacity({ attempt: () => { valid(request); attempt(); }, signal, subscribe: listener => ledger.subscribeCapacity(listener),
        waiting: () => { const previous = store.get('execution.capacity-waits', request.id); if (!previous) store.put('execution.capacity-waits', request.id, { runId: request.runId, requestId: request.id, phase, startedAt: this.now() }, null); } }); }
      finally { const row = store.get('execution.capacity-waits', request.id); if (row) store.delete('execution.capacity-waits', request.id, row.revision); }
    };
    return {
      capturePrompt: async (manifest, payload) => { validateCapturedPrompt(manifest, payload); const value = { manifest, artifact: store.putArtifact(payload) }, prior = store.get('prompts', manifest.id); invariant(!prior || identity(prior.value) === identity(value), 'Generation prompt identity changed'); if (!prior) store.put('prompts', manifest.id, value, null); },
      reserve: (request, signal) => capacity(request, 'reserve', () => ledger.reserve(request), signal), dispatched: (request, signal) => capacity(request, 'dispatch', () => this.options.dispatchAuthority(this.options.current().authority, () => ledger.dispatched(request)), signal),
      settle: async receipt => { invariant(receipt.runId === call.input.run.id, 'Foreign generation receipt'); ledger.settle(receipt); },
      persistCheckpoint: async (runId, revision, shell, content) => {
        invariant(runId === call.input.run.id && revision === call.input.run.revision, 'Foreign generation checkpoint');
        const value = content as { observationIds?: string[] }; invariant(Array.isArray(value.observationIds), 'Generation checkpoint lacks observation identity');
        const checkpoint = { runId, revision, shell, artifact: store.putJsonArtifact(content), observationIds: value.observationIds };
        const row = store.get<RoleSession>('host.generation-sessions', call.sessionId)!; store.put('host.generation-sessions', call.sessionId, { ...row.value, checkpoint }, row.revision); return checkpoint;
      },
      readCheckpoint: async checkpoint => { const saved = store.get<RoleSession>('host.generation-sessions', call.sessionId)?.value.checkpoint;
        invariant(saved && saved.runId === call.input.run.id && identity(saved.artifact) === identity(checkpoint.artifact), 'Unassigned generation checkpoint'); return store.readJsonArtifact(checkpoint.artifact); },
    };
  }
  private assertMailboxSource(call: GenerationCall, tool: ToolCall): void {
    const { store } = this.options;
    const matches = store.list<{ turnId: string; sessionId: string; runId: string }>('host.generation-responses').filter(row => row.value.turnId === call.turnId && row.value.sessionId === call.sessionId && row.value.runId === call.input.run.id);
    invariant(matches.some(row => {
      const response = store.get<{ httpStatus: number; response: ArtifactRef }>('host.model-responses', row.key)?.value;
      if (response?.httpStatus !== 200 || this.ledger().request(row.key)?.status !== 'succeeded' || this.ledger().request(row.key)?.runId !== call.input.run.id) return false;
      const body = store.readJsonArtifact<{ choices?: { finish_reason?: string; message?: { tool_calls?: { id: string; function: { name: string; arguments: string | JsonValue } }[] } }[] }>(response.response);
      return body.choices?.some(choice => choice.finish_reason === 'tool_calls' && choice.message?.tool_calls?.some(raw => tool.id.endsWith(`:${raw.id}`) && raw.function.name === tool.name && identity(typeof raw.function.arguments === 'string' ? JSON.parse(raw.function.arguments) : raw.function.arguments) === identity(tool.arguments)));
    }), 'Generation mailbox lacks an actual matching model response');
  }
  private async probe(binding: SuccessionBinding, question: string, signal?: AbortSignal): Promise<ArtifactRef> {
    signal = this.signal(signal); signal.throwIfAborted();
    const current = this.options.current(), request = { id: `succession-probe:${identity(binding)}`, bindingDigest: identity(binding), operationId: binding.id,
      parentRunId: binding.runId, candidateId: binding.candidateId, authority: current.authority, scope: binding.scope, question };
    this.options.dispatchAuthority(current.authority, () => enqueueSuccessionProbe(this.options.store, request));
    const started = this.now();
    while (this.now() - started < 120000) {
      signal?.throwIfAborted(); this.assertBinding(binding, 'observe');
      const result = readSuccessionProbe(this.options.store, request); if (result) return result;
      await this.options.environment.wait(100, signal);
    }
    throw new Error('Serving successor probe unresolved; preserve original work and do not infer regression or retry');
  }
}
