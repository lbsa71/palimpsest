import { invariant } from '../../packages/contracts/common.ts';
import type { BaselineProfile } from './observer.ts';

export const PINNED_CODEX_VERSION = 'codex-cli 0.162.1';
export const PINNED_CODEX_SHA256 = '628e35487d888a28f0427fc37501da529dd3d81fcbad7a2c3421c1e8670d92e1';
export const PINNED_CODEX_HELPER_SHA256 = 'ec71830690a7c0024916ee0c99fbdc635bc6e747ff665ea4f03a8389bbcb6b30';
export interface CodexNativeProtocol {
  kind: 'agent-message-v1'; codexVersion: string; codexSha256: string; helperSha256: string; qualification: 'synthetic-only';
}
function object(value: unknown): Record<string, unknown> { invariant(value !== null && typeof value === 'object' && !Array.isArray(value), 'native Codex object required'); return value as Record<string, unknown>; }
function fields(value: Record<string, unknown>, allowed: string[]): void { invariant(Object.keys(value).every(key => allowed.includes(key)), 'unknown native Codex field refused'); }
export function validateCodexNativeProtocol(profile: BaselineProfile): void {
  const value = object(profile.codexNativeProtocol);
  fields(value, ['kind', 'codexVersion', 'codexSha256', 'helperSha256', 'qualification']);
  invariant(value.kind === 'agent-message-v1' && value.codexVersion === PINNED_CODEX_VERSION && value.codexSha256 === PINNED_CODEX_SHA256 && value.helperSha256 === PINNED_CODEX_HELPER_SHA256 && value.qualification === 'synthetic-only', 'unsupported pinned native Codex protocol; new qualification required');
  invariant(profile.provider === 'openai' && profile.model === 'gpt-6-astra' && profile.effort === 'high' && profile.contextWindowTokens === 200_000 && profile.maxOutputTokens === 4096, 'native Codex child format requires the exact acquired synthetic profile');
}
/** Client attribution is retained evidence, never host authority. Opaque blocks are not decoded. */
export function validateCodexAgentMessage(raw: unknown, profile: BaselineProfile): void {
  invariant(profile.codexNativeProtocol, 'native Codex child message requires synthetic pinned qualification');
  const item = object(raw); fields(item, ['type', 'id', 'author', 'recipient', 'content']);
  invariant(item.type === 'agent_message' && typeof item.id === 'string' && /^amsg_[A-Za-z0-9_-]{1,128}$/.test(item.id), 'invalid native child message identity');
  for (const key of ['author', 'recipient']) invariant(typeof item[key] === 'string' && Buffer.byteLength(item[key]) <= 256 && /^\/root(?:\/[A-Za-z0-9_-]+){0,8}$/.test(item[key]), 'invalid bounded native agent identity');
  invariant(Array.isArray(item.content) && item.content.length > 0 && item.content.length <= 64, 'explicit bounded native agent content required');
  for (const rawPart of item.content) {
    const part = object(rawPart);
    invariant(part.type === 'input_text' || part.type === 'encrypted_content', 'unknown or media native agent content refused');
    const key = part.type === 'input_text' ? 'text' : 'encrypted_content'; fields(part, ['type', key]);
    invariant(typeof part[key] === 'string' && part[key].length > 0, 'native agent content must be a nonempty string');
  }
}
