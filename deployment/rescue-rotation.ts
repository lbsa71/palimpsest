import { identity, invariant, type ArtifactRef, type Authority, type DataScope, type Effect, type JsonValue, type PhysicalRequest, type Run } from '../packages/contracts/index.ts';
import { EffectJournal } from '../packages/effects/index.ts';
import type { ReleaseState, ReleaseTarget } from '../packages/release/controller.ts';
import { ResourceLedger } from '../packages/runtime/resources/index.ts';
import type { OperationalStore } from '../packages/storage/index.ts';
import type { AuthorityStore } from '../packages/supervisor/authority.ts';
import type { ApplicationTool } from './application.ts';
import type { EvolutionContext } from './evolution-tools.ts';

const namespace = 'host.rescue-rotations', acknowledgments = 'host.rescue-rotation-acknowledgments';
class ProducerActive extends Error {}
export interface RescueRotationRequest { id: string; runId: string; scope: DataScope; authority: Authority; selected: ReleaseTarget }
interface RotationAcknowledgment { effectId: string; payload: JsonValue; authority: Authority; receipt: ArtifactRef }
export interface RescueRotationRecord {
  request: RescueRotationRequest; status: 'pending' | 'processing' | 'completed' | 'rejected' | 'uncertain';
  acknowledgment?: RotationAcknowledgment; decision?: ArtifactRef; failure?: ArtifactRef; diagnosis?: string;
}
function boundAuthor(store: OperationalStore, request: RescueRotationRequest): Run {
  const run = store.get<Run>('runs', request.runId)?.value;
  // Completing the requesting slice does not revoke its already committed explicit request.
  invariant(run && run.status !== 'cancelled' && identity(run.scope) === identity(request.scope) && identity(run.authority) === identity(request.authority), 'Rescue rotation author cancelled, fenced or outside its audience');
  let id: string | undefined = run.id; const seen = new Set<string>();
  while (id) {
    invariant(seen.size < 128 && !seen.has(id), 'Bounded rescue request allocation required'); seen.add(id);
    const allocation: { parentRunId?: string; cancelled: boolean; startedAt: number; envelope: { maxElapsedMs: number } } | undefined = store.get<{ parentRunId?: string; cancelled: boolean; startedAt: number; envelope: { maxElapsedMs: number } }>('allocations', id)?.value;
    invariant(allocation && !allocation.cancelled && Date.now() - allocation.startedAt < allocation.envelope.maxElapsedMs, 'Rescue rotation allowance expired or cancelled'); id = allocation.parentRunId;
  }
  invariant(!new ResourceLedger(store, { tokens: 0, costUsd: 0, elapsedMs: 0 }).snapshot(run.id).cancelled, 'Rescue rotation allowance cancelled');
  return run;
}
export function rescueRotationStatus(store: OperationalStore, id: string, runId: string, scope: DataScope): RescueRotationRecord | undefined {
  const record = store.get<RescueRotationRecord>(namespace, id)?.value;
  invariant(!record || record.request.runId === runId && identity(record.request.scope) === identity(scope), 'Rescue rotation unavailable for this run/audience'); return record;
}
function publicStatus(record: RescueRotationRecord): JsonValue {
  return { requestId: record.request.id, status: record.status, selected: { ...record.request.selected },
    ...(record.diagnosis ? { diagnosis: record.diagnosis } : {}) };
}
export function rescueRotationTools(context: EvolutionContext, options: { candidateId: string; policyDigest: string; assertAuthority(authority: Authority): void }): ApplicationTool[] {
  const bound = { ...context, scope: structuredClone(context.scope), authority: structuredClone(context.authority) };
  const allowed = (signal?: AbortSignal) => { signal?.throwIfAborted(); options.assertAuthority(bound.authority);
    const run = bound.store.get<Run>('runs', bound.runId)?.value;
    invariant(run && !['completed', 'cancelled'].includes(run.status) && identity(run.scope) === identity(bound.scope) && identity(run.authority) === identity(bound.authority), 'Live scoped rescue requester required'); };
  const arg = (args: JsonValue, key: 'candidateId' | 'requestId'): string => {
    invariant(args && typeof args === 'object' && !Array.isArray(args) && Object.keys(args).join(',') === key && typeof args[key] === 'string' && args[key].length <= 256, 'Exact bounded rescue rotation argument required'); return args[key];
  };
  return [{ name: 'rescue_rotate', description: 'Explicitly request that the current accepted, actually boot-ready candidate become the retained rescue. This separate host decision preserves old rescue artifacts and never runs automatically on release acceptance. Read rescue_status for the durable result.',
    inputSchema: { type: 'object', properties: { candidateId: { type: 'string' } }, required: ['candidateId'], additionalProperties: false },
    execute(args, signal) {
      try { allowed(signal); const candidateId = arg(args, 'candidateId');
        invariant(candidateId === options.candidateId && /^[a-f0-9]{64}$/.test(candidateId) && /^[a-f0-9]{64}$/.test(options.policyDigest) && bound.effectId, 'Current candidate and host effect identity required');
        return bound.store.transaction(() => {
          allowed(signal);
          const fields = { runId: bound.runId, scope: bound.scope, authority: bound.authority, selected: { candidateId, policyDigest: options.policyDigest } };
          const request: RescueRotationRequest = { id: `rescue:${identity(fields)}`, ...structuredClone(fields) };
          boundAuthor(bound.store, request);
          const old = rescueRotationStatus(bound.store, request.id, bound.runId, bound.scope);
          invariant(!old || identity(old.request) === identity(request), 'Rescue request identity changed');
          invariant(old || bound.store.list<RescueRotationRecord>(namespace).filter(row => ['pending', 'processing'].includes(row.value.status)).length < 32, 'Rescue request queue is full');
          const record: RescueRotationRecord = old ?? { request, status: 'pending' }, value = publicStatus(record);
          const acknowledgment: RotationAcknowledgment = { effectId: bound.effectId!, payload: structuredClone(args), authority: bound.authority, receipt: bound.store.putJsonArtifact(value) };
          invariant(!old?.acknowledgment || old.acknowledgment.effectId !== acknowledgment.effectId || identity(old.acknowledgment) === identity(acknowledgment), 'Local rescue acknowledgment changed');
          // The first producer remains the readiness gate; repeated status-equivalent requests
          // cannot replace its still-unsettled effect with a different effect identity.
          if (!old) bound.store.put(namespace, request.id, { ...record, acknowledgment }, null);
          const priorAck = bound.store.get<{ requestId: string; acknowledgment: RotationAcknowledgment; settled: boolean }>(acknowledgments, acknowledgment.effectId);
          invariant(!priorAck || priorAck.value.requestId === request.id && identity(priorAck.value.acknowledgment) === identity(acknowledgment), 'Exact rescue reply identity changed');
          if (!priorAck) bound.store.put(acknowledgments, acknowledgment.effectId, { requestId: request.id, acknowledgment, settled: false }, null);
          return value;
        });
      } catch (cause) { throw Object.assign(Error(`Rescue rotation enqueue rejected: ${cause instanceof Error ? cause.message : 'invalid binding'}`, { cause }), { mayHaveApplied: false }); }
    },
  }, { name: 'rescue_status', description: 'Read this original run’s scoped rescue rotation decision. Unknown rotation outcomes remain retained for explicit host reconciliation; this read never retries them.',
    inputSchema: { type: 'object', properties: { requestId: { type: 'string' } }, required: ['requestId'], additionalProperties: false },
    execute(args, signal) { allowed(signal); const id = arg(args, 'requestId'); invariant(/^rescue:[a-f0-9]{64}$/.test(id), 'Exact rescue request ID required');
      const record = rescueRotationStatus(bound.store, id, bound.runId, bound.scope); invariant(record, 'Unknown scoped rescue request'); return publicStatus(record); },
  }];
}
export interface RescueRotationOptions {
  store: OperationalStore; authority: AuthorityStore; status(): ReleaseState; ready(): boolean;
  /** The existing bootstrap callback holds publication and authority locks before commit.
   * commit must guard the original requester and journal the pointer operation synchronously. */
  rotate?(request: RescueRotationRequest, commit: (apply: () => void) => void): void;
}
export class RescueRotationHost {
  readonly options: RescueRotationOptions;
  readonly #abort = new AbortController(); #loop?: Promise<void>; #processing = false;
  constructor(options: RescueRotationOptions) {
    this.options = options;
    for (const row of options.store.list<RescueRotationRecord>(namespace)) if (row.value.status === 'processing') this.#update(row.value.request.id,
      { status: 'uncertain', diagnosis: 'Rescue pointer operation interrupted; inspect the retained host decision before any new request' });
  }
  records(): RescueRotationRecord[] { return this.options.store.list<RescueRotationRecord>(namespace).map(row => row.value); }
  #update(id: string, patch: Partial<RescueRotationRecord>): void { const row = this.options.store.get<RescueRotationRecord>(namespace, id); invariant(row, 'Missing rescue request'); this.options.store.put(namespace, id, { ...row.value, ...patch }, row.revision); }
  #validate(request: RescueRotationRequest): void {
    const author = boundAuthor(this.options.store, request); this.options.authority.assert(request.authority);
    if (author.status === 'running') throw new ProducerActive('Rescue requester has resumed a physical slice');
    const state = this.options.status();
    invariant(state.phase === 'accepted' && identity(state.accepted) === identity(request.selected) && identity(state.active) === identity(request.selected) &&
      identity({ generation: state.authority.generation, epoch: state.authority.epoch, controlRevision: state.authority.controlRevision }) === identity(request.authority) &&
      state.authority.artifactId === request.selected.candidateId, 'Rescue request must bind the current accepted serving candidate');
  }
  #ack(record: RescueRotationRecord): { effect: Effect; physical: PhysicalRequest; elapsedMs: number } | undefined {
    const { store } = this.options, ack = record.acknowledgment;
    if (!ack) return undefined;
    const effect = store.get<Effect>('effects', ack.effectId)?.value, reservation = effect?.reservationId ? store.get<{ request: PhysicalRequest; ceiling: { elapsedMs: number }; charged: { elapsedMs: number } }>('requests', effect.reservationId)?.value : undefined;
    invariant(effect && effect.id === ack.effectId && effect.id.startsWith('tool:') && effect.kind === 'rescue_rotate' && effect.runId === record.request.runId &&
      identity(effect.payload) === identity(ack.payload) && identity(effect.scope) === identity(record.request.scope) && identity(effect.authority) === identity(ack.authority) &&
      identity(ack.authority) === identity(record.request.authority) && ack.payload && typeof ack.payload === 'object' && !Array.isArray(ack.payload) && ack.payload.candidateId === record.request.selected.candidateId,
      'Exact local rescue effect required');
    invariant(reservation && reservation.request.id === effect.id && reservation.request.reservationId === effect.reservationId && reservation.request.runId === effect.runId &&
      reservation.request.provider === 'effect-receiver' && reservation.request.purpose === 'reasoning' && reservation.request.model === effect.kind && reservation.request.promptManifestId === effect.id &&
      reservation.request.requestDigest === identity({ id: effect.id.slice(5), runId: effect.runId, stepId: effect.stepId, name: effect.kind, arguments: effect.payload }), 'Exact local rescue receiver required');
    const receipt = store.readJsonArtifact<{ requestId: string; selected: ReleaseTarget }>(ack.receipt);
    invariant(receipt.requestId === record.request.id && identity(receipt.selected) === identity(record.request.selected), 'Exact committed rescue acknowledgment required');
    if (effect.status === 'succeeded') invariant(effect.receipt && identity(store.readJsonArtifact(effect.receipt)) === identity(receipt), 'Successful rescue acknowledgment changed');
    return { effect, physical: reservation.request, elapsedMs: Math.max(reservation.request.usage.elapsedMs, reservation.ceiling.elapsedMs, reservation.charged.elapsedMs) };
  }
  #reconcileAcknowledgment(record: RescueRotationRecord): void {
    const { store, authority } = this.options;
    // Do not race the live bridge's own settlement after it has committed effect success.
    if (store.get<Run>('runs', record.request.runId)?.value.status === 'running') return;
    const state = authority.current(); if (!state?.generation) return;
    const serving: Authority = { generation: state.generation, epoch: state.epoch, controlRevision: state.controlRevision };
    authority.dispatch(serving, () => store.transaction(() => {
      if (store.get<Run>('runs', record.request.runId)?.value.status === 'running') return;
      const ack = this.#ack(record); if (!ack || !['uncertain', 'succeeded'].includes(ack.effect.status)) return;
      if (['dispatched', 'uncertain'].includes(ack.physical.status)) {
        if (ack.effect.status === 'uncertain') {
          const effects = new EffectJournal(store, authority, { async dispatch() { throw Error('Local reconciliation never dispatches'); }, async reconcile() { throw Error('Committed local receipt only'); } });
          effects.recordReconciliation(ack.effect.id, serving, 'succeeded', record.acknowledgment!.receipt);
        }
        new ResourceLedger(store, { tokens: 0, costUsd: 0, elapsedMs: 0 }).settle({ ...ack.physical, status: 'succeeded', usage: { ...ack.physical.usage, elapsedMs: ack.elapsedMs } });
        store.append({ id: `local-rescue-reconciled:${ack.effect.id}`, stream: record.request.runId, type: 'local-rescue-reconciled', data: { effectId: ack.effect.id, requestId: record.request.id, elapsedMs: ack.elapsedMs, externalReviewRetried: false } });
      }
      const after = this.#ack(record), row = store.get<{ requestId: string; acknowledgment: RotationAcknowledgment; settled: boolean }>(acknowledgments, record.acknowledgment!.effectId);
      if (row && after?.effect.status === 'succeeded' && after.physical.status === 'succeeded') store.put(acknowledgments, row.value.acknowledgment.effectId, { ...row.value, settled: true }, row.revision);
    }));
  }
  #reconcileAcknowledgments(): void {
    for (const row of this.options.store.list<{ requestId: string; acknowledgment: RotationAcknowledgment; settled: boolean }>(acknowledgments).filter(row => !row.value.settled).slice(0, 32)) {
      const record = this.options.store.get<RescueRotationRecord>(namespace, row.value.requestId)?.value;
      // Malformed receipt records stay unresolved; they never free another physical slot.
      if (record) try { this.#reconcileAcknowledgment({ ...record, acknowledgment: row.value.acknowledgment }); } catch { /* original activation validation preserves rejection separately */ }
    }
  }
  #acknowledged(record: RescueRotationRecord): boolean {
    this.#reconcileAcknowledgment(record);
    const ack = this.#ack(record);
    return (!record.acknowledgment || !!ack && ack.effect.status === 'succeeded' && ack.physical.status === 'succeeded') && this.options.store.get<Run>('runs', record.request.runId)?.value.status !== 'running';
  }
  async processPending(): Promise<void> {
    if (this.#processing || this.#abort.signal.aborted || !this.options.ready()) return;
    this.#reconcileAcknowledgments();
    const record = this.records().find(value => value.status === 'pending'); if (!record) return;
    this.#processing = true; let entered = false;
    try {
      // Accounting may recover a known old local receipt, but does not revive its author.
      if (!this.#acknowledged(record)) return;
      this.#validate(record.request); invariant(this.options.rotate, 'Installed bootstrap rescue rotation is unavailable');
      this.#update(record.request.id, { status: 'processing' });
      // No outer AuthorityStore.dispatch here: the existing callback opens its own ledger
      // and holds the publication/authority locks BEFORE acquiring operational locks.
      this.options.rotate(record.request, apply => this.options.store.transaction(() => {
        this.#abort.signal.throwIfAborted(); this.#validate(record.request); entered = true; apply();
        const decision = this.options.store.putJsonArtifact({ requestId: record.request.id, selected: { ...record.request.selected }, authority: { ...record.request.authority }, outcome: 'rotated', retainedPreviousSnapshots: true });
        this.#update(record.request.id, { status: 'completed', decision });
      }));
      invariant(this.options.store.get<RescueRotationRecord>(namespace, record.request.id)?.value.status === 'completed', 'Rescue callback omitted its exact durable decision');
    } catch (cause) {
      if (cause instanceof ProducerActive && !entered) this.#update(record.request.id, { status: 'pending' });
      else if (this.options.store.get<RescueRotationRecord>(namespace, record.request.id)?.value.status !== 'completed') this.#update(record.request.id,
        { status: entered ? 'uncertain' : 'rejected', failure: this.options.store.putJsonArtifact({ requestId: record.request.id, selected: { ...record.request.selected }, pointerEntered: entered, cause: cause instanceof Error ? cause.message : String(cause) }), diagnosis: entered ? 'Rescue pointer outcome unresolved; inspect retained host decision and snapshots before retry' : 'Rescue rotation rejected: current authority, audience, remaining allowance, accepted target or boot readiness did not satisfy host guards' });
    } finally { this.#processing = false; }
  }
  start(): void { invariant(!this.#loop, 'Rescue processor already started'); this.#loop = (async () => { while (!this.#abort.signal.aborted) {
    await this.processPending(); if (!this.#abort.signal.aborted) await new Promise<void>(resolve => { const done = () => { clearTimeout(timer); this.#abort.signal.removeEventListener('abort', done); resolve(); }; const timer = setTimeout(done, 50); this.#abort.signal.addEventListener('abort', done, { once: true }); });
  } })(); }
  async close(): Promise<void> { this.#abort.abort(); await this.#loop; }
}
