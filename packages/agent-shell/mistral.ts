import { captureShellEnvironment, nodeShellFetch, readShellJson, shellTimeout, throwShellFailures, type ShellEnvironment } from './environment.ts';
import { createHash } from 'node:crypto';
import { AssistantMessageEventStream, collapseSystemMessages, contentText, getCurrentTools, getSystemMessageText } from './vendor/pi/ai/index.ts';
import type { AssistantMessage, JsonValue, Message, Model, TranscriptContext, Usage } from './vendor/pi/ai/types.ts';
import type { StreamFn } from './vendor/pi/agent/types.ts';

export const DEFAULT_MISTRAL_MODEL = 'mistral-large-latest';
export type Attempt = { id: string; payload: string; digest: string; attempt: number; purpose: 'reasoning' | 'compaction'; model: string };
export type AttemptOutcome = { status: 'completed' | 'failed' | 'uncertain' | 'cancelled'; usage?: { inputTokens: number; outputTokens: number }; httpStatus?: number };
export interface MistralTransportOptions {
  environment?: ShellEnvironment;
  model?: string;
  endpoint?: string;
  apiKey: () => string | Promise<string>;
  fetch?: typeof fetch;
  maxRequests: number;
  /** Only explicit HTTP 429 responses are retried. Network/5xx outcomes remain uncertain. */
  maxRetries?: number;
  timeoutMs?: number;
  maxOutputTokens?: number;
  /** Provider capability/configuration is supplied explicitly, never inferred from a model name. */
  modelProfile?: { contextWindow: number; reasoning: boolean };
  reasoningEffort?: 'none' | 'high';
  reserve(attempt: Attempt): Promise<void>;
  dispatched(attempt: Attempt): Promise<void>;
  settle(attempt: Attempt, outcome: AttemptOutcome): Promise<void>;
}

export function mistralModel(id = DEFAULT_MISTRAL_MODEL, profile?: MistralTransportOptions['modelProfile']): Model<string> {
  return { id, name: id, api: 'mistral-chat-completions', provider: 'mistral', baseUrl: 'https://api.mistral.ai/v1', input: ['text'], reasoning: profile?.reasoning ?? false, contextWindow: profile?.contextWindow ?? 0, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
}

export function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function emptyUsage(): Usage { return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }; }
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid Mistral response object');
  return value as Record<string, unknown>;
}
const NATIVE_CHUNK = 'mistral-chunk:';
function parseContent(value: unknown): AssistantMessage['content'] {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') return value ? [{ type: 'text', text: value }] : [];
  if (!Array.isArray(value)) throw new Error('Unsupported Mistral content');
  return value.map(raw => {
    const chunk = record(raw);
    if (chunk.type === 'text' && typeof chunk.text === 'string') return { type: 'text' as const, text: chunk.text, textSignature: NATIVE_CHUNK + JSON.stringify(chunk) };
    if (chunk.type === 'thinking' && Array.isArray(chunk.thinking)) {
      const thinking = chunk.thinking.map(inner => { const item = record(inner); if (item.type !== 'text' || typeof item.text !== 'string') throw new Error('Unsupported Mistral thinking content'); return item.text; }).join('');
      return { type: 'thinking' as const, thinking, thinkingSignature: NATIVE_CHUNK + JSON.stringify(chunk) };
    }
    throw new Error('Unsupported Mistral content block');
  });
}
function assistantContent(message: AssistantMessage): unknown {
  const chunks = message.content.filter(block => block.type !== 'toolCall');
  if (!chunks.some(block => block.type === 'thinking' || block.textSignature?.startsWith(NATIVE_CHUNK))) return contentText(message.content) || null;
  return chunks.map(block => {
    const signature = block.type === 'thinking' ? block.thinkingSignature : block.textSignature;
    if (signature?.startsWith(NATIVE_CHUNK)) return record(JSON.parse(signature.slice(NATIVE_CHUNK.length)));
    return block.type === 'thinking' ? { type: 'thinking', thinking: [{ type: 'text', text: block.thinking }] } : { type: 'text', text: block.text };
  });
}

// Recovery appends a settled result after a newer host input. Mistral requires
// the whole batch immediately after its assistant; only this request view moves.
function mistralMessageOrder(messages: Message[]): Message[] {
  const ordered: Message[] = [];
  for (let index = 0; index < messages.length; index++) {
    const assistant = messages[index];
    if (assistant.role === 'toolResult') throw Error('Mistral tool result has no assistant batch');
    ordered.push(assistant);
    if (assistant.role !== 'assistant') continue;
    const calls = assistant.content.filter(block => block.type === 'toolCall');
    if (!calls.length) continue;
    if (assistant.stopReason !== 'toolUse') throw Error('Mistral tool batch is truncated or incomplete');
    const pending = new Map(calls.map(call => [call.id, call]));
    if (pending.size !== calls.length) throw Error('Mistral tool batch has duplicate call IDs');
    const results: Message[] = []; const deferredUsers: Message[] = [];
    const stepId = (assistant as Message & { aeonStepId?: string }).aeonStepId;
    let next = index + 1;
    for (; next < messages.length; next++) {
      const message = messages[next];
      if (message.role === 'assistant' || message.role === 'system') break;
      if (message.role === 'user') { deferredUsers.push(message); continue; }
      const call = pending.get(message.toolCallId);
      const resultStepId = (message as Message & { aeonStepId?: string }).aeonStepId;
      if (!call || call.name !== message.toolName || stepId !== resultStepId) throw Error('Mistral tool result does not match its assistant batch');
      pending.delete(message.toolCallId); results.push(message);
    }
    if (pending.size) throw Error('Mistral tool batch lacks complete results');
    ordered.push(...results, ...deferredUsers);
    index = next - 1;
  }
  return ordered;
}

/** Choose a raw-history cut without separating a complete assistant batch from
 * its later recovered results. Provider ordering validates the same exact native
 * identities as normal requests; historical messages themselves never move. */
export function mistralCompactionBoundary(history: Message[], boundary: number, continuation: Message[] = history): number {
  if (!Number.isSafeInteger(boundary) || boundary < 0 || boundary > history.length) throw Error('Invalid Mistral compaction boundary');
  const indices = new Map(history.map((message, index) => [message, index]));
  const ordered = mistralMessageOrder(continuation);
  for (let index = 0; index < ordered.length; index++) {
    const message = ordered[index]!;
    if (message.role !== 'assistant') continue;
    const calls = message.content.filter(block => block.type === 'toolCall'); if (!calls.length) continue;
    const start = indices.get(message), results = ordered.slice(index + 1, index + 1 + calls.length);
    const resultIndices = results.map(result => indices.get(result));
    if (start === undefined || resultIndices.some(result => result === undefined)) throw Error('Mistral compaction view differs from retained history');
    const end = Math.max(...resultIndices as number[]);
    if (start < boundary && end >= boundary) boundary = start;
    index += calls.length;
  }
  return boundary;
}

export function mistralPayload(context: TranscriptContext, model: string, maxTokens: number, reasoningEffort?: 'none' | 'high'): string {
  const normalized = collapseSystemMessages(context);
  const messages = mistralMessageOrder(normalized.messages).map(message => {
    if (message.role === 'system') return { role: 'system', content: getSystemMessageText(message) };
    if (message.role === 'user') {
      if (typeof message.content !== 'string' && message.content.some(block => block.type !== 'text')) throw new Error('Mistral transport currently supports text input only');
      return { role: 'user', content: contentText(message.content) };
    }
    if (message.role === 'toolResult') return { role: 'tool', tool_call_id: message.toolCallId, name: message.toolName, content: contentText(message.content) };
    const calls = message.content.filter(block => block.type === 'toolCall').map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } }));
    return { role: 'assistant', content: assistantContent(message), ...(calls.length ? { tool_calls: calls } : {}) };
  });
  const tools = getCurrentTools(normalized.messages).map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
  return JSON.stringify({ model, messages, ...(tools.length ? { tools, tool_choice: 'auto' } : {}), ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}), stream: false, max_tokens: maxTokens });
}

/** One finite transport per run; reservations cover retries and compaction as well as ordinary calls. */
export function createMistralTransport(options: MistralTransportOptions): { stream: StreamFn; setPurpose(purpose: Attempt['purpose']): void; attempts(): number } {
  options = { ...options, modelProfile: options.modelProfile && { ...options.modelProfile } };
  const environment = captureShellEnvironment(options.environment), transport = options.fetch ?? nodeShellFetch();
  const { apiKey, reserve, dispatched: markDispatched, settle } = options;
  const identities = new Set<string>();
  if (!Number.isSafeInteger(options.maxRequests) || options.maxRequests < 1) throw new Error('A finite positive request budget is required');
  const retries = options.maxRetries ?? 0;
  if (!Number.isSafeInteger(retries) || retries < 0 || retries > 3) throw new Error('Retry budget must be between zero and three');
  if (options.reasoningEffort && !options.modelProfile?.reasoning) throw new Error('Reasoning effort requires an explicitly capable model profile');
  if (options.modelProfile && (!Number.isSafeInteger(options.modelProfile.contextWindow) || options.modelProfile.contextWindow < 1)) throw new Error('Invalid configured model context window');
  let dispatched = 0;
  let purpose: Attempt['purpose'] = 'reasoning';
  const stream: StreamFn = (model, context, requestOptions) => {
    const events = new AssistantMessageEventStream(environment);
    const message: AssistantMessage = { role: 'assistant', content: [], api: model.api, provider: 'mistral', model: model.id, usage: emptyUsage(), stopReason: 'pending', timestamp: environment.wallNow() };
    void (async () => {
      try {
        const payload = mistralPayload(context, model.id, options.maxOutputTokens ?? 4096, options.reasoningEffort);
        for (let retry = 0; ; retry++) {
          requestOptions?.signal?.throwIfAborted();
          if (dispatched >= options.maxRequests) throw new Error('Physical request budget exhausted');
          const key = await apiKey();
          if (!key) throw new Error('Mistral API key is required');
          const attempt: Attempt = { id: environment.newId(), payload, digest: digest(payload), attempt: dispatched + 1, purpose, model: model.id };
          if (identities.has(attempt.id)) throw new Error('Duplicate shell request identity');
          identities.add(attempt.id);
          await reserve(attempt);
          let outcome: AttemptOutcome = { status: 'cancelled' };
          let retryAllowed = false;
          let timeout: ReturnType<typeof shellTimeout> | undefined, response: Response | undefined;
          let readStarted = false, sent = false;
          const failures: unknown[] = [];
          try {
            requestOptions?.signal?.throwIfAborted();
            timeout = shellTimeout(environment.scheduleTimeout, options.timeoutMs ?? 60_000, requestOptions?.signal);
            const signal = timeout.signal;
            await markDispatched(attempt);
            signal.throwIfAborted();
            dispatched++; sent = true;
            outcome = { status: 'uncertain' };
            response = await transport(options.endpoint ?? 'https://api.mistral.ai/v1/chat/completions', { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: payload, signal });
            signal.throwIfAborted();
            outcome.httpStatus = response.status;
            if (!response.ok) {
              if (response.status === 429) { outcome.status = 'failed'; retryAllowed = retry < retries; }
              if (!retryAllowed) throw new Error(`Mistral HTTP ${response.status}`);
            } else {
              readStarted = true;
              const body = record(await readShellJson(response, signal));
              if (!Array.isArray(body.choices) || body.choices.length === 0) throw new Error('Missing Mistral choice');
              const choice = record(body.choices[0]); const reply = record(choice.message);
              message.content.push(...parseContent(reply.content));
              if (options.reasoningEffort) message.providerThinkingLevel = options.reasoningEffort;
              if (reply.tool_calls !== undefined && reply.tool_calls !== null && !Array.isArray(reply.tool_calls)) throw new Error('Invalid Mistral tool calls');
              for (const raw of (reply.tool_calls ?? []) as unknown[]) {
                const call = record(raw); const fn = record(call.function);
                if (typeof call.id !== 'string' || typeof fn.name !== 'string' || typeof fn.arguments !== 'string') throw new Error('Invalid Mistral tool call');
                const args = record(JSON.parse(fn.arguments)) as { [key: string]: JsonValue };
                message.content.push({ type: 'toolCall', id: call.id, name: fn.name, arguments: args });
              }
              if (body.usage !== undefined) {
                const usage = record(body.usage);
                if (typeof usage.prompt_tokens !== 'number' || typeof usage.completion_tokens !== 'number' || !Number.isSafeInteger(usage.prompt_tokens) || !Number.isSafeInteger(usage.completion_tokens) || usage.prompt_tokens < 0 || usage.completion_tokens < 0) throw new Error('Invalid Mistral usage');
                message.usage.input = usage.prompt_tokens; message.usage.output = usage.completion_tokens; message.usage.totalTokens = usage.prompt_tokens + usage.completion_tokens;
                outcome.usage = { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens };
              }
              if (typeof body.id === 'string') message.responseId = body.id;
              if (typeof body.model === 'string') message.responseModel = body.model;
              if (!['stop', 'length', 'tool_calls'].includes(String(choice.finish_reason))) throw new Error('Unsupported Mistral finish reason');
              message.stopReason = choice.finish_reason === 'length' ? 'length' : message.content.some(block => block.type === 'toolCall') ? 'toolUse' : 'stop';
              outcome.status = 'completed';
            }
          } catch (error) { failures.push(error); }
          finally {
            const beforeCleanup = failures.length;
            if (response?.body && !readStarted) { try { await response.body.cancel(); } catch (error) { failures.push(error); } }
            try { timeout?.cancel(); } catch (error) { failures.push(error); }
            if (failures.length > beforeCleanup && sent) { outcome = { status: 'uncertain', httpStatus: outcome.httpStatus }; retryAllowed = false; }
            try { await settle(attempt, outcome); } catch (error) { failures.push(error); }
          }
          throwShellFailures(failures);
          if (retryAllowed) continue;
          break;
        }
        events.push({ type: 'start', partial: message });
        events.push({ type: 'done', reason: message.stopReason as 'stop' | 'length' | 'toolUse', message });
      } catch (error) {
        // Never expose HTTP bodies or credential-bearing fetch exception text to the model/audit.
        message.content = [];
        message.stopReason = requestOptions?.signal?.aborted ? 'aborted' : 'error';
        message.errorMessage = error instanceof Error && /^(Mistral HTTP|Physical request budget|Mistral API key|Invalid Mistral|Missing Mistral|Unsupported Mistral)/.test(error.message) ? error.message : 'Mistral transport or accounting failed';
        try { events.push({ type: 'error', reason: message.stopReason, error: message }); }
        catch (timing) { events.fail(new AggregateError([error, timing], 'Shell response timing failed', { cause: error })); }
      }
    })();
    return events;
  };
  return { stream, setPurpose(value) { purpose = value; }, attempts() { return dispatched; } };
}

export function asJson(value: unknown): JsonValue { return JSON.parse(JSON.stringify(value)) as JsonValue; }
