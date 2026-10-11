import { nativeProtocolHeaders } from './anthropic-native-protocol.ts';
import type { AnthropicNativeProtocol, AnthropicProtocolHeaders } from './anthropic-native-protocol.ts';
import { anthropicUsage, validateAnthropicPayload, validateAnthropicProfile } from './anthropic-codec.ts';
import type { AnthropicReceipt } from './anthropic-codec.ts';
import { randomUUID } from 'node:crypto';
import { validateClaudeFixturePayload, claudeFixtureUsage } from './claude-fixture-codec.ts';
import { canonicalJson, invariant, nonempty } from '../../packages/contracts/common.ts';
import type { ArtifactRef, ResourceEnvelope, ResourceUsage } from '../../packages/contracts/common.ts';
import type { PhysicalRequest } from '../../packages/contracts/control/index.ts';
import { ResourceLedger } from '../../packages/runtime/resources/index.ts';
import { OperationalStore } from '../../packages/storage/index.ts';

export const OPENAI_RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';
export interface BaselineProfile {
  provider: 'openai' | 'anthropic-fixture' | 'anthropic'; model: string; effort: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Host attestation of the provider's maximum billable text input, not a byte/token estimate. */
  contextContract: string; contextWindowTokens: number; maxOutputTokens: number;
  prices: { source: string; inputUsdPerMillion: number; cachedInputUsdPerMillion: number; outputUsdPerMillion: number; cacheWrite5mUsdPerMillion?: number; cacheWrite1hUsdPerMillion?: number };
  /** Selected explicit native thinking configuration; only global standard synchronous inference is priced. */
  anthropic?: { thinking: 'adaptive' | 'enabled' | 'disabled'; thinkingBudgetTokens?: number; serviceTier: 'standard'; inferenceGeo: 'global'; speed: 'standard'; nativeProtocol?: AnthropicNativeProtocol };
}
export interface ObserverGrant {
  id: string; resources: ResourceEnvelope; profile: BaselineProfile;
  requestTimeoutMs: number; maxRequestBytes: number; maxResponseBytes: number;
}
export interface ProviderAttempt { method: string; path: string; payload: string; nativeHttp?: { path: string; headers: Record<string, string | string[] | undefined> } }
export interface ProviderReply { status: number; contentType: string; body: string }
export type BaselineTransport = (payload: string, signal: AbortSignal, protocol?: AnthropicProtocolHeaders) => Promise<Response>;
export interface AttemptEvidence {
  requestId: string; before: ArtifactRef; after: ArtifactRef;
  /** Exact native instructions, input and tool definitions are contained in before/after. */
  response?: ArtifactRef; responseStatus?: number; contentType?: string;
  nativeHttp?: ArtifactRef;
  outcome?: 'completed' | 'unknown'; reason?: string; usage?: ResourceUsage; anthropicReceipt?: AnthropicReceipt;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

function positive(value: number, name: string): void { invariant(Number.isSafeInteger(value) && value > 0, `finite positive ${name} required`); }
export function validateObserverGrant(grant: ObserverGrant): void {
  nonempty(grant.id, 'grant.id'); invariant(['openai', 'anthropic-fixture', 'anthropic'].includes(grant.profile.provider), 'supported baseline profile required');
  nonempty(grant.profile.model, 'model'); nonempty(grant.profile.contextContract, 'context contract');
  invariant((grant.profile.provider === 'anthropic' ? ['low', 'medium', 'high', 'xhigh', 'max'] : ['none', 'low', 'medium', 'high', 'xhigh']).includes(grant.profile.effort), 'invalid effort');
  positive(grant.profile.contextWindowTokens, 'context window'); positive(grant.profile.maxOutputTokens, 'output tokens');
  nonempty(grant.profile.prices.source, 'price source');
  for (const price of [grant.profile.prices.inputUsdPerMillion, grant.profile.prices.cachedInputUsdPerMillion, grant.profile.prices.outputUsdPerMillion]) invariant(Number.isFinite(price) && price >= 0, 'explicit finite prices required');
  if (grant.profile.provider === 'anthropic-fixture') invariant(grant.profile.effort === 'low' && Object.entries(grant.profile.prices).every(([key, value]) => key === 'source' || value === 0), 'Claude supports low-effort zero-price synthetic fixture only; live accounting unavailable');
  if (grant.profile.provider === 'anthropic') validateAnthropicProfile(grant.profile);
  else { invariant(grant.profile.anthropic === undefined && grant.profile.prices.cacheWrite5mUsdPerMillion === undefined && grant.profile.prices.cacheWrite1hUsdPerMillion === undefined, 'Anthropic categories require separate real profile');
    invariant(grant.profile.prices.cachedInputUsdPerMillion <= grant.profile.prices.inputUsdPerMillion, 'cached price exceeds reserved price'); }
  for (const key of ['maxRequests', 'maxTokens', 'maxCostUsd', 'maxElapsedMs', 'maxConcurrency'] as const) invariant(Number.isFinite(grant.resources[key]) && grant.resources[key] > 0, `finite positive ${key} grant required`);
  positive(grant.resources.maxRequests, 'requests'); positive(grant.resources.maxTokens, 'tokens'); positive(grant.resources.maxElapsedMs, 'elapsed time');
  invariant(grant.resources.maxConcurrency === 1, 'native observer requires one active attempt');
  positive(grant.requestTimeoutMs, 'request timeout'); positive(grant.maxRequestBytes, 'request bytes'); positive(grant.maxResponseBytes, 'response bytes');
  invariant(grant.requestTimeoutMs <= grant.resources.maxElapsedMs && grant.requestTimeoutMs <= 900_000, 'request timeout exceeds grant');
  invariant(grant.maxRequestBytes <= 2_000_000 && grant.maxResponseBytes <= 2_000_000, 'bridge byte ceiling exceeded');
  positive(grant.profile.contextWindowTokens + grant.profile.maxOutputTokens, 'combined request token ceiling');
  if (grant.profile.provider === 'anthropic') invariant(grant.profile.contextWindowTokens + grant.profile.maxOutputTokens <= grant.resources.maxTokens, 'Anthropic readiness refused: full input contract plus output cap exceeds token grant');
}

function object(value: unknown): Record<string, unknown> {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value), 'JSON object required'); return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, allowed: string[]): void { invariant(Object.keys(value).every(key => allowed.includes(key)), 'unknown native item field refused'); }
function tools(value: unknown): void {
  invariant(Array.isArray(value), 'tool array required');
  for (const raw of value) {
    const tool = object(raw);
    invariant(['namespace', 'function', 'custom'].includes(String(tool.type)), 'hosted or unknown tool refused');
    nonempty(tool.name, 'tool name');
    if (tool.type === 'namespace') tools(tool.tools);
  }
}
function textContent(value: unknown): void {
  if (typeof value === 'string') return;
  invariant(Array.isArray(value), 'text content required');
  for (const raw of value) {
    const part = object(raw); invariant(['input_text', 'output_text', 'text'].includes(String(part.type)), 'media or unknown content refused');
    fields(part, ['type', 'text', 'annotations', 'logprobs']);
    invariant(typeof part.text === 'string', 'text content required');
  }
}
/** Accept the native text/tool boundary only. Opaque server context and paid tools cannot be priced here. */
function validatePayload(body: Record<string, unknown>, profile: BaselineProfile): void {
  const allowed = new Set(['model', 'instructions', 'input', 'tools', 'tool_choice', 'reasoning', 'stream', 'store', 'max_output_tokens', 'parallel_tool_calls', 'include', 'text', 'metadata', 'client_metadata', 'service_tier', 'prompt_cache_key', 'prompt_cache_retention']);
  invariant(Object.keys(body).every(key => allowed.has(key)), 'unknown request field or server context refused');
  invariant(body.model === profile.model, 'model differs from immutable host profile');
  invariant(body.instructions === undefined || typeof body.instructions === 'string', 'instructions must be text');
  const reasoning = object(body.reasoning); invariant(reasoning.effort === profile.effort, 'effort differs from immutable host profile');
  invariant(body.service_tier === undefined || body.service_tier === 'default', 'unpriced service tier refused');
  invariant(body.tool_choice === undefined || ['auto', 'none', 'required'].includes(String(body.tool_choice)), 'hosted or unknown tool choice refused');
  invariant(body.include === undefined || (Array.isArray(body.include) && body.include.every(value => value === 'reasoning.encrypted_content')), 'unknown response include refused');
  if (body.tools !== undefined) tools(body.tools);
  invariant(Array.isArray(body.input), 'explicit input array required');
  for (const raw of body.input) {
    const item = object(raw);
    if (item.type === 'additional_tools') { fields(item, ['type', 'id', 'role', 'tools']); tools(item.tools); continue; }
    if (item.type === 'message' || item.type === undefined) { fields(item, ['type', 'id', 'role', 'content', 'status']); invariant(['system', 'developer', 'user', 'assistant'].includes(String(item.role)), 'invalid text message role'); textContent(item.content); continue; }
    if (item.type === 'function_call_output' || item.type === 'custom_tool_call_output') { fields(item, ['type', 'id', 'call_id', 'output', 'status']); textContent(item.output); continue; }
    invariant(['function_call', 'custom_tool_call', 'reasoning'].includes(String(item.type)), 'media or unknown input item refused');
    // These native continuations carry only text, summaries and opaque reasoning ciphertext.
    if (item.type === 'reasoning') {
      fields(item, ['type', 'id', 'summary', 'encrypted_content', 'status']);
      invariant(item.encrypted_content === undefined || typeof item.encrypted_content === 'string', 'invalid reasoning content');
      invariant(item.summary === undefined || (Array.isArray(item.summary) && item.summary.every(raw => { const part = object(raw); return part.type === 'summary_text' && typeof part.text === 'string'; })), 'invalid reasoning summary');
    } else { fields(item, ['type', 'id', 'call_id', 'name', 'namespace', 'arguments', 'input', 'status']); invariant(typeof item[item.type === 'function_call' ? 'arguments' : 'input'] === 'string', 'invalid native tool call'); }
  }
}

/** No URL, headers, credential file or retries are accepted from the worker. Never logs the key. */
export function openAITransport(apiKey: string, fetcher: typeof fetch = fetch): BaselineTransport {
  invariant(typeof apiKey === 'string' && apiKey.length > 0 && !/[\r\n]/.test(apiKey), 'explicit host credential required');
  return (payload, signal) => fetcher(OPENAI_RESPONSES_ENDPOINT, { method: 'POST', redirect: 'error', signal,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: payload });
}

function count(value: unknown): number { invariant(Number.isSafeInteger(value) && (value as number) >= 0, 'invalid final usage'); return value as number; }
function finalUsage(body: string, profile: BaselineProfile, elapsedMs: number): ResourceUsage {
  let final: Record<string, unknown> | undefined; let responseId: string | undefined;
  let done = false;
  invariant(body.endsWith('\n\n') || body.endsWith('\r\n\r\n'), 'truncated SSE');
  for (const block of body.split(/\r?\n\r?\n/).filter(Boolean)) {
    const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) continue;
    if (data === '[DONE]') { invariant(final !== undefined && !done, 'unexpected SSE terminal marker'); done = true; continue; }
    invariant(!done, 'data after SSE terminal marker');
    const event = object(JSON.parse(data));
    invariant(final === undefined, 'unexpected data after final response');
    invariant(!['error', 'response.failed', 'response.incomplete'].includes(String(event.type)), 'failed or incomplete response');
    if (event.type === 'response.created') {
      const response = object(event.response); nonempty(response.id, 'response id');
      invariant(responseId === undefined || responseId === response.id, 'inconsistent response id'); responseId = response.id;
    }
    if (event.type === 'response.completed') {
      invariant(final === undefined, 'duplicate final response'); final = object(event.response);
      nonempty(final.id, 'response id'); invariant(responseId === undefined || responseId === final.id, 'inconsistent response id');
    }
  }
  invariant(final && final.status === 'completed' && final.model === profile.model, 'missing or inconsistent final response');
  invariant(final.service_tier === undefined || final.service_tier === 'default', 'unpriced final service tier');
  const usage = object(final.usage), input = count(usage.input_tokens), output = count(usage.output_tokens);
  invariant(count(usage.total_tokens) === input + output, 'inconsistent total usage');
  const cached = count(object(usage.input_tokens_details).cached_tokens);
  const reasoning = count(object(usage.output_tokens_details).reasoning_tokens);
  invariant(cached <= input && reasoning <= output, 'inconsistent usage details');
  invariant(input <= profile.contextWindowTokens && output <= profile.maxOutputTokens, 'provider usage exceeds pinned contract');
  const prices = profile.prices;
  return { requests: 1, inputTokens: input, outputTokens: output, costUsd: ((input - cached) * prices.inputUsdPerMillion + cached * prices.cachedInputUsdPerMillion + output * prices.outputUsdPerMillion) / 1_000_000, elapsedMs };
}

export class BaselineObserver {
  readonly store: OperationalStore; readonly ledger: ResourceLedger; readonly grant: ObserverGrant;
  private readonly transport: BaselineTransport; private readonly now: () => number;
  private readonly active = new Set<AbortController>();
  constructor(options: { store: OperationalStore; grant: ObserverGrant; transport: BaselineTransport; now?: () => number }) {
    validateObserverGrant(options.grant);
    this.store = options.store; this.grant = freeze(structuredClone(options.grant)); this.transport = options.transport; this.now = options.now ?? Date.now;
    const profile = this.grant.profile;
    this.ledger = new ResourceLedger(this.store, { tokens: profile.contextWindowTokens + profile.maxOutputTokens,
      costUsd: (profile.contextWindowTokens * Math.max(profile.prices.inputUsdPerMillion, profile.prices.cachedInputUsdPerMillion, profile.prices.cacheWrite5mUsdPerMillion ?? 0, profile.prices.cacheWrite1hUsdPerMillion ?? 0) + profile.maxOutputTokens * profile.prices.outputUsdPerMillion) / 1_000_000,
      elapsedMs: this.grant.requestTimeoutMs }, this.now);
    this.store.transaction(() => {
      const owner = this.store.get<string>('baseline-owner', 'grant');
      if (owner) invariant(owner.value === this.grant.id, 'dedicated observer state already belongs to a different grant');
      else this.store.put('baseline-owner', 'grant', this.grant.id, null);
      const previous = this.store.get<ObserverGrant>('baseline-grants', this.grant.id);
      if (previous) invariant(canonicalJson(previous.value) === canonicalJson(this.grant), 'immutable baseline grant changed');
      else { this.store.put('baseline-grants', this.grant.id, this.grant, null); this.ledger.allocate(this.grant.id, this.grant.resources); }
      // Dedicated baseline state. A restart cannot prove a reserved/dispatched attempt was not sent.
      for (const row of this.store.list<{ request: PhysicalRequest }>('requests')) {
        const request = row.value.request;
        if (request.runId !== this.grant.id || !['reserved', 'dispatched', 'uncertain'].includes(request.status)) continue;
        if (request.status === 'dispatched') this.ledger.settle({ ...request, status: 'uncertain', usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 } });
        this.ledger.cancel(this.grant.id);
        const evidence = this.store.get<AttemptEvidence>('baseline-attempts', request.id);
        if (evidence && evidence.value.outcome === undefined) this.store.put('baseline-attempts', request.id, { ...evidence.value, outcome: 'unknown', reason: 'Interrupted attempt; reservation held and grant cancelled' }, evidence.revision);
      }
    });
  }
  cancel(): void { this.ledger.cancel(this.grant.id); for (const controller of this.active) controller.abort(); }
  evidence(): AttemptEvidence[] { return this.store.list<AttemptEvidence>('baseline-attempts').filter(row => this.ledger.request(row.key)?.runId === this.grant.id).map(row => row.value); }
  async handle(attempt: ProviderAttempt, signal?: AbortSignal): Promise<ProviderReply> {
    signal?.throwIfAborted();
    const claudeFixture = this.grant.profile.provider === 'anthropic-fixture', anthropic = this.grant.profile.provider === 'anthropic', messages = claudeFixture || anthropic;
    let body: Record<string, unknown>; let protocol: AnthropicProtocolHeaders | undefined;
    try {
      invariant(attempt.method === 'POST' && attempt.path === (messages ? '/v1/messages' : '/v1/responses') && typeof attempt.payload === 'string', 'invalid native provider route');
      invariant(Buffer.byteLength(attempt.payload) <= this.grant.maxRequestBytes, 'request byte limit exceeded');
      if (attempt.nativeHttp) invariant(messages && ['/v1/messages', '/v1/messages?beta=true'].includes(attempt.nativeHttp.path) && Buffer.byteLength(canonicalJson(attempt.nativeHttp)) <= 16_384, 'invalid native HTTP metadata');
      body = object(JSON.parse(attempt.payload));
      if (anthropic) {
        protocol = nativeProtocolHeaders(attempt, this.grant.profile);
        validateAnthropicPayload(body, this.grant.profile);
      } else if (claudeFixture) validateClaudeFixturePayload(body, this.grant.profile); else validatePayload(body, this.grant.profile);
    } catch (error) {
      // Preserve bounded protocol-discovery failures without calling them provider dispatches.
      this.store.put('baseline-refusals', randomUUID(), { grantId: this.grant.id,
        request: this.store.putArtifact(Buffer.from(typeof attempt.payload === 'string' ? attempt.payload : '').subarray(0, this.grant.maxRequestBytes)),
        reason: error instanceof Error ? error.message.slice(0, 256) : 'invalid native request' }, null);
      throw error;
    }
    // Instructions and input remain exactly as emitted. Only explicit host accounting controls change.
    const outgoing = JSON.stringify(messages ? { ...body, max_tokens: this.grant.profile.maxOutputTokens, stream: true, ...(anthropic ? { service_tier: 'standard_only', inference_geo: 'global' } : {}) } : { ...body, max_output_tokens: this.grant.profile.maxOutputTokens, store: false, stream: true, service_tier: 'default' });
    invariant(Buffer.byteLength(outgoing) <= this.grant.maxRequestBytes, 'modified request byte limit exceeded');
    const id = randomUUID(), startedAt = this.now();
    const request: PhysicalRequest = { id, runId: this.grant.id, purpose: 'reasoning', provider: this.grant.profile.provider, model: this.grant.profile.model,
      promptManifestId: `native:${id}`, requestDigest: '', reservationId: id, status: 'reserved',
      usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: 0 } };
    this.store.transaction(() => {
      const before = this.store.putArtifact(attempt.payload), after = this.store.putArtifact(outgoing); request.requestDigest = after.sha256;
      this.ledger.reserve(request); this.store.put('baseline-attempts', id, { requestId: id, before, after,
        ...(attempt.nativeHttp ? { nativeHttp: this.store.putArtifact(canonicalJson(attempt.nativeHttp)) } : {}) }, null);
      this.ledger.dispatched({ ...request, status: 'dispatched' });
    });
    const controller = new AbortController();
    this.active.add(controller);
    const abort = () => controller.abort(new Error('Baseline attempt cancelled'));
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    const timer = setTimeout(() => controller.abort(new Error('Baseline attempt deadline exceeded')), this.grant.requestTimeoutMs);
    const chunks: Buffer[] = []; let bytes = 0; let status: number | undefined; let contentType: string | undefined;
    const execute = async () => {
      controller.signal.throwIfAborted(); const response = await this.transport(outgoing, controller.signal, protocol); controller.signal.throwIfAborted();
      status = response.status; contentType = response.headers.get('content-type') ?? '';
      invariant(response.body, 'missing provider body'); const reader = response.body.getReader();
      try {
        for (;;) {
          controller.signal.throwIfAborted(); const part = await reader.read(); controller.signal.throwIfAborted(); if (part.done) break;
          chunks.push(Buffer.from(part.value.subarray(0, Math.max(0, this.grant.maxResponseBytes - bytes)))); bytes += part.value.length;
          invariant(bytes <= this.grant.maxResponseBytes, 'response byte limit exceeded');
        }
      } finally { void reader.cancel().catch(() => {}); }
      const body = Buffer.concat(chunks).toString('utf8');
      invariant(status === 200 && /^text\/event-stream(?:;|$)/i.test(contentType), 'untrusted response status or content type');
      const elapsedMs = Math.max(0, this.now() - startedAt);
      if (anthropic) { const result = anthropicUsage(body, this.grant.profile, elapsedMs); return { body, usage: result.usage, anthropicReceipt: result.receipt }; }
      return { body, usage: (claudeFixture ? claudeFixtureUsage : finalUsage)(body, this.grant.profile, elapsedMs) };
    };
    let cancelListener: (() => void) | undefined;
    const cancelled = new Promise<never>((_resolve, reject) => { cancelListener = () => reject(new Error('Baseline attempt stopped')); controller.signal.addEventListener('abort', cancelListener, { once: true }); if (controller.signal.aborted) cancelListener(); });
    try {
      const completed = await Promise.race([execute(), cancelled]);
      this.store.transaction(() => {
        this.ledger.settle({ ...request, status: 'succeeded', usage: completed.usage });
        const row = this.store.get<AttemptEvidence>('baseline-attempts', id)!;
        this.store.put('baseline-attempts', id, { ...row.value, response: this.store.putArtifact(completed.body), responseStatus: status!, contentType: contentType!, outcome: 'completed', usage: completed.usage, ...('anthropicReceipt' in completed ? { anthropicReceipt: completed.anthropicReceipt } : {}) }, row.revision);
      });
      return { status: 200, contentType: contentType!, body: completed.body };
    } catch {
      controller.abort();
      const usage: ResourceUsage = { requests: 1, inputTokens: null, outputTokens: null, costUsd: null, elapsedMs: Math.max(0, this.now() - startedAt) };
      this.store.transaction(() => {
        this.ledger.settle({ ...request, status: 'uncertain', usage }); this.ledger.cancel(this.grant.id);
        const row = this.store.get<AttemptEvidence>('baseline-attempts', id)!;
        this.store.put('baseline-attempts', id, { ...row.value, response: this.store.putArtifact(Buffer.concat(chunks)),
          ...(status === undefined ? {} : { responseStatus: status }), ...(contentType === undefined ? {} : { contentType }),
          outcome: 'unknown', reason: 'No trustworthy completed usage; reservation held and grant cancelled', usage }, row.revision);
      });
      throw new Error('Baseline provider outcome unknown; grant stopped');
    } finally {
      this.active.delete(controller);
      clearTimeout(timer); signal?.removeEventListener('abort', abort); if (cancelListener) controller.signal.removeEventListener('abort', cancelListener);
    }
  }
}
