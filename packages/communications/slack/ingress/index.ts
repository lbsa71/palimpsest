import { createHmac, timingSafeEqual } from 'node:crypto';
import { invariant, nonempty } from '../../../contracts/common.ts';
import type { DataScope } from '../../../contracts/common.ts';
import { CommunicationsCore } from '../../core/index.ts';
import type { Admission } from '../../core/index.ts';
import type { SlackMessage } from '../client.ts';
import { captureWallClock, createNodeCommunicationsEnvironment } from '../../environment.ts';

export interface SlackChannelGrant { channel:string; scope:DataScope; directUserId?:string }
/** Explicit one-person DM authority is private to the authenticated Slack actor. */
export function validateSlackDirectGrant(grant:SlackChannelGrant,teamId:string,botUserId:string):void {
  if(grant.directUserId===undefined)return;
  nonempty(grant.directUserId,'Slack direct user');
  invariant(grant.channel.startsWith('D') && grant.directUserId!==botUserId,'DM grant requires a D channel and nonbot direct user');
  invariant(grant.scope.kind==='restricted' && grant.scope.principals.length===1 && grant.scope.principals[0]===`slack:${teamId}:${grant.directUserId}`,'DM grant requires the exact private direct user scope');
}
export interface SlackIngressOptions { core:CommunicationsCore; teamId:string; botUserId:string; channels:readonly SlackChannelGrant[]; eligibleHumanIds:readonly string[] }
export interface SlackEvent {type:string;channel?:string;ts?:string;user?:string;text?:string;thread_ts?:string;subtype?:string;bot_id?:string;message?:SlackMessage;previous_message?:SlackMessage;deleted_ts?:string;event_ts?:string}
export interface JoinedThread {channel:string;threadTs:string;joinedAt:string}
export class SlackIngress {
  readonly options:SlackIngressOptions;
  constructor(options:SlackIngressOptions){this.options=options;nonempty(options.teamId,'Slack team');nonempty(options.botUserId,'Slack bot');invariant(new Set(options.channels.map(c=>c.channel)).size===options.channels.length,'duplicate channel grant');for(const grant of options.channels)validateSlackDirectGrant(grant,options.teamId,options.botUserId);}
  threads():JoinedThread[]{return this.options.core.store.list<JoinedThread>('communications.slack.threads').map(r=>r.value);}
  /** Called exclusively after Socket Mode authentication or signed HTTP verification. */
  acceptAuthenticated(teamId:string,event:SlackEvent):Admission|undefined {
    invariant(teamId===this.options.teamId,'foreign Slack workspace');
    if(!['app_mention','message'].includes(event.type)||!event.channel)return;
    const grant=this.options.channels.find(c=>c.channel===event.channel);if(!grant)return;
    const deletion=event.subtype==='message_deleted';
    const message=event.subtype==='message_changed'?event.message:deletion?event.previous_message:event as SlackMessage;
    if(!message || message.bot_id || message.user===this.options.botUserId || !message.user || !message.ts)return;
    if(message.subtype && !['thread_broadcast','message_changed'].includes(message.subtype))return;
    const author=message.user;const threadTs=message.thread_ts??message.ts;
    if(grant.directUserId!==undefined && author!==grant.directUserId)return;
    const key=`${this.options.teamId}:${grant.channel}:${threadTs}`;
    const mention=message.text?.includes(`<@${this.options.botUserId}>`)===true;
    const store=this.options.core.store;
    if(grant.directUserId===undefined&&!mention&&!store.get('communications.slack.threads',key))return;
    return store.transaction(()=>{
      const thread=store.get('communications.slack.threads',key);
      if(!thread)store.put('communications.slack.threads',key,{channel:grant.channel,threadTs,joinedAt:message.ts},null);
      const command=(message.text??'').replaceAll(`<@${this.options.botUserId}>`,'').trim();
      const revision=deletion?event.event_ts:event.subtype==='message_changed'?message.edited?.ts??event.event_ts:message.edited?.ts??message.ts;
      nonempty(revision,'Slack revision');
      return this.options.core.receive({source:`slack:${this.options.teamId}`,externalId:`${grant.channel}:${message.ts}`,revision,conversation:`slack:${key}`,text:deletion?'source message deleted':message.text??'',actor:{id:`slack:${this.options.teamId}:${author}`,scope:grant.scope,modificationEligible:this.options.eligibleHumanIds.includes(author)},...(deletion?{control:'cancel' as const}:command==='cancel'?{control:'cancel' as const}:command==='status'?{control:'status' as const}:{})});
    });
  }
  acceptHistory(channel:string,message:SlackMessage):Admission|undefined {return this.acceptAuthenticated(this.options.teamId,{...message,type:'message',channel});}
}

export function verifySlackSignature(options:{secret:string;timestamp:string;signature:string;body:string;nowMs?:number;now?:()=>number}):boolean {
  if(!options.secret)return false;
  const now=options.nowMs??captureWallClock(options.now??createNodeCommunicationsEnvironment().now)();
  invariant(Number.isFinite(now),'invalid communications wall clock');
  const time=Number(options.timestamp);if(!Number.isFinite(time)||Math.abs(now/1000-time)>300)return false;
  const expected=Buffer.from(`v0=${createHmac('sha256',options.secret).update(`v0:${options.timestamp}:${options.body}`).digest('hex')}`);
  const actual=Buffer.from(options.signature);return actual.length===expected.length&&timingSafeEqual(actual,expected);
}
