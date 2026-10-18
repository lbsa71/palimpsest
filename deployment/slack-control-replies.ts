import { identity, invariant, scopeAllows, type DataScope, type Effect, type InboundInput, type Run } from '../packages/contracts/index.ts';
import { inputIdentity } from '../packages/contracts/execution/index.ts';
import { OperationalStore } from '../packages/storage/index.ts';

export interface SlackControlTarget { channel: string; threadTs: string; transport: 'slack'; scope: DataScope }
export type SlackControlDiagnosis = 'slice-limit' | 'time-limit' | 'capacity-wait' | 'uncertain-effect' | 'coding-running' | 'budget-held'
  | 'model-step' | 'tool-step' | 'recovery-step' | 'compaction-step';
export interface SlackControlReply {
  id: string; inputId: string; runId: string; control: 'status' | 'cancel'; runStatus: Run['status']; runRevision: number;
  target: SlackControlTarget;
  payload: { channel: string; threadTs: string; kind: 'message'; text: string };
}
export interface SlackControlReplyOptions {
  store: OperationalStore; teamId: string; botUserId: string;
  /** Trusted accounting identity used by the deterministic host speech receiver. */
  accountingRunId?: string;
  getRun(id: string): Run | undefined;
  targetForRun(id: string): SlackControlTarget | undefined;
  getEffect(id: string): Effect | undefined;
  /** Fixed host classifications only; provider diagnostics are never reply text. */
  diagnose?(run: Run): SlackControlDiagnosis | undefined;
}
interface ControlRecord {
  input: InboundInput; runId: string; conversation: string; operation: string;
  controlResult?: { status: Run['status']; revision: number };
}
const namespace = 'host.slack-control-replies';
const descriptions: Record<Run['status'], string> = {
  ready: 'queued', running: 'running', waiting: 'waiting', blocked: 'blocked', completed: 'completed', cancelled: 'cancelled',
};
const reasons: Record<SlackControlDiagnosis, string> = {
  'slice-limit': 'The finite model request allowance for that execution slice was reached.',
  'time-limit': 'The execution time limit was reached.',
  'capacity-wait': 'It was waiting for execution capacity.',
  'uncertain-effect': 'An earlier action needs its outcome confirmed before work can continue.',
  'coding-running': 'The external coding session was still working.',
  'budget-held': 'The host resource allowance was holding further execution.',
  'model-step': 'It stopped at a model request.', 'tool-step': 'It stopped at a tool action.',
  'recovery-step': 'It stopped while restoring its checkpoint.', 'compaction-step': 'It stopped during context compaction.',
};

/** Planning is durable and local. The host owns the ordinary accounted speech
 * dispatch/reconciliation path; this helper never invokes inference or Slack. */
export class SlackControlReplies {
  private readonly options: SlackControlReplyOptions;
  constructor(options: SlackControlReplyOptions) {
    invariant(options.teamId.trim() && options.botUserId.trim(), 'Slack control installation required');
    this.options = { ...options };
  }
  prepare(limit = 8): SlackControlReply[] {
    invariant(Number.isSafeInteger(limit) && limit > 0 && limit <= 64, 'Finite Slack control reply limit required');
    const { store, getRun, targetForRun, teamId, botUserId } = this.options;
    const result: SlackControlReply[] = [], reconciliation: SlackControlReply[] = [];
    const records = store.list<ControlRecord>('communications.inputs').filter(row => row.value.controlResult)
      .sort((a, b) => Number(a.value.input.externalRevision) - Number(b.value.input.externalRevision) || a.key.localeCompare(b.key));
    for (const row of records) {
      const record = row.value, input = record.input, snapshot = record.controlResult!;
      if (!input.authenticated || input.source !== `slack:${teamId}` || input.id !== row.key || inputIdentity(input) !== input.id) continue;
      let operation: { control?: unknown; targetRunId?: unknown };
      try { operation = JSON.parse(record.operation) as typeof operation; } catch { continue; }
      if (!operation || !['status', 'cancel'].includes(String(operation.control)) || typeof input.value !== 'string') continue;
      const control = operation.control as 'status' | 'cancel';
      if (input.value.replaceAll(`<@${botUserId}>`, '').trim() !== control) continue;
      if (!Object.hasOwn(descriptions, snapshot.status) || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) continue;
      if (control === 'cancel' && !['completed', 'cancelled'].includes(snapshot.status)) continue;
      const parts = record.conversation.split(':');
      if (parts.length !== 4 || parts[0] !== 'slack' || parts[1] !== teamId || !parts[2] || !/^\d+(?:\.\d+)?$/.test(parts[3]!)) continue;
      const [channel, threadTs] = parts.slice(2) as [string, string];
      if (!input.externalId.startsWith(`${channel}:`) || !/^\d+(?:\.\d+)?$/.test(input.externalId.slice(channel.length + 1))) continue;
      const run = getRun(record.runId), target = targetForRun(record.runId);
      if (!run || !target || target.transport !== 'slack' || target.channel !== channel || target.threadTs !== threadTs
        || !scopeAllows(run.scope, target.scope) || !scopeAllows(input.scope, target.scope)) continue;
      const id = `host:slack-control:${input.id}`;
      const saved = store.get<SlackControlReply>(namespace, id);
      let plan: SlackControlReply;
      if (saved) {
        plan = saved.value;
        invariant(plan.inputId === input.id && plan.runId === run.id && plan.control === control && plan.runStatus === snapshot.status
          && plan.runRevision === snapshot.revision && identity(plan.target) === identity(target), 'Slack control reply binding changed');
      } else {
        let text = control === 'cancel'
          ? snapshot.status === 'completed' ? '[Host status] This conversation had already completed; nothing was cancelled.' : '[Host status] Cancellation recorded. This conversation is cancelled.'
          : `[Host status] At this status check, this conversation was ${descriptions[snapshot.status]}.`;
        if (control === 'status' && run.revision === snapshot.revision && run.status === snapshot.status) {
          let diagnosis: SlackControlDiagnosis | undefined;
          try { diagnosis = this.options.diagnose?.(run); } catch { /* Status itself remains available without optional diagnostics. */ }
          if (diagnosis !== undefined && Object.hasOwn(reasons, diagnosis)) text += ` ${reasons[diagnosis]}`;
        }
        plan = { id, inputId: input.id, runId: run.id, control, runStatus: snapshot.status, runRevision: snapshot.revision,
          target: structuredClone(target), payload: { channel, threadTs, kind: 'message', text } };
        store.put(namespace, id, plan, null);
      }
      const action = this.nextAction(plan);
      if (action === 'dispatch') result.push(structuredClone(plan));
      else if (action === 'reconcile' && reconciliation.length < limit) reconciliation.push(structuredClone(plan));
      if (result.length === limit) break;
    }
    // Historical uncertain sends must not fill the window and silence newer
    // commands. Their bounded reconciliation remains separate from resending.
    return [...result, ...reconciliation].slice(0, limit);
  }
  nextAction(plan: SlackControlReply): 'dispatch' | 'reconcile' | undefined {
    const retained = this.options.store.get<SlackControlReply>(namespace, plan.id)?.value;
    invariant(retained && identity(retained) === identity(plan), 'Slack control reply was not prepared by the host');
    const effect = this.options.getEffect(plan.id);
    if (!effect) return 'dispatch';
    invariant(effect.runId === (this.options.accountingRunId ?? plan.runId) && effect.kind === 'speech_send' && identity(effect.payload) === identity(plan.payload)
      && identity(effect.scope) === identity(plan.target.scope), 'Slack control reply effect changed');
    if (effect.status === 'pending' || effect.status === 'authorized') return 'dispatch';
    if (effect.status === 'uncertain') return 'reconcile';
    return undefined;
  }
}
