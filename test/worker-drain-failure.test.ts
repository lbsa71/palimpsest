import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AgentWorker } from '../src/workers.ts';

test('worker stop retains unavailable process-group drain as a failure', { skip: process.platform !== 'linux' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'palimpsest-worker-drain-'));
  mkdirSync(join(root, 'src/agent'), { recursive: true });
  writeFileSync(join(root, 'src/agent/brain.ts'), 'export function conversationRequest(){return {system:"fixture",prompt:"fixture",maxOutputTokens:64};}');
  const worker = await AgentWorker.start({ candidateRoot: root });
  const originalKill = process.kill;
  // The kernel really terminates the worker. Only the independent absence
  // observation is unavailable, so successful signalling cannot count as drain.
  process.kill = ((pid: number, signal?: string | number) => {
    if (pid === -worker.peer.pid && signal === 0) throw Object.assign(new Error('fixture drain unavailable'), { code: 'EPERM' });
    return originalKill(pid, signal);
  }) as typeof process.kill;
  try {
    await assert.rejects(worker.stop(), /process group drain was not confirmed/);
  } finally {
    process.kill = originalKill;
    await worker.stop().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});
