import assert from 'node:assert/strict';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { runIsolated } from '../src/isolation.ts';

const helper = resolve('trusted/workspace-files.mjs');
const limits = { maxFiles: 40, maxTotalBytes: 100_000, maxFileBytes: 30_000, maxResponseBytes: 40_000, maxResults: 2 };
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const expected = (value: string, mode = 0o644) => ({ sha256: sha(value), mode });
const platform = { skip: process.platform !== 'darwin' };
function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'palimpsest-file-tools-'));
  const root = join(base, 'work'); const stage = join(base, 'stage'); const outside = join(base, 'private');
  const operations = new Map<string, string>();
  for (const directory of [root, stage, outside]) mkdirSync(directory, { mode: 0o700 });
  async function call(operation: Record<string, unknown>, operationId?: string, overrides = {}) {
    if (operationId && operation.kind !== 'observe') operations.set(operationId, sha(JSON.stringify(operation)));
    const result = await runIsolated({ program: process.execPath, args: [helper, root, stage], cwd: root,
      readPaths: [helper, stage], writePaths: [root, stage], timeoutMs: 3000, maxOutputBytes: 50_000,
      stdin: JSON.stringify({ version: 1, operation, operationId,
        ...(operation.kind === 'observe' ? { expectedOperationDigest: operations.get(operationId!) ?? sha('unknown') } : {}),
        limits: { ...limits, ...overrides } }) });
    assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.outputLimitExceeded, false);
    assert.equal(result.timedOut, false); return JSON.parse(result.stdout);
  }
  return { base, root, stage, outside, call, dispose: () => rmSync(base, { recursive: true, force: true }) };
}

test('manifest includes exact binary/empty/executable files and pages sorted paths', platform, async () => {
  const f = fixture(); try {
    writeFileSync(join(f.root, 'z'), Buffer.from([0xff, 0])); writeFileSync(join(f.root, 'empty'), '');
    writeFileSync(join(f.root, 'exec'), 'hello'); chmodSync(join(f.root, 'exec'), 0o755);
    const manifest = await f.call({ kind: 'manifest' }); assert.equal(manifest.ok, true);
    assert.deepEqual(manifest.result.files, [
      { path: 'empty', ...expected(''), bytes: 0 }, { path: 'exec', ...expected('hello', 0o755), bytes: 5 },
      { path: 'z', sha256: sha(Buffer.from([0xff, 0])), mode: 0o644, bytes: 2 },
    ]);
    const first = await f.call({ kind: 'list' }); assert.deepEqual(first.result.files.map((x: any) => x.path), ['empty', 'exec']);
    assert.equal(first.result.truncated, true);
    const last = await f.call({ kind: 'list', cursor: first.result.nextCursor });
    assert.deepEqual(last.result.files.map((x: any) => x.path), ['z']); assert.equal(last.result.nextCursor, null);
  } finally { f.dispose(); }
});

test('reads preserve byte coordinates, reject binary and split Unicode; search paginates lines', platform, async () => {
  const f = fixture(); try {
    const text = 'a😀\nfind one\nfind two\nfind three'; writeFileSync(join(f.root, 'text'), text);
    writeFileSync(join(f.root, 'binary'), Buffer.from([0xff]));
    const read = await f.call({ kind: 'read', path: 'text', startByte: 1, endByte: 5, expectedSha256: sha(text) });
    assert.equal(read.result.text, '😀'); assert.equal(read.result.bytes, Buffer.byteLength(text));
    assert.equal((await f.call({ kind: 'read', path: 'text', startByte: 2, endByte: 5 })).code, 'invalid-range');
    assert.equal((await f.call({ kind: 'read', path: 'binary' })).code, 'unsupported-encoding');
    assert.equal((await f.call({ kind: 'read', path: 'text', expectedSha256: sha('old') })).code, 'conflict');
    const search = await f.call({ kind: 'search', query: 'find' }); assert.equal(search.result.matches.length, 2);
    assert.equal(search.result.skippedBinaryFiles, 1);
    assert.equal(search.result.matches[0].line, 2);
    const last = await f.call({ kind: 'search', query: 'find', cursor: search.result.nextCursor });
    assert.equal(last.result.matches[0].line, 4); assert.equal(last.result.truncated, false);
  } finally { f.dispose(); }
});

test('create replace unique edit move delete and directories change actual files with preconditions', platform, async () => {
  const f = fixture(); try {
    assert.equal((await f.call({ kind: 'mkdir', path: 'src' }, 'dir')).result.status, 'completed');
    assert.equal((await f.call({ kind: 'create', path: 'src/a', content: 'one', mode: 0o644 }, 'create')).result.status, 'completed');
    assert.equal((await f.call({ kind: 'replace', path: 'src/a', content: 'two', mode: 0o755, expected: expected('one') }, 'replace')).ok, true);
    assert.equal((await f.call({ kind: 'edit', path: 'src/a', oldText: 'two', newText: 'three', expected: expected('two', 0o755) }, 'edit')).ok, true);
    assert.equal((await f.call({ kind: 'move', path: 'src/a', destination: 'src/b', expected: expected('three', 0o755) }, 'move')).ok, true);
    assert.equal(readFileSync(join(f.root, 'src/b'), 'utf8'), 'three');
    assert.equal((await f.call({ kind: 'rmdir', path: 'src' }, 'nonempty')).code, 'conflict');
    assert.equal((await f.call({ kind: 'delete', path: 'src/b', expected: expected('three', 0o755) }, 'delete')).ok, true);
    assert.equal((await f.call({ kind: 'rmdir', path: 'src' }, 'rmdir')).ok, true);
    assert.deepEqual((await f.call({ kind: 'manifest' })).result.files, []);
  } finally { f.dispose(); }
});

test('stale/mode/ambiguous edits and existing move destination never alter files', platform, async () => {
  const f = fixture(); try {
    writeFileSync(join(f.root, 'a'), 'xx'); writeFileSync(join(f.root, 'b'), 'keep');
    for (const [operation, id] of [
      [{ kind: 'replace', path: 'a', content: 'bad', expected: expected('old'), mode: 0o644 }, 'stale'],
      [{ kind: 'edit', path: 'a', oldText: 'x', newText: 'bad', expected: expected('xx') }, 'many'],
      [{ kind: 'edit', path: 'a', oldText: 'z', newText: 'bad', expected: expected('xx') }, 'zero'],
      [{ kind: 'delete', path: 'a', expected: expected('xx', 0o755) }, 'mode'],
      [{ kind: 'move', path: 'a', destination: 'b', expected: expected('xx') }, 'exists'],
    ] as const) assert.equal((await f.call(operation, id)).code, 'conflict');
    const stale = await f.call({ kind: 'delete', path: 'a', expected: expected('old') }, 'metadata');
    assert.deepEqual(stale.conflict, { path: 'a', current: { ...expected('xx'), bytes: 2 } });
    assert.equal(readFileSync(join(f.root, 'a'), 'utf8'), 'xx'); assert.equal(readFileSync(join(f.root, 'b'), 'utf8'), 'keep');
  } finally { f.dispose(); }
});

test('unsafe paths and links are denied in actual sandbox without private inode damage', platform, async () => {
  const f = fixture(); try {
    const privateFile = join(f.outside, 'key'); writeFileSync(privateFile, 'private fixture');
    for (const path of ['../private/key', '/private/key', 'a/../b', '.git/config', 'a//b', 'x\n']) {
      assert.equal((await f.call({ kind: 'create', path, content: 'bad', mode: 0o644 }, 'badpath')).code, 'invalid-path');
    }
    symlinkSync(f.outside, join(f.root, 'link'));
    assert.equal((await f.call({ kind: 'read', path: 'link/key' })).ok, false);
    unlinkSync(join(f.root, 'link'));
    linkSync(privateFile, join(f.root, 'hard'));
    assert.equal((await f.call({ kind: 'read', path: 'hard' })).code, 'unsupported-entry');
    assert.equal((await f.call({ kind: 'replace', path: 'hard', content: 'bad', mode: 0o644, expected: expected('private fixture') }, 'hard')).code, 'unsupported-entry');
    assert.equal((await f.call({ kind: 'manifest' })).code, 'unsupported-entry');
    assert.equal(readFileSync(privateFile, 'utf8'), 'private fixture');
  } finally { f.dispose(); }
});

test('observe reconciles actual pre/post/mixed states and duplicate operation never replays', platform, async () => {
  const f = fixture(); try {
    writeFileSync(join(f.root, 'a'), 'before');
    const operation = { kind: 'move', path: 'a', destination: 'b', expected: expected('before') };
    assert.equal((await f.call(operation, 'durable')).result.status, 'completed');
    assert.equal((await f.call({ kind: 'observe' }, 'durable')).result.status, 'completed');
    rmSync(join(f.root, 'b')); writeFileSync(join(f.root, 'a'), 'before');
    assert.equal((await f.call(operation, 'durable')).result.status, 'not-completed');
    assert.equal(readFileSync(join(f.root, 'a'), 'utf8'), 'before');
    writeFileSync(join(f.root, 'b'), 'before');
    assert.equal((await f.call({ kind: 'observe' }, 'durable')).result.status, 'uncertain');
    assert.equal((await f.call({ ...operation, destination: 'c' }, 'durable')).code, 'operation-conflict');
    assert.equal((await f.call({ kind: 'observe' }, 'unknown')).result.status, 'not-staged');
  } finally { f.dispose(); }
});

test('host ceilings reject large files and safely cap response before emission', platform, async () => {
  const f = fixture(); try {
    writeFileSync(join(f.root, 'large'), 'x'.repeat(100));
    assert.equal((await f.call({ kind: 'manifest' }, undefined, { maxFileBytes: 20 })).code, 'limit-exceeded');
    assert.equal((await f.call({ kind: 'read', path: 'large' }, undefined, { maxResponseBytes: 80 })).code, 'response-limit');
    assert.equal((await f.call({ kind: 'create', path: 'a', content: 'x'.repeat(100), mode: 0o644 }, 'limit', { maxFileBytes: 20 })).code, 'limit-exceeded');
  } finally { f.dispose(); }
});

test('unsupported directory entries and aggregate ceilings reject without mutation', platform, async () => {
  const f = fixture(); try {
    writeFileSync(join(f.root, 'a'), '123'); writeFileSync(join(f.root, 'b'), '456');
    assert.equal((await f.call({ kind: 'manifest' }, undefined, { maxTotalBytes: 5 })).code, 'limit-exceeded');
    assert.equal((await f.call({ kind: 'create', path: 'c', content: '789', mode: 0o644 }, 'aggregate', { maxTotalBytes: 8 })).code, 'limit-exceeded');
    assert.equal(existsSync(join(f.root, 'c')), false);
    mkdirSync(join(f.root, 'empty'));
    assert.equal((await f.call({ kind: 'manifest' }, undefined, { maxFiles: 2 })).code, 'limit-exceeded');
    chmodSync(join(f.root, 'a'), 0o4644);
    assert.equal((await f.call({ kind: 'manifest' })).code, 'unsupported-entry');
    chmodSync(join(f.root, 'a'), 0o644);
    mkdirSync(join(f.root, '.git'));
    assert.equal((await f.call({ kind: 'read', path: 'a' })).code, 'invalid-path');
  } finally { f.dispose(); }
});

test('directory listing discovers empty directories and filters a relative subtree', platform, async () => {
  const f = fixture(); try {
    mkdirSync(join(f.root, 'src')); mkdirSync(join(f.root, 'empty'));
    writeFileSync(join(f.root, 'src/a'), 'a'); writeFileSync(join(f.root, 'outside'), 'b');
    const list = await f.call({ kind: 'list', path: 'src' });
    assert.equal(list.ok, true); assert.deepEqual(list.result.files.map((x: any) => x.path), ['src/a']);
    assert.deepEqual(list.result.directories, []);
    const top = await f.call({ kind: 'list' }); assert.equal(top.ok, true);
    const next = await f.call({ kind: 'list', cursor: top.result.nextCursor });
    assert.deepEqual([...top.result.directories, ...next.result.directories], ['empty', 'src']);
  } finally { f.dispose(); }
});

test('reconciliation compares durable stage digest with independently journaled arguments', platform, async () => {
  const f = fixture(); try {
    await f.call({ kind: 'create', path: 'a', content: 'a', mode: 0o644 }, 'bound');
    const result = await runIsolated({ program: process.execPath, args: [helper, f.root, f.stage], cwd: f.root,
      readPaths: [helper, f.stage], writePaths: [f.root, f.stage], stdin: JSON.stringify({ version: 1, limits,
        operationId: 'bound', expectedOperationDigest: sha('different'), operation: { kind: 'observe' } }) });
    assert.deepEqual(JSON.parse(result.stdout), { ok: false, code: 'operation-conflict' });
    assert.equal(readFileSync(join(f.root, 'a'), 'utf8'), 'a');
  } finally { f.dispose(); }
});

test('directory reconciliation holds unrelated nonempty states uncertain', platform, async () => {
  const f = fixture(); try {
    await f.call({ kind: 'mkdir', path: 'new' }, 'mkdir'); writeFileSync(join(f.root, 'new/unrelated'), 'changed');
    assert.equal((await f.call({ kind: 'observe' }, 'mkdir')).result.status, 'uncertain');
    rmSync(join(f.root, 'new'), { recursive: true }); mkdirSync(join(f.root, 'empty'));
    await f.call({ kind: 'rmdir', path: 'empty' }, 'rmdir'); mkdirSync(join(f.root, 'empty'));
    writeFileSync(join(f.root, 'empty/unrelated'), 'changed');
    assert.equal((await f.call({ kind: 'observe' }, 'rmdir')).result.status, 'uncertain');
  } finally { f.dispose(); }
});

test('parent replacement after actual helper launch cannot overwrite private files', platform, async () => {
  const f = fixture(); try {
    mkdirSync(join(f.root, 'src')); writeFileSync(join(f.root, 'src/a'), 'source'); writeFileSync(join(f.outside, 'a'), 'private');
    const result = await runIsolated({ program: process.execPath, args: [helper, f.root, f.stage], cwd: f.root,
      readPaths: [helper, f.stage], writePaths: [f.root, f.stage], stdin: JSON.stringify({ version: 1, limits, operationId: 'race',
        operation: { kind: 'replace', path: 'src/a', content: 'bad', mode: 0o644, expected: expected('source') } }),
      onSpawn: () => { rmSync(join(f.root, 'src'), { recursive: true }); symlinkSync(f.outside, join(f.root, 'src')); } });
    assert.equal(result.exitCode, 0); assert.equal(JSON.parse(result.stdout).ok, false);
    assert.equal(readFileSync(join(f.outside, 'a'), 'utf8'), 'private');
  } finally { f.dispose(); }
});

test('real staging denial and post-mutation lost output reconcile without replay', platform, async () => {
  const f = fixture(); try {
    const operation = { kind: 'create', path: 'a', content: 'durable', mode: 0o644 };
    const request = (id: string, operation: object) => JSON.stringify({ version: 1, limits, operationId: id, operation });
    const deniedBeforeStage = await runIsolated({ program: process.execPath, args: [helper, f.root, f.stage], cwd: f.root,
      readPaths: [helper, f.stage], stdin: request('before-stage', operation) });
    assert.equal(JSON.parse(deniedBeforeStage.stdout).ok, false); assert.equal(existsSync(join(f.root, 'a')), false);
    const observe = async (id: string) => {
      const result = await runIsolated({ program: process.execPath, args: [helper, f.root, f.stage], cwd: f.root,
        readPaths: [helper, f.stage], stdin: JSON.stringify({ version: 1, limits, operationId: id,
          operation: { kind: 'observe' }, expectedOperationDigest: sha(JSON.stringify(operation)) }) });
      return JSON.parse(result.stdout).result.status;
    };
    assert.equal(await observe('before-stage'), 'not-staged');
    const deniedAfterStage = await runIsolated({ program: process.execPath, args: [helper, f.root, f.stage], cwd: f.root,
      readPaths: [helper, f.stage], writePaths: [f.stage], stdin: request('after-stage', operation) });
    assert.equal(JSON.parse(deniedAfterStage.stdout).ok, false);
    assert.equal(existsSync(join(f.stage, 'after-stage/manifest.json')), true);
    assert.equal(existsSync(join(f.root, 'a')), false); assert.equal(await observe('after-stage'), 'not-completed');
    const lostOutput = await runIsolated({ program: process.execPath, args: [helper, f.root, f.stage], cwd: f.root,
      readPaths: [helper, f.stage], writePaths: [f.root, f.stage], maxOutputBytes: 64, stdin: request('lost-output', operation) });
    assert.equal(lostOutput.outputLimitExceeded, true); assert.equal(await observe('lost-output'), 'completed');
    assert.equal(readFileSync(join(f.root, 'a'), 'utf8'), 'durable');
  } finally { f.dispose(); }
});

test('control paths, invalid input/limits and lone surrogate content fail safely', platform, async () => {
  const f = fixture(); try {
    assert.equal((await f.call({ kind: 'create', path: 'x\u0085', content: '', mode: 0o644 }, 'c1')).code, 'invalid-path');
    assert.equal((await f.call({ kind: 'create', path: 'a', content: '\ud800', mode: 0o644 }, 'unicode')).code, 'unsupported-encoding');
    assert.equal((await f.call({ kind: 'read', path: 'a', root: f.outside })).code, 'invalid-request');
    assert.equal((await f.call({ kind: 'manifest' }, undefined, { maxFiles: 0 })).code, 'invalid-request');
    mkdirSync(join(f.root, '..stage'));
    const result = await runIsolated({ program: process.execPath, args: [helper, f.root, join(f.root, '..stage')], cwd: f.root,
      readPaths: [helper], writePaths: [f.root], stdin: JSON.stringify({ version: 1, limits, operation: { kind: 'manifest' } }) });
    assert.deepEqual(JSON.parse(result.stdout), { ok: false, code: 'invalid-roots' });
  } finally { f.dispose(); }
});
