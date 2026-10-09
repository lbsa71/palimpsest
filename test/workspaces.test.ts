import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Store } from '../src/store.ts';
import { CodingWorkspaces, workspaceTreeDigest } from '../src/workspaces.ts';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const helperDigest = createHash('sha256').update(readFileSync(new URL('../trusted/workspace-files.mjs', import.meta.url))).digest('hex');
const files = [{ path: 'src/main.ts', content: Buffer.from('first\nsecond\n'), mode: 0o644 as const },
  { path: 'empty', content: Buffer.from(''), mode: 0o644 as const }];

function fixture(source = 'direct') {
  const root = mkdtempSync(join(tmpdir(), 'palimpsest-workspaces-'));
  const store = new Store(join(root, 'state.sqlite'));
  const task = store.enqueue({ conversationId: source === 'peer' ? 'peer:blackhat' : 'coding:test', source, input: 'repair source' });
  store.claimNext();
  let currentEpoch = 3; let allowed = true;
  const options = { store, directory: join(root, 'workspaces'), repositoryRoot: process.cwd(),
    authorize: (authority: { epoch: number }) => allowed && authority.epoch === currentEpoch };
  const receiver = new CodingWorkspaces(options);
  const input = { taskId: task.id, epoch: 3, base: { releaseDigest: 'a'.repeat(64), baseCommit: 'b'.repeat(40), treeDigest: workspaceTreeDigest(files) }, files };
  return { root, store, task, receiver, options, input, epoch: (value: number) => { currentEpoch = value; },
    allow: (value: boolean) => { allowed = value; }, cleanup: async () => { await receiver.stop(); store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('snapshot import binds exact files/modes and external base identity before operations', async () => {
  const f = fixture();
  try {
    const ws = f.receiver.create(f.input);
    assert.equal(ws.base.treeDigest, workspaceTreeDigest(files));
    assert.equal(readFileSync(join(f.receiver.path(ws.id), 'src/main.ts'), 'utf8'), 'first\nsecond\n');
    assert.equal(readFileSync(join(f.receiver.path(ws.id), 'empty')).length, 0);
    assert.throws(() => f.receiver.create({ ...f.input, base: { ...f.input.base, treeDigest: '0'.repeat(64) } }), /source|digest/i);
    assert.throws(() => f.receiver.create({ ...f.input, files: [...files, files[0]!] }), /duplicate|collision/i);
    assert.throws(() => new CodingWorkspaces({ ...f.options, directory: join(process.cwd(), 'forbidden-workspace') }), /outside/i);
    assert.equal(existsSync(join(process.cwd(), 'forbidden-workspace')), false);
  } finally { await f.cleanup(); }
});

test('peer, revoked authority and nonrunning task cannot create or read coding workspaces', async () => {
  const peer = fixture('peer');
  try { assert.throws(() => peer.receiver.create(peer.input), /authority|peer/i); }
  finally { await peer.cleanup(); }
  const f = fixture();
  try {
    const ws = f.receiver.create(f.input);
    f.allow(false);
    await assert.rejects(f.receiver.perform(ws.id, 3, 'denied', { kind: 'read', path: 'src/main.ts' }), /authority/i);
    assert.equal(f.store.effect('denied'), undefined);
    f.allow(true); f.store.updateTask(f.task.id, { state: 'cancelled' });
    await assert.rejects(f.receiver.perform(ws.id, 3, 'cancelled', { kind: 'manifest' }), /authority|running/i);
  } finally { await f.cleanup(); }
});

test('real helper mutations are journaled once and stale/ambiguous edits preserve files', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    const ws = f.receiver.create(f.input);
    const operation = { kind: 'edit' as const, path: 'src/main.ts', expected: { sha256: sha('first\nsecond\n'), mode: 0o644 as const }, oldText: 'second', newText: 'corrected' };
    const result = await f.receiver.perform(ws.id, 3, 'edit-once', operation);
    assert.equal(result.ok, true);
    assert.equal(f.store.effect('edit-once')?.state, 'completed');
    assert.equal(readFileSync(join(f.receiver.path(ws.id), 'src/main.ts'), 'utf8'), 'first\ncorrected\n');
    assert.deepEqual(await f.receiver.perform(ws.id, 3, 'edit-once', operation), result);
    assert.equal(f.store.listEvents().filter(event => event.type === 'effect.reserved' && event.taskId === f.task.id).length, 1);
    await assert.rejects(f.receiver.perform(ws.id, 3, 'edit-once', { ...operation, newText: 'different' }), /conflict/i);
    const stale = await f.receiver.perform(ws.id, 3, 'stale-edit', operation);
    assert.equal(stale.ok, false);
    assert.equal(readFileSync(join(f.receiver.path(ws.id), 'src/main.ts'), 'utf8'), 'first\ncorrected\n');
  } finally { await f.cleanup(); }
});

test('receiver persists workspace identity and manifests after reopening store', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    const ws = f.receiver.create(f.input);
    await f.receiver.perform(ws.id, 3, 'create-empty', { kind: 'create', path: 'new.ts', content: '', mode: 0o755 });
    await f.receiver.stop(); f.store.close();
    const reopened = new Store(join(f.root, 'state.sqlite'));
    try {
      const receiver = new CodingWorkspaces({ ...f.options, store: reopened });
      assert.deepEqual(receiver.workspace(ws.id), ws);
      const observed = await receiver.perform(ws.id, 3, 'inspect-reopened', { kind: 'manifest' });
      assert.equal(observed.ok, true);
      assert.equal(readFileSync(join(receiver.path(ws.id), 'new.ts')).length, 0);
      await receiver.stop();
    } finally { reopened.close(); }
  } finally { await f.cleanup(); }
});

test('exclusive claim refuses a second receiver while a real helper is running', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    const ws = f.receiver.create(f.input);
    assert.throws(() => new CodingWorkspaces(f.options), /coordinator|ownership/i);
    const first = f.receiver.perform(ws.id, 3, 'first', { kind: 'manifest' });
    await assert.rejects(f.receiver.perform(ws.id, 3, 'second', { kind: 'manifest' }), /writer|busy/i);
    assert.equal(f.store.effect('second'), undefined);
    assert.equal((await first).ok, true);
    assert.equal((await f.receiver.perform(ws.id, 3, 'after-drain', { kind: 'manifest' })).ok, true);
  } finally { await f.cleanup(); }
});

test('epoch revocation rejects a delayed result and preserves its effect for reconciliation', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    const ws = f.receiver.create(f.input);
    const running = f.receiver.perform(ws.id, 3, 'revoked', { kind: 'create', path: 'draft.ts', content: 'draft', mode: 0o644 });
    // Wait for the durable reservation, not for any mutation or model claim.
    await new Promise(resolve => setImmediate(resolve));
    f.epoch(4);
    await assert.rejects(running, /authority|revoked/i);
    assert.equal(f.store.effect('revoked')?.state, 'unknown');
    assert.throws(() => f.receiver.adopt(ws.id, 3), /authority/i);
    f.receiver.adopt(ws.id, 4);
    const reconciled = await f.receiver.reconcile(ws.id, 4, 'revoked');
    assert.ok(['completed', 'not-completed', 'not-staged'].includes(reconciled.status));
    assert.equal(f.store.effect('revoked')?.state, 'completed');
  } finally { await f.cleanup(); }
});

test('persistent unknown writer claim cannot be cleared by restart or its age', async () => {
  const f = fixture();
  try {
    const ws = f.receiver.create(f.input);
    writeFileSync(join(f.receiver.controlPath(ws.id), 'writer.json'), JSON.stringify({ version: 1, operationId: 'crashed', pid: null }), { flag: 'wx', mode: 0o600 });
    await f.receiver.stop();
    const other = new CodingWorkspaces(f.options);
    await assert.rejects(other.perform(ws.id, 3, 'blocked', { kind: 'manifest' }), /writer|busy/i);
    await assert.rejects(other.reconcile(ws.id, 3, 'crashed'), /effect|writer|claim/i);
    assert.equal(existsSync(join(f.receiver.controlPath(ws.id), 'writer.json')), true);
    assert.equal(f.store.effect('blocked'), undefined);
    await other.stop();
  } finally { await f.cleanup(); }
});

function stoppedPid(): number {
  const child = spawnSync(process.execPath, ['-e', '0']);
  assert.equal(child.status, 0); assert.ok(child.pid > 0);
  assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  return child.pid;
}

test('reconciliation cannot steal a dead-child claim while its coordinator is alive', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    const ws = f.receiver.create(f.input);
    f.store.reserveEffect({ id: 'owner-gap', taskId: f.task.id, kind: 'workspace.files',
      payload: { workspaceId: ws.id, epoch: 3, baseTreeDigest: ws.base.treeDigest, helperDigest, operation: { kind: 'mkdir', path: 'next' } } });
    f.store.markEffectUnknown('owner-gap', 'Fixture receipt gap after direct helper exit');
    const claim = join(f.receiver.controlPath(ws.id), 'writer.json');
    writeFileSync(claim, JSON.stringify({ version: 1, operationId: 'owner-gap', ownerPid: process.pid, ownerNonce: 'test-owner', pid: stoppedPid() }), { mode: 0o600 });
    await assert.rejects(f.receiver.reconcile(ws.id, 3, 'owner-gap'), /coordinator|owner|writer/i);
    assert.equal(existsSync(claim), true); assert.equal(f.store.effect('owner-gap')?.state, 'unknown');
  } finally { await f.cleanup(); }
});

test('new current epoch can adopt a proven stopped owner and reconcile without replay', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    const ws = f.receiver.create(f.input);
    const operation = { kind: 'mkdir' as const, path: 'not-created' };
    f.store.reserveEffect({ id: 'new-epoch', taskId: f.task.id, kind: 'workspace.files',
      payload: { workspaceId: ws.id, epoch: 3, baseTreeDigest: ws.base.treeDigest, helperDigest, operation } });
    f.store.markEffectUnknown('new-epoch', 'Fixture terminated coordinator and helper before dispatch');
    writeFileSync(join(f.receiver.controlPath(ws.id), 'writer.json'), JSON.stringify({ version: 1, operationId: 'new-epoch', ownerPid: stoppedPid(), ownerNonce: 'stopped-owner', pid: stoppedPid() }), { mode: 0o600 });
    f.epoch(4);
    assert.equal(f.receiver.adopt(ws.id, 4).epoch, 4);
    assert.equal(f.store.effect('new-epoch')?.state, 'unknown');
    assert.equal((await f.receiver.reconcile(ws.id, 4, 'new-epoch')).status, 'not-staged');
    assert.equal(existsSync(join(f.receiver.path(ws.id), 'not-created')), false);
  } finally { await f.cleanup(); }
});

test('accepted operation arguments cannot mutate between invocation and reservation', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    const ws = f.receiver.create(f.input);
    const operation = { kind: 'create' as const, path: 'immutable.ts', content: 'accepted', mode: 0o644 as const };
    const running = f.receiver.perform(ws.id, 3, 'immutable-intent', operation);
    operation.content = 'changed after acceptance';
    assert.equal((await running).ok, true);
    assert.equal(readFileSync(join(f.receiver.path(ws.id), 'immutable.ts'), 'utf8'), 'accepted');
    assert.equal((f.store.effect('immutable-intent')?.payload as any).operation.content, 'accepted');
  } finally { await f.cleanup(); }
});

test('final authority is rechecked after the second conflict-observation helper', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    const ws = f.receiver.create(f.input);
    const original = f.options.authorize; let checks = 0;
    f.options.authorize = authority => original(authority) && ++checks < 4;
    await assert.rejects(f.receiver.perform(ws.id, 3, 'late-conflict', { kind: 'delete', path: 'src/main.ts', expected: { sha256: sha('stale'), mode: 0o644 } }), /authority/i);
    assert.equal(checks, 4); assert.equal(f.store.effect('late-conflict')?.state, 'unknown');
    assert.equal(readFileSync(join(f.receiver.path(ws.id), 'src/main.ts'), 'utf8'), 'first\nsecond\n');
    f.options.authorize = original;
    assert.equal((await f.receiver.reconcile(ws.id, 3, 'late-conflict')).status, 'not-staged');
  } finally { await f.cleanup(); }
});

test('stop drains an actual helper before a new coordinator can acquire ownership', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    const ws = f.receiver.create(f.input);
    const running = f.receiver.perform(ws.id, 3, 'stopped-operation', { kind: 'manifest' });
    // Attach the rejection handler before cancellation; setImmediate reaches
    // the actual spawn, unlike an invented task-success checkpoint.
    const settled = running.catch(error => error);
    await new Promise(resolve => setImmediate(resolve));
    const claim = JSON.parse(readFileSync(join(f.receiver.controlPath(ws.id), 'writer.json'), 'utf8'));
    assert.ok(claim.pid > 0);
    await f.receiver.stop(); await settled;
    assert.throws(() => process.kill(claim.pid, 0), { code: 'ESRCH' });
    assert.equal(existsSync(join(f.receiver.controlPath(ws.id), 'writer.json')), false);
    assert.equal(f.store.effect('stopped-operation')?.state, 'unknown');
    const next = new CodingWorkspaces(f.options);
    assert.equal((await next.reconcile(ws.id, 3, 'stopped-operation')).status, 'not-staged');
    assert.equal((await next.perform(ws.id, 3, 'next-read', { kind: 'manifest' })).ok, true);
    await next.stop();
  } finally { await f.cleanup(); }
});

test('root replacement before grant selection is refused without reserving an effect', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    const ws = f.receiver.create(f.input);
    const original = f.receiver.path(ws.id);
    renameSync(original, `${original}.retained`); mkdirSync(original, { mode: 0o700 });
    await assert.rejects(f.receiver.perform(ws.id, 3, 'replaced-root', { kind: 'manifest' }), /identity/i);
    assert.equal(f.store.effect('replaced-root'), undefined);
    assert.equal(readFileSync(join(`${original}.retained`, 'src/main.ts'), 'utf8'), 'first\nsecond\n');
  } finally { await f.cleanup(); }
});

test('case aliases for source parent directories cannot silently change tree identity', async () => {
  const f = fixture();
  try {
    const aliased = [{ path: 'Src/a', content: Buffer.from('a'), mode: 0o644 as const },
      { path: 'src/b', content: Buffer.from('b'), mode: 0o644 as const }];
    assert.throws(() => workspaceTreeDigest(aliased), /collision|alias/i);
  } finally { await f.cleanup(); }
});

test('malformed UTF-16 filenames cannot change during an exact byte/mode import', async () => {
  const f = fixture();
  try {
    const malformed = [{ path: 'bad-\ud800', content: Buffer.from('content'), mode: 0o644 as const }];
    assert.throws(() => workspaceTreeDigest(malformed), /path|encoding/i);
    assert.throws(() => f.receiver.create({ ...f.input, files: malformed }), /path|encoding/i);
    assert.equal(f.store.listEvents().filter(event => event.type === 'workspace.created').length, 0);
  } finally { await f.cleanup(); }
});

test('lost receipt after actual mutation reconciles exact postconditions after reopening', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    const ws = f.receiver.create(f.input);
    const target = join(f.receiver.path(ws.id), 'committed.ts');
    const original = f.options.authorize;
    // Revoke only when actual filesystem evidence proves the helper already
    // changed the file, before the receiver can complete its SQLite receipt.
    f.options.authorize = authority => original(authority) && !existsSync(target);
    await assert.rejects(f.receiver.perform(ws.id, 3, 'lost-receipt', { kind: 'create', path: 'committed.ts', content: 'preserved', mode: 0o644 }), /authority/i);
    assert.equal(readFileSync(target, 'utf8'), 'preserved');
    assert.equal(f.store.effect('lost-receipt')?.state, 'unknown');
    f.options.authorize = original;
    await f.receiver.stop(); f.store.close();
    const reopened = new Store(join(f.root, 'state.sqlite'));
    try {
      const receiver = new CodingWorkspaces({ ...f.options, store: reopened });
      assert.equal((await receiver.reconcile(ws.id, 3, 'lost-receipt')).status, 'completed');
      assert.equal(reopened.effect('lost-receipt')?.state, 'completed');
      const saved = await receiver.perform(ws.id, 3, 'lost-receipt', { kind: 'create', path: 'committed.ts', content: 'preserved', mode: 0o644 });
      assert.equal(saved.ok, true);
      assert.equal(readFileSync(target, 'utf8'), 'preserved');
      await receiver.stop();
    } finally { reopened.close(); }
  } finally { await f.cleanup(); }
});

test('reserved but undispatched mutation resolves not-applied and is never replayed', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    const ws = f.receiver.create(f.input);
    const operation = { kind: 'create' as const, path: 'never.ts', content: 'draft', mode: 0o644 as const };
    f.store.reserveEffect({ id: 'undispatched', taskId: f.task.id, kind: 'workspace.files',
      payload: { workspaceId: ws.id, epoch: 3, baseTreeDigest: ws.base.treeDigest, helperDigest, operation } });
    f.store.markEffectUnknown('undispatched', 'Fixture coordinator interrupted before spawn');
    assert.equal((await f.receiver.reconcile(ws.id, 3, 'undispatched')).status, 'not-staged');
    assert.equal((await f.receiver.perform(ws.id, 3, 'undispatched', operation)).ok, false);
    assert.equal(existsSync(join(f.receiver.path(ws.id), 'never.ts')), false);
    assert.equal((await f.receiver.perform(ws.id, 3, 'explicit-new-operation', operation)).ok, true);
  } finally { await f.cleanup(); }
});

test('mixed staged outcome stays unknown and blocks a conflicting new mutation', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture();
  try {
    const ws = f.receiver.create(f.input);
    const operation = { kind: 'move' as const, path: 'src/main.ts', destination: 'moved.ts', expected: { sha256: sha('first\nsecond\n'), mode: 0o644 as const } };
    f.store.reserveEffect({ id: 'mixed', taskId: f.task.id, kind: 'workspace.files',
      payload: { workspaceId: ws.id, epoch: 3, baseTreeDigest: ws.base.treeDigest, helperDigest, operation } });
    f.store.markEffectUnknown('mixed', 'Fixture interrupted move with unrelated competing state');
    const stage = join(f.receiver.controlPath(ws.id), 'staging', sha('mixed')); mkdirSync(stage, { mode: 0o700 });
    const before = { sha256: sha('first\nsecond\n'), bytes: 13, mode: 0o644 };
    writeFileSync(join(stage, 'manifest.json'), JSON.stringify({ version: 1, operationId: sha('mixed'), operationDigest: sha(JSON.stringify(operation)),
      rootDevice: ws.device, rootInode: ws.inode, changes: [{ path: 'src/main.ts', before, after: null }, { path: 'moved.ts', before: null, after: before }] }), { mode: 0o600 });
    writeFileSync(join(f.receiver.path(ws.id), 'moved.ts'), 'unrelated');
    assert.equal((await f.receiver.reconcile(ws.id, 3, 'mixed')).status, 'uncertain');
    assert.equal(f.store.effect('mixed')?.state, 'unknown');
    await assert.rejects(f.receiver.perform(ws.id, 3, 'must-wait', { kind: 'delete', path: 'empty', expected: { sha256: sha(''), mode: 0o644 } }), /uncertain|reconciliation/i);
    assert.equal(f.store.effect('must-wait'), undefined);
    assert.equal(readFileSync(join(f.receiver.path(ws.id), 'moved.ts'), 'utf8'), 'unrelated');
  } finally { await f.cleanup(); }
});
