import { parseGrowthReflection, reflectionSchema } from './growth.ts';
import { maySuggestSelfModification } from './conversation-policy.ts';
import { ProviderError } from './providers.ts';
import type { CompletionRequest } from './providers.ts';
import type { Growth, Json, Memory, Task } from './store.ts';
import { Store } from './store.ts';
import type { EvolutionQueueItem } from './evolution-scheduler.ts';
import type { EvolutionReport } from './evolution.ts';
import type { GitPublisher } from './git-publication.ts';
import type { ReleasePublication } from './release-publication.ts';
import { parseSourceBinding } from './source-identity.ts';
import type { SourceBinding } from './source-identity.ts';
import type { MemoryDescriptor } from './memory-projection.ts';
import { conversationMemoryTasks } from './conversation-provenance.ts';
import { createHash } from 'node:crypto';

const INTERACTIVE_MAX_OUTPUT_TOKENS = 8192;
const proposalSchema = (reflectionSchema.properties as Record<string, unknown>).proposedChange;
export const decisionSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    reply: { type: 'string', minLength: 1, maxLength: 8000 },
    disposition: { type: 'string', enum: ['converse', 'clarify', 'decline', 'propose'] },
    rationale: { type: 'string', minLength: 1, maxLength: 12000 },
    proposal: proposalSchema,
  }, required: ['reply', 'disposition', 'rationale', 'proposal'],
};
/** Advertised only by a configured, eligible coding entrypoint. */
export const codingDecisionSchema = { ...decisionSchema, properties: { ...decisionSchema.properties,
  disposition: { type: 'string', enum: ['converse', 'clarify', 'decline', 'propose', 'code'] },
  coding: { type: 'object', additionalProperties: false, properties: { objective: { type: 'string', minLength: 1, maxLength: 4000 } }, required: ['objective'] },
} };
export interface ConversationActionsOptions {
  store: Store;
  userIds: readonly string[];
  allowDirectOperator?: boolean;
  sourceContext(): string;
  /** Sample trusted source identity before inference, never from decision JSON. */
  observeSource?(): SourceBinding;
  cancelWork?(taskId: string): boolean;
  /** Trusted destination policy, evaluated again immediately before sending. */
  authorizeReport?(origin: Task, report: Task): boolean;
}
const json = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;
const object = (value: unknown): Record<string, Json> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Json> : {};
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const route = (task: Task) => ({ source: task.source, conversationId: task.conversationId, slackAuthor: task.slackAuthor ?? null,
  replyTo: typeof object(task.checkpoint).replyTo === 'string' ? object(task.checkpoint).replyTo as string : null });
const releaseStatuses = ['running', 'promoted', 'declined', 'interrupted', 'probation', 'rolled_back', 'failed'];
const publicReleaseStatus = (status: unknown): string => typeof status === 'string' && releaseStatuses.includes(status) ? status : 'unavailable';
const releaseNotice = 'Host notice: The retained self-modification report predates explicit speech. Its evaluation details remain private; use scoped status for the observed release state. No new execution or publication is claimed.';
const refusalNotice = 'Host notice: The source proposal was not admitted. No source work was queued or changed.';
type RefusalReason = 'author_policy' | 'source_path' | 'source_binding';
interface ReleaseOrigin { origin: Task; growth: Growth; queueId: string }
interface ReleaseReportBinding {
  version: 'conversation-release-report/1'; reportTaskId: string; originTaskId: string; growthId: string; queueId: string;
  originRoute: ReturnType<typeof route>; textDigest: string; sourceRefs: { id: string; version: number }[];
}
function releaseOrigin(store: Store, task: Task): ReleaseOrigin | undefined {
  const prepared = store.listEvents({ taskId: task.id }).find(event => event.type === 'conversation.release_report.prepared');
  const queueId = prepared ? object(prepared.payload).queueId : task.eventId?.endsWith(':release-result') ? task.eventId.slice(0, -':release-result'.length) : undefined;
  if (typeof queueId !== 'string') return;
  const queued = store.listEvents({ types: ['evolution.queue.enqueued'] }).find(event => object(event.payload).id === queueId);
  const growthId = object(queued?.payload).growthId;
  const growth = typeof growthId === 'string' ? store.growth(growthId) : undefined;
  const origin = growth?.sourceTaskId ? store.task(growth.sourceTaskId) : undefined;
  if (!origin || !growth || growth.id !== `conversation:${origin.id}` || growth.origin !== growth.id || growth.state !== 'completed'
    || !['direct', 'slack'].includes(origin.source) || task.eventId !== `${queueId}:release-result`) return;
  if (!prepared && (task.source !== origin.source || typeof object(task.checkpoint).answer !== 'string'
    || !store.listEvents({ types: ['evolution.queue.observed'] }).some(event => object(event.payload).id === queueId))) return;
  return { origin, growth, queueId };
}

/** Recognize historical reports from immutable queue/growth provenance, never
 * from a caller's suggestive input text. Used even while the receiver is absent. */
export function isConversationReleaseReport(store: Store, task: Task): boolean {
  return store.listEvents({ taskId: task.id }).some(event => ['conversation.release_report.prepared', 'conversation.proposal_refusal.prepared'].includes(event.type)) || !!releaseOrigin(store, task);
}

/** Pure validation is shared with outcome admission: malformed action fields
 * must not supersede an existing topic before source dispatch rejects them. */
export function parseConversationDecision(raw: string) {
  const value = JSON.parse(raw) as Record<string, unknown>;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['reply','disposition','rationale','proposal','coding'].includes(key))
    || typeof value.reply !== 'string' || (value.reply.length > 0 && !value.reply.trim()) || value.reply.length > 8000
    || typeof value.rationale !== 'string' || !value.rationale.trim() || value.rationale.length > 12000
    || !['converse','clarify','decline','propose','code'].includes(String(value.disposition))) throw new Error('Invalid conversation decision');
  const coding = value.coding;
  if (value.disposition === 'code') {
    if (!coding || typeof coding !== 'object' || Array.isArray(coding) || Object.keys(coding).length !== 1
      || typeof Reflect.get(coding, 'objective') !== 'string' || !Reflect.get(coding, 'objective').trim()
      || Reflect.get(coding, 'objective').length > 4000 || value.proposal !== null) throw new Error('Invalid coding decision');
  } else if (coding !== undefined) throw new Error('Unexpected coding intent');
  const result = parseGrowthReflection(JSON.stringify({ observation: value.rationale, lesson: value.rationale, nextQuestion: 'Evaluate the exact human-origin source proposal.', proposedChange: value.proposal }));
  if ((value.disposition === 'propose') !== !!result.proposedChange) throw new Error('Inconsistent proposal disposition');
  return { value: value as { reply: string; disposition: string; rationale: string; proposal: unknown; coding?: { objective: string } }, result };
}

/** Trusted interpretation/dispatch boundary. It creates an immutable proposal,
 * never changes the checkout or calls cutover from inside the conversation drain. */
export class ConversationActions {
  readonly #options: ConversationActionsOptions;
  readonly #users: readonly string[];
  constructor(options: ConversationActionsOptions) {
    this.#options = options; this.#users = Object.freeze([...options.userIds]);
  }
  eligible(task: Task): boolean {
    return maySuggestSelfModification(task, this.#users)
      || (task.source === 'direct' && this.#options.allowDirectOperator === true);
  }
  authorize(growth: Growth): boolean {
    if (!growth.sourceTaskId) return !growth.origin.startsWith('conversation:');
    const task = this.#options.store.task(growth.sourceTaskId);
    return !!task && growth.id === `conversation:${task.id}` && growth.origin === growth.id
      && task.state === 'succeeded' && this.eligible(task)
      && !this.#options.store.listEvents({ types: ['conversation.proposal.cancelled'], taskId: task.id }).some(event => event.type === 'conversation.proposal.cancelled' && event.taskId === task.id);
  }
  prepare(task: Task, memories: Memory[], request: CompletionRequest, hostFacts: unknown, projection?: readonly MemoryDescriptor[], codingAvailable = false): CompletionRequest {
    let sourceBinding: SourceBinding | undefined;
    let sourceObservationUnavailable = false;
    if (this.#options.observeSource) {
      try { sourceBinding = parseSourceBinding(this.#options.observeSource()); }
      catch { sourceObservationUnavailable = true; }
      const saved = this.#options.store.task(task.id)?.checkpoint;
      const progress = saved !== null && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
      this.#options.store.updateTask(task.id, { checkpoint: json({ ...progress, sourceBinding: sourceBinding ?? null, sourceObservationUnavailable }) });
    }
    // Other-author episodes cannot become engineering instructions through a
    // whitelisted participant. Use exact recorded, same-author task episodes;
    // do not trust identity text or derived memories with erased provenance.
    const ownMemories = this.selectMemories(task,memories);
    return { ...request, schema: decisionSchema, maxOutputTokens: INTERACTIVE_MAX_OUTPUT_TOKENS,
      system: `${request.system}\nInteractive host protocol: Return the required deliberative decision JSON. The final host schema supplies explicit say actions for any outward words; rationale and proposal interpretation remain internal. For ordinary informational questions, answer the main point first in about 100–180 words unless more detail is requested; finish complete sentences and include the material limitation. Ground implemented capability claims in executable operations and current host facts, rather than aspirational comments or remembered descriptions. Input-order slicing alone does not establish chronological sorting; a UTF-16 character prefix does not establish a UTF-8 byte bound or safe surrogate boundary. Describe the selected activePlanAllocation; alternate configuration settings are not simultaneous active caps. Distinguish configured standing growth from its current pause or deferral; a scheduled timer does not mean inference is presently permitted. Current host request preparation can override source defaults: maxOutputTokens limits output tokens, never input size. requester.selfModificationSuggestionEligible describes this request; authenticated direct operators and whitelisted Slack authors follow separate eligibility paths. Do not infer system-wide permissions or permanent unavailability from a temporary pause or this request alone. Answer ordinary questions with converse and proposal null. Only an actual request to change your cognitive source may produce propose. Clarify unclear requests; decline unsuitable requests even when eligible. Weigh goals, evidence, commitments and constraints. A proposal is a hypothesis, never a completed action. ${codingAvailable ? 'Complete-file propose decisions admit only direct src/agent/*.ts; iterative code decisions may draft the full source through separate workspace receivers.' : 'Changes are limited to direct src/agent/*.ts;'} Preserve request/memory JSON contracts and cross-scope isolation. Use supplied source and types only, complete replacement files and testable acceptance criteria. Make the smallest readable change with descriptive names; preserve useful behavior and explain non-obvious invariants. Use actual failed-check evidence to fix causes. Never hard-code fixtures, weaken checks, add speculative dependencies or claim tests you did not run. Separate intended acceptance criteria from observed results: report a check as passed only when supplied authoritative evidence establishes that named contract. Explicitly identify dependent work that remains unimplemented. Character/count limits do not establish UTF-8 byte bounds or safe Unicode truncation; evidence metadata has variable size, so claim a numerical resource bound only from measured serialized data or an enforceable input bound. ${codingAvailable ? 'Host/governance drafts require separate supported admission and cannot judge their own activation.' : 'Do not request host/governance changes.'} The host will queue proposals for separate checks, review, interview and cognitive-worker succession; configured Git publication follows promotion. Outer Slack-service rebuild/restart is unavailable. Never claim an action is completed from this inference.`,
      prompt: JSON.stringify({ request: task.input, requestLimits: { maxOutputTokens: INTERACTIVE_MAX_OUTPUT_TOKENS, unit: 'output tokens' }, sameAuthorExperiences: projection ?? ownMemories.map(memory => ({ id: memory.id, content: memory.content.slice(0,4000) })),
        sourceContext: this.#options.sourceContext(), hostFacts, ...(sourceBinding ? { sourceBinding } : {}),
        ...(sourceObservationUnavailable ? { sourceModificationAvailability: 'Temporarily unavailable: current checkout and admitted source identity cannot be established. Continue ordinary conversation; no source proposal can be dispatched from this inference.' } : {}) }),
    };
  }
  selectMemories(task:Task,memories:Memory[]):Memory[] {
    return memories.filter(memory => {
      const sources = conversationMemoryTasks(this.#options.store, memory);
      return !!sources?.length && sources.every(source => source.conversationId === task.conversationId && this.eligible(source)
        && source.source === task.source && source.slackAuthor?.userId === task.slackAuthor?.userId
        && source.slackAuthor?.teamId === task.slackAuthor?.teamId);
    }).slice(-12);
  }
  accept(task: Task, raw: string): string {
    try {
      const { value, result } = parseConversationDecision(raw);
      if (!this.eligible(task)) {
        if (result.proposedChange) this.#prepareRefusalNotice(task, 'author_policy');
        return 'No source modification was dispatched: current author policy does not permit it.';
      }
      if (value.disposition === 'code') throw new ProviderError('configuration', 'Coding requires the configured durable session receiver.');
      if (result.proposedChange) {
        if (result.proposedChange.files.some(file => !/^src\/agent\/[A-Za-z0-9_.-]+\.ts$/.test(file.path))) {
          this.#prepareRefusalNotice(task, 'source_path');
          return 'Proposal declined: this release path admits only direct src/agent/*.ts changes. No source was changed.';
        }
        const saved = this.#options.store.task(task.id)?.checkpoint;
        const recorded = saved !== null && typeof saved === 'object' && !Array.isArray(saved) ? saved.sourceBinding : undefined;
        let sourceBinding: SourceBinding | undefined;
        if (this.#options.observeSource || (recorded !== undefined && recorded !== null)) {
          try { sourceBinding = parseSourceBinding(recorded); }
          catch {
            this.#prepareRefusalNotice(task, 'source_binding');
            return 'Source modification is temporarily unavailable: this inference has no verified source binding. No proposal was dispatched or source changed.';
          }
        }
        this.#options.store.recordConversationProposal(task.id, json({ result, ...(sourceBinding ? { sourceBinding } : {}) }));
        return `${value.reply}\n\nProposal ${task.id} is recorded and queued for checks, fresh review, interview and worker succession. No release or push has completed yet. Use status ${task.id} or cancel ${task.id} in this thread.`;
      }
      this.#options.store.appendEvent('conversation.decision', json({ disposition: value.disposition, rationale: value.rationale }), task.id);
      return value.reply;
    } catch { throw new ProviderError('protocol', 'Invalid conversational decision; no source action dispatched.'); }
  }
  status(taskId: string): string {
    const growth = this.#options.store.growth(`conversation:${taskId}`);
    if (!growth) return '';
    const events = this.#options.store.listEvents({ types: ['evolution.queue.enqueued', 'evolution.queue.observed', 'conversation.proposal.cancelled'] });
    const queued = events.find(event => event.type === 'evolution.queue.enqueued' && (event.payload as Record<string, Json>)?.growthId === growth.id);
    const id = (queued?.payload as Record<string, Json>)?.id;
    const result = events.filter(event => event.type === 'evolution.queue.observed' && (event.payload as Record<string, Json>)?.id === id).at(-1);
    if (result) return ` Self-modification: ${publicReleaseStatus(object(object(result.payload).result).status)}.`;
    if (events.some(event => event.type === 'conversation.proposal.cancelled' && event.taskId === taskId)) return ' Self-modification: cancellation requested.';
    return ` Self-modification: ${queued ? 'queued or evaluating' : 'awaiting queue reconciliation'}.`;
  }
  cancel(taskId: string): boolean { return this.#options.cancelWork?.(taskId) ?? false; }

  isReport(task: Task): boolean { return isConversationReleaseReport(this.#options.store, task); }

  #prepareRefusalNotice(task: Task, reason: RefusalReason): void {
    const store = this.#options.store, origin = store.task(task.id)!;
    const progress = object(origin.checkpoint);
    // A previously admitted proposal already owns a release-result obligation.
    // New refusal semantics never alter historical decision recovery.
    if (progress.deliberationProtocol !== 'autark-turn/1' || typeof progress.decisionText !== 'string'
      || !['direct', 'slack'].includes(origin.source) || store.growth(`conversation:${origin.id}`)) return;
    store.transaction(() => {
      const report = store.enqueuePreparedReply({ source: origin.source, conversationId: origin.conversationId,
        eventId: `${origin.id}:proposal-refused`, input: 'Host-observed source proposal admission refusal',
        ...(origin.slackAuthor ? { slackAuthor: { ...origin.slackAuthor } } : {}) }, refusalNotice, typeof progress.replyTo === 'string' ? progress.replyTo : undefined);
      if (store.listEvents({ taskId: report.id }).some(event => event.type === 'conversation.proposal_refusal.prepared')) return;
      store.appendEvent('conversation.proposal_refusal.prepared', json({ version: 'conversation-proposal-refusal/1', reportTaskId: report.id,
        originTaskId: origin.id, originRoute: route(origin), decisionDigest: digest(progress.decisionText as string),
        sourceRefs: this.#sourceRefs(origin), reason }), report.id);
    });
  }

  #sourceRefs(origin: Task): { id: string; version: number }[] {
    const refs = new Map<string, { id: string; version: number }>();
    const progress = object(origin.checkpoint);
    for (const key of ['conversationSourceRefs', 'deliberationSourceRefs']) {
      const values = progress[key];
      if (Array.isArray(values)) for (const value of values) {
        const ref = object(value);
        if (typeof ref.id === 'string' && typeof ref.version === 'number') refs.set(ref.id, { id: ref.id, version: ref.version });
      }
    }
    for (const memory of this.#options.store.listMemories(origin.conversationId)) {
      if (memory.kind === 'episodic' && memory.source === `task:${origin.id}`) refs.set(memory.id, { id: memory.id, version: memory.version });
    }
    return [...refs.values()];
  }

  #refusalMaySend(task: Task, binding: Record<string, Json>): boolean {
    const store = this.#options.store, current = store.task(task.id);
    const origin = typeof binding.originTaskId === 'string' ? store.task(binding.originTaskId) : undefined;
    if (!current || !origin || binding.version !== 'conversation-proposal-refusal/1' || binding.reportTaskId !== task.id
      || task.eventId !== `${origin.id}:proposal-refused` || origin.state === 'cancelled' || !store.taskSourceCurrent(origin.id)
      || store.growth(`conversation:${origin.id}`) || object(origin.checkpoint).deliberationProtocol !== 'autark-turn/1'
      || digest(String(object(origin.checkpoint).decisionText)) !== binding.decisionDigest
      || JSON.stringify(route(origin)) !== JSON.stringify(binding.originRoute) || JSON.stringify(route(current)) !== JSON.stringify(binding.originRoute)
      || JSON.stringify(route(task)) !== JSON.stringify(binding.originRoute) || object(current.checkpoint).answer !== refusalNotice
      || object(task.checkpoint).answer !== refusalNotice || object(object(current.checkpoint).preparedSpeech).version !== 'prepared-speech/1'
      || object(object(current.checkpoint).preparedSpeech).kind !== 'host_notice' || !Array.isArray(binding.sourceRefs)
      || binding.sourceRefs.some(value => { const ref = object(value); return typeof ref.id !== 'string' || store.memory(ref.id, origin.conversationId)?.version !== ref.version; })
      || origin.state === 'succeeded' && !store.listMemories(origin.conversationId).some(memory => memory.kind === 'episodic' && memory.source === `task:${origin.id}`)) return false;
    // Source-work eligibility may be the reason for refusal. Returning a fixed
    // receipt still requires current destination policy. This independently
    // observed admission result does not depend on delivery of the earlier say;
    // an uncertain/rejected say retains its own effect without being retried.
    try { return this.#options.authorizeReport?.(origin, current) !== false; } catch { return false; }
  }

  #bindReport(task: Task, source: ReleaseOrigin): void {
    const store = this.#options.store;
    if (store.listEvents({ taskId: task.id }).some(event => event.type === 'conversation.release_report.prepared')) return;
    const binding: ReleaseReportBinding = { version: 'conversation-release-report/1', reportTaskId: task.id, originTaskId: source.origin.id,
      growthId: source.growth.id, queueId: source.queueId, originRoute: route(source.origin), sourceRefs: this.#sourceRefs(source.origin),
      textDigest: digest(String(object(task.checkpoint).answer)) };
    store.appendEvent('conversation.release_report.prepared', json(binding), task.id);
  }

  sanitizeReport(task: Task): Task {
    const store = this.#options.store, current = store.task(task.id) ?? task;
    if (!['queued', 'running'].includes(current.state) || store.effect(`${current.id}:result`)
      || store.listEvents({ taskId: current.id }).some(event => event.type === 'conversation.release_report.prepared')) return current;
    const source = releaseOrigin(store, current); if (!source) return current;
    return store.transaction(() => {
      const migrated = store.updateTask(current.id, { checkpoint: { ...object(current.checkpoint), answer: releaseNotice,
        preparedSpeech: { version: 'prepared-speech/1', kind: 'host_notice' } } });
      this.#bindReport(migrated, source);
      store.appendEvent('conversation.release_report.speech_migrated', { reportTaskId: current.id, queueId: source.queueId }, current.id);
      return migrated;
    });
  }

  reportMaySend(task: Task): boolean {
    const store = this.#options.store;
    if (!this.isReport(task)) return true;
    // Already observed delivery is historical evidence; no new send occurs.
    if (store.effect(`${task.id}:result`)?.state === 'completed') return true;
    const refusal = store.listEvents({ taskId: task.id }).find(event => event.type === 'conversation.proposal_refusal.prepared');
    if (refusal) return this.#refusalMaySend(task, object(refusal.payload));
    const prepared = store.listEvents({ taskId: task.id }).find(event => event.type === 'conversation.release_report.prepared');
    if (!prepared) return false;
    const binding = prepared.payload as unknown as ReleaseReportBinding;
    const current = store.task(task.id), source = releaseOrigin(store, task);
    if (!current || !source || binding.version !== 'conversation-release-report/1' || binding.reportTaskId !== task.id
      || binding.originTaskId !== source.origin.id || binding.growthId !== source.growth.id || binding.queueId !== source.queueId
      || source.origin.state !== 'succeeded' || !this.eligible(source.origin) || !store.taskSourceCurrent(source.origin.id)
      || JSON.stringify(route(source.origin)) !== JSON.stringify(binding.originRoute) || JSON.stringify(route(current)) !== JSON.stringify(binding.originRoute)
      || JSON.stringify(route(task)) !== JSON.stringify(binding.originRoute) || typeof object(current.checkpoint).answer !== 'string'
      || digest(String(object(current.checkpoint).answer)) !== binding.textDigest || digest(String(object(task.checkpoint).answer)) !== binding.textDigest
      || object(object(current.checkpoint).preparedSpeech).version !== 'prepared-speech/1'
      || object(object(current.checkpoint).preparedSpeech).kind !== 'host_notice' || !Array.isArray(binding.sourceRefs)
      || !binding.sourceRefs.some(ref => store.memory(ref.id, source.origin.conversationId)?.source === `task:${source.origin.id}`)
      || binding.sourceRefs.some(ref => store.memory(ref.id, source.origin.conversationId)?.version !== ref.version)) return false;
    try { return this.#options.authorizeReport?.(source.origin, current) !== false; } catch { return false; }
  }

  async reconcileResults(items: EvolutionQueueItem[], publisher?: GitPublisher, publications?: Pick<ReleasePublication,'result'>): Promise<void> {
    for (const item of items.filter(item => item.state === 'finished')) {
      const growth=this.#options.store.growth(item.growthId);
      const task=growth?.sourceTaskId ? this.#options.store.task(growth.sourceTaskId) : undefined;
      if(!task || !item.result)continue;
      const eventId=`${item.id}:release-result`;
      if(this.#options.store.listTasks().some(value=>value.source===task.source && value.eventId===eventId))continue;
      const final=this.#options.store.listEvents({ types: ['evolution.finished'] }).filter(event=>event.type==='evolution.finished' && (event.payload as Record<string,Json>)?.runId===item.id).at(-1);
      const report=(final?.payload as unknown as {report?:EvolutionReport})?.report;
      let publication='Git publication is disabled; no commit or push was performed.';
      if(item.result.status==='promoted' && report?.candidate && (publisher || publications)) {
        if(this.authorize(growth!)) {
          const result=publications?.result(item.id) ?? (publisher ? await publisher.publish(report.candidate) : undefined);
          if(!result)continue;
          const status = ['published', 'declined', 'uncertain'].includes(result.status) ? result.status : 'unavailable';
          publication=`Git publication: ${status}.${result.commit && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(result.commit) ? ` Commit ${result.commit}.` : ''}`;
          this.#options.store.appendEvent('conversation.publication_result',json({runId:item.id,result}),task.id);
        }else publication='Git publication withheld by current source-author policy; the already committed worker transfer is not undone.';
      }else if(item.result.status!=='promoted')publication='No Git publication was attempted for this release outcome.';
      // Reasons can contain model-authored review/interpretation text. Retain
      // them in operational evidence; this host notice reports observed status.
      const answer=`Host notice: Self-modification ${task.id}: ${publicReleaseStatus(item.result.status)}.\n${report?.candidate && /^[a-f0-9]{64}$/.test(report.candidate.id) ? `Candidate ${report.candidate.id}.\n` : ''}${publication}\nSuccession replaces the cognitive worker; the outer Slack service was not rebuilt or restarted.`;
      const progress=task.checkpoint!==null && typeof task.checkpoint==='object' && !Array.isArray(task.checkpoint) ? task.checkpoint : {};
      this.#options.store.transaction(() => {
        const prepared = this.#options.store.enqueuePreparedReply({source:task.source,conversationId:task.conversationId,eventId,input:`Host-observed release result for ${task.id}`,
          ...(task.slackAuthor ? {slackAuthor:{...task.slackAuthor}} : {})},answer,typeof progress.replyTo==='string' ? progress.replyTo : undefined);
        this.#bindReport(prepared, { origin: task, growth: growth!, queueId: item.id });
      });
    }
  }
}
