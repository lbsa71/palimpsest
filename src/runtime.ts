import type { Communications, InboundMessage } from './communications.ts';
import { CommunicationsError } from './communications.ts';
import type { CompletionRequest, Provider } from './providers.ts';
import { ProviderError } from './providers.ts';
import { Store } from './store.ts';
import type { Json, Memory, Task } from './store.ts';
import { conversationRequest } from './agent/brain.ts';
import { conversationPolicy, maySuggestSelfModification, sameSlackAuthor } from './conversation-policy.ts';
import type { ConversationActions } from './conversation-actions.ts';
import { validateMemoryProjection } from './memory-projection.ts';
import { assertConversationRole } from './conversation-role.ts';

export interface RuntimeOptions {
  store: Store;
  provider: Provider;
  communications: Communications[];
  maxCallsPerTask?: number;
  requestFactory?: (task: Task, memories: Memory[]) => CompletionRequest | Promise<CompletionRequest>;
  /** Trusted receiving boundary; never a model-supplied role or epoch. */
  authorize?: (boundary: 'tool' | 'store' | 'memory' | 'message') => void;
  selfModificationUserIds?: readonly string[];
  /** Host-observed facts, never supplied by a cognitive worker or transport body. */
  hostFacts?: () => Record<string, Json>;
  conversationActions?: ConversationActions;
  /** Exact active-worker manifest floor. Absent only for standalone legacy factories. */
  memoryProjectionChecks?: () => readonly string[];
}

function checkpoint(task: Task): Record<string, Json> {
  return task.checkpoint !== null && typeof task.checkpoint === 'object' && !Array.isArray(task.checkpoint)
    ? task.checkpoint : {};
}

function command(input: string): { kind: string; id: string; text?: string } | undefined {
  const match = /^(?:<@[A-Z0-9]+>\s*)?\/?(status|cancel|correct)\s+([A-Za-z0-9_-]+)(?:\s+([\s\S]+))?$/i.exec(input.trim());
  if (!match || (match[1]!.toLowerCase() === 'correct' ? !match[3]?.trim() : match[3] !== undefined)) return;
  return { kind: match[1]!.toLowerCase(), id: match[2]!, text: match[3]?.trim() };
}

/** Shared task semantics; neither Slack nor the direct API owns execution. */
export class AgentRuntime {
  readonly #store: Store;
  readonly #provider: Provider;
  readonly #communications: Map<string, Communications>;
  readonly #maxCalls: number;
  #draining?: Promise<void>;
  #controller?: AbortController;
  #current?: string;
  #stopped = false;
  #paused = false;
  readonly #commands = new Set<Promise<void>>();
  readonly #requestFactory: NonNullable<RuntimeOptions['requestFactory']>;
  readonly #authorize: NonNullable<RuntimeOptions['authorize']>;
  readonly #selfModificationUserIds: readonly string[];
  readonly #hostFacts: NonNullable<RuntimeOptions['hostFacts']>;
  readonly #actions?: ConversationActions;
  readonly #memoryProjectionChecks?: RuntimeOptions['memoryProjectionChecks'];

  constructor(options: RuntimeOptions) {
    this.#store = options.store;
    this.#provider = options.provider;
    this.#communications = new Map(options.communications.map(adapter => [adapter.name, adapter]));
    this.#maxCalls = options.maxCallsPerTask ?? 4;
    this.#requestFactory = options.requestFactory ?? conversationRequest;
    this.#authorize = options.authorize ?? (() => {});
    this.#selfModificationUserIds = Object.freeze([...(options.selfModificationUserIds ?? [])]);
    if (this.#selfModificationUserIds.some(id => !/^[A-Za-z0-9]+$/.test(id))) throw new Error('Modification whitelist requires explicit user IDs');
    this.#hostFacts = options.hostFacts ?? (() => ({}));
    this.#actions = options.conversationActions;
    this.#memoryProjectionChecks = options.memoryProjectionChecks;
    if (!Number.isSafeInteger(this.#maxCalls) || this.#maxCalls < 1) throw new Error('Task call budget must be a positive integer');
  }

  async submit(input: InboundMessage): Promise<Task> {
    if (this.#stopped) throw new Error('Runtime is stopped');
    if (!this.#communications.has(input.source)) throw new Error('Unknown communication source');
    // Transport normalization is not the only ingress: direct callers must
    // preserve the same role boundary before any durable task is created.
    assertConversationRole(input);
    let task = this.#store.enqueue({ conversationId: input.conversationId, input: input.text,
      source: input.source, eventId: input.id,
      ...(input.slackAuthor ? { slackAuthor: { ...input.slackAuthor } } : {}) });
    if (task.state === 'queued' && task.checkpoint === null) {
      task = this.#store.updateTask(task.id, { checkpoint: { calls: 0, replyTo: input.replyTo ?? null } });
    }
    if (!this.#paused && task.state === 'queued' && command(task.input)) {
      this.#authorize('store'); task = this.#store.updateTask(task.id, { state: 'running' });
      // Register ownership before execution can enter a transport callback.
      const work = Promise.resolve().then(() => this.#execute(task, new AbortController().signal)); this.#commands.add(work);
      try { await work; } finally { this.#commands.delete(work); }
      return this.#store.task(task.id)!;
    }
    return task;
  }

  status(id: string): Task | undefined { return this.#store.task(id); }
  events(after = 0) { return this.#store.listEvents({ after }); }
  hasUserWork(): boolean { return this.#store.listTasks({ states: ['queued', 'running'] }).length > 0; }

  cancel(id: string): Task | undefined {
    const task = this.#store.task(id);
    if (task?.source !== 'peer') this.#actions?.cancel(id);
    if (!task || ['succeeded', 'failed', 'cancelled'].includes(task.state)) return task;
    const cancelled = this.#store.updateTask(id, { state: 'cancelled' });
    if (this.#current === id) this.#controller?.abort();
    return cancelled;
  }

  retry(id: string): Task {
    const task = this.#store.task(id);
    if (!task || task.state !== 'waiting_for_provider') throw new Error('Only waiting tasks can be retried');
    return this.#store.updateTask(id, { state: 'queued', error: null });
  }

  runUntilIdle(): Promise<void> {
    if (!this.#draining) this.#draining = this.#drain().finally(() => { this.#draining = undefined; });
    return this.#draining;
  }

  async #drain(): Promise<void> {
    while (!this.#stopped && !this.#paused) {
      this.#authorize('store');
      const task = this.#store.claimNext();
      if (!task) return;
      this.#controller = new AbortController(); this.#current = task.id;
      try { await this.#execute(task, this.#controller.signal); }
      finally { this.#controller = undefined; this.#current = undefined; }
    }
  }

  async #execute(task: Task, signal: AbortSignal): Promise<void> {
    let progress = checkpoint(task);
    try {
      let answer = typeof progress.answer === 'string' ? progress.answer : undefined;
      if (answer === undefined && typeof progress.decisionText === 'string' && this.#actions) {
        this.#authorize('store');
        answer = this.#actions.accept(task, progress.decisionText);
        progress = { ...progress, answer }; this.#store.updateTask(task.id, { checkpoint: progress });
      }
      if (answer === undefined && command(task.input)) {
        this.#authorize('store'); answer = this.#command(task);
        progress = { ...progress, answer };
        this.#store.updateTask(task.id, { checkpoint: progress });
      }
      if (answer === undefined) {
        this.#authorize('store');
        const calls = typeof progress.calls === 'number' ? progress.calls : 0;
        if (calls >= this.#maxCalls) {
          this.#store.updateTask(task.id, { state: 'failed', error: 'inference_budget_exhausted' });
          return;
        }
        progress = { ...progress, calls: calls + 1 };
        this.#store.updateTask(task.id, { checkpoint: progress });
        this.#store.appendEvent('inference.started', { provider: this.#provider.name, attempt: calls + 1 }, task.id);
        this.#authorize('memory');
        // The candidate sees exactly the bounded set whose source facts the
        // host supplies; it cannot select an unlabeled older memory.
        const interactive = this.#actions?.eligible(task) === true;
        const scopedMemories = this.#conversationMemories(task, this.#store.listMemories(task.conversationId));
        const memories = interactive ? this.#actions!.selectMemories(task,scopedMemories) : scopedMemories.slice(-12);
        const memorySourceFacts = (memory: Memory) => {
          const origin = memory.source.startsWith('task:') ? this.#store.task(memory.source.slice(5)) : undefined;
          const sameScope = origin?.conversationId === task.conversationId ? origin : undefined;
          const proposal = sameScope ? this.#store.growth(`conversation:${sameScope.id}`) : undefined;
          return { memoryId: memory.id, sourceTaskId: sameScope?.id ?? null,
            conversationSource: sameScope && ['peer', 'direct', 'slack'].includes(sameScope.source) ? sameScope.source : null,
            slackAuthor: sameScope?.slackAuthor ?? null,
            selfModificationSuggestionEligible: sameScope ? (this.#actions ? this.#actions.eligible(sameScope) : maySuggestSelfModification(sameScope, this.#selfModificationUserIds)) : false,
            // A submitted proposal is not a release or proof that its claims
            // are true. Match the trusted task-linked record, never its text.
            sourceProposalRecorded: !!proposal && proposal.sourceTaskId === sameScope?.id
              && proposal.origin === proposal.id && proposal.outcome !== null };
        };
        // Collect policy outside candidate execution. These facts guide cognition;
        // future effect receivers must separately enforce the same eligibility.
        const facts = {
          ...this.#hostFacts(),
          memoryPersistence: this.#store.persistent ? 'on-disk SQLite, survives restart' : 'in-memory SQLite, does not survive restart',
          memoryMechanics: { scopedRetrieval: true, versionedCorrections: true, logicalForgetting: true,
            automaticPruning: false, conversationMemoryManagementTools: false },
          conversationActionTools: interactive ? ['propose_cognitive_change', 'status', 'cancel'] : [],
          conversationDispatchToGrowth: interactive, selfModificationDispatcher: interactive,
          configuredConversationCapabilities: { conversationDispatchToGrowth: !!this.#actions, selfModificationDispatcher: !!this.#actions },
          requester: { source: task.source, slackAuthor: task.slackAuthor ?? null,
            selfModificationSuggestionEligible: this.#actions ? this.#actions.eligible(task) : maySuggestSelfModification(task, this.#selfModificationUserIds) },
          memorySources: memories.map(memorySourceFacts),
        };
        let request = await this.#requestFactory(structuredClone(task), structuredClone(memories));
        if (signal.aborted || this.#store.task(task.id)?.state !== 'running') throw new ProviderError('cancelled', 'Task was interrupted after worker construction');
        let projection;
        const checks = this.#memoryProjectionChecks?.();
        // Pre-P06 ordinary workers may have custom untrusted prompt shapes.
        // Interactive preparation always needs a validated descriptor bridge;
        // ordinary lineage becomes enforced only with the admitted capability.
        if (checks && (interactive || checks.includes('memory-provenance') || checks.includes('memory-context-budget'))) {
          this.#authorize('memory');
          const currentTask = this.#store.task(task.id)!;
          if ((this.#actions?.eligible(currentTask) === true) !== interactive) throw new ProviderError('protocol', 'Current conversation eligibility changed during worker construction');
          const current = this.#conversationMemories(currentTask, memories.flatMap(memory => {
            const value = this.#store.memory(memory.id, task.conversationId); return value ? [value] : [];
          }));
          const authorizedCurrent = interactive ? this.#actions!.selectMemories(currentTask, current) : current;
          projection = validateMemoryProjection({ request, task: currentTask, supplied: memories, authorizedCurrent, checks, interactive });
          // Identity and authority come from current host records in the actual
          // selected order, never from candidate-provided facts or stale policy.
          facts.memorySources = projection.map(descriptor => memorySourceFacts(authorizedCurrent.find(memory => memory.id === descriptor.id)!));
        }
        if (interactive) {
          request = this.#actions!.prepare(task, memories, request, facts, projection);
          // prepare persists the host-observed source binding before inference.
          // Keep it when adding the provider result to the durable checkpoint.
          progress = checkpoint(this.#store.task(task.id)!);
        }
        if (signal.aborted) throw new ProviderError('cancelled', 'Task was interrupted before inference');
        this.#authorize('tool');
        const response = await this.#provider.complete({ ...request, system: `${request.system}\n\n${conversationPolicy}\nHost facts: ${JSON.stringify(facts)}`, signal });
        this.#authorize('store');
        if (this.#store.task(task.id)?.state !== 'running' || signal.aborted) return;
        if (interactive) {
          progress = { ...progress, decisionText: response.text };
          this.#store.updateTask(task.id, { checkpoint: progress });
          answer = this.#actions!.accept(task, response.text);
        } else answer = response.text;
        progress = { ...progress, answer, provider: response.provider, model: response.model,
          usage: { inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens } };
        this.#store.updateTask(task.id, { checkpoint: progress });
        this.#store.appendEvent('inference.completed', { provider: response.provider, model: response.model,
          usage: progress.usage! }, task.id);
      }
      const effectId = `${task.id}:result`;
      this.#authorize('store');
      const existing = this.#store.effect(effectId);
      if (existing && existing.state !== 'completed') throw new Error('effect_reconciliation_required');
      if (!existing) {
        const adapter = this.#communications.get(task.source);
        if (!adapter) throw new Error('communication_adapter_unavailable');
        const message = { conversationId: task.conversationId, taskId: task.id, text: answer, kind: 'result' as const,
          ...(typeof progress.replyTo === 'string' ? { replyTo: progress.replyTo } : {}) };
        this.#store.reserveEffect({ id: effectId, taskId: task.id, kind: 'communication', payload: { ...message } });
        try {
          this.#authorize('message');
          await adapter.send(message);
          this.#authorize('store');
          this.#store.completeEffect(effectId, { delivered: true });
        } catch (error) {
          this.#authorize('store');
          if (error instanceof CommunicationsError && error.delivery === 'rejected') {
            this.#store.completeEffect(effectId, { delivered: false, rejected: true });
            throw new Error('communication_rejected');
          }
          this.#store.markEffectUnknown(effectId, 'Delivery outcome requires independent reconciliation');
          throw new Error('effect_reconciliation_required');
        }
      } else if (existing.result !== null && typeof existing.result === 'object' && !Array.isArray(existing.result) && existing.result.delivered === false) {
        throw new Error('communication_rejected');
      }
      if (this.#store.task(task.id)?.state !== 'running' || signal.aborted) return;
      this.#authorize('memory');
      this.#store.finishTask(task.id, answer, {
        scope: task.conversationId, kind: 'episodic', source: `task:${task.id}`, confidence: 1,
        content: JSON.stringify({ user: task.input, response: answer, slackAuthor: task.slackAuthor ?? null,
          note: 'Recorded exchange; response assertions are not independently verified facts. Authorship is not execution authority.' }),
        evidence: [`task:${task.id}`],
      });
    } catch (error) {
      this.#authorize('store');
      if (this.#store.task(task.id)?.state !== 'running') return;
      if (this.#store.listEffects(task.id).some(effect => effect.state !== 'completed')) {
        this.#store.updateTask(task.id, { state: 'waiting_for_provider', error: 'effect_reconciliation_required' });
        return;
      }
      if (this.#stopped || signal.aborted) {
        this.#store.updateTask(task.id, { state: 'queued' });
        return;
      }
      if (error instanceof ProviderError) {
        const waiting = ['unavailable', 'timeout', 'configuration'].includes(error.code);
        this.#store.updateTask(task.id, { state: waiting ? 'waiting_for_provider' : 'failed', error: `provider_${error.code}` });
      } else {
        const reason = error instanceof Error && ['effect_reconciliation_required', 'communication_rejected', 'communication_adapter_unavailable'].includes(error.message)
          ? error.message : 'runtime_failure';
        this.#store.updateTask(task.id, { state: reason === 'effect_reconciliation_required' ? 'waiting_for_provider' : 'failed', error: reason });
      }
    }
  }

  async stop(): Promise<void> {
    this.#stopped = true; this.#controller?.abort();
    await this.#settleOwnedWork();
  }

  async quiesce(): Promise<void> {
    this.#paused = true; this.#controller?.abort();
    await this.#settleOwnedWork();
  }

  async #settleOwnedWork(): Promise<void> {
    // A rejected drain must not abandon a concurrent command's external effect.
    // Paused/stopped is set first, so ingress can enqueue but cannot add execution.
    const settled = await Promise.allSettled([...(this.#draining ? [this.#draining] : []), ...this.#commands]);
    const failure = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) throw failure.reason;
  }

  async resume(): Promise<void> {
    if (this.#stopped) throw new Error('Runtime is stopped');
    this.#paused = false;
    await this.runUntilIdle();
  }

  #conversationMemories(task: Task, memories: Memory[]): Memory[] {
    if (task.source !== 'peer') return memories;
    // Before peer ingress existed, operator scopes could use any label. Scope
    // alone cannot authorize those legacy episodes or anonymous derivations.
    return memories.filter(memory => {
      if (memory.kind !== 'episodic' || !memory.source.startsWith('task:')) return false;
      const origin = this.#store.task(memory.source.slice(5));
      return origin?.source === 'peer' && origin.conversationId === task.conversationId;
    });
  }

  #command(task: Task): string {
    const parsed = command(task.input)!; const target = this.#store.task(parsed.id);
    if (!target || target.conversationId !== task.conversationId || target.id === task.id
      || (task.source === 'peer' && target.source !== 'peer')) return 'Task not found in this conversation.';
    if (parsed.kind === 'status') return `Task ${target.id}: ${target.state}${target.error ? ` (${target.error})` : ''}.${this.#actions?.status(target.id) ?? ''}`;
    if (task.source === 'slack' && !sameSlackAuthor(task, target)) return 'Only the original Slack author can cancel or correct this task.';
    const cancelledProposal = task.source === 'peer' ? false : this.#actions?.cancel(target.id) ?? false;
    this.cancel(target.id);
    if (parsed.kind === 'cancel') return cancelledProposal ? `Self-modification cancellation requested for ${target.id}; committed transfers cannot be undone by this command.` : `Task ${target.id}: ${this.#store.task(target.id)!.state}.`;
    const replacement = this.#store.enqueue({ conversationId: task.conversationId, source: task.source, input: parsed.text!, eventId: `${task.id}:replacement`,
      ...(task.slackAuthor ? { slackAuthor: { ...task.slackAuthor } } : {}) });
    if (replacement.checkpoint === null) this.#store.updateTask(replacement.id, { checkpoint: { calls: 0, replyTo: checkpoint(task).replyTo ?? null } });
    this.#store.appendEvent('task.corrected', { originalId: target.id, replacementId: replacement.id }, task.id);
    return `Correction recorded. Replacement task ${replacement.id} is queued; original history is preserved.`;
  }
}
