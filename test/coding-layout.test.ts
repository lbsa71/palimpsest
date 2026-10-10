import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store } from '../src/store.ts';
import { CodingWorkspaces, workspaceTreeDigest } from '../src/workspaces.ts';

test('trusted source import preserves empty directories and directory/root modes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'p17-layout-')), store = new Store(':memory:');
  const task = store.enqueue({ source: 'direct', conversationId: 'local', input: 'Synthetic directory import' }); store.updateTask(task.id, { state: 'running' });
  const workspaces = new CodingWorkspaces({ store, directory: join(root, 'drafts'), repositoryRoot: resolve('.'), authorize: authority => authority.taskId === task.id && authority.epoch === 1 });
  try {
    const files = [{ path: 'src/value.ts', content: Buffer.from(''), mode: 0o644 as const }];
    const workspace = workspaces.create(Object.assign({ taskId: task.id, epoch: 1, files, base: { releaseDigest: 'a'.repeat(64), baseCommit: 'b'.repeat(40), treeDigest: workspaceTreeDigest(files) } },
      { directories: [{ path: 'src', mode: 0o755 }, { path: 'empty', mode: 0o700 }, { path: 'empty/nested', mode: 0o755 }], rootMode: 0o755 }));
    assert.equal(existsSync(join(workspaces.path(workspace.id), 'empty/nested')), true);
    assert.equal(statSync(join(workspaces.path(workspace.id), 'src')).mode & 0o777, 0o755);
    assert.equal(statSync(join(workspaces.path(workspace.id), 'empty/nested')).mode & 0o777, 0o755);
    assert.equal(statSync(workspaces.path(workspace.id)).mode & 0o777, 0o755);
  } finally { await workspaces.stop(); store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('trusted source import rejects aliased, incomplete and unsupported directory metadata before creating a workspace', async () => {
  const root = mkdtempSync(join(tmpdir(), 'p17-layout-negative-')), store = new Store(':memory:');
  const task = store.enqueue({ source: 'direct', conversationId: 'local', input: 'Synthetic rejected directory import' }); store.updateTask(task.id, { state: 'running' });
  const workspaces = new CodingWorkspaces({ store, directory: join(root, 'drafts'), repositoryRoot: resolve('.'), authorize: () => true });
  const files = [{ path: 'src/value.ts', content: Buffer.from(''), mode: 0o644 as const }];
  const source = { taskId: task.id, epoch: 1, files, base: { releaseDigest: 'a'.repeat(64), baseCommit: 'b'.repeat(40), treeDigest: workspaceTreeDigest(files) } };
  try {
    for (const layout of [
      { directories: [] },
      { directories: [{ path: 'src', mode: 0o755 }, { path: 'SRC', mode: 0o755 }] },
      { directories: [{ path: 'src', mode: 0o755 }, { path: 'src/value.ts', mode: 0o755 }] },
      { directories: [{ path: 'src', mode: 0o777 }] },
      { directories: [{ path: '../outside', mode: 0o755 }] },
      { directories: [{ path: 'src', mode: 0o755 }], rootMode: 0o777 },
    ]) assert.throws(() => workspaces.create({ ...source, ...layout }));
    assert.equal(store.listEvents().some(event => event.type === 'workspace.created'), false);
  } finally { await workspaces.stop(); store.close(); rmSync(root, { recursive: true, force: true }); }
});
