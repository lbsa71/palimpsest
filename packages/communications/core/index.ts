import { canonicalJson, identity, invariant, nonempty, scopeAllows, validateScope } from '../../contracts/common.ts';
import type { Authority, DataScope, ResourceEnvelope } from '../../contracts/common.ts';
import { inputIdentity } from '../../contracts/execution/index.ts';
import type { InboundInput, Run } from '../../contracts/execution/index.ts';
import { DurableRuntime } from '../../runtime/index.ts';
import { OperationalStore } from '../../storage/index.ts';

export interface Principal { id: string; scope: DataScope; modificationEligible: boolean; controlledRunIds?:readonly string[] }
export interface AuthenticatedMessage { source: string; externalId: string; revision: string; conversation: string; text: string; actor: Principal; targetRunId?: string; control?: 'cancel' | 'status' }
export interface Admission { run: Run; duplicate: boolean; modificationEligible: boolean }
interface MessageRecord { input: InboundInput; runId: string; conversation: string; operation: string; controlResult?: { status: Run['status']; revision: number } }
interface Conversation { runId: string; scope: DataScope }
export interface CommunicationsOptions { store: OperationalStore; runtime: DurableRuntime; grant: (actor: Principal) => { authority: Authority; resources: ResourceEnvelope;parentRunId?:string }; onReady?: (run: Run) => void }

/** Authenticated transports construct actors; message bodies can never construct grants. */
export class CommunicationsCore {
  readonly options: CommunicationsOptions;
  constructor(options: CommunicationsOptions) { this.options = options; }
  get store(): OperationalStore { return this.options.store; }
  status(runId: string, actor: Principal): Run {
    const run = this.options.runtime.getRun(runId); invariant(run, 'unknown run');
    invariant(scopeAllows(run.scope, actor.scope), 'run audience denied'); return run;
  }
  receive(message: AuthenticatedMessage): Admission {
    nonempty(message.actor.id, 'authenticated actor'); validateScope(message.actor.scope);
    nonempty(message.externalId, 'external message'); nonempty(message.revision, 'external revision'); nonempty(message.conversation, 'conversation');
    const input: InboundInput = { id: inputIdentity({source:message.source,externalId:message.externalId,externalRevision:message.revision}), source:message.source, externalId:message.externalId, externalRevision:message.revision, actorId:message.actor.id, authenticated:true, scope:message.actor.scope, value:message.text };
    const operation=canonicalJson({targetRunId:message.targetRunId??null,control:message.control??null});
    let ready: Run | undefined;
    const admission = this.store.transaction(() => {
      const old = this.store.get<MessageRecord>('communications.inputs', input.id);
      if (old) { invariant(canonicalJson(old.value.input) === canonicalJson(input) && old.value.conversation === message.conversation && old.value.operation===operation, 'conflicting authenticated message identity'); return {run:this.status(old.value.runId,message.actor),duplicate:true,modificationEligible:message.actor.modificationEligible}; }
      const originKey = identity({source:message.source,externalId:message.externalId});
      const origin = this.store.get<MessageRecord>('communications.origins', originKey);
      if (origin) invariant(origin.value.input.actorId === input.actorId && origin.value.conversation === message.conversation && canonicalJson(origin.value.input.scope) === canonicalJson(input.scope), 'conflicting message origin');
      const conversation = this.store.get<Conversation>('communications.conversations', message.conversation);
      if(message.targetRunId)invariant(message.targetRunId===origin?.value.runId || message.targetRunId===conversation?.value.runId || message.actor.controlledRunIds?.includes(message.targetRunId), 'control target is not registered to this conversation');
      const target = message.targetRunId ?? origin?.value.runId ?? conversation?.value.runId;
      let run = target ? this.status(target,message.actor) : undefined;
      // Slack timestamps and direct numeric revisions have an order. Old backfill edits
      // remain evidence and cannot steer a newer accepted revision backwards.
      const stale=origin && Number.isFinite(Number(input.externalRevision)) && Number.isFinite(Number(origin.value.input.externalRevision)) && Number(input.externalRevision)<Number(origin.value.input.externalRevision);
      if(stale){invariant(run,'revision has no run');this.store.put('communications.inputs',input.id,{input,runId:run.id,conversation:message.conversation,operation},null);return {run,duplicate:false,modificationEligible:message.actor.modificationEligible};}
      if (message.control) {
        invariant(run, 'control requires an owned run');
        if (message.control === 'cancel') this.options.runtime.cancel(run.id,message.actor.id,message.text || 'cancelled by authenticated speaker');
        run = this.status(run.id,message.actor);
      } else if (run && !['completed','cancelled'].includes(run.status)) {
        this.options.runtime.steer(run.id,input); ready = this.options.runtime.getRun(run.id)!; run = ready;
      } else {
        const grant = this.options.grant(message.actor);
        run = this.options.runtime.admit(input,grant.authority,grant.resources,grant.parentRunId); ready = run;
      }
      const record: MessageRecord = {input,runId:run.id,conversation:message.conversation,operation,
        ...(message.control ? { controlResult: { status: run.status, revision: run.revision } } : {})};
      this.store.put('communications.inputs',input.id,record,null);
      this.store.put('communications.origins',originKey,record,origin?.revision ?? null);
      if(!message.control || !conversation || conversation.value.runId===run.id)this.store.put('communications.conversations',message.conversation,{runId:run.id,scope:input.scope},conversation?.revision ?? null);
      this.store.append({id:`communication:${input.id}`,stream:'communications',type:message.control ?? (origin?'revision':'input'),data:{...record,modificationEligible:message.actor.modificationEligible}});
      return {run,duplicate:false,modificationEligible:message.actor.modificationEligible};
    });
    // Scheduling is outside the commit. A host can recover ready/waiting runs if this callback is lost.
    if (ready && this.options.onReady) {const run=ready;queueMicrotask(()=>this.options.onReady?.(run));}
    return admission;
  }
}
