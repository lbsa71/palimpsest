import { createHash } from 'node:crypto';
// Fixture-only package resolution; production installation remains a separate gate.
import { createMistral } from './fixture-sdk/@ai-sdk/mistral/dist/index.js';
import { APICallError } from './fixture-sdk/@ai-sdk/provider/dist/index.js';
import type { LanguageModelV4Prompt, LanguageModelV4FunctionTool, LanguageModelV4GenerateResult } from './fixture-sdk/@ai-sdk/provider/dist/index.js';
import { z } from './fixture-sdk/zod/index.js';

import type { CodingProviderPort, CodingStepInput, CodingStepResult, CodingToolDefinition, FailureKind, JsonObject, RawToolIntent, TrustedCodingProviderOptions, Usage } from './contracts.ts';
export type * from './contracts.ts';
const endpoint = 'https://api.mistral.ai/v1/chat/completions';
const callIdSchema = z.string().regex(/^[A-Za-z0-9]{9}$/);
const nameSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const intentSchema = z.object({ callId: callIdSchema, name: nameSchema, arguments: z.string() }).strict();
const outcomeSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), text: z.string() }).strict(),
  z.object({ ok: z.literal(false), kind: z.enum(['tool_failed', 'tool_denied']), message: z.string() }).strict(),
]);
const messageSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('system'), text: z.string() }).strict(),
  z.object({ role: z.literal('user'), text: z.string() }).strict(),
  z.object({ role: z.literal('assistant'), text: z.string(), intents: z.array(intentSchema).optional() }).strict(),
  z.object({ role: z.literal('tool'), callId: callIdSchema, name: nameSchema, outcome: outcomeSchema }).strict(),
]);
const inputSchema = z.object({ messages: z.array(messageSchema).min(1), signal: z.instanceof(AbortSignal).optional() }).strict();
class Failure extends Error {
  readonly kind: FailureKind;
  readonly statusCode: number | undefined;
  constructor(kind: FailureKind, statusCode?: number) { super('Coding provider operation failed'); this.kind = kind; this.statusCode = statusCode; }
}
/** Reject non-JSON schema values/cycles before taking a trusted configuration snapshot. */
function snapshotSchema(value: unknown, maxBytes: number): JsonObject {
  const visited = new Set<object>();
  const check = (part: unknown, depth: number): void => {
    if (depth > 64) throw new Error('Invalid trusted schema');
    if (part === null || typeof part === 'string' || typeof part === 'boolean') return;
    if (typeof part === 'number' && Number.isFinite(part)) return;
    if (typeof part !== 'object' || part === null || visited.has(part)) throw new Error('Invalid trusted schema');
    if (!Array.isArray(part) && Object.getPrototypeOf(part) !== Object.prototype && Object.getPrototypeOf(part) !== null) throw new Error('Invalid trusted schema');
    visited.add(part);
    for (const child of Object.values(part)) check(child, depth + 1);
    visited.delete(part);
  };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid trusted schema');
  check(value, 0);
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > maxBytes) throw new Error('Invalid trusted schema');
  return JSON.parse(text) as JsonObject;
}
function validateIntent(intent: RawToolIntent, catalog: ReadonlyMap<string, CodingToolDefinition>): unknown {
  try {
    intentSchema.parse(intent);
    const tool = catalog.get(intent.name);
    if (!tool) throw new Failure('invalid-intent');
    const accepted: unknown = tool.validateArguments(JSON.parse(intent.arguments));
    if (accepted !== true) {
      // Contain a violated synchronous callback contract, including a private rejected promise.
      void Promise.resolve(accepted).catch(() => {});
      throw new Failure('invalid-intent');
    }
    // Validator mutation cannot change native history; parse an independent copy.
    return JSON.parse(intent.arguments);
  } catch { throw new Failure('invalid-intent'); }
}
function promptFor(messages: CodingStepInput['messages'], catalog: ReadonlyMap<string, CodingToolDefinition>, maxIntents: number): LanguageModelV4Prompt {
  const prompt: LanguageModelV4Prompt = [];
  const pending: RawToolIntent[] = [], seen = new Set<string>();
  let hasUser = false;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!;
    if (message.role === 'tool') {
      const expected = pending.shift();
      if (!expected || expected.callId !== message.callId || expected.name !== message.name) throw new Failure('invalid-input');
      prompt.push({ role: 'tool', content: [{ type: 'tool-result', toolCallId: message.callId, toolName: message.name, output: { type: message.outcome.ok ? 'json' : 'error-json', value: message.outcome } }] });
    } else {
      if (pending.length) throw new Failure('invalid-input');
      if (message.role === 'system') {
        if (index !== 0) throw new Failure('invalid-input');
        prompt.push({ role: 'system', content: message.text });
      } else if (message.role === 'user') {
        hasUser = true;
        prompt.push({ role: 'user', content: [{ type: 'text', text: message.text }] });
      } else {
        if (!hasUser || (message.intents?.length ?? 0) > maxIntents) throw new Failure('invalid-input');
        const calls = (message.intents ?? []).map(intent => {
          if (seen.has(intent.callId)) throw new Failure('invalid-input');
          seen.add(intent.callId); pending.push(intent);
          return { type: 'tool-call' as const, toolCallId: intent.callId, toolName: intent.name, input: validateIntent(intent, catalog) };
        });
        prompt.push({ role: 'assistant', content: [{ type: 'text', text: message.text }, ...calls] });
      }
    }
  }
  if (pending.length || !hasUser) throw new Failure('invalid-input');
  return prompt;
}
/** Restore exact validated arguments after pinned SDK normalization, before byte/hash reservation. */
function finalBody(serialized: string, messages: CodingStepInput['messages'], model: string, wireTools: unknown, outputTokens: number): string {
  const body = JSON.parse(serialized) as { model?: unknown; max_tokens?: unknown; tools?: unknown; messages?: unknown };
  if (body.model !== model || body.max_tokens !== outputTokens || JSON.stringify(body.tools) !== JSON.stringify(wireTools) || !Array.isArray(body.messages)) throw new Failure('provider');
  const history = messages.flatMap(message => message.role === 'assistant' ? message.intents ?? [] : []);
  let position = 0;
  for (const message of body.messages) {
    if (message.role !== 'assistant' || message.tool_calls === undefined) continue;
    if (!Array.isArray(message.tool_calls)) throw new Failure('provider');
    for (const native of message.tool_calls) {
      const expected = history[position++];
      if (!expected || native.id !== expected.callId || native.type !== 'function' || native.function?.name !== expected.name) throw new Failure('provider');
      native.function.arguments = expected.arguments;
    }
  }
  if (position !== history.length) throw new Failure('provider');
  return JSON.stringify(body);
}
function boundedInteger(value: number | undefined, fallback: number): number {
  const actual = value ?? fallback;
  if (!Number.isSafeInteger(actual) || actual <= 0) throw new Error('Invalid trusted limit');
  return actual;
}
function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason;
}
/** Settle on host cancellation even if the trusted fixture/transport ignores it. */
function abortAware<T>(promise: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
async function boundedResponse(response: Response, maxBytes: number, signal: AbortSignal): Promise<Response> {
  const cancel = () => { void response.body?.cancel().catch(() => {}); };
  if ((response.status >= 300 && response.status <= 399) || response.redirected) { cancel(); throw new Failure('provider', response.status); }
  const length = response.headers.get('content-length');
  if (length !== null && /^\d+$/.test(length) && Number(length) > maxBytes) { cancel(); throw new Failure('response-too-large'); }
  if (!response.body) return response;
  const reader = response.body.getReader();
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      checkAbort(signal);
      const chunk = await abortAware(reader.read(), signal);
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes) throw new Failure('response-too-large');
      chunks.push(chunk.value);
    }
  } finally {
    // Never let an uncooperative cancellation promise hold the host deadline open.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
}
function measuredUsage(result: LanguageModelV4GenerateResult): Extract<Usage, { status: 'known' }> {
  const raw = result.usage.raw;
  const input = raw?.prompt_tokens, output = raw?.completion_tokens, total = raw?.total_tokens;
  const valid = (count: unknown): count is number => typeof count === 'number' && Number.isSafeInteger(count) && count >= 0;
  if (!valid(input) || !valid(output) || !valid(total)) throw new Failure('invalid-usage');
  return { status: 'known', input, output, total };
}
function checkUsageConsistency(result: LanguageModelV4GenerateResult, usage: Extract<Usage, { status: 'known' }>): void {
  if (usage.input + usage.output !== usage.total) throw new Failure('invalid-usage');
  const raw = result.usage.raw!;
  const cacheCounts: unknown[] = [raw.num_cached_tokens];
  for (const key of ['prompt_tokens_details', 'prompt_token_details']) {
    const details = raw[key];
    if (typeof details === 'object' && details !== null && !Array.isArray(details)) cacheCounts.push(Reflect.get(details, 'cached_tokens'));
  }
  let previous: number | undefined;
  for (const count of cacheCounts) {
    // Optional cache statistics remain unknown when absent/null; do not import SDK defaults.
    if (count === undefined || count === null) continue;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || count > usage.input || (previous !== undefined && previous !== count)) throw new Failure('invalid-usage');
    previous = count;
  }
}
function safeError(error: unknown): { kind: FailureKind; statusCode?: number } {
  if (error instanceof Failure) return { kind: error.kind, ...(error.statusCode === undefined ? {} : { statusCode: error.statusCode }) };
  if (APICallError.isInstance(error) && typeof error.statusCode === 'number' && Number.isInteger(error.statusCode) && error.statusCode >= 100 && error.statusCode <= 599) {
    return { kind: 'provider', statusCode: error.statusCode };
  }
  return { kind: 'provider' };
}

export function createCodingProvider(options: TrustedCodingProviderOptions): CodingProviderPort {
  const maxRequestBytes = boundedInteger(options.limits?.maxRequestBytes, 256 * 1024);
  const maxResponseBytes = boundedInteger(options.limits?.maxResponseBytes, 256 * 1024);
  const deadlineMs = boundedInteger(options.limits?.deadlineMs, 2000);
  if (deadlineMs > 2 ** 31 - 1) throw new Error('Invalid trusted deadline');
  const maxOutputTokens = boundedInteger(options.limits?.maxOutputTokens, 512);
  const maxHistoryBytes = boundedInteger(options.limits?.maxHistoryBytes, 128 * 1024);
  const maxHistoryMessages = boundedInteger(options.limits?.maxHistoryMessages, 64);
  const maxCatalogEntries = boundedInteger(options.limits?.maxCatalogEntries, 32);
  const maxIntentsPerStep = boundedInteger(options.limits?.maxIntentsPerStep, 8);
  const { model: modelId, apiKey, preauthorize, reserve, transport } = options;
  if (typeof modelId !== 'string' || modelId.trim().length === 0 || modelId.length > 256 || typeof apiKey !== 'string' || apiKey.length === 0 || typeof preauthorize !== 'function' || typeof reserve !== 'function' || typeof transport !== 'function' || !Array.isArray(options.tools) || options.tools.length === 0 || options.tools.length > maxCatalogEntries) throw new Error('Invalid trusted configuration');
  const catalog = new Map<string, CodingToolDefinition>();
  for (const tool of options.tools) {
    if (!nameSchema.safeParse(tool.name).success || catalog.has(tool.name) || typeof tool.description !== 'string' || Buffer.byteLength(tool.description) > maxRequestBytes || typeof tool.validateArguments !== 'function') throw new Error('Invalid trusted tool catalog');
    catalog.set(tool.name, { name: tool.name, description: tool.description, inputSchema: snapshotSchema(tool.inputSchema, maxRequestBytes), validateArguments: tool.validateArguments });
  }
  const nativeTools: LanguageModelV4FunctionTool[] = [...catalog.values()].map(tool => ({ type: 'function', name: tool.name, description: tool.description, inputSchema: tool.inputSchema as LanguageModelV4FunctionTool['inputSchema'] }));
  const wireTools = nativeTools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } }));
  return { async step(input): Promise<CodingStepResult> {
    let dispatched = false, usage: Usage = { status: 'unknown' };
    const controller = new AbortController();
    const abort = () => controller.abort(new Failure('aborted'));
    let externalSignal: AbortSignal | undefined;
    const timer = setTimeout(() => controller.abort(new Failure('deadline')), deadlineMs);
    try {
      let parsed: CodingStepInput, prompt: LanguageModelV4Prompt;
      try {
        if (!Array.isArray(input?.messages) || input.messages.length > maxHistoryMessages) throw new Failure('invalid-input');
        parsed = inputSchema.parse(input);
        if (Buffer.byteLength(JSON.stringify(parsed.messages)) > maxHistoryBytes) throw new Failure('invalid-input');
        prompt = promptFor(parsed.messages, catalog, maxIntentsPerStep);
      }
      catch { throw new Failure('invalid-input'); }
      externalSignal = parsed.signal;
      externalSignal?.addEventListener('abort', abort, { once: true });
      if (externalSignal?.aborted) abort();
      checkAbort(controller.signal);
      try { await abortAware(Promise.resolve(preauthorize(controller.signal)), controller.signal); }
      catch { checkAbort(controller.signal); throw new Failure('authorization'); }
      checkAbort(controller.signal);
      const model = createMistral({ apiKey, fetch: async (url, init) => {
        checkAbort(controller.signal);
        if (dispatched || String(url) !== endpoint || init?.method !== 'POST' || typeof init.body !== 'string') throw new Failure('provider');
        const body = finalBody(init.body, parsed.messages, modelId, wireTools, maxOutputTokens);
        const bodyBytes = Buffer.byteLength(body, 'utf8');
        if (bodyBytes > maxRequestBytes) throw new Failure('request-too-large');
        try { await abortAware(Promise.resolve(reserve({ model: modelId, bodyBytes, bodySha256: createHash('sha256').update(body).digest('hex'), signal: controller.signal })), controller.signal); }
        catch { checkAbort(controller.signal); throw new Failure('authorization'); }
        checkAbort(controller.signal);
        dispatched = true;
        const pendingTransport = transport(url, { ...init, body, redirect: 'error', signal: controller.signal }).then(response => {
          if (controller.signal.aborted) void response.body?.cancel().catch(() => {});
          return response;
        });
        const response = await abortAware(pendingTransport, controller.signal);
        return boundedResponse(response, maxResponseBytes, controller.signal);
      } }).chat(modelId);
      const result = await abortAware(model.doGenerate({ prompt, tools: nativeTools, maxOutputTokens, abortSignal: controller.signal }), controller.signal);
      const reported = measuredUsage(result);
      checkUsageConsistency(result, reported);
      usage = reported;
      const intents: RawToolIntent[] = [];
      const seen = new Set(parsed.messages.flatMap(message => message.role === 'assistant' ? (message.intents ?? []).map(intent => intent.callId) : []));
      const texts: string[] = [];
      try {
        for (const part of result.content) {
          if (part.type === 'text') texts.push(part.text);
          else if (part.type === 'tool-call') {
            const intent = intentSchema.parse({ callId: part.toolCallId, name: part.toolName, arguments: part.input });
            validateIntent(intent, catalog);
            if (seen.has(intent.callId) || intents.length === maxIntentsPerStep) throw new Failure('invalid-intent');
            seen.add(intent.callId); intents.push(intent);
          } else throw new Failure('invalid-intent');
        }
      } catch { throw new Failure('invalid-intent'); }
      const text = texts.join('');
      const finishReason = result.finishReason.unified;
      if ((finishReason !== 'stop' && finishReason !== 'tool-calls') ||
          (finishReason === 'stop' && (result.finishReason.raw !== 'stop' || intents.length !== 0 || text.trim().length === 0)) ||
          (finishReason === 'tool-calls' && (result.finishReason.raw !== 'tool_calls' || intents.length === 0))) throw new Failure('incomplete-response');
      checkAbort(controller.signal);
      return { status: 'ok', text, intents, usage, finishReason };
    } catch (error) {
      return { status: 'failed', error: safeError(controller.signal.aborted ? controller.signal.reason : error), usage, dispatch: dispatched ? 'uncertain' : 'not-sent' };
    } finally { clearTimeout(timer); externalSignal?.removeEventListener('abort', abort); }
  } };
}
