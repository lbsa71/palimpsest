import { captureShellEnvironment, nodeShellFetch, readShellJson, shellTimeout, throwShellFailures } from './environment.ts';
import { identity } from '../contracts/index.ts';
import { AssistantMessageEventStream, collapseSystemMessages, contentText, getCurrentTools, getSystemMessageText } from './vendor/pi/ai/index.ts';
import type { AssistantMessage, JsonValue, Model, TranscriptContext } from './vendor/pi/ai/types.ts';
import type { StreamFn } from './vendor/pi/agent/types.ts';
import { digest, emptyUsage, type Attempt, type AttemptOutcome, type MistralTransportOptions } from './mistral.ts';

export const OPENAI_ENDPOINT = 'https://api.openai.com/v1/responses';
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid OpenAI response object');
  return value as Record<string, unknown>;
}
function nonempty(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
/** Validate the implemented text/function subset; retain entire native items, including opaque fields. */
export function openaiOutput(value: unknown): { native: JsonValue[]; content: AssistantMessage['content'] } {
  if (!Array.isArray(value) || !value.length) throw new Error('Invalid OpenAI output');
  const content: AssistantMessage['content'] = [];
  const ids = new Set<string>(); const calls = new Set<string>();
  for (const raw of value) {
    const item = object(raw);
    if (!nonempty(item.id) || ids.has(item.id)) throw new Error('Invalid OpenAI item identity');
    ids.add(item.id);
    if (item.status !== undefined && item.status !== 'completed') throw new Error('Unsupported OpenAI item status');
    if (item.type === 'reasoning') {
      if (!Array.isArray(item.summary) || !nonempty(item.encrypted_content)) throw new Error('Invalid OpenAI replayable reasoning');
      for (const rawPart of item.summary) { const part = object(rawPart); if (part.type !== 'summary_text' || typeof part.text !== 'string') throw new Error('Unsupported OpenAI reasoning summary'); }
      if (item.content !== undefined && (!Array.isArray(item.content) || item.content.some(rawPart => { const part = object(rawPart); return part.type !== 'reasoning_text' || typeof part.text !== 'string'; }))) throw new Error('Unsupported OpenAI reasoning content');
    } else if (item.type === 'message') {
      if (item.role !== 'assistant' || !Array.isArray(item.content) || (item.phase !== undefined && item.phase !== null && !['commentary', 'final_answer'].includes(String(item.phase)))) throw new Error('Invalid OpenAI assistant message');
      for (const rawPart of item.content) {
        const part = object(rawPart);
        if (part.type === 'output_text' && typeof part.text === 'string') content.push({ type: 'text', text: part.text });
        else if (part.type === 'refusal' && typeof part.refusal === 'string') content.push({ type: 'text', text: part.refusal });
        else throw new Error('Unsupported OpenAI message content');
      }
    } else if (item.type === 'function_call') {
      if (!nonempty(item.call_id) || calls.has(item.call_id) || !nonempty(item.name) || typeof item.arguments !== 'string') throw new Error('Invalid OpenAI function call');
      calls.add(item.call_id);
      const args = object(JSON.parse(item.arguments)) as { [key: string]: JsonValue };
      content.push({ type: 'toolCall', id: item.call_id, name: item.name, arguments: args });
    } else throw new Error('Unsupported OpenAI output item');
  }
  return { native: structuredClone(value) as JsonValue[], content };
}
/** A completed wire response must still represent a usable tool turn or final answer. */
export function completedOpenAIOutput(value: unknown): ReturnType<typeof openaiOutput> {
  const parsed = openaiOutput(value);
  if (!parsed.content.length) throw new Error('Unsupported OpenAI empty response');
  const messages = parsed.native.filter(item => object(item).type === 'message');
  if (!parsed.content.some(part => part.type === 'toolCall') && object(messages.at(-1)).phase === 'commentary') throw new Error('Unsupported OpenAI nonfinal completion');
  return parsed;
}
export function openaiModel(id: string, profile?: MistralTransportOptions['modelProfile']): Model<string> {
  if (!id) throw new Error('OpenAI requires an explicit model');
  return { id, name: id, api: 'openai-responses', provider: 'openai', baseUrl: 'https://api.openai.com/v1', input: ['text'], reasoning: profile?.reasoning ?? false, contextWindow: profile?.contextWindow ?? 0, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
}
export function openaiPayload(context: TranscriptContext, model: string, maxTokens: number, effort?: 'none' | 'high'): string {
  const normalized = collapseSystemMessages(context);
  const input: unknown[] = [];
  let instructions = '';
  for (const message of normalized.messages) {
    if (message.role === 'system') { instructions = getSystemMessageText(message); continue; }
    if (message.role === 'user') {
      if (typeof message.content !== 'string' && message.content.some(part => part.type !== 'text')) throw new Error('Unsupported OpenAI input content');
      input.push({ role: 'user', content: contentText(message.content) });
    } else if (message.role === 'toolResult') {
      input.push({ type: 'function_call_output', call_id: message.toolCallId, output: contentText(message.content) });
    } else {
      if (message.provider !== 'openai' || !message.openaiOutput) throw new Error('Unsupported OpenAI assistant history');
      const parsed = openaiOutput(message.openaiOutput);
      // The native sequence is authoritative. Reject corrupt projections before tool continuation.
      if (identity(parsed.content) !== identity(message.content)) throw new Error('Invalid OpenAI assistant projection');
      input.push(...parsed.native);
    }
  }
  const tools = getCurrentTools(normalized.messages).map(tool => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters, strict: false }));
  return JSON.stringify({ model, instructions, input, ...(tools.length ? { tools, tool_choice: 'auto' } : {}), ...(effort ? { reasoning: { effort } } : {}), store: false, include: ['reasoning.encrypted_content'], stream: false, max_output_tokens: maxTokens });
}
/** Reservations and host settlement apply to every attempt, including retry and compaction. */
export function createOpenAITransport(options: MistralTransportOptions): { stream: StreamFn; setPurpose(value: Attempt['purpose']): void; attempts(): number } {
  if (options.requiredTool !== undefined) throw Error('Required-tool routing is only qualified for the Mistral protocol transport');
  options = { ...options, modelProfile: options.modelProfile && { ...options.modelProfile } };
  const environment = captureShellEnvironment(options.environment), transport = options.fetch ?? nodeShellFetch();
  const { apiKey, reserve, dispatched: markDispatched, settle } = options;
  const identities = new Set<string>();
  if (options.endpoint !== undefined && options.endpoint !== OPENAI_ENDPOINT) throw new Error('OpenAI endpoint must be the allowlisted HTTPS destination');
  if (!Number.isSafeInteger(options.maxRequests) || options.maxRequests < 1) throw new Error('A finite positive request budget is required');
  const retries = options.maxRetries ?? 0;
  if (!Number.isSafeInteger(retries) || retries < 0 || retries > 3) throw new Error('Retry budget must be between zero and three');
  if (options.reasoningEffort && !options.modelProfile?.reasoning) throw new Error('Reasoning effort requires an explicitly capable model profile');
  if (options.modelProfile && (!Number.isSafeInteger(options.modelProfile.contextWindow) || options.modelProfile.contextWindow < 1)) throw new Error('Invalid configured model context window');
  let dispatched = 0; let purpose: Attempt['purpose'] = 'reasoning';
  const stream: StreamFn = (model, context, requestOptions) => {
    const events = new AssistantMessageEventStream(environment);
    const message: AssistantMessage = { role: 'assistant', content: [], api: model.api, provider: 'openai', model: model.id, usage: emptyUsage(), stopReason: 'pending', timestamp: environment.wallNow() };
    void (async () => {
      try {
        const payload = openaiPayload(context, model.id, options.maxOutputTokens ?? 4096, options.reasoningEffort);
        for (let retry = 0; ; retry++) {
          requestOptions?.signal?.throwIfAborted();
          if (dispatched >= options.maxRequests) throw new Error('Physical request budget exhausted');
          const key = await apiKey(); if (!key) throw new Error('OpenAI API key is required');
          const attempt: Attempt = { id: environment.newId(), payload, digest: digest(payload), attempt: dispatched + 1, purpose, model: model.id };
          if (identities.has(attempt.id)) throw new Error('Duplicate shell request identity');
          identities.add(attempt.id);
          await reserve(attempt);
          let outcome: AttemptOutcome = { status: 'cancelled' }; let retryAllowed = false;
          let timeout: ReturnType<typeof shellTimeout> | undefined, response: Response | undefined;
          let readStarted = false, sent = false;
          const failures: unknown[] = [];
          try {
            requestOptions?.signal?.throwIfAborted();
            timeout = shellTimeout(environment.scheduleTimeout, options.timeoutMs ?? 60_000, requestOptions?.signal);
            const signal = timeout.signal;
            await markDispatched(attempt); signal.throwIfAborted(); dispatched++; sent = true; outcome = { status: 'uncertain' };
            response = await transport(OPENAI_ENDPOINT, { method: 'POST', redirect: 'error', signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: payload });
            signal.throwIfAborted();
            outcome.httpStatus = response.status;
            if (!response.ok) {
              if (response.status === 429) { outcome.status = 'failed'; retryAllowed = retry < retries; }
              if (!retryAllowed) throw new Error(`OpenAI HTTP ${response.status}`);
            } else {
              outcome.status = 'failed'; // A received invalid protocol reply is a known failure, not a network ambiguity.
              readStarted = true;
              const body = object(await readShellJson(response, signal));
              if (body.usage !== undefined && body.usage !== null) {
                const usage = object(body.usage);
                if (![usage.input_tokens, usage.output_tokens].every(value => Number.isSafeInteger(value) && Number(value) >= 0)) throw new Error('Invalid OpenAI usage');
                message.usage.input = Number(usage.input_tokens); message.usage.output = Number(usage.output_tokens); message.usage.totalTokens = message.usage.input + message.usage.output;
                outcome.usage = { inputTokens: message.usage.input, outputTokens: message.usage.output };
              }
              if (body.status !== 'completed') throw new Error('Unsupported OpenAI response status');
              if (!nonempty(body.id) || !nonempty(body.model)) throw new Error('Invalid OpenAI response identity');
              const parsed = completedOpenAIOutput(body.output); message.content = parsed.content; message.openaiOutput = parsed.native;
              message.responseId = body.id; message.responseModel = body.model;
              if (options.reasoningEffort) message.providerThinkingLevel = options.reasoningEffort;
              message.stopReason = message.content.some(part => part.type === 'toolCall') ? 'toolUse' : 'stop'; outcome.status = 'completed';
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
          if (retryAllowed) continue; break;
        }
        events.push({ type: 'start', partial: message }); events.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message });
      } catch (error) {
        message.content = []; delete message.openaiOutput;
        message.stopReason = requestOptions?.signal?.aborted ? 'aborted' : 'error';
        message.errorMessage = error instanceof Error && /^(OpenAI HTTP|OpenAI API key|Physical request budget|Invalid OpenAI|Unsupported OpenAI)/.test(error.message) ? error.message : 'OpenAI transport or accounting failed';
        try { events.push({ type: 'error', reason: message.stopReason, error: message }); }
        catch (timing) { events.fail(new AggregateError([error, timing], 'Shell response timing failed', { cause: error })); }
      }
    })();
    return events;
  };
  return { stream, setPurpose(value) { purpose = value; }, attempts() { return dispatched; } };
}
