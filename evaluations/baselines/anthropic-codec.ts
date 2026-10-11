import { invariant, nonempty } from '../../packages/contracts/common.ts';
import type { ResourceUsage } from '../../packages/contracts/common.ts';
import type { BaselineProfile, BaselineTransport } from './observer.ts';

export const ANTHROPIC_MESSAGES_ENDPOINT = 'https://api.anthropic.com/v1/messages';
export interface AnthropicReceipt {
  uncachedInputTokens: number; cacheWrite5mTokens: number; cacheWrite1hTokens: number; cacheReadTokens: number;
  outputTokens: number; thinkingTokens?: number; serviceTier: 'standard'; inferenceGeo: 'global'; speed: 'standard';
  stopReason: string; truncated: boolean;
}
function object(value: unknown): Record<string, unknown> {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value), 'Messages object required'); return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, allowed: string[]): void {
  invariant(Object.keys(value).every(key => allowed.includes(key)), 'unknown or unpriced Messages field refused');
}
function count(value: unknown): number { invariant(Number.isSafeInteger(value) && (value as number) >= 0, 'invalid Messages usage count'); return value as number; }
function cache(value: unknown): void {
  if (value === undefined || value === null) return;
  const control = object(value); fields(control, ['type', 'ttl']);
  invariant(control.type === 'ephemeral' && (control.ttl === undefined || ['5m', '1h'].includes(String(control.ttl))), 'unknown cache control');
}
function content(value: unknown, role: 'system' | 'user' | 'assistant'): void {
  if (typeof value === 'string') return;
  invariant(Array.isArray(value), 'explicit Messages content required');
  for (const raw of value) {
    const part = object(raw); cache(part.cache_control);
    if (part.type === 'text') { fields(part, ['type', 'text', 'cache_control']); invariant(typeof part.text === 'string', 'text required'); }
    else if (role === 'assistant' && part.type === 'thinking') {
      fields(part, ['type', 'thinking', 'signature']); invariant(typeof part.thinking === 'string', 'thinking text required'); nonempty(part.signature, 'thinking signature');
    } else if (role === 'assistant' && part.type === 'redacted_thinking') { fields(part, ['type', 'data']); nonempty(part.data, 'redacted thinking'); }
    else if (role === 'assistant' && part.type === 'tool_use') {
      fields(part, ['type', 'id', 'name', 'input', 'cache_control']); nonempty(part.id, 'tool id'); nonempty(part.name, 'tool name'); object(part.input);
    } else if (role === 'user' && part.type === 'tool_result') {
      fields(part, ['type', 'tool_use_id', 'content', 'is_error', 'cache_control']); nonempty(part.tool_use_id, 'tool result id'); content(part.content, 'system');
      invariant(part.is_error === undefined || typeof part.is_error === 'boolean', 'invalid tool result');
    } else throw new Error('Media, server tools or unknown Messages content refused');
  }
}
export function validateAnthropicProfile(profile: BaselineProfile): void {
  invariant(profile.provider === 'anthropic' && profile.anthropic, 'explicit first-party Anthropic profile required');
  fields(profile.prices as unknown as Record<string, unknown>, ['source', 'inputUsdPerMillion', 'cachedInputUsdPerMillion', 'outputUsdPerMillion', 'cacheWrite5mUsdPerMillion', 'cacheWrite1hUsdPerMillion']);
  const options = profile.anthropic; fields(options as unknown as Record<string, unknown>, ['thinking', 'thinkingBudgetTokens', 'serviceTier', 'inferenceGeo', 'speed']);
  invariant(options.serviceTier === 'standard' && options.inferenceGeo === 'global' && options.speed === 'standard', 'unpriced Anthropic tier/geography/speed refused');
  invariant(['adaptive', 'enabled', 'disabled'].includes(options.thinking), 'explicit thinking profile required');
  if (options.thinking === 'enabled') invariant(count(options.thinkingBudgetTokens) >= 1024 && options.thinkingBudgetTokens! < profile.maxOutputTokens, 'manual thinking requires at least 1,024 tokens below the output cap');
  else invariant(options.thinkingBudgetTokens === undefined, 'unexpected thinking budget');
  for (const value of [profile.prices.cacheWrite5mUsdPerMillion, profile.prices.cacheWrite1hUsdPerMillion]) invariant(typeof value === 'number' && Number.isFinite(value) && value >= 0, 'explicit cache write prices required');
}
export function validateAnthropicPayload(body: Record<string, unknown>, profile: BaselineProfile): void {
  fields(body, ['model', 'messages', 'system', 'tools', 'tool_choice', 'max_tokens', 'stream', 'metadata', 'temperature', 'output_config', 'thinking', 'cache_control', 'service_tier', 'inference_geo']);
  invariant(body.model === profile.model, 'model differs from immutable host profile');
  // Zero requests cache pre-warming, a separate nonstreaming operation. Do not
  // turn it (or a malformed limit) into generation when applying the host cap.
  invariant(Number.isSafeInteger(body.max_tokens) && (body.max_tokens as number) > 0, 'explicit positive generation max_tokens required; cache pre-warming is unsupported');
  invariant(body.service_tier === undefined || body.service_tier === 'standard_only', 'unpriced request tier refused');
  invariant(body.inference_geo === undefined || body.inference_geo === 'global', 'unpriced request geography refused'); cache(body.cache_control);
  if (body.system !== undefined) content(body.system, 'system');
  invariant(Array.isArray(body.messages), 'explicit Messages input required');
  for (const raw of body.messages) { const message = object(raw); fields(message, ['role', 'content']); invariant(message.role === 'user' || message.role === 'assistant', 'invalid Messages role'); content(message.content, message.role); }
  if (body.tools !== undefined) {
    invariant(Array.isArray(body.tools), 'explicit local tools required');
    for (const raw of body.tools) { const tool = object(raw); fields(tool, ['type', 'name', 'description', 'input_schema', 'cache_control', 'strict', 'defer_loading']);
      invariant(tool.type === undefined || tool.type === 'custom', 'server tool refused'); nonempty(tool.name, 'local tool name'); object(tool.input_schema); cache(tool.cache_control);
      invariant(tool.defer_loading === undefined || tool.defer_loading === false, 'server tool search refused');
    }
  }
  if (body.tool_choice !== undefined) {
    const choice = object(body.tool_choice); fields(choice, ['type', 'name', 'disable_parallel_tool_use']);
    invariant(['auto', 'none', 'any', 'tool'].includes(String(choice.type)), 'unknown tool choice'); if (choice.type === 'tool') nonempty(choice.name, 'tool choice name');
  }
  // The selected profile does not independently attest model-dependent API defaults.
  // Refuse missing native controls instead of rewriting cognition or mislabelling it.
  invariant(body.output_config !== undefined && body.thinking !== undefined, 'explicit native effort and thinking controls required');
  { const config = object(body.output_config); fields(config, ['effort']); invariant(config.effort === profile.effort, 'effort differs from immutable host profile'); }
  {
    const thinking = object(body.thinking); fields(thinking, ['type', 'budget_tokens', 'display']); invariant(thinking.type === profile.anthropic!.thinking, 'thinking differs from immutable host profile');
    invariant(thinking.budget_tokens === profile.anthropic!.thinkingBudgetTokens, 'thinking budget differs from profile');
    invariant(thinking.display === undefined || ['summarized', 'omitted'].includes(String(thinking.display)), 'unknown thinking display');
  }
  if (body.metadata !== undefined) { const metadata = object(body.metadata); fields(metadata, ['user_id']); invariant(typeof metadata.user_id === 'string', 'invalid metadata'); }
  invariant(body.temperature === undefined || (typeof body.temperature === 'number' && body.temperature >= 0 && body.temperature <= 1), 'invalid temperature');
}
/** First-party synchronous standard transport. Host credentials and endpoint never come from the worker. No retries/beta/ambient auth. */
export function anthropicTransport(apiKey: string, fetcher: typeof fetch = fetch): BaselineTransport {
  invariant(typeof apiKey === 'string' && apiKey.length > 0 && !/[\r\n]/.test(apiKey), 'explicit host credential required');
  return (payload, signal) => fetcher(ANTHROPIC_MESSAGES_ENDPOINT, { method: 'POST', redirect: 'error', signal,
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: payload });
}

/** Usage is cumulative. Hold the reservation unless every final priced dimension is exact. */
export function anthropicUsage(body: string, profile: BaselineProfile, elapsedMs: number): { usage: ResourceUsage; receipt: AnthropicReceipt } {
  invariant(body.endsWith('\n\n') || body.endsWith('\r\n\r\n'), 'truncated Messages SSE');
  let started = false, stopped = false, deltas = 0, stopReason: string | undefined;
  const totals: Record<string, number> = {}; let tier: string | undefined, geo: string | undefined, speed: string | undefined;
  const mergeCount = (key: string, value: unknown) => { const next = count(value); invariant(totals[key] === undefined || next >= totals[key]!, 'decreasing cumulative Messages usage'); totals[key] = next; };
  const mergeUsage = (raw: unknown) => {
    const usage = object(raw); fields(usage, ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'cache_creation', 'output_tokens_details', 'server_tool_use', 'service_tier', 'inference_geo', 'speed']);
    for (const key of ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']) if (usage[key] !== undefined) mergeCount(key, usage[key]);
    if (usage.cache_creation !== undefined && usage.cache_creation !== null) {
      const split = object(usage.cache_creation); fields(split, ['ephemeral_5m_input_tokens', 'ephemeral_1h_input_tokens']);
      mergeCount('write5m', split.ephemeral_5m_input_tokens); mergeCount('write1h', split.ephemeral_1h_input_tokens);
    }
    if (totals.write5m !== undefined && totals.cache_creation_input_tokens !== undefined) invariant(totals.write5m + totals.write1h! === totals.cache_creation_input_tokens, 'inconsistent cache TTL usage');
    if (usage.output_tokens_details !== undefined && usage.output_tokens_details !== null) { const details = object(usage.output_tokens_details); fields(details, ['thinking_tokens']); mergeCount('thinking', details.thinking_tokens); }
    if (totals.thinking !== undefined && totals.output_tokens !== undefined) invariant(totals.thinking <= totals.output_tokens, 'thinking exceeds output');
    if (usage.server_tool_use !== undefined && usage.server_tool_use !== null) {
      const tools = object(usage.server_tool_use); fields(tools, ['web_search_requests', 'web_fetch_requests']); for (const value of Object.values(tools)) invariant(count(value) === 0, 'unpriced server tool usage');
    }
    if (usage.service_tier !== undefined) { invariant(usage.service_tier === 'standard' && (tier === undefined || tier === usage.service_tier), 'unpriced served tier'); tier = usage.service_tier; }
    if (usage.inference_geo !== undefined) { invariant(usage.inference_geo === 'global' && (geo === undefined || geo === usage.inference_geo), 'unpriced served geography'); geo = usage.inference_geo; }
    if (usage.speed !== undefined) { invariant(usage.speed === 'standard' && (speed === undefined || speed === usage.speed), 'unpriced served speed'); speed = usage.speed; }
  };
  const blocks = new Set<number>();
  for (const block of body.split(/\r?\n\r?\n/).filter(Boolean)) {
    const lines = block.split(/\r?\n/), data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n'); if (!data) continue;
    const event = object(JSON.parse(data)); invariant(!stopped && lines.find(line => line.startsWith('event:'))?.slice(6).trim() === event.type, 'unexpected or mismatched Messages SSE');
    if (event.type === 'ping') continue;
    if (event.type === 'message_start') {
      invariant(!started, 'duplicate Messages start'); started = true; const message = object(event.message);
      nonempty(message.id, 'message id'); invariant(message.type === 'message' && message.role === 'assistant' && message.model === profile.model, 'inconsistent Messages identity');
      invariant(message.container === undefined || message.container === null, 'unpriced server container'); mergeUsage(message.usage);
      for (const key of ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']) invariant(totals[key] !== undefined, 'missing initial usage');
      if (message.content !== undefined) { invariant(Array.isArray(message.content) && message.content.length === 0, 'unexpected initial Messages content'); }
    } else if (event.type === 'message_delta') {
      invariant(started && blocks.size === 0, 'unexpected Messages delta'); deltas++; const delta = object(event.delta);
      fields(delta, ['stop_reason', 'stop_sequence', 'stop_details']);
      if (delta.stop_reason !== undefined && delta.stop_reason !== null) {
        invariant(['end_turn', 'tool_use', 'stop_sequence', 'max_tokens', 'refusal'].includes(String(delta.stop_reason)), 'unsupported Messages stop');
        invariant(stopReason === undefined || stopReason === delta.stop_reason, 'inconsistent stop reason'); stopReason = String(delta.stop_reason);
      }
      mergeUsage(event.usage);
      invariant(object(event.usage).output_tokens !== undefined, 'missing cumulative output usage');
    } else if (event.type === 'message_stop') { invariant(started && deltas > 0 && stopReason !== undefined && blocks.size === 0, 'missing completed Messages usage'); stopped = true; }
    else if (event.type === 'content_block_start') {
      invariant(started && deltas === 0, 'unexpected content start'); const index = count(event.index); invariant(!blocks.has(index), 'duplicate content block'); blocks.add(index);
      const part = object(event.content_block); invariant(['text', 'tool_use', 'thinking', 'redacted_thinking'].includes(String(part.type)), 'server or unknown response content refused');
    } else if (event.type === 'content_block_delta') {
      invariant(started && deltas === 0 && blocks.has(count(event.index)), 'unexpected content delta'); const delta = object(event.delta);
      invariant(['text_delta', 'input_json_delta', 'thinking_delta', 'signature_delta'].includes(String(delta.type)), 'unknown response delta refused');
    } else if (event.type === 'content_block_stop') { invariant(blocks.delete(count(event.index)), 'unexpected content stop'); }
    else throw new Error('Unknown or failed Messages event');
  }
  invariant(stopped && tier === 'standard' && geo === 'global', 'missing completed usage/tier/geography');
  const U = totals.input_tokens!, W = totals.cache_creation_input_tokens!, R = totals.cache_read_input_tokens!, O = totals.output_tokens!;
  invariant(W === 0 || totals.write5m !== undefined, 'nonzero cache creation without exact TTL split');
  const W5 = totals.write5m ?? 0, W1 = totals.write1h ?? 0, input = U + W5 + W1 + R;
  invariant(Number.isSafeInteger(input) && input <= profile.contextWindowTokens && O <= profile.maxOutputTokens, 'usage exceeds pinned contract');
  const p = profile.prices, costUsd = (U * p.inputUsdPerMillion + W5 * p.cacheWrite5mUsdPerMillion! + W1 * p.cacheWrite1hUsdPerMillion! + R * p.cachedInputUsdPerMillion + O * p.outputUsdPerMillion) / 1_000_000;
  invariant(Number.isFinite(costUsd), 'invalid Messages cost');
  return { usage: { requests: 1, inputTokens: input, outputTokens: O, costUsd, elapsedMs }, receipt: {
    uncachedInputTokens: U, cacheWrite5mTokens: W5, cacheWrite1hTokens: W1, cacheReadTokens: R, outputTokens: O,
    ...(totals.thinking === undefined ? {} : { thinkingTokens: totals.thinking }), serviceTier: 'standard', inferenceGeo: 'global', speed: 'standard', stopReason: stopReason!, truncated: stopReason === 'max_tokens' } };
}
