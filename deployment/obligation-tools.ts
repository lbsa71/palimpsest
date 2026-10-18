import { identity, invariant, type DataScope, type Effect, type JsonValue } from '../packages/contracts/index.ts';
import { ObligationRegistry } from '../packages/initiative/index.ts';
import type { ApplicationTool } from './application.ts';
export interface ObligationTarget { channel: string; threadTs?: string; transport: 'direct' | 'slack'; scope: DataScope }
export class ConversationObligations {
  readonly registry: ObligationRegistry;
  constructor(registry: ObligationRegistry) { this.registry = registry; }
  target(id: string): ObligationTarget | undefined { return this.registry.store.get<ObligationTarget>('host.obligation-targets', id)?.value; }
  visible(target: ObligationTarget | undefined) { return target ? this.registry.all().filter(owed => identity(this.target(owed.id) ?? null) === identity(target)) : []; }
  tools(runId: string, target: ObligationTarget | undefined): ApplicationTool[] {
    if (!target) return [];
    const string = { type: 'string', minLength: 1 };
    return [{ name: 'obligation_owe', description: 'Record an outcome promised to this authenticated conversation. A progress message cannot settle it; delivery requires an explicit confirmed report.',
      inputSchema: { type: 'object', properties: { id: string, promisedOutcome: string, dueAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] } }, required: ['id', 'promisedOutcome', 'dueAt'], additionalProperties: false },
      execute: (args: JsonValue) => {
        invariant(args && typeof args === 'object' && !Array.isArray(args) && Object.keys(args).every(key => ['id', 'promisedOutcome', 'dueAt'].includes(key)) && typeof args.id === 'string' && typeof args.promisedOutcome === 'string' && (args.dueAt === null || typeof args.dueAt === 'string' && Number.isFinite(Date.parse(args.dueAt))), 'Invalid promise');
        const input = this.registry.store.list<{ runId: string; input: { id: string } }>('communications.inputs').findLast(row => row.value.runId === runId)?.value.input;
        invariant(input, 'Promise requires an authenticated conversational input');
        return this.registry.store.transaction(() => {
          const id = `owed:${identity(target)}:${args.id}`;
          const obligation = this.registry.owe({ id, inputId: input.id, audience: target.scope, promisedOutcome: args.promisedOutcome as string, dueAt: args.dueAt as string | null });
          this.registry.store.put('host.obligation-targets', id, target, null); return obligation;
        });
      } }, { name: 'obligation_list', description: 'Inspect promises for this conversation and their delivery status.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, execute: (args: JsonValue) => { invariant(args && typeof args === 'object' && !Array.isArray(args) && !Object.keys(args).length, 'No list arguments'); return this.visible(target); } }];
  }
  beforeSpeech(effect: Effect, target: ObligationTarget): void {
    const payload = effect.payload as Record<string, JsonValue>;
    if (payload.kind !== 'report' || payload.obligationId === undefined) return;
    invariant(typeof payload.obligationId === 'string', 'Report obligation required');
    invariant(identity(this.target(payload.obligationId) ?? null) === identity(target), 'Report belongs to another conversation');
    const obligation = this.registry.obligation(payload.obligationId)!;
    invariant(payload.obligationRevision === obligation.revision && obligation.status === 'owed', 'Report revision is not owed');
    invariant(payload.channel === target.channel && payload.threadTs === target.threadTs, 'Report destination was not bound to this conversation');
    this.registry.beginDelivery(obligation.id, obligation.revision, effect.id, { channel: target.channel, ...(target.threadTs !== undefined ? { threadTs: target.threadTs } : {}) });
  }
  confirm(): void {
    for (const obligation of this.registry.all()) if (obligation.status === 'delivering' && obligation.effectId && this.registry.store.get<Effect>('effects', obligation.effectId)?.value.status === 'succeeded') this.registry.confirmDelivery(obligation.id, obligation.revision);
  }
}
