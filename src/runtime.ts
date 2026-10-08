import type { Communications, InboundMessage } from './communications.ts';
import { CommunicationsError } from './communications.ts';
import type { Provider } from './providers.ts';
import { ProviderError } from './providers.ts';
import { Store } from './store.ts';
import type { Json, Task } from './store.ts';
import { conversationRequest } from './agent/brain.ts';

export interface RuntimeOptions {
  store: Store;
  provider: Provider;
  communications: Communications[];
  maxCallsPerTask?: number;
}

function checkpoint(task: Task): Record<string, Json> {
  return task.checkpoint !== null && typeof task.checkpoint === 'object' && !Array.isArray(task.checkpoint)
    ? task.checkpoint : {};
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

  constructor(options: RuntimeOptions) {
    this.#store = options.store;
    this.#provider = options.provider;
    this.#communications = new Map(options.communications.map(adapter => [adapter.name, adapter]));
    this.#maxCalls = options.maxCallsPerTask ?? 4;
    if (!Number.isSafeInteger(this.#maxCalls) || this.#maxCalls < 1) throw new Error('Task call budget must be a positive integer');
  }

  async submit(input: InboundMessage): Promise<Task> {
    if (this.#stopped) throw new Error('Runtime is stopped');
    if (!this.#communications.has(input.source)) throw new Error('Unknown communication source');
    const task = this.#store.enqueue({ conversationId: input.conversationId, input: input.text,
      source: input.source, eventId: input.id });
    if (task.state === 'queued' && task.checkpoint === null) {
      return this.#store.updateTask(task.id, { checkpoint: { calls: 0, replyTo: input.replyTo ?? null } });
    }
    return task;
  }

  status(id: string): Task | undefined { return this.#store.task(id); }
  events(after = 0) { return this.#store.listEvents({ after }); }
  hasUserWork(): boolean { return this.#store.listTasks({ states: ['queued', 'running'] }).length > 0; }

  cancel(id: string): Task | undefined {
    const task = this.#store.task(id);
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
    while (!this.#stopped) {
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
      if (answer === undefined) {
        const calls = typeof progress.calls === 'number' ? progress.calls : 0;
        if (calls >= this.#maxCalls) {
          this.#store.updateTask(task.id, { state: 'failed', error: 'inference_budget_exhausted' });
          return;
        }
        progress = { ...progress, calls: calls + 1 };
        this.#store.updateTask(task.id, { checkpoint: progress });
        this.#store.appendEvent('inference.started', { provider: this.#provider.name, attempt: calls + 1 }, task.id);
        const response = await this.#provider.complete({
          ...conversationRequest(task, this.#store.listMemories(task.conversationId)), signal,
        });
        if (this.#store.task(task.id)?.state !== 'running' || signal.aborted) return;
        answer = response.text;
        progress = { ...progress, answer, provider: response.provider, model: response.model,
          usage: { inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens } };
        this.#store.updateTask(task.id, { checkpoint: progress });
        this.#store.appendEvent('inference.completed', { provider: response.provider, model: response.model,
          usage: progress.usage! }, task.id);
      }
      const effectId = `${task.id}:result`;
      const existing = this.#store.effect(effectId);
      if (existing && existing.state !== 'completed') throw new Error('effect_reconciliation_required');
      if (!existing) {
        const adapter = this.#communications.get(task.source);
        if (!adapter) throw new Error('communication_adapter_unavailable');
        const message = { conversationId: task.conversationId, taskId: task.id, text: answer, kind: 'result' as const,
          ...(typeof progress.replyTo === 'string' ? { replyTo: progress.replyTo } : {}) };
        this.#store.reserveEffect({ id: effectId, taskId: task.id, kind: 'communication', payload: { ...message } });
        try {
          await adapter.send(message);
          this.#store.completeEffect(effectId, { delivered: true });
        } catch (error) {
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
      this.#store.finishTask(task.id, answer, {
        scope: task.conversationId, kind: 'episodic', source: `task:${task.id}`, confidence: 1,
        content: JSON.stringify({ user: task.input, response: answer, note: 'Recorded exchange; response assertions are not independently verified facts.' }),
        evidence: [`task:${task.id}`],
      });
    } catch (error) {
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
    await this.#draining;
  }
}
