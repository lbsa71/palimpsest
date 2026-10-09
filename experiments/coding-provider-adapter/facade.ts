import { createHash } from 'node:crypto';
import { createMistral } from '@ai-sdk/mistral';
import { APICallError } from '@ai-sdk/provider';
import type { LanguageModelV4Prompt, LanguageModelV4FunctionTool, LanguageModelV4GenerateResult } from '@ai-sdk/provider';
import { z } from 'zod';

const endpoint = 'https://api.mistral.ai/v1/chat/completions';
const modelId = 'mistral-small-latest';
const callIdSchema = z.string().regex(/^[A-Za-z0-9]{9}$/);
const readSchema = z.object({ path: z.string().min(1).max(512) }).strict();
const intentSchema = z.object({ callId: callIdSchema, name: z.literal('readFile'), arguments: z.string() }).strict();
const outcomeSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), text: z.string() }).strict(),
  z.object({ ok: z.literal(false), kind: z.enum(['tool_failed', 'tool_denied']), message: z.string() }).strict(),
]);
const messageSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('user'), text: z.string() }).strict(),
  z.object({ role: z.literal('assistant'), text: z.string(), intents: z.array(intentSchema).max(8).optional() }).strict(),
  z.object({ role: z.literal('tool'), callId: callIdSchema, outcome: outcomeSchema }).strict(),
]);
const inputSchema = z.object({ messages: z.array(messageSchema).min(1).max(64), signal: z.instanceof(AbortSignal).optional() }).strict();
export type StepInput = z.infer<typeof inputSchema>;
export type RawIntent = z.infer<typeof intentSchema>;
export type ToolOutcome = z.infer<typeof outcomeSchema>;
/** Known means coherent, validated reported counts; never fabricated/defaulted or verified billing. */
export type Usage = { status: 'known'; input: number; output: number; total: number } | { status: 'unknown' };
type FailureKind = 'authorization' | 'invalid-input' | 'invalid-intent' | 'invalid-usage' | 'incomplete-response' | 'request-too-large' | 'response-too-large' | 'aborted' | 'deadline' | 'provider';
export type StepResult =
  | { status: 'ok'; text: string; intents: RawIntent[]; usage: Usage; finishReason: 'stop' | 'tool-calls' }
  | { status: 'failed'; error: { kind: FailureKind; statusCode?: number }; usage: Usage; dispatch: 'not-sent' | 'uncertain' };
export interface TrustedOptions {
  transport: typeof fetch;
  preauthorize(signal: AbortSignal): void | Promise<void>;
  reserve(request: { model: string; bodyBytes: number; bodySha256: string; signal: AbortSignal }): void | Promise<void>;
  limits?: { maxRequestBytes?: number; maxResponseBytes?: number; deadlineMs?: number; maxOutputTokens?: number };
}
class Failure extends Error {
  readonly kind: FailureKind;
  constructor(kind: FailureKind) { super('Facade operation failed'); this.kind = kind; }
}
const tool: LanguageModelV4FunctionTool = {
  type: 'function', name: 'readFile', description: 'Return a host-owned file-read intent only',
  inputSchema: { type: 'object', properties: { path: { type: 'string', minLength: 1, maxLength: 512 } }, required: ['path'], additionalProperties: false },
};

/** Semantic validation is not permission to perform a read. */
export function validateReadIntent(intent: RawIntent): { path: string } {
  try {
    intentSchema.parse(intent);
    return readSchema.parse(JSON.parse(intent.arguments));
  } catch { throw new Failure('invalid-intent'); }
}
function promptFor(messages: StepInput['messages']): LanguageModelV4Prompt {
  const prompt: LanguageModelV4Prompt = [];
  const pending: string[] = [], seen = new Set<string>();
  for (const message of messages) {
    if (message.role === 'tool') {
      if (pending.shift() !== message.callId) throw new Failure('invalid-input');
      prompt.push({ role: 'tool', content: [{ type: 'tool-result', toolCallId: message.callId, toolName: 'readFile', output: { type: message.outcome.ok ? 'json' : 'error-json', value: message.outcome } }] });
    } else {
      if (pending.length) throw new Failure('invalid-input');
      if (message.role === 'user') prompt.push({ role: 'user', content: [{ type: 'text', text: message.text }] });
      else {
        const calls = (message.intents ?? []).map(intent => {
          if (seen.has(intent.callId)) throw new Failure('invalid-input');
          seen.add(intent.callId); pending.push(intent.callId);
          return { type: 'tool-call' as const, toolCallId: intent.callId, toolName: intent.name, input: validateReadIntent(intent) };
        });
        prompt.push({ role: 'assistant', content: [{ type: 'text', text: message.text }, ...calls] });
      }
    }
  }
  if (pending.length) throw new Failure('invalid-input');
  return prompt;
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
  if (error instanceof Failure) return { kind: error.kind };
  if (APICallError.isInstance(error) && typeof error.statusCode === 'number' && Number.isInteger(error.statusCode) && error.statusCode >= 100 && error.statusCode <= 599) {
    return { kind: 'provider', statusCode: error.statusCode };
  }
  return { kind: 'provider' };
}

/** Fixture facade: explicit synthetic key; not a production credential/config interface. */
export function createFacade(options: TrustedOptions): { step(input: StepInput): Promise<StepResult> } {
  const maxRequestBytes = boundedInteger(options.limits?.maxRequestBytes, 32 * 1024);
  const maxResponseBytes = boundedInteger(options.limits?.maxResponseBytes, 64 * 1024);
  const deadlineMs = boundedInteger(options.limits?.deadlineMs, 2000);
  if (deadlineMs > 2 ** 31 - 1) throw new Error('Invalid trusted deadline');
  const maxOutputTokens = boundedInteger(options.limits?.maxOutputTokens, 512);
  return { async step(input): Promise<StepResult> {
    let dispatched = false, usage: Usage = { status: 'unknown' };
    const controller = new AbortController();
    const abort = () => controller.abort(new Failure('aborted'));
    let externalSignal: AbortSignal | undefined;
    const timer = setTimeout(() => controller.abort(new Failure('deadline')), deadlineMs);
    try {
      let parsed: StepInput, prompt: LanguageModelV4Prompt;
      try { parsed = inputSchema.parse(input); prompt = promptFor(parsed.messages); }
      catch { throw new Failure('invalid-input'); }
      externalSignal = parsed.signal;
      externalSignal?.addEventListener('abort', abort, { once: true });
      if (externalSignal?.aborted) abort();
      checkAbort(controller.signal);
      try { await abortAware(Promise.resolve(options.preauthorize(controller.signal)), controller.signal); }
      catch { checkAbort(controller.signal); throw new Failure('authorization'); }
      checkAbort(controller.signal);
      const model = createMistral({ apiKey: 'synthetic-fixture-key', fetch: async (url, init) => {
        checkAbort(controller.signal);
        if (dispatched || String(url) !== endpoint || init?.method !== 'POST' || typeof init.body !== 'string') throw new Failure('provider');
        const bodyBytes = Buffer.byteLength(init.body, 'utf8');
        if (bodyBytes > maxRequestBytes) throw new Failure('request-too-large');
        try { await abortAware(Promise.resolve(options.reserve({ model: modelId, bodyBytes, bodySha256: createHash('sha256').update(init.body).digest('hex'), signal: controller.signal })), controller.signal); }
        catch { checkAbort(controller.signal); throw new Failure('authorization'); }
        checkAbort(controller.signal);
        dispatched = true;
        const transport = options.transport(url, { ...init, signal: controller.signal }).then(response => {
          if (controller.signal.aborted) void response.body?.cancel().catch(() => {});
          return response;
        });
        const response = await abortAware(transport, controller.signal);
        return boundedResponse(response, maxResponseBytes, controller.signal);
      } }).chat(modelId);
      const result = await abortAware(model.doGenerate({ prompt, tools: [tool], maxOutputTokens, abortSignal: controller.signal }), controller.signal);
      const reported = measuredUsage(result);
      checkUsageConsistency(result, reported);
      usage = reported;
      const intents: RawIntent[] = [];
      const seen = new Set(parsed.messages.flatMap(message => message.role === 'assistant' ? (message.intents ?? []).map(intent => intent.callId) : []));
      const texts: string[] = [];
      try {
        for (const part of result.content) {
          if (part.type === 'text') texts.push(part.text);
          else if (part.type === 'tool-call') {
            const intent = intentSchema.parse({ callId: part.toolCallId, name: part.toolName, arguments: part.input });
            validateReadIntent(intent);
            if (seen.has(intent.callId) || intents.length === 8) throw new Failure('invalid-intent');
            seen.add(intent.callId); intents.push(intent);
          } else throw new Failure('invalid-intent');
        }
      } catch { throw new Failure('invalid-intent'); }
      const text = texts.join('');
      const finishReason = result.finishReason.unified;
      if ((finishReason !== 'stop' && finishReason !== 'tool-calls') ||
          (finishReason === 'stop' && (result.finishReason.raw !== 'stop' || intents.length !== 0 || text.trim().length === 0)) ||
          (finishReason === 'tool-calls' && (result.finishReason.raw !== 'tool_calls' || intents.length === 0))) throw new Failure('incomplete-response');
      return { status: 'ok', text, intents, usage, finishReason };
    } catch (error) {
      return { status: 'failed', error: safeError(controller.signal.aborted ? controller.signal.reason : error), usage, dispatch: dispatched ? 'uncertain' : 'not-sent' };
    } finally { clearTimeout(timer); externalSignal?.removeEventListener('abort', abort); }
  } };
}
