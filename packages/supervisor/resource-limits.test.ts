import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { confinementArguments, runConfined, type ConfinedCommand } from './confinement.ts';
import { diagnoseResourceConfinement, initializeResourceDelegation, type ResourceLimits } from './resource-limits.ts';
import { runWorker } from './worker-process.ts';

test('resource readiness refuses an absent profile and a nondelegated cgroup', () => {
  assert.equal(diagnoseResourceConfinement('/tmp').ready, false);
  assert.equal(diagnoseResourceConfinement('/tmp', { cgroupRoot: '/sys/fs/cgroup', memoryBytes: 64 * 1024 * 1024,
    pids: 24, cpuQuotaMicros: 10000, cpuPeriodMicros: 100000, maxFileBytes: 2 * 1024 * 1024, maxOpenFiles: 64,
    workspaceBytes: 16 * 1024 * 1024, workspaceInodes: 128 }).ready, false);
});

// Real checks are explicitly opted in by the disposable delegated-service harness, never silently skipped as passes.
if (process.env.AEON_RESOURCE_WORKSPACE) {
  const workspace = process.env.AEON_RESOURCE_WORKSPACE;
  const cgroupRoot = '/sys/fs/cgroup' + readFileSync('/proc/self/cgroup', 'utf8').trim().slice(3);
  await initializeResourceDelegation(cgroupRoot);
  const limits: ResourceLimits = { cgroupRoot, memoryBytes: 128 * 1024 * 1024, pids: 24, cpuQuotaMicros: 20000,
    cpuPeriodMicros: 100000, maxFileBytes: 2 * 1024 * 1024, maxOpenFiles: 64,
    workspaceBytes: 16 * 1024 * 1024, workspaceInodes: 128 };
  const protectedPath = process.cwd();
  const base: ConfinedCommand = { workspace, protectedPaths: [protectedPath], resourceLimits: limits,
    executable: '/usr/bin/python3', args: [], nodeBinary: process.execPath, timeoutMs: 10000, maxOutputBytes: 16384 };
  const groups = () => readdirSync(cgroupRoot).filter(name => name.startsWith('command-'));
  const execute = (script: string, overrides: Partial<ConfinedCommand> = {}) => runConfined({ ...base, args: ['-c', script], ...overrides });

  test('real installed profile bounds file descriptors/file size and leaves no groups', async () => {
    assert.deepEqual(diagnoseResourceConfinement(workspace, limits), { ready: true });
    const observed = await execute("print(open('/proc/self/limits').read()); files=[]\ntry:\n while True: files.append(open('/dev/null'))\nexcept OSError as e: print('fd-limit',e.errno)");
    assert.equal(observed.exitCode, 0, observed.stderr);
    assert.match(observed.stdout, /Max open files\s+64\s+64/);
    assert.match(observed.stdout, /Max file size\s+2097152\s+2097152/);
    assert.match(observed.stdout, /Max cpu time\s+10\s+10/);
    assert.match(observed.stdout, /fd-limit 24/);
    const file = await execute("f=open('/work/fsize','wb'); f.write(b'x'*(3*1024*1024));f.flush()");
    assert.notEqual(file.exitCode, 0);
    assert.equal(statSync(join(workspace, 'fsize')).size, limits.maxFileBytes);
    rmSync(join(workspace, 'fsize'));
    assert.deepEqual(groups(), []);
  });

  test('aggregate memory ceiling kills a small multi-process allocation and drains the entire cgroup', async context => {
    const receipt = await execute("import subprocess,sys,time\nchildren=[subprocess.Popen([sys.executable,'-c','import time; x=bytearray(20*1024*1024); time.sleep(10)']) for i in range(4)]\ntime.sleep(10)",
      { resourceLimits: { ...limits, memoryBytes: 64 * 1024 * 1024 } });
    assert.equal(receipt.stoppedFor, 'resource-limit');
    assert.ok(receipt.resources!.oomKills > 0);
    // memory.peak may report a page-charge overshoot; the hard configured max is independently read back before launch.
    assert.ok(receipt.resources!.memoryPeakBytes < 72 * 1024 * 1024, JSON.stringify(receipt.resources));
    context.diagnostic(JSON.stringify({ case: 'memory', ...receipt.resources }));
    assert.deepEqual(groups(), []);
  });

  test('aggregate process ceiling refuses bounded forks, including detached descendants', async context => {
    const receipt = await execute("import subprocess\nchildren=[]\ntry:\n for i in range(32): children.append(subprocess.Popen(['/bin/sleep','10'],start_new_session=True))\nexcept OSError as e: print('process-limit',e.errno)\nfinally:\n for child in children: child.kill()\n for child in children: child.wait()");
    assert.equal(receipt.exitCode, 0, receipt.stderr);
    assert.match(receipt.stdout, /process-limit 11/);
    assert.ok(receipt.resources!.pidsLimitHits > 0);
    context.diagnostic(JSON.stringify({ case: 'pids', ...receipt.resources }));
    assert.deepEqual(groups(), []);
  });

  test('CPU rate is throttled across multiple busy processes and the deadline bounds cumulative usage', async context => {
    const receipt = await execute("import subprocess,sys\nchildren=[subprocess.Popen([sys.executable,'-c','while True: pass']) for i in range(2)]\nwhile True: pass",
      { timeoutMs: 1600, resourceLimits: { ...limits, cpuQuotaMicros: 10000 } });
    assert.equal(receipt.stoppedFor, 'timeout');
    assert.ok(receipt.resources!.cpuThrottledMicros > 0);
    const theoretical = Math.ceil(receipt.elapsedMs / 100) * 10000 + 10000;
    assert.ok(receipt.resources!.cpuUsageMicros < theoretical + 100000, JSON.stringify(receipt));
    context.diagnostic(JSON.stringify({ case: 'cpu', elapsedMs: receipt.elapsedMs, ...receipt.resources }));
    assert.deepEqual(groups(), []);
  });

  test('fixed workspace storage returns ENOSPC within 16 MiB and inodes remain bounded', async () => {
    const receipt = await execute("import os\nfiles=[]\ntry:\n for i in range(24):\n  name='/work/storage-'+str(i);files.append(name)\n  with open(name,'wb') as f: f.write(b'x'*(1024*1024))\nexcept OSError as e: print('storage-limit',e.errno)\nfinally:\n for name in files: os.unlink(name)");
    assert.equal(receipt.exitCode, 0, receipt.stderr);
    assert.match(receipt.stdout, /storage-limit 28/);
    const inode = await execute("import os\nfiles=[]\ntry:\n for i in range(256):\n  name='/work/inode-'+str(i)\n  open(name,'w').close();files.append(name)\nexcept OSError as e: print('inode-limit',e.errno)\nfinally:\n for name in files: os.unlink(name)");
    assert.equal(inode.exitCode, 0, inode.stderr);
    assert.match(inode.stdout, /inode-limit 28/);
    assert.deepEqual(groups(), []);
  });

  test('the same enforcement surrounds an RPC worker; cancelled detached descendants cannot retain storage', async () => {
    const controller = new AbortController();
    const command = { ...base, executable: '/runtime/node', signal: controller.signal, args: ['-e',
      "const {spawn}=require('node:child_process'); process.stdin.once('data',()=>{spawn('/bin/sh',['-c','sleep 1; echo escaped > /work/escaped'],{detached:true,stdio:'ignore'}); console.log(JSON.stringify({kind:'request',id:'one',method:'cancel',args:[]}));});setInterval(()=>{},1000);"] };
    assert.ok(confinementArguments(command).includes('/work'));
    await assert.rejects(runWorker({ command, initial: null, maxMessageBytes: 4096, maxRequests: 2,
      async handle() { controller.abort(); return null; } }), /cancelled/);
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert.deepEqual(groups(), []);
    assert.ok(!readdirSync(workspace).includes('escaped'));
  });

  for (const pause of ['gate', 'before-parent-death-setup']) test(`host death at ${pause} cannot start orphaned untrusted execution`, async () => {
    const crashCommand = { ...base, executable: '/bin/sh', args: ['-c', 'echo escaped > /work/gate-escaped'] };
    const resourceModule = new URL('./resource-limits.ts', import.meta.url).href;
    const confinementModule = new URL('./confinement.ts', import.meta.url).href;
    // Pause the trusted gate before its first instruction: this deterministically widens a real scheduling window.
    const host = spawn(process.execPath, ['--input-type=module', '-e', `
      import childProcess from 'node:child_process';
      import {syncBuiltinESMExports} from 'node:module';
      const original = childProcess.spawn;
      childProcess.spawn = (file, args, options) => {
        if (${JSON.stringify(pause)} === 'before-parent-death-setup') {
          return original('/bin/sh', ['-c', 'kill -STOP $$; exec "$@"', 'aeon-review-pause', file, ...args], options);
        }
        args = [...args]; const script = args.indexOf('-c') + 1;
        if (script > 0) args[script] = 'kill -STOP $$; ' + args[script];
        return original(file, args, options);
      };
      syncBuiltinESMExports();
      const {spawnBounded} = await import(${JSON.stringify(resourceModule)});
      const {confinementArguments} = await import(${JSON.stringify(confinementModule)});
      const command = ${JSON.stringify(crashCommand)};
      const confined = await spawnBounded(confinementArguments(command), {...command, input: 'ignore'});
      process.send({pid: confined.child.pid});
      setInterval(() => {}, 1000);
    `], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const exited = new Promise<void>(resolve => host.once('exit', () => resolve()));
    let gatePid: number | undefined;
    try {
      gatePid = await new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Launch gate did not start')), 5000);
        host.once('message', message => { clearTimeout(timeout); resolve((message as {pid: number}).pid); });
      });
      const stoppedDeadline = performance.now() + 3000;
      while (!/^State:\s+T/m.test(readFileSync(`/proc/${gatePid}/status`, 'utf8'))) {
        assert.ok(performance.now() < stoppedDeadline, 'Launch gate did not stop');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      host.kill('SIGKILL'); await exited;
      try { process.kill(gatePid, 'SIGCONT'); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
      const deadline = performance.now() + 3000;
      while (groups().some(group => !readFileSync(join(cgroupRoot, group, 'cgroup.events'), 'utf8').includes('populated 0'))) {
        assert.ok(performance.now() < deadline, 'Launch gate survived its host');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.ok(!readdirSync(workspace).includes('gate-escaped'), 'Untrusted command ran after its host died');
    } finally {
      host.kill('SIGKILL'); await exited;
      if (gatePid) { try { process.kill(gatePid, 'SIGKILL'); } catch {} }
      await initializeResourceDelegation(cgroupRoot);
      rmSync(join(workspace, 'gate-escaped'), { force: true });
    }
  });

  test('a real host SIGKILL leaves no live descendants and restart reaps its empty cgroup', async () => {
    const crashCommand = { ...base, executable: '/bin/sh', args: ['-c',
      "echo started > /work/crash-started; setsid /bin/sh -c 'sleep 1; echo escaped > /work/crash-escaped' & sleep 10"] };
    const module = new URL('./confinement.ts', import.meta.url).href;
    const host = spawn(process.execPath, ['--input-type=module', '-e',
      `import {runConfined} from ${JSON.stringify(module)}; await runConfined(${JSON.stringify(crashCommand)});`], { stdio: 'ignore' });
    const exited = new Promise<void>(resolve => host.once('exit', () => resolve()));
    try {
      const deadline = performance.now() + 5000;
      while (!readdirSync(workspace).includes('crash-started')) {
        assert.ok(performance.now() < deadline, 'Disposable host did not launch its confined command');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(groups().length, 1);
      host.kill('SIGKILL'); await exited;
      const drainDeadline = performance.now() + 3000;
      while (groups().some(group => !readFileSync(join(cgroupRoot, group, 'cgroup.events'), 'utf8').includes('populated 0'))) {
        assert.ok(performance.now() < drainDeadline, 'Parent death left a live descendant');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      await new Promise(resolve => setTimeout(resolve, 1200));
      assert.ok(!readdirSync(workspace).includes('crash-escaped'));
      await initializeResourceDelegation(cgroupRoot);
      assert.deepEqual(groups(), []);
      rmSync(join(workspace, 'crash-started'));
    } finally { host.kill('SIGKILL'); await exited; }
  });
}
