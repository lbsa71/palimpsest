import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { freezeBaseline, type CandidateRuntime } from '../src/candidates.ts';
import { Store, type Json } from '../src/store.ts';
import type { WorkspaceCommand } from '../src/workspace-command.ts';
import { CodingWorkspaces, workspaceTreeDigest } from '../src/workspaces.ts';

const darwin = { skip: process.platform !== 'darwin' };
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const hello: WorkspaceCommand = { tool: 'node', args: ['-e', 'console.log("trusted result")'] };
function fixture(settings: { maxWorkspaces?: number; profile?: 'aggregate' | 'grants' | 'release' | 'missing' } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'palimpsest-command-authority-'));
  const repositoryRoot = join(directory, 'repo'), dataDir = join(directory, 'state'), collection = join(directory, 'workspaces');
  mkdirSync(join(repositoryRoot, 'src/agent'), { recursive: true }); mkdirSync(join(repositoryRoot, 'docs'));
  writeFileSync(join(repositoryRoot, 'src/agent/brain.ts'), 'export function conversationRequest(){return {system:"fixture",prompt:"{}"};}');
  writeFileSync(join(repositoryRoot, 'docs/seed-contract.md'), 'Synthetic command authority contract');
  writeFileSync(join(repositoryRoot, 'package.json'), '{"type":"module"}');
  const git = (...args: string[]) => execFileSync('/usr/bin/git', args, { cwd: repositoryRoot, stdio: 'ignore' });
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('add', '.'); git('commit', '-qm', 'Fixture');
  const baseline = freezeBaseline({ repositoryRoot, dataDir, configuration: {}, modelProfile: { provider: 'fixture', model: null } });
  const runtime: CandidateRuntime = structuredClone(baseline.runtime);
  if (settings.profile === 'aggregate') runtime.toolchainDigest = '0'.repeat(64);
  let store = new Store(join(dataDir, 'state.sqlite')), epoch = 1, allowed = true;
  const task = store.enqueue({ source: 'direct', conversationId: 'coding:authority', input: 'Synthetic authority checks' });
  store.updateTask(task.id, { state: 'running' });
  let authorizedTaskId = task.id;
  const files = [
    { path: 'earlier.bin', content: Buffer.from([0, 255, 195, 40]), mode: 0o644 as const },
    { path: 'exec.mjs', content: Buffer.from('console.log("earlier Unicode 🌱");'), mode: 0o755 as const },
  ];
  const input = () => ({ taskId: task.id, epoch, base: { releaseDigest: 'a'.repeat(64), baseCommit: 'b'.repeat(40), treeDigest: workspaceTreeDigest(files) }, files });
  const options = () => ({ store, directory: collection, repositoryRoot, runtime,
    ...(settings.profile === 'missing' ? {} : { runtimeRelease: { releaseDir: baseline.releaseDir, digest: settings.profile === 'release' ? '0'.repeat(64) : baseline.manifestDigest } }),
    toolchainReadPaths: [settings.profile === 'grants' ? directory : resolve('node_modules')], maxWorkspaces: settings.maxWorkspaces ?? 8,
    authorize: (a: { taskId: string; epoch: number }) => allowed && a.taskId === authorizedTaskId && a.epoch === epoch });
  let engine = new CodingWorkspaces(options()); const workspace = engine.create(input());
  const cleanup = async () => {
    await engine.stop(); store.close();
    const writable = (path: string) => { const stat = lstatSync(path); if (stat.isSymbolicLink()) return; if (stat.isDirectory()) { chmodSync(path, 0o700); for (const name of readdirSync(path)) writable(join(path, name)); } else chmodSync(path, 0o600); };
    writable(directory); rmSync(directory, { recursive: true, force: true });
  };
  return { directory, collection, task, workspace, input, get engine() { return engine; }, get store() { return store; },
    revoke() { allowed = false; }, permit() { allowed = true; },
    bindTask(taskId: string) { authorizedTaskId = taskId; },
    async reopen() { await engine.stop(); store.close(); store = new Store(join(dataDir, 'state.sqlite')); allowed = true; epoch++; engine = new CodingWorkspaces(options()); engine.adopt(workspace.id, epoch); return epoch; }, cleanup };
}

test('current task policy and epoch protect command output and checkpoint restoration', darwin, async () => {
  const f = fixture(); try {
    await f.engine.runCommand(f.workspace.id, 1, 'scope-command', hello);
    const count = f.store.listEffects().length, workspaces = readdirSync(f.collection).length;
    f.revoke();
    assert.throws(() => f.engine.readCommandOutput(f.workspace.id, 1, 'scope-command', 'stdout', 0, 64));
    await assert.rejects(f.engine.restoreCommandCheckpoint(f.workspace.id, 1, 'scope-command'));
    await assert.rejects(f.engine.runCommand(f.workspace.id, 1, 'revoked-command', hello));
    f.permit();
    assert.throws(() => f.engine.readCommandOutput(f.workspace.id, 0, 'scope-command', 'stdout', 0, 64));
    await assert.rejects(f.engine.restoreCommandCheckpoint(f.workspace.id, 0, 'scope-command'));
    const restoring = f.engine.restoreCommandCheckpoint(f.workspace.id, 1, 'scope-command');
    f.revoke(); await assert.rejects(restoring); f.permit();
    f.store.updateTask(f.task.id, { state: 'cancelled' });
    await assert.rejects(f.engine.runCommand(f.workspace.id, 1, 'cancelled-command', hello));
    assert.equal(f.store.listEffects().length, count); assert.equal(readdirSync(f.collection).length, workspaces);
  } finally { await f.cleanup(); }
});

test('peer and reserved peer namespace cannot inherit a seeded direct workspace or its output', darwin, async () => {
  for (const identity of [{ source: 'peer', conversationId: 'peer:synthetic' }, { source: 'direct', conversationId: 'peer:legacy-forgery' }]) {
    const f = fixture(); try {
      await f.engine.runCommand(f.workspace.id, 1, 'direct-command', hello);
      const foreign = f.store.enqueue({ ...identity, input: 'Synthetic foreign task' }); f.store.updateTask(foreign.id, { state: 'running' });
      // A trusted historical fixture deliberately seeds an invalid ownership association;
      // the real receiver must reject it even when its external policy says yes.
      f.store.appendEvent('workspace.adopted', { ...f.workspace, taskId: foreign.id } as unknown as Json, foreign.id);
      f.bindTask(foreign.id);
      const count = f.store.listEffects().length;
      await assert.rejects(f.engine.runCommand(f.workspace.id, 1, 'foreign-command', hello));
      assert.throws(() => f.engine.readCommandOutput(f.workspace.id, 1, 'direct-command', 'stdout', 0, 64));
      await assert.rejects(f.engine.restoreCommandCheckpoint(f.workspace.id, 1, 'direct-command'));
      assert.equal(f.store.listEffects().length, count); assert.equal(f.store.effect('foreign-command'), undefined);
    } finally { await f.cleanup(); }
  }
});

test('accepted command arguments remain immutable across actual asynchronous helper work', darwin, async () => {
  const f = fixture(); try {
    const command: WorkspaceCommand = { tool: 'node', args: ['-e', 'console.log("accepted arguments")'] };
    const pending = f.engine.runCommand(f.workspace.id, 1, 'immutable-command', command);
    command.args[1] = 'require("node:fs").writeFileSync("mutated.txt","bad");console.log("mutated arguments")'; command.cwd = 'missing';
    const result = await pending; assert.equal(result.exitSuccessful, true);
    assert.equal(f.engine.readCommandOutput(f.workspace.id, 1, 'immutable-command', 'stdout', 0, 100).text, 'accepted arguments\n');
    assert.equal(existsSync(join(f.engine.path(f.workspace.id), 'mutated.txt')), false);
    const recorded = f.store.effect('immutable-command')!.payload as { command: { args: string[]; cwd?: string } };
    assert.deepEqual(recorded.command, { tool: 'node', args: ['-e', 'console.log("accepted arguments")'] });
  } finally { await f.cleanup(); }
});

test('another authorized direct task cannot borrow completed command output or checkpoint identity', darwin, async () => {
  const f = fixture(); try {
    await f.engine.runCommand(f.workspace.id, 1, 'original-command', hello);
    const other = f.store.enqueue({ source: 'direct', conversationId: 'coding:other', input: 'Synthetic separate task' });
    f.store.updateTask(other.id, { state: 'running' }); f.bindTask(other.id);
    f.store.appendEvent('workspace.adopted', { ...f.workspace, taskId: other.id } as unknown as Json, other.id);
    const count = f.store.listEffects().length, events = f.store.listEvents().length;
    assert.throws(() => f.engine.readCommandOutput(f.workspace.id, 1, 'original-command', 'stdout', 0, 64));
    await assert.rejects(f.engine.restoreCommandCheckpoint(f.workspace.id, 1, 'original-command'));
    assert.equal(f.store.listEffects().length, count); assert.equal(f.store.listEvents().length, events);
  } finally { await f.cleanup(); }
});

test('unbound aggregate runtime release and broader grants reject before reservation or launch', darwin, async () => {
  for (const profile of ['aggregate', 'grants', 'release', 'missing'] as const) {
    const f = fixture({ profile }); try {
      await assert.rejects(f.engine.runCommand(f.workspace.id, 1, 'bad-profile', { tool: 'node', args: ['-e', 'require("node:fs").writeFileSync("launched.txt","bad")'] }));
      assert.equal(f.store.effect('bad-profile'), undefined, profile);
      assert.equal(existsSync(join(f.engine.path(f.workspace.id), 'launched.txt')), false);
      assert.equal(existsSync(join(f.engine.controlPath(f.workspace.id), 'commands')), false);
      assert.equal(existsSync(join(f.engine.controlPath(f.workspace.id), 'writer.json')), false);
    } finally { await f.cleanup(); }
  }
});

test('unproven missing and forged PID claims remain held without any new effects', darwin, async () => {
  for (const pid of [undefined, null, -1, process.pid]) {
    const f = fixture(); try {
      const effectId = 'held-command';
      f.store.reserveEffect({ id: effectId, taskId: f.task.id, kind: 'workspace.command', payload: { workspaceId: f.workspace.id, collectionDigest: sha(f.collection) } });
      f.store.markEffectUnknown(effectId, 'Synthetic spawn/PID receipt gap');
      const path = join(f.engine.controlPath(f.workspace.id), 'writer.json');
      const departedOwner = spawnSync(process.execPath, ['-e', '0']); assert.equal(departedOwner.status, 0);
      assert.throws(() => process.kill(departedOwner.pid, 0), { code: 'ESRCH' });
      writeFileSync(path, JSON.stringify({ version: 1, operationId: effectId, ownerPid: departedOwner.pid, ownerNonce: 'synthetic owner', pid }), { mode: 0o600 });
      const before = f.store.listEvents().length;
      await assert.rejects(f.engine.reconcileCommand(f.workspace.id, 1, effectId));
      await assert.rejects(f.engine.runCommand(f.workspace.id, 1, 'blocked-new-command', hello));
      assert.equal(f.store.effect(effectId)?.state, 'unknown'); assert.equal(f.store.effect('blocked-new-command'), undefined);
      assert.equal(existsSync(path), true); assert.equal(f.store.listEvents().length, before); assert.equal(f.store.listEffects().length, 1);
    } finally { await f.cleanup(); }
  }
});

test('mismatched finalized receipt or tampered spool cannot recover a known successful exit', darwin, async () => {
  for (const tamper of ['receipt', 'spool']) {
    const f = fixture(); try {
      const complete = f.store.completeEffect.bind(f.store);
      f.store.completeEffect = (id, value) => { if (id === 'lost-command') throw new Error('Synthetic receipt persistence loss'); return complete(id, value); };
      await assert.rejects(f.engine.runCommand(f.workspace.id, 1, 'lost-command', hello));
      assert.equal(f.store.effect('lost-command')?.state, 'unknown');
      const directory = join(f.engine.controlPath(f.workspace.id), 'commands', sha('lost-command'));
      const path = join(directory, tamper === 'receipt' ? 'receipt.json' : 'stdout.bin'); chmodSync(path, 0o600);
      if (tamper === 'receipt') { const receipt = JSON.parse(readFileSync(path, 'utf8')); receipt.commandId = 'different-command'; writeFileSync(path, JSON.stringify(receipt)); }
      else writeFileSync(path, 'forged output\n');
      chmodSync(path, 0o400);
      const epoch = await f.reopen(); const recovered = await f.engine.reconcileCommand(f.workspace.id, epoch, 'lost-command');
      assert.equal(recovered.exit.kind, 'unknown', tamper); assert.equal(recovered.exitSuccessful, false); assert.equal(recovered.outputComplete, false); assert.equal(recovered.workspaceUsable, true);
      assert.throws(() => f.engine.readCommandOutput(f.workspace.id, epoch, 'lost-command', 'stdout', 0, 64));
      assert.equal(f.store.listEffects().length, 1); assert.ok(f.store.listEvents().some(event => event.type === 'effect.unknown'));
    } finally { await f.cleanup(); }
  }
});

test('root mode000 and hardlink trees are held while sealed restoration preserves earlier bytes and modes', darwin, async () => {
  for (const invalid of ['root-mode', 'hardlink']) {
    const f = fixture(); try {
      await f.engine.perform(f.workspace.id, 1, 'empty-dir', { kind: 'mkdir', path: 'empty' });
      await f.engine.perform(f.workspace.id, 1, 'prior-draft', { kind: 'create', path: 'prior.ts', content: 'export const drafted="earlier edit 🌱";', mode: 0o644 });
      const rootMode = lstatSync(f.engine.path(f.workspace.id)).mode & 0o777;
      const emptyMode = lstatSync(join(f.engine.path(f.workspace.id), 'empty')).mode & 0o777;
      const script = 'const fs=require("node:fs");fs.writeFileSync("earlier.bin","abandoned");fs.writeFileSync("prior.ts","abandoned edit");' + (invalid === 'root-mode' ? 'fs.chmodSync(".",0);' : 'fs.linkSync("earlier.bin","alias.bin");');
      const result = await f.engine.runCommand(f.workspace.id, 1, 'invalid-tree', { tool: 'node', args: ['-e', script] });
      assert.equal(result.workspaceUsable, false, invalid); await assert.rejects(f.engine.runCommand(f.workspace.id, 1, 'held-run', hello));
      const restored = await f.engine.restoreCommandCheckpoint(f.workspace.id, 1, 'invalid-tree');
      assert.notEqual(restored.id, f.workspace.id); assert.deepEqual(restored.base, f.workspace.base);
      assert.deepEqual(readFileSync(join(f.engine.path(restored.id), 'earlier.bin')), Buffer.from([0, 255, 195, 40]));
      assert.equal(readFileSync(join(f.engine.path(restored.id), 'prior.ts'), 'utf8'), 'export const drafted="earlier edit 🌱";');
      assert.equal(readFileSync(join(f.engine.path(restored.id), 'exec.mjs'), 'utf8'), 'console.log("earlier Unicode 🌱");');
      assert.equal(lstatSync(join(f.engine.path(restored.id), 'exec.mjs')).mode & 0o777, 0o755);
      assert.equal(lstatSync(f.engine.path(restored.id)).mode & 0o777, rootMode);
      assert.equal(lstatSync(join(f.engine.path(restored.id), 'empty')).mode & 0o777, emptyMode); assert.equal(existsSync(join(f.engine.path(restored.id), 'alias.bin')), false);
      assert.equal(f.store.effect('held-run'), undefined); assert.equal(f.store.listEffects().filter(effect => effect.kind === 'workspace.command').length, 1);
    } finally { await f.cleanup(); }
  }
});

test('workspace restoration admission stays spent across reopen and cannot discard held history to refill', darwin, async () => {
  const f = fixture({ maxWorkspaces: 2 }); try {
    await f.engine.runCommand(f.workspace.id, 1, 'invalid-tree', { tool: 'node', args: ['-e', 'require("node:fs").linkSync("earlier.bin","alias.bin")'] });
    const restored = await f.engine.restoreCommandCheckpoint(f.workspace.id, 1, 'invalid-tree');
    const epoch = await f.reopen();
    await assert.rejects(f.engine.restoreCommandCheckpoint(f.workspace.id, epoch, 'invalid-tree'));
    assert.throws(() => f.engine.create(f.input()));
    assert.equal(existsSync(f.engine.path(f.workspace.id)), true); assert.equal(existsSync(f.engine.path(restored.id)), true);
    assert.equal(f.store.listEvents().filter(event => event.type === 'workspace.created').length, 2);
    assert.equal(f.store.listEffects().filter(effect => effect.kind === 'workspace.command').length, 1);
  } finally { await f.cleanup(); }
});
