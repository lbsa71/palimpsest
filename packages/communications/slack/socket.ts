import { setTimeout as delay } from 'node:timers/promises';
import { invariant } from '../../contracts/common.ts';
import type { SlackApi } from './client.ts';
import { SlackIngress } from './ingress/index.ts';
import type { SlackEvent } from './ingress/index.ts';
import { SlackRecovery } from './recovery/index.ts';

export interface SocketLike {addEventListener(type:string,listener:(event:any)=>void,options?:{once?:boolean}):void;send(data:string):void;close():void}
export interface SocketOptions {botApi:SlackApi;appApi:SlackApi;ingress:SlackIngress;recovery:SlackRecovery;socket?:(url:string)=>SocketLike;reconnectMinMs?:number;reconnectMaxMs?:number;recoveryIntervalMs?:number;onError?:(kind:string)=>void}
/** Authenticated ephemeral Socket Mode links, durable intake before ACK, automatic catch-up. */
export class SlackSocketMode {
  readonly options:SocketOptions;private controller?:AbortController;private active?:SocketLike;private completion?:Promise<void>;
  constructor(options:SocketOptions){this.options=options;}
  start():void {invariant(!this.controller,'Socket Mode already started');const controller=new AbortController();this.controller=controller;this.completion=this.run(controller.signal);}
  async stop():Promise<void>{this.controller?.abort();this.active?.close();await this.completion;this.controller=undefined;}
  private async run(signal:AbortSignal):Promise<void>{
    await Promise.all([this.connections(signal),this.recover(signal)]);
  }
  private async recover(signal:AbortSignal):Promise<void>{
    while(!signal.aborted){try{await this.options.recovery.tick(signal);}catch{if(!signal.aborted)this.options.onError?.('recovery_failed');}try{await delay(this.options.recoveryIntervalMs??1000,undefined,{signal});}catch{return;}}
  }
  private async connections(signal:AbortSignal):Promise<void>{
    let backoff=this.options.reconnectMinMs??250;
    while(!signal.aborted){
      try{
        const auth=await this.options.botApi.call<{team_id:string;user_id:string}>('auth.test',{},signal);
        invariant(auth.team_id===this.options.ingress.options.teamId && auth.user_id===this.options.ingress.options.botUserId,'Slack token identity mismatch');
        const link=await this.options.appApi.call<{url:string}>('apps.connections.open',{},signal);
        const url=new URL(link.url);invariant(url.protocol==='wss:' && url.hostname.endsWith('.slack.com'),'untrusted Socket Mode link');
        const connectedAt=Date.now();await this.connected(link.url,signal);
        if(Date.now()-connectedAt>=30000)backoff=this.options.reconnectMinMs??250;
      }catch{if(!signal.aborted)this.options.onError?.('socket_connection_failed');}
      try{await delay(backoff,undefined,{signal});}catch{return;}
      backoff=Math.min(this.options.reconnectMaxMs??30000,backoff*2);
    }
  }
  private async connected(url:string,signal:AbortSignal):Promise<void>{
    const socket=(this.options.socket??(u=>new WebSocket(u)))(url);this.active=socket;
    await new Promise<void>((resolve,reject)=>{
      let finished=false;const finish=(error?:Error)=>{if(finished)return;finished=true;signal.removeEventListener('abort',abort);socket.close();this.active=undefined;error?reject(error):resolve();};
      const abort=()=>finish();signal.addEventListener('abort',abort,{once:true});if(signal.aborted){finish();return;}
      socket.addEventListener('close',()=>finish(),{once:true});socket.addEventListener('error',()=>finish(new Error('socket error')),{once:true});
      socket.addEventListener('message',(event:{data:string})=>{
        try{
          const envelope=JSON.parse(event.data) as {type?:string;envelope_id?:string;payload?:{team_id:string;event:SlackEvent}};
          if(envelope.type==='disconnect'){finish();return;}
          if(envelope.type==='events_api'){
            invariant(envelope.payload && typeof envelope.payload.team_id==='string' && envelope.payload.event && typeof envelope.payload.event.type==='string','malformed Slack event envelope');
            this.options.ingress.acceptAuthenticated(envelope.payload.team_id,envelope.payload.event);
          }
          if(envelope.envelope_id)socket.send(JSON.stringify({envelope_id:envelope.envelope_id}));
        }catch{this.options.onError?.('socket_intake_rejected');/* No ACK after failed persistence. Slack retry/backfill can recover. */}
      });
    });
  }
}
