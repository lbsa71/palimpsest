import { invariant, scopeAllows, type DataScope, type Effect, type JsonValue } from '../packages/contracts/index.ts';

/** Missing optional routing fields inherit only the host's exact conversation
 * destination. Keep the journal's original payload intact for audit/recovery. */
export function bindSpeechTarget(effect: Effect, target: { channel: string; threadTs?: string; scope: DataScope }): Effect {
  invariant(effect.kind === 'speech.send', 'Unsupported speech effect');
  invariant(effect.payload !== null && typeof effect.payload === 'object' && !Array.isArray(effect.payload), 'Speech requires an object');
  const payload = effect.payload as Record<string, JsonValue>;
  invariant(Object.keys(payload).every(key => ['channel', 'threadTs', 'text', 'kind', 'obligationId', 'obligationRevision', 'reportRevision'].includes(key)), 'Unknown speech field');
  invariant(payload.channel === target.channel && (payload.threadTs === undefined || payload.threadTs === target.threadTs), 'Speech target invalid');
  invariant(scopeAllows(effect.scope, target.scope), 'Speech audience denied');
  invariant(typeof payload.text === 'string' && payload.text.trim().length > 0, 'Speech content invalid');
  invariant(payload.kind === undefined || ['message', 'progress', 'report'].includes(payload.kind as string), 'Speech kind invalid');
  for (const key of ['obligationRevision', 'reportRevision'] as const) {
    invariant(payload[key] === undefined || Number.isSafeInteger(payload[key]) && (payload[key] as number) >= 0, 'Speech report revision invalid');
  }
  if (payload.obligationId !== undefined) invariant(typeof payload.obligationId === 'string' && payload.obligationId.trim().length > 0
    && payload.kind === 'report' && Number.isSafeInteger(payload.obligationRevision), 'Report requires an obligation and its current revision');
  return { ...effect, payload: { ...payload, kind: payload.kind ?? 'message', ...(target.threadTs !== undefined ? { threadTs: target.threadTs } : {}) } };
}
