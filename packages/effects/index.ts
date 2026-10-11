import { randomUUID } from 'node:crypto';
import { assertAuthority, canonicalJson, invariant } from '../contracts/common.ts';
import type { Authority, ArtifactRef } from '../contracts/common.ts';
import { transitionEffect, validateEffect } from '../contracts/execution/index.ts';
import type { Effect, EffectReceiver, EffectTransition } from '../contracts/execution/index.ts';
import { OperationalStore } from '../storage/index.ts';
export interface AuthorityFence { assert(authority: Authority): void }
/** Persist dispatch intent before crossing the receiver. No retry is inferred from a lost receipt. */
export class EffectJournal {
  readonly store: OperationalStore; readonly fence: AuthorityFence; readonly receiver: EffectReceiver;
  constructor(store: OperationalStore, fence: AuthorityFence, receiver: EffectReceiver) { this.store=store; this.fence=fence; this.receiver=receiver; }
  get(id: string): Effect | undefined { return this.store.get<Effect>('effects', id)?.value; }
  create(effect: Effect): Effect {
    validateEffect(effect); invariant(effect.status === 'pending', 'new effect must be pending');
    return this.store.transaction(() => {
      const existing = this.get(effect.id);
      invariant(!existing, 'effect already exists');
      this.store.put('effects', effect.id, effect, null); this.event(effect, 'created'); return effect;
    });
  }
  /** Existing identity must bind the original payload, scope and grant. */
  ensure(effect: Effect): Effect {
    const existing = this.get(effect.id);
    if (!existing) return this.create(effect);
    for (const key of ['runId','stepId','kind','payload','scope','authority','idempotencyKey'] as const) invariant(canonicalJson(existing[key] ?? null) === canonicalJson(effect[key] ?? null), `conflicting effect ${key}`);
    return existing;
  }
  private event(effect: Effect, type: string): void { this.store.append({ id: randomUUID(), stream: `effect:${effect.id}`, type, data: effect }); }
  private transition(id: string, event: EffectTransition, authority: Authority): Effect {
    return this.store.transaction(() => { const row = this.store.get<Effect>('effects',id); invariant(row,'missing effect'); const next = transitionEffect(row.value,event,authority); this.store.put('effects',id,next,row.revision); this.event(next,event.kind); return next; });
  }
  authorize(id: string, reservationId: string, authority: Authority): Effect { this.fence.assert(authority); return this.transition(id,{kind:'authorize',reservationId},authority); }
  async dispatch(id: string, authority: Authority, signal?: AbortSignal): Promise<Effect> {
    const effect = this.get(id); invariant(effect,'missing effect'); assertAuthority(effect.authority,authority); invariant(effect.status === 'authorized','effect requires authorization or reconciliation');
    signal?.throwIfAborted(); this.fence.assert(authority);
    const dispatched = this.transition(id,{kind:'dispatch'},authority);
    // The receiver also MUST fence inside dispatch before starting its actual effect.
    let result: Awaited<ReturnType<EffectReceiver['dispatch']>>;
    try { this.fence.assert(authority); result = await this.receiver.dispatch(dispatched,signal); }
    catch { result = {outcome:'uncertain'}; }
    const now = this.get(id)!;
    if (now.status === 'uncertain' && result.receipt) return this.recordReconciliation(id,authority,result.outcome==='succeeded'?'succeeded':'unresolved',result.receipt);
    if (now.status !== 'dispatched') return now;
    // A late receipt is evidence, even if ownership was withdrawn during the call.
    return this.store.transaction(() => {
      const row = this.store.get<Effect>('effects',id)!;
      if (row.value.status !== 'dispatched') return row.value;
      const next: Effect = { ...row.value, revision: row.value.revision + 1, status: result.outcome, ...(result.receipt ? {receipt:result.receipt} : {}) };
      validateEffect(next); this.store.put('effects',id,next,row.revision); this.event(next,'receipt'); return next;
    });
  }
  recoverDispatched(runId?: string): string[] {
    return this.store.transaction(() => this.store.list<Effect>('effects').filter(row => row.value.status === 'dispatched' && (runId === undefined || row.value.runId === runId)).map(row => {
      const next: Effect = {...row.value,status:'uncertain',revision:row.value.revision+1}; this.store.put('effects',row.key,next,row.revision); this.event(next,'recovered-uncertain'); return row.key;
    }));
  }
  async reconcile(id: string, currentAuthority: Authority): Promise<Effect> {
    const effect = this.get(id); invariant(effect?.status === 'uncertain','only uncertain effects reconcile');
    const result = await this.receiver.reconcile(effect);
    return this.transition(id,{kind:'reconcile',...result},currentAuthority);
  }
  recordReconciliation(id: string, currentAuthority: Authority, outcome: 'succeeded' | 'not-applied' | 'unresolved', receipt: ArtifactRef): Effect { return this.transition(id,{kind:'reconcile',outcome,receipt},currentAuthority); }
  unresolved(runId?: string): Effect[] { return this.store.list<Effect>('effects').map(r=>r.value).filter(e=>['dispatched','uncertain'].includes(e.status) && (runId === undefined || e.runId===runId)); }
}
