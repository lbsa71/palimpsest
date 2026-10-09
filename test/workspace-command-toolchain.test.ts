import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

// An executable hash alone misses changes to the installed dependency tree
// while a checkpoint is awaited. Use an independent module/toolchain copy so
// the actual frozen-runtime verifier can observe the race without touching the
// shared installation. The private red receiver differs only by the three
// profile rechecks introduced for this defect; no production fault hook exists.
test('a dependency change during the real checkpoint refuses command launch and retains its spent effect',
  { skip: process.platform !== 'darwin' }, async context => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'palimpsest-toolchain-race-')));
    const host = join(directory, 'host');
    const repositoryRoot = join(directory, 'repo');
    const dataDir = join(directory, 'state');
    const sharedToolchain = realpathSync(resolve('node_modules'));
    const privateToolchain = join(host, 'node_modules');
    const sharedMarker = join(sharedToolchain, '@types/node/README.md');
    const sharedMarkerBytes = readFileSync(sharedMarker);
    let engine: import('../src/workspaces.ts').CodingWorkspaces | undefined;
    let store: import('../src/store.ts').Store | undefined;
    const writable = (path: string) => {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) return;
      if (stat.isDirectory()) {
        chmodSync(path, 0o700);
        for (const name of readdirSync(path)) writable(join(path, name));
      } else chmodSync(path, 0o600);
    };
    try {
      mkdirSync(host, { mode: 0o700 });
      cpSync(resolve('src'), join(host, 'src'), { recursive: true });
      cpSync(resolve('trusted'), join(host, 'trusted'), { recursive: true });
      cpSync(sharedToolchain, privateToolchain, { recursive: true, dereference: true });
      writeFileSync(join(host, 'package.json'), '{"type":"module"}');
      const assertResolvedCopy = (path: string) => {
        const stat = lstatSync(path);
        if (stat.isSymbolicLink()) {
          // Materialize any retained executable shim from the dependency tree
          // into its own private file; no link may reach the shared runtime.
          const target = realpathSync(path);
          assert.ok(target.startsWith(`${sharedToolchain}/`));
          const targetStat = lstatSync(target);
          assert.ok(targetStat.isFile());
          const bytes = readFileSync(target);
          rmSync(path); writeFileSync(path, bytes, { mode: targetStat.mode & 0o777 });
          assert.equal(lstatSync(path).nlink, 1); return;
        }
        if (stat.isDirectory()) for (const name of readdirSync(path)) assertResolvedCopy(join(path, name));
        else assert.equal(stat.nlink, 1, 'copied files cannot alias a shared inode');
      };
      assertResolvedCopy(privateToolchain);
      const marker = join(privateToolchain, '@types/node/README.md');
      assert.notEqual(lstatSync(marker).ino, lstatSync(sharedMarker).ino);
      assert.deepEqual(readFileSync(marker), sharedMarkerBytes);

      const receiverPath = join(host, 'src/workspaces.ts');
      const receiverBytes = readFileSync(receiverPath, 'utf8');
      const recheck = /this\.#sameProfile\(profile\);/g;
      assert.equal(receiverBytes.match(recheck)?.length, 3, 'private red fixture removes only the added profile rechecks');
      const priorBytes = receiverBytes.replace(recheck, '');
      const priorPath = join(host, 'src/workspaces-before-profile-checks.ts');
      writeFileSync(priorPath, priorBytes);
      assert.equal(sha(readFileSync(receiverPath)), sha(readFileSync(resolve('src/workspaces.ts'))));
      context.diagnostic(`receiver=${sha(receiverBytes)} private-red=${sha(priorBytes)}`);

      const candidates = await import(pathToFileURL(join(host, 'src/candidates.ts')).href) as typeof import('../src/candidates.ts');
      const storage = await import(pathToFileURL(join(host, 'src/store.ts')).href) as typeof import('../src/store.ts');
      const current = await import(pathToFileURL(receiverPath).href) as typeof import('../src/workspaces.ts');
      const prior = await import(pathToFileURL(priorPath).href) as typeof import('../src/workspaces.ts');
      mkdirSync(join(repositoryRoot, 'src/agent'), { recursive: true });
      mkdirSync(join(repositoryRoot, 'docs'));
      writeFileSync(join(repositoryRoot, 'src/agent/brain.ts'), 'export function conversationRequest(){return {system:"fixture",prompt:"{}"};}');
      writeFileSync(join(repositoryRoot, 'docs/seed-contract.md'), 'Synthetic command-runtime contract');
      writeFileSync(join(repositoryRoot, 'package.json'), '{"type":"module"}');
      const git = (...args: string[]) => execFileSync('/usr/bin/git', args, { cwd: repositoryRoot, stdio: 'ignore' });
      git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
      git('add', '.'); git('commit', '-qm', 'Private runtime fixture');
      const baseline = candidates.freezeBaseline({ repositoryRoot, dataDir, configuration: {}, modelProfile: { provider: 'fixture', model: null } });
      assert.ok(baseline.runtime.compilerPath.startsWith(`${privateToolchain}/`), 'freeze uses the private installed module and compiler');
      const compilerBytes = readFileSync(baseline.runtime.compilerPath);
      assert.equal(sha(compilerBytes), baseline.runtime.compilerSha256);

      // Enough files make the actual partial-copy stage observable. This is a
      // quiescent valid draft, not a production delay or injected helper failure.
      const files = Array.from({ length: 128 }, (_, index) => ({
        path: `drafts/${String(index).padStart(3, '0')}.txt`, content: Buffer.alloc(65_536, 65 + index % 26), mode: 0o644 as const,
      }));
      for (const [label, module] of [['private-red', prior], ['current', current]] as const) {
        writeFileSync(marker, sharedMarkerBytes);
        store = new storage.Store(join(dataDir, `${label}.sqlite`));
        const task = store.enqueue({ conversationId: 'coding', source: 'direct', input: 'Synthetic runtime race' });
        store.updateTask(task.id, { state: 'running' });
        engine = new module.CodingWorkspaces({ store, directory: join(directory, label), repositoryRoot,
          runtime: baseline.runtime, runtimeRelease: { releaseDir: baseline.releaseDir, digest: baseline.manifestDigest },
          toolchainReadPaths: [privateToolchain], authorize: authority => authority.taskId === task.id && authority.epoch === 1 });
        const workspace = engine.create({ taskId: task.id, epoch: 1,
          base: { releaseDigest: 'a'.repeat(64), baseCommit: 'b'.repeat(40), treeDigest: module.workspaceTreeDigest(files) }, files });
        const effectId = `${label}-command`;
        const checkpointDirectory = join(engine.controlPath(workspace.id), 'staging', sha(effectId));
        const outputDirectory = join(engine.controlPath(workspace.id), 'commands', sha(effectId));
        const launched = join(engine.path(workspace.id), 'command-launched');
        const pending = engine.runCommand(workspace.id, 1, effectId,
          { tool: 'node', args: ['-e', "require('node:fs').writeFileSync('command-launched','once');"] });
        // Attach rejection handling before observing the asynchronous boundary.
        const settled = pending.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
        const deadline = performance.now() + 10_000;
        let checkpointPid = 0;
        while (performance.now() < deadline) {
          if (existsSync(join(checkpointDirectory, '.checkpoint-partial'))) {
            assert.equal(existsSync(join(checkpointDirectory, 'checkpoint')), false);
            const claim = JSON.parse(readFileSync(join(engine.controlPath(workspace.id), 'writer.json'), 'utf8'));
            assert.ok(Number.isSafeInteger(claim.pid) && claim.pid > 0);
            checkpointPid = claim.pid;
            process.kill(checkpointPid, 0); // The real helper is still alive.
            assert.equal(existsSync(launched), false);
            writeFileSync(marker, Buffer.concat([sharedMarkerBytes, Buffer.from('\nSynthetic dependency changed during checkpoint.\n')]));
            break;
          }
          await delay(1);
        }
        assert.ok(checkpointPid > 0, 'actual checkpoint partial-copy phase must be observed');
        const outcome = await settled;
        assert.deepEqual(readFileSync(sharedMarker), sharedMarkerBytes, 'shared dependency remains unchanged');
        assert.deepEqual(readFileSync(baseline.runtime.compilerPath), compilerBytes, 'binary identity did not change');
        assert.equal(sha(readFileSync(process.execPath)), baseline.runtime.nodeSha256);
        assert.notDeepEqual(readFileSync(marker), sharedMarkerBytes, 'only a nonbinary private dependency changed');
        assert.ok(store.listEvents({ taskId: task.id }).some(event => event.type === 'workspace.command.checkpointed'));
        assert.equal(store.listEffects(task.id).filter(effect => effect.kind === 'workspace.command').length, 1);
        if (label === 'private-red') {
          assert.equal(outcome.error, undefined, String(outcome.error));
          assert.equal(outcome.value?.exitSuccessful, true, 'prior receiver actually launches despite the changed aggregate identity');
          assert.equal(readFileSync(launched, 'utf8'), 'once');
          assert.equal(store.effect(effectId)?.state, 'completed');
        } else {
          assert.match(String(outcome.error), /runtime|toolchain/i);
          assert.equal(outcome.value, undefined);
          assert.equal(existsSync(launched), false);
          for (const name of ['stdout.bin', 'stderr.bin', 'receipt.json']) assert.equal(existsSync(join(outputDirectory, name)), false, 'command runner never starts');
          assert.equal(store.effect(effectId)?.state, 'unknown', 'reserved command remains spent, never accepted or refunded');
          assert.ok(store.listEvents({ taskId: task.id }).some(event => event.type === 'effect.unknown'));
        }
        assert.throws(() => process.kill(checkpointPid, 0), { code: 'ESRCH' }, 'checkpoint process drained before result');
        assert.equal(existsSync(join(engine.controlPath(workspace.id), 'writer.json')), false);
        await engine.stop(); engine = undefined;
        store.close(); store = undefined;
      }
    } finally {
      await engine?.stop(); store?.close();
      assert.deepEqual(readFileSync(sharedMarker), sharedMarkerBytes);
      writable(directory); rmSync(directory, { recursive: true, force: true });
    }
  });
