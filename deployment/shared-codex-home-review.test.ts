import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { nodeExecutionEnvironment, type ProcessChild } from '../packages/supervisor/environment.ts';
import type { CodingInvocation } from '../packages/coding/index.ts';
import { createCodexProcess, type CodexProcessDependencies, type CodexProcessOptions } from './codex-process.ts';

const home = '/home/owner/.codex';
const options: CodexProcessOptions = { codexBinary: '/runtime-source/codex', nodeBinary: '/runtime-source/node', codexHome: home, protectedPaths: ['/protected-state'] };
const invocation: CodingInvocation = { executable: 'codex', args: ['exec', '--json', 'resume', '01a14e9a-f676-7f22-b71b-08cdc6111a4e', '-'],
  cwd: '/workspace', stdin: 'One explicit read-only follow-up.', mode: 'inspect', timeoutMs: 100, maxOutputBytes: 1000 };
function fixture() {
  const state = { launches: 0, args: [] as string[], policy: '', removed: 0, listed: [] as string[], rootMode: 0o40700, rootUid: 1000,
    authMode: 0o100600, authUid: 1000, authLinks: 1, authSymlink: false, homeFile: false, workspaceSpecial: false };
  const child = new EventEmitter() as EventEmitter & { pid: number; stdin: EventEmitter & { destroyed: boolean; end(value: unknown): void; write(value: unknown): void }; stdout: EventEmitter; stderr: EventEmitter };
  child.pid = 800; child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  child.stdin = Object.assign(new EventEmitter(), { destroyed: false, end(_value: unknown) { queueMicrotask(() => child.emit('close', 0, null)); }, write(_value: unknown) {} });
  const stat = (path: string) => {
    const isHome = path === home, auth = path === home + '/auth.json', special = path === '/workspace/socket';
    const directory = ['/workspace', home, '/usr'].includes(path) && !(isHome && state.homeFile);
    return { mode: isHome ? state.rootMode : auth ? state.authMode : directory ? 0o40755 : 0o100755,
      uid: isHome ? state.rootUid : auth ? state.authUid : 1000, dev: 1, nlink: auth ? state.authLinks : 1,
      isDirectory: () => directory, isFile: () => !directory && !special && !(auth && state.authSymlink), isSymbolicLink: () => auth && state.authSymlink };
  };
  const environment: CodexProcessDependencies = { ...nodeExecutionEnvironment(), platform: () => 'linux', uid: () => 1000, pid: () => 500, monotonicNow: () => 10,
    realpath: path => path, stat: stat as CodexProcessDependencies['stat'], lstat: stat as CodexProcessDependencies['lstat'],
    readdir: path => {
      state.listed.push(path);
      if (path === home) throw Error('A shared home may contain live sockets and disappearing SQLite/cache entries; do not enumerate it');
      return path === '/workspace' && state.workspaceSpecial ? ['socket'] : [];
    },
    spawn: (_file, args) => { state.launches++; state.args = args; return child as ProcessChild; },
    kill: () => child.emit('close', null, 'SIGKILL'), schedule: () => ({ cancel() {} }),
    policyFile: contents => { state.policy = contents; return { path: '/private-policy/requirements.toml', remove() { state.removed++; } }; },
  };
  return { state, environment };
}

test('canonical .codex home is the one writable native home without traversing app sockets or caches', async () => {
  const f = fixture(), receipt = await createCodexProcess(options, f.environment)(invocation);
  assert.equal(receipt.exitCode, 0); assert.equal(f.state.launches, 1); assert.equal(f.state.removed, 1);
  const homeMount = f.state.args.findIndex((arg, index) => arg === home && f.state.args[index + 1] === '/coding-home');
  assert.ok(homeMount > 0); assert.equal(f.state.args[homeMount - 1], '--bind');
  assert.equal(f.state.args.filter(arg => arg === home).length, 1);
  assert.ok(f.state.args.some((arg, index) => arg === 'CODEX_HOME' && f.state.args[index + 1] === '/coding-home'));
  const workspaceMount = f.state.args.findIndex((arg, index) => arg === '/workspace' && f.state.args[index + 1] === '/work');
  assert.equal(f.state.args[workspaceMount - 1], '--ro-bind');
  assert.match(f.state.policy, /deny_read = \["\/coding-home\/auth.json"\]/);
  assert.match(f.state.policy, /allowed_sandbox_modes = \["read-only"\]/);
  assert.deepEqual(f.state.listed, ['/workspace']); assert.ok(!f.state.args.includes('/protected-state'));
  assert.ok(f.state.args.includes('resume')); assert.ok(f.state.args.includes('01a14e9a-f676-7f22-b71b-08cdc6111a4e'));
});

test('shared home still requires an owner-private directory before any native process starts', async () => {
  for (const change of [(f: ReturnType<typeof fixture>) => { f.state.rootMode = 0o40775; },
    (f: ReturnType<typeof fixture>) => { f.state.rootUid = 999; }, (f: ReturnType<typeof fixture>) => { f.state.homeFile = true; }]) {
    const f = fixture(); change(f);
    await assert.rejects(createCodexProcess(options, f.environment)(invocation)); assert.equal(f.state.launches, 0); assert.equal(f.state.removed, 1);
  }
});

test('shared home does not relax exact auth file permissions, ownership, link count or symlink rejection', async () => {
  for (const change of [(f: ReturnType<typeof fixture>) => { f.state.authMode = 0o100644; },
    (f: ReturnType<typeof fixture>) => { f.state.authUid = 999; }, (f: ReturnType<typeof fixture>) => { f.state.authLinks = 2; },
    (f: ReturnType<typeof fixture>) => { f.state.authSymlink = true; }]) {
    const f = fixture(); change(f);
    await assert.rejects(createCodexProcess(options, f.environment)(invocation)); assert.equal(f.state.launches, 0);
  }
});

test('shared home preserves protected-path and workspace overlap exclusions and workspace special-file refusal', async () => {
  for (const protectedPath of [home, '/home/owner', home + '/sessions']) {
    const f = fixture();
    await assert.rejects(createCodexProcess({ ...options, protectedPaths: [protectedPath] }, f.environment)(invocation), /overlaps protected/);
    assert.equal(f.state.launches, 0);
  }
  const overlap = fixture(); overlap.environment.realpath = path => path === '/workspace' ? home : path;
  await assert.rejects(createCodexProcess(options, overlap.environment)(invocation), /overlaps credential/); assert.equal(overlap.state.launches, 0);
  const special = fixture(); special.state.workspaceSpecial = true;
  await assert.rejects(createCodexProcess(options, special.environment)(invocation), /special file/); assert.equal(special.state.launches, 0);
});
