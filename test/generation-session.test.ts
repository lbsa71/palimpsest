import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { freezeBaseline } from '../src/candidates.ts';
import { DirectCommunications } from '../src/communications.ts';
import { GenerationHost } from '../src/generations.ts';
import { Store } from '../src/store.ts';

test('actual idle host retains epoch and work across old lifetime windows; genuine worker crash still recovers', { skip: process.platform !== 'darwin' }, async context => {
  const directory = mkdtempSync(join(tmpdir(), 'palimpsest-generation-session-')), repositoryRoot = join(directory, 'repo'), dataDir = join(directory, 'state');
  mkdirSync(join(repositoryRoot, 'src/agent'), { recursive: true }); mkdirSync(join(repositoryRoot, 'docs'));
  writeFileSync(join(repositoryRoot, 'src/agent/brain.ts'), readFileSync(resolve('src/agent/brain.ts')));
  writeFileSync(join(repositoryRoot, 'docs/seed-contract.md'), 'Synthetic worker-lifetime contract'); writeFileSync(join(repositoryRoot, 'package.json'), '{"type":"module"}');
  const git = (...args: string[]) => execFileSync('/usr/bin/git', args, { cwd: repositoryRoot, stdio: 'ignore' });
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('add', '.'); git('commit', '-qm', 'Fixture');
  const baseline = freezeBaseline({ repositoryRoot, dataDir, configuration: {}, modelProfile: { provider: 'fixture', model: null } });
  const store = new Store(join(dataDir, 'state.sqlite')); let calls = 0;
  const host = new GenerationHost({ repositoryRoot, dataDir, store, model: null, communications: [new DirectCommunications()],
    provider: { name: 'fixture', async complete() { calls++; throw new Error('No inference belongs in idle/recovery fixture'); } } });
  context.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    await host.start(baseline); const initial = host.custodian.inspect(), peer = initial.active!.process;
    const memory = store.addMemory({ scope: 'local', kind: 'episodic', content: 'current memory survives', source: 'fixture', confidence: 1 });
    const cancelled = store.enqueue({ conversationId: 'local', source: 'direct', input: 'Do not resume this task' }); store.updateTask(cancelled.id, { state: 'cancelled' });
    const stateBefore = store.listEvents().length;
    for (const advance of [300001, 300001]) {
      context.mock.timers.tick(advance); await new Promise(resolve => setImmediate(resolve)); await host.tick();
      const state = host.custodian.inspect(); assert.equal(state.epoch, initial.epoch); assert.equal(state.active!.process.pid, peer.pid);
      assert.equal(state.phase, 'normal'); assert.equal(store.memory(memory.id, 'local')?.content, memory.content);
      assert.equal(store.task(cancelled.id)?.state, 'cancelled'); assert.equal(store.listEvents().length, stateBefore); assert.equal(calls, 0);
    }
    context.mock.timers.reset(); process.kill(peer.pid, 'SIGKILL'); await new Promise(resolve => setImmediate(resolve)); await host.tick();
    const recovered = host.custodian.inspect(); assert.equal(recovered.phase, 'normal'); assert.ok(recovered.epoch > initial.epoch);
    assert.notEqual(recovered.active!.process.pid, peer.pid); assert.equal(recovered.active!.release.digest, baseline.manifestDigest);
    assert.equal(store.memory(memory.id, 'local')?.content, memory.content); assert.equal(store.task(cancelled.id)?.state, 'cancelled'); assert.equal(calls, 0);
  } finally { await host.close(); context.mock.timers.reset(); store.close(); rmSync(directory, { recursive: true, force: true }); }
});
