import { invariant, nonempty } from '../../packages/contracts/common.ts';
import type { ResourceUsage } from '../../packages/contracts/common.ts';
import type { BaselineProfile } from './observer.ts';

function object(value: unknown): Record<string, unknown> {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value), 'Messages object required');
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, allowed: string[]): void {
  invariant(Object.keys(value).every(key => allowed.includes(key)), 'unknown Messages field refused');
}
function cache(value: unknown): void {
  if (value === undefined) return;
  const control = object(value); fields(control, ['type', 'ttl']);
  invariant(control.type === 'ephemeral' && (control.ttl === undefined || ['5m', '1h'].includes(String(control.ttl))), 'unknown cache control');
}
function content(value: unknown, tools: boolean): void {
  if (typeof value === 'string') return;
  invariant(Array.isArray(value), 'explicit text/tool content required');
  for (const raw of value) {
    const part = object(raw); cache(part.cache_control);
    if (part.type === 'text') {
      fields(part, ['type', 'text', 'cache_control']); invariant(typeof part.text === 'string', 'text required');
    } else if (tools && part.type === 'tool_use') {
      fields(part, ['type', 'id', 'name', 'input', 'cache_control']); nonempty(part.id, 'tool id'); nonempty(part.name, 'tool name'); object(part.input);
    } else if (tools && part.type === 'tool_result') {
      fields(part, ['type', 'tool_use_id', 'content', 'is_error', 'cache_control']); nonempty(part.tool_use_id, 'tool result id'); content(part.content, false);
      invariant(part.is_error === undefined || typeof part.is_error === 'boolean', 'invalid tool result');
    } else throw new Error('Media, hosted tools, opaque thinking or unknown Messages content refused');
  }
}
/** Native Messages transport rehearsal only. No paid Anthropic transport is exported. */
export function validateClaudeFixturePayload(body: Record<string, unknown>, profile: BaselineProfile): void {
  fields(body, ['model', 'messages', 'system', 'tools', 'tool_choice', 'max_tokens', 'stream', 'metadata', 'temperature', 'output_config', 'thinking']);
  invariant(body.model === profile.model, 'model differs from immutable host profile');
  if (body.system !== undefined) content(body.system, false);
  invariant(Array.isArray(body.messages), 'explicit Messages input required');
  for (const raw of body.messages) {
    const message = object(raw); fields(message, ['role', 'content']);
    invariant(['user', 'assistant'].includes(String(message.role)), 'invalid Messages role'); content(message.content, true);
  }
  if (body.tools !== undefined) {
    invariant(Array.isArray(body.tools), 'explicit local tool list required');
    for (const raw of body.tools) {
      const tool = object(raw); fields(tool, ['name', 'description', 'input_schema', 'cache_control', 'strict', 'defer_loading']);
      nonempty(tool.name, 'tool name'); object(tool.input_schema); cache(tool.cache_control);
    }
  }
  if (body.tool_choice !== undefined) {
    const choice = object(body.tool_choice); fields(choice, ['type', 'disable_parallel_tool_use']);
    invariant(['auto', 'none', 'any'].includes(String(choice.type)), 'unknown tool choice');
  }
  if (body.output_config !== undefined) {
    const config = object(body.output_config); fields(config, ['effort']); invariant(config.effort === profile.effort, 'effort differs from fixture profile');
  }
  if (body.thinking !== undefined) { const thinking = object(body.thinking); fields(thinking, ['type']); invariant(thinking.type === 'disabled', 'thinking must be explicitly disabled for fixture'); }
  if (body.metadata !== undefined) { const metadata = object(body.metadata); fields(metadata, ['user_id']); invariant(typeof metadata.user_id === 'string', 'invalid metadata'); }
  invariant(body.temperature === undefined || (typeof body.temperature === 'number' && body.temperature >= 0 && body.temperature <= 1), 'invalid temperature');
}

function count(value: unknown): number { invariant(Number.isSafeInteger(value) && (value as number) >= 0, 'invalid Messages usage'); return value as number; }
function zeroCache(usage: Record<string, unknown>): void {
  for (const key of ['cache_creation_input_tokens', 'cache_read_input_tokens']) invariant(usage[key] === undefined || count(usage[key]) === 0, 'cached Anthropic usage unqualified');
  if (usage.cache_creation !== undefined) {
    const cache = object(usage.cache_creation); fields(cache, ['ephemeral_5m_input_tokens', 'ephemeral_1h_input_tokens']);
    for (const value of Object.values(cache)) invariant(count(value) === 0, 'cache creation unqualified');
  }
  invariant(usage.server_tool_use === undefined, 'server tool usage unqualified');
}
export function claudeFixtureUsage(body: string, profile: BaselineProfile, elapsedMs: number): ResourceUsage {
  invariant(body.endsWith('\n\n') || body.endsWith('\r\n\r\n'), 'truncated Messages SSE');
  let input: number | undefined, initialOutput: number | undefined, output: number | undefined, delta = false, stopped = false;
  for (const block of body.split(/\r?\n\r?\n/).filter(Boolean)) {
    const lines = block.split(/\r?\n/), data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) continue;
    const event = object(JSON.parse(data));
    invariant(!stopped && lines.find(line => line.startsWith('event:'))?.slice(6).trim() === event.type, 'unexpected or mismatched Messages SSE');
    if (event.type === 'message_start') {
      invariant(input === undefined, 'duplicate Messages start'); const message = object(event.message);
      nonempty(message.id, 'message id'); invariant(message.type === 'message' && message.role === 'assistant' && message.model === profile.model, 'inconsistent Messages identity');
      const usage = object(message.usage); zeroCache(usage); input = count(usage.input_tokens); initialOutput = count(usage.output_tokens);
    } else if (event.type === 'message_delta') {
      invariant(input !== undefined && !delta, 'unexpected Messages final delta'); delta = true;
      const end = object(event.delta); invariant(['end_turn', 'tool_use', 'stop_sequence'].includes(String(end.stop_reason)), 'incomplete Messages stop');
      const usage = object(event.usage); zeroCache(usage); output = count(usage.output_tokens);
      invariant(initialOutput !== undefined && output >= initialOutput, 'decreasing cumulative Messages output usage');
      invariant(usage.input_tokens === undefined || count(usage.input_tokens) === input, 'inconsistent Messages input usage');
    } else if (event.type === 'message_stop') {
      invariant(delta && output !== undefined, 'Messages stop without final usage'); stopped = true;
    } else invariant(input !== undefined && !delta && ['content_block_start', 'content_block_delta', 'content_block_stop', 'ping'].includes(String(event.type)), 'unknown or failed Messages event');
  }
  invariant(stopped && input !== undefined && output !== undefined && input <= profile.contextWindowTokens && output <= profile.maxOutputTokens, 'missing or excessive Messages usage');
  return { requests: 1, inputTokens: input, outputTokens: output, costUsd: 0, elapsedMs };
}
