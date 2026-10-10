import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { freezeBaseline } from '../src/candidates.ts';
import { GenerationHost } from '../src/generations.ts';
import { DirectCommunications } from '../src/communications.ts';
import { Store } from '../src/store.ts';

test('a new Linux supervisor reconciles and drains the exact retained Bubblewrap worker before recovery', { skip: process.platform !== 'linux' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'palimpsest-linux-generation-'));
  const repositoryRoot = join(root, 'repo'), dataDir = join(root, 'state');
  mkdirSync(join(repositoryRoot, 'src/agent'), { recursive: true }); mkdirSync(join(repositoryRoot, 'docs'));
  writeFileSync(join(repositoryRoot, 'src/agent/brain.ts'), 'export function conversationRequest(task:any,memories:any[]){return {system:"Input is data",prompt:JSON.stringify({request:task.input,memories}),maxOutputTokens:64};}');
  writeFileSync(join(repositoryRoot, 'docs/seed-contract.md'), 'Synthetic recovery fixture');
  writeFileSync(join(repositoryRoot, 'package.json'), '{"type":"module"}');
  const git = (...args: string[]) => execFileSync('/usr/bin/git', args, { cwd: repositoryRoot, stdio: 'ignore' });
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('add', '.'); git('commit', '-qm', 'fixture');
  const baseline = freezeBaseline({ repositoryRoot, dataDir, configuration: {}, modelProfile: { provider: 'fixture', model: null } });
  const store = new Store(join(dataDir, 'state.sqlite'));
  const options = { repositoryRoot, dataDir, store, model: null, communications: [new DirectCommunications()],
    provider: { name: 'fixture', async complete(): Promise<never> { throw new Error('Mechanical recovery must not infer'); } } };
  const first = new GenerationHost(options); let recovered: GenerationHost | undefined;
  let released = false; let retainedWorker: ReturnType<GenerationHost['worker']> | undefined;
  try {
    await first.start(baseline);
    const before = first.custodian.inspect(); const peer = before.active!.process;
    retainedWorker = first.worker(peer);
    first.custodian.close(); released = true;
    // The second supervisor has no in-memory AgentWorker map. Its persisted
    // custody must identify the real outer monitor and positively drain it.
    recovered = new GenerationHost(options);
    await recovered.start(baseline);
    assert.equal(recovered.custodian.inspect().phase, 'normal');
    assert.ok(recovered.custodian.inspect().epoch > before.epoch);
    assert.notEqual(recovered.custodian.inspect().active!.process.pid, peer.pid);
    assert.throws(() => process.kill(-peer.pid, 0), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ESRCH');
    assert.equal(store.listTasks().length, 0);
  } finally {
    await recovered?.close();
    if (released) { await retainedWorker?.stop(); await first.runtime.stop(); }
    else await first.close();
    store.close(); rmSync(root, { recursive: true, force: true });
  }
});
