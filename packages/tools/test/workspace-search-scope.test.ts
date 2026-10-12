import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceTools } from '../workspace/index.ts';
import type { JsonValue } from '../../contracts/common.ts';

function fixture(maxBytes = 131072) {
  const root = mkdtempSync(join(tmpdir(), 'aeon-search-scope-'));
  const workspace = join(root, 'work'), state = join(root, 'state');
  mkdirSync(join(workspace, 'packages', 'coding'), { recursive: true });
  mkdirSync(join(workspace, 'docs'), { recursive: true });
  mkdirSync(state);
  writeFileSync(join(workspace, 'docs', 'execution.md'), 'history '.repeat(29408));
  writeFileSync(join(workspace, 'packages', 'coding', 'target.ts'), 'export const target = "needle";\n');
  const tools = new WorkspaceTools({ workspace, protectedPaths: [state], nodeBinary: process.execPath,
    timeoutMs: 5000, maxBytes, maxFiles: 200 });
  return { root, workspace, state, tools };
}
function object(value: JsonValue) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value;
}

test('snapshot discovery and scoped source search tolerate unrelated oversized history', async () => {
  const f = fixture();
  try {
    assert.deepEqual(await f.tools.execute('discover', {}), { files: ['docs/execution.md', 'packages/coding/target.ts'] });
    const expected = { matches: [{ path: 'packages/coding/target.ts', line: 1, text: 'export const target = "needle";' }] };
    assert.deepEqual(await f.tools.execute('search', { path: 'packages/coding', text: 'needle' }), expected);
    assert.deepEqual(await f.tools.execute('search', { path: 'packages/coding/target.ts', text: 'needle' }), expected);
    // Existing reads keep their whole-file size boundary.
    await assert.rejects(f.tools.execute('read', { path: 'docs/execution.md', startLine: 1, endLine: 1 }), /file exceeds limit/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('whole-workspace search returns useful matches and truthful oversized-file omissions', async () => {
  const f = fixture();
  try {
    const result = object(await f.tools.execute('search', { text: 'needle' }));
    assert.deepEqual(result.matches, [{ path: 'packages/coding/target.ts', line: 1, text: 'export const target = "needle";' }]);
    assert.deepEqual(result.omissions, { reason: 'file exceeds byte limit', count: 1,
      files: [{ path: 'docs/execution.md', bytes: 235264 }], omittedDetails: 0 });
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 131072);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('search scope rejects escapes, symlinks, hardlinks and missing targets', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.state, 'secret'), 'needle');
    symlinkSync(f.state, join(f.workspace, 'alias'));
    for (const path of ['../state', '/work/packages', '', 'packages/../docs']) {
      await assert.rejects(f.tools.execute('search', { path, text: 'needle' }), /invalid workspace-relative path/);
    }
    await assert.rejects(f.tools.execute('search', { path: 'alias', text: 'needle' }), /symlink/);
    await assert.rejects(f.tools.execute('search', { path: 'missing', text: 'needle' }), /ENOENT/);
    // A selected source subtree does not inspect unrelated aliases either.
    const selected = object(await f.tools.execute('search', { path: 'packages/coding', text: 'needle' }));
    assert.ok(Array.isArray(selected.matches) && selected.matches.length === 1);
    linkSync(join(f.state, 'secret'), join(f.workspace, 'packages', 'coding', 'hard'));
    await assert.rejects(f.tools.execute('search', { path: 'packages/coding', text: 'needle' }), /hardlink/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('omission details and complete search response remain bounded', async () => {
  const f = fixture(2048);
  try {
    for (let index = 0; index < 40; index++) writeFileSync(join(f.workspace, 'docs', `large-${index}.md`), 'x'.repeat(3000));
    const result = object(await f.tools.execute('search', { text: 'needle' }));
    const omissions = object(result.omissions!);
    assert.equal(omissions.count, 41);
    assert.ok(Array.isArray(omissions.files));
    assert.ok(omissions.files.length < 41);
    assert.equal(omissions.omittedDetails, 41 - omissions.files.length);
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 2048);
    writeFileSync(join(f.workspace, 'packages', 'coding', 'more.ts'), 'needle\n'.repeat(200));
    await assert.rejects(f.tools.execute('search', { path: 'packages/coding', text: 'needle' }), /search results exceed limit/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
