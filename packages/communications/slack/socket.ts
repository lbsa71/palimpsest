import { invariant } from '../../contracts/common.ts';
import type { SlackApi } from './client.ts';
import { SlackIngress } from './ingress/index.ts';
import type { SlackEvent } from './ingress/index.ts';
import { SlackRecovery } from './recovery/index.ts';
import { captureMonotonicClock, communicationDelay, createNodeCommunicationsEnvironment } from '../environment.ts';
import type { CommunicationSchedule } from '../environment.ts';

export interface SocketLike {addEventListener(type:string,listener:(event:any)=>void,options?:{once?:boolean}):void;removeEventListener?(type:string,listener:(event:any)=>void):void;send(data:string):void;close():void}
export interface SocketOptions {botApi:SlackApi;appApi:SlackApi;ingress:SlackIngress;recovery:SlackRecovery;socket?:(url:string)=>SocketLike;schedule?:CommunicationSchedule;monotonicNow?:()=>number;reconnectMinMs?:number;reconnectMaxMs?:number;recoveryIntervalMs?:number;onError?:(kind:string)=>void}
class LifecycleFailure extends Error { constructor(cause:unknown) { super('communications lifecycle failure',{cause}); } }
/** Authenticated ephemeral Socket Mode links, durable intake before ACK, automatic catch-up. */
export class SlackSocketMode {
  readonly options:SocketOptions;private controller?:AbortController;private completion?:Promise<void>;
  private readonly socket:(url:string)=>SocketLike;private readonly schedule:CommunicationSchedule;private readonly now:()=>number;
  private readonly botCall:SlackApi['call'];private readonly appCall:SlackApi['call'];private readonly tick:(signal:AbortSignal)=>Promise<unknown>;
  private readonly onError:((kind:string)=>void)|undefined;private readonly minimum:number;private readonly maximum:number;private readonly interval:number;
  constructor(options:SocketOptions){
    this.options=options;const node=options.socket&&options.schedule&&options.monotonicNow?undefined:createNodeCommunicationsEnvironment();
    this.socket=options.socket??node!.socket;this.schedule=options.schedule??node!.schedule;this.now=captureMonotonicClock(options.monotonicNow??node!.monotonicNow);
    this.botCall=options.botApi.call.bind(options.botApi);this.appCall=options.appApi.call.bind(options.appApi);this.tick=options.recovery.tick.bind(options.recovery);
    this.onError=options.onError;this.minimum=options.reconnectMinMs??250;this.maximum=options.reconnectMaxMs??30000;this.interval=options.recoveryIntervalMs??1000;
    invariant(Number.isSafeInteger(this.minimum)&&this.minimum>0&&Number.isSafeInteger(this.maximum)&&this.maximum>=this.minimum&&this.maximum<=2147483647,'invalid Socket Mode reconnect bounds');
    invariant(Number.isSafeInteger(this.interval)&&this.interval>0&&this.interval<=2147483647,'invalid Socket Mode recovery interval');
  }
  start():void {invariant(!this.controller,'Socket Mode already started');const controller=new AbortController();this.controller=controller;this.completion=this.run(controller);void this.completion.catch(()=>{});}
  async stop():Promise<void>{const completion=this.completion;this.controller?.abort();try{await completion;}finally{if(this.completion===completion){this.controller=undefined;this.completion=undefined;}}}
  private async run(controller:AbortController):Promise<void>{
    const guard=async(work:Promise<void>)=>{try{await work;}catch(error){controller.abort();throw error;}};
    const settled=await Promise.allSettled([guard(this.connections(controller.signal)),guard(this.recover(controller.signal))]);
    const errors=settled.filter((r):r is PromiseRejectedResult=>r.status==='rejected').map(r=>r.reason as unknown);
    if(errors.length===1)throw errors[0];if(errors.length>1)throw new AggregateError(errors,'communications background cleanup failed');
  }
  private async wait(ms:number,signal:AbortSignal):Promise<boolean>{
    if(signal.aborted)return false;
    try{const schedule=this.schedule;await communicationDelay(schedule,ms,signal);return !signal.aborted;}
    catch(error){if(signal.aborted&&error===signal.reason)return false;throw error;}
  }
  private async recover(signal:AbortSignal):Promise<void>{
    while(!signal.aborted){try{const tick=this.tick;await tick(signal);}catch(error){if(signal.aborted){if(error===signal.reason)return;throw error;}const onError=this.onError;onError?.('recovery_failed');}if(!await this.wait(this.interval,signal))return;}
  }
  private async connections(signal:AbortSignal):Promise<void>{
    let backoff=this.minimum;
    while(!signal.aborted){
      let connectedAt:number|undefined;
      try{
        const botCall=this.botCall,appCall=this.appCall;
        const auth=await botCall<{team_id:string;user_id:string}>('auth.test',{},signal);signal.throwIfAborted();
        invariant(auth.team_id===this.options.ingress.options.teamId && auth.user_id===this.options.ingress.options.botUserId,'Slack token identity mismatch');
        const link=await appCall<{url:string}>('apps.connections.open',{},signal);signal.throwIfAborted();
        const url=new URL(link.url);invariant(url.protocol==='wss:' && url.hostname.endsWith('.slack.com'),'untrusted Socket Mode link');
        // Clock failures are lifecycle failures, not a manufactured reconnect duration.
        try{const now=this.now;connectedAt=now();}catch(error){throw new LifecycleFailure(error);}
        await this.connected(link.url,signal);
      }catch(error){if(error instanceof LifecycleFailure)throw error;if(signal.aborted){if(error===signal.reason)return;throw error;}const onError=this.onError;onError?.('socket_connection_failed');}
      if(connectedAt!==undefined){const now=this.now;if(now()-connectedAt>=30000)backoff=this.minimum;}
      if(!await this.wait(backoff,signal))return;
      backoff=Math.min(this.maximum,backoff*2);
    }
  }
  private async connected(url:string,signal:AbortSignal):Promise<void>{
    signal.throwIfAborted();const factory=this.socket,socket=factory(url);
    const add=socket.addEventListener.bind(socket),remove=socket.removeEventListener?.bind(socket),send=socket.send.bind(socket),close=socket.close.bind(socket);
    await new Promise<void>((resolve,reject)=>{
      let finished=false;const attached:Array<[string,(event:any)=>void]>=[];
      const finish=(error?:unknown)=>{
        if(finished)return;finished=true;const errors:unknown[]=[];
        signal.removeEventListener('abort',abort);
        for(const [type,listener] of attached){try{remove?.(type,listener);}catch(e){errors.push(e);}}
        try{close();}catch(e){errors.push(e);}
        if(errors.length){if(error!==undefined)errors.unshift(error);reject(new LifecycleFailure(new AggregateError(errors,'socket cleanup failed')));}
        else if(error!==undefined)reject(error);else resolve();
      };
      const abort=()=>finish(),closed=()=>finish(),failed=()=>finish(new Error('socket error'));
      const message=(event:{data:string})=>{
        if(finished||signal.aborted)return;
        try{
          const envelope=JSON.parse(event.data) as {type?:string;envelope_id?:string;payload?:{team_id:string;event:SlackEvent}};
          if(envelope.type==='disconnect'){finish();return;}
          if(envelope.type==='events_api'){
            invariant(envelope.payload && typeof envelope.payload.team_id==='string' && envelope.payload.event && typeof envelope.payload.event.type==='string','malformed Slack event envelope');
            this.options.ingress.acceptAuthenticated(envelope.payload.team_id,envelope.payload.event);
          }
          if(envelope.envelope_id)send(JSON.stringify({envelope_id:envelope.envelope_id}));
        }catch{try{const onError=this.onError;onError?.('socket_intake_rejected');}catch(error){finish(new LifecycleFailure(error));}/* No ACK after failed persistence. */}
      };
      signal.addEventListener('abort',abort,{once:true});if(signal.aborted){finish();return;}
      try{for(const [type,listener] of [['close',closed],['error',failed],['message',message]] as const){attached.push([type,listener]);add(type,listener);if(finished)break;}}
      catch(error){finish(error);}
    });
  }
}
