import { codingDecisionSchema, parseConversationDecision } from './conversation-actions.ts';
import { parseGrowthReflection, reflectionSchema, type GrowthCoding } from './growth.ts';
import type { CompletionRequest } from './providers.ts';
import type { RuntimeCoding } from './runtime.ts';
import type { CodingSessionCoordinator } from './coding-session.ts';
import type { CodingSession } from './coding-state.ts';
import type { CodingArtifacts, CodingSubmissionReceipt } from './coding-artifacts.ts';
import { Store, type Growth, type Json, type Task } from './store.ts';
import { createHash } from 'node:crypto';

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const json = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;
const route = (task: Task) => ({ source: task.source, scope: task.conversationId, slackAuthor: task.slackAuthor ?? null,
  replyTo: typeof object(task.checkpoint).replyTo === 'string' ? object(task.checkpoint).replyTo as string : null });
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const revokedDisposition = 'Coding execution ended; its draft is retained. Execution authority is unavailable. No release acceptance is claimed.';
interface ReportBinding {
  version: 'coding-report/1'; sessionId: string; reportTaskId: string; originTaskId: string;
  originRoute: ReturnType<typeof route>; reportRoute: ReturnType<typeof route>; textDigest: string;
  requiresSourceAuthority: boolean; topics: { id: string; revision: number }[];
  sourceRefs: { id: string; version: number }[]; sourceTaskIds: string[];
}
interface Options {
  store: Store;
  coordinator: () => CodingSessionCoordinator;
  artifacts: () => CodingArtifacts;
  available: (task: Task) => boolean;
  authorizeOrigin: (task: Task) => boolean;
  /** Trusted current conversation delivery policy, separate from execution
   * eligibility. It cannot replace the durable original route or authors. */
  authorizeReport?: (origin: Task, report: Task) => boolean;
  authorizeGrowth?: (growth: Growth) => boolean;
  growthAvailable?: (growth: Growth) => boolean;
  authorizeSubmission: (task: Task, receipt: CodingSubmissionReceipt) => void;
  now?: () => number;
}

/** The conversation selects work, while the detached coordinator owns its
 * lifetime. Every acknowledgment, admission disposition and owed report is a
 * durable fact; a callback or model sentence is never release evidence. */
export class CodingServing implements RuntimeCoding {
  readonly #options: Options;
  constructor(options: Options) { this.#options = options; }
  eligible(task: Task): boolean {
    return ['direct', 'slack'].includes(task.source) && !task.conversationId.startsWith('peer:')
      && this.#options.authorizeOrigin(task) && this.#options.available(task);
  }
  prepare(task: Task, request: CompletionRequest): CompletionRequest {
    if (!this.eligible(task)) throw new Error('Coding request authority unavailable');
    return { ...request, schema: structuredClone(codingDecisionSchema), system: request.system +
      '\nIterative coding protocol: choose disposition code with proposal null and coding {objective} only for repository work worth carrying out. The host admits a finite durable coding session, imports verified admitted source, and provides real file, diff, test and submission tools in subsequent steps. Those later receipts establish execution; this decision does not edit or test anything. Authoring may cover the whole source tree. Cognitive proposals still use their existing checks/review/succession route; broader drafts await supported admission. Do not demand routine plan acceptance, invent permission, assert a release or claim tests ran from this decision. Ordinary conversation keeps its other disposition and omits coding.' };
  }
  async accept(task: Task, raw: string): Promise<string | undefined> {
    const { value } = parseConversationDecision(raw);
    if (value.disposition !== 'code') return;
    if (!this.eligible(task)) throw new Error('Coding admission authority unavailable');
    const unavailableReply = 'Coding is unavailable: the admitted source, finite policy or provider could not be established. No coding session was queued.';
    const store = this.#options.store;
    if (store.listEvents({ taskId: task.id }).some(event => event.type === 'coding.admission.unavailable')) {
      this.#unavailable(task, value.coding!.objective, unavailableReply); return unavailableReply;
    }
    let session: CodingSession;
    try { session = await this.#options.coordinator().admitTask(task, value.coding!.objective); }
    catch (error) {
      const current = store.task(task.id);
      if (!current || current.state !== 'running' || !this.eligible(current) || object(error).code === 'interrupted') throw error;
      this.#unavailable(current, value.coding!.objective, unavailableReply);
      return unavailableReply;
    }
    if (!this.eligible(this.#options.store.task(task.id)!)) throw new Error('Coding admission authority changed');
    this.#oweReport(session, task);
    if (session.state === 'terminal') return `Coding session ${session.id} could not start: ${session.reason ?? session.phase}. Its disposition is retained.`;
    return `Coding session ${session.id} is durably queued. I will return the observed outcome here. No release has completed.`;
  }
  #unavailable(task: Task, objective: string, reply: string): void {
    const store = this.#options.store, sessionId = `coding-admission:${task.id}`;
    store.transaction(() => {
      if (!store.listEvents({ taskId: task.id }).some(event => event.type === 'coding.admission.unavailable'))
        store.appendEvent('coding.admission.unavailable', { objective, disposition: 'source_contract_or_provider_unavailable' }, task.id);
      this.#recordReportObligation(sessionId, null, task);
      if (!store.listEvents({ taskId: task.id }).some(event => event.type === 'coding.serving.outcome' && object(event.payload).sessionId === sessionId))
        store.appendEvent('coding.serving.outcome', { sessionId, contractDigest: null, originTaskId: task.id, summary: reply, submissionId: null }, task.id);
    });
  }
  #oweReport(session: CodingSession, origin: Task): void {
    this.#recordReportObligation(session.id, session.contractDigest, origin);
  }
  #recordReportObligation(sessionId: string, contractDigest: string | null, origin: Task): void {
    const store = this.#options.store;
    store.transaction(() => {
      if (store.listEvents().some(event => event.type === 'coding.report.owed' && object(event.payload).sessionId === sessionId)) return;
      const prepared = store.listEvents({ taskId: origin.id }).find(event => event.type === 'conversation.outcomes.prepared');
      const topicIds = Array.isArray(object(prepared?.payload).topicIds) ? object(prepared?.payload).topicIds as string[] : [];
      const refs = object(origin.checkpoint).conversationTopicRefs;
      const topics = topicIds.map(id => ({ id, revision: (Array.isArray(refs) ? refs.find(ref => object(ref).id === id) : undefined)
        ? Number(object((refs as unknown[]).find(ref => object(ref).id === id)).revision) + 1 : store.conversationTopic(id)?.revision ?? 1 }));
      store.appendEvent('coding.report.owed', json({ sessionId, contractDigest, originTaskId: origin.id, topicIds, topics }), origin.id);
    });
  }
  onOutcome = ({ session, originTask, summary }: { session: CodingSession; originTask: Task; summary: string }): void => {
    const store = this.#options.store;
    store.transaction(() => {
      this.#oweReport(session, originTask);
      if (!store.listEvents().some(event => event.type === 'coding.serving.outcome' && object(event.payload).sessionId === session.id)) {
        const submission = object(object(session.data).submission);
        store.appendEvent('coding.serving.outcome', json({ sessionId: session.id, contractDigest: session.contractDigest,
          originTaskId: originTask.id, summary, submissionId: submission.submissionId ?? null }), originTask.id);
      }
    });
  };
  isReport(task: Task): boolean {
    return this.#options.store.listEvents().some(event => event.type === 'coding.report.prepared' && object(event.payload).reportTaskId === task.id
      || event.type === 'coding.serving.report_prepared' && Array.isArray(object(event.payload).reportTaskIds)
        && (object(event.payload).reportTaskIds as unknown[]).includes(task.id));
  }
  /** Pure current-state check: holding a stale report neither clears the owed
   * result nor grants a retry of an uncertain communication effect. */
  reportMaySend(task: Task): boolean {
    const store = this.#options.store;
    const event = store.listEvents({ taskId: task.id }).find(entry => entry.type === 'coding.report.prepared');
    if (!event) return !this.isReport(task); // Older unbound coding reports fail closed.
    const binding = event.payload as unknown as ReportBinding;
    if (binding.version !== 'coding-report/1' || binding.reportTaskId !== task.id || typeof binding.requiresSourceAuthority !== 'boolean'
      || !Array.isArray(binding.topics) || !Array.isArray(binding.sourceRefs) || !Array.isArray(binding.sourceTaskIds)) return false;
    const origin = store.task(binding.originTaskId), current = store.task(task.id);
    if (!origin || !current || !['direct', 'slack'].includes(origin.source) || origin.conversationId.startsWith('peer:')
      || JSON.stringify(route(origin)) !== JSON.stringify(binding.originRoute)
      || JSON.stringify(route(current)) !== JSON.stringify(binding.reportRoute)
      || JSON.stringify(route(task)) !== JSON.stringify(binding.reportRoute)
      || current.source !== origin.source || current.conversationId !== origin.conversationId
      || route(current).replyTo !== route(origin).replyTo
      || origin.source === 'slack' && (!origin.slackAuthor || !current.slackAuthor
        || current.slackAuthor.teamId !== origin.slackAuthor.teamId
        || !origin.conversationId.startsWith(`slack:${origin.slackAuthor.teamId}:`))
      || typeof object(current.checkpoint).answer !== 'string' || typeof object(task.checkpoint).answer !== 'string'
      || digest(object(current.checkpoint).answer as string) !== binding.textDigest
      || digest(object(task.checkpoint).answer as string) !== binding.textDigest
      || !store.taskSourceCurrent(origin.id)) return false;
    try {
      if (this.#options.authorizeReport?.(origin, current) === false) return false;
      for (const ref of binding.topics) {
        const topic = store.conversationTopic(ref.id);
        if (!topic || topic.scope !== origin.conversationId || topic.source !== origin.source || topic.state !== 'active'
          || topic.revision !== ref.revision || topic.report.waived) return false;
      }
      // A fixed host disposition can still report revoked execution. It contains
      // no model/source/artifact description and needs no source-change grant.
      if (!binding.requiresSourceAuthority) return binding.textDigest === digest(revokedDisposition);
      if (this.#options.authorizeOrigin(origin) !== true) return false;
      if (binding.sourceRefs.some(ref => store.memory(ref.id, origin.conversationId)?.version !== ref.version)) return false;
      return binding.sourceTaskIds.every(id => {
        const source = store.task(id);
        return !!source && source.conversationId === origin.conversationId && source.source === origin.source
          && store.taskSourceCurrent(id) && this.#options.authorizeOrigin(source) === true;
      });
    } catch { return false; }
  }
  #bindReport(report: Task, origin: Task, sessionId: string, topicIds: string[], requiresSourceAuthority: boolean): void {
    const store = this.#options.store;
    if (store.listEvents({ taskId: report.id }).some(event => event.type === 'coding.report.prepared')) return;
    const refs = new Map<string, { id: string; version: number }>(), sourceTaskIds = new Set([origin.id]);
    const visit = (ref: { id: string; version: number }): void => {
      if (refs.has(ref.id)) return;
      refs.set(ref.id, { id: ref.id, version: ref.version });
      const memory = store.memory(ref.id, origin.conversationId);
      if (!memory || memory.version !== ref.version) return; // Guard will hold it.
      if (memory.kind === 'episodic' && memory.source.startsWith('task:')) sourceTaskIds.add(memory.source.slice(5));
      store.memorySourceRefs(memory.id, memory.scope).forEach(visit);
    };
    const initial = object(origin.checkpoint).conversationSourceRefs;
    if (Array.isArray(initial)) for (const ref of initial) {
      const value = object(ref); if (typeof value.id === 'string' && Number.isSafeInteger(value.version)) visit({ id: value.id, version: value.version as number });
    }
    store.listMemories(origin.conversationId).filter(memory => memory.kind === 'episodic' && memory.source === `task:${origin.id}`).forEach(visit);
    const topics = topicIds.flatMap(id => {
      const topic = store.conversationTopic(id); if (!topic) return [];
      topic.sourceRefs.forEach(visit); topic.sourceTaskIds.forEach(id => sourceTaskIds.add(id));
      return [{ id, revision: topic.revision }];
    });
    const binding: ReportBinding = { version: 'coding-report/1', sessionId, reportTaskId: report.id, originTaskId: origin.id,
      originRoute: route(origin), reportRoute: route(report), textDigest: digest(String(object(report.checkpoint).answer)),
      requiresSourceAuthority, topics, sourceRefs: [...refs.values()], sourceTaskIds: [...sourceTaskIds] };
    store.appendEvent('coding.report.prepared', json(binding), report.id);
  }
  reconcile(): void {
    const store = this.#options.store;
    for (const event of store.listEvents().filter(event => event.type === 'coding.serving.outcome')) {
      const outcome = object(event.payload), sessionId = String(outcome.sessionId);
      if (store.listEvents().some(entry => entry.type === 'coding.serving.report_prepared' && object(entry.payload).sessionId === sessionId)) continue;
      const origin = store.task(String(outcome.originTaskId));
      if (!origin || ['queued', 'running'].includes(origin.state)) continue;
      const receipt = typeof outcome.submissionId === 'string' ? this.#options.artifacts().submissionReceipt(outcome.submissionId) : undefined;
      let disposition = receipt ? `Draft ${receipt.id}: ${receipt.disposition} (${receipt.reason}).` : 'No immutable code submission was produced.';
      store.transaction(() => {
        if (receipt?.cognitiveBridge && origin.state === 'succeeded') {
          try {
            this.#options.authorizeSubmission(origin, receipt);
            const bridge = receipt.cognitiveBridge;
            const result = parseGrowthReflection(JSON.stringify({ observation: 'A coding workspace produced an immutable submission.',
              lesson: 'The exact draft still requires independent release evaluation.', nextQuestion: 'Evaluate this exact cognitive draft.',
              proposedChange: { summary: String(outcome.summary).slice(0, 2000), rationale: 'Preserve the submitted workspace changes without a lossy source subset.',
                acceptanceCriteria: ['Run all protected release checks and independently evaluate the exact submitted behavior.'], files: bridge.changes } }));
            const body = json({ result, sourceBinding: bridge.sourceBinding, codingSubmission: { id: receipt.id, treeDigest: receipt.treeDigest, contractDigest: outcome.contractDigest } });
            if (origin.source === 'coding-origin') {
              const grant = store.listEvents({ taskId: origin.id }).find(entry => entry.type === 'coding.growth.origin.admitted');
              const growthId = object(grant?.payload).growthId;
              if (typeof growthId !== 'string') throw new Error('Missing independent growth origin');
              const originalGrowth = store.growth(growthId); if (!originalGrowth || originalGrowth.sourceTaskId) throw new Error('Independent growth origin changed');
              const proposalId = `coding-submission:${sessionId}:${receipt.id}`;
              if (!store.growth(proposalId)) {
                store.addGrowth({ id: proposalId, dimension: originalGrowth.dimension, question: origin.input, origin: `coding:${growthId}`, budget: 0 });
                store.updateGrowth(proposalId, { state: 'completed', outcome: body, nextStep: 'Exact cognitive draft awaits existing release admission.' });
              } else if (JSON.stringify(store.growth(proposalId)!.outcome) !== JSON.stringify(body)) throw new Error('Coding submission proposal identity changed');
            } else store.recordConversationProposal(origin.id, body);
            disposition = `Draft ${receipt.id} is recorded in the existing cognitive review queue. No admission or publication is claimed.`;
            store.appendEvent('coding.submission.queued', json({ sessionId, submissionId: receipt.submissionId, submissionDigest: receipt.id }), origin.id);
          } catch {
            disposition = `Draft ${receipt.id} is preserved; current source or origin authority prevents release admission.`;
            store.appendEvent('coding.submission.held', json({ sessionId, submissionId: receipt.submissionId, reason: 'current_source_or_origin_unavailable' }), origin.id);
          }
        }
        let sourceAuthority = false;
        try { sourceAuthority = this.#options.authorizeOrigin(origin) === true; } catch { /* Fixed host disposition only. */ }
        const text = sourceAuthority ? `Host-observed coding outcome for ${sessionId}: ${String(outcome.summary)}\n\n${disposition}` : revokedDisposition;
        const owed = store.listEvents().find(entry => entry.type === 'coding.report.owed' && object(entry.payload).sessionId === sessionId);
        const topics = Array.isArray(object(owed?.payload).topicIds) ? object(owed?.payload).topicIds as string[] : [];
        const bindings = Array.isArray(object(owed?.payload).topics) ? object(owed?.payload).topics as { id: string; revision: number }[] : [];
        const reportTaskIds: string[] = [];
        let progressed = false, waived = false;
        for (const id of topics) {
          const topic = store.conversationTopic(id);
          if (topic?.report.waived) { waived = true; continue; }
          if (topic && (topic.revision !== bindings.find(binding => binding.id === id)?.revision || topic.sourceTaskIds.at(-1) !== origin.id)) { progressed = true; continue; }
          if (!topic || topic.state !== 'active' || !topic.sourceTaskIds.includes(origin.id) || !store.conversationSourcesCurrent(topic)) continue;
          store.reviseConversationOutcome(id, { ...topic.outcome, stance: text.slice(0, 4000), status: 'settled', unresolved: [],
            rationale: 'The host retained the execution and submission disposition; release acceptance remains separate.' }, (this.#options.now ?? Date.now)(), 'coding_outcome');
          const report = store.prepareConversationReport(id, text, 'final', (this.#options.now ?? Date.now)());
          if (report) { this.#bindReport(report, origin, sessionId, [id], sourceAuthority); reportTaskIds.push(report.id); }
        }
        if ((!topics.length || progressed && !reportTaskIds.length) && !waived && store.taskSourceCurrent(origin.id) && origin.source !== 'coding-origin') {
          const report = store.enqueuePreparedReply({ source: origin.source, conversationId: origin.conversationId,
            eventId: `${sessionId}:coding-result`, input: `Host-observed coding session result`, ...(origin.slackAuthor ? { slackAuthor: origin.slackAuthor } : {}) }, text,
          typeof object(origin.checkpoint).replyTo === 'string' ? object(origin.checkpoint).replyTo as string : undefined);
          this.#bindReport(report, origin, sessionId, topics, sourceAuthority);
          reportTaskIds.push(report.id);
        }
        store.appendEvent('coding.serving.report_prepared', json({ sessionId, reportTaskIds, disposition,
          reporting: origin.source === 'coding-origin' ? 'growth_journal' : reportTaskIds.length ? 'prepared' : 'scope_or_topic_withdrawn' }), origin.id);
      });
    }
  }
  async admitGrowth(growth: Growth, objective: string): Promise<CodingSession> {
    const store = this.#options.store, current = store.growth(growth.id);
    if (!current || current.sourceTaskId || current.origin.startsWith('conversation:') || this.#options.authorizeGrowth?.(current) !== true) throw new Error('Independent growth authority unavailable');
    const origin = store.transaction(() => {
      const task = store.enqueue({ id: `coding-growth:${current.id}`, source: 'coding-origin', conversationId: 'growth', input: objective, eventId: `coding-growth:${current.id}` });
      const prior = store.listEvents({ taskId: task.id }).find(event => event.type === 'coding.growth.origin.admitted');
      if (prior && object(prior.payload).objective !== objective) throw new Error('Growth coding objective identity conflict');
      if (!prior)
        store.appendEvent('coding.growth.origin.admitted', { growthId: current.id, objective }, task.id);
      return ['succeeded', 'failed'].includes(store.task(task.id)!.state) ? store.task(task.id)! : store.updateTask(task.id, { state: 'running' });
    });
    const unavailable = 'Coding is unavailable: the admitted source, finite policy or provider could not be established. No coding session was queued.';
    if (store.listEvents({ taskId: origin.id }).some(event => event.type === 'coding.admission.unavailable')) {
      this.#unavailable(origin, objective, unavailable);
      if (origin.state === 'running') store.updateTask(origin.id, { state: 'failed' });
      throw new Error('Growth coding admission unavailable');
    }
    let session: CodingSession;
    try { session = await this.#options.coordinator().admitGrowth(origin, objective); }
    catch (error) {
      const latest = store.growth(growth.id), task = store.task(origin.id);
      if (object(error).code === 'interrupted' || !latest || this.#options.authorizeGrowth?.(latest) !== true || task?.state !== 'running') throw error;
      this.#unavailable(task, objective, unavailable); store.updateTask(task.id, { state: 'failed' });
      throw error;
    }
    store.updateTask(origin.id, { state: 'succeeded' }); this.#oweReport(session, origin); return session;
  }
  readonly growth: GrowthCoding = {
    eligible: growth => !growth.sourceTaskId && !growth.origin.startsWith('conversation:')
      && this.#options.authorizeGrowth?.(growth) === true && this.#options.growthAvailable?.(growth) === true,
    prepare: (growth, request) => {
      if (!this.growth.eligible(growth)) throw new Error('Growth coding authority unavailable');
      const schema = structuredClone(reflectionSchema);
      const coding = { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false,
        properties: { objective: { type: 'string', minLength: 1, maxLength: 4000 } }, required: ['objective'] }] };
      return { ...request, schema: { ...schema, properties: { ...object(schema.properties), coding }, required: [...schema.required as string[], 'coding'] },
        system: request.system + '\nIndependent growth may choose coding {objective} with proposedChange null to start a finite durable workspace investigation using the admitted growth allocation. Otherwise return coding null. This is an agenda hypothesis, not execution or truth. Human or peer conversation does not create growth authority. Later actual tools and checks determine the result; broader drafts await supported admission.' };
    },
    accept: async (growth, raw, signal) => {
      signal?.throwIfAborted(); if (!this.growth.eligible(this.#options.store.growth(growth.id)!)) throw new Error('Growth coding authority changed');
      const value = object(JSON.parse(raw)), { coding, ...reflection } = value;
      const result = parseGrowthReflection(JSON.stringify(reflection));
      if (coding === undefined || coding === null) return;
      const intent = object(coding);
      if (Object.keys(intent).length !== 1 || typeof intent.objective !== 'string' || !intent.objective.trim() || intent.objective.length > 4000 || result.proposedChange) throw new Error('Invalid independent coding intent');
      let session: CodingSession;
      try { session = await this.admitGrowth(growth, intent.objective); }
      catch (error) {
        const originId = `coding-growth:${growth.id}`;
        if (signal?.aborted || !this.growth.eligible(this.#options.store.growth(growth.id)!)
          || !this.#options.store.listEvents({ taskId: originId }).some(event => event.type === 'coding.admission.unavailable')) throw error;
        return this.#options.store.updateGrowth(growth.id, { state: 'completed', checkpoint: { phase: 'coding_unavailable' },
          outcome: json({ assessment: 'coding_unavailable', result }), nextStep: 'No coding session was admitted; the unavailable disposition is retained without another inference.' });
      }
      return this.#options.store.updateGrowth(growth.id, { state: 'completed', checkpoint: json({ phase: 'coding_session', codingSessionId: session.id }),
        outcome: json({ assessment: 'coding_queued', result, codingSessionId: session.id }), nextStep: 'The detached coding session owns this inquiry; its observed outcome remains owed.' });
    },
  };
  async tick(): Promise<boolean> { this.reconcile(); const advanced = await this.#options.coordinator().tick(); this.reconcile(); return advanced; }
  pendingTopic(topicId: string): boolean {
    const topic = this.#options.store.conversationTopic(topicId);
    return this.#options.store.listEvents().some(event => {
      const payload = object(event.payload), bindings = payload.topics;
      if (event.type !== 'coding.report.owed' || !Array.isArray(bindings) || !bindings.some(binding => object(binding).id === topicId && object(binding).revision === topic?.revision)) return false;
      const session = this.#options.coordinator().status(String(payload.sessionId)); return !!session && session.state !== 'terminal';
    });
  }
  cancel(taskId: string): void { void this.#options.coordinator().cancel(taskId).catch(() => this.#options.store.appendEvent('coding.cancel.held', { originTaskId: taskId })); }
  status(taskId: string): string {
    const session = this.#options.coordinator().status(taskId);
    // Completion reasons may contain model-authored source or tool observations.
    // Status is shared conversation metadata, not the originating result report.
    return session ? ` Coding session ${session.id}: ${session.state}, ${session.phase}.` : '';
  }
  async pause(): Promise<void> { await this.#options.coordinator().pause('generation_quiescing'); }
  async resume(): Promise<void> { await this.#options.coordinator().adoptEpoch(); this.#options.coordinator().resume(); }
}
