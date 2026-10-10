import { randomUUID, createHash } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import { digestJson } from './candidates.ts';
import type { CandidateCheck, CandidateEvidence, CandidateManifest, FreezeOptions, VerifyOptions, evaluateChallenge } from './candidates.ts';
import { resolveExternalPath } from './config.ts';
import { runIsolated } from './isolation.ts';
import type { IsolationOptions, IsolationResult } from './isolation.ts';
import { linuxIsolationIdentity } from './isolation-linux.ts';
import { withIsolationOwnership } from './isolation-ownership.ts';
import { CoordinatorLock } from './ownership.ts';
import type { Json } from './store.ts';
import { CandidateJobState, jobHash, readJobJson, writeJobJson } from './candidate-job-state.ts';
import type { CandidateJobReceipt } from './candidate-job-state.ts';

export type CandidateJobOperation =
 |{kind:'freeze';options:FreezeOptions}
 |{kind:'verify';options:VerifyOptions}
 |{kind:'challenge';options:Parameters<typeof evaluateChallenge>[0]}
 |{kind:'evaluate';options:Pick<VerifyOptions,'repositoryRoot'|'releaseDir'|'expectedLegacyManifestDigest'>&{timeoutMs?:number}};
export type CandidateJobValue<T extends CandidateJobOperation> = T extends {kind:'challenge'}?CandidateCheck:T extends {kind:'evaluate'}?CandidateEvidence:CandidateManifest;
export interface CandidateJobControl {jobId?:string;signal?:AbortSignal;deadlineMs?:number;binding?:Json;validateBinding?:()=>void|Promise<void>}
interface CandidateJobTarget {releaseDir:string;candidateId:string;manifestDigest:string;baseCommit:string;sourceDigest:string;fileDigest:string}
interface InstalledIdentity {nodePath:string;nodeVersion:string;evaluatorPath:string;developerDir?:string;files:{path:string;sha256:string}[]}
export interface CandidateJobEnvelope {version:1;jobId:string;directory:string;operation:CandidateJobOperation;binding:Json;target?:CandidateJobTarget;optionsDigest:string;installed:InstalledIdentity;installedDigest:string;inputDigest:string}
export interface CandidateIsolationRequest {version:1;kind:'isolate';jobId:string;inputDigest:string;sequence:number;optionsDigest:string;options:IsolationOptions}
export interface CandidateJobOutput {version:1;jobId:string;inputDigest:string;optionsDigest:string;installedDigest:string;status:'completed'|'failed'|'cancelled';result?:CandidateManifest|CandidateEvidence|CandidateCheck;resultDigest?:string}
export class CandidateJobError extends Error {
 readonly status:'failed'|'held'|'cancelled';readonly jobId:string;
 constructor(status:'failed'|'held'|'cancelled',jobId:string,message:string){super(message);this.name='CandidateJobError';this.status=status;this.jobId=jobId;}
}
const installedRoot=fileURLToPath(new URL('..',import.meta.url));
const helperPath=join(installedRoot,'src/candidate-job-helper.ts');
const evaluatorPath=join(installedRoot,'src/candidates.ts');
const hashFile=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
const deadline=(value:number)=>{if(!Number.isSafeInteger(value)||value<1||value>299_000)throw new Error('Candidate observation deadline must be 1–299000ms');return value;};

/** Fixed trusted collector backend. A held rejection is NOT a drain receipt. */
export class CandidateJobs {
 readonly #repositoryRoot:string;readonly #directory:string;readonly #deadlineMs:number;
 #busy=false;
 constructor(options:{repositoryRoot:string;dataDir:string;deadlineMs?:number}) {
  this.#repositoryRoot=realpathSync(options.repositoryRoot);
  this.#directory=resolveExternalPath(this.#repositoryRoot,join(options.dataDir,'candidate-jobs'));
  this.#deadlineMs=deadline(options.deadlineMs??240_000);mkdirSync(this.#directory,{recursive:true,mode:0o700});
 }
 inspect():CandidateJobReceipt[]{
  return readdirSync(this.#directory).filter(name=>/^[a-f0-9]{64}$/.test(name)).map(name=>new CandidateJobState(join(this.#directory,name)).receipt()).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).slice(-64);
 }
 async run<T extends CandidateJobOperation>(operation:T,control:CandidateJobControl={}):Promise<CandidateJobValue<T>> {
  // Copy before the first await, including all nested draft/tool options.
  const copy=JSON.parse(JSON.stringify(operation)) as T,binding=JSON.parse(JSON.stringify(control.binding??null)) as Json;
  if(!copy||!['freeze','verify','challenge','evaluate'].includes(copy.kind)||realpathSync(copy.options.repositoryRoot)!==this.#repositoryRoot)throw new Error('Candidate job requires the configured trusted repository');
  const jobId=control.jobId??randomUUID();if(typeof jobId!=='string'||!jobId.trim()||jobId.length>240)throw new Error('Invalid candidate job ID');
  const duration=deadline(control.deadlineMs??this.#deadlineMs);
  if(control.signal?.aborted)throw new CandidateJobError('cancelled',jobId,'Candidate collection cancelled before launch');
  if(this.#busy)throw new CandidateJobError('held',jobId,'Another candidate collection owns this backend');
  const lock=new CoordinatorLock(join(this.#directory,'ownership.sqlite'));this.#busy=true;
  const activePath=join(this.#directory,'active.json');let state:CandidateJobState|undefined;
  try {
   if(existsSync(activePath)) {
    const active=readJobJson<{jobId:string}>(activePath),previous=new CandidateJobState(join(this.#directory,jobHash(active.jobId))),receipt=previous.receipt();
    if(receipt.outer.state==='drained'&&previous.allDrained()&&['completed','failed','cancelled','rejected'].includes(receipt.status))unlinkSync(activePath);
    else{previous.update({status:'held',reason:'Prior collection lacks a complete drain receipt; no replay'});throw new CandidateJobError('held',active.jobId,'Prior candidate collection requires reconciliation');}
   }
   const directory=join(this.#directory,jobHash(jobId));if(existsSync(directory))throw new CandidateJobError('held',jobId,'Candidate job IDs cannot be replayed');
   state=new CandidateJobState(directory);
   const compiler=realpathSync(join(installedRoot,'node_modules','@typescript',`typescript-${process.platform}-${process.arch}`,'lib/tsc'));
   const developer=existsSync('/var/select/developer_dir')?realpathSync('/var/select/developer_dir'):undefined;
   const selectedGit=developer?join(developer,'usr/bin/git'):undefined;
   const programs=[...(selectedGit?[selectedGit,join(developer!,'usr/bin/xcodebuild')]:[]),'/usr/bin/git','/bin/sh','/bin/bash','/usr/bin/xcrun'].filter(existsSync).map(path=>realpathSync(path));
   const isolationFiles=process.platform==='linux'?linuxIsolationIdentity():['/usr/bin/sandbox-exec'];
   const files=[...(existsSync('/usr/share/firmlinks')?['/usr/share/firmlinks']:[]),process.execPath,...isolationFiles,compiler,join(installedRoot,'trusted/agent-contract.test.mjs'),join(installedRoot,'trusted/development-contract.test.mjs'),evaluatorPath,helperPath,join(installedRoot,'src/candidate-job-state.ts'),join(installedRoot,'src/candidate-jobs.ts'),join(installedRoot,'src/config.ts'),join(installedRoot,'src/ownership.ts'),join(installedRoot,'src/isolation.ts'),join(installedRoot,'src/isolation-linux.ts'),join(installedRoot,'src/isolation-ownership.ts'),join(installedRoot,'src/isolation-executor.ts'),...programs];
   const installed:InstalledIdentity={nodePath:process.execPath,nodeVersion:process.version,evaluatorPath,...(developer?{developerDir:developer}:{}),files:[...new Set(files)].map(path=>({path,sha256:hashFile(path)}))};
   let target:CandidateJobTarget|undefined,targetManifest:CandidateManifest|undefined;
   if(copy.kind!=='freeze'){const releaseDir=resolveExternalPath(this.#repositoryRoot,copy.options.releaseDir),path=join(releaseDir,'manifest.json');
    const header=readJobJson<CandidateManifest>(path,4_194_304);targetManifest=header;
    if(!/^[a-f0-9]{64}$/.test(header.id)||header.id!==header.manifestDigest)throw new Error('Invalid target manifest identity');
    target={releaseDir,candidateId:header.id,manifestDigest:header.manifestDigest,baseCommit:header.baseCommit,sourceDigest:header.sourceDigest,fileDigest:hashFile(path)};}
   const body={version:1 as const,jobId,directory,operation:copy,binding,...(target?{target}:{}),optionsDigest:jobHash(JSON.stringify(copy)),installed,installedDigest:jobHash(JSON.stringify(installed))};
   const request:CandidateJobEnvelope={...body,inputDigest:jobHash(JSON.stringify(body))};
   if(Buffer.byteLength(JSON.stringify(request))>33_554_432)throw new Error('Candidate job input exceeds bounded transport');
   state.initialize({version:1,jobId,inputDigest:request.inputDigest,operation:copy.kind,createdAt:new Date().toISOString(),status:'running',outer:{state:'intent',pid:null},nested:[]});
   writeJobJson(join(directory,'request.json'),request);writeJobJson(activePath,{jobId});
   const writes=[directory];
   if(copy.kind==='evaluate'){const evidence=join(resolveExternalPath(this.#repositoryRoot,copy.options.releaseDir),'evidence');mkdirSync(evidence,{recursive:true,mode:0o700});writes.push(evidence);}
   const reads=[installedRoot,this.#repositoryRoot,realpathSync(join(installedRoot,'node_modules')),directory,...installed.files.map(file=>file.path)];
   if(copy.kind!=='freeze')reads.push(resolveExternalPath(this.#repositoryRoot,copy.options.releaseDir));
   for(const path of [...(developer?[join(developer,'..')]:[]),'/usr/share/firmlinks','/Library/Developer/CommandLineTools','/var/select','/var/db/xcode_select_link','/Library/Preferences/com.apple.dt.CommandLineTools.plist','/Library/Preferences/com.apple.dt.Xcode.plist'])if(existsSync(path))reads.push(realpathSync(path));
   const controller=new AbortController(),nestedController=new AbortController(),decoder=new StringDecoder('utf8');
   const pendingChecks=new Set<Promise<void>>();let brokerBuffer='',brokerSequence=0,brokerFailure=false;
   let child:ChildProcess|undefined,cancelled=false,timer:ReturnType<typeof setTimeout>|undefined,killTimer:ReturnType<typeof setTimeout>|undefined;
   const cancel=()=>{if(cancelled)return;cancelled=true;nestedController.abort();try{child?.stdin?.write(JSON.stringify({kind:'cancel'})+'\n');}catch{}killTimer=setTimeout(()=>controller.abort(),500);};
   const reply=(frame:unknown)=>{const line=JSON.stringify(frame);if(Buffer.byteLength(line)>2_097_152)throw new Error('Broker result exceeds bound');try{child?.stdin?.write(line+'\n');}catch{}};
   const receive=(chunk:Buffer)=>{
    try {brokerBuffer+=decoder.write(chunk);if(Buffer.byteLength(brokerBuffer)>2_097_152)throw new Error('Broker request exceeds bound');
     let end;while((end=brokerBuffer.indexOf('\n'))>=0){const line=brokerBuffer.slice(0,end);brokerBuffer=brokerBuffer.slice(end+1);const frame=JSON.parse(line) as CandidateIsolationRequest;
      if(cancelled||brokerFailure||pendingChecks.size||frame.version!==1||frame.kind!=='isolate'||frame.jobId!==jobId||frame.inputDigest!==request.inputDigest||frame.sequence!==brokerSequence+1||frame.optionsDigest!==jobHash(JSON.stringify(frame.options)))throw new Error('Broker request identity/order mismatch');
      validateIsolationRequest(copy,targetManifest,request.target,compiler,installed,frame.options,++brokerSequence);
      const running=withIsolationOwnership({signal:nestedController.signal,beforeSpawn:descriptor=>state!.beforeSpawn(descriptor),spawned:(id,actual)=>state!.spawned(id,actual.pid),drained:(id,outcome)=>state!.drained(id,outcome)},
       ()=>runIsolated({...frame.options,signal:nestedController.signal})).then(result=>{reply({kind:'isolation-result',jobId,inputDigest:request.inputDigest,sequence:frame.sequence,optionsDigest:frame.optionsDigest,status:'completed',result,resultDigest:jobHash(JSON.stringify(result))});},()=>{brokerFailure=true;reply({kind:'isolation-result',jobId,inputDigest:request.inputDigest,sequence:frame.sequence,optionsDigest:frame.optionsDigest,status:'failed'});});
      pendingChecks.add(running);void running.then(()=>pendingChecks.delete(running),()=>pendingChecks.delete(running));
     }
    }catch{brokerFailure=true;nestedController.abort();throw new Error('Fixed collector broker rejected request');}
   };
   control.signal?.addEventListener('abort',cancel,{once:true});if(control.signal?.aborted)cancel();timer=setTimeout(cancel,duration);
   let launched;
   try {
    launched=await runIsolated({program:process.execPath,args:[helperPath,directory],cwd:directory,readPaths:reads,writePaths:writes,
     trustedExecutables:programs.map(path=>({path,sha256:installed.files.find(file=>file.path===path)!.sha256})),allowNodeChildren:true,
     keepStdinOpen:true,timeoutMs:300_000,maxOutputBytes:16_777_216,signal:controller.signal,onStdout:receive,
     onSpawn(actual){child=actual;if(!actual.pid)throw new Error('Candidate helper identity unknown');state!.update({outer:{state:'spawned',pid:actual.pid}});if(cancelled)actual.stdin?.write(JSON.stringify({kind:'cancel'})+'\n');}});
   }finally{nestedController.abort();await Promise.allSettled([...pendingChecks]);if(timer)clearTimeout(timer);if(killTimer)clearTimeout(killTimer);control.signal?.removeEventListener('abort',cancel);}
   const outer=state.receipt().outer;if(outer.state==='spawned'&&outer.pid)state.update({outer:{state:'drained',pid:outer.pid}});
   if(!state.allDrained()){state.update({status:'held',reason:'One or more nested checker intents have no proven close/cleanup'});throw new CandidateJobError('held',jobId,'Candidate descendants require reconciliation');}
   if(cancelled||launched.aborted||launched.timedOut){state.update({status:'cancelled',reason:'Collection cancelled; all recorded children drained'});unlinkSync(activePath);throw new CandidateJobError('cancelled',jobId,'Candidate collection cancelled');}
   if(brokerFailure||brokerBuffer.trim()||launched.exitCode!==0||launched.outputLimitExceeded)throw new CandidateJobError('failed',jobId,'Fixed candidate helper failed');
   const output=readJobJson<CandidateJobOutput>(join(directory,'output.json'),4_194_304);
   if(output.version!==1||output.jobId!==jobId||output.inputDigest!==request.inputDigest||output.optionsDigest!==request.optionsDigest||output.installedDigest!==request.installedDigest
    ||output.status!=='completed'||!output.result||output.resultDigest!==jobHash(JSON.stringify(output.result)))throw new CandidateJobError('failed',jobId,'Candidate result identity or completion mismatch');
   for(const file of installed.files)if(hashFile(file.path)!==file.sha256)throw new CandidateJobError('failed',jobId,'Installed collector changed during job');
   let result=output.result;
   validateResult(copy,result,directory,target);
   try{await control.validateBinding?.();}catch(error){state.update({status:'rejected',resultDigest:output.resultDigest,reason:'Current caller binding rejected result'});unlinkSync(activePath);throw error;}
   if(control.signal?.aborted){state.update({status:'cancelled'});unlinkSync(activePath);throw new CandidateJobError('cancelled',jobId,'Collection cancelled before result admission');}
   if(copy.kind==='freeze') {
    const manifest=result as CandidateManifest,releaseParent=resolveExternalPath(this.#repositoryRoot,join(copy.options.dataDir,'releases'));
    mkdirSync(releaseParent,{recursive:true,mode:0o700});const releaseDir=join(releaseParent,manifest.id);
    if(existsSync(releaseDir))throw new CandidateJobError('failed',jobId,'Frozen destination already exists');
    renameSync(manifest.releaseDir,releaseDir);result={...manifest,releaseDir,candidateRoot:join(releaseDir,'source')};
   }
   state.update({status:'completed',resultDigest:jobHash(JSON.stringify(result))});unlinkSync(activePath);return result as CandidateJobValue<T>;
  }catch(error){
   if(state&&existsSync(activePath)) {
    const receipt=state.receipt(),drained=receipt.outer.state==='drained'&&state.allDrained();
    if(!drained){state.update({status:'held',reason:'Collector interrupted without complete process drain'});throw new CandidateJobError('held',receipt.jobId,'Candidate collection requires reconciliation');}
    state.update({status:'failed',reason:'Collection or result validation failed'});unlinkSync(activePath);
   }
   throw error;
  }finally{this.#busy=false;lock.close();}
 }
}
function validateResult(operation:CandidateJobOperation,result:CandidateJobOutput['result'],directory:string,target?:CandidateJobTarget):void {
 if(!result||typeof result!=='object')throw new Error('Invalid candidate result');
 if(operation.kind==='challenge'){if(!('name'in result)||!('status'in result)||result.name!==operation.options.challenge||!['passed','failed'].includes(result.status))throw new Error('Invalid protected challenge result');return;}
 if(operation.kind==='evaluate'){
  const evidence=result as CandidateEvidence;const{evidenceDigest,...body}=evidence;
  if(!target||evidence.candidateId!==target.candidateId||evidence.manifestDigest!==target.manifestDigest||evidence.baseCommit!==target.baseCommit)throw new Error('Candidate evidence changed target');
  if(evidence.version!==1||!Array.isArray(evidence.checks)||evidence.checks.length>16||evidenceDigest!==digestJson(body))throw new Error('Invalid candidate evidence identity');
  return;
 }
 const manifest=result as CandidateManifest;const{id,manifestDigest,releaseDir,candidateRoot,...body}=manifest;
 if(!/^[a-f0-9]{64}$/.test(id)||id!==manifestDigest||manifestDigest!==digestJson(body)||candidateRoot!==join(releaseDir,'source'))throw new Error('Invalid candidate manifest identity');
 if(operation.kind==='freeze'&&releaseDir!==join(directory,'stage/releases',id))throw new Error('Frozen result escaped private stage');
 if(operation.kind==='verify'&&(!target||id!==target.candidateId||manifest.baseCommit!==target.baseCommit||manifest.sourceDigest!==target.sourceDigest||releaseDir!==target.releaseDir))throw new Error('Verified result changed artifact path');
}

// This fixed transport accepts only the unchanged collector's ordinary finite
// check descriptors. It has no public socket, shell or model-selected grant.
function validateIsolationRequest(operation:CandidateJobOperation,manifest:CandidateManifest|undefined,target:CandidateJobTarget|undefined,
 compiler:string,installed:InstalledIdentity,options:IsolationOptions,sequence:number):void {
 if(!manifest||!target||(operation.kind!=='challenge'&&operation.kind!=='evaluate'))throw new Error('Operation cannot launch checks');
 const sourceRoot=join(target.releaseDir,'source'),dependencyRoot=realpathSync(join(installedRoot,'node_modules'));
 const names=operation.kind==='challenge'?[operation.options.challenge]:['typecheck','trusted-agent-contract',...(manifest.requiredChecks.includes('cross-scope-memory')?['cross-scope-memory']:[]),...(['memory-provenance','memory-context-budget'] as const).filter(name=>manifest.requiredChecks.includes(name))];
 const name=names[sequence-1];if(!name)throw new Error('Too many protected checks');
 if(name==='typecheck'){
  const roots=manifest.typecheckPolicy?.entrypoints??manifest.files.filter(file=>file.path.endsWith('.ts')).map(file=>file.path);
  const args=['--ignoreConfig','--noEmit','--strict','--target','es2024','--module','nodenext','--moduleResolution','nodenext','--allowImportingTsExtensions','--erasableSyntaxOnly','--verbatimModuleSyntax','--skipLibCheck','--types','node','--typeRoots',join(dependencyRoot,'@types'),...roots.map(path=>join(sourceRoot,path))];
  const expected={program:compiler,trustedExecutables:[{path:compiler,sha256:installed.files.find(file=>file.path===compiler)!.sha256}],args,cwd:sourceRoot,readPaths:[dependencyRoot],timeoutMs:operation.options.timeoutMs??30_000,maxOutputBytes:262_144};
  if(digestJson(options)!==digestJson(expected))throw new Error('Compiler descriptor changed');
 }else{
  const bridge=`import { readFileSync } from 'node:fs'; import { pathToFileURL } from 'node:url'; const fixtures=JSON.parse(readFileSync(0,'utf8')); const {conversationRequest}=await import(pathToFileURL(process.argv[1]).href); const responses=[]; for(const fixture of fixtures) responses.push(await conversationRequest(fixture.task,fixture.memories)); process.stdout.write(JSON.stringify({responses}));`;
  if(typeof options.stdin!=='string'||Buffer.byteLength(options.stdin)>1_048_576||!Array.isArray(JSON.parse(options.stdin)))throw new Error('Protected fixtures are invalid');
  const expected={program:process.execPath,args:['--input-type=module','-e',bridge,join(sourceRoot,'src/agent/brain.ts')],cwd:sourceRoot,
   denyReadPaths:manifest.typecheckPolicy?.runtimeExcludedPaths.map(path=>join(sourceRoot,path))??[],stdin:options.stdin,timeoutMs:operation.options.timeoutMs??30_000,maxOutputBytes:262_144};
  if(digestJson(options)!==digestJson(expected))throw new Error('Protected behavior descriptor changed');
 }
}
