import { invariant, nonempty, scopeAllows, validateObligation } from '../../contracts/index.ts';
import type { DataScope, Effect, JsonValue, Obligation, ObligationPort } from '../../contracts/index.ts';
import { OperationalStore } from '../../storage/index.ts';
const NS = 'initiative.obligations';
function object(value: JsonValue): { [key: string]: JsonValue } { invariant(value !== null && typeof value === 'object' && !Array.isArray(value), 'delivery requires structured receipt'); return value; }
/** Independent of goal completion; only confirmed report delivery settles an owed outcome. */
export class ObligationRegistry implements ObligationPort {
  readonly store: OperationalStore;
  constructor(store: OperationalStore) { this.store = store; }
  obligation(id: string): Obligation | undefined { return this.store.get<Obligation>(NS, id)?.value; }
  async get(id: string): Promise<Obligation | undefined> { return this.obligation(id); }
  all(): Obligation[] { return this.store.list<Obligation>(NS).map(row => row.value); }
  async owed(audience: DataScope): Promise<Obligation[]> { return this.all().filter(o => ['owed', 'delivering'].includes(o.status) && scopeAllows(o.audience, audience)); }
  async put(value: Obligation, expected: number | null): Promise<void> {
    if (expected === null) { invariant(value.status === 'owed', 'new obligation must be owed'); this.save(value, null); return; }
    invariant(value.status !== 'delivered', 'use confirmDelivery for receipt validation');
    const old = this.obligation(value.id); invariant(old && old.status !== 'delivered' && old.status !== 'cancelled', 'obligation terminal');
    invariant(value.status === old.status || value.status === 'cancelled', 'use beginDelivery for delivery'); this.save(value, expected);
  }
  private save(value: Obligation, expected: number | null): Obligation {
    validateObligation(value); invariant(value.revision === (expected ?? 0) + 1, 'obligation revision must advance once');
    const old = this.obligation(value.id);
    if (old) invariant(old.inputId === value.inputId && old.goalId === value.goalId && old.promisedOutcome === value.promisedOutcome && scopeAllows(old.audience, value.audience) && scopeAllows(value.audience, old.audience), 'obligation identity/audience immutable');
    this.store.put(NS, value.id, value, expected); return value;
  }
  owe(value: Omit<Obligation, 'revision' | 'status'>): Obligation { return this.save({ ...value, revision: 1, status: 'owed' }, null); }
  beginDelivery(id: string, expected: number, effectId: string): Obligation {
    nonempty(effectId, 'delivery effect');
    return this.store.transaction(() => { const old = this.obligation(id); invariant(old && old.status === 'owed', 'obligation not owed'); const saved = this.save({ ...old, revision: expected + 1, status: 'delivering', effectId }, expected); this.store.put('initiative.delivery-intents', `${id}:${saved.revision}`, { obligationRevision: expected, effectId }, null); return saved; });
  }
  confirmDelivery(id: string, expected: number): Obligation {
    return this.store.transaction(() => {
      const old = this.obligation(id); invariant(old && old.status === 'delivering' && old.effectId, 'obligation not delivering');
      const effect = this.store.get<Effect>('effects', old.effectId)?.value;
      invariant(effect?.status === 'succeeded' && effect.receipt, 'delivery lacks confirmed receipt');
      invariant(scopeAllows(old.audience, effect.scope) && scopeAllows(effect.scope, old.audience), 'delivery audience mismatch');
      const payload = object(effect.payload), receipt = object(this.store.readJsonArtifact(effect.receipt));
      const intent = this.store.get<{ obligationRevision: number }>('initiative.delivery-intents', `${id}:${old.revision}`)?.value;
      invariant(intent && payload.kind === 'report' && receipt.kind === 'report' && receipt.delivered === true, 'progress acknowledgement is not an outcome report');
      invariant(payload.obligationId === id && receipt.obligationId === id && payload.obligationRevision === intent.obligationRevision && receipt.obligationRevision === intent.obligationRevision, 'report does not match obligation revision');
      nonempty(payload.channel, 'report channel'); invariant(receipt.channel === payload.channel && receipt.threadTs === payload.threadTs, 'report receipt target mismatch');
      nonempty(payload.text, 'report text'); invariant(receipt.text === payload.text && receipt.reportRevision === payload.reportRevision, 'report receipt content/revision mismatch');
      nonempty(receipt.clientMsgId, 'host generated delivery identity');
      if (payload.clientMsgId !== undefined) invariant(receipt.clientMsgId === payload.clientMsgId, 'report receipt identity mismatch');
      nonempty(receipt.messageTs, 'delivered message timestamp');
      return this.save({ ...old, revision: expected + 1, status: 'delivered', resolution: `confirmed receipt ${effect.receipt.sha256}` }, expected);
    });
  }
  retry(id: string, expected: number, reason: string): Obligation {
    nonempty(reason, 'retry reason'); const old = this.obligation(id); invariant(old?.status === 'delivering', 'only delivering can retry');
    const effect = this.store.get<Effect>('effects', old.effectId!)?.value; invariant(effect?.status === 'failed', 'uncertain or successful delivery cannot retry');
    const { effectId: _effectId, ...rest } = old; return this.save({ ...rest, revision: expected + 1, status: 'owed', resolution: reason }, expected);
  }
  cancel(id: string, expected: number, reason: string): Obligation { nonempty(reason, 'cancellation reason'); const old = this.obligation(id); invariant(old && ['owed', 'delivering'].includes(old.status), 'obligation terminal'); return this.save({ ...old, revision: expected + 1, status: 'cancelled', resolution: reason }, expected); }
}
