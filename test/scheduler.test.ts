import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { GrowthScheduler } from '../src/scheduler.ts';
import { Store } from '../src/store.ts';
import { ProviderError, type Provider } from '../src/providers.ts';

const reflection = { observation: 'The supplied context does not establish a regression.', lesson: 'Preserve the behavior until a discriminating trial is available.', nextQuestion: 'What counterexample would challenge this interpretation?', proposedChange: null };
function fixture(complete?: Provider['complete']) {
  const dir = mkdtempSync(join(tmpdir(), 'palimpsest-scheduler-test-'));
  const path = join(dir, 'state.sqlite');
  const store = new Store(path);
  let calls = 0;
  const provider: Provider = { name: 'fixture', complete: async (request) => {
    calls++;
    return complete ? complete(request) : { text: JSON.stringify(reflection), provider: 'fixture', model: 'fixture-model', usage: { inputTokens: 3, outputTokens: 10 } };
  } };
  return { dir, path, store, provider, calls: () => calls, cleanup: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
async function until(done: () => boolean) {
  const deadline = Date.now() + 1500;
  while (!done()) {
    if (Date.now() >= deadline) throw new Error('Timed scheduler observation did not complete');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('running timer starts autonomous growth in all four dimensions and then stops spending', async () => {
  const f = fixture();
  const scheduler = new GrowthScheduler({ store: f.store, provider: f.provider, hasUserWork: () => false, intervalMs: 5, now: () => 100 });
  try {
    scheduler.start();
    await until(() => f.store.listGrowth().filter((item) => item.state === 'completed').length === 4);
    assert.equal(f.calls(), 4);
    assert.equal(new Set(f.store.listGrowth().filter((item) => item.state === 'completed').map((item) => item.dimension)).size, 4);
    const journal = f.store.listEvents().length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(f.calls(), 4);
    assert.equal(f.store.listEvents().length, journal);
  } finally { await scheduler.stop(); f.cleanup(); }
});

test('spent window budget survives SQLite reopen and new windows advance discovered questions', async () => {
  const f = fixture();
  let now = 100;
  let scheduler = new GrowthScheduler({ store: f.store, provider: f.provider, hasUserWork: () => false, now: () => now, windowMs: 1000, callsPerWindow: 2 });
  try {
    const first = await scheduler.tick();
    await scheduler.tick();
    assert.equal(f.calls(), 2);
    await scheduler.stop(); f.store.close();
    const reopened = new Store(f.path);
    try {
      scheduler = new GrowthScheduler({ store: reopened, provider: f.provider, hasUserWork: () => false, now: () => now, windowMs: 1000, callsPerWindow: 2 });
      assert.equal(await scheduler.tick(), null); assert.equal(f.calls(), 2);
      now = 1100;
      const third = await scheduler.tick();
      await scheduler.tick();
      assert.notEqual(third?.dimension, first?.dimension);
      assert.equal(new Set(reopened.listGrowth().filter((item) => item.state === 'completed').map((item) => item.dimension)).size, 4);
      now = 2100;
      const followup = await scheduler.tick();
      assert.match(followup!.id, /^followup:/);
      assert.equal(f.calls(), 5);
    } finally { await scheduler.stop(); reopened.close(); }
  } finally { f.cleanup(); }
});

test('user work prevents initiation and timer aborts an in-flight inquiry without a refund', async () => {
  let busy = true;
  let interrupted = false;
  const f = fixture(async (request) => new Promise((_resolve, reject) => {
    request.signal!.addEventListener('abort', () => { interrupted = true; reject(new ProviderError('cancelled', 'cancelled')); }, { once: true });
  }));
  const scheduler = new GrowthScheduler({ store: f.store, provider: f.provider, hasUserWork: () => busy, intervalMs: 5, callsPerWindow: 1, now: () => 100 });
  try {
    scheduler.start(); await new Promise((resolve) => setTimeout(resolve, 20)); assert.equal(f.calls(), 0);
    busy = false; await until(() => f.calls() === 1);
    busy = true; await until(() => interrupted && f.store.listGrowth().some((item) => item.state === 'paused'));
    busy = false; await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(f.calls(), 1);
    assert.equal(f.store.growthWindow('standing-growth-v1:0')?.usedCalls, 1);
    assert.equal(f.store.listMemories('growth').length, 0);
  } finally { await scheduler.stop(); f.cleanup(); }
});

test('window ledger rejects refills and overlapping reconfiguration; shared stores cannot overdraw', () => {
  const f = fixture();
  const second = new Store(f.path);
  try {
    const window = f.store.openGrowthWindow({ id: 'budget:0', schedulerId: 'budget', startsAt: 0, endsAt: 1000, maxCalls: 1 });
    assert.throws(() => second.openGrowthWindow({ ...window, maxCalls: 2 }), /immutable|conflict/i);
    assert.throws(() => second.openGrowthWindow({ id: 'budget:other', schedulerId: 'budget', startsAt: 500, endsAt: 1500, maxCalls: 1 }), /overlap/i);
    const one = f.store.addGrowth({ dimension: 'code_quality', question: 'one', origin: 'fixture', budget: 0 });
    const two = f.store.addGrowth({ dimension: 'interests_curiosity', question: 'two', origin: 'fixture', budget: 0 });
    assert.equal(f.store.claimGrowthInWindow(one.id, window.id, 100)?.remainingBudget, 0);
    assert.equal(second.claimGrowthInWindow(two.id, window.id, 100), undefined);
    assert.equal(second.growthWindow(window.id)?.usedCalls, 1);
    assert.equal(second.growth(two.id)?.budget, 0);
  } finally { second.close(); f.cleanup(); }
});

test('expired windows and invalid limits cannot start model work', async () => {
  const f = fixture();
  try {
    const item = f.store.addGrowth({ dimension: 'code_quality', question: 'one', origin: 'fixture', budget: 0 });
    f.store.openGrowthWindow({ id: 'old', schedulerId: 'budget', startsAt: 0, endsAt: 100, maxCalls: 4 });
    assert.equal(f.store.claimGrowthInWindow(item.id, 'old', 100), undefined);
    for (const callsPerWindow of [-1, Infinity, NaN, 1.5]) assert.throws(() => new GrowthScheduler({ store: f.store, provider: f.provider, hasUserWork: () => false, callsPerWindow }), /budget|limit/i);
    const disabled = new GrowthScheduler({ store: f.store, provider: f.provider, hasUserWork: () => false, callsPerWindow: 0, now: () => 100 });
    assert.equal(await disabled.tick(), null); assert.equal(f.calls(), 0); await disabled.stop();
  } finally { f.cleanup(); }
});

test('crash after durable claim consumes the window but retains the inquiry for a later allocation', async () => {
  const f = fixture();
  try {
    const item = f.store.addGrowth({ id: 'interrupted-inquiry', dimension: 'code_quality', question: 'Inspect behavior', origin: 'fixture', budget: 0 });
    f.store.openGrowthWindow({ id: 'standing-growth-v1:0', schedulerId: 'standing-growth-v1', startsAt: 0, endsAt: 1000, maxCalls: 1 });
    f.store.claimGrowthInWindow(item.id, 'standing-growth-v1:0', 100);
    f.store.close();
    const reopened = new Store(f.path);
    try {
      // The host has confirmed the previous execution owner is stopped.
      reopened.recoverGrowthInterrupted();
      const scheduler = new GrowthScheduler({ store: reopened, provider: f.provider, hasUserWork: () => false, now: () => 100, windowMs: 1000, callsPerWindow: 1 });
      assert.equal(await scheduler.tick(), null); assert.equal(f.calls(), 0);
      assert.equal(reopened.growth(item.id)?.state, 'paused');
      await scheduler.stop();
    } finally { reopened.close(); }
  } finally { f.cleanup(); }
});

test('proposal callback receives persisted data once and uncertain dispatch is not replayed', async () => {
  const proposal = { summary: 'Improve error', rationale: 'Observed fixture ambiguity', acceptanceCriteria: ['Reject empty input'], files: [{ path: 'src/agent/example.ts', content: 'export const example = 1;' }] };
  const f = fixture(async () => ({ text: JSON.stringify({ ...reflection, proposedChange: proposal }), provider: 'fixture', model: 'fixture-model', usage: { inputTokens: 1, outputTokens: 1 } }));
  let notified = 0;
  let scheduler = new GrowthScheduler({ store: f.store, provider: f.provider, hasUserWork: () => false, callsPerWindow: 1, now: () => 100,
    onProposedChange: async ({ growth, proposedChange }) => {
      notified++; assert.equal(f.store.growth(growth.id)?.state, 'completed'); assert.deepEqual(proposedChange, proposal);
      throw new Error('synthetic uncertain callback outcome');
    },
  });
  try {
    const result = await scheduler.tick();
    assert.equal(result?.state, 'completed'); assert.equal(notified, 1);
    assert.equal(f.store.growthProposalDelivery(result!.id)?.state, 'uncertain');
    await scheduler.stop();
    scheduler = new GrowthScheduler({ store: f.store, provider: f.provider, hasUserWork: () => false, callsPerWindow: 1, now: () => 100, onProposedChange: () => { notified++; } });
    await scheduler.tick(); assert.equal(notified, 1);
  } finally { await scheduler.stop(); f.cleanup(); }
});

test('stop ends the timer and rejects further initiation', async () => {
  const f = fixture();
  const scheduler = new GrowthScheduler({ store: f.store, provider: f.provider, hasUserWork: () => false, intervalMs: 5, now: () => 100 });
  try {
    await scheduler.stop();
    assert.throws(() => scheduler.start(), /stopped/i);
    assert.equal(await scheduler.tick(), null);
    assert.equal(f.calls(), 0);
  } finally { f.cleanup(); }
});

test('a stalled proposal callback times out as uncertain and receives cancellation', async () => {
  const proposal = { summary: 'Improve error', rationale: 'Observed fixture ambiguity', acceptanceCriteria: ['Reject empty input'], files: [{ path: 'src/agent/example.ts', content: 'export const example = 1;' }] };
  const f = fixture(async () => ({ text: JSON.stringify({ ...reflection, proposedChange: proposal }), provider: 'fixture', model: 'fixture-model', usage: { inputTokens: 1, outputTokens: 1 } }));
  let aborted = false;
  const scheduler = new GrowthScheduler({ store: f.store, provider: f.provider, hasUserWork: () => false, callsPerWindow: 1, now: () => 100, proposalTimeoutMs: 10,
    onProposedChange: ({ signal }) => new Promise(() => { signal.addEventListener('abort', () => { aborted = true; }); }),
  });
  try {
    const result = await scheduler.tick();
    assert.equal(aborted, true);
    assert.equal(f.store.growthProposalDelivery(result!.id)?.state, 'uncertain');
  } finally { await scheduler.stop(); f.cleanup(); }
});

test('a timer configuration failure stops polling after one durable error', async () => {
  const f = fixture();
  f.store.openGrowthWindow({ id: 'standing-growth-v1:0', schedulerId: 'standing-growth-v1', startsAt: 0, endsAt: 86_400_000, maxCalls: 1 });
  let errors = 0;
  const scheduler = new GrowthScheduler({ store: f.store, provider: f.provider, hasUserWork: () => false, callsPerWindow: 2, intervalMs: 5, now: () => 100, onError: () => { errors++; } });
  try {
    scheduler.start(); await until(() => errors > 0);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(errors, 1);
    assert.equal(f.store.listEvents().filter((event) => event.type === 'growth.scheduler.error').length, 1);
    assert.equal(f.calls(), 0);
  } finally { await scheduler.stop(); f.cleanup(); }
});

test('simultaneous child-process claims cannot spend the same final window call twice', async () => {
  const f = fixture();
  const children: ReturnType<typeof spawn>[] = [];
  try {
    f.store.openGrowthWindow({ id: 'shared', schedulerId: 'shared', startsAt: 0, endsAt: 1000, maxCalls: 1 });
    const items = ['one', 'two'].map((id) => f.store.addGrowth({ id, dimension: 'code_quality', question: id, origin: 'fixture', budget: 0 }));
    const runs = items.map((item) => {
      const source = `import {Store} from ${JSON.stringify(new URL('../src/store.ts', import.meta.url).href)};
        const store=new Store(${JSON.stringify(f.path)}); process.stdout.write('ready\\n');
        process.stdin.once('data',()=>{const result=store.claimGrowthInWindow(${JSON.stringify(item.id)},'shared',100);process.stdout.write(result?'1':'0');store.close();process.exit(0)});`;
      const child = spawn(process.execPath, ['--input-type=module', '--eval', source], { stdio: ['pipe', 'pipe', 'pipe'] });
      children.push(child);
      let output = '';
      let ready!: () => void;
      const begun = new Promise<void>((resolve) => { ready = resolve; });
      child.stdout!.on('data', (chunk) => { output += chunk.toString(); if (output.includes('ready\n')) ready(); });
      const finished = new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Child budget test timed out')); }, 5000);
        child.once('error', reject);
        child.once('close', (code) => { clearTimeout(timer); code === 0 ? resolve(Number(output.split('\n')[1])) : reject(new Error('Budget child failed')); });
      });
      return { child, begun, finished };
    });
    await Promise.all(runs.map((run) => run.begun));
    for (const run of runs) run.child.stdin!.write('go');
    assert.equal((await Promise.all(runs.map((run) => run.finished))).reduce((a, b) => a + b, 0), 1);
    assert.equal(f.store.growthWindow('shared')?.usedCalls, 1);
  } finally { for (const child of children) child.kill('SIGKILL'); f.cleanup(); }
});
