import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { identity } from '../packages/contracts/index.ts';
import { OperationalStore } from '../packages/storage/index.ts';
import { CodingSources } from './coding-source.ts';

const first = 'a'.repeat(64), second = 'b'.repeat(64);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aeon-coding-source-')), workspace = join(root, 'work');
  mkdirSync(workspace);
  const store = new OperationalStore({ filename: join(root, 'state.sqlite') });
  return { root, workspace, store, close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('accepted image changes reuse one source tree without overwriting dirty work or historical preparation', async () => {
  const f = fixture(); let seeds = 0;
  try {
    const oldPath = join(f.workspace, 'repositories', first); mkdirSync(oldPath, { recursive: true });
    writeFileSync(join(oldPath, 'old.txt'), 'Retain unfinished historical work');
    const oldKey = identity({ workspace: f.workspace, candidateId: first });
    f.store.put('host.coding-sources', oldKey, { state: 'ready', source: { candidateId: first, path: `repositories/${first}`, receipt: f.store.putJsonArtifact({ old: true }) } }, null);
    const original = f.store.get('host.coding-sources', oldKey);
    const sources = new CodingSources({ store: f.store, snapshot: async (workspace, path) => {
      seeds++; assert.equal(workspace, f.workspace); assert.equal(path, 'source');
      mkdirSync(join(workspace, path)); writeFileSync(join(workspace, path, 'README.md'), 'Accepted initial source');
      return { exitCode: 0, stdout: 'Seeded once' };
    } });
    const seeded = await sources.prepare(f.workspace, first);
    assert.equal(seeded.candidateId, first); assert.equal(seeded.acceptedCandidateId, first); assert.equal(seeded.path, 'source');
    const stableKey = identity({ workspace: f.workspace, path: 'source' }), durable = f.store.get('host.coding-sources', stableKey);
    writeFileSync(join(f.workspace, 'source', 'README.md'), 'Dirty change awaiting review');
    const restored = new CodingSources({ store: f.store, snapshot: async () => { throw Error('A second image must not seed a second tree'); } });
    for (const source of [restored.prepared(f.workspace, second), await restored.prepare(f.workspace, second)]) {
      assert.deepEqual(source, { ...seeded, acceptedCandidateId: second });
    }
    assert.equal(readFileSync(join(f.workspace, 'source', 'README.md'), 'utf8'), 'Dirty change awaiting review');
    assert.equal(readFileSync(join(oldPath, 'old.txt'), 'utf8'), 'Retain unfinished historical work');
    assert.deepEqual(f.store.get('host.coding-sources', oldKey), original);
    assert.deepEqual(f.store.get('host.coding-sources', stableKey), durable);
    assert.equal(seeds, 1);
  } finally { f.close(); }
});

test('a failed seed retains its receipt and partial files across later accepted images without retry', async () => {
  const f = fixture(); let calls = 0;
  try {
    const sources = new CodingSources({ store: f.store, snapshot: async (workspace, path) => {
      calls++; mkdirSync(join(workspace, path)); writeFileSync(join(workspace, path, 'partial'), 'Partial evidence');
      return { exitCode: 1, stderr: 'Git baseline commit failed' };
    } });
    await assert.rejects(sources.prepare(f.workspace, first), /preparation failed/);
    const key = identity({ workspace: f.workspace, path: 'source' }), failed = f.store.get<any>('host.coding-sources', key)!;
    assert.equal(failed.value.state, 'uncertain');
    assert.deepEqual(f.store.readJsonArtifact(failed.value.receipt), { exitCode: 1, stderr: 'Git baseline commit failed' });
    const restored = new CodingSources({ store: f.store, snapshot: async () => { calls++; return { exitCode: 0 }; } });
    assert.throws(() => restored.prepared(f.workspace, second), /no overwrite or automatic retry/);
    await assert.rejects(restored.prepare(f.workspace, second), /no overwrite or automatic retry/);
    assert.deepEqual(f.store.get('host.coding-sources', key), failed);
    assert.equal(readFileSync(join(f.workspace, 'source', 'partial'), 'utf8'), 'Partial evidence'); assert.equal(calls, 1);
  } finally { f.close(); }
});

test('concurrent source preparation seeds once and returns each caller current accepted identity', async () => {
  const f = fixture(); let finish!: () => void, calls = 0;
  const held = new Promise<void>(resolve => { finish = resolve; });
  try {
    const sources = new CodingSources({ store: f.store, snapshot: async () => { calls++; await held; return { exitCode: 0 }; } });
    const one = sources.prepare(f.workspace, first), two = sources.prepare(f.workspace, second);
    finish(); const [a, b] = await Promise.all([one, two]);
    assert.equal(calls, 1); assert.equal(a.candidateId, first); assert.equal(b.candidateId, first);
    assert.equal(a.acceptedCandidateId, first); assert.equal(b.acceptedCandidateId, second); assert.deepEqual(a.receipt, b.receipt);
    a.path = 'tampered'; assert.equal(sources.prepared(f.workspace, second)!.path, 'source');
  } finally { finish(); f.close(); }
});
