import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AgentWorker } from '../src/workers.ts';
import type { Task } from '../src/store.ts';

const darwin = { skip: process.platform !== 'darwin' };
const task: Task = { id: 'session-fixture', conversationId: 'scope', input: 'ordinary request', source: 'direct', state: 'running',
  checkpoint: null, output: null, error: null, createdAt: 'fixture', updatedAt: 'fixture' };
function fixture(source: string): string {
  const root = mkdtempSync(join(tmpdir(), 'palimpsest-worker-session-'));
  mkdirSync(join(root, 'src/agent'), { recursive: true }); writeFileSync(join(root, 'src/agent/brain.ts'), source); return root;
}
const ordinary = 'export function conversationRequest(t,m,c){return {system:"fixture",prompt:JSON.stringify({request:t.input,sequence:c.sequence,scope:c.snapshot.scope,lesson:c.snapshot.lesson}),maxOutputTokens:8}}';

test('actual supervised worker survives two former lifetime windows with the same identity and checkpoint', darwin, async context => {
  const root = fixture(ordinary); let worker: AgentWorker | undefined;
  context.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    worker = await AgentWorker.start({ candidateRoot: root, scope: task.conversationId }); const pid = worker.peer.pid;
    await worker.catchUp({ sequence: 7, snapshot: { scope: task.conversationId, lesson: 'retained draft context' }, policyVersion: 'fixture' });
    for (const advance of [300001, 300001]) {
      context.mock.timers.tick(advance); await new Promise(resolve => setImmediate(resolve));
      assert.equal(await worker.probe(), 'healthy'); assert.equal(worker.peer.pid, pid); process.kill(pid, 0);
      const response = JSON.parse((await worker.request(task, [])).prompt);
      assert.equal(response.sequence, 7); assert.equal(response.lesson, 'retained draft context'); assert.equal(worker.sequence, 7);
    }
  } finally { await worker?.stop(); context.mock.timers.reset(); rmSync(root, { recursive: true, force: true }); }
});

test('more than one MiB of aggregate valid responses never becomes a lifetime transcript limit', darwin, async () => {
  const root = fixture('export function conversationRequest(t){return {system:"x".repeat(32000),prompt:JSON.stringify({request:t.input}),maxOutputTokens:8}}');
  const worker = await AgentWorker.start({ candidateRoot: root }); const pid = worker.peer.pid;
  try {
    let bytes = 0;
    for (let index = 0; index < 40; index++) { const result = await worker.request(task, []); bytes += Buffer.byteLength(result.system) + Buffer.byteLength(result.prompt); }
    assert.ok(bytes > 1048576); assert.equal(worker.closed, false); assert.equal(worker.peer.pid, pid); assert.equal(await worker.probe(), 'healthy');
  } finally { await worker.stop(); rmSync(root, { recursive: true, force: true }); }
});

test('supervised descriptors cannot write disposable HOME or TMPDIR', darwin, async () => {
  const root = fixture(`import fs from 'node:fs';import path from 'node:path';export function conversationRequest(t){const denied=[];
    for(const directory of [process.env.HOME,process.env.TMPDIR]){try{fs.writeFileSync(path.join(directory,'candidate-write'),'bad');denied.push(false)}catch{denied.push(true)}}
    return {system:'fixture',prompt:JSON.stringify({request:t.input,denied}),maxOutputTokens:8}}`);
  const worker = await AgentWorker.start({ candidateRoot: root });
  try { assert.deepEqual(JSON.parse((await worker.request(task, [])).prompt).denied, [true, true]); }
  finally { await worker.stop(); rmSync(root, { recursive: true, force: true }); }
});

test('explicit finite worker lifetime remains bounded and stop drains the actual process', darwin, async () => {
  const root = fixture(ordinary); const worker = await AgentWorker.start({ candidateRoot: root, lifetimeMs: 250 }); const pid = worker.peer.pid;
  try { await new Promise(resolve => setTimeout(resolve, 350)); assert.equal(await worker.probe(), 'failed'); }
  finally { await worker.stop(); assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }); rmSync(root, { recursive: true, force: true }); }
});

test('trusted authority rejection stops and drains the owned worker before returning', darwin, async () => {
  const root = fixture(ordinary); let allowed = true;
  const worker = await AgentWorker.start({ candidateRoot: root, authorize: () => { if (!allowed) throw new Error('Fixture authority revoked'); } }); const pid = worker.peer.pid;
  try {
    await worker.request(task, []); allowed = false;
    await assert.rejects(worker.request(task, []), /revoked/);
    assert.equal(worker.closed, true); assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  } finally { await worker.stop(); rmSync(root, { recursive: true, force: true }); }
});

test('accepted task and memory bytes are frozen before yielding for authority and process drain', darwin, async () => {
  const root = fixture('export function conversationRequest(t,m){return {system:"fixture",prompt:JSON.stringify({request:t.input,memory:m[0].content}),maxOutputTokens:8}}');
  const worker = await AgentWorker.start({ candidateRoot: root });
  try {
    const accepted = structuredClone(task);
    const memories = [{ id: 'fixture-memory', version: 1, scope: task.conversationId, kind: 'episodic' as const,
      content: 'accepted memory', source: 'fixture', confidence: 1, evidence: [], createdAt: 'fixture', updatedAt: 'fixture' }];
    const pending = worker.request(accepted, memories); accepted.input = 'changed input'; memories[0]!.content = 'changed memory';
    assert.deepEqual(JSON.parse((await pending).prompt), { request: 'ordinary request', memory: 'accepted memory' });
  } finally { await worker.stop(); rmSync(root, { recursive: true, force: true }); }
});

test('async authority callbacks fail closed and delayed rejections are consumed before releasing ownership', darwin, async () => {
  for (const late of [false, true]) {
    const root = fixture(ordinary);
    const worker = await AgentWorker.start({ candidateRoot: root, authorize: () => late
      ? new Promise<void>((_resolve, reject) => setTimeout(() => reject(new Error('Synthetic delayed authority denial')), 10))
      : Promise.resolve() }); const pid = worker.peer.pid;
    try {
      await assert.rejects(worker.request(task, []), /synchronous/);
      assert.equal(worker.closed, true); assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
      await new Promise(resolve => setTimeout(resolve, 30));
    } finally { await worker.stop(); rmSync(root, { recursive: true, force: true }); }
  }
});
