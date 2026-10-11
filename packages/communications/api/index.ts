import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { invariant, nonempty } from '../../contracts/common.ts';
import { CommunicationsCore } from '../core/index.ts';
import type { Principal } from '../core/index.ts';

export interface ApiCredential { token: string; principal: Principal }
export function bearerAuthenticator(credentials: readonly ApiCredential[]): (request: IncomingMessage) => Principal | undefined {
  credentials.forEach(c => nonempty(c.token,'API credential'));
  return request => { const value = request.headers.authorization; if (!value?.startsWith('Bearer ')) return; const bytes = Buffer.from(value.slice(7)); return credentials.find(c => {const expected=Buffer.from(c.token);return bytes.length===expected.length && timingSafeEqual(bytes,expected);})?.principal; };
}
async function body(request: IncomingMessage, maxBytes: number): Promise<Record<string,unknown>> {
  const chunks: Buffer[] = []; let size=0;
  for await (const chunk of request) {size+=chunk.length;invariant(size<=maxBytes,'request too large');chunks.push(Buffer.from(chunk));}
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8')); invariant(typeof value==='object' && value!==null && !Array.isArray(value),'JSON object required');return value as Record<string,unknown>;
}
function respond(response: ServerResponse, status: number, value: unknown): void {response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify(value));}
export function createDirectApi(options: {core: CommunicationsCore; authenticate: (request:IncomingMessage)=>Principal|undefined; maxBodyBytes?:number;outputForRun?:(runId:string)=>unknown|Promise<unknown>;health?:()=>unknown}): Server {
  return createServer((request,response)=>{void (async()=>{
    const actor=options.authenticate(request);if(!actor){respond(response,401,{error:'authentication required'});return;}
    const path=new URL(request.url ?? '/', 'http://localhost').pathname;
    if(request.method==='GET' && path==='/health' && options.health){respond(response,200,options.health());return;}
    const output=/^\/runs\/([^/]+)\/output$/.exec(path);
    if(request.method==='GET' && output && options.outputForRun){const runId=decodeURIComponent(output[1]!);options.core.status(runId,actor);respond(response,200,await options.outputForRun(runId));return;}
    const status=/^\/runs\/([^/]+)$/.exec(path);
    if(request.method==='GET' && status){respond(response,200,options.core.status(decodeURIComponent(status[1]!),actor));return;}
    if(request.method!=='POST' || path!=='/inputs'){respond(response,404,{error:'unknown route'});return;}
    const value=await body(request,options.maxBodyBytes ?? 65536);
    invariant(Object.keys(value).every(k=>['externalId','revision','conversation','text','targetRunId','control'].includes(k)),'unknown or privileged input field');
    for(const key of ['externalId','revision','conversation','text'] as const) invariant(typeof value[key]==='string',`${key} must be string`);
    invariant(/^\d+$/.test(value.revision as string) && Number.isSafeInteger(Number(value.revision)), 'revision must be a safe integer string');
    if(value.targetRunId!==undefined) nonempty(value.targetRunId,'targetRunId');
    invariant(value.control===undefined || value.control==='status' || value.control==='cancel','unknown control');
    const result=options.core.receive({source:'direct',externalId:`${actor.id}:${value.externalId as string}`,revision:value.revision as string,conversation:`direct:${actor.id}:${value.conversation as string}`,text:value.text as string,actor,...(value.targetRunId?{targetRunId:value.targetRunId as string}:{}),...(value.control?{control:value.control as 'cancel'|'status'}:{})});
    respond(response,202,result);
  })().catch(()=>{if(!response.headersSent)respond(response,400,{error:'request rejected'});else response.end();});});
}
