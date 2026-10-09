import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync,mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { freezeCandidate } from '../src/candidates.ts';
import { GitPublisher, runGitCommand } from '../src/git-publication.ts';
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

function singleChild(child: import('node:child_process').ChildProcess): import('../src/git-publication.ts').GitExecution {
  return { child, terminateOwnedGroup: () => { child.kill('SIGKILL'); } };
}

function pushDiagnostics(f: ReturnType<typeof fixture>) {
  return f.store.listEvents().filter(event => event.type === 'git.publication.command_result');
}

test('rejected initial push retains bounded sanitized evidence and restart does not retry', async () => {
  const f = fixture(); let pushes = 0;
  const executeGit: import('../src/git-publication.ts').GitExecutor = (file, args, options, callback) => {
    if (args.includes('push')) {
      pushes++;
      return singleChild(execFile(file, [...args.slice(0, args.indexOf('push')), 'push', '--porcelain', 'origin', 'missing-ref:refs/heads/main'], options, (error, stdout, stderr) => {
        if (error) error.message = 'secret credential https://private.invalid';
        callback(error, `${stdout} secret output`, `${stderr} private credential`);
      }));
    }
    return singleChild(execFile(file, args, options, callback));
  };
  try {
    const result = await new GitPublisher({ ...f.options, executeGit }).publish(f.candidate);
    assert.equal(result.status, 'uncertain');
    const [event] = pushDiagnostics(f);
    assert.ok(event);
    assert.deepEqual(event.payload, {
      candidateId: f.candidate.id,
      target: createHash('sha256').update(JSON.stringify({ remote: 'origin', remoteUrl: f.remoteUrl, branch: 'main' })).digest('hex'),
      commit: result.commit, operation: 'push', exitCode: 1, signal: null, deadlineExpired: false,
    });
    assert.ok(event.seq > f.store.listEvents().find(event => event.type === 'git.publication.push_reserved')!.seq);
    assert.doesNotMatch(JSON.stringify(event.payload), /credential|private|secret|https|stderr|stdout|args|env/);
    f.store.close();
    const reopened = new Store(join(f.dataDir, 'state.sqlite'));
    try {
      assert.equal((await new GitPublisher({ ...f.options, store: reopened, executeGit }).publish(f.candidate)).status, 'uncertain');
      assert.equal(pushes, 1);
      assert.equal(reopened.listEvents().filter(event => event.type === 'git.publication.command_result').length, 1);
    } finally { reopened.close(); }
  } finally { f.close(); }
});

test('failed command reporting can still confirm independently published exact source', async () => {
  const f = fixture();
  const executeGit: import('../src/git-publication.ts').GitExecutor = (file, args, options, callback) => singleChild(execFile(file, args, options, (error, stdout, stderr) => {
    if (args.includes('push') && !error) {
      const lostResponse = Object.assign(new Error('private transport response'), { code: 1, killed: true, signal: 'SIGTERM' as const });
      callback(lostResponse, stdout, stderr);
    } else callback(error, stdout, stderr);
  }));
  try {
    const result = await new GitPublisher({ ...f.options, executeGit }).publish(f.candidate);
    assert.equal(result.status, 'published');
    assert.equal(f.git('ls-remote', 'origin', 'refs/heads/main').split(/\s+/)[0], result.commit);
    assert.equal((pushDiagnostics(f)[0].payload as Record<string, unknown>).exitCode, 1);
    assert.equal((pushDiagnostics(f)[0].payload as Record<string, unknown>).signal, 'SIGTERM');
    assert.equal((pushDiagnostics(f)[0].payload as Record<string, unknown>).deadlineExpired, false, 'killed alone is not timeout proof');
  } finally { f.close(); }
});

test('successful push with unavailable confirmation stays uncertain then observes across restart without replay', async () => {
  const f = fixture(); let pushed = false; let unavailable = true; let pushes = 0;
  const executeGit: import('../src/git-publication.ts').GitExecutor = (file, args, options, callback) => {
    if (pushed && unavailable && args.includes('ls-remote')) {
      return singleChild(execFile(file, ['--git-dir', join(f.dir, 'missing.git'), 'rev-parse', 'HEAD'], options, callback));
    }
    return singleChild(execFile(file, args, options, (error, stdout, stderr) => {
      if (args.includes('push')) { pushed = true; pushes++; }
      callback(error, stdout, stderr);
    }));
  };
  try {
    const result = await new GitPublisher({ ...f.options, executeGit }).publish(f.candidate);
    assert.equal(result.status, 'uncertain');
    assert.equal((pushDiagnostics(f)[0].payload as Record<string, unknown>).exitCode, 0);
    unavailable = false;
    assert.equal((await new GitPublisher({ ...f.options, executeGit }).publish(f.candidate)).status, 'published');
    assert.equal(pushes, 1);
    assert.equal(pushDiagnostics(f).length, 1);
  } finally { f.close(); }
});

test('actual 30-second command deadline records expiration and terminates the subprocess without retry', async () => {
  const f = fixture(); let childPid: number | undefined; let pushes = 0;
  const executeGit: import('../src/git-publication.ts').GitExecutor = (file, args, options, callback) => {
    if (args.includes('push')) {
      pushes++;
      const execution = runGitCommand(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], options, callback);
      childPid = execution.child.pid;
      return execution;
    }
    return singleChild(execFile(file, args, options, callback));
  };
  try {
    const result = await new GitPublisher({ ...f.options, executeGit }).publish(f.candidate);
    assert.equal(result.status, 'uncertain');
    const diagnostic = pushDiagnostics(f)[0].payload as Record<string, unknown>;
    assert.equal(diagnostic.deadlineExpired, true);
    assert.equal(diagnostic.exitCode, null);
    assert.equal(diagnostic.signal, null, 'termination was requested at settlement, not observed');
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(childPid);
    assert.throws(() => process.kill(childPid!, 0), { code: 'ESRCH' });
    assert.equal((await new GitPublisher({ ...f.options, executeGit }).publish(f.candidate)).status, 'uncertain');
    assert.equal(pushes, 1);
  } finally { f.close(); }
});

test('diagnostic target identity cannot authorize altered publication and preflight refusal writes no diagnostic', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.repositoryRoot, 'private.txt'), 'uncommitted');
    assert.equal((await f.publisher.publish(f.candidate)).status, 'declined');
    assert.equal(pushDiagnostics(f).length, 0);
    rmSync(join(f.repositoryRoot, 'private.txt'));
    assert.equal((await f.publisher.publish(f.candidate)).status, 'published');
    const before = f.git('rev-parse', 'HEAD');
    f.store.appendEvent('git.publication.command_result', { candidateId: f.candidate.id, target: 'altered', commit: before, operation: 'push', exitCode: 0, signal: null, deadlineExpired: false });
    assert.match((await new GitPublisher(f.options).publish(f.candidate)).reason, /target changed/);
    assert.equal(f.git('rev-parse', 'HEAD'), before);
    assert.equal(f.store.listEvents().filter(event => event.type === 'git.publication.push_reserved').length, 1);
  } finally { f.close(); }
});

test('deadline settles despite inherited descendant pipes and cleans only the owned process group', async (t) => {
  const f = fixture();
  const realDelay = globalThis.setTimeout;
  const sleep = (ms: number) => new Promise<void>(resolve => realDelay(resolve, ms));
  const { spawn } = await import('node:child_process');
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
  let parent: import('node:child_process').ChildProcess | undefined;
  let descendantPid: number | undefined;
  let settled = false, closeObserved = false;
  const executeGit: import('../src/git-publication.ts').GitExecutor = (file, args, options, callback) => {
    if (args.includes('push')) {
      const execution = runGitCommand(process.execPath, ['-e', `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'inherit'}); process.stdout.write(String(child.pid)+'\\n'); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);`], options, (error, stdout, stderr) => { closeObserved = true; callback(error, stdout, stderr); });
      parent = execution.child;
      let stdout = '';
      parent.stdout!.on('data', chunk => { stdout += String(chunk); descendantPid = Number(stdout.trim()); });
      return execution;
    }
    return singleChild(execFile(file, args, options, callback));
  };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const work = new GitPublisher({ ...f.options, executeGit }).publish(f.candidate).then(result => { settled = true; return result; });
    for (let n = 0; n < 100 && !descendantPid; n++) await sleep(20);
    assert.ok(parent?.pid && descendantPid);
    t.mock.timers.tick(30000);
    for (let n = 0; n < 50 && !settled; n++) await sleep(20);
    assert.equal(settled, true, 'the deadline must settle without waiting for inherited pipes to close');
    assert.equal((await work).status, 'uncertain');
    const gone = (pid: number) => { try { process.kill(pid, 0); return false; } catch { return true; } };
    for (let n = 0; n < 100 && (!gone(parent!.pid!) || !gone(descendantPid!)); n++) await sleep(20);
    assert.equal(gone(parent!.pid!), true);
    assert.equal(gone(descendantPid!), true);
    assert.doesNotThrow(() => process.kill(unrelated.pid!, 0));
    const events = pushDiagnostics(f);
    assert.equal(events.length, 1);
    assert.equal((events[0].payload as Record<string, unknown>).deadlineExpired, true);
    assert.equal((events[0].payload as Record<string, unknown>).signal, null, 'requested termination is not observed termination');
    await sleep(100);
    assert.equal(closeObserved, true, 'the actual late close callback was observed');
    assert.equal(pushDiagnostics(f).length, 1, 'late close callback cannot duplicate evidence');
  } finally {
    t.mock.timers.reset();
    for (const pid of [parent?.pid, descendantPid, unrelated.pid]) if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    f.close();
  }
});

test('owned spawn runner retains bounded stdout and stderr on excessive output', async () => {
  for (const stream of ['stdout', 'stderr']) {
    const f = fixture(); let childPid: number | undefined;
    const executeGit: import('../src/git-publication.ts').GitExecutor = (file, args, options, callback) => {
      if (args.includes('push')) {
        const execution = runGitCommand(process.execPath, ['-e', `process.${stream}.write(Buffer.alloc(1048577, 'x')); setInterval(()=>{},1000);`], options, callback);
        childPid = execution.child.pid;
        return execution;
      }
      return runGitCommand(file, args, options, callback);
    };
    try {
      const result = await new GitPublisher({ ...f.options, executeGit }).publish(f.candidate);
      assert.equal(result.status, 'uncertain');
      assert.equal(pushDiagnostics(f).length, 1);
      assert.deepEqual(Object.fromEntries(Object.entries(pushDiagnostics(f)[0].payload as Record<string, unknown>).filter(([key]) => ['exitCode', 'signal', 'deadlineExpired'].includes(key))), { exitCode: null, signal: null, deadlineExpired: false });
      assert.ok(childPid);
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.throws(() => process.kill(childPid!, 0), { code: 'ESRCH' });
    } finally { f.close(); }
  }
});
