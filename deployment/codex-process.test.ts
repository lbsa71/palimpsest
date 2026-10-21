import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, linkSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { CodexCodingProvider, type CodingInvocation, type CodingMode } from '../packages/coding/index.ts';
import { nodeExecutionEnvironment, type ProcessChild } from '../packages/supervisor/environment.ts';
import { createCodexProcess, nodeCodexProcessDependencies, type CodexProcessDependencies, type CodexProcessOptions } from './codex-process.ts';
import { runtimeBundlePath, type RuntimeIdentity } from './runtime-bundle.ts';

// Existing write/lifecycle scenarios explicitly request edit; omitted modes are tested as inspect below.
const invocation: CodingInvocation = { executable: 'codex', args: ['exec', '--json', '-'], cwd: '/workspace', stdin: 'finite coding task', mode: 'edit', timeoutMs: 100, maxOutputBytes: 64 };
const options: CodexProcessOptions = { codexBinary: '/host/codex', nodeBinary: '/host/node', codeModeHost: '/host/helper', codexHome: '/coding', protectedPaths: ['/state', '/source'] };
class Child extends EventEmitter {
  pid = 700;
  stdin = Object.assign(new EventEmitter(), { destroyed: false, end: (_value: string | Uint8Array) => {}, write: (_value: string | Uint8Array) => {} });
  stdout = new EventEmitter(); stderr = new EventEmitter(); closed = false;
  close(code: number | null = 0, signal: NodeJS.Signals | null = null) { if (!this.closed) { this.closed = true; this.emit('close', code, signal); } }
}
function fixture() {
  const child = new Child();
  const state = { now: 10, launches: 0, kills: [] as number[], args: [] as string[], input: '', policy: '', removed: 0,
    closeOnKill: true, failTimer: false, fileHardlink: false, files: [] as string[], timers: [] as { fire(): void; cancelled: boolean }[] };
  const stat = (path: string) => ({ mode: path === '/coding' ? 0o40700 : path.endsWith('auth.json') ? 0o100600 : 0o100755,
    uid: 1000, dev: 1, nlink: state.fileHardlink && path.endsWith('/alias') ? 2 : 1,
    isDirectory: () => ['/workspace', '/coding', '/state', '/source', '/usr'].includes(path),
    isFile: () => !['/workspace', '/coding', '/state', '/source', '/usr'].includes(path), isSymbolicLink: () => false });
  const environment: CodexProcessDependencies = { ...nodeExecutionEnvironment(), platform: () => 'linux', uid: () => 1000, pid: () => 500,
    monotonicNow: () => state.now, realpath: path => path,
    stat: stat as CodexProcessDependencies['stat'], lstat: stat as CodexProcessDependencies['lstat'],
    readdir: path => path === '/workspace' ? state.files : [],
    schedule: (_delay, callback) => {
      if (state.failTimer) throw Error('timer unavailable');
      const timer = { fire: callback, cancelled: false }; state.timers.push(timer); return { cancel: () => { timer.cancelled = true; } };
    },
    spawn: (file, args, input, gate) => {
      assert.equal(file, '/usr/bin/setpriv'); assert.equal(input, 'pipe'); assert.equal(gate, false);
      state.launches++; state.args = args; return child as ProcessChild;
    },
    kill: pid => { state.kills.push(pid); if (state.closeOnKill) child.close(null, 'SIGKILL'); },
    policyFile: contents => { state.policy = contents; return { path: '/private-policy/requirements.toml', remove: () => { state.removed++; } }; },
  };
  child.stdin.end = value => { state.input = String(value); };
  return { child, state, environment };
}
const tick = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); };

test('host binding uses isolated mounts, explicit environment and managed auth denial with retained streams', async () => {
  const f = fixture(), execute = createCodexProcess(options, f.environment), running = execute(invocation); await tick();
  f.environment.monotonicNow = () => NaN; // Captured dependencies cannot be replaced during an active call.
  f.child.stdout.emit('data', Buffer.from('event\n')); f.child.stderr.emit('data', Buffer.from('diagnostic\n'));
  f.state.now = 23; f.child.close();
  const result = await running;
  assert.deepEqual(result, { exitCode: 0, signal: null, stdout: 'event\n', stderr: 'diagnostic\n', elapsedMs: 13 });
  assert.equal(f.state.input, invocation.stdin); assert.equal(f.state.removed, 1); assert.equal(f.state.timers[0]!.cancelled, true);
  assert.ok(f.state.args.includes('--pdeathsig')); assert.ok(f.state.args.includes('--die-with-parent')); assert.ok(f.state.args.includes('--new-session'));
  assert.ok(f.state.args.includes('--share-net')); assert.ok(f.state.args.includes('--clearenv'));
  assert.ok(f.state.args.includes('/etc/codex/requirements.toml')); assert.ok(f.state.args.includes('/runtime/codex-code-mode-host'));
  assert.match(f.state.policy, /deny_read = \["\/coding-home\/auth.json"\]/);
  assert.ok(!f.state.args.includes('/state')); assert.ok(!f.state.args.includes('/source')); assert.ok(!f.state.args.includes('/home'));
});

test('each invocation independently selects the workspace mount and immutable allowed native sandbox mode', async () => {
  for (const mode of [undefined, 'inspect', 'edit'] as const) {
    const f = fixture(), execute = createCodexProcess(options, f.environment);
    const running = execute({ ...invocation, mode }); await tick(); f.child.close(); await running;
    const mountIndex = f.state.args.findIndex((arg, index) => arg === '/workspace' && f.state.args[index + 1] === '/work');
    assert.equal(f.state.args[mountIndex - 1], mode === 'edit' ? '--bind' : '--ro-bind');
    assert.match(f.state.policy, mode === 'edit' ? /allowed_sandbox_modes = \["read-only", "workspace-write"\]/ : /allowed_sandbox_modes = \["read-only"\]/);
  }
  const f = fixture();
  await assert.rejects(createCodexProcess(options, f.environment)({ ...invocation, mode: 'write' as CodingMode }), /mode must be inspect or edit/);
  assert.equal(f.state.launches, 0);
});

for (const reason of ['timeout', 'cancelled', 'output-limit'] as const) test(`coding ${reason} kills and drains the full namespace`, async () => {
  const f = fixture(), controller = new AbortController(), execute = createCodexProcess(options, f.environment);
  const running = execute(invocation, controller.signal); await tick();
  if (reason === 'timeout') f.state.timers[0]!.fire();
  else if (reason === 'cancelled') controller.abort();
  else { f.child.stdout.emit('data', Buffer.alloc(50, 97)); f.child.stderr.emit('data', Buffer.alloc(50, 98)); }
  const receipt = await running;
  assert.equal(receipt.stoppedFor, reason); assert.deepEqual(f.state.kills, [-700]);
  assert.ok(Buffer.byteLength(receipt.stdout) + Buffer.byteLength(receipt.stderr) <= invocation.maxOutputBytes);
  assert.equal(f.state.removed, 1);
});

test('pre-cancelled and overlapping invocations never launch another process', async () => {
  const f = fixture(), controller = new AbortController(), execute = createCodexProcess(options, f.environment); controller.abort();
  await assert.rejects(execute(invocation, controller.signal)); assert.equal(f.state.launches, 0);
  const first = execute(invocation); await tick();
  await assert.rejects(execute(invocation), /already active/); assert.equal(f.state.launches, 1);
  f.child.close(); await first;
});

test('abort during spawn is caught before writing the task', async () => {
  const f = fixture(), controller = new AbortController(), spawn = f.environment.spawn;
  f.environment.spawn = (...args) => { controller.abort(); return spawn(...args); };
  const receipt = await createCodexProcess(options, f.environment)(invocation, controller.signal);
  assert.equal(receipt.stoppedFor, 'cancelled'); assert.equal(f.state.input, '');
});

test('launch and timer failures drain acquired processes before deleting the policy', async () => {
  const f = fixture(); f.state.closeOnKill = false;
  const running = createCodexProcess(options, f.environment)(invocation); let settled = false;
  void running.catch(() => { settled = true; }); await tick(); f.child.emit('error', Error('launch failed')); await tick();
  assert.equal(settled, false); assert.equal(f.state.removed, 0); f.child.close(125);
  await assert.rejects(running, /launch unavailable/); assert.equal(f.state.removed, 1);
  const t = fixture(); t.state.failTimer = true;
  await assert.rejects(createCodexProcess(options, t.environment)(invocation), /timer unavailable/);
  assert.equal(t.child.closed, true); assert.equal(t.state.removed, 1);
});

test('platform, executable, storage overlap, hardlink and credential permissions fail before spawn', async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.environment.platform = () => 'darwin'; },
    (f: ReturnType<typeof fixture>) => { f.environment.realpath = path => path === '/workspace' ? '/state' : path; },
    (f: ReturnType<typeof fixture>) => { f.state.files = ['alias']; f.state.fileHardlink = true; },
    (f: ReturnType<typeof fixture>) => { const lstat = f.environment.lstat; f.environment.lstat = ((path: string) => ({ ...lstat(path), mode: 0o100644 })) as CodexProcessDependencies['lstat']; },
  ]) {
    const f = fixture(); mutate(f); await assert.rejects(createCodexProcess(options, f.environment)(invocation)); assert.equal(f.state.launches, 0);
  }
  const f = fixture(); await assert.rejects(createCodexProcess(options, f.environment)({ ...invocation, executable: '/bin/sh' }), /host-bound/); assert.equal(f.state.launches, 0);
});

function realFixture() {
  const root = mkdtempSync(join(tmpdir(), 'aeon-codex-process-')), workspace = join(root, 'workspace'), home = join(root, 'coding'), state = join(root, 'state');
  mkdirSync(workspace); mkdirSync(home, { mode: 0o700 }); mkdirSync(state);
  writeFileSync(join(home, 'auth.json'), '{"fixture":true}', { mode: 0o600 }); writeFileSync(join(state, 'private'), 'private state');
  return { root, workspace, home, state, options: { codexBinary: process.execPath, nodeBinary: process.execPath, codexHome: home, protectedPaths: [state] } satisfies CodexProcessOptions };
}

function bundledFixture() {
  const f = realFixture(), application = join(f.root, 'application'), nodeBinary = join(application, runtimeBundlePath);
  mkdirSync(join(application, '.runtime'), { recursive: true }); copyFileSync(process.execPath, nodeBinary);
  writeFileSync(join(application, '.runtime', 'private-control'), 'protected runtime sibling');
  writeFileSync(join(application, 'private-control'), 'protected application control');
  const identity: RuntimeIdentity = { nodeVersion: process.version, nodeSha256: createHash('sha256').update(readFileSync(nodeBinary)).digest('hex'),
    platform: process.platform, arch: process.arch, bundle: { path: runtimeBundlePath, bytes: statSync(nodeBinary).size } };
  return { ...f, application, nodeBinary, options: { ...f.options, nodeBinary, nodeRuntime: { root: application, identity }, protectedPaths: [f.state, application] } };
}

test('pinned bundled Node runs read-only in the actual namespace without exposing its protected application', async () => {
  const f = bundledFixture();
  try {
    const { nodeRuntime, ...withoutGrant } = f.options;
    await assert.rejects(createCodexProcess(withoutGrant)({ ...invocation, cwd: f.workspace }), /overlaps protected storage/);
    const receipt = await createCodexProcess(f.options)({ ...invocation, cwd: f.workspace, timeoutMs: 5000, maxOutputBytes: 4096,
      args: ['-e', `const fs=require('node:fs'),{spawnSync}=require('node:child_process');
        if(fs.existsSync('/app/private-control')||fs.existsSync('/runtime/private-control')||fs.existsSync(${JSON.stringify(f.application)}))throw Error('application exposed');
        if(require('node:crypto').createHash('sha256').update(fs.readFileSync('/runtime/node')).digest('hex')!==${JSON.stringify(nodeRuntime.identity.nodeSha256)})throw Error('runtime identity changed');
        try{fs.writeFileSync('/runtime/node','changed');throw Error('runtime writable')}catch(error){if(!['EROFS','EACCES','ETXTBSY'].includes(error.code))throw error}
        const child=spawnSync('/runtime/node',['-e',"require('node:fs').writeFileSync('/work/runtime-result',process.version);console.log(process.version)"],{encoding:'utf8'});
        if(child.status!==0)throw Error(child.stderr);process.stdout.write(child.stdout);`] });
    assert.equal(receipt.exitCode, 0, receipt.stderr);
    assert.equal(receipt.stdout, `${process.version}\n`);
    assert.equal(readFileSync(join(f.workspace, 'runtime-result'), 'utf8'), process.version);
    assert.equal(readFileSync(join(f.application, 'private-control'), 'utf8'), 'protected application control');
    assert.equal(createHash('sha256').update(readFileSync(f.nodeBinary)).digest('hex'), nodeRuntime.identity.nodeSha256);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('bundled runtime grants reject identity, path, protection and writable-storage mismatches before spawn', async () => {
  const f = bundledFixture(), dependencies = nodeCodexProcessDependencies(f.state); let launches = 0;
  dependencies.spawn = () => { launches++; throw Error('unexpected spawn'); };
  const reject = async (options: CodexProcessOptions, expected: RegExp, injected = dependencies) => {
    await assert.rejects(createCodexProcess(options, injected)({ ...invocation, cwd: f.workspace }), expected);
    assert.equal(launches, 0); assert.deepEqual(readdirSync(f.state), ['private']);
  };
  try {
    const grant = f.options.nodeRuntime;
    await reject({ ...f.options, nodeRuntime: { ...grant, identity: { ...grant.identity, nodeSha256: '0'.repeat(64) } } }, /Pinned runtime changed/);
    await reject({ ...f.options, nodeRuntime: { ...grant, identity: { ...grant.identity, bundle: { ...grant.identity.bundle!, bytes: 1 } } } }, /bundle size differs/);
    const { bundle: _bundle, ...unbundled } = grant.identity;
    await reject({ ...f.options, nodeRuntime: { ...grant, identity: unbundled } }, /exact protected application file/);
    await reject({ ...f.options, nodeBinary: process.execPath }, /exact protected application file/);
    await reject({ ...f.options, nodeRuntime: { ...grant, root: f.state } }, /exact protected application file/);
    await reject({ ...f.options, protectedPaths: [f.state] }, /exact protected application file/);
    await reject(f.options, /exact protected application file/, { ...dependencies, verifyRuntimeFile: undefined });
    for (const protectedChild of [join(f.application, '.runtime'), f.nodeBinary]) {
      await reject({ ...f.options, protectedPaths: [...f.options.protectedPaths, protectedChild] }, /overlaps protected storage/);
    }
    for (const writable of [f.home, f.workspace]) {
      const path = join(writable, 'node'); writeFileSync(path, 'fixture executable', { mode: 0o700 });
      await reject({ ...f.options, nodeBinary: path }, /cannot come from writable coding storage/);
      rmSync(path);
    }
    linkSync(f.nodeBinary, join(f.root, 'runtime-hardlink'));
    await reject(f.options, /without hardlinks/); rmSync(join(f.root, 'runtime-hardlink'));
    renameSync(f.nodeBinary, join(f.application, '.runtime', 'retained-node'));
    symlinkSync('retained-node', f.nodeBinary);
    await reject(f.options, /exact protected application file/); rmSync(f.nodeBinary);
    renameSync(join(f.application, '.runtime', 'retained-node'), f.nodeBinary);
    renameSync(join(f.application, '.runtime'), join(f.application, 'retained-runtime'));
    symlinkSync('retained-runtime', join(f.application, '.runtime'));
    await reject(f.options, /exact protected application file/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('bundled runtime identity and verification callback are captured before host callbacks run', async () => {
  const f = fixture(), identity: RuntimeIdentity = { nodeVersion: 'v24.13.0', nodeSha256: 'a'.repeat(64), platform: 'linux', arch: 'x64', bundle: { path: runtimeBundlePath, bytes: 100 } };
  const grant = { root: '/source', identity }, bound = { ...options, nodeBinary: '/source/.runtime/node', nodeRuntime: grant };
  const expected = structuredClone(grant); let verified = 0;
  f.environment.verifyRuntimeFile = (root, path, actual) => { verified++; assert.equal(root, expected.root); assert.equal(path, runtimeBundlePath); assert.deepEqual(actual, expected.identity); };
  const policyFile = f.environment.policyFile;
  f.environment.policyFile = contents => {
    grant.root = '/state'; identity.nodeSha256 = 'b'.repeat(64); identity.bundle!.bytes = 1;
    f.environment.verifyRuntimeFile = () => { throw Error('replaced verifier used'); };
    return policyFile(contents);
  };
  const running = createCodexProcess(bound, f.environment)(invocation); await tick(); f.child.close(); await running;
  assert.equal(verified, 1); assert.equal(f.state.launches, 1);
  const mount = f.state.args.findIndex((arg, index) => arg === '/source/.runtime/node' && f.state.args[index + 1] === '/runtime/node');
  assert.equal(f.state.args[mount - 1], '--ro-bind'); assert.ok(!f.state.args.includes('/source'));
});

test('default inspect namespace reads files but rejects direct, aliased and metadata writes while persisting session state', async () => {
  const f = realFixture();
  try {
    writeFileSync(join(f.workspace, 'original'), 'retained source');
    mkdirSync(join(f.workspace, 'nested')); symlinkSync('original', join(f.workspace, 'alias'));
    const beforeMode = statSync(join(f.workspace, 'original')).mode;
    const receipt = await createCodexProcess(f.options)({ ...invocation, mode: undefined, cwd: f.workspace, timeoutMs: 5000, maxOutputBytes: 4096,
      args: ['-e', `const fs=require('node:fs');
        if(fs.readFileSync('/work/original','utf8')!=='retained source')throw Error('inspection unreadable');
        fs.symlinkSync('/work/original','/coding-home/workspace-alias');
        const attempts=[
          ()=>fs.writeFileSync('/work/original','changed'),
          ()=>fs.appendFileSync('/work/alias','changed'),
          ()=>fs.writeFileSync('/coding-home/workspace-alias','changed'),
          ()=>fs.writeFileSync('/proc/self/cwd/original','changed'),
          ()=>fs.writeFileSync('/work/new-file','new'),
          ()=>fs.writeFileSync('/work/nested/new-file','new'),
          ()=>fs.unlinkSync('/work/original'),
          ()=>fs.renameSync('/work/original','/work/renamed'),
          ()=>fs.chmodSync('/work/original',0o777),
          ()=>fs.mkdirSync('/work/new-directory')];
        for(const attempt of attempts){let denied=false;try{attempt()}catch(error){if(!['EROFS','EACCES','EPERM'].includes(error.code))throw error;denied=true}if(!denied)throw Error('inspect permitted a workspace mutation')}
        fs.writeFileSync('/coding-home/fixture-session','same native session');
        console.log(JSON.stringify({read:true,denied:attempts.length,sessionPersisted:true}));`] });
    assert.equal(receipt.exitCode, 0, receipt.stderr);
    assert.deepEqual(JSON.parse(receipt.stdout), { read: true, denied: 10, sessionPersisted: true });
    assert.equal(readFileSync(join(f.workspace, 'original'), 'utf8'), 'retained source');
    assert.equal(statSync(join(f.workspace, 'original')).mode, beforeMode);
    assert.deepEqual(readdirSync(f.workspace).sort(), ['alias', 'nested', 'original']);
    assert.deepEqual(readdirSync(join(f.workspace, 'nested')), []);
    assert.equal(readFileSync(join(f.home, 'fixture-session'), 'utf8'), 'same native session');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('one fixture native session resumes through inspect, edit and inspect with host write authority changing each turn', async () => {
  const f = realFixture(), sessionId = '0199e12a-9af2-7123-8a90-92b4f0e11b51', executable = join(f.root, 'fixture-codex');
  try {
    writeFileSync(join(f.workspace, 'target'), 'original');
    writeFileSync(executable, `#!/runtime/node
      const fs=require('node:fs'),args=process.argv.slice(2),session=${JSON.stringify(sessionId)},path='/coding-home/fixture-session.json';
      fs.readFileSync(0,'utf8');
      const resume=args.indexOf('resume');
      if(resume<0&&fs.existsSync(path))throw Error('second native session started');
      const previous=resume<0?{session,turn:0}:JSON.parse(fs.readFileSync(path,'utf8'));
      if(resume>=0&&(args[resume+1]!==session||previous.session!==session))throw Error('foreign session resumed');
      const next={session,turn:previous.turn+1};fs.writeFileSync(path,JSON.stringify(next));
      const sandbox=args[args.indexOf('--sandbox')+1];let wrote=false;
      try{fs.appendFileSync('/work/target',' edited');wrote=true}catch(error){if(!['EROFS','EACCES','EPERM'].includes(error.code))throw error}
      if(wrote!==(sandbox==='workspace-write'))throw Error('host and native requested authority diverged');
      for(const event of [{type:'thread.started',thread_id:session},{type:'item.completed',item:{type:'agent_message',text:JSON.stringify({sandbox,wrote,turn:next.turn})}},
        {type:'turn.completed',usage:{input_tokens:next.turn*10,output_tokens:next.turn,cached_input_tokens:0}}])console.log(JSON.stringify(event));
    `, { mode: 0o755 });
    const provider = new CodexCodingProvider({ execute: createCodexProcess({ ...f.options, codexBinary: executable }), timeoutMs: 5000, maxOutputBytes: 4096 });
    let previousUsage;
    for (const [index, mode] of ([undefined, 'edit', undefined] as const).entries()) {
      const result = await provider.run({ message: 'Inspect or edit the fixture as authorized.', workspace: f.workspace, mode,
        ...(index ? { sessionId, previousUsage } : {}) });
      assert.equal(result.status, 'completed', result.stderr + result.summary);
      assert.equal(result.sessionId, sessionId);
      assert.equal(result.mode, mode ?? 'inspect');
      assert.deepEqual(JSON.parse(result.summary), { sandbox: mode === 'edit' ? 'workspace-write' : 'read-only', wrote: mode === 'edit', turn: index + 1 });
      assert.equal(readFileSync(join(f.workspace, 'target'), 'utf8'), index ? 'original edited' : 'original');
      assert.equal(result.usage.inputTokens, 10);
      previousUsage = result.cumulativeUsage;
    }
    assert.deepEqual(JSON.parse(readFileSync(join(f.home, 'fixture-session.json'), 'utf8')), { session: sessionId, turn: 3 });
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('real namespace accepts stdin and edits only the selected workspace without host environment', async () => {
  const f = realFixture();
  try {
    const receipt = await createCodexProcess(f.options)({ ...invocation, cwd: f.workspace, timeoutMs: 5000, maxOutputBytes: 4096,
      args: ['--input-type=module', '-e', `import fs from 'node:fs';
        if(fs.existsSync(${JSON.stringify(f.state)}) || fs.existsSync('/home/palimpsest')) throw Error('host visible');
        if(process.env.USER || process.env.OPENAI_API_KEY || process.env.MISTRAL_API_KEY) throw Error('host environment visible');
        fs.writeFileSync('/work/result',fs.readFileSync(0,'utf8')); console.log(process.cwd(),process.env.CODEX_HOME);
        console.error('bounded diagnostic');`] });
    assert.equal(receipt.exitCode, 0, receipt.stderr); assert.equal(readFileSync(join(f.workspace, 'result'), 'utf8'), invocation.stdin);
    assert.equal(receipt.stdout, '/work /coding-home\n'); assert.equal(receipt.stderr, 'bounded diagnostic\n');
    assert.equal(readFileSync(join(f.state, 'private'), 'utf8'), 'private state');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('host-selected toolchain is readable and immutable while its protected application parent stays hidden', async () => {
  const f = realFixture(), application = join(f.root, 'application'), toolchain = join(application, 'node_modules');
  try {
    mkdirSync(join(toolchain, 'fixture-package'), { recursive: true }); mkdirSync(join(toolchain, '.bin'));
    writeFileSync(join(application, 'private-control'), 'protected application control');
    writeFileSync(join(toolchain, 'fixture-package', 'index.cjs'), 'module.exports="pinned dependency"');
    symlinkSync('../fixture-package/index.cjs', join(toolchain, '.bin', 'fixture'));
    const receipt = await createCodexProcess({ ...f.options, toolchainDirectory: toolchain, protectedPaths: [f.state, application] })({
      ...invocation, cwd: f.workspace, timeoutMs: 5000, maxOutputBytes: 4096,
      args: ['-e', `const fs=require('node:fs');
        if(fs.existsSync('/app/private-control') || fs.existsSync(${JSON.stringify(application)})) throw Error('application exposed');
        if(require('/app/node_modules/fixture-package/index.cjs')!=='pinned dependency') throw Error('toolchain missing');
        fs.readFileSync('/app/node_modules/.bin/fixture');
        try {fs.writeFileSync('/app/node_modules/fixture-package/index.cjs','mutated');throw Error('toolchain writable')}catch(e){if(!['EROFS','EACCES'].includes(e.code))throw e;}
        fs.writeFileSync('/work/toolchain-result','pinned dependency verified');`],
    });
    assert.equal(receipt.exitCode, 0, receipt.stderr);
    assert.equal(readFileSync(join(f.workspace, 'toolchain-result'), 'utf8'), 'pinned dependency verified');
    assert.equal(readFileSync(join(toolchain, 'fixture-package', 'index.cjs'), 'utf8'), 'module.exports="pinned dependency"');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('toolchain hardlinks, escaping symlinks and separately protected descendants fail before launch', async () => {
  const f = realFixture(), toolchain = join(f.root, 'application', 'node_modules');
  try {
    mkdirSync(toolchain, { recursive: true });
    const execute = (protectedPaths = [f.state]) => createCodexProcess({ ...f.options, toolchainDirectory: toolchain, protectedPaths })({ ...invocation, cwd: f.workspace });
    linkSync(join(f.state, 'private'), join(toolchain, 'alias'));
    await assert.rejects(execute(), /hardlink/); rmSync(join(toolchain, 'alias'));
    symlinkSync(join(f.state, 'private'), join(toolchain, 'alias'));
    await assert.rejects(execute(), /escaping symlink/); rmSync(join(toolchain, 'alias'));
    const protectedChild = join(toolchain, 'private'); mkdirSync(protectedChild);
    await assert.rejects(execute([f.state, protectedChild]), /contains protected/);
    await assert.rejects(createCodexProcess({ ...f.options, toolchainDirectory: f.state })({ ...invocation, cwd: f.workspace }), /node_modules directory/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('the pinned compiler checks a separate workspace using the read-only dependency closure', async () => {
  const f = realFixture(), application = fileURLToPath(new URL('../', import.meta.url));
  try {
    writeFileSync(join(f.workspace, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2024', module: 'NodeNext',
      moduleResolution: 'NodeNext', types: ['node'], strict: true, noEmit: true, skipLibCheck: true }, include: ['example.ts'] }));
    writeFileSync(join(f.workspace, 'example.ts'), 'import { readFileSync } from "node:fs"; const contents: string = readFileSync("example.ts", "utf8");\n');
    const receipt = await createCodexProcess({ ...f.options, toolchainDirectory: join(application, 'node_modules'), protectedPaths: [f.state, application] })({
      ...invocation, cwd: f.workspace, timeoutMs: 10000, maxOutputBytes: 4096,
      args: ['/app/node_modules/typescript/bin/tsc', '--project', '/work/tsconfig.json', '--typeRoots', '/app/node_modules/@types'],
    });
    assert.equal(receipt.exitCode, 0, receipt.stderr + receipt.stdout);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('real timeout reaps a detached descendant before it can finish a delayed write', async () => {
  const f = realFixture();
  try {
    const receipt = await createCodexProcess(f.options)({ ...invocation, cwd: f.workspace, timeoutMs: 200, maxOutputBytes: 4096,
      args: ['-e', `require('node:child_process').spawn('/usr/bin/setsid',['/bin/sh','-c','sleep 1; echo escaped > /work/escaped'],{stdio:'inherit'});setTimeout(()=>{},10000)`] });
    assert.equal(receipt.stoppedFor, 'timeout');
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.throws(() => statSync(join(f.workspace, 'escaped')), /ENOENT/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('unexpected host death kills the namespace and detached descendants', async () => {
  const f = realFixture();
  const module = new URL('./codex-process.ts', import.meta.url).href;
  const source = `import {createCodexProcess,nodeCodexProcessDependencies} from ${JSON.stringify(module)};
    import {writeFileSync,rmSync} from 'node:fs';
    const dependencies=nodeCodexProcessDependencies();
    dependencies.policyFile=contents=>{const path=${JSON.stringify(join(f.root, 'requirements.toml'))};writeFileSync(path,contents,{mode:0o600});return {path,remove:()=>rmSync(path,{force:true})}};
    await createCodexProcess(${JSON.stringify(f.options)},dependencies)(${JSON.stringify({ ...invocation, cwd: f.workspace, timeoutMs: 10000, maxOutputBytes: 4096,
      args: ['-e', "require('node:child_process').spawn('/usr/bin/setsid',['/bin/sh','-c','echo ready > /work/ready; sleep 1; echo escaped > /work/escaped'],{stdio:'inherit'});setTimeout(()=>{},10000)"] })});`;
  const host = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: 'ignore' });
  const closed = new Promise<void>((resolve, reject) => { host.once('error', reject); host.once('close', () => resolve()); });
  try {
    const deadline = performance.now() + 5000;
    while (true) {
      try { statSync(join(f.workspace, 'ready')); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      assert.ok(performance.now() < deadline, 'fixture namespace did not start');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    host.kill('SIGKILL'); await closed;
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.throws(() => statSync(join(f.workspace, 'escaped')), /ENOENT/);
  } finally { host.kill('SIGKILL'); await closed; rmSync(f.root, { recursive: true, force: true }); }
});

test('real workspace hardlinks are refused with either a separate or shared Codex home', async () => {
  const f = realFixture();
  try {
    linkSync(join(f.state, 'private'), join(f.workspace, 'alias'));
    await assert.rejects(createCodexProcess(f.options)({ ...invocation, cwd: f.workspace }), /hardlink/);
    const home = join(f.root, '.codex'); mkdirSync(home, { mode: 0o700 });
    writeFileSync(join(home, 'auth.json'), '{"fixture":true}', { mode: 0o600 });
    await assert.rejects(createCodexProcess({ ...f.options, codexHome: home })({ ...invocation, cwd: f.workspace }), /hardlink/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('production policy file has private permissions and explicit cleanup', () => {
  const policy = nodeCodexProcessDependencies().policyFile('fixture policy');
  assert.equal(statSync(policy.path).mode & 0o777, 0o600); assert.equal(readFileSync(policy.path, 'utf8'), 'fixture policy');
  policy.remove(); assert.throws(() => statSync(policy.path), /ENOENT/);
});

test('explicit protected policy root supports execution and cleans only its temporary subtree', async () => {
  const f = realFixture(), dependencies = nodeCodexProcessDependencies(f.state), policyFile = dependencies.policyFile;
  let observedPath = '';
  dependencies.policyFile = contents => {
    const policy = policyFile(contents); observedPath = policy.path;
    assert.ok(policy.path.startsWith(f.state + '/aeon-codex-policy-'));
    assert.equal(statSync(join(policy.path, '..')).mode & 0o777, 0o700);
    assert.equal(statSync(policy.path).mode & 0o777, 0o600);
    return policy;
  };
  try {
    const execute = createCodexProcess(f.options, dependencies);
    const receipt = await execute({ ...invocation, cwd: f.workspace, timeoutMs: 5000, maxOutputBytes: 4096,
      args: ['-e', `const fs=require('node:fs');
        if(!fs.readFileSync('/etc/codex/requirements.toml','utf8').includes('deny_read'))throw Error('policy absent');
        if(fs.existsSync(${JSON.stringify(f.state)}))throw Error('protected policy root exposed');
        fs.writeFileSync('/work/policy-verified','protected policy mounted');`] });
    assert.equal(receipt.exitCode, 0, receipt.stderr);
    assert.equal(readFileSync(join(f.workspace, 'policy-verified'), 'utf8'), 'protected policy mounted');
    assert.throws(() => statSync(observedPath), /ENOENT/); assert.deepEqual(readdirSync(f.state), ['private']);
    await assert.rejects(execute({ ...invocation, cwd: f.workspace, executable: '/bin/sh' }), /host-bound/);
    assert.throws(() => statSync(observedPath), /ENOENT/); assert.deepEqual(readdirSync(f.state), ['private']);
    assert.equal(readFileSync(join(f.state, 'private'), 'utf8'), 'private state');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('installed native Linux launcher requires explicit PATH after shell environment sanitization',
  { skip: !process.env.AEON_CODEX_TEST_BINARY && 'Set AEON_CODEX_TEST_BINARY for the offline native CLI regression; no model request is made' }, async () => {
  const f = realFixture();
  try {
    const source = `const fs=require('node:fs'),{spawnSync}=require('node:child_process');
      const policy={type:'managed',file_system:{type:'restricted',entries:[{path:{type:'special',value:{kind:'root'}},access:'read'},{path:{type:'path',path:'/work'},access:'write'}]},network:'restricted'};
      const results=[{}, {PATH:'/runtime:/usr/bin:/bin'}].map(env=>{
        const p=spawnSync('/runtime/codex-code-mode-host',['--sandbox-policy-cwd','/work','--permission-profile',JSON.stringify(policy),'--','/bin/sh','-c','printf sandbox-command-ran'],
          {argv0:'codex-linux-sandbox',env,encoding:'utf8',timeout:3000});
        return {status:p.status,stdout:p.stdout,stderr:p.stderr};
      });
      fs.writeFileSync('/work/launcher-receipts.json',JSON.stringify(results));`;
    const receipt = await createCodexProcess({ ...f.options, codeModeHost: process.env.AEON_CODEX_TEST_BINARY! })({
      ...invocation, cwd: f.workspace, timeoutMs: 8000, maxOutputBytes: 4096, args: ['-e', source],
    });
    assert.equal(receipt.exitCode, 0, receipt.stderr);
    const [missing, supplied] = JSON.parse(readFileSync(join(f.workspace, 'launcher-receipts.json'), 'utf8'));
    assert.equal(missing.status, 101); assert.match(missing.stderr, /no system bwrap was found on PATH/);
    assert.equal(supplied.status, 0, supplied.stderr); assert.equal(supplied.stdout, 'sandbox-command-ran');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('installed native sandbox independently denies inspect writes and permits edit writes inside an editable outer fixture',
  { skip: !process.env.AEON_CODEX_TEST_BINARY && 'Set AEON_CODEX_TEST_BINARY for the offline native sandbox regression; no model request is made' }, async () => {
  const f = realFixture();
  try {
    writeFileSync(join(f.workspace, 'original'), 'original');
    const source = `const fs=require('node:fs'),{spawnSync}=require('node:child_process');
      const run=edit=>{
        const entries=[{path:{type:'special',value:{kind:'root'}},access:'read'}];
        if(edit)entries.push({path:{type:'path',path:'/work'},access:'write'});
        const policy={type:'managed',file_system:{type:'restricted',entries},network:'restricted'};
        const command=edit?'printf edited >> /work/original':'cat /work/original; printf forbidden > /work/original; touch /work/new-file';
        const result=spawnSync('/runtime/codex-code-mode-host',['--sandbox-policy-cwd','/work','--permission-profile',JSON.stringify(policy),'--','/bin/sh','-c',command],
          {argv0:'codex-linux-sandbox',env:{PATH:'/runtime:/usr/bin:/bin'},encoding:'utf8',timeout:3000});
        return {status:result.status,stdout:result.stdout,stderr:result.stderr,contents:fs.readFileSync('/work/original','utf8'),created:fs.existsSync('/work/new-file')};
      };console.log(JSON.stringify([run(false),run(true)]));`;
    const receipt = await createCodexProcess({ ...f.options, codeModeHost: process.env.AEON_CODEX_TEST_BINARY! })({
      ...invocation, mode: 'edit', cwd: f.workspace, timeoutMs: 8000, maxOutputBytes: 4096, args: ['-e', source],
    });
    assert.equal(receipt.exitCode, 0, receipt.stderr);
    const [inspection, edit] = JSON.parse(receipt.stdout);
    assert.notEqual(inspection.status, 0);
    assert.equal(inspection.stdout, 'original');
    assert.equal(inspection.contents, 'original');
    assert.equal(inspection.created, false);
    assert.match(inspection.stderr, /[Pp]ermission denied|[Rr]ead-only file system/);
    assert.equal(edit.status, 0, edit.stderr);
    assert.equal(edit.contents, 'originaledited');
    assert.equal(readFileSync(join(f.workspace, 'original'), 'utf8'), 'originaledited');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('installed native CLI loads the generated requirements for inspect and edit without inference',
  { skip: !process.env.AEON_CODEX_TEST_BINARY && 'Set AEON_CODEX_TEST_BINARY for real native config validation; features list performs no inference' }, async () => {
  const f = realFixture();
  try {
    for (const mode of ['inspect', 'edit'] as const) {
      const receipt = await createCodexProcess({ ...f.options, codexBinary: process.env.AEON_CODEX_TEST_BINARY! })({
        ...invocation, mode, cwd: f.workspace, timeoutMs: 10000, maxOutputBytes: 20000,
        args: ['-c', 'approval_policy="never"', '-c', `sandbox_mode="${mode === 'edit' ? 'workspace-write' : 'read-only'}"`, '--disable', 'multi_agent', 'features', 'list'],
      });
      assert.equal(receipt.exitCode, 0, `${mode}: ${receipt.stderr}`);
      assert.match(receipt.stdout, /multi_agent/);
    }
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
