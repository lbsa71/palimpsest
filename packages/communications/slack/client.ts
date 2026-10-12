import { invariant, nonempty } from '../../contracts/common.ts';
import { communicationTimeout, createNodeCommunicationsEnvironment } from '../environment.ts';
import type { CommunicationSchedule } from '../environment.ts';

export class SlackError extends Error {
  readonly code: string; readonly retryAfterMs: number | undefined;
  constructor(code:string,retryAfterMs?:number){super(`Slack API: ${code}`);this.code=code;this.retryAfterMs=retryAfterMs;}
}
export interface SlackMessage { ts: string; text?: string; user?: string; bot_id?: string; subtype?: string; thread_ts?: string; reply_count?: number; edited?: {ts:string;user?:string}; client_msg_id?: string }
export interface SlackPage { messages: SlackMessage[]; response_metadata?: {next_cursor?:string}; has_more?:boolean; is_limited?:boolean }
export interface SlackApi { call<T>(method:string,parameters:Record<string,string>,signal?:AbortSignal):Promise<T> }
/** No automatic write retries: a network error after dispatch is an unknown effect. */
export class SlackClient implements SlackApi {
  readonly token:string; readonly fetch:typeof fetch; readonly endpoint:string; readonly timeoutMs:number;readonly maxResponseBytes:number;
  private readonly transport:typeof fetch;private readonly schedule:CommunicationSchedule;
  constructor(options:{token:string;fetch?:typeof fetch;schedule?:CommunicationSchedule;endpoint?:string;timeoutMs?:number;maxResponseBytes?:number}){const node=options.fetch&&options.schedule?undefined:createNodeCommunicationsEnvironment();nonempty(options.token,'Slack token');this.token=options.token;this.fetch=options.fetch??node!.fetch;this.transport=this.fetch;this.schedule=options.schedule??node!.schedule;this.endpoint=options.endpoint??'https://slack.com/api/';this.timeoutMs=options.timeoutMs??15000;this.maxResponseBytes=options.maxResponseBytes??4*1024*1024;invariant(Number.isSafeInteger(this.maxResponseBytes)&&this.maxResponseBytes>0,'positive Slack response bound required');}
  async call<T>(method:string,parameters:Record<string,string>,signal?:AbortSignal):Promise<T>{
    invariant(/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(method),'invalid Slack method');
    signal?.throwIfAborted();
    const timeout=communicationTimeout(this.schedule,this.timeoutMs,signal);
    const failures:unknown[]=[];
    let responseBody:ReadableStream<Uint8Array>|null=null;
    let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
    let consumed=false;
    let result!:T;
    try {
      const transport=this.transport;
      const response=await transport(`${this.endpoint}${method}`,{method:'POST',redirect:'error',headers:{authorization:`Bearer ${this.token}`,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(parameters),signal:timeout.signal});
      // Own the body before any status or cancellation check can exit the request.
      responseBody=response.body;
      timeout.signal.throwIfAborted();
      if(response.status===429){const seconds=Number(response.headers.get('retry-after'));throw new SlackError('ratelimited',Number.isFinite(seconds)&&seconds>=0?seconds*1000:1000);}
      if(!response.ok)throw new SlackError(`http_${response.status}`);
      reader=responseBody?.getReader();invariant(reader,'Slack response body absent');
      const chunks:Uint8Array[]=[];let size=0;
      for(;;){
        const part=await reader.read();
        if(part.done)consumed=true;
        timeout.signal.throwIfAborted();
        if(part.done)break;
        size+=part.value.byteLength;
        invariant(size<=this.maxResponseBytes,'Slack response exceeds configured byte bound');
        chunks.push(part.value);
      }
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8')) as {ok?:boolean;error?:string};
      if(body.ok!==true)throw new SlackError(body.error??'malformed_response');
      result=body as T;
    } catch(error){failures.push(error);} finally {
      // Each cleanup is attempted once, even when an earlier operation/cleanup failed.
      if(responseBody&&!consumed){try{if(reader)await reader.cancel();else await responseBody.cancel();}catch(error){failures.push(error);}}
      if(reader){try{reader.releaseLock();}catch(error){failures.push(error);}}
      try{timeout.cancel();}catch(error){failures.push(error);}
    }
    if(failures.length===1)throw failures[0];
    if(failures.length>1)throw new AggregateError(failures,'Slack request cleanup failed',{cause:failures[0]});
    return result;
  }
}
