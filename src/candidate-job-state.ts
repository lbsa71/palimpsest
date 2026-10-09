import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IsolationDrain, IsolationSpawnDescriptor } from './isolation-ownership.ts';

export type JobStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'rejected' | 'held';
export interface JobChild { id:string; state:'intent'|'spawned'|'drained'; pid:number|null; descriptorDigest:string; program:string; scratch:string; outcome?:IsolationDrain }
export interface CandidateJobReceipt {
 version:1; jobId:string; inputDigest:string; operation:string; createdAt:string; status:JobStatus;
 outer:{state:'intent'|'spawned'|'drained';pid:number|null}; nested:JobChild[]; resultDigest?:string; reason?:string;
}
export const jobHash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
/** Flush each private record before atomic visibility; no hard power-loss claim. */
export function writeJobJson(path:string,value:unknown):void {
 const bytes=Buffer.from(JSON.stringify(value));const temporary=`${path}.${randomUUID()}.tmp`;
 const fd=openSync(temporary,'wx',0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
 renameSync(temporary,path);
 const directory=openSync(join(path,'..'),'r');try{fsyncSync(directory);}finally{closeSync(directory);}
}
export function readJobJson<T>(path:string,maxBytes=262_144):T {
 const stat=statSync(path);if(!stat.isFile()||stat.size>maxBytes)throw new Error('Invalid or oversized candidate job record');
 return JSON.parse(readFileSync(path,'utf8')) as T;
}
/** Parent and helper own separate records: no cross-process read/modify/write. */
export class CandidateJobState {
 readonly directory:string;
 constructor(directory:string){this.directory=directory;}
 initialize(receipt:CandidateJobReceipt):void {
  // Publish the pair atomically so a simultaneous status observer cannot see
  // a new job directory with its receipt or nested ledger still absent.
  const staging=`${this.directory}.initializing-${randomUUID()}`;mkdirSync(staging,{mode:0o700});
  writeJobJson(join(staging,'receipt.json'),receipt);writeJobJson(join(staging,'nested.json'),[]);renameSync(staging,this.directory);
  const parent=openSync(join(this.directory,'..'),'r');try{fsyncSync(parent);}finally{closeSync(parent);}
 }
 receipt():CandidateJobReceipt {const receipt=readJobJson<CandidateJobReceipt>(join(this.directory,'receipt.json'));return{...receipt,nested:this.nested()};}
 nested():JobChild[]{return readJobJson<JobChild[]>(join(this.directory,'nested.json'));}
 update(patch:Partial<CandidateJobReceipt>):void {const receipt=readJobJson<CandidateJobReceipt>(join(this.directory,'receipt.json'));writeJobJson(join(this.directory,'receipt.json'),{...receipt,...patch,nested:[]});}
 beforeSpawn(descriptor:IsolationSpawnDescriptor):string {
  const children=this.nested();if(children.length>=16)throw new Error('Candidate job child limit exceeded');
  const id=`child-${children.length+1}`;
  children.push({id,state:'intent',pid:null,descriptorDigest:jobHash(JSON.stringify(descriptor)),program:descriptor.program,scratch:descriptor.scratch});
  writeJobJson(join(this.directory,'nested.json'),children);return id;
 }
 spawned(id:string,pid:number|undefined):void {
  if(!Number.isSafeInteger(pid)||!pid||pid<1)throw new Error('Candidate child PID is unknown');
  const children=this.nested(),child=children.find(item=>item.id===id);
  if(!child||child.state!=='intent')throw new Error('Candidate child receipt conflicts');
  child.state='spawned';child.pid=pid;writeJobJson(join(this.directory,'nested.json'),children);
 }
 drained(id:string,outcome:IsolationDrain):void {
  const children=this.nested(),child=children.find(item=>item.id===id);
  if(!child||child.state!=='spawned'||!child.pid)throw new Error('Candidate child drain lacks identity');
  child.state='drained';child.outcome={...outcome};writeJobJson(join(this.directory,'nested.json'),children);
 }
 allDrained():boolean {return this.nested().every(child=>child.state==='drained'&&Number.isSafeInteger(child.pid)&&child.pid!==null&&child.pid>0&&!existsSync(child.scratch));}
}
