import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AgentWorker } from '../src/workers.ts';
import type { Task } from '../src/store.ts';

const task: Task = { id: 'task', conversationId: 'scope', input: 'ordinary memory', source: 'direct', state: 'running',
  checkpoint: null, output: null, error: null, createdAt: 'now', updatedAt: 'now' };
function fixture(source?: string) {
  const root = mkdtempSync(join(tmpdir(), 'palimpsest-worker-'));
  mkdirSync(join(root, 'src/agent'), { recursive: true });
  if (source) writeFileSync(join(root, 'src/agent/brain.ts'), source);
  else copyFileSync(resolve('src/agent/brain.ts'), join(root, 'src/agent/brain.ts'));
  return root;
}

test('real restricted worker uses actual child identity and current snapshot without credentials', { skip: process.platform !== 'darwin' }, async () => {
  const root = fixture(); let active = true; const seen: number[] = [];
  const worker = await AgentWorker.start({ candidateRoot: root, scope: task.conversationId, authorize: peer => { assert.ok(active); seen.push(peer.pid); } });
  try {
    assert.notEqual(worker.peer.pid, process.pid);
    await worker.catchUp({ sequence: 4, snapshot: { scope: task.conversationId, lesson: 'current' }, policyVersion: 'v1' });
    const result = await worker.request(task, []);
    assert.equal(JSON.parse(result.prompt).request, task.input);
    assert.equal(worker.sequence, 4); assert.ok(seen.every(pid => pid === worker.peer.pid));
    assert.equal(await worker.probe(), 'healthy');
    active = false;
    await assert.rejects(worker.request(task, []));
  } finally { await worker.stop(); rmSync(root, { recursive: true, force: true }); }
});

test('actual hung and crashed generations fail closed within their RPC deadline', { skip: process.platform !== 'darwin' }, async () => {
  for (const source of ['export function conversationRequest(){while(true){}}', 'export function conversationRequest(){process.exit(0)}']) {
    const root = fixture(source);
    const worker = await AgentWorker.start({ candidateRoot: root, rpcTimeoutMs: 100 });
    try { assert.equal(await worker.probe(), 'failed'); await assert.rejects(worker.request(task, [])); }
    finally { await worker.stop(); rmSync(root, { recursive: true, force: true }); }
  }
});

test('cold module startup has a separate budget while steady requests retain their short deadline', { skip: process.platform !== 'darwin' }, async () => {
  // P05 defect specification: initialization may exceed a short request budget;
  // granting startup time must never extend the deadline of a hung request.
  const root = fixture('await new Promise(resolve => setTimeout(resolve, 250)); export function conversationRequest(){while(true){}}');
  let worker: AgentWorker | undefined;
  try {
    worker = await AgentWorker.start({ candidateRoot: root, rpcTimeoutMs: 50 });
    const began = performance.now();
    assert.equal(await worker.probe(), 'failed');
    assert.ok(performance.now() - began < 1500, 'steady RPC must not inherit the three-second startup budget');
  } finally { await worker?.stop(); rmSync(root, { recursive: true, force: true }); }
});

test('an unresponsive module cannot exceed its separate startup allowance', { skip: process.platform !== 'darwin' }, async () => {
  const root = fixture('while(true){} export function conversationRequest(){}');
  try {
    const began = performance.now();
    await assert.rejects(AgentWorker.start({ candidateRoot: root, startupTimeoutMs: 100, rpcTimeoutMs: 3000 }), /deadline|failed/i);
    assert.ok(performance.now() - began < 1500);
    for (const startupTimeoutMs of [0, NaN, Infinity, 2_147_483_648]) await assert.rejects(AgentWorker.start({ candidateRoot: root, startupTimeoutMs }), /deadline/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('worker cannot read private substrate or execute arbitrary host commands', { skip: process.platform !== 'darwin' }, async () => {
  const privateRoot = mkdtempSync(join(tmpdir(), 'palimpsest-private-'));
  const privatePath = join(privateRoot, 'experience'); writeFileSync(privatePath, 'must remain private');
  const root = fixture(`import {readFileSync} from 'node:fs'; import {execFileSync} from 'node:child_process';
    export function conversationRequest(t){let denied=0;try{readFileSync(${JSON.stringify(privatePath)})}catch{denied++}try{execFileSync('/bin/sh',['-c','true'])}catch{denied++}return {system:String(denied),prompt:JSON.stringify({request:t.input}),maxOutputTokens:8}}`);
  const worker = await AgentWorker.start({ candidateRoot: root });
  try { assert.equal((await worker.request(task, [])).system, '2'); }
  finally { await worker.stop(); rmSync(root, { recursive: true, force: true }); rmSync(privateRoot, { recursive: true, force: true }); }
});

test('invalid descriptor and unsolicited or oversized worker messages cannot become accepted requests', { skip: process.platform !== 'darwin' }, async () => {
  for (const source of [
    'export function conversationRequest(){return {system:"x",prompt:"y",tools:["shell"]}}',
    'export function conversationRequest(){process.stdout.write(JSON.stringify({id:"invented",result:{system:"x",prompt:"y"}})+"\\n");return {system:"x",prompt:"y"}}',
    'export function conversationRequest(){return {system:"x",prompt:"x".repeat(100000)}}',
  ]) {
    const root = fixture(source); const worker = await AgentWorker.start({ candidateRoot: root });
    try { await assert.rejects(worker.request(task, [])); }
    finally { await worker.stop(); rmSync(root, { recursive: true, force: true }); }
  }
});

test('cached candidate globals cannot cross conversations in a persistent worker', { skip: process.platform !== 'darwin' }, async () => {
  const root = fixture(`let retained=''; export function conversationRequest(t,m,c){retained += m.map(x=>x.content).join();return {system:'fixture',prompt:JSON.stringify({request:t.input,retained,checkpoint:c}),maxOutputTokens:100}}`);
  const worker = await AgentWorker.start({ candidateRoot: root });
  let other: AgentWorker | undefined;
  try {
    const first = JSON.parse((await worker.request(task, [{ id: 'private', version: 1, scope: task.conversationId, kind: 'episodic', content: 'SCOPE_ONE_SECRET', source: 'fixture', confidence: 1, evidence: [], createdAt: 'now', updatedAt: 'now' }])).prompt);
    assert.equal(first.retained, 'SCOPE_ONE_SECRET');
    await assert.rejects(worker.request({ ...task, conversationId: 'other' }, []), /scope/i);
    other = await AgentWorker.start({ candidateRoot: root, scope: 'other' });
    const second = await other.request({ ...task, conversationId: 'other' }, []);
    assert.ok(!second.prompt.includes('SCOPE_ONE_SECRET'));
    await assert.rejects(worker.request(task, [{ id: 'wrong', version: 1, scope: 'other', kind: 'episodic', content: 'OTHER_SECRET', source: 'fixture', confidence: 1, evidence: [], createdAt: 'now', updatedAt: 'now' }]), /scope/i);
  } finally { await worker.stop(); await other?.stop(); rmSync(root, { recursive: true, force: true }); }
});

test('checkpoint delivery is bound to conversation scope and health receives empty synthetic context', { skip: process.platform !== 'darwin' }, async () => {
  const root = fixture(`let healthContext=null;export function conversationRequest(t,m,c){if(t.id==='health')healthContext=c;return {system:'fixture',prompt:JSON.stringify({request:t.input,checkpoint:c,healthContext}),maxOutputTokens:100}}`);
  const worker = await AgentWorker.start({ candidateRoot: root, scope: task.conversationId });
  try {
    await assert.rejects(worker.catchUp({ sequence: 1, snapshot: { secret: 'UNSCOPED' }, policyVersion: 'v1' }), /scope/i);
    await assert.rejects(worker.catchUp({ sequence: 1, snapshot: { scope: 'other', secret: 'OTHER_SECRET' }, policyVersion: 'v1' }), /scope/i);
    await worker.catchUp({ sequence: 1, snapshot: { scope: task.conversationId, secret: 'SCOPED_SECRET' }, policyVersion: 'v1' });
    assert.equal(await worker.probe(), 'healthy');
    const result = JSON.parse((await worker.request(task, [])).prompt);
    assert.equal(result.checkpoint.snapshot.secret, 'SCOPED_SECRET');
    assert.ok(!JSON.stringify(result.healthContext).includes('SCOPED_SECRET'));
    assert.equal(result.healthContext.snapshot.scope, 'health');
  } finally { await worker.stop(); rmSync(root, { recursive: true, force: true }); }
});

test('an unbound staged checkpoint never reaches a first request for another scope', { skip: process.platform !== 'darwin' }, async () => {
  const root = fixture('export function conversationRequest(t,m,c){return {system:"fixture",prompt:JSON.stringify({request:t.input,checkpoint:c})}}');
  const worker = await AgentWorker.start({ candidateRoot: root });
  try {
    await worker.catchUp({ sequence: 1, snapshot: { scope: 'staged', secret: 'STAGED_SECRET' }, policyVersion: 'v1' });
    const result = JSON.parse((await worker.request(task, [])).prompt);
    assert.ok(!JSON.stringify(result).includes('STAGED_SECRET'));
    assert.equal(result.checkpoint.snapshot.scope, task.conversationId);
    assert.equal(worker.sequence, 0);
    await assert.rejects(worker.catchUp({ sequence: 2, snapshot: { scope: 'staged' }, policyVersion: 'v1' }), /scope/i);
  } finally { await worker.stop(); rmSync(root, { recursive: true, force: true }); }
});


test('catch-up transfers the full accepted snapshot beyond the ordinary request frame limit', { skip: process.platform !== 'darwin' }, async () => {
  const root = fixture(`export function conversationRequest(t,m,c){return {system:'fixture',prompt:JSON.stringify({request:t.input,length:c.snapshot.history.length,end:c.snapshot.history.slice(-8)}),maxOutputTokens:100}}`);
  const worker = await AgentWorker.start({ candidateRoot: root, scope: task.conversationId });
  try {
    const history = 'å'.repeat(180_000) + 'END-MARK';
    await worker.catchUp({ sequence: 9, snapshot: { scope: task.conversationId, history }, policyVersion: 'v9' });
    const result = JSON.parse((await worker.request(task, [])).prompt);
    assert.equal(result.length, history.length); assert.equal(result.end, 'END-MARK');
    assert.equal(worker.sequence, 9);
    await assert.rejects(worker.catchUp({ sequence: 10, snapshot: { scope: 'other', history }, policyVersion: 'v10' }), /scope/i);
    await assert.rejects(worker.catchUp({ sequence: 8, snapshot: { scope: task.conversationId, history }, policyVersion: 'v8' }), /checkpoint/i);
    await assert.rejects(worker.catchUp({ sequence: 10, snapshot: { scope: task.conversationId, history: 'x'.repeat(1_060_000) }, policyVersion: 'v10' }), /input exceeds limit/);
    assert.equal(worker.sequence, 9, 'rejected checkpoints do not advance continuity');
    await assert.rejects(worker.request({ ...task, input: 'x'.repeat(300_000) }, []), /input exceeds limit/);
    assert.equal(worker.closed, false, 'oversized ordinary requests are rejected before sending');
  } finally { await worker.stop(); rmSync(root, { recursive: true, force: true }); }
});
