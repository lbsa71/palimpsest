import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync,mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
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
  const candidate=freezeCandidate({repositoryRoot,dataDir,configuration:{},modelProfile:{provider:'fixture',model:null},changes:[{path:'src/agent/brain.ts',content:'export const policy="new";\n'}]});
  store.appendEvent('evolution.finished',JSON.parse(JSON.stringify({report:{status:'promoted',candidate}})));
  const options={repositoryRoot,dataDir,store,remote:'origin',branch:'main',remoteUrl};const publisher=new GitPublisher(options);
  return {dir,repositoryRoot,dataDir,remoteUrl,git,store,candidate,publisher,options,close(){store.close();rmSync(dir,{recursive:true,force:true});}};
}
function preparedCommit(f: ReturnType<typeof fixture>): string {
  const git = (args: string[], input?: string) => execFileSync('/usr/bin/git', args, {
    cwd: f.repositoryRoot, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GIT_INDEX_FILE: join(f.dataDir, 'fixture.index') },
  }).trim();
  git(['read-tree', f.candidate.baseCommit]);
  const blob = git(['hash-object', '-w', '--stdin'], readFileSync(join(f.candidate.candidateRoot, 'src/agent/brain.ts'), 'utf8'));
  git(['update-index', '--add', '--cacheinfo', `100644,${blob},src/agent/brain.ts`]);
  return git(['commit-tree', git(['write-tree']), '-p', f.candidate.baseCommit, '-m', 'prepared admitted source']);
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
    const commit=preparedCommit(f);
    f.store.appendEvent('git.publication.prepared',{candidateId:f.candidate.id,target,commit});
    f.store.appendEvent('git.publication.push_reserved',{candidateId:f.candidate.id,target,commit});
    const reopened=new GitPublisher(f.options);assert.equal((await reopened.publish(f.candidate)).status,'uncertain');
    assert.equal(f.git('ls-remote','origin','refs/heads/main').split(/\s+/)[0],f.candidate.baseCommit);
    f.git('push','origin',`${commit}:refs/heads/main`);
    assert.equal((await reopened.publish(f.candidate)).status,'published');
    assert.equal(f.store.listEvents().filter(e=>e.type==='git.publication.push_reserved').length,1);
  }finally{f.close();}
});

test('completed publication remains confirmed after a remote-only descendant and store restart without replay or ref changes', async () => {
  const f = fixture();
  try {
    const first = await f.publisher.publish(f.candidate);
    assert.equal(first.status, 'published');
    const localHead = f.git('rev-parse', 'HEAD');
    const otherRoot = join(f.dir, 'other');
    execFileSync('/usr/bin/git', ['clone', '-q', '-b', 'main', f.remoteUrl, otherRoot], { stdio: 'ignore' });
    const otherGit = (...args: string[]) => execFileSync('/usr/bin/git', args, { cwd: otherRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    otherGit('config', 'user.name', 'Later Host Fixture'); otherGit('config', 'user.email', 'host@example.invalid');
    writeFileSync(join(otherRoot, 'docs', 'later-host.md'), 'Separately reviewed host progress.');
    otherGit('add', '.'); otherGit('commit', '-qm', 'later host upgrade'); otherGit('push', 'origin', 'main');
    const descendant = otherGit('rev-parse', 'HEAD');
    assert.throws(() => f.git('cat-file', '-e', `${descendant}^{commit}`));
    const localRefs = f.git('show-ref');
    const eventCount = f.store.listEvents().filter(event => event.type === 'git.publication.push_reserved').length;
    f.store.close();
    const reopened = new Store(join(f.dataDir, 'state.sqlite'));
    try {
      const result = await new GitPublisher({ ...f.options, store: reopened }).publish(f.candidate);
      assert.equal(result.status, 'published');
      assert.equal(result.commit, first.commit);
      assert.equal(f.git('rev-parse', 'HEAD'), localHead);
      assert.equal(f.git('show-ref'), localRefs);
      assert.equal(otherGit('ls-remote', 'origin', 'refs/heads/main').split(/\s+/)[0], descendant);
      assert.equal(reopened.listEvents().filter(event => event.type === 'git.publication.push_reserved').length, eventCount);
    } finally { reopened.close(); }
  } finally { f.close(); }
});

test('reserved publication remains uncertain for divergent, missing or unreachable remote, without another reservation', async () => {
  const f = fixture();
  try {
    assert.equal((await f.publisher.publish(f.candidate)).status, 'published');
    const divergent = f.git('commit-tree', f.git('rev-parse', 'HEAD^{tree}'), '-m', 'unrelated history');
    f.git('push', '--force', 'origin', `${divergent}:refs/heads/main`);
    assert.equal((await new GitPublisher(f.options).publish(f.candidate)).status, 'uncertain');
    assert.equal(f.git('ls-remote', 'origin', 'refs/heads/main').split(/\s+/)[0], divergent);
    execFileSync('/usr/bin/git', ['--git-dir', f.remoteUrl, 'config', 'receive.denyDeleteCurrent', 'ignore'], { stdio: 'ignore' });
    f.git('push', 'origin', ':refs/heads/main');
    assert.equal((await new GitPublisher(f.options).publish(f.candidate)).status, 'uncertain');
    rmSync(f.remoteUrl, { recursive: true, force: true });
    assert.equal((await new GitPublisher(f.options).publish(f.candidate)).status, 'uncertain');
    assert.equal(f.store.listEvents().filter(event => event.type === 'git.publication.push_reserved').length, 1);
  } finally { f.close(); }
});

test('local replacement and graft ancestry cannot manufacture remote publication proof', async () => {
  const f = fixture();
  try {
    const published = await f.publisher.publish(f.candidate);
    assert.equal(published.status, 'published');
    const tree = f.git('rev-parse', 'HEAD^{tree}');
    const divergent = f.git('commit-tree', tree, '-m', 'unrelated remote root');
    const substituted = f.git('commit-tree', tree, '-p', published.commit!, '-m', 'forged local ancestry');
    f.git('push', '--force', 'origin', `${divergent}:refs/heads/main`);
    f.git('replace', divergent, substituted);
    assert.equal((await new GitPublisher(f.options).publish(f.candidate)).status, 'uncertain');
    f.git('replace', '-d', divergent);
    const grafts = join(f.repositoryRoot, f.git('rev-parse', '--git-path', 'info/grafts'));
    writeFileSync(grafts, `${divergent} ${published.commit}\n`);
    assert.equal((await new GitPublisher(f.options).publish(f.candidate)).status, 'uncertain');
    assert.equal(f.store.listEvents().filter(event => event.type === 'git.publication.push_reserved').length, 1);
  } finally { f.close(); }
});

test('remote reachability alone cannot confirm a prepared commit with different cognitive source', async () => {
  const f = fixture();
  try {
    const target = createHash('sha256').update(JSON.stringify({ remote: 'origin', remoteUrl: f.remoteUrl, branch: 'main' })).digest('hex');
    const commit = f.git('commit-tree', f.git('rev-parse', 'HEAD^{tree}'), '-p', f.candidate.baseCommit, '-m', 'incorrect old source');
    f.store.appendEvent('git.publication.prepared', { candidateId: f.candidate.id, target, commit });
    f.store.appendEvent('git.publication.push_reserved', { candidateId: f.candidate.id, target, commit });
    f.git('push', 'origin', `${commit}:refs/heads/main`);
    assert.equal((await new GitPublisher(f.options).publish(f.candidate)).status, 'uncertain');
    assert.equal(f.store.listEvents().filter(event => event.type === 'git.publication.push_reserved').length, 1);
  } finally { f.close(); }
});

test('historical remote confirmation rejects mutated frozen cognitive bytes or mode', async () => {
  const f = fixture();
  try {
    const published = await f.publisher.publish(f.candidate);
    assert.equal(published.status, 'published');
    const brain = join(f.candidate.candidateRoot, 'src/agent/brain.ts');
    const original = readFileSync(brain, 'utf8');
    chmodSync(brain, 0o600); writeFileSync(brain, 'export const policy="tampered";\n');
    assert.equal((await new GitPublisher(f.options).publish(f.candidate)).status, 'uncertain');
    writeFileSync(brain, original); chmodSync(brain, 0o500);
    assert.equal((await new GitPublisher(f.options).publish(f.candidate)).status, 'uncertain');
    assert.equal(f.git('ls-remote', 'origin', 'refs/heads/main').split(/\s+/)[0], published.commit);
    assert.equal(f.store.listEvents().filter(event => event.type === 'git.publication.push_reserved').length, 1);
  } finally { f.close(); }
});
