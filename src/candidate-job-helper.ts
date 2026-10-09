import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import { CandidateJobState, jobHash, readJobJson, writeJobJson } from './candidate-job-state.ts';
import { withFiniteIsolationExecutor } from './isolation-executor.ts';
import type { IsolationResult } from './isolation.ts';
import type { CandidateJobEnvelope, CandidateJobOutput, CandidateIsolationRequest } from './candidate-jobs.ts';

const directory=process.argv[2];if(!directory)throw new Error('Fixed candidate helper needs its private job directory');
const state=new CandidateJobState(directory),controller=new AbortController(),decoder=new StringDecoder('utf8');
const request=readJobJson<CandidateJobEnvelope>(join(directory,'request.json'),33_554_432);
const{inputDigest,...body}=request;
if(inputDigest!==jobHash(JSON.stringify(body))||request.optionsDigest!==jobHash(JSON.stringify(request.operation))
 ||request.directory!==directory||request.version!==1||request.installedDigest!==jobHash(JSON.stringify(request.installed)))throw new Error('Candidate helper request identity mismatch');
for(const file of request.installed.files){if(createHash('sha256').update(readFileSync(file.path)).digest('hex')!==file.sha256)throw new Error('Installed collector identity changed');}
if(request.installed.nodePath!==process.execPath||request.installed.nodeVersion!==process.version)throw new Error('Candidate helper runtime mismatch');
if(request.installed.evaluatorPath!==fileURLToPath(new URL('./candidates.ts',import.meta.url)))throw new Error('Fixed collector module mismatch');
if(request.installed.developerDir)process.env.DEVELOPER_DIR=request.installed.developerDir;
let buffer='',sequence=0,pending:{sequence:number;optionsDigest:string;resolve:(result:IsolationResult)=>void;reject:(error:Error)=>void}|undefined;
const fail=()=>{controller.abort();pending?.reject(new Error('Candidate broker cancelled or invalid'));pending=undefined;};
process.stdin.on('data',(chunk:Buffer)=>{
 try {
  buffer+=decoder.write(chunk);if(Buffer.byteLength(buffer)>2_097_152)throw new Error('Oversized broker control');
  let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);const frame=JSON.parse(line);
   if(frame.kind==='cancel'){fail();continue;}
   if(!pending||frame.kind!=='isolation-result'||frame.jobId!==request.jobId||frame.inputDigest!==inputDigest||frame.sequence!==pending.sequence||frame.optionsDigest!==pending.optionsDigest)throw new Error('Broker reply identity mismatch');
   const current=pending;pending=undefined;
   if(frame.status==='completed'&&frame.result&&frame.resultDigest===jobHash(JSON.stringify(frame.result)))current.resolve(frame.result);
   else{controller.abort();current.reject(new Error('Parent isolated checker failed'));}
  }
 }catch{fail();}
});
process.stdin.on('end',fail);
const candidate=await import('./candidates.ts');
const receipt=state.receipt();if(receipt.inputDigest!==inputDigest||receipt.jobId!==request.jobId)throw new Error('Helper receipt mismatch');
const targetCurrent=()=>{if(request.target&&jobHash(readFileSync(join(request.target.releaseDir,'manifest.json')))!==request.target.fileDigest)throw new Error('Candidate target manifest changed');};
let output:CandidateJobOutput;
try {
 targetCurrent();
 const result=await withFiniteIsolationExecutor(async options=>{
  if(controller.signal.aborted||pending||++sequence>16)throw new Error('Candidate broker unavailable');
  const optionsDigest=jobHash(JSON.stringify(options));
  const frame:CandidateIsolationRequest={version:1,kind:'isolate',jobId:request.jobId,inputDigest,sequence,optionsDigest,options};
  const encoded=JSON.stringify(frame);if(Buffer.byteLength(encoded)>2_097_152)throw new Error('Candidate broker request exceeds bound');
  return await new Promise<IsolationResult>((resolve,reject)=>{pending={sequence,optionsDigest,resolve,reject};process.stdout.write(encoded+'\n');});
 },async()=>{
  const operation=request.operation;if(controller.signal.aborted)throw new Error('Candidate job cancelled');
  switch(operation.kind){
   case'challenge':return await candidate.evaluateChallenge(operation.options);
   case'freeze':{const frozen=candidate.freezeCandidate({...operation.options,dataDir:join(directory,'stage')});return candidate.verifyFrozenCandidate({repositoryRoot:operation.options.repositoryRoot,releaseDir:frozen.releaseDir});}
   case'evaluate':return await candidate.evaluateCandidate(operation.options);
   case'verify':return candidate.verifyFrozenCandidate(operation.options);
  }
 });
 targetCurrent();if(controller.signal.aborted||!state.allDrained())throw new Error('Candidate job did not finish and drain');
 output={version:1,jobId:request.jobId,inputDigest,optionsDigest:request.optionsDigest,installedDigest:request.installedDigest,status:'completed',result,resultDigest:jobHash(JSON.stringify(result))};
}catch{output={version:1,jobId:request.jobId,inputDigest,optionsDigest:request.optionsDigest,installedDigest:request.installedDigest,status:controller.signal.aborted?'cancelled':'failed'};}
if(Buffer.byteLength(JSON.stringify(output))>4_194_304)throw new Error('Candidate job result exceeds bound');
writeJobJson(join(directory,'output.json'),output);process.stdin.pause();process.stdin.destroy();
