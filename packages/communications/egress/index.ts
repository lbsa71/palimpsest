import { identity, invariant, nonempty, scopeAllows } from '../../contracts/common.ts';
import type { DataScope, JsonValue } from '../../contracts/common.ts';
import type { Effect, EffectReceiver } from '../../contracts/execution/index.ts';
import type { AuthorityFence } from '../../effects/index.ts';
import { OperationalStore } from '../../storage/index.ts';
import { SlackError } from '../slack/client.ts';
import type { SlackApi, SlackPage } from '../slack/client.ts';
import type { SlackDeliveryIdentity } from '../slack/authorship.ts';

export interface SpeechGrant {channel:string;threadTs?:string;scope:DataScope}
export interface SpeechPayload {channel:string;threadTs?:string;text:string;kind:'report'|'progress'|'message';obligationId?:string;obligationRevision?:number;reportRevision?:number}
export interface SpeechReceipt extends SpeechPayload {transport:'slack';messageTs:string;clientMsgId:string;delivered:true}
export interface SpeechOptions {store:OperationalStore;fence:AuthorityFence;api:SlackApi;botUserId:string;grants:readonly SpeechGrant[];maxReconcilePages?:number;pageSize?:number}
function payload(effect:Effect,grants:readonly SpeechGrant[]):SpeechPayload {
  invariant(effect.kind==='speech.send','unsupported speech effect');
  invariant(effect.payload!==null && typeof effect.payload==='object'&&!Array.isArray(effect.payload),'speech requires an object');
  const p=effect.payload as Record<string,JsonValue>;
  invariant(Object.keys(p).every(k=>['channel','threadTs','text','kind','obligationId','obligationRevision','reportRevision'].includes(k)),'unknown or privileged speech field');
  nonempty(p.channel,'channel');nonempty(p.text,'text');invariant(p.threadTs===undefined||typeof p.threadTs==='string','invalid thread');
  const grant=grants.find(g=>g.channel===p.channel && g.threadTs===p.threadTs);invariant(grant && scopeAllows(effect.scope,grant.scope),'speech audience denied');
  invariant(p.kind===undefined || ['report','progress','message'].includes(p.kind as string),'invalid speech kind');
  if(p.obligationId!==undefined){nonempty(p.obligationId,'obligation');invariant(p.kind==='report' && Number.isSafeInteger(p.obligationRevision) && (p.obligationRevision as number)>=0,'report requires current obligation revision');}
  return {...p,kind:p.kind??'message'} as unknown as SpeechPayload;
}
function clientId(effect:Effect):string {const d=identity({effectId:effect.id});return `${d.slice(0,8)}-${d.slice(8,12)}-4${d.slice(13,16)}-a${d.slice(17,20)}-${d.slice(20,32)}`;}
function receipt(p:SpeechPayload,messageTs:string,clientMsgId:string):SpeechReceipt {return {...p,transport:'slack',messageTs,clientMsgId,delivered:true};}
/** Injectable into ToolEffectReceiver. Host grants identify exact channels/threads. */
export function createSpeechHandler(options:SpeechOptions):EffectReceiver {
  nonempty(options.botUserId,'sending Slack bot identity');
  invariant(Number.isSafeInteger(options.maxReconcilePages??10)&&(options.maxReconcilePages??10)>0,'positive reconciliation page bound required');
  invariant(Number.isSafeInteger(options.pageSize??100)&&(options.pageSize??100)>0&&(options.pageSize??100)<=1000,'invalid reconciliation page size');
  const retainDelivery=(effect:Effect,p:SpeechPayload,messageTs:string)=>{
    const key=`${p.channel}:${messageTs}`,old=options.store.get('communications.slack.deliveries',key);
    const value:SlackDeliveryIdentity={channel:p.channel,messageTs,botUserId:options.botUserId,effectId:effect.id,
      origin:effect.id.startsWith('host:')?'host-status':'mind-speech'};
    options.store.put('communications.slack.deliveries',key,value,old?.revision??null);
  };
  return {
    async dispatch(effect,signal){
      const p=payload(effect,options.grants);options.fence.assert(effect.authority);signal?.throwIfAborted();
      const clientMsgId=clientId(effect);
      try{
        const response=await options.api.call<{channel:string;ts:string}>('chat.postMessage',{channel:p.channel,text:p.text,client_msg_id:clientMsgId,...(p.threadTs?{thread_ts:p.threadTs}:{})},signal);
        invariant(response.channel===p.channel && typeof response.ts==='string' && response.ts.length>0,'invalid Slack delivery receipt');
        retainDelivery(effect,p,response.ts);
        return {outcome:'succeeded',receipt:options.store.putJsonArtifact(receipt(p,response.ts,clientMsgId) as unknown as JsonValue)};
      }catch(error){
        // Documented API rejections are failed. Connection loss, malformed success and 5xx stay unknown.
        const failed=error instanceof SlackError && ['missing_scope','channel_not_found','not_in_channel','invalid_auth','account_inactive','msg_too_long','no_text','ratelimited'].includes(error.code);
        return {outcome:failed?'failed':'uncertain',receipt:options.store.putJsonArtifact({transport:'slack',channel:p.channel,clientMsgId,delivered:false,reason:error instanceof SlackError?error.code:'unknown_send_outcome'})};
      }
    },
    async reconcile(effect){
      const p=payload(effect,options.grants),clientMsgId=clientId(effect);let cursor='';const seen=new Set<string>();
      try{
        for(let page=0;page<(options.maxReconcilePages??10);page++){
          const result=await options.api.call<SlackPage>(p.threadTs?'conversations.replies':'conversations.history',{channel:p.channel,...(p.threadTs?{ts:p.threadTs}:{}),limit:String(options.pageSize??100),...(cursor?{cursor}:{})});
          // Slack can sanitize the text; trusted bot identity + unique client ID +
          // exact destination bind the receipt without demanding byte-identical rendering.
          const message=result.messages.find(m=>m.client_msg_id===clientMsgId && m.user===options.botUserId && (p.threadTs?m.thread_ts===p.threadTs:!m.thread_ts||m.thread_ts===m.ts));
          if(message){retainDelivery(effect,p,message.ts);return {outcome:'succeeded',receipt:options.store.putJsonArtifact(receipt(p,message.ts,clientMsgId) as unknown as JsonValue)};}
          cursor=result.response_metadata?.next_cursor??'';if(!cursor||seen.has(cursor))break;seen.add(cursor);
        }
      }catch{/* Permission, retention, rate limit or transport gaps cannot prove non-delivery. */}
      return {outcome:'unresolved',receipt:options.store.putJsonArtifact({transport:'slack',channel:p.channel,clientMsgId,delivered:false,reason:'receipt_not_found_within_available_history'})};
    },
  };
}
