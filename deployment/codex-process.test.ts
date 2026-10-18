import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { linkSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { CodingInvocation } from '../packages/coding/index.ts';
import { nodeExecutionEnvironment, type ProcessChild } from '../packages/supervisor/environment.ts';
import { createCodexProcess, nodeCodexProcessDependencies, type CodexProcessDependencies, type CodexProcessOptions } from './codex-process.ts';

const invocation: CodingInvocation = { executable: 'codex', args: ['exec', '--json', '-'], cwd: '/workspace', stdin: 'finite coding task', timeoutMs: 100, maxOutputBytes: 64 };
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

test('real preexisting hardlinks and full user Codex homes are refused', async () => {
  const f = realFixture();
  try {
    linkSync(join(f.state, 'private'), join(f.workspace, 'alias'));
    await assert.rejects(createCodexProcess(f.options)({ ...invocation, cwd: f.workspace }), /hardlink/);
    const home = join(f.root, '.codex'); mkdirSync(home, { mode: 0o700 });
    await assert.rejects(createCodexProcess({ ...f.options, codexHome: home })({ ...invocation, cwd: f.workspace }), /dedicated/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('production policy file has private permissions and explicit cleanup', () => {
  const policy = nodeCodexProcessDependencies().policyFile('fixture policy');
  assert.equal(statSync(policy.path).mode & 0o777, 0o600); assert.equal(readFileSync(policy.path, 'utf8'), 'fixture policy');
  policy.remove(); assert.throws(() => statSync(policy.path), /ENOENT/);
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
