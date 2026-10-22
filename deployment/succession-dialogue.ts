import { canonicalJson, identity, invariant, validateArtifact, type ArtifactRef, type Authority, type DataScope, type JsonValue } from '../packages/contracts/index.ts';
import type { OperationalStore } from '../packages/storage/index.ts';
import type { GenerationEvent, GenerationRole } from './generation-mind.ts';

export interface SuccessionBinding {
  id: string; runId: string; stageId: string; incumbentId: string; candidateId: string; policyDigest: string;
  authority: Authority; scope: DataScope; context: ArtifactRef; objective: string; criteria: string[];
}
export interface DialogueTurn {
  id: string; role: GenerationRole; phase: 'challenge' | 'answer' | 'counter-answer' | 'verdict' | 'ready' | 'observe';
  message: JsonValue; status: 'dispatched' | 'completed'; event?: GenerationEvent; evidence?: ArtifactRef;
}
export interface DialogueRecord {
  binding: SuccessionBinding; phase: 'interviewing' | 'approved' | 'observing' | 'observed' | 'rejected' | 'uncertain' | 'retired';
  turns: DialogueTurn[]; approval?: ArtifactRef; readiness?: ArtifactRef; probationQuestion?: string;
  observation?: ArtifactRef; diagnosis?: string;
}
export interface SuccessionDialoguePorts {
  store: OperationalStore;
  /** Checks authenticated operation/role/scope/candidate and current physical authority. */
  assertBinding(binding: SuccessionBinding, phase: 'interview' | 'observe' | 'retire'): void;
  /** Executes exact frozen cognition; keeps the SAME incumbent checkpoint for observer calls. */
  turn(binding: SuccessionBinding, turn: DialogueTurn, signal?: AbortSignal): Promise<{ event: GenerationEvent; evidence: ArtifactRef }>;
  /** Host-issued observation from the REAL serving successor, including its concrete response. */
  probe(binding: SuccessionBinding, question: string, signal?: AbortSignal): Promise<ArtifactRef>;
}
const ns = 'host.succession-dialogues';
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;
const text = (value: unknown): string => { invariant(typeof value === 'string' && value.trim().length > 0 && value.length <= 8192, 'Bounded substantive succession text required'); return value; };
const object = (value: JsonValue): Record<string, JsonValue> => { invariant(value && typeof value === 'object' && !Array.isArray(value), 'Succession reply must be an object'); return value; };
/** Cognitive decisions belong to the two minds. This host mediator authenticates and records
 * their actual exchange; it never supplies a verdict or readiness on either mind's behalf. */
export class SuccessionDialogue {
  readonly ports: SuccessionDialoguePorts;
  constructor(ports: SuccessionDialoguePorts) { this.ports = Object.freeze({ ...ports }); }
  status(id: string): DialogueRecord | undefined { return this.ports.store.get<DialogueRecord>(ns, id)?.value; }
  private update(id: string, patch: Partial<DialogueRecord>): DialogueRecord {
    const row = this.ports.store.get<DialogueRecord>(ns, id); invariant(row, 'Missing succession dialogue');
    const next = { ...row.value, ...patch }; this.ports.store.put(ns, id, next, row.revision); return next;
  }
  private async call(binding: SuccessionBinding, role: GenerationRole, phase: DialogueTurn['phase'], message: unknown, kind: GenerationEvent['kind'][], signal?: AbortSignal) {
    this.ports.assertBinding(binding, role === 'observer' ? 'observe' : 'interview'); signal?.throwIfAborted();
    const record = this.status(binding.id)!;
    invariant(identity(record.binding) === identity(binding) && !record.turns.some(turn => turn.status === 'dispatched'), 'Unresolved succession turn cannot be retried');
    const turn: DialogueTurn = { id: `succession-turn:${identity({ id: binding.id, ordinal: record.turns.length, role, phase })}`, role, phase, message: JSON.parse(JSON.stringify(message)) as JsonValue, status: 'dispatched' };
    this.update(binding.id, { turns: [...record.turns, turn] });
    const result = await this.ports.turn(binding, turn, signal);
    this.ports.assertBinding(binding, role === 'observer' ? 'observe' : 'interview'); signal?.throwIfAborted();
    invariant(kind.includes(result.event.kind), 'Wrong succession role/phase response'); validateArtifact(result.evidence);
    invariant(Buffer.byteLength(canonicalJson(result.event)) <= 16384, 'Succession reply exceeds its bound');
    const witness = this.ports.store.readJsonArtifact<Record<string, JsonValue>>(result.evidence);
    invariant(witness.bindingDigest === identity(binding) && witness.turnId === turn.id && witness.role === role &&
      witness.candidateId === (role === 'successor' ? binding.candidateId : binding.incumbentId) && identity(witness.event!) === identity(result.event), 'Actual generation witness differs from the authenticated dialogue');
    const latest = this.status(binding.id)!;
    invariant(latest.turns.at(-1)?.id === turn.id && latest.turns.at(-1)?.status === 'dispatched', 'Succession turn changed during execution');
    this.update(binding.id, { turns: [...latest.turns.slice(0, -1), { ...turn, status: 'completed', ...result }] });
    return result;
  }
  async interview(binding: SuccessionBinding, signal?: AbortSignal): Promise<ArtifactRef> {
    this.ports.assertBinding(binding, 'interview'); validateArtifact(binding.context);
    invariant(binding.incumbentId !== binding.candidateId && binding.criteria.length > 0, 'Distinct exact successor and criteria required');
    const previous = this.status(binding.id);
    if (previous) {
      invariant(identity(previous.binding) === identity(binding), 'Succession identity reused');
      if (previous.approval && ['approved', 'observing', 'observed', 'retired'].includes(previous.phase)) return previous.approval;
      throw new Error('Interrupted or rejected interview requires explicit reconciliation; no automatic model retry');
    }
    this.ports.store.put(ns, binding.id, { binding, phase: 'interviewing', turns: [] } satisfies DialogueRecord, null);
    try {
      const verdicts: { dimension: string; criterion: string; evidence: ArtifactRef }[] = [];
      let probationQuestion = '';
      for (const dimension of ['continuity', 'improvement'] as const) {
        const criteria = dimension === 'continuity' ? ['continuity of current authorized memory and commitments'] : binding.criteria;
        const challenge = await this.call(binding, 'incumbent', 'challenge', { dimension, objective: binding.objective, criteria, continuity: binding.context,
          instruction: 'Choose a substantive challenge for this dimension and exact successor. Submit kind challenge/content {question, criterion}; criterion must exactly match one supplied criterion. Assess actual evidence, not a yes/ready answer.' }, ['challenge'], signal);
        let question = text(object(challenge.event.content).question); const criterion = text(object(challenge.event.content).criterion);
        invariant(criteria.includes(criterion), 'Incumbent challenge must address the required dimension criterion');
        let accepted = false;
        for (let round = 0; round < 3; round++) {
          let answer = await this.call(binding, 'successor', 'answer', { dimension, criterion, question, round, continuity: binding.context,
            instruction: 'Answer from actual supplied evidence using kind answer/content {answer,evidence:[the continuity reference]}; distinguish unsupported capability. You may instead ask one counterquestion using kind counterquestion/content {question}.' }, ['answer', 'counterquestion'], signal);
          if (answer.event.kind === 'counterquestion') {
            const counter = text(object(answer.event.content).question);
            const response = await this.call(binding, 'incumbent', 'counter-answer', { question: counter, instruction: 'Address the successor question honestly. Submit kind answer/content {answer}.' }, ['answer'], signal);
            text(object(response.event.content).answer);
            answer = await this.call(binding, 'successor', 'answer', { question, clarification: response.event.content, continuity: binding.context,
              instruction: 'Now submit kind answer/content {answer,evidence:[the continuity reference]} grounded in available evidence. No further counterquestion this round.' }, ['answer'], signal);
          }
          const answerContent = object(answer.event.content); text(answerContent.answer);
          invariant(Array.isArray(answerContent.evidence) && answerContent.evidence.some(ref => identity(ref) === identity(binding.context)), 'Successor must cite its authenticated continuity evidence');
          const verdict = await this.call(binding, 'incumbent', 'verdict', { dimension, criterion, question, answer: answer.event.content, answerEvidence: answer.evidence,
            instruction: 'Assess the actual successor answer and practical evidence for this dimension. Submit kind verdict/content {decision:accept|reject|more, reason, question}. For accept, question is your practical follow-up for the REAL serving successor during probation; for more it is your next challenge. Do not accept unavailable or merely asserted capability. No reviewer/host supplies your verdict.' }, ['verdict'], signal);
          const decision = object(verdict.event.content); text(decision.reason);
          invariant(['accept', 'reject', 'more'].includes(String(decision.decision)), 'Explicit incumbent verdict required');
          if (decision.decision === 'reject') { this.update(binding.id, { phase: 'rejected', diagnosis: text(decision.reason) }); throw new Error('Incumbent rejected successor'); }
          question = text(decision.question);
          if (decision.decision === 'more') continue;
          verdicts.push({ dimension, criterion, evidence: verdict.evidence }); probationQuestion = question; accepted = true; break;
        }
        if (!accepted) { this.update(binding.id, { phase: 'rejected', diagnosis: 'Required interview dimension remains inconclusive after three rounds' }); throw new Error('Interview inconclusive; incumbent remains serving'); }
      }
      const ready = await this.call(binding, 'successor', 'ready', { verdicts, continuity: binding.context,
        instruction: 'Both incumbent dimension verdicts passed. Acknowledge or decline readiness for this exact candidate/current-history handover. Submit kind ready/content {ready:boolean,reason}. This reply grants no production authority.' }, ['ready'], signal);
      const readiness = object(ready.event.content); text(readiness.reason);
      if (readiness.ready !== true) { this.update(binding.id, { phase: 'rejected', diagnosis: 'Successor declined readiness' }); throw new Error('Successor is not ready'); }
      const approval = this.ports.store.putJsonArtifact(json({ candidateId: binding.candidateId, policyDigest: binding.policyDigest, incumbentId: binding.incumbentId,
        bindingDigest: identity(binding), incumbentAccepted: true, successorReady: true, verdicts, readiness: ready.evidence,
        transcriptDigest: identity(this.status(binding.id)!.turns), context: binding.context }));
      this.update(binding.id, { phase: 'approved', approval, readiness: ready.evidence, probationQuestion }); return approval;
    } catch (error) {
      const current = this.status(binding.id)!;
      if (current.phase === 'interviewing') this.update(binding.id, { phase: 'uncertain', diagnosis: 'Generation exchange incomplete; retain original requests and explicitly reconcile before any retry' });
      throw error;
    }
  }
  assertApproved(binding: SuccessionBinding): void {
    this.ports.assertBinding(binding, 'interview');
    const record = this.status(binding.id);
    invariant(record && identity(record.binding) === identity(binding) && record.phase === 'approved' && record.approval && record.readiness && record.probationQuestion &&
      record.turns.every(turn => turn.status === 'completed'), 'Exact incumbent verdict and successor readiness required before cutover');
    const receipt = this.ports.store.readJsonArtifact<Record<string, JsonValue>>(record.approval);
    invariant(Array.isArray(receipt.verdicts) && receipt.verdicts.length === 2 && (receipt.verdicts[0] as Record<string, JsonValue>).dimension === 'continuity' && (receipt.verdicts[1] as Record<string, JsonValue>).dimension === 'improvement', 'Both independent incumbent dimension judgments required');
    invariant(receipt.bindingDigest === identity(binding) && receipt.incumbentAccepted === true && receipt.successorReady === true && receipt.transcriptDigest === identity(record.turns), 'Succession approval witness changed');
  }
  async observe(binding: SuccessionBinding, signal?: AbortSignal): Promise<'accept' | 'regression' | 'inconclusive'> {
    this.ports.assertBinding(binding, 'observe'); const record = this.status(binding.id);
    invariant(record?.phase === 'approved' && identity(record.binding) === identity(binding) && record.probationQuestion, 'Exact approved observer context required');
    this.update(binding.id, { phase: 'observing' });
    try {
      const probe = await this.ports.probe(binding, record.probationQuestion, signal); validateArtifact(probe);
      const witnessed = this.ports.store.readJsonArtifact<Record<string, JsonValue>>(probe);
      invariant(witnessed.bindingDigest === identity(binding) && witnessed.candidateId === binding.candidateId && witnessed.serving === true && witnessed.response !== undefined && witnessed.authority !== undefined, 'Actual serving successor observation required');
      const result = await this.call(binding, 'observer', 'observe', { question: record.probationQuestion, observation: witnessed, evidence: probe,
        instruction: 'Continue your SAME incumbent context as an observer, without production authority. Inspect the actual serving successor observation. Submit kind verdict/content {decision:accept|regression|inconclusive, reason, evidence:[the supplied observation reference]}. Regression requires concrete evidence; transport/provider failure alone is inconclusive.' }, ['verdict', 'regression'], signal);
      const content = object(result.event.content); text(content.reason);
      invariant(['accept', 'regression', 'inconclusive'].includes(String(content.decision)) && Array.isArray(content.evidence) && content.evidence.some(ref => identity(ref) === identity(probe)), 'Observer verdict must cite the actual successor observation');
      const decision = content.decision as 'accept' | 'regression' | 'inconclusive';
      invariant(result.event.kind !== 'regression' || decision === 'regression', 'Contradictory observer regression event');
      this.update(binding.id, { phase: decision === 'accept' ? 'observed' : decision === 'regression' ? 'rejected' : 'uncertain', observation: result.evidence, ...(decision === 'accept' ? {} : { diagnosis: text(content.reason) }) });
      return decision;
    } catch (error) { this.update(binding.id, { phase: 'uncertain', diagnosis: 'Observer evidence unavailable; no automatic acceptance or model retry' }); throw error; }
  }
  /** Revalidate the exact observed decision and all exposed context under the final
   * authority/operational acceptance locks, before the controller commits. */
  assertObserved(binding: SuccessionBinding): void {
    this.ports.assertBinding(binding, 'observe'); const record = this.status(binding.id), turn = record?.turns.at(-1);
    invariant(record?.phase === 'observed' && identity(record.binding) === identity(binding) && record.observation && record.approval &&
      turn?.role === 'observer' && turn.phase === 'observe' && turn.status === 'completed' && turn.evidence && turn.event &&
      identity(turn.evidence) === identity(record.observation), 'Exact completed incumbent observation required for final acceptance');
    const observed = this.ports.store.readJsonArtifact<Record<string, JsonValue>>(record.observation);
    invariant(observed.bindingDigest === identity(binding) && observed.turnId === turn.id && observed.role === 'observer' &&
      observed.candidateId === binding.incumbentId && identity(observed.event!) === identity(turn.event) &&
      turn.event.kind === 'verdict' && object(turn.event.content).decision === 'accept', 'Incumbent acceptance observation changed');
    const approval = this.ports.store.readJsonArtifact<Record<string, JsonValue>>(record.approval);
    invariant(approval.bindingDigest === identity(binding) && approval.incumbentAccepted === true && approval.successorReady === true &&
      approval.transcriptDigest === identity(record.turns.slice(0, -1)), 'Original succession approval changed during probation');
  }
  retire(binding: SuccessionBinding): void {
    this.ports.assertBinding(binding, 'retire'); const record = this.status(binding.id);
    invariant(record?.phase === 'observed' && identity(record.binding) === identity(binding) && record.observation, 'Observer cannot retire before actual probation observation and verdict');
    this.update(binding.id, { phase: 'retired' });
  }
}
