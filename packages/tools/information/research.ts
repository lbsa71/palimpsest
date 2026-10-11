import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';
import { invariant } from '../../contracts/common.ts';
import type { JsonValue } from '../../contracts/common.ts';
export interface ResearchPolicy { allowedHosts: string[]; timeoutMs: number; maxBytes: number; maxRedirects: number }
/** Reject nonpublic ranges, including IPv4-mapped IPv6. DNS results are pinned in the actual socket lookup. */
export function isPublicAddress(address: string): boolean {
  const lower=address.toLowerCase();
  if(lower.startsWith('::ffff:')) {
    const tail=lower.slice(7);
    if(isIP(tail)===4)return isPublicAddress(tail);
    const pair=tail.split(':');
    if(pair.length===2) { const n=(parseInt(pair[0]!,16)*65536+parseInt(pair[1]!,16))>>>0;return isPublicAddress(`${n>>>24}.${(n>>>16)&255}.${(n>>>8)&255}.${n&255}`); }
    return false;
  }
  if(isIP(address)===4) {
    const [a,b]=address.split('.').map(Number);
    return !(a===0||a===10||a===127||a!>=224||a===169&&b===254||a===172&&b!>=16&&b!<=31||a===192&&(b===168||b===0||b===2)||a===100&&b!>=64&&b!<=127||a===198&&(b===18||b===19||b===51)||a===203&&b===0);
  }
  // Only global-unicast IPv6, excluding documentation and transition/tunnel ranges.
  return isIP(address)===6 && /^[23]/.test(lower) && !lower.startsWith('2001:db8:') && !lower.startsWith('2001:0:') && !lower.startsWith('2002:') && !(lower.startsWith('2001:')&&parseInt(lower.split(':')[1]!,16)<0x200);
}
export function validateResearchUrl(raw: string, policy: ResearchPolicy): URL {
  const url=new URL(raw);
  invariant(url.protocol==='https:' && !url.username && !url.password && (!url.port||url.port==='443'),'public HTTPS without credentials required');
  invariant(policy.allowedHosts.includes(url.hostname.toLowerCase()),'research host is not granted');
  const address=url.hostname.replace(/^\[|\]$/g,'');
  if(isIP(address))invariant(isPublicAddress(address),'private address rejected');
  return url;
}
async function interruptible<T>(promise:Promise<T>,signal:AbortSignal):Promise<T> {
  signal.throwIfAborted();let abort:()=>void=()=>{};
  try{return await Promise.race([promise,new Promise<never>((_resolve,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();})]);}
  finally{signal.removeEventListener('abort',abort);}
}
export async function fetchPublic(raw: string, policy: ResearchPolicy, signal?: AbortSignal): Promise<JsonValue> {
  invariant(Number.isSafeInteger(policy.maxBytes)&&policy.maxBytes>0 && Number.isSafeInteger(policy.timeoutMs)&&policy.timeoutMs>0 && Number.isSafeInteger(policy.maxRedirects)&&policy.maxRedirects>=0&&policy.maxRedirects<=10,'finite research limits required');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new Error('research timeout')),policy.timeoutMs);
  const abort=()=>controller.abort(signal?.reason);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const sources: string[]=[];
  try {
    let url=validateResearchUrl(raw,policy);
    for(let redirects=0;;redirects++) {
      controller.signal.throwIfAborted();
      const addresses=await interruptible(lookup(url.hostname.replace(/^\[|\]$/g,''),{all:true}),controller.signal);
      invariant(addresses.length>0&&addresses.every(a=>isPublicAddress(a.address)),'DNS includes private or nonpublic address');
      controller.signal.throwIfAborted();
      const pinned=addresses[0]!;sources.push(url.href);
      const response=await new Promise<{status:number;location?:string;contentType:string;body:string}>((resolve,reject)=> {
        const req=request(url,{method:'GET',family:pinned.family,signal:controller.signal,headers:{'user-agent':'Palimpsest-Aeon1-Research','accept':'text/plain,text/html,application/json'},lookup:(_hostname,_options,callback)=>callback(null,pinned.address,pinned.family)},res=> {
          const buffers:Buffer[]=[];let bytes=0;
          res.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>policy.maxBytes){req.destroy(new Error('research response exceeds byte limit'));res.destroy();}else buffers.push(chunk);});
          res.once('error',reject);res.once('end',()=>resolve({status:res.statusCode??0,location:res.headers.location,contentType:res.headers['content-type']??'',body:Buffer.concat(buffers).toString('utf8')}));
        });req.once('error',reject);req.end();
      });
      if([301,302,303,307,308].includes(response.status)) {
        invariant(redirects<policy.maxRedirects && response.location,'redirect limit or missing target');
        url=validateResearchUrl(new URL(response.location,url).href,policy);continue;
      }
      invariant(response.status>=200&&response.status<300,`research HTTP ${response.status}`);
      return {url:url.href,requestedUrl:raw,redirectChain:sources,status:response.status,contentType:response.contentType,body:response.body,recordedAt:new Date().toISOString(),derivation:'observed',instructionAuthority:false};
    }
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
