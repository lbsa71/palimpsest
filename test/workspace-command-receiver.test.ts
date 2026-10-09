import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmodSync,existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import test from 'node:test';
import {freezeBaseline} from '../src/candidates.ts';
import {Store} from '../src/store.ts';
import {CodingWorkspaces,workspaceTreeDigest} from '../src/workspaces.ts';
const darwin={skip:process.platform!=='darwin'};
function fixture(maxCommands=16,maxWorkspaces=8){
 const directory=mkdtempSync(join(tmpdir(),'palimpsest-command-receiver-')),repositoryRoot=join(directory,'repo'),dataDir=join(directory,'state'),collection=join(directory,'workspaces');
 mkdirSync(join(repositoryRoot,'src/agent'),{recursive:true});mkdirSync(join(repositoryRoot,'docs'));
 writeFileSync(join(repositoryRoot,'src/agent/brain.ts'),'export function conversationRequest(){return {system:"fixture",prompt:"{}"};}');writeFileSync(join(repositoryRoot,'docs/seed-contract.md'),'Synthetic contract');writeFileSync(join(repositoryRoot,'package.json'),'{"type":"module"}');
 const git=(...args:string[])=>execFileSync('/usr/bin/git',args,{cwd:repositoryRoot,stdio:'ignore'});git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');git('add','.');git('commit','-qm','Fixture');
 const baseline=freezeBaseline({repositoryRoot,dataDir,configuration:{},modelProfile:{provider:'fixture',model:null}}),runtime=baseline.runtime;
 let store=new Store(join(dataDir,'state.sqlite')),epoch=1,allowed=true;
 const task=store.enqueue({conversationId:'coding',source:'direct',input:'Synthetic command workflow'});store.updateTask(task.id,{state:'running'});
 const files=[{path:'src/example.ts',content:Buffer.from('export const value: string = "initial";'),mode:0o644 as const},{path:'package.json',content:Buffer.from('{"type":"module"}'),mode:0o644 as const}];
 const options=()=>({store,directory:collection,repositoryRoot,runtime,runtimeRelease:{releaseDir:baseline.releaseDir,digest:baseline.manifestDigest},toolchainReadPaths:[resolve('node_modules')],maxCommands,maxWorkspaces,authorize:(a:{taskId:string;epoch:number})=>allowed&&a.taskId===task.id&&a.epoch===epoch});
 let engine=new CodingWorkspaces(options());const workspace=engine.create({taskId:task.id,epoch,base:{releaseDigest:'a'.repeat(64),baseCommit:'b'.repeat(40),treeDigest:workspaceTreeDigest(files)},files});
 const cleanup=async()=>{await engine.stop();store.close();const writable=(path:string)=>{const stat=lstatSync(path);if(stat.isSymbolicLink())return;if(stat.isDirectory()){chmodSync(path,0o700);for(const n of readdirSync(path))writable(join(path,n));}else chmodSync(path,0o600);};writable(directory);rmSync(directory,{recursive:true,force:true});};
 return{directory,workspace,task,runtime,get engine(){return engine;},get store(){return store;},revoke(){allowed=false;},async reopen(){await engine.stop();store.close();store=new Store(join(dataDir,'state.sqlite'));allowed=true;epoch++;engine=new CodingWorkspaces(options());engine.adopt(workspace.id,epoch);return epoch;},cleanup};
}
async function waitFor(predicate:()=>boolean){for(let n=0;n<200;n++){if(predicate())return;await delay(10);}throw new Error('Fixture condition did not arrive');}

test('receiver records one real command, exact output and final tree without replay',darwin,async()=>{
 const f=fixture();try{
  const command={tool:'node' as const,args:['--input-type=module','-e',"import fs from 'node:fs';fs.writeFileSync('src/example.ts','export const value = 42;');fs.writeFileSync('ran.txt','once');console.log('command done');"]};
  const result=await f.engine.runCommand(f.workspace.id,1,'real-command',command);
  assert.equal(result.exit.kind,'observed');assert.equal(result.exitSuccessful,true);assert.equal(result.workspaceUsable,true);assert.match(result.afterTreeDigest!,/^[a-f0-9]{64}$/);
  assert.deepEqual(await f.engine.runCommand(f.workspace.id,1,'real-command',command),result);assert.equal(f.store.listEffects(f.task.id).filter(e=>e.kind==='workspace.command').length,1);
  const page=f.engine.readCommandOutput(f.workspace.id,1,'real-command','stdout',0,64);assert.equal(page.text,'command done\n');assert.equal(page.outputComplete,true);
  assert.equal(readFileSync(join(f.engine.path(f.workspace.id),'ran.txt'),'utf8'),'once');assert.ok(!JSON.stringify(result).includes(f.directory),'public observation omits private paths');
 }finally{await f.cleanup();}
});

test('writer ownership survives cancellation and revocation until the actual command drains',darwin,async()=>{
 const f=fixture();try{
  const pending=f.engine.runCommand(f.workspace.id,1,'drained-command',{tool:'node',args:['--input-type=module','-e',"import fs from 'node:fs';console.log('started');setTimeout(()=>fs.writeFileSync('late.txt','late'),300);setInterval(()=>{},1000);"]});
  const rejected=assert.rejects(pending,/authority|revok|interrupt/);let pid=0;
  await waitFor(()=>{try{const claim=JSON.parse(readFileSync(join(f.engine.controlPath(f.workspace.id),'writer.json'),'utf8'));const commands=join(f.engine.controlPath(f.workspace.id),'commands');if(claim.pid&&existsSync(commands)&&readdirSync(commands).some(n=>{const spool=join(commands,n,'stdout.bin');return existsSync(spool)&&lstatSync(spool).size>0;})){pid=claim.pid;return true;}}catch{}return false;});
  await assert.rejects(f.engine.perform(f.workspace.id,1,'racing-write',{kind:'create',path:'racing.txt',content:'race',mode:0o644}),/busy|writer|uncertain/);
  f.revoke();await f.engine.cancel(f.workspace.id);await rejected;assert.throws(()=>process.kill(pid,0),(e:NodeJS.ErrnoException)=>e.code==='ESRCH');await delay(350);
  assert.equal(existsSync(join(f.engine.path(f.workspace.id),'late.txt')),false);assert.equal(f.store.effect('drained-command')?.state,'unknown');
  const epoch=await f.reopen();const recovered=await f.engine.reconcileCommand(f.workspace.id,epoch,'drained-command');assert.equal(recovered.exitSuccessful,false);assert.equal(f.store.effect('drained-command')?.state,'completed');
 }finally{await f.cleanup();}
});

test('lost receipt recovery preserves the real draft, unknown exit and original reservation',darwin,async()=>{
 const f=fixture();try{
  const complete=f.store.completeEffect.bind(f.store);f.store.completeEffect=(id,result)=>{if(id==='lost-command')throw new Error('Synthetic durable-receipt loss');return complete(id,result);};
  await assert.rejects(f.engine.runCommand(f.workspace.id,1,'lost-command',{tool:'node',args:['--input-type=module','-e',"import fs from 'node:fs';fs.writeFileSync('src/example.ts','export const value=42;');"]}),/loss/);
  assert.equal(f.store.effect('lost-command')?.state,'unknown');const output=join(f.engine.controlPath(f.workspace.id),'commands');for(const name of readdirSync(output)){const receipt=join(output,name,'receipt.json');if(existsSync(receipt))rmSync(receipt);}
  const epoch=await f.reopen();const result=await f.engine.reconcileCommand(f.workspace.id,epoch,'lost-command');assert.equal(result.exit.kind,'unknown');assert.equal(result.exitSuccessful,false);assert.equal(result.outputComplete,false);assert.equal(result.workspaceUsable,true);
  assert.equal(readFileSync(join(f.engine.path(f.workspace.id),'src/example.ts'),'utf8'),'export const value=42;');assert.equal(f.store.listEffects(f.task.id).filter(e=>e.kind==='workspace.command').length,1);
  assert.ok(f.store.listEvents({taskId:f.task.id}).some(e=>e.type==='effect.unknown'));await assert.rejects(f.engine.runCommand(f.workspace.id,epoch,'lost-command',{tool:'node',args:['-e','throw 1']}),/identity|conflict|replay/);
 }finally{await f.cleanup();}
});

test('invalid command tree is held and a new checkpoint workspace preserves earlier edits and base lineage',darwin,async()=>{
 const f=fixture();try{
  const before=await f.engine.perform(f.workspace.id,1,'before-read',{kind:'read',path:'src/example.ts'});assert.equal(before.ok,true);if(!before.ok||!('sha256'in before.result))throw new Error('Fixture read missing');
  await f.engine.perform(f.workspace.id,1,'prior-edit',{kind:'replace',path:'src/example.ts',content:'export const value="earlier edit";',mode:0o644,expected:{sha256:before.result.sha256,mode:0o644}});
  await f.engine.perform(f.workspace.id,1,'empty-dir',{kind:'mkdir',path:'empty'});
  const result=await f.engine.runCommand(f.workspace.id,1,'invalid-command',{tool:'node',args:['--input-type=module','-e',"import fs from 'node:fs';fs.writeFileSync('src/example.ts','bad abandoned change');fs.symlinkSync('example.ts','src/alias.ts');"]});
  assert.equal(result.exitSuccessful,true);assert.equal(result.workspaceUsable,false);await assert.rejects(f.engine.perform(f.workspace.id,1,'after-invalid',{kind:'manifest'}),/held|invalid/);
  const restored=await f.engine.restoreCommandCheckpoint(f.workspace.id,1,'invalid-command');assert.notEqual(restored.id,f.workspace.id);assert.deepEqual(restored.base,f.workspace.base);assert.deepEqual(restored.files,f.workspace.files);
  assert.equal(readFileSync(join(f.engine.path(restored.id),'src/example.ts'),'utf8'),'export const value="earlier edit";');assert.equal(existsSync(join(f.engine.path(restored.id),'empty')),true);assert.equal(existsSync(join(f.engine.path(restored.id),'src/alias.ts')),false);
  assert.equal(lstatSync(join(f.engine.path(f.workspace.id),'src/alias.ts')).isSymbolicLink(),true,'held original retained');assert.equal(f.store.listEffects(f.task.id).filter(e=>e.kind==='workspace.command').length,1);
  assert.ok(f.store.listEvents({taskId:f.task.id}).some(e=>e.type==='workspace.restored'));
 }finally{await f.cleanup();}
});

test('finite retained command ceiling survives reopen and never refunds an old intent',darwin,async()=>{
 const f=fixture(1);try{await f.engine.runCommand(f.workspace.id,1,'one-command',{tool:'node',args:['-e','console.log(1)']});const epoch=await f.reopen();
  await assert.rejects(f.engine.runCommand(f.workspace.id,epoch,'over-limit',{tool:'node',args:['-e','console.log(2)']}),/limit|retention|ceiling/);assert.equal(f.store.effect('over-limit'),undefined);
  assert.equal(f.engine.readCommandOutput(f.workspace.id,epoch,'one-command','stdout',0,64).text,'1\n');assert.equal(f.store.listEffects(f.task.id).filter(e=>e.kind==='workspace.command').length,1);
 }finally{await f.cleanup();}
});
