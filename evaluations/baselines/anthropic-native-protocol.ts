import { invariant } from '../../packages/contracts/common.ts';
import type { BaselineProfile, ProviderAttempt } from './observer.ts';

export const PINNED_CLAUDE_VERSION = '2.1.296 (Claude Code)';
export const PINNED_CLAUDE_SHA256 = '24972e3bc859fab2b46ed4c1e51f7d6130f06d3bd550811a114640de3370d0de';
export const HISTORICAL_CLAUDE_FIXTURE_BETA = 'interleaved-thinking-2025-05-14,thinking-token-count-2026-05-13,context-management-2025-06-27,prompt-caching-scope-2026-01-05,claude-code-20250219';
/** Captured from the pinned Opus native profile in diagnostic artifact 9cd20c09d128b7b4ee39733820efe12f4aa46d34a3a7e883930dda4c3149b068. */
export const PINNED_CLAUDE_BETA = 'claude-code-20250219,interleaved-thinking-2025-05-14,thinking-token-count-2026-05-13,context-management-2025-06-27,prompt-caching-scope-2026-01-05,mid-conversation-system-2026-04-07,per-turn-control-2026-07-01,effort-2025-11-24,thinking-display-updates-2026-08-18';
/* Exact isolated-native Agent surface, acquired before transport in d9dc038e. */
export const PINNED_CLAUDE_DELEGATION_BETA = 'claude-code-20250219,interleaved-thinking-2025-05-14,thinking-token-count-2026-05-13,context-management-2025-06-27,prompt-caching-scope-2026-01-05,mid-conversation-system-2026-04-07,per-turn-control-2026-07-01,mid-conversation-tool-changes-2026-07-01,effort-2025-11-24,thinking-display-updates-2026-08-18';
export interface AnthropicNativeProtocol {
  kind: 'opus-adaptive-coding' | 'opus-adaptive-delegation'; claudeVersion: string; claudeSha256: string; version: '2023-06-01'; beta: string;
  qualification: 'synthetic-only';
}
export interface AnthropicProtocolHeaders { version: string; beta: string }
function object(value: unknown): Record<string, unknown> {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value), 'native Messages object required'); return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, allowed: string[]): void { invariant(Object.keys(value).every(key => allowed.includes(key)), 'unknown native Messages feature refused'); }
function count(value: unknown, positive = false): number { invariant(Number.isSafeInteger(value) && (value as number) >= (positive ? 1 : 0), 'invalid native count'); return value as number; }
export function validateNativeProtocol(value: AnthropicNativeProtocol): void {
  fields(value as unknown as Record<string, unknown>, ['kind', 'claudeVersion', 'claudeSha256', 'version', 'beta', 'qualification']);
  invariant(((value.kind === 'opus-adaptive-coding' && value.beta === PINNED_CLAUDE_BETA) || (value.kind === 'opus-adaptive-delegation' && value.beta === PINNED_CLAUDE_DELEGATION_BETA)) && value.claudeVersion === PINNED_CLAUDE_VERSION && value.claudeSha256 === PINNED_CLAUDE_SHA256 && value.version === '2023-06-01' && value.qualification === 'synthetic-only', 'unsupported pinned native protocol; new qualification required');
}
const CONSUMED_HEADERS = ['accept', 'accept-encoding', 'anthropic-dangerous-direct-browser-access', 'connection', 'content-length', 'content-type', 'host', 'user-agent', 'x-api-key', 'authorization', 'x-app',
  'x-claude-code-session-id', 'x-claude-code-agent-id', 'x-claude-code-parent-agent-id', 'x-stainless-arch', 'x-stainless-lang', 'x-stainless-os', 'x-stainless-package-version', 'x-stainless-retry-count', 'x-stainless-runtime', 'x-stainless-runtime-version', 'x-stainless-timeout'];
/** Authenticate nowhere: only the exact version/beta pair can cross to the host-owned transport. */
export function nativeProtocolHeaders(attempt: ProviderAttempt, profile: BaselineProfile): AnthropicProtocolHeaders | undefined {
  const protocol = profile.anthropic?.nativeProtocol;
  if (!protocol) {
    if (attempt.nativeHttp) invariant(Object.entries(attempt.nativeHttp.headers).every(([key, value]) => !['anthropic-beta', 'anthropic-workspace-id', 'anthropic-user-profile-id'].includes(key.toLowerCase()) || value === undefined), 'unsupported native Anthropic header refused');
    return undefined;
  }
  invariant(attempt.nativeHttp && ['/v1/messages', '/v1/messages?beta=true'].includes(attempt.nativeHttp.path), 'explicit native HTTP protocol evidence required');
  const headers: Record<string, string | string[] | undefined> = {};
  for (const [raw, value] of Object.entries(attempt.nativeHttp.headers)) {
    const key = raw.toLowerCase(); invariant(headers[key] === undefined, 'duplicate native header');
    invariant(['anthropic-version', 'anthropic-beta', ...CONSUMED_HEADERS].includes(key), 'unknown native header refused'); headers[key] = value;
  }
  invariant(headers['anthropic-version'] === protocol.version && headers['anthropic-beta'] === protocol.beta, 'native version/beta differs from pinned host profile');
  return { version: headers['anthropic-version'], beta: headers['anthropic-beta'] };
}
function threshold(raw: unknown, types: string[], positive = false): void { const value = object(raw); fields(value, ['type', 'value']); invariant(types.includes(String(value.type)), 'unknown context threshold'); count(value.value, positive); }
/** Documented server-side clearing; local history remains untouched. No hosted tools or compaction iterations. */
export function validateContextManagement(raw: unknown): void {
  const value = object(raw); fields(value, ['edits']); invariant(Array.isArray(value.edits), 'explicit context edits required');
  for (const rawEdit of value.edits) {
    const edit = object(rawEdit);
    if (edit.type === 'clear_thinking_20251015') {
      fields(edit, ['type', 'keep']); if (edit.keep !== undefined && edit.keep !== 'all') threshold(edit.keep, ['thinking_turns'], true);
    } else if (edit.type === 'clear_tool_uses_20250919') {
      fields(edit, ['type', 'trigger', 'keep', 'clear_at_least', 'exclude_tools', 'clear_tool_inputs']);
      if (edit.trigger !== undefined) threshold(edit.trigger, ['input_tokens', 'tool_uses'], true);
      if (edit.keep !== undefined) threshold(edit.keep, ['tool_uses']);
      if (edit.clear_at_least !== undefined) threshold(edit.clear_at_least, ['input_tokens']);
      if (edit.exclude_tools !== undefined) invariant(Array.isArray(edit.exclude_tools) && edit.exclude_tools.every(name => typeof name === 'string' && name.length > 0), 'invalid excluded context tools');
      invariant(edit.clear_tool_inputs === undefined || typeof edit.clear_tool_inputs === 'boolean', 'invalid context input clearing');
    } else throw new Error('Unsupported native context strategy');
  }
}
export function validateAppliedContextEdits(raw: unknown): void {
  const value = object(raw); fields(value, ['applied_edits']); invariant(Array.isArray(value.applied_edits), 'explicit applied context edits required');
  for (const rawEdit of value.applied_edits) {
    const edit = object(rawEdit); invariant(['clear_thinking_20251015', 'clear_tool_uses_20250919'].includes(String(edit.type)), 'unsupported applied context strategy');
    fields(edit, ['type', 'cleared_input_tokens', edit.type === 'clear_thinking_20251015' ? 'cleared_thinking_turns' : 'cleared_tool_uses']); count(edit.cleared_input_tokens);
    count(edit[edit.type === 'clear_thinking_20251015' ? 'cleared_thinking_turns' : 'cleared_tool_uses']);
  }
}
export function validateDirectCaller(raw: unknown): void { if (raw === undefined) return; const caller = object(raw); fields(caller, ['type']); invariant(caller.type === 'direct', 'unpriced server tool caller'); }
export function validateThinkingProgress(raw: unknown): void {
  const delta = object(raw); fields(delta, ['type', 'thinking', 'estimated_tokens']); invariant(delta.type === 'thinking_delta' && typeof delta.thinking === 'string', 'invalid thinking delta');
  if (delta.estimated_tokens !== undefined && delta.estimated_tokens !== null) count(delta.estimated_tokens);
}
