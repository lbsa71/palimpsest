import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { freezeCandidate } from '../src/candidates.ts';
import { GitPublisher } from '../src/git-publication.ts';
import { Store } from '../src/store.ts';
function fixture() {
  const dir=mkdtempSync(join(tmpdir(),'palimpsest-publication-'));const repositoryRoot=join(dir,'repo');const dataDir=join(dir,'state');const remoteUrl=join(dir,'remote.git');
  mkdirSync(join(repositoryRoot,'src/agent'),{recursive:true});mkdirSync(join(repositoryRoot,'docs'));mkdirSync(dataDir);
  writeFileSync(join(repositoryRoot,'src/agent/brain.ts'),'export const policy="old";');writeFileSync(join(repositoryRoot,'docs/seed-contract.md'),'Protected fixture');
  const git=(...args:string[])=>execFileSync('/usr/bin/git',args,{cwd:repositoryRoot,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-q','-b','main');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');git('add','.');git('commit','-qm','baseline');git('init','--bare',remoteUrl);git('remote','add','origin',remoteUrl);git('push','origin','main');
  const store=new Store(join(dataDir,'state.sqlite'));
  const candidate=freezeCandidate({repositoryRoot,dataDir,configuration:{},modelProfile:{provider:'fixture',model:null},changes:[{path:'src/agent/brain.ts',content:'export const policy="new";'}]});
  store.appendEvent('evolution.finished',JSON.parse(JSON.stringify({report:{status:'promoted',candidate}})));
  const options={repositoryRoot,dataDir,store,remote:'origin',branch:'main',remoteUrl};const publisher=new GitPublisher(options);
  return {dir,repositoryRoot,dataDir,remoteUrl,git,store,candidate,publisher,options,close(){store.close();rmSync(dir,{recursive:true,force:true});}};
}
test('publication refuses dirty checkout, changed destination and divergent remote without changing source',async()=>{
  const f=fixture();try {
    const before=f.git('rev-parse','HEAD');writeFileSync(join(f.repositoryRoot,'local.txt'),'private local work');
    assert.match((await f.publisher.publish(f.candidate)).reason,/local changes/);assert.equal(f.git('rev-parse','HEAD'),before);
    rmSync(join(f.repositoryRoot,'local.txt'));f.git('remote','remove','origin');
    assert.equal((await f.publisher.publish(f.candidate)).status,'declined');f.git('remote','add','origin',f.remoteUrl);
    const tree=f.git('rev-parse','HEAD^{tree}');const remoteCommit=f.git('commit-tree',tree,'-p',before,'-m','concurrent remote work');
    f.git('push','origin',`${remoteCommit}:refs/heads/main`);
    assert.match((await f.publisher.publish(f.candidate)).reason,/diverged/);
    assert.equal(f.git('rev-parse','HEAD'),before);assert.equal(readFileSync(join(f.repositoryRoot,'src/agent/brain.ts'),'utf8'),'export const policy="old";');
  }finally{f.close();}
});
test('reserved uncertain push is observed across restart and never replayed',async()=>{
  const f=fixture();try {
    const target=createHash('sha256').update(JSON.stringify({remote:'origin',remoteUrl:f.remoteUrl,branch:'main'})).digest('hex');
    const commit=f.git('commit-tree',f.git('rev-parse','HEAD^{tree}'),'-p',f.candidate.baseCommit,'-m','reserved fixture');
    f.store.appendEvent('git.publication.prepared',{candidateId:f.candidate.id,target,commit});
    f.store.appendEvent('git.publication.push_reserved',{candidateId:f.candidate.id,target,commit});
    const reopened=new GitPublisher(f.options);assert.equal((await reopened.publish(f.candidate)).status,'uncertain');
    assert.equal(f.git('ls-remote','origin','refs/heads/main').split(/\s+/)[0],f.candidate.baseCommit);
    f.git('push','origin',`${commit}:refs/heads/main`);
    assert.equal((await reopened.publish(f.candidate)).status,'published');
    assert.equal(f.store.listEvents().filter(e=>e.type==='git.publication.push_reserved').length,1);
  }finally{f.close();}
});
