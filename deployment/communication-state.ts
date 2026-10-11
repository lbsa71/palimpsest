import { invariant, scopeAllows, type DataScope, type JsonValue } from '../packages/contracts/index.ts';
import type { SlackRecovery } from '../packages/communications/index.ts';
import type { ApplicationTool } from './application.ts';
import type { ObligationTarget } from './obligation-tools.ts';

/** Recovery is a bounded history scan, not proof that Slack retained every message.
 * Read only this conversation's gaps; even channel names in other audiences stay private. */
export function communicationState(audience: DataScope, target: ObligationTarget | undefined, recovery: SlackRecovery | undefined): JsonValue {
  if (!target || !scopeAllows(target.scope, audience)) return { status: 'no-conversation-target' };
  if (target.transport === 'direct') return { transport: 'direct', status: 'local-durable-admission', recovery: 'Only inputs admitted by this endpoint are known; no external history is available.' };
  const grant = recovery?.options.ingress.options.channels.find(channel => channel.channel === target.channel);
  if (!recovery || !grant || !scopeAllows(grant.scope, audience)) return { transport: 'slack', status: 'recovery-unavailable' };
  const state = recovery.state();
  const gaps = state.gaps.filter(gap => gap.channel === target.channel && (gap.threadTs === undefined || gap.threadTs === target.threadTs));
  const recent = gaps.slice(-32).map(gap => ({ id: gap.id, kind: gap.kind, detail: gap.detail.slice(0, 1024), at: gap.at, ...(gap.threadTs ? { threadTs: gap.threadTs } : {}) }));
  return { transport: 'slack', channel: target.channel, ...(target.threadTs ? { threadTs: target.threadTs } : {}),
    status: state.retryAt && state.retryAt > Date.now() ? 'retry-scheduled' : state.cycle ? 'scan-in-progress' : state.lastCompleted ? 'scan-cycle-finished' : 'not-scanned',
    coverage: { declaredStart: recovery.options.coverageStart, lookbackSeconds: recovery.options.lookbackSeconds,
      meaning: 'A completed cycle records an attempted bounded scan, not complete delivery. Retention, permission and protocol gaps may remain.' },
    lastScanCycleFinishedAt: state.lastCompleted ?? null, retryAt: state.retryAt ?? null,
    knownGaps: recent, omittedOlderGapCount: gaps.length - recent.length,
    gapMeaning: 'Historical observations, not automatically cleared or certified repaired by a later successful scan.',
    connectivity: 'not-probed' };
}

export function communicationTools(read: () => JsonValue): ApplicationTool[] {
  return [{ name: 'communication_status', description: 'Read the current conversation’s bounded recovery coverage and known history gaps. This performs no network request and sends no message.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }, execute: args => {
      invariant(args && typeof args === 'object' && !Array.isArray(args) && Object.keys(args).length === 0, 'No communication status arguments');
      return read();
    } }];
}
