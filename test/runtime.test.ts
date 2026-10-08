import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { DirectCommunications, CommunicationsError } from '../src/communications.ts';
import { ProviderError } from '../src/providers.ts';
import type { CompletionRequest, Provider } from '../src/providers.ts';
import { AgentRuntime } from '../src/runtime.ts';

function provider(complete: Provider['complete']): Provider { return { name: 'fixture', complete }; }
function result(text: string) { return { text, model: 'fixture', provider: 'fixture', usage: { inputTokens: 1, outputTokens: 1 } }; }
const message = (id: string, conversationId = 'one') => ({ id, conversationId, text: `Hello ${id}`, source: 'direct' });

test('direct ingress returns durable queued work, deduplicates, and preserves scoped episodes', async () => {
  const store = new Store(':memory:');
  const direct = new DirectCommunications();
  const prompts: CompletionRequest[] = [];
  const runtime = new AgentRuntime({ store, communications: [direct], provider: provider(async request => {
    prompts.push(request); return result(`answer ${prompts.length}`);
  }) });
  try {
    const first = await runtime.submit(message('a'));
    assert.equal((await runtime.submit(message('a'))).id, first.id);
    assert.equal(first.state, 'queued');
    await runtime.runUntilIdle();
    assert.equal(runtime.status(first.id)?.state, 'succeeded');
    assert.equal(prompts.length, 1);
    assert.equal(direct.messages('one').filter(m => m.kind === 'result').length, 1);
    assert.equal(store.listMemories('one').length, 1);
    await runtime.submit(message('b', 'two'));
    await runtime.runUntilIdle();
    assert.ok(!prompts[1]!.prompt.includes('Hello a'));
  } finally { await runtime.stop(); store.close(); }
});

test('cancel remains responsive during inference and late output cannot become a reply or memory', async () => {
  const store = new Store(':memory:'); const direct = new DirectCommunications();
  let release!: () => void; let started!: () => void;
  const begun = new Promise<void>(r => { started = r; });
  const blocked = new Promise<void>(r => { release = r; });
  const runtime = new AgentRuntime({ store, communications: [direct], provider: provider(async () => { started(); await blocked; return result('late'); }) });
  try {
    const task = await runtime.submit(message('a'));
    const drain = runtime.runUntilIdle();
    await begun;
    assert.equal(runtime.status(task.id)?.state, 'running');
    assert.equal(runtime.cancel(task.id)?.state, 'cancelled');
    release(); await drain;
    assert.equal(runtime.status(task.id)?.state, 'cancelled');
    assert.equal(direct.messages('one').filter(m => m.kind === 'result').length, 0);
    assert.equal(store.listMemories('one').length, 0);
  } finally { release(); await runtime.stop(); store.close(); }
});

test('provider unavailability waits without fallback and consumes its persisted call budget', async () => {
  const store = new Store(':memory:');
  let calls = 0;
  const runtime = new AgentRuntime({ store, communications: [new DirectCommunications()], maxCallsPerTask: 1,
    provider: provider(async () => { calls++; throw new ProviderError('unavailable', 'provider offline'); }) });
  try {
    const task = await runtime.submit(message('a'));
    await runtime.runUntilIdle();
    assert.equal(runtime.status(task.id)?.state, 'waiting_for_provider');
    assert.equal(calls, 1);
    runtime.retry(task.id);
    await runtime.runUntilIdle();
    assert.equal(calls, 1);
    assert.equal(runtime.status(task.id)?.error, 'inference_budget_exhausted');
  } finally { await runtime.stop(); store.close(); }
});

test('uncertain communication remains blocked and is never blindly replayed', async () => {
  const store = new Store(':memory:'); let sends = 0;
  const runtime = new AgentRuntime({ store, provider: provider(async () => result('hello')),
    communications: [{ name: 'direct', send: async () => { sends++; throw new CommunicationsError('transport_lost', 'uncertain'); } }] });
  try {
    const task = await runtime.submit(message('a')); await runtime.runUntilIdle();
    assert.equal(runtime.status(task.id)?.error, 'effect_reconciliation_required');
    assert.equal(store.listEffects(task.id)[0]?.state, 'unknown');
    assert.throws(() => runtime.retry(task.id), /reconcil/i);
    await runtime.runUntilIdle(); assert.equal(sends, 1);
  } finally { await runtime.stop(); store.close(); }
});

test('shutdown during uncertain delivery checkpoints reconciliation instead of retrying', async () => {
  const store = new Store(':memory:');
  let started!: () => void; let rejectDelivery!: () => void;
  const begun = new Promise<void>(r => { started = r; });
  const failed = new Promise<void>((_, reject) => { rejectDelivery = () => reject(new CommunicationsError('lost', 'uncertain')); });
  const runtime = new AgentRuntime({ store, provider: provider(async () => result('answer')),
    communications: [{ name: 'direct', send: async () => { started(); await failed; } }] });
  try {
    const task = await runtime.submit(message('shutdown'));
    const drain = runtime.runUntilIdle(); await begun;
    const stopping = runtime.stop(); rejectDelivery();
    await assert.doesNotReject(Promise.all([drain, stopping]));
    assert.equal(store.task(task.id)?.state, 'waiting_for_provider');
    assert.equal(store.task(task.id)?.error, 'effect_reconciliation_required');
  } finally { await runtime.stop().catch(() => {}); store.close(); }
});
