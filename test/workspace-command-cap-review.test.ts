import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmodSync,existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
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

test('collection command ceiling serializes simultaneous workspaces before either launch',darwin,async()=>{
 const f=fixture(1);try{
  const files=[{path:'second.txt',content:Buffer.from('second'),mode:0o644 as const}];
  const second=f.engine.create({taskId:f.task.id,epoch:1,base:{releaseDigest:'a'.repeat(64),baseCommit:'b'.repeat(40),treeDigest:workspaceTreeDigest(files)},files});
  const results=await Promise.allSettled([
   f.engine.runCommand(f.workspace.id,1,'cap-one',{tool:'node',args:['-e',"require('node:fs').writeFileSync('launched.txt','one')"]}),
   f.engine.runCommand(second.id,1,'cap-two',{tool:'node',args:['-e',"require('node:fs').writeFileSync('launched.txt','two')"]})
  ]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1,'only one command can pass the collection-wide ceiling');
  const denied=results.find(r=>r.status==='rejected');assert.ok(denied&&denied.status==='rejected');assert.match(String(denied.reason),/limit|retention|ceiling/);
  assert.equal(f.store.listEffects().filter(e=>e.kind==='workspace.command').length,1,'reservation count is not exceeded');
  assert.equal([f.workspace,second].filter(w=>existsSync(join(f.engine.path(w.id),'launched.txt'))).length,1,'the denied command never executes');
  const retained=[f.workspace,second].flatMap(w=>{const p=join(f.engine.controlPath(w.id),'commands');return existsSync(p)?readdirSync(p):[];});
  assert.equal(retained.length,1,'the denied command creates no retained output directory');
 }finally{await f.cleanup();}
});
