import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { CodingTools } from '../src/coding-tools.ts';
import { CodingWorkspaces, workspaceTreeDigest } from '../src/workspaces.ts';
import { freezeBaseline } from '../src/candidates.ts';
import { Store } from '../src/store.ts';
import type { CodingArtifacts } from '../src/coding-artifacts.ts';
import type { CodingExecutionContext } from '../src/coding-contracts.ts';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const darwin = { skip: process.platform !== 'darwin' };
function fixture(extraFiles: Array<{ path: string; content: Buffer; mode: 0o644 | 0o755 }> = []) {
  const root = mkdtempSync(join(tmpdir(), 'palimpsest-coding-tools-')), repositoryRoot = join(root, 'repo');
  mkdirSync(join(repositoryRoot, 'src/agent'), { recursive: true }); mkdirSync(join(repositoryRoot, 'docs'));
  writeFileSync(join(repositoryRoot, 'src/agent/brain.ts'), 'export function conversationRequest(){return {system:"fixture",prompt:"{}"};}');
  writeFileSync(join(repositoryRoot, 'docs/seed-contract.md'), 'Synthetic contract'); writeFileSync(join(repositoryRoot, 'package.json'), '{"type":"module"}');
  const git = (...args: string[]) => execFileSync('/usr/bin/git', args, { cwd: repositoryRoot, stdio: 'ignore' }); git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('add', '.'); git('commit', '-qm', 'Fixture');
  const baseline = freezeBaseline({ repositoryRoot, dataDir: join(root, 'state'), configuration: {}, modelProfile: { provider: 'fixture', model: null } });
  const store = new Store(join(root, 'state/state.sqlite'));
  const task = store.enqueue({ source: 'coding-session', conversationId: 'coding:test', input: 'Synthetic receiver workflow' }); store.updateTask(task.id, { state: 'running' });
  const files = [{ path: 'src/value.txt', content: Buffer.from('1\n'), mode: 0o644 as const }, { path: 'empty', content: Buffer.from(''), mode: 0o644 as const }, ...extraFiles];
  let allowed = true;
  const workspaces = new CodingWorkspaces({ store, directory: join(root, 'drafts'), repositoryRoot, runtime: baseline.runtime, runtimeRelease: { releaseDir: baseline.releaseDir, digest: baseline.manifestDigest }, toolchainReadPaths: [resolve('node_modules')], authorize: a => allowed && a.taskId === task.id && a.epoch === 1 });
  const workspace = workspaces.create({ taskId: task.id, epoch: 1, base: { releaseDigest: 'a'.repeat(64), baseCommit: 'b'.repeat(40), treeDigest: workspaceTreeDigest(files) }, files });
  const context: CodingExecutionContext = { sessionId: 'fixture-session', taskId: task.id, attemptId: 'fixture-attempt', contractDigest: 'c'.repeat(64), epoch: 1, expiresAt: Date.now() + 60000, workspaceId: workspace.id, sourceArtifactId: 'fixture-source', base: workspace.base, commands: [] };
  // File/command fixture supplies no artifact authority. Actual import/submission has separate host fixtures.
  const artifacts = { readBaseFiles: () => files, readBaseTree: () => ({ files, directories: [{ path: 'src', mode: 0o700 }], rootMode: 0o700 }) } as unknown as CodingArtifacts;
  const tools = new CodingTools({ store, workspaces, artifacts, current: () => { if (!allowed) throw new Error('Authority revoked'); }, commandTimeoutMs: 1000, maxCommandOutputBytes: 65536 });
  return { root, store, workspaces, tools, context, allow: (value: boolean) => { allowed = value; }, cleanup: async () => { await workspaces.stop(); store.close(); execFileSync('/bin/chmod', ['-R', 'u+w', root]); rmSync(root, { recursive: true, force: true }); } };
}
test('whole batch validation rejects a mixed valid mutation and forged grant before any effects', async () => {
  const f = fixture(); try {
    assert.throws(() => f.tools.validateBatch([{ callId: 'edit00001', name: 'workspace_files', arguments: '{"kind":"create","path":"new","content":"","mode":420}' }, { callId: 'edit00002', name: 'workspace_files', arguments: '{"kind":"observe","taskId":"forged"}' }], [], 2));
    assert.equal(f.store.listEffects().length, 0);
  } finally { await f.cleanup(); }
});
test('actual file receiver read/edit/create/move/delete/mkdir/rmdir and conflict receipts', darwin, async () => {
  const f = fixture(); try {
    let ordinal = 0;
    const run = async (operation: unknown) => f.tools.execute(f.context, { callId: `file${String(++ordinal).padStart(5, '0')}`, name: 'workspace_files', arguments: JSON.stringify(operation) }, `fixture:files:${ordinal}`);
    const read = await run({ kind: 'read', path: 'src/value.txt', startByte: 0, endByte: 1 }); assert.equal(read.outcome.ok, true); assert.match(JSON.stringify(read.receipt), /"text":"1"/);
    const conflict = await run({ kind: 'edit', path: 'src/value.txt', oldText: 'absent', newText: '2', expected: { sha256: sha('1\n'), mode: 420 } }); assert.equal(conflict.outcome.ok, false);
    await run({ kind: 'edit', path: 'src/value.txt', oldText: '1', newText: '2', expected: { sha256: sha('1\n'), mode: 420 } });
    await run({ kind: 'mkdir', path: 'draft' }); await run({ kind: 'create', path: 'draft/empty', content: '', mode: 493 });
    await run({ kind: 'move', path: 'draft/empty', destination: 'moved', expected: { sha256: sha(''), mode: 493 } });
    await run({ kind: 'delete', path: 'moved', expected: { sha256: sha(''), mode: 493 } }); await run({ kind: 'rmdir', path: 'draft' });
    assert.equal(readFileSync(join(f.workspaces.path(f.context.workspaceId), 'src/value.txt'), 'utf8'), '2\n');
    assert.equal(f.store.listEffects().filter(effect => effect.state === 'completed').length, 8);
  } finally { await f.cleanup(); }
});
test('real failed Node check output reaches the repair, a new check passes, opaque paging is scoped', darwin, async () => {
  const f = fixture(); try {
    const check = { tool: 'node', args: ['--input-type=module', '-e', 'import fs from "node:fs";if(fs.readFileSync("src/value.txt","utf8")!=="2\\n"){console.error("observed fixture failure");process.exit(1)}console.log("observed fixture pass")'] };
    const failed = await f.tools.execute(f.context, { callId: 'test00001', name: 'workspace_command', arguments: JSON.stringify(check) }, 'fixture:command:1');
    assert.equal(failed.outcome.ok, false); assert.match(JSON.stringify(failed.receipt), /"code":1/); f.context.commands.push(failed.command!);
    const output = await f.tools.execute(f.context, { callId: 'out000001', name: 'workspace_output', arguments: '{"commandCallId":"test00001","stream":"stderr","offset":0,"length":1024}' }, 'fixture:output:1'); assert.match(JSON.stringify(output.receipt), /observed fixture failure/);
    await f.tools.execute(f.context, { callId: 'edit00001', name: 'workspace_files', arguments: JSON.stringify({ kind: 'edit', path: 'src/value.txt', oldText: '1', newText: '2', expected: { sha256: sha('1\n'), mode: 420 } }) }, 'fixture:edit');
    const passed = await f.tools.execute(f.context, { callId: 'test00002', name: 'workspace_command', arguments: JSON.stringify(check) }, 'fixture:command:2'); assert.equal(passed.outcome.ok, true);
    const forged = await f.tools.execute(f.context, { callId: 'out000002', name: 'workspace_output', arguments: '{"commandCallId":"forged001","stream":"stdout","offset":0,"length":1}' }, 'fixture:output:2'); assert.equal(forged.outcome.ok, false);
  } finally { await f.cleanup(); }
});
test('stable diff pages retain file hunks and empty directory changes, rejecting stale continuation', darwin, async () => {
  const f = fixture(); try {
    await f.tools.execute(f.context, { callId: 'edit00001', name: 'workspace_files', arguments: JSON.stringify({ kind: 'edit', path: 'src/value.txt', oldText: '1', newText: '2', expected: { sha256: sha('1\n'), mode: 420 } }) }, 'diff:edit');
    await f.tools.execute(f.context, { callId: 'dir000001', name: 'workspace_files', arguments: '{"kind":"mkdir","path":"new-directory"}' }, 'diff:mkdir');
    const first = await f.tools.execute(f.context, { callId: 'diff00001', name: 'workspace_diff', arguments: '{}' }, 'diff:page:1');
    assert.equal(first.outcome.ok, true); assert.match(JSON.stringify(first.receipt), /directory-added/);
    const cursor = (first.receipt as { nextCursor: string }).nextCursor; assert.ok(cursor);
    const second = await f.tools.execute(f.context, { callId: 'diff00002', name: 'workspace_diff', arguments: JSON.stringify({ cursor }) }, 'diff:page:2');
    assert.match(JSON.stringify(second.receipt), /-1/); assert.match(JSON.stringify(second.receipt), /\+2/);
    await f.tools.execute(f.context, { callId: 'edit00002', name: 'workspace_files', arguments: JSON.stringify({ kind: 'replace', path: 'src/value.txt', content: '3\n', mode: 420, expected: { sha256: sha('2\n'), mode: 420 } }) }, 'diff:new-revision');
    const stale = await f.tools.execute(f.context, { callId: 'diff00003', name: 'workspace_diff', arguments: JSON.stringify({ cursor }) }, 'diff:stale'); assert.equal(stale.outcome.ok, false); assert.match(JSON.stringify(stale.receipt), /stale/);
  } finally { await f.cleanup(); }
});
test('receiver manifest/list/literal search/full read remain available through the catalog', darwin, async () => {
  const f = fixture(); try {
    for (const [ordinal, operation, match] of [
      [1, { kind: 'manifest' }, /value.txt/], [2, { kind: 'list' }, /directories/],
      [3, { kind: 'search', query: '1' }, /"line":1/], [4, { kind: 'read', path: 'src/value.txt' }, /"text":"1\\n"/],
    ] as const) {
      const receipt = await f.tools.execute(f.context, { callId: `read${String(ordinal).padStart(5, '0')}`, name: 'workspace_files', arguments: JSON.stringify(operation) }, `receiver:inspect:${ordinal}`);
      assert.equal(receipt.outcome.ok, true); assert.match(JSON.stringify(receipt.receipt), match);
    }
  } finally { await f.cleanup(); }
});

test('large escaped diff remains bounded and pages the complete hunk through model-facing cursors', darwin, async () => {
  const f = fixture(); try {
    const content = '\u0001'.repeat(5000) + '😀'.repeat(3000) + '\n';
    await f.tools.execute(f.context, { callId: 'edit00001', name: 'workspace_files', arguments: JSON.stringify({ kind: 'replace', path: 'src/value.txt', content, mode: 420, expected: { sha256: sha('1\n'), mode: 420 } }) }, 'large:edit');
    let cursor: string | undefined, hunk = '', pages = 0;
    do {
      const result = await f.tools.execute(f.context, { callId: `diff${String(++pages).padStart(5, '0')}`, name: 'workspace_diff', arguments: JSON.stringify(cursor ? { cursor } : {}) }, `large:diff:${pages}`);
      assert.equal(result.outcome.ok, true); if (!result.outcome.ok) throw new Error('Expected diff page');
      assert.ok(Buffer.byteLength(result.outcome.text) <= 16384);
      const model = JSON.parse(result.outcome.text); assert.equal(model.truncated, undefined); assert.ok(model.changes);
      hunk += model.changes[0].textHunk; cursor = model.nextCursor ?? undefined;
      assert.ok(pages < 32);
    } while (cursor);
    assert.match(hunk, /-1/); assert.ok(hunk.includes('+' + content.trimEnd())); assert.ok(pages > 1);
  } finally { await f.cleanup(); }
});

test('completed receiver evidence is reused once and cannot be rebound to different raw intent', darwin, async () => {
  const f = fixture(); try {
    const intent = { callId: 'edit00001', name: 'workspace_files', arguments: JSON.stringify({ kind: 'edit', path: 'src/value.txt', oldText: '1', newText: '2', expected: { sha256: sha('1\n'), mode: 420 } }) };
    const first = await f.tools.execute(f.context, intent, 'effect:once');
    assert.equal(first.outcome.ok, true); const recovered = await f.tools.execute(f.context, intent, 'effect:once');
    assert.deepEqual(recovered.receipt, first.receipt); assert.equal(f.store.listEffects().length, 1);
    await assert.rejects(f.tools.execute(f.context, { ...intent, arguments: JSON.stringify({ kind: 'delete', path: 'src/value.txt', expected: { sha256: sha('2\n'), mode: 420 } }) }, 'effect:once'), /intent mismatch/);
    assert.equal(readFileSync(join(f.workspaces.path(f.context.workspaceId), 'src/value.txt'), 'utf8'), '2\n');
  } finally { await f.cleanup(); }
});

test('oversized list/search/read receipts retain usable structured continuation in model results', darwin, async () => {
  const shared = ['a'.repeat(200), 'b'.repeat(200), 'c'.repeat(200)].join('/');
  const files = Array.from({ length: 30 }, (_, n) => ({ path: `${shared}/${String(n).padStart(2, '0')}-${'d'.repeat(190)}.txt`, content: Buffer.from('needle ' + 'x'.repeat(2000) + '\n'), mode: 0o644 as const }));
  const f = fixture(files); try {
    const model = (value: { outcome: import('../src/coding-provider.ts').ToolOutcome }) => { assert.equal(value.outcome.ok, true); if (!value.outcome.ok) throw new Error('Expected receiver success'); assert.ok(Buffer.byteLength(value.outcome.text) <= 16384); return JSON.parse(value.outcome.text); };
    const listed = model(await f.tools.execute(f.context, { callId: 'list00001', name: 'workspace_files', arguments: '{"kind":"list"}' }, 'bounded:list:1'));
    assert.ok(listed.result.files.length); assert.equal(listed.result.truncated, true); assert.equal(typeof listed.result.nextCursor, 'string');
    const next = model(await f.tools.execute(f.context, { callId: 'list00002', name: 'workspace_files', arguments: JSON.stringify({ kind: 'list', cursor: listed.result.nextCursor }) }, 'bounded:list:2'));
    assert.ok(next.result.files[0].path > listed.result.nextCursor);
    const searched = model(await f.tools.execute(f.context, { callId: 'find00001', name: 'workspace_files', arguments: '{"kind":"search","query":"needle"}' }, 'bounded:search'));
    assert.ok(searched.result.matches[0].path); assert.equal(searched.result.truncated, true); assert.equal(searched.result.nextCursor, searched.result.matches.length);
    const read = model(await f.tools.execute(f.context, { callId: 'read00001', name: 'workspace_files', arguments: JSON.stringify({ kind: 'read', path: files[0]!.path }) }, 'bounded:read'));
    // Full 2008-byte read fits; requesting full large content below must still expose the exact next byte.
    assert.equal(read.result.text, files[0]!.content.toString());
    await f.tools.execute(f.context, { callId: 'edit00001', name: 'workspace_files', arguments: JSON.stringify({ kind: 'create', path: 'large', content: '\u0001'.repeat(5000), mode: 420 }) }, 'bounded:large');
    const ranged = model(await f.tools.execute(f.context, { callId: 'read00002', name: 'workspace_files', arguments: '{"kind":"read","path":"large"}' }, 'bounded:read:large'));
    assert.equal(ranged.result.nextStartByte, Buffer.byteLength(ranged.result.text)); assert.equal(ranged.result.truncated, true); assert.equal(ranged.result.bytes, 5000);
  } finally { await f.cleanup(); }
});

test('oversized sealed command output preserves exact base64 and next offsets in model pages', darwin, async () => {
  const f = fixture(); try {
    const command = await f.tools.execute(f.context, { callId: 'test00001', name: 'workspace_command', arguments: JSON.stringify({ tool: 'node', args: ['-e', 'process.stdout.write(String.fromCharCode(1).repeat(5000))'] }) }, 'output:command');
    assert.equal(command.outcome.ok, true); f.context.commands.push(command.command!);
    const chunks: Buffer[] = []; let offset = 0, pages = 0;
    do {
      const result = await f.tools.execute(f.context, { callId: `out${String(++pages).padStart(6, '0')}`, name: 'workspace_output', arguments: JSON.stringify({ commandCallId: 'test00001', stream: 'stdout', offset, length: 65536 }) }, `output:page:${pages}`);
      assert.equal(result.outcome.ok, true); if (!result.outcome.ok) throw new Error('Expected sealed output');
      assert.ok(Buffer.byteLength(result.outcome.text) <= 16384); const model = JSON.parse(result.outcome.text);
      assert.equal(model.totalBytes, 5000); assert.equal(model.outputComplete, true); assert.equal(model.offset, offset);
      const bytes = Buffer.from(model.base64, 'base64'); chunks.push(bytes); assert.equal(model.endOffset, offset + bytes.length);
      offset = model.nextOffset ?? 5000; assert.ok(pages < 8);
    } while (offset < 5000);
    assert.deepEqual(Buffer.concat(chunks), Buffer.alloc(5000, 1));
  } finally { await f.cleanup(); }
});
