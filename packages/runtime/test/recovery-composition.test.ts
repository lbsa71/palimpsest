import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { composition, envelope, input, original } from './recovery-composition-fixture.ts';
import { WorkspaceTools } from '../../tools/index.ts';
import type { ShellCheckpoint } from '../../contracts/execution/index.ts';

async function interrupt(root: string, phase: 'repair' | 'provider') {
  const marker = join(root, 'marker'); rmSync(marker, { force: true });
  const child = spawn(process.execPath, [fileURLToPath(new URL('./recovery-composition-fixture.ts', import.meta.url)), root, phase], { detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; child.stderr.on('data', chunk => stderr += String(chunk));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  try {
    const deadline = Date.now() + 30000;
    while (!existsSync(marker) && Date.now() < deadline) { assert.equal(child.exitCode, null, stderr); await delay(20); }
    assert.ok(existsSync(marker), stderr); const boundary = readFileSync(marker, 'utf8');
    child.kill('SIGKILL'); assert.deepEqual(await exited, { code: null, signal: 'SIGKILL' }); return boundary;
  } finally {
    // Reap any confined descendant left by the terminated host before granting the successor.
    try { process.kill(-child.pid!, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    await exited;
  }
}

test('one real confined inspect/edit/test/repair task survives lost repair receipt and interrupted provider through SQLite checkpoints', { timeout: 90000 }, async context => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-recovery-composition-')); mkdirSync(join(root, 'state')); mkdirSync(join(root, 'work'));
  writeFileSync(join(root, 'work', 'sum.mjs'), original);
  writeFileSync(join(root, 'work', 'verify.mjs'), "import assert from 'node:assert/strict'; import {sum} from './sum.mjs'; assert.equal(sum(2,3),5,'Observed seeded defect'); console.log('verified 5');\n");
  let f: ReturnType<typeof composition> | undefined;
  try {
    assert.equal(await interrupt(root, 'repair'), 'repair-applied-before-receipt');
    f = composition(root, 'finish'); const run = f.runtime.admit(input, f.authority, envelope);
    assert.deepEqual(f.runtime.recover(), [run.id]);
    const unresolved = f.effects.unresolved(run.id); assert.equal(unresolved.length, 1); const lost = unresolved[0]; assert.equal(lost.kind, 'workspace_patch');
    const lostRequest = f.resources.request(lost.reservationId!)!; assert.equal(lostRequest.status, 'uncertain');
    const checkpoint = f.store.get<{ checkpoint: ShellCheckpoint }>('execution', run.id)!.value.checkpoint;
    assert.ok(checkpoint); assert.match(JSON.stringify(f.store.readJsonArtifact(checkpoint.artifact)), /workspace_patch/);
    const next = f.authorities.activate(f.authorities.withdraw(f.authority), 'second', 'fixture-controls', 'fixture-source');
    assert.throws(() => f!.authorities.assert(f!.authority), /Stale or withdrawn/); f.runtime.adopt(run.id, next);
    assert.equal((await f.runtime.resume(run.id, f.prompt)).status, 'blocked');
    assert.equal((await f.effects.reconcile(lost.id, next)).status, 'uncertain');
    const inspected = await new WorkspaceTools(f.policy).execute('read', { path: 'sum.mjs' });
    assert.equal((inspected as { content: string }).content, original);
    f.effects.recordReconciliation(lost.id, next, 'succeeded', f.store.putJsonArtifact({ reason: 'reconciled actual repaired file', inspection: inspected }));
    assert.deepEqual(f.effects.get(lost.id)!.authority, lost.authority); assert.deepEqual(f.resources.request(lostRequest.id), lostRequest);
    f.close(); f = undefined;
    assert.equal(await interrupt(root, 'provider'), 'provider-dispatched-before-response');
    f = composition(root, 'finish'); assert.deepEqual(f.runtime.recover(), [run.id]);
    const unknown = f.store.list<{ request: { id: string; provider: string; status: string } }>('requests').map(row => row.value.request).filter(request => request.provider !== 'effect-receiver' && request.status === 'uncertain');
    assert.equal(unknown.length, 1); const unknownRequest = f.resources.request(unknown[0].id)!;
    const third = f.authorities.activate(f.authorities.withdraw(f.authority), 'third', 'fixture-controls', 'fixture-source'); f.runtime.adopt(run.id, third);
    assert.equal((await f.runtime.resume(run.id, f.prompt)).status, 'completed', JSON.stringify(f.store.get('execution', run.id)));
    assert.deepEqual(f.resources.request(unknownRequest.id), unknownRequest, 'unknown provider usage must remain reserved under its original identity');
    assert.deepEqual(f.resources.request(lostRequest.id), lostRequest, 'effect reconciliation cannot invent a physical usage receipt');
    assert.equal(f.runtime.admit(input, third, envelope).id, run.id); assert.equal(f.store.list('runs').length, 1);
    const audit = readFileSync(join(root, 'audit.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const effects = audit.filter(row => row.kind === 'effect'); assert.equal(effects.length, 5); assert.equal(new Set(effects.map(row => row.value.id)).size, 5);
    assert.deepEqual(effects.map(row => row.value.kind), ['workspace_read', 'workspace_write', 'command_run', 'workspace_patch', 'command_run']);
    assert.equal(audit.filter(row => row.kind === 'model').length, 7); assert.equal(f.resources.snapshot(run.id).requests, 12);
    const observations = f.runtime.observations(run.id); assert.equal(observations.length, 5); assert.equal(observations.filter(row => row.kind === 'error').length, 1);
    assert.match(JSON.stringify(observations), /verified 5/); assert.equal(readFileSync(join(root, 'work', 'sum.mjs'), 'utf8'), original);
    context.diagnostic(JSON.stringify({ boundaries: ['repair-applied-before-receipt', 'provider-dispatched-before-response'], effects: effects.length, modelRequests: 7, totalRequests: 12, unknownProviderRequests: 1, originalRepairGrant: lost.authority, finalGrant: third, evidenceKind: 'deterministic-model-real-process-storage-tools' }));
  } finally { f?.close(); rmSync(root, { recursive: true, force: true }); }
});
