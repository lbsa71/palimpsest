import { parseGrowthReflection, reflectionSchema } from './growth.ts';
import { maySuggestSelfModification } from './conversation-policy.ts';
import { ProviderError } from './providers.ts';
import type { CompletionRequest } from './providers.ts';
import type { Growth, Json, Memory, Task } from './store.ts';
import { Store } from './store.ts';
import type { EvolutionQueueItem } from './evolution-scheduler.ts';
import type { EvolutionReport } from './evolution.ts';
import type { GitPublisher } from './git-publication.ts';

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
export interface ConversationActionsOptions {
  store: Store;
  userIds: readonly string[];
  allowDirectOperator?: boolean;
  sourceContext(): string;
  cancelWork?(taskId: string): boolean;
}
const json = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;

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
      && !this.#options.store.listEvents().some(event => event.type === 'conversation.proposal.cancelled' && event.taskId === task.id);
  }
  prepare(task: Task, memories: Memory[], request: CompletionRequest, hostFacts: unknown): CompletionRequest {
    // Other-author episodes cannot become engineering instructions through a
    // whitelisted participant. Use exact recorded, same-author task episodes;
    // do not trust identity text or derived memories with erased provenance.
    const ownMemories = this.selectMemories(task,memories);
    return { ...request, schema: decisionSchema, maxOutputTokens: 8192,
      system: `${request.system}\nInteractive host protocol: Return the required decision JSON. Answer ordinary questions with converse and proposal null. Only an actual request to change your cognitive source may produce propose. Clarify unclear requests; decline unsuitable requests even when eligible. Weigh goals, evidence, commitments and constraints. A proposal is a hypothesis, never a completed action. Changes are limited to direct src/agent/*.ts; preserve request/memory JSON contracts and cross-scope isolation. Use supplied source and types only, complete replacement files and testable acceptance criteria. Do not request host/governance changes. The host will queue proposals for separate checks, review, interview and cognitive-worker succession; configured Git publication follows promotion. Outer Slack-service rebuild/restart is unavailable. Never claim an action is completed from this inference.`,
      prompt: JSON.stringify({ request: task.input, sameAuthorExperiences: ownMemories.map(memory => ({ id: memory.id, content: memory.content.slice(0,4000) })),
        sourceContext: this.#options.sourceContext(), hostFacts }),
    };
  }
  selectMemories(task:Task,memories:Memory[]):Memory[] {
    return memories.filter(memory => {
      if (memory.kind !== 'episodic' || !memory.source.startsWith('task:')) return false;
      const source = this.#options.store.task(memory.source.slice(5));
      return source?.conversationId === task.conversationId && this.eligible(source)
        && source.source === task.source && source.slackAuthor?.userId === task.slackAuthor?.userId
        && source.slackAuthor?.teamId === task.slackAuthor?.teamId;
    }).slice(-12);
  }
  accept(task: Task, raw: string): string {
    if (!this.eligible(task)) return 'No source modification was dispatched: current author policy does not permit it.';
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).some(key => !['reply','disposition','rationale','proposal'].includes(key))
        || typeof value.reply !== 'string' || !value.reply.trim() || value.reply.length > 8000
        || typeof value.rationale !== 'string' || !value.rationale.trim() || value.rationale.length > 12000
        || !['converse','clarify','decline','propose'].includes(String(value.disposition))) throw new Error();
      const result = parseGrowthReflection(JSON.stringify({ observation: value.rationale, lesson: value.rationale, nextQuestion: 'Evaluate the exact human-origin source proposal.', proposedChange: value.proposal }));
      if ((value.disposition === 'propose') !== !!result.proposedChange) throw new Error();
      if (result.proposedChange) {
        if (result.proposedChange.files.some(file => !/^src\/agent\/[A-Za-z0-9_.-]+\.ts$/.test(file.path))) return 'Proposal declined: this release path admits only direct src/agent/*.ts changes. No source was changed.';
        this.#options.store.recordConversationProposal(task.id, json({ result }));
        return `${value.reply}\n\nProposal ${task.id} is recorded and queued for checks, fresh review, interview and worker succession. No release or push has completed yet. Use status ${task.id} or cancel ${task.id} in this thread.`;
      }
      this.#options.store.appendEvent('conversation.decision', json({ disposition: value.disposition, rationale: value.rationale }), task.id);
      return `${value.reply}\n\nNo source modification was dispatched.`;
    } catch { throw new ProviderError('protocol', 'Invalid conversational decision; no source action dispatched.'); }
  }
  status(taskId: string): string {
    const growth = this.#options.store.growth(`conversation:${taskId}`);
    if (!growth) return '';
    const events = this.#options.store.listEvents();
    const queued = events.find(event => event.type === 'evolution.queue.enqueued' && (event.payload as Record<string, Json>)?.growthId === growth.id);
    const id = (queued?.payload as Record<string, Json>)?.id;
    const result = events.filter(event => event.type === 'evolution.queue.observed' && (event.payload as Record<string, Json>)?.id === id).at(-1);
    if (result) return ` Self-modification: ${JSON.stringify((result.payload as Record<string, Json>).result)}.`;
    if (events.some(event => event.type === 'conversation.proposal.cancelled' && event.taskId === taskId)) return ' Self-modification: cancellation requested.';
    return ` Self-modification: ${queued ? 'queued or evaluating' : 'awaiting queue reconciliation'}.`;
  }
  cancel(taskId: string): boolean { return this.#options.cancelWork?.(taskId) ?? false; }

  async reconcileResults(items: EvolutionQueueItem[], publisher?: GitPublisher): Promise<void> {
    for (const item of items.filter(item => item.state === 'finished')) {
      const growth=this.#options.store.growth(item.growthId);
      const task=growth?.sourceTaskId ? this.#options.store.task(growth.sourceTaskId) : undefined;
      if(!task || !item.result)continue;
      const eventId=`${item.id}:release-result`;
      if(this.#options.store.listTasks().some(value=>value.source===task.source && value.eventId===eventId))continue;
      const final=this.#options.store.listEvents().filter(event=>event.type==='evolution.finished' && (event.payload as Record<string,Json>)?.runId===item.id).at(-1);
      const report=(final?.payload as unknown as {report?:EvolutionReport})?.report;
      let publication='Git publication is disabled; no commit or push was performed.';
      if(item.result.status==='promoted' && report?.candidate && publisher) {
        if(this.authorize(growth!)) {
          const result=await publisher.publish(report.candidate);
          publication=`Git publication: ${result.status}. ${result.reason}${result.commit ? ` Commit ${result.commit}.` : ''}`;
          this.#options.store.appendEvent('conversation.publication_result',json({runId:item.id,result}),task.id);
        }else publication='Git publication withheld by current source-author policy; the already committed worker transfer is not undone.';
      }else if(item.result.status!=='promoted')publication='No Git publication was attempted for this release outcome.';
      const answer=`Self-modification ${task.id}: ${item.result.status}. ${item.result.reason}\n${report?.candidate ? `Candidate ${report.candidate.id}.\n` : ''}${publication}\nSuccession replaces the cognitive worker; the outer Slack service was not rebuilt or restarted.`;
      const progress=task.checkpoint!==null && typeof task.checkpoint==='object' && !Array.isArray(task.checkpoint) ? task.checkpoint : {};
      this.#options.store.enqueuePreparedReply({source:task.source,conversationId:task.conversationId,eventId,input:`Host-observed release result for ${task.id}`,
        ...(task.slackAuthor ? {slackAuthor:{...task.slackAuthor}} : {})},answer,typeof progress.replyTo==='string' ? progress.replyTo : undefined);
    }
  }
}
